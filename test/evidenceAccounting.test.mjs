// ======================================================
// TESTS — evidence accounting tells ONE story (#61, #62)
// ======================================================
//
// A response-behavior Review that says "4 valid events" and a
// confidence line that counts its own evidence must count the
// SAME events; and Technical recommendations must lead with the
// axis that carries the active Review, not with whichever axis
// happened to have the highest average tracking error.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import { analyzePids } from "../src/analysis/pidAnalysis.js";
import { confirmsFromResponseBehavior } from "../src/analysis/recommendationContract.js";

const SAMPLE_RATE = 200;
const SECONDS = 60;

// Roll: distinct 120 deg/s step commands answered by an
// under-damped second-order response — every step overshoots and
// reverses past the target (bounce-back). Pitch: no commands at
// all, but a constant gyro offset, so its AVERAGE tracking error
// is the highest of the three axes.
function buildFixture() {
  const header =
    "loopIteration,time,setpoint[0],setpoint[1],setpoint[2]," +
    "gyroADC[0],gyroADC[1],gyroADC[2],headspeed";
  const lines = [header];
  const rowCount = SAMPLE_RATE * SECONDS;

  let y = 0;
  let v = 0;
  const dt = 1 / SAMPLE_RATE;
  const wn = 2 * Math.PI * 3; // 3 Hz natural frequency
  const zeta = 0.2; // lightly damped → overshoot + bounce-back

  for (let row = 0; row < rowCount; row += 1) {
    const t = row / SAMPLE_RATE;
    const phase = t % 5;
    const target = phase >= 1 && phase < 3 ? 120 : 0;

    const a = wn * wn * (target - y) - 2 * zeta * wn * v;
    v += a * dt;
    y += v * dt;

    lines.push(
      [
        row,
        Math.round(t * 1_000_000),
        target.toFixed(1),
        "0",
        "0",
        y.toFixed(2),
        "35", // pitch gyro sits 35 deg/s off a zero target
        "0",
        "1800"
      ].join(",")
    );
  }

  const allColumns = header.split(",");
  const analysisContext = {
    telemetry: { allColumns },
    flight: { telemetryHeaderIndex: 0 }
  };
  const sampleIndexes = [];
  for (let row = 1; row <= rowCount; row += 1) sampleIndexes.push(row);

  return {
    analysisContext,
    lines,
    headspeedProfiles: [{ targetRpm: 1800, sampleIndexes }]
  };
}

const fixture = buildFixture();
const result = analyzePids(fixture.analysisContext, fixture.lines, fixture.headspeedProfiles);

// The under-damped roll answers every step with overshoot and a
// long hunt — whichever response check crosses its bar first is
// the Review the rest of the tests follow.
const rollReview = (result.responseBehavior ?? []).find(
  (check) => check.axis === "Roll" && check.status === "Review"
);

test("fixture produces a Roll response-behavior Review with counted events", () => {
  assert.ok(rollReview, "a roll response check flagged Review");
  assert.ok(rollReview.eventCount > 0, "events counted");
});

test("#61 the check's structured evidence rows match its quoted event count", () => {
  for (const check of result.responseBehavior ?? []) {
    assert.ok(Array.isArray(check.evidenceRows), `${check.axis} ${check.check} rows`);
    assert.equal(check.evidenceRows.length, check.eventCount);
    const quoted = /^(\d+) valid event/.exec(check.evidence ?? "");
    if (quoted) {
      assert.equal(Number(quoted[1]), check.eventCount, `${check.axis} ${check.check} count`);
    }
    for (const row of check.evidenceRows) {
      assert.equal(row.kind, "command-event");
      assert.equal(row.axis, check.axis);
      assert.ok(Number.isInteger(row.rowIndex), "row anchor present");
    }
  }
});

test("#61 the confirm entry counts the same evidence the finding quotes", () => {
  const confirms = confirmsFromResponseBehavior(result.responseBehavior, []);
  const roll = confirms.find((rec) => rec.axis === "Roll");
  assert.ok(roll, "roll confirm entry");
  const quoted = Number(/(\d+) valid event/.exec(roll.finding)[1]);
  assert.equal(roll.evidenceCount, quoted);
  assert.equal(roll.evidence.length, quoted);
  assert.match(roll.evidenceLabel, new RegExp(`^${quoted} valid Roll ${rollReview.check} events`));
  assert.doesNotMatch(roll.evidenceLabel, /\b0 /);
});

test("#62 Technical recommendations lead with the Review axis; tracking-error rank is secondary", () => {
  const lines = result.recommendations ?? [];
  assert.ok(lines.length > 0);
  assert.match(lines[0], new RegExp(`^Roll ${rollReview.check} is the current Review finding`));
  assert.match(lines[0], /No PID change is earned yet/);
  assert.match(lines[0], /roll inputs/i);
  // The generic lead never stands on its own any more …
  assert.ok(
    !lines.some((line) => /^No command-balance or PID-term saturation review condition was identified\. If further tuning is desired, compare/.test(line)),
    "generic tracking-error lead must not displace the Review"
  );
  // … but the observation stays visible, labeled secondary.
  const secondary = lines.find((line) => /^Secondary context: Pitch had the highest average tracking error/.test(line));
  assert.ok(secondary, "pitch tracking-error observation kept as secondary context");
  assert.equal(lines.indexOf(secondary), lines.length - 1);
});
