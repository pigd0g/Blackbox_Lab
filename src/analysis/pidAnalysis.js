import {
  getColumnValues,
  getColumnValuesByRowIndexes,
  calculateAverageAbsolute
} from "./mathHelpers.js";

import {
  detectStableFlightPhase,
  buildRollingMean
} from "./flightPhase.js";
function findMatchingColumns(columns, searchTerms) {
  if (!Array.isArray(columns)) {
    return [];
  }

  return columns.filter((columnName) => {
    const normalizedName =
      String(columnName).toLowerCase();

    return searchTerms.some((searchTerm) =>
      normalizedName.includes(searchTerm)
    );
  });
}

function groupPidColumns(pidColumns) {
  const groups = {
    p: [],
    i: [],
    d: [],
    feedforward: [],
    pidSum: []
  };

  for (const columnName of pidColumns) {
    const normalizedName =
      String(columnName).toLowerCase();

    if (normalizedName.includes("pidsum")) {
      groups.pidSum.push(columnName);
    } else if (
      normalizedName.includes("axisf") ||
      normalizedName.includes("feedforward")
    ) {
      groups.feedforward.push(columnName);
    } else if (normalizedName.includes("axisd")) {
      groups.d.push(columnName);
    } else if (normalizedName.includes("axisi")) {
      groups.i.push(columnName);
    } else if (
  normalizedName.includes("axisp") &&
  !normalizedName.includes("axispd")
) {
  groups.p.push(columnName);
}
  }

  return groups;
}

// Rotorflight doctrine: feedforward is supposed to carry the
// work during commanded motion, so sustained near-peak
// feedforward drive is expected behavior, never a fault. The
// command-balance assessment is the feedforward health signal.
export function applyFeedforwardDoctrine(
  saturationAssessment
) {
  if (
    saturationAssessment?.status !== "Review"
  ) {
    return saturationAssessment;
  }

  return {
    ...saturationAssessment,
    status: "Expected",
    recommendation:
      "Feedforward held near-maximum output for sustained periods. In Rotorflight, feedforward is supposed to do most of the work during commanded motion, so sustained feedforward drive is expected behavior and does not reduce the score. If this axis tracks poorly, review the command-balance result and gyro evidence instead of lowering feedforward."
  };
}

/**
 * How much a timing check can be trusted, given how many clean command
 * events it had to work with.
 *
 * One home for the thresholds: the per-axis confidence printed in the
 * findings and the overall confidence rating are the same judgement,
 * and a page that prints "Insufficient" beside "High 100/100" is
 * telling a pilot two different things about one flight.
 */
export function commandEvidenceConfidence(eventCount) {
  if (eventCount >= 10) return "High";
  if (eventCount >= 5) return "Medium";
  if (eventCount >= 2) return "Low";
  return "Insufficient";
}

/**
 * What the confidence rating owes to evidence the timing checks never
 * had. Overshoot, bounce-back, settling and ringing are all measured
 * from clean command events, so an axis with almost none leaves those
 * checks unanswered however complete the log's columns are.
 *
 * Evidence is counted as clean responses, NOT as responses that
 * misbehaved. An overshoot figure only exists where the response
 * crossed past its target, so an axis that tracked well produces no
 * overshoot numbers at all — counting those as missing evidence would
 * mark down the best-flying machines for flying well.
 */
export function assessCommandEvidence(commandEvents = []) {
  const axes = commandEvents.map((axisResult) => {
    const events = Array.isArray(axisResult?.events)
      ? axisResult.events
      : [];

    const usable = events.filter((event) =>
      Number.isFinite(event?.responsePeak)
    ).length;

    return {
      axis: axisResult?.axis ?? "Axis",
      usableEvents: usable,
      confidence: commandEvidenceConfidence(usable)
    };
  });

  const penalty = axes.reduce((total, axis) => {
    if (axis.confidence === "Insufficient") return total + 15;
    if (axis.confidence === "Low") return total + 8;
    return total;
  }, 0);

  return {
    axes,
    penalty,
    thinAxes: axes.filter(
      (axis) =>
        axis.confidence === "Insufficient" || axis.confidence === "Low"
    )
  };
}

// ------------------------------------------------------
// Tracking-score calibration
//
// The score is continuous: the deduction grows with the
// measured relative tracking error instead of stepping in
// fixed penalty sizes. The constants below are calibrated
// against the contributed fleet so the spread carries
// information — every value here is a dial, and the corpus
// is the dyno it was set on.
// ------------------------------------------------------
export const TRACKING_SCORE_TUNING = {
  // Denominator floor for relative error, in setpoint units —
  // keeps a hover-only log from dividing by nearly zero.
  SETPOINT_ACTIVITY_FLOOR: 25,

  // Relative error at or below this deducts nothing. Fleet p05
  // is 0.124 across 179 measured flights, so the cleanest decile
  // keeps full marks.
  FULL_MARKS_RELATIVE_ERROR: 0.15,

  // Relative error at or above this takes the full deduction —
  // beyond the fleet's p95 of 0.549, with headroom for genuinely
  // rough machines (fleet max observed: 0.85).
  ZERO_MARKS_RELATIVE_ERROR: 0.75,

  MAX_TRACKING_DEDUCTION: 50,

  BALANCE_DEDUCTION_PER_AXIS: 10,
  MAX_BALANCE_DEDUCTION: 25,

  SATURATION_DEDUCTION_PER_TERM: 6,
  MAX_SATURATION_DEDUCTION: 18,

  // One real-world flight cannot prove a mathematically
  // perfect tune.
  REAL_WORLD_MARGIN: 2
};

export function computeTrackingScore({
  relativeError = null,
  commandBalanceReviewCount = 0,
  saturationReviewCount = 0
} = {}) {
  const tuning = TRACKING_SCORE_TUNING;

  const trackingDeduction = Number.isFinite(relativeError)
    ? Math.min(
        1,
        Math.max(
          0,
          (relativeError - tuning.FULL_MARKS_RELATIVE_ERROR) /
            (tuning.ZERO_MARKS_RELATIVE_ERROR -
              tuning.FULL_MARKS_RELATIVE_ERROR)
        )
      ) * tuning.MAX_TRACKING_DEDUCTION
    : 0;

  const balanceDeduction = Math.min(
    tuning.MAX_BALANCE_DEDUCTION,
    commandBalanceReviewCount * tuning.BALANCE_DEDUCTION_PER_AXIS
  );

  const saturationDeduction = Math.min(
    tuning.MAX_SATURATION_DEDUCTION,
    saturationReviewCount * tuning.SATURATION_DEDUCTION_PER_TERM
  );

  return {
    score: Math.max(
      0,
      Math.round(
        100 -
          tuning.REAL_WORLD_MARGIN -
          trackingDeduction -
          balanceDeduction -
          saturationDeduction
      )
    ),
    trackingDeduction: Math.round(trackingDeduction * 10) / 10,
    balanceDeduction,
    saturationDeduction
  };
}

