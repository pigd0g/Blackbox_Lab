// ======================================================
// TESTS — command-event semantics (the events-integrity
// contract)
// ======================================================
//
// One synthetic flight per claim, each locking a failure
// mode reported from the field:
//
//   - a tiny stick nudge is not an event at all
//   - a target that never holds still is not a step
//   - a command-to-zero decay that stays on its original
//     side of the target is never "overshoot"
//   - a disturbance after the response has settled is not
//     this command's overshoot
//   - a real persistent crossing IS overshoot, measured
//     beyond the target and anchored where it peaked
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzePids } from "../src/analysis/pidAnalysis.js";

const SAMPLE_RATE = 200;
const SECONDS = 40;

// Build a flight whose roll setpoint/response pair is supplied
// per row by callbacks; everything else stays inert and the
// rotor holds a steady 1800 rpm so the whole flight is stable.
function buildFlight(setpointAt, responseAt) {
  const header =
    "loopIteration,time,setpoint[0],setpoint[1],setpoint[2]," +
    "gyroADC[0],gyroADC[1],gyroADC[2],headspeed";

  const lines = [header];
  const rowCount = SAMPLE_RATE * SECONDS;

  for (let row = 0; row < rowCount; row += 1) {
    const t = row / SAMPLE_RATE;

    lines.push(
      [
        row,
        Math.round(t * 1_000_000),
        setpointAt(t).toFixed(2),
        "0",
        "0",
        responseAt(t).toFixed(2),
        "0",
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

  return {
    analysisContext,
    lines,
    headspeedProfiles: [{ targetRpm: 1800, sampleIndexes }]
  };
}

function rollEvents(fixture) {
  const result = analyzePids(
    fixture.analysisContext,
    fixture.lines,
    fixture.headspeedProfiles
  );

  const axis = (
    result?.detectedColumns?.trackingAnalysis?.commandEvents ?? []
  ).find((entry) => entry.axis === "Roll");

  return axis?.events ?? [];
}

// A step command that holds; the response follows it exactly.
const stepAt = (t, from, to, at) => (t >= at ? to : from);

test("a tiny stick nudge below the meaningful-command bar is not an event", () => {
  // 12 deg/s steps, repeated — hover corrections, not commands.
  const fixture = buildFlight(
    (t) => (t % 4 >= 1 && t % 4 < 2 ? 12 : 0),
    (t) => (t % 4 >= 1 && t % 4 < 2 ? 12 : 0)
  );

  assert.equal(rollEvents(fixture).length, 0);
});

test("a target that never stabilizes is not a step event", () => {
  // Continuous 0.5 Hz sweep between -90 and +90: the setpoint
  // changes fast enough to trigger the scan but never holds
  // still for the stability window.
  const fixture = buildFlight(
    (t) => 90 * Math.sin(t * Math.PI),
    (t) => 90 * Math.sin(t * Math.PI - 0.15)
  );

  assert.equal(rollEvents(fixture).length, 0);
});

test("command-to-zero decay on the original side is never overshoot", () => {
  // Setpoint steps 60 → 0 at t=10; the response decays toward
  // zero exponentially and never crosses it (the Bell 40.5 s
  // case).
  const fixture = buildFlight(
    (t) => (t >= 2 && t < 10 ? 60 : 0),
    (t) => {
      if (t < 2) return 0;
      if (t < 10) return 60;
      return 60 * Math.exp(-(t - 10) / 0.4);
    }
  );

  const events = rollEvents(fixture);
  const commandToZero = events.find(
    (event) => event.commandTarget === 0
  );

  assert.ok(commandToZero, "the down-step must be an event");
  assert.equal(
    commandToZero.overshootPercent,
    null,
    "a decay that never crosses the target must not be overshoot"
  );
});

test("a disturbance after the response settled is not this command's overshoot", () => {
  // Clean step 0 → 60 at t=10, tracked immediately; at t=12 (two
  // seconds later, still inside a 60-hold) a gust pushes the gyro
  // to 100 for 200 ms. The event must not wear that gust as
  // overshoot.
  const fixture = buildFlight(
    (t) => (t >= 10 && t < 14 ? 60 : 0),
    (t) => {
      if (t >= 12 && t < 12.2) return 100;
      return t >= 10 && t < 14 ? 60 : 0;
    }
  );

  const events = rollEvents(fixture);
  const upStep = events.find((event) => event.commandTarget === 60);

  assert.ok(upStep, "the up-step must be an event");
  assert.equal(
    upStep.overshootPercent,
    null,
    "a post-settle disturbance must not be scored as overshoot"
  );
});

test("a real persistent crossing is overshoot, measured beyond the target", () => {
  // Step 0 → 60 at t=10; the response rises through the target to
  // 90 (50% past), stays beyond for 150 ms, then settles at 60.
  const fixture = buildFlight(
    (t) => (t >= 10 && t < 14 ? 60 : 0),
    (t) => {
      if (t < 10) return 0;
      if (t < 10.05) return 60 * ((t - 10) / 0.05);
      if (t < 10.2) return 90;
      return t < 14 ? 60 : 0;
    }
  );

  const events = rollEvents(fixture);
  const upStep = events.find((event) => event.commandTarget === 60);

  assert.ok(upStep, "the up-step must be an event");
  assert.ok(
    Number.isFinite(upStep.overshootPercent),
    "a persistent crossing must be measured"
  );
  assert.ok(
    upStep.overshootPercent > 30 && upStep.overshootPercent < 60,
    `overshoot should read near 50%, got ${upStep.overshootPercent}`
  );
  assert.ok(
    Number.isInteger(upStep.responsePeakSampleIndex),
    "the overshoot peak must carry its anchor"
  );
});
