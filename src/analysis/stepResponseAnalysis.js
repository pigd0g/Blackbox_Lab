// ======================================================
// BLACKBOX LAB — STEP RESPONSE ANALYSIS
// ======================================================
//
// JavaScript re-implementation of the FFT-based deconvolution
// step response algorithm described in step_response.md. It
// treats many short flight windows as repeated experiments,
// recovers the closed-loop impulse response from setpoint and
// gyro, integrates it to a step response, and averages the
// valid windows. Metrics are then extracted from the averaged
// response.
//
// The module works on the same CSV-shaped flight lines every
// other analysis uses, so it runs on both decoded binary .bbl
// files and text CSV exports.
//
// ======================================================

import { fftInPlace } from "./dsp/fft.js";

const AXIS_NAMES = ["Roll", "Pitch", "Yaw"];
const SETPOINT_ALIASES = [
  ["setpoint[0]", "setpoint_0", "rcCommand[0]"],
  ["setpoint[1]", "setpoint_1", "rcCommand[1]"],
  ["setpoint[2]", "setpoint_2", "rcCommand[2]"]
];
const GYRO_ALIASES = [
  ["gyroADC[0]", "gyroADC_0", "gyro[0]"],
  ["gyroADC[1]", "gyroADC_1", "gyro[1]"],
  ["gyroADC[2]", "gyroADC_2", "gyro[2]"]
];

function findColumnName(headers, aliases) {
  const normalizedHeaders = headers.map((header) =>
    String(header)
      .trim()
      .replace(/^"|"$/g, "")
      .toLowerCase()
  );

  for (const alias of aliases) {
    const normalizedAlias = String(alias).trim().toLowerCase();
    const index = normalizedHeaders.indexOf(normalizedAlias);
    if (index >= 0) {
      return headers[index];
    }
  }

  return null;
}

function readColumn(lines, headerIndex, columnName) {
  if (!columnName || headerIndex < 0) {
    return [];
  }

  const headers = lines[headerIndex]
    .split(",")
    .map((header) =>
      String(header)
        .trim()
        .replace(/^"|"$/g, "")
    );

  const columnIndex = headers.indexOf(columnName);
  if (columnIndex < 0) {
    return [];
  }

  const values = [];
  for (let row = headerIndex + 1; row < lines.length; row += 1) {
    const cells = lines[row].split(",");
    const rawValue =
      cells[columnIndex]
        ?.trim()
        .replace(/^"|"$/g, "") ?? "";

    if (rawValue === "") {
      values.push(Number.NaN);
      continue;
    }

    const value = Number(rawValue);
    values.push(Number.isFinite(value) ? value : Number.NaN);
  }

  return values;
}

function median(values) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return null;
  }

  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function estimateLogRate(timeMicroseconds) {
  if (!Array.isArray(timeMicroseconds) || timeMicroseconds.length < 2) {
    return null;
  }

  const diffs = [];
  for (let i = 1; i < timeMicroseconds.length; i += 1) {
    const diff = timeMicroseconds[i] - timeMicroseconds[i - 1];
    if (Number.isFinite(diff) && diff > 0) {
      diffs.push(diff);
    }
  }

  const dtUs = median(diffs);
  if (!Number.isFinite(dtUs) || dtUs <= 0) {
    return null;
  }

  return 1000.0 / dtUs; // samples per millisecond
}

function lowessSmooth(values, windowSize) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  if (windowSize <= 1) {
    return values.slice();
  }

  const n = values.length;
  const half = Math.floor(windowSize / 2);
  const smoothed = new Array(n);

  for (let i = 0; i < n; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const center = i - start;

    let weightedSum = 0;
    let weightSum = 0;

    for (let j = start; j < end; j += 1) {
      const distance = Math.abs(j - start - center) / (half + 1);
      const weight = distance < 1 ? Math.pow(1 - Math.pow(distance, 3), 3) : 0;
      const value = values[j];

      if (weight > 0 && Number.isFinite(value)) {
        weightedSum += weight * value;
        weightSum += weight;
      }
    }

    smoothed[i] = weightSum > 0 ? weightedSum / weightSum : values[i];
  }

  return smoothed;
}

function hannWindow(length) {
  const window = new Float64Array(length);

  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }

  return window;
}

