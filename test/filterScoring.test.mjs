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

// Above the level at which a profile stops reading as clean.
const VIBRATION_THAT_MATTERS = 14;
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

test("an unexplained peak costs the perfect score", () => {
  const { penalty } = assessUnresolvedFindings({
    unmatchedPeakCount: 1,
    averageReduction: 45,
    remainingVibration: VIBRATION_THAT_DOES_NOT
  });

  assert.ok(
    penalty > 0,
    "vibration the analysis cannot attribute is an open question"
  );
});

test("more unexplained peaks cost more, up to a limit", () => {
  const one = assessUnresolvedFindings({ unmatchedPeakCount: 1 }).penalty;
  const three = assessUnresolvedFindings({ unmatchedPeakCount: 3 }).penalty;
  const ten = assessUnresolvedFindings({ unmatchedPeakCount: 10 }).penalty;

  assert.ok(three > one);
  assert.ok(ten <= 25, "one finding must not consume the whole score");
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

test("the two vibration findings never both fire", () => {
  const result = assessUnresolvedFindings({
    averageReduction: 2,
    remainingVibration: VIBRATION_THAT_MATTERS
  });

  assert.equal(
    result.findings.length,
    1,
    "one remaining-vibration problem is charged once, not twice"
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
