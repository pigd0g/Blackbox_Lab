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
import * as craftHistoryModule from "../src/analysis/craftHistory.js";

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

test("a pre-fingerprint entry folds into the modern analysis of its file", () => {
  // The reported record: one .bbl analyzed by an older build (no
  // date, no sample count — no fingerprint possible) and again by a
  // newer one. The newer, better-described analysis stays; the
  // legacy row only fills gaps — never overrides.
  const collapsed = collapseDuplicateFlights([
    {
      fileName: "md500e_20260000_000000.bbl",
      flightDateMs: null,
      durationSeconds: 102.9,
      trackingScore: 98,
      vibrationPeak: 4.7,
      batterySagPercent: 1.5
    },
    {
      fileName: "md500e_20260000_000000.bbl",
      flightDateMs: Date.UTC(2026, 4, 16),
      durationSeconds: 102.9,
      sampleCount: 102_720,
      trackingScore: 87,
      vibrationPeak: 3.8,
      droopRpm: 38.1
    }
  ]);

  assert.equal(collapsed.length, 1, "one physical flight, one row");
  assert.equal(
    collapsed[0].trackingScore,
    87,
    "the newer analysis speaks for the flight"
  );
  assert.equal(
    collapsed[0].batterySagPercent,
    1.5,
    "the legacy row still fills gaps the new analysis left"
  );
});

test("two flights of a multi-flight file are never merged by name", () => {
  // One .bbl can hold several flights: same file name, different
  // flights. Both carry fingerprints, so the name must not fold them.
  const collapsed = collapseDuplicateFlights([
    {
      fileName: "session.bbl",
      flightDateMs: Date.UTC(2026, 4, 16, 10, 0, 0),
      durationSeconds: 210.4,
      sampleCount: 210_000
    },
    {
      fileName: "session.bbl",
      flightDateMs: Date.UTC(2026, 4, 16, 10, 30, 0),
      durationSeconds: 195.7,
      sampleCount: 195_000
    }
  ]);

  assert.equal(collapsed.length, 2, "different flights both survive");
});

test("two legacy rows of one file become one row", () => {
  const collapsed = collapseDuplicateFlights([
    {
      fileName: "old.bbl",
      flightDateMs: null,
      durationSeconds: 88.8,
      trackingScore: 91
    },
    {
      fileName: "old.bbl",
      flightDateMs: null,
      durationSeconds: 88.8,
      vibrationPeak: 2.2
    }
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].trackingScore, 91);
  assert.equal(collapsed[0].vibrationPeak, 2.2);
});

// ------------------------------------------------------
// The re-analysis hole (issue: same physical flight as
// duplicate rows): identity must survive the software
// changing how it reads dates, samples or scores.
// ------------------------------------------------------

test("a re-analysis that learned the flight's date folds into one row", () => {
  // The reported record: an older build filed the flight with no
  // usable date; a newer build reads the date from the log header.
  // Same duration, same sample count, different date fields — one
  // physical flight, and the newer analysis speaks for it.
  const collapsed = collapseDuplicateFlights([
    {
      fileName: "md500e_20260000_000000.bbl",
      flightDateMs: null,
      durationSeconds: 102.9,
      sampleCount: 443_549,
      trackingScore: 98,
      vibrationPeak: 4.7,
      recordedAtMs: 1_000
    },
    {
      fileName: "md500e_20260000_000000.bbl",
      flightDateMs: Date.UTC(2026, 4, 16),
      durationSeconds: 102.9,
      sampleCount: 443_549,
      trackingScore: 87,
      vibrationPeak: 3.8,
      droopRpm: 38.1,
      recordedAtMs: 2_000
    }
  ]);

  assert.equal(collapsed.length, 1, "one physical flight, one row");
  assert.equal(collapsed[0].trackingScore, 87);
  assert.ok(isFinite(collapsed[0].flightDateMs));
});

test("the source hash is the authority in both directions", () => {
  const { sameFlight } = craftHistoryModule;

  // Same bytes: same flight, whatever else disagrees.
  assert.ok(
    sameFlight(
      {
        fileName: "a.bbl",
        sourceHash: "fnv1a-abc-100",
        durationSeconds: 102.9,
        flightDateMs: Date.UTC(2026, 4, 16)
      },
      {
        fileName: "renamed.csv",
        sourceHash: "fnv1a-abc-100",
        durationSeconds: 102.9,
        flightDateMs: null
      }
    )
  );

  // Different bytes: two flights, however alike their shape.
  assert.ok(
    !sameFlight(
      {
        fileName: "a.bbl",
        sourceHash: "fnv1a-abc-100",
        durationSeconds: 102.9,
        sampleCount: 100
      },
      {
        fileName: "a.bbl",
        sourceHash: "fnv1a-def-100",
        durationSeconds: 102.9,
        sampleCount: 100
      }
    )
  );
});

test("two trustworthy dates that disagree veto a shape match", () => {
  const { sameFlight } = craftHistoryModule;

  assert.ok(
    !sameFlight(
      {
        fileName: "hover-one.bbl",
        durationSeconds: 102.9,
        sampleCount: 102_720,
        flightDateMs: Date.UTC(2026, 4, 16, 19, 27, 2)
      },
      {
        fileName: "hover-two.bbl",
        durationSeconds: 102.9,
        sampleCount: 102_720,
        flightDateMs: Date.UTC(2026, 4, 17, 9, 0, 0)
      }
    )
  );
});

test("migrateHistory folds stored duplicates once, on startup", () => {
  const { migrateHistory } = craftHistoryModule;
  const storage = memoryStorage();

  storage.setItem(
    "blackboxLabCraftHistory",
    JSON.stringify({
      md500e: [
        {
          fileName: "md500e_20260000_000000.bbl",
          flightDateMs: null,
          durationSeconds: 102.9,
          sampleCount: 443_549,
          trackingScore: 98
        },
        {
          fileName: "md500e_20260000_000000.bbl",
          flightDateMs: Date.UTC(2026, 4, 16),
          durationSeconds: 102.9,
          sampleCount: 443_549,
          trackingScore: 87
        },
        {
          fileName: "other.bbl",
          flightDateMs: Date.UTC(2026, 4, 17),
          durationSeconds: 240.1,
          sampleCount: 240_100,
          trackingScore: 91
        }
      ]
    })
  );

  assert.equal(migrateHistory(storage), true, "duplicates were found");

  const flights = loadHistory(storage)["md500e"];
  assert.equal(flights.length, 2, "3 rows, 2 physical flights");

  assert.equal(
    migrateHistory(storage),
    false,
    "a clean record is left untouched"
  );
});

test("hashing is line-boundary aware and stable", () => {
  const { hashFlightLines } = craftHistoryModule;

  assert.equal(
    hashFlightLines(["loopIteration,time", "1,2"]),
    hashFlightLines(["loopIteration,time", "1,2"])
  );
  assert.notEqual(
    hashFlightLines(["ab", "c"]),
    hashFlightLines(["a", "bc"])
  );
  assert.equal(hashFlightLines([]), null);
});
