// ======================================================
// TESTS — the Step Response verdict card
// ======================================================
//
// The card follows the worst axis (worst of rise, overshoot,
// settling). Low confidence (few segments) softens an
// attention to watch. No available axes means no card.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";

function stepResponseCard(stepResponseResult) {
  const verdict = buildFlightVerdict({
    spectra: [],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: null,
    labs: {},
    stepResponseResult
  });

  return verdict.cards.find((card) => card.key === "stepResponse");
}

function makeAxis(name, { rise = 50, overshoot = 0, settling = 0, segments = 20 }) {
  return {
    axis: name,
    available: true,
    timeMs: [0, 100, 200, 500],
    stepResponse: [0, 0.5, 1, 1],
    metrics: {
      riseTimeMs: rise,
      maxOvershoot: overshoot / 100,
      settlingTimeMs: settling
    },
    numSegments: segments,
    series: []
  };
}

function makeResult(axes) {
  return { aggregated: { axes, options: {} }, perFlight: [] };
}

test("returns no card when no axes are available", () => {
  const result = makeResult([
    { axis: "Roll", available: false, reason: "no data", metrics: {}, numSegments: 0, series: [] }
  ]);
  const card = stepResponseCard(result);
  assert.equal(card, undefined);
});

test("returns no card when stepResponseResult is null", () => {
  const card = stepResponseCard(null);
  assert.equal(card, undefined);
});

test("good metrics across all axes produce a good card", () => {
  const card = stepResponseCard(
    makeResult([
      makeAxis("Roll", { rise: 50, overshoot: 5, settling: 100, segments: 30 }),
      makeAxis("Pitch", { rise: 60, overshoot: 8, settling: 150, segments: 25 }),
      makeAxis("Yaw", { rise: 45, overshoot: 3, settling: 80, segments: 20 })
    ])
  );

  assert.ok(card);
  assert.equal(card.status, "good");
  assert.match(card.headline, /clean/);
});

test("overshoot above 30% produces an attention card", () => {
  const card = stepResponseCard(
    makeResult([
      makeAxis("Roll", { rise: 50, overshoot: 35, settling: 100, segments: 25 }),
      makeAxis("Pitch", { rise: 60, overshoot: 8, settling: 150, segments: 20 })
    ])
  );

  assert.ok(card);
  assert.equal(card.status, "attention");
  assert.match(card.headline, /Roll.*overshoot/);
  assert.match(card.action, /Lower roll P or raise roll D/);
});

test("overshoot between 15% and 30% produces a watch card", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Yaw", { rise: 50, overshoot: 20, settling: 100, segments: 20 })])
  );

  assert.ok(card);
  assert.equal(card.status, "watch");
  assert.match(card.headline, /Yaw.*overshoot.*worth a look/);
});

test("settling time above 450ms produces an attention card", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Pitch", { rise: 50, overshoot: 5, settling: 500, segments: 15 })])
  );

  assert.ok(card);
  assert.equal(card.status, "attention");
  assert.match(card.headline, /Pitch.*settle/);
  assert.match(card.action, /Raise pitch D/);
});

test("rise time above 130ms produces an attention card", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Roll", { rise: 140, overshoot: 5, settling: 100, segments: 20 })])
  );

  assert.ok(card);
  assert.equal(card.status, "attention");
  assert.match(card.headline, /Roll.*rise time/);
  assert.match(card.action, /Raise roll P and feed-forward/);
});

test("a settling time of 0 is treated as good", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Roll", { rise: 50, overshoot: 5, settling: 0, segments: 20 })])
  );

  assert.ok(card);
  assert.equal(card.status, "good");
});

test("low confidence softens attention to watch", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Pitch", { rise: 50, overshoot: 40, settling: 100, segments: 2 })])
  );

  assert.ok(card);
  assert.equal(card.status, "watch");
  assert.match(card.detail, /few segments/);
});

test("the worst axis drives the card", () => {
  const card = stepResponseCard(
    makeResult([
      makeAxis("Roll", { rise: 50, overshoot: 5, settling: 100, segments: 30 }),
      makeAxis("Pitch", { rise: 50, overshoot: 35, settling: 100, segments: 25 }),
      makeAxis("Yaw", { rise: 50, overshoot: 8, settling: 200, segments: 20 })
    ])
  );

  assert.ok(card);
  assert.equal(card.status, "attention");
  assert.match(card.headline, /Pitch/);
});

test("the card navigates to the stepResponse screen", () => {
  const card = stepResponseCard(
    makeResult([makeAxis("Roll", { rise: 50, overshoot: 5, settling: 100, segments: 20 })])
  );

  assert.ok(card);
  assert.equal(card.screen, "stepResponse");
  assert.match(card.evidence, /Step Response/);
});