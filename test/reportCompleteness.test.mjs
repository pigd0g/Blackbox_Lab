// ======================================================
// TESTS — the report says what it could not judge
// ======================================================
//
// A shared report is read by people who never saw the app.
// Inside the app, the Log Quality gate says what this log
// could and could not support; the exported report must say
// the same, or its reader cannot tell "this area was fine"
// from "this area was never judged".
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { buildReportHtml } from "../src/ui/reportBuilder.js";

const BASE = {
  fileName: "flight.bbl",
  craftName: "Test Heli",
  firmware: "Rotorflight 4.6.0",
  durationSeconds: 180,
  verdict: { summary: "Looks healthy overall.", cards: [] },
  labs: [],
  chartElements: []
};

test("a missing area is stated as unjudged, not silently absent", () => {
  const html = buildReportHtml({
    ...BASE,
    quality: {
      summary:
        "This log limits some analyses — the notes below say what to enable for the full picture.",
      capabilities: [
        {
          name: "Vibration & filters",
          level: "full",
          note: "Unfiltered + filtered gyro at a healthy rate."
        },
        {
          name: "Governor",
          level: "missing",
          note: "No headspeed in this log — enable RPM telemetry to unlock governor analysis."
        }
      ],
      warnings: []
    }
  });

  assert.match(html, /What This Report Is Based On/);
  assert.match(html, /No judgment was possible on this area/);
  assert.match(html, /enable RPM telemetry/);
  assert.match(html, /NO JUDGMENT/);
  assert.match(
    html,
    /fully\s+qualified report depends on all telemetry/
  );
});

test("a complete log reports full data without unjudged areas", () => {
  const html = buildReportHtml({
    ...BASE,
    quality: {
      summary:
        "This log is excellent — every analysis has the data it needs.",
      capabilities: [
        { name: "Vibration & filters", level: "full", note: "All there." },
        { name: "Governor", level: "full", note: "All there." },
        { name: "Battery & ESC", level: "full", note: "All there." }
      ],
      warnings: []
    }
  });

  assert.match(html, /every analysis has the data it needs/);
  assert.ok(
    !/No judgment was possible/.test(html),
    "a complete log has no unjudged areas"
  );
});

test("without a quality assessment the report builds as before", () => {
  const html = buildReportHtml(BASE);

  assert.ok(!/What This Report Is Based On/.test(html));
  assert.match(html, /Blackbox Lab · Flight Report/);
});
