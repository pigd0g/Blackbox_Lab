// ======================================================
// BLACKBOX LAB — GOVERNOR LAB ANALYSIS
// ======================================================
//
// Charts may show the complete recording.
//
// Governor scoring uses only stable governed-flight
// samples detected by the shared flight-phase module.
// Spool-up, spool-down and headspeed transitions are
// excluded from the calculations.
//
// ======================================================

import {
  detectStableFlightPhase,
  detectInFlightSamples,
  buildRollingMean,
  estimateSampleRate
} from "./flightPhase.js";

export function analyzeGovernorLab({
  timeSeconds,
  headspeed,
  governorTarget,
  motorOutput = null,
  activity = []
}) {
  if (
    !Array.isArray(timeSeconds) ||
    !Array.isArray(headspeed) ||
    headspeed.length < 100
  ) {
    return null;
  }

  // A model on an ESC or external governor logs rotor speed with
  // no target to compare it against. That is not "no result" —
  // the rotor still answers for how steadily it held. With no
  // stated target the reference is the headspeed's own slow
  // trend: deviation from it is short-term instability, while
  // deliberate throttle-curve changes move the trend itself and
  // are not charged against the hold.
  const hasUsableTarget =
    Array.isArray(governorTarget) &&
    governorTarget.some((value) => Number(value) > 300);

  if (!hasUsableTarget) {
    return analyzeHeadspeedHold({ timeSeconds, headspeed });
  }
  const flightPhase = detectStableFlightPhase({
    timeSeconds,
    headspeed,
    governorTarget,
    activity
  });

  const stableIndexes = flightPhase.stableIndexes;

  if (
    !Array.isArray(stableIndexes) ||
    stableIndexes.length < 100
  ) {
    return {
      score: null,
      status: "insufficient",
      hasRotorSpeedData: flightPhase.hasRotorSpeedData !== false,
      movedDuringRecording:
        flightPhase.movedDuringRecording ?? null,
      story:
        flightPhase.movedDuringRecording === false
          ? "The airframe did not move during this recording, and no rotor speed was logged, so there is no flight to assess."
          : flightPhase.hasRotorSpeedData === false
            ? "This log contains no rotor-speed data, so governor behaviour cannot be assessed. Governor scoring needs an RPM sensor feeding headspeed."
            : "No stable governed-flight section was long enough for a reliable governor assessment.",
      droopRpm: null,
      droopPercent: null,
      droopTimeSeconds: null,
      averageHeadspeed: null,
      stableSampleCount:
        flightPhase.stableSampleCount ?? 0,
      stableSegments:
        flightPhase.segments ?? [],
      metrics: [
        {
          label: "Stable samples",
          value: String(
            flightPhase.stableSampleCount ?? 0
          )
        },
        {
          label: "Governor result",
          value: "Insufficient stable-flight data"
        }
      ]
    };
  }

  // A dip only means something when it lasts. A single sample of
  // target−actual at full logging rate is sensor noise wearing a
  // governor's clothes, so the droop that drives the verdict is
  // the tracking error smoothed over a quarter second. The error
  // is smoothed on the real timeline (never across the compacted
  // stable set, which would blend separate segments), then read
  // at the stable samples.
  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const droopWindow = Math.max(3, Math.round(sampleRate * 0.25));

  const rawDroop = new Array(headspeed.length).fill(null);

  for (let index = 0; index < headspeed.length; index += 1) {
    const actual = Number(headspeed[index]);
    const target = Number(governorTarget[index]);

    if (
      Number.isFinite(actual) &&
      Number.isFinite(target) &&
      target > 0
    ) {
      rawDroop[index] = target - actual;
    }
  }

  const smoothedDroop = buildRollingMean(rawDroop, droopWindow);

  let targetSum = 0;
  let actualSum = 0;
  let maximumDroop = 0;
  let peakSampleDroop = 0;
  let droopTime = null;
  let squaredErrorSum = 0;
  let validSampleCount = 0;

  for (const index of stableIndexes) {
    const actual = Number(headspeed[index]);
    const target = Number(governorTarget[index]);
    const time = Number(timeSeconds[index]);

    if (
      !Number.isFinite(actual) ||
      !Number.isFinite(target) ||
      target <= 0
    ) {
      continue;
    }

    targetSum += target;
    actualSum += actual;

    const trackingError = target - actual;
    squaredErrorSum += trackingError * trackingError;

    if (trackingError > peakSampleDroop) {
      peakSampleDroop = trackingError;
    }

    const sustained = smoothedDroop[index];

    if (
      Number.isFinite(sustained) &&
      sustained > maximumDroop
    ) {
      maximumDroop = sustained;
      droopTime =
        Number.isFinite(time) ? time : null;
    }

    validSampleCount += 1;
  }

  if (validSampleCount < 100) {
    return null;
  }

  // The whole-flight sustained dip. Hard load events pull the
  // rotor off its plateau and out of the stable set, so the
  // deepest sustained droop of the flight is read across every
  // in-flight sample — with the motor output at that moment,
  // because "governor gain" and "no power left" are different
  // diagnoses of the same dip.
  const flightDip = (() => {
    const inFlightIndexes = detectInFlightSamples({
      timeSeconds,
      headspeed
    });

    if (!inFlightIndexes) {
      return null;
    }

    let deepest = 0;
    let deepestIndex = null;

    for (const index of inFlightIndexes) {
      const sustained = smoothedDroop[index];
      const target = Number(governorTarget[index]);

      if (
        Number.isFinite(sustained) &&
        Number.isFinite(target) &&
        target > 300 &&
        sustained > deepest
      ) {
        deepest = sustained;
        deepestIndex = index;
      }
    }

    if (deepestIndex === null) {
      return null;
    }

    let outputPercent = null;

    if (Array.isArray(motorOutput)) {
      let outputMax = 0;

      for (const value of motorOutput) {
        const numericValue = Number(value);

        if (
          Number.isFinite(numericValue) &&
          numericValue > outputMax
        ) {
          outputMax = numericValue;
        }
      }

      const fullScale =
        outputMax > 1100 ? 2000 : outputMax > 100 ? 1000 : 100;

      const atDip = Number(motorOutput[deepestIndex]);

      if (Number.isFinite(atDip) && outputMax > 0) {
        outputPercent = (atDip / fullScale) * 100;
      }
    }

    const target = Number(governorTarget[deepestIndex]);

    return {
      droopRpm: deepest,
      droopPercent:
        target > 0 ? (deepest / target) * 100 : null,
      timeSeconds: Number(timeSeconds[deepestIndex]),
      outputPercent
    };
  })();

  const averageTarget =
    targetSum / validSampleCount;

  const averageActual =
    actualSum / validSampleCount;

  const rmsError = Math.sqrt(
    squaredErrorSum / validSampleCount
  );

  const droopPercent =
    averageTarget > 0
      ? (maximumDroop / averageTarget) * 100
      : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          droopPercent * 12 -
          rmsError * 0.5
      )
    )
  );

  // A deep sustained dip under load anywhere in the flight
  // outranks the stable-phase reading: that is the machine
  // genuinely failing to hold headspeed, whatever the calm
  // sections say.
  const flightDipSevere =
    flightDip &&
    Number.isFinite(flightDip.droopPercent) &&
    flightDip.droopPercent > 8;

  const status = flightDipSevere
    ? "attention"
    : droopPercent > 3
      ? "attention"
      : droopPercent > 1.2
        ? "watch"
        : "good";

  const droopTimeText =
    Number.isFinite(droopTime)
      ? ` at ${droopTime.toFixed(1)} s`
      : "";

  const flightDipText = flightDipSevere
    ? ` Under load the rotor fell ${Math.round(
        flightDip.droopRpm
      )} rpm below target (${flightDip.droopPercent.toFixed(
        1
      )}%) at ${flightDip.timeSeconds.toFixed(1)} s${
        Number.isFinite(flightDip.outputPercent)
          ? `, with the motor output at ${Math.round(
              flightDip.outputPercent
            )}%`
          : ""
      }.${
        Number.isFinite(flightDip.outputPercent) &&
        flightDip.outputPercent >= 95
          ? " The output was already at its ceiling — that dip is a power-system limit, not a governor-gain problem. See the ESC Lab."
          : " Review the worst-droop event before changing governor gain."
      }`
    : "";

  const story =
    (status === "good"
      ? `Excellent hold: average headspeed ${Math.round(
          averageActual
        )} rpm against a ${Math.round(
          averageTarget
        )} rpm target. Largest sustained dip was ${Math.round(
          maximumDroop
        )} rpm.`
      : status === "watch"
        ? `The largest sustained dip in stable flight was ${Math.round(
            maximumDroop
          )} rpm (${droopPercent.toFixed(
            1
          )}%)${droopTimeText}. Review the chart before changing governor settings.`
        : flightDipSevere
          ? `Stable flight held to a ${Math.round(
              maximumDroop
            )} rpm sustained dip (${droopPercent.toFixed(1)}%).`
          : `The largest sustained dip in stable flight was ${Math.round(
              maximumDroop
            )} rpm (${droopPercent.toFixed(
              1
            )}%)${droopTimeText}. Confirm that this occurred during a real airborne load event before changing governor gain.`) +
    flightDipText;

  return {
    score,
    status,
    story,

    droopRpm:
      Math.round(maximumDroop * 10) / 10,

    droopPercent:
      Math.round(droopPercent * 100) / 100,

    peakSampleDroopRpm:
      Math.round(peakSampleDroop * 10) / 10,

    droopTimeSeconds: flightDipSevere
      ? Math.round(flightDip.timeSeconds * 100) / 100
      : Number.isFinite(droopTime)
        ? Math.round(droopTime * 100) / 100
        : null,

    flightDroopRpm: flightDip
      ? Math.round(flightDip.droopRpm * 10) / 10
      : null,

    flightDroopPercent:
      flightDip && Number.isFinite(flightDip.droopPercent)
        ? Math.round(flightDip.droopPercent * 100) / 100
        : null,

    flightDroopOutputPercent:
      flightDip && Number.isFinite(flightDip.outputPercent)
        ? Math.round(flightDip.outputPercent * 10) / 10
        : null,

    averageHeadspeed:
      Math.round(averageActual),

    stableSampleCount: validSampleCount,

    stableSegments:
      flightPhase.segments ?? [],

    metrics: [
      {
        label: "Average headspeed",
        value: `${Math.round(averageActual)} rpm`
      },
      {
        label: "Target",
        value: `${Math.round(averageTarget)} rpm`
      },
      {
        label: "Largest sustained dip (stable flight)",
        value: `${Math.round(
          maximumDroop
        )} rpm (${droopPercent.toFixed(1)}%)`
      },
      ...(flightDip
        ? [
            {
              label: "Largest sustained dip (whole flight)",
              value: `${Math.round(flightDip.droopRpm)} rpm${
                Number.isFinite(flightDip.outputPercent)
                  ? ` @ ${Math.round(
                      flightDip.outputPercent
                    )}% output`
                  : ""
              }`
            }
          ]
        : []),
      {
        label: "RMS tracking error",
        value: `${rmsError.toFixed(1)} rpm`
      },
      {
        label: "Stable samples used",
        value: validSampleCount.toLocaleString()
      }
    ]
  };
}
// ------------------------------------------------------
// analyzeHeadspeedHold — the rotor story for models that
// state no governor target.
//
// The reference is the headspeed's own 2-second trend.
// Short-term deviation from it (quarter-second smoothed)
// is instability the pilot feels; slow changes are the
// throttle curve doing its job and stay out of the
// verdict. Without a stated target this never claims
// more than "worth a look" — there is no contract to
// hold the rotor to, only its own steadiness.
// ------------------------------------------------------
function analyzeHeadspeedHold({ timeSeconds, headspeed }) {
  const inFlightIndexes = detectInFlightSamples({
    timeSeconds,
    headspeed
  });

  if (!inFlightIndexes) {
    return {
      score: null,
      status: "insufficient",
      mode: "headspeed-hold",
      hasRotorSpeedData: false,
      movedDuringRecording: null,
      story:
        "This log states no governor target and records no usable rotor speed, so rotor-speed hold cannot be assessed.",
      droopRpm: null,
      droopPercent: null,
      droopTimeSeconds: null,
      averageHeadspeed: null,
      stableSampleCount: 0,
      stableSegments: [],
      metrics: []
    };
  }

  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const trend = buildRollingMean(
    headspeed,
    Math.max(5, Math.round(sampleRate * 2))
  );
  const shortTerm = buildRollingMean(
    headspeed,
    Math.max(3, Math.round(sampleRate * 0.25))
  );

  let meanSum = 0;
  let meanCount = 0;
  let worstDeviation = 0;
  let worstTime = null;

  for (const index of inFlightIndexes) {
    const actual = Number(headspeed[index]);

    if (Number.isFinite(actual)) {
      meanSum += actual;
      meanCount += 1;
    }

    const deviation =
      Number.isFinite(shortTerm[index]) &&
      Number.isFinite(trend[index])
        ? Math.abs(shortTerm[index] - trend[index])
        : null;

    if (
      Number.isFinite(deviation) &&
      deviation > worstDeviation
    ) {
      worstDeviation = deviation;
      worstTime = Number(timeSeconds[index]);
    }
  }

  if (meanCount < 100) {
    return null;
  }

  const meanRpm = meanSum / meanCount;
  const deviationPercent =
    meanRpm > 0 ? (worstDeviation / meanRpm) * 100 : 0;

  // Never "attention" without a stated target: there is no
  // contract being broken, only steadiness worth reviewing.
  const status = deviationPercent > 3 ? "watch" : "good";

  const story =
    status === "good"
      ? `No governor target is logged, so hold is judged against the rotor's own trend: headspeed averaged ${Math.round(
          meanRpm
        )} rpm and stayed within ${Math.round(
          worstDeviation
        )} rpm (${deviationPercent.toFixed(
          1
        )}%) of it. Deliberate headspeed changes are not counted against this.`
      : `No governor target is logged, so hold is judged against the rotor's own trend: headspeed averaged ${Math.round(
          meanRpm
        )} rpm, with a largest short-term swing of ${Math.round(
          worstDeviation
        )} rpm (${deviationPercent.toFixed(1)}%)${
          Number.isFinite(worstTime)
            ? ` at ${worstTime.toFixed(1)} s`
            : ""
        }. Worth a look at that moment on the chart.`;

  return {
    score: null,
    status,
    mode: "headspeed-hold",
    hasRotorSpeedData: true,
    story,
    droopRpm: Math.round(worstDeviation * 10) / 10,
    droopPercent:
      Math.round(deviationPercent * 100) / 100,
    droopTimeSeconds:
      Number.isFinite(worstTime)
        ? Math.round(worstTime * 100) / 100
        : null,
    averageHeadspeed: Math.round(meanRpm),
    stableSampleCount: meanCount,
    stableSegments: [],
    metrics: [
      {
        label: "Average headspeed",
        value: `${Math.round(meanRpm)} rpm`
      },
      {
        label: "Governor target",
        value: "not logged"
      },
      {
        label: "Largest short-term swing",
        value: `${Math.round(
          worstDeviation
        )} rpm (${deviationPercent.toFixed(1)}%)`
      },
      {
        label: "In-flight samples used",
        value: meanCount.toLocaleString()
      }
    ]
  };
}
