// ======================================================
// BLACKBOX LAB — BATTERY LAB ANALYSIS
// ======================================================
//
// Charts may show the complete recording.
//
// Battery conclusions use only stable governed-flight
// samples. Spool-up, spool-down, ground operation and
// headspeed-profile transitions are excluded.
//
// Electrical values remain estimates because telemetry
// scaling and calibration vary between installations.
//
// ======================================================

import {
  detectStableFlightPhase,
  detectInFlightSamples
} from "./flightPhase.js";

function averageOf(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}

function minimumOf(values) {
  let minimum = Infinity;

  for (const value of values) {
    if (Number.isFinite(value) && value < minimum) {
      minimum = value;
    }
  }

  return Number.isFinite(minimum) ? minimum : null;
}
function hasUsablePositiveData(values) {
  if (!Array.isArray(values) || values.length < 200) {
    return false;
  }

  let usableCount = 0;

  for (const value of values) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      usableCount += 1;

      if (usableCount >= 20) {
        return true;
      }
    }
  }

  return false;
}
// Raw average of a voltage column — no unit inference here. The
// cross-check below compares sources scale-invariantly, because
// unit inference is exactly what cannot be trusted at this point
// (a 2S micro's decivolt vbat averages 76 raw, which the magnitude
// rule reads as 76 V and would turn into a phantom conflict).
function rawAverage(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  let sum = 0;
  let count = 0;

  for (const value of values) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      sum += numericValue;
      count += 1;
    }
  }

  return count > 0 ? sum / count : null;
}

// Scale-free disagreement between two positive readings: fold
// their ratio by powers of ten into [1/√10, √10) and measure the
// distance from 1. Two sources measuring the same pack in ANY
// units (volts, decivolts, centivolts) fold to ~1; a genuine
// reading difference survives every power-of-ten alignment.
// (Folding, not mantissas: 9.8 V vs 10.2 V sit on either side of a
// decade boundary and must still read as agreement.)
function scaleFreeDisagreement(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return null;
  }

  let ratio = a / b;
  const edge = Math.sqrt(10);

  while (ratio >= edge) ratio /= 10;
  while (ratio < 1 / edge) ratio *= 10;

  return Math.max(ratio, 1 / ratio) - 1;
}

// The Lab's display scale rule — used for the note's numbers only,
// after the scale-free comparison has decided the winner.
function scaledAverageVolts(values) {
  const average = rawAverage(values);

  if (average === null) {
    return null;
  }

  const scale = average > 1000 ? 100 : average > 100 ? 10 : 1;
  return average / scale;
}

/**
 * Choose between the ESC's voltage telemetry and the flight
 * controller's own pack reading.
 *
 * ESC voltage is preferred when it is the only usable source — but
 * when the flight controller ALSO measured the pack, the two must
 * agree. Some ESCs report voltage in units the generic scale rule
 * cannot know, and a cell count estimated from such a reading
 * invents a pack that does not exist. The FC's own ADC is the one
 * the pilot calibrates, so on real disagreement it wins — and the
 * returned note says so, for the story of whichever Lab asked.
 */
export function chooseVoltageSource(escVoltage, vbat) {
  const escUsable = hasUsablePositiveData(escVoltage);
  const vbatUsable = hasUsablePositiveData(vbat);

  if (escUsable && vbatUsable) {
    const disagreement = scaleFreeDisagreement(
      rawAverage(escVoltage),
      rawAverage(vbat)
    );

    if (disagreement !== null && disagreement > 0.08) {
      return {
        selected: vbat,
        note: `The ESC's voltage telemetry (reading ~${scaledAverageVolts(escVoltage)?.toFixed(1)} V) disagrees with the flight controller's pack measurement (~${scaledAverageVolts(vbat)?.toFixed(1)} V) — this assessment uses the flight controller's. If the FC's voltage calibration is off, correcting it there fixes both readings at once.`
      };
    }

    return { selected: escVoltage, note: null };
  }

  return {
    selected: escUsable ? escVoltage : vbat,
    note: null
  };
}

