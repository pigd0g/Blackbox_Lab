// ======================================================
// BLACKBOX LAB — RECOMMENDATION ENGINE TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// The engine only READS structured findings, so fixtures
// are hand-built analysis results with known signatures.
// These tests pin the gate: when a directional suggestion
// may appear, which knob it names, and what the object
// says when it stays silent.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRecommendations,
  RECOMMENDATION_GATE
} from "../src/analysis/recommendationEngine.js";

// 100 Hz timeline: settlingDurationSamples × 10 ms.
const timeSeconds = Array.from({ length: 10_000 }, (_, i) => i / 100);

function commandEvent({
  slow = false,
  hunting = false,
  clean = true
} = {}) {
  return {
    responsePeak: clean ? 100 : NaN,
    settlingDetected: true,
    settlingDurationSamples: slow ? 90 : 20, // 900 vs 200 ms
    ringingTargetCrossingCount: hunting ? 4 : 0,
    sampleRowIndex: 1000
  };
}

function axisEvents(axis, events) {
  return { axis, events };
}

// 10+ clean events = High confidence per the shared tiers.
function highConfidenceAxis(axis, { slowCount, huntingCount }) {
  const events = [];

  for (let index = 0; index < slowCount; index += 1) {
    events.push(
      commandEvent({ slow: true, hunting: index < huntingCount })
    );
  }

  while (events.length < 12) {
    events.push(commandEvent());
  }

  return axisEvents(axis, events);
}

function governorEvent({ cause, hunting = false }) {
  return {
    id: `gov:${Math.floor(Math.random * 1000)}`,
    cause,
    hunting,
    t: 40,
    peakErrorPercent: 7,
    outputMaxPercent: cause === "power-limit" ? 99 : 70
  };
}

test("slow settling with hunting majority suggests axis D, up, small step", () => {
  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [
        highConfidenceAxis("Pitch", { slowCount: 4, huntingCount: 3 })
      ]
    },
    timeSeconds
  });

  assert.equal(result.pid.length, 1);
  const [rec] = result.pid;
  assert.equal(rec.axis, "Pitch");
  assert.equal(rec.confidence, "High");
  assert.deepEqual(rec.suggestion, {
    family: "pitch_d_gain",
    direction: "up",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /underdamped/);
  assert.match(rec.verifyMetric, /Flight Events/);
});

test("slow settling without hunting but with I-dominance suggests feedforward", () => {
  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [
        highConfidenceAxis("Roll", { slowCount: 3, huntingCount: 0 })
      ]
    },
    commandBalanceReviewAxes: ["Roll"],
    timeSeconds
  });

  const [rec] = result.pid;
  assert.deepEqual(rec.suggestion, {
    family: "roll_f_gain",
    direction: "up",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /feedforward is supposed to do that work/);
});

test("mixed signature stays non-directional", () => {
  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [
        highConfidenceAxis("Roll", { slowCount: 3, huntingCount: 0 })
      ]
    },
    commandBalanceReviewAxes: [],
    timeSeconds
  });

  const [rec] = result.pid;
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /confirm the pattern/i);
});

test("low evidence confidence gates the suggestion and says why", () => {
  // 4 clean events = Low confidence, 2 of them slow+hunting.
  const events = [
    commandEvent({ slow: true, hunting: true }),
    commandEvent({ slow: true, hunting: true }),
    commandEvent(),
    commandEvent()
  ];

  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [axisEvents("Yaw", events)]
    },
    timeSeconds
  });

  const [rec] = result.pid;
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /confidence is Low/);
  assert.match(rec.gatedReason, /4 clean commands/);
});

test("an open vibration finding silences PID suggestions — filters first", () => {
  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [
        highConfidenceAxis("Pitch", { slowCount: 4, huntingCount: 3 })
      ]
    },
    timeSeconds,
    vibrationConcern: true
  });

  const [rec] = result.pid;
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /Filters come before PIDs/);
});

test("one slow event is not a pattern — no recommendation at all", () => {
  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [
        highConfidenceAxis("Roll", { slowCount: 1, huntingCount: 1 })
      ]
    },
    timeSeconds
  });

  assert.equal(result.pid.length, 0);
});

