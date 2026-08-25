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
//   · Blackbox Lab NEVER silently changes anything; it
//     recommends and explains, the pilot decides.
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
//   · Every suggestion ends with its verify plan: it rides
//     in the flight's pack (at most PACK_CAP changes, one per
//     instrument), fly again, let the pack check and the
//     named metric be the judge.
//
// ======================================================

import { commandEvidenceConfidence } from "./pidAnalysis.js";
import { estimateSampleRate } from "./flightPhase.js";
import {
  finalizeRecommendations,
  confirmsFromResponseBehavior,
  rankRecommendations
} from "./recommendationContract.js";

export const RECOMMENDATION_GATE = {
  MINIMUM_EVENTS: 2,
  SLOW_SETTLING_MS: 500,
  // Slow-settle shares re-anchored 2026-08-18 (same sweep as the
  // overshoot anchors; per-axis split and rationale unchanged:
  // yaw settles slow as its nature, roll fast). Bars sit at each
  // axis's fleet p90, yaw at p95: Roll p90 0.125, Pitch p90
  // 0.118, Yaw p95 0.219.
  // Yaw re-read 2026-08-23 on the post-ghost-fix fleet (742
  // flights): yaw pirouettes are the long ramps the ghost events
  // rode on; with them gone yaw's p95 slow share reads 0.18.
  SLOW_SETTLE_SHARE_MINIMUM: {
    Roll: 0.13,
    Pitch: 0.12,
    Yaw: 0.18
  },
  HUNTING_MINIMUM_CROSSINGS: 3,
  // Governor excursions are fleet-rare by calibration (median
  // machine: zero), so three same-cause excursions in ONE flight
  // is already a strong pattern.
  GOVERNOR_HIGH_CONFIDENCE_EVENTS: 3,
  // Overshoot: re-calibrated 2026-08-18 after the reversal-
  // termination refinement (370 contributed flights, 748 axes
  // with >=5 clean responses — compound slurred-command events no
  // longer inflate the tail). Same doctrine as always: bars at
  // the fleet's p90, so a card names a machine, not the formula.
  // Share of clean commands overshooting >=25% AND >=10 deg/s at
  // fleet p90 (0.50), per-axis median overshoot at fleet p90
  // (34%), at least three events.
  OVERSHOOT_REVIEW_PERCENT: 25,
  OVERSHOOT_MINIMUM_DEG_S: 10,
  OVERSHOOT_MINIMUM_EVENTS: 3,
  OVERSHOOT_SHARE_MINIMUM: 0.5,
  OVERSHOOT_MEDIAN_MINIMUM_PERCENT: 34,
  OVERSHOOT_CORRELATION_MINIMUM_EVENTS: 5,
  OVERSHOOT_CORRELATION_STRONG: 0.6,
  OVERSHOOT_CORRELATION_GAP: 0.25
};

// Spearman rank correlation — the driver signature lives in how
// overshoot GROWS with a candidate driver, not in absolute values,
// so ranks are the honest measure at these sample sizes.
function spearmanCorrelation(a, b) {
  if (a.length !== b.length || a.length < 3) {
    return null;
  }

  // Ties share their average rank — without this, a CONSTANT
  // series gets ranks in input order and correlates perfectly
  // with anything sorted, which is exactly backwards.
  const rankOf = (values) => {
    const indexed = values
      .map((value, index) => ({ value, index }))
      .sort((x, y) => x.value - y.value);

    const ranks = new Array(values.length);
    let i = 0;

    while (i < indexed.length) {
      let j = i;

      while (
        j + 1 < indexed.length &&
        indexed[j + 1].value === indexed[i].value
      ) {
        j += 1;
      }

      const sharedRank = (i + j) / 2;

      for (let k = i; k <= j; k += 1) {
        ranks[indexed[k].index] = sharedRank;
      }

      i = j + 1;
    }

    return ranks;
  };

  const ra = rankOf(a);
  const rb = rankOf(b);
  const meanRank = (a.length - 1) / 2;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const da = ra[i] - meanRank;
    const db = rb[i] - meanRank;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : null;
}

