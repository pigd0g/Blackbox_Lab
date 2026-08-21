// ======================================================
// BLACKBOX LAB — SAMPLE FLIGHT GENERATOR
// ======================================================
//
// Creates realistic Rotorflight-style helicopter flights
// as genuine BINARY .bbl files, with known ground truth:
// you decide the vibration frequencies, governor behavior
// and tune quality — then the Labs must find exactly that.
//
// Usage:
//   node tools/generateSampleLog.mjs                 # all presets → samples/
//   node tools/generateSampleLog.mjs clean-tuned 20  # one preset, 20 seconds
//
// Presets:
//   clean-tuned        well-tuned machine, light vibration
//   vibration-problem  strong 1/rev + tail resonance peaks
//   governor-sag       headspeed droops under collective load
//
// Academy presets (Diagnosis Academy — each plants exactly
// ONE known defect; the reveal copy lives with the Academy
// shelf in the app):
//   academy-imbalance        heavy 1/rev, tune is fine
//   academy-underdamped-roll bounce-back after roll inputs
//   academy-weak-ff          I-term carries the commands
//   academy-governor-droop   headspeed sags under load
//   academy-dead-current     current sensor reads nothing
//   academy-stale-dump       ships with an OUTDATED CLI pair
//
// ======================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------
// Spec-faithful binary writers
// ------------------------------------------------------

function writeUnsignedVB(value, out) {
  let remaining = value >>> 0;

  while (remaining > 127) {
    out.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }

  out.push(remaining);
}

function writeSignedVB(value, out) {
  writeUnsignedVB(((value << 1) ^ (value >> 31)) >>> 0, out);
}

function writeTag2_3S32(values, out) {
  const fits = (v, bits) =>
    v >= -(1 << (bits - 1)) && v < 1 << (bits - 1);

  if (values.every((v) => fits(v, 2))) {
    out.push(
      ((values[0] & 0x03) << 4) |
        ((values[1] & 0x03) << 2) |
        (values[2] & 0x03)
    );
    return;
  }

  if (values.every((v) => fits(v, 4))) {
    out.push(0b0100_0000 | (values[0] & 0x0f));
    out.push(((values[1] & 0x0f) << 4) | (values[2] & 0x0f));
    return;
  }

  if (values.every((v) => fits(v, 6))) {
    out.push(0b1000_0000 | (values[0] & 0x3f));
    out.push(values[1] & 0x3f);
    out.push(values[2] & 0x3f);
    return;
  }

  const byteCount = (v) =>
    fits(v, 8) ? 1 : fits(v, 16) ? 2 : fits(v, 24) ? 3 : 4;

  const counts = values.map(byteCount);
  out.push(
    0b1100_0000 |
      ((counts[2] - 1) << 4) |
      ((counts[1] - 1) << 2) |
      (counts[0] - 1)
  );

  for (let i = 0; i < 3; i += 1) {
    let v = values[i];

    for (let b = 0; b < counts[i]; b += 1) {
      out.push(v & 0xff);
      v >>= 8;
    }
  }
}

function writeTag8_8SVB(values, out) {
  if (values.length === 1) {
    writeSignedVB(values[0], out);
    return;
  }

  let header = 0;

  values.forEach((v, i) => {
    if (v !== 0) {
      header |= 1 << i;
    }
  });

  out.push(header);

  for (const v of values) {
    if (v !== 0) {
      writeSignedVB(v, out);
    }
  }
}

function pushAscii(text, out) {
  for (const char of text) {
    out.push(char.charCodeAt(0));
  }
}

// ------------------------------------------------------
// Deterministic pseudo-random (same file every run)
// ------------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------
// Flight physics model
// ------------------------------------------------------

