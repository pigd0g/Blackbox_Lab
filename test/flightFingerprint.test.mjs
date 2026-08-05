// ======================================================
// ONE FLIGHT, HOWEVER MANY NAMES
// ======================================================
//
// A pilot who copies, renames or re-exports a log still
// has one flight. Filing it twice shows it twice, counts
// it twice towards the flights a trend needs, and draws
// that trend through a single flight plotted twice.
//
// The opposite mistake is worse: two genuinely different
// flights merged into one loses a flight the pilot made.
// So identity is only claimed where enough is known.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoryEntry,
  collapseDuplicateFlights,
  flightFingerprint,
  loadHistory,
  recordFlight
} from "../src/analysis/craftHistory.js";

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

const DATASET = {
  spectra: [],
  labs: {},
  pidScore: 90,
  timeSeconds: new Array(102_720).fill(0)
};

function entry(fileName, overrides = {}) {
  return {
    ...buildHistoryEntry({
      fileName,
      flightDateMs: Date.UTC(2026, 4, 16, 19, 27, 2),
      durationSeconds: 102.9,
      dataset: DATASET
    }),
    ...overrides
  };
}

test("the same flight under another name is filed once", () => {
  const storage = memoryStorage();

  recordFlight(storage, "md500e", entry("md500e_20260000_000000.bbl"));
  recordFlight(storage, "md500e", entry("md500e_all_20260803_220748.bbl"));

  const flights = loadHistory(storage)["md500e"];

  assert.equal(
    flights.length,
    1,
    "a renamed copy is the same flight, not a second one"
  );
});

test("the record keeps the name the flight arrived under", () => {
  const storage = memoryStorage();

  recordFlight(storage, "md500e", entry("first-name.bbl"));
  recordFlight(storage, "md500e", entry("second-name.bbl"));

  assert.equal(
    loadHistory(storage)["md500e"][0].fileName,
    "first-name.bbl"
  );
});

test("genuinely different flights both survive", () => {
  const storage = memoryStorage();

  recordFlight(storage, "md500e", entry("morning.bbl"));
  recordFlight(
    storage,
    "md500e",
    entry("afternoon.bbl", {
      flightDateMs: Date.UTC(2026, 4, 16, 21, 3, 40),
      durationSeconds: 240.5,
      sampleCount: 240_500
    })
  );

  assert.equal(loadHistory(storage)["md500e"].length, 2);
});

test("two flights of identical length are still two flights", () => {
  const storage = memoryStorage();

  recordFlight(storage, "md500e", entry("hover-one.bbl"));
  recordFlight(
    storage,
    "md500e",
    entry("hover-two.bbl", {
      flightDateMs: Date.UTC(2026, 4, 17, 9, 0, 0)
    })
  );

  assert.equal(
    loadHistory(storage)["md500e"].length,
    2,
    "same duration is not the same flight"
  );
});

test("too little is known to claim identity", () => {
  assert.equal(flightFingerprint(null), null);
  assert.equal(
    flightFingerprint({ durationSeconds: 0, flightDateMs: 1 }),
    null
  );

  // Duration alone: two hovers can run the same length, so this must
  // not be enough to merge them.
  assert.equal(
    flightFingerprint({
      durationSeconds: 102.9,
      flightDateMs: null,
      sampleCount: null
    }),
    null
  );
});

test("a duration plus a sample count identifies a dateless flight", () => {
  assert.ok(
    flightFingerprint({
      durationSeconds: 102.9,
      flightDateMs: null,
      sampleCount: 102_720
    })
  );
});

test("records already holding a duplicate fold it back together", () => {
  const shared = {
    flightDateMs: Date.UTC(2026, 4, 16, 19, 27, 2),
    durationSeconds: 102.9,
    sampleCount: 102_720
  };

  const collapsed = collapseDuplicateFlights([
    { fileName: "a.bbl", ...shared, trackingScore: 98 },
    { fileName: "b.bbl", ...shared, trackingScore: 98, droopRpm: 40 }
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(
    collapsed[0].droopRpm,
    40,
    "nothing measured is lost when the two are folded together"
  );
});

test("unidentifiable flights are never folded together", () => {
  const collapsed = collapseDuplicateFlights([
    { fileName: "a.bbl", durationSeconds: 0 },
    { fileName: "b.bbl", durationSeconds: 0 }
  ]);

  assert.equal(
    collapsed.length,
    2,
    "merging two real flights loses one — keep the duplicate instead"
  );
});
