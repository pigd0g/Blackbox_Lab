// ======================================================
// TESTS — the tracking score is continuous
// ======================================================
//
// A score that can only land on seven values is a category
// label wearing a number. The continuous score moves with
// the measured relative tracking error, so a crisp machine
// and a sloppy one no longer read the same.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  computeTrackingScore,
  TRACKING_SCORE_TUNING
} from "../src/analysis/pidAnalysis.js";

test("the score falls as measured tracking error grows", () => {
  const crisp = computeTrackingScore({ relativeError: 0.2 });
  const decent = computeTrackingScore({ relativeError: 0.5 });
  const sloppy = computeTrackingScore({ relativeError: 1.0 });

  assert.ok(crisp.score > decent.score);
  assert.ok(decent.score > sloppy.score);
  assert.equal(
    crisp.score,
    100 - TRACKING_SCORE_TUNING.REAL_WORLD_MARGIN,
    "error below the full-marks threshold deducts nothing"
  );
});

test("nearby error values produce nearby scores", () => {
  const a = computeTrackingScore({ relativeError: 0.6 }).score;
  const b = computeTrackingScore({ relativeError: 0.65 }).score;

  assert.ok(
    Math.abs(a - b) <= 3,
    `a small error change must not jump the score (${a} vs ${b})`
  );
  assert.ok(a !== b || a > 0, "distinct errors resolve distinctly");
});

test("balance and saturation reviews still cost, with caps", () => {
  const clean = computeTrackingScore({ relativeError: 0.3 });
  const reviewed = computeTrackingScore({
    relativeError: 0.3,
    commandBalanceReviewCount: 2,
    saturationReviewCount: 1
  });
  const flooded = computeTrackingScore({
    relativeError: 0.3,
    commandBalanceReviewCount: 9,
    saturationReviewCount: 9
  });

  assert.ok(reviewed.score < clean.score);
  assert.equal(
    flooded.balanceDeduction,
    TRACKING_SCORE_TUNING.MAX_BALANCE_DEDUCTION
  );
  assert.equal(
    flooded.saturationDeduction,
    TRACKING_SCORE_TUNING.MAX_SATURATION_DEDUCTION
  );
});

test("an unmeasurable relative error deducts nothing for tracking", () => {
  const result = computeTrackingScore({ relativeError: null });

  assert.equal(result.trackingDeduction, 0);
});