const PRESETS = {
  "clean-tuned": {
    description: "Well-tuned 700-class heli: light vibration, crisp tracking",
    headspeedTarget: 1820,
    mainRotorVibration: 3, // deg/s amplitude at 1/rev
    tailVibration: 1.5,
    wideBandNoise: 1.2,
    governorStiffness: 0.15,
    loadSag: 4,
    trackingLag: 0.035, // seconds — crisp
    trackingDamping: 0.95 // near-critical: no overshoot
  },
  "vibration-problem": {
    description:
      "Mechanical trouble: strong 1/rev (imbalance) + tail resonance",
    headspeedTarget: 1780,
    mainRotorVibration: 28,
    tailVibration: 16,
    wideBandNoise: 4,
    governorStiffness: 0.15,
    loadSag: 6,
    trackingLag: 0.045,
    trackingDamping: 0.42 // underdamped: overshoot + ringing
  },
  "governor-sag": {
    description:
      "Weak governor: headspeed droops hard under collective load",
    headspeedTarget: 1850,
    mainRotorVibration: 5,
    tailVibration: 2.5,
    wideBandNoise: 1.6,
    governorStiffness: 0.035,
    loadSag: 65,
    trackingLag: 0.04,
    trackingDamping: 0.8
  },

  // ---- Academy presets ----
  //
  // Extra knobs beyond the classic three:
  //   trackingLag / trackingDamping  may be per-axis triples
  //   pGain / iGain / iLeakPerSecond PID-term synthesis
  //   currentDead                    amperage reads zero
  //   headerTuning                   H-header PID arrays
  //     (rollPID/pitchPID/yawPID = P,I,D,F,B —
  //      govPID = P,I,D,F,gain — the layout the applied-
  //      state checks read)
  //   staleDump                      paired CLI dump whose
  //     listed settings deliberately DIFFER from the flown
  //     headers — the freshness-warning teaching case
  //   script: "repeat"               repeating maneuver
  //     blocks so every axis collects enough command events
  //   defaultSeconds                 length when no CLI arg

  "academy-imbalance": {
    description:
      "Planted defect: heavy 1/rev main-rotor imbalance — the tune is fine",
    headspeedTarget: 1800,
    mainRotorVibration: 30,
    tailVibration: 3,
    wideBandNoise: 2,
    governorStiffness: 0.15,
    loadSag: 5,
    trackingLag: 0.035,
    trackingDamping: 0.95,
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "52,180,42,110,0",
      pitchPID: "56,190,48,115,0",
      yawPID: "70,120,20,60,0",
      govPID: "40,25,0,0,105"
    }
  },
  "academy-underdamped-roll": {
    description:
      "Planted defect: underdamped roll — every roll input bounces back",
    headspeedTarget: 1820,
    mainRotorVibration: 2.2,
    tailVibration: 1.2,
    wideBandNoise: 1.2,
    governorStiffness: 0.15,
    loadSag: 5,
    trackingLag: [0.045, 0.038, 0.04],
    trackingDamping: [0.09, 0.9, 0.9],
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "58,170,18,120,0",
      pitchPID: "54,185,46,115,0",
      yawPID: "72,118,22,62,0",
      govPID: "42,26,0,0,102"
    }
  },
  "academy-weak-ff": {
    description:
      "Planted defect: feedforward too weak — the I-term carries every command",
    headspeedTarget: 1810,
    mainRotorVibration: 2.2,
    tailVibration: 1.2,
    wideBandNoise: 1.2,
    governorStiffness: 0.15,
    loadSag: 5,
    trackingLag: [0.06, 0.06, 0.035],
    trackingDamping: [0.9, 0.9, 0.9],
    pGain: 0.05,
    iGain: 0.015,
    ffGain: 0.02,
    iLeakPerSecond: 2,
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "48,210,40,25,0",
      pitchPID: "50,215,44,25,0",
      yawPID: "68,130,20,30,0",
      govPID: "40,25,0,0,104"
    }
  },
  "academy-governor-droop": {
    description:
      "Planted defect: weak governor — headspeed droops hard under load",
    headspeedTarget: 1850,
    mainRotorVibration: 2.2,
    tailVibration: 1.2,
    wideBandNoise: 1.2,
    governorStiffness: 0.035,
    loadSag: 65,
    trackingLag: 0.04,
    trackingDamping: 0.8,
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "50,182,42,112,0",
      pitchPID: "54,192,48,116,0",
      yawPID: "70,122,20,60,0",
      govPID: "18,10,0,0,62"
    }
  },
  "academy-dead-current": {
    description:
      "Planted defect: dead current sensor — every amperage sample reads zero",
    headspeedTarget: 1820,
    mainRotorVibration: 2.2,
    tailVibration: 1.2,
    wideBandNoise: 1.2,
    governorStiffness: 0.15,
    loadSag: 5,
    trackingLag: 0.035,
    trackingDamping: 0.92,
    currentDead: true,
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "51,184,42,110,0",
      pitchPID: "55,194,48,114,0",
      yawPID: "71,121,21,61,0",
      govPID: "41,25,0,0,103"
    }
  },
  "academy-stale-dump": {
    description:
      "Planted trap: the paired CLI dump is OUTDATED — bench changes were never re-dumped",
    headspeedTarget: 1820,
    mainRotorVibration: 2.2,
    tailVibration: 1.2,
    wideBandNoise: 1.2,
    governorStiffness: 0.15,
    loadSag: 5,
    trackingLag: 0.035,
    trackingDamping: 0.92,
    script: "repeat",
    defaultSeconds: 56,
    firmwareRevision: "4.6.0 (synthetic)",
    headerTuning: {
      rollPID: "52,180,42,110,0",
      pitchPID: "56,190,45,115,0",
      yawPID: "70,120,20,60,0",
      govPID: "40,25,0,0,105"
    },
    // The dump's values BEFORE the (fictional) bench session:
    // two settings walked back from the flown headers.
    staleDump: { roll_p_gain: 44, pitch_d_gain: 30 }
  }
};

