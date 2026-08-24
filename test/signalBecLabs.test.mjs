// ======================================================
// TESTS — Signal Lab + BEC Lab
// ======================================================
//
// Both labs promise the same discipline as the rest of
// the app: judge against the flight's own levels, weigh
// depth AND duration AND repetition, let the firmware's
// flags outrank any inferred read, and say Not Evaluated
// instead of guessing. These tests pin each promise.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSignalLab } from "../src/analysis/signalLabAnalysis.js";
import {
  analyzeBecLab,
  correlateSignalAndPower
} from "../src/analysis/becLabAnalysis.js";

const RATE = 1000;
const SECONDS = 60;
const LENGTH = RATE * SECONDS;

const timeSeconds = Array.from({ length: LENGTH }, (_, i) => i / RATE);
const headspeed = new Array(LENGTH).fill(1800);

const between = (t0, t1) => (value, base) =>
  Array.from({ length: LENGTH }, (_, i) => {
    const t = i / RATE;
    return t >= t0 && t < t1 ? value : base;
  });

// ---------------- Signal Lab ----------------

test("a steady link with healthy flags reads good with no events", () => {
  const result = analyzeSignalLab({
    timeSeconds,
    rssi: new Array(LENGTH).fill(800).map((v, i) => v + (i % 7)),
    failsafePhase: new Array(LENGTH).fill(0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  assert.equal(result.status, "good");
  assert.equal(result.capability, "full");
  assert.equal(result.events.length, 0);
});

test("a failsafe flag outranks a clean rssi trace", () => {
  const result = analyzeSignalLab({
    timeSeconds,
    rssi: new Array(LENGTH).fill(800),
    failsafePhase: between(30, 30.4)(2, 0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  assert.equal(result.status, "attention");
  assert.equal(result.counts.failsafe, 1);
  const event = result.events.find((e) => e.kind === "failsafe");
  assert.ok(event, "failsafe event expected");
  assert.ok(Math.abs(event.startSeconds - 30) < 0.5);
});

test("signal dips are judged against the flight's own level", () => {
  // Typical 800; one deep dip to 200 for a second.
  const rssi = between(20, 21)(200, 800);

  const result = analyzeSignalLab({
    timeSeconds,
    rssi,
    failsafePhase: new Array(LENGTH).fill(0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  assert.equal(result.counts.deep, 1);
  assert.equal(result.status, "watch");
});

test("flags-only logs are evaluated from flags, not scored on absent rssi", () => {
  const result = analyzeSignalLab({
    timeSeconds,
    rssi: new Array(LENGTH).fill(0),
    failsafePhase: new Array(LENGTH).fill(0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  assert.equal(result.capability, "flags-only");
  assert.equal(result.status, "good");
});

test("no link data at all returns null, never a verdict", () => {
  assert.equal(
    analyzeSignalLab({ timeSeconds, headspeed }),
    null
  );
});

// ---------------- BEC Lab ----------------

const steadyVbec = new Array(LENGTH).fill(745); // 7.45 V in centivolts

test("steady receiver power reads good with the flight's own median as reference", () => {
  const result = analyzeBecLab({
    timeSeconds,
    vbec: steadyVbec,
    headspeed
  });

  assert.equal(result.status, "good");
  assert.ok(Math.abs(result.referenceVolts - 7.45) < 0.02);
  assert.equal(result.events.length, 0);
});

test("a 6 V system is judged against 6 V, not a higher assumed setting", () => {
  const result = analyzeBecLab({
    timeSeconds,
    vbec: new Array(LENGTH).fill(600),
    headspeed
  });

  assert.equal(result.status, "good");
  assert.ok(Math.abs(result.referenceVolts - 6.0) < 0.02);
});

test("a sustained dip is attention; its servo context is read", () => {
  const vbec = between(25, 25.6)(640, 745); // 8.6% below, 600 ms

  // Servos quiet everywhere except a burst elsewhere, so the dip
  // reads as quiet-context.
  const busy = between(40, 41)(1600, 1500);
  const servos = [{ name: "servo[0]", values: busy }];

  const result = analyzeBecLab({
    timeSeconds,
    vbec,
    servos,
    headspeed
  });

  assert.equal(result.status, "attention");
  assert.equal(result.counts.sustained, 1);
  assert.equal(result.events[0].demandContext, "quiet");
});

test("brownout territory with the receiver demonstrably alive reads as a measurement story", () => {
  const vbec = between(25, 26)(110, 745); // 1.1 V for a second

  const alive = analyzeBecLab({
    timeSeconds,
    vbec,
    headspeed,
    receiverStayedAlive: true
  });

  assert.equal(alive.status, "watch");
  assert.equal(alive.implausibleBrownout, true);
  assert.match(alive.story, /measurement path/);

  const unknown = analyzeBecLab({
    timeSeconds,
    vbec,
    headspeed,
    receiverStayedAlive: null
  });

  assert.equal(unknown.status, "attention");
  assert.match(unknown.story, /brownout territory/);
});

test("a dead voltage column returns null, never a verdict", () => {
  assert.equal(
    analyzeBecLab({
      timeSeconds,
      vbec: new Array(LENGTH).fill(25500),
      headspeed
    }),
    null
  );
});

// ---------------- correlation ----------------

test("overlapping link and power events point at each other", () => {
  const signal = analyzeSignalLab({
    timeSeconds,
    rssi: between(25, 25.8)(200, 800),
    failsafePhase: new Array(LENGTH).fill(0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  const bec = analyzeBecLab({
    timeSeconds,
    vbec: between(25.2, 25.9)(640, 745),
    headspeed
  });

  const correlation = correlateSignalAndPower(signal, bec);

  assert.ok(correlation, "overlap expected");
  assert.ok(correlation.overlaps.length >= 1);
  assert.match(correlation.signalSentence, /BEC Lab/);
  assert.match(correlation.becSentence, /Signal Lab/);
});

test("no overlap means no correlation claim", () => {
  const signal = analyzeSignalLab({
    timeSeconds,
    rssi: between(10, 10.5)(200, 800),
    failsafePhase: new Array(LENGTH).fill(0),
    rxSignalReceived: new Array(LENGTH).fill(1),
    rxFlightChannelsValid: new Array(LENGTH).fill(1),
    headspeed
  });

  const bec = analyzeBecLab({
    timeSeconds,
    vbec: between(40, 40.6)(640, 745),
    headspeed
  });

  assert.equal(correlateSignalAndPower(signal, bec), null);
});

// #64: the verdict's minimum is the SUSTAINED view; the chart draws
// raw samples. When a brief raw sample undercuts it, the lab says so
// — the two surfaces stay auditable against each other.
test("a brief raw undercut is stated beside the sustained minimum (#64)", () => {
  const sampleRate = 100;
  const seconds = 60;
  const n = sampleRate * seconds;
  const timeSeconds = Array.from({ length: n }, (_, i) => i / sampleRate);
  // steady 6.11 V (raw scale 611), with 2-sample raw spikes to 6.00 V
  // at 20 s and 40 s — visible on a chart, too brief to sustain.
  const vbec = Array.from({ length: n }, (_, i) => {
    const t = i / sampleRate;
    if ((t > 20 && t < 20.02) || (t > 40 && t < 40.02)) return 600;
    return 611;
  });
  const headspeed = Array.from({ length: n }, () => 1800);
  const lab = analyzeBecLab({ timeSeconds, vbec, headspeed, servos: [] });
  assert.ok(lab, "lab ran");
  assert.ok(lab.rawMinimumVolts <= 6.0, `raw min ${lab.rawMinimumVolts}`);
  assert.ok(lab.minimumVolts > lab.rawMinimumVolts, "sustained min above raw min");
  assert.match(lab.story, /lowest sustained reading/);
  assert.match(lab.story, /briefest raw samples reach 6\.00 V/);
  assert.match(lab.story, /too short|lasted long enough/);
  const rawMetric = lab.metrics.find((m) => m.label === "Briefest raw sample");
  assert.ok(rawMetric, "raw-sample metric present");
  assert.match(rawMetric.value, /6\.00 V/);
});