export function analyzePids(
  analysisContext,
  lines = [],
  headspeedProfiles = []
) {
  const allColumns =
  analysisContext?.telemetry?.allColumns ?? [];

  const setpointColumns = findMatchingColumns(
    allColumns,
    [
      "setpoint",
      "axiscommand",
      "axiscommandf",
      "rccommand"
    ]
  );
const axisSetpointColumns =
  setpointColumns.filter((columnName) =>
    /^"?setpoint\[[0-2]\]"?$/i.test(
      String(columnName).trim()
    )
  );
  const filteredGyroColumns = findMatchingColumns(
  allColumns,
  [
    "gyroadc",
    "gyrofiltered"
  ]
).filter((columnName) =>
  /^"?(?:gyroADC|gyroFiltered)\[[0-2]\]"?$/i.test(
    String(columnName).trim()
  )
);
  const axisErrorColumns = findMatchingColumns(
    allColumns,
    [
      "axiserror",
      "error"
    ]
  );

const telemetryHeaderIndex =
  analysisContext?.flight?.telemetryHeaderIndex ?? -1;
  const stableRowIndexes = [
  ...new Set(
    headspeedProfiles.flatMap(
      (profile) =>
        Array.isArray(profile.sampleIndexes)
          ? profile.sampleIndexes
          : []
    )
  )
]
  .filter(Number.isInteger)
  .sort((first, second) => first - second);

const hasStableFlightRows =
  stableRowIndexes.length > 0;
  const stableRowSegments = [];

for (const rowIndex of stableRowIndexes) {
  const currentSegment =
    stableRowSegments[
      stableRowSegments.length - 1
    ];

  const previousRowIndex =
    currentSegment?.[
      currentSegment.length - 1
    ];

  if (
    !currentSegment ||
    rowIndex !== previousRowIndex + 1
  ) {
   stableRowSegments.push([rowIndex]);
  } else {
    currentSegment.push(rowIndex);
  }
}

 const stableArraySegments = [];

let stableArrayOffset = 0;

for (const rowSegment of stableRowSegments) {
  const segmentLength = rowSegment.length;

  if (segmentLength <= 0) {
    continue;
  }

  stableArraySegments.push({
    startIndex: stableArrayOffset,
    endIndex:
      stableArrayOffset +
      segmentLength -
      1,
    sampleCount: segmentLength
  });

  stableArrayOffset += segmentLength;
}

// The command-event windows below are defined in SECONDS and
// converted to samples here. "Stable for 0.2 s" has to mean the
// same thing in a 100 Hz CSV export and a 1 kHz raw log — a
// fixed sample count silently shrinks every window at higher
// logging rates, which splits one stick movement into several
// events and calls a mid-movement pause its target.
const timeColumnName = allColumns.find((name) =>
  /^"?time"?$/i.test(String(name).trim())
);

const stableTimeValues =
  timeColumnName && hasStableFlightRows
    ? getColumnValuesByRowIndexes(
        lines,
        telemetryHeaderIndex,
        timeColumnName,
        stableRowIndexes
      )
    : [];

const samplesPerSecond = (() => {
  for (const segment of stableArraySegments) {
    if (segment.sampleCount < 50) {
      continue;
    }

    const firstMicros = Number(
      stableTimeValues[segment.startIndex]
    );
    const lastMicros = Number(
      stableTimeValues[segment.endIndex]
    );

    if (
      Number.isFinite(firstMicros) &&
      Number.isFinite(lastMicros) &&
      lastMicros > firstMicros
    ) {
      return (
        ((segment.sampleCount - 1) /
          (lastMicros - firstMicros)) *
        1_000_000
      );
    }
  }

  return 100;
})();

const eventWindowSamples = (seconds, minimumSamples) =>
  Math.max(
    minimumSamples,
    Math.round(seconds * samplesPerSecond)
  );

const commandChangeWindowSamples = eventWindowSamples(0.2, 5);
const commandStableWindowSamples = eventWindowSamples(0.2, 5);

// The smallest setpoint step (deg/s, unrounded) that counts as a
// deliberate stick command. Below this bar a "command" is hover
// correction or stick noise: scoring one produces events like a
// 16 deg/s nudge reported as several hundred percent overshoot,
// because the denominator is noise-sized.
const meaningfulCommandMinimum = 20;

// Response measurements run on a ~25 ms rolling mean of the
// response window (raw gyro noise breaks consecutive-sample
// settle detection and fakes single-sample "peaks").
const responseSmoothingSamples = eventWindowSamples(0.025, 3);
const commandEndLookaheadSamples = eventWindowSamples(3, 60);
const responseWindowLimitSamples = eventWindowSamples(2, 40);
const minimumEventSpacingSamples = eventWindowSamples(0.5, 10);
const settledWindowSamples = eventWindowSamples(0.2, 5);
const minimumRingingWindowSamples = eventWindowSamples(0.2, 5);
const minimumBounceBackSamples = eventWindowSamples(0.03, 3);

// Event moments print as seconds from the start of the recording
// — the same axis every chart shows — so a finding can be walked
// straight to its place in the log.
const firstDataRowTimeMicros = timeColumnName
  ? Number(
      getColumnValuesByRowIndexes(
        lines,
        telemetryHeaderIndex,
        timeColumnName,
        [telemetryHeaderIndex + 1]
      )[0]
    )
  : Number.NaN;

const stableSampleTimeSeconds = (compactedIndex) => {
  const micros = Number(stableTimeValues[compactedIndex]);

  return Number.isFinite(micros) &&
    Number.isFinite(firstDataRowTimeMicros)
    ? (micros - firstDataRowTimeMicros) / 1_000_000
    : null;
};

const eventMomentText = (compactedIndex, rowIndex) => {
  const seconds = stableSampleTimeSeconds(compactedIndex);

  if (seconds === null) {
    return Number.isInteger(rowIndex)
      ? `data row ${rowIndex}`
      : "Unavailable";
  }

  return `${seconds.toFixed(2)} s${
    Number.isInteger(rowIndex) ? ` (data row ${rowIndex})` : ""
  }`;
};


const recordedAxisErrorValues =
  axisErrorColumns.map((columnName) => ({
    columnName,
    values: hasStableFlightRows
      ? getColumnValuesByRowIndexes(
          lines,
          telemetryHeaderIndex,
          columnName,
          stableRowIndexes
        )
      : []
  }));
const axisSetpointValues =
  axisSetpointColumns.map((columnName) => ({
    columnName,
    values: hasStableFlightRows
  ? getColumnValuesByRowIndexes(
      lines,
      telemetryHeaderIndex,
      columnName,
      stableRowIndexes
    )
  : []
  }));
const filteredGyroValues =
  filteredGyroColumns.map((columnName) => ({
    columnName,
    values: hasStableFlightRows
      ? getColumnValuesByRowIndexes(
          lines,
          telemetryHeaderIndex,
          columnName,
          stableRowIndexes
        )
      : []
  }));
const axisErrorValues =
  recordedAxisErrorValues.length === 3
    ? recordedAxisErrorValues
    : axisSetpointValues.map((setpointResult, index) => {
        const gyroResult = filteredGyroValues[index];

        if (!gyroResult) {
          return {
            columnName: `derivedAxisError[${index}]`,
            values: []
          };
        }

        const sampleCount = Math.min(
          setpointResult.values.length,
          gyroResult.values.length
        );

        const values = [];

        for (
          let sampleIndex = 0;
          sampleIndex < sampleCount;
          sampleIndex += 1
        ) {
          values.push(
            setpointResult.values[sampleIndex] -
              gyroResult.values[sampleIndex]
          );
        }

        return {
          columnName: `derivedAxisError[${index}]`,
          values
        };
      });
 
  const axisNames = [
  "Roll",
  "Pitch",
  "Yaw"
];
  const reconstructedAxisResponse =
  axisSetpointValues.map((setpointResult, index) => {
    const errorResult = axisErrorValues[index];

    if (!errorResult) {
      return {
        axis: axisNames[index] ?? `Axis ${index}`,
        sampleCount: 0,
        values: []
      };
    }

    const sampleCount = Math.min(
      setpointResult.values.length,
      errorResult.values.length
    );

    const values = [];

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      values.push(
        setpointResult.values[sampleIndex] -
          errorResult.values[sampleIndex]
      );
    }

    return {
      axis: axisNames[index] ?? `Axis ${index}`,
      sampleCount,
      values
    };
  });
  const averageAbsoluteAxisResponse =
  reconstructedAxisResponse.map((axisResult) => ({
    axis: axisResult.axis,
    sampleCount: axisResult.sampleCount,
    averageAbsoluteResponse:
      calculateAverageAbsolute(axisResult.values)
  }));

  const instantaneousExceedanceAnalysis =
  reconstructedAxisResponse.map((responseResult, index) => {
    const setpointResult = axisSetpointValues[index];

    if (!setpointResult) {
      return {
        axis: responseResult.axis,
        commandSampleCount: 0,
        exceedanceSampleCount: 0,
exceedancePercent: null
      };
    }

    const sampleCount = Math.min(
      responseResult.values.length,
      setpointResult.values.length
    );

    let commandSampleCount = 0;
    let exceedanceSampleCount = 0;

    for (
      let sampleIndex = 0;
      sampleIndex < sampleCount;
      sampleIndex += 1
    ) {
      const setpoint =
        setpointResult.values[sampleIndex];

      const response =
        responseResult.values[sampleIndex];

      if (Math.abs(setpoint) < 5) {
        continue;
      }

      commandSampleCount += 1;

      const sameDirection =
        Math.sign(response) === Math.sign(setpoint);

      const exceededCommand =
        Math.abs(response) > Math.abs(setpoint);

      if (sameDirection && exceededCommand) {
        exceedanceSampleCount += 1;
      }
    }

    return {
  axis: responseResult.axis,
  commandSampleCount,
  exceedanceSampleCount,
  exceedancePercent:
    commandSampleCount > 0
      ? (
          exceedanceSampleCount /
          commandSampleCount
        ) * 100
      : null
};
  });
 const commandEvents =
  axisSetpointValues.map((setpointResult, axisIndex) => {
    const events = [];
    const values = setpointResult.values;

    const minimumEventSpacing = minimumEventSpacingSamples;

    for (const stableSegment of stableArraySegments) {
      const segmentStart =
        stableSegment.startIndex;

      const segmentEnd =
        stableSegment.endIndex;

      let lastAcceptedEventIndex =
        Number.NEGATIVE_INFINITY;

      for (
        let sampleIndex =
          segmentStart + commandChangeWindowSamples;
        sampleIndex <= segmentEnd;
        sampleIndex += 1
      ) {
      const previousValue =
        values[sampleIndex - commandChangeWindowSamples];
      const currentValue = values[sampleIndex];

      const commandChange =
      currentValue - previousValue;
      if (Math.abs(commandChange) < 5) {
  continue;
}

if (
  sampleIndex - lastAcceptedEventIndex <
  minimumEventSpacing
) {
  continue;
}

lastAcceptedEventIndex = sampleIndex;
let commandEndSampleIndex =
  sampleIndex;

let stableSampleCount = 0;
const requiredStableSamples = commandStableWindowSamples;

// A step response can only be measured against a target that
// actually holds still: when the lookahead never finds the
// command settling, the pilot was still moving the stick and
// the "event" is continuous flying, not a step.
let targetStabilized = false;

// Both look-aheads stop at the segment edge: past it the
// compacted array jumps to a different moment of the flight,
// and a window that crosses that seam would read two distant
// moments as if they were adjacent.
for (
  let lookAheadIndex = sampleIndex + 1;
  lookAheadIndex <
    Math.min(
      sampleIndex + commandEndLookaheadSamples,
      segmentEnd + 1,
      values.length
    );
  lookAheadIndex += 1
) {
  const lookAheadChange =
    values[lookAheadIndex] -
    values[lookAheadIndex - 1];

  if (Math.abs(lookAheadChange) < 0.25) {
    stableSampleCount += 1;
  } else {
    stableSampleCount = 0;
  }

  commandEndSampleIndex =
    lookAheadIndex;

  if (
    stableSampleCount >=
    requiredStableSamples
  ) {
    commandEndSampleIndex =
      lookAheadIndex -
      requiredStableSamples +
      1;

    targetStabilized = true;

    break;
  }
}

const commandTarget =
  values[commandEndSampleIndex];

// ---- event qualification ----
// Two bars before anything is measured or reported:
// the command must be big enough to be a deliberate stick
// input (tiny nudges are normal hover corrections and read
// as absurd percentages when scored), and the target must
// have stabilized (a target still moving through the
// response window pairs an old command with a newer,
// different setpoint).
const qualifiedMagnitude =
  Number.isFinite(commandTarget) &&
  Number.isFinite(previousValue)
    ? Math.abs(commandTarget - previousValue)
    : null;

if (
  !targetStabilized ||
  !Number.isFinite(qualifiedMagnitude) ||
  qualifiedMagnitude < meaningfulCommandMinimum
) {
  // Still one stick movement: resume after it, exactly like
  // an accepted event, so it cannot re-trigger along its
  // own rise.
  sampleIndex = Math.max(
    sampleIndex,
    commandEndSampleIndex
  );
  continue;
}

const responseResult =
  reconstructedAxisResponse[axisIndex];

const responseWindowStart =
  commandEndSampleIndex;

const maximumResponseWindowEnd =
  Math.min(
    responseWindowStart + responseWindowLimitSamples,
    segmentEnd + 1,
    values.length,
    responseResult?.values.length ?? 0
  );

let nextCommandSampleIndex = null;

for (
  let lookAheadIndex =
    responseWindowStart + 1;
  lookAheadIndex <
  maximumResponseWindowEnd;
  lookAheadIndex += 1
) {
  const lookAheadValue =
    values[lookAheadIndex];

  if (
    Number.isFinite(lookAheadValue) &&
    Number.isFinite(commandTarget) &&
    Math.abs(
      lookAheadValue - commandTarget
    ) >= 5
  ) {
    nextCommandSampleIndex =
      lookAheadIndex;

    break;
  }
}

const responseWindowEnd =
  Number.isInteger(nextCommandSampleIndex)
    ? nextCommandSampleIndex
    : maximumResponseWindowEnd;
const commandWindow =
  values.slice(
    responseWindowStart,
    responseWindowEnd
  );

const hasOverlappingCommand =
  commandWindow.some((value) =>
    Number.isFinite(value) &&
    Math.abs(value - commandTarget) >= 5
  );
const responseWindow =
  responseResult
    ? responseResult.values.slice(
        responseWindowStart,
        responseWindowEnd
      )
    : [];
const validResponseWindow =
  responseWindow.filter((value) =>
    Number.isFinite(value)
  );

const commandDirection =
  Math.sign(commandChange);

const commandMagnitude = qualifiedMagnitude;

// Every response read below runs on a lightly smoothed trace
// (~25 ms): raw gyro noise otherwise breaks the consecutive
// settle window on every real log and turns single-sample
// spikes into "peaks". The charts still draw the raw trace;
// only the measurements smooth.
const measuredResponseWindow = buildRollingMean(
  responseWindow,
  responseSmoothingSamples
);

// Signed error in the command direction: positive means the
// response has gone BEYOND the target, negative means it has
// not reached it yet. Every response read below works in this
// space, so "peak", "reached" and "overshoot" all refer to the
// same movement the command asked for.
const directionalError = (value) =>
  Number.isFinite(value) &&
  Number.isFinite(commandTarget)
    ? (value - commandTarget) * commandDirection
    : null;

const approachTolerance =
  Number.isFinite(commandMagnitude)
    ? Math.max(2, commandMagnitude * 0.1)
    : 2;

// How far the response actually got, measured along the
// commanded direction — a wandering gyro on another errand can
// no longer supply the "peak" of this command's response.
let responsePeak = null;
let responsePeakOffset = -1;

for (
  let offset = 0;
  offset < measuredResponseWindow.length;
  offset += 1
) {
  const value = measuredResponseWindow[offset];
  if (!Number.isFinite(value)) continue;
  if (
    responsePeak === null ||
    value * commandDirection >
      responsePeak * commandDirection
  ) {
    responsePeak = value;
    responsePeakOffset = offset;
  }
}

// The response has ANSWERED the command once it comes within
// tolerance of the target. Overshoot exists only after that
// moment, and only as the FIRST excursion beyond the target:
// later wandering inside the window is ringing or disturbance,
// not the answer to this command.
let reachedOffset = -1;

for (
  let offset = 0;
  offset < measuredResponseWindow.length;
  offset += 1
) {
  const error = directionalError(measuredResponseWindow[offset]);
  if (
    Number.isFinite(error) &&
    error >= -approachTolerance
  ) {
    reachedOffset = offset;
    break;
  }
}

// Settling is measured BEFORE overshoot on purpose: once the
// response has demonstrably settled at the target, anything the
// gyro does afterwards is a new disturbance, and the overshoot
// scan below must not read it as this command's answer.
const settlingTolerance =
  Number.isFinite(commandMagnitude)
    ? Math.max(
        2,
        commandMagnitude * 0.1
      )
    : null;
const settlingInToleranceFlags =
  Number.isFinite(commandTarget) &&
  Number.isFinite(settlingTolerance)
    ? measuredResponseWindow.map((value) =>
        Number.isFinite(value) &&
        Math.abs(value - commandTarget) <=
          settlingTolerance
      )
    : [];
const requiredSettledSamples = settledWindowSamples;
let settlingStartOffset = null;
let consecutiveSettledSamples = 0;

for (
  let offset = 0;
  offset < settlingInToleranceFlags.length;
  offset += 1
) {
  if (settlingInToleranceFlags[offset]) {
    consecutiveSettledSamples += 1;
  } else {
    consecutiveSettledSamples = 0;
  }

  if (
    consecutiveSettledSamples >=
    requiredSettledSamples
  ) {
    settlingStartOffset =
      offset -
      requiredSettledSamples +
      1;

    break;
  }
}

let overshootAmount = null;
let overshootPeakOffset = -1;

if (reachedOffset >= 0 && !hasOverlappingCommand) {
  // Overshoot lives between arrival and rest: the scan stops
  // where the settled window ends, so a disturbance half a
  // second after a clean settle can never be scored as this
  // command's overshoot.
  const excursionScanEnd = Number.isInteger(settlingStartOffset)
    ? Math.min(
        settlingStartOffset + requiredSettledSamples,
        measuredResponseWindow.length
      )
    : measuredResponseWindow.length;
  // An overshoot is a movement, not an instant: a one-sample
  // spike at the moment the stick is released reads as a
  // beyond-target value but proves nothing about the tune. An
  // excursion only scores when it PERSISTS beyond the target.
  const excursionMinimumSamples = minimumBounceBackSamples;

  let runLength = 0;
  let runPeak = null;
  let runPeakOffset = -1;

  for (
    let offset = reachedOffset;
    offset < excursionScanEnd;
    offset += 1
  ) {
    const error = directionalError(measuredResponseWindow[offset]);
    if (!Number.isFinite(error)) continue;

    if (error > 0) {
      runLength += 1;
      if (runPeak === null || error > runPeak) {
        runPeak = error;
        runPeakOffset = offset;
      }
    } else {
      if (runLength >= excursionMinimumSamples) {
        // First persistent excursion ended — anything after
        // this is a separate story.
        overshootAmount = runPeak;
        overshootPeakOffset = runPeakOffset;
        break;
      }
      // A blip too short to be a movement: discard and keep
      // scanning.
      runLength = 0;
      runPeak = null;
      runPeakOffset = -1;
    }
  }

  // The window can end while still beyond the target.
  if (
    overshootAmount === null &&
    runLength >= excursionMinimumSamples
  ) {
    overshootAmount = runPeak;
    overshootPeakOffset = runPeakOffset;
  }
}

const responseReachedTarget = reachedOffset >= 0;

// Bounce-back is recovery from having been AT (or past) the
// target — a response that only came within tolerance has
// nothing to bounce back from, and its steady-state gap must
// not be measured as a reversal.
const peakDirectionalError = Number.isFinite(responsePeak)
  ? directionalError(responsePeak)
  : null;

const responseTouchedTarget =
  Number.isFinite(peakDirectionalError) &&
  peakDirectionalError >= 0;

// The response-peak anchor names the moment the pilot should
// look at: the top of the overshoot when there is one,
// otherwise how far the tracked response got.
const anchorOffset =
  overshootPeakOffset >= 0
    ? overshootPeakOffset
    : responsePeakOffset;

const responsePeakSampleIndex =
  anchorOffset >= 0
    ? responseWindowStart + anchorOffset
    : null;

const responsePeakInCommandDirection =
  responseReachedTarget;
const crossedCommandTarget =
  Number.isFinite(overshootAmount);

const overshootPercent =
  Number.isFinite(overshootAmount) &&
  Number.isFinite(commandMagnitude) &&
  commandMagnitude >= meaningfulCommandMinimum
    ? (
        overshootAmount /
        commandMagnitude
      ) * 100
    : null;
    const bounceBackWindowStart =
  Number.isInteger(responsePeakSampleIndex)
    ? responsePeakSampleIndex + 1
    : null;

const bounceBackWindow =
  Number.isInteger(bounceBackWindowStart) &&
  responseResult
    ? responseResult.values.slice(
        bounceBackWindowStart,
        responseWindowEnd
      )
    : [];

const validBounceBackWindow =
  bounceBackWindow.filter((value) =>
    Number.isFinite(value)
  );
  const bounceBackSampleCount =
  validBounceBackWindow.length;

const hasSufficientBounceBackWindow =
  bounceBackSampleCount >= minimumBounceBackSamples;
  const bounceBackExtreme =
  hasSufficientBounceBackWindow
    ? commandDirection > 0
      ? Math.min(...validBounceBackWindow)
      : Math.max(...validBounceBackWindow)
    : null;

const bounceBackAmount =
  responseTouchedTarget &&
  Number.isFinite(commandTarget) &&
  Number.isFinite(bounceBackExtreme)
    ? commandDirection > 0
      ? Math.max(
          0,
          commandTarget - bounceBackExtreme
        )
      : Math.max(
          0,
          bounceBackExtreme - commandTarget
        )
    : null;


    const bounceBackPercent =
  hasSufficientBounceBackWindow &&
  responseTouchedTarget &&
  Number.isFinite(bounceBackAmount) &&
  Number.isFinite(commandMagnitude) &&
  commandMagnitude >= 10
    ? (
        bounceBackAmount /
        commandMagnitude
      ) * 100
    : null;
    const bounceBackEligible =
  hasSufficientBounceBackWindow &&
  responseTouchedTarget &&
  Number.isFinite(bounceBackPercent);

    const settlingSampleIndex =
  Number.isInteger(settlingStartOffset)
    ? responseWindowStart +
      settlingStartOffset
    : null;
    const settlingDurationSamples =
  Number.isInteger(settlingStartOffset)
    ? settlingStartOffset
    : null;
    const settlingDetected =
  Number.isInteger(settlingSampleIndex) &&
  Number.isInteger(settlingDurationSamples);
  const settlingEligible =
  !hasOverlappingCommand &&
  settlingDetected &&
  Number.isFinite(commandMagnitude) &&
  commandMagnitude >= 10;
  const ringingErrorWindow =
  Number.isFinite(commandTarget)
    ? bounceBackWindow.map((value) =>
        Number.isFinite(value)
          ? value - commandTarget
          : null
      )
    : [];
    const ringingNoiseThreshold =
  Number.isFinite(settlingTolerance)
    ? Math.max(
        1,
        settlingTolerance * 0.5
      )
    : 1;

const significantRingingErrorWindow =
  ringingErrorWindow.map((error) =>
    Number.isFinite(error) &&
    Math.abs(error) >= ringingNoiseThreshold
      ? error
      : 0
  );
  let ringingTargetCrossingCount = 0;
let previousRingingSign = 0;

for (
  const error of significantRingingErrorWindow
) {
  const currentRingingSign = Math.sign(error);

  if (currentRingingSign === 0) {
    continue;
  }

  if (
    previousRingingSign !== 0 &&
    currentRingingSign !== previousRingingSign
  ) {
    ringingTargetCrossingCount += 1;
  }

  previousRingingSign = currentRingingSign;
}
  const ringingSampleCount =
  significantRingingErrorWindow.length;

const hasSufficientRingingWindow =
  ringingSampleCount >= minimumRingingWindowSamples;
  const ringingEligible =
  !hasOverlappingCommand &&
  hasSufficientRingingWindow &&
 Number.isFinite(commandMagnitude) &&
commandMagnitude >= 10

// A separate, deliberately deaf read of the same window: how
// big were the swings, and how often did they cross the target
// counting only swings a pilot would call a swing. The noise
// threshold above (~1-2 deg/s) is right for "has it settled",
// but a verdict of OSCILLATION must not be reachable by sensor
// noise alone.
const strongRingingThreshold = Math.max(
  5,
  Number.isFinite(settlingTolerance) ? settlingTolerance : 5
);

let ringingAmplitude = null;
let strongRingingCrossingCount = 0;
let previousStrongSign = 0;

for (const error of ringingErrorWindow) {
  if (!Number.isFinite(error)) continue;

  const size = Math.abs(error);

  if (
    ringingAmplitude === null ||
    size > ringingAmplitude
  ) {
    ringingAmplitude = size;
  }

  if (size < strongRingingThreshold) {
    continue;
  }

  const sign = Math.sign(error);

  if (
    previousStrongSign !== 0 &&
    sign !== previousStrongSign
  ) {
    strongRingingCrossingCount += 1;
  }

  previousStrongSign = sign;
}

events.push({
  axis: axisNames[axisIndex] ?? `Axis ${axisIndex}`,
  sampleIndex,
  commandEndSampleIndex,
commandTarget,
  previousSetpoint: previousValue,
  currentSetpoint: currentValue,
  commandChange,
  commandMagnitude,
commandDirection,
responsePeakInCommandDirection,
responseReachedTarget,
overshootAmount,
overshootPercent,
bounceBackWindowStart,
bounceBackWindow,
validBounceBackWindow,
bounceBackSampleCount,
hasSufficientBounceBackWindow,
bounceBackExtreme,
bounceBackAmount,
bounceBackPercent,
bounceBackEligible,
settlingTolerance,
settlingInToleranceFlags,
requiredSettledSamples,
settlingStartOffset,
settlingSampleIndex,
settlingDurationSamples,
settlingDetected,
settlingEligible,
ringingErrorWindow,
ringingNoiseThreshold,
significantRingingErrorWindow,
ringingTargetCrossingCount,
ringingSampleCount,
hasSufficientRingingWindow,
ringingEligible,
ringingAmplitude,
strongRingingCrossingCount,
  responseWindowStart,
  responseWindowEnd,
  responseWindow,
  responsePeak,
responsePeakOffset,
responsePeakSampleIndex,
  // Absolute data-row anchors: the compacted stable-array
  // indexes above cannot be read against the flight timeline,
  // so every consumer that names a time or draws a chart uses
  // these instead.
  sampleRowIndex:
    stableRowIndexes[sampleIndex] ?? null,
  commandEndRowIndex:
    stableRowIndexes[commandEndSampleIndex] ?? null,
  responsePeakRowIndex:
    Number.isInteger(responsePeakSampleIndex)
      ? stableRowIndexes[responsePeakSampleIndex] ?? null
      : null
});

// One stick movement is one event: the scan resumes after the
// command finished settling, so a long continuous input cannot
// re-trigger every few tenths along its own rise.
sampleIndex = Math.max(
  sampleIndex,
  commandEndSampleIndex
);
      }
    }
    return {
      axis: axisNames[axisIndex] ?? `Axis ${axisIndex}`,
      eventCount: events.length,
      events
    };
  });
