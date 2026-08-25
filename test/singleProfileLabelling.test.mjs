// ======================================================
// ONE HEADSPEED IS NOT A RANKING
// ======================================================
//
// "Cleanest", "lowest" and "highest" are placings, and a
// placing needs a field. A flight flown at one headspeed
// has nothing to be placed against, so naming that
// headspeed as both the best and the worst reads as a
// finding when it is only a reflection.
//
// Roughly half of contributed flights run a single
// headspeed, so this is what most pilots see.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { buildLogAnalysis } from "../src/analysis/logAnalysisBuilder.js";
import { aircraftProfiles } from "../src/profiles/aircraftProfiles.js";

const SAMPLE_RATE = 1000;

function wobble(index, amplitude) {
  return (
    Math.sin(index * 0.37) * amplitude +
    Math.cos(index * 1.13) * amplitude * 0.5
  );
}

function buildFlight(banks) {
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
    "govTarget"
  ];

  const lines = [
    `"Craft name","test heli"`,
    `"Firmware revision","Rotorflight 4.5.1 (test) STM32F7X2"`,
    fields.map((name) => `"${name}"`).join(",")
  ];

  let index = 0;

  for (const bank of banks) {
    for (let step = 0; step < bank.seconds * SAMPLE_RATE; step += 1) {
      lines.push(
        [
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
          bank.rpm + wobble(index, 12),
          bank.rpm
        ].join(",")
      );
      index += 1;
    }
  }

  return lines;
}

function analyze(banks) {
  return buildLogAnalysis({
    fileType: "Blackbox BBL Log",
    lines: buildFlight(banks),
    aircraftProfiles
  });
}

function allText(analysis) {
  const pid = analysis.pidAnalysis ?? {};
  return [
    ...(pid.summary ?? []),
    ...(pid.findings ?? []),
    ...(pid.recommendations ?? [])
  ]
    .filter((entry) => typeof entry === "string")
    .join("\n");
}

test("one headspeed is never named both best and worst", () => {
  const text = allText(analyze([{ rpm: 1700, seconds: 60 }]));

  const claimsLowest = /lowest overall tracking error/i.test(text);
  const claimsHighest = /highest overall tracking error/i.test(text);

  assert.equal(
    claimsLowest && claimsHighest,
    false,
    "a single profile cannot hold both places at once"
  );
});

test("a single-headspeed flight says comparison is unavailable", () => {
  const text = allText(analyze([{ rpm: 1700, seconds: 60 }]));

  assert.match(
    text,
    /only headspeed|cannot be compared/i,
    "the pilot should be told why no comparison appears"
  );
});

test("two headspeeds still get a real comparison", () => {
  const text = allText(
    analyze([
      { rpm: 1500, seconds: 40 },
      { rpm: 1800, seconds: 40 }
    ])
  );

  assert.match(text, /lowest overall tracking error/i);
  assert.match(text, /highest overall tracking error/i);
});

test("a lone filter profile is not crowned cleanest", () => {
  const analysis = analyze([{ rpm: 1700, seconds: 60 }]);
  const profiles =
    analysis.filterAnalysis?.profileSpecificFilterAnalysis ?? [];

  assert.equal(profiles.length, 1, "expected exactly one profile");
  assert.notEqual(
    profiles[0].mechanicalFinding?.status,
    "Cleanest Profile",
    "there is no field to be cleanest in"
  );
});

test("a profile that earns a warning keeps it regardless of count", () => {
  // Only the clean label is comparative. "Monitor" and "Needs Review"
  // are earned on a profile's own reading, so a single-profile flight
  // must still be able to raise them.
  const analysis = analyze([{ rpm: 1700, seconds: 60 }]);
  const finding =
    analysis.filterAnalysis?.profileSpecificFilterAnalysis?.[0]
      ?.mechanicalFinding;

  assert.ok(finding?.status, "a single profile still reports a status");
  assert.ok(
    ["Only Profile Measured", "Monitor", "Needs Review"].includes(
      finding.status
    ),
    `unexpected status: ${finding.status}`
  );
});

test("with several profiles, only one holds the Cleanest title", () => {
  const analysis = analyze([
    { rpm: 1500, seconds: 40 },
    { rpm: 1800, seconds: 40 }
  ]);
  const profiles =
    analysis.filterAnalysis?.profileSpecificFilterAnalysis ?? [];
  const cleanest = profiles.filter(
    (profile) =>
      profile.mechanicalFinding?.status === "Cleanest Profile"
  );

  assert.ok(profiles.length >= 2, "expected a multi-profile flight");
  assert.ok(
    cleanest.length <= 1,
    `only one profile may be Cleanest, got ${cleanest.length}`
  );

  // And the title holder is the one the recommendation crowns: the
  // profile with the least remaining filtered vibration.
  if (cleanest.length === 1) {
    const quietest = profiles.reduce((best, current) =>
      (current.mechanicalFinding?.averageFiltered ?? Infinity) <
      (best.mechanicalFinding?.averageFiltered ?? Infinity)
        ? current
        : best
    );
    assert.equal(cleanest[0], quietest);
  }
});

test("a sparse bank cannot hold the Cleanest title, however quiet its few samples (#47 doctrine)", () => {
  // 1.2 s at 1000 Hz ≈ 1200 samples → Low confidence AND 20:1
  // dwarfed by the 60 s bank.
  const analysis = analyze([
    { rpm: 1500, seconds: 60 },
    { rpm: 1900, seconds: 1.2 }
  ]);
  const profiles =
    analysis.filterAnalysis?.profileSpecificFilterAnalysis ?? [];
  const sparse = profiles.find((profile) => profile.targetRpm >= 1800);
  const fat = profiles.find((profile) => profile.targetRpm < 1800);

  if (!sparse?.mechanicalFinding || !fat?.mechanicalFinding) {
    // The sparse bank may not survive profile detection at all —
    // that is an equally acceptable "not compared".
    assert.ok(true);
    return;
  }

  assert.notEqual(
    sparse.mechanicalFinding.status,
    "Cleanest Profile",
    "a Low-confidence sliver must not be crowned"
  );
  if (sparse.mechanicalFinding.status === "Clean — limited evidence") {
    assert.match(
      sparse.mechanicalFinding.summary,
      /too few to compare|Collect more flight time/
    );
  }
  assert.ok(
    ["Cleanest Profile", "Monitor", "Needs Review", "Clean"].includes(
      fat.mechanicalFinding.status
    )
  );
});
