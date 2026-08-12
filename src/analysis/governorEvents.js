// ======================================================
// BLACKBOX LAB — GOVERNOR EVENTS
// ======================================================
//
// The Governor Lab's event layer: every sustained moment
// the rotor ran meaningfully UNDER or OVER its governed
// target, packaged the way stick commands already are on
// the PID page — when it happened, how far it went, and
// what the machine was doing at the time.
//
// This module MEASURES (the flight-events module only
// repackages what the PID analysis found; nothing existed
// that watched headspeed error in both directions). It
// deliberately measures the same signal the Governor Lab
// verdict scores — the tracking error smoothed over a
// quarter second, in-flight samples only — so an event can
// never contradict the droop number beside it.
//
// Events DESCRIBE; they do not advise. Directional tuning
// suggestions are the recommendation layer's job, gated by
// its own evidence rules.
//
// ======================================================

import {
  buildRollingMean,
  estimateSampleRate,
  detectInFlightSamples
} from "./flightPhase.js";

// Fleet-calibrated 2026-08-12 (247 contributed flights, 146 with a
// usable governor target, five candidate bands probed): at 6%/3%
// the MEDIAN governed machine reads zero events and the 90th
// percentile reads 7, while 6–7% excursions — the kind pilots
// actually ask about — stay visible. The band also lines up with
// the fleet's stable-droop p90 (6.44%) and the lab's 6.5%
// "attention" threshold: an event is an excursion worse than nine
// out of ten machines' ordinary droop. Hysteresis keeps one
// wobbling excursion from counting as five.
export const GOVERNOR_EVENT_TUNING = {
  ENTER_ERROR_PERCENT: 6,
  EXIT_ERROR_PERCENT: 3,
  MINIMUM_DURATION_SECONDS: 0.35,
  MERGE_GAP_SECONDS: 0.6,
  POWER_LIMIT_OUTPUT_PERCENT: 95,
  COLLECTIVE_LOOKBACK_SECONDS: 0.8,
  COLLECTIVE_MOVE_FRACTION_OF_RANGE: 0.15,
  HUNTING_WINDOW_SECONDS: 2,
  HUNTING_MINIMUM_CROSSINGS: 3,
  HUNTING_AMPLITUDE_PERCENT: 1.5,
  MAXIMUM_EVENTS: 24
};

// Same full-scale inference the Governor Lab verdict uses for
// its worst-dip output reading — one rule, two readers.
function toOutputPercentSeries(motorOutput) {
  if (!Array.isArray(motorOutput) || motorOutput.length === 0) {
    return null;
  }

  let outputMax = 0;

  for (const value of motorOutput) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue) && numericValue > outputMax) {
      outputMax = numericValue;
    }
  }

  if (outputMax <= 0) {
    return null;
  }

  const fullScale =
    outputMax > 1100 ? 2000 : outputMax > 100 ? 1000 : 100;

  return motorOutput.map((value) => {
    const numericValue = Number(value);

    return Number.isFinite(numericValue)
      ? (numericValue / fullScale) * 100
      : null;
  });
}

function maxFiniteInWindow(values, startIndex, endIndex) {
  if (!Array.isArray(values)) {
    return null;
  }

  let maximum = null;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = Number(values[index]);

    if (Number.isFinite(value) && (maximum === null || value > maximum)) {
      maximum = value;
    }
  }

  return maximum;
}

// The collective move leading INTO an event, read scale-free:
// the log's own collective range sets what counts as "a real
// move", so degrees, microseconds and normalized units all
// work without unit knowledge.
function collectiveMoveBefore({
  collective,
  timeSeconds,
  startIndex,
  lookbackSeconds,
  moveThreshold
}) {
  if (!Array.isArray(collective) || moveThreshold === null) {
    return "unknown";
  }

  const startTime = Number(timeSeconds[startIndex]);

  if (!Number.isFinite(startTime)) {
    return "unknown";
  }

  let lookbackIndex = startIndex;

  while (
    lookbackIndex > 0 &&
    Number.isFinite(Number(timeSeconds[lookbackIndex - 1])) &&
    startTime - Number(timeSeconds[lookbackIndex - 1]) <= lookbackSeconds
  ) {
    lookbackIndex -= 1;
  }

  const atStart = Number(collective[startIndex]);
  const atLookback = Number(collective[lookbackIndex]);

  if (!Number.isFinite(atStart) || !Number.isFinite(atLookback)) {
    return "unknown";
  }

  const delta = atStart - atLookback;

  if (delta >= moveThreshold) {
    return "rise";
  }

  if (delta <= -moveThreshold) {
    return "drop";
  }

  return "steady";
}

