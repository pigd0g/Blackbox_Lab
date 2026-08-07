// ======================================================
// TESTS — the governor score is calibrated on the fleet
// ======================================================
//
// The old deductions assumed sub-2% droop is normal; 247
// contributed flights say ~4% is the middle of the road
// (p25 2.57 / p50 4.09 / p90 6.44 % stable droop; RMS
// p25 9.3 / p50 16.6 / p90 40 rpm). These tests pin the
// score to that reality: the median machine earns a good
// score, "attention" is reserved for what stands out from
// the fleet, and only genuine outliers approach zero.
//
// The lesson from the filter and PID calibrations applies:
// tests written beside a mis-calibration pass and confirm
// it — the anchors here exist because a fleet distribution
// showed the disease, and they must not drift quietly.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeGovernorScore,
  GOVERNOR_SCORE_TUNING,
  GOVERNOR_STATUS_THRESHOLDS
} from "../src/analysis/governorLabAnalysis.js";

test("the median machine of the fleet earns a good score", () => {
  const score = computeGovernorScore({
    droopPercent: 4.09,
    rmsError: 16.6
  });

  assert.ok(
    score >= 75 && score <= 90,
    `fleet-median inputs must land 75-90, got ${score}`
  );
});

test("a clean quartile flight earns full credit", () => {
  const score = computeGovernorScore({
    droopPercent: 2.5,
    rmsError: 9
  });

  assert.equal(score, 100);
});

test("credit is continuous — no cliffs, no ladders", () => {
  let previous = Number.POSITIVE_INFINITY;

  for (let droop = 2; droop <= 10.5; droop += 0.25) {
    const score = computeGovernorScore({
      droopPercent: droop,
      rmsError: 16.6
    });

    assert.ok(
      score <= previous,
      `score must fall monotonically with droop (${droop}%)`
    );
    previous = score;
  }
});

test("a genuine outlier approaches zero, the fleet does not", () => {
  const outlier = computeGovernorScore({
    droopPercent: 9.5,
    rmsError: 85
  });
  const worstOrdinary = computeGovernorScore({
    droopPercent: 6.44, // fleet p90
    rmsError: 40 // fleet p90
  });

  assert.ok(outlier <= 10, `outlier should bottom out, got ${outlier}`);
  assert.ok(
    worstOrdinary >= 40,
    `the fleet's p90 machine is not a failure, got ${worstOrdinary}`
  );
});

test("attention means unusual for the fleet, not median", () => {
  assert.ok(
    GOVERNOR_STATUS_THRESHOLDS.ATTENTION_DROOP_PERCENT > 4.09,
    "the attention threshold must sit above the fleet median"
  );
  assert.ok(
    GOVERNOR_STATUS_THRESHOLDS.SEVERE_FLIGHT_DIP_PERCENT > 8.42,
    "severe must sit above the fleet's p75 whole-flight dip"
  );
  assert.ok(
    GOVERNOR_SCORE_TUNING.DROOP_WEIGHT >
      GOVERNOR_SCORE_TUNING.RMS_WEIGHT,
    "holding the rotor is the contract; calm is secondary"
  );
});