export function analyzeBatteryLab({
  timeSeconds,
  vbat,
  escVoltage,
  amperage,
  escCurrent,
  headspeed,
  governorTarget
}) {
  const { selected: selectedVoltage, note: voltageSourceNote } =
    chooseVoltageSource(escVoltage, vbat);

  const selectedAmperage =
    hasUsablePositiveData(escCurrent)
      ? escCurrent
      : amperage;
   if (
    !Array.isArray(selectedVoltage) ||
    selectedVoltage.length < 200
  ) {
    return null;
  }

    // The governor target refines the stable-phase search but is
    // not part of a battery assessment: pack voltage and current
    // are readable whether or not the model runs a Rotorflight
    // governor. Only the data this Lab reads may bound the count.
    const sampleCount = Math.min(
    timeSeconds?.length ?? 0,
    selectedVoltage.length,
    headspeed?.length ?? 0
  );

  if (sampleCount < 200) {
    return null;
  }

  const alignedTime =
    timeSeconds.slice(0, sampleCount);

    const alignedVbat =
    selectedVoltage.slice(0, sampleCount);

    const alignedAmperage =
    Array.isArray(selectedAmperage)
      ? selectedAmperage.slice(0, sampleCount)
      : null;

  const alignedHeadspeed =
    headspeed.slice(0, sampleCount);

  const alignedTarget =
    Array.isArray(governorTarget)
      ? governorTarget.slice(0, sampleCount)
      : [];

  const rawAverage = averageOf(alignedVbat);

  const voltsScale =
    rawAverage > 1000
      ? 100
      : rawAverage > 100
        ? 10
        : 1;

  const volts = alignedVbat.map(
    (value) => Number(value) / voltsScale
  );

  let maxRawAmperage = 0;

  if (alignedAmperage) {
    for (const value of alignedAmperage) {
      const numericValue = Number(value);

      if (
        Number.isFinite(numericValue) &&
        numericValue > maxRawAmperage
      ) {
        maxRawAmperage = numericValue;
      }
    }
  }

  const ampsScale =
    maxRawAmperage > 500 ? 100 : 1;

  const amps = alignedAmperage
    ? alignedAmperage.map(
        (value) => Number(value) / ampsScale
      )
    : null;

  const flightPhase = detectStableFlightPhase({
    timeSeconds: alignedTime,
    headspeed: alignedHeadspeed,
    governorTarget: alignedTarget
  });

  const stableIndexes =
    flightPhase.stableIndexes ?? [];

  if (stableIndexes.length < 100) {
    return {
      status: "insufficient",
      hasRotorSpeedData: flightPhase.hasRotorSpeedData !== false,
      story:
        flightPhase.hasRotorSpeedData === false
          ? "This log contains no rotor-speed data, so a steady-load section could not be identified for a battery assessment."
          : "No stable governed-flight section was long enough for a reliable battery assessment.",
      metrics: [
        {
          label: "Stable samples",
          value: String(stableIndexes.length)
        },
        {
          label: "Battery result",
          value: "Insufficient stable-flight data"
        }
      ],
      sagPercent: null,
      internalResistance: null,
      endVoltsPerCell: null,
      stableSampleCount: stableIndexes.length
    };
  }

  const stableVolts = stableIndexes
    .map((index) => volts[index])
    .filter(Number.isFinite);

  const firstStableIndexes =
    stableIndexes.slice(
      0,
      Math.min(1000, stableIndexes.length)
    );

  const lastStableIndexes =
    stableIndexes.slice(
      Math.max(0, stableIndexes.length - 1000)
    );

  const startVolts = averageOf(
    firstStableIndexes
      .map((index) => volts[index])
      .filter(Number.isFinite)
  );

  const endVolts = averageOf(
    lastStableIndexes
      .map((index) => volts[index])
      .filter(Number.isFinite)
  );

  const minVolts = minimumOf(stableVolts);

  if (
    !Number.isFinite(startVolts) ||
    !Number.isFinite(endVolts) ||
    !Number.isFinite(minVolts)
  ) {
    return null;
  }

  // Cell count estimate based on the beginning of the
  // valid governed-flight window.
  const cellCount = Math.max(
    1,
    Math.round(startVolts / 4.1)
  );

  const endPerCell =
    endVolts / cellCount;

  // The lowest voltage is read across the whole flight, not
  // only the stable phase. The deepest dips ride the hardest
  // load events, and those events pull the rotor off its
  // plateau — which drops them out of the stable set at
  // exactly the moment the pack is answering for itself.
  const flightMinVolts = (() => {
    const inFlightIndexes = detectInFlightSamples({
      timeSeconds: alignedTime,
      headspeed: alignedHeadspeed
    });

    if (!inFlightIndexes) {
      return minVolts;
    }

    let lowest = Infinity;
    let counted = 0;

    for (const index of inFlightIndexes) {
      const value = volts[index];

      if (Number.isFinite(value) && value > 0) {
        counted += 1;

        if (value < lowest) {
          lowest = value;
        }
      }
    }

    return counted >= 100 && lowest < Infinity
      ? Math.min(lowest, minVolts)
      : minVolts;
  })();

  const minimumPerCell =
    flightMinVolts / cellCount;

  const flightVoltageDropPercent =
    ((startVolts - endVolts) / startVolts) * 100;

  // ---- consumed capacity during stable flight only ----
  let consumedMah = null;

  if (
    amps &&
    amps.length === alignedTime.length
  ) {
    let ampSeconds = 0;

    for (
      let stablePosition = 1;
      stablePosition < stableIndexes.length;
      stablePosition += 1
    ) {
      const previousIndex =
        stableIndexes[stablePosition - 1];

      const currentIndex =
        stableIndexes[stablePosition];

      // Do not integrate across gaps between separate
      // stable-flight segments.
      if (currentIndex !== previousIndex + 1) {
        continue;
      }

      const dt =
        alignedTime[currentIndex] -
        alignedTime[previousIndex];

      const currentAmps =
        Number(amps[currentIndex]);

      const previousAmps =
        Number(amps[previousIndex]);

      if (
        Number.isFinite(dt) &&
        dt > 0 &&
        dt < 1 &&
        Number.isFinite(currentAmps) &&
        Number.isFinite(previousAmps)
      ) {
        const averageAmps =
          (currentAmps + previousAmps) / 2;

        ampSeconds += averageAmps * dt;
      }
    }

    consumedMah = Math.round(
      (ampSeconds / 3600) * 1000
    );
  }

  // ---- estimated internal resistance ----
  //
  // Only evaluate current steps that occur fully inside
  // stable flight. This avoids startup and transition sag.
  //
  // And only when voltage and current tell one story: when the
  // voltage cross-check had to override the ESC's reading, the
  // volts here come from the FC while the amps come from the ESC —
  // two sensors with different filtering, whose step response is
  // not an internal-resistance measurement. Better no estimate
  // than a trended wrong one.
  let internalResistancePerCell = null;

  if (
    amps &&
    amps.length === volts.length &&
    voltageSourceNote === null
  ) {
    const stableSet =
      new Set(stableIndexes);

    let best = null;

    for (
      let index = 50;
      index < amps.length;
      index += 1
    ) {
      if (
        !stableSet.has(index) ||
        !stableSet.has(index - 50)
      ) {
        continue;
      }

      const deltaAmps =
        amps[index] - amps[index - 50];

      if (deltaAmps > 15) {
        const deltaVolts =
          volts[index - 50] - volts[index];

        if (deltaVolts > 0) {
          const packResistance =
            deltaVolts / deltaAmps;

          if (
            best === null ||
            packResistance < best
          ) {
            best = packResistance;
          }
        }
      }
    }

    if (best !== null) {
      internalResistancePerCell =
        (best / cellCount) * 1000;
    }
  }

  // Do not diagnose pack age or condition from ordinary
  // discharge alone. A brief loaded dip is evidence to
  // review, not proof that a pack is tired.
  const status =
    minimumPerCell < 3.45
      ? "attention"
      : minimumPerCell < 3.6
        ? "watch"
        : "good";

  const story =
    status === "good"
      ? `Pack voltage remained within the normal reviewed range during stable flight. It began the analyzed window near ${startVolts.toFixed(
          1
        )} V and ended near ${endVolts.toFixed(
          1
        )} V. Lowest in-flight voltage was ${flightMinVolts.toFixed(
          1
        )} V (${minimumPerCell.toFixed(
          2
        )} V per cell). No clear evidence of a weak or tired pack.`
      : status === "watch"
        ? `The lowest in-flight voltage was ${flightMinVolts.toFixed(
            1
          )} V (${minimumPerCell.toFixed(
            2
          )} V per cell). Review the matching current and throttle event, but this dip alone does not prove the pack is tired.`
        : `In-flight voltage reached ${flightMinVolts.toFixed(
            1
          )} V (${minimumPerCell.toFixed(
            2
          )} V per cell). Review pack condition, connectors and load before another hard flight.`;

  const metrics = [
    {
      label: "Pack (detected)",
      value: `${cellCount}S (est.)`
    },
    {
      label: "Stable-flight start → end",
      value: `${startVolts.toFixed(
        1
      )} → ${endVolts.toFixed(1)} V (est.)`
    },
    {
      label: "Lowest in-flight voltage",
      value: `${flightMinVolts.toFixed(
        1
      )} V (${minimumPerCell.toFixed(
        2
      )} V/cell)`
    },
    {
      label: "Stable samples used",
      value: stableIndexes.length.toLocaleString()
    }
  ];

  if (
    Number.isFinite(consumedMah) &&
    consumedMah > 0
  ) {
    metrics.push({
      label: "Stable-flight consumption",
      value: `~${consumedMah} mAh (est.)`
    });
  }

  if (
    Number.isFinite(internalResistancePerCell)
  ) {
    metrics.push({
      label: "Internal resistance",
      value: `~${internalResistancePerCell.toFixed(
        1
      )} mΩ/cell (est.)`
    });
  }

  return {
    status,
    story: voltageSourceNote
      ? `${story} ${voltageSourceNote}`
      : story,
    metrics,

    sagPercent:
      Math.round(
        flightVoltageDropPercent * 100
      ) / 100,

    internalResistance:
      Number.isFinite(
        internalResistancePerCell
      )
        ? Math.round(
            internalResistancePerCell * 10
          ) / 10
        : null,

    endVoltsPerCell:
      Math.round(endPerCell * 100) / 100,

    minimumVoltsPerCell:
      Math.round(
        minimumPerCell * 100
      ) / 100,

    stableSampleCount:
      stableIndexes.length
  };
}