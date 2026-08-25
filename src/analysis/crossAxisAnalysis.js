// ======================================================
// CROSS-AXIS I-COUPLING — the off-axis integrator story
// ======================================================
//
// A command on one axis should not charge another axis's
// I-term. When it does — pitch-I building during a held
// roll and dumping at aileron release — the pilot feels an
// unwanted movement on an axis they never commanded, at the
// exact moment they let go. No single-axis instrument sees
// this: the commanded axis tracks fine, and the victim axis
// shows no command of its own to be judged against.
//
// The measurement: for every command event on axis A, the
// peak |I| of every OTHER axis B inside the command window
// plus a short release tail, against B's whole-flight
// baseline. The release drop (peak to post-peak minimum
// inside the tail) records the dump itself.
//
// Everything runs in the same compacted qualified-row space
// as the command events and term columns, so windows and
// values align by construction.
//
// Labeled specimen: Tron 7.0 log — pitch |I| 206 vs flight
// median 4 during a 255 deg/s roll command, dumped at
// release into a felt pitch-up.
//
// ======================================================

export const CROSS_AXIS_TAIL_SECONDS = 0.6;

// Per-pair Review bars, measured on the full-fleet sweep of
// 2026-08-22 (fleet-calibration discipline — bars are measured,
// never guessed). A pair reads Review only when its strongest
// event clears ALL THREE legs:
//   ratio >= bar.ratio   (per-pair fleet p95 of strongest ratio)
//   delta >= bar.delta   (per-pair fleet p50 — guards against
//                         ratio inflation over near-zero baselines)
//   releaseDrop >= CROSS_AXIS_DUMP_SHARE * delta
//                        (at least half the built charge released
//                         in the tail — the dump signature itself)
// Composite rule verified on the annotated Tron 7.0 package: the
// felt pitch-up flight reads Review; the softened-technique rerun
// and a near-zero-baseline high-ratio flight both stay Observed.
// Fleet Review volume at these bars: 3.2 % of flights.
// Pairs with yaw as the OFF axis carry no bar and stay Observed:
// yaw |I| baselines run in the hundreds (tail torque holding),
// so the ratio leg has no comparable meaning there — those pairs
// need their own labeled specimen before bars are set.
export const CROSS_AXIS_REVIEW_BARS = {
  "Pitch->Roll": { ratio: 49.5, delta: 152 },
  "Roll->Pitch": { ratio: 63.0, delta: 160 },
  "Yaw->Roll": { ratio: 43.4, delta: 139 },
  "Yaw->Pitch": { ratio: 53.8, delta: 158 }
};

export const CROSS_AXIS_DUMP_SHARE = 0.5;

// Review/Observed for one measured pair, judged on its strongest
// event against the pair's bars. Pairs without bars are Observed
// by definition — never Review, never silent.
export function crossAxisPairStatus(pair) {
  const bars =
    CROSS_AXIS_REVIEW_BARS[
      `${pair?.commandAxis}->${pair?.offAxis}`
    ];
  const strongest = pair?.strongest;

  if (!bars || !strongest) {
    return "Observed";
  }

  const meetsAllLegs =
    strongest.ratio >= bars.ratio &&
    strongest.delta >= bars.delta &&
    strongest.delta > 0 &&
    strongest.releaseDrop >=
      CROSS_AXIS_DUMP_SHARE * strongest.delta;

  return meetsAllLegs ? "Review" : "Observed";
}

const median = (values) => {
  const finite = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (finite.length === 0) {
    return null;
  }

  const middle = Math.floor(finite.length / 2);

  return finite.length % 2 === 1
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
};

/**
 * @param {object} input {
 *   commandEvents,     // [{ axis, events: [...] }] from the PID lab
 *   iTermValuesByAxis, // { Roll: number[], ... } compacted stable rows
 *   samplesPerSecond
 * }
 * @returns {Array} one entry per ordered axis pair with
 *   measurable events:
 *   {
 *     commandAxis, offAxis,
 *     eventCount,          // events measured for this pair
 *     baseline,            // median |I| of the off axis, whole flight
 *     medianPeak,          // median of per-event off-axis peaks
 *     strongest: {         // the worst event
 *       peak, delta, ratio, releaseDrop,
 *       commandMagnitude,
 *       sampleRowIndex, commandEndRowIndex  // absolute anchors
 *     }
 *   }
 */
