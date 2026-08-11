// ======================================================
// BLACKBOX LAB — DUMP SCRUBBER TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// These tests are the privacy contract of the CLI dump
// that travels with contributed flights. If one fails,
// the settings payload is leaking something it promised
// not to.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scrubDump,
  looksLikeDump,
  readDumpIdentity
} from "../src/contribute/dumpScrubber.js";

// A synthetic `dump all` containing everything we promise
// to remove, alongside everything we promise to keep.
const SYNTHETIC_DUMP = `
# Rotorflight / STM32F7X2 (S7X2) 4.4.0
board_name MYBOARD_V2
manufacturer_id ACME
mcu_id 003800233438510534383538
signature 0123456789abcdef

name Vince Secret Heli
set craft_name = Vince Secret Heli

resource MOTOR 1 A00
serial 0 64 115200 57600 0 115200
set serialrx_provider = CRSF
set rx_spi_protocol = 0
set vtx_band = 5
set wifi_password = hunter2

feature GOVERNOR
feature -TELEMETRY
profile 0
rateprofile 0

set gyro_lpf1_static_hz = 100
set dterm_lpf1_static_hz = 80
set rpm_filter_harmonics = 3
set gov_headspeed = 2100
set gear_ratio = 1090
set motor_poles = 10
set pid_process_denom = 1
set roll_p = 80
set roll_i = 120
set yaw_cw_stop_gain = 120
set rescue_mode = 1
set blackbox_sample_rate = 1
set error_decay_time_cyclic = 25
set offset_flood_relax_level = 30
set setpoint_boost_gain = 15
set d_max_gain = 40
set min_throttle = 1070
set max_throttle = 2000
set min_command = 1000
set battery_cell_count = 12
set dshot_bidir = ON
set ibata_scale = 400
set imu_dcm_kp = 25000
set acc_trim_pitch = 12
set acc_calibration = -42,18,344,1
set deadband = 2
set use_unsynced_pwm = ON
set freq_input_pull = PULLUP
set totally_unknown_future_thing = 42
`;

test("personal identity never survives", () => {
  const { scrubbedText } = scrubDump(SYNTHETIC_DUMP);

  for (const leak of [
    "Vince Secret Heli",
    "003800233438510534383538",
    "0123456789abcdef",
    "hunter2",
    "resource",
    "serial 0",
    "serialrx",
    "rx_spi",
    "vtx"
  ]) {
    assert.ok(
      !scrubbedText.includes(leak),
      `scrubbed dump leaked: ${leak}`
    );
  }
});

test("hardware context survives: board model is kept and parsed", () => {
  const { scrubbedText, parsed } = scrubDump(SYNTHETIC_DUMP);

  assert.ok(scrubbedText.includes("board_name MYBOARD_V2"));
  assert.ok(scrubbedText.includes("manufacturer_id ACME"));
  assert.equal(parsed.board_name, "MYBOARD_V2");
  assert.equal(parsed.manufacturer_id, "ACME");

  // The neighbours on either side stay dead: MCU id and
  // signature are per-device, not hardware model.
  assert.ok(!scrubbedText.includes("mcu_id"));
  assert.ok(!scrubbedText.includes("signature"));
});

test("tuning setup survives, verbatim and parsed", () => {
  const { scrubbedText, parsed } = scrubDump(SYNTHETIC_DUMP);

  assert.ok(scrubbedText.includes("set gov_headspeed = 2100"));
  assert.ok(scrubbedText.includes("set rpm_filter_harmonics = 3"));
  assert.ok(scrubbedText.includes("feature GOVERNOR"));
  assert.ok(scrubbedText.includes("profile 0"));

  assert.equal(parsed.gov_headspeed, "2100");
  assert.equal(parsed.gear_ratio, "1090");
  assert.equal(parsed.roll_p, "80");
  assert.equal(parsed.motor_poles, "10");
});

test("firmware-verified tuning families survive (2026-08-02 extension)", () => {
  const { parsed } = scrubDump(SYNTHETIC_DUMP);

  assert.equal(parsed.error_decay_time_cyclic, "25");
  assert.equal(parsed.offset_flood_relax_level, "30");
  assert.equal(parsed.setpoint_boost_gain, "15");
  assert.equal(parsed.d_max_gain, "40");
  assert.equal(parsed.min_throttle, "1070");
  assert.equal(parsed.max_throttle, "2000");
  assert.equal(parsed.min_command, "1000");
  assert.equal(parsed.battery_cell_count, "12");
  assert.equal(parsed.dshot_bidir, "ON");
  assert.equal(parsed.ibata_scale, "400");
  assert.equal(parsed.imu_dcm_kp, "25000");
  assert.equal(parsed.deadband, "2");
  assert.equal(parsed.use_unsynced_pwm, "ON");
  assert.equal(parsed.freq_input_pull, "PULLUP");
});

test("per-device calibration constants die; pilot trims survive", () => {
  const { scrubbedText, parsed } = scrubDump(SYNTHETIC_DUMP);

  assert.equal(parsed.acc_calibration, undefined);
  assert.ok(
    !scrubbedText.includes("acc_calibration"),
    "device calibration key leaked"
  );
  assert.ok(
    !scrubbedText.includes("-42,18,344,1"),
    "device calibration vector leaked"
  );

  assert.equal(parsed.acc_trim_pitch, "12");
});

