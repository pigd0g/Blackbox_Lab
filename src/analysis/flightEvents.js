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

import { estimateSampleRate } from "./flightPhase.js";

// Verdict thresholds — deliberately few and readable.
const OVERSHOOT_REVIEW_PERCENT = 25;
// A percentage alone lies on small steps (10 deg/s past a
// 20 deg/s nudge = "50%"): overshoot must also be a movement
// worth naming in absolute terms.
const OVERSHOOT_MINIMUM_DEG_S = 10;
const SLOW_SETTLING_MS = 500;
// Oscillation: repeated strong swings across the target after
// the command — a different story than one overshoot, and the
// more specific verdict wins. Fleet-calibrated 2026-08-17
// (80-flight sample): post-command ringing of a few tens of
// deg/s is the fleet's NORM after hard inputs, so the verdict
// demands swings that exceed the command itself, many times —
// at these bars the median flight reads zero and what remains
// is genuine hunting.
const OSCILLATION_MINIMUM_CROSSINGS = 8;
const OSCILLATION_MINIMUM_DEG_S = 15;

// A response can only be called "still on its way" when the
// window actually left it time to arrive: a window cut short by
// the next stick input proves nothing about the machine.
const LAGGING_MINIMUM_WINDOW_MS = 500;

function toSeconds(timeSeconds, sampleIndex) {
  const value = timeSeconds?.[sampleIndex];
  return Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

// Gap-robust: a logging dropout stretches an endpoint average and
// would inflate every settling_ms shown to the pilot; the median
// interval is unaffected.
function sampleSpacingMs(timeSeconds) {
  const rate = estimateSampleRate(timeSeconds);
  return Number.isFinite(rate) && rate > 0 ? 1000 / rate : null;
}

function eventVerdict(event, settlingMs, windowMs) {
  const oscillationAmplitudeBar = Math.max(
    OSCILLATION_MINIMUM_DEG_S,
    Number.isFinite(event.commandMagnitude)
      ? event.commandMagnitude
      : OSCILLATION_MINIMUM_DEG_S
  );

  if (
    event.ringingEligible &&
    (event.strongRingingCrossingCount ?? 0) >=
      OSCILLATION_MINIMUM_CROSSINGS &&
    Number.isFinite(event.ringingAmplitude) &&
    event.ringingAmplitude >= oscillationAmplitudeBar
  ) {
    return "oscillation";
  }

  if (
    Number.isFinite(event.overshootPercent) &&
    event.overshootPercent >= OVERSHOOT_REVIEW_PERCENT &&
    Number.isFinite(event.overshootAmount) &&
    event.overshootAmount >= OVERSHOOT_MINIMUM_DEG_S
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

  // The response never came within tolerance of the target
  // inside a window long enough to give it a fair chance:
  // not clean, not overshoot — it was still on its way.
  if (
    event.responseReachedTarget === false &&
    Number.isFinite(windowMs) &&
    windowMs >= LAGGING_MINIMUM_WINDOW_MS
  ) {
    return "lagging";
  }

  return "clean";
}

/**
 * Build the flight's event list from the tracking analysis
 * the PID Lab already computed.
 *
 * @param {object} options {
 *     trackingAnalysis,  // pidAnalysis.detectedColumns.trackingAnalysis
 *     timeSeconds,       // dataset.timeSeconds (row index → seconds)
 *     dataRowOffset      // first data line's index in the source
 *                        // file (telemetry header index + 1), so
 *                        // absolute row anchors map onto dataset rows
 *   }
 * Returns { events, summary } — events sorted by time;
 * summary = { total, clean, overshoot, slow, sentence, worst }.
 */
export function buildFlightEvents({
  trackingAnalysis,
  timeSeconds,
  dataRowOffset = 0
} = {}) {
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

      const windowMs =
        Number.isFinite(dtMs) &&
        Array.isArray(raw.responseWindow)
          ? raw.responseWindow.length * dtMs
          : null;

      const verdict = eventVerdict(raw, settlingMs, windowMs);

      // Events measured on the compacted stable-flight arrays carry
      // their absolute source row; the flight timeline is ONLY read
      // through it. A compacted index is not a substitute — on a real
      // log it lands tens of seconds early — so an event without its
      // anchor keeps t = null and the UI says so, rather than naming
      // a moment the flight never had.
      const datasetRow = Number.isInteger(raw.sampleRowIndex)
        ? raw.sampleRowIndex - dataRowOffset
        : null;

      const responseEndRow = Number.isInteger(raw.responsePeakRowIndex)
        ? raw.responsePeakRowIndex - dataRowOffset
        : null;

      const commandEndRow = Number.isInteger(raw.commandEndRowIndex)
        ? raw.commandEndRowIndex - dataRowOffset
        : null;

      events.push({
        // One identity for card, description, chart and findings:
        // where the command started and ended in the source file.
        id: `${raw.axis}:${raw.sampleRowIndex ?? "?"}:${raw.commandEndRowIndex ?? "?"}`,
        t: datasetRow === null ? null : toSeconds(timeSeconds, datasetRow),
        tEnd:
          commandEndRow === null
            ? null
            : toSeconds(timeSeconds, commandEndRow),
        tResponsePeak:
          responseEndRow === null
            ? null
            : toSeconds(timeSeconds, responseEndRow),
        sample: datasetRow,
        axis: raw.axis,
        kind: "command",
        magnitude: Number.isFinite(raw.commandMagnitude)
          ? Math.round(raw.commandMagnitude)
          : null,
        direction: raw.commandDirection ?? null,
        overshoot_percent: Number.isFinite(raw.overshootPercent)
          ? Math.round(raw.overshootPercent * 10) / 10
          : null,
        overshoot_ds: Number.isFinite(raw.overshootAmount)
          ? Math.round(raw.overshootAmount)
          : null,
        oscillation_ds:
          verdict === "oscillation" &&
          Number.isFinite(raw.ringingAmplitude)
            ? Math.round(raw.ringingAmplitude)
            : null,
        settling_ms: settlingMs,
        verdict
      });
    }
  }

  // Sorted by time; events without a timeline anchor go last
  // instead of masquerading as the start of the flight.
  events.sort((a, b) => {
    const aKnown = Number.isFinite(a.t);
    const bKnown = Number.isFinite(b.t);

    if (aKnown !== bKnown) {
      return aKnown ? -1 : 1;
    }

    return (a.t ?? 0) - (b.t ?? 0);
  });

  const counts = {
    clean: 0,
    overshoot: 0,
    slow: 0,
    lagging: 0,
    oscillation: 0
  };
  for (const event of events) {
    counts[event.verdict] += 1;
  }

  // The worst moment: ranked by the size of the movement in
  // deg/s — absolute swings compare fairly across commands,
  // percentages don't. Slowest settle breaks ties.
  const excursionSize = (event) =>
    Math.max(event.oscillation_ds ?? 0, event.overshoot_ds ?? 0);

  const worst =
    [...events]
      .filter((event) => event.verdict !== "clean")
      .sort((a, b) => {
        const sizeGap = excursionSize(b) - excursionSize(a);
        if (sizeGap !== 0) return sizeGap;
        return (b.settling_ms ?? 0) - (a.settling_ms ?? 0);
      })[0] ?? null;

  const sentence =
    events.length === 0
      ? "No distinct stick commands found in the stable flight sections: smooth cruising, or not enough command activity to judge."
      : `${events.length} clear stick command${events.length === 1 ? "" : "s"} analyzed: ` +
        `${counts.clean} tracked cleanly` +
        (counts.overshoot > 0 ? `, ${counts.overshoot} overshot` : "") +
        (counts.oscillation > 0
          ? `, ${counts.oscillation} oscillated after the input`
          : "") +
        (counts.slow > 0 ? `, ${counts.slow} settled slowly` : "") +
        (counts.lagging > 0
          ? `, ${counts.lagging} still approaching the target when their window closed`
          : "") +
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

/**
 * The chart window that provably CONTAINS the selected event:
 * from just before the command started to just after the response
 * finished (peak or settle), never a fixed slice around one point.
 * Returns null when the event carries no timeline anchor.
 */
export function eventChartWindow(event, paddingSeconds = 1.5) {
  if (!event || !Number.isFinite(event.t)) {
    return null;
  }

  const candidates = [
    event.t,
    Number.isFinite(event.tEnd) ? event.tEnd : null,
    Number.isFinite(event.tResponsePeak) ? event.tResponsePeak : null,
    Number.isFinite(event.settling_ms)
      ? event.t + event.settling_ms / 1000
      : null
  ].filter((value) => Number.isFinite(value));

  const last = Math.max(...candidates);

  return {
    min: Math.max(0, event.t - paddingSeconds),
    max: last + paddingSeconds
  };
}