const SAMPLE_RATE = 2000; // Hz logging rate
const I_INTERVAL = 32;
const TAIL_RATIO = 4.6; // tail rotor turns per main rotor turn

// Per-axis knobs accept a scalar (same on all axes) or a
// [roll, pitch, yaw] triple.
const asTriple = (value) =>
  Array.isArray(value) ? value : [value, value, value];

function buildHeader(preset, presetName) {
  const fieldNames = [
    "loopIteration",
    "time",
    "axisP[0]",
    "axisP[1]",
    "axisP[2]",
    "axisI[0]",
    "axisI[1]",
    "axisI[2]",
    "axisD[0]",
    "axisD[1]",
    "axisD[2]",
    "axisF[0]",
    "axisF[1]",
    "axisF[2]",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "setpoint[3]",
    "rcCommand[0]",
    "rcCommand[1]",
    "rcCommand[2]",
    "rcCommand[3]",
    "gyroADC[0]",
    "gyroADC[1]",
    "gyroADC[2]",
    "gyroUnfilt[0]",
    "gyroUnfilt[1]",
    "gyroUnfilt[2]",
    "motor[0]",
    "motor[1]",
    "headspeed",
    "governorTarget",
    "vbatLatest",
    "amperageLatest"
  ];

  const motorStart = fieldNames.indexOf("motor[0]");
  const positiveStart = motorStart; // motor..amperage: positive

  const fields = {
    names: fieldNames,
    // I-frame: absolutes. unsigned VB for counters/positives,
    // signed VB for anything that can be negative. Motors
    // predict from minthrottle (predictor 4).
    iPredictors: fieldNames.map((name) =>
      name.startsWith("motor[") ? 4 : 0
    ),
    iEncodings: fieldNames.map((name, index) =>
      index < 2 || index >= positiveStart ? 1 : 0
    ),
    // P-frame: deltas. loopIteration increments silently,
    // time extrapolates, PID P/I terms exercise the TAG group
    // encodings, everything else is previous + SVB delta.
    pPredictors: fieldNames.map((name, index) =>
      index === 0 ? 6 : index === 1 ? 2 : 1
    ),
    pEncodings: fieldNames.map((name, index) =>
      index === 0
        ? 9
        : index === 1
          ? 0
          : index >= 2 && index <= 4
            ? 7
            : index >= 5 && index <= 7
              ? 6
              : 0
    )
  };

  const lines = [
    "H Product:Blackbox flight data recorder by Nicholas Sherlock",
    "H Data version:2",
    "H Firmware type:Rotorflight",
    `H Firmware revision:${preset.firmwareRevision ?? "4.4.0 (synthetic)"}`,
    `H Firmware date:${new Date(2026, 0, 1).toDateString()}`,
    "H Board information:BLACKBOX_LAB_SIM",
    `H Craft name:Sample ${presetName}`,
    "H minthrottle:1070",
    "H maxthrottle:2000",
    "H vbatref:2520",
    // PID arrays in the firmware's own header layout
    // (<axis>PID = P,I,D,F,B / govPID = P,I,D,F,gain) so
    // the applied-state and dump-freshness checks can read
    // the flown values from the log itself.
    ...Object.entries(preset.headerTuning ?? {}).map(
      ([key, value]) => `H ${key}:${value}`
    ),
    `H I interval:${I_INTERVAL}`,
    "H P interval:1/1",
    `H Field I name:${fields.names.join(",")}`,
    `H Field I predictor:${fields.iPredictors.join(",")}`,
    `H Field I encoding:${fields.iEncodings.join(",")}`,
    `H Field P predictor:${fields.pPredictors.join(",")}`,
    `H Field P encoding:${fields.pEncodings.join(",")}`
  ];

  return { fields, headerText: lines.join("\n") + "\n" };
}

