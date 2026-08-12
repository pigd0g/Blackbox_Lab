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
