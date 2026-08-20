// ======================================================
// TESTS — the recommendation contract
// ======================================================
//
// One shape for every surface: level derives from the
// engine's own gates, blocked items name their blocker,
// confirms carry a flyable maneuver, and the outcome
// record (the future training row) round-trips the fields
// the ledger needs.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  finalizeRecommendation,
  finalizeRecommendations,
  confirmsFromResponseBehavior,
  toOutcomeRecord,
  CONTRACT_VERSION
} from "../src/analysis/recommendationContract.js";

test("a suggestion-bearing recommendation is an earned change", () => {
  const rec = finalizeRecommendation({
    id: "pid:Roll:slow-settling",
    lab: "pid",
    axis: "Roll",
    suggestion: { family: "roll_d_gain", direction: "up", magnitudeClass: "small step" },
    confidence: "High"
  });

  assert.equal(rec.level, "earned");
  assert.equal(rec.domain, "tuning");
  assert.equal(rec.blockedBy, null);
  assert.equal(rec.instrument, "pid.roll.settle");
  assert.equal(rec.contractVersion, CONTRACT_VERSION);
});

test("an evidence-gated recommendation becomes a confirm with a flyable maneuver", () => {
  const rec = finalizeRecommendation({
    id: "pid:Pitch:slow-settling",
    lab: "pid",
    axis: "Pitch",
    suggestion: null,
    gatedReason: "Evidence confidence is Medium (3 clean commands). Fly a log with more distinct stick inputs and re-read this page."
  });

  assert.equal(rec.level, "confirm");
  assert.match(rec.nextManeuver, /pitch inputs/i);
  assert.match(rec.nextManeuver, /same headspeed/i);
});

test("vibration precedence blocks instead of confirming", () => {
  const rec = finalizeRecommendation({
    id: "pid:Roll:slow-settling",
    lab: "pid",
    axis: "Roll",
    suggestion: null,
    gatedReason: "Filters come before PIDs: resolve the vibration finding, fly again, and re-read this page."
  });

  assert.equal(rec.level, "observed");
  assert.equal(rec.blockedBy, "vibration");
});

test("overshoot recommendations verify on the overshoot instrument", () => {
  const rec = finalizeRecommendation({
    id: "pid:Yaw:overshoot",
    lab: "pid",
    axis: "Yaw",
    suggestion: { family: "yaw_d_gain", direction: "up", magnitudeClass: "small step" }
  });

  assert.equal(rec.instrument, "pid.yaw.overshoot");
});

test("finalizeRecommendations stamps both lists in place", () => {
  const nextSteps = {
    pid: [{ id: "pid:Roll:slow-settling", lab: "pid", axis: "Roll", suggestion: null, gatedReason: "Mixed signature: confirm the pattern with another log before changing values." }],
    governor: [{ id: "governor:droop", lab: "governor", suggestion: { family: "gov_gain", direction: "up", magnitudeClass: "small step" } }]
  };

  const out = finalizeRecommendations(nextSteps);

  assert.equal(out.pid[0].level, "confirm");
  assert.equal(out.governor[0].level, "earned");
  assert.equal(out.governor[0].instrument, "governor.droop");
});

test("the outcome record carries what the ledger and training need", () => {
  const rec = finalizeRecommendation({
    id: "pid:Roll:slow-settling",
    lab: "pid",
    axis: "Roll",
    suggestion: { family: "roll_d_gain", direction: "up", magnitudeClass: "small step" },
    confidence: "High"
  });

  const row = toOutcomeRecord(rec, { outcome: "kept", verifyingFlightId: "v1:abc" });

  assert.equal(row.outcome, "kept");
  assert.equal(row.instrument, "pid.roll.settle");
  assert.equal(row.suggestion.family, "roll_d_gain");
  assert.equal(row.verifyingFlightId, "v1:abc");
  assert.equal(row.contractVersion, CONTRACT_VERSION);
});

test("a below-gate response-behavior Review becomes a confirm entry with the right instrument", () => {
  const confirms = confirmsFromResponseBehavior(
    [
      { axis: "Roll", check: "bounce-back", status: "Review", confidence: "Medium", evidence: "3 valid events" },
      { axis: "Roll", check: "settling", status: "Review" },
      { axis: "Pitch", check: "ringing", status: "Clear" }
    ],
    []
  );

  assert.equal(confirms.length, 1); // one per axis, first Review wins
  assert.equal(confirms[0].level, "confirm");
  assert.equal(confirms[0].instrument, "pid.roll.overshoot");
  assert.match(confirms[0].nextManeuver, /roll inputs/i);
  assert.match(confirms[0].finding, /3 valid events/);
});

test("axes the engine already covered get no duplicate confirm", () => {
  const confirms = confirmsFromResponseBehavior(
    [{ axis: "Roll", check: "bounce-back", status: "Review" }],
    [{ axis: "Roll", id: "pid:Roll:slow-settling" }]
  );

  assert.equal(confirms.length, 0);
});
