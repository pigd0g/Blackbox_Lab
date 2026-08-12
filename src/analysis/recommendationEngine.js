// ======================================================
// BLACKBOX LAB — RECOMMENDATION ENGINE
// ======================================================
//
// The layer that turns findings into "where to start":
// one recommendation object per pattern, carrying its own
// evidence, its confidence, and — only above the gate — a
// directional suggestion.
//
// House rules, non-negotiable:
//   · Blackbox Lab NEVER changes settings; it recommends
//     and explains, the pilot decides.
//   · A directional suggestion needs HIGH confidence, a
//     pattern of at least MINIMUM_EVENTS comparable events,
//     and no conflicting higher-priority finding. Below the
//     gate the same object renders as a "review" finding —
//     one schema, both moods, no second code path to drift.
//   · One suggestion names ONE setting family and a
//     direction with a magnitude CLASS, never a number —
//     numbers depend on craft and firmware defaults a log
//     cannot fully know.
//   · Workflow order is enforced: an open vibration/filter
//     concern silences PID suggestions (filters come before
//     PIDs), and a power-limit event silences governor
//     suggestions (hardware before tune).
//   · Every suggestion ends with its verify plan: change
//     the one thing, fly again, let Compare Flights and the
//     named metric be the judge.
//
// ======================================================

import { commandEvidenceConfidence } from "./pidAnalysis.js";

export const RECOMMENDATION_GATE = {
  MINIMUM_EVENTS: 2,
  SLOW_SETTLING_MS: 500,
  HUNTING_MINIMUM_CROSSINGS: 3,
  // Governor excursions are fleet-rare by calibration (median
  // machine: zero), so three same-cause excursions in ONE flight
  // is already a strong pattern.
  GOVERNOR_HIGH_CONFIDENCE_EVENTS: 3
};

function sampleSpacingMs(timeSeconds) {
  if (!Array.isArray(timeSeconds) || timeSeconds.length < 2) {
    return null;
  }

  const spacing =
    (timeSeconds[timeSeconds.length - 1] - timeSeconds[0]) /
    (timeSeconds.length - 1);

  return Number.isFinite(spacing) && spacing > 0
    ? spacing * 1000
    : null;
}

// The Rotorflight CLI family a suggestion points at, per axis.
const AXIS_SETTING_FAMILY = {
  Roll: { damping: "roll_d_gain", drive: "roll_f_gain" },
  Pitch: { damping: "pitch_d_gain", drive: "pitch_f_gain" },
  Yaw: { damping: "yaw_d_gain", drive: "yaw_f_gain" }
};

/**
 * Build the flight's recommendations from what the analyses
 * already measured. Everything here READS structured results —
 * nothing is re-measured, so a recommendation can never disagree
 * with the finding it cites.
 *
 * @param {object} options {
 *     trackingAnalysis,   // pidAnalysis.detectedColumns.trackingAnalysis
 *     commandBalanceReviewAxes, // pidAnalysis.technicalSummary
 *     timeSeconds,        // flight timeline (for ms conversion)
 *     governorEvents,     // detectGovernorEvents result or null
 *     vibrationConcern,   // boolean: open vibration/filter finding
 *   }
 * Returns { pid: [...], governor: [...] } — each entry a
 * recommendation object; empty arrays when there is nothing to say.
 */
export function buildRecommendations({
  trackingAnalysis = null,
  commandBalanceReviewAxes = [],
  timeSeconds = null,
  governorEvents = null,
  vibrationConcern = false
} = {}) {
  return {
    pid: buildPidRecommendations({
      trackingAnalysis,
      commandBalanceReviewAxes,
      timeSeconds,
      vibrationConcern
    }),
    governor: buildGovernorRecommendations({ governorEvents })
  };
}

