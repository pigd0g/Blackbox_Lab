// ======================================================
// TESTS — Replay offers every logged field as it is (#63)
// ======================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  catalogLogFields,
  groupLogFields,
  describeField,
  fieldGraphKey,
  fieldNameFromKey,
  fieldMatchesSearch,
  fieldHeading
} from "../src/ui/replayFields.js";

const HEADER = [
  "loopIteration", "time",
  "rcCommand[0]", "rcCommand[3]", "setpoint[2]", "setpoint[3]",
  "mixer[2]", "axisP[0]", "axisI[1]", "axisF[2]", "axisB[0]", "axisO[2]",
  "gyroRAW[0]", "gyroADC[2]", "attitude[1]", "accADC[2]",
  "motor[0]", "servo[3]", "govP", "govTarget", "headspeed",
  "EscV", "Esc2I", "BecV", "Vbec", "Tesc", "rssi", "debug[7]",
  "GPS_numSat", "flightModeFlags", "somethingNew"
];

test("the catalog comes from the header: time excluded, unknown fields kept", () => {
  const names = catalogLogFields(HEADER).map((entry) => entry.name);
  assert.ok(!names.includes("time"), "time is the x-axis, not a series");
  assert.ok(names.includes("somethingNew"), "a field the catalog never heard of is still offered");
  assert.equal(new Set(names).size, names.length, "no duplicates");
  assert.equal(names.length, HEADER.length - 1);
});

test("fields land in their Rotorflight families, in tuner order", () => {
  const groups = groupLogFields(HEADER);
  const labels = groups.map((group) => group.label);
  assert.deepEqual(labels.slice(0, 5), ["Commands", "Setpoints", "PID terms", "Gyro", "Mixer inputs"]);
  assert.equal(labels[labels.length - 1], "Other logged fields");
  const pid = groups.find((group) => group.label === "PID terms");
  assert.deepEqual(pid.fields.map((f) => f.name), ["axisP[0]", "axisI[1]", "axisF[2]", "axisB[0]", "axisO[2]"]);
  const servos = groups.find((group) => group.label === "Servo outputs");
  assert.match(servos.note, /S1–S3 cyclic, S4 tail/);
});

test("aliases speak, but never guess or hide identity", () => {
  assert.equal(describeField("axisF[2]").alias, "Yaw feedforward");
  assert.equal(describeField("mixer[2]").alias, "Stabilized yaw");
  assert.equal(describeField("rcCommand[3]").alias, "Collective stick");
  assert.equal(describeField("axisO[2]").alias, "Yaw offset (HSI)");
  // A servo is a number, not a role the log never stated.
  assert.equal(describeField("servo[3]").alias, "Servo 4 output");
  assert.equal(describeField("somethingNew").alias, null);
  // The heading keeps the original field name beside any alias.
  const entry = catalogLogFields(["axisF[2]"])[0];
  assert.equal(fieldHeading(entry), "Yaw feedforward · axisF[2]");
  assert.equal(fieldHeading(catalogLogFields(["somethingNew"])[0]), "somethingNew");
});

test("units: known where known, 'logged units' otherwise — never invented", () => {
  assert.equal(describeField("gyroADC[2]").unit, "deg/s");
  assert.equal(describeField("headspeed").unit, "rpm");
  assert.equal(describeField("EscV").unit, "logged units");
  assert.equal(describeField("somethingNew").unit, "logged units");
});

test("layout keys round-trip and cannot collide with presets", () => {
  assert.equal(fieldGraphKey("axisP[0]"), "field:axisP[0]");
  assert.equal(fieldNameFromKey("field:axisP[0]"), "axisP[0]");
  assert.equal(fieldNameFromKey("tracking-roll"), null);
  assert.equal(fieldNameFromKey(null), null);
});

test("search finds a field by name, alias or group, all words required", () => {
  const [yawFf] = catalogLogFields(["axisF[2]"]);
  assert.ok(fieldMatchesSearch(yawFf, "yaw ff"));
  assert.ok(fieldMatchesSearch(yawFf, "axisF"));
  assert.ok(fieldMatchesSearch(yawFf, "pid yaw"));
  assert.ok(!fieldMatchesSearch(yawFf, "pitch"));
  assert.ok(fieldMatchesSearch(yawFf, ""));
});
