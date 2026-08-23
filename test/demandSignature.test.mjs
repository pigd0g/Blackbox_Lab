// ======================================================
// TESTS — Compare exposes what the flights asked of the machine
// ======================================================
//
// Every dimension two flights can differ on is shown side by side
// and lowers the verdict's confidence visibly (#4, #32 / incubator
// #38): demand, per-axis stick demand, maneuver coverage, headspeed,
// collective work, length, evidence quality.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { demandSignature, compareDemand, ADEQUATE_AXIS_EVENTS } from "../src/analysis/demandSignature.js";
import { compareFlights } from "../src/analysis/compareFlights.js";

function side({
  demand = "normal",
  level = "High",
  rates = [80, 70, 60],
  events = { Roll: 12, Pitch: 10, Yaw: 9 },
  rpm = 2100,
  seconds = 120,
  collectiveStep = 2
} = {}) {
  const n = seconds * 10;
  const timeSeconds = Array.from({ length: n }, (_, i) => i / 10);
  const collective = Array.from({ length: n }, (_, i) => (i % 20 < 10 ? collectiveStep * 50 : 0));
  return {
    timeSeconds,
    pidConfidence: { level, demand, score: 80 },
    demandRates: rates,
    axisEvidence: events,
    labs: { governor: { perBank: [{ averageRpm: rpm, sampleCount: n }], averageHeadspeed: rpm } },
    collective,
    spectra: [],
    craftName: "Test Heli",
    pidScore: 90
  };
}

test("a matched pair reads High confidence with every dimension comparable", () => {
  const result = compareDemand(demandSignature(side()), demandSignature(side()));
  assert.equal(result.confidence, "High");
  assert.equal(result.level, "comparable");
  assert.ok(result.rows.length >= 6, `rows: ${result.rows.map((r) => r.key).join(",")}`);
  assert.ok(result.rows.every((row) => row.verdict === "match"));
  assert.deepEqual(result.reducedBy, []);
});

test("a headspeed bank change lowers confidence to Low and says why", () => {
  const result = compareDemand(demandSignature(side({ rpm: 2100 })), demandSignature(side({ rpm: 2400 })));
  assert.equal(result.confidence, "Low");
  const row = result.rows.find((r) => r.key === "headspeed");
  assert.equal(row.verdict, "mismatch");
  assert.match(row.before, /2100 rpm/);
  assert.match(row.after, /2400 rpm/);
  assert.match(row.note, /bank change/);
  assert.ok(result.reducedBy.includes("headspeed"));
});

test("thin coverage on one axis is partial: that axis is named as not judged", () => {
  const result = compareDemand(
    demandSignature(side({ events: { Roll: 12, Pitch: 10, Yaw: 2 } })),
    demandSignature(side())
  );
  assert.equal(result.confidence, "Medium");
  const row = result.rows.find((r) => r.key === "coverage");
  assert.equal(row.verdict, "partial");
  assert.match(row.note, new RegExp(`Yaw: fewer than ${ADEQUATE_AXIS_EVENTS}`));
});

test("a much harder stick demand on one axis is a mismatch on the rates row", () => {
  const result = compareDemand(
    demandSignature(side({ rates: [80, 70, 60] })),
    demandSignature(side({ rates: [80, 70, 200] }))
  );
  const row = result.rows.find((r) => r.key === "rates");
  assert.equal(row.verdict, "mismatch");
  assert.match(row.after, /Yaw 200°\/s/);
  assert.equal(result.confidence, "Low");
});

test("gentle vs real-input flights: demand mismatch, Low", () => {
  const result = compareDemand(demandSignature(side({ demand: "gentle" })), demandSignature(side()));
  assert.equal(result.rows.find((r) => r.key === "demand").verdict, "mismatch");
  assert.equal(result.confidence, "Low");
});

test("compareFlights carries the footing AND the causal gate in one comparability object", () => {
  const result = compareFlights(side(), side({ rpm: 2400 }));
  assert.ok(Array.isArray(result.comparability.rows), "rows present on the result");
  assert.equal(result.comparability.confidence, "Low");
  assert.equal(typeof result.comparability.likeForLike, "boolean");
  assert.match(result.summary, /Verdict confidence: Low — reduced by headspeed/);
});
