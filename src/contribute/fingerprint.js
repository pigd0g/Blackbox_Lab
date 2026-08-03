// ======================================================
// BLACKBOX LAB — FLIGHT FINGERPRINT
//
// The compact feature vector that travels with a
// contribution: per-axis tracking metrics, the labelled
// noise peaks, governor droop and saturation percentages.
// Everything here is READ from what the analysis already
// computed — nothing is recomputed, so the fingerprint can
// never disagree with what the pilot saw on screen.
//
// Versioned so features can evolve without invalidating
// old rows.
// ======================================================

export const FINGERPRINT_VERSION = 1;

function roundOrNull(value, decimals = 2) {
  const number = Number.parseFloat(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

// Per-axis tracking: joins the three per-axis series the
// PID analysis already produced (average absolute error,
// average absolute response, exceedance) by axis name.
function buildTracking(pidAnalysis) {
  const tracking = pidAnalysis?.detectedColumns?.trackingAnalysis;

  if (!tracking) {
    return [];
  }

  const byAxis = new Map();

  const entryFor = (axis) => {
    if (!byAxis.has(axis)) {
      byAxis.set(axis, {
        axis,
        average_absolute_error: null,
        average_absolute_response: null,
        exceedance_percent: null
      });
    }
    return byAxis.get(axis);
  };

  for (const result of tracking.averageAbsoluteAxisError ?? []) {
    entryFor(result.axis).average_absolute_error = roundOrNull(
      result.averageAbsoluteError
    );
  }

  for (const result of tracking.averageAbsoluteAxisResponse ?? []) {
    entryFor(result.axis).average_absolute_response = roundOrNull(
      result.averageAbsoluteResponse
    );
  }

  for (const result of tracking.instantaneousExceedanceAnalysis ?? []) {
    entryFor(result.axis).exceedance_percent = roundOrNull(
      result.exceedancePercent
    );
  }

  return Array.from(byAxis.values());
}

// The spectrum markers the app already picked and labelled
// (strongest peaks, harmonic classification against the
// governed headspeed).
function buildNoisePeaks(markers) {
  return (markers ?? []).map((marker) => ({
    hz: roundOrNull(marker.hz, 1),
    magnitude: roundOrNull(marker.magnitude, 1),
    classification: marker.classification ?? "unclassified"
  }));
}

/**
 * Build the versioned flight fingerprint from the analysis
 * outputs the app has already computed.
 *
 * @param {object} options { dataset, pidAnalysis }
 *   dataset      the buildDataset() result (labs, markers)
 *   pidAnalysis  the analyzePids() result
 */
export function buildFingerprint({ dataset, pidAnalysis }) {
  const governor = dataset?.labs?.governor ?? null;
  const esc = dataset?.labs?.esc ?? null;

  return {
    fingerprint_version: FINGERPRINT_VERSION,

    tracking_score: roundOrNull(pidAnalysis?.score),
    tracking: buildTracking(pidAnalysis),

    noise_peaks: buildNoisePeaks(dataset?.markers),

    governor: governor
      ? {
          droop_rpm: roundOrNull(governor.droopRpm, 1),
          droop_percent: roundOrNull(governor.droopPercent),
          average_headspeed_rpm: roundOrNull(
            governor.averageHeadspeed,
            0
          )
        }
      : null,

    saturation: esc
      ? {
          esc_throttle_percent: roundOrNull(esc.saturationPercent)
        }
      : null
  };
}