// Scripted stick inputs: hover, cyclic pulses, a yaw sweep,
// collective climbs — enough variety for every Lab.
function setpointAt(axis, t, duration) {
  const phase = t / duration;

  if (axis === 0) {
    // roll: two crisp cyclic pulses
    if (phase > 0.25 && phase < 0.27) return 180;
    if (phase > 0.55 && phase < 0.57) return -220;
    return 0;
  }

  if (axis === 1) {
    // pitch: one long elliptical pull
    if (phase > 0.4 && phase < 0.48)
      return 140 * Math.sin(((phase - 0.4) / 0.08) * Math.PI);
    return 0;
  }

  if (axis === 2) {
    // yaw: pirouette segment
    if (phase > 0.65 && phase < 0.78) return 90;
    return 0;
  }

  // collective (setpoint[3]): hover with two climbs
  if (phase > 0.3 && phase < 0.38) return 60;
  if (phase > 0.7 && phase < 0.76) return 80;
  return 12;
}

// Academy flights repeat a fixed 12-second maneuver block
// (after an 8 s spool-up-and-settle lead-in) so every axis
// collects enough command events for the response
// instruments to compute honest medians — a one-pulse
// flight cannot ground a bounce-back or settling verdict.
function repeatingSetpoint(axis, t) {
  if (t < 8) {
    // Spool up, come to a hover, touch nothing.
    return axis === 3 ? (t > 6 ? 12 : 0) : 0;
  }

  const blockIndex = Math.floor((t - 8) / 12);
  const block = (t - 8) % 12;

  // No two blocks fly the exact same amplitudes: a pilot
  // never repeats a stick input perfectly, and identical
  // peaks would let synthetic terms dwell at their own
  // maximum for the sum of every repeat.
  const vary = 0.88 + 0.12 * Math.sin(blockIndex * 2.399 + axis);

  if (axis === 0) {
    // roll: one pulse each way per block
    if (block >= 1 && block < 1.3) return 180 * vary;
    if (block >= 6 && block < 6.3) return -200 * vary;
    return 0;
  }

  if (axis === 1) {
    // pitch: one elliptical pull, one crisp push
    if (block >= 3 && block < 3.6)
      return 150 * vary * Math.sin(((block - 3) / 0.6) * Math.PI);
    if (block >= 9 && block < 9.4) return -160 * vary;
    return 0;
  }

  if (axis === 2) {
    // yaw: one held segment each way
    if (block >= 4.5 && block < 5.5) return 90 * vary;
    if (block >= 10.5 && block < 11.2) return -90 * vary;
    return 0;
  }

  // collective: hover with two climbs per block
  if (block >= 2 && block < 3) return 60;
  if (block >= 7.5 && block < 8.4) return 80;
  return 12;
}

function scriptedSetpoint(preset, axis, t, duration) {
  return preset.script === "repeat"
    ? repeatingSetpoint(axis, t)
    : setpointAt(axis, t, duration);
}

