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

const rawEvent = (overrides) => ({
  axis: "Roll",
  sampleIndex: 20_000, // 10.0 s
  commandMagnitude: 180.4,
  commandDirection: 1,
  overshootPercent: 5,
  settlingDetected: true,
  settlingDurationSamples: 200, // 100 ms
  ...overrides
});

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

test("verdict thresholds: overshoot beats slow, clean is the default", () => {
  const { events, summary } = buildFlightEvents({
    trackingAnalysis: {
      commandEvents: [
        {
          axis: "Roll",
          events: [
            rawEvent({ sampleIndex: 2000, overshootPercent: 40 }),
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
  assert.ok(summary.sentence.includes("3 stick commands analyzed"));
  assert.ok(summary.sentence.includes("Worst: roll at 1.0 s"));
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
