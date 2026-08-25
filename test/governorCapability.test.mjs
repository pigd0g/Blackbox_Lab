// ======================================================
// TESTS — governor capability states (full / partial /
// unavailable) and the surfaces that render from them
// ======================================================
//
// A missing governor target must reduce the scope of the
// conclusion, never inflate it: no "/100" without a real
// score, no "good" chip for an unjudged system, and no
// "droop" wording without a target to droop against.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzeGovernorLab } from "../src/analysis/governorLabAnalysis.js";
import { describeGovernorSystemScore } from "../src/analysis/logAnalysisBuilder.js";
import { buildReportHtml } from "../src/ui/reportBuilder.js";
import { compareFlights } from "../src/analysis/compareFlights.js";

const SAMPLE_RATE = 100;

function flight({ withTarget }) {
  const timeSeconds = [];
  const headspeed = [];
  const governorTarget = [];

  for (let i = 0; i < 90 * SAMPLE_RATE; i += 1) {
    const seconds = i / SAMPLE_RATE;
    timeSeconds.push(seconds);

    const spooling = seconds < 4;
    const rpm = spooling
      ? 1800 * (seconds / 4)
      : 1800 + ((i % 7) - 3);

    headspeed.push(rpm);
    governorTarget.push(withTarget && !spooling ? 1800 : 0);
  }

  return { timeSeconds, headspeed, governorTarget };
}

test("a governed flight reports full capability with a numeric score", () => {
  const result = analyzeGovernorLab(flight({ withTarget: true }));

  assert.equal(result.capability, "full");
  assert.ok(Number.isFinite(result.score));
});

test("a target-less flight reports partial capability, no score, no droop wording", () => {
  const result = analyzeGovernorLab(flight({ withTarget: false }));

  assert.equal(result.capability, "partial");
  assert.equal(result.score, null);
  assert.equal(result.mode, "headspeed-hold");

  // The word "droop" is target-relative and stays out of every
  // user-facing string in partial mode.
  assert.ok(!/droop/i.test(result.story), result.story);
  for (const metric of result.metrics) {
    assert.ok(!/droop/i.test(metric.label), metric.label);
    assert.ok(!/droop/i.test(String(metric.value)), metric.label);
  }

  // The scope is stated outright, first.
  assert.equal(result.metrics[0].label, "Analysis scope");
  assert.match(result.metrics[0].value, /Partial/);
});

test("System Scores never renders null/100 or a quality label without a score", () => {
  const partial = analyzeGovernorLab(flight({ withTarget: false }));
  const partialLine = describeGovernorSystemScore(partial);

  assert.ok(!partialLine.includes("null"), partialLine);
  assert.ok(!partialLine.includes("/100"), partialLine);
  assert.match(partialLine, /Partial: headspeed stability only/);

  const insufficientLine = describeGovernorSystemScore({
    score: null,
    status: "insufficient",
    capability: "unavailable"
  });

  assert.ok(!insufficientLine.includes("null"), insufficientLine);
  assert.match(insufficientLine, /Not scored/);

  const full = analyzeGovernorLab(flight({ withTarget: true }));
  assert.match(
    describeGovernorSystemScore(full),
    /^\d+\/100 \(/
  );

  // Legacy statuses keep their N/A-style honesty.
  assert.match(
    describeGovernorSystemScore({
      score: 0,
      status: "Target Unavailable"
    }),
    /Not scored: Target Unavailable/
  );
});

test("the exported report renders unknown statuses as Not evaluated, never Looks good", () => {
  const html = buildReportHtml({
    fileName: "test.bbl",
    craftName: null,
    firmware: null,
    durationSeconds: 90,
    verdict: { cards: [] },
    labs: [
      {
        title: "Governor Lab",
        analysis: {
          status: "insufficient",
          story: "No stable governed-flight section was long enough.",
          metrics: []
        }
      }
    ],
    chartElements: []
  });

  assert.match(html, /Not evaluated/);
  assert.ok(
    !/Governor Lab<\/span>\s*<span[^>]*>Looks good/.test(html),
    "insufficient lab must not wear the Looks good chip"
  );
});

test("Compare Flights speaks swing, not droop, when either flight lacks a target", () => {
  const governed = {
    labs: { governor: analyzeGovernorLab(flight({ withTarget: true })) },
    spectra: [],
    pidScore: null
  };
  const ungoverned = {
    labs: { governor: analyzeGovernorLab(flight({ withTarget: false })) },
    spectra: [],
    pidScore: null
  };

  const mixed = compareFlights(governed, ungoverned);
  const rotorRow = mixed.rows.find(
    (row) => row.title === "Headspeed hold"
  );

  assert.ok(rotorRow, "headspeed row present");
  assert.ok(!/droop/i.test(rotorRow.before), rotorRow.before);
  assert.ok(!/droop/i.test(rotorRow.after), rotorRow.after);
  assert.ok(!/droop/i.test(rotorRow.sentence), rotorRow.sentence);

  const bothGoverned = compareFlights(governed, governed);
  const governedRow = bothGoverned.rows.find(
    (row) => row.title === "Headspeed hold"
  );

  assert.match(governedRow.before, /droop/i);
});