// Post-event hunting: the smoothed error re-crossing zero with
// real amplitude after the excursion ended — the rotor circling
// its target instead of returning to it.
function detectHunting({
  smoothedErrorPercent,
  timeSeconds,
  endIndex,
  tuning
}) {
  const endTime = Number(timeSeconds[endIndex]);

  if (!Number.isFinite(endTime)) {
    return false;
  }

  let crossings = 0;
  let lastSign = 0;
  let armed = false;

  for (
    let index = endIndex + 1;
    index < smoothedErrorPercent.length;
    index += 1
  ) {
    const time = Number(timeSeconds[index]);

    if (
      Number.isFinite(time) &&
      time - endTime > tuning.HUNTING_WINDOW_SECONDS
    ) {
      break;
    }

    const value = smoothedErrorPercent[index];

    if (!Number.isFinite(value)) {
      continue;
    }

    // A crossing only counts once the error has shown real
    // amplitude on its current side — sensor ripple around
    // zero is not hunting.
    if (Math.abs(value) >= tuning.HUNTING_AMPLITUDE_PERCENT) {
      armed = true;
    }

    const sign = value > 0 ? 1 : value < 0 ? -1 : 0;

    if (sign !== 0 && lastSign !== 0 && sign !== lastSign && armed) {
      crossings += 1;
      armed = false;
    }

    if (sign !== 0) {
      lastSign = sign;
    }
  }

  return crossings >= tuning.HUNTING_MINIMUM_CROSSINGS;
}

function classifyEvent({ kind, outputMaxPercent, collectiveBefore, tuning }) {
  if (kind === "under") {
    if (
      Number.isFinite(outputMaxPercent) &&
      outputMaxPercent >= tuning.POWER_LIMIT_OUTPUT_PERCENT
    ) {
      return "power-limit";
    }

    if (collectiveBefore === "rise") {
      return "load";
    }

    return "unexplained";
  }

  if (collectiveBefore === "drop") {
    return "collective-drop";
  }

  return "unexplained";
}

function eventStory(event) {
  const direction = event.kind === "under" ? "below" : "above";

  const core =
    `The rotor ran ${Math.round(event.peakErrorRpm)} rpm ` +
    `(${event.peakErrorPercent.toFixed(1)}%) ${direction} its ` +
    `${Math.round(event.targetRpm)} rpm target for ` +
    `${(event.durationMs / 1000).toFixed(1)} s.`;

  const cause =
    event.cause === "power-limit"
      ? " The motor output was at its ceiling — the power system had nothing left to give here, whatever the governor asked. See the ESC Lab."
      : event.cause === "load"
        ? " It followed a collective increase — the load arrived faster than the drive could answer."
        : event.cause === "collective-drop"
          ? " It followed a sharp collective drop — the drive kept pushing power the load no longer needed, which is where governor feedforward/precomp does its work."
          : event.kind === "under"
            ? " No collective move or output ceiling explains it from this log alone."
            : " No preceding collective drop explains it from this log alone.";

  const hunting = event.hunting
    ? " Afterwards the headspeed circled its target instead of returning to it — watch the error trace hunting around zero."
    : "";

  return core + cause + hunting;
}

/**
 * Detect sustained over/under-target excursions of a governed
 * rotor. Arrays are row-aligned with the flight timeline (the
 * same arrays the Governor Lab charts read).
 *
 * Returns { events, summary } or null when the log carries no
 * usable governor target (headspeed-only logs get steadiness
 * language elsewhere — an excursion against a target that was
 * never stated is not a measurement).
 */
