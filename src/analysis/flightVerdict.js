// ======================================================
// BLACKBOX LAB — FLIGHT VERDICT
// ======================================================
//
// The plain-language layer: turns numbers into the story
// a pilot needs first. Every verdict card carries:
//
//   status   "good" | "watch" | "attention"
//   headline one short sentence, no jargon
//   detail   one more sentence of why
//   screen   which Lab shows the evidence
//
// Simple first. Deeper when you want it.
//
// ======================================================

import { VIBRATION_FLOOR_HZ } from "./dsp/fft.js";
import { assessVibrationConclusion } from "./vibrationSeverity.js";

function averageOf(values) {
  if (!values || values.length === 0) {
    return null;
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum / values.length;
}

// ------------------------------------------------------
// Vibration verdict — from the noise spectrum peaks
// ------------------------------------------------------
function vibrationVerdict(spectra, headspeedRpm, filterAdvice, pidAnalysis) {
  if (!spectra || spectra.length === 0) {
    return null;
  }

  // Strongest peak above the vibration floor across all gyro axes.
  let peakHz = 0;
  let peakMagnitude = 0;

  for (const { spectrum } of spectra) {
    for (let i = 0; i < spectrum.frequencies.length; i += 1) {
      if (
        spectrum.frequencies[i] >= VIBRATION_FLOOR_HZ &&
        spectrum.magnitudes[i] > peakMagnitude
      ) {
        peakMagnitude = spectrum.magnitudes[i];
        peakHz = spectrum.frequencies[i];
      }
    }
  }

  if (peakMagnitude === 0) {
    return null;
  }

  // Name the peak if it matches a rotor frequency.
  let source = "an unidentified source";

  if (headspeedRpm && headspeedRpm > 300) {
    const oneRev = headspeedRpm / 60;
    const ratio = peakHz / oneRev;

    if (Math.abs(ratio - 1) < 0.15) {
      source = "the MAIN ROTOR turning once per revolution — usually blade balance or head damping";
    } else if (Math.abs(ratio - 2) < 0.2) {
      source = "twice-per-revolution of the main rotor — often blade tracking or head play";
    } else if (ratio > 3.5 && ratio < 6.5) {
      source = "the TAIL rotor region — check tail blades, belt/shaft and bearings";
    } else if (ratio > 6.5) {
      source = "a high-frequency source — motor, pinion or bearing territory";
    }
  }

  const magnitudeLabel = peakMagnitude.toFixed(1);
  const hzLabel = peakHz.toFixed(0);

  // Filtering evidence for THIS peak, when the advisor measured it:
  // raw amplitude alone never decides the verdict again.
  const advisorRow =
    filterAdvice?.rows?.find(
      (row) => Math.abs(row.hz - peakHz) <= 3
    ) ?? null;

  const conclusion = assessVibrationConclusion({
    rawMagnitude: peakMagnitude,
    hz: peakHz,
    source,
    reductionPercent: advisorRow?.reductionPercent ?? null,
    residualMagnitude: advisorRow?.filteredMagnitude ?? null,
    trackingConcern: Number.isFinite(pidAnalysis?.score)
      ? pidAnalysis.score < 70
      : null
  });

  // Detection stays sensitive; the card's status follows the
  // evidence-gated conclusion. A managed strong peak stays visible
  // as "watch" — filters do not remove vibration from bearings.
  const status =
    conclusion.level === "strong" || conclusion.level === "suspected"
      ? "attention"
      : conclusion.level === "review" ||
          (conclusion.managed && peakMagnitude > 8)
        ? "watch"
        : "good";

  const headline =
    conclusion.level === "observed" && peakMagnitude > 3
      ? `Vibration at ${hzLabel} Hz — managed by filtering`
      : peakMagnitude > 8
        ? `Strong vibration at ${hzLabel} Hz`
        : peakMagnitude > 3
          ? `Vibration at ${hzLabel} Hz`
          : "Vibration levels look healthy";

  const detail =
    peakMagnitude > 3
      ? `${conclusion.detected} ${conclusion.filtering} ${conclusion.impact}`
      : `Largest peak only ${magnitudeLabel} at ${hzLabel} Hz — a clean, well-balanced machine.`;

  return {
    key: "vibration",
    title: "Vibration",
    status,
    headline,
    detail,
    action: conclusion.recommendation,
    screen: "filter",
    evidence: "Noise Spectrum chart, Filter Lab"
  };
}

// ------------------------------------------------------
// Rotor speed verdict — how well headspeed held
// ------------------------------------------------------
function rotorSpeedVerdict(headspeed, governorTarget) {
  if (!headspeed || headspeed.length < 100) {
    return null;
  }

  // Judge only the governed part of the flight (target
  // reached), so spool-up doesn't count against it.
  const pairs = [];

  for (let i = 0; i < headspeed.length; i += 1) {
    const target = governorTarget ? governorTarget[i] : null;

    if (target && target > 300 && headspeed[i] > target * 0.85) {
      pairs.push([headspeed[i], target]);
    }
  }

  if (pairs.length < 100) {
    return null;
  }

  let maximumDroop = 0;
  let errorSum = 0;

  for (const [actual, target] of pairs) {
    const droop = target - actual;
    errorSum += Math.abs(droop);

    if (droop > maximumDroop) {
      maximumDroop = droop;
    }
  }

  const averageTarget = averageOf(pairs.map((pair) => pair[1]));
  const droopPercent = (maximumDroop / averageTarget) * 100;

  if (droopPercent > 3) {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "attention",
      headline: `Headspeed sags up to ${Math.round(maximumDroop)} rpm under load`,
      detail: `That is ${droopPercent.toFixed(1)}% below target — the governor needs more gain or the power system more headroom.`,
      action: "In Rotorflight Configurator, raise governor gain in small steps — or check the ESC Lab for missing power headroom.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  if (droopPercent > 1.2) {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "watch",
      headline: `Headspeed dips ${Math.round(maximumDroop)} rpm on collective`,
      detail: `${droopPercent.toFixed(1)}% droop is flyable; a touch more governor gain could tighten it.`,
      action: "Optional: a small governor gain increase next session.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  return {
    key: "rotor",
    title: "Rotor Speed",
    status: "good",
    headline: "Rock-solid headspeed",
    detail: `Worst droop only ${Math.round(maximumDroop)} rpm (${droopPercent.toFixed(1)}%) — the governor is doing its job.`,
    action: "Nothing to do — this is what good looks like.",
    screen: "governor",
    evidence: "Headspeed vs Target chart, Governor Lab"
  };
}

// ------------------------------------------------------
// Tuning verdict — from the PID Lab score
// ------------------------------------------------------
function tuningVerdict(pidAnalysis) {
  const score = pidAnalysis?.score;
  const overallStatus =
    pidAnalysis?.overallStatus ?? null;

  if (
    overallStatus === "Insufficient Data" ||
    !Number.isFinite(score)
  ) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: "PID tracking could not be measured",
      detail:
        "Setpoint data was present, but no valid axis-response or tracking windows were available. This flight cannot support a PID tuning score.",
      action:
        "Do not change PID values from this result. Open PID Lab to review the missing evidence.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  if (score < 50) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "attention",
      headline: `Tracking score ${score}/100 — room to improve`,
      detail:
        "The helicopter lags or overshoots what the sticks ask for. The PID Lab lists the events behind this number.",
      action:
        "Open the PID Lab and work through its recommendations one change at a time.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  // The card and the PID Lab must tell the same story: when the
  // Lab's own status says "Review", the Home card cannot say
  // "crisp" — whatever the score. One source of truth.
  if (overallStatus === "Review") {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: `Tracking score ${score}/100 — with items to review`,
      detail:
        "The response follows the sticks, but the PID Lab flags findings worth reading before calling this tune done.",
      action:
        "Open the PID Lab and read its review items — they say exactly where to look.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  if (score < 75) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: `Tracking score ${score}/100 — decent, not crisp`,
      detail:
        "Response mostly follows the sticks; the PID Lab shows where it loosens.",
      action:
        "If you want it sharper, the PID Lab shows where to look.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  return {
    key: "tuning",
    title: "Tuning",
    status: "good",
    headline: `Tracking score ${score}/100 — crisp response`,
    detail: "The machine follows the sticks faithfully.",
    action: "Nothing to do — enjoy it.",
    screen: "pid",
    evidence: "PID Lab findings"
  };
}
  

  

  
  


// ------------------------------------------------------
// Battery verdict — voltage sag over the flight
// ------------------------------------------------------
function batteryVerdict(vbat) {
  if (!vbat || vbat.length < 100) {
    return null;
  }

  // vbatLatest is typically volts × 100.
  const start = averageOf(vbat.slice(0, 50)) / 100;
  const end = averageOf(vbat.slice(-50)) / 100;

  if (!start || start < 5) {
    return null;
  }

  const sagPercent = ((start - end) / start) * 100;

  if (sagPercent > 12) {
    return {
      key: "battery",
      title: "Battery",
      status: "attention",
      headline: `Voltage fell ${sagPercent.toFixed(0)}% during the flight`,
      detail: `${start.toFixed(1)} V → ${end.toFixed(1)} V — an aging pack or a flight flown long/hard.`,
      action: "Land earlier, or move this pack to gentler duty. The Battery Lab has the details.",
      screen: "viewer",
      evidence: "Motor & Power chart, Log Viewer"
    };
  }

  return {
    key: "battery",
    title: "Battery",
    status: "good",
    headline: "Battery held up well",
    detail: `${start.toFixed(1)} V → ${end.toFixed(1)} V over the flight.`,
    action: "Nothing to do.",
    screen: "viewer",
    evidence: "Motor & Power chart, Log Viewer"
  };
}
function rotorSpeedVerdictFromLab(governorLab) {
  if (!governorLab) {
    return null;
  }

  // Models that state no governor target still get a rotor
  // story: hold judged against the rotor's own trend. Without
  // a target there is no contract to break, so this card never
  // goes past "watch".
  if (
    governorLab.mode === "headspeed-hold" &&
    governorLab.status !== "insufficient" &&
    Number.isFinite(governorLab.droopRpm)
  ) {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: governorLab.status,
      // The stability RESULT may be favorable, but without a target
      // there is no governed contract to score — the label says
      // partial, never a scored-quality word.
      statusLabel: "Partial — stability only",
      headline:
        governorLab.status === "good"
          ? `Headspeed held steady near ${governorLab.averageHeadspeed} rpm`
          : `Headspeed swung ${Math.round(
              governorLab.droopRpm
            )} rpm short-term`,
      detail: `No governor target is logged, so hold is judged against the rotor's own trend: largest short-term swing ${Math.round(
        governorLab.droopRpm
      )} rpm (${governorLab.droopPercent.toFixed(1)}%).`,
      action:
        governorLab.status === "good"
          ? "Nothing to change from this result."
          : "Worth a look at that moment in the Governor Lab chart — deliberate headspeed changes are not counted against this.",
      screen: "governor",
      evidence: "Headspeed Over Time chart, Governor Lab"
    };
  }

  if (
    governorLab.status === "insufficient" ||
    !Number.isFinite(governorLab.droopRpm)
  ) {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "watch",
      headline:
        governorLab.movedDuringRecording === false
          ? "No flight found in this recording"
          : governorLab.hasRotorSpeedData === false
            ? "No rotor-speed data in this log"
            : "Governor hold could not be measured",
      detail:
        governorLab.movedDuringRecording === false
          ? "The sticks and servos move in this log, but the airframe itself never does, and no rotor speed was recorded. That is the signature of a bench or ground run rather than a flight."
          : governorLab.hasRotorSpeedData === false
            ? "This log records no headspeed, which is normal for a model flown without an RPM sensor. Governor hold is measured against rotor speed, so it cannot be scored from this flight."
            : "No stable governed-flight section was long enough for a reliable governor result.",
      action:
        governorLab.movedDuringRecording === false
          ? "Open a log recorded in flight. If this was a flight, check that the gyro and RPM sensor are being logged."
          : governorLab.hasRotorSpeedData === false
            ? "Nothing to fix in the log. Fit and enable an RPM sensor if you want governor scoring."
            : "Do not change governor settings from this flight.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  const droopRpm = governorLab.droopRpm;
  const droopPercent = governorLab.droopPercent;

  // A deep sustained dip under load anywhere in the flight is
  // the headline, and the motor output at that moment decides
  // what the card recommends: at the ceiling, the fix is power,
  // not governor gain.
  const flightDipSevere =
    Number.isFinite(governorLab.flightDroopPercent) &&
    governorLab.flightDroopPercent > 8;

  if (flightDipSevere) {
    const outputAtCeiling =
      Number.isFinite(governorLab.flightDroopOutputPercent) &&
      governorLab.flightDroopOutputPercent >= 95;

    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "attention",
      headline: `Rotor fell ${Math.round(
        governorLab.flightDroopRpm
      )} rpm under load`,
      detail: `A sustained ${governorLab.flightDroopPercent.toFixed(
        1
      )}% dip below target${
        Number.isFinite(governorLab.flightDroopOutputPercent)
          ? ` with the motor output at ${Math.round(
              governorLab.flightDroopOutputPercent
            )}%`
          : ""
      }.`,
      action: outputAtCeiling
        ? "The output was already at its ceiling, so more governor gain cannot help. Lower the headspeed, take some pitch out, or step up the power system — the ESC Lab shows the moment."
        : "Review the worst-droop event in Governor Lab before changing gain or power-system settings.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  if (governorLab.status === "attention") {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "attention",
      headline: `Sustained dip of ${Math.round(
        droopRpm
      )} rpm in stable flight`,
      detail: `${droopPercent.toFixed(
        1
      )}% below target, held for a quarter second or longer.`,
      action:
        "Review the matching event in Governor Lab before changing gain or power-system settings.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  if (governorLab.status === "watch") {
    return {
      key: "rotor",
      title: "Rotor Speed",
      status: "watch",
      headline: `Sustained dip of ${Math.round(
        droopRpm
      )} rpm in stable flight`,
      detail: `${droopPercent.toFixed(
        1
      )}% below target. Review the event before making a governor change.`,
      action:
        "No automatic change recommended. Confirm that the dip occurred during a real airborne load.",
      screen: "governor",
      evidence: "Headspeed vs Target chart, Governor Lab"
    };
  }

  return {
    key: "rotor",
    title: "Rotor Speed",
    status: "good",
    headline: "Rock-solid headspeed",
    detail: `Largest sustained dip was ${Math.round(
      droopRpm
    )} rpm (${droopPercent.toFixed(1)}%).`,
    action: "Nothing to change from this result.",
    screen: "governor",
    evidence: "Headspeed vs Target chart, Governor Lab"
  };
}

function batteryVerdictFromLab(batteryLab) {
  if (!batteryLab) {
    return null;
  }

  if (
    batteryLab.status === "insufficient" ||
    !Number.isFinite(batteryLab.minimumVoltsPerCell)
  ) {
    return {
      key: "battery",
      title: "Battery",
      status: "watch",
      headline:
        batteryLab.hasRotorSpeedData === false
          ? "Battery assessment needs rotor-speed data"
          : "Battery condition could not be assessed",
      detail:
        batteryLab.hasRotorSpeedData === false
          ? "Pack condition is judged over a steady-load section, which this app identifies from rotor speed. This log records none, so the pack cannot be scored from this flight."
          : "No stable governed-flight section was long enough for a reliable battery result.",
      action:
        batteryLab.hasRotorSpeedData === false
          ? "Nothing to fix in the log. Use the Voltage Over the Flight chart to view the pack directly."
          : "Do not judge the pack from this flight alone.",
      screen: "battery",
      evidence: "Voltage Over the Flight chart, Battery Lab"
    };
  }

  const minimumPerCell =
    batteryLab.minimumVoltsPerCell;

  if (batteryLab.status === "attention") {
    return {
      key: "battery",
      title: "Battery",
      status: "attention",
      headline: "Low voltage observed during stable flight",
      detail: `Lowest in-flight voltage was ${minimumPerCell.toFixed(
        2
      )} V per cell.`,
      action:
        "Review the matching current and throttle event in Battery Lab.",
      screen: "battery",
      evidence: "Voltage Over the Flight chart, Battery Lab"
    };
  }

  if (batteryLab.status === "watch") {
    return {
      key: "battery",
      title: "Battery",
      status: "watch",
      headline: "Loaded voltage is worth reviewing",
      detail: `Lowest in-flight voltage was ${minimumPerCell.toFixed(
        2
      )} V per cell. This alone does not prove the pack is weak.`,
      action:
        "Compare the voltage dip with current demand in Battery Lab.",
      screen: "battery",
      evidence: "Voltage Over the Flight chart, Battery Lab"
    };
  }

  return {
    key: "battery",
    title: "Battery",
    status: "good",
    headline: "Battery held up well",
    detail: `Lowest in-flight voltage was ${minimumPerCell.toFixed(
      2
    )} V per cell. No clear evidence of a weak or tired pack.`,
    action: "Nothing to change from this result.",
    screen: "battery",
    evidence: "Voltage Over the Flight chart, Battery Lab"
  };
}
// ------------------------------------------------------
// Power verdict — motor output headroom, from the ESC Lab
// ------------------------------------------------------
function powerVerdictFromLab(escLab) {
  if (!escLab || escLab.status === "insufficient") {
    return null;
  }

  const headline =
    escLab.status === "attention"
      ? "The power system ran out of headroom"
      : escLab.status === "watch"
        ? "Power headroom is getting thin"
        : "Plenty of power in reserve";

  const action =
    escLab.status === "attention"
      ? "Lower the headspeed, take some pitch out, or step up the power system — the ESC Lab shows the exact moments."
      : escLab.status === "watch"
        ? "Fine for now — worth remembering before asking the machine for more."
        : "Nothing to do.";

  return {
    key: "power",
    title: "Power & ESC",
    status: escLab.status,
    headline,
    detail: escLab.story,
    action,
    screen: "esc",
    evidence: "Throttle Output chart, ESC Lab"
  };
}

// ------------------------------------------------------
// buildFlightVerdict — the one call the renderer makes
// ------------------------------------------------------
export function buildFlightVerdict({
  spectra,
  headspeed,
  governorTarget,
  vbat,
  pidAnalysis,
  labs,
  anchorHeadspeedRpm,
  filterAdvice = null
}) {
  // Peak naming needs the rotor speed the machine flew at. The
  // caller passes the stable-flight mean when one exists; the
  // tail-of-log average remains only as a fallback.
  const governedHeadspeed =
    (Number.isFinite(anchorHeadspeedRpm) && anchorHeadspeedRpm > 0
      ? anchorHeadspeedRpm
      : null) ??
    (headspeed
      ? averageOf(headspeed.slice(-Math.floor(headspeed.length / 3)))
      : null);

  const cards = [
  vibrationVerdict(spectra, governedHeadspeed, filterAdvice, pidAnalysis),
  rotorSpeedVerdictFromLab(labs?.governor),
  tuningVerdict(pidAnalysis),
  powerVerdictFromLab(labs?.esc),
  batteryVerdictFromLab(labs?.battery)
].filter(Boolean);

  const worst = cards.some((card) => card.status === "attention")
    ? "attention"
    : cards.some((card) => card.status === "watch")
      ? "watch"
      : "good";

  const summary =
    worst === "good"
      ? "This flight looks healthy. Explore the Labs to see the details."
      : worst === "watch"
        ? "Mostly healthy, with a few things worth keeping an eye on."
        : "This flight found something that deserves your attention.";

  return { cards, worst, summary };
}
