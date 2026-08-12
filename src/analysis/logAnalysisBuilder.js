import { buildAnalysisContext } from "./analysisContext.js";
import { getMetadataValue } from "./metadataReader.js";
import { findTelemetryHeaderIndex } from "./telemetryHeader.js";
import { findHeader } from "./headerHelpers.js";
import {
  getColumnValues,
  getColumnAverage,
  getColumnSamples
} from "./mathHelpers.js";
import { buildFlightAnalysis } from "./flightAnalysis.js";
import { analyzePids } from "./pidAnalysis.js";
import { analyzeFilters } from "./filterAnalysis.js";
import {
  isUsableGovernorTarget,
  detectStableFlightPhase,
  hasUsableRotorSpeed
} from "./flightPhase.js";
import { analyzeGovernorLab } from "./governorLabAnalysis.js";

// Does this log carry a governor target, or only rotor speed?
// Models on an ESC or external governor log the second without the
// first, and the column may be present but empty.
function hasRealGovernorTarget(governorTargetValues) {
  return (
    Array.isArray(governorTargetValues) &&
    governorTargetValues.some((value) => Number(value) > 0)
  );
}

// The headspeed a pilot is holding, with the measurement noise taken
// out. For a governed model the flight controller states its target
// outright; for an ungoverned one, the steady value the rotor actually
// runs at is the closest honest equivalent — but only once smoothed.
// Raw rotor speed jitters by tens of rpm sample to sample, and that
// jitter is what fragments one real headspeed into dozens of profile
// buckets and reads as a governor changing its mind.
function smoothRotorSpeed(values, windowSamples) {
  const half = Math.max(1, Math.round(windowSamples / 2));
  const smoothed = new Array(values.length).fill(null);

  let runningTotal = 0;
  let runningCount = 0;

  for (let index = 0; index < values.length + half; index += 1) {
    if (index < values.length) {
      const entering = Number(values[index]);
      if (Number.isFinite(entering)) {
        runningTotal += entering;
        runningCount += 1;
      }
    }

    const leavingIndex = index - 2 * half;

    if (leavingIndex >= 0) {
      const leaving = Number(values[leavingIndex]);
      if (Number.isFinite(leaving)) {
        runningTotal -= leaving;
        runningCount -= 1;
      }
    }

    const writeIndex = index - half;

    if (writeIndex >= 0 && writeIndex < values.length && runningCount > 0) {
      smoothed[writeIndex] = runningTotal / runningCount;
    }
  }

  return smoothed;
}

