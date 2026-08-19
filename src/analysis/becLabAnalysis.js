// ======================================================
// BLACKBOX LAB — BEC LAB ANALYSIS
// ======================================================
//
// "Did the receiver and servos receive stable, reliable
// power throughout this flight?"
//
// The reference voltage is this flight's OWN median — a
// system deliberately running 6.0 V is never judged
// against one running 8.4 V, and the lab never guesses
// what the pilot intended. Events are whole excursions
// (depth AND duration AND repetition), not single
// samples. Brownout language appears only near the
// absolute floor where receivers genuinely die, and a
// dip is read WITH its servo-demand context: voltage
// following a hard collective pump is load response;
// voltage sagging with the servos quiet points at
// wiring, connectors or the BEC itself.
//
// ======================================================

import {
  detectInFlightSamples,
  estimateSampleRate,
  buildRollingMean
} from "./flightPhase.js";

export const BEC_LAB_TUNING = {
  // Event bands, relative to the flight's own median voltage.
  DIP_ENTER_SHARE: 0.95,
  DIP_DEEP_SHARE: 0.88,
  // Absolute territory where receivers/servos genuinely brown
  // out — the only absolute number here, deliberately below any
  // sane BEC setting (5.0/6.0/7.4/8.4 V systems all clear it).
  BROWNOUT_TERRITORY_VOLTS: 4.5,
  MINIMUM_EVENT_SECONDS: 0.05,
  SUSTAINED_EVENT_SECONDS: 0.3,
  MERGE_GAP_SECONDS: 0.4,
  SMOOTHING_SECONDS: 0.1,
  REPEATED_EVENTS: 3,
  MAXIMUM_EVENTS: 16,
  // Servo-demand context: an event overlapping the flight's top
  // quartile of servo activity is load-driven.
  HIGH_DEMAND_QUANTILE: 0.75
};

function columnCarriesData(values) {
  if (!Array.isArray(values)) return false;
  let first = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (first === null) {
      first = value;
    } else if (value !== first) {
      return true;
    }
  }
  return false;
}

// Rotorflight logs Vbec in centivolts; other sources may log
// volts. Normalize by magnitude, never by assumption about the
// intended setting.
function toVolts(value, scale) {
  return Number.isFinite(value) ? value / scale : null;
}

function resolveScale(medianRaw) {
  if (!Number.isFinite(medianRaw)) return 1;
  if (medianRaw > 100) return 100;
  if (medianRaw > 20) return 10;
  return 1;
}

// A perfectly steady BEC logs a CONSTANT column — that is the
// good result, not a dead sensor. A column is dead only when it
// is absent, all-zero, or pinned at a value that cannot be a
// receiver voltage on any scale (the 25500 "no sensor" sentinel
// reads as 255 V).
function usableVoltageColumn(values) {
  if (columnCarriesData(values)) {
    return true;
  }

  const first = (values ?? []).find((value) =>
    Number.isFinite(value)
  );

  if (!Number.isFinite(first) || first <= 0) {
    return false;
  }

  const volts = first / resolveScale(first);
  return volts >= 3 && volts <= 13;
}

