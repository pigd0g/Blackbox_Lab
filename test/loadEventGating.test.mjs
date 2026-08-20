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

// ------------------------------------------------------
// The qualified load envelope: spool-up and the governor's
// first settling seconds run an elevated output plateau
// that outranks real flight moments. The envelope opens at
// the first SUSTAINED stable segment — a short stable brush
// on the way up must not open it — and closes at the last
// stable sample.
// ------------------------------------------------------

import { qualifiedLoadEnvelope } from "../src/analysis/flightPhase.js";

const RATE = 100;

function trace(shapeAt, totalSeconds) {
  const n = RATE * totalSeconds;
  const timeSeconds = [];
  const headspeed = [];
  const governorTarget = [];

  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    timeSeconds.push(t);
    headspeed.push(shapeAt(t));
    governorTarget.push(1800);
  }

  return { timeSeconds, headspeed, governorTarget };
}

test("the load envelope opens after spool-up, not during it", () => {
  const { timeSeconds, headspeed, governorTarget } = trace((t) => {
    if (t < 10) return 0;
    if (t < 20) return ((t - 10) / 10) * 1800; // spool-up ramp
    return 1800 + Math.sin(t * 3) * 4;
  }, 200);

  const envelope = qualifiedLoadEnvelope({
    timeSeconds,
    headspeed,
    governorTarget
  });

  assert.ok(envelope, "a stable flight must yield an envelope");
  assert.ok(
    timeSeconds[envelope.startIndex] >= 18,
    `envelope opens at ${timeSeconds[envelope.startIndex]}s — inside the ramp`
  );
  assert.ok(
    timeSeconds[envelope.endIndex] >= 180,
    "the envelope must reach the end of stable flight"
  );
});

test("a short stable brush on the way up does not open the envelope", () => {
  const { timeSeconds, headspeed, governorTarget } = trace((t) => {
    if (t < 10) return 0;
    if (t < 20) return ((t - 10) / 10) * 1800;
    if (t < 21.5) return 1800; // brief first contact
    if (t < 30) return 1600; // settling dip — not stable
    return 1800 + Math.sin(t * 3) * 4;
  }, 200);

  const envelope = qualifiedLoadEnvelope({
    timeSeconds,
    headspeed,
    governorTarget
  });

  assert.ok(envelope);
  assert.ok(
    timeSeconds[envelope.startIndex] >= 28,
    `envelope opens at ${timeSeconds[envelope.startIndex]}s — on the settling transient`
  );
});

test("no stable flight, no envelope", () => {
  const { timeSeconds, headspeed, governorTarget } = trace(() => 0, 120);

  assert.equal(
    qualifiedLoadEnvelope({ timeSeconds, headspeed, governorTarget }),
    null
  );
});

test("a load series with no distinguished moments yields no events", () => {
  // Constant output (a DIRECT-mode throttle): every window ties,
  // and ranking ties would just crown the earliest windows.
  const n = 10000;
  const events = findHighestLoadEvents(
    { timeSeconds: seconds(n), load: Array(n).fill(62) },
    { windowSeconds: 2, count: 3 }
  );

  assert.equal(events.length, 0);
});