function detectHeadspeedProfiles(
  headspeedValues,
  governorTargetValues,
  alignedHeadspeedSamples = []
) {
  const rowAlignedSamples =
  Array.isArray(alignedHeadspeedSamples)
    ? alignedHeadspeedSamples
    : [];
  if (
  !Array.isArray(headspeedValues) ||
  !Array.isArray(governorTargetValues)
) {
  return [];
}
const targetIsReal = hasRealGovernorTarget(governorTargetValues);

// Without a real target there is nothing to hand the phase detector:
// it already falls back to reading rotor speed on its own, and giving
// it a target copied from the measurement is actively worse than
// giving it none. The transition filter exists to drop the moments a
// governor switches banks, so a "target" that jitters with the sensor
// looks like a governor changing its mind on every sample and takes
// the whole flight out with it.
const stableFlightPhase =
  rowAlignedSamples.length > 0
    ? detectStableFlightPhase({
        timeSeconds: rowAlignedSamples.map(
          (sample) => sample.timeSeconds
        ),
        headspeed: rowAlignedSamples.map(
          (sample) => sample.measuredRpm
        ),
        governorTarget: targetIsReal
          ? rowAlignedSamples.map((sample) => sample.targetRpm)
          : []
      })
    : null;

const stableSampleIndexes =
  new Set(
    stableFlightPhase?.stableIndexes || []
  );

const rawProfileSamples =
  rowAlignedSamples.length > 0
    ? rowAlignedSamples
    : headspeedValues.map((measuredRpm, index) => ({
        rowIndex: null,
        measuredRpm: Number(measuredRpm),
       targetRpm:
  Number(governorTargetValues[index]) > 0
    ? Number(governorTargetValues[index])
    : Number(measuredRpm)
      }));

// Profiles are grouped by target, so an ungoverned model needs its
// stand-in target smoothed before grouping — otherwise one steady
// 1700 rpm scatters across every 10-rpm bucket between 1600 and 1800
// and no single bucket holds enough samples to count as a profile.
// A real bank change moves the smoothed value too, so distinct
// headspeeds stay distinct.
const profileSamples = (() => {
  if (targetIsReal || rawProfileSamples.length === 0) {
    return rawProfileSamples;
  }

  const times = rawProfileSamples.map((sample) => sample.timeSeconds);
  const firstTime = times.find((value) => Number.isFinite(value));
  const lastTime = [...times]
    .reverse()
    .find((value) => Number.isFinite(value));

  const span =
    Number.isFinite(firstTime) && Number.isFinite(lastTime)
      ? lastTime - firstTime
      : 0;

  const samplesPerSecond =
    span > 0 ? rawProfileSamples.length / span : 1000;

  // Two seconds: long enough to flatten sensor noise, short enough
  // that a deliberate headspeed change still shows up as one.
  const windowSamples = Math.max(
    5,
    Math.min(
      Math.round(samplesPerSecond * 2),
      Math.floor(rawProfileSamples.length / 2)
    )
  );

  const smoothed = smoothRotorSpeed(
    rawProfileSamples.map((sample) => sample.measuredRpm),
    windowSamples
  );

  return rawProfileSamples.map((sample, index) => ({
    ...sample,
    targetRpm: Number.isFinite(smoothed[index])
      ? smoothed[index]
      : sample.measuredRpm
  }));
})();

 const sampleCount = profileSamples.length;

   
  const profileGroups = new Map();
const rejected = {
   seen: 0,
  unstable: 0,
  invalidNumbers: 0,
  targetTooLow: 0,
  outsideRange: 0,
  accepted: 0
};
  for (
  let sampleIndex = 0;
  sampleIndex < profileSamples.length;
  sampleIndex += 1
) {
  const sample = profileSamples[sampleIndex];
rejected.seen += 1;
  if (
  stableFlightPhase &&
  !stableSampleIndexes.has(sampleIndex)
) {
  rejected.unstable += 1;
  continue;
}
  

  const measuredRpm = Number(sample.measuredRpm);
  const targetRpm = Number(sample.targetRpm);

    if (
  !Number.isFinite(measuredRpm) ||
  !Number.isFinite(targetRpm)
) {
  rejected.invalidNumbers += 1;
  continue;
}
if (targetRpm < 300) {
  rejected.targetTooLow += 1;
  continue;
}
    // Ignore spool-up, spool-down, and large transient errors.
    const minimumStableRpm = targetRpm * 0.7;
    const maximumStableRpm = targetRpm * 1.3;

    if (
      measuredRpm < minimumStableRpm ||
      measuredRpm > maximumStableRpm
    ) {
      continue;
    }

    // Combine tiny target fluctuations into the same RPM profile.
    const targetBucket =
      Math.round(targetRpm / 10) * 10;

    if (!profileGroups.has(targetBucket)) {
      profileGroups.set(targetBucket, {
        targetRpm: targetBucket,
        measuredTotal: 0,
        sampleCount: 0,
        sampleIndexes: [],
        minimumRpm: measuredRpm,
        maximumRpm: measuredRpm
      });
    }

    const profile = profileGroups.get(targetBucket);

    profile.measuredTotal += measuredRpm;
    profile.sampleCount += 1;
    if (Number.isInteger(sample.rowIndex)) {
  profile.sampleIndexes.push(sample.rowIndex);
}
    profile.minimumRpm = Math.min(
      profile.minimumRpm,
      measuredRpm
    );
    profile.maximumRpm = Math.max(
      profile.maximumRpm,
      measuredRpm
    );
  }
 

  // A stated target lands on one bucket every time, so governed logs
  // group correctly as they are. A derived target is a measurement,
  // and a measurement sitting near a bucket edge falls either side of
  // it — one steady headspeed arriving as two half-populated buckets,
  // both then too small to survive the minimum. Merge neighbours back
  // together first, and merge against the running cluster mean rather
  // than the previous bucket so a slow drift cannot chain distinct
  // headspeeds into one.
  const grouped = Array.from(profileGroups.values()).sort(
    (first, second) => first.targetRpm - second.targetRpm
  );

  const merged = targetIsReal
    ? grouped
    : grouped.reduce((clusters, candidate) => {
        const open = clusters[clusters.length - 1];

        const tolerance = open
          ? Math.max(30, open.targetRpm * 0.02)
          : 0;

        if (open && candidate.targetRpm - open.targetRpm <= tolerance) {
          const total = open.sampleCount + candidate.sampleCount;

          open.targetRpm =
            (open.targetRpm * open.sampleCount +
              candidate.targetRpm * candidate.sampleCount) /
            total;
          open.measuredTotal += candidate.measuredTotal;
          open.sampleCount = total;
          open.sampleIndexes = open.sampleIndexes.concat(
            candidate.sampleIndexes
          );
          open.minimumRpm = Math.min(open.minimumRpm, candidate.minimumRpm);
          open.maximumRpm = Math.max(open.maximumRpm, candidate.maximumRpm);

          return clusters;
        }

        clusters.push({ ...candidate });
        return clusters;
      }, []);

  return merged
    .filter((profile) => profile.sampleCount >= 1000)
    .map((profile) => ({
      targetRpm: Math.round(profile.targetRpm),
      averageRpm:
        profile.measuredTotal / profile.sampleCount,
      minimumRpm: profile.minimumRpm,
      maximumRpm: profile.maximumRpm,
      sampleCount: profile.sampleCount,
      sampleIndexes: profile.sampleIndexes
    }))
    .sort((a, b) => a.targetRpm - b.targetRpm);
}
// The one System Scores line where missing telemetry must not
// masquerade as a judged governor: a score renders as "/100" only
// when it is a real number earned against a real target. A
// headspeed-only log says so in words, and anything unjudged says
// "Not scored" — never a quality label.
export function describeGovernorSystemScore(governor) {
  if (!governor) {
    return "N/A";
  }

  if (governor.capability === "partial") {
    return "Partial — headspeed stability only (no governor target logged)";
  }

  if (
    Number.isFinite(governor.score) &&
    governor.status !== "Unavailable" &&
    governor.status !== "No Active Flight Data" &&
    governor.status !== "Target Unavailable"
  ) {
    return `${governor.score}/100 — ${governor.status}`;
  }

  return `Not scored — ${
    governor.status === "insufficient"
      ? "insufficient telemetry"
      : governor.status
  }`;
}

