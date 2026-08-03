// ======================================================
// BLACKBOX LAB — FLIGHT EVENTS
// ======================================================
//
// The event layer: every meaningful stick command the PID
// analysis already found, packaged as one compact event
// object — when it happened, what was asked, and how the
// machine answered. Everything here is READ from the
// trackingAnalysis the app already computed; nothing is
// re-measured, so an event can never disagree with the
// score it feeds.
//
// These are the same Event objects that travel as the
// `events` array of contribution schema 1.1.
//
// ======================================================

// Verdict thresholds — deliberately few and readable.
const OVERSHOOT_REVIEW_PERCENT = 25;
const SLOW_SETTLING_MS = 500;

function toSeconds(timeSeconds, sampleIndex) {
  const value = timeSeconds?.[sampleIndex];
  return Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

function sampleSpacingMs(timeSeconds) {
  if (!timeSeconds || timeSeconds.length < 2) {
    return null;
  }
  const spacing =
    (timeSeconds[timeSeconds.length - 1] - timeSeconds[0]) /
    (timeSeconds.length - 1);
  return Number.isFinite(spacing) && spacing > 0
    ? spacing * 1000
    : null;
}

function eventVerdict(event, settlingMs) {
  if (
    Number.isFinite(event.overshootPercent) &&
    event.overshootPercent >= OVERSHOOT_REVIEW_PERCENT
  ) {
    return "overshoot";
  }

  if (
    event.settlingDetected &&
    Number.isFinite(settlingMs) &&
    settlingMs > SLOW_SETTLING_MS
  ) {
    return "slow";
  }

  return "clean";
}

/**
 * Build the flight's event list from the tracking analysis
 * the PID Lab already computed.
 *
 * @param {object} options {
 *     trackingAnalysis,  // pidAnalysis.detectedColumns.trackingAnalysis
 *     timeSeconds        // dataset.timeSeconds (row index → seconds)
 *   }
 * Returns { events, summary } — events sorted by time;
 * summary = { total, clean, overshoot, slow, sentence, worst }.
 */
export function buildFlightEvents({ trackingAnalysis, timeSeconds } = {}) {
  const perAxis = trackingAnalysis?.commandEvents ?? [];
  const dtMs = sampleSpacingMs(timeSeconds);

  const events = [];

  for (const axisResult of perAxis) {
    for (const raw of axisResult?.events ?? []) {
      const settlingMs =
        raw.settlingDetected &&
        Number.isFinite(raw.settlingDurationSamples) &&
        Number.isFinite(dtMs)
          ? Math.round(raw.settlingDurationSamples * dtMs)
          : null;

      const verdict = eventVerdict(raw, settlingMs);

      events.push({
        t: toSeconds(timeSeconds, raw.sampleIndex),
        axis: raw.axis,
        kind: "command",
        magnitude: Number.isFinite(raw.commandMagnitude)
          ? Math.round(raw.commandMagnitude)
          : null,
        direction: raw.commandDirection ?? null,
        overshoot_percent: Number.isFinite(raw.overshootPercent)
          ? Math.round(raw.overshootPercent * 10) / 10
          : null,
        settling_ms: settlingMs,
        verdict
      });
    }
  }

  events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const counts = { clean: 0, overshoot: 0, slow: 0 };
  for (const event of events) {
    counts[event.verdict] += 1;
  }

  // The worst moment: biggest overshoot first, slowest
  // settle as runner-up.
  const worst =
    [...events]
      .filter((event) => event.verdict !== "clean")
      .sort((a, b) => {
        const overshootGap =
          (b.overshoot_percent ?? 0) - (a.overshoot_percent ?? 0);
        if (overshootGap !== 0) return overshootGap;
        return (b.settling_ms ?? 0) - (a.settling_ms ?? 0);
      })[0] ?? null;

  const sentence =
    events.length === 0
      ? "No distinct stick commands found in the stable flight sections — smooth cruising, or not enough command activity to judge."
      : `${events.length} stick command${events.length === 1 ? "" : "s"} analyzed — ` +
        `${counts.clean} tracked cleanly` +
        (counts.overshoot > 0 ? `, ${counts.overshoot} overshot` : "") +
        (counts.slow > 0 ? `, ${counts.slow} settled slowly` : "") +
        "." +
        (worst && worst.t !== null
          ? ` Worst: ${worst.axis.toLowerCase()} at ${worst.t.toFixed(1)} s.`
          : "");

  return {
    events,
    summary: {
      total: events.length,
      ...counts,
      worst,
      sentence
    }
  };
}