export function analyzeCrossAxisIDump({
  commandEvents = [],
  iTermValuesByAxis = {},
  samplesPerSecond = null
}) {
  if (
    !Array.isArray(commandEvents) ||
    !Number.isFinite(samplesPerSecond) ||
    samplesPerSecond <= 0
  ) {
    return [];
  }

  const tailSamples = Math.round(
    CROSS_AXIS_TAIL_SECONDS * samplesPerSecond
  );

  const pairs = [];

  for (const axisResult of commandEvents) {
    const commandAxis = axisResult?.axis;
    const events = Array.isArray(axisResult?.events)
      ? axisResult.events
      : [];

    if (!commandAxis || events.length === 0) {
      continue;
    }

    for (const [offAxis, iValues] of Object.entries(
      iTermValuesByAxis
    )) {
      if (
        offAxis === commandAxis ||
        !Array.isArray(iValues) ||
        iValues.length === 0
      ) {
        continue;
      }

      const baseline = median(
        iValues.map((value) =>
          Number.isFinite(value) ? Math.abs(value) : null
        )
      );

      if (!Number.isFinite(baseline)) {
        continue;
      }

      let eventCount = 0;
      const peaks = [];
      let strongest = null;

      for (const event of events) {
        const start = event?.sampleIndex;
        const commandEnd = Number.isInteger(
          event?.commandEndSampleIndex
        )
          ? event.commandEndSampleIndex
          : start;

        if (!Number.isInteger(start) || start < 0) {
          continue;
        }

        const end = Math.min(
          iValues.length - 1,
          commandEnd + tailSamples
        );

        if (end <= start) {
          continue;
        }

        // Peak |I| of the off axis inside command + tail.
        let peak = null;
        let peakIndex = null;

        for (let index = start; index <= end; index += 1) {
          const value = iValues[index];

          if (!Number.isFinite(value)) {
            continue;
          }

          const size = Math.abs(value);

          if (peak === null || size > peak) {
            peak = size;
            peakIndex = index;
          }
        }

        if (peak === null) {
          continue;
        }

        // The dump: how far |I| falls within a tail AFTER
        // the peak — the released energy the pilot feels as
        // the uncommanded movement. The dump follows the
        // peak, not the command window: a peak at the window
        // edge still gets its decay measured.
        const dumpEnd = Math.min(
          iValues.length - 1,
          peakIndex + tailSamples
        );

        let postPeakMinimum = peak;

        for (
          let index = peakIndex;
          index <= dumpEnd;
          index += 1
        ) {
          const value = iValues[index];

          if (!Number.isFinite(value)) {
            continue;
          }

          const size = Math.abs(value);

          if (size < postPeakMinimum) {
            postPeakMinimum = size;
          }
        }

        const releaseDrop = peak - postPeakMinimum;
        const delta = peak - baseline;
        const ratio = peak / Math.max(baseline, 1);

        eventCount += 1;
        peaks.push(peak);

        if (!strongest || delta > strongest.delta) {
          strongest = {
            peak,
            delta,
            ratio,
            releaseDrop,
            peakSampleIndex: peakIndex,
            commandMagnitude: Number.isFinite(
              event.commandMagnitude
            )
              ? event.commandMagnitude
              : null,
            sampleRowIndex: Number.isInteger(
              event.sampleRowIndex
            )
              ? event.sampleRowIndex
              : null,
            commandEndRowIndex: Number.isInteger(
              event.commandEndRowIndex
            )
              ? event.commandEndRowIndex
              : null
          };
        }
      }

      if (eventCount === 0 || !strongest) {
        continue;
      }

      pairs.push({
        commandAxis,
        offAxis,
        eventCount,
        baseline,
        medianPeak: median(peaks),
        strongest
      });
    }
  }

  return pairs;
}

// One findings line per measured pair, strict format — the
// fleet-calibration probe parses these. The status rides at the
// end, after the measurement the probe reads.
export function crossAxisFindingLines(pairs, describeMoment) {
  return (pairs ?? []).map((pair) => {
    const moment =
      typeof describeMoment === "function"
        ? describeMoment(pair.strongest)
        : null;

    return (
      `Cross-axis I coupling ${pair.commandAxis}->${pair.offAxis}: ` +
      `baseline ${pair.baseline.toFixed(1)}, ` +
      `strongest event peak ${pair.strongest.peak.toFixed(1)} ` +
      `(delta ${pair.strongest.delta.toFixed(1)}, ` +
      `ratio ${pair.strongest.ratio.toFixed(1)}, ` +
      `release drop ${pair.strongest.releaseDrop.toFixed(1)}) ` +
      `across ${pair.eventCount} measured event${
        pair.eventCount === 1 ? "" : "s"
      }` +
      (moment ? `, ${moment}` : "") +
      ` — ${crossAxisPairStatus(pair)}`
    );
  });
}
