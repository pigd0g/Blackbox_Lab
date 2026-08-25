// ======================================================
// TESTS — capability chips answer for data, not columns
// ======================================================
//
// A column can exist and carry nothing: an unplugged RPM
// wire logs headspeed as constant zero, a dead current
// sensor logs zero amps all flight. The quality gate's
// whole job is honesty about the input — a chip that
// promises "fully measurable" for an empty column teaches
// exactly the wrong thing. In the contributed corpus,
// 16 % of contributed flights carry at least one dead column.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  assessLogQuality,
  columnCarriesData
} from "../src/analysis/logQuality.js";

test("a dead column is not data", () => {
  assert.equal(columnCarriesData([0, 0, 0, 0]), false);
  assert.equal(columnCarriesData([null, null]), false);
  assert.equal(columnCarriesData([]), false);
  assert.equal(columnCarriesData(null), false);
  assert.equal(columnCarriesData([0, 0, 1480, 1490]), true);
});

test("an unplugged RPM wire does not promise governor analysis", () => {
  // Flags computed the way the app now computes them: through
  // columnCarriesData over the actual column values.
  const deadHeadspeed = new Array(5000).fill(0);
  const liveVbat = new Array(5000).fill(2350);

  const quality = assessLogQuality({
    sampleRateHz: 1000,
    durationSeconds: 300,
    hasUnfilteredGyro: true,
    hasFilteredGyro: true,
    hasHeadspeed: columnCarriesData(deadHeadspeed),
    hasGovernorTarget: columnCarriesData(deadHeadspeed),
    hasVbat: columnCarriesData(liveVbat),
    hasAmperage: columnCarriesData(new Array(5000).fill(0))
  });

  const governor = quality.capabilities.find(
    (chip) => chip.name === "Governor"
  );
  const power = quality.capabilities.find(
    (chip) => chip.name === "Battery & ESC"
  );

  assert.equal(
    governor.level,
    "missing",
    "no usable rotor data must read as missing, not full"
  );
  assert.equal(
    power.level,
    "partial",
    "a dead current sensor is voltage-only"
  );
});

test("the excellent-log summary speaks about data, not confidence", () => {
  const quality = assessLogQuality({
    sampleRateHz: 1000,
    durationSeconds: 300,
    hasUnfilteredGyro: true,
    hasFilteredGyro: true,
    hasHeadspeed: true,
    hasGovernorTarget: true,
    hasVbat: true,
    hasAmperage: true,
    hasRssi: true,
    hasLinkFlags: true,
    hasVbec: true
  });

  assert.match(quality.summary, /data it needs/);
  assert.ok(
    !/full confidence/.test(quality.summary),
    "confidence is the analyses' own word to use"
  );
});

test("signal and receiver-power chips state their telemetry honestly", () => {
  const flagsOnly = assessLogQuality({
    sampleRateHz: 1000,
    durationSeconds: 300,
    hasUnfilteredGyro: true,
    hasFilteredGyro: true,
    hasHeadspeed: true,
    hasGovernorTarget: true,
    hasVbat: true,
    hasAmperage: true,
    hasRssi: false,
    hasLinkFlags: true,
    hasVbec: false
  });

  const signal = flagsOnly.capabilities.find(
    (c) => c.name === "Signal & link"
  );
  const bec = flagsOnly.capabilities.find(
    (c) => c.name === "BEC output"
  );

  assert.equal(signal.level, "partial");
  assert.match(signal.note, /flags only/i);
  assert.equal(bec.level, "missing");
  assert.match(bec.note, /BEC voltage/);
});
