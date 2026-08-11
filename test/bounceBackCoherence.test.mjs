// ======================================================
// TESTS — status, confidence and evidence tell ONE story
// ======================================================
//
// An axis that flew clean commands and never overshot has
// nothing to bounce back from. That is an answer about the
// machine — but the whole findings block has to say so
// together: the observation, a confidence built on the
// clean responses that justify it, and a recommendation
// that does not send the pilot collecting evidence their
// good flying is the reason they do not have. A "Clear"
// verdict beside "Insufficient" and "collect more data"
// is a conclusion stronger than its own evidence.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzePids } from "../src/analysis/pidAnalysis.js";

const SAMPLE_RATE = 200;
const SECONDS = 40;

// A synthetic flight whose roll axis flies several distinct,
// cleanly-tracked stick commands: the response follows the
// setpoint with a slight lag and never crosses past it.
function buildFixture() {
  const header =
    "loopIteration,time,setpoint[0],setpoint[1],setpoint[2]," +
    "gyroADC[0],gyroADC[1],gyroADC[2],headspeed";

  const lines = [header];
  const rowCount = SAMPLE_RATE * SECONDS;

  // Commands: 4 s apart, each a 1-second 80 deg/s roll input.
  let previousTarget = 0;

  for (let row = 0; row < rowCount; row += 1) {
    const t = row / SAMPLE_RATE;
    const phase = t % 4;
    const target = phase >= 1 && phase < 2 ? 80 : 0;

    // First-order response with realistic tracking lag: it
    // follows cleanly but never quite reaches the target, so it
    // can never cross past it — no overshoot, and therefore no
    // valid bounce-back measurement anywhere in the flight.
    previousTarget =
      previousTarget + (target * 0.95 - previousTarget) * 0.12;

    lines.push(
      [
        row,
        Math.round(t * 1_000_000),
        target.toFixed(1),
        "0",
        "0",
        previousTarget.toFixed(2),
        "0",
        "0",
        "1800"
      ].join(",")
    );
  }

  const allColumns = header.split(",");

  const analysisContext = {
    telemetry: { allColumns },
    flight: { telemetryHeaderIndex: 0 }
  };

  const sampleIndexes = [];

  for (let row = 1; row <= rowCount; row += 1) {
    sampleIndexes.push(row);
  }

  const headspeedProfiles = [
    { targetRpm: 1800, sampleIndexes }
  ];

  return { analysisContext, lines, headspeedProfiles };
}

test("a clean axis reads as observed, evidenced and settled — not Clear-but-Insufficient", () => {
  const { analysisContext, lines, headspeedProfiles } = buildFixture();

  const result = analyzePids(analysisContext, lines, headspeedProfiles);
  const findings = (result?.findings ?? []).filter((line) =>
    line.startsWith("Roll bounce-back")
  );

  assert.ok(findings.length > 0, "roll bounce-back findings expected");

  const statusLine = findings.find((line) =>
    line.includes("bounce-back status:")
  );
  const confidenceLine = findings.find((line) =>
    line.includes("bounce-back confidence:")
  );
  const recommendationLine = findings.find((line) =>
    line.includes("bounce-back recommendation:")
  );

  assert.match(
    statusLine,
    /No overshoot to recover from/,
    `status must be the observation, got: ${statusLine}`
  );
  assert.ok(
    !/status: Clear/.test(statusLine),
    "the verdict word Clear must not label an unevaluated check"
  );
  assert.ok(
    !/confidence: Insufficient/.test(confidenceLine),
    `clean responses are the evidence — got: ${confidenceLine}`
  );
  assert.match(
    recommendationLine,
    /[Nn]o action needed/,
    `the pilot must not be sent collecting data, got: ${recommendationLine}`
  );
});
