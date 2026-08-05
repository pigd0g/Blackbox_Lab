// ======================================================
// TESTS — peaks below the filter band point to the bench
// ======================================================
//
// Below ~20 Hz the flight controller itself must respond,
// so no gyro filter may act there. A peak that low is a
// structural story: the advisor must never suggest a notch
// for it, and the filter score must not charge the filters
// for leaving it alone.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { adviseFilters } from "../src/analysis/filterAdvisor.js";
import { assessUnresolvedFindings } from "../src/analysis/filterAnalysis.js";

// A spectrum with a strong 13 Hz structural peak and a normal,
// well-attenuated 1/rev at 45 Hz (2700 rpm).
function spectrumPair() {
  const frequencies = [];
  const raw = [];
  const filtered = [];

  for (let hz = 0; hz <= 300; hz += 0.5) {
    frequencies.push(hz);

    let rawMagnitude = 0.4;
    let filteredMagnitude = 0.2;

    if (Math.abs(hz - 13) < 0.5) {
      rawMagnitude = 12;
      filteredMagnitude = 11.8; // filters rightly untouched
    }

    if (Math.abs(hz - 45) < 0.5) {
      rawMagnitude = 6;
      filteredMagnitude = 0.3; // filters doing their job
    }

    raw.push(rawMagnitude);
    filtered.push(filteredMagnitude);
  }

  return {
    unfilteredSpectrum: { frequencies, magnitudes: raw },
    filteredSpectrum: { frequencies, magnitudes: filtered }
  };
}

test("no notch advice for a peak below the filter band", () => {
  const { unfilteredSpectrum, filteredSpectrum } = spectrumPair();

  const advice = adviseFilters({
    unfilteredSpectrum,
    filteredSpectrum,
    headspeedRpm: 2700
  });

  assert.ok(advice);

  const noteText = advice.recommendations
    .map((entry) => entry.text)
    .join(" | ");

  // The structural peak gets bench advice…
  assert.match(noteText, /below ~20 Hz/);
  assert.match(noteText, /bench|mechanical|structural/i);

  // …and no recommendation treats 13 Hz as a filter problem.
  for (const entry of advice.recommendations) {
    if (/targeted notch|let a meaningful share/.test(entry.text)) {
      assert.doesNotMatch(entry.text, /\b13(\.\d)? Hz/);
    }
  }

  // The row itself is flagged for rendering.
  const structuralRow = advice.rows.find((row) => row.hz === 13);
  assert.ok(structuralRow);
  assert.equal(structuralRow.belowFilterBand, true);
});

test("the score does not charge filters for sub-band vibration", () => {
  // Same measured facts, with and without the structural context:
  // low reduction + elevated residual.
  const blamed = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    matchedPeakCount: 1,
    averageReduction: 8,
    remainingVibration: 40,
    lowFrequencyPeakCount: 0
  });

  const structural = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    matchedPeakCount: 1,
    averageReduction: 8,
    remainingVibration: 40,
    lowFrequencyPeakCount: 1
  });

  assert.ok(
    structural.penalty < blamed.penalty,
    `structural context must reduce the filter-blame penalty (${structural.penalty} vs ${blamed.penalty})`
  );

  // The vibration itself is still charged — the machine does shake.
  assert.ok(
    structural.penalty > 0,
    "elevated residual vibration still costs the score"
  );

  // And the structural finding names the bench.
  const reasons = structural.findings.map((entry) => entry.reason).join(" | ");
  assert.match(reasons, /bench/);
});