test("three overspeeds after collective drops suggest gov_f_gain down", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [
        governorEvent({ cause: "collective-drop", hunting: true }),
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" })
      ]
    }
  });

  assert.equal(result.governor.length, 1);
  const [rec] = result.governor;
  assert.equal(rec.confidence, "High");
  assert.deepEqual(rec.suggestion, {
    family: "gov_f_gain",
    direction: "down",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /feedforward\/precomp/);
});

test("two collective-drop events are a hint, not a pattern", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" })
      ]
    }
  });

  const [rec] = result.governor;
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /hint, not a pattern/);
});

test("a power-limit event outranks and silences precomp advice", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [
        governorEvent({ cause: "power-limit" }),
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" })
      ]
    }
  });

  assert.equal(result.governor.length, 1);
  const [rec] = result.governor;
  assert.equal(rec.id, "governor:power-limit");
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /ESC Lab/);
});

test("empty inputs produce empty recommendation lists", () => {
  const result = buildRecommendations({});
  assert.deepEqual(result, { pid: [], governor: [] });
});

test("gate constants stay explicit", () => {
  assert.equal(RECOMMENDATION_GATE.MINIMUM_EVENTS, 2);
  assert.ok(RECOMMENDATION_GATE.GOVERNOR_HIGH_CONFIDENCE_EVENTS >= 3);
});

function precompFixture(overrides = {}) {
  return {
    governor: {
      balance: "low",
      riseDroopPercent: 4.2,
      dropOvershootPercent: 0.8,
      riseCount: 12,
      dropCount: 11,
      ...overrides.governor
    },
    tail: overrides.tail ?? null
  };
}

test("precomp running low suggests gov_f_gain up from the ratio view", () => {
  const result = buildRecommendations({
    precomp: precompFixture()
  });

  assert.equal(result.governor.length, 1);
  const [rec] = result.governor;
  assert.equal(rec.id, "governor:precomp-low");
  assert.deepEqual(rec.suggestion, {
    family: "gov_f_gain",
    direction: "up",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /before the load does/);
});

test("precomp running high suggests gov_f_gain down when no event rec fired", () => {
  const result = buildRecommendations({
    precomp: precompFixture({
      governor: {
        balance: "high",
        riseDroopPercent: 0.6,
        dropOvershootPercent: 4.5
      }
    })
  });

  const [rec] = result.governor;
  assert.equal(rec.id, "governor:precomp-high");
  assert.equal(rec.suggestion.direction, "down");
});

test("the ratio view stays quiet when the event-based precomp rec already fired", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" })
      ]
    },
    precomp: precompFixture({
      governor: { balance: "high", dropOvershootPercent: 5 }
    })
  });

  assert.equal(result.governor.length, 1);
  assert.equal(result.governor[0].id, "governor:precomp-overshoot");
});

test("two-sided lag is not given a precomp direction", () => {
  const result = buildRecommendations({
    precomp: precompFixture({
      governor: {
        balance: "lagging",
        riseDroopPercent: 3.8,
        dropOvershootPercent: 3.1
      }
    })
  });

  const [rec] = result.governor;
  assert.equal(rec.id, "governor:response-lag");
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /ESC Lab/);
});

test("a power-limit event silences the ratio view too", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [governorEvent({ cause: "power-limit" })]
    },
    precomp: precompFixture()
  });

  assert.equal(result.governor.length, 1);
  assert.equal(result.governor[0].id, "governor:power-limit");
});

test("tail coupling names the knob and the two-way verify plan", () => {
  const result = buildRecommendations({
    precomp: {
      governor: null,
      tail: {
        balance: "coupled",
        kickRatio: 6.2,
        transientError: 74,
        consistency: 0.92,
        kickCount: 18
      }
    }
  });

  assert.equal(result.governor.length, 1);
  const [rec] = result.governor;
  assert.equal(rec.id, "governor:tail-coupling");
  assert.equal(rec.confidence, "High");
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /yaw_collective_ff_gain/);
  assert.match(rec.gatedReason, /if the kick grows, go the other way/);
});

// ---- overshoot driver disambiguation ----

function overshootEvent({
  overshoot,
  size = 100,
  durationSamples = 10,
  ringing = 0,
  index = 0
}) {
  return {
    responsePeak: 100,
    settlingDetected: true,
    settlingDurationSamples: 20,
    ringingTargetCrossingCount: ringing,
    overshootPercent: overshoot,
    commandMagnitude: size,
    sampleIndex: 1000 + index * 500,
    commandEndSampleIndex: 1000 + index * 500 + durationSamples,
    sampleRowIndex: 1000 + index * 500
  };
}