const profileTrackingAnalysis =
  headspeedProfiles.map((profile) => {
    const axisResults =
  axisSetpointColumns.map((setpointColumnName, index) => {
    const profileRowIndexes =
      Array.isArray(profile.sampleIndexes)
        ? profile.sampleIndexes
        : [];

    const setpointValues =
      getColumnValuesByRowIndexes(
        lines,
        telemetryHeaderIndex,
        setpointColumnName,
        profileRowIndexes
      );

    const recordedErrorColumnName =
      axisErrorColumns[index];

    const filteredGyroColumnName =
      filteredGyroColumns[index];

    let values = [];

    if (recordedErrorColumnName) {
      values =
        getColumnValuesByRowIndexes(
          lines,
          telemetryHeaderIndex,
          recordedErrorColumnName,
          profileRowIndexes
        );
    } else if (filteredGyroColumnName) {
      const gyroValues =
        getColumnValuesByRowIndexes(
          lines,
          telemetryHeaderIndex,
          filteredGyroColumnName,
          profileRowIndexes
        );

      const sampleCount = Math.min(
        setpointValues.length,
        gyroValues.length
      );

      for (
        let sampleIndex = 0;
        sampleIndex < sampleCount;
        sampleIndex += 1
      ) {
        values.push(
          setpointValues[sampleIndex] -
            gyroValues[sampleIndex]
        );
      }
    }

    return {
      axis: axisNames[index] ?? `Axis ${index}`,
      columnName:
        recordedErrorColumnName ??
        `derivedAxisError[${index}]`,
      sampleCount: values.length,
      averageAbsoluteError:
        calculateAverageAbsolute(values)
    };
  });

        

    const validAxisErrors =
  axisResults
    .map((axisResult) =>
      axisResult.averageAbsoluteError
    )
    .filter((value) =>
      Number.isFinite(value)
    );

const averageTrackingError =
  validAxisErrors.length > 0
    ? validAxisErrors.reduce(
        (sum, value) => sum + value,
        0
      ) / validAxisErrors.length
    : null;

return {
  targetRpm: profile.targetRpm,
  sampleCount: profile.sampleIndexes.length,
  axisResults,
  averageTrackingError
};
  });
  const validProfileTrackingResults =
  profileTrackingAnalysis.filter((profile) =>
    Number.isFinite(profile.averageTrackingError)
  );

// Best and worst are answers to "compared with what?". One profile
// answers it with itself: the same headspeed gets named as both the
// lowest and the highest tracking error, which reads as a finding and
// is only a reflection. Below two profiles there is no comparison to
// report — the flight simply ran at one headspeed.
const canCompareProfiles = validProfileTrackingResults.length >= 2;

const onlyTrackingProfile =
  validProfileTrackingResults.length === 1
    ? validProfileTrackingResults[0]
    : null;

const bestTrackingProfile =
  validProfileTrackingResults.reduce(
    (best, profile) => {
      if (
        !best ||
        profile.averageTrackingError <
          best.averageTrackingError
      ) {
        return profile;
      }

      return best;
    },
    null
  );