// Gap-robust: a logging dropout stretches an endpoint average and
// would inflate every settling duration; the median interval the
// sibling modules use is unaffected.
function sampleSpacingMs(timeSeconds) {
  const rate = estimateSampleRate(timeSeconds);
  return Number.isFinite(rate) && rate > 0 ? 1000 / rate : null;
}

// The Rotorflight CLI family a suggestion points at, per axis.
const AXIS_SETTING_FAMILY = {
  Roll: {
    damping: "roll_d_gain",
    drive: "roll_f_gain",
    proportional: "roll_p_gain"
  },
  Pitch: {
    damping: "pitch_d_gain",
    drive: "pitch_f_gain",
    proportional: "pitch_p_gain"
  },
  Yaw: {
    damping: "yaw_d_gain",
    drive: "yaw_f_gain",
    proportional: "yaw_p_gain"
  }
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
  precomp = null,
  vibrationConcern = false,
  responseBehavior = null
} = {}) {
  // Every recommendation leaves this function wearing the contract
  // (level, domain, instrument, next maneuver) — the one shape all
  // surfaces render and the pack builder selects from.
  const nextSteps = finalizeRecommendations({
    pid: buildPidRecommendations({
      trackingAnalysis,
      commandBalanceReviewAxes,
      timeSeconds,
      vibrationConcern
    }),
    governor: buildGovernorRecommendations({
      governorEvents,
      precomp,
      vibrationConcern
    })
  });

  // Response-behavior Reviews below the gates still deserve their
  // evidence flight — the report already says so, and the contract
  // must agree with the report (one axis, one entry, no duplicates
  // where the engine already spoke).
  nextSteps.pid.push(
    ...confirmsFromResponseBehavior(responseBehavior, nextSteps.pid)
  );

  // One priority rule for every surface (#62): the first entry here
  // IS the primary next action — Home, the pack, the PID Lab card,
  // the Technical recommendations and the report all read this order.
  nextSteps.pid = rankRecommendations(nextSteps.pid);
  nextSteps.governor = rankRecommendations(nextSteps.governor);

  return nextSteps;
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

    const overshootRecommendation = buildOvershootRecommendation({
      axis,
      cleanResponses,
      confidence,
      vibrationConcern,
      gate
    });

    // Same-knob guard: when the slow-settle rec below already points
    // at damping, a second damping-side overshoot rec on the same
    // axis would say the same thing twice with two findings.
    const pushOvershoot = (slowSuggestedDamping) => {
      if (!overshootRecommendation) {
        return;
      }

      if (slowSuggestedDamping && overshootRecommendation.dampingSide) {
        return;
      }

      delete overshootRecommendation.dampingSide;
      recommendations.push(overshootRecommendation);
    };

    // Count AND share: a long flight accumulates slow events the
    // way any flight accumulates minutes — only an axis where slow
    // settling is a real fraction of its commands has a pattern.
    const slowShare =
      cleanResponses.length > 0
        ? slowEvents.length / cleanResponses.length
        : 0;

    const slowShareBar =
      gate.SLOW_SETTLE_SHARE_MINIMUM[axis] ?? 0.15;

    if (
      slowEvents.length < gate.MINIMUM_EVENTS ||
      slowShare < slowShareBar
    ) {
      pushOvershoot(false);
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
        ? "The response circles its setpoint before resting. But this flight also carries an open vibration finding, and gyro vibration can produce exactly this signature."
        : "The response creeps to its target. But this flight also carries an open vibration finding, which has to be resolved first.";
      gatedReason =
        "Filters come before PIDs: resolve the vibration finding, fly again, and re-read this page.";
    } else if (confidence !== "High") {
      hypothesis = huntingMajority
        ? "The slow settles hunt around the setpoint, which usually points at damping. But there are not enough clean commands in this log to call it."
        : "The slow settles creep to target without hunting. But there are not enough clean commands in this log to call it.";
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
        "The axis creeps to its target while the I-term carries the command. In Rotorflight, feedforward is supposed to do that work.";
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
        "Mixed signature: confirm the pattern with another log before changing values.";
    }

    recommendations.push({
      id: `pid:${axis}:slow-settling`,
      lab: "pid",
      axis,
      finding,
      hypothesis,
      evidence,
      evidenceCount: slowEvents.length,
      confidence,
      suggestion,
      expectedResult,
      verifyMetric,
      gatedReason
    });

    pushOvershoot(
      suggestion?.family === AXIS_SETTING_FAMILY[axis].damping
    );
  }

  return recommendations;
}