function overshootAxis(axis, events) {
  const padded = [...events];
  let i = events.length;

  // Pad to High confidence with clean, non-overshooting events.
  while (padded.length < 12) {
    padded.push({
      responsePeak: 100,
      settlingDetected: true,
      settlingDurationSamples: 20,
      ringingTargetCrossingCount: 0,
      overshootPercent: NaN,
      commandMagnitude: 100,
      sampleIndex: 20_000 + i * 500,
      commandEndSampleIndex: 20_000 + i * 500 + 10,
      sampleRowIndex: 20_000 + i * 500
    });
    i += 1;
  }

  return { axis, events: padded };
}

test("ringing overshoots suggest damping up", () => {
  // The fleet-anchored trigger needs nearly every command
  // overshooting, by a lot: 12 of 12, median well over 115%.
  const events = [120, 135, 140, 132, 138, 125, 150, 118, 122, 145, 128, 131].map(
    (overshoot, index) =>
      overshootEvent({ overshoot, ringing: index < 8 ? 4 : 0, index })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Roll", events }] },
    timeSeconds
  });

  const rec = result.pid.find((r) => r.id === "pid:Roll:overshoot");
  assert.ok(rec, JSON.stringify(result.pid.map((r) => r.id)));
  assert.deepEqual(rec.suggestion, {
    family: "roll_d_gain",
    direction: "up",
    magnitudeClass: "small step"
  });
  assert.ok(!("dampingSide" in rec), "internal flag leaked");
});

test("overshoot growing with command rate suggests feedforward down", () => {
  // Same command size, varying duration: faster command = bigger
  // overshoot. Size is constant so it cannot be the driver. Every
  // event clears the fleet bars (all big, median >115%).
  const durations = [40, 35, 30, 25, 20, 15, 10, 8, 6, 5, 4, 4];
  const events = durations.map((durationSamples, index) =>
    overshootEvent({
      overshoot: 100 + (100 / durationSamples) * 5,
      durationSamples,
      index
    })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Pitch", events }] },
    timeSeconds
  });

  const rec = result.pid.find((r) => r.id === "pid:Pitch:overshoot");
  assert.ok(rec);
  assert.deepEqual(rec.suggestion, {
    family: "pitch_f_gain",
    direction: "down",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /how FAST/);
});

test("overshoot growing with command size suggests proportional down", () => {
  // Duration scales with size, so the RATE is constant — only the
  // size can be the driver. Every event clears the fleet bars.
  const sizes = [60, 80, 100, 120, 140, 160, 180, 200, 220, 250, 280, 300];
  const events = sizes.map((size, index) =>
    overshootEvent({
      overshoot: 90 + size / 4,
      size,
      durationSamples: size / 10,
      index
    })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Yaw", events }] },
    timeSeconds
  });

  const rec = result.pid.find((r) => r.id === "pid:Yaw:overshoot");
  assert.ok(rec);
  assert.deepEqual(rec.suggestion, {
    family: "yaw_p_gain",
    direction: "down",
    magnitudeClass: "small step"
  });
  assert.match(rec.hypothesis, /how BIG/);
});

test("an inseparable driver names both knobs, feedforward first", () => {
  // Overshoot uncorrelated with either candidate; all events clear
  // the fleet bars so only the driver question stays open.
  const rows = [
    { overshoot: 130, size: 100, durationSamples: 10 },
    { overshoot: 145, size: 100, durationSamples: 10 },
    { overshoot: 128, size: 200, durationSamples: 20 },
    { overshoot: 150, size: 200, durationSamples: 20 },
    { overshoot: 133, size: 150, durationSamples: 15 },
    { overshoot: 141, size: 150, durationSamples: 15 },
    { overshoot: 126, size: 120, durationSamples: 12 },
    { overshoot: 148, size: 120, durationSamples: 12 },
    { overshoot: 135, size: 180, durationSamples: 18 },
    { overshoot: 139, size: 180, durationSamples: 18 },
    { overshoot: 124, size: 160, durationSamples: 16 },
    { overshoot: 143, size: 160, durationSamples: 16 }
  ];
  const events = rows.map((row, index) =>
    overshootEvent({ ...row, index })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Roll", events }] },
    timeSeconds
  });

  const rec = result.pid.find((r) => r.id === "pid:Roll:overshoot");
  assert.ok(rec);
  assert.equal(
    rec.suggestion.family,
    "roll_f_gain, then roll_p_gain"
  );
  assert.match(rec.expectedResult, /step it first/);
});

