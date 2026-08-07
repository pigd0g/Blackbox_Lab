// ======================================================
// TESTS — governor droop reads sustained events
// ======================================================
//
// One sample of target−actual at full logging rate is
// sensor noise, not a governor finding. The droop that
// drives the verdict is smoothed over a quarter second;
// a genuine sustained sag still registers in full, and a
// deep whole-flight dip with the motor output at its
// ceiling is named a power limit, not a gain problem.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { analyzeGovernorLab } from "../src/analysis/governorLabAnalysis.js";

const SAMPLE_RATE = 100;

function baseFlight(durationSeconds) {
  const timeSeconds = [];
  const headspeed = [];
  const governorTarget = [];

  for (let i = 0; i < durationSeconds * SAMPLE_RATE; i += 1) {
    timeSeconds.push(i / SAMPLE_RATE);
    governorTarget.push(1800);
    headspeed.push(1800 + (i % 5) - 2);
  }

  return { timeSeconds, headspeed, governorTarget };
}

test("a single-sample blip does not turn the card red", () => {
  const flight = baseFlight(120);

  // One 80 rpm single-sample glitch mid-flight: 4.4% raw, which
  // used to read as attention. Smoothed over 250 ms it is noise.
  flight.headspeed[6000] = 1720;

  const result = analyzeGovernorLab(flight);

  assert.ok(result, "governor lab should produce a result");
  assert.equal(result.status, "good");
  assert.ok(
    result.droopPercent < 1.2,
    `sustained droop should stay small, got ${result.droopPercent}%`
  );
  // The raw figure remains visible for the curious.
  assert.ok(result.peakSampleDroopRpm >= 70);
});

test("a genuinely sustained sag still registers in full", () => {
  const flight = baseFlight(120);

  // Two full seconds 90 rpm below target: a real 5% sag.
  // The rotor stays inside the stable band (>0.97 of target
  // is not required; the plateau tolerance holds it).
  for (let i = 6000; i < 6200; i += 1) {
    flight.headspeed[i] = 1710;
  }

  const result = analyzeGovernorLab(flight);

  assert.ok(result, "governor lab should produce a result");
  assert.ok(
    result.droopRpm > 60 || result.flightDroopRpm > 60,
    `sustained sag should register, got stable ${result.droopRpm} / flight ${result.flightDroopRpm}`
  );
});

test("a deep dip at full output is named a power limit", () => {
  const flight = baseFlight(120);
  const motorOutput = new Array(flight.headspeed.length).fill(600);

  // Six seconds 15% below target with the output pinned: the
  // bog-down drops out of the stable phase but must be found.
  // (Severe means beyond the fleet's p90 whole-flight dip — a
  // quarter of real flights work their rotor past 8%, so the
  // fixture digs clearly deeper than ordinary hard flying.)
  for (let i = 6000; i < 6600; i += 1) {
    flight.headspeed[i] = 1530;
    motorOutput[i] = 1000;
  }

  const result = analyzeGovernorLab({ ...flight, motorOutput });

  assert.ok(result, "governor lab should produce a result");
  assert.equal(result.status, "attention");
  assert.ok(
    result.flightDroopPercent > 12.5,
    `whole-flight dip should read severe, got ${result.flightDroopPercent}`
  );
  assert.ok(
    result.flightDroopOutputPercent >= 95,
    `output context should show the ceiling, got ${result.flightDroopOutputPercent}`
  );
  assert.match(result.story, /power-system limit/);
});