const worstTrackingProfile =
  validProfileTrackingResults.reduce(
    (worst, profile) => {
      if (
        !worst ||
        profile.averageTrackingError >
          worst.averageTrackingError
      ) {
        return profile;
      }

      return worst;
    },
    null
  );
const averageAbsoluteAxisError =
  axisErrorValues.map((axisResult, index) => ({
    axis: axisNames[index] ?? `Axis ${index}`,
    columnName: axisResult.columnName,
    sampleCount: axisResult.values.length,
    averageAbsoluteError:
      calculateAverageAbsolute(axisResult.values)
  }));

// Tracking error only means something against how hard the machine
// was being flown: 30 units of error is sloppy in a hover and
// invisible in a full-rate flip. Each axis's error is read relative
// to its own commanded magnitude, with a floor so a hover-only log
// cannot divide by almost nothing.
const axisRelativeTrackingErrors = averageAbsoluteAxisError.map(
  (axisResult, index) => {
    const setpointMagnitude = calculateAverageAbsolute(
      axisSetpointValues[index]?.values ?? []
    );

    return Number.isFinite(axisResult.averageAbsoluteError) &&
      Number.isFinite(setpointMagnitude)
      ? axisResult.averageAbsoluteError /
          Math.max(
            setpointMagnitude,
            TRACKING_SCORE_TUNING.SETPOINT_ACTIVITY_FLOOR
          )
      : null;
  }
);

const finiteRelativeErrors = axisRelativeTrackingErrors.filter(
  Number.isFinite
);

const meanRelativeTrackingError =
  finiteRelativeErrors.length > 0
    ? finiteRelativeErrors.reduce((sum, value) => sum + value, 0) /
      finiteRelativeErrors.length
    : null;
  


const pidColumns = findMatchingColumns(
 
    allColumns,
    [
      "axisp",
      "axisi",
      "axisd",
      "axisf",
      "pidsum",
      "pid"
    ]
  );
  
   
const groupedPidColumns =
  groupPidColumns(pidColumns);
  const pidTermValues = {
  p: groupedPidColumns.p.map(
    (columnName, axisIndex) => ({
      axis:
        axisNames[axisIndex] ??
        `Axis ${axisIndex}`,
      columnName,
      values: getColumnValues(
        lines,
        telemetryHeaderIndex,
        columnName
      )
    })
  ),

  i: groupedPidColumns.i.map(
    (columnName, axisIndex) => ({
      axis:
        axisNames[axisIndex] ??
        `Axis ${axisIndex}`,
      columnName,
      values: getColumnValues(
        lines,
        telemetryHeaderIndex,
        columnName
      )
    })
  ),

  d: groupedPidColumns.d.map(
    (columnName, axisIndex) => ({
      axis:
        axisNames[axisIndex] ??
        `Axis ${axisIndex}`,
      columnName,
      values: getColumnValues(
        lines,
        telemetryHeaderIndex,
        columnName
      )
    })
  ),

  feedforward:
    groupedPidColumns.feedforward.map(
      (columnName, axisIndex) => ({
        axis:
          axisNames[axisIndex] ??
          `Axis ${axisIndex}`,
        columnName,
        values: getColumnValues(
          lines,
          telemetryHeaderIndex,
          columnName
        )
      })
    )
};
const pidTermAverageAbsolute = {
  p: pidTermValues.p.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    sampleCount: termResult.values.length,
    averageAbsolute:
      calculateAverageAbsolute(termResult.values)
  })),

  i: pidTermValues.i.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    sampleCount: termResult.values.length,
    averageAbsolute:
      calculateAverageAbsolute(termResult.values)
  })),

  d: pidTermValues.d.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    sampleCount: termResult.values.length,
    averageAbsolute:
      calculateAverageAbsolute(termResult.values)
  })),

  feedforward:
    pidTermValues.feedforward.map(
      (termResult) => ({
        axis: termResult.axis,
        columnName: termResult.columnName,
        sampleCount: termResult.values.length,
        averageAbsolute:
          calculateAverageAbsolute(
            termResult.values
          )
      })
    )
};
const calculateMaximumAbsolute = (values) =>
  values.reduce((maximum, value) => {
    if (!Number.isFinite(value)) {
      return maximum;
    }

    return Math.max(
      maximum,
      Math.abs(value)
    );
  }, 0);

const pidTermMaximumAbsolute = {
  p: pidTermValues.p.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    maximumAbsolute:
      calculateMaximumAbsolute(
        termResult.values
      )
  })),

  i: pidTermValues.i.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    maximumAbsolute:
      calculateMaximumAbsolute(
        termResult.values
      )
  })),

  d: pidTermValues.d.map((termResult) => ({
    axis: termResult.axis,
    columnName: termResult.columnName,
    maximumAbsolute:
      calculateMaximumAbsolute(
        termResult.values
      )
  })),

  feedforward:
    pidTermValues.feedforward.map(
      (termResult) => ({
        axis: termResult.axis,
        columnName: termResult.columnName,
        maximumAbsolute:
          calculateMaximumAbsolute(
            termResult.values
          )
      })
    )
};
const analyzeNearPeakActivity = (
  values,
  maximumAbsolute
) => {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !Number.isFinite(maximumAbsolute) ||
    maximumAbsolute <= 0
  ) {
    return {
      sampleCount: 0,
      nearPeakSampleCount: 0,
      nearPeakPercent: null,
      longestNearPeakRun: 0,
      threshold: null
    };
  }

  const threshold =
    maximumAbsolute * 0.98;

  let validSampleCount = 0;
  let nearPeakSampleCount = 0;
  let currentNearPeakRun = 0;
  let longestNearPeakRun = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      currentNearPeakRun = 0;
      continue;
    }

    validSampleCount += 1;

    const isNearPeak =
      Math.abs(value) >= threshold;

    if (isNearPeak) {
      nearPeakSampleCount += 1;
      currentNearPeakRun += 1;

      longestNearPeakRun = Math.max(
        longestNearPeakRun,
        currentNearPeakRun
      );
    } else {
      currentNearPeakRun = 0;
    }
  }

  return {
    sampleCount: validSampleCount,
    nearPeakSampleCount,
    nearPeakPercent:
      validSampleCount > 0
        ? (
            nearPeakSampleCount /
            validSampleCount
          ) * 100
        : null,
    longestNearPeakRun,
    threshold
  };
};

const pidTermNearPeakActivity = {
  p: pidTermValues.p.map(
    (termResult, axisIndex) => ({
      axis: termResult.axis,
      columnName: termResult.columnName,
      ...analyzeNearPeakActivity(
        termResult.values,
        pidTermMaximumAbsolute.p[
          axisIndex
        ]?.maximumAbsolute
      )
    })
  ),

  i: pidTermValues.i.map(
    (termResult, axisIndex) => ({
      axis: termResult.axis,
      columnName: termResult.columnName,
      ...analyzeNearPeakActivity(
        termResult.values,
        pidTermMaximumAbsolute.i[
          axisIndex
        ]?.maximumAbsolute
      )
    })
  ),

  d: pidTermValues.d.map(
    (termResult, axisIndex) => ({
      axis: termResult.axis,
      columnName: termResult.columnName,
      ...analyzeNearPeakActivity(
        termResult.values,
        pidTermMaximumAbsolute.d[
          axisIndex
        ]?.maximumAbsolute
      )
    })
  ),

  feedforward:
    pidTermValues.feedforward.map(
      (termResult, axisIndex) => ({
        axis: termResult.axis,
        columnName: termResult.columnName,
        ...analyzeNearPeakActivity(
          termResult.values,
          pidTermMaximumAbsolute.feedforward[
            axisIndex
          ]?.maximumAbsolute
        )
      })
    )
};
const classifyPidTermSaturation = (
  nearPeakResult
) => {
  const nearPeakPercent =
    nearPeakResult?.nearPeakPercent;

  const longestNearPeakRun =
    nearPeakResult?.longestNearPeakRun ?? 0;

  const sampleCount =
    nearPeakResult?.sampleCount ?? 0;

  if (
    sampleCount <= 0 ||
    !Number.isFinite(nearPeakPercent)
  ) {
    return {
      status: "Insufficient Data",
      confidence: "Low",
      recommendation:
        "More valid PID-term samples are required before evaluating saturation."
    };
  }

  const sustainedRunDetected =
    longestNearPeakRun >= 100;

  const elevatedNearPeakActivity =
    nearPeakPercent >= 0.25;

  const moderateNearPeakActivity =
    nearPeakPercent >= 0.10;

  const status =
    sustainedRunDetected &&
    elevatedNearPeakActivity
      ? "Review"
      : "Clear";

  const confidence =
    sampleCount >= 10000
      ? "High"
      : sampleCount >= 1000
        ? "Medium"
        : "Low";

  const recommendation =
    status === "Review"
      ? "Repeated near-maximum PID-term activity was detected. Review the affected axis and term together with command activity, tracking error, and clipping evidence before changing PID values."
      : sustainedRunDetected &&
          moderateNearPeakActivity
        ? "A sustained near-peak run was detected, but total near-peak activity remained below the Review threshold. Monitor this term in another comparable log."
        : "No repeated sustained PID-term saturation pattern was identified.";

  return {
    status,
    confidence,
    recommendation,
    sustainedRunDetected,
    elevatedNearPeakActivity,
    moderateNearPeakActivity
  };
};

const pidTermSaturationAssessment = {
  p: pidTermNearPeakActivity.p.map(
    (termResult) => ({
      ...termResult,
      ...classifyPidTermSaturation(
        termResult
      )
    })
  ),

  i: pidTermNearPeakActivity.i.map(
    (termResult) => ({
      ...termResult,
      ...classifyPidTermSaturation(
        termResult
      )
    })
  ),

  d: pidTermNearPeakActivity.d.map(
    (termResult) => ({
      ...termResult,
      ...classifyPidTermSaturation(
        termResult
      )
    })
  ),

  feedforward:
    pidTermNearPeakActivity.feedforward.map(
      (termResult) => ({
        ...termResult,
        ...applyFeedforwardDoctrine(
          classifyPidTermSaturation(
            termResult
          )
        )
      })
    )
};
const pidCommandWindowsByAxis =
  commandEvents.map((axisResult, axisIndex) => ({
    axis: axisResult.axis,
    axisIndex,
    windows: axisResult.events
      .filter(
        (event) =>
          Number.isInteger(
            event?.responseWindowStart
          ) &&
          Number.isInteger(
            event?.responseWindowEnd
          ) &&
          event.responseWindowEnd >=
            event.responseWindowStart
      )
      .map((event) => ({
        startSampleIndex:
          event.responseWindowStart,
        endSampleIndex:
          event.responseWindowEnd
      }))
  }));
const getValuesFromCommandWindows = (
  values,
  windows
) => {
  const commandValues = [];

  for (const window of windows) {
    const startSampleIndex =
      Math.max(0, window.startSampleIndex);

    const endSampleIndex =
      Math.min(
        values.length - 1,
        window.endSampleIndex
      );

    for (
      let sampleIndex = startSampleIndex;
      sampleIndex <= endSampleIndex;
      sampleIndex += 1
    ) {
      const value = values[sampleIndex];

      if (Number.isFinite(value)) {
        commandValues.push(value);
      }
    }
  }

  return commandValues;
};
const pidCommandTermAverageAbsolute =
  axisNames.map((axis, axisIndex) => {
    const windows =
      pidCommandWindowsByAxis[axisIndex]
        ?.windows ?? [];

    const pValues =
      getValuesFromCommandWindows(
        pidTermValues.p[axisIndex]?.values ?? [],
        windows
      );

    const iValues =
      getValuesFromCommandWindows(
        pidTermValues.i[axisIndex]?.values ?? [],
        windows
      );

    const dValues =
      getValuesFromCommandWindows(
        pidTermValues.d[axisIndex]?.values ?? [],
        windows
      );

    const feedforwardValues =
      getValuesFromCommandWindows(
        pidTermValues.feedforward[axisIndex]
          ?.values ?? [],
        windows
      );

    return {
      axis,
      commandWindowCount: windows.length,
      pSampleCount: pValues.length,
      iSampleCount: iValues.length,
      dSampleCount: dValues.length,
      feedforwardSampleCount:
        feedforwardValues.length,
      pAverage:
        calculateAverageAbsolute(pValues),
      iAverage:
        calculateAverageAbsolute(iValues),
      dAverage:
        calculateAverageAbsolute(dValues),
      feedforwardAverage:
        calculateAverageAbsolute(
          feedforwardValues
        )
    };
  });
  const pidCommandTermContributionPercentages =
  pidCommandTermAverageAbsolute.map(
    (axisResult) => {
      const validTermAverages = [
        axisResult.pAverage,
        axisResult.iAverage,
        axisResult.dAverage,
        axisResult.feedforwardAverage
      ].filter((value) =>
        Number.isFinite(value)
      );
      

      

      const totalCommandActivity =
        validTermAverages.length > 0
          ? validTermAverages.reduce(
              (sum, value) => sum + value,
              0
            )
          : null;

      const calculatePercent = (value) =>
        Number.isFinite(value) &&
        Number.isFinite(totalCommandActivity) &&
        totalCommandActivity > 0
          ? (
              value /
              totalCommandActivity
            ) * 100
          : null;

      return {
        ...axisResult,
        totalCommandActivity,
        pPercent:
          calculatePercent(axisResult.pAverage),
        iPercent:
          calculatePercent(axisResult.iAverage),
        dPercent:
          calculatePercent(axisResult.dAverage),
        feedforwardPercent:
          calculatePercent(
            axisResult.feedforwardAverage
          )
      };
    }
  );