test("one big overshoot is not a pattern", () => {
  const events = [overshootEvent({ overshoot: 60 })];

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [overshootAxis("Roll", events)] },
    timeSeconds
  });

  assert.equal(
    result.pid.find((r) => r.id === "pid:Roll:overshoot"),
    undefined
  );
});

test("vibration silences overshoot advice too", () => {
  const events = [120, 135, 140, 132, 138, 125, 150, 118, 122, 145, 128, 131].map(
    (overshoot, index) => overshootEvent({ overshoot, ringing: 4, index })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Roll", events }] },
    timeSeconds,
    vibrationConcern: true
  });

  const rec = result.pid.find((r) => r.id === "pid:Roll:overshoot");
  assert.equal(rec.suggestion, null);
  assert.match(rec.gatedReason, /Filters come before PIDs/);
});

test("damping advice is not said twice on one axis", () => {
  // Slow settling WITH hunting (damping rec) plus ringing
  // overshoots (also damping-side) → only the slow-settle rec
  // carries the knob.
  const slowHunting = [0, 1, 2, 3].map((index) => ({
    responsePeak: 100,
    settlingDetected: true,
    settlingDurationSamples: 90,
    ringingTargetCrossingCount: 4,
    overshootPercent: 30 + index,
    commandMagnitude: 100,
    sampleIndex: 1000 + index * 500,
    commandEndSampleIndex: 1010 + index * 500,
    sampleRowIndex: 1000 + index * 500
  }));

  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [overshootAxis("Pitch", slowHunting)]
    },
    timeSeconds
  });

  const dampingRecs = result.pid.filter(
    (r) => r.suggestion?.family === "pitch_d_gain"
  );
  assert.equal(dampingRecs.length, 1, JSON.stringify(result.pid.map((r) => [r.id, r.suggestion?.family])));
  assert.equal(dampingRecs[0].id, "pid:Pitch:slow-settling");
});

test("vibration silences governor advice too — filters before governor", () => {
  const result = buildRecommendations({
    governorEvents: {
      events: [
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" }),
        governorEvent({ cause: "collective-drop" })
      ]
    },
    precomp: {
      governor: null,
      tail: {
        balance: "coupled",
        kickRatio: 6,
        transientError: 70,
        consistency: 0.9,
        kickCount: 15
      }
    },
    vibrationConcern: true
  });

  for (const rec of result.governor) {
    assert.equal(rec.suggestion, null, rec.id);
  }

  const precompRec = result.governor.find(
    (rec) => rec.id === "governor:precomp-overshoot"
  );
  assert.match(precompRec.gatedReason, /vibration/i);

  const tailRec = result.governor.find(
    (rec) => rec.id === "governor:tail-coupling"
  );
  assert.match(tailRec.gatedReason, /Filters come first/);
  assert.ok(
    !tailRec.gatedReason.includes("yaw_collective_ff_gain"),
    "vibration-suspect tail read still handed out the knob"
  );
});


test("ordinary fleet-level overshoot never triggers a recommendation", () => {
  // The fleet's MEDIAN axis: most commands overshoot ~47%. That is
  // the measurement's norm, not a tuning fault — no card.
  const events = [40, 55, 47, 60, 35, 50, 45, 52, 38, 48, 44, 58].map(
    (overshoot, index) => overshootEvent({ overshoot, index })
  );

  const result = buildRecommendations({
    trackingAnalysis: { commandEvents: [{ axis: "Roll", events }] },
    timeSeconds
  });

  assert.equal(
    result.pid.find((r) => r.id === "pid:Roll:overshoot"),
    undefined
  );
});

test("slow events diluted across a long flight never trigger", () => {
  // Two slow settles among forty commands is the fleet's ordinary
  // background, not a pattern — however real each event was.
  const events = [];
  for (let index = 0; index < 2; index += 1) {
    events.push(commandEvent({ slow: true, hunting: true }));
  }
  while (events.length < 40) {
    events.push(commandEvent());
  }

  const result = buildRecommendations({
    trackingAnalysis: {
      commandEvents: [axisEvents("Pitch", events)]
    },
    timeSeconds
  });

  assert.equal(
    result.pid.find((r) => r.id === "pid:Pitch:slow-settling"),
    undefined
  );
});