export function analyzeBecLab({
  timeSeconds,
  vbec,
  servos = [],
  headspeed,
  // From the Signal Lab when available: did the receiver keep
  // reporting a healthy link the whole flight? A voltage trace
  // that "browns out" while the receiver demonstrably kept
  // flying is a measurement-path story, not a power-loss story
  // — a real supply collapse trips failsafe.
  receiverStayedAlive = null
} = {}) {
  if (!usableVoltageColumn(vbec)) {
    return null;
  }

  const tuning = BEC_LAB_TUNING;
  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;

  const airborne =
    detectInFlightSamples({ timeSeconds, headspeed }) ??
    timeSeconds.map((_, index) => index);

  if (airborne.length < 100) {
    return null;
  }

  const smoothingSamples = Math.max(
    3,
    Math.round(tuning.SMOOTHING_SECONDS * sampleRate)
  );
  const smoothedRaw = buildRollingMean(vbec, smoothingSamples);

  const airborneRaw = airborne
    .map((index) => Number(smoothedRaw[index]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (airborneRaw.length < 100) {
    return null;
  }

  const quantileRaw = (q) =>
    airborneRaw[
      Math.min(airborneRaw.length - 1, Math.floor(airborneRaw.length * q))
    ];

  const medianRaw = quantileRaw(0.5);
  const scale = resolveScale(medianRaw);

  const referenceVolts = toVolts(medianRaw, scale);
  const minimumVolts = toVolts(airborneRaw[0], scale);
  const maximumVolts = toVolts(airborneRaw[airborneRaw.length - 1], scale);
  const spreadVolts =
    toVolts(quantileRaw(0.95), scale) - toVolts(quantileRaw(0.05), scale);

  // ---- servo-demand trace for event context ----
  const activityWindow = Math.max(3, Math.round(sampleRate * 0.2));
  let servoActivity = null;
  let highDemandBar = null;

  const liveServos = (servos ?? []).filter((servo) =>
    columnCarriesData(servo?.values)
  );

  if (liveServos.length > 0) {
    const raw = new Array(timeSeconds.length).fill(0);

    for (const servo of liveServos) {
      const values = servo.values;
      for (let i = 1; i < values.length; i += 1) {
        const a = Number(values[i]);
        const b = Number(values[i - 1]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          raw[i] += Math.abs(a - b);
        }
      }
    }

    servoActivity = buildRollingMean(raw, activityWindow);

    const airborneActivity = airborne
      .map((index) => Number(servoActivity[index]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (airborneActivity.length >= 100) {
      highDemandBar =
        airborneActivity[
          Math.floor(
            airborneActivity.length * tuning.HIGH_DEMAND_QUANTILE
          )
        ];
    } else {
      servoActivity = null;
    }
  }

  // ---- dip events ----
  const enterRaw = medianRaw * tuning.DIP_ENTER_SHARE;
  const deepRaw = medianRaw * tuning.DIP_DEEP_SHARE;
  const minimumEventSamples = Math.max(
    2,
    Math.round(tuning.MINIMUM_EVENT_SECONDS * sampleRate)
  );

  const runs = [];
  let runStart = null;
  let previous = null;

  for (const index of airborne) {
    const value = Number(smoothedRaw[index]);
    const inDip = Number.isFinite(value) && value < enterRaw;
    const continuous = previous !== null && index === previous + 1;

    if (inDip && (runStart === null || !continuous)) {
      if (runStart !== null) {
        runs.push({ startIndex: runStart, endIndex: previous });
      }
      runStart = index;
    } else if (!inDip && runStart !== null) {
      runs.push({ startIndex: runStart, endIndex: previous });
      runStart = null;
    }

    previous = index;
  }
  if (runStart !== null) {
    runs.push({ startIndex: runStart, endIndex: previous });
  }

  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      (timeSeconds[run.startIndex] ?? 0) -
        (timeSeconds[last.endIndex] ?? 0) <=
        tuning.MERGE_GAP_SECONDS
    ) {
      last.endIndex = run.endIndex;
    } else {
      merged.push({ ...run });
    }
  }

  const events = [];
  let sustainedCount = 0;
  let transientCount = 0;
  let brownoutTerritory = false;

  for (const run of merged) {
    if (run.endIndex - run.startIndex + 1 < minimumEventSamples) {
      continue;
    }

    let lowestRaw = Infinity;
    let lowestIndex = run.startIndex;

    for (let i = run.startIndex; i <= run.endIndex; i += 1) {
      const value = Number(smoothedRaw[i]);
      if (Number.isFinite(value) && value < lowestRaw) {
        lowestRaw = value;
        lowestIndex = i;
      }
    }

    const durationSeconds =
      (timeSeconds[run.endIndex] ?? 0) -
      (timeSeconds[run.startIndex] ?? 0);

    const sustained =
      durationSeconds >= tuning.SUSTAINED_EVENT_SECONDS;
    const deep = lowestRaw < deepRaw;
    const lowestVolts = toVolts(lowestRaw, scale);

    if (
      Number.isFinite(lowestVolts) &&
      lowestVolts < tuning.BROWNOUT_TERRITORY_VOLTS
    ) {
      brownoutTerritory = true;
    }

    if (sustained) {
      sustainedCount += 1;
    } else {
      transientCount += 1;
    }

    // Servo-demand context at the dip.
    let demandContext = null;
    if (servoActivity && highDemandBar !== null) {
      const activityAtDip = Number(servoActivity[lowestIndex]);
      // A near-zero demand bar means the servos barely moved all
      // flight — then NOTHING qualifies as high demand, rather
      // than everything.
      demandContext =
        Number.isFinite(activityAtDip) &&
        highDemandBar > 0 &&
        activityAtDip >= highDemandBar
          ? "high-demand"
          : "quiet";
    }

    events.push({
      kind: deep ? "deep-dip" : "dip",
      sustained,
      demandContext,
      startSeconds: timeSeconds[run.startIndex],
      endSeconds: timeSeconds[run.endIndex],
      durationMs: Math.round(durationSeconds * 1000),
      lowestVolts:
        Math.round(lowestVolts * 100) / 100,
      depthPercent:
        Math.round(
          ((medianRaw - lowestRaw) / medianRaw) * 1000
        ) / 10,
      detail:
        `Voltage fell to ${lowestVolts.toFixed(2)} V (${(((medianRaw - lowestRaw) / medianRaw) * 100).toFixed(1)}% below this flight's ${referenceVolts.toFixed(2)} V median) for ${Math.round(durationSeconds * 1000)} ms` +
        (demandContext === "high-demand"
          ? ", during high servo demand, consistent with load."
          : demandContext === "quiet"
            ? ", with the servos comparatively quiet, which points away from simple load."
            : ".")
    });
  }

  events.sort((a, b) => a.startSeconds - b.startSeconds);
  const cappedEvents = events.slice(0, tuning.MAXIMUM_EVENTS);

  const dipCount = sustainedCount + transientCount;
  const worst = events.reduce(
    (best, event) =>
      best === null || event.depthPercent > best.depthPercent
        ? event
        : best,
    null
  );

  // ---- verdict ----
  const implausibleBrownout =
    brownoutTerritory && receiverStayedAlive === true;

  const status = brownoutTerritory
    ? implausibleBrownout
      ? "watch"
      : "attention"
    : sustainedCount > 0 || dipCount >= tuning.REPEATED_EVENTS
      ? "attention"
      : dipCount > 0
        ? "watch"
        : "good";

  const quietDips = events.filter(
    (event) => event.demandContext === "quiet"
  ).length;

  const story = brownoutTerritory
    ? implausibleBrownout
      ? `The voltage reading dropped into brownout territory (below ${tuning.BROWNOUT_TERRITORY_VOLTS.toFixed(1)} V). Yet the receiver kept reporting a healthy link the whole time, and a real supply collapse trips failsafe.\n\nThat points at the measurement path (the voltage sensor, its wiring or connector) rather than an actual receiver power loss. Worth a physical inspection of that path; do not replace the BEC on this evidence alone.`
      : `Receiver power entered genuine brownout territory (below ${tuning.BROWNOUT_TERRITORY_VOLTS.toFixed(1)} V): that is where receivers and servos actually let go.\n\nReview the whole receiver power path before the next flight: BEC setting and capability, wiring, connectors, and whether servo load or binding drove the demand.`
    : sustainedCount > 0
      ? `Receiver voltage stayed low for an extended stretch ${sustainedCount === 1 ? "once" : `${sustainedCount} times`}: longer than a load transient should last. ${quietDips > 0 ? "At least one dip happened with the servos comparatively quiet, which points at wiring, connectors or the BEC rather than load. " : "The dips line up with servo demand, so start with servo load and mechanical binding. "}The events below name each moment.`
      : dipCount >= tuning.REPEATED_EVENTS
        ? `Receiver voltage dipped ${dipCount} times this flight. Each recovered, but repetition is the pattern that matters with power: review the events below and check connectors, wiring and servo load before it grows.`
        : dipCount > 0
          ? `${dipCount === 1 ? "One brief" : `${dipCount} brief`} voltage dip${dipCount === 1 ? "" : "s"}, recovered normally: ${quietDips === 0 ? "in step with servo demand, which is a power system doing its job under load." : "worth a glance at the event context below."} Nothing here suggests an unstable supply.`
          : `Receiver power held steady across the analyzed in-flight window: ${referenceVolts.toFixed(2)} V typical, never below ${minimumVolts.toFixed(2)} V, total variation ${(spreadVolts >= 0 ? spreadVolts : 0).toFixed(2)} V. This is what a healthy BEC looks like. (Startup and shutdown samples sit outside this window: the chart may show lower readings there.)`;

  const metrics = [
    {
      label: "Typical voltage (this flight's median)",
      value: `${referenceVolts.toFixed(2)} V`
    },
    {
      label: "Range in flight",
      value: `${minimumVolts.toFixed(2)} – ${maximumVolts.toFixed(2)} V`
    },
    {
      label: "Stability (5th–95th percentile spread)",
      value: `${(spreadVolts >= 0 ? spreadVolts : 0).toFixed(2)} V`
    },
    {
      label: "Voltage dips",
      value: `${dipCount}${sustainedCount > 0 ? ` (${sustainedCount} sustained)` : ""}`
    },
    ...(worst
      ? [
          {
            label: "Worst event",
            value: `${worst.lowestVolts.toFixed(2)} V (${worst.depthPercent.toFixed(1)}%) for ${worst.durationMs} ms at ${worst.startSeconds.toFixed(1)} s`
          }
        ]
      : [])
  ];

  const findings = [
    "The reference is this flight's own median voltage: a system deliberately running 6.0 V is never judged against one running 8.4 V.",
    "Events are judged by depth, duration and repetition together, never by a single lowest sample."
  ];

  if (servoActivity === null) {
    findings.push(
      "No usable servo data in this log, so dips could not be read against servo demand."
    );
  }

  return {
    status,
    capability: "full",
    story,
    metrics,
    events: cappedEvents,
    counts: {
      dips: dipCount,
      sustained: sustainedCount,
      transient: transientCount,
      quietContext: quietDips
    },
    referenceVolts,
    minimumVolts,
    maximumVolts,
    brownoutTerritory,
    implausibleBrownout,
    scale,
    findings
  };
}

// ------------------------------------------------------
// Cross-lab correlation: when a link event and a power
// event overlap in time, each lab points at the other —
// correlation named, causation never claimed.
// ------------------------------------------------------
export function correlateSignalAndPower(signalResult, becResult) {
  if (!signalResult?.events?.length || !becResult?.events?.length) {
    return null;
  }

  const overlaps = [];

  for (const signalEvent of signalResult.events) {
    for (const becEvent of becResult.events) {
      const start = Math.max(
        signalEvent.startSeconds,
        becEvent.startSeconds
      );
      const end = Math.min(
        signalEvent.endSeconds + 0.5,
        becEvent.endSeconds + 0.5
      );

      if (end >= start) {
        overlaps.push({
          atSeconds: Math.round(start * 10) / 10,
          signalKind: signalEvent.kind,
          becKind: becEvent.kind
        });
      }
    }
  }

  if (overlaps.length === 0) {
    return null;
  }

  const at = overlaps
    .slice(0, 3)
    .map((overlap) => `${overlap.atSeconds.toFixed(1)} s`)
    .join(", ");

  return {
    overlaps,
    signalSentence: ` A receiver-power event occurred at the same time (${at}). Review the BEC Lab for the other half of this story.`,
    becSentence: ` A link event occurred at the same time (${at}). Review the Signal Lab for the other half of this story.`
  };
}
