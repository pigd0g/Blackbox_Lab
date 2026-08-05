// ======================================================
// LOGS WITHOUT A GOVERNOR TARGET
// ======================================================
//
// Models flown on an ESC or external governor log rotor
// speed with no governor target beside it. Everything the
// ESC and Battery Labs read — motor output, pack voltage,
// current — is present in those logs, so both Labs run on
// them. Governor tracking, which is measured against the
// target, is the one thing that cannot be scored.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzeEscLab } from "../src/analysis/escLabAnalysis.js";
import { analyzeBatteryLab } from "../src/analysis/batteryLabAnalysis.js";
import { analyzeGovernorLab } from "../src/analysis/governorLabAnalysis.js";
import { findHighestLoadEvents } from "../src/analysis/evidenceViews.js";

const SAMPLE_RATE = 1000;
const SECONDS = 60;
const SAMPLE_COUNT = SAMPLE_RATE * SECONDS;

// Deterministic stand-in for sensor noise.
function wobble(index, amplitude) {
  return (
    Math.sin(index * 0.37) * amplitude +
    Math.cos(index * 1.13) * amplitude * 0.5
  );
}

function buildGovernorlessFlight() {
  const timeSeconds = [];
  const headspeed = [];
  const motor = [];
  const escThrottle = [];
  const vbat = [];
  const escCurrent = [];

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const seconds = index / SAMPLE_RATE;
    timeSeconds.push(seconds);

    // Three seconds of spool-up, then governed-looking flight
    // held by an ESC governor the log knows nothing about.
    const spooling = seconds < 3;
    const spoolFraction = Math.min(1, seconds / 3);

    headspeed.push(
      spooling
        ? 1800 * spoolFraction
        : 1800 + wobble(index, 6)
    );
    motor.push(spooling ? 700 * spoolFraction : 720 + wobble(index, 8));
    escThrottle.push(
      spooling ? 700 * spoolFraction : 725 + wobble(index, 8)
    );
    vbat.push(spooling ? 5000 : 4900 + wobble(index, 12));
    escCurrent.push(spooling ? 500 : 2600 + wobble(index, 90));
  }

  return {
    timeSeconds,
    headspeed,
    motor,
    escThrottle,
    vbat,
    escCurrent
  };
}

const flight = buildGovernorlessFlight();

test("the ESC Lab reads a log that carries no governor target", () => {
  const result = analyzeEscLab({
    timeSeconds: flight.timeSeconds,
    motor: flight.motor,
    escThrottle: flight.escThrottle,
    amperage: null,
    escCurrent: flight.escCurrent,
    vbat: flight.vbat,
    escVoltage: null,
    headspeed: flight.headspeed,
    governorTarget: null
  });

  assert.ok(
    result,
    "motor output is present, so the ESC Lab has something to report"
  );
  assert.ok(
    result.metrics.length > 0,
    "a readable ESC Lab result carries metrics"
  );
});

test("the Battery Lab reads a log that carries no governor target", () => {
  const result = analyzeBatteryLab({
    timeSeconds: flight.timeSeconds,
    vbat: flight.vbat,
    escVoltage: null,
    amperage: null,
    escCurrent: flight.escCurrent,
    headspeed: flight.headspeed,
    governorTarget: null
  });

  assert.ok(
    result,
    "pack voltage is present, so the Battery Lab has something to report"
  );
  assert.ok(
    result.metrics.length > 0,
    "a readable Battery Lab result carries metrics"
  );
});

test("governor scoring still waits for a governor target", () => {
  const result = analyzeGovernorLab({
    timeSeconds: flight.timeSeconds,
    headspeed: flight.headspeed,
    governorTarget: null
  });

  assert.equal(
    result,
    null,
    "tracking error and droop are measured against a target"
  );
});

test("an undefined governor target is handled like an absent one", () => {
  assert.ok(
    analyzeEscLab({
      timeSeconds: flight.timeSeconds,
      motor: flight.motor,
      escThrottle: flight.escThrottle,
      amperage: null,
      escCurrent: flight.escCurrent,
      vbat: flight.vbat,
      escVoltage: null,
      headspeed: flight.headspeed
    }),
    "the ESC Lab tolerates the parameter being left off entirely"
  );

  assert.ok(
    analyzeBatteryLab({
      timeSeconds: flight.timeSeconds,
      vbat: flight.vbat,
      escVoltage: null,
      amperage: null,
      escCurrent: flight.escCurrent,
      headspeed: flight.headspeed
    }),
    "the Battery Lab tolerates the parameter being left off entirely"
  );
});

test("one load peak on a window seam is one reported moment", () => {
  const timeSeconds = [];
  const load = [];

  // A single sharp current spike, placed so the stepped search
  // windows meet across it.
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const seconds = index / SAMPLE_RATE;
    timeSeconds.push(seconds);

    const distanceFromSpike = Math.abs(seconds - 30);
    load.push(
      distanceFromSpike < 0.25
        ? 60 - distanceFromSpike * 20
        : 20 + wobble(index, 0.5)
    );
  }

  const events = findHighestLoadEvents(
    { timeSeconds, load },
    { windowSeconds: 2, count: 3 }
  );

  const aroundSpike = events.filter(
    (event) =>
      event.startSeconds <= 30.5 && event.endSeconds >= 29.5
  );

  assert.equal(
    aroundSpike.length,
    1,
    "the spike is one load moment, however the windows fall across it"
  );
});