function buildPidRecommendations({
  trackingAnalysis,
  commandBalanceReviewAxes,
  timeSeconds,
  vibrationConcern
}) {
  const perAxis = trackingAnalysis?.commandEvents ?? [];
  const dtMs = sampleSpacingMs(timeSeconds);
  const gate = RECOMMENDATION_GATE;
  const recommendations = [];

  for (const axisResult of perAxis) {
    const axis = axisResult?.axis;
    const events = Array.isArray(axisResult?.events)
      ? axisResult.events
      : [];

    if (!axis || !AXIS_SETTING_FAMILY[axis]) {
      continue;
    }

    const cleanResponses = events.filter((event) =>
      Number.isFinite(event.responsePeak)
    );

    const confidence = commandEvidenceConfidence(
      cleanResponses.length
    );

    const slowEvents = cleanResponses.filter(
      (event) =>
        event.settlingDetected &&
        Number.isFinite(event.settlingDurationSamples) &&
        Number.isFinite(dtMs) &&
        event.settlingDurationSamples * dtMs >
          gate.SLOW_SETTLING_MS
    );

    if (slowEvents.length < gate.MINIMUM_EVENTS) {
      continue;
    }

    const huntingSlow = slowEvents.filter(
      (event) =>
        Number.isFinite(event.ringingTargetCrossingCount) &&
        event.ringingTargetCrossingCount >=
          gate.HUNTING_MINIMUM_CROSSINGS
    );

    const huntingMajority =
      huntingSlow.length * 2 > slowEvents.length;

    const driveSide =
      !huntingMajority &&
      commandBalanceReviewAxes.includes(axis);

    const finding =
      `${axis} reached its target but settled slowly on ` +
      `${slowEvents.length} of ${cleanResponses.length} measured commands` +
      (huntingMajority
        ? ", circling the setpoint before coming to rest"
        : "") +
      ".";

    const evidence = slowEvents.slice(0, 6).map((event) => ({
      kind: "command-event",
      axis,
      rowIndex: event.sampleRowIndex ?? null,
      settlingMs:
        Number.isFinite(event.settlingDurationSamples) &&
        Number.isFinite(dtMs)
          ? Math.round(event.settlingDurationSamples * dtMs)
          : null,
      ringingCrossings: event.ringingTargetCrossingCount ?? null
    }));

    // The gate: high evidence confidence, a clear damping-or-drive
    // signature, and no open vibration finding.
    let suggestion = null;
    let gatedReason = null;
    let hypothesis;
    let expectedResult = null;
    let verifyMetric = null;

    if (vibrationConcern) {
      hypothesis = huntingMajority
        ? "The response circles its setpoint before resting — but this flight also carries an open vibration finding, and gyro vibration can produce exactly this signature."
        : "The response creeps to its target — but this flight also carries an open vibration finding, which has to be resolved first.";
      gatedReason =
        "Filters come before PIDs: resolve the vibration finding, fly again, and re-read this page.";
    } else if (confidence !== "High") {
      hypothesis = huntingMajority
        ? "The slow settles hunt around the setpoint, which usually points at damping — but there are not enough clean commands in this log to call it."
        : "The slow settles creep to target without hunting — but there are not enough clean commands in this log to call it.";
      gatedReason = `Evidence confidence is ${confidence} (${cleanResponses.length} clean command${cleanResponses.length === 1 ? "" : "s"}). Fly a log with more distinct stick inputs and re-read this page.`;
    } else if (huntingMajority) {
      hypothesis =
        "Reaching the target and then circling it is the classic underdamped signature: the axis has the drive to get there but not the damping to stop there.";
      suggestion = {
        family: AXIS_SETTING_FAMILY[axis].damping,
        direction: "up",
        magnitudeClass: "small step"
      };
      expectedResult = `${axis} settling times drop back toward the clean events on this page, without new oscillation on fast moves.`;
      verifyMetric = `the ${axis} slow-settle count in Flight Events`;
    } else if (driveSide) {
      hypothesis =
        "The axis creeps to its target while the I-term carries the command — in Rotorflight, feedforward is supposed to do that work.";
      suggestion = {
        family: AXIS_SETTING_FAMILY[axis].drive,
        direction: "up",
        magnitudeClass: "small step"
      };
      expectedResult = `${axis} responses reach target with less I-term build-up, and the command-balance finding clears.`;
      verifyMetric = `the ${axis} slow-settle count in Flight Events`;
    } else {
      hypothesis =
        "The slow settles carry neither a clear hunting signature nor an I-dominance finding, so damping and drive cannot be told apart from this log alone.";
      gatedReason =
        "Mixed signature — confirm the pattern with another log before changing values.";
    }

    recommendations.push({
      id: `pid:${axis}:slow-settling`,
      lab: "pid",
      axis,
      finding,
      hypothesis,
      evidence,
      confidence,
      suggestion,
      expectedResult,
      verifyMetric,
      gatedReason
    });
  }

  return recommendations;
}

