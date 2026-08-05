// ======================================================
// PID CONFIDENCE — RATE THE EVIDENCE, NOT THE COLUMNS
// ======================================================
//
// Confidence was built from what the log contained: three
// axes with samples, enough of them, every PID column
// detected. None of that asks whether the checks built on
// those columns had anything to measure, so a flight with
// almost no clean command responses still rated High.
//
// The trap on the other side: an overshoot figure only
// exists where a response crossed past its target, so a
// well-tracking axis produces none. Counting that as
// missing evidence would mark down the best-flying
// machines for flying well — the opposite error, and
// easier to make.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  assessCommandEvidence,
  commandEvidenceConfidence
} from "../src/analysis/pidAnalysis.js";

function axis(name, { responses = 0, overshoots = 0 } = {}) {
  const events = [];

  for (let index = 0; index < responses; index += 1) {
    events.push({
      responsePeak: 10 + index,
      overshootPercent: index < overshoots ? 12 : null
    });
  }

  return { axis: name, events };
}

test("plenty of clean responses is strong evidence", () => {
  const { penalty } = assessCommandEvidence([
    axis("Roll", { responses: 20 }),
    axis("Pitch", { responses: 15 }),
    axis("Yaw", { responses: 30 })
  ]);

  assert.equal(penalty, 0);
});

test("an axis that tracked well is not penalised for not misbehaving", () => {
  // 20 clean responses, none of which overshot. That is an answer
  // about the machine, not a hole in the evidence.
  const { penalty, thinAxes } = assessCommandEvidence([
    axis("Roll", { responses: 20, overshoots: 0 }),
    axis("Pitch", { responses: 15, overshoots: 0 }),
    axis("Yaw", { responses: 30, overshoots: 0 })
  ]);

  assert.equal(penalty, 0, "flying well must not cost confidence");
  assert.deepEqual(thinAxes, []);
});

test("an axis with almost no clean responses lowers confidence", () => {
  const { penalty, thinAxes } = assessCommandEvidence([
    axis("Roll", { responses: 1 }),
    axis("Pitch", { responses: 20 }),
    axis("Yaw", { responses: 20 })
  ]);

  assert.ok(penalty > 0, "a check with nothing to measure is a limit");
  assert.deepEqual(
    thinAxes.map((entry) => entry.axis),
    ["Roll"]
  );
});

test("thinner evidence costs more than merely sparse evidence", () => {
  const sparse = assessCommandEvidence([axis("Roll", { responses: 3 })])
    .penalty;
  const none = assessCommandEvidence([axis("Roll", { responses: 0 })])
    .penalty;

  assert.ok(none > sparse, "severity has to move confidence");
});

test("every axis being thin costs more than one", () => {
  const one = assessCommandEvidence([
    axis("Roll", { responses: 0 }),
    axis("Pitch", { responses: 20 }),
    axis("Yaw", { responses: 20 })
  ]).penalty;

  const all = assessCommandEvidence([
    axis("Roll", { responses: 0 }),
    axis("Pitch", { responses: 0 }),
    axis("Yaw", { responses: 0 })
  ]).penalty;

  assert.ok(all > one);
});

test("the confidence wording matches the thresholds it reports", () => {
  // The per-axis label and the overall rating are one judgement; a
  // page that prints "Insufficient" beside "High" tells a pilot two
  // different things about one flight.
  assert.equal(commandEvidenceConfidence(0), "Insufficient");
  assert.equal(commandEvidenceConfidence(2), "Low");
  assert.equal(commandEvidenceConfidence(5), "Medium");
  assert.equal(commandEvidenceConfidence(10), "High");
});

test("no command events at all is handled without throwing", () => {
  assert.equal(assessCommandEvidence([]).penalty, 0);
  assert.equal(assessCommandEvidence().penalty, 0);
});
