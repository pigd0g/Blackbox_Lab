// ======================================================
// TESTS — pilot-input (stick) display
// ======================================================
//
// The geometry is pure and provable: transmitter-mode
// permutations, clamping, range detection from the log's
// own data, and honest unavailability when a log carries
// no rcCommand telemetry.
//
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  mapStickPositions,
  readPilotInput,
  timeToRowIndex,
  getStickMode,
  setStickMode
} from "../src/ui/stickDisplay.js";

const SCALES = { roll: 500, pitch: 500, yaw: 500, collective: 500 };

test("mode 2 (default): collective left, cyclic right", () => {
  const positions = mapStickPositions(
    { roll: 250, pitch: -500, yaw: 100, collective: 500 },
    2,
    SCALES
  );

  assert.equal(positions.left.x, 0.2, "yaw on left x");
  assert.equal(positions.left.y, 1, "collective on left y");
  assert.equal(positions.right.x, 0.5, "roll on right x");
  assert.equal(positions.right.y, -1, "pitch on right y");
});

test("all four transmitter modes place every axis exactly once", () => {
  const frame = { roll: 100, pitch: 200, yaw: 300, collective: 400 };

  for (const mode of [1, 2, 3, 4]) {
    const positions = mapStickPositions(frame, mode, SCALES);
    const values = [
      positions.left.x,
      positions.left.y,
      positions.right.x,
      positions.right.y
    ].sort((a, b) => a - b);

    assert.deepEqual(
      values,
      [0.2, 0.4, 0.6, 0.8],
      `mode ${mode} carries all four axes`
    );
    assert.equal(positions.labels.left.length, 2);
    assert.equal(positions.labels.right.length, 2);
  }
});

test("deflection is clamped, never drawn outside the gimbal", () => {
  const positions = mapStickPositions(
    { roll: 9000, pitch: -9000, yaw: 0, collective: 0 },
    2,
    SCALES
  );

  assert.equal(positions.right.x, 1);
  assert.equal(positions.right.y, -1);
});

function datasetWith(columns) {
  return {
    findColumnsIn(patterns) {
      return Object.keys(columns).filter((name) =>
        patterns.some((pattern) => pattern.test(name))
      );
    },
    columnValues(name) {
      return columns[name];
    },
    timeSeconds: [0, 0.5, 1, 1.5, 2]
  };
}

test("range is read from the log's own extremes, floored at 500", () => {
  const input = readPilotInput(
    datasetWith({
      "rcCommand[0]": [0, 100, -200, 50, 0],
      "rcCommand[1]": [0, 900, -100, 0, 0],
      "rcCommand[2]": [0, 0, 0, 0, 0],
      "rcCommand[3]": [-500, 0, 500, 0, 0]
    })
  );

  assert.equal(input.available, true);
  assert.equal(input.scales.roll, 500, "calm axis keeps the floor");
  assert.equal(input.scales.pitch, 900, "hot axis widens to its data");
  assert.equal(input.scales.collective, 500);
  assert.deepEqual(input.frameAt(1), {
    roll: 100,
    pitch: 900,
    yaw: 0,
    collective: 0
  });
});

test("a log without rcCommand has no pilot-input evidence", () => {
  const input = readPilotInput(
    datasetWith({
      "setpoint[0]": [1, 2, 3],
      "gyroADC[0]": [1, 2, 3]
    })
  );

  assert.equal(input.available, false);
});

test("timeToRowIndex finds the nearest following row", () => {
  const times = [0, 0.5, 1, 1.5, 2];

  assert.equal(timeToRowIndex(times, -1), 0);
  assert.equal(timeToRowIndex(times, 0.6), 2);
  assert.equal(timeToRowIndex(times, 2), 4);
  assert.equal(timeToRowIndex(times, 99), 4);
  assert.equal(timeToRowIndex([], 1), 0);
});

test("stick mode persists and rejects nonsense", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };

  assert.equal(getStickMode(storage), 2, "default is mode 2");
  setStickMode(4, storage);
  assert.equal(getStickMode(storage), 4);
  setStickMode(9, storage);
  assert.equal(getStickMode(storage), 4, "invalid mode ignored");
});
