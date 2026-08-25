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

// ---- voltage source cross-check (v1.1.x) ----

import { chooseVoltageSource } from "../src/analysis/batteryLabAnalysis.js";

test("disagreeing ESC voltage yields to the FC's pack reading, with a note", () => {
  // ESC reports ~32 V while the FC reads ~26 V — a 6S HV pack.
  const escVoltage = new Array(500).fill(3228);
  const vbat = new Array(500).fill(2618);

  const { selected, note } = chooseVoltageSource(escVoltage, vbat);

  assert.equal(selected, vbat);
  assert.match(note, /disagrees/);
  assert.match(note, /calibration/);
});

test("agreeing sources keep the ESC's reading, no note", () => {
  const escVoltage = new Array(500).fill(2615);
  const vbat = new Array(500).fill(2618);

  const { selected, note } = chooseVoltageSource(escVoltage, vbat);

  assert.equal(selected, escVoltage);
  assert.equal(note, null);
});

test("a single usable source is used as before", () => {
  const escOnly = chooseVoltageSource(new Array(500).fill(2500), null);
  assert.ok(escOnly.selected);
  assert.equal(escOnly.note, null);

  const fcOnly = chooseVoltageSource(null, new Array(500).fill(2500));
  assert.ok(fcOnly.selected);
  assert.equal(fcOnly.note, null);
});

test("a regression from a zero baseline is never 'about the same'", () => {
  const clean = verifyDataset({
    events: { summary: { total: 40, clean: 40, overshoot: 0, slow: 0 } },
    governorEvents: { summary: { totalFound: 0, under: 0, over: 0, powerLimit: 0, hunting: 0 } }
  });
  const rough = verifyDataset({
    events: { summary: { total: 35, clean: 25, overshoot: 6, slow: 4 } },
    governorEvents: { summary: { totalFound: 8, under: 5, over: 3, powerLimit: 0, hunting: 2 } }
  });

  const rows = compareFlights(clean, rough).rows;

  const excursions = rows.find((r) => r.title === "Headspeed excursions");
  assert.equal(excursions.direction, "worse", excursions.sentence);

  const events = rows.find((r) => r.title === "Stick response events");
  assert.equal(events.direction, "worse", events.sentence);
});

test("unit differences are not disagreements — the cross-check is scale-free", () => {
  // A 2S micro: FC logs decivolts (avg 76 raw = 7.6 V), ESC logs
  // volts (7.6). Same pack, different units — no conflict, ESC
  // preferred as before.
  const escVoltage = new Array(500).fill(7.6);
  const vbat = new Array(500).fill(76);

  const { selected, note } = chooseVoltageSource(escVoltage, vbat);
  assert.equal(selected, escVoltage);
  assert.equal(note, null);

  // Decade-boundary readings that agree must not fake a conflict.
  const nearTen = chooseVoltageSource(
    new Array(500).fill(9.8),
    new Array(500).fill(10.2)
  );
  assert.equal(nearTen.note, null);
});

// ---- #32: the comparability assessment is exposed, and weak footing
// downgrades causal wording ----

import { assessComparability, compareFlights as compareForComparability } from "../src/analysis/compareFlights.js";

test("matched demand and axis evidence reads comparable", () => {
  const side = (demand) => ({
    pidConfidence: { level: "High", demand },
    axisEvidence: { Roll: 12, Pitch: 10, Yaw: 9 },
    timeSeconds: [0, 100]
  });
  const result = assessComparability(side("normal"), side("normal"));
  assert.equal(result.level, "comparable");
  assert.equal(result.causal, true);
});

test("a demand mismatch is weak and says why", () => {
  const side = (demand) => ({
    pidConfidence: { level: "High", demand },
    axisEvidence: { Roll: 12 },
    timeSeconds: [0, 100]
  });
  const result = assessComparability(side("gentle"), side("normal"));
  assert.equal(result.level, "weak");
  assert.equal(result.causal, false);
  assert.ok(result.lines.some((line) => /NOT comparable/.test(line)));
  assert.match(result.guidance, /observations, not proof/);
});

test("one-sided axis evidence is partial", () => {
  const before = {
    pidConfidence: { level: "High", demand: "normal" },
    axisEvidence: { Roll: 12, Yaw: 2 },
    timeSeconds: [0, 100]
  };
  const after = {
    pidConfidence: { level: "High", demand: "normal" },
    axisEvidence: { Roll: 11, Yaw: 14 },
    timeSeconds: [0, 100]
  };
  const result = assessComparability(before, after);
  assert.equal(result.level, "partial");
  assert.ok(result.lines.some((line) => /too few on one side/.test(line)));
});
