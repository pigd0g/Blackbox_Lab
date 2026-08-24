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

test("every finalized entry carries an evidence array — renderers map without ceremony", () => {
  const bridge = confirmsFromResponseBehavior(
    [{ axis: "Roll", check: "bounce-back", status: "Review" }],
    []
  )[0];
  assert.ok(Array.isArray(bridge.evidence));
  assert.equal(typeof bridge.hypothesis, "string");

  const bare = finalizeRecommendation({ id: "x", lab: "pid", axis: "Roll" });
  assert.ok(Array.isArray(bare.evidence));
});

// ---- #62: ONE priority rule for every surface ----

import { rankRecommendations, priorityRank } from "../src/analysis/recommendationContract.js";

test("the strongest Review leads: High/9 ringing outranks Medium/4 bounce-back on every surface (#62)", () => {
  const behavior = [
    { axis: "Pitch", check: "bounce-back", status: "Review", confidence: "Medium", eventCount: 4, evidenceRows: [], evidence: "4 valid events" },
    { axis: "Roll", check: "ringing", status: "Review", confidence: "High", eventCount: 9, evidenceRows: [], evidence: "9 valid events" }
  ];
  const confirms = confirmsFromResponseBehavior(behavior, []);
  assert.equal(confirms[0].axis, "Roll");
  assert.match(confirms[0].finding, /ringing/);
  assert.equal(confirms[1].axis, "Pitch");

  const ranked = rankRecommendations([...confirms].reverse());
  assert.equal(ranked[0].axis, "Roll", "ranking is order-independent");
});

test("an axis with several Reviews confirms its strongest check, not the first-listed (#62)", () => {
  const behavior = [
    { axis: "Roll", check: "bounce-back", status: "Review", confidence: "Medium", eventCount: 4, evidenceRows: [] },
    { axis: "Roll", check: "ringing", status: "Review", confidence: "High", eventCount: 9, evidenceRows: [] }
  ];
  const confirms = confirmsFromResponseBehavior(behavior, []);
  assert.equal(confirms.length, 1);
  assert.match(confirms[0].finding, /ringing/);
});

test("an earned change outranks any evidence request; confidence and events break ties", () => {
  const entries = [
    finalizeRecommendation({ id: "b", lab: "pid", axis: "Pitch", suggestion: null, gatedReason: "confirm", confidence: "High", evidenceCount: 9 }),
    finalizeRecommendation({ id: "a", lab: "pid", axis: "Roll", suggestion: { family: "roll_d_gain", direction: "up", magnitudeClass: "small step" }, confidence: "Medium", evidenceCount: 3 })
  ];
  const ranked = rankRecommendations(entries);
  assert.equal(ranked[0].id, "a", "earned first");
  assert.deepEqual(priorityRank(entries[0])[0], 1);
});
