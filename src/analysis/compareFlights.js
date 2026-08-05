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

function describeChange(change, lowerIsBetter, absoluteDelta, minimumDelta) {
  // Tiny absolute changes are noise, not news — a droop of
  // 4 vs 6 rpm is "excellent both times", not "50% worse".
  if (
    change === null ||
    Math.abs(change) < 5 ||
    (Number.isFinite(absoluteDelta) &&
      Math.abs(absoluteDelta) < minimumDelta)
  ) {
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

export function compareFlights(baseline, comparison) {
  const rows = [];

  // ---- vibration ----
  const peakBefore = strongestPeak(baseline.spectra);
  const peakAfter = strongestPeak(comparison.spectra);

  if (peakBefore && peakAfter) {
    const change = percentChange(peakBefore.magnitude, peakAfter.magnitude);
    const described = describeChange(
      change,
      true,
      peakAfter.magnitude - peakBefore.magnitude,
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
    const change = percentChange(droopBefore, droopAfter);
    const described = describeChange(
      change,
      true,
      droopAfter - droopBefore,
      8
    );

    rows.push({
      title: "Headspeed hold",
      direction: described.direction,
      before: `${Math.round(droopBefore)} rpm worst droop`,
      after: `${Math.round(droopAfter)} rpm worst droop`,
      sentence:
        described.direction === "same"
          ? `Governor hold is about the same (worst droop ${Math.round(droopAfter)} rpm).`
          : `Headspeed hold got ${described.word}: worst droop ${Math.round(droopBefore)} → ${Math.round(droopAfter)} rpm.`
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
      const change = percentChange(scoreBefore, scoreAfter);
      const described = describeChange(
        change,
        false,
        scoreAfter - scoreBefore,
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

  // ---- battery sag ----
  const sagBefore = baseline.batterySagPercent;
  const sagAfter = comparison.batterySagPercent;

  if (Number.isFinite(sagBefore) && Number.isFinite(sagAfter)) {
    const change = percentChange(sagBefore, sagAfter);
    const described = describeChange(
      change,
      true,
      sagAfter - sagBefore,
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
  // question, not a direction to act on.
  const comparedRows = better + worse;

  const summary =
    rows.length === 0
      ? "Not enough shared data between the two flights to compare."
      : comparedRows === 0
        ? uncomparable > 0
          ? "These two flights cannot be compared usefully — see the rows below for what was missing."
          : "No meaningful change between these two flights."
        : worse === 0 && better > 0
          ? "Your change helped — nothing got worse. That's a keeper."
          : better === 0 && worse > 0
            ? "This change went the wrong way — consider reverting it."
            : "Mixed result: some things improved, others got worse. Trade-off territory.";

  return { rows, summary, better, worse, uncomparable };
}
