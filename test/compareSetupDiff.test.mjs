// ======================================================
// TESTS — the keeper verdict knows what actually changed
// ======================================================
//
// "Your change helped" presumes exactly one change. The BBL
// header logs the tuning state, so the pair can be told apart:
// no change logged, one named change, or several changes that
// no single verdict may take credit for. And Before/After is
// decided by the logs' own clocks only when they are credible.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  compareFlights,
  extractComparableSetup,
  diffSetups,
  chronologicalOrder
} from "../src/analysis/compareFlights.js";

function lines(settings, start) {
  const out = [`"Log start datetime","${start}"`];
  for (const [k, v] of Object.entries(settings)) {
    out.push(`"${k}","${v}"`);
  }
  return out;
}

test("setup extraction reads settings and start time", () => {
  const setup = extractComparableSetup(
    lines({ rollPID: "50,100,20", gyro_lpf1_static_hz: "100" }, "2026-08-12T10:25:30.000+00:00")
  );
  assert.equal(setup.found, 2);
  assert.equal(setup.settings.rollPID, "50,100,20");
  assert.match(setup.startIso, /^2026-08-12/);
});

test("diff counts only keys present on both sides", () => {
  const a = extractComparableSetup(lines({ rollPID: "50,100,20", pitchPID: "60,110,25" }, "x"));
  const b = extractComparableSetup(lines({ rollPID: "55,100,20", pitchPID: "60,110,25" }, "x"));
  const d = diffSetups(a, b);
  assert.equal(d.changedCount, 1);
  assert.deepEqual(d.changedKeys, ["rollPID"]);
});

test("chronology trusts only credible clocks", () => {
  assert.equal(chronologicalOrder("2026-08-12T10:00:00Z", "2026-08-16T10:00:00Z"), "keep");
  assert.equal(chronologicalOrder("2026-08-16T10:00:00Z", "2026-08-12T10:00:00Z"), "swap");
  // unsynced RTC (year 2000) never decides
  assert.equal(chronologicalOrder("2000-01-23T05:01:19Z", "2026-08-16T10:00:00Z"), null);
  assert.equal(chronologicalOrder(null, "2026-08-16T10:00:00Z"), null);
  assert.equal(chronologicalOrder("2026-08-16T10:00:00Z", "2026-08-16T10:00:00Z"), null);
});

const solid = { level: "High", demand: "sport" };
function goodPair() {
  const spectrum = (mag) => {
    const frequencies = [], magnitudes = [];
    for (let hz = 0; hz < 200; hz += 1) { frequencies.push(hz); magnitudes.push(hz === 30 ? mag : 0.2); }
    return { frequencies, magnitudes };
  };
  const mk = (mag, score) => ({
    spectra: [{ label: "gyro", spectrum: spectrum(mag) }],
    labs: { governor: { droopRpm: mag }, battery: null },
    pidScore: score, pidConfidence: solid, batterySagPercent: null
  });
  return [mk(28, 40), mk(4, 70)];
}

test("several changed settings share the credit as a set", () => {
  const [before, after] = goodPair();
  const result = compareFlights(before, after, {
    setupDiff: { changedCount: 3, changedKeys: ["rollPID", "pitchPID", "gyro_lpf1_static_hz"] }
  });
  assert.doesNotMatch(result.summary, /That's a keeper/);
  assert.match(result.summary, /3 settings changed/);
  assert.match(result.summary, /belongs to the set/);
  assert.match(result.summary, /verifying metric/);
});

test("exactly one changed setting is credited by name", () => {
  const [before, after] = goodPair();
  const result = compareFlights(before, after, {
    setupDiff: { changedCount: 1, changedKeys: ["rollPID"] }
  });
  assert.match(result.summary, /rollPID/);
  assert.match(result.summary, /That's a keeper/);
});

test("no logged change means nothing to keep", () => {
  const [before, after] = goodPair();
  const result = compareFlights(before, after, {
    setupDiff: { changedCount: 0, changedKeys: [] }
  });
  assert.doesNotMatch(result.summary, /That's a keeper/);
  assert.match(result.summary, /NO logged setup change/);
});

test("without setup data, behavior is unchanged", () => {
  const [before, after] = goodPair();
  const result = compareFlights(before, after);
  assert.match(result.summary, /That's a keeper/);
});
