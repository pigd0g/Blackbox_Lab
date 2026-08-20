// ======================================================
// BLACKBOX LAB — EVIDENCE VIEW HELPERS
// ======================================================
//
// Pure helpers behind the synchronized evidence views in
// the Governor and ESC Labs. They select the moments worth
// looking at and describe them in plain language — they
// never touch any lab score.
//
// ======================================================

// Index window covering [centerSeconds - beforeSeconds,
// centerSeconds + afterSeconds] on a monotonic time axis.
export function sliceWindow(
  timeSeconds,
  centerSeconds,
  beforeSeconds,
  afterSeconds
) {
  if (
    !Array.isArray(timeSeconds) ||
    timeSeconds.length === 0 ||
    !Number.isFinite(centerSeconds)
  ) {
    return null;
  }

  const startTime = centerSeconds - beforeSeconds;
  const endTime = centerSeconds + afterSeconds;

  let startIndex = 0;
  let endIndex = timeSeconds.length - 1;

  for (let i = 0; i < timeSeconds.length; i += 1) {
    if (timeSeconds[i] >= startTime) {
      startIndex = i;
      break;
    }
  }

  for (let i = timeSeconds.length - 1; i >= 0; i -= 1) {
    if (timeSeconds[i] <= endTime) {
      endIndex = i;
      break;
    }
  }

  if (endIndex <= startIndex) {
    return null;
  }

  return { startIndex, endIndex };
}

export function windowStats(values, startIndex, endIndex) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const value = values[i];

    if (!Number.isFinite(value)) {
      continue;
    }

    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return {
    min,
    max,
    average: sum / count,
    sampleCount: count
  };
}

