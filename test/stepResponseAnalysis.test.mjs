// ======================================================
// BLACKBOX LAB — STEP RESPONSE ANALYSIS TESTS
// ======================================================
//
// Run with: npm test
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeFlightStepResponse,
  analyzeAllFlightsStepResponse
} from "../src/analysis/stepResponseAnalysis.js";

function buildCsvLines({
  sampleRate = 1000,
  durationSeconds = 6,
  setpointGenerator,
  gyroGenerator
} = {}) {
  const totalSamples = Math.round(sampleRate * durationSeconds);
  const headers = [
    "time",
    "setpoint[0]",
    "setpoint[1]",
    "setpoint[2]",
    "gyroADC[0]",
    "gyroADC[1]",
    "gyroADC[2]"
  ];

  const lines = [headers.join(",")];

  for (let i = 0; i < totalSamples; i += 1) {
    const t = Math.round((i / sampleRate) * 1_000_000);
    const setpoint = setpointGenerator ? setpointGenerator(i) : [0, 0, 0];
    const gyro = gyroGenerator ? gyroGenerator(i, setpoint) : [0, 0, 0];
    lines.push([t, ...setpoint, ...gyro].join(","));
  }

  return lines;
}

function randomWalkCommands(sampleRate, totalSamples, amplitude = 100) {
  const commands = [new Array(totalSamples).fill(0), new Array(totalSamples).fill(0), new Array(totalSamples).fill(0)];
  const state = [0, 0, 0];

  for (let axis = 0; axis < 3; axis += 1) {
    for (let i = 0; i < totalSamples; i += 1) {
      const change = (Math.random() - 0.5) * amplitude * 0.4;
      state[axis] += change;
      state[axis] = Math.max(-amplitude, Math.min(amplitude, state[axis]));
      commands[axis][i] = state[axis];
    }
  }

  return commands;
}

function applyFirstOrderModel(setpoint, sampleRate, timeConstantMs) {
  const dt = 1 / sampleRate;
  const alpha = dt / (timeConstantMs / 1000 + dt);
  const output = new Array(setpoint.length).fill(0);
  const result = [];

  for (let i = 0; i < setpoint.length; i += 1) {
    output[i] += alpha * (setpoint[i] - output[i]);
    result.push(output[i]);
  }

  return result;
}

test("analyzeFlightStepResponse returns axis results for realistic commands", () => {
  const sampleRate = 1000;
  const durationSeconds = 6;
  const commands = randomWalkCommands(sampleRate, sampleRate * durationSeconds, 120);

  const lines = buildCsvLines({
    sampleRate,
    durationSeconds,
    setpointGenerator: (i) => [commands[0][i], commands[1][i], commands[2][i]],
    gyroGenerator: (i, setpoint) => [
      applyFirstOrderModel([setpoint[0]], sampleRate, 40)[0],
      applyFirstOrderModel([setpoint[1]], sampleRate, 60)[0],
      applyFirstOrderModel([setpoint[2]], sampleRate, 80)[0]
    ]
  });

  const result = analyzeFlightStepResponse(lines, {
    smoothFactor: 1,
    yCorrection: true,
    minInput: 20
  });

  assert.equal(result.axes.length, 3);

  const roll = result.axes.find((axis) => axis.axis === "Roll");
  assert.ok(roll.available, "Roll axis should have usable data");
  assert.ok(roll.numSegments > 0, "Roll should have segments");
  assert.ok(roll.timeMs.length > 0, "Roll should have time values");
  assert.ok(roll.stepResponse.length > 0, "Roll should have response values");
  assert.ok(Number.isFinite(roll.metrics.riseTimeMs), "Roll rise time should be finite");

  const pitch = result.axes.find((axis) => axis.axis === "Pitch");
  assert.ok(pitch.available, "Pitch axis should have usable data");

  const yaw = result.axes.find((axis) => axis.axis === "Yaw");
  assert.ok(yaw.available, "Yaw axis should have usable data");
  assert.ok(yaw.numSegments > 0, "Yaw should have segments");
});

test("analyzeAllFlightsStepResponse aggregates multiple flights", () => {
  const sampleRate = 1000;
  const durationSeconds = 5;

  const makeFlight = () => {
    const commands = randomWalkCommands(sampleRate, sampleRate * durationSeconds, 120);
    return buildCsvLines({
      sampleRate,
      durationSeconds,
      setpointGenerator: (i) => [commands[0][i], commands[1][i], commands[2][i]],
      gyroGenerator: (i, setpoint) => [
        applyFirstOrderModel([setpoint[0]], sampleRate, 50)[0],
        applyFirstOrderModel([setpoint[1]], sampleRate, 50)[0],
        applyFirstOrderModel([setpoint[2]], sampleRate, 50)[0]
      ]
    });
  };

  const logData = {
    flights: [
      { label: "Flight 1", lines: makeFlight() },
      { label: "Flight 2", lines: makeFlight() }
    ]
  };

  const { aggregated, perFlight } = analyzeAllFlightsStepResponse(logData);

  assert.equal(perFlight.length, 2);
  assert.ok(aggregated, "Should produce aggregated result");
  assert.equal(aggregated.axes.length, 3);

  const roll = aggregated.axes.find((axis) => axis.axis === "Roll");
  assert.ok(roll.available, "Aggregated Roll should be available");
  assert.ok(roll.numSegments > 0, "Aggregated Roll should have segments");
});

test("returns unavailable result when setpoint or gyro columns are missing", () => {
  const lines = [
    "time,gyroADC[0],gyroADC[1],gyroADC[2]",
    "0,0,0,0",
    "1000,0,0,0"
  ];

  const result = analyzeFlightStepResponse(lines);
  assert.equal(result.axes.length, 0);
});

test("extracts PID values from CSV-shaped header lines", () => {
  const sampleRate = 1000;
  const durationSeconds = 6;
  const commands = randomWalkCommands(sampleRate, sampleRate * durationSeconds, 120);

  const lines = [
    '"rollPID","52,105,0,100,0"',
    '"pitchPID","64,111,40,100,0"',
    '"yawPID","315,145,29,3,1"',
    ...buildCsvLines({
      sampleRate,
      durationSeconds,
      setpointGenerator: (i) => [commands[0][i], commands[1][i], commands[2][i]],
      gyroGenerator: (i, setpoint) => [
        applyFirstOrderModel([setpoint[0]], sampleRate, 40)[0],
        applyFirstOrderModel([setpoint[1]], sampleRate, 60)[0],
        applyFirstOrderModel([setpoint[2]], sampleRate, 80)[0]
      ]
    })
  ];

  const result = analyzeFlightStepResponse(lines, {
    smoothFactor: 1,
    yCorrection: true,
    minInput: 20
  });

  const roll = result.axes.find((axis) => axis.axis === "Roll");
  assert.deepEqual(roll.pid, {
    p: 52,
    i: 105,
    d: 0,
    f: 100,
    boost: 0,
    dMin: null
  });

  const pitch = result.axes.find((axis) => axis.axis === "Pitch");
  assert.deepEqual(pitch.pid, {
    p: 64,
    i: 111,
    d: 40,
    f: 100,
    boost: 0,
    dMin: null
  });

  const yaw = result.axes.find((axis) => axis.axis === "Yaw");
  assert.deepEqual(yaw.pid, {
    p: 315,
    i: 145,
    d: 29,
    f: 3,
    boost: 1,
    dMin: null
  });
});
