// ======================================================
// BLACKBOX LAB — PRECOMP ANALYSIS
// ======================================================
//
// Precompensation is the feedforward that anticipates what a
// collective move will do to everything else: the governor's
// collective precomp anticipates the load change, the tail's
// collective feedforward anticipates the torque change. Neither
// is logged as a series — what IS logged is how well the
// anticipation worked. This module reads exactly that:
//
//   · governor balance — during fast collective RISES, does the
//     rotor droop? During fast DROPS, does it overspeed? The
//     ratio of the two says whether the precomp is running
//     behind the load, ahead of it, or on it.
//   · tail balance — does the yaw axis get kicked when the
//     collective moves? A tail that only misbehaves during
//     collective transients is a precomp story, not a PID one.
//
// Directions here are physics, not guesses: droop on rises with
// clean drops = anticipation too weak; overspeed on drops with
// clean rises = too strong; both = the governor is late both
// ways. The tail's SIGN, by contrast, depends on rotor rotation
// direction, which a log does not state — so the tail read
// reports coupling strength and leaves the sign to the pilot.
//
// ======================================================

import {
  buildRollingMean,
  estimateSampleRate,
  detectInFlightSamples
} from "./flightPhase.js";

// Fleet-validated 2026-08-12 (247 contributed flights, 134 with a
// governor target and enough collective activity to read): the
// transient detector finds a median of 50 collective moves per real
// flight, and at these thresholds the fleet reads 81% balanced /
// 7% low / 7% high / 4% lagging — the balance verdicts are rare,
// deliberate calls, not the formula describing itself. Tail
// coupling fires on 4% of flights with yaw telemetry.
export const PRECOMP_TUNING = {
  // A "fast" collective move covers this fraction of the flight's
  // own collective range within one second.
  COLLECTIVE_RATE_PER_SECOND: 1.0,
  TRANSIENT_WINDOW_SECONDS: 0.6,
  TRANSIENT_GAP_SECONDS: 0.4,
  MINIMUM_TRANSIENTS_PER_SIDE: 3,
  // Governor balance: a side is DOMINANT when its median transient
  // error clears this floor and doubles the other side.
  GOVERNOR_NOTICE_PERCENT: 2.5,
  GOVERNOR_DOMINANCE_RATIO: 2,
  // Tail: transient yaw error vs the flight's own baseline.
  TAIL_KICK_RATIO: 3,
  TAIL_MINIMUM_ERROR: 25,
  TAIL_CONSISTENCY: 0.7
};

function medianOf(values) {
  const usable = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return usable.length
    ? usable[Math.floor(usable.length / 2)]
    : null;
}

// Fast collective moves, scale-free: the flight's own collective
// range defines what "fast" means. Returns windows that never
// overlap — a pump is one transient per direction, not five.
export function findCollectiveTransients({
  timeSeconds,
  collective,
  inFlight,
  tuning = PRECOMP_TUNING
}) {
  if (!Array.isArray(collective) || collective.length < 100) {
    return [];
  }

  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const rateWindow = Math.max(2, Math.round(sampleRate * 0.1));
  const smoothed = buildRollingMean(collective, rateWindow);

  let minimum = null;
  let maximum = null;

  for (const index of inFlight) {
    const value = smoothed[index];
    if (!Number.isFinite(value)) continue;
    if (minimum === null || value < minimum) minimum = value;
    if (maximum === null || value > maximum) maximum = value;
  }

  if (minimum === null || maximum <= minimum) {
    return [];
  }

  const range = maximum - minimum;
  const rateThreshold =
    range * tuning.COLLECTIVE_RATE_PER_SECOND;

  const windowSamples = Math.round(
    sampleRate * tuning.TRANSIENT_WINDOW_SECONDS
  );
  const gapSamples = Math.round(
    sampleRate * tuning.TRANSIENT_GAP_SECONDS
  );

  const inFlightSet = inFlight instanceof Set ? inFlight : new Set(inFlight);
  const transients = [];
  let blockedUntil = -1;

  for (let index = 1; index < smoothed.length; index += 1) {
    if (index <= blockedUntil || !inFlightSet.has(index)) {
      continue;
    }

    const current = smoothed[index];
    const previous = smoothed[index - 1];
    const dt =
      Number(timeSeconds[index]) - Number(timeSeconds[index - 1]);

    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      !Number.isFinite(dt) ||
      dt <= 0
    ) {
      continue;
    }

    const rate = (current - previous) / dt;

    if (Math.abs(rate) >= rateThreshold) {
      transients.push({
        startIndex: index,
        endIndex: Math.min(
          smoothed.length - 1,
          index + windowSamples
        ),
        direction: rate > 0 ? "rise" : "drop"
      });

      blockedUntil = index + windowSamples + gapSamples;
    }
  }

  return transients;
}

