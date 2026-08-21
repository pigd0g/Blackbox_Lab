// ======================================================
// TESTS — knowledge cards, interference groups, and the
// pack builder
// ======================================================
//
// The doctrine in executable form: at most one change per
// interference group, numeric values only from a real dump
// under the pinned firmware and never past the fleet band
// edge, confirms bundle freely, blocked items never pack,
// and the revert snippet restores exactly what the dump
// held.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { groupOf, groupsConflict } from "../src/analysis/interferenceGroups.js";
import { numericStep, cardsApplyTo, KNOWLEDGE_CARDS } from "../src/analysis/knowledgeCards.js";
import { buildPack, PACK_CAP } from "../src/analysis/packBuilder.js";
import { packSnippet, revertSnippet } from "../src/analysis/packSnippet.js";

const FIRMWARE = "Rotorflight 4.6.0 (118e912) STM32F7X2";

function earned(axis, family, { confidence = "High", direction = "up" } = {}) {
  return {
    id: `pid:${axis}:test:${family}`,
    lab: family.startsWith("gov") ? "governor" : "pid",
    axis,
    level: "earned",
    blockedBy: null,
    confidence,
    suggestion: { family, direction, magnitudeClass: "small step" },
    instrument: `pid.${axis.toLowerCase()}.settle`,
    finding: `${axis} test finding`,
    expectedResult: "improves"
  };
}

// ---- groups ----

test("same-axis P and D share a group; roll and pitch never do", () => {
  assert.equal(groupOf("roll_p_gain"), groupOf("roll_d_gain"));
  assert.notEqual(groupOf("roll_d_gain"), groupOf("pitch_d_gain"));
  assert.ok(!groupsConflict(groupOf("roll_d_gain"), groupOf("pitch_f_gain")));
});

test("the governor master gain conflicts with every governor group", () => {
  assert.ok(groupsConflict(groupOf("gov_gain"), groupOf("gov_p_gain")));
  assert.ok(groupsConflict(groupOf("gov_gain"), groupOf("gov_collective_ff_weight")));
  assert.ok(!groupsConflict(groupOf("gov_gain"), groupOf("roll_d_gain")));
});

// ---- cards ----

test("numeric steps come from the card and stop at the fleet band edge", () => {
  const step = numericStep("roll_d_gain", 10, "up");
  assert.deepEqual(step, { from: 10, to: 15 });

  // 18 + 5 would pass the band edge (p90 = 20) — capped there.
  assert.deepEqual(numericStep("roll_d_gain", 18, "up"), { from: 18, to: 20 });

  // At or beyond the edge: no number at all.
  assert.equal(numericStep("roll_d_gain", 20, "up"), null);
  assert.equal(numericStep("roll_d_gain", 25, "up"), null);
});

test("cards are firmware-pinned", () => {
  assert.ok(cardsApplyTo(FIRMWARE));
  assert.ok(!cardsApplyTo("Rotorflight 4.5.1"));
  assert.ok(!cardsApplyTo(null));
});

test("every card's step cannot cross its own band in one move from the median", () => {
  for (const [name, card] of Object.entries(KNOWLEDGE_CARDS)) {
    assert.ok(card.step > 0, `${name} step`);
    assert.ok(card.fleetBand.p90 >= card.fleetBand.p10, `${name} band`);
    assert.ok(card.range.max > card.range.min, `${name} range`);
  }
});

// ---- pack builder ----

test("one member per interference group; the loser is queued with its reason", () => {
  const pack = buildPack({
    recommendations: {
      pid: [
        earned("Roll", "roll_d_gain"),
        earned("Roll", "roll_p_gain", { confidence: "Medium" })
      ],
      governor: []
    },
    firmwareRevision: FIRMWARE
  });

  assert.equal(pack.members.length, 1);
  assert.equal(pack.members[0].setting, "roll_d_gain");
  assert.equal(pack.queued.length, 1);
  assert.match(pack.queued[0].reason, /shares the roll-feedback instrument/);
});

test("the cap holds and overflow is queued", () => {
  const pack = buildPack({
    recommendations: {
      pid: [
        earned("Roll", "roll_d_gain"),
        earned("Pitch", "pitch_f_gain"),
        earned("Yaw", "yaw_d_gain"),
        earned("Pitch", "pitch_i_gain")
      ],
      governor: []
    },
    firmwareRevision: FIRMWARE
  });

  assert.equal(pack.members.length, PACK_CAP);
  assert.equal(pack.queued.length, 1);
  assert.match(pack.queued[0].reason, /pack is full/);
});

