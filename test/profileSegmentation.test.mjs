// ======================================================
// TESTS — per-profile flight segmentation
// ======================================================
//
// A flight that switched PID profiles mid-air flew two
// tunes. The segments say which rows flew which profile,
// the adapter turns recorded switches into the pidProfile
// column, and the pack builder attributes every earned
// change to the profile whose rows its evidence lives in
// — or queues it with the reason spelled out. The log
// never names its starting profile, so numbers exist only
// for changes earned there: the headers describe that
// profile and no other.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProfileSegments,
  distinctProfiles,
  attributeRows,
  profileName
} from "../src/analysis/profileSegments.js";
import { decodedFlightToCsvLines } from "../src/analysis/bbl/csvAdapter.js";
import { buildPack } from "../src/analysis/packBuilder.js";

const FIRMWARE = "Rotorflight 4.6.0 (118e912) STM32F7X2";

// ---- segments from the column ----

function linesWithProfileColumn() {
  const lines = [
    `"firmware","${FIRMWARE}"`,
    "time,gyroADC[0],pidProfile"
  ];

  for (let row = 0; row < 10; row += 1) {
    // rows 0-3 profile 0 (unknown start), 4-7 profile 2, 8-9 profile 4
    const profile = row < 4 ? 0 : row < 8 ? 2 : 4;
    lines.push(`${row * 1000},0,${profile}`);
  }

  return lines;
}

test("contiguous same-profile rows fold into one segment each", () => {
  const segments = buildProfileSegments({
    lines: linesWithProfileColumn(),
    telemetryHeaderIndex: 1
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.profile),
    [null, 2, 4]
  );
  assert.equal(segments[0].firstRowIndex, 2);
  assert.equal(segments[0].lastRowIndex, 5);
  assert.equal(segments[1].firstRowIndex, 6);
  assert.equal(segments[2].sampleCount, 2);
});

test("no pidProfile column means no segments — not a guess", () => {
  const segments = buildProfileSegments({
    lines: ["time,gyroADC[0]", "0,1", "1000,2"],
    telemetryHeaderIndex: 0
  });

  assert.deepEqual(segments, []);
});

test("attribution finds the owning profile and refuses rows outside", () => {
  const segments = buildProfileSegments({
    lines: linesWithProfileColumn(),
    telemetryHeaderIndex: 1
  });

  assert.deepEqual(attributeRows(segments, [3, 4]), {
    profiles: [null],
    unanchored: 0
  });
  assert.deepEqual(attributeRows(segments, [6, 7]).profiles, [2]);
  assert.deepEqual(attributeRows(segments, [3, 7]).profiles, [null, 2]);
  assert.equal(attributeRows(segments, [999]).unanchored, 1);
  assert.deepEqual(distinctProfiles(segments), [null, 2, 4]);
});

// ---- the adapter writes the column from recorded switches ----

function decodedFlight({ events = [] } = {}) {
  return {
    headers: new Map([["Craft name", "test"]]),
    sysConfig: { firmwareType: "Rotorflight", firmwareRevision: "4.6.0" },
    mainFieldNames: ["time", "gyroADC[0]"],
    mainFrames: [
      [0, 1],
      [1000, 2],
      [2000, 3],
      [3000, 4]
    ],
    slowFieldNames: [],
    slowFrames: [],
    events
  };
}

test("recorded PID profile switches become the pidProfile column", () => {
  const lines = decodedFlightToCsvLines(
    decodedFlight({
      events: [
        // rate-profile switch (fn 1) must be ignored
        { type: 13, adjustmentFunction: 1, value: 9, afterMainFrame: 0 },
        { type: 13, adjustmentFunction: 2, value: 2, afterMainFrame: 1 }
      ]
    })
  );

  const headerIndex = lines.findIndex((line) => line.startsWith("time,"));
  assert.ok(lines[headerIndex].endsWith(",pidProfile"));

  const values = lines
    .slice(headerIndex + 1)
    .map((line) => line.split(",").at(-1));
  // switch after main frame 1 → active from frame 2 on
  assert.deepEqual(values, ["0", "0", "2", "2"]);
});

test("a flight without switches gets no pidProfile column at all", () => {
  const lines = decodedFlightToCsvLines(decodedFlight());
  const headerIndex = lines.findIndex((line) => line.startsWith("time,"));

  assert.ok(!lines[headerIndex].includes("pidProfile"));
});

