// ======================================================
// FILTER SCORING — UNRESOLVED FINDINGS COST SOMETHING
// ======================================================
//
// A filter score that counts only how many column groups
// were detected reaches 100 on any readable log — beside
// its own findings reporting an unexplained peak, or
// filters measurably removing almost nothing. A perfect
// score has to mean the analysis found nothing left to
// resolve.
//
// The distinction these tests protect: filters removing
// little on an already-quiet machine is the correct
// outcome. Filters removing little while real vibration
// remains is a finding. Scoring both the same sends a
// pilot chasing filters on a healthy helicopter.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { assessUnresolvedFindings } from "../src/analysis/filterAnalysis.js";

// Levels are calibrated against the contributed fleet, whose
// per-profile filtered level runs a median of 15.5 and an upper
// quartile of 30.5. "Matters" is elevated for this fleet; "high" is
// genuinely unusual; "ordinary" is what most machines look like.
const VIBRATION_HIGH = 35;
const VIBRATION_THAT_MATTERS = 20;
const VIBRATION_THAT_DOES_NOT = 6;

test("a clean result leaves nothing to answer for", () => {
  const { findings, penalty } = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: 45,
    remainingVibration: VIBRATION_THAT_DOES_NOT
  });

  assert.deepEqual(findings, []);
  assert.equal(penalty, 0, "a genuinely clean analysis still scores full marks");
});

test("an unmatched peak counts only when the matcher is working", () => {
  // Across the contributed fleet most flights match no known frequency
  // at all. Deducting for "unmatched" on its own would score the
  // matcher's reach, not the machine — and mark down the pilot for it.
  const matcherFoundNothing = assessUnresolvedFindings({
    unmatchedPeakCount: 3,
    matchedPeakCount: 0,
    averageReduction: 45,
    remainingVibration: VIBRATION_THAT_DOES_NOT
  });

  assert.equal(
    matcherFoundNothing.penalty,
    0,
    "a matcher that recognises nothing is not evidence about the machine"
  );

  const matcherWorking = assessUnresolvedFindings({
    unmatchedPeakCount: 1,
    matchedPeakCount: 2,
    averageReduction: 45,
    remainingVibration: VIBRATION_THAT_DOES_NOT
  });

  assert.ok(
    matcherWorking.penalty > 0,
    "a peak standing out among recognised ones is a real open question"
  );
});

test("more unexplained peaks cost more, up to a limit", () => {
  const one = assessUnresolvedFindings({
    unmatchedPeakCount: 1,
    matchedPeakCount: 1
  }).penalty;
  const three = assessUnresolvedFindings({
    unmatchedPeakCount: 3,
    matchedPeakCount: 1
  }).penalty;
  const ten = assessUnresolvedFindings({
    unmatchedPeakCount: 10,
    matchedPeakCount: 1
  }).penalty;

  assert.ok(three > one);
  assert.ok(ten <= 10, "one finding must not dominate the score");
});

test("quiet machine, little filtering: not a fault", () => {
  const result = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: 3.4,
    remainingVibration: VIBRATION_THAT_DOES_NOT
  });

  assert.equal(
    result.filtersAreIneffective,
    false,
    "there was little vibration to remove"
  );
  assert.equal(result.penalty, 0);
});

test("real vibration, little filtering: a fault", () => {
  const result = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: 3.4,
    remainingVibration: VIBRATION_THAT_MATTERS
  });

  assert.equal(result.filtersAreIneffective, true);
  assert.ok(result.penalty > 0);
  assert.match(
    result.findings[0].reason,
    /3\.4%/,
    "the finding states the measured figure rather than a vague warning"
  );
});

test("vibration left behind is a finding even when filters worked hard", () => {
  const result = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: 55,
    remainingVibration: VIBRATION_THAT_MATTERS
  });

  assert.ok(
    result.penalty > 0,
    "a machine still shaking is worth saying so, however much was removed"
  );
  assert.equal(
    result.filtersAreIneffective,
    false,
    "the filters are not the thing at fault here"
  );
});

test("an ordinary machine is not marked down for being ordinary", () => {
  // The fleet median sits around 15.5; scoring that as a problem would
  // tell most pilots their helicopter needs attention when it does not.
  const result = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: 24,
    remainingVibration: 15
  });

  assert.equal(result.penalty, 0);
});

test("unusually high vibration costs more than merely elevated", () => {
  const elevated = assessUnresolvedFindings({
    averageReduction: 45,
    remainingVibration: VIBRATION_THAT_MATTERS
  }).penalty;

  const high = assessUnresolvedFindings({
    averageReduction: 45,
    remainingVibration: VIBRATION_HIGH
  }).penalty;

  assert.ok(high > elevated, "severity has to move the score");
});

test("one remaining-vibration problem is charged once", () => {
  const result = assessUnresolvedFindings({
    averageReduction: 2,
    remainingVibration: VIBRATION_THAT_MATTERS
  });

  assert.equal(
    result.findings.length,
    1,
    "the same vibration must not be deducted for twice"
  );
});

test("missing measurements are not treated as problems", () => {
  const result = assessUnresolvedFindings({
    unmatchedPeakCount: 0,
    averageReduction: null,
    remainingVibration: null
  });

  assert.equal(
    result.penalty,
    0,
    "absent evidence lowers confidence, it does not invent findings"
  );
});
