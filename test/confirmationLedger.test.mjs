// ======================================================
// TESTS — confirmation ledger, applied-state check, and
// the silent grader
// ======================================================
//
// The craft remembers: patterns accumulate confirmations
// across flights, adequate-evidence silence closes them,
// inadequate silence changes nothing. A pack is graded
// only against a log that provably applied it — and until
// the field calibration exists, applied members grade as
// awaiting-calibration, never as guessed verdicts.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  fileAnalysis,
  openConfirmations,
  latestPack,
  ADEQUATE_AXIS_EVENTS
} from "../src/analysis/confirmationLedger.js";
import {
  assessAppliedState,
  readHeaderSetting
} from "../src/analysis/appliedState.js";
import {
  gradeAppliedPack,
  GRADE
} from "../src/analysis/verificationAutopilot.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

const CONFIRM = {
  id: "pid:Roll:bounce-back:confirm",
  axis: "Roll",
  instrument: "pid.roll.overshoot",
  finding: "Roll bounce-back flagged for review.",
  nextManeuver: "Repeat 4-6 deliberate roll inputs with clean stops and reversals at the same headspeed.",
  level: "confirm"
};

test("a pattern seen across two flights accumulates confirmations", () => {
  const storage = fakeStorage();

  fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-1", dateMs: 1, confirms: [CONFIRM], axisEvidence: {}
  });
  const open = fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-2", dateMs: 2, confirms: [CONFIRM], axisEvidence: {}
  });

  assert.equal(open.length, 1);
  assert.deepEqual(open[0].flights, ["flight-1", "flight-2"]);
});

test("adequate-evidence silence closes the item; inadequate silence does not", () => {
  const storage = fakeStorage();
  fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-1", dateMs: 1, confirms: [CONFIRM], axisEvidence: {}
  });

  // Flight 2: barely any roll commands — the question stays open.
  fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-2", dateMs: 2, confirms: [], axisEvidence: { Roll: 2 }
  });
  assert.equal(openConfirmations(storage, "TestHeli").length, 1);

  // Flight 3: plenty of roll commands, no pattern — closed.
  fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-3", dateMs: 3, confirms: [],
    axisEvidence: { Roll: ADEQUATE_AXIS_EVENTS }
  });
  assert.equal(openConfirmations(storage, "TestHeli").length, 0);
});

test("the latest pack from a different flight is retrievable; same-flight is excluded", () => {
  const storage = fakeStorage();
  const pack = {
    members: [{ setting: "roll_d_gain", direction: "up", from: 10, to: 15, instrument: "pid.roll.settle" }]
  };
  fileAnalysis(storage, "TestHeli", {
    sourceHash: "flight-1", dateMs: 1, confirms: [], axisEvidence: {}, pack
  });

  assert.equal(latestPack(storage, "TestHeli", { excludeSourceHash: "flight-1" }), null);
  const found = latestPack(storage, "TestHeli", { excludeSourceHash: "flight-2" });
  assert.equal(found.members[0].to, 15);
});

test("applied-state reads the flown PID arrays and verdicts honestly", () => {
  const headers = {
    rollPID: "52,102,15,100,0",
    pitchPID: "53,104,40,100,0",
    govPID: "30,40,0,5,30"
  };
  const getHeaderValue = (name) => headers[name] ?? "Not found";

  assert.equal(readHeaderSetting(getHeaderValue, "roll_d_gain"), 15);
  assert.equal(readHeaderSetting(getHeaderValue, "gov_gain"), 30);
  assert.equal(readHeaderSetting(getHeaderValue, "yaw_cw_stop_gain"), null);

  const applied = assessAppliedState({
    packMembers: [
      { setting: "roll_d_gain", to: 15 },
      { setting: "pitch_d_gain", to: 45 },
      { setting: "yaw_cw_stop_gain", to: 125 }
    ],
    getHeaderValue
  });

  assert.equal(applied.verdict, "partial");
  assert.equal(applied.members[0].state, "applied");
  assert.equal(applied.members[1].state, "not-applied");
  assert.equal(applied.members[2].state, "unverifiable");
});

test("the grader stays silent until floors exist", () => {
  const pack = {
    members: [
      { setting: "roll_d_gain", instrument: "pid.roll.settle", to: 15 },
      { setting: "pitch_d_gain", instrument: "pid.pitch.settle", to: 45 }
    ]
  };
  const appliedState = {
    members: [
      { setting: "roll_d_gain", state: "applied" },
      { setting: "pitch_d_gain", state: "not-applied" }
    ]
  };

  const graded = gradeAppliedPack({ pack, appliedState });

  assert.equal(graded.members[0].grade, GRADE.AWAITING_CALIBRATION);
  assert.equal(graded.members[1].grade, GRADE.NOT_APPLIED);
});