export function detectGovernorEvents({
  timeSeconds,
  headspeed,
  governorTarget,
  motorOutput = null,
  collective = null,
  tuning = GOVERNOR_EVENT_TUNING
} = {}) {
  if (
    !Array.isArray(timeSeconds) ||
    !Array.isArray(headspeed) ||
    !Array.isArray(governorTarget) ||
    headspeed.length < 100
  ) {
    return null;
  }

  const hasUsableTarget = governorTarget.some(
    (value) => Number(value) > 300
  );

  if (!hasUsableTarget) {
    return null;
  }

  const inFlightIndexes = detectInFlightSamples({
    timeSeconds,
    headspeed
  });

  if (!inFlightIndexes) {
    return null;
  }

  const inFlight = new Set(inFlightIndexes);

  const sampleRate = estimateSampleRate(timeSeconds) ?? 100;
  const smoothWindow = Math.max(3, Math.round(sampleRate * 0.25));

  // Signed error, target-relative: positive = under target
  // (droop), negative = over target. Only samples with a real
  // stated target participate.
  const errorPercent = new Array(headspeed.length).fill(null);

  for (let index = 0; index < headspeed.length; index += 1) {
    const actual = Number(headspeed[index]);
    const target = Number(governorTarget[index]);

    if (
      Number.isFinite(actual) &&
      Number.isFinite(target) &&
      target > 300
    ) {
      errorPercent[index] = ((target - actual) / target) * 100;
    }
  }

  const smoothedErrorPercent = buildRollingMean(
    errorPercent,
    smoothWindow
  );

  // A moving target is a spool ramp or a deliberate bank change —
  // the rotor chasing a target that is itself travelling is not an
  // excursion. Samples where the target moves faster than 1% of
  // itself per second are excluded, with a short guard band after
  // the move so the settle onto the new bank is not charged either.
  const targetMoving = (() => {
    const smoothedTarget = buildRollingMean(
      governorTarget.map((value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 300
          ? numericValue
          : null;
      }),
      smoothWindow
    );

    const moving = new Array(smoothedTarget.length).fill(false);
    const guardSamples = Math.round(sampleRate * 1.5);
    let guardUntil = -1;

    for (let index = 1; index < smoothedTarget.length; index += 1) {
      const current = smoothedTarget[index];
      const previous = smoothedTarget[index - 1];
      const dt =
        Number(timeSeconds[index]) - Number(timeSeconds[index - 1]);

      if (
        Number.isFinite(current) &&
        Number.isFinite(previous) &&
        Number.isFinite(dt) &&
        dt > 0
      ) {
        const slopePercentPerSecond =
          (Math.abs(current - previous) / dt / current) * 100;

        if (slopePercentPerSecond > 1) {
          guardUntil = index + guardSamples;
        }
      }

      if (index <= guardUntil) {
        moving[index] = true;
      }
    }

    return moving;
  })();

  const outputPercent = toOutputPercentSeries(motorOutput);

  // The log's own collective range defines a "real" move.
  const collectiveMoveThreshold = (() => {
    if (!Array.isArray(collective)) {
      return null;
    }

    let minimum = null;
    let maximum = null;

    for (const index of inFlightIndexes) {
      const value = Number(collective[index]);

      if (!Number.isFinite(value)) {
        continue;
      }

      if (minimum === null || value < minimum) minimum = value;
      if (maximum === null || value > maximum) maximum = value;
    }

    if (minimum === null || maximum <= minimum) {
      return null;
    }

    return (
      (maximum - minimum) *
      tuning.COLLECTIVE_MOVE_FRACTION_OF_RANGE
    );
  })();

  // ---- excursion scan with hysteresis ----
  const rawEvents = [];
  let open = null;

  const closeEvent = (endIndex) => {
    if (!open) {
      return;
    }

    rawEvents.push({ ...open, endIndex });
    open = null;
  };

  for (let index = 0; index < smoothedErrorPercent.length; index += 1) {
    const value = smoothedErrorPercent[index];
    const usable =
      Number.isFinite(value) &&
      inFlight.has(index) &&
      !targetMoving[index];

    if (!usable) {
      closeEvent(index - 1);
      continue;
    }

    const sign = value > 0 ? "under" : "over";
    const magnitude = Math.abs(value);

    if (open) {
      if (magnitude < tuning.EXIT_ERROR_PERCENT || sign !== open.kind) {
        closeEvent(index - 1);
      } else if (magnitude > open.peakMagnitude) {
        open.peakMagnitude = magnitude;
        open.peakIndex = index;
      }
    }

    if (!open && magnitude >= tuning.ENTER_ERROR_PERCENT) {
      open = {
        kind: sign,
        startIndex: index,
        peakIndex: index,
        peakMagnitude: magnitude
      };
    }
  }

  closeEvent(smoothedErrorPercent.length - 1);

  // Merge same-direction neighbours separated by less than the
  // merge gap — one excursion that briefly touched the exit
  // band, not two events.
  const merged = [];

  for (const event of rawEvents) {
    const previous = merged[merged.length - 1];

    const gapSeconds =
      previous &&
      Number.isFinite(Number(timeSeconds[event.startIndex])) &&
      Number.isFinite(Number(timeSeconds[previous.endIndex]))
        ? Number(timeSeconds[event.startIndex]) -
          Number(timeSeconds[previous.endIndex])
        : null;

    if (
      previous &&
      previous.kind === event.kind &&
      Number.isFinite(gapSeconds) &&
      gapSeconds >= 0 &&
      gapSeconds < tuning.MERGE_GAP_SECONDS
    ) {
      previous.endIndex = event.endIndex;

      if (event.peakMagnitude > previous.peakMagnitude) {
        previous.peakMagnitude = event.peakMagnitude;
        previous.peakIndex = event.peakIndex;
      }
    } else {
      merged.push({ ...event });
    }
  }

  // ---- qualify, contextualize, classify ----
  const qualified = [];

  for (const event of merged) {
    const startTime = Number(timeSeconds[event.startIndex]);
    const endTime = Number(timeSeconds[event.endIndex]);

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime - startTime < tuning.MINIMUM_DURATION_SECONDS
    ) {
      continue;
    }

    const peakTime = Number(timeSeconds[event.peakIndex]);
    const target = Number(governorTarget[event.peakIndex]);

    if (!Number.isFinite(target) || target <= 300) {
      continue;
    }

    const outputMaxPercent = outputPercent
      ? maxFiniteInWindow(
          outputPercent,
          event.startIndex,
          event.endIndex
        )
      : null;

    const collectiveBefore = collectiveMoveBefore({
      collective,
      timeSeconds,
      startIndex: event.startIndex,
      lookbackSeconds: tuning.COLLECTIVE_LOOKBACK_SECONDS,
      moveThreshold: collectiveMoveThreshold
    });

    const hunting = detectHunting({
      smoothedErrorPercent,
      timeSeconds,
      endIndex: event.endIndex,
      tuning
    });

    const cause = classifyEvent({
      kind: event.kind,
      outputMaxPercent,
      collectiveBefore,
      tuning
    });

    const built = {
      id: `gov:${event.startIndex}:${event.endIndex}`,
      kind: event.kind,
      cause,
      hunting,
      t: Math.round(startTime * 10) / 10,
      tPeak: Number.isFinite(peakTime)
        ? Math.round(peakTime * 10) / 10
        : null,
      tEnd: Math.round(endTime * 10) / 10,
      durationMs: Math.round((endTime - startTime) * 1000),
      peakErrorPercent:
        Math.round(event.peakMagnitude * 10) / 10,
      peakErrorRpm:
        Math.round((event.peakMagnitude / 100) * target),
      targetRpm: Math.round(target),
      outputMaxPercent: Number.isFinite(outputMaxPercent)
        ? Math.round(outputMaxPercent * 10) / 10
        : null,
      collectiveBefore
    };

    built.story = eventStory(built);
    qualified.push(built);
  }

  // Severity keeps a bounded list honest: when a flight produces
  // more excursions than the strip can carry, the mild ones are
  // dropped and the summary SAYS so.
  qualified.sort(
    (a, b) => b.peakErrorPercent - a.peakErrorPercent
  );

  const dropped = Math.max(
    0,
    qualified.length - tuning.MAXIMUM_EVENTS
  );

  const events = qualified
    .slice(0, tuning.MAXIMUM_EVENTS)
    .sort((a, b) => a.t - b.t);

  // Tallies cover EVERYTHING found, not just the events kept for
  // display — "31 excursions (14 under · 10 over)" is a summary
  // that cannot add up, and it would travel into contributions.
  const counts = {
    under: 0,
    over: 0,
    powerLimit: 0,
    hunting: 0
  };

  for (const event of qualified) {
    counts[event.kind] += 1;

    if (event.cause === "power-limit") {
      counts.powerLimit += 1;
    }

    if (event.hunting) {
      counts.hunting += 1;
    }
  }

  const worst = events.reduce(
    (best, event) =>
      !best || event.peakErrorPercent > best.peakErrorPercent
        ? event
        : best,
    null
  );

  const sentence =
    events.length === 0
      ? "No sustained over- or under-target excursions found in flight — the rotor stayed inside the event band the whole time."
      : `${qualified.length} headspeed excursion${qualified.length === 1 ? "" : "s"} found — ` +
        `${counts.under} below target` +
        (counts.over > 0 ? `, ${counts.over} above target` : "") +
        (counts.powerLimit > 0
          ? `, ${counts.powerLimit} at the power-system limit`
          : "") +
        (counts.hunting > 0
          ? `, ${counts.hunting} with hunting afterwards`
          : "") +
        "." +
        (worst
          ? ` Worst: ${worst.peakErrorPercent.toFixed(1)}% ${worst.kind === "under" ? "below" : "above"} target at ${worst.tPeak ?? worst.t} s.`
          : "") +
        (dropped > 0
          ? ` (${dropped} milder excursion${dropped === 1 ? "" : "s"} not shown.)`
          : "");

  return {
    events,
    summary: {
      total: events.length,
      totalFound: qualified.length,
      dropped,
      ...counts,
      worst,
      sentence
    }
  };
}

/**
 * The chart window that provably contains the excursion —
 * from just before it started to just after it ended, wide
 * enough to show the preceding collective move and any
 * hunting afterwards.
 */
export function governorEventWindow(event, tuning = GOVERNOR_EVENT_TUNING) {
  if (!event || !Number.isFinite(event.t)) {
    return null;
  }

  const end = Number.isFinite(event.tEnd) ? event.tEnd : event.t;

  return {
    min: Math.max(
      0,
      event.t - Math.max(1.5, tuning.COLLECTIVE_LOOKBACK_SECONDS + 0.7)
    ),
    max:
      end +
      (event.hunting ? tuning.HUNTING_WINDOW_SECONDS + 0.5 : 1.5)
  };
}
