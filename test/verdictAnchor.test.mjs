// ======================================================
// TESTS — vibration verdict anchors to flight rotor speed
// ======================================================
//
// Peak naming divides the peak frequency by the rotor's
// once-per-revolution frequency. That anchor must be the
// rotor speed the machine flew at: when the caller supplies
// the stable-flight mean, a 1/rev peak is named as the main
// rotor even when the log's tail is ground idle that would
// drag a positional average far below flight rpm.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";

// A spectrum with one dominant peak at `peakHz`.
function spectrumWithPeak(peakHz, magnitude) {
  const frequencies = [];
  const magnitudes = [];

  for (let hz = 0; hz <= 400; hz += 1) {
    frequencies.push(hz);
    magnitudes.push(hz === peakHz ? magnitude : 0.2);
  }

  return { frequencies, magnitudes };
}

// Headspeed trace: flown at 2700 rpm, but the last third of the
// log is ground idle — the shape that misleads a positional
// average.
function headspeedWithIdleTail() {
  const values = [];

  for (let i = 0; i < 2000; i += 1) {
    values.push(2700);
  }

  for (let i = 0; i < 1000; i += 1) {
    values.push(300);
  }

  return values;
}

test("anchor names a 1/rev peak as main rotor despite an idle tail", () => {
  const headspeed = headspeedWithIdleTail();

  // 2700 rpm -> 45 Hz once per revolution.
  const verdict = buildFlightVerdict({
    spectra: [{ spectrum: spectrumWithPeak(45, 9) }],
    headspeed,
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: {},
    anchorHeadspeedRpm: 2700
  });

  const vibration = verdict.cards.find((card) => card.key === "vibration");

  assert.ok(vibration, "vibration card expected");
  assert.match(
    vibration.detail,
    /MAIN ROTOR/,
    "1/rev peak should be attributed to the main rotor"
  );
});

test("without an anchor the idle tail mis-names the same peak", () => {
  // Locks the fallback behavior so the anchor's value is visible:
  // the positional average lands near 1900 rpm and 45 Hz no longer
  // ratios to 1/rev.
  const verdict = buildFlightVerdict({
    spectra: [{ spectrum: spectrumWithPeak(45, 9) }],
    headspeed: headspeedWithIdleTail(),
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: {}
  });

  const vibration = verdict.cards.find((card) => card.key === "vibration");

  assert.ok(vibration, "vibration card expected");
  assert.doesNotMatch(vibration.detail, /MAIN ROTOR turning once/);
});

test("a zero or absent anchor falls back rather than dividing by it", () => {
  const verdict = buildFlightVerdict({
    spectra: [{ spectrum: spectrumWithPeak(45, 9) }],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: {},
    anchorHeadspeedRpm: 0
  });

  const vibration = verdict.cards.find((card) => card.key === "vibration");

  assert.ok(vibration, "vibration card still renders without rotor speed");
  assert.match(vibration.detail, /unidentified source/);
});