test("numeric with dump, directional without — and the note says why", () => {
  const withDump = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    craftDumpParsed: { roll_d_gain: "10" },
    firmwareRevision: FIRMWARE
  });
  assert.equal(withDump.members[0].from, 10);
  assert.equal(withDump.members[0].to, 15);

  const withoutDump = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    firmwareRevision: FIRMWARE
  });
  assert.equal(withoutDump.members[0].to, null);
  assert.match(withoutDump.members[0].numericNote, /no CLI dump/);

  const wrongFirmware = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    craftDumpParsed: { roll_d_gain: "10" },
    firmwareRevision: "Rotorflight 4.5.1"
  });
  assert.equal(wrongFirmware.members[0].to, null);
  assert.match(wrongFirmware.members[0].numericNote, /firmware 4\.6/);
});

test("blocked recommendations never pack; confirms bundle as prescriptions", () => {
  const pack = buildPack({
    recommendations: {
      pid: [
        {
          ...earned("Roll", "roll_d_gain"),
          level: "observed",
          blockedBy: "vibration",
          suggestion: null
        },
        {
          id: "pid:Pitch:slow",
          lab: "pid",
          axis: "Pitch",
          level: "confirm",
          blockedBy: null,
          nextManeuver: "Repeat 4-6 deliberate pitch inputs with clean stops and reversals at the same headspeed."
        }
      ],
      governor: []
    },
    firmwareRevision: FIRMWARE
  });

  assert.equal(pack.members.length, 0);
  assert.equal(pack.blocked.length, 1);
  assert.equal(pack.blocked[0].blockedBy, "vibration");
  assert.equal(pack.prescriptions.length, 1);
});

test("a governor member beside a cyclic member demands held headspeed", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earned("Roll", "roll_d_gain")],
      governor: [earned("governor", "gov_p_gain")]
    },
    firmwareRevision: FIRMWARE
  });

  assert.equal(pack.members.length, 2);
  assert.ok(pack.requiresHeadspeedHold);
});

// ---- snippets ----

test("forward and revert snippets carry real values and the safety lines", () => {
  const pack = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    craftDumpParsed: { roll_d_gain: "10" },
    firmwareRevision: FIRMWARE
  });

  const forward = packSnippet(pack);
  assert.match(forward, /set roll_d_gain = 15/);
  assert.match(forward, /never while armed/i);
  assert.match(forward, /hover check/i);
  assert.match(forward, /save$/m);

  const revert = revertSnippet(pack);
  assert.match(revert.text, /set roll_d_gain = 10/);
  assert.equal(revert.restorable, 1);
});

test("a directional member never becomes a guessed number in the snippet", () => {
  const pack = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    firmwareRevision: FIRMWARE
  });

  const forward = packSnippet(pack);
  assert.ok(!/^set /m.test(forward.split("\n").filter((l) => l.includes("roll_d_gain"))[0]));
  assert.match(forward, /# roll_d_gain: one small step up/);
});

test("the flown header value beats a stale dump for mapped settings", () => {
  const pack = buildPack({
    recommendations: { pid: [earned("Roll", "roll_d_gain")], governor: [] },
    craftDumpParsed: { roll_d_gain: "5" }, // stale
    firmwareRevision: FIRMWARE,
    getHeaderValue: (h) => (h === "rollPID" ? "52,102,10,100,0" : "Not found")
  });

  assert.equal(pack.members[0].from, 10); // flown, not 5
  assert.equal(pack.members[0].currentSource, "log");
});

test("a dump-only number under a stale dump carries the freshness warning", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earned("Yaw", "yaw_cw_stop_gain")], // unmapped in headers
      governor: []
    },
    craftDumpParsed: { yaw_cw_stop_gain: "115" },
    firmwareRevision: FIRMWARE,
    getHeaderValue: () => "Not found",
    dumpFreshness: { fresh: false, checked: 5, mismatches: [{ setting: "roll_d_gain", dump: 5, flown: 10 }] }
  });

  assert.equal(pack.members[0].currentSource, "dump");
  assert.match(pack.members[0].freshnessNote, /refresh it/);
});
