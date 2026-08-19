// ======================================================
// BLACKBOX LAB — SIGNAL LAB ANALYSIS
// ======================================================
//
// "Was the radio link healthy and reliable throughout
// this flight?"
//
// Everything here is read the way the flight controller
// saw it: the logged rssi column is the control link's
// strength AS RECEIVED, and the slow-frame flags
// (failsafePhase, rxSignalReceived, rxFlightChannelsValid)
// are the firmware's own account of link state. Protocols
// scale rssi differently, so no absolute threshold is ever
// applied — degradation is measured against this flight's
// OWN typical level, and only the firmware's flags speak
// with authority about loss of control.
//
// What the log cannot say, the lab does not say: missing
// fields report Not Evaluated, and telemetry-only trouble
// is never claimed as control loss.
//
// ======================================================

import {
  detectInFlightSamples,
  estimateSampleRate,
  buildRollingMean
} from "./flightPhase.js";

export const SIGNAL_LAB_TUNING = {
  // Degradation is relative to the flight's own median level.
  DEGRADED_SHARE_OF_TYPICAL: 0.7,
  DEEP_SHARE_OF_TYPICAL: 0.4,
  // A dip must persist to be an event — single-sample flickers
  // are reporting noise, not radio behavior.
  MINIMUM_EVENT_SECONDS: 0.2,
  MERGE_GAP_SECONDS: 0.5,
  SMOOTHING_SECONDS: 0.25,
  MAXIMUM_EVENTS: 16,
  // Verdict weights: firmware flags outrank any rssi read.
  DEEP_EVENTS_FOR_ATTENTION: 2,
  DEGRADED_EVENTS_FOR_WATCH: 1
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

// Contiguous runs of a predicate over a set of indexes that are
// consecutive in the source arrays. Returns [{startIndex, endIndex}].
function findRuns(indexes, predicate) {
  const runs = [];
  let start = null;
  let previous = null;

  for (const index of indexes) {
    const hit = predicate(index);
    const continuous = previous !== null && index === previous + 1;

    if (hit && (start === null || !continuous)) {
      if (start !== null) {
        runs.push({ startIndex: start, endIndex: previous });
      }
      start = index;
    } else if (!hit && start !== null) {
      runs.push({ startIndex: start, endIndex: previous });
      start = null;
    }

    previous = index;
  }

  if (start !== null) {
    runs.push({ startIndex: start, endIndex: previous });
  }

  return runs;
}

export function analyzeSignalLab({
  timeSeconds,
  rssi,
  failsafePhase,
  rxSignalReceived,
  rxFlightChannelsValid,
  headspeed
} = {}) {
  const hasRssi = columnCarriesData(rssi);
  const hasFlags =
    Array.isArray(failsafePhase) ||
    Array.isArray(rxSignalReceived) ||
    Array.isArray(rxFlightChannelsValid);

  if (!hasRssi && !hasFlags) {
    return null;
  }

  const tuning = SIGNAL_LAB_TUNING;
  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;

  const airborne =
    detectInFlightSamples({ timeSeconds, headspeed }) ??
    timeSeconds.map((_, index) => index);

  if (airborne.length < 100) {
    return null;
  }

  const seconds = (startIndex, endIndex) =>
    Math.max(
      0,
      (timeSeconds[endIndex] ?? 0) - (timeSeconds[startIndex] ?? 0)
    );

  const mergeRuns = (runs) => {
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
    return merged;
  };

  const events = [];
  const metrics = [];
  const findings = [];

  // ---- the firmware's own account: failsafe + rx flags ----
  let failsafeEventCount = 0;
  let linkLossEventCount = 0;

  if (Array.isArray(failsafePhase)) {
    const runs = mergeRuns(
      findRuns(airborne, (index) => Number(failsafePhase[index]) > 0)
    );

    for (const run of runs) {
      failsafeEventCount += 1;
      events.push({
        kind: "failsafe",
        startSeconds: timeSeconds[run.startIndex],
        endSeconds: timeSeconds[run.endIndex],
        durationMs: Math.round(seconds(run.startIndex, run.endIndex) * 1000),
        detail: "Firmware entered failsafe: the control link was lost long enough for the failsafe stage to engage."
      });
    }
  }

  const lossFlags = [
    { values: rxSignalReceived, label: "no signal received" },
    { values: rxFlightChannelsValid, label: "flight channels invalid" }
  ];

  for (const flag of lossFlags) {
    if (!Array.isArray(flag.values)) continue;
    if (!columnCarriesData(flag.values) && Number(flag.values[airborne[0]]) === 1) {
      // Constant healthy all flight — nothing to report, and that
      // IS the good result.
      continue;
    }

    const runs = mergeRuns(
      findRuns(airborne, (index) => {
        const value = Number(flag.values[index]);
        return Number.isFinite(value) && value === 0;
      })
    ).filter(
      (run) => seconds(run.startIndex, run.endIndex) >= 0.05
    );

    for (const run of runs) {
      linkLossEventCount += 1;
      events.push({
        kind: "link-loss",
        startSeconds: timeSeconds[run.startIndex],
        endSeconds: timeSeconds[run.endIndex],
        durationMs: Math.round(seconds(run.startIndex, run.endIndex) * 1000),
        detail: `Receiver reported ${flag.label}.`
      });
    }
  }

  // ---- rssi: this flight's own level as the yardstick ----
  let typicalRssi = null;
  let minimumRssi = null;
  let degradedEventCount = 0;
  let deepEventCount = 0;
  let capability = hasRssi ? "full" : "flags-only";

  if (hasRssi) {
    const smoothingSamples = Math.max(
      3,
      Math.round(tuning.SMOOTHING_SECONDS * sampleRate)
    );
    const smoothed = buildRollingMean(rssi, smoothingSamples);

    const airborneValues = airborne
      .map((index) => Number(smoothed[index]))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (airborneValues.length >= 100) {
      typicalRssi =
        airborneValues[Math.floor(airborneValues.length / 2)];
      minimumRssi = airborneValues[0];

      const minimumEventSamples = Math.max(
        3,
        Math.round(tuning.MINIMUM_EVENT_SECONDS * sampleRate)
      );

      const degradedRuns = mergeRuns(
        findRuns(airborne, (index) => {
          const value = Number(smoothed[index]);
          return (
            Number.isFinite(value) &&
            typicalRssi > 0 &&
            value < typicalRssi * tuning.DEGRADED_SHARE_OF_TYPICAL
          );
        })
      ).filter(
        (run) =>
          run.endIndex - run.startIndex + 1 >= minimumEventSamples
      );

      for (const run of degradedRuns) {
        let lowest = Infinity;
        for (let i = run.startIndex; i <= run.endIndex; i += 1) {
          const value = Number(smoothed[i]);
          if (Number.isFinite(value) && value < lowest) lowest = value;
        }

        const deep =
          typicalRssi > 0 &&
          lowest < typicalRssi * tuning.DEEP_SHARE_OF_TYPICAL;

        if (deep) {
          deepEventCount += 1;
        } else {
          degradedEventCount += 1;
        }

        events.push({
          kind: deep ? "deep-degradation" : "degradation",
          startSeconds: timeSeconds[run.startIndex],
          endSeconds: timeSeconds[run.endIndex],
          durationMs: Math.round(
            seconds(run.startIndex, run.endIndex) * 1000
          ),
          detail: `Signal fell to ${Math.round(lowest)} (typical for this flight: ${Math.round(typicalRssi)})${deep ? ", a deep dip" : ""}, then recovered.`
        });
      }
    } else {
      capability = "flags-only";
    }
  }

  events.sort((a, b) => a.startSeconds - b.startSeconds);
  const cappedEvents = events.slice(0, tuning.MAXIMUM_EVENTS);

  // ---- verdict: flags outrank rssi ----
  const status =
    failsafeEventCount > 0 || linkLossEventCount > 0
      ? "attention"
      : deepEventCount >= tuning.DEEP_EVENTS_FOR_ATTENTION
        ? "attention"
        : deepEventCount > 0 ||
            degradedEventCount >= tuning.DEGRADED_EVENTS_FOR_WATCH
          ? "watch"
          : "good";

  // ---- metrics: only what the log actually carries ----
  if (typicalRssi !== null) {
    metrics.push({
      label: "Typical link strength (as logged)",
      value: `${Math.round(typicalRssi)}`
    });
    metrics.push({
      label: "Weakest moment (as logged)",
      value: `${Math.round(minimumRssi)}`
    });
  } else {
    metrics.push({
      label: "Link strength",
      value: "Not logged. Link state read from receiver flags only"
    });
  }

  metrics.push({
    label: "Failsafe events",
    value: Array.isArray(failsafePhase)
      ? String(failsafeEventCount)
      : "Not logged"
  });

  metrics.push({
    label: "Link-loss indications",
    value:
      Array.isArray(rxSignalReceived) ||
      Array.isArray(rxFlightChannelsValid)
        ? String(linkLossEventCount)
        : "Not logged"
  });

  if (typicalRssi !== null) {
    metrics.push({
      label: "Signal dips (relative to this flight)",
      value: `${degradedEventCount + deepEventCount}${deepEventCount > 0 ? ` (${deepEventCount} deep)` : ""}`
    });
  }

  // ---- the story ----
  const story =
    failsafeEventCount > 0
      ? `The firmware entered failsafe ${failsafeEventCount === 1 ? "once" : `${failsafeEventCount} times`} in flight: the control link was genuinely interrupted. Review the event times below and check receiver antenna placement, orientation and condition before the next flight.`
      : linkLossEventCount > 0
        ? `The receiver reported ${linkLossEventCount === 1 ? "a moment" : `${linkLossEventCount} moments`} of lost or invalid signal. The flight continued, but this is the firmware's own account of the link: worth reviewing antennas, wiring and receiver placement.`
        : deepEventCount > 0
          ? `The link held, but it dipped deeply ${deepEventCount === 1 ? "once" : `${deepEventCount} times`} relative to this flight's typical level. One deep dip can be orientation shading; repeated dips point at antenna placement or damage.`
          : degradedEventCount > 0
            ? `Signal strength dipped briefly ${degradedEventCount === 1 ? "once" : `${degradedEventCount} times`} but stayed clear of trouble and the receiver never reported a problem: normal for orientation changes at range.`
            : capability === "flags-only"
              ? "No signal-strength telemetry was logged, but the receiver's own flags stayed healthy the whole flight: no failsafe, no invalid-signal moments."
              : "The link stayed strong and steady the whole flight: no failsafe, no loss indications, no meaningful dips below this flight's own typical level.";

  if (typicalRssi !== null) {
    findings.push(
      "Signal readings are compared against this flight's own typical level, never against absolute thresholds: different receivers and protocols scale these numbers differently."
    );
  }
  findings.push(
    "A telemetry interruption is never read as loss of control: only the receiver's own failsafe and signal flags speak for the control link."
  );

  return {
    status,
    capability,
    story,
    metrics,
    events: cappedEvents,
    counts: {
      failsafe: failsafeEventCount,
      linkLoss: linkLossEventCount,
      degraded: degradedEventCount,
      deep: deepEventCount
    },
    typicalRssi,
    minimumRssi,
    findings
  };
}
