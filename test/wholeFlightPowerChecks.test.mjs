// ======================================================
// TESTS — power checks sweep the whole flight
// ======================================================
//
// A hard load event pulls the rotor off its plateau, so
// its samples drop out of the stable phase. The ESC
// saturation check and the battery minimum-voltage check
// must still see those seconds: they are the moments the
// power system answers for itself.
//
// The synthetic flight: two minutes governed at 1800 rpm,
// with one six-second bog-down to 1500 rpm during which
// the motor output pins at 100% and the pack dips hard.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { analyzeEscLab } from "../src/analysis/escLabAnalysis.js";
import { analyzeBatteryLab } from "../src/analysis/batteryLabAnalysis.js";

const SAMPLE_RATE = 100;
const DURATION_SECONDS = 120;
const EVENT_START = 60;
const EVENT_END = 66;

function buildFlight() {
  const timeSeconds = [];
  const headspeed = [];
  const governorTarget = [];
  const motor = [];
  const vbat = [];

  for (let i = 0; i < DURATION_SECONDS * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE;
    const inEvent = t >= EVENT_START && t < EVENT_END;

    timeSeconds.push(t);
    governorTarget.push(1800);
    // Small jitter keeps the plateau realistic without
    // breaking the stable-phase detection.
    headspeed.push(inEvent ? 1500 : 1800 + (i % 5) - 2);
    motor.push(inEvent ? 1000 : 600);
    // volts × 100: 22.8 V cruise, 19.0 V in the dip.
    vbat.push(inEvent ? 1900 : 2280 - Math.floor(t / 10));
  }

  return { timeSeconds, headspeed, governorTarget, motor, vbat };
}

test("ESC Lab reports saturation that lives outside the stable phase", () => {
  const flight = buildFlight();

  const result = analyzeEscLab({
    timeSeconds: flight.timeSeconds,
    motor: flight.motor,
    escThrottle: null,
    amperage: null,
    escCurrent: null,
    vbat: flight.vbat,
    escVoltage: null,
    headspeed: flight.headspeed,
    governorTarget: flight.governorTarget
  });

  assert.ok(result, "ESC Lab should produce a result");

  // Six seconds pinned of ~120 flying seconds is ~5% — far over
  // the 2% attention threshold once the whole flight is swept.
  assert.ok(
    result.saturationPercent > 2,
    `whole-flight saturation should exceed 2%, got ${result.saturationPercent}`
  );
  assert.equal(result.status, "attention");

  // The stable-phase figure stays available separately and stays
  // small: the event removed itself from the stable set.
  assert.ok(
    result.stableSaturationPercent < result.saturationPercent,
    "stable-phase saturation should be lower than whole-flight"
  );
});

test("Battery Lab minimum voltage sees the dip outside the stable phase", () => {
  const flight = buildFlight();

  const result = analyzeBatteryLab({
    timeSeconds: flight.timeSeconds,
    vbat: flight.vbat,
    escVoltage: null,
    amperage: null,
    escCurrent: null,
    headspeed: flight.headspeed,
    governorTarget: flight.governorTarget
  });

  assert.ok(result, "Battery Lab should produce a result");

  // 19.0 V on a detected 6S pack is ~3.17 V per cell.
  assert.ok(
    result.minimumVoltsPerCell < 3.3,
    `whole-flight minimum should reflect the dip, got ${result.minimumVoltsPerCell}`
  );
  assert.equal(result.status, "attention");
});
