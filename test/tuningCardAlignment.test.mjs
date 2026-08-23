// ======================================================
// TESTS — the Tuning card agrees with the PID Lab
// ======================================================
//
// One source of truth: when the PID Lab's own status says
// "Review", the Home card must not say "crisp response",
// whatever the score. When the Lab says "Clear", the score
// bands speak.
//
// ======================================================

import { strict as assert } from "node:assert";
import test from "node:test";

import { buildFlightVerdict } from "../src/analysis/flightVerdict.js";

function tuningCard(pidAnalysis) {
  const verdict = buildFlightVerdict({
    spectra: [],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis,
    labs: {}
  });

  return verdict.cards.find((card) => card.key === "tuning");
}

test("a Review status reads as watch even with a high score", () => {
  const card = tuningCard({ score: 78, overallStatus: "Review" });

  assert.ok(card);
  assert.equal(card.status, "watch");
  assert.doesNotMatch(card.headline, /crisp/);
  assert.match(card.detail, /PID Lab/);
});

test("a Clear status with a high score stays crisp", () => {
  const card = tuningCard({ score: 88, overallStatus: "Clear" });

  assert.ok(card);
  assert.equal(card.status, "good");
  assert.match(card.headline, /crisp/);
});

test("a Clear status with a low score still reads by the bands", () => {
  const card = tuningCard({ score: 45, overallStatus: "Clear" });

  assert.ok(card);
  assert.equal(card.status, "attention");
});

// A strong, unmanaged peak — the kind the Vibration card flags as
// attention. The tuning number is not touched by it; the verdict is.
function strongVibrationSpectra() {
  const frequencies = [];
  const magnitudes = [];
  for (let hz = 5; hz <= 400; hz += 1) {
    frequencies.push(hz);
    magnitudes.push(hz === 29 ? 40 : 0.4);
  }
  return [{ spectrum: { frequencies, magnitudes } }];
}

test("a high score beside an open vibration finding is read through it, not enjoyed", () => {
  const verdict = buildFlightVerdict({
    spectra: strongVibrationSpectra(),
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: { score: 98, overallStatus: "Clear", confidence: { level: "High" } },
    labs: {}
  });
  const vibration = verdict.cards.find((card) => card.key === "vibration");
  const tuning = verdict.cards.find((card) => card.key === "tuning");

  assert.equal(vibration.status, "attention", "fixture must trip the vibration card");
  assert.equal(tuning.status, "watch");
  assert.match(tuning.headline, /98\/100, read through a vibration finding/);
  assert.doesNotMatch(tuning.action, /Enjoy/);
  assert.match(tuning.action, /Fix the vibration first/);
});

test("a high score on thin evidence is not called crisp", () => {
  const card = tuningCard({
    score: 96,
    overallStatus: "Clear",
    confidence: { level: "Low", score: 25 }
  });

  assert.equal(card.status, "watch");
  assert.match(card.headline, /on thin evidence/);
  assert.doesNotMatch(card.headline, /crisp/);
});

test("a high score at Medium confidence with no vibration stays crisp", () => {
  const card = tuningCard({
    score: 96,
    overallStatus: "Clear",
    confidence: { level: "Medium", score: 60 }
  });

  assert.equal(card.status, "good");
  assert.match(card.headline, /crisp/);
});

// ------------------------------------------------------
// Capability gaps: a missing sensor is a finding on the card
// that would have measured it; a missing lab is a greyed card.
// ------------------------------------------------------
const CHIPS = (overrides = {}) => [
  { name: "Vibration & filters", level: "full", note: "ok" },
  { name: "Governor", level: "full", note: "ok" },
  { name: "Battery & ESC", level: "full", note: "ok" },
  { name: "Signal & link", level: "missing", note: "No link telemetry in this log. Enable RSSI telemetry for signal analysis." },
  { name: "BEC output", level: "missing", note: "No BEC voltage in this log." },
  ...Object.values(overrides)
].filter((chip) => !(chip.name in overrides) || overrides[chip.name] === chip);

function verdictWith({ capabilities, labs = {}, signalLab = null, becLab = null }) {
  return buildFlightVerdict({
    spectra: [],
    headspeed: null,
    governorTarget: null,
    vbat: null,
    pidAnalysis: { score: 90, overallStatus: "Clear", confidence: { level: "High" } },
    labs,
    signalLab,
    becLab,
    capabilities
  });
}

test("labs without data become greyed cards, never vanish, never color the flight", () => {
  const verdict = verdictWith({ capabilities: CHIPS() });
  const signal = verdict.cards.find((card) => card.key === "signal");
  const bec = verdict.cards.find((card) => card.key === "bec");
  assert.equal(signal.status, "unavailable");
  assert.equal(signal.statusLabel, "not logged");
  assert.match(signal.gapAction, /Enable RSSI telemetry/);
  assert.equal(bec.status, "unavailable");
  assert.match(bec.gapAction, /BEC voltage telemetry/);
  assert.equal(verdict.worst, "good", "not-logged is not unhealthy");
});

test("a dead current sensor rides on the Battery and Power cards as a gap with advice", () => {
  const capabilities = [
    { name: "Vibration & filters", level: "full", note: "ok" },
    { name: "Governor", level: "full", note: "ok" },
    { name: "Battery & ESC", level: "partial", note: "Voltage only: sag is visible; consumption and internal resistance need a current sensor." },
    { name: "Signal & link", level: "full", note: "ok" },
    { name: "BEC output", level: "full", note: "ok" }
  ];
  const verdict = verdictWith({
    capabilities,
    labs: {
      battery: { status: "good", minimumVoltsPerCell: 3.8 },
      esc: { status: "good", story: "Healthy headroom." }
    }
  });
  const battery = verdict.cards.find((card) => card.key === "battery");
  const power = verdict.cards.find((card) => card.key === "power");
  assert.equal(battery.status, "good");
  assert.match(battery.gapShort, /current/);
  assert.match(battery.gapAction, /current sensor's wiring and scale, or add one/);
  assert.match(power.gapAction, /current sensor/);
});

test("without the quality gate, absent labs stay absent (older callers)", () => {
  const verdict = verdictWith({ capabilities: null });
  assert.ok(!verdict.cards.some((card) => card.key === "signal"));
  assert.ok(!verdict.cards.some((card) => card.status === "unavailable"));
});

test("no headspeed: the rotor card is greyed and power/battery name rotor speed as the blocker", () => {
  const capabilities = [
    { name: "Vibration & filters", level: "full", note: "ok" },
    { name: "Governor", level: "missing", note: "No headspeed in this log. Enable RPM telemetry to unlock governor analysis." },
    { name: "Battery & ESC", level: "partial", note: "Voltage only." },
    { name: "Signal & link", level: "full", note: "ok" },
    { name: "BEC output", level: "full", note: "ok" }
  ];
  const verdict = verdictWith({
    capabilities,
    labs: { governor: { status: "insufficient", hasRotorSpeedData: false, droopRpm: NaN } }
  });
  const rotor = verdict.cards.find((card) => card.key === "rotor");
  const power = verdict.cards.find((card) => card.key === "power");
  assert.equal(rotor.status, "unavailable");
  assert.match(rotor.gapAction, /RPM telemetry/);
  assert.equal(power.status, "unavailable");
  assert.equal(power.statusLabel, "not measurable");
  assert.match(power.gapAction, /No headspeed logged/);
});
