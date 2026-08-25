// ======================================================
// TESTS — one stick movement is ONE event (#32)
// ======================================================
//
// A long ramped command (a full-deflection roll input building
// over a second) used to produce a second, ghost event at the
// moment the target held: the scan resumed AT the hold and read
// the first held sample against the ramp's last 0.2 s. The same
// response was then measured twice, the second time against a
// fraction of the real step. A held target is the new baseline.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzePids } from "../src/analysis/pidAnalysis.js";

const SAMPLE_RATE = 200;
const SECONDS = 60;

// Every 6 s: a 1.0 s linear ramp from 0 to 300 deg/s, a 1.5 s
// hold, a 1.0 s ramp back to 0, a hold. The gyro follows with a
// short first-order lag. Nothing else moves.
function buildFixture() {
  const header =
    "loopIteration,time,setpoint[0],setpoint[1],setpoint[2]," +
    "gyroADC[0],gyroADC[1],gyroADC[2],headspeed";
  const lines = [header];
  const rowCount = SAMPLE_RATE * SECONDS;
  let y = 0;

  for (let row = 0; row < rowCount; row += 1) {
    const t = row / SAMPLE_RATE;
    const phase = t % 6;
    let target = 0;
    if (phase >= 1 && phase < 2) target = (phase - 1) * 300;
    else if (phase >= 2 && phase < 3.5) target = 300;
    else if (phase >= 3.5 && phase < 4.5) target = 300 - (phase - 3.5) * 300;

    y += (target - y) * 0.15;

    lines.push(
      [
        row,
        Math.round(t * 1_000_000),
        target.toFixed(1),
        "0",
        "0",
        y.toFixed(2),
        "0",
        "0",
        "1800"
      ].join(",")
    );
  }

  const sampleIndexes = [];
  for (let row = 1; row <= rowCount; row += 1) sampleIndexes.push(row);

  return {
    analysisContext: {
      telemetry: { allColumns: header.split(",") },
      flight: { telemetryHeaderIndex: 0 }
    },
    lines,
    headspeedProfiles: [{ targetRpm: 1800, sampleIndexes }]
  };
}

test("a ramped command yields one event, never a ghost at its hold", () => {
  const fixture = buildFixture();
  const result = analyzePids(
    fixture.analysisContext,
    fixture.lines,
    fixture.headspeedProfiles
  );
  const roll = result.detectedColumns.trackingAnalysis.commandEvents.find(
    (axisResult) => axisResult.axis === "Roll"
  );
  const events = roll.events;

  // 10 periods × 2 ramps (up, down); the last period's down-ramp
  // ends at 58.5 s inside the log, so all 20 qualify.
  assert.equal(events.length, 20, `events: ${events.map((e) => e.sampleIndex).join(",")}`);

  // Every event measures the WHOLE ramp — 300 deg/s, never a tail
  // fraction of it — and no two events share a command end.
  const ends = new Set();
  for (const event of events) {
    assert.ok(
      Math.abs(event.commandMagnitude - 300) < 15,
      `magnitude ${event.commandMagnitude} is the full step`
    );
    assert.ok(!ends.has(event.commandEndSampleIndex), "distinct command ends");
    ends.add(event.commandEndSampleIndex);
  }
});
