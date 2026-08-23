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
import { magnitudeNear } from "./filterAdvisor.js";

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
      source = "the MAIN ROTOR turning once per revolution, usually blade balance or head damping";
    } else if (Math.abs(ratio - 2) < 0.2) {
      source = "twice-per-revolution of the main rotor, often blade tracking or head play";
    } else if (ratio > 3.5 && ratio < 6.5) {
      source = "the TAIL rotor region: check tail blades, belt/shaft and bearings";
    } else if (ratio > 6.5) {
      source = "a high-frequency source: motor, pinion or bearing territory";
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

  // The verdict's peak and the advisor's rows come from separate
  // peak-finders, so a peak the advisor kept no row for is normal
  // — but when a filtered spectrum EXISTS, the card must not claim
  // the log has no filtered trace. Read the residual at this
  // peak's own frequency directly instead.
  let reductionPercent = advisorRow?.reductionPercent ?? null;
  let residualMagnitude = advisorRow?.filteredMagnitude ?? null;

  if (
    !advisorRow &&
    filterAdvice?.filteredSpectrum &&
    peakMagnitude > 0
  ) {
    const residual = magnitudeNear(
      filterAdvice.filteredSpectrum,
      peakHz
    );

    if (Number.isFinite(residual)) {
      residualMagnitude = residual;
      reductionPercent = Math.max(
        0,
        ((peakMagnitude - residual) / peakMagnitude) * 100
      );
    }
  }

  const conclusion = assessVibrationConclusion({
    rawMagnitude: peakMagnitude,
    hz: peakHz,
    source,
    reductionPercent,
    residualMagnitude,
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
      ? `Vibration at ${hzLabel} Hz: managed by filtering`
      : peakMagnitude > 8
        ? `Strong vibration at ${hzLabel} Hz`
        : peakMagnitude > 3
          ? `Vibration at ${hzLabel} Hz`
          : "Vibration levels look healthy";

  const detail =
    peakMagnitude > 3
      ? `${conclusion.detected} ${conclusion.filtering} ${conclusion.impact}`
      : `Largest peak only ${magnitudeLabel} at ${hzLabel} Hz: a clean, well-balanced machine.`;

  return {
    key: "vibration",
    title: "Vibration",
    status,
    headline,
    detail,
    action: conclusion.recommendation,
    // Structured peak facts, so downstream text (the Try First
    // panel) can speak about the same peak without parsing prose.
    peak: {
      hz: Math.round(peakHz),
      magnitude: Math.round(peakMagnitude * 10) / 10,
      source,
      reductionPercent: Number.isFinite(reductionPercent)
        ? Math.round(reductionPercent)
        : null,
      managed: conclusion.managed === true,
      identified: source !== "an unidentified source"
    },
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
      detail: `That is ${droopPercent.toFixed(1)}% below target. The governor needs more gain or the power system more headroom.`,
      action: "In Rotorflight Configurator, raise governor gain in small steps, or check the ESC Lab for missing power headroom.",
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
    detail: `Worst droop only ${Math.round(maximumDroop)} rpm (${droopPercent.toFixed(1)}%): the governor is doing its job.`,
    action: "Nothing to do. This is what good looks like.",
    screen: "governor",
    evidence: "Headspeed vs Target chart, Governor Lab"
  };
}

// ------------------------------------------------------
// Tuning verdict — from the PID Lab score
// ------------------------------------------------------
function tuningVerdict(pidAnalysis, { vibrationConcern = false } = {}) {
  const score = pidAnalysis?.score;
  const overallStatus =
    pidAnalysis?.overallStatus ?? null;
  const confidenceLevel = pidAnalysis?.confidence?.level ?? null;
  const thinEvidence =
    confidenceLevel === "Low" || confidenceLevel === "Insufficient";

  // A score earned in a gentle hover and one earned in hard
  // maneuvers are different measurements wearing the same number
  // — the card says which one this was, so nobody compares them.
  const hoverDemand =
    pidAnalysis?.technicalSummary?.demand?.hoverLevel === true;

  const demandSuffix = hoverDemand ? " at gentle demand" : "";

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

  // Bands follow the fleet, like every other status in the app:
  // the corpus median tracking score sits near 87, so "crisp"
  // is reserved for the better half of real machines. 65 is the
  // worse-than-most line (score-space p90 territory), not a
  // universal grade scale.
  if (score < 65) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "attention",
      headline: `Tracking score ${score}/100: room to improve`,
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
      headline: `Tracking score ${score}/100: items to review${demandSuffix}`,
      detail:
        "The response follows the sticks, but the PID Lab flags findings worth reading before calling this tune done.",
      action:
        "Open the PID Lab and read its review items: they say exactly where to look.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  // The score measures tracking and only tracking — it CAN be high
  // while the airframe shakes, because the filtered gyro still
  // follows the stick. But a tune read through an open vibration
  // finding is not a tune to be enjoyed: the recommendation engine
  // already holds every tuning change on it (filters before PIDs),
  // and the card must say the same — the number stands, the
  // verdict waits for the flight after the fix.
  if (vibrationConcern) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: `Tracking score ${score}/100, read through a vibration finding${demandSuffix}`,
      detail:
        "The response follows the sticks, but a strong vibration is open on this flight — the tuning instruments are read through it, and no tuning change is earned until the mechanical source is fixed.",
      action:
        "Fix the vibration first (see the Vibration card), fly again, and read this score fresh on that flight.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  // "Crisp" is a claim; thin evidence cannot carry it. Few clean
  // commands make a high score a hover's score, not a tune's.
  if (thinEvidence) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: `Tracking score ${score}/100 on thin evidence${demandSuffix}`,
      detail:
        "The machine followed the few clean commands this flight offered, but too few of them to call the tune crisp — the score is honest, the confidence is not there yet.",
      action:
        "Fly 4–6 deliberate stops and reversals on each axis at one headspeed; the PID Lab then has the evidence to rate the tune.",
      screen: "pid",
      evidence: "PID Lab findings"
    };
  }

  if (score < 85) {
    return {
      key: "tuning",
      title: "Tuning",
      status: "watch",
      headline: `Tracking score ${score}/100: decent, not crisp${demandSuffix}`,
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
    headline: `Tracking score ${score}/100: crisp response${demandSuffix}`,
    detail: hoverDemand
      ? "The machine follows the sticks faithfully, at the gentle demand this flight asked of it. A score from a harder flight is a different measurement."
      : "The machine follows the sticks faithfully.",
    action: "Nothing to do. Enjoy it.",
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
      detail: `${start.toFixed(1)} V → ${end.toFixed(1)} V: an aging pack or a flight flown long/hard.`,
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
      statusLabel: "Partial: stability only",
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
          : "Worth a look at that moment in the Governor Lab chart. Deliberate headspeed changes are not counted against this.",
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
        ? "The output was already at its ceiling, so more governor gain cannot help. Lower the headspeed, take some pitch out, or adjust the gearing/Kv to match your target headspeed. The ESC Lab shows the moment."
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
      ? "Lower the headspeed, take some pitch out, or adjust the gearing/Kv to match your target headspeed. The ESC Lab shows the exact moments."
      : escLab.status === "watch"
        ? "Fine for now. Worth remembering before asking the machine for more."
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
// ------------------------------------------------------
// Signal + receiver-power verdicts — from their labs.
// Cards appear only when the log carried the telemetry: an
// absent column is a quality-chip fact, not a Home warning.
// ------------------------------------------------------
function signalVerdict(signalLab) {
  if (!signalLab) return null;

  const status = signalLab.status;

  return {
    key: "signal",
    title: "Signal",
    status,
    headline:
      status === "attention"
        ? signalLab.counts.failsafe > 0
          ? "The control link was interrupted"
          : "The link needs a look"
        : status === "watch"
          ? "Signal dipped: the link held"
          : "Radio link solid the whole flight",
    detail: signalLab.story,
    action:
      status === "good"
        ? "Nothing to do."
        : "Open the Signal Lab: the events name each moment.",
    screen: "signal",
    evidence: "Signal Lab events"
  };
}

function becVerdict(becLab) {
  if (!becLab) return null;

  const status = becLab.status;

  return {
    key: "bec",
    title: "BEC Output",
    status,
    headline:
      status === "attention"
        ? "BEC output needs attention"
        : status === "watch"
          ? becLab.implausibleBrownout
            ? "Voltage reading worth checking"
            : "BEC voltage dipped"
          : "BEC output rock steady",
    detail: becLab.story,
    action:
      status === "good"
        ? "Nothing to do."
        : "Open the BEC Lab: each dip carries its servo context.",
    screen: "bec",
    evidence: "BEC Lab events"
  };
}

export function buildFlightVerdict({
  spectra,
  headspeed,
  governorTarget,
  vbat,
  pidAnalysis,
  labs,
  anchorHeadspeedRpm,
  filterAdvice = null,
  signalLab = null,
  becLab = null
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

  const vibration = vibrationVerdict(
    spectra,
    governedHeadspeed,
    filterAdvice,
    pidAnalysis
  );

  const cards = [
  vibration,
  rotorSpeedVerdictFromLab(labs?.governor),
  tuningVerdict(pidAnalysis, {
    vibrationConcern: vibration?.status === "attention"
  }),
  powerVerdictFromLab(labs?.esc),
  batteryVerdictFromLab(labs?.battery),
  signalVerdict(signalLab),
  becVerdict(becLab)
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
