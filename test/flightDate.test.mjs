// ======================================================
// FLIGHT DATES
// ======================================================
//
// The date a flight is filed under comes from the log's
// own header, so renaming, copying or re-exporting a log
// does not change when it says it flew. A flight
// controller with no RTC set writes a zeroed timestamp,
// which reaches JavaScript as the Windows zero FILETIME —
// a real number that would render as a real, wrong date.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  isPlausibleFlightDate,
  resolveFlightDateMs
} from "../src/analysis/metadataReader.js";
import {
  buildHistoryEntry,
  recordFlight,
  loadHistory
} from "../src/analysis/craftHistory.js";

// The Windows zero FILETIME, 1601-01-01, in epoch ms.
const WINDOWS_ZERO_FILETIME_MS = -11_644_473_600_000;

const REAL_FLIGHT_MS = Date.UTC(2026, 4, 16, 19, 27, 2, 236);

function linesWith(startDatetime) {
  return [
    '"Product","Blackbox flight data recorder by Nicholas Sherlock"',
    '"Firmware type","Rotorflight"',
    ...(startDatetime
      ? [`"Log start datetime","${startDatetime}"`]
      : []),
    '"Craft name","md500e"'
  ];
}

function memoryStorage() {
  const store = new Map();

  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

test("the log's own start time is what the flight is dated by", () => {
  const resolved = resolveFlightDateMs(
    linesWith("2026-05-16T19:27:02.236+00:00"),
    Date.UTC(2026, 7, 3, 22, 7, 48)
  );

  assert.equal(
    resolved,
    REAL_FLIGHT_MS,
    "the header wins over the file's own timestamp"
  );
});

test("a zeroed controller clock does not become a date", () => {
  const resolved = resolveFlightDateMs(
    linesWith(null),
    WINDOWS_ZERO_FILETIME_MS
  );

  assert.equal(
    resolved,
    null,
    "1601 is the absence of a timestamp, not a flight in 1601"
  );

  assert.equal(
    isPlausibleFlightDate(WINDOWS_ZERO_FILETIME_MS),
    false
  );
});

test("a file timestamp still serves when the header has none", () => {
  const fileMs = Date.UTC(2026, 7, 3, 22, 7, 48);

  assert.equal(
    resolveFlightDateMs(linesWith(null), fileMs),
    fileMs
  );
});

test("an unparseable header falls back rather than throwing", () => {
  const fileMs = Date.UTC(2026, 7, 3, 22, 7, 48);

  assert.equal(
    resolveFlightDateMs(linesWith("not a date at all"), fileMs),
    fileMs
  );
});

test("a dateless flight does not scramble the record's order", () => {
  const storage = memoryStorage();

  const dataset = {
    spectra: [],
    labs: {},
    pidScore: 90
  };

  const entryAt = (fileName, flightDateMs) =>
    buildHistoryEntry({
      fileName,
      flightDateMs,
      durationSeconds: 100,
      dataset
    });

  recordFlight(
    storage,
    "md500e",
    entryAt("second.bbl", Date.UTC(2026, 4, 2))
  );
  recordFlight(storage, "md500e", entryAt("undated.bbl", null));
  recordFlight(
    storage,
    "md500e",
    entryAt("first.bbl", Date.UTC(2026, 4, 1))
  );

  const flights = loadHistory(storage)["md500e"];

  assert.deepEqual(
    flights.map((flight) => flight.fileName),
    ["first.bbl", "second.bbl", "undated.bbl"],
    "dated flights stay in order and the undated one sits at the end"
  );
});
