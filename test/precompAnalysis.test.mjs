// ======================================================
// BLACKBOX LAB — PRECOMP ANALYSIS TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// Synthetic flights with planted collective pumps and known
// consequences: droop on rises, overspeed on drops, tail
// kicks with known consistency. The tests pin the balance
// verdicts and the honesty states (not enough transients,
// missing telemetry).
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzePrecomp,
  findCollectiveTransients,
  PRECOMP_TUNING
} from "../src/analysis/precompAnalysis.js";

const RATE = 100;
const SECONDS = 140;
const TARGET = 2000;

// Governed flight with collective pumps at known times. Options
// plant the consequences.
function buildFlight({
  riseDroopPercent = 0,
  dropOvershootPercent = 0,
  tailKick = 0,
  tailKickConsistent = true
} = {}) {
  const count = RATE * SECONDS;
  const timeSeconds = Array.from({ length: count }, (_, i) => i / RATE);
  const headspeed = new Array(count).fill(TARGET);
  const governorTarget = new Array(count).fill(TARGET);
  const collective = new Array(count).fill(200);
  const yawSetpoint = new Array(count).fill(0);
  const yawGyro = new Array(count).fill(0);

  // Spool ramps (target follows, as Rotorflight does).
  for (let i = 0; i < 10 * RATE; i += 1) {
    const ramp = (TARGET * i) / (10 * RATE);
    headspeed[i] = ramp;
    governorTarget[i] = ramp;
  }

  // Small alternating yaw noise floor so the baseline is not zero.
  for (let i = 0; i < count; i += 1) {
    yawGyro[i] = i % 2 === 0 ? 2 : -2;
  }

  const pumpStarts = [30, 45, 60, 75, 90, 105];

  for (const start of pumpStarts) {
    const riseAt = Math.round(start * RATE);
    const dropAt = Math.round((start + 5) * RATE);

    // Collective jumps up in 0.1 s, back down 5 s later.
    for (let i = riseAt; i < dropAt; i += 1) {
      collective[i] = 800;
    }

    // Planted consequences, 0.4 s each.
    for (let i = riseAt; i < riseAt + 0.4 * RATE; i += 1) {
      if (riseDroopPercent > 0) {
        headspeed[i] = TARGET * (1 - riseDroopPercent / 100);
      }
      if (tailKick > 0) {
        yawGyro[i] = tailKick;
      }
    }

    for (let i = dropAt; i < dropAt + 0.4 * RATE; i += 1) {
      if (dropOvershootPercent > 0) {
        headspeed[i] = TARGET * (1 + dropOvershootPercent / 100);
      }
      if (tailKick > 0) {
        // Consistent coupling flips sign with the collective
        // direction; inconsistent coupling keeps one sign.
        yawGyro[i] = tailKickConsistent ? -tailKick : tailKick;
      }
    }
  }

  return {
    timeSeconds,
    headspeed,
    governorTarget,
    collective,
    yawSetpoint,
    yawGyro
  };
}

test("collective pumps are found, one transient per direction", () => {
  const flight = buildFlight();

  const transients = findCollectiveTransients({
    timeSeconds: flight.timeSeconds,
    collective: flight.collective,
    inFlight: new Set(
      Array.from({ length: RATE * SECONDS }, (_, i) => i).filter(
        (i) => i > 12 * RATE
      )
    )
  });

  const rises = transients.filter((t) => t.direction === "rise");
  const drops = transients.filter((t) => t.direction === "drop");

  assert.equal(rises.length, 6, `rises=${rises.length}`);
  assert.equal(drops.length, 6, `drops=${drops.length}`);
});

test("clean pumps read as balanced governor precomp", () => {
  const result = analyzePrecomp(buildFlight());

  assert.ok(result);
  assert.equal(result.governor.balance, "balanced");
  assert.match(result.governor.story, /doing its job/);
});

test("droop on rises with clean drops reads precomp low", () => {
  const result = analyzePrecomp(
    buildFlight({ riseDroopPercent: 6 })
  );

  assert.equal(result.governor.balance, "low");
  assert.ok(result.governor.riseDroopPercent >= 4);
  assert.match(result.governor.story, /More collective precomp/);
});

test("overspeed on drops with clean rises reads precomp high", () => {
  const result = analyzePrecomp(
    buildFlight({ dropOvershootPercent: 6 })
  );

  assert.equal(result.governor.balance, "high");
  assert.match(result.governor.story, /Less collective precomp/);
});

test("misses both ways read as lagging, not a precomp direction", () => {
  const result = analyzePrecomp(
    buildFlight({ riseDroopPercent: 5, dropOvershootPercent: 5 })
  );

  assert.equal(result.governor.balance, "lagging");
  assert.match(result.governor.story, /late in both directions/);
});

test("a consistent tail kick reads as coupled with its ratio", () => {
  const result = analyzePrecomp(buildFlight({ tailKick: 90 }));

  assert.equal(result.tail.balance, "coupled");
  assert.ok(result.tail.kickRatio >= PRECOMP_TUNING.TAIL_KICK_RATIO);
  assert.ok(result.tail.consistency >= PRECOMP_TUNING.TAIL_CONSISTENCY);
  assert.match(result.tail.story, /rotation direction/);
});

test("an inconsistent tail wobble is not called coupling", () => {
  const result = analyzePrecomp(
    buildFlight({ tailKick: 90, tailKickConsistent: false })
  );

  // Same-sign kicks on rises AND drops = oriented signs split
  // 50/50 — turbulence, not torque coupling.
  assert.equal(result.tail.balance, "balanced");
});

test("a quiet cruise has no verdict, and says why", () => {
  const flight = buildFlight();

  // Flatten the collective: no pumps at all.
  flight.collective.fill(400);

  const result = analyzePrecomp(flight);

  assert.equal(result.governor.balance, null);
  assert.match(result.governor.story, /Not enough fast collective/);
});

test("no governor target = no governor read; tail still works", () => {
  const flight = buildFlight({ tailKick: 90 });
  flight.governorTarget = flight.governorTarget.map(() => 0);

  const result = analyzePrecomp(flight);

  assert.equal(result.governor, null);
  assert.equal(result.tail.balance, "coupled");
});

test("no yaw telemetry = no tail read; governor still works", () => {
  const flight = buildFlight({ riseDroopPercent: 6 });

  const result = analyzePrecomp({
    ...flight,
    yawSetpoint: null,
    yawGyro: null
  });

  assert.equal(result.tail, null);
  assert.equal(result.governor.balance, "low");
});