export function generateFlight(presetName, durationSeconds, seed = 20260722) {
  const preset = PRESETS[presetName];

  if (!preset) {
    throw new Error(
      `Unknown preset "${presetName}" — pick one of: ${Object.keys(PRESETS).join(", ")}`
    );
  }

  const random = mulberry32(seed);
  const { fields, headerText } = buildHeader(preset, presetName);

  const out = [];
  pushAscii(headerText, out);

  const frameCount = Math.floor(durationSeconds * SAMPLE_RATE);
  const dt = 1 / SAMPLE_RATE;

  const gyro = [0, 0, 0];
  const gyroRate = [0, 0, 0];
  const iTerm = [0, 0, 0];
  let headspeed = 0;
  let vbat = 2520; // volts × 100
  let previous = null;
  let previous2 = null;

  const lagTriple = asTriple(preset.trackingLag);
  const dampingTriple = asTriple(preset.trackingDamping);
  const pGain = preset.pGain ?? 0.4;
  const iGain = preset.iGain ?? 0.02;
  const dGain = preset.dGain ?? 0.02;
  const ffGain = preset.ffGain ?? 0.25;
  const previousFiltered = [0, 0, 0];
  // I-term leak: without it a heavy iGain rails at the clamp
  // and every academy flight would read as I-term saturation
  // instead of the one defect it plants.
  // Academy (repeat-script) flights default to a light leak:
  // a leak-free synthetic I ratchets upward across repeated
  // blocks and reads as saturation on every axis.
  const iLeakFactor =
    1 -
    (preset.iLeakPerSecond ??
      (preset.script === "repeat" ? 0.8 : 0)) /
      SAMPLE_RATE;

  for (let n = 0; n < frameCount; n += 1) {
    const t = n * dt;
    const command = (axis) =>
      scriptedSetpoint(preset, axis, t, durationSeconds);

    // ---- rotor spool-up, then governed headspeed ----
    const spool = Math.min(1, t / 6);
    const collective = command(3);
    const load = collective / 80;

    const governedTarget = preset.headspeedTarget * spool;
    const sag = preset.loadSag * load;
    headspeed +=
      (governedTarget - sag - headspeed) * preset.governorStiffness;

    const mainRotorHz = headspeed / 60;
    const tailHz = mainRotorHz * TAIL_RATIO;

    // ---- gyro follows setpoint as a second-order system:
    // damping < 1 produces the overshoot and ringing a
    // badly tuned helicopter really shows ----
    const cleanGyro = [0, 1, 2].map((axis) => {
      const naturalFrequency = 1 / lagTriple[axis];
      const damping = dampingTriple[axis];
      const target = command(axis);
      const acceleration =
        naturalFrequency * naturalFrequency * (target - gyro[axis]) -
        2 * damping * naturalFrequency * gyroRate[axis];

      gyroRate[axis] += acceleration * dt;
      gyro[axis] += gyroRate[axis] * dt;
      return gyro[axis];
    });

    // ---- vibration + noise on the unfiltered gyro ----
    const vibration = (axisGain) =>
      preset.mainRotorVibration *
        axisGain *
        Math.sin(2 * Math.PI * mainRotorHz * t) +
      preset.mainRotorVibration *
        0.35 *
        axisGain *
        Math.sin(2 * Math.PI * 2 * mainRotorHz * t + 1.1) +
      preset.tailVibration *
        axisGain *
        Math.sin(2 * Math.PI * tailHz * t + 0.6) +
      preset.wideBandNoise * (random() * 2 - 1);

    const unfiltered = [
      cleanGyro[0] + vibration(1),
      cleanGyro[1] + vibration(0.8),
      cleanGyro[2] + vibration(1.2)
    ];

    // A simple software-filter stand-in: the "filtered"
    // trace keeps ~15% of the vibration.
    const filtered = [0, 1, 2].map(
      (axis) =>
        cleanGyro[axis] + (unfiltered[axis] - cleanGyro[axis]) * 0.15
    );

    // ---- PID terms, motors, battery ----
    const pTerm = [0, 1, 2].map((axis) =>
      Math.round((command(axis) - filtered[axis]) * pGain)
    );

    // D on the (filtered) gyro derivative, FF straight off
    // the command — the same signals the firmware uses.
    const dTerm = [0, 1, 2].map((axis) => {
      const derivative =
        (filtered[axis] - previousFiltered[axis]) / dt;
      previousFiltered[axis] = filtered[axis];
      return Math.round(-derivative * dGain);
    });

    const fTerm = [0, 1, 2].map((axis) =>
      Math.round(command(axis) * ffGain)
    );

    [0, 1, 2].forEach((axis) => {
      iTerm[axis] = Math.max(
        -400,
        Math.min(
          400,
          iTerm[axis] * iLeakFactor +
            (command(axis) - filtered[axis]) * iGain
        )
      );
    });

    const throttle = Math.round(
      1070 + 500 * spool + 260 * load + (random() * 8 - 4)
    );
    const tailMotor = Math.round(
      1070 + 420 * spool + 120 * Math.abs(cleanGyro[2] / 90)
    );

    const amps = preset.currentDead
      ? 0
      : Math.round((8 + 60 * load + 14 * spool) * 100);
    vbat = Math.max(
      2190,
      2520 - Math.round(14 * t * (0.4 + load)) / 10
    );

    const frame = [
      n, // loopIteration
      Math.round(t * 1_000_000), // time in microseconds
      pTerm[0],
      pTerm[1],
      pTerm[2],
      Math.round(iTerm[0]),
      Math.round(iTerm[1]),
      Math.round(iTerm[2]),
      dTerm[0],
      dTerm[1],
      dTerm[2],
      fTerm[0],
      fTerm[1],
      fTerm[2],
      Math.round(command(0)),
      Math.round(command(1)),
      Math.round(command(2)),
      Math.round(collective),
      // Pilot input: deflection consistent with the setpoints —
      // cyclic/yaw 1:1 (500 deg/s at full stick), collective on
      // the deflection scale.
      Math.round(command(0)),
      Math.round(command(1)),
      Math.round(command(2)),
      Math.round(collective * 5),
      Math.round(filtered[0]),
      Math.round(filtered[1]),
      Math.round(filtered[2]),
      Math.round(unfiltered[0]),
      Math.round(unfiltered[1]),
      Math.round(unfiltered[2]),
      throttle,
      tailMotor,
      Math.round(headspeed),
      Math.round(governedTarget),
      Math.round(vbat),
      amps
    ];

    if (n % I_INTERVAL === 0 || previous === null) {
      // ---- intraframe ----
      out.push("I".charCodeAt(0));

      frame.forEach((value, i) => {
        const predicted =
          fields.iPredictors[i] === 4 ? value - 1070 : value;

        if (fields.iEncodings[i] === 1) {
          writeUnsignedVB(predicted, out);
        } else {
          writeSignedVB(predicted, out);
        }
      });

      previous2 = frame;
      previous = frame;
    } else {
      // ---- interframe ----
      out.push("P".charCodeAt(0));

      // time: straight-line predictor
      writeSignedVB(
        frame[1] - (2 * previous[1] - previous2[1]),
        out
      );

      // axisP group: TAG2_3S32
      writeTag2_3S32(
        [
          frame[2] - previous[2],
          frame[3] - previous[3],
          frame[4] - previous[4]
        ],
        out
      );

      // axisI group: TAG8_8SVB
      writeTag8_8SVB(
        [
          frame[5] - previous[5],
          frame[6] - previous[6],
          frame[7] - previous[7]
        ],
        out
      );

      // everything else (axisD/axisF onward): previous +
      // signed VB delta
      for (let i = 8; i < frame.length; i += 1) {
        writeSignedVB(frame[i] - previous[i], out);
      }

      previous2 = previous;
      previous = frame;
    }
  }

  // Tidy end-of-log event
  out.push("E".charCodeAt(0), 0xff);
  pushAscii("End of log", out);
  out.push(0);

  return {
    bytes: new Uint8Array(out),
    preset,
    groundTruth: {
      preset: presetName,
      description: preset.description,
      sampleRateHz: SAMPLE_RATE,
      headspeedTarget: preset.headspeedTarget,
      expectedMainRotorPeakHz:
        Math.round((preset.headspeedTarget / 60) * 10) / 10,
      expectedTailPeakHz:
        Math.round((preset.headspeedTarget / 60) * TAIL_RATIO * 10) / 10,
      ...(preset.headerTuning
        ? { headerTuning: preset.headerTuning }
        : {}),
      ...(preset.staleDump
        ? { staleDumpSettings: preset.staleDump }
        : {})
    }
  };
}

