// ======================================================
// TESTS — Highest-Load Moments earn their name
// ======================================================
//
// Spool-up is not flight load, and a dead current sensor is
// not a load signal. The finder must return nothing rather
// than crowning the earliest windows of the log.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { findHighestLoadEvents } from "../src/analysis/evidenceViews.js";

const seconds = (n) => Array.from({ length: n }, (_, i) => i * 0.01);

test("an all-zero load series produces no events", () => {
  const n = 5000;
  const events = findHighestLoadEvents(
    { timeSeconds: seconds(n), load: Array(n).fill(0) },
    { windowSeconds: 2, count: 3 }
  );

  assert.equal(events.length, 0);
});

test("windows outside the airborne mask cannot win", () => {
  const n = 10000; // 100 s at 100 Hz
  const load = Array(n).fill(10);
  // Huge "load" during the first 20 s (spool-up)…
  for (let i = 0; i < 2000; i += 1) load[i] = 90;
  // …and a genuine flight event at 50–52 s.
  for (let i = 5000; i < 5200; i += 1) load[i] = 60;

  const mask = new Uint8Array(n);
  for (let i = 2500; i < n; i += 1) mask[i] = 1; // airborne after 25 s

  const events = findHighestLoadEvents(
    { timeSeconds: seconds(n), load },
    { windowSeconds: 2, count: 3, qualifiedMask: mask }
  );

  assert.ok(events.length > 0, "the flight event must be found");
  for (const event of events) {
    assert.ok(
      event.startSeconds >= 24,
      `event at ${event.startSeconds}s sits in the masked-out spool-up`
    );
  }
});

test("without a mask, behavior is unchanged", () => {
  const n = 5000;
  const load = Array(n).fill(5);
  for (let i = 3000; i < 3200; i += 1) load[i] = 80;

  const events = findHighestLoadEvents(
    { timeSeconds: seconds(n), load },
    { windowSeconds: 2, count: 1 }
  );

  assert.equal(events.length, 1);
  assert.ok(events[0].peakSeconds > 29 && events[0].peakSeconds < 33);
});
