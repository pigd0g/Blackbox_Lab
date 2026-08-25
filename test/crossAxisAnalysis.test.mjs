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
  crossAxisFindingLines,
  crossAxisPairStatus,
  CROSS_AXIS_REVIEW_BARS
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
    assert.match(
      line,
      / — (Review|Observed)$/,
      "every findings line must end with its status"
    );
  }
});

test("review bars exist only where the ratio leg is comparable", () => {
  // Bars cover the four pairs whose off axis is cyclic. Pairs with
  // yaw as the off axis have no bar: yaw |I| baselines run in the
  // hundreds, so a peak-over-baseline ratio means something
  // different there.
  assert.deepEqual(
    Object.keys(CROSS_AXIS_REVIEW_BARS).sort(),
    ["Pitch->Roll", "Roll->Pitch", "Yaw->Pitch", "Yaw->Roll"]
  );

  for (const bars of Object.values(CROSS_AXIS_REVIEW_BARS)) {
    assert.ok(bars.ratio > 0);
    assert.ok(bars.delta > 0);
  }
});

const statusPair = (strongest, commandAxis = "Roll", offAxis = "Pitch") => ({
  commandAxis,
  offAxis,
  eventCount: 1,
  baseline: 3,
  medianPeak: strongest.peak ?? null,
  strongest
});

test("a specimen-grade dump reads Review", () => {
  // The annotated Tron 7.0 felt-pitch-up numbers: ratio and delta
  // above their bars, most of the built charge released in the tail.
  assert.equal(
    crossAxisPairStatus(
      statusPair({ peak: 204, ratio: 68, delta: 201, releaseDrop: 160 })
    ),
    "Review"
  );
});

test("high ratio over a near-zero baseline stays Observed", () => {
  // Ratio alone would flag this; the delta leg is what refuses a
  // 64-peak event dressed up by a baseline of one.
  assert.equal(
    crossAxisPairStatus(
      statusPair({ peak: 64, ratio: 64, delta: 64, releaseDrop: 64 })
    ),
    "Observed"
  );
});

test("a softened release below the ratio bar stays Observed", () => {
  // The technique rerun of the same maneuvers: same craft, same
  // tune, ratio well under the bar.
  assert.equal(
    crossAxisPairStatus(
      statusPair({ peak: 208, ratio: 17.3, delta: 196, releaseDrop: 141 })
    ),
    "Observed"
  );
});

test("a build that never dumps stays Observed", () => {
  // Ratio and delta clear their bars, but the charge holds through
  // the tail — no release, no felt movement, no Review.
  assert.equal(
    crossAxisPairStatus(
      statusPair({ peak: 204, ratio: 68, delta: 201, releaseDrop: 40 })
    ),
    "Observed"
  );
});

test("pairs without bars are Observed by definition", () => {
  assert.equal(
    crossAxisPairStatus(
      statusPair(
        { peak: 900, ratio: 80, delta: 800, releaseDrop: 700 },
        "Roll",
        "Yaw"
      )
    ),
    "Observed"
  );
});
