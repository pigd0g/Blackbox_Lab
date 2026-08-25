// ======================================================
// BLACKBOX LAB — SERVO LIMIT ANALYSIS
// ======================================================
//
// Detects servo commands pinned at a travel limit. The
// idea comes from the field: in normal flight the FBL
// updates every servo command continuously (tens of ms),
// so a command that FREEZES is suspicious — but freezing
// alone is not enough. On real logs the cyclic servos
// park for whole seconds mid-range in calm hover. The
// discriminating signature is a command frozen AT THE
// EDGE of that servo's own observed travel: the FBL kept
// asking for more and the mixer clipped it — a limit from
// setup, or a moment of genuine control saturation.
//
// Reference is each servo's own flight envelope (robust
// percentiles of its airborne values) — no configuration
// needed, honest on every log.
//
// ======================================================

import {
  detectInFlightSamples,
  estimateSampleRate
} from "./flightPhase.js";

// Rotorflight wiring convention: cyclic servos on S1-S3, the tail
// servo on S4 — and every real log seen so far agrees (the tail
// channel is the one updating every few milliseconds). The raw
// column name rides along so the label stays traceable to the log.
export function servoDisplayName(name) {
  const match = String(name).match(/^servo\[(\d)\]$/);
  if (!match) return name;

  const index = Number(match[1]);
  if (index <= 2) return `Cyclic servo ${index + 1}`;
  if (index === 3) return "Tail servo";
  return `Servo ${index + 1}`;
}

export const SERVO_LIMIT_TUNING = {
  // A command frozen this long, at the edge, is a clipped
  // demand: an unclipped command reverses within a few tens
  // of milliseconds.
  MINIMUM_FREEZE_MS: 100,
  // The freeze must sit INSIDE activity: in the second around
  // it the servo must be updating normally. A scale machine in
  // steady cruise holds its trim — which is often the gentle
  // flight's own envelope edge — for seconds, surrounded by the
  // same stillness; a real clip is a hole punched into motion.
  CONTEXT_WINDOW_SECONDS: 1,
  // How close to the observed edge counts as "at" it, as a
  // share of the servo's own travel span (floored in µs so a
  // barely-moving servo cannot pass on numerics).
  EDGE_TOLERANCE_SPAN_SHARE: 0.02,
  EDGE_TOLERANCE_MINIMUM_US: 4,
  // A servo whose whole airborne travel is narrower than this
  // was parked or unused (nitro throttle servos log constant
  // values) — nothing to judge.
  MINIMUM_SPAN_US: 40,
  MERGE_GAP_SECONDS: 0.5,
  MAXIMUM_EVENTS_PER_SERVO: 12
};

/**
 * @param {object} options {
 *     timeSeconds,   // row index → seconds
 *     headspeed,     // for the airborne gate
 *     servos         // [{ name, values }] command traces in µs
 *   }
 * Returns null when nothing can be judged (no servo data or no
 * airborne flight), else {
 *     servos: [{ name, spanUs, minUs, maxUs, events, longestMs }],
 *     events,          // all events, sorted by time
 *     summary          // one plain sentence
 *   }
 */