// ------------------------------------------------------
// Stale-dump pair
// ------------------------------------------------------
//
// The academy-stale-dump entry ships WITH a CLI dump — but a
// deliberately outdated one: its listed settings are the
// values from BEFORE a fictional bench session, while the
// log's headers carry what actually flew. Loading both must
// trip the dump-freshness warning; that warning is the
// lesson.

const HEADER_TO_CLI = [
  ["rollPID", ["roll_p_gain", "roll_i_gain", "roll_d_gain", "roll_f_gain", "roll_b_gain"]],
  ["pitchPID", ["pitch_p_gain", "pitch_i_gain", "pitch_d_gain", "pitch_f_gain", "pitch_b_gain"]],
  ["yawPID", ["yaw_p_gain", "yaw_i_gain", "yaw_d_gain", "yaw_f_gain", "yaw_b_gain"]],
  ["govPID", ["gov_p_gain", "gov_i_gain", "gov_d_gain", "gov_f_gain", "gov_gain"]]
];

export function buildStaleDumpText(presetName) {
  const preset = PRESETS[presetName];

  if (!preset?.headerTuning || !preset.staleDump) {
    throw new Error(
      `Preset "${presetName}" has no stale-dump pair to build.`
    );
  }

  const lines = [
    `# Rotorflight / SYNTHETIC (SIM) 4.6.0`,
    `# This is a TEACHING dump for the Diagnosis Academy.`,
    `board_name BLACKBOX_LAB_SIM`,
    `set name = Sample ${presetName}`
  ];

  for (const [header, cliKeys] of HEADER_TO_CLI) {
    const flown = String(preset.headerTuning[header] ?? "")
      .split(",")
      .map(Number);

    cliKeys.forEach((key, index) => {
      if (!Number.isFinite(flown[index])) return;
      const value = preset.staleDump[key] ?? flown[index];
      lines.push(`set ${key} = ${value}`);
    });
  }

  return lines.join("\n") + "\n";
}

