// ======================================================
// BLACKBOX LAB — LOG QUALITY GATE
// ======================================================
//
// Before trusting any analysis, be honest about the
// input: what can THIS log actually tell us? Analysis
// silently done on inadequate data is how a teaching
// tool teaches wrong things.
//
// ======================================================

// A column can exist and still carry nothing: a model flown
// without its RPM wire logs headspeed as constant zero, a dead
// current sensor logs zero amps for the whole flight. A
// capability chip built on mere column presence then promises
// "fully measurable" for an analysis that has nothing to
// measure — so capability flags are computed from this, never
// from Boolean(column).
export function columnCarriesData(values) {
  return (
    Array.isArray(values) &&
    values.some(
      (value) => Number.isFinite(value) && value !== 0
    )
  );
}

export function assessLogQuality({
  sampleRateHz,
  durationSeconds,
  corruptFrames = 0,
  totalFrames = 0,
  hasUnfilteredGyro,
  hasFilteredGyro,
  hasHeadspeed,
  hasGovernorTarget,
  hasVbat,
  hasAmperage,
  hasRssi = false,
  hasLinkFlags = false,
  hasVbec = false
}) {
  const capabilities = [];
  const warnings = [];

  // ---- vibration & filters need sample rate + gyro ----
  const anyGyro = hasUnfilteredGyro || hasFilteredGyro;

  if (!anyGyro) {
    capabilities.push({
      name: "Vibration & filters",
      level: "missing",
      note: "No gyro data in this log."
    });
  } else if (!sampleRateHz || sampleRateHz < 400) {
    capabilities.push({
      name: "Vibration & filters",
      level: "partial",
      note: `Logging rate ~${Math.round(sampleRateHz || 0)} Hz is too slow for tail-frequency vibration. Raise the Blackbox rate for the full picture.`
    });
  } else if (sampleRateHz < 1000) {
    capabilities.push({
      name: "Vibration & filters",
      level: "partial",
      note: `Logging rate ~${Math.round(sampleRateHz)} Hz covers main-rotor and tail vibration; only very high motor/bearing frequencies are out of view.`
    });
  } else if (!hasUnfilteredGyro) {
    capabilities.push({
      name: "Vibration & filters",
      level: "partial",
      note: "Only filtered gyro is logged: noise is visible after filtering, so real vibration is underestimated and filter effectiveness can't be measured. Enable unfiltered gyro logging (gyro_raw) for the full picture."
    });
  } else {
    capabilities.push({
      name: "Vibration & filters",
      level: "full",
      note:
        hasFilteredGyro
          ? "Unfiltered + filtered gyro at a healthy rate: full noise and filter-effectiveness analysis."
          : "Unfiltered gyro at a healthy rate. Also logging the filtered gyro would let the Filter Advisor measure your filters' real effect."
    });
  }

  // ---- governor ----
  if (hasHeadspeed && hasGovernorTarget) {
    capabilities.push({
      name: "Governor",
      level: "full",
      note: "Headspeed and target present: droop and tracking fully measurable."
    });
  } else if (hasHeadspeed) {
    capabilities.push({
      name: "Governor",
      level: "partial",
      note: "Headspeed is logged but no governor target: stability is visible, droop-vs-target is not."
    });
  } else {
    capabilities.push({
      name: "Governor",
      level: "missing",
      note: "No headspeed in this log. Enable RPM telemetry to unlock governor analysis."
    });
  }

  // ---- power ----
  if (hasVbat && hasAmperage) {
    capabilities.push({
      name: "Battery & ESC",
      level: "full",
      note: "Voltage and current present: sag, consumption and resistance estimates available."
    });
  } else if (hasVbat) {
    capabilities.push({
      name: "Battery & ESC",
      level: "partial",
      note: "Voltage only: sag is visible; consumption and internal resistance need a current sensor."
    });
  } else {
    capabilities.push({
      name: "Battery & ESC",
      level: "missing",
      note: "No electrical telemetry in this log."
    });
  }

  // ---- signal & link ----
  if (hasRssi) {
    capabilities.push({
      name: "Signal & link",
      level: "full",
      note: "Signal strength and receiver flags present: link health fully measurable."
    });
  } else if (hasLinkFlags) {
    capabilities.push({
      name: "Signal & link",
      level: "partial",
      note: "Receiver flags only: failsafe and signal-valid state are visible, but no signal-strength trace was logged."
    });
  } else {
    capabilities.push({
      name: "Signal & link",
      level: "missing",
      note: "No link telemetry in this log. Enable RSSI telemetry for signal analysis."
    });
  }

  // ---- receiver power ----
  if (hasVbec) {
    capabilities.push({
      name: "BEC output",
      level: "full",
      note: "BEC voltage present: receiver-power stability, dips and their servo context are measurable."
    });
  } else {
    capabilities.push({
      name: "BEC output",
      level: "missing",
      note: "No BEC voltage in this log. Enable BEC voltage telemetry for receiver-power analysis."
    });
  }

  // ---- general warnings ----
  if (durationSeconds && durationSeconds < 20) {
    warnings.push(
      `Short flight (${durationSeconds.toFixed(0)} s): trends and averages are less reliable; treat scores as indicative.`
    );
  }

  if (totalFrames > 0 && corruptFrames / totalFrames > 0.02) {
    warnings.push(
      `${((corruptFrames / totalFrames) * 100).toFixed(1)}% of frames were corrupt and skipped. Consider a faster/better flash or SD card.`
    );
  }

  const missing = capabilities.filter((c) => c.level === "missing").length;
  const partial = capabilities.filter((c) => c.level === "partial").length;

  // The chips speak about DATA, not about conclusions — the
  // analyses rate their own confidence from what they measure.
  const summary =
    missing === 0 && partial === 0 && warnings.length === 0
      ? "This log is excellent: every analysis has the data it needs."
      : missing === 0
        ? "Good log: a few analyses run with reduced confidence (details below)."
        : "This log limits some analyses: the notes below say what to enable for the full picture.";

  return { capabilities, warnings, summary };
}