const pidTermContributionByAxis =
  axisNames.map((axis, axisIndex) => {
    const pAverage =
      pidTermAverageAbsolute.p[axisIndex]
        ?.averageAbsolute ?? null;

    const iAverage =
      pidTermAverageAbsolute.i[axisIndex]
        ?.averageAbsolute ?? null;

    const dAverage =
      pidTermAverageAbsolute.d[axisIndex]
        ?.averageAbsolute ?? null;

    const feedforwardAverage =
      pidTermAverageAbsolute.feedforward[
        axisIndex
      ]?.averageAbsolute ?? null;

    return {
      axis,
      pAverage,
      iAverage,
      dAverage,
      feedforwardAverage
    };
  });
  const pidTermContributionTotals =
  pidTermContributionByAxis.map((axisResult) => {
    const validTermAverages = [
      axisResult.pAverage,
      axisResult.iAverage,
      axisResult.dAverage,
      axisResult.feedforwardAverage
    ].filter((value) =>
      Number.isFinite(value)
    );

    const totalAverageActivity =
      validTermAverages.length > 0
        ? validTermAverages.reduce(
            (sum, value) => sum + value,
            0
          )
        : null;

    return {
      ...axisResult,
      totalAverageActivity
    };
  });
  const pidTermContributionPercentages =
  pidTermContributionTotals.map((axisResult) => {
    const total =
      axisResult.totalAverageActivity;

    const calculatePercent = (value) =>
      Number.isFinite(value) &&
      Number.isFinite(total) &&
      total > 0
        ? (value / total) * 100
        : null;

    return {
      ...axisResult,
      pPercent:
        calculatePercent(axisResult.pAverage),
      iPercent:
        calculatePercent(axisResult.iAverage),
      dPercent:
        calculatePercent(axisResult.dAverage),
      feedforwardPercent:
        calculatePercent(
          axisResult.feedforwardAverage
        )
    };
  });
  const dominantPidTermByAxis =
  pidTermContributionPercentages.map(
    (axisResult) => {
      const termPercentages = [
        {
          term: "P",
          percent: axisResult.pPercent
        },
        {
          term: "I",
          percent: axisResult.iPercent
        },
        {
          term: "D",
          percent: axisResult.dPercent
        },
        {
          term: "Feedforward",
          percent:
            axisResult.feedforwardPercent
        }
      ].filter((termResult) =>
        Number.isFinite(termResult.percent)
      );

      const dominantTerm =
        termPercentages.reduce(
          (highest, termResult) => {
            if (
              !highest ||
              termResult.percent >
                highest.percent
            ) {
              return termResult;
            }

            return highest;
          },
          null
        );

      return {
        axis: axisResult.axis,
        dominantTerm:
          dominantTerm?.term ?? null,
        dominantPercent:
          dominantTerm?.percent ?? null
      };
    }
  );

  const validAxisCount =
  averageAbsoluteAxisError.filter(
    (axisResult) =>
      Number.isFinite(axisResult.averageAbsoluteError) &&
      axisResult.sampleCount > 0
  ).length;
  const minimumSampleCount =
  averageAbsoluteAxisError.reduce(
    (smallest, axisResult) =>
      Math.min(smallest, axisResult.sampleCount),
    Number.POSITIVE_INFINITY
  );

// Tracking windows can come from airframe motion instead of rotor
// speed (no-RPM logs). The measurements are real, but without rotor
// context the stable-phase quality is weaker — the confidence cap
// below says so.
const motionBasisOnly =
  headspeedProfiles.length > 0 &&
  headspeedProfiles.every(
    (profile) => profile.basis === "motion"
  );

let confidenceScore = 10;

if (validAxisCount === 3) {
  confidenceScore += 40;
}

if (minimumSampleCount >= 10000) {
  confidenceScore += 30;
}

if (
  axisSetpointColumns.length === 3 &&
  groupedPidColumns.p.length === 3 &&
  groupedPidColumns.i.length === 3 &&
  groupedPidColumns.d.length === 3 &&
  groupedPidColumns.feedforward.length === 3
) {
  confidenceScore += 20;
}

// Everything above this point rates the log: three axes present,
// enough samples, every PID column detected. None of it asks whether
// the checks built on those columns actually had anything to measure.
// Overshoot, bounce-back, settling and ringing all need clean command
// events, and an axis that yielded almost none leaves them unanswered
// — which is a limit on the verdict, not a detail beneath it.
const commandEvidence = assessCommandEvidence(commandEvents);

confidenceScore = Math.max(
  0,
  confidenceScore - commandEvidence.penalty
);

if (motionBasisOnly) {
  confidenceScore = Math.min(confidenceScore, 65);
}

const confidenceLevel =
  confidenceScore >= 80
    ? "High"
    : confidenceScore >= 50
      ? "Medium"
      : "Low";
      const highestTrackingErrorAxis =
  averageAbsoluteAxisError.reduce(
    (highest, axisResult) => {
      if (
        !Number.isFinite(
          axisResult.averageAbsoluteError
        )
      ) {
        return highest;
      }

      if (
        !highest ||
        axisResult.averageAbsoluteError >
          highest.averageAbsoluteError
      ) {
        return axisResult;
      }

      return highest;
    },
    null
  );
   
  const pidCommandBalanceAssessment =
  pidCommandTermContributionPercentages.map(
    (axisResult) => {
    
      const hasUsableContributionData =
        axisResult.commandWindowCount >= 3 &&
        Number.isFinite(axisResult.iPercent) &&
        Number.isFinite(axisResult.pPercent) &&
        Number.isFinite(
          axisResult.feedforwardPercent
        );

      const isHighestTrackingErrorAxis =
        highestTrackingErrorAxis?.axis ===
        axisResult.axis;

      const iRemainsDominantDuringCommands =
        axisResult.iPercent >= 65;

      const commandSupportIsLow =
        axisResult.pPercent +
          axisResult.feedforwardPercent <
        35;

      const status =
  !hasUsableContributionData
    ? "Insufficient Data"
    : isHighestTrackingErrorAxis &&
        iRemainsDominantDuringCommands &&
        commandSupportIsLow
      ? "Review"
      : "Clear";

      return {
        axis: axisResult.axis,
        status,
        commandWindowCount:
          axisResult.commandWindowCount,
        isHighestTrackingErrorAxis,
        iRemainsDominantDuringCommands,
        commandSupportIsLow
      };
    }
  );
 const saturationReviewTerms = [
  ...pidTermSaturationAssessment.p,
  ...pidTermSaturationAssessment.i,
  ...pidTermSaturationAssessment.d
].filter(
  (termResult) =>
    termResult.status === "Review"
);

const commandBalanceReviewAxes =
  pidCommandBalanceAssessment.filter(
    (axisResult) =>
      axisResult.status === "Review"
  );

const pidSummary = [
  highestTrackingErrorAxis
    ? `${highestTrackingErrorAxis.axis} has the highest tracking error.`
    : "Tracking-error priority could not be identified.",

  commandBalanceReviewAxes.length > 0
    ? `${commandBalanceReviewAxes
        .map((axisResult) => axisResult.axis)
        .join(", ")} command balance requires review.`
    : "No command-balance review condition was identified.",

  saturationReviewTerms.length > 0
    ? `${saturationReviewTerms.length} PID term${
        saturationReviewTerms.length === 1
          ? ""
          : "s"
      } showed possible sustained saturation.`
    : "No sustained PID-term saturation pattern was identified.",

  canCompareProfiles
    ? `${bestTrackingProfile.targetRpm} RPM produced the lowest overall tracking error.`
    : onlyTrackingProfile
      ? Number.isFinite(onlyTrackingProfile.targetRpm)
        ? `The flight ran at one headspeed, ${onlyTrackingProfile.targetRpm} RPM, so headspeeds cannot be compared.`
        : "No rotor-speed data was logged, so tracking was measured over the moving parts of the flight and headspeeds cannot be compared."
      : "A best tracking profile could not be identified."
];
const hasCompleteTrackingEvidence =
  validAxisCount === 3 &&
  highestTrackingErrorAxis !== null;

const pidOverallStatus =
  !hasCompleteTrackingEvidence
    ? "Insufficient Data"
    : saturationReviewTerms.length > 0
      ? "Review"
      : commandBalanceReviewAxes.length > 0
        ? "Review"
        : "Clear";
      const scoreParts = computeTrackingScore({
  relativeError: meanRelativeTrackingError,
  commandBalanceReviewCount: commandBalanceReviewAxes.length,
  saturationReviewCount: saturationReviewTerms.length
});

const pidScore =
  hasCompleteTrackingEvidence ? scoreParts.score : null;

