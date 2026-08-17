// ======================================================
// BLACKBOX LAB — FLIGHT EVENTS TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// The event layer only REPACKAGES what the tracking
// analysis computed — these tests pin the packaging:
// times, verdict thresholds, ordering, and the summary
// sentence a pilot reads.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFlightEvents } from "../src/analysis/flightEvents.js";

// 2 kHz log: rows are 0.5 ms apart.
const timeSeconds = Array.from({ length: 100_000 }, (_, i) => i * 0.0005);

const rawEvent = (overrides) => {
  const merged = {
    axis: "Roll",
    sampleIndex: 20_000, // 10.0 s
    commandMagnitude: 180.4,
    commandDirection: 1,
    overshootPercent: 5,
    settlingDetected: true,
    settlingDurationSamples: 200, // 100 ms
    ...overrides
  };

  // Tests run with dataRowOffset 0, so unless a test states its own
  // anchor, the absolute row IS the sample index. An event without
  // any anchor is the explicit subject of its own test below.
  if (!("sampleRowIndex" in merged)) {
    merged.sampleRowIndex = merged.sampleIndex;
  }

  return merged;
};

test("events carry time, axis and rounded measurements", () => {
  const { events } = buildFlightEvents({
    trackingAnalysis: { commandEvents: [{ axis: "Roll", events: [rawEvent({})] }] },
    timeSeconds
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].t, 10);
  assert.equal(events[0].axis, "Roll");
  assert.equal(events[0].kind, "command");
  assert.equal(events[0].magnitude, 180);
  assert.equal(events[0].settling_ms, 100);
  assert.equal(events[0].verdict, "clean");
});

test("an absolute row anchor beats the compacted stable-array index", () => {
  // Events are measured on the compacted stable-flight arrays,
  // so their sampleIndex means nothing on the flight timeline.
  // With sampleRowIndex present, the time must come from it —
  // offset by the first data line — never from sampleIndex.
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Yaw",
          events: [
            rawEvent({
              axis: "Yaw",
              sampleIndex: 8_300, // compacted → 4.15 s, WRONG
              sampleRowIndex: 40_100 // line index in the file
            })
          ]
        }
      ]
    },
    timeSeconds,
    dataRowOffset: 100 // telemetry header at line 99
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].sample, 40_000);
  assert.equal(events[0].t, 20);
});

test("verdict thresholds: overshoot beats slow, clean is the default", () => {
  const { events, summary } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Roll",
          events: [
            rawEvent({
              sampleIndex: 2000,
              overshootPercent: 40,
              overshootAmount: 72 // deg/s — clears the absolute bar
            }),
            rawEvent({
              sampleIndex: 6000,
              overshootPercent: 3,
              settlingDurationSamples: 1400 // 700 ms → slow
            }),
            rawEvent({ sampleIndex: 10_000 })
          ]
        }
      ]
    },
    timeSeconds
  });

  assert.deepEqual(
    events.map((event) => event.verdict),
    ["overshoot", "slow", "clean"]
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.overshoot, 1);
  assert.equal(summary.slow, 1);
  assert.equal(summary.clean, 1);
  assert.equal(summary.worst.verdict, "overshoot");
  assert.ok(summary.sentence.includes("3 clear stick commands analyzed"));
  assert.ok(summary.sentence.includes("Worst: roll at 1.0 s"));
});

test("overshoot needs an absolute movement, not just a percentage", () => {
  // 50% of a 16 deg/s nudge is 8 deg/s — noise-sized. The percent
  // clears the review bar, the movement does not, and the verdict
  // must stay clean (this is the RS6 hover-log failure mode).
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Roll",
          events: [
            rawEvent({
              sampleIndex: 2000,
              commandMagnitude: 16,
              overshootPercent: 50,
              overshootAmount: 8
            })
          ]
        }
      ]
    },
    timeSeconds
  });

  assert.equal(events[0].verdict, "clean");
});

test("repeated strong swings across the target read as oscillation, not overshoot", () => {
  const { events, summary } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Roll",
          events: [
            rawEvent({
              sampleIndex: 2000,
              commandMagnitude: 30,
              overshootPercent: 120,
              overshootAmount: 30,
              ringingEligible: true,
              strongRingingCrossingCount: 9,
              ringingAmplitude: 45
            })
          ]
        }
      ]
    },
    timeSeconds
  });

  assert.equal(events[0].verdict, "oscillation");
  assert.equal(events[0].oscillation_ds, 45);
  assert.equal(summary.oscillation, 1);
  assert.ok(summary.sentence.includes("oscillated after the input"));
});