function nextPowerOfTwo(n) {
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

function complexFft(signal) {
  const n = nextPowerOfTwo(signal.length);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  for (let i = 0; i < signal.length; i += 1) {
    real[i] = signal[i];
  }

  fftInPlace(real, imag);

  return { real, imag, length: n };
}

function complexIfft({ real, imag, length }) {
  const inverseReal = new Float64Array(real);
  const inverseImag = new Float64Array(imag);

  for (let i = 0; i < length; i += 1) {
    inverseImag[i] = -inverseImag[i];
  }

  fftInPlace(inverseReal, inverseImag);

  for (let i = 0; i < length; i += 1) {
    inverseReal[i] /= length;
    inverseImag[i] /= -length;
  }

  return { real: inverseReal, imag: inverseImag, length };
}

function elementWiseMultiply(aReal, aImag, bReal, bImag, length) {
  const resultReal = new Float64Array(length);
  const resultImag = new Float64Array(length);

  for (let i = 0; i < length; i += 1) {
    resultReal[i] = aReal[i] * bReal[i] - aImag[i] * bImag[i];
    resultImag[i] = aReal[i] * bImag[i] + aImag[i] * bReal[i];
  }

  return { real: resultReal, imag: resultImag };
}

function complexConjugate({ real, imag, length }) {
  return {
    real: new Float64Array(real),
    imag: imag.map((value) => -value),
    length
  };
}

function deconvolveStepResponse(setpoint, gyro, logRate, options = {}) {
  const segmentLength = Math.round(logRate * 2000); // 2-second windows
  const wnd = Math.round(logRate * 1000 * 0.5); // 500 ms response
  const padLength = 100;
  const minInput = options.minInput ?? 20;
  const yCorrection = options.yCorrection !== false;

  const n = Math.min(setpoint.length, gyro.length);
  if (n < segmentLength + padLength * 2) {
    return {
      timeMs: [],
      stepResponse: [],
      numSegments: 0
    };
  }

  const durationSeconds = n / (logRate * 1000);
  let subsampleFactor;
  if (durationSeconds <= 20) {
    subsampleFactor = 10;
  } else if (durationSeconds <= 60) {
    subsampleFactor = 7;
  } else {
    subsampleFactor = 3;
  }

  const segmentStep = Math.max(1, Math.round(segmentLength / subsampleFactor));
  const stepResponses = [];

  const window = hannWindow(segmentLength);

  for (
    let start = 0;
    start + segmentLength <= n;
    start += segmentStep
  ) {
    const setpointSegment = setpoint.slice(start, start + segmentLength);
    const gyroSegment = gyro.slice(start, start + segmentLength);

    const maxInput = Math.max(
      ...setpointSegment.map((value) => Math.abs(value))
    );
    if (!Number.isFinite(maxInput) || maxInput < minInput) {
      continue;
    }

    const a = new Float64Array(segmentLength);
    const b = new Float64Array(segmentLength);

    for (let i = 0; i < segmentLength; i += 1) {
      a[i] = (Number.isFinite(gyroSegment[i]) ? gyroSegment[i] : 0) * window[i];
      b[i] = (Number.isFinite(setpointSegment[i]) ? setpointSegment[i] : 0) * window[i];
    }

    const paddedLength = segmentLength + padLength * 2;
    const aPad = new Float64Array(paddedLength);
    const bPad = new Float64Array(paddedLength);

    for (let i = 0; i < segmentLength; i += 1) {
      aPad[i + padLength] = a[i];
      bPad[i + padLength] = b[i];
    }

    const gFft = complexFft(aPad);
    const hFft = complexFft(bPad);
    const hConj = complexConjugate(hFft);

    const numerator = elementWiseMultiply(
      gFft.real,
      gFft.imag,
      hConj.real,
      hConj.imag,
      gFft.length
    );

    const denominatorReal = new Float64Array(hFft.length);
    const denominatorImag = new Float64Array(hFft.length);
    const reg = 0.0001;

    for (let i = 0; i < hFft.length; i += 1) {
      const hSquared = hFft.real[i] * hFft.real[i] + hFft.imag[i] * hFft.imag[i];
      denominatorReal[i] = hSquared + reg;
      denominatorImag[i] = 0;
    }

    const recoveredReal = new Float64Array(gFft.length);
    const recoveredImag = new Float64Array(gFft.length);

    for (let i = 0; i < gFft.length; i += 1) {
      const denom =
        denominatorReal[i] * denominatorReal[i] +
        denominatorImag[i] * denominatorImag[i];
      recoveredReal[i] =
        (numerator.real[i] * denominatorReal[i] +
          numerator.imag[i] * denominatorImag[i]) /
        denom;
      recoveredImag[i] =
        (numerator.imag[i] * denominatorReal[i] -
          numerator.real[i] * denominatorImag[i]) /
        denom;
    }

    const impulse = complexIfft({
      real: recoveredReal,
      imag: recoveredImag,
      length: recoveredReal.length
    });

    const realImpulse = impulse.real;

    // Integrate to step response
    let response = new Float64Array(realImpulse.length);
    let sum = 0;
    for (let i = 0; i < realImpulse.length; i += 1) {
      sum += realImpulse[i];
      response[i] = sum;
    }

    // Y-correction: scale so mean between 200 ms and 500 ms is 1.0
    const steadyStart = Math.round(logRate * 1000 * 0.2);
    const steadyEnd = Math.round(logRate * 1000 * 0.5);
    const steadyIndices = [];
    for (let i = steadyStart; i <= steadyEnd && i < response.length; i += 1) {
      steadyIndices.push(i);
    }

    if (steadyIndices.length === 0) {
      continue;
    }

    const steadyMean =
      steadyIndices.reduce((sum, i) => sum + response[i], 0) /
      steadyIndices.length;

    if (!Number.isFinite(steadyMean) || steadyMean === 0) {
      continue;
    }

    if (yCorrection) {
      const scaleFactor = 1.0 / steadyMean;
      response = response.map((value) => value * scaleFactor);
    }

    // Quality gate: all steady-state samples must be within [0.5, 3.0]
    const steadyStateValues = steadyIndices.map((i) => response[i]);
    const steadyMin = Math.min(...steadyStateValues);
    const steadyMax = Math.max(...steadyStateValues);
    if (steadyMin < 0.5 || steadyMax > 3.0) {
      continue;
    }

    // Discard if any NaN in the response window
    const responseWindow = response.slice(0, wnd + 1);
    if (responseWindow.some((value) => Number.isNaN(value))) {
      continue;
    }

    stepResponses.push(responseWindow);
  }

  if (stepResponses.length === 0) {
    const emptyLength = wnd + 1;
    return {
      timeMs: new Array(emptyLength).fill(0),
      stepResponse: new Array(emptyLength).fill(0),
      numSegments: 0
    };
  }

  const minLen = Math.min(...stepResponses.map((r) => r.length));
  const averaged = new Float64Array(minLen);

  for (let i = 0; i < minLen; i += 1) {
    let sum = 0;
    for (const response of stepResponses) {
      sum += response[i];
    }
    averaged[i] = sum / stepResponses.length;
  }

  const timeMs = new Array(minLen);
  for (let i = 0; i < minLen; i += 1) {
    timeMs[i] = i / logRate;
  }

  return {
    timeMs,
    stepResponse: averaged,
    numSegments: stepResponses.length
  };
}

function calculateMetrics(timeMs, stepResponse) {
  const n = stepResponse.length;
  if (n === 0) {
    return {
      riseTimeMs: 0,
      maxOvershoot: 0,
      settlingTimeMs: 0
    };
  }

  const finalValue =
    stepResponse
      .slice(Math.floor(0.9 * n))
      .reduce((sum, value) => sum + value, 0) /
    Math.max(1, n - Math.floor(0.9 * n));

  if (!Number.isFinite(finalValue) || finalValue === 0) {
    return {
      riseTimeMs: 0,
      maxOvershoot: 0,
      settlingTimeMs: 0
    };
  }

  const target50 = 0.5 * finalValue;
  let riseTimeMs = 0;
  for (let i = 0; i < n; i += 1) {
    if (stepResponse[i] >= target50) {
      riseTimeMs = timeMs[i];
      break;
    }
  }

  const peakValue = Math.max(...stepResponse);
  const maxOvershoot = Math.max(
    0,
    (peakValue - finalValue) / finalValue
  );

  const threshold = 0.02 * Math.abs(finalValue);
  let lastOutIndex = -1;
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(stepResponse[i] - finalValue) > threshold) {
      lastOutIndex = i;
    }
  }

  const settlingTimeMs =
    lastOutIndex >= 0 && lastOutIndex + 1 < n
      ? timeMs[lastOutIndex + 1]
      : 0;

  return {
    riseTimeMs,
    maxOvershoot,
    settlingTimeMs
  };
}