// The overshoot driver question: an axis that repeatedly shoots
// past its target is being pushed past it by SOMETHING — damping
// too short (it also rings), feedforward too hot (overshoot grows
// with how FAST the command moved), or proportional drive too hot
// (overshoot grows with how BIG the command was). The signature is
// read from how overshoot grows, never from one event.
function buildOvershootRecommendation({
  axis,
  cleanResponses,
  confidence,
  vibrationConcern,
  gate
}) {
  const measured = cleanResponses.filter((event) =>
    Number.isFinite(event.overshootPercent)
  );

  const big = measured.filter(
    (event) =>
      event.overshootPercent >= gate.OVERSHOOT_REVIEW_PERCENT &&
      Number.isFinite(event.overshootAmount) &&
      event.overshootAmount >= gate.OVERSHOOT_MINIMUM_DEG_S
  );

  const medianBig = big.length
    ? big
        .map((event) => event.overshootPercent)
        .sort((a, b) => a - b)[Math.floor(big.length / 2)]
    : null;

  // The fleet-anchored trigger: all three bars, or silence. See
  // the calibration note on the gate constants — anything looser
  // fires on the median machine.
  if (
    big.length < gate.OVERSHOOT_MINIMUM_EVENTS ||
    cleanResponses.length === 0 ||
    big.length / cleanResponses.length <
      gate.OVERSHOOT_SHARE_MINIMUM ||
    !Number.isFinite(medianBig) ||
    medianBig < gate.OVERSHOOT_MEDIAN_MINIMUM_PERCENT
  ) {
    return null;
  }

  const finding =
    `${axis} overshot its target by ${gate.OVERSHOOT_REVIEW_PERCENT}%+ on ` +
    `${big.length} of ${cleanResponses.length} measured commands ` +
    `(median ${Math.round(medianBig)}% past the target).`;

  const evidence = big.slice(0, 6).map((event) => ({
    kind: "command-event",
    axis,
    rowIndex: event.sampleRowIndex ?? null,
    overshootPercent:
      Math.round(event.overshootPercent * 10) / 10,
    ringingCrossings: event.ringingTargetCrossingCount ?? null
  }));

  const base = {
    id: `pid:${axis}:overshoot`,
    lab: "pid",
    axis,
    finding,
    evidence,
    evidenceCount: big.length,
    confidence,
    suggestion: null,
    expectedResult: null,
    verifyMetric: null,
    gatedReason: null,
    dampingSide: false
  };

  if (vibrationConcern) {
    return {
      ...base,
      hypothesis:
        "Repeated overshoot with an open vibration finding is unreadable: gyro vibration can push a response past its target all by itself.",
      gatedReason:
        "Filters come before PIDs: resolve the vibration finding, fly again, and re-read this page."
    };
  }

  if (confidence !== "High") {
    return {
      ...base,
      hypothesis:
        "The overshoots repeat, but there are not enough clean commands in this log to read what drives them.",
      gatedReason: `Evidence confidence is ${confidence} (${cleanResponses.length} clean command${cleanResponses.length === 1 ? "" : "s"}). Fly a log with more distinct stick inputs and re-read this page.`
    };
  }

  const ringing = big.filter(
    (event) =>
      Number.isFinite(event.ringingTargetCrossingCount) &&
      event.ringingTargetCrossingCount >=
        gate.HUNTING_MINIMUM_CROSSINGS
  );

  if (ringing.length * 2 > big.length) {
    return {
      ...base,
      dampingSide: true,
      hypothesis:
        "The overshoots ring: the axis blows past its target and oscillates before resting. The drive is winning against the damping.",
      suggestion: {
        family: AXIS_SETTING_FAMILY[axis].damping,
        direction: "up",
        magnitudeClass: "small step"
      },
      expectedResult: `${axis} overshoot events shrink and stop ringing, without the response turning sluggish.`,
      verifyMetric: `the ${axis} overshoot count in Flight Events`
    };
  }

  // Driver correlation needs enough measured overshoots to rank.
  if (
    measured.length < gate.OVERSHOOT_CORRELATION_MINIMUM_EVENTS
  ) {
    return {
      ...base,
      hypothesis:
        "The overshoots repeat without ringing, but too few responses crossed the target to read whether command speed or command size drives them.",
      gatedReason:
        "Confirm the pattern with another log carrying more measured overshoots before changing values."
    };
  }

  const overshoots = measured.map(
    (event) => event.overshootPercent
  );

  const rates = measured.map((event) => {
    const durationSamples = Math.max(
      1,
      Number.isInteger(event.commandEndSampleIndex) &&
        Number.isInteger(event.sampleIndex)
        ? event.commandEndSampleIndex - event.sampleIndex
        : 1
    );

    return (
      (Number(event.commandMagnitude) || 0) / durationSamples
    );
  });

  const sizes = measured.map(
    (event) => Number(event.commandMagnitude) || 0
  );

  const rhoRate = spearmanCorrelation(overshoots, rates) ?? 0;
  const rhoSize = spearmanCorrelation(overshoots, sizes) ?? 0;

  const rateDriven =
    rhoRate >= gate.OVERSHOOT_CORRELATION_STRONG &&
    rhoRate - rhoSize >= gate.OVERSHOOT_CORRELATION_GAP;

  const sizeDriven =
    rhoSize >= gate.OVERSHOOT_CORRELATION_STRONG &&
    rhoSize - rhoRate >= gate.OVERSHOOT_CORRELATION_GAP;

  if (rateDriven) {
    return {
      ...base,
      hypothesis:
        "Overshoot grows with how FAST the command moved: the feedforward signature. It pushes in proportion to stick speed, and here it pushes past the target.",
      suggestion: {
        family: AXIS_SETTING_FAMILY[axis].drive,
        direction: "down",
        magnitudeClass: "small step"
      },
      expectedResult: `${axis} overshoot shrinks on fast inputs first: exactly where it is worst now.`,
      verifyMetric: `the ${axis} overshoot count in Flight Events`
    };
  }

  if (sizeDriven) {
    return {
      ...base,
      hypothesis:
        "Overshoot grows with how BIG the command was, not how fast: the proportional-drive signature.",
      suggestion: {
        family: AXIS_SETTING_FAMILY[axis].proportional,
        direction: "down",
        magnitudeClass: "small step"
      },
      expectedResult: `${axis} overshoot shrinks on large inputs first: exactly where it is worst now.`,
      verifyMetric: `the ${axis} overshoot count in Flight Events`
    };
  }

  return {
    ...base,
    hypothesis:
      "The overshoots are real but their driver is not separable from this log: they grow with neither command speed nor command size clearly enough to name one knob.",
    suggestion: {
      family: `${AXIS_SETTING_FAMILY[axis].drive}, then ${AXIS_SETTING_FAMILY[axis].proportional}`,
      direction: "down",
      magnitudeClass: "small step"
    },
    expectedResult: `${axis} overshoot count drops. In Rotorflight, feedforward does most of the commanded work, so it is the likelier driver: step it first, and only touch ${AXIS_SETTING_FAMILY[axis].proportional} if the next log still overshoots.`,
    verifyMetric: `the ${axis} overshoot count in Flight Events`
  };
}