function peakInWindow(values, startIndex, endIndex, sign) {
  let peak = null;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = values[index];

    if (!Number.isFinite(value)) continue;

    const oriented = sign === "negative" ? -value : value;

    if (peak === null || oriented > peak) {
      peak = oriented;
    }
  }

  return peak;
}

/**
 * Read the precomp balance of a flight. All arrays are
 * row-aligned with the flight timeline. Yaw inputs are optional —
 * the tail read simply stays null without them, and the governor
 * read stays null without a usable target.
 */
export function analyzePrecomp({
  timeSeconds,
  headspeed,
  governorTarget = null,
  collective = null,
  yawSetpoint = null,
  yawGyro = null,
  tuning = PRECOMP_TUNING
} = {}) {
  if (
    !Array.isArray(timeSeconds) ||
    !Array.isArray(headspeed) ||
    headspeed.length < 100 ||
    !Array.isArray(collective)
  ) {
    return null;
  }

  const inFlightIndexes = detectInFlightSamples({
    timeSeconds,
    headspeed
  });

  if (!inFlightIndexes) {
    return null;
  }

  const transients = findCollectiveTransients({
    timeSeconds,
    collective,
    inFlight: inFlightIndexes,
    tuning
  });

  const rises = transients.filter((t) => t.direction === "rise");
  const drops = transients.filter((t) => t.direction === "drop");

  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const errorWindow = Math.max(3, Math.round(sampleRate * 0.25));

  // ---- governor balance ----
  const governor = (() => {
    const hasTarget =
      Array.isArray(governorTarget) &&
      governorTarget.some((value) => Number(value) > 300);

    if (!hasTarget) {
      return null;
    }

    if (
      rises.length < tuning.MINIMUM_TRANSIENTS_PER_SIDE ||
      drops.length < tuning.MINIMUM_TRANSIENTS_PER_SIDE
    ) {
      return {
        balance: null,
        riseDroopPercent: null,
        dropOvershootPercent: null,
        riseCount: rises.length,
        dropCount: drops.length,
        story:
          "Not enough fast collective moves in both directions to read the governor's precomp balance — it needs a few honest pumps each way."
      };
    }

    const errorPercent = headspeed.map((actual, index) => {
      const target = Number(governorTarget[index]);
      const value = Number(actual);

      return Number.isFinite(value) &&
        Number.isFinite(target) &&
        target > 300
        ? ((target - value) / target) * 100
        : null;
    });

    const smoothedError = buildRollingMean(
      errorPercent,
      errorWindow
    );

    // Droop is positive error; overshoot is negative. Each side is
    // read in its own natural direction.
    const riseDroopPercent = medianOf(
      rises.map((t) =>
        peakInWindow(smoothedError, t.startIndex, t.endIndex, "positive")
      )
    );

    const dropOvershootPercent = medianOf(
      drops.map((t) =>
        peakInWindow(smoothedError, t.startIndex, t.endIndex, "negative")
      )
    );

    const riseNoticeable =
      Number.isFinite(riseDroopPercent) &&
      riseDroopPercent >= tuning.GOVERNOR_NOTICE_PERCENT;

    const dropNoticeable =
      Number.isFinite(dropOvershootPercent) &&
      dropOvershootPercent >= tuning.GOVERNOR_NOTICE_PERCENT;

    const riseDominant =
      riseNoticeable &&
      (!dropNoticeable ||
        riseDroopPercent >=
          dropOvershootPercent * tuning.GOVERNOR_DOMINANCE_RATIO);

    const dropDominant =
      dropNoticeable &&
      (!riseNoticeable ||
        dropOvershootPercent >=
          riseDroopPercent * tuning.GOVERNOR_DOMINANCE_RATIO);

    const balance = riseDominant
      ? "low"
      : dropDominant
        ? "high"
        : riseNoticeable && dropNoticeable
          ? "lagging"
          : "balanced";

    const story =
      balance === "low"
        ? `Collective rises pull the rotor ${riseDroopPercent.toFixed(1)}% under target while drops stay clean — the governor's anticipation of load is running behind. More collective precomp asks for the power before the load arrives.`
        : balance === "high"
          ? `Collective drops push the rotor ${dropOvershootPercent.toFixed(1)}% over target while rises stay clean — the governor keeps feeding power the load no longer needs. Less collective precomp, or more governor damping, absorbs it.`
          : balance === "lagging"
            ? `The rotor misses its target both ways around collective moves (droop ${riseDroopPercent.toFixed(1)}% on rises, overspeed ${dropOvershootPercent.toFixed(1)}% on drops) — the governor is late in both directions, which reads as a response-speed story before a precomp one.`
            : "Fast collective moves barely disturb the headspeed in either direction — the governor's precomp is doing its job.";

    return {
      balance,
      riseDroopPercent:
        Number.isFinite(riseDroopPercent)
          ? Math.round(riseDroopPercent * 100) / 100
          : null,
      dropOvershootPercent:
        Number.isFinite(dropOvershootPercent)
          ? Math.round(dropOvershootPercent * 100) / 100
          : null,
      riseCount: rises.length,
      dropCount: drops.length,
      story
    };
  })();

  // ---- tail balance ----
  const tail = (() => {
    if (
      !Array.isArray(yawSetpoint) ||
      !Array.isArray(yawGyro) ||
      yawSetpoint.length === 0 ||
      yawGyro.length === 0
    ) {
      return null;
    }

    if (transients.length < tuning.MINIMUM_TRANSIENTS_PER_SIDE) {
      return {
        balance: null,
        kickRatio: null,
        story:
          "Not enough fast collective moves to read the tail's precomp coupling."
      };
    }

    const yawError = yawGyro.map((gyro, index) => {
      const setpoint = Number(yawSetpoint[index]);
      const value = Number(gyro);

      return Number.isFinite(value) && Number.isFinite(setpoint)
        ? value - setpoint
        : null;
    });

    const smoothedYawError = buildRollingMean(
      yawError,
      Math.max(2, Math.round(sampleRate * 0.05))
    );

    const baseline = medianOf(
      inFlightIndexes.map((index) => {
        const value = smoothedYawError[index];
        return Number.isFinite(value) ? Math.abs(value) : null;
      })
    );

    // The kick each transient produced, signed relative to the
    // collective direction: consistent sign = mechanical coupling,
    // random sign = ordinary turbulence.
    const kicks = transients.map((t) => {
      let extreme = null;

      for (let index = t.startIndex; index <= t.endIndex; index += 1) {
        const value = smoothedYawError[index];

        if (!Number.isFinite(value)) continue;

        if (extreme === null || Math.abs(value) > Math.abs(extreme)) {
          extreme = value;
        }
      }

      if (extreme === null) {
        return null;
      }

      return {
        magnitude: Math.abs(extreme),
        // Relative sign: does the kick point the same way whenever
        // the collective moves the same way?
        orientedSign:
          (extreme > 0 ? 1 : -1) *
          (t.direction === "rise" ? 1 : -1)
      };
    }).filter(Boolean);

    if (kicks.length < tuning.MINIMUM_TRANSIENTS_PER_SIDE) {
      return {
        balance: null,
        kickRatio: null,
        story:
          "Not enough measurable yaw responses around collective moves to read the tail coupling."
      };
    }

    const transientError = medianOf(
      kicks.map((kick) => kick.magnitude)
    );

    const sameSignCount = Math.max(
      kicks.filter((kick) => kick.orientedSign > 0).length,
      kicks.filter((kick) => kick.orientedSign < 0).length
    );

    const consistency = sameSignCount / kicks.length;

    // A floor of 1 deg/s on the baseline: an exceptionally calm
    // tail must read as MORE coupled when kicked, not divide the
    // ratio by nothing.
    const kickRatio = Number.isFinite(baseline)
      ? transientError / Math.max(baseline, 1)
      : null;

    const coupled =
      Number.isFinite(kickRatio) &&
      kickRatio >= tuning.TAIL_KICK_RATIO &&
      transientError >= tuning.TAIL_MINIMUM_ERROR &&
      consistency >= tuning.TAIL_CONSISTENCY;

    const story = coupled
      ? `Collective moves kick the tail ${kickRatio.toFixed(1)}× harder than its ordinary error (median ${Math.round(transientError)} deg/s, ${Math.round(consistency * 100)}% in a consistent direction) — a torque-anticipation story: the collective feedforward into yaw is not matching the torque change. Which way to move it depends on your rotation direction — step once, and if the kick grows, go the other way.`
      : "The tail holds its own during collective moves — no precomp coupling worth chasing.";

    return {
      balance: coupled ? "coupled" : "balanced",
      kickRatio:
        Number.isFinite(kickRatio)
          ? Math.round(kickRatio * 10) / 10
          : null,
      baselineError:
        Number.isFinite(baseline)
          ? Math.round(baseline * 10) / 10
          : null,
      transientError:
        Number.isFinite(transientError)
          ? Math.round(transientError * 10) / 10
          : null,
      consistency:
        Math.round(consistency * 100) / 100,
      kickCount: kicks.length,
      story
    };
  })();

  return {
    transientCount: transients.length,
    riseCount: rises.length,
    dropCount: drops.length,
    governor,
    tail
  };
}
