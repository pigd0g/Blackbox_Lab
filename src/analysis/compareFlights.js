// ======================================================
// BLACKBOX LAB — BEFORE / AFTER COMPARISON
// ======================================================
//
// The payoff of the tuning loop, in one sentence per
// topic: "your change cut the 137 Hz tail peak by 62%".
//
// Takes two analyzed datasets (baseline = before,
// comparison = after) and returns plain-language delta
// rows, each marked better / worse / same.
//
// ======================================================

function strongestPeak(spectra) {
  if (!spectra || spectra.length === 0) {
    return null;
  }

  let peakHz = 0;
  let peakMagnitude = 0;

  for (const { spectrum } of spectra) {
    for (let i = 0; i < spectrum.frequencies.length; i += 1) {
      if (
        spectrum.frequencies[i] > 10 &&
        spectrum.magnitudes[i] > peakMagnitude
      ) {
        peakMagnitude = spectrum.magnitudes[i];
        peakHz = spectrum.frequencies[i];
      }
    }
  }

  return peakMagnitude > 0 ? { hz: peakHz, magnitude: peakMagnitude } : null;
}

function percentChange(before, after) {
  if (!Number.isFinite(before) || before === 0) {
    return null;
  }

  return ((after - before) / Math.abs(before)) * 100;
}

function describeChange(before, after, lowerIsBetter, minimumDelta) {
  const absoluteDelta = after - before;

  // Tiny absolute changes are noise, not news — a droop of
  // 4 vs 6 rpm is "excellent both times", not "50% worse".
  if (
    !Number.isFinite(absoluteDelta) ||
    Math.abs(absoluteDelta) < minimumDelta
  ) {
    return { direction: "same", word: "about the same" };
  }

  // A zero baseline has no percent — but 0 → 8 is not "the same".
  // The common good state IS zero (no excursions, no events), so
  // regressions from it must be called what they are.
  if (before === 0) {
    const improved = lowerIsBetter ? after < 0 : after > 0;
    return {
      direction: improved ? "better" : "worse",
      word: improved ? "better" : "worse"
    };
  }

  const change = percentChange(before, after);

  if (change === null || Math.abs(change) < 5) {
    return { direction: "same", word: "about the same" };
  }

  const improved = lowerIsBetter ? change < 0 : change > 0;

  return {
    direction: improved ? "better" : "worse",
    word: `${Math.abs(change).toFixed(0)}% ${improved ? "better" : "worse"}`
  };
}

/**
 * Whether two tracking scores rest on enough evidence to be subtracted
 * from one another.
 *
 * A flight with almost no clean command responses still produces a
 * score; comparing it with a well-flown one measures how much each was
 * measured, not how each flew.
 */
export function comparableEvidence(beforeConfidence, afterConfidence) {
  const thin = (confidence) =>
    confidence?.level === "Low" || confidence?.level === "Insufficient";

  const beforeThin = thin(beforeConfidence);
  const afterThin = thin(afterConfidence);

  // Same-demand flights only: a hover-level score and a
  // maneuvering score are different measurements wearing the same
  // number, and subtracting them ranks the flying style, not the
  // change. (This is how a mis-set-up machine hovering calmly
  // "outscored" its own fixed self on a sport flight.)
  const beforeDemand = beforeConfidence?.demand ?? null;
  const afterDemand = afterConfidence?.demand ?? null;

  if (
    beforeDemand &&
    afterDemand &&
    beforeDemand !== afterDemand
  ) {
    return {
      comparable: false,
      reason:
        beforeDemand === "gentle"
          ? "the earlier flight was flown gently while the later one was flown much harder. The two scores measure different demands, not the change."
          : "the later flight was flown gently while the earlier one was flown much harder. The two scores measure different demands, not the change."
    };
  }

  if (!beforeThin && !afterThin) {
    return { comparable: true, reason: "" };
  }

  if (beforeThin && afterThin) {
    return {
      comparable: false,
      reason: "neither flight recorded enough clean stick movements to measure tracking from."
    };
  }

  return {
    comparable: false,
    reason: beforeThin
      ? "the earlier flight did not record enough clean stick movements to measure tracking from."
      : "the later flight did not record enough clean stick movements to measure tracking from."
  };
}

/**
 * Are these two flights the same helicopter?
 *
 * Comparing a change means holding the machine still and varying one
 * thing. Two different helicopters differ in every way at once, so the
 * numbers are worth showing but the difference is not a verdict on
 * anything the pilot did.
 *
 * Unknown names are treated as the same aircraft: a log without a
 * craft name is common, and refusing to compare on that basis would
 * take a working feature away from the pilots most likely to need it.
 */
