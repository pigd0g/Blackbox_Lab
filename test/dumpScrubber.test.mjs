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
  looksLikeDump
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
set totally_unknown_future_thing = 42
`;

test("denied identity fields never survive", () => {
  const { scrubbedText } = scrubDump(SYNTHETIC_DUMP);

  for (const leak of [
    "Vince Secret Heli",
    "MYBOARD_V2",
    "ACME",
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

test("dump detection accepts dumps, rejects noise", () => {
  assert.ok(looksLikeDump(SYNTHETIC_DUMP));
  assert.ok(!looksLikeDump("hello world"));
  assert.ok(!looksLikeDump(""));
  assert.ok(!looksLikeDump(null));
});
