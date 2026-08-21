// ======================================================
// TESTS — cross-axis I-coupling measurement
// ======================================================
//
// A command on one axis charging another axis's integrator
// is the finding class the Tron 7.0 specimen exposed: pitch
// I builds during a held roll and dumps at release. The
// measurement must find a planted off-axis build, ignore
// the commanded axis itself, and measure the dump from the
// PEAK onward — a peak at the window edge still owns its
// decay.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeCrossAxisIDump,
  crossAxisFindingLines
} from "../src/analysis/crossAxisAnalysis.js";

const SAMPLE_RATE = 100;

// One roll command from sample 100 to 200. Pitch I sits at 4,
// builds to 120 through the command, dumps back to 6 within
// half a second of the peak.
function plantedFixture() {
  const pitchI = new Array(1000).fill(4);

  for (let index = 100; index <= 200; index += 1) {
    pitchI[index] = 4 + ((index - 100) / 100) * 116;
  }

  for (let index = 201; index <= 240; index += 1) {
    pitchI[index] = 120 - ((index - 200) / 40) * 114;
  }

  const rollI = new Array(1000).fill(50);

  return {
    commandEvents: [
      {
        axis: "Roll",
        events: [
          {
            sampleIndex: 100,
            commandEndSampleIndex: 200,
            commandMagnitude: 250,
            sampleRowIndex: 1100,
            commandEndRowIndex: 1200
          }
        ]
      },
      { axis: "Pitch", events: [] }
    ],
    iTermValuesByAxis: { Roll: rollI, Pitch: pitchI }
  };
}

test("a planted off-axis I build is found with peak, baseline and dump", () => {
  const fixture = plantedFixture();

  const pairs = analyzeCrossAxisIDump({
    ...fixture,
    samplesPerSecond: SAMPLE_RATE
  });

  const rollToPitch = pairs.find(
    (pair) => pair.commandAxis === "Roll" && pair.offAxis === "Pitch"
  );

  assert.ok(rollToPitch, "the Roll->Pitch pair must be measured");
  assert.equal(rollToPitch.eventCount, 1);
  assert.ok(Math.abs(rollToPitch.baseline - 4) < 1);
  assert.ok(Math.abs(rollToPitch.strongest.peak - 120) < 2);
  assert.ok(
    rollToPitch.strongest.releaseDrop > 100,
    `the dump after the peak must be measured (got ${rollToPitch.strongest.releaseDrop})`
  );
});

test("the commanded axis never pairs with itself", () => {
  const fixture = plantedFixture();

  const pairs = analyzeCrossAxisIDump({
    ...fixture,
    samplesPerSecond: SAMPLE_RATE
  });

  assert.equal(
    pairs.some((pair) => pair.commandAxis === pair.offAxis),
    false
  );
});

test("a peak at the window edge still owns its decay", () => {
  // Build runs to the very end of command + tail; the dump
  // happens after that edge. The measured drop must cover it.
  const pitchI = new Array(1000).fill(4);
  const tailSamples = 0.6 * SAMPLE_RATE;
  const windowEnd = 200 + tailSamples;

  for (let index = 100; index <= windowEnd; index += 1) {
    pitchI[index] = 4 + ((index - 100) / (windowEnd - 100)) * 116;
  }

  for (let index = windowEnd + 1; index <= windowEnd + 30; index += 1) {
    pitchI[index] = 120 - ((index - windowEnd) / 30) * 110;
  }

  const pairs = analyzeCrossAxisIDump({
    commandEvents: [
      {
        axis: "Roll",
        events: [
          { sampleIndex: 100, commandEndSampleIndex: 200 }
        ]
      }
    ],
    iTermValuesByAxis: { Roll: new Array(1000).fill(50), Pitch: pitchI },
    samplesPerSecond: SAMPLE_RATE
  });

  const rollToPitch = pairs.find(
    (pair) => pair.commandAxis === "Roll" && pair.offAxis === "Pitch"
  );

  assert.ok(rollToPitch);
  assert.ok(
    rollToPitch.strongest.releaseDrop > 80,
    `decay past the window edge must be measured (got ${rollToPitch.strongest.releaseDrop})`
  );
});

test("no sample rate means no measurement, never a guess", () => {
  const fixture = plantedFixture();

  assert.deepEqual(
    analyzeCrossAxisIDump({ ...fixture, samplesPerSecond: null }),
    []
  );
});

test("findings lines carry the probe-parsable format", () => {
  const fixture = plantedFixture();

  const pairs = analyzeCrossAxisIDump({
    ...fixture,
    samplesPerSecond: SAMPLE_RATE
  });

  const lines = crossAxisFindingLines(pairs);

  assert.ok(lines.length > 0);

  const pattern =
    /^Cross-axis I coupling (\w+)->(\w+): baseline ([\d.]+), strongest event peak ([\d.]+) \(delta ([\d.]+), ratio ([\d.]+), release drop ([\d.]+)\) across (\d+) measured events?/;

  for (const line of lines) {
    assert.match(line, pattern);
  }
});
