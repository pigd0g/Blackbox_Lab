// ======================================================
// BLACKBOX LAB — GOVERNOR EVENTS TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// This module MEASURES, so the fixtures are synthetic
// flights with planted excursions: known depth, known
// duration, known collective context. The tests pin what
// counts as an event, how it is classified, and what the
// pilot-facing sentence says.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectGovernorEvents,
  governorEventWindow,
  GOVERNOR_EVENT_TUNING
} from "../src/analysis/governorEvents.js";

const SAMPLE_RATE = 100; // 100 Hz keeps fixtures small and honest
const TARGET_RPM = 2000;

// A governed flight: spool-up to target, cruise, spool-down.
// Callers plant excursions on top of the cruise section.
function buildFlight({
  seconds = 120,
  target = TARGET_RPM
} = {}) {
  const sampleCount = seconds * SAMPLE_RATE;

  const timeSeconds = Array.from(
    { length: sampleCount },
    (_, index) => index / SAMPLE_RATE
  );

  const headspeed = new Array(sampleCount).fill(target);
  const governorTarget = new Array(sampleCount).fill(target);

  // Spool-up ramp for the first 10 s, spool-down for the last 5.
  // Rotorflight ramps the governor TARGET during spool, and the
  // rotor follows it — the fixture mirrors that, so spool edges
  // carry no artificial tracking error.
  for (let index = 0; index < 10 * SAMPLE_RATE; index += 1) {
    const ramp = (target * index) / (10 * SAMPLE_RATE);
    headspeed[index] = ramp;
    governorTarget[index] = ramp;
  }

  for (let index = sampleCount - 5 * SAMPLE_RATE; index < sampleCount; index += 1) {
    const ramp = (target * (sampleCount - index)) / (5 * SAMPLE_RATE);
    headspeed[index] = ramp;
    governorTarget[index] = ramp;
  }

  return { timeSeconds, headspeed, governorTarget };
}

// Plant a dip/overspeed of errorPercent for durationSeconds,
// starting at startSecond. Positive = below target (droop).
function plantExcursion(
  flight,
  { startSecond, durationSeconds, errorPercent }
) {
  const start = Math.round(startSecond * SAMPLE_RATE);
  const end = Math.round(
    (startSecond + durationSeconds) * SAMPLE_RATE
  );

  for (let index = start; index < end; index += 1) {
    const target = flight.governorTarget[index];
    flight.headspeed[index] =
      target - (target * errorPercent) / 100;
  }
}

function flatSeries(length, value) {
  return new Array(length).fill(value);
}

test("clean flight produces zero events and says so", () => {
  const flight = buildFlight();

  const result = detectGovernorEvents(flight);

  assert.ok(result);
  assert.equal(result.events.length, 0);
  assert.match(result.summary.sentence, /No sustained/);
});

test("a sustained dip below target becomes one under event", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 1.2,
    errorPercent: 8
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 1);

  const [event] = result.events;
  assert.equal(event.kind, "under");
  assert.ok(Math.abs(event.t - 40) < 0.5, `t=${event.t}`);
  assert.ok(
    event.peakErrorPercent > 6.5 && event.peakErrorPercent <= 8.5,
    `peak=${event.peakErrorPercent}`
  );
  assert.ok(event.durationMs > 800, `duration=${event.durationMs}`);
  assert.equal(event.targetRpm, TARGET_RPM);
  assert.match(result.summary.sentence, /1 headspeed excursion/);
});

test("an overspeed becomes an over event", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 60,
    durationSeconds: 1,
    errorPercent: -7
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "over");
  assert.match(result.summary.sentence, /1 above target/);
});

test("short blips below the minimum duration are ignored", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 50,
    durationSeconds: 0.1,
    errorPercent: 9
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 0);
});

test("excursions inside the enter band are not events", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 50,
    durationSeconds: 2,
    errorPercent: GOVERNOR_EVENT_TUNING.ENTER_ERROR_PERCENT - 1.5
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 0);
});

test("spool-up is never an event however large the error", () => {
  // During spool-up the actual runs far below target by
  // construction; in-flight detection must exclude it.
  const flight = buildFlight();

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 0);
});