test("a response that never reached the target in a fair window reads lagging, not clean", () => {
  const longWindow = new Array(1200).fill(0); // 600 ms at 2 kHz

  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Pitch",
          events: [
            rawEvent({
              axis: "Pitch",
              sampleIndex: 2000,
              overshootPercent: null,
              settlingDetected: false,
              settlingDurationSamples: null,
              responseReachedTarget: false,
              responseWindow: longWindow
            }),
            // Window cut short by the next input: proves nothing,
            // stays clean.
            rawEvent({
              axis: "Pitch",
              sampleIndex: 6000,
              overshootPercent: null,
              settlingDetected: false,
              settlingDurationSamples: null,
              responseReachedTarget: false,
              responseWindow: new Array(40).fill(0)
            })
          ]
        }
      ]
    },
    timeSeconds
  });

  assert.equal(events[0].verdict, "lagging");
  assert.equal(events[1].verdict, "clean");
});

test("events merge across axes and sort by time", () => {
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        { axis: "Roll", events: [rawEvent({ sampleIndex: 40_000 })] },
        { axis: "Yaw", events: [rawEvent({ axis: "Yaw", sampleIndex: 4000 })] }
      ]
    },
    timeSeconds
  });

  assert.deepEqual(
    events.map((event) => event.axis),
    ["Yaw", "Roll"]
  );
});

test("no commands found is an honest sentence, not an error", () => {
  const { events, summary } = buildFlightEvents({
    trackingAnalysis: { commandEvents: [] },
    timeSeconds
  });

  assert.equal(events.length, 0);
  assert.equal(summary.worst, null);
  assert.ok(summary.sentence.includes("No distinct stick commands"));

  const empty = buildFlightEvents({});
  assert.equal(empty.events.length, 0);
});

// ------------------------------------------------------
// Canonical event identity (issue: card, description,
// chart window and findings can desynchronize)
// ------------------------------------------------------

import { eventChartWindow } from "../src/analysis/flightEvents.js";

test("an event without an absolute anchor gets no invented time", () => {
  // The compacted stable-array index lands tens of seconds early
  // on real logs. Without sampleRowIndex the event keeps t = null
  // and sorts last — it never names a moment the flight never had.
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Yaw",
          events: [
            rawEvent({ axis: "Yaw", sampleIndex: 8_300, sampleRowIndex: null }),
            rawEvent({ axis: "Yaw", sampleIndex: 4_000 })
          ]
        }
      ]
    },
    timeSeconds
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].t, 2, "anchored event first");
  assert.equal(events[1].t, null, "anchorless event has no time");
  assert.equal(events[1].verdict, "clean", "verdict still computed");
});

test("every event carries a stable identity", () => {
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Yaw",
          events: [
            rawEvent({ axis: "Yaw", sampleIndex: 4_000, commandEndSampleIndex: 4_400, commandEndRowIndex: 4_400 }),
            rawEvent({ axis: "Yaw", sampleIndex: 6_000, commandEndSampleIndex: 6_500, commandEndRowIndex: 6_500 })
          ]
        },
        {
          axis: "Roll",
          events: [
            rawEvent({ sampleIndex: 4_000, commandEndSampleIndex: 4_400, commandEndRowIndex: 4_400 })
          ]
        }
      ]
    },
    timeSeconds
  });

  const ids = events.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
});

test("the event chart window contains the whole event, response included", () => {
  const { events } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Yaw",
          events: [
            rawEvent({
              axis: "Yaw",
              sampleIndex: 110_400,
              sampleRowIndex: 110_400, // beyond timeSeconds? no — keep in range
              commandEndRowIndex: 111_000,
              responsePeakRowIndex: 112_000,
              settlingDurationSamples: 2_416 // 1208 ms
            })
          ]
        }
      ]
    },
    timeSeconds: Array.from({ length: 200_000 }, (_, i) => i * 0.0005)
  });

  const event = events[0];
  const window = eventChartWindow(event);

  assert.ok(window, "anchored event yields a window");
  assert.ok(window.min <= event.t, "window starts before the command");
  assert.ok(
    window.max >= event.tResponsePeak,
    "window covers the response peak"
  );
  assert.ok(
    window.max >= event.t + event.settling_ms / 1000,
    "window covers the settling tail"
  );

  assert.equal(eventChartWindow({ t: null }), null);
  assert.equal(eventChartWindow(null), null);
});