export function sameAircraft(beforeCraft, afterCraft) {
  const clean = (name) => {
    const text = String(name ?? "").trim();
    return !text || text === "Not found" || text === "Unknown craft"
      ? null
      : text.toLowerCase();
  };

  const before = clean(beforeCraft);
  const after = clean(afterCraft);

  if (!before || !after) {
    return { known: false, same: true, before, after };
  }

  return { known: true, same: before === after, before, after };
}


// ------------------------------------------------------
// Setup comparison — what actually CHANGED between the
// two flights, read from the logged FC settings.
// ------------------------------------------------------
//
// "Your change helped" presumes there was one change. The BBL
// header logs the full tuning state, so the pair can be told
// apart honestly: no change logged, one named change, or several
// changes that no single verdict may take credit for.

const COMPARABLE_SETUP_KEYS = [
  "rollPID", "pitchPID", "yawPID", "levelPID", "govPID",
  "rates_type", "rc_rates", "rates",
  "yaw_stop_gain", "yaw_precomp", "yaw_inertia_precomp",
  "hsi_gain", "hsi_limit",
  "gyro_lpf1_type", "gyro_lpf1_static_hz", "gyro_lpf1_dyn_hz",
  "gyro_lpf2_type", "gyro_lpf2_static_hz",
  "gyro_notch_hz", "gyro_notch_cutoff",
  "gyro_rpm_notch_preset", "gyro_rpm_notch_min_hz",
  "dterm_lpf1_type", "dterm_lpf1_static_hz",
  "dterm_lpf2_type", "dterm_lpf2_static_hz"
];

export function extractComparableSetup(lines) {
  if (!Array.isArray(lines)) {
    return null;
  }

  const settings = {};
  let startIso = null;
  let found = 0;

  for (const line of lines) {
    if (typeof line !== "string" || line[0] !== '"') continue;
    const match = line.match(/^"([^"]+)","(.*)"$/);
    if (!match) continue;
    if (match[1] === "Log start datetime") {
      startIso = match[2];
    } else if (COMPARABLE_SETUP_KEYS.includes(match[1])) {
      settings[match[1]] = match[2];
      found += 1;
    }
  }

  return { settings, startIso, found };
}

export function diffSetups(before, after) {
  if (!before || !after || before.found === 0 || after.found === 0) {
    return null;
  }

  const changedKeys = [];
  for (const key of COMPARABLE_SETUP_KEYS) {
    const a = before.settings[key];
    const b = after.settings[key];
    if (a !== undefined && b !== undefined && a !== b) {
      changedKeys.push(key);
    }
  }

  return { changedKeys, changedCount: changedKeys.length };
}

// A start timestamp is only trustworthy when the FC clock was
// actually set: unsynced RTCs log epoch-adjacent years. Equal or
// unusable stamps mean: preserve the user's order, never guess.
export function chronologicalOrder(startIsoA, startIsoB) {
  const parse = (iso) => {
    const ms = Date.parse(iso ?? "");
    if (!Number.isFinite(ms)) return null;
    const year = new Date(ms).getUTCFullYear();
    return year >= 2010 ? ms : null;
  };

  const a = parse(startIsoA);
  const b = parse(startIsoB);

  if (a === null || b === null || a === b) {
    return null;
  }

  return a <= b ? "keep" : "swap";
}

