// ======================================================
// TESTS — spectra averaged across every stable run
// ======================================================
//
// One slice makes the noise picture hostage to where the
// slice lands. Averaged across runs, a shake that lives in
// only part of the flight still shows — scaled by how much
// of the flight it lived in — and two logs of the same
// machine tell the same story.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  computeNoiseSpectrum,
  computeNoiseSpectrumOverRuns
} from "../src/analysis/dsp/fft.js";
import { allConsecutiveRuns } from "../src/analysis/evidenceViews.js";

const SAMPLE_RATE = 1000;

function tone(hz, amplitude, samples, offset = 0) {
  const values = new Array(samples);

  for (let i = 0; i < samples; i += 1) {
    values[i] =
      amplitude * Math.sin((2 * Math.PI * hz * (i + offset)) / SAMPLE_RATE);
  }

  return values;
}

function peakNear(spectrum, hz) {
  let best = 0;

  for (let i = 0; i < spectrum.frequencies.length; i += 1) {
    if (
      Math.abs(spectrum.frequencies[i] - hz) <= 2 &&
      spectrum.magnitudes[i] > best
    ) {
      best = spectrum.magnitudes[i];
    }
  }

  return best;
}

test("a shake present in only one run still shows in the average", () => {
  // Run A: clean 45 Hz at amplitude 2. Run B: the same plus a
  // 90 Hz shake at amplitude 6. A single window in run A would
  // miss the shake entirely.
  const runA = tone(45, 2, 8192);
  const runB = tone(45, 2, 8192).map(
    (value, i) => value + 6 * Math.sin((2 * Math.PI * 90 * i) / SAMPLE_RATE)
  );

  const averaged = computeNoiseSpectrumOverRuns(
    [runA, runB],
    SAMPLE_RATE,
    { segmentSize: 4096 }
  );

  assert.ok(averaged);

  const shakeInAverage = peakNear(averaged, 90);
  const shakeInRunA = peakNear(
    computeNoiseSpectrum(runA, SAMPLE_RATE, { segmentSize: 4096 }),
    90
  );

  assert.ok(
    shakeInAverage > 3,
    `the intermittent shake must appear in the average, got ${shakeInAverage}`
  );
  assert.ok(
    shakeInRunA < 0.5,
    "control: the shake is genuinely absent from run A alone"
  );
});

test("runs shorter than one segment sit out instead of skewing bins", () => {
  const result = computeNoiseSpectrumOverRuns(
    [tone(45, 2, 8192), tone(45, 2, 100)],
    SAMPLE_RATE,
    { segmentSize: 4096 }
  );

  assert.ok(result);
  assert.equal(result.segmentSize, 4096);
});

test("allConsecutiveRuns splits an index list at its gaps", () => {
  const runs = allConsecutiveRuns([1, 2, 3, 7, 8, 20]);

  assert.deepEqual(runs, [
    { startIndex: 1, length: 3 },
    { startIndex: 7, length: 2 },
    { startIndex: 20, length: 1 }
  ]);
});