const pidScoreExplanation = [
  `${TRACKING_SCORE_TUNING.REAL_WORLD_MARGIN} points are reserved because one real-world flight cannot prove a mathematically perfect PID tune.`,
  Number.isFinite(meanRelativeTrackingError)
    ? `${scoreParts.trackingDeduction} points deducted for measured tracking error — on average the response missed its commanded rate by ${Math.round(
        meanRelativeTrackingError * 100
      )}% of the commanded magnitude.`
    : "Tracking error could not be measured against commanded motion.",

  commandBalanceReviewAxes.length > 0
    ? `${scoreParts.balanceDeduction} points deducted because ${commandBalanceReviewAxes
        .map((axisResult) => axisResult.axis)
        .join(", ")} command balance requires review.`
    : "No points were deducted for command balance.",

  saturationReviewTerms.length > 0
    ? `${scoreParts.saturationDeduction} points deducted because sustained PID-term saturation requires review.`
    : "No points were deducted for PID-term saturation.",

  bestTrackingProfile
  ? "No points were deducted for profile comparison data."
  : "Profile comparison was not available and did not affect the PID score."
];
  return {
    status: hasCompleteTrackingEvidence
  ? "PID Tracking Analysis Complete"
  : "PID Tracking Analysis Unavailable",
    summary: pidSummary,
    overallStatus: pidOverallStatus,
    score: pidScore,
    scoreExplanation: hasCompleteTrackingEvidence
  ? pidScoreExplanation
  : [],
    technicalSummary: {
  highestTrackingErrorAxis:
    highestTrackingErrorAxis?.axis ?? null,
  meanRelativeTrackingError:
    Number.isFinite(meanRelativeTrackingError)
      ? Math.round(meanRelativeTrackingError * 1000) / 1000
      : null,
  axisRelativeTrackingErrors:
    axisRelativeTrackingErrors.map((value) =>
      Number.isFinite(value)
        ? Math.round(value * 1000) / 1000
        : null
    ),
  bestTrackingProfileRpm:
    bestTrackingProfile?.targetRpm ?? null,
  commandBalanceReviewAxes:
    commandBalanceReviewAxes.map(
      (axisResult) => axisResult.axis
    ),
  saturationReviewTermCount:
    saturationReviewTerms.length,
    axisStatus: axisNames.map((axis) => {
  const commandBalance =
    pidCommandBalanceAssessment.find(
      (axisResult) =>
        axisResult.axis === axis
    );

  const trackingError =
    averageAbsoluteAxisError.find(
      (axisResult) =>
        axisResult.axis === axis
    );

  return {
    axis,
    trackingError:
      trackingError?.averageAbsoluteError ??
      null,
    commandBalanceStatus:
      commandBalance?.status ??
      "Insufficient Data"
  };
})
},
    
  confidence: hasCompleteTrackingEvidence
  ? {
      level: confidenceLevel,
      score: confidenceScore
    }
  : {
      level: "Insufficient",
      score: 0
    },

    findings: [
      `Axis setpoint columns detected: ${axisSetpointColumns.length}`,
      axisErrorColumns.length === 3
  ? `Tracking-error source: recorded axis-error columns (${axisErrorColumns.join(", ")})`
  : filteredGyroColumns.length === 3
    ? "Tracking-error source: derived from setpoint minus filtered gyro"
    : "Tracking-error source: unavailable",
      ...averageAbsoluteAxisError.map((axisResult) =>
        `${axisResult.axis} average absolute tracking error: ${
    Number.isFinite(axisResult.averageAbsoluteError)
      ? axisResult.averageAbsoluteError.toFixed(2)
      : "Unavailable"
  } from ${axisResult.sampleCount} samples`
),
...averageAbsoluteAxisResponse.map((axisResult) =>
  `${axisResult.axis} average absolute response: ${
    Number.isFinite(axisResult.averageAbsoluteResponse)
      ? axisResult.averageAbsoluteResponse.toFixed(2)
      : "Unavailable"
  } from ${axisResult.sampleCount} samples`
),
...instantaneousExceedanceAnalysis.map((axisResult) =>
  `${axisResult.axis} instantaneous exceedance rate: ${
    
    Number.isFinite(axisResult.exceedancePercent)
      ? axisResult.exceedancePercent.toFixed(2)
      : "Unavailable"
  }% from ${axisResult.commandSampleCount} command samples`
),
...commandEvents.map((axisResult) =>
  `${axisResult.axis} meaningful command events detected: ${axisResult.eventCount}`
),
...commandEvents.flatMap((axisResult) => {
  const validPeakEvents =
    axisResult.events.filter((event) =>
      Number.isFinite(event.responsePeak)
    );

  const averageAbsolutePeak =
    validPeakEvents.length > 0
      ? validPeakEvents.reduce(
          (sum, event) =>
            sum + Math.abs(event.responsePeak),
          0
        ) / validPeakEvents.length
      : null;

  return [
    `${axisResult.axis} events with valid response peaks: ${validPeakEvents.length}`,
    `${axisResult.axis} average absolute response peak: ${
      Number.isFinite(averageAbsolutePeak)
        ? averageAbsolutePeak.toFixed(2)
        : "Unavailable"
    }`
  ];
}),
...commandEvents.flatMap((axisResult) => {
  const validOvershootEvents =
    axisResult.events.filter((event) =>
      Number.isFinite(event.overshootPercent)
    );

  const averageOvershootPercent =
    validOvershootEvents.length > 0
      ? validOvershootEvents.reduce(
          (sum, event) =>
            sum + event.overshootPercent,
          0
        ) / validOvershootEvents.length
      : null;
const sortedOvershootPercentages =
  validOvershootEvents
    .map((event) => event.overshootPercent)
    .sort((firstValue, secondValue) =>
      firstValue - secondValue
    );

const medianOvershootPercent =
  sortedOvershootPercentages.length > 0
    ? (
        sortedOvershootPercentages[
          Math.floor(
            (sortedOvershootPercentages.length - 1) / 2
          )
        ] +
        sortedOvershootPercentages[
          Math.ceil(
            (sortedOvershootPercentages.length - 1) / 2
          )
        ]
      ) / 2
    : null;

const trimmedOvershootPercentages =
  sortedOvershootPercentages.length >= 5
    ? sortedOvershootPercentages.slice(0, -1)
    : sortedOvershootPercentages;

const trimmedMaximumOvershootPercent =
  trimmedOvershootPercentages.length > 0
    ? Math.max(...trimmedOvershootPercentages)
    : null;
  const maximumOvershootPercent =
    validOvershootEvents.length > 0
      ? Math.max(
          ...validOvershootEvents.map(
            (event) => event.overshootPercent
          )
        )
      : null;
const highestOvershootEvent =
  validOvershootEvents.reduce(
    (highestEvent, event) => {
      if (
        !highestEvent ||
        event.overshootPercent >
          highestEvent.overshootPercent
      ) {
        return event;
      }

      return highestEvent;
    },
    null
  );
  // An overshoot figure exists only where the response crossed past
  // its target. Plenty of clean responses and no overshoot among them
  // is an answer — the axis did not overshoot — not an absence of
  // evidence. Confidence therefore follows how many clean responses
  // the axis produced; only a shortage of THOSE leaves the question
  // open.
  const cleanResponseCount = axisResult.events.filter((event) =>
    Number.isFinite(event.responsePeak)
  ).length;

  const overshootConfidence =
    commandEvidenceConfidence(cleanResponseCount);

  const axisDidNotOvershoot =
    cleanResponseCount >= 2 && validOvershootEvents.length === 0;

   const overshootRecommendation =
  overshootConfidence === "Insufficient" ||
  overshootConfidence === "Low"
    ? `Collect more clean ${axisResult.axis} command events before evaluating overshoot.`
    : axisDidNotOvershoot
      ? `${axisResult.axis} did not overshoot its target on any of the ${cleanResponseCount} clean responses measured.`
      : Number.isFinite(medianOvershootPercent) &&
        medianOvershootPercent >= 25
      ? `Review ${axisResult.axis} for repeated overshoot. Confirm the pattern with another log before changing PID or feedforward values.`
      : `No repeated ${axisResult.axis} overshoot pattern was identified from the available clean events.`;

return [
  `${axisResult.axis} events with valid overshoot measurements: ${validOvershootEvents.length}`,
  `${axisResult.axis} overshoot confidence: ${overshootConfidence}${
    axisDidNotOvershoot ? " (no overshoot occurred)" : ""
  }`,
`${axisResult.axis} overshoot recommendation: ${overshootRecommendation}`,
  
  `${axisResult.axis} average event overshoot: ${
    Number.isFinite(averageOvershootPercent)
      ? averageOvershootPercent.toFixed(2)
      : "Unavailable"
  }%`,

  `${axisResult.axis} median event overshoot: ${
    Number.isFinite(medianOvershootPercent)
      ? medianOvershootPercent.toFixed(2)
      : "Unavailable"
  }%`,

  `${axisResult.axis} trimmed maximum event overshoot: ${
    Number.isFinite(trimmedMaximumOvershootPercent)
      ? trimmedMaximumOvershootPercent.toFixed(2)
      : "Unavailable"
  }%`,

  

highestOvershootEvent
  ? `${axisResult.axis} highest overshoot event details — command at: ${
      eventMomentText(
        highestOvershootEvent.sampleIndex,
        highestOvershootEvent.sampleRowIndex
      )
    }, command end: ${
      eventMomentText(
        highestOvershootEvent.commandEndSampleIndex,
        highestOvershootEvent.commandEndRowIndex
      )
    }, previous setpoint: ${
      Number.isFinite(highestOvershootEvent.previousSetpoint)
        ? highestOvershootEvent.previousSetpoint.toFixed(2)
        : "Unavailable"
    }, target: ${
      Number.isFinite(highestOvershootEvent.commandTarget)
        ? highestOvershootEvent.commandTarget.toFixed(2)
        : "Unavailable"
    }, command magnitude: ${
      Number.isFinite(highestOvershootEvent.commandMagnitude)
        ? highestOvershootEvent.commandMagnitude.toFixed(2)
        : "Unavailable"
    }, response peak: ${
      Number.isFinite(highestOvershootEvent.responsePeak)
        ? highestOvershootEvent.responsePeak.toFixed(2)
        : "Unavailable"
    }`
  : `${axisResult.axis} highest overshoot event details: Unavailable`
];
}),
 ...commandEvents.flatMap((axisResult) => {
  const validBounceBackEvents =
    axisResult.events.filter((event) =>
      event?.bounceBackEligible === true &&
      Number.isFinite(event?.bounceBackPercent)
    );

  const bounceBackPercentValues =
    validBounceBackEvents.map(
      (event) => event.bounceBackPercent
    );
const averageBounceBackPercent =
  bounceBackPercentValues.length > 0
    ? bounceBackPercentValues.reduce(
        (sum, value) => sum + value,
        0
      ) / bounceBackPercentValues.length
    : null;
    const sortedBounceBackPercentValues =
  [...bounceBackPercentValues].sort(
    (a, b) => a - b
  );

const medianBounceBackPercent =
sortedBounceBackPercentValues.length > 0
    ? sortedBounceBackPercentValues.length % 2 === 1
      ? sortedBounceBackPercentValues[
          Math.floor(
            sortedBounceBackPercentValues.length / 2
          )
        ]
      : (
          sortedBounceBackPercentValues[
            sortedBounceBackPercentValues.length / 2 - 1
          ] +
          sortedBounceBackPercentValues[
            sortedBounceBackPercentValues.length / 2
          ]
        ) / 2
    : null;
    const maximumBounceBackPercent =
  bounceBackPercentValues.length > 0
    ? Math.max(...bounceBackPercentValues)
    : null;
  
  const trimmedBounceBackPercentValues =
  sortedBounceBackPercentValues.length >= 4
    ? sortedBounceBackPercentValues.slice(0, -1)
    : sortedBounceBackPercentValues;

const trimmedMaximumBounceBackPercent =
  trimmedBounceBackPercentValues.length > 0
    ? Math.max(...trimmedBounceBackPercentValues)
    : null;
    const highestBounceBackEvent =
  validBounceBackEvents.reduce(
    (highestEvent, event) => {
      if (
        !highestEvent ||
        event.bounceBackPercent >
          highestEvent.bounceBackPercent
      ) {
        return event;
      }

      return highestEvent;
    },
    null
    );
    // A response can only bounce back from an overshoot, so an axis
    // that never overshot offers nothing to measure — which is a
    // result about the axis, not a gap in the log. Saying
    // "Insufficient Data" there sends a pilot hunting for evidence
    // their good flying is the reason they do not have. The whole
    // block must tell that one story: an observation ("no overshoot
    // to recover from") backed by the clean responses that justify
    // it — never a "Clear" verdict sitting beside an Insufficient
    // confidence and a plea for more data.
    const cleanBounceResponseCount = axisResult.events.filter(
      (event) => Number.isFinite(event.responsePeak)
    ).length;

    const nothingToBounceFrom =
      validBounceBackEvents.length === 0 &&
      cleanBounceResponseCount >= 2;

    const bounceBackConfidence =
  nothingToBounceFrom
    ? commandEvidenceConfidence(cleanBounceResponseCount)
    : validBounceBackEvents.length >= 5
    ? "High"
    : validBounceBackEvents.length >= 3
      ? "Medium"
      : validBounceBackEvents.length >= 2
        ? "Low"
        : "Insufficient";
        const bounceBackRecommendation =
  nothingToBounceFrom
    ? `${axisResult.axis} produced ${cleanBounceResponseCount} clean responses and none overshot, so there is no bounce-back to measure. No action needed.`
    : bounceBackConfidence === "Insufficient" ||
  bounceBackConfidence === "Low"
    ? `Collect more clean ${axisResult.axis} command events before evaluating bounce-back.`
    : Number.isFinite(medianBounceBackPercent) &&
        medianBounceBackPercent >= 15
      ? `Review ${axisResult.axis} for repeated response reversal after command peaks. Confirm the pattern before changing PID gains.`
      : `No repeated ${axisResult.axis} bounce-back pattern was identified from the valid command events.`;

      const bounceBackStatus =
  nothingToBounceFrom
    ? "No overshoot to recover from"
    : bounceBackConfidence === "Insufficient" ||
  bounceBackConfidence === "Low"
    ? "Insufficient Data"
    : Number.isFinite(medianBounceBackPercent) &&
        medianBounceBackPercent >= 15
      ? "Review"
      : "Clear";
return [
  `${axisResult.axis} events with valid bounce-back measurements: ${validBounceBackEvents.length}`,
  `${axisResult.axis} bounce-back status: ${bounceBackStatus}`,
  `${axisResult.axis} bounce-back confidence: ${bounceBackConfidence}${
    nothingToBounceFrom
      ? ` (based on ${cleanBounceResponseCount} clean responses, none overshot)`
      : ""
  }`,
  `${axisResult.axis} bounce-back evidence: ${
    nothingToBounceFrom
      ? `${cleanBounceResponseCount} clean responses without overshoot — no bounce-back events expected`
      : `${validBounceBackEvents.length} valid event${
          validBounceBackEvents.length === 1 ? "" : "s"
        }`
  }`,
  `${axisResult.axis} bounce-back recommendation: ${bounceBackRecommendation}`,

  `${axisResult.axis} average event bounce-back: ${
    Number.isFinite(averageBounceBackPercent)
      ? averageBounceBackPercent.toFixed(2)
      : "Unavailable"
  }%`,

  `${axisResult.axis} median event bounce-back: ${
    Number.isFinite(medianBounceBackPercent)
      ? medianBounceBackPercent.toFixed(2)
      : "Unavailable"
  }%`,

  `${axisResult.axis} trimmed maximum event bounce-back: ${
    Number.isFinite(trimmedMaximumBounceBackPercent)
      ? trimmedMaximumBounceBackPercent.toFixed(2)
      : "Unavailable"
  }%`,

  `${axisResult.axis} raw maximum event bounce-back: ${
    Number.isFinite(maximumBounceBackPercent)
      ? maximumBounceBackPercent.toFixed(2)
      : "Unavailable"
  }%`,

  highestBounceBackEvent
    ? `${axisResult.axis} highest bounce-back event details — command at: ${
        eventMomentText(
          highestBounceBackEvent.sampleIndex,
          highestBounceBackEvent.sampleRowIndex
        )
      }, target: ${
        Number.isFinite(highestBounceBackEvent.commandTarget)
          ? highestBounceBackEvent.commandTarget.toFixed(2)
          : "Unavailable"
      }, response peak: ${
        Number.isFinite(highestBounceBackEvent.responsePeak)
          ? highestBounceBackEvent.responsePeak.toFixed(2)
          : "Unavailable"
      }, bounce-back extreme: ${
        Number.isFinite(highestBounceBackEvent.bounceBackExtreme)
          ? highestBounceBackEvent.bounceBackExtreme.toFixed(2)
          : "Unavailable"
      }, bounce-back: ${
        Number.isFinite(highestBounceBackEvent.bounceBackPercent)
          ? highestBounceBackEvent.bounceBackPercent.toFixed(2)
          : "Unavailable"
      }%`
    : `${axisResult.axis} highest bounce-back event details: Unavailable`
];
}),
...commandEvents.flatMap((axisResult) => {
  const validSettlingEvents =
    axisResult.events.filter((event) =>
      event?.settlingEligible === true &&
      Number.isFinite(
        event?.settlingDurationSamples
      )
    );

  const settlingDurationSamples =
    validSettlingEvents.map(
      (event) => event.settlingDurationSamples
    );
const averageSettlingDurationSamples =
  settlingDurationSamples.length > 0
    ? settlingDurationSamples.reduce(
        (sum, value) => sum + value,
        0
      ) / settlingDurationSamples.length
    : null;
    const sortedSettlingDurationSamples =
  [...settlingDurationSamples].sort(
    (a, b) => a - b
  );

const medianSettlingDurationSamples =
  sortedSettlingDurationSamples.length > 0
    ? sortedSettlingDurationSamples.length % 2 === 1
      ? sortedSettlingDurationSamples[
          Math.floor(
            sortedSettlingDurationSamples.length / 2
          )
        ]
      : (
          sortedSettlingDurationSamples[
            sortedSettlingDurationSamples.length / 2 - 1
          ] +
          sortedSettlingDurationSamples[
            sortedSettlingDurationSamples.length / 2
          ]
        ) / 2
    : null;
    const maximumSettlingDurationSamples =
  settlingDurationSamples.length > 0
    ? Math.max(...settlingDurationSamples)
    : null;
    const trimmedSettlingDurationSamples =
  sortedSettlingDurationSamples.length >= 4
    ? sortedSettlingDurationSamples.slice(0, -1)
    : sortedSettlingDurationSamples;

const trimmedMaximumSettlingDurationSamples =
  trimmedSettlingDurationSamples.length > 0
    ? Math.max(...trimmedSettlingDurationSamples)
    : null;
    const highestSettlingDurationEvent =
  validSettlingEvents.reduce(
    (highestEvent, event) => {
      if (
        !highestEvent ||
        event.settlingDurationSamples >
          highestEvent.settlingDurationSamples
      ) {
        return event;
      }

      return highestEvent;
    },
    null
  );
  const settlingConfidence =
  validSettlingEvents.length >= 5
    ? "High"
    : validSettlingEvents.length >= 3
      ? "Medium"
      : validSettlingEvents.length >= 2
        ? "Low"
        : "Insufficient";
        const settlingRecommendation =
  settlingConfidence === "Insufficient" ||
  settlingConfidence === "Low"
    ? `Collect more clean ${axisResult.axis} command events before evaluating settling behavior.`
    : Number.isFinite(
        medianSettlingDurationSamples
      ) &&
        medianSettlingDurationSamples >= 100
      ? `Review ${axisResult.axis} for slow settling after command changes. Confirm the pattern with another log before changing PID values.`
      : `No repeated slow-settling pattern was identified for ${axisResult.axis}.`;
      const settlingStatus =
  settlingConfidence === "Insufficient" ||
  settlingConfidence === "Low"
    ? "Insufficient Data"
    : Number.isFinite(
        medianSettlingDurationSamples
      ) &&
        medianSettlingDurationSamples >= 100
      ? "Review"
      : "Clear";
  return [
  `${axisResult.axis} settling status: ${settlingStatus}`,
  `${axisResult.axis} settling confidence: ${settlingConfidence}`,
  `${axisResult.axis} settling evidence: ${validSettlingEvents.length} valid event${
    validSettlingEvents.length === 1 ? "" : "s"
  }`,
  
  `${axisResult.axis} settling recommendation: ${settlingRecommendation}`,
  `${axisResult.axis} average settling duration: ${
  Number.isFinite(averageSettlingDurationSamples)
    ? averageSettlingDurationSamples.toFixed(2)
    : "Unavailable"
} samples`,

`${axisResult.axis} median settling duration: ${
  Number.isFinite(medianSettlingDurationSamples)
    ? medianSettlingDurationSamples.toFixed(2)
    : "Unavailable"
} samples`,
`${axisResult.axis} trimmed maximum settling duration: ${
  Number.isFinite(trimmedMaximumSettlingDurationSamples)
    ? trimmedMaximumSettlingDurationSamples.toFixed(2)
    : "Unavailable"
} samples`,

`${axisResult.axis} raw maximum settling duration: ${
  Number.isFinite(maximumSettlingDurationSamples)
    ? maximumSettlingDurationSamples.toFixed(2)
    : "Unavailable"
} samples`,
highestSettlingDurationEvent
  ? `${axisResult.axis} slowest settling event details — sample: ${highestSettlingDurationEvent.sampleIndex}, command end: ${highestSettlingDurationEvent.commandEndSampleIndex}, target: ${
      Number.isFinite(highestSettlingDurationEvent.commandTarget)
        ? highestSettlingDurationEvent.commandTarget.toFixed(2)
        : "Unavailable"
    }, settling start: ${
      Number.isInteger(highestSettlingDurationEvent.settlingSampleIndex)
        ? highestSettlingDurationEvent.settlingSampleIndex
        : "Unavailable"
    }, duration: ${
      Number.isFinite(highestSettlingDurationEvent.settlingDurationSamples)
        ? highestSettlingDurationEvent.settlingDurationSamples.toFixed(2)
        : "Unavailable"
    } samples`
  : `${axisResult.axis} slowest settling event details: Unavailable`
];
}),
...commandEvents.flatMap((axisResult) => {
  const validRingingEvents =
    axisResult.events.filter((event) =>
      event?.ringingEligible === true &&
      Number.isFinite(
        event?.ringingTargetCrossingCount
      )
    );

  const ringingCrossingCounts =
    validRingingEvents.map(
      (event) =>
        event.ringingTargetCrossingCount
    );

const averageRingingCrossingCount =
  ringingCrossingCounts.length > 0
    ? ringingCrossingCounts.reduce(
        (sum, value) => sum + value,
        0
      ) / ringingCrossingCounts.length
    : null;
    const sortedRingingCrossingCounts =
  [...ringingCrossingCounts].sort(
    (a, b) => a - b
  );

const medianRingingCrossingCount =
  sortedRingingCrossingCounts.length > 0
    ? sortedRingingCrossingCounts.length % 2 === 1
      ? sortedRingingCrossingCounts[
          Math.floor(
            sortedRingingCrossingCounts.length / 2
          )
        ]
      : (
          sortedRingingCrossingCounts[
            sortedRingingCrossingCounts.length / 2 - 1
          ] +
          sortedRingingCrossingCounts[
            sortedRingingCrossingCounts.length / 2
          ]
        ) / 2
    : null;
    const maximumRingingCrossingCount =
  ringingCrossingCounts.length > 0
    ? Math.max(...ringingCrossingCounts)
    : null;
    const trimmedRingingCrossingCounts =
  sortedRingingCrossingCounts.length >= 4
    ? sortedRingingCrossingCounts.slice(0, -1)
    : sortedRingingCrossingCounts;

const trimmedMaximumRingingCrossingCount =
  trimmedRingingCrossingCounts.length > 0
    ? Math.max(...trimmedRingingCrossingCounts)
    : null;
    const highestRingingEvent =
  validRingingEvents.reduce(
    (highestEvent, event) => {
      if (
        !highestEvent ||
        event.ringingTargetCrossingCount >
          highestEvent.ringingTargetCrossingCount
      ) {
        return event;
      }

      return highestEvent;
    },
    null
  );
  const ringingConfidence =
  validRingingEvents.length >= 5
    ? "High"
    : validRingingEvents.length >= 3
      ? "Medium"
      : validRingingEvents.length >= 2
        ? "Low"
        : "Insufficient";
        const ringingRecommendation =
  ringingConfidence === "Insufficient" ||
  ringingConfidence === "Low"
    ? `Collect more clean ${axisResult.axis} command events before evaluating sustained ringing.`
    : Number.isFinite(
        medianRingingCrossingCount
      ) &&
        medianRingingCrossingCount >= 3
      ? `Review ${axisResult.axis} for repeated post-command ringing. Confirm the pattern with another log before changing PID or filter values.`
      : `No repeated sustained-ringing pattern was identified for ${axisResult.axis}.`;
      const ringingStatus =
  ringingConfidence === "Insufficient" ||
  ringingConfidence === "Low"
    ? "Insufficient Data"
    : Number.isFinite(
        medianRingingCrossingCount
      ) &&
        medianRingingCrossingCount >= 3
      ? "Review"
      : "Clear";
  return [
  `${axisResult.axis} ringing status: ${ringingStatus}`,
  `${axisResult.axis} ringing confidence: ${ringingConfidence}`,
  `${axisResult.axis} ringing evidence: ${validRingingEvents.length} valid event${
    validRingingEvents.length === 1 ? "" : "s"
  }`,
  `${axisResult.axis} ringing recommendation: ${ringingRecommendation}`,
  `${axisResult.axis} average ringing target crossings: ${
  Number.isFinite(averageRingingCrossingCount)
    ? averageRingingCrossingCount.toFixed(2)
    : "Unavailable"
}`,

`${axisResult.axis} median ringing target crossings: ${
  Number.isFinite(medianRingingCrossingCount)
    ? medianRingingCrossingCount.toFixed(2)
    : "Unavailable"
}`,
`${axisResult.axis} trimmed maximum ringing target crossings: ${
  Number.isFinite(trimmedMaximumRingingCrossingCount)
    ? trimmedMaximumRingingCrossingCount.toFixed(2)
    : "Unavailable"
}`,

`${axisResult.axis} raw maximum ringing target crossings: ${
  Number.isFinite(maximumRingingCrossingCount)
    ? maximumRingingCrossingCount.toFixed(2)
    : "Unavailable"
}`,
highestRingingEvent
  ? `${axisResult.axis} highest ringing event details — sample: ${highestRingingEvent.sampleIndex}, command end: ${highestRingingEvent.commandEndSampleIndex}, target: ${
      Number.isFinite(highestRingingEvent.commandTarget)
        ? highestRingingEvent.commandTarget.toFixed(2)
        : "Unavailable"
    }, response peak: ${
      Number.isFinite(highestRingingEvent.responsePeak)
        ? highestRingingEvent.responsePeak.toFixed(2)
        : "Unavailable"
    }, meaningful target crossings: ${
      Number.isFinite(highestRingingEvent.ringingTargetCrossingCount)
        ? highestRingingEvent.ringingTargetCrossingCount.toFixed(2)
        : "Unavailable"
    }`
  : `${axisResult.axis} highest ringing event details: Unavailable`
];
}),
highestTrackingErrorAxis
  ? `${highestTrackingErrorAxis.axis} has the highest average tracking error at ${highestTrackingErrorAxis.averageAbsoluteError.toFixed(2)}. This axis deserves the closest review during PID tuning.`
  : "A highest tracking-error axis could not be identified.",

...profileTrackingAnalysis.flatMap((profile) => {
  const axisResults = Array.isArray(profile.axisResults)
    ? profile.axisResults
    : [];

  return [
    `${
      Number.isFinite(profile.targetRpm)
        ? `${profile.targetRpm} RPM profile tracking`
        : "Motion-based tracking (no rotor-speed data)"
    } from ${profile.sampleCount} samples:`,

    ...(axisResults.length > 0
      ? axisResults.map((axisResult) =>
          `  ${axisResult.axis}: ${
            Number.isFinite(axisResult.averageAbsoluteError)
              ? axisResult.averageAbsoluteError.toFixed(2)
              : "Unavailable"
          } average absolute error`
        )
      : [
          `  Per-axis tracking values were unavailable for this profile.`
        ])
  ];
}),

...(canCompareProfiles
  ? [
      `${bestTrackingProfile.targetRpm} RPM has the lowest overall tracking error at ${bestTrackingProfile.averageTrackingError.toFixed(
        2
      )}.`,
      `${worstTrackingProfile.targetRpm} RPM has the highest overall tracking error at ${worstTrackingProfile.averageTrackingError.toFixed(
        2
      )}.`
    ]
  : onlyTrackingProfile
    ? [
        `${
        Number.isFinite(onlyTrackingProfile.targetRpm)
          ? `${onlyTrackingProfile.targetRpm} RPM was the only headspeed flown`
          : "Tracking was measured over the moving parts of the flight (no rotor-speed data)"
      }, with an average tracking error of ${onlyTrackingProfile.averageTrackingError.toFixed(
          2
        )}. Fly a second headspeed to compare them.`
      ]
    : ["Tracking could not be compared across headspeeds."]),
  ...pidCommandTermContributionPercentages.map(
  (axisResult) =>
    `${axisResult.axis} command-event PID contribution from ${
      axisResult.commandWindowCount
    } window${
      axisResult.commandWindowCount === 1 ? "" : "s"
    } — P: ${
      Number.isFinite(axisResult.pPercent)
        ? axisResult.pPercent.toFixed(2)
        : "Unavailable"
    }%, I: ${
      Number.isFinite(axisResult.iPercent)
        ? axisResult.iPercent.toFixed(2)
        : "Unavailable"
    }%, D: ${
      Number.isFinite(axisResult.dPercent)
        ? axisResult.dPercent.toFixed(2)
        : "Unavailable"
    }%, Feedforward: ${
      Number.isFinite(axisResult.feedforwardPercent)
        ? axisResult.feedforwardPercent.toFixed(2)
        : "Unavailable"
    }%`
),
...pidCommandBalanceAssessment.map(
  (axisResult) =>
    `${axisResult.axis} command-balance status: ${
      axisResult.status
    } from ${
      axisResult.commandWindowCount
    } command window${
      axisResult.commandWindowCount === 1 ? "" : "s"
    }`
),
...pidCommandBalanceAssessment.map(
  (axisResult) =>
    axisResult.status === "Review"
      ? `${axisResult.axis} command-balance finding: I remains dominant during command events while P plus feedforward support stays below 35%, and this axis also has the highest tracking error. Review setpoint, axis error, feedforward, and I behavior together before changing any PID value.`
      : axisResult.status === "Clear"
        ? `${axisResult.axis} command-balance finding: No combined tracking-error and command-support concern was identified.`
        : `${axisResult.axis} command-balance finding: More usable command windows are required before evaluating PID-term balance.`
),
  ...pidTermContributionPercentages.map(
  (axisResult) =>
    `${axisResult.axis} PID-term contribution — P: ${
      Number.isFinite(axisResult.pPercent)
        ? axisResult.pPercent.toFixed(2)
        : "Unavailable"
    }%, I: ${
      Number.isFinite(axisResult.iPercent)
        ? axisResult.iPercent.toFixed(2)
        : "Unavailable"
    }%, D: ${
      Number.isFinite(axisResult.dPercent)
        ? axisResult.dPercent.toFixed(2)
        : "Unavailable"
    }%, Feedforward: ${
      Number.isFinite(axisResult.feedforwardPercent)
        ? axisResult.feedforwardPercent.toFixed(2)
        : "Unavailable"
    }%`
),

...dominantPidTermByAxis.map(
  (axisResult) =>
    `${axisResult.axis} dominant PID term: ${
      axisResult.dominantTerm ?? "Unavailable"
    } at ${
      Number.isFinite(axisResult.dominantPercent)
        ? axisResult.dominantPercent.toFixed(2)
        : "Unavailable"
    }%`
),
...axisNames.flatMap((axis, axisIndex) => [
  `${axis} observed P-term peak: ${
    Number.isFinite(
      pidTermMaximumAbsolute.p[axisIndex]
        ?.maximumAbsolute
    )
      ? pidTermMaximumAbsolute.p[
          axisIndex
        ].maximumAbsolute.toFixed(2)
      : "Unavailable"
  }`,

  `${axis} observed I-term peak: ${
    Number.isFinite(
      pidTermMaximumAbsolute.i[axisIndex]
        ?.maximumAbsolute
    )
      ? pidTermMaximumAbsolute.i[
          axisIndex
        ].maximumAbsolute.toFixed(2)
      : "Unavailable"
  }`,

  `${axis} observed D-term peak: ${
    Number.isFinite(
      pidTermMaximumAbsolute.d[axisIndex]
        ?.maximumAbsolute
    )
      ? pidTermMaximumAbsolute.d[
          axisIndex
        ].maximumAbsolute.toFixed(2)
      : "Unavailable"
  }`,

  `${axis} observed Feedforward peak: ${
    Number.isFinite(
      pidTermMaximumAbsolute.feedforward[
        axisIndex
      ]?.maximumAbsolute
    )
      ? pidTermMaximumAbsolute.feedforward[
          axisIndex
        ].maximumAbsolute.toFixed(2)
      : "Unavailable"
  }`
]),
...axisNames.flatMap((axis, axisIndex) => [
  `${axis} P-term near-peak activity: ${
    Number.isFinite(
      pidTermNearPeakActivity.p[axisIndex]
        ?.nearPeakPercent
    )
      ? pidTermNearPeakActivity.p[
          axisIndex
        ].nearPeakPercent.toFixed(4)
      : "Unavailable"
  }% across ${
    pidTermNearPeakActivity.p[axisIndex]
      ?.nearPeakSampleCount ?? 0
  } samples, longest run ${
    pidTermNearPeakActivity.p[axisIndex]
      ?.longestNearPeakRun ?? 0
  } samples`,

  `${axis} I-term near-peak activity: ${
    Number.isFinite(
      pidTermNearPeakActivity.i[axisIndex]
        ?.nearPeakPercent
    )
      ? pidTermNearPeakActivity.i[
          axisIndex
        ].nearPeakPercent.toFixed(4)
      : "Unavailable"
  }% across ${
    pidTermNearPeakActivity.i[axisIndex]
      ?.nearPeakSampleCount ?? 0
  } samples, longest run ${
    pidTermNearPeakActivity.i[axisIndex]
      ?.longestNearPeakRun ?? 0
  } samples`,

  `${axis} D-term near-peak activity: ${
    Number.isFinite(
      pidTermNearPeakActivity.d[axisIndex]
        ?.nearPeakPercent
    )
      ? pidTermNearPeakActivity.d[
          axisIndex
        ].nearPeakPercent.toFixed(4)
      : "Unavailable"
  }% across ${
    pidTermNearPeakActivity.d[axisIndex]
      ?.nearPeakSampleCount ?? 0
  } samples, longest run ${
    pidTermNearPeakActivity.d[axisIndex]
      ?.longestNearPeakRun ?? 0
  } samples`,

  `${axis} Feedforward near-peak activity: ${
    Number.isFinite(
      pidTermNearPeakActivity.feedforward[
        axisIndex
      ]?.nearPeakPercent
    )
      ? pidTermNearPeakActivity.feedforward[
          axisIndex
        ].nearPeakPercent.toFixed(4)
      : "Unavailable"
  }% across ${
    pidTermNearPeakActivity.feedforward[
      axisIndex
    ]?.nearPeakSampleCount ?? 0
  } samples, longest run ${
    pidTermNearPeakActivity.feedforward[
      axisIndex
    ]?.longestNearPeakRun ?? 0
  } samples`
]),
...axisNames.flatMap((axis, axisIndex) => [
  `${axis} P-term saturation status: ${
    pidTermSaturationAssessment.p[axisIndex]
      ?.status ?? "Insufficient Data"
  } with ${
    pidTermSaturationAssessment.p[axisIndex]
      ?.confidence ?? "Low"
  } confidence`,

  `${axis} I-term saturation status: ${
    pidTermSaturationAssessment.i[axisIndex]
      ?.status ?? "Insufficient Data"
  } with ${
    pidTermSaturationAssessment.i[axisIndex]
      ?.confidence ?? "Low"
  } confidence`,

  `${axis} D-term saturation status: ${
    pidTermSaturationAssessment.d[axisIndex]
      ?.status ?? "Insufficient Data"
  } with ${
    pidTermSaturationAssessment.d[axisIndex]
      ?.confidence ?? "Low"
  } confidence`,

  `${axis} Feedforward sustained-drive status: ${
    pidTermSaturationAssessment.feedforward[
      axisIndex
    ]?.status ?? "Insufficient Data"
  } with ${
    pidTermSaturationAssessment.feedforward[
      axisIndex
    ]?.confidence ?? "Low"
  } confidence`
]),
     `P-term columns detected: ${groupedPidColumns.p.length}`,
      `P-term column names: ${groupedPidColumns.p.join(", ")}`,
      `Axis setpoint column names: ${axisSetpointColumns.join(", ")}`,
`I-term columns detected: ${groupedPidColumns.i.length}`,
`D-term columns detected: ${groupedPidColumns.d.length}`,
`Feedforward columns detected: ${groupedPidColumns.feedforward.length}`,
`PID-sum columns detected: ${groupedPidColumns.pidSum.length}`
    ],
    recommendations: [
      ...[
  ...pidTermSaturationAssessment.p,
  ...pidTermSaturationAssessment.i,
  ...pidTermSaturationAssessment.d
]
  .filter(
    (termResult) =>
      termResult.status === "Review"
  )
  .map(
    (termResult) =>
      `Review ${termResult.axis} ${termResult.columnName} for possible sustained PID-term saturation. Near-peak activity reached ${
        Number.isFinite(termResult.nearPeakPercent)
          ? termResult.nearPeakPercent.toFixed(4)
          : "Unavailable"
      }% with a longest run of ${
        termResult.longestNearPeakRun ?? 0
      } samples. Compare this with command activity, tracking error, and the matching axis response before changing PID values.`
  ),
      ...pidTermSaturationAssessment.feedforward
  .filter(
    (termResult) =>
      termResult.status === "Expected"
  )
  .map(
    (termResult) =>
      `${termResult.axis} ${termResult.columnName} held near-maximum output for sustained periods. In Rotorflight this is feedforward doing its intended work and it does not reduce the score. If ${termResult.axis} tracking is poor, review the command-balance result instead of lowering feedforward.`
  ),
      ...pidCommandBalanceAssessment
  .filter(
    (axisResult) =>
      axisResult.status === "Review"
  )
  .map(
    (axisResult) =>
      `Review ${axisResult.axis} command balance before changing PID values. I remains dominant during command events while P plus feedforward support stays below 35%, and this axis also has the highest tracking error. Compare setpoint, axis error, feedforward, and I behavior together.`
  ),
 commandBalanceReviewAxes.length === 0 &&
saturationReviewTerms.length === 0 &&
highestTrackingErrorAxis
  ? `No command-balance or PID-term saturation review condition was identified. If further tuning is desired, compare ${highestTrackingErrorAxis.axis} first because it had the highest tracking error.`
  : null,
   ].filter(Boolean),
  
        evidence: [
      {  
        source: "Setpoint Columns",
        value: setpointColumns
      },
      {
        source: "Axis Error Columns",
        value: axisErrorColumns
      },
      {
        source: "PID Columns",
        value: pidColumns
      }
    ],
    detectedColumns: {
  setpoint: setpointColumns,
  axisSetpoint: axisSetpointColumns,
  axisError: axisErrorColumns,
  pid: pidColumns,
  groupedPid: groupedPidColumns,
  trackingAnalysis: {
  averageAbsoluteAxisError,
  averageAbsoluteAxisResponse,
  instantaneousExceedanceAnalysis,
  commandEvents,
  profileTrackingAnalysis
},
},    analysisContext,
    lineCount: Array.isArray(lines)
      ? lines.length
      : 0
  };
}