export function compareFlights(baseline, comparison, options = {}) {
  const rows = [];

  // ---- vibration ----
  const peakBefore = strongestPeak(baseline.spectra);
  const peakAfter = strongestPeak(comparison.spectra);

  if (peakBefore && peakAfter) {
    const described = describeChange(
      peakBefore.magnitude,
      peakAfter.magnitude,
      true,
      1.5
    );

    rows.push({
      title: "Vibration",
      direction: described.direction,
      before: `${peakBefore.magnitude.toFixed(1)} @ ${peakBefore.hz.toFixed(0)} Hz`,
      after: `${peakAfter.magnitude.toFixed(1)} @ ${peakAfter.hz.toFixed(0)} Hz`,
      sentence:
        described.direction === "same"
          ? `Biggest vibration peak is about the same (${peakAfter.magnitude.toFixed(1)} at ${peakAfter.hz.toFixed(0)} Hz).`
          : `Your change made the biggest vibration peak ${described.word}: ${peakBefore.magnitude.toFixed(1)} → ${peakAfter.magnitude.toFixed(1)} at ~${peakAfter.hz.toFixed(0)} Hz.`
    });
  }

  // ---- governor droop ----
  const govBefore = baseline.labs?.governor;
  const govAfter = comparison.labs?.governor;

  if (govBefore && govAfter) {
    const droopBefore = govBefore.droopRpm;
    const droopAfter = govAfter.droopRpm;
    const described = describeChange(
      droopBefore,
      droopAfter,
      true,
      8
    );

    // "Droop" is a target-relative word. If either flight lacks a
    // governor target, the number being compared is a short-term
    // swing against the rotor's own trend, and the row says so.
    const bothMeasuredDroop =
      govBefore.capability === "full" &&
      govAfter.capability === "full";

    const measureWord = bothMeasuredDroop
      ? "worst droop"
      : "largest swing";

    rows.push({
      title: "Headspeed hold",
      direction: described.direction,
      before: `${Math.round(droopBefore)} rpm ${measureWord}`,
      after: `${Math.round(droopAfter)} rpm ${measureWord}`,
      sentence:
        described.direction === "same"
          ? `${bothMeasuredDroop ? "Governor hold" : "Headspeed steadiness"} is about the same (${measureWord} ${Math.round(droopAfter)} rpm).`
          : `${bothMeasuredDroop ? "Headspeed hold" : "Headspeed steadiness"} got ${described.word}: ${measureWord} ${Math.round(droopBefore)} → ${Math.round(droopAfter)} rpm.`
    });
  }

  // ---- tracking score ----
  const scoreBefore = baseline.pidScore;
  const scoreAfter = comparison.pidScore;

  if (Number.isFinite(scoreBefore) && Number.isFinite(scoreAfter)) {
    // A tracking score is only as solid as the clean command responses
    // it was measured from. Subtracting a well-evidenced score from a
    // barely-evidenced one produces a confident-looking number that
    // describes the evidence gap, not the flying — so where either
    // side is thin, the difference is reported and left uncounted
    // rather than called better or worse.
    const evidence = comparableEvidence(
      baseline.pidConfidence,
      comparison.pidConfidence
    );

    if (evidence.comparable) {
      const described = describeChange(
        scoreBefore,
        scoreAfter,
        false,
        5
      );

      rows.push({
        title: "Tracking",
        direction: described.direction,
        before: `${scoreBefore}/100`,
        after: `${scoreAfter}/100`,
        sentence:
          described.direction === "same"
            ? `Stick tracking is about the same (${scoreAfter}/100).`
            : `Stick tracking got ${described.word}: ${scoreBefore} → ${scoreAfter} points.`
      });
    } else {
      rows.push({
        title: "Tracking",
        direction: "unknown",
        before: `${scoreBefore}/100`,
        after: `${scoreAfter}/100`,
        sentence: `Tracking cannot be compared here: ${evidence.reason} Both numbers are shown, but the difference between them would not mean anything.`
      });
    }
  }

  // ---- stick response events ----
  //
  // The recommendation cards name "the slow-settle count" and "the
  // overshoot count in Flight Events" as their verify metric — this
  // row is where that promise is kept. Counts are compared as a
  // RATE per measured command: two flights rarely contain the same
  // number of stick inputs, and 3-of-40 versus 3-of-8 are different
  // machines.
  const eventsBefore = baseline.flightEvents?.summary;
  const eventsAfter = comparison.flightEvents?.summary;

  if (eventsBefore?.total > 0 && eventsAfter?.total > 0) {
    const reviewBefore =
      eventsBefore.overshoot +
      eventsBefore.slow +
      (eventsBefore.lagging ?? 0) +
      (eventsBefore.oscillation ?? 0);
    const reviewAfter =
      eventsAfter.overshoot +
      eventsAfter.slow +
      (eventsAfter.lagging ?? 0) +
      (eventsAfter.oscillation ?? 0);

    const rateBefore = reviewBefore / eventsBefore.total;
    const rateAfter = reviewAfter / eventsAfter.total;

    // The DIRECTION comes from the rate (two flights rarely hold
    // the same number of commands), but the noise floor is one
    // whole event: a rate wiggle without a count change is nothing.
    const described =
      Math.abs(reviewAfter - reviewBefore) < 1
        ? { direction: "same", word: "about the same" }
        : describeChange(rateBefore, rateAfter, true, 0.001);

    const describeSide = (summary, review) =>
      `${review} of ${summary.total} command${summary.total === 1 ? "" : "s"}` +
      (review > 0
        ? ` (${summary.overshoot} overshot · ${summary.slow} slow` +
          ((summary.oscillation ?? 0) > 0
            ? ` · ${summary.oscillation} oscillated`
            : "") +
          ((summary.lagging ?? 0) > 0
            ? ` · ${summary.lagging} late`
            : "") +
          `)`
        : "");

    rows.push({
      title: "Stick response events",
      direction: described.direction,
      before: describeSide(eventsBefore, reviewBefore),
      after: describeSide(eventsAfter, reviewAfter),
      sentence:
        reviewBefore === 0 && reviewAfter === 0
          ? "Every measured stick command tracked cleanly in both flights."
          : described.direction === "same"
            ? `The share of commands needing review is about the same (${reviewAfter} of ${eventsAfter.total}).`
            : `The share of commands needing review got ${described.word}: ${reviewBefore} of ${eventsBefore.total} → ${reviewAfter} of ${eventsAfter.total}.`
    });
  }

  // ---- governor excursions ----
  const govExBefore = baseline.governorEvents?.summary;
  const govExAfter = comparison.governorEvents?.summary;

  if (govExBefore && govExAfter) {
    const countBefore = govExBefore.totalFound;
    const countAfter = govExAfter.totalFound;

    const described = describeChange(
      countBefore,
      countAfter,
      true,
      1
    );

    const describeSide = (summary, count) =>
      count === 0
        ? "none"
        : `${count} (${summary.under} under · ${summary.over} over)`;

    rows.push({
      title: "Headspeed excursions",
      direction:
        countBefore === 0 && countAfter === 0
          ? "same"
          : described.direction,
      before: describeSide(govExBefore, countBefore),
      after: describeSide(govExAfter, countAfter),
      sentence:
        countBefore === 0 && countAfter === 0
          ? "The rotor stayed inside the event band in both flights."
          : described.direction === "same"
            ? `Headspeed excursions are about the same (${countAfter}).`
            : `Headspeed excursions got ${described.word}: ${countBefore} → ${countAfter}.`
    });
  }

  // ---- precomp balance ----
  //
  // The precomp recommendations name these exact numbers as their
  // before/after judge. Each side must have READ a balance (enough
  // collective moves both ways) for the row to appear.
  const precompRows = [
    {
      key: "riseDroopPercent",
      title: "Collective-rise droop",
      unit: "%",
      minimumDelta: 1
    },
    {
      key: "dropOvershootPercent",
      title: "Collective-drop overspeed",
      unit: "%",
      minimumDelta: 1
    }
  ];

  for (const { key, title, unit, minimumDelta } of precompRows) {
    const valueBefore = baseline.precomp?.governor?.[key];
    const valueAfter = comparison.precomp?.governor?.[key];

    if (!Number.isFinite(valueBefore) || !Number.isFinite(valueAfter)) {
      continue;
    }

    const described = describeChange(
      valueBefore,
      valueAfter,
      true,
      minimumDelta
    );

    rows.push({
      title,
      direction: described.direction,
      before: `${valueBefore}${unit}`,
      after: `${valueAfter}${unit}`,
      sentence:
        described.direction === "same"
          ? `${title} is about the same (${valueAfter}${unit}).`
          : `${title} got ${described.word}: ${valueBefore}${unit} → ${valueAfter}${unit}.`
    });
  }

  const kickBefore = baseline.precomp?.tail?.kickRatio;
  const kickAfter = comparison.precomp?.tail?.kickRatio;

  if (Number.isFinite(kickBefore) && Number.isFinite(kickAfter)) {
    const described = describeChange(
      kickBefore,
      kickAfter,
      true,
      0.8
    );

    rows.push({
      title: "Tail kick on collective moves",
      direction: described.direction,
      before: `${kickBefore}× baseline`,
      after: `${kickAfter}× baseline`,
      sentence:
        described.direction === "same"
          ? `The tail's reaction to collective moves is about the same (${kickAfter}× its baseline error).`
          : `The tail's reaction to collective moves got ${described.word}: ${kickBefore}× → ${kickAfter}× its baseline error.`
    });
  }

  // ---- battery sag ----
  const sagBefore = baseline.batterySagPercent;
  const sagAfter = comparison.batterySagPercent;

  if (Number.isFinite(sagBefore) && Number.isFinite(sagAfter)) {
    const described = describeChange(
      sagBefore,
      sagAfter,
      true,
      1.5
    );

    rows.push({
      title: "Battery sag",
      direction: described.direction,
      before: `${sagBefore.toFixed(1)}%`,
      after: `${sagAfter.toFixed(1)}%`,
      sentence:
        described.direction === "same"
          ? `Battery sag is about the same (${sagAfter.toFixed(1)}%).`
          : `Battery sag got ${described.word}: ${sagBefore.toFixed(1)}% → ${sagAfter.toFixed(1)}%.`
    });
  }

  const better = rows.filter((row) => row.direction === "better").length;
  const worse = rows.filter((row) => row.direction === "worse").length;
  const uncomparable = rows.filter(
    (row) => row.direction === "unknown"
  ).length;

  // "Consider reverting it" tells a pilot to undo work. It has to rest
  // on something measured on both sides — with nothing comparable to
  // count, the honest answer is that this pair does not answer the
  // question, not a direction to act on. The same applies when the two
  // flights are different helicopters: every number will differ, and
  // none of it is a verdict on a change.
  const comparedRows = better + worse;
  const aircraft = sameAircraft(baseline.craftName, comparison.craftName);

  // ---- comparability gate for the causal headline ----
  // "That's a keeper" and "consider reverting" recommend keeping or
  // undoing a setup change — causal claims. The rows above only
  // DESCRIBE differences; attributing them to the change needs the
  // pair to be like-for-like: same machine, matched flight demand,
  // and solid evidence on both sides. Below that bar the summary
  // stays descriptive and asks for the confirming flight instead of
  // recommending action.
  const setupDiff = options.setupDiff ?? null;

  const headlineEvidence = comparableEvidence(
    baseline.pidConfidence,
    comparison.pidConfidence
  );
  const evidenceKnown =
    Boolean(baseline.pidConfidence) && Boolean(comparison.pidConfidence);
  const likeForLike =
    aircraft.same && evidenceKnown && headlineEvidence.comparable;
  const unlikeReason = !aircraft.same
    ? ""
    : !evidenceKnown
      ? "this pair does not carry enough evidence to verify the two flights were flown alike."
      : headlineEvidence.comparable
        ? ""
        : headlineEvidence.reason;

  // Different helicopters: the numbers are shown for reference, but
  // "90% better" is a tuning judgment and there is no tune being
  // judged — every row becomes descriptive, not directional.
  if (!aircraft.same) {
    for (const row of rows) {
      row.direction = "unknown";
      row.sentence = `${row.title}: ${row.before} vs ${row.after}. Two different machines, shown side by side for reference only.`;
    }
  }

  const summary =
    rows.length === 0
      ? "Not enough shared data between the two flights to compare."
      : !aircraft.same
        ? `These flights are different helicopters (${aircraft.before} and ${aircraft.after}), so the figures below describe two machines rather than a change to one.`
        : comparedRows === 0
          ? uncomparable > 0
            ? "These two flights cannot be compared usefully: see the rows below for what was missing."
            : "No meaningful change between these two flights."
          : worse === 0 && better > 0
            ? likeForLike
              ? setupDiff && setupDiff.changedCount === 0
                ? "The later flight measured better with NO logged setup change between the two: the difference reflects conditions or flying, not a tune. Nothing to keep or revert."
                : setupDiff && setupDiff.changedCount === 1
                  ? `Your change helped: nothing got worse, and the logs show exactly one setup change (${setupDiff.changedKeys[0]}). That's a keeper.`
                  : setupDiff && setupDiff.changedCount > 1
                    ? `The later flight measured better and nothing got worse, but ${setupDiff.changedCount} settings changed between these flights (${setupDiff.changedKeys.slice(0, 3).join(", ")}${setupDiff.changedCount > 3 ? ", …" : ""}). No single change can take the credit: repeat with one change at a time to know which one earned it.`
                    : "Your change helped: nothing got worse. That's a keeper."
              : `The later flight measured better in ${better} area${better === 1 ? "" : "s"} and nothing measured got worse. Whether that is your change or the flying differing isn't settled yet: ${unlikeReason} Repeat the same maneuvers; if the gain returns, it's a keeper.`
            : better === 0 && worse > 0
              ? likeForLike
                ? "This change went the wrong way. Consider reverting it."
                : `The later flight measured worse in ${worse} area${worse === 1 ? "" : "s"}, but ${unlikeReason} Repeat the same maneuvers before reverting anything.`
              : likeForLike
                ? "Mixed result: some things improved, others got worse. Trade-off territory."
                : `The measurements moved in both directions, and ${unlikeReason} This pair reads as two different flights more than as one change; repeat the same maneuvers for a cleaner verdict.`;

  return {
    rows,
    summary,
    better,
    worse,
    uncomparable,
    sameAircraft: aircraft.same,
    // Whether the pair earned causal language, and if not, why —
    // surfaced so the UI and tests can see the gate, not just its
    // effect on the wording.
    comparability: { likeForLike, reason: unlikeReason },
    setupDiff
  };
}