// The top non-overlapping windows by average load. "Load"
// is whatever series the caller passes — current when the
// log has it, output percent otherwise.
export function findHighestLoadEvents(
  { timeSeconds, load },
  { windowSeconds = 2, count = 3, qualifiedMask = null } = {}
) {
  if (
    !Array.isArray(timeSeconds) ||
    !Array.isArray(load) ||
    timeSeconds.length < 10 ||
    load.length !== timeSeconds.length
  ) {
    return [];
  }

  const duration =
    timeSeconds[timeSeconds.length - 1] - timeSeconds[0];

  if (!(duration > windowSeconds)) {
    return [];
  }

  // A load series that never leaves zero (a fitted-but-dead current
  // sensor) has no highest moment: every window ties at 0 and the
  // "winners" would just be the earliest windows — spool-up. No
  // usable signal, no events.
  if (!load.some((value) => Number.isFinite(value) && value > 0)) {
    return [];
  }

  const samplesPerSecond =
    timeSeconds.length / duration;

  const windowSamples = Math.max(
    10,
    Math.round(windowSeconds * samplesPerSecond)
  );

  // Rolling average via prefix sums (nulls count as 0 but
  // are tracked so sparse telemetry doesn't fake a lull).
  const prefixSum = new Float64Array(load.length + 1);
  const prefixCount = new Float64Array(load.length + 1);

  for (let i = 0; i < load.length; i += 1) {
    const value = Number.isFinite(load[i]) ? load[i] : 0;
    prefixSum[i + 1] = prefixSum[i] + value;
    prefixCount[i + 1] =
      prefixCount[i] + (Number.isFinite(load[i]) ? 1 : 0);
  }

  const candidates = [];

  for (
    let start = 0;
    start + windowSamples <= load.length;
    start += Math.max(1, Math.floor(windowSamples / 4))
  ) {
    const end = start + windowSamples;
    const validCount = prefixCount[end] - prefixCount[start];

    if (validCount < windowSamples / 2) {
      continue;
    }

    // Startup, spool-up and shutdown are not flight load: when the
    // caller supplies an in-flight mask, a window must be flown
    // almost entirely airborne to compete.
    if (qualifiedMask) {
      let airborne = 0;
      for (let i = start; i < end; i += 1) {
        if (qualifiedMask[i]) airborne += 1;
      }
      if (airborne < windowSamples * 0.8) {
        continue;
      }
    }

    candidates.push({
      startIndex: start,
      endIndex: end - 1,
      averageLoad:
        (prefixSum[end] - prefixSum[start]) / validCount
    });
  }

  candidates.sort(
    (first, second) => second.averageLoad - first.averageLoad
  );

  // A load series that does not vary has no highest moment: when
  // every window ties (a constant-throttle DIRECT flight logs the
  // same output for the whole flight), ranking the ties just crowns
  // the earliest windows. "No distinguished load event" is the
  // honest answer, and the card's empty state says exactly that.
  // The bar is deliberately at dead-flat only — a governor working
  // under 3D load varies by single percent and those moments are
  // real.
  if (candidates.length >= 5) {
    const bestAverage = candidates[0].averageLoad;
    const medianAverage =
      candidates[Math.floor(candidates.length / 2)].averageLoad;

    if (
      Number.isFinite(bestAverage) &&
      Number.isFinite(medianAverage) &&
      bestAverage <= medianAverage * 1.005
    ) {
      return [];
    }
  }

  const events = [];

  for (const candidate of candidates) {
    let peakIndex = candidate.startIndex;
    let peakValue = -Infinity;

    for (
      let i = candidate.startIndex;
      i <= candidate.endIndex;
      i += 1
    ) {
      if (
        Number.isFinite(load[i]) &&
        load[i] > peakValue
      ) {
        peakValue = load[i];
        peakIndex = i;
      }
    }

    // Separate moments must be separated in time. Windows step a
    // quarter-window at a time, so a single current spike sitting
    // on a seam lands in two abutting windows: they never overlap
    // by span, they each find their own peak sample either side of
    // the seam, and the same spike gets listed twice with matching
    // figures. Requiring a full window of clear air between events
    // keeps one spike to one moment, while genuinely separate
    // loads further apart than the window still both stand.
    const tooClose = events.some(
      (event) =>
        candidate.startIndex <= event.endIndex + windowSamples &&
        candidate.endIndex >= event.startIndex - windowSamples
    );

    if (tooClose) {
      continue;
    }

    const stats = windowStats(
      load,
      candidate.startIndex,
      candidate.endIndex
    );

    events.push({
      peakIndex,
      startIndex: candidate.startIndex,
      endIndex: candidate.endIndex,
      startSeconds: timeSeconds[candidate.startIndex],
      endSeconds: timeSeconds[candidate.endIndex],
      peakSeconds: timeSeconds[peakIndex],
      averageLoad: stats ? stats.average : null,
      peakLoad: Number.isFinite(peakValue) ? peakValue : null
    });

    if (events.length >= count) {
      break;
    }
  }

  return events.sort(
    (first, second) => first.startSeconds - second.startSeconds
  );
}

// Did the collective drive this event? True when the event's
// peak collective demand approaches the flight's own maximum
// AND clearly exceeds the flight's typical level — the second
// guard keeps a steady hover (where every moment is near the
// tiny "maximum") from reading as a pitch pump.
export function isCollectiveDriven({
  eventPeakCollective,
  flightPeakCollective,
  flightMedianCollective
}) {
  return (
    Number.isFinite(eventPeakCollective) &&
    Number.isFinite(flightPeakCollective) &&
    Number.isFinite(flightMedianCollective) &&
    flightPeakCollective > 0 &&
    eventPeakCollective >= flightPeakCollective * 0.7 &&
    eventPeakCollective >= flightMedianCollective * 1.5
  );
}

