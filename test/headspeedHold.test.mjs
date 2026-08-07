// ======================================================
// TESTS — rotor story for models without a governor target
// ======================================================
//
// A model on an ESC or external governor states no target,
// but its rotor still answers for how steadily it held.
// The reference is the headspeed's own slow trend, so a
// deliberate throttle-curve change is not charged against
// the hold — and without a stated target the card never
// claims more than "worth a look".
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { analyzeGovernorLab } from "../src/analysis/governorLabAnalysis.js";
import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";

const SAMPLE_RATE = 100;

function ungovernedFlight({ withSwing = false, withRampChange = false }) {
  const timeSeconds = [];
  const headspeed = [];

  for (let i = 0; i < 120 * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE;
    let rpm = 2400 + (i % 5) - 2;

    // A deliberate headspeed change mid-flight: ramps over
    // four seconds to a new cruise value and stays there.
    if (withRampChange) {
      if (t >= 60 && t < 64) {
        rpm = 2400 + ((t - 60) / 4) * 300;
      } else if (t >= 64) {
        rpm = 2700 + (i % 5) - 2;
      }
    }

    // A genuine short-term bog: 8% down for 1.5 seconds.
    if (withSwing && t >= 30 && t < 31.5) {
      rpm = 2210;
    }

    timeSeconds.push(t);
    headspeed.push(rpm);
  }

  return { timeSeconds, headspeed, governorTarget: null };
}

test("an ungoverned model gets a rotor result instead of null", () => {
  const result = analyzeGovernorLab(ungovernedFlight({}));

  assert.ok(result, "governor lab should not return null");
  assert.equal(result.mode, "headspeed-hold");
  assert.equal(result.status, "good");
  assert.ok(result.averageHeadspeed > 2300);
});

test("a genuine short-term swing reads as watch, never attention", () => {
  const result = analyzeGovernorLab(
    ungovernedFlight({ withSwing: true })
  );

  assert.ok(result);
  assert.equal(result.status, "watch");
  assert.ok(
    result.droopRpm > 60,
    `swing should register, got ${result.droopRpm} rpm`
  );
});

test("a deliberate headspeed ramp is not charged against the hold", () => {
  const result = analyzeGovernorLab(
    ungovernedFlight({ withRampChange: true })
  );

  assert.ok(result);
  assert.equal(
    result.status,
    "good",
    `a 4-second deliberate ramp should not read as instability, got ${result.status} (${result.droopRpm} rpm)`
  );
});

test("a commanded shutdown spool-down is not an in-flight swing", () => {
  // Spool-up, level flight, then the motor is commanded to zero
  // and the rotor spools down — the flight Daniel reported: the
  // decay corner must not read as a 30% droop.
  const timeSeconds = [];
  const headspeed = [];

  for (let i = 0; i < 110 * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE;
    let rpm;

    if (t < 6) {
      rpm = (t / 6) * 1300;
    } else if (t < 95.6) {
      rpm = 1300 + (i % 5) - 2;
    } else if (t < 100) {
      rpm = Math.max(0, 1300 * (1 - (t - 95.6) / 4.4));
    } else {
      rpm = 0;
    }

    timeSeconds.push(t);
    headspeed.push(rpm);
  }

  const result = analyzeGovernorLab({
    timeSeconds,
    headspeed,
    governorTarget: null
  });

  assert.ok(result);
  assert.equal(result.mode, "headspeed-hold");
  assert.equal(
    result.status,
    "good",
    `shutdown decay must not be charged against the hold, got ${result.status} (${result.droopRpm} rpm)`
  );
  assert.ok(
    result.droopRpm < 40,
    `expected only noise-level swing, got ${result.droopRpm} rpm`
  );
});

test("a genuine bog right before shutdown still registers", () => {
  // The exclusion must remove the ramp corners, not the flight
  // in front of them: an 8% bog twenty seconds before shutdown
  // keeps its evidence.
  const timeSeconds = [];
  const headspeed = [];

  for (let i = 0; i < 110 * SAMPLE_RATE; i += 1) {
    const t = i / SAMPLE_RATE;
    let rpm;

    if (t < 6) {
      rpm = (t / 6) * 1300;
    } else if (t < 95.6) {
      rpm = 1300 + (i % 5) - 2;

      if (t >= 75 && t < 76.5) {
        rpm = 1196;
      }
    } else if (t < 100) {
      rpm = Math.max(0, 1300 * (1 - (t - 95.6) / 4.4));
    } else {
      rpm = 0;
    }

    timeSeconds.push(t);
    headspeed.push(rpm);
  }

  const result = analyzeGovernorLab({
    timeSeconds,
    headspeed,
    governorTarget: null
  });

  assert.ok(result);
  assert.equal(result.status, "watch");
  assert.ok(
    result.droopRpm > 40,
    `the bog should register, got ${result.droopRpm} rpm`
  );
});

test("the verdict renders a rotor card for headspeed-hold results", () => {
  const lab = analyzeGovernorLab(ungovernedFlight({}));

  const verdict = buildFlightVerdict({
    spectra: [],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: { governor: lab }
  });

  const rotor = verdict.cards.find((card) => card.key === "rotor");

  assert.ok(rotor, "rotor card expected for ungoverned models");
  assert.equal(rotor.status, "good");
  assert.match(rotor.detail, /own trend/);
});
