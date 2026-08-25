// ======================================================
// TESTS — response-behavior Review bars are per-axis,
// fleet-anchored, and settling is rate-independent
// ======================================================
//
// The original bars sat at or below each check's fleet
// median (roll bounce-back flagged nine qualifying
// flights in ten). These lock the re-anchor: every bar
// sits above its axis's fleet median, the axes differ,
// and settling is judged in milliseconds so the same
// flight reads the same at any logging rate.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { RESPONSE_REVIEW_BARS } from "../src/analysis/pidAnalysis.js";

// Fleet medians (whole contributed fleet, 2026-08-21):
// bounce % R/P/Y 32.8/15.0/11.6 · settle ms 108/114/44 ·
// ringing crossings 7/1/2.
const FLEET_MEDIANS = {
  bounceBackPercent: { Roll: 32.8, Pitch: 15.0, Yaw: 11.6 },
  settleMs: { Roll: 108, Pitch: 114, Yaw: 44 },
  ringingCrossings: { Roll: 7, Pitch: 1, Yaw: 2 }
};

test("every bar sits above its axis's fleet median", () => {
  for (const [check, axes] of Object.entries(FLEET_MEDIANS)) {
    for (const [axis, median] of Object.entries(axes)) {
      assert.ok(
        RESPONSE_REVIEW_BARS[check][axis] > median,
        `${check}.${axis} bar must exceed fleet median ${median}`
      );
    }
  }
});

test("bars are per-axis — one global number cannot serve these distributions", () => {
  for (const axes of Object.values(RESPONSE_REVIEW_BARS)) {
    assert.ok(new Set(Object.values(axes)).size > 1);
  }
});

test("settling bars are stated in milliseconds", () => {
  // Millisecond bars live in a plausible physical range; a fixed
  // sample count (the old bar) would sit orders of magnitude off
  // at real logging rates.
  for (const value of Object.values(RESPONSE_REVIEW_BARS.settleMs)) {
    assert.ok(value >= 100 && value <= 1000);
  }
});