// ---- pack attribution ----

const SEGMENTS = [
  { profile: null, firstRowIndex: 100, lastRowIndex: 499, sampleCount: 400 },
  { profile: 2, firstRowIndex: 500, lastRowIndex: 899, sampleCount: 400 },
  { profile: 1, firstRowIndex: 900, lastRowIndex: 999, sampleCount: 100 }
];

function earnedWithRows(axis, family, rows, extra = {}) {
  return {
    id: `pid:${axis}:test:${family}`,
    lab: "pid",
    axis,
    level: "earned",
    blockedBy: null,
    confidence: extra.confidence ?? "High",
    suggestion: {
      family,
      direction: "up",
      magnitudeClass: "small step"
    },
    evidence: rows.map((rowIndex) => ({
      kind: "command-event",
      axis,
      rowIndex
    })),
    instrument: `pid.${axis.toLowerCase()}.settle`,
    finding: `${axis} test finding`,
    expectedResult: "improves"
  };
}

test("evidence living in one switched-to profile packs — direction only, reason named", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earnedWithRows("Roll", "roll_d_gain", [520, 640, 800])],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    getHeaderValue: (h) => (h === "rollPID" ? "52,102,10,100,0" : "Not found"),
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 1);
  assert.equal(pack.members[0].profile, 2);
  // the headers describe the log-start profile, not profile 2
  assert.equal(pack.members[0].to, null);
  assert.match(pack.members[0].numericNote, /profile 2/);
  assert.deepEqual(pack.profiles.flown, [null, 2, 1]);
  assert.equal(pack.profiles.packProfile, 2);
});

test("evidence in the log-start profile keeps its numbers — the headers describe it", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earnedWithRows("Roll", "roll_d_gain", [150, 300])],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    getHeaderValue: (h) => (h === "rollPID" ? "52,102,10,100,0" : "Not found"),
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 1);
  assert.equal(pack.members[0].profile, null);
  assert.equal(pack.members[0].from, 10);
  assert.equal(pack.members[0].to, 15);
  assert.equal(pack.profiles.packProfileName, "the log-start profile");
});

test("mixed-profile evidence queues with the spanned profiles named", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earnedWithRows("Roll", "roll_d_gain", [300, 600])],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 0);
  assert.equal(pack.queued.length, 1);
  assert.match(pack.queued[0].reason, /spans/);
  assert.match(pack.queued[0].reason, /the log-start profile and profile 2/);
});

test("evidence without row anchors queues on a multi-profile flight", () => {
  const rec = earnedWithRows("Roll", "roll_d_gain", []);
  rec.evidence = [{ kind: "precomp-balance", riseCount: 4 }];

  const pack = buildPack({
    recommendations: { pid: [rec], governor: [] },
    firmwareRevision: FIRMWARE,
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 0);
  assert.match(pack.queued[0].reason, /no row anchors/);
});

test("one pack verifies one profile — members from another queue for their own", () => {
  const pack = buildPack({
    recommendations: {
      pid: [
        earnedWithRows("Roll", "roll_d_gain", [520]),
        earnedWithRows("Pitch", "pitch_d_gain", [200])
      ],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 1);
  assert.equal(pack.members[0].profile, 2);
  assert.equal(pack.queued.length, 1);
  assert.match(pack.queued[0].reason, /this pack verifies profile 2/);
});

test("recorded switches lift the multi-bank refusal — attribution beats withholding", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earnedWithRows("Roll", "roll_d_gain", [520])],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    headspeedBanks: [{ averageRpm: 1330 }, { averageRpm: 1850 }],
    profileSegments: SEGMENTS
  });

  assert.equal(pack.members.length, 1);
  assert.equal(pack.withheld, null);
});

test("without recorded switches the multi-bank refusal stands untouched", () => {
  const pack = buildPack({
    recommendations: {
      pid: [earnedWithRows("Roll", "roll_d_gain", [520])],
      governor: []
    },
    firmwareRevision: FIRMWARE,
    headspeedBanks: [{ averageRpm: 1330 }, { averageRpm: 1850 }],
    profileSegments: []
  });

  assert.equal(pack.members.length, 0);
  assert.ok(pack.withheld);
  assert.equal(pack.profiles, null);
});

test("profile names read like a person wrote them", () => {
  assert.equal(profileName(null), "the log-start profile");
  assert.equal(profileName(4), "profile 4");
});
