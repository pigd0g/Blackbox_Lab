// ======================================================
// TESTS — the vibration floor and the strongest axis
// ======================================================
//
// A gyro spectrum's near-DC bins carry maneuver energy many
// times taller than any real shake. Everything that asks
// "which axis is strongest" or "what is the biggest peak"
// must ignore them — otherwise the advisor studies the
// most-flown axis while the verdict warns about the
// most-shaking one, and the two contradict each other on
// the same page.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VIBRATION_FLOOR_HZ,
  peakMagnitudeAbove
} from "../src/analysis/dsp/fft.js";
import { adviseFilters } from "../src/analysis/filterAdvisor.js";

// A spectrum shaped like the reported MD500E flight: tall
// maneuver energy near DC, a moderate real peak at 227 Hz.
function spectrumWithPeak({ dcMagnitude, peakHz, peakMagnitude }) {
  const frequencies = [];
  const magnitudes = [];

  for (let hz = 0; hz <= 499; hz += 0.5) {
    frequencies.push(hz);

    let magnitude = 0.2;

    if (hz < 2) {
      magnitude = dcMagnitude;
    } else if (peakHz !== null && Math.abs(hz - peakHz) < 0.25) {
      magnitude = peakMagnitude;
    }

    magnitudes.push(magnitude);
  }

  return { frequencies, magnitudes };
}

test("peakMagnitudeAbove ignores near-DC maneuver energy", () => {
  const spectrum = spectrumWithPeak({
    dcMagnitude: 15,
    peakHz: 227,
    peakMagnitude: 3.8
  });

  assert.ok(VIBRATION_FLOOR_HZ > 2);
  assert.equal(peakMagnitudeAbove(spectrum), 3.8);
});

test("the advisor names the peak the verdict warns about", () => {
  const unfiltered = spectrumWithPeak({
    dcMagnitude: 15,
    peakHz: 227,
    peakMagnitude: 3.8
  });

  const advice = adviseFilters({
    unfilteredSpectrum: unfiltered,
    filteredSpectrum: null,
    headspeedRpm: 1284
  });

  assert.ok(advice.rows.length > 0, "the 227 Hz peak must be found");
  assert.ok(
    Math.abs(advice.rows[0].hz - 227) < 1,
    `expected the 227 Hz peak first, got ${advice.rows[0].hz} Hz`
  );
});

test("a genuinely clean raw signal says it is talking about raw data", () => {
  const clean = spectrumWithPeak({
    dcMagnitude: 15,
    peakHz: null,
    peakMagnitude: 0
  });

  const advice = adviseFilters({
    unfilteredSpectrum: clean,
    filteredSpectrum: null,
    headspeedRpm: 1284
  });

  assert.equal(advice.rows.length, 0);
  assert.match(advice.story, /UNFILTERED/);
});
