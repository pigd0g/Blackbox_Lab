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

// ------------------------------------------------------
// Parity: what Home shows, the report carries — the to-do list,
// the change pack (or why it is empty), labs that could not run.
// ------------------------------------------------------
test("the report carries Home's What To Do First, including what was not measured", () => {
  const html = buildReportHtml({
    ...BASE,
    firstSteps: {
      entries: [
        { screen: "pid", title: "Tuning", text: "Try one small step up on roll_d_gain.", tone: "watch" },
        { screen: "battery", title: "Battery", text: "Nothing to change for the pack.", tone: "clear" }
      ],
      gapEntries: [
        { screen: "battery", title: "Power & ESC · Battery", text: "Current was not measured: check the current sensor's wiring and scale, or add one.", tone: "info" }
      ]
    }
  });
  assert.match(html, /What To Do First/);
  assert.match(html, /Try one small step up on roll_d_gain/);
  assert.doesNotMatch(html, /Nothing to change for the pack/, "clear rows are summarized, not listed — as on Home");
  assert.match(html, /Not measured on this flight/);
  assert.match(html, /check the current sensor/);
});

test("the change pack travels: members, waiting list, evidence flights — or the empty-state sentence", () => {
  const full = buildReportHtml({
    ...BASE,
    pack: {
      intro: "1 change earned by this flight.",
      members: [{ setting: "roll_d_gain", from: 15, to: 20, meaning: "Roll damping.", finding: "Roll settled slowly.", instrument: "pid.roll.settle", expectedResult: "settling drops" }],
      queued: [{ family: "pitch_d_gain", reason: "pack is full — next pack" }],
      prescriptions: ["Repeat 4-6 deliberate yaw stops at the same headspeed."],
      headspeedNote: null,
      empty: false
    }
  });
  assert.match(full, /This Flight's Change Pack/);
  assert.match(full, /roll_d_gain<\/code> 15 → 20/);
  assert.match(full, /Verified by: pid\.roll\.settle/);
  assert.match(full, /Waiting for the next pack/);
  assert.match(full, /pitch_d_gain/);
  assert.match(full, /Evidence flights wanted/);
  assert.match(full, /deliberate yaw stops/);

  const empty = buildReportHtml({
    ...BASE,
    pack: { intro: "No change is earned from this flight, and nothing is queued. Roll flew only 2 clean commands.", members: [], queued: [], prescriptions: [], empty: true }
  });
  assert.match(empty, /No change is earned from this flight/);
  assert.doesNotMatch(empty, /Waiting for the next pack/);
});

test("a lab that could not run is stated in the report, in its page's own words", () => {
  const html = buildReportHtml({
    ...BASE,
    labs: [
      { title: "Signal Lab", analysis: null, absent: "This log carries no link telemetry (no signal strength and no receiver flags), so radio-link health cannot be assessed." },
      { title: "ESC Lab", analysis: { status: "good", story: "Healthy headroom.", metrics: [{ label: "Reserve", value: "18%" }] } }
    ]
  });
  assert.match(html, /Signal Lab/);
  assert.match(html, /Not logged/);
  assert.match(html, /no link telemetry/);
  assert.match(html, /Healthy headroom/);
});

test("not-logged verdict cards and capability gaps travel with the verdict", () => {
  const html = buildReportHtml({
    ...BASE,
    verdict: {
      summary: "Looks healthy.",
      cards: [
        { key: "battery", title: "Battery", status: "good", headline: "Battery held up well", detail: "3.9 V/cell.", action: "Nothing to change.", gap: "Voltage only.", gapShort: "current (no usable sensor reading)", gapAction: "Check the current sensor's wiring and scale, or add one." },
        { key: "bec", title: "BEC Output", status: "unavailable", statusLabel: "not logged", headline: "BEC voltage not logged", detail: "No BEC voltage in this log.", action: "Enable BEC voltage telemetry." }
      ]
    }
  });
  assert.match(html, /Not measured:<\/b> current \(no usable sensor reading\) — Check the current sensor/);
  assert.match(html, /BEC voltage not logged/);
  assert.match(html, /not logged/);
});

test("What To Do First keeps the order it was handed — the blocking finding stays first (#66)", () => {
  const html = buildReportHtml({
    ...BASE,
    firstSteps: {
      entries: [
        { screen: "filter", title: "Vibration", text: "Balance and track the main blades.", tone: "attention" },
        { screen: "pid", title: "Tuning", text: "Filters come before PIDs.", tone: "watch" }
      ],
      gapEntries: []
    }
  });
  const vibration = html.indexOf("Balance and track the main blades");
  const tuning = html.indexOf("Filters come before PIDs");
  assert.ok(vibration >= 0 && tuning >= 0);
  assert.ok(vibration < tuning, "vibration must precede tuning in the report");
});
