// ======================================================
// TESTS — vibration conclusion layer (detect → filter →
// impact → recommend, severity gated on agreeing signals)
// ======================================================
//
// The controlled Bell 222UT testing is the reference case:
// a real, correctly detected rotor harmonic (raw 7.9 at
// 28.5 Hz), ~99% attenuated, clean filtered gyro, strong
// tracking — and the wording must call that MANAGED, not
// a mechanical fault. Detection sensitivity is untouched;
// only the words earn their evidence.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { assessVibrationConclusion } from "../src/analysis/vibrationSeverity.js";
import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";
import { adviseFilters } from "../src/analysis/filterAdvisor.js";

const BELL_CASE = {
  rawMagnitude: 7.9,
  hz: 28.5,
  source: "main rotor 1/rev",
  reductionPercent: 99,
  residualMagnitude: 0.1,
  trackingConcern: false
};

test("the Bell case: detected, 99% filtered, no control impact — managed, not a fault", () => {
  const conclusion = assessVibrationConclusion(BELL_CASE);

  assert.equal(conclusion.level, "observed");
  assert.equal(conclusion.managed, true);
  assert.equal(conclusion.controlImpact, false);
  assert.match(conclusion.recommendation, /managed successfully/);
  assert.match(conclusion.recommendation, /No change recommended/);
  assert.ok(
    !/check bearings|fix the mechanics/i.test(conclusion.recommendation)
  );
  assert.match(conclusion.detected, /observation, not a diagnosis/);
});

test("raw amplitude alone cannot produce mechanical-warning language", () => {
  // Same raw strength as an alarming peak, but filters contain it.
  const managed = assessVibrationConclusion({
    ...BELL_CASE,
    rawMagnitude: 12
  });

  assert.equal(managed.level, "observed");

  // The moment filters lose containment, severity climbs — one
  // signal at a time.
  const leaking = assessVibrationConclusion({
    ...BELL_CASE,
    rawMagnitude: 12,
    reductionPercent: 50,
    residualMagnitude: 6
  });

  assert.equal(leaking.level, "suspected");

  // "Strong evidence" needs raw + poor filtering + control impact
  // agreeing.
  const confirmed = assessVibrationConclusion({
    ...BELL_CASE,
    rawMagnitude: 12,
    reductionPercent: 50,
    residualMagnitude: 6,
    trackingConcern: true
  });

  assert.equal(confirmed.level, "strong");
  assert.match(confirmed.recommendation, /Multiple signals agree/);
});

test("unknown filtering evidence caps honesty, not sensitivity", () => {
  const unknown = assessVibrationConclusion({
    rawMagnitude: 5,
    hz: 60,
    source: "tail region",
    reductionPercent: null,
    residualMagnitude: null,
    trackingConcern: null
  });

  assert.equal(unknown.level, "review");
  assert.match(unknown.filtering, /cannot be measured/);
  assert.match(unknown.impact, /could not be assessed/);
});

test("the Home vibration card follows the conclusion, end to end", () => {
  // A synthetic spectrum with one strong 28.5 Hz peak, plus the
  // advisor evidence that the filters contain it.
  const frequencies = Array.from({ length: 200 }, (_, i) => i);
  const magnitudes = frequencies.map((hz) =>
    hz === 28 ? 7.9 : 0.2
  );

  const spectra = [
    { label: "gyroRAW[0]", spectrum: { frequencies, magnitudes } }
  ];

  const filteredMagnitudes = frequencies.map(() => 0.1);

  const filterAdvice = adviseFilters({
    unfilteredSpectrum: { frequencies, magnitudes },
    filteredSpectrum: {
      frequencies,
      magnitudes: filteredMagnitudes
    },
    headspeedRpm: 1710
  });

  const verdict = buildFlightVerdict({
    spectra,
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: { score: 95 },
    labs: {},
    anchorHeadspeedRpm: 1710,
    filterAdvice
  });

  const vibration = verdict.cards.find(
    (card) => card.key === "vibration"
  );

  assert.ok(vibration, "vibration card present");
  assert.equal(vibration.status, "good");
  assert.match(vibration.headline, /managed by filtering/);
  assert.ok(!/fix the mechanics/i.test(vibration.action));
  assert.match(vibration.action, /managed successfully/);

  // Without the filtering evidence the same peak stays a
  // bench-review card — sensitivity is intact.
  const blind = buildFlightVerdict({
    spectra,
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: {},
    anchorHeadspeedRpm: 1710
  });

  const blindVibration = blind.cards.find(
    (card) => card.key === "vibration"
  );

  assert.equal(blindVibration.status, "watch");
});

test("the advisor's mechanics-first advice yields to measured containment", () => {
  const frequencies = Array.from({ length: 400 }, (_, i) => i / 2);
  const magnitudes = frequencies.map((hz) =>
    hz === 28.5 ? 9 : 0.15
  );
  const filtered = frequencies.map(() => 0.1);

  const advice = adviseFilters({
    unfilteredSpectrum: { frequencies, magnitudes },
    filteredSpectrum: { frequencies, magnitudes: filtered },
    headspeedRpm: 1710
  });

  const mechanicsFirst = advice.recommendations.find((rec) =>
    /check the mechanics first/i.test(rec.text)
  );

  assert.equal(
    mechanicsFirst,
    undefined,
    "a contained peak must not trigger the mechanics alarm"
  );

  const monitoring = advice.recommendations.find((rec) =>
    /being managed successfully/i.test(rec.text)
  );

  assert.ok(monitoring, "the managed state is said outright");
  assert.equal(monitoring.priority, "gentle");
});