test("unknown settings are dropped, not forwarded", () => {
  const { scrubbedText, parsed } = scrubDump(SYNTHETIC_DUMP);

  assert.ok(!scrubbedText.includes("totally_unknown_future_thing"));
  assert.equal(parsed.totally_unknown_future_thing, undefined);
});

test("craft name survives only with explicit consent", () => {
  const withConsent = scrubDump(SYNTHETIC_DUMP, {
    includeCraftName: true
  });

  assert.ok(withConsent.scrubbedText.includes("Vince Secret Heli"));

  const withoutConsent = scrubDump(SYNTHETIC_DUMP);
  assert.ok(
    !withoutConsent.scrubbedText.includes("Vince Secret Heli")
  );
});

test("scrub report names what was removed", () => {
  const { report, stats } = scrubDump(SYNTHETIC_DUMP);

  assert.ok(report.length > 0);
  assert.ok(report.some((entry) => entry.includes("craft name")));
  assert.ok(stats.dropped > 0);
  assert.ok(stats.kept > 0);
});

// Shapes learned from a real Rotorflight 4.6 `dump all`
// (verified 2026-08: full dump, zero leaks). The synthetic
// corpus carries the same line shapes so the privacy
// contract stays testable without anyone's real data.
const REAL_SHAPE_DUMP = `
# dump

# version
# Rotorflight / STM32F7X2 (S7X2) 4.6.0 Jun 30 2026 / 07:20:47 (0000000) MSP API: 12.9

# start the command batch
batch start

board_name TESTBOARD_X1
board_design F7B5
manufacturer_id ACME

# name: secret test heli

resource MOTOR 1 A09
serial 20 1 115200 57600 0 115200

servo 1 1440 -700 700 500 500 333 0 3
mixer input SR -1000 1000 474
mixer rule 10 set AUX3 S5 1000 0
aux 1 37 2 950 2055 0 0
adjfunc 0 1 255 1500 1500 1 945 2040 1500 1500 0 1 3
map AETRC123

set acc_calibration = 0,0,42,-12345
set stats_total_flights = 38
set stats_total_time_s = 5390
set stats_total_dist_m = 13106915
set timezone_offset_minutes = 60
set profile_name = -
set box_user_1_name = my secret box
set motor_poles = 10,0,0,0
set main_rotor_gear_ratio = 12,134
set gov_headspeed = 1830
set name = secret test heli

profile 2
rateprofile 0

batch end
`;

test("real-dump shapes: personal identity, stats and timezone never survive", () => {
  const { scrubbedText } = scrubDump(REAL_SHAPE_DUMP);

  for (const leak of [
    "secret test heli",
    "secret",
    "-12345",
    "13106915",
    "5390",
    "stats_total",
    "timezone",
    "batch",
    "resource",
    "serial 20",
    "map AETRC123",
    "my secret box"
  ]) {
    assert.ok(
      !scrubbedText.includes(leak),
      `real-shape dump leaked: ${leak}`
    );
  }
});

test("real-dump shapes: board model, aux and adjfunc are hardware context and stay", () => {
  const { scrubbedText, parsed } = scrubDump(REAL_SHAPE_DUMP);

  assert.equal(parsed.board_name, "TESTBOARD_X1");
  assert.equal(parsed.board_design, "F7B5");
  assert.equal(parsed.manufacturer_id, "ACME");
  assert.ok(scrubbedText.includes("aux 1 37 2"));
  assert.ok(scrubbedText.includes("adjfunc 0 1 255"));
});

test("readDumpIdentity reads name and board from the raw paste, for the UI only", () => {
  const identity = readDumpIdentity(REAL_SHAPE_DUMP);

  assert.equal(identity.craftName, "secret test heli");
  assert.equal(identity.boardName, "TESTBOARD_X1");

  const empty = readDumpIdentity("hello world");
  assert.equal(empty.craftName, null);
  assert.equal(empty.boardName, null);
});

test("real-dump shapes: setup lines and multi-value settings survive", () => {
  const { scrubbedText, parsed } = scrubDump(REAL_SHAPE_DUMP);

  // The `# name:` comment form must die even though the
  // version banner comment is kept.
  assert.ok(scrubbedText.includes("# Rotorflight /"));
  assert.ok(!scrubbedText.includes("# name:"));

  assert.ok(scrubbedText.includes("servo 1 1440"));
  assert.ok(scrubbedText.includes("mixer input SR"));
  assert.ok(scrubbedText.includes("mixer rule 10"));
  assert.ok(scrubbedText.includes("profile 2"));
  assert.ok(scrubbedText.includes("rateprofile 0"));

  // Multi-value settings parse verbatim.
  assert.equal(parsed.motor_poles, "10,0,0,0");
  assert.equal(parsed.main_rotor_gear_ratio, "12,134");
  assert.equal(parsed.gov_headspeed, "1830");
});

test("dump detection accepts dumps, rejects noise", () => {
  assert.ok(looksLikeDump(SYNTHETIC_DUMP));
  assert.ok(!looksLikeDump("hello world"));
  assert.ok(!looksLikeDump(""));
  assert.ok(!looksLikeDump(null));
});
