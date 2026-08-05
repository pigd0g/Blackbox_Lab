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