const AXIS_LOWER_NAMES = ["roll", "pitch", "yaw"];

function extractPidParams(lines, axisIndex) {
  const result = { p: null, i: null, d: null, f: null, boost: null, dMin: null };
  const axisLower = AXIS_LOWER_NAMES[axisIndex];

  function findHeaderValue(labelPatterns) {
    for (const line of lines) {
      const lower = String(line).toLowerCase();
      for (const pattern of labelPatterns) {
        if (lower.includes(pattern)) {
          const match = line.match(/:\s*(.+)/);
          if (match) {
            return match[1].trim();
          }
        }
      }
    }
    return null;
  }

  function findSingleValue(labelPatterns) {
    for (const line of lines) {
      const lower = String(line).toLowerCase();
      for (const pattern of labelPatterns) {
        if (lower.includes(pattern)) {
          const match = line.match(/:\s*([+-]?[\d.]+)/);
          if (match) {
            return match[1].trim();
          }
        }
      }
    }
    return null;
  }

  // Per-axis PID header, e.g. "rollPID: 45,80,35,0,0" or "Roll PID: 45,80,35".
  const axisPids = findHeaderValue([
    `${axisLower} pid`,
    `${axisLower}pid`,
    `pid ${axisLower}`,
    `pid${axisLower}`
  ]);
  if (axisPids) {
    const parts = axisPids.split(",").map((value) => Number(value.trim()));
    if (parts.length >= 3) {
      [result.p, result.i, result.d] = parts.slice(0, 3);
      if (parts.length >= 5) {
        result.f = parts[3];
        result.boost = parts[4];
      } else if (parts.length === 4) {
        result.f = parts[3];
      }
    }
  }

  // Individual coefficient headers as a fallback.
  if (result.p === null) {
    const pVal = findSingleValue([`${axisLower}_p`, `${axisLower}p`, `p_term_${axisLower}`]);
    if (pVal !== null) result.p = Number(pVal);
  }
  if (result.i === null) {
    const iVal = findSingleValue([`${axisLower}_i`, `${axisLower}i`, `i_term_${axisLower}`]);
    if (iVal !== null) result.i = Number(iVal);
  }
  if (result.d === null) {
    const dVal = findSingleValue([`${axisLower}_d`, `${axisLower}d`, `d_term_${axisLower}`]);
    if (dVal !== null) result.d = Number(dVal);
  }

  return result;
}