export function buildLogAnalysis({
  fileType,
  lines,
  aircraftProfiles,
  
}) {
  let extraSummary = "";
  let telemetryText = "No telemetry found.";
  let analysisContext = null;
  let filterAnalysis = null;
  let pidAnalysis = null;
  // ====================================================
  // BLACKBOX BBL LOG
  // ====================================================

  if (fileType === "Blackbox BBL Log") {
    const firmware = getMetadataValue(lines, "firmware");
    const firmwareRevision = getMetadataValue(
      lines,
      "Firmware revision"
    );

    const board = getMetadataValue(lines, "Board information");
    const craftName = getMetadataValue(lines, "Craft name");
    const logStart = getMetadataValue(lines, "Log start datetime");

    const profile =
      aircraftProfiles[craftName.toLowerCase()] || null;

    const telemetryHeaderIndex =
      findTelemetryHeaderIndex(lines);

    let averageEscOutput = null;
    let averageEscRPM = null;
    let flightAnalysis = null;
    

    // --------------------------------------------------
    // 15A. TELEMETRY COLUMN EXTRACTION
    // --------------------------------------------------

    if (telemetryHeaderIndex >= 0) {
      const headers = lines[telemetryHeaderIndex]
        .split(",")
        .map((header) => header.trim());

      const escOutputHeader = findHeader(
        headers,
        ["escthr"]
      );

      const escRpmHeader = findHeader(
        headers,
        ["escrpm"]
      );
const timeHeader = findHeader(
  headers,
  ["time"]
);
      const headspeedHeader = findHeader(
        headers,
        ["headspeed"]
      );

      const governorTargetHeader = findHeader(
        headers,
        ["govtarget"]
      );

      averageEscOutput = getColumnAverage(
        lines,
        telemetryHeaderIndex,
        escOutputHeader
      );

      averageEscRPM = getColumnAverage(
        lines,
        telemetryHeaderIndex,
        escRpmHeader
      );
      const headspeedValues = getColumnValues(
  lines,
  telemetryHeaderIndex,
  headspeedHeader
);
const timeSamples = getColumnSamples(
  lines,
  telemetryHeaderIndex,
  timeHeader
);

const firstTimeMicroseconds =
  timeSamples.find(
    (sample) => Number.isFinite(sample.value)
  )?.value ?? 0;

const timeByRow = new Map(
  timeSamples.map((sample) => [
    sample.rowIndex,
    Number.isFinite(sample.value)
      ? (
          sample.value -
          firstTimeMicroseconds
        ) / 1_000_000
      : null
  ])
);

const headspeedSamples = getColumnSamples(
  lines,
  telemetryHeaderIndex,
  headspeedHeader
);

const averageHeadspeed = getColumnAverage(
  lines,
  telemetryHeaderIndex,
  headspeedHeader
);

const governorTargetValues = getColumnValues(
  lines,
  telemetryHeaderIndex,
  governorTargetHeader
);

const governorTargetSamples = getColumnSamples(
  lines,
  telemetryHeaderIndex,
  governorTargetHeader
);

// DIRECT-mode / passthrough targets are not rotor-speed targets —
// blank them here so profiles, labs and the report all fall back
// to headspeed-only reads (mirrors the renderer's dataset rule).
const governorTargetUsable = isUsableGovernorTarget(
  headspeedValues,
  governorTargetValues
);

if (!governorTargetUsable) {
  governorTargetValues.length = 0;
  governorTargetSamples.length = 0;
}

const governorTargetByRow = new Map(
  governorTargetSamples.map((sample) => [
    sample.rowIndex,
    sample.value
  ])
);

const alignedHeadspeedSamples = headspeedSamples
  .map((sample) => ({
    rowIndex: sample.rowIndex,
    timeSeconds: timeByRow.get(sample.rowIndex),
    measuredRpm: sample.value,
    
  targetRpm:
  Number(governorTargetByRow.get(sample.rowIndex)) > 0
    ? Number(governorTargetByRow.get(sample.rowIndex))
    : Number(sample.value)
  }))
  .filter((sample) =>
    Number.isFinite(sample.timeSeconds) &&
    Number.isFinite(sample.measuredRpm) &&
    Number.isFinite(sample.targetRpm)
  );
     
// Airframe motion, used only when no rotor speed was logged.
// It lets the app tell "no RPM sensor" apart from "this was a
// bench run and the model never moved".
const gyroActivityByRow = (() => {
  // Adapter headers may arrive quoted ("gyroADC[0]") — strip the
  // quotes before comparing, or quoted logs silently lose their
  // motion signal.
  const unquoted = (header) =>
    String(header).trim().replace(/^"|"$/g, "").toLowerCase();

  const axisSamples = [0, 1, 2]
    .map((axis) => {
      const columnName =
        headers.find(
          (header) => unquoted(header) === `gyroadc[${axis}]`
        ) ??
        headers.find(
          (header) => unquoted(header) === `gyroraw[${axis}]`
        ) ??
        null;

      return columnName
        ? getColumnSamples(
            lines,
            telemetryHeaderIndex,
            columnName
          )
        : [];
    })
    .filter((samples) => samples.length > 0);

  if (axisSamples.length === 0) {
    return null;
  }

  const totals = new Map();

  for (const samples of axisSamples) {
    for (const sample of samples) {
      const value = Number(sample.value);

      if (!Number.isFinite(value)) {
        continue;
      }

      totals.set(
        sample.rowIndex,
        (totals.get(sample.rowIndex) ?? 0) + Math.abs(value)
      );
    }
  }

  return totals;
})();

const headspeedProfiles =
  detectHeadspeedProfiles(
    headspeedValues,
    governorTargetValues,
    alignedHeadspeedSamples
  );

// Without rotor-speed data there are no headspeed profiles, but
// stick-following needs none of that: the tracking checks only need
// to know WHEN the machine was flying. Airframe motion answers it,
// so a no-RPM log still earns a tuning read — labelled as such, and
// with its confidence capped by the missing rotor context.
const motionProfiles = (() => {
  if (
    headspeedProfiles.length > 0 ||
    !gyroActivityByRow ||
    hasUsableRotorSpeed(headspeedValues)
  ) {
    return [];
  }

  const rows = [...gyroActivityByRow.entries()]
    .map(([rowIndex, activityValue]) => ({
      rowIndex,
      activityValue,
      timeSeconds: timeByRow.get(rowIndex)
    }))
    .filter((row) => Number.isFinite(row.timeSeconds))
    .sort((a, b) => a.rowIndex - b.rowIndex);

  if (rows.length < 100) {
    return [];
  }

  const motionPhase = detectStableFlightPhase({
    timeSeconds: rows.map((row) => row.timeSeconds),
    headspeed: [],
    governorTarget: [],
    activity: rows.map((row) => row.activityValue)
  });

  const stableIndexes = motionPhase.stableIndexes ?? [];

  if (stableIndexes.length < 1000) {
    return [];
  }

  return [
    {
      targetRpm: null,
      basis: "motion",
      sampleCount: stableIndexes.length,
      sampleIndexes: stableIndexes.map(
        (position) => rows[position].rowIndex
      )
    }
  ];
})();

const pidProfiles =
  headspeedProfiles.length > 0
    ? headspeedProfiles
    : motionProfiles;


      const keyHeaders = [
        ["Time", findHeader(headers, ["time"])],

        [
          "Battery Voltage",
          findHeader(headers, ["vbat", "escv"])
        ],

        [
          "Current",
          findHeader(headers, ["current", "esci"])
        ],

        [
          "ESC Output",
          findHeader(
            headers,
            ["escthr", "throttle", "motor"]
          )
        ],

        [
          "ESC RPM",
          findHeader(headers, ["escrpm"])
        ],

        [
          "Headspeed",
          headspeedHeader
        ],

        [
          "ESC Temperature",
          findHeader(headers, ["tesc", "tmcu", "esc2t"])
        ],

        [
          "Governor P",
          findHeader(headers, ["govp"])
        ],

        [
          "Governor I",
          findHeader(headers, ["govi"])
        ],

        [
          "Governor D",
          findHeader(headers, ["govd"])
        ],

        [
          "Governor Target",
          governorTargetHeader
        ]
      ];
     
  analysisContext = buildAnalysisContext({
  fileType,
  lines,
  aircraftProfile: profile,
  firmware,
  firmwareRevision,
  board,
  craftName,
  logStart,
  averageHeadspeed,
  headspeedProfiles,
  telemetryHeaderIndex,
  allColumns: headers,
  detectedTelemetry: {
    time: findHeader(headers, ["time"]),
    batteryVoltage: findHeader(headers, ["vbat", "escv"]),
    current: findHeader(headers, ["current", "esci"]),
    escOutput: escOutputHeader,
    escRpm: escRpmHeader,
    headspeed: headspeedHeader,
    escTemperature: findHeader(headers, ["tesc", "tmcu", "esc2t"]),
    governorP: findHeader(headers, ["govp"]),
    governorI: findHeader(headers, ["govi"]),
    governorD: findHeader(headers, ["govd"]),
    governorTarget: governorTargetHeader
  },

  evidenceSources: {
    bbl: fileType === "Blackbox BBL Log",
    csv: false,
    cli: false,
    aircraftProfile: Boolean(profile),
    telemetry: telemetryHeaderIndex >= 0,
    gps: false
  }

});
    filterAnalysis = analyzeFilters(
    analysisContext,
    lines
);
pidAnalysis = analyzePids(
  analysisContext,
  lines,
  pidProfiles
);


const governorLabSamples = headspeedSamples
  .map((sample) => ({
    timeSeconds: timeByRow.get(sample.rowIndex),
    measuredRpm: sample.value,
    targetRpm: governorTargetByRow.get(sample.rowIndex),
    activity: gyroActivityByRow
      ? gyroActivityByRow.get(sample.rowIndex) ?? 0
      : null
  }))
  .filter(
    (sample) =>
      Number.isFinite(sample.timeSeconds) &&
      Number.isFinite(sample.measuredRpm)
  );

const governorLabAnalysis = analyzeGovernorLab({
  timeSeconds: governorLabSamples.map(
    (sample) => sample.timeSeconds
  ),
  headspeed: governorLabSamples.map(
    (sample) => sample.measuredRpm
  ),
  governorTarget:
    governorTargetSamples.length >= 100
      ? governorLabSamples.map(
          (sample) => sample.targetRpm
        )
      : [],
  activity: gyroActivityByRow
    ? governorLabSamples.map((sample) => sample.activity)
    : []
});
      flightAnalysis = buildFlightAnalysis(
        averageEscOutput,
        profile,
        keyHeaders,
        headspeedValues,
        governorTargetValues,
        governorLabAnalysis
      );

      telemetryText =
        "KEY TELEMETRY FOUND\n" +
        "-------------------\n" +
        keyHeaders
          .map(([label, value]) => {
            return `${value ? "✓" : "✗"} ${label}: ${value || "Not found"}`;
          })
          .join("\n") +
        "\n\nCALCULATED VALUES\n" +
        "-----------------\n" +
        `Average ESC Output: ${
          averageEscOutput !== null
            ? `${(averageEscOutput / 10).toFixed(1)}%`
            : "N/A"
        }\n` +
        `Average ESC RPM: ${
          averageEscRPM !== null
            ? Math.round(averageEscRPM)
            : "N/A"
        }\n` +
        "\nALL COLUMNS\n" +
        "-----------\n" +
        headers.join("\n");
    }


    // --------------------------------------------------
    // 15B. BLACKBOX FLIGHT SUMMARY
    // --------------------------------------------------

    extraSummary = `
      File Type: ${fileType}<br>
      Craft Name: ${craftName}<br>
      Display Name: ${profile ? profile.displayName : "Unknown"}<br>
      Motor: ${profile ? profile.motor : "Unknown"}<br>
      ESC: ${profile ? profile.esc : "Unknown"}<br>
      Battery: ${profile ? profile.battery : "Unknown"}<br>
      Weight: ${profile ? `${profile.weightLb} lb` : "Unknown"}<br>
      Target ESC Output: ${profile ? profile.targetEscOutput : "Unknown"}<br>
      Firmware: ${firmware}<br>
      Firmware Revision: ${firmwareRevision}<br>
      Board: ${board}<br>
      Log Start: ${logStart}<br>
      Telemetry Header Row: ${
        telemetryHeaderIndex >= 0
          ? telemetryHeaderIndex
          : "Not found"
      }<br>
      Average ESC Output: ${
        averageEscOutput !== null
          ? `${(averageEscOutput / 10).toFixed(1)}%`
          : "N/A"
      }<br>
      Average ESC RPM: ${
        averageEscRPM !== null
          ? Math.round(averageEscRPM)
          : "N/A"
      }<br>

      <br>
      <strong>INTELLIGENT FLIGHT ANALYSIS</strong><br>

      Overall Flight Score: ${
        flightAnalysis &&
      Number.isFinite(flightAnalysis.overallScore)
          ? `${flightAnalysis.overallScore}/100`
          : "N/A"
      }<br>

      Flight Rating: ${
        flightAnalysis
          ? flightAnalysis.rating
          : "Insufficient Data"
      }<br>

      Analysis Confidence: ${
        flightAnalysis
          ? `${flightAnalysis.confidence.label} (${flightAnalysis.confidence.score}/100)`
          : "Low"
      }<br>

      <br>
      <strong>System Scores</strong><br>

      Aircraft Profile: ${
        flightAnalysis
          ? `${flightAnalysis.profile.score}/100 — ${flightAnalysis.profile.status}`
          : "N/A"
      }<br>

      ESC Operating Range: ${
  flightAnalysis
    ? flightAnalysis.esc.status === "Unavailable"
      ? "N/A — Unavailable"
      : `${flightAnalysis.esc.score}/100 — ${flightAnalysis.esc.status}`
          : "N/A"
      }<br>

      Telemetry Quality: ${
        flightAnalysis
          ? `${flightAnalysis.telemetry.score}/100 — ${flightAnalysis.telemetry.status}`
          : "N/A"
      }<br>

      Governor Performance: ${
  flightAnalysis
    ? describeGovernorSystemScore(flightAnalysis.governor)
    : "N/A"
    }<br>

      <br>
      <strong>Findings</strong><br>

      ${
        flightAnalysis
          ? `✓ ${flightAnalysis.profile.finding}`
          : "✗ Aircraft profile analysis unavailable."
      }<br>

      ${
        flightAnalysis
          ? `${
              flightAnalysis.esc.severity === "warning"
                ? "⚠"
                : flightAnalysis.esc.severity === "caution"
                  ? "△"
                  : "✓"
            } ${flightAnalysis.esc.finding}`
          : "✗ ESC analysis unavailable."
      }<br>

      ${
        flightAnalysis
          ? `✓ ${flightAnalysis.telemetry.finding}`
          : "✗ Telemetry analysis unavailable."
      }<br>

      ${
        flightAnalysis
          ? `${
              flightAnalysis.governor.score > 0 ||
              (flightAnalysis.governor.capability === "partial" &&
                flightAnalysis.governor.status === "good")
                ? "✓"
                : flightAnalysis.governor.capability === "partial"
                  ? "△"
                  : "⚠"
            } ${flightAnalysis.governor.finding}`
          : "✗ Governor analysis unavailable."
      }<br>
    `;


  // ====================================================
  // 15C. ROTORFLIGHT CLI DUMP
  // ====================================================

  } else if (fileType === "Rotorflight CLI Dump") {
    extraSummary = `
      File Type: ${fileType}<br>
      Status: Settings file detected<br>
      Settings belong to a helicopter rather than to a flight: open the
      flight they go with, then add this file from the model card on
      Home. Names and identifiers are removed before anything is kept.
    `;


  // ====================================================
  // 15D. CSV TELEMETRY EXPORT
  // ====================================================

  } else if (fileType === "CSV Telemetry Export") {
  const csvHeaderIndex = lines.findIndex((line) => {
  const lower = String(line).toLowerCase();

  return (
    lower.includes("headspeed") &&
    lower.includes("setpoint") &&
    (lower.includes("motor[0]") || lower.includes("escthr"))
  );
});

const csvHeaderLine =
  csvHeaderIndex >= 0
    ? lines[csvHeaderIndex]
    : lines[0] || "";

const delimiter =
  (csvHeaderLine.match(/;/g) || []).length >
  (csvHeaderLine.match(/,/g) || []).length
    ? ";"
    : ",";

const headers = csvHeaderLine
  .split(delimiter)
  .map((header) => header.trim());

    const headspeedColumn = findHeader(
      headers,
      ["headspeed", "rpm"]
    );

    const voltageColumn = findHeader(
      headers,
      ["vbat", "escv", "voltage", "pack voltage", "battery voltage"]
    );

    const escColumn = findHeader(
      headers,
      ["esc", "throttle", "motor"]
    );

    telemetryText = headers.join("\n");

    extraSummary = `
      File Type: ${fileType}<br>
      Columns: ${headers.length}<br>
      Headspeed Column: ${headspeedColumn || "Not found"}<br>
      Voltage Column: ${voltageColumn || "Not found"}<br>
      ESC/Motor Column: ${escColumn || "Not found"}<br>
    `;


  // ====================================================
  // 15E. UNKNOWN FILE
  // ====================================================

  } else {
    extraSummary = `
      File Type: ${fileType}<br>
      Status: Blackbox Lab does not recognize this file yet.
    `;
  }
  
    return {
  extraSummary,
  telemetryText,
  analysisContext,
  filterAnalysis,
  pidAnalysis,
  filterAnalysisSummaryFindings: filterAnalysis?.summaryFindings ?? []
  };
  }