// Why was the output high here? Answers a pilot can act on,
// in priority order: the ESC genuinely ran out of headroom;
// the collective demanded it (a pitch pump — the load is the
// pilot's doing, wording per Daniel); the battery sagged so
// more throttle was needed for the same power; or it was
// simply a demanding moment working as designed.
export function explainLoadEvent({
  outputPeakPercent,
  outputSaturatedShare,
  voltageSagPercent,
  collectiveDriven = false
}) {
  const saturated =
    Number.isFinite(outputPeakPercent) &&
    outputPeakPercent >= 97 &&
    Number.isFinite(outputSaturatedShare) &&
    outputSaturatedShare >= 0.15;

  if (saturated) {
    return {
      cause: "headroom-limit",
      sentence:
        "Output sat at maximum for a meaningful part of this event: the power system had nothing left to give here. Consider more headroom (lower headspeed, a fresher pack, or gearing/Kv matched to your target headspeed) before blaming the tune."
    };
  }

  const sagged =
    Number.isFinite(voltageSagPercent) &&
    voltageSagPercent >= 8;

  if (collectiveDriven) {
    return {
      cause: "collective-load",
      sentence: sagged
        ? "Collective demand rose sharply at the same time as current, power and ESC output. This is consistent with a hard pitch pump or other demanding collective maneuver. The battery sag was a response to the load, not necessarily evidence of a weak pack."
        : "Collective demand rose sharply at the same time as current, power and ESC output. This is consistent with a hard pitch pump or other demanding collective maneuver: the power system followed the demand with voltage holding up well."
    };
  }

  if (sagged) {
    return {
      cause: "battery-sag",
      sentence:
        "Pack voltage fell well below its level from just before this event, so the governor needed extra throttle to deliver the same power. The demand is real, but the battery is amplifying it: the table shows the exact before → during voltages."
    };
  }

  return {
    cause: "normal-load",
    sentence:
      "High output with headroom to spare and steady voltage: this looks like a genuinely demanding moment handled as designed."
  };
}

// Longest run of consecutive integers in an ascending index
// list — the FFT needs continuous samples, so a bank's stable
// time only counts where it is unbroken.
export function longestConsecutiveRun(indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return null;
  }

  let bestStart = indexes[0];
  let bestLength = 1;
  let runStart = indexes[0];
  let runLength = 1;

  for (let i = 1; i < indexes.length; i += 1) {
    if (indexes[i] === indexes[i - 1] + 1) {
      runLength += 1;
    } else {
      runStart = indexes[i];
      runLength = 1;
    }

    if (runLength > bestLength) {
      bestLength = runLength;
      bestStart = runStart;
    }
  }

  return { startIndex: bestStart, length: bestLength };
}

// Group stable-flight samples by governor target so
// averages can be reported per headspeed profile (bank).
// Targets within one percent of each other belong to the
// same bank.
export function groupByGovernorTarget({
  governorTarget,
  sampleIndexes
}) {
  if (
    !Array.isArray(governorTarget) ||
    !Array.isArray(sampleIndexes)
  ) {
    return [];
  }

  const banks = [];

  for (const index of sampleIndexes) {
    const target = Number(governorTarget[index]);

    if (!Number.isFinite(target) || target <= 0) {
      continue;
    }

    let bank = banks.find(
      (candidate) =>
        Math.abs(candidate.targetRpm - target) <=
        candidate.targetRpm * 0.01
    );

    if (!bank) {
      bank = { targetRpm: target, indexes: [] };
      banks.push(bank);
    }

    bank.indexes.push(index);
  }

  return banks
    .filter((bank) => bank.indexes.length >= 100)
    .map((bank) => ({
      targetRpm: Math.round(
        bank.indexes.reduce(
          (sum, index) => sum + governorTarget[index],
          0
        ) / bank.indexes.length
      ),
      indexes: bank.indexes
    }))
    .sort((first, second) => first.targetRpm - second.targetRpm);
}

// Every consecutive run inside a sorted index list — the
// multi-window spectra average across all of a bank's stable
// stretches, not only its longest one.
export function allConsecutiveRuns(indexes) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return [];
  }

  const runs = [];
  let runStart = indexes[0];
  let runLength = 1;

  for (let i = 1; i <= indexes.length; i += 1) {
    if (indexes[i] === indexes[i - 1] + 1) {
      runLength += 1;
    } else {
      runs.push({ startIndex: runStart, length: runLength });
      runStart = indexes[i];
      runLength = 1;
    }
  }

  return runs;
}
