// ======================================================
// HEADSPEED PROFILES ON UNGOVERNED MODELS
// ======================================================
//
// Profiles are grouped by governor target. A model on an
// ESC or external governor states no target, so the rotor
// speed it actually holds has to stand in for one — and a
// raw measurement cannot: it jitters, and jitter both
// scatters one headspeed across many buckets and reads as
// a governor changing its mind on every sample.
//
// Profiles are what PID and Filter analysis are grouped
// by, so when they come out empty those analyses report
// insufficient evidence and score nothing at all.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { buildLogAnalysis } from "../src/analysis/logAnalysisBuilder.js";
import { aircraftProfiles } from "../src/profiles/aircraftProfiles.js";

const SAMPLE_RATE = 1000;

// Deterministic stand-in for sensor noise.
function wobble(index, amplitude) {
  return (
    Math.sin(index * 0.37) * amplitude +
    Math.cos(index * 1.13) * amplitude * 0.5
  );
}

/**
 * A flight held at one or more headspeeds.
 *
 * @param banks     [{ rpm, seconds }]
 * @param withTarget whether the log states a governor target
 */
function buildFlight(banks, { withTarget }) {
  const fields = [
    "loopIteration",
    "time",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "gyroADC[0]",
    "gyroADC[1]",
    "gyroADC[2]",
    "gyroRAW[0]",
    "gyroRAW[1]",
    "gyroRAW[2]",
    "motor[0]",
    "headspeed",
    ...(withTarget ? ["govTarget"] : [])
  ];

  const lines = [
    `"Craft name","test heli"`,
    `"Firmware revision","Rotorflight 4.5.1 (test) STM32F7X2"`,
    fields.map((name) => `"${name}"`).join(",")
  ];

  let index = 0;

  for (const bank of banks) {
    const samples = bank.seconds * SAMPLE_RATE;

    for (let step = 0; step < samples; step += 1) {
      // Real rotor speed wanders by tens of rpm around the value the
      // pilot is holding — this is the jitter that fragments buckets.
      const measured = bank.rpm + wobble(index, 18);

      const row = [
        index,
        index * (1_000_000 / SAMPLE_RATE),
        wobble(index, 40),
        wobble(index + 7, 40),
        wobble(index + 13, 40),
        wobble(index, 6),
        wobble(index + 5, 6),
        wobble(index + 11, 6),
        wobble(index, 9),
        wobble(index + 5, 9),
        wobble(index + 11, 9),
        700 + wobble(index, 8),
        measured,
        ...(withTarget ? [bank.rpm] : [])
      ];

      lines.push(row.join(","));
      index += 1;
    }
  }

  return lines;
}

function profilesOf(lines) {
  const analysis = buildLogAnalysis({
    fileType: "Blackbox BBL Log",
    lines,
    aircraftProfiles
  });

  return analysis.analysisContext?.flight?.headspeedProfiles ?? [];
}

test("one headspeed with no governor target is one profile", () => {
  const profiles = profilesOf(
    buildFlight([{ rpm: 1700, seconds: 60 }], { withTarget: false })
  );

  assert.equal(
    profiles.length,
    1,
    "rotor-speed jitter must not split one headspeed into several"
  );

  assert.ok(
    Math.abs(profiles[0].targetRpm - 1700) <= 40,
    `expected a profile near 1700 rpm, got ${profiles[0].targetRpm}`
  );
});

test("two headspeeds with no governor target stay two profiles", () => {
  const profiles = profilesOf(
    buildFlight(
      [
        { rpm: 1400, seconds: 40 },
        { rpm: 1700, seconds: 40 }
      ],
      { withTarget: false }
    )
  );

  assert.equal(
    profiles.length,
    2,
    "merging jitter must not also merge genuinely different headspeeds"
  );

  const targets = profiles.map((profile) => profile.targetRpm).sort(
    (first, second) => first - second
  );

  assert.ok(Math.abs(targets[0] - 1400) <= 40, `low bank: ${targets[0]}`);
  assert.ok(Math.abs(targets[1] - 1700) <= 40, `high bank: ${targets[1]}`);
});

test("a stated governor target still groups exactly as before", () => {
  const profiles = profilesOf(
    buildFlight(
      [
        { rpm: 1500, seconds: 40 },
        { rpm: 1800, seconds: 40 }
      ],
      { withTarget: true }
    )
  );

  assert.equal(profiles.length, 2);
  assert.deepEqual(
    profiles.map((profile) => profile.targetRpm),
    [1500, 1800],
    "a governed log groups on the target the firmware states"
  );
});

test("an ungoverned flight keeps most of its stable samples", () => {
  const seconds = 60;
  const profiles = profilesOf(
    buildFlight([{ rpm: 1700, seconds }], { withTarget: false })
  );

  const kept = profiles.reduce(
    (total, profile) => total + profile.sampleCount,
    0
  );

  // Spool-up trimming costs some samples; losing nearly all of them
  // is the failure this test exists to catch.
  assert.ok(
    kept > seconds * SAMPLE_RATE * 0.5,
    `expected over half the flight to survive as stable, kept ${kept}`
  );
});
