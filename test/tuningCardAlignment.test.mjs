// ======================================================
// TESTS — the Tuning card agrees with the PID Lab
// ======================================================
//
// One source of truth: when the PID Lab's own status says
// "Review", the Home card must not say "crisp response",
// whatever the score. When the Lab says "Clear", the score
// bands speak.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";

function tuningCard(pidAnalysis) {
  const verdict = buildFlightVerdict({
    spectra: [],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis,
    labs: {}
  });

  return verdict.cards.find((card) => card.key === "tuning");
}

test("a Review status reads as watch even with a high score", () => {
  const card = tuningCard({ score: 78, overallStatus: "Review" });

  assert.ok(card);
  assert.equal(card.status, "watch");
  assert.doesNotMatch(card.headline, /crisp/);
  assert.match(card.detail, /PID Lab/);
});

test("a Clear status with a high score stays crisp", () => {
  const card = tuningCard({ score: 88, overallStatus: "Clear" });

  assert.ok(card);
  assert.equal(card.status, "good");
  assert.match(card.headline, /crisp/);
});

test("a Clear status with a low score still reads by the bands", () => {
  const card = tuningCard({ score: 45, overallStatus: "Clear" });

  assert.ok(card);
  assert.equal(card.status, "attention");
});

// A strong, unmanaged peak — the kind the Vibration card flags as
// attention. The tuning number is not touched by it; the verdict is.
function strongVibrationSpectra() {
  const frequencies = [];
  const magnitudes = [];
  for (let hz = 5; hz <= 400; hz += 1) {
    frequencies.push(hz);
    magnitudes.push(hz === 29 ? 40 : 0.4);
  }
  return [{ spectrum: { frequencies, magnitudes } }];
}

test("a high score beside an open vibration finding is read through it, not enjoyed", () => {
  const verdict = buildFlightVerdict({
    spectra: strongVibrationSpectra(),
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: { score: 98, overallStatus: "Clear", confidence: { level: "High" } },
    labs: {}
  });
  const vibration = verdict.cards.find((card) => card.key === "vibration");
  const tuning = verdict.cards.find((card) => card.key === "tuning");

  assert.equal(vibration.status, "attention", "fixture must trip the vibration card");
  assert.equal(tuning.status, "watch");
  assert.match(tuning.headline, /98\/100, read through a vibration finding/);
  assert.doesNotMatch(tuning.action, /Enjoy/);
  assert.match(tuning.action, /Fix the vibration first/);
});

test("a high score on thin evidence is not called crisp", () => {
  const card = tuningCard({
    score: 96,
    overallStatus: "Clear",
    confidence: { level: "Low", score: 25 }
  });

  assert.equal(card.status, "watch");
  assert.match(card.headline, /on thin evidence/);
  assert.doesNotMatch(card.headline, /crisp/);
});

test("a high score at Medium confidence with no vibration stays crisp", () => {
  const card = tuningCard({
    score: 96,
    overallStatus: "Clear",
    confidence: { level: "Medium", score: 60 }
  });

  assert.equal(card.status, "good");
  assert.match(card.headline, /crisp/);
});