// ------------------------------------------------------
// CLI
// ------------------------------------------------------

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  const [presetArgument, secondsArgument] = process.argv.slice(2);

  const presets = presetArgument
    ? [presetArgument]
    : Object.keys(PRESETS);

  const samplesDirectory = join(projectRoot, "samples");
  mkdirSync(samplesDirectory, { recursive: true });

  const manifest = [];

  for (const name of presets) {
    const seconds =
      Number(secondsArgument) ||
      PRESETS[name]?.defaultSeconds ||
      15;
    const { bytes, groundTruth } = generateFlight(name, seconds);
    const fileName = `sample-${name}.bbl`;

    writeFileSync(join(samplesDirectory, fileName), bytes);

    if (PRESETS[name]?.staleDump) {
      const dumpFileName = `sample-${name}.dump.txt`;
      writeFileSync(
        join(samplesDirectory, dumpFileName),
        buildStaleDumpText(name)
      );
      manifest.push({ file: fileName, dumpFile: dumpFileName, ...groundTruth });
    } else {
      manifest.push({ file: fileName, ...groundTruth });
    }

    console.log(
      `${fileName}  ${(bytes.length / 1024).toFixed(0)} KB  ` +
        `(main rotor peak ~${groundTruth.expectedMainRotorPeakHz} Hz, ` +
        `tail ~${groundTruth.expectedTailPeakHz} Hz)`
    );
  }

  writeFileSync(
    join(samplesDirectory, "ground-truth.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`\nWrote ${presets.length} sample flight(s) to samples/`);
}