function analyzeAxis(lines, headerIndex, axisIndex, options) {
  const headers = lines[headerIndex]
    .split(",")
    .map((header) =>
      String(header)
        .trim()
        .replace(/^"|"$/g, "")
    );

  const setpointColumn = findColumnName(headers, SETPOINT_ALIASES[axisIndex]);
  const gyroColumn = findColumnName(headers, GYRO_ALIASES[axisIndex]);

  if (!setpointColumn || !gyroColumn) {
    return null;
  }

  const timeColumn = findColumnName(headers, ["time", "time_us", "loopIteration"]);
  const timeValues = timeColumn ? readColumn(lines, headerIndex, timeColumn) : [];
  const logRate = estimateLogRate(timeValues);

  if (!Number.isFinite(logRate) || logRate <= 0) {
    return null;
  }

  let setpoint = readColumn(lines, headerIndex, setpointColumn);
  let gyro = readColumn(lines, headerIndex, gyroColumn);

  const n = Math.min(setpoint.length, gyro.length);
  setpoint = setpoint.slice(0, n).map((value) =>
    Number.isFinite(value) ? value : 0
  );
  gyro = gyro.slice(0, n).map((value) =>
    Number.isFinite(value) ? value : 0
  );

  const smoothWindows = [1, 20, 40, 60];
  const windowSize = smoothWindows[(options.smoothFactor || 1) - 1] ?? 1;
  gyro = lowessSmooth(gyro, windowSize);

  const { timeMs, stepResponse, numSegments } = deconvolveStepResponse(
    setpoint,
    gyro,
    logRate,
    options
  );

  if (numSegments === 0) {
    return {
      axis: AXIS_NAMES[axisIndex],
      available: false,
      reason: "No usable command segments found.",
      timeMs,
      stepResponse,
      metrics: { riseTimeMs: 0, maxOvershoot: 0, settlingTimeMs: 0 },
      numSegments: 0
    };
  }

  const metrics = calculateMetrics(timeMs, stepResponse);

  return {
    axis: AXIS_NAMES[axisIndex],
    available: true,
    timeMs,
    stepResponse,
    metrics,
    numSegments,
    pid: extractPidParams(lines, axisIndex)
  };
}

