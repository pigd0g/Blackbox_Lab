// ======================================================
// TESTS — PID-term saturation is scored on qualified
// flight evidence
// ======================================================
//
// A term winding against a grounded airframe — landing,
// shutdown, post-flight — is not a tuning finding. The
// saturation checks must read the same qualified flight
// rows the tracking analysis reads: activity outside that
// window cannot create a Review, and activity inside it
// still must. A Review that does fire names the moment it
// happened, so the finding can be audited on the charts.
//
// The response-behavior checks (bounce-back, settling,
// ringing) also export as structured data, so surfaces
// that cannot show the technical findings list — the
// exported report — carry the same picture.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzePids } from "../src/analysis/pidAnalysis.js";

const SAMPLE_RATE = 200;
const SECONDS = 60;
const ROW_COUNT = SAMPLE_RATE * SECONDS;
const WINDOW_END_ROW = SAMPLE_RATE * 40; // qualified flight: first 40 s

// A flight whose Roll I-term is supplied per row; the rotor holds
// steady and the sticks stay quiet. The qualified window covers only
// the first 40 s — everything after is landing/post-flight rows that
// the profiles never sampled.
function buildFlight(iTermAt) {
  const header =
    "loopIteration,time,setpoint[0],setpoint[1],setpoint[2]," +
    "gyroADC[0],gyroADC[1],gyroADC[2]," +
    "axisP[0],axisP[1],axisP[2]," +
    "axisI[0],axisI[1],axisI[2]," +
    "axisD[0],axisD[1],axisD[2],headspeed";

  const lines = [header];

  for (let row = 0; row < ROW_COUNT; row += 1) {
    const t = row / SAMPLE_RATE;

    // Gentle varying activity so no term sits at a constant value,
    // anchored by one brief spike so the column's maximum is a
    // single real event. A pure sine (or a constant) rides its own
    // maximum every cycle by definition and would fake near-peak
    // dwell that no real flight term shows.
    const wobble =
      t >= 30 && t < 30.05 ? 30 : 10 + 5 * Math.sin(t * 2);

    lines.push(
      [
        row,
        Math.round(t * 1_000_000),
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        wobble.toFixed(2),
        wobble.toFixed(2),
        wobble.toFixed(2),
        iTermAt(t).toFixed(2),
        wobble.toFixed(2),
        wobble.toFixed(2),
        wobble.toFixed(2),
        wobble.toFixed(2),
        wobble.toFixed(2),
        "1800"
      ].join(",")
    );
  }

  const sampleIndexes = [];
  for (let row = 1; row <= WINDOW_END_ROW; row += 1) {
    sampleIndexes.push(row);
  }

  return analyzePids(
    {
      telemetry: { allColumns: header.split(",") },
      flight: { telemetryHeaderIndex: 0 }
    },
    lines,
    [{ targetRpm: 1800, sampleIndexes }]
  );
}

// ~2.1 s pinned at 100 starting at `at` seconds; gentle wobble
// otherwise, with one brief in-window anchor spike so the term's
// maximum is a single real event — a periodic wobble that kisses
// its own maximum every cycle is not how flight I-terms behave,
// and it would fake near-peak dwell time.
const iTermWithRunAt = (at) => (t) => {
  if (t >= at && t < at + 2.1) return 100;
  if (t >= 30 && t < 30.05) return 30;
  return 10 + 6 * Math.sin(t * 1.7);
};

const rollISaturationLine = (result) =>
  (result.findings ?? []).find(
    (line) =>
      typeof line === "string" &&
      line.startsWith("Roll I-term saturation status:")
  );

test("post-flight I-term activity cannot create a saturation Review", () => {
  // The sustained run sits at 50 s — after the qualified window.
  const result = buildFlight(iTermWithRunAt(50));

  assert.match(rollISaturationLine(result), /Clear/);
  assert.equal(
    (result.recommendations ?? []).some((line) =>
      /Roll .*sustained PID-term saturation/.test(line)
    ),
    false,
    "no saturation recommendation may come from post-flight rows"
  );
});

test("in-flight sustained saturation still reviews, and names its moment", () => {
  // The same run at 20 s — inside the qualified window.
  const result = buildFlight(iTermWithRunAt(20));

  assert.match(rollISaturationLine(result), /Review/);

  const recommendation = (result.recommendations ?? []).find((line) =>
    /Roll .*sustained PID-term saturation/.test(line)
  );
  assert.ok(recommendation, "the in-window run must be recommended for review");
  assert.match(
    recommendation,
    /inside the analyzed flight window/,
    "the finding must be traceable to its moment"
  );
});

test("response-behavior checks export as structured data", () => {
  const result = buildFlight(iTermWithRunAt(50));

  assert.ok(Array.isArray(result.responseBehavior));
  assert.ok(result.responseBehavior.length > 0);

  for (const checkResult of result.responseBehavior) {
    assert.ok(["Roll", "Pitch", "Yaw"].includes(checkResult.axis));
    assert.ok(
      ["bounce-back", "settling", "ringing"].includes(checkResult.check)
    );
    assert.equal(typeof checkResult.status, "string");
  }
});