export function analyzeServoLimits({
  timeSeconds,
  headspeed,
  servos
} = {}) {
  if (!Array.isArray(servos) || servos.length === 0) {
    return null;
  }

  const airborne = detectInFlightSamples({
    timeSeconds,
    headspeed
  });

  if (!airborne || airborne.length < 100) {
    return null;
  }

  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const tuning = SERVO_LIMIT_TUNING;
  const minimumFreezeSamples = Math.max(
    3,
    Math.round((tuning.MINIMUM_FREEZE_MS / 1000) * sampleRate)
  );

  const airborneSet = new Set(airborne);

  const perServo = [];
  const allEvents = [];

  for (const servo of servos) {
    const values = servo?.values;

    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }

    // Robust envelope of the servo's own airborne travel.
    const airborneValues = [];

    for (const index of airborne) {
      const value = Number(values[index]);
      if (Number.isFinite(value)) {
        airborneValues.push(value);
      }
    }

    if (airborneValues.length < 100) {
      continue;
    }

    airborneValues.sort((a, b) => a - b);

    const percentile = (q) =>
      airborneValues[
        Math.min(
          airborneValues.length - 1,
          Math.floor(airborneValues.length * q)
        )
      ];

    const minUs = percentile(0.001);
    const maxUs = percentile(0.999);
    const spanUs = maxUs - minUs;

    if (spanUs < tuning.MINIMUM_SPAN_US) {
      // Parked or unused — nothing to judge, and saying so
      // would imply a check that never ran.
      continue;
    }

    const edgeTolerance = Math.max(
      tuning.EDGE_TOLERANCE_MINIMUM_US,
      spanUs * tuning.EDGE_TOLERANCE_SPAN_SHARE
    );

    const contextWindowSamples = Math.max(
      minimumFreezeSamples,
      Math.round(tuning.CONTEXT_WINDOW_SECONDS * sampleRate)
    );

    // Longest run of one unchanged value in [from, to) — used to
    // ask whether the servo was actively updating around a
    // candidate freeze. Gaps and non-finite samples break runs.
    const longestFrozenSpan = (from, to) => {
      let longest = 0;
      let current = 0;
      let lastValue = null;

      for (
        let index = Math.max(0, from);
        index < Math.min(values.length, to);
        index += 1
      ) {
        const value = Number(values[index]);

        if (
          Number.isFinite(value) &&
          airborneSet.has(index) &&
          value === lastValue
        ) {
          current += 1;
        } else {
          current = Number.isFinite(value) ? 1 : 0;
        }

        lastValue = Number.isFinite(value) ? value : null;

        if (current > longest) {
          longest = current;
        }
      }

      return longest;
    };

    const surroundedByActivity = (startIndex, endIndex) => {
      const before = longestFrozenSpan(
        startIndex - contextWindowSamples,
        startIndex
      );
      const after = longestFrozenSpan(
        endIndex + 1,
        endIndex + 1 + contextWindowSamples
      );

      // Both flanks must show normal update activity — a calm
      // stretch on either side means the hold belongs to calm
      // flying, not to a clipped demand.
      return (
        before < minimumFreezeSamples &&
        after < minimumFreezeSamples
      );
    };

    // Scan airborne samples for frozen runs at either edge.
    const events = [];
    let runStart = null;
    let runValue = null;
    let runLength = 0;
    let previousIndex = null;

    const closeRun = (endIndex) => {
      if (
        runStart === null ||
        runLength < minimumFreezeSamples
      ) {
        runStart = null;
        runValue = null;
        runLength = 0;
        return;
      }

      const atMin = Math.abs(runValue - minUs) <= edgeTolerance;
      const atMax = Math.abs(runValue - maxUs) <= edgeTolerance;

      if (
        (atMin || atMax) &&
        surroundedByActivity(runStart, endIndex)
      ) {
        const startSeconds = timeSeconds[runStart];
        const endSeconds = timeSeconds[endIndex];

        events.push({
          servo: servo.name,
          side: atMax ? "max" : "min",
          valueUs: runValue,
          startSeconds,
          endSeconds,
          durationMs: Math.round(
            (endSeconds - startSeconds) * 1000
          )
        });
      }

      runStart = null;
      runValue = null;
      runLength = 0;
    };

    for (const index of airborne) {
      const value = Number(values[index]);

      const continuous =
        previousIndex !== null && index === previousIndex + 1;

      if (
        !Number.isFinite(value) ||
        !continuous ||
        value !== runValue
      ) {
        closeRun(previousIndex ?? index);

        if (Number.isFinite(value)) {
          runStart = index;
          runValue = value;
          runLength = 1;
        }
      } else {
        runLength += 1;
      }

      previousIndex = index;
    }

    closeRun(previousIndex);

    // Merge events separated by less than the merge gap — one
    // sustained clip that flickers is one event.
    const merged = [];

    for (const event of events) {
      const last = merged[merged.length - 1];

      if (
        last &&
        last.side === event.side &&
        event.startSeconds - last.endSeconds <=
          tuning.MERGE_GAP_SECONDS
      ) {
        last.endSeconds = event.endSeconds;
        last.durationMs = Math.round(
          (last.endSeconds - last.startSeconds) * 1000
        );
      } else {
        merged.push({ ...event });
      }
    }

    const capped = merged
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, tuning.MAXIMUM_EVENTS_PER_SERVO)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    perServo.push({
      name: servo.name,
      minUs,
      maxUs,
      spanUs: Math.round(spanUs),
      events: capped,
      longestMs: capped.reduce(
        (longest, event) => Math.max(longest, event.durationMs),
        0
      )
    });

    allEvents.push(...capped);
  }

  if (perServo.length === 0) {
    return null;
  }

  allEvents.sort((a, b) => a.startSeconds - b.startSeconds);

  const affected = perServo.filter(
    (servo) => servo.events.length > 0
  );

  const summary =
    affected.length === 0
      ? `No servo command sat frozen at its travel edge in flight: all ${perServo.length} active servos used their range freely.`
      : `${affected
          .map(
            (servo) =>
              `${servoDisplayName(servo.name)} pinned at its ${servo.events[0].side === "max" ? "upper" : "lower"} edge ${servo.events.length}× (longest ${servo.longestMs} ms)`
          )
          .join("; ")}. A command frozen at the edge of its own travel means the flight controller was asking for more than the setup allows. Check servo travel/limit settings, or read it alongside the saturation findings as genuine control saturation.`;

  return {
    servos: perServo,
    events: allEvents,
    summary,
    status: affected.length > 0 ? "detected" : "clear"
  };
}