function buildGovernorRecommendations({ governorEvents }) {
  const events = governorEvents?.events ?? [];

  if (events.length === 0) {
    return [];
  }

  const gate = RECOMMENDATION_GATE;
  const recommendations = [];

  const powerLimitEvents = events.filter(
    (event) => event.cause === "power-limit"
  );

  const collectiveDropEvents = events.filter(
    (event) => event.cause === "collective-drop"
  );

  // Hardware before tune: dips the governor could not have fixed
  // outrank every gain-or-precomp thought, and silence them.
  if (powerLimitEvents.length > 0) {
    recommendations.push({
      id: "governor:power-limit",
      lab: "governor",
      finding:
        `${powerLimitEvents.length} excursion${powerLimitEvents.length === 1 ? "" : "s"} happened with the motor output at its ceiling — ` +
        "the power system had nothing left to give at those moments.",
      hypothesis:
        "A dip with no output headroom is a power-system limit, not a governor-tune problem: no gain or precomp value can add power that is not there.",
      evidence: powerLimitEvents.slice(0, 6).map((event) => ({
        kind: "governor-event",
        eventId: event.id,
        t: event.t,
        peakErrorPercent: event.peakErrorPercent,
        outputMaxPercent: event.outputMaxPercent
      })),
      confidence: "High",
      suggestion: null,
      expectedResult: null,
      verifyMetric: null,
      gatedReason:
        "See the ESC Lab for the headroom story (headspeed, gearing, pack) before touching governor values."
    });
  }

  if (
    collectiveDropEvents.length >= gate.MINIMUM_EVENTS &&
    powerLimitEvents.length === 0
  ) {
    const confidence =
      collectiveDropEvents.length >=
      gate.GOVERNOR_HIGH_CONFIDENCE_EVENTS
        ? "High"
        : "Medium";

    const huntingCount = collectiveDropEvents.filter(
      (event) => event.hunting
    ).length;

    const gated = confidence !== "High";

    recommendations.push({
      id: "governor:precomp-overshoot",
      lab: "governor",
      finding:
        `The rotor ran over its target right after a sharp collective drop on ${collectiveDropEvents.length} occasions` +
        (huntingCount > 0
          ? `, ${huntingCount} of them hunting around the target afterwards`
          : "") +
        ".",
      hypothesis:
        "Overspeed that follows a collective drop is the governor's feedforward/precomp still pushing power the load no longer needs. Less collective precomp asks for less of that power; more governor damping absorbs it instead — the smaller change first.",
      evidence: collectiveDropEvents.slice(0, 6).map((event) => ({
        kind: "governor-event",
        eventId: event.id,
        t: event.t,
        peakErrorPercent: event.peakErrorPercent,
        hunting: event.hunting
      })),
      confidence,
      suggestion: gated
        ? null
        : {
            family: "gov_f_gain",
            direction: "down",
            magnitudeClass: "small step"
          },
      expectedResult: gated
        ? null
        : "Collective drops stop producing over-target excursions, and the events above disappear from this page.",
      verifyMetric: gated
        ? null
        : "over-target events after collective drops in the Governor Lab",
      gatedReason: gated
        ? `Two occurrences is a hint, not a pattern (confidence ${confidence}). Fly another log with the same moves and re-read this page.`
        : null
    });
  }

  return recommendations;
}
