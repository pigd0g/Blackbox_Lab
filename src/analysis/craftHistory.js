// ======================================================
// BLACKBOX LAB — CRAFT HEALTH RECORD
// ======================================================
//
// Every analyzed flight is filed under its craft (the
// name lives in the log header). Across flights, trends
// appear that no single log can show — a bearing wearing
// out, a pack aging, a tune drifting. The storage backend
// is injected so tests can use a plain Map and the app
// can use localStorage. Everything stays on the pilot's
// computer; nothing is ever uploaded.
//
// ======================================================

import { isPlausibleFlightDate } from "./metadataReader.js";

const STORAGE_KEY = "blackboxLabCraftHistory";
const MAXIMUM_FLIGHTS_PER_CRAFT = 200;

// ------------------------------------------------------
// Physical-flight identity
//
// A flight's identity must survive re-analysis: scores,
// dates and sample handling all change as the software
// improves, and any of them inside the identity turns an
// app update into a duplicate row. The source bytes are
// the one thing an update cannot touch, so their hash is
// the authority; shape (duration + sample count) is the
// heuristic for records written before hashing existed;
// and two plausible dates that disagree veto a merge —
// better a duplicate kept than a real flight lost.
// ------------------------------------------------------

// Cheap stable content hash (FNV-1a over every line). Runs once per
// analysis on the selected flight's own lines, so each flight of a
// multi-flight file carries its own identity.
export function hashFlightLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  let hash = 0x811c9dc5;

  for (const line of lines) {
    const text = String(line);

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }

    // Line boundary, so ["ab","c"] and ["a","bc"] differ.
    hash ^= 10;
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}-${lines.length}`;
}

export function sameFlight(a, b) {
  if (!a || !b) {
    return false;
  }

  // The source bytes are the flight: equal hashes are one recording
  // whatever it is named or dated; differing hashes are two.
  if (a.sourceHash && b.sourceHash) {
    return a.sourceHash === b.sourceHash;
  }

  const durationA = Number(a.durationSeconds);
  const durationB = Number(b.durationSeconds);

  if (
    !Number.isFinite(durationA) ||
    durationA <= 0 ||
    !Number.isFinite(durationB) ||
    durationB <= 0 ||
    Math.abs(durationA - durationB) > 0.05
  ) {
    return false;
  }

  const samplesA = Number(a.sampleCount);
  const samplesB = Number(b.sampleCount);
  const bothCounted =
    Number.isFinite(samplesA) &&
    samplesA > 0 &&
    Number.isFinite(samplesB) &&
    samplesB > 0;

  const dateA = isPlausibleFlightDate(a.flightDateMs)
    ? Number(a.flightDateMs)
    : null;
  const dateB = isPlausibleFlightDate(b.flightDateMs)
    ? Number(b.flightDateMs)
    : null;

  if (bothCounted) {
    if (samplesA !== samplesB) {
      return false;
    }

    // Same shape, but two trustworthy dates that disagree are two
    // flights. A missing or implausible date never vetoes — that is
    // exactly the re-analysis case this identity exists to survive.
    if (
      dateA !== null &&
      dateB !== null &&
      Math.abs(dateA - dateB) > 120_000
    ) {
      return false;
    }

    return true;
  }

  // Without both sample counts: equal trustworthy dates decide.
  if (dateA !== null && dateB !== null) {
    return Math.abs(dateA - dateB) < 2_000;
  }

  // Legacy fallback, unchanged from the pre-hash record: an entry
  // too old to describe itself is matched by the name it arrived
  // under (duration already agreed above).
  return (
    normalizeFileName(a.fileName) === normalizeFileName(b.fileName)
  );
}

// Which of two rows describing one flight should speak for it:
// the one recorded latest, then the better-described one.
function keeperRank(entry) {
  return [
    Number.isFinite(Number(entry.recordedAtMs))
      ? Number(entry.recordedAtMs)
      : 0,
    entry.sourceHash ? 1 : 0,
    isPlausibleFlightDate(entry.flightDateMs) ? 1 : 0
  ];
}

function betterKeeper(a, b) {
  const rankA = keeperRank(a);
  const rankB = keeperRank(b);

  for (let i = 0; i < rankA.length; i += 1) {
    if (rankA[i] !== rankB[i]) {
      return rankA[i] > rankB[i] ? a : b;
    }
  }

  return a;
}

export function loadHistory(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveHistory(storage, history) {
  storage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function buildHistoryEntry({
  fileName,
  flightDateMs,
  durationSeconds,
  dataset,
  sourceHash = null
}) {
  const peak = (() => {
    if (!dataset.spectra || dataset.spectra.length === 0) {
      return null;
    }

    let hz = 0;
    let magnitude = 0;

    for (const { spectrum } of dataset.spectra) {
      for (let i = 0; i < spectrum.frequencies.length; i += 1) {
        if (
          spectrum.frequencies[i] > 10 &&
          spectrum.magnitudes[i] > magnitude
        ) {
          magnitude = spectrum.magnitudes[i];
          hz = spectrum.frequencies[i];
        }
      }
    }

    return magnitude > 0 ? { hz, magnitude } : null;
  })();

  return {
    fileName,
    flightDateMs,
    // Identity of the source recording itself — survives renames,
    // re-exports and every future change to the analysis.
    sourceHash,
    // When this analysis was filed, so a re-analysis knows it
    // supersedes the row it replaces.
    recordedAtMs: Date.now(),
    durationSeconds:
      Math.round((durationSeconds ?? 0) * 10) / 10,
    // How many samples the flight holds. Part of what identifies a
    // flight regardless of what its file is called.
    sampleCount: Array.isArray(dataset.timeSeconds)
      ? dataset.timeSeconds.length
      : null,
    vibrationPeak: peak ? Math.round(peak.magnitude * 10) / 10 : null,
    vibrationHz: peak ? Math.round(peak.hz * 10) / 10 : null,
    droopRpm: dataset.labs?.governor?.droopRpm ?? null,
    trackingScore:
  dataset.pidAnalysis?.score ??
  dataset.pidScore ??
  null,
    batterySagPercent: dataset.batterySagPercent ?? null,
    internalResistance: dataset.labs?.battery?.internalResistance ?? null
  };
}

/**
 * What identifies a flight, independent of its file name.
 *
 * Retained as the claimability check; live identity decisions run
 * through sameFlight(), which prefers the source hash and treats
 * the date as a veto rather than as part of the identity.
 *
 * A pilot who copies, renames or re-exports a log is holding the same
 * flight, and the record should say so rather than showing it twice
 * and counting it twice towards a trend. The properties used are the
 * ones a rename cannot touch: when the flight started, how long it
 * ran, and how many samples it holds.
 *
 * Returns null when too little is known to identify the flight
 * safely — better to keep a duplicate than to merge two real flights.
 */
export function flightFingerprint(entry) {
  if (!entry) {
    return null;
  }

  const duration = Number(entry.durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const started =
    entry.flightDateMs === null || entry.flightDateMs === undefined
      ? null
      : Number(entry.flightDateMs);

  const samples = Number(entry.sampleCount);

  const hasStart = Number.isFinite(started);
  const hasSamples = Number.isFinite(samples) && samples > 0;

  // Duration alone is too weak: two hovers can run the same length.
  // One further stable property has to agree.
  if (!hasStart && !hasSamples) {
    return null;
  }

  return [
    hasStart ? started : "no-start",
    duration.toFixed(1),
    hasSamples ? samples : "no-samples"
  ].join("|");
}

const normalizeFileName = (fileName = "") =>
  String(fileName)
    .toLowerCase()
    .replace(/\.bbl\.csv$/, "")
    .replace(/\.bbl$/, "")
    .replace(/\.csv$/, "");

export function recordFlight(storage, craftName, entry) {
  const history = loadHistory(storage);

let craftKey =
  (craftName || "Unknown craft").trim() ||
  "Unknown craft";

// A CSV may not contain the Craft name header.
// When that happens, attach it to an existing matching
// BBL flight instead of filing it under Unknown craft.
if (craftKey === "Unknown craft") {
  const normalizedIncoming =
    normalizeFileName(entry.fileName);

  for (const [existingCraft, flights] of Object.entries(
    history
  )) {
    const matchingFlight = flights.find(
      (flight) =>
        normalizeFileName(flight.fileName) ===
        normalizedIncoming
    );

    if (matchingFlight) {
      craftKey = existingCraft;
      break;
    }
  }
}




  if (!history[craftKey]) {
    history[craftKey] = [];
  }

  // The same flight under a second name — or under a second
  // analysis by a newer build — is still one flight.
  const duplicate = history[craftKey].find((existing) =>
    sameFlight(existing, entry)
  );

  if (duplicate) {
    // Keep the name the flight was first filed under: the record reads
    // as one flight, not as whichever copy was opened last.
    const firstKnownName = duplicate.fileName;

    for (const [key, value] of Object.entries(entry)) {
      if (value !== null && value !== undefined) {
        duplicate[key] = value;
      }
    }

    duplicate.fileName = firstKnownName;
  } else {
    history[craftKey].push(entry);
    // Flights with no trustworthy date keep their arrival order at
    // the end of the record rather than steering it: subtracting a
    // missing date yields NaN, and a NaN comparator scrambles the
    // ordering of everything around it.
    history[craftKey].sort((first, second) => {
      // Number(null) is 0, a perfectly finite epoch date in 1970,
      // so a missing date has to be ruled out before the number is
      // taken rather than after.
      const dateOf = (flight) =>
        flight.flightDateMs === null ||
        flight.flightDateMs === undefined
          ? Number.NaN
          : Number(flight.flightDateMs);

      const firstMs = dateOf(first);
      const secondMs = dateOf(second);
      const firstKnown = Number.isFinite(firstMs);
      const secondKnown = Number.isFinite(secondMs);

      if (firstKnown && secondKnown) {
        return firstMs - secondMs;
      }

      if (firstKnown !== secondKnown) {
        return firstKnown ? -1 : 1;
      }

      return 0;
    });

    if (
      history[craftKey].length >
      MAXIMUM_FLIGHTS_PER_CRAFT
    ) {
      history[craftKey] = history[craftKey].slice(
        -MAXIMUM_FLIGHTS_PER_CRAFT
      );
    }
  }

  // Records written before a flight could be identified may hold the
  // same flight twice under two names. Once both have been read again
  // they describe themselves identically, so the record folds them
  // together here rather than carrying the pair forever — a duplicate
  // counts towards the flights a trend needs, and would draw a trend
  // line through one flight plotted twice.
  history[craftKey] = collapseDuplicateFlights(history[craftKey]);

  saveHistory(storage, history);
  return craftKey;
}

export function collapseDuplicateFlights(flights = []) {
  const survivors = [];

  for (const flight of flights) {
    const twinIndex = survivors.findIndex((candidate) =>
      sameFlight(candidate, flight)
    );

    if (twinIndex === -1) {
      survivors.push(flight);
      continue;
    }

    // One physical flight, two rows: the later, better-described
    // analysis speaks for it, and the other only fills the gaps it
    // left — nothing measured is lost, nothing stale survives as a
    // second observation.
    const keeper = betterKeeper(survivors[twinIndex], flight);
    const filler =
      keeper === survivors[twinIndex] ? flight : survivors[twinIndex];

    for (const [key, value] of Object.entries(filler)) {
      if (
        (keeper[key] === null || keeper[key] === undefined) &&
        value !== null &&
        value !== undefined
      ) {
        keeper[key] = value;
      }
    }

    // The record keeps reading as the flight it first filed.
    keeper.fileName = survivors[twinIndex].fileName;
    survivors[twinIndex] = keeper;
  }

  return survivors;
}

// Records written by earlier builds may already hold duplicates.
// One pass on startup folds them without waiting for the same log
// to be opened again.
export function migrateHistory(storage) {
  const history = loadHistory(storage);
  let changed = false;

  for (const [craft, flights] of Object.entries(history)) {
    const collapsed = collapseDuplicateFlights(flights);

    if (collapsed.length !== flights.length) {
      history[craft] = collapsed;
      changed = true;
    }
  }

  if (changed) {
    saveHistory(storage, history);
  }

  return changed;
}

export function deleteFlight(storage, craftName, fileName) {
  const history = loadHistory(storage);
  const flights = history[craftName];

  if (!Array.isArray(flights)) {
    return false;
  }

  const remaining = flights.filter(
    (flight) => flight.fileName !== fileName
  );

  if (remaining.length === flights.length) {
    return false;
  }

  if (remaining.length === 0) {
    delete history[craftName];
  } else {
    history[craftName] = remaining;
  }

  saveHistory(storage, history);
  return true;
}

export function clearHistory(storage) {
  storage.removeItem(STORAGE_KEY);
}

// ------------------------------------------------------
// Craft class card — the minimum context that makes
// flights comparable: confirmed once per craft, stored
// locally, attached to contributions only when sharing
// is on. Local app data first, contribution metadata
// second.
// ------------------------------------------------------

const CRAFT_CARD_KEY = "blackboxLabCraftCards";

export const CRAFT_SIZE_CLASSES = [
  "450",
  "500",
  "550",
  "600",
  "700",
  "other"
];
export const CRAFT_POWER_TYPES = ["electric", "nitro", "gasoline"];
export const CRAFT_DRIVES = ["direct", "belt", "torque_tube_tail"];

function loadCraftCards(storage) {
  try {
    const raw = storage.getItem(CRAFT_CARD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getCraftCard(storage, craftName) {
  return loadCraftCards(storage)[craftName] ?? null;
}

// Allowlist on write, same philosophy as the payload:
// only the card fields survive, everything else is
// dropped. Unknown enum values fall back to null rather
// than travelling on.
//
// `craft_id` is a stable anonymous identifier, minted on
// first save and preserved across edits. It is what groups
// this craft's contributions in the community bucket — the
// craft NAME stays on this computer (owner ruling
// 2026-08-03: local reassurance yes, upload no).
export function saveCraftCard(storage, craftName, card) {
  const cards = loadCraftCards(storage);

  const numberOrNull = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number > 0
      ? Math.round(number)
      : null;
  };

  const oneOf = (value, allowed) =>
    allowed.includes(value) ? value : null;

  cards[craftName] = {
    craft_id: cards[craftName]?.craft_id ?? crypto.randomUUID(),
    size_class: oneOf(card?.size_class, CRAFT_SIZE_CLASSES),
    blade_length_mm: numberOrNull(card?.blade_length_mm),
    power_type: oneOf(card?.power_type, CRAFT_POWER_TYPES),
    typical_headspeed_rpm: numberOrNull(card?.typical_headspeed_rpm),
    drive: oneOf(card?.drive, CRAFT_DRIVES)
  };

  storage.setItem(CRAFT_CARD_KEY, JSON.stringify(cards));
  return cards[craftName];
}

// ------------------------------------------------------
// Per-craft CLI dump — the SCRUBBED result only, filed
// under the craft so it persists across sessions and
// attaches to every contribution of that craft. The raw
// paste is never stored.
// ------------------------------------------------------

const CRAFT_DUMP_KEY = "blackboxLabCraftDumps";

function loadCraftDumps(storage) {
  try {
    const raw = storage.getItem(CRAFT_DUMP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getCraftDump(storage, craftName) {
  return loadCraftDumps(storage)[craftName] ?? null;
}

// Allowlist on write: exactly the scrubber's output fields
// plus a timestamp — nothing else survives into storage.
export function saveCraftDump(storage, craftName, scrubbed) {
  const dumps = loadCraftDumps(storage);

  dumps[craftName] = {
    scrubbedText: String(scrubbed?.scrubbedText ?? ""),
    parsed: scrubbed?.parsed ?? {},
    report: Array.isArray(scrubbed?.report) ? scrubbed.report : [],
    stats: {
      kept: scrubbed?.stats?.kept ?? 0,
      dropped: scrubbed?.stats?.dropped ?? 0
    },
    savedAtMs: Date.now()
  };

  storage.setItem(CRAFT_DUMP_KEY, JSON.stringify(dumps));
  return dumps[craftName];
}

// Pre-fill from what the log already knows, so the pilot
// confirms instead of typing. Only suggestions the log can
// actually support are made; everything else stays null
// and waits for the pilot.
// What a parsed CLI dump can contribute to the craft card:
// numbers and modes, never guesses. Fills only what it
// actually knows; the pilot confirms the rest.
export function craftCardFromDump(parsed = {}) {
  const headspeed = Number.parseFloat(parsed.gov_headspeed);

  const powerByGovMode = {
    ELECTRIC: "electric",
    NITRO: "nitro",
    GAS: "gasoline",
    GASOLINE: "gasoline"
  };

  return {
    size_class: null,
    blade_length_mm: null,
    power_type:
      powerByGovMode[String(parsed.gov_mode ?? "").toUpperCase()] ?? null,
    typical_headspeed_rpm:
      Number.isFinite(headspeed) && headspeed > 300
        ? Math.round(headspeed / 10) * 10
        : null,
    drive: null
  };
}

export function prefillCraftCard({
  medianHeadspeedRpm = null,
  hasElectricalTelemetry = false
} = {}) {
  const headspeed = Number.parseFloat(medianHeadspeedRpm);

  return {
    size_class: null,
    blade_length_mm: null,
    power_type: hasElectricalTelemetry ? "electric" : null,
    typical_headspeed_rpm:
      Number.isFinite(headspeed) && headspeed > 300
        ? Math.round(headspeed / 10) * 10
        : null,
    drive: null
  };
}

// ------------------------------------------------------
// Trend assessment — the sentences that make this a
// health record instead of a diary.
// ------------------------------------------------------

function averageOf(values) {
  const usable = values.filter((value) => Number.isFinite(value));

  if (usable.length === 0) {
    return null;
  }

  let sum = 0;

  for (const value of usable) {
    sum += value;
  }

  return sum / usable.length;
}

function assessMetric(entries, key, { label, lowerIsBetter, unit, adviceUp }) {
  const values = entries.map((entry) => entry[key]);
  const usable = values.filter((value) => Number.isFinite(value));

  if (usable.length < 4) {
    return null;
  }

  const half = Math.floor(usable.length / 2);
  const earlier = averageOf(usable.slice(0, half));
  const recent = averageOf(usable.slice(-Math.min(3, half)));

  if (earlier === null || recent === null || earlier === 0) {
    return null;
  }

  const ratio = recent / earlier;
  const gettingWorse = lowerIsBetter ? ratio > 1.4 : ratio < 0.7;
  const changePercent = Math.abs((ratio - 1) * 100).toFixed(0);

  if (!gettingWorse) {
    return null;
  }

  return {
    status: "attention",
    sentence: `${label} has ${lowerIsBetter ? "risen" : "fallen"} ~${changePercent}% across your last flights (${earlier.toFixed(1)} → ${recent.toFixed(1)}${unit}). ${adviceUp}`
  };
}

export function assessTrends(entries) {
  if (!entries || entries.length < 4) {
    return {
      findings: [],
      note:
        entries && entries.length > 0
          ? `Keep flying — trends appear after 4 logged flights (${entries.length} so far).`
          : "No flights recorded for this craft yet."
    };
  }

  const findings = [
    assessMetric(entries, "vibrationPeak", {
      label: "Vibration",
      lowerIsBetter: true,
      unit: "",
      adviceUp:
        "Something mechanical is changing — check bearings, blade balance and links before it grows."
    }),
    assessMetric(entries, "droopRpm", {
      label: "Governor droop",
      lowerIsBetter: true,
      unit: " rpm",
      adviceUp:
        "The power system is losing headroom — aging pack, dirty pinion or slipping gear are the usual suspects."
    }),
    assessMetric(entries, "internalResistance", {
      label: "Pack internal resistance",
      lowerIsBetter: true,
      unit: " mΩ",
      adviceUp: "The battery is aging — expect softer punch and more sag."
    }),
    assessMetric(entries, "trackingScore", {
      label: "Tracking score",
      lowerIsBetter: false,
      unit: "",
      adviceUp:
        "The tune is drifting — mechanics wearing in, or settings changed along the way."
    })
  ].filter(Boolean);

  return {
    findings,
    note:
      findings.length === 0
        ? `All trends stable across ${entries.length} flights. That's a healthy machine.`
        : `${findings.length} trend(s) deserve a look.`
  };
}
