// ======================================================
// TESTS — telemetry inventory counts usable data, not headers
// ======================================================
//
// A column can exist and carry nothing: an EscI field whose
// every sample is zero is a header, not a current sensor.
// The telemetry score must judge what the labs can actually
// use, so a present-but-empty channel (marked by its third
// tuple element) counts as missing — while a populated one
// counts normally.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { analyzeTelemetry } from "../src/analysis/telemetryAnalysis.js";

const fullSet = [
  ["Time", "time (us)"],
  ["Battery Voltage", "Vbat"],
  ["Current", "EscI"],
  ["ESC Output", "escThr"],
  ["ESC RPM", "escRPM"],
  ["Headspeed", "headspeed"],
  ["ESC Temperature", "tESC"],
  ["Governor P", "govP"],
  ["Governor I", "govI"],
  ["Governor D", "govD"],
  ["Governor Target", "govTarget"]
];

test("a populated channel set scores on all channels", () => {
  const result = analyzeTelemetry(fullSet);

  assert.equal(result.foundCount, 11);
  assert.equal(result.score, 100);
});

test("a present-but-empty channel does not count as found", () => {
  const withEmptyCurrent = fullSet.map(([label, header]) =>
    label === "Current"
      ? [label, header, "present, no usable data"]
      : [label, header]
  );

  const result = analyzeTelemetry(withEmptyCurrent);

  assert.equal(result.foundCount, 10);
  assert.ok(result.score < 100);
});

test("empty and absent channels score the same", () => {
  const withEmptyCurrent = fullSet.map(([label, header]) =>
    label === "Current"
      ? [label, header, "present, no usable data"]
      : [label, header]
  );
  const withoutCurrent = fullSet.map(([label, header]) =>
    label === "Current" ? [label, null] : [label, header]
  );

  assert.equal(
    analyzeTelemetry(withEmptyCurrent).score,
    analyzeTelemetry(withoutCurrent).score
  );
});