test("output at ceiling classifies an under event as power-limit", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 1.5,
    errorPercent: 9
  });

  const motorOutput = flatSeries(flight.headspeed.length, 600); // of 1000
  const start = 40 * SAMPLE_RATE;
  const end = 41.5 * SAMPLE_RATE;

  for (let index = start; index < end; index += 1) {
    motorOutput[index] = 990;
  }

  const result = detectGovernorEvents({ ...flight, motorOutput });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].cause, "power-limit");
  assert.ok(result.events[0].outputMaxPercent >= 95);
  assert.match(result.events[0].story, /power system/);
  assert.match(result.summary.sentence, /power-system limit/);
});

test("a dip after a collective rise classifies as load", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 1.5,
    errorPercent: 8
  });

  // Collective sits low, rises sharply just before the dip.
  const collective = flatSeries(flight.headspeed.length, 100);

  for (
    let index = Math.round(39.6 * SAMPLE_RATE);
    index < flight.headspeed.length;
    index += 1
  ) {
    collective[index] = 700;
  }

  const result = detectGovernorEvents({ ...flight, collective });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].cause, "load");
  assert.equal(result.events[0].collectiveBefore, "rise");
  assert.match(result.events[0].story, /collective increase/);
});

test("an overspeed after a collective drop classifies as collective-drop", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 60,
    durationSeconds: 1,
    errorPercent: -7.5
  });

  const collective = flatSeries(flight.headspeed.length, 700);

  for (
    let index = Math.round(59.6 * SAMPLE_RATE);
    index < flight.headspeed.length;
    index += 1
  ) {
    collective[index] = 100;
  }

  const result = detectGovernorEvents({ ...flight, collective });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].cause, "collective-drop");
  assert.match(result.events[0].story, /collective drop/);
  assert.match(result.events[0].story, /feedforward\/precomp/);
});

test("post-event oscillation sets the hunting flag", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 60,
    durationSeconds: 1,
    errorPercent: -7
  });

  // After the overspeed ends at 61 s, the rotor circles the
  // target: ±2.5% swings at 2 Hz for 1.5 s.
  const start = Math.round(61 * SAMPLE_RATE);
  const end = Math.round(62.5 * SAMPLE_RATE);

  for (let index = start; index < end; index += 1) {
    const seconds = index / SAMPLE_RATE - 61;
    const swing =
      Math.sin(seconds * 2 * Math.PI * 2) * 0.025 * TARGET_RPM;
    flight.headspeed[index] = TARGET_RPM + swing;
  }

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].hunting, true);
  assert.match(result.events[0].story, /hunting/);
  assert.match(result.summary.sentence, /hunting afterwards/);
});

test("two dips separated by a real gap stay two events", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 1,
    errorPercent: 8
  });
  plantExcursion(flight, {
    startSecond: 45,
    durationSeconds: 1,
    errorPercent: 8
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 2);
});

test("headspeed-only logs return null — no target, no excursions", () => {
  const flight = buildFlight();

  const result = detectGovernorEvents({
    timeSeconds: flight.timeSeconds,
    headspeed: flight.headspeed,
    governorTarget: flatSeries(flight.headspeed.length, 0)
  });

  assert.equal(result, null);
});

test("event window contains the whole excursion with context", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 2,
    errorPercent: 8
  });

  const result = detectGovernorEvents(flight);
  const window = governorEventWindow(result.events[0]);

  assert.ok(window.min < result.events[0].t);
  assert.ok(window.max > result.events[0].tEnd);
});

test("worst event and summary agree", () => {
  const flight = buildFlight();
  plantExcursion(flight, {
    startSecond: 40,
    durationSeconds: 1,
    errorPercent: 6
  });
  plantExcursion(flight, {
    startSecond: 70,
    durationSeconds: 1,
    errorPercent: 11
  });

  const result = detectGovernorEvents(flight);

  assert.equal(result.events.length, 2);
  assert.ok(
    result.summary.worst.peakErrorPercent >
      result.events[0].peakErrorPercent ||
      result.summary.worst === result.events[1]
  );
  assert.match(
    result.summary.sentence,
    /Worst: 1[01](\.\d)?% below target/
  );
});
