// ======================================================
// BLACKBOX LAB — VIBRATION CONCLUSION LAYER
// ======================================================
//
// The detector's job is to see everything; this layer's
// job is to say only what the evidence proves. Four
// separate concepts, never blended:
//
//   1. Detected      — what was measured, an observation
//   2. Filtering     — what Rotorflight does with it
//   3. Control impact — does it reach the control loop
//   4. Recommendation — only then, what to do
//
// Severity climbs Observed → Worth reviewing → Suspected
// mechanical source → Strong evidence, and the strong
// steps require MULTIPLE agreeing signals. A cleanly
// filtered expected harmonic with no control-loop impact
// is a managed observation, not a fault — the state
// between "no vibration" and "mechanical problem".
//
// ======================================================

// Raw-amplitude bands (unchanged from the fleet-calibrated
// verdict): above STRONG the shake is big by any standard,
// above MODERATE it is worth words at all.
const RAW_STRONG = 8;
const RAW_MODERATE = 3;

// Filtering counts as managing a peak when it removes at
// least this share of it and what remains is small.
const MANAGED_REDUCTION_PERCENT = 90;
const RESIDUAL_QUIET = 1.5;

// A residual this big reaches the control loop regardless
// of how good the percentage sounds.
const RESIDUAL_LOUD = 3;

/**
 * @param {object} evidence {
 *   rawMagnitude, hz, source,      // detection (source = hypothesis text)
 *   reductionPercent,              // measured attenuation, null = unknown
 *   residualMagnitude,             // filtered peak, null = unknown
 *   trackingConcern                // control evidence from PID lab, null = unknown
 * }
 * @returns {object} {
 *   level: "observed" | "review" | "suspected" | "strong",
 *   managed,                       // filtering demonstrably handles it
 *   controlImpact,                 // true / false / null (unknown)
 *   detected, filtering, impact, recommendation   // the four sentences
 * }
 */
export function assessVibrationConclusion({
  rawMagnitude,
  hz,
  source,
  reductionPercent = null,
  residualMagnitude = null,
  trackingConcern = null
}) {
  const raw = Number(rawMagnitude);
  const hzLabel = Number.isFinite(hz) ? Number(hz).toFixed(0) : "?";

  const filteringKnown =
    Number.isFinite(reductionPercent) &&
    Number.isFinite(residualMagnitude);

  const managed =
    filteringKnown &&
    reductionPercent >= MANAGED_REDUCTION_PERCENT &&
    residualMagnitude < RESIDUAL_QUIET;

  const controlImpact = filteringKnown
    ? residualMagnitude >= RESIDUAL_LOUD || trackingConcern === true
    : trackingConcern === true
      ? true
      : null;

  // ---- the four sentences ----

  const detected = `Vibration detected at ${hzLabel} Hz (raw amplitude ${raw.toFixed(1)}). Frequency territory: ${source}. This is an observation, not a diagnosis.`;

  const filtering = filteringKnown
    ? `Rotorflight filtering reduces this peak ${Math.round(reductionPercent)}% (${raw.toFixed(1)} raw → ${residualMagnitude.toFixed(1)} filtered).`
    : "This log carries no separate filtered gyro trace, so filter effectiveness at this peak cannot be measured.";

  const impact =
    controlImpact === true
      ? "Residual vibration reaches the filtered gyro and may be affecting control response."
      : controlImpact === false
        ? "No meaningful filtered-gyro or control-loop impact detected."
        : "Control-loop impact could not be assessed from this log.";

  // ---- severity ladder: strong words need agreeing signals ----

  let level;

  if (raw <= RAW_MODERATE) {
    level = "observed";
  } else if (managed && controlImpact !== true) {
    // The missing conceptual state: physically present,
    // successfully managed.
    level = "observed";
  } else if (raw > RAW_STRONG) {
    // Strong raw amplitude alone earns "suspected". "Strong
    // evidence" needs the filters demonstrably losing AND the
    // control loop measurably suffering — independent signals
    // agreeing, not one number crossing a line.
    level =
      filteringKnown &&
      reductionPercent < 70 &&
      trackingConcern === true
        ? "strong"
        : "suspected";
  } else {
    level = "review";
  }

  const recommendation =
    level === "observed" && raw > RAW_MODERATE
      ? "Vibration is present, but it is being managed successfully. No change recommended. Worth reviewing mechanically only if this peak grows across flights or begins reaching the filtered gyro."
      : level === "observed"
        ? "No action needed: a clean, well-balanced machine."
        : level === "review"
          ? "Worth reviewing at the bench when convenient; re-log after any mechanical change to compare."
          : level === "suspected"
            ? "Mechanical review suggested: balance, tracking, damping and bearings in the named frequency territory, then re-log. Filters suppress what the gyro sees; they do not remove the physical vibration."
            : "Multiple signals agree: strong raw vibration, filters not containing it, and control impact. Inspect the mechanics in the named frequency territory before further flights, then re-log.";

  return {
    level,
    managed,
    controlImpact,
    detected,
    filtering,
    impact,
    recommendation
  };
}