function buildGovernorRecommendations({
  governorEvents,
  precomp,
  vibrationConcern = false
}) {
  const events = governorEvents?.events ?? [];
  const gate = RECOMMENDATION_GATE;
  const recommendations = [];

  // The tuning order holds here too: gyro vibration can fake the
  // yaw-error signal the tail read is built on, and shake enough
  // energy into everything else to make any governor conclusion
  // suspect. One silencer, applied to every directional suggestion
  // this builder would otherwise make.
  const silenceForVibration = (recommendation) =>
    vibrationConcern &&
    (recommendation.suggestion ||
      // The tail read is measured from yaw gyro error — the most
      // vibration-sensitive signal here — so its verify-plan
      // guidance yields too, suggestion or not.
      recommendation.id === "governor:tail-coupling")
      ? {
          ...recommendation,
          suggestion: null,
          expectedResult: null,
          verifyMetric: null,
          gatedReason:
            "This flight carries an open vibration finding, and vibration can fake exactly these signals. Filters come first: resolve it, fly again, and re-read this page."
        }
      : recommendation;

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
        `${powerLimitEvents.length} excursion${powerLimitEvents.length === 1 ? "" : "s"} happened with the motor output at its ceiling: ` +
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
      evidenceCount: powerLimitEvents.length,
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
        "Overspeed that follows a collective drop is the governor's feedforward/precomp still pushing power the load no longer needs. Less collective precomp asks for less of that power; more governor damping absorbs it instead. The smaller change first.",
      evidence: collectiveDropEvents.slice(0, 6).map((event) => ({
        kind: "governor-event",
        eventId: event.id,
        t: event.t,
        peakErrorPercent: event.peakErrorPercent,
        hunting: event.hunting
      })),
      evidenceCount: collectiveDropEvents.length,
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

  // ---- precomp balance (the ratio view) ----
  //
  // The event layer sees excursions past the fleet band; the ratio
  // view sees the systematic lean UNDER it. They agree by
  // construction (same error signal), so when the event-based
  // precomp recommendation already fired, the ratio adds nothing
  // and stays quiet.
  const governorBalance = precomp?.governor ?? null;
  const eventRecAlreadyFired = recommendations.some(
    (rec) => rec.id === "governor:precomp-overshoot"
  );

  if (
    governorBalance &&
    governorBalance.balance &&
    governorBalance.balance !== "balanced" &&
    powerLimitEvents.length === 0 &&
    !eventRecAlreadyFired
  ) {
    const sideCounts = `${governorBalance.riseCount} rises / ${governorBalance.dropCount} drops`;

    const confidence =
      governorBalance.riseCount >= 2 * gate.MINIMUM_EVENTS &&
      governorBalance.dropCount >= 2 * gate.MINIMUM_EVENTS
        ? "High"
        : "Medium";

    const gated = confidence !== "High";

    if (governorBalance.balance === "low") {
      recommendations.push({
        id: "governor:precomp-low",
        lab: "governor",
        finding: `Fast collective rises pull the rotor a median ${governorBalance.riseDroopPercent}% under target while drops stay clean (${sideCounts} measured).`,
        hypothesis:
          "Droop that only appears when load ARRIVES is anticipation running behind: the governor waits to see the error instead of feeding power with the collective. More collective precomp asks for the power before the load does.",
        evidence: [
          {
            kind: "precomp-balance",
            riseDroopPercent: governorBalance.riseDroopPercent,
            dropOvershootPercent:
              governorBalance.dropOvershootPercent,
            riseCount: governorBalance.riseCount,
            dropCount: governorBalance.dropCount
          }
        ],
        confidence,
        suggestion: gated
          ? null
          : {
              family: "gov_f_gain",
              direction: "up",
              magnitudeClass: "small step"
            },
        expectedResult: gated
          ? null
          : "The rise-side droop in the Precomp Balance read shrinks, without new overspeed appearing on drops.",
        verifyMetric: gated
          ? null
          : "the rise-droop number in the Governor Lab's Precomp Balance",
        gatedReason: gated
          ? `Not enough collective moves in both directions yet (${sideCounts}). Fly a log with a few honest pumps each way and re-read this page.`
          : null
      });
    } else if (governorBalance.balance === "high") {
      recommendations.push({
        id: "governor:precomp-high",
        lab: "governor",
        finding: `Fast collective drops push the rotor a median ${governorBalance.dropOvershootPercent}% over target while rises stay clean (${sideCounts} measured).`,
        hypothesis:
          "Overspeed that only appears when load LEAVES is anticipation overshooting: the precomp keeps feeding power the load no longer needs. Less collective precomp, or more governor damping, absorbs it. The smaller change first.",
        evidence: [
          {
            kind: "precomp-balance",
            riseDroopPercent: governorBalance.riseDroopPercent,
            dropOvershootPercent:
              governorBalance.dropOvershootPercent,
            riseCount: governorBalance.riseCount,
            dropCount: governorBalance.dropCount
          }
        ],
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
          : "The drop-side overspeed in the Precomp Balance read shrinks, without new droop appearing on rises.",
        verifyMetric: gated
          ? null
          : "the drop-overspeed number in the Governor Lab's Precomp Balance",
        gatedReason: gated
          ? `Not enough collective moves in both directions yet (${sideCounts}). Fly a log with a few honest pumps each way and re-read this page.`
          : null
      });
    } else if (governorBalance.balance === "lagging") {
      recommendations.push({
        id: "governor:response-lag",
        lab: "governor",
        finding: `The rotor misses its target both ways around collective moves: droop ${governorBalance.riseDroopPercent}% on rises AND overspeed ${governorBalance.dropOvershootPercent}% on drops (${sideCounts} measured).`,
        hypothesis:
          "Missing in both directions is not a precomp balance problem: precomp trades one side against the other. A governor late both ways is a response-speed story, and that lives in its gain and the power system's headroom together.",
        evidence: [
          {
            kind: "precomp-balance",
            riseDroopPercent: governorBalance.riseDroopPercent,
            dropOvershootPercent:
              governorBalance.dropOvershootPercent,
            riseCount: governorBalance.riseCount,
            dropCount: governorBalance.dropCount
          }
        ],
        confidence,
        suggestion: null,
        expectedResult: null,
        verifyMetric: null,
        gatedReason:
          "Two-sided lag needs the ESC Lab's headroom read next to it before any governor value moves. Check that page first."
      });
    }
  }

  // ---- tail precomp coupling ----
  const tailBalance = precomp?.tail ?? null;

  if (tailBalance?.balance === "coupled") {
    recommendations.push({
      id: "governor:tail-coupling",
      lab: "governor",
      finding: `Collective moves kick the tail ${tailBalance.kickRatio}× harder than its ordinary error (median ${tailBalance.transientError} deg/s across ${tailBalance.kickCount} moves, ${Math.round(tailBalance.consistency * 100)}% in a consistent direction).`,
      hypothesis:
        "A tail that only misbehaves during collective transients is torque anticipation, not tail tuning: the collective feedforward into yaw is not matching the torque change. The knob is the collective-to-yaw precomp. But its direction depends on rotor rotation, which a log does not state.",
      evidence: [
        {
          kind: "tail-coupling",
          kickRatio: tailBalance.kickRatio,
          transientError: tailBalance.transientError,
          consistency: tailBalance.consistency,
          kickCount: tailBalance.kickCount
        }
      ],
      confidence:
        tailBalance.kickCount >= 2 * gate.MINIMUM_EVENTS
          ? "High"
          : "Medium",
      suggestion: null,
      expectedResult: null,
      verifyMetric: null,
      gatedReason:
        "Step yaw_collective_ff_gain one small step in either direction and fly the same pumps: if the kick grows, go the other way. The Precomp Balance read here is the before/after judge."
    });
  }

  return recommendations.map(silenceForVibration);
}
