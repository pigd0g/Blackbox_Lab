// ======================================================
// TESTS — command-balance bars are per-axis and the
// deduction scales with severity
// ======================================================
//
// The bars were re-anchored on the aligned measurement
// (2026-08-21 fleet calibration): on true data the fleet's
// NORMAL state is I doing most of the command work, so the
// flag must mark each axis's genuine tail, not the median.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_BALANCE_BARS,
  computeTrackingScore,
  TRACKING_SCORE_TUNING
} from "../src/analysis/pidAnalysis.js";

test("bars are per-axis and sit above each axis's fleet median", () => {
  // Fleet medians on aligned data: Roll 82, Pitch 65, Yaw 69.
  assert.ok(COMMAND_BALANCE_BARS.Roll.iPercent > 82);
  assert.ok(COMMAND_BALANCE_BARS.Pitch.iPercent > 65);
  assert.ok(COMMAND_BALANCE_BARS.Yaw.iPercent > 69);
  // And they differ — one global bar cannot serve these axes.
  const values = new Set(
    Object.values(COMMAND_BALANCE_BARS).map((b) => b.iPercent)
  );
  assert.ok(values.size > 1);
});

test("a just-past-the-bar axis deducts the minimum, an extreme one the full amount", () => {
  const base = { relativeError: 0.10, saturationReviewCount: 0 };

  const mild = computeTrackingScore({
    ...base,
    commandBalanceSeverities: [0]
  });
  const severe = computeTrackingScore({
    ...base,
    commandBalanceSeverities: [1]
  });
  const clean = computeTrackingScore({
    ...base,
    commandBalanceSeverities: []
  });

  assert.equal(
    clean.score - mild.score,
    TRACKING_SCORE_TUNING.BALANCE_DEDUCTION_MIN
  );
  assert.equal(
    clean.score - severe.score,
    TRACKING_SCORE_TUNING.BALANCE_DEDUCTION_PER_AXIS
  );
});

test("the count-based fallback still works for callers without severities", () => {
  const withCount = computeTrackingScore({
    relativeError: 0.10,
    commandBalanceReviewCount: 1
  });
  const without = computeTrackingScore({ relativeError: 0.10 });

  assert.equal(
    without.score - withCount.score,
    TRACKING_SCORE_TUNING.BALANCE_DEDUCTION_PER_AXIS
  );
});
