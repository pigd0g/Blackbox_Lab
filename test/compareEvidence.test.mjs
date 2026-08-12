// ======================================================
// COMPARING FLIGHTS — SUBTRACT LIKE FROM LIKE
// ======================================================
//
// A tracking score is measured from clean command
// responses. A flight that recorded almost none still
// produces a score, so subtracting it from a well-flown
// one yields a confident-looking figure that describes the
// evidence gap rather than the flying.
//
// "Consider reverting it" tells a pilot to undo work, so
// it has to rest on something measured on both sides.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  compareFlights,
  comparableEvidence
} from "../src/analysis/compareFlights.js";

const solid = { level: "High", score: 100 };
const thin = { level: "Low", score: 5 };
const none = { level: "Insufficient", score: 0 };

function flight({ score, confidence }) {
  return {
    pidScore: score,
    pidConfidence: confidence,
    spectra: [],
    labs: {},
    batterySagPercent: null
  };
}

test("two well-evidenced flights compare normally", () => {
  const result = compareFlights(
    flight({ score: 78, confidence: solid }),
    flight({ score: 98, confidence: solid })
  );

  const tracking = result.rows.find((row) => row.title === "Tracking");

  assert.equal(tracking.direction, "better");
  assert.match(result.summary, /helped|keeper/i);
});

test("a thin later flight is not called worse", () => {
  const result = compareFlights(
    flight({ score: 98, confidence: solid }),
    flight({ score: 68, confidence: thin })
  );

  const tracking = result.rows.find((row) => row.title === "Tracking");

  assert.equal(
    tracking.direction,
    "unknown",
    "a score built on almost no evidence cannot be ranked against one that is"
  );
  assert.match(tracking.sentence, /cannot be compared/i);
});

test("both scores are still shown when they cannot be compared", () => {
  const result = compareFlights(
    flight({ score: 98, confidence: solid }),
    flight({ score: 68, confidence: thin })
  );

  const tracking = result.rows.find((row) => row.title === "Tracking");

  assert.match(tracking.before, /98/);
  assert.match(tracking.after, /68/);
});

test("reverting is never advised on an uncomparable pair", () => {
  const result = compareFlights(
    flight({ score: 98, confidence: solid }),
    flight({ score: 40, confidence: none })
  );

  assert.doesNotMatch(
    result.summary,
    /revert/i,
    "undoing work must not be advised from an evidence gap"
  );
  assert.match(result.summary, /cannot be compared/i);
});

test("a genuinely worse flight is still called worse", () => {
  const result = compareFlights(
    flight({ score: 95, confidence: solid }),
    flight({ score: 60, confidence: solid })
  );

  assert.match(result.summary, /wrong way|revert/i);
});

test("the reason names which side was thin", () => {
  assert.match(
    comparableEvidence(thin, solid).reason,
    /earlier/i
  );
  assert.match(
    comparableEvidence(solid, thin).reason,
    /later/i
  );
  assert.match(
    comparableEvidence(thin, thin).reason,
    /neither/i
  );
  assert.equal(comparableEvidence(solid, solid).comparable, true);
});

test("a missing confidence is not treated as thin", () => {
  // Older datasets carry no confidence at all; absence of the field
  // must not silently stop every comparison from working.
  assert.equal(comparableEvidence(null, null).comparable, true);
});

test("two different helicopters are not a before and after", () => {
  const result = compareFlights(
    { ...flight({ score: 95, confidence: solid }), craftName: "md500e" },
    { ...flight({ score: 60, confidence: solid }), craftName: "Bell 222UT" }
  );

  assert.doesNotMatch(
    result.summary,
    /revert/i,
    "a different machine is not a change the pilot made"
  );
  assert.match(result.summary, /different helicopters/i);
  assert.equal(result.sameAircraft, false);
});

test("the same helicopter compares as before", () => {
  const result = compareFlights(
    { ...flight({ score: 95, confidence: solid }), craftName: "md500e" },
    { ...flight({ score: 60, confidence: solid }), craftName: "MD500E" }
  );

  assert.equal(result.sameAircraft, true, "the name is matched case-insensitively");
  assert.match(result.summary, /wrong way|revert/i);
});

test("an unnamed craft does not block comparison", () => {
  // Plenty of logs carry no craft name; refusing to compare on that
  // basis would remove the feature from the pilots most likely to
  // need it.
  const result = compareFlights(
    flight({ score: 95, confidence: solid }),
    flight({ score: 60, confidence: solid })
  );

  assert.equal(result.sameAircraft, true);
  assert.match(result.summary, /wrong way|revert/i);
});

// ---- verify-metric rows (v1.1) ----

function verifyDataset({
  events = null,
  governorEvents = null,
  precomp = null
} = {}) {
  return {
    spectra: [],
    labs: {},
    pidScore: null,
    batterySagPercent: null,
    flightEvents: events,
    governorEvents,
    precomp
  };
}

test("stick-response row keeps the recommendation cards' promise", () => {
  const before = verifyDataset({
    events: { summary: { total: 40, clean: 30, overshoot: 4, slow: 6 } }
  });
  const after = verifyDataset({
    events: { summary: { total: 35, clean: 34, overshoot: 1, slow: 0 } }
  });

  const { rows } = compareFlights(before, after);
  const row = rows.find((r) => r.title === "Stick response events");

  assert.ok(row);
  assert.equal(row.direction, "better");
  assert.match(row.sentence, /10 of 40 → 1 of 35/);
});

test("governor excursion row compares counts, zero-both stays calm", () => {
  const noisy = verifyDataset({
    governorEvents: {
      summary: { totalFound: 5, under: 3, over: 2, powerLimit: 0, hunting: 1 }
    }
  });
  const calm = verifyDataset({
    governorEvents: {
      summary: { totalFound: 0, under: 0, over: 0, powerLimit: 0, hunting: 0 }
    }
  });

  const improved = compareFlights(noisy, calm).rows.find(
    (r) => r.title === "Headspeed excursions"
  );
  assert.equal(improved.direction, "better");
  assert.equal(improved.after, "none");

  const bothCalm = compareFlights(calm, calm).rows.find(
    (r) => r.title === "Headspeed excursions"
  );
  assert.equal(bothCalm.direction, "same");
  assert.match(bothCalm.sentence, /both flights/);
});

test("precomp rows appear only when both flights read a balance", () => {
  const read = verifyDataset({
    precomp: {
      governor: { riseDroopPercent: 4.2, dropOvershootPercent: 0.6 },
      tail: { kickRatio: 5.5 }
    }
  });
  const unread = verifyDataset({ precomp: { governor: null, tail: null } });

  const withBoth = compareFlights(
    read,
    verifyDataset({
      precomp: {
        governor: { riseDroopPercent: 1.8, dropOvershootPercent: 0.7 },
        tail: { kickRatio: 1.9 }
      }
    })
  ).rows;

  assert.ok(withBoth.find((r) => r.title === "Collective-rise droop"));
  assert.equal(
    withBoth.find((r) => r.title === "Collective-rise droop").direction,
    "better"
  );
  assert.ok(
    withBoth.find((r) => r.title === "Tail kick on collective moves")
  );

  const withOne = compareFlights(read, unread).rows;
  assert.equal(
    withOne.find((r) => r.title === "Collective-rise droop"),
    undefined
  );
});