export function analyzeFlightStepResponse(lines, options = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { axes: [], options };
  }

  const telemetryHeaderIndex = lines.findIndex((line) => {
    const lower = String(line).toLowerCase();
    return (
      lower.includes("setpoint") &&
      lower.includes("gyroadc") &&
      lower.includes("time")
    );
  });

  const headerIndex = telemetryHeaderIndex >= 0 ? telemetryHeaderIndex : 0;

  const axes = [];
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const result = analyzeAxis(lines, headerIndex, axisIndex, options);
    if (result) {
      axes.push(result);
    }
  }

  return {
    axes,
    options
  };
}

function resampleToCommonGrid(timeMs, stepResponse, targetTimeMs) {
  const result = new Float64Array(targetTimeMs.length);

  for (let i = 0; i < targetTimeMs.length; i += 1) {
    const target = targetTimeMs[i];

    if (target <= timeMs[0]) {
      result[i] = stepResponse[0];
      continue;
    }

    if (target >= timeMs[timeMs.length - 1]) {
      result[i] = stepResponse[timeMs.length - 1];
      continue;
    }

    let left = 0;
    let right = timeMs.length - 1;
    while (right - left > 1) {
      const mid = Math.floor((left + right) / 2);
      if (timeMs[mid] <= target) {
        left = mid;
      } else {
        right = mid;
      }
    }

    const t0 = timeMs[left];
    const t1 = timeMs[right];
    const y0 = stepResponse[left];
    const y1 = stepResponse[right];
    const fraction = t1 === t0 ? 0 : (target - t0) / (t1 - t0);
    result[i] = y0 + fraction * (y1 - y0);
  }

  return result;
}

export function analyzeAllFlightsStepResponse(logData, options = {}) {
  if (!logData || !Array.isArray(logData.flights) || logData.flights.length === 0) {
    return { aggregated: null, perFlight: [] };
  }

  const perFlight = logData.flights.map((flight, index) => ({
    index,
    label: flight.label,
    result: analyzeFlightStepResponse(flight.lines, options)
  }));

  // Build aggregated response across all flights
  const axisNames = ["Roll", "Pitch", "Yaw"];
  const aggregatedAxes = axisNames.map((axisName) => {
    const responses = [];
    const flightForResponse = [];

    for (const flight of perFlight) {
      const axisResult = flight.result.axes.find(
        (axis) => axis.axis === axisName && axis.available
      );
      if (axisResult) {
        responses.push(axisResult);
        flightForResponse.push(flight);
      }
    }

    if (responses.length === 0) {
      return {
        axis: axisName,
        available: false,
        reason: "No usable data across flights.",
        timeMs: [],
        stepResponse: [],
        metrics: { riseTimeMs: 0, maxOvershoot: 0, settlingTimeMs: 0 },
        numSegments: 0,
        series: []
      };
    }

    // Use the finest time grid among available responses, capped at 500 ms
    let targetTimeMs = responses[0].timeMs;
    for (const response of responses) {
      if (response.timeMs.length > targetTimeMs.length) {
        targetTimeMs = response.timeMs;
      }
    }
    targetTimeMs = targetTimeMs.filter((value) => value <= 500);

    const resampled = responses.map((response) =>
      resampleToCommonGrid(
        response.timeMs,
        response.stepResponse,
        targetTimeMs
      )
    );

    const averaged = new Float64Array(targetTimeMs.length);
    for (let i = 0; i < targetTimeMs.length; i += 1) {
      let sum = 0;
      for (const response of resampled) {
        sum += response[i];
      }
      averaged[i] = sum / resampled.length;
    }

    const totalSegments = responses.reduce(
      (sum, response) => sum + response.numSegments,
      0
    );

    const metrics = calculateMetrics(targetTimeMs, averaged);

    // Per-flight series, resampled to the common time grid, with
    // each flight's metrics and PID values attached so the renderer
    // can draw every flight as its own line and label it with its
    // PID gains.
    const series = responses.map((response, responseIndex) => {
      const flight = flightForResponse[responseIndex];
      return {
        flightIndex: flight.index,
        label: flight.label,
        timeMs: Array.from(targetTimeMs),
        stepResponse: Array.from(resampled[responseIndex]),
        metrics: calculateMetrics(targetTimeMs, resampled[responseIndex]),
        pid: response.pid ?? null,
        numSegments: response.numSegments
      };
    });

    return {
      axis: axisName,
      available: true,
      timeMs: targetTimeMs,
      stepResponse: averaged,
      metrics,
      numSegments: totalSegments,
      series
    };
  });

  return {
    aggregated: { axes: aggregatedAxes, options },
    perFlight
  };
}

export { AXIS_NAMES };
