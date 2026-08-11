// ======================================================
// TESTS — tuning feedback without an RPM sensor
// ======================================================
//
// Stick-following needs no rotor data: the tracking checks
// only need to know when the machine was flying, and
// airframe motion answers that. A no-RPM log now earns a
// real tuning read — with its confidence capped, because
// the stable phase rests on motion rather than rotor
// speed.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildLogAnalysis } from "../src/analysis/logAnalysisBuilder.js";
import { aircraftProfiles } from "../src/profiles/aircraftProfiles.js";

const SAMPLE_RATE = 500;
const DURATION_SECONDS = 90;

// A flight with no rotor speed logged: quiet on the ground for
// ten seconds, flown for seventy, quiet again. Gyro follows the
// setpoint closely — a machine tracking well.
function buildLines() {
  const header = [
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
    "headspeed",
    "vbat",
    "motor[0]"
  ];

  const lines = [
    `"Product","Blackbox flight data recorder by Nicholas Sherlock"`,
    `"Firmware type","Cleanflight"`,
    `"Firmware revision","Rotorflight 4.6.0 (test)"`,
    `"Craft name","No RPM Test"`,
    header.map((name) => `"${name}"`).join(",")
  ];

  const count = SAMPLE_RATE * DURATION_SECONDS;

  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const flying = t >= 10 && t < 80;

    const command = flying
      ? Math.round(250 * Math.sin(t * 1.7) + 120 * Math.sin(t * 0.43))
      : 0;

    const noise = Math.round(
      Math.sin(i * 0.37) * (flying ? 18 : 2) +
        Math.cos(i * 1.13) * (flying ? 9 : 1)
    );

    const gyro = command + Math.round(noise * 0.4);

    lines.push(
      [
        i * (1_000_000 / SAMPLE_RATE),
        command,
        Math.round(command * 0.8),
        Math.round(command * 0.5),
        gyro,
        Math.round(gyro * 0.8),
        Math.round(gyro * 0.5),
        gyro + noise,
        Math.round(gyro * 0.8) + noise,
        Math.round(gyro * 0.5) + noise,
        0,
        2280,
        flying ? 600 : 0
      ].join(",")
    );
  }

  return lines;
}

test("a no-RPM log earns a tuning read with capped confidence", () => {
  const analysis = buildLogAnalysis({
    fileType: "Blackbox BBL Log",
    lines: buildLines(),
    aircraftProfiles
  });

  assert.ok(analysis, "analysis expected");

  const pid = analysis.pidAnalysis;

  assert.ok(pid, "PID analysis expected");
  assert.notEqual(
    pid.overallStatus,
    "Insufficient Data",
    "motion-based windows should carry the tracking checks"
  );
  assert.ok(
    Number.isFinite(pid.score),
    `a score is expected, got ${pid.score}`
  );
  assert.ok(
    pid.confidence.score <= 65,
    `confidence must be capped without rotor context, got ${pid.confidence.score}`
  );

  const summaryText = JSON.stringify(pid.summary ?? []);
  assert.doesNotMatch(
    summaryText,
    /null RPM/,
    "no label may print a null rpm"
  );
});
