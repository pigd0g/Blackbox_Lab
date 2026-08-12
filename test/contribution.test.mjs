// ======================================================
// BLACKBOX LAB — CONTRIBUTION (ANONYMIZATION) TESTS
// ======================================================
//
// Run with:  npm test   (node --test)
//
// These tests are the privacy contract of the "share
// anonymized logs" feature. If one of them fails, the
// payload is leaking something it promised not to.
//
// ======================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildContribution,
  buildContributionV1,
  computeContentHash,
  describeContribution
} from "../src/contribute/contributionBuilder.js";
import { scrubDump } from "../src/contribute/dumpScrubber.js";
import { buildFingerprint } from "../src/contribute/fingerprint.js";
import {
  getCraftCard,
  saveCraftCard,
  prefillCraftCard,
  craftCardFromDump,
  getCraftDump,
  saveCraftDump
} from "../src/analysis/craftHistory.js";
import { contributionPaths } from "../src/contribute/uploader.js";
import {
  hasContributed,
  recordContributed
} from "../src/contribute/uploadLedger.js";

// Synthetic decoded flight in the bblDecoder shape.
// Home position: Vienna city center — must NEVER appear
// in any payload.
const LAT0 = 481_982_000; // 48.1982° in 1e-7 deg
const LON0 = 163_738_000; // 16.3738°

function makeFlight() {
  return {
    headers: new Map([
      ["Field G name", "time,GPS_numSat,GPS_coord[0],GPS_coord[1],GPS_altitude,GPS_speed,GPS_ground_course"],
      ["Log start datetime", "2026-07-23T18:41:02.123+00:00"],
      ["gyro_lpf1_dyn_min_hz", "25"],
      ["gov_headspeed", "1780"],
      ["some_unknown_header", "whatever"]
    ]),
    sysConfig: {
      firmwareType: "Rotorflight",
      firmwareRevision: "4.6.0",
      craftName: "Vince's Goosky RS7",
      boardInformation: "VANTAC RF007",
      logStartDatetime: "2026-07-23T18:41:02.123+00:00"
    },
    mainFieldNames: [
      "time",
      "gyroADC[0]",
      "setpoint[0]",
      "motor[0]",
      "headspeed",
      "Vbat",
      "secretExperimentalField"
    ],
    mainFrames: [
      [1000, 5, 0, 120, 0, 2333, 42],
      [2000, 7, 1, 130, 500, 2331, 43]
    ],
    slowFieldNames: ["flightModeFlags", "failsafePhase", "privateThing"],
    slowFrames: [{ afterMainFrame: 0, values: [3, 0, 99] }],
    gpsFrames: [
      { afterMainFrame: 0, values: [1000, 12, LAT0, LON0, 500, 0, 0] },
      {
        afterMainFrame: 1,
        values: [2000, 12, LAT0 + 9000, LON0 + 4500, 520, 35, 90]
      }
    ],
    durationSeconds: 133.5
  };
}

const ALL_ON = { power: true, gps: true, setup: true };
const ALL_OFF = { power: false, gps: false, setup: false };

function payloadText(payload) {
  return JSON.stringify(payload);
}

test("core payload never contains dates or unknown fields; board model is hardware context and ships", () => {
  const payload = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  const text = payloadText(payload);

  assert.ok(!text.includes("2026-07-23"), "log date leaked");
  assert.ok(!text.includes("secretExperimentalField"), "unlisted main field leaked");
  assert.ok(!text.includes("privateThing"), "unlisted slow field leaked");
  assert.ok(!text.includes("some_unknown_header"), "unlisted header leaked");

  // Board model identifies hardware, not a person — it
  // explains the data and travels with every payload.
  assert.equal(payload.setup.board, "VANTAC RF007");
});

test("absolute GPS coordinates never appear, even with GPS enabled", () => {
  const payload = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  const text = payloadText(payload);

  assert.ok(!text.includes(String(LAT0)), "absolute latitude leaked");
  assert.ok(!text.includes(String(LON0)), "absolute longitude leaked");
  assert.ok(payload.gps, "gps section expected when enabled");

  // First fix is the origin; second is ~100m north, ~50m east.
  const [first, second] = payload.gps.frames;
  const north = payload.gps.fields.indexOf("rel_north_m");
  const east = payload.gps.fields.indexOf("rel_east_m");
  assert.equal(first[north], 0);
  assert.equal(first[east], 0);
  assert.ok(Math.abs(second[north] - 100.2) < 1, `north offset ${second[north]}`);
  assert.ok(Math.abs(second[east] - 33.4) < 5, `east offset ${second[east]}`);

  // Altitude is relative to the first fix.
  const alt = payload.gps.fields.indexOf("rel_altitude");
  assert.equal(first[alt], 0);
  assert.equal(second[alt], 20);
});

test("GPS off means no gps section at all", () => {
  const payload = buildContribution(
    makeFlight(),
    "Blackbox BBL Log",
    { power: true, gps: false, setup: true },
    "0.3.0"
  );
  assert.equal(payload.gps, undefined);
});

test("the craft name never ships, under any consent; tuning needs Setup", () => {
  const withSetup = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  assert.ok(
    !payloadText(withSetup).includes("Goosky"),
    "craft name leaked even with all consents on"
  );
  assert.equal(withSetup.setup.tuning.gov_headspeed, "1780");

  const withoutSetup = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_OFF, "0.3.0");
  const text = payloadText(withoutSetup);
  assert.ok(!text.includes("Goosky"), "craft name leaked with setup off");
  assert.ok(!text.includes("gov_headspeed"), "tuning leaked with setup off");
  // firmware and board info are always fine — they identify
  // equipment, not people
  assert.equal(withoutSetup.setup.firmwareType, "Rotorflight");
  assert.equal(withoutSetup.setup.board, "VANTAC RF007");
});

test("power fields ship only with Power enabled", () => {
  const withPower = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  assert.ok(withPower.fields.includes("Vbat"));

  const withoutPower = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_OFF, "0.3.0");
  assert.ok(!withoutPower.fields.includes("Vbat"));
  // core channels survive regardless
  assert.ok(withoutPower.fields.includes("gyroADC[0]"));
  assert.ok(withoutPower.fields.includes("headspeed"));
});

test("frame projection keeps values aligned with kept fields", () => {
  const payload = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  const vbat = payload.fields.indexOf("Vbat");
  assert.equal(payload.frames[0][vbat], 2333);
  assert.equal(payload.frames[1][vbat], 2331);
  assert.equal(payload.frames[0].length, payload.fields.length);
});

test("summary text mentions gps privacy when gps is shared", () => {
  const payload = buildContribution(makeFlight(), "Blackbox BBL Log", ALL_ON, "0.3.0");
  const summary = describeContribution(payload);
  assert.ok(summary.includes("never your location"));
});

// ======================================================
// Schema v1 — envelope, content hash, consent sections
// ======================================================

const V1_ALL_ON = { power: true, gps: true, setup: true, dump: true };
const V1_ALL_OFF = { power: false, gps: false, setup: false, dump: false };

const SAMPLE_DUMP = `
# Rotorflight 4.4.0
set gov_headspeed = 2100
set gear_ratio = 1090
board_name SECRETBOARD
mcu_id 003800233438510534383538
`;

test("v1 envelope carries schema version, tier, id and hash", async () => {
  const { payload, contentHash, contributionId } =
    await buildContributionV1(makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.4.0");

  assert.equal(payload.schema_version, "1.2");
  assert.equal(payload.tier, 1);
  assert.equal(payload.app_version, "0.4.0");
  assert.match(
    payload.contribution_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "contribution_id should be a v4 UUID"
  );
  assert.equal(payload.contribution_id, contributionId);
  assert.match(contentHash, /^[0-9a-f]{64}$/, "content hash should be sha-256 hex");
  assert.equal(payload.content_hash, contentHash);
});

test("reserved Tier 2 fields are present and null", async () => {
  const { payload } = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.4.0"
  );

  for (const field of [
    "intent",
    "reference_contribution_id",
    "declared_change",
    "pilot_verdict"
  ]) {
    assert.ok(field in payload, `reserved field ${field} missing`);
    assert.equal(payload[field], null, `reserved field ${field} not null`);
  }
});

test("consent mirrors the category toggles", async () => {
  const scrubbedDump = scrubDump(SAMPLE_DUMP);
  const { payload } = await buildContributionV1(
    makeFlight(),
    "Blackbox BBL Log",
    { power: true, gps: false, setup: true, dump: true },
    "0.4.0",
    { scrubbedDump }
  );

  assert.deepEqual(payload.consent, {
    core_flight_data: true,
    power_telemetry: true,
    setup_headers: true,
    cli_dump: true,
    gps_relative: false
  });
});

test("consent-off categories produce no corresponding payload sections", async () => {
  const scrubbedDump = scrubDump(SAMPLE_DUMP);
  const { payload, frames, dumpText } = await buildContributionV1(
    makeFlight(),
    "Blackbox BBL Log",
    V1_ALL_OFF,
    "0.4.0",
    { scrubbedDump }
  );

  assert.equal(payload.dump, undefined, "dump section despite dump consent off");
  assert.equal(dumpText, null, "dump text despite dump consent off");
  assert.equal(frames.gps, undefined, "gps frames despite gps consent off");

  const text = JSON.stringify(payload) + JSON.stringify(frames);
  assert.ok(!text.includes("Goosky"), "craft name leaked with setup off");
  assert.ok(!text.includes("Vbat"), "power field leaked with power off");
});

test("dump consent on: parsed dump in payload, scrubbed text separate, never raw", async () => {
  const scrubbedDump = scrubDump(SAMPLE_DUMP);
  const { payload, dumpText } = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.4.0",
    { scrubbedDump }
  );

  assert.equal(payload.dump.parsed.gov_headspeed, "2100");
  assert.ok(dumpText.includes("set gear_ratio = 1090"));
  // Board model is hardware context — kept and queryable.
  assert.equal(payload.dump.parsed.board_name, "SECRETBOARD");
  assert.ok(dumpText.includes("board_name SECRETBOARD"));
});

test("two flights in one file produce two distinct content hashes", async () => {
  const first = makeFlight();

  const second = makeFlight();
  second.mainFrames = [
    [1000, 5, 0, 120, 0, 2333, 42],
    [2000, 8, 2, 131, 501, 2330, 44]
  ];

  const firstHash = await computeContentHash(first);
  const secondHash = await computeContentHash(second);

  assert.notEqual(firstHash, secondHash);

  // Same flight decoded again → same hash (the dedup key).
  assert.equal(firstHash, await computeContentHash(makeFlight()));
});

test("anonymization report names the applied rules, including the dump's", async () => {
  const scrubbedDump = scrubDump(SAMPLE_DUMP);
  const { payload } = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.4.0",
    { scrubbedDump }
  );

  assert.ok(Array.isArray(payload.anonymization_report));
  assert.ok(payload.anonymization_report.includes("log date/time removed"));
  assert.ok(
    payload.anonymization_report.includes(
      "serial numbers and device ids removed"
    )
  );
  assert.ok(
    payload.anonymization_report.some((entry) =>
      entry.includes("anonymous craft id")
    ),
    "craft-name rule missing from the report"
  );
  assert.ok(
    payload.anonymization_report.some((entry) => entry.startsWith("dump:")),
    "dump scrub rules missing from the report"
  );
});

test("frame rows live in frames.bin, not in payload.json", async () => {
  const { payload, frames } = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.4.0"
  );

  assert.equal(payload.frames, undefined, "frame rows duplicated into payload.json");
  assert.ok(frames.frames.length > 0);
  assert.equal(frames.frames[0].length, frames.fields.length);
  assert.deepEqual(payload.fields, frames.fields);
});

// ======================================================
// Schema v1 — craft card, fingerprint, paths, ledger
// ======================================================

function memoryStorage() {
  const map = new Map();

  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

test("craft card round-trips: confirm once, reused afterwards", () => {
  const storage = memoryStorage();

  assert.equal(getCraftCard(storage, "Goosky RS7"), null);

  saveCraftCard(storage, "Goosky RS7", {
    size_class: "700",
    blade_length_mm: "710",
    power_type: "electric",
    typical_headspeed_rpm: 2100,
    drive: "torque_tube_tail"
  });

  const card = getCraftCard(storage, "Goosky RS7");
  assert.equal(card.size_class, "700");
  assert.equal(card.blade_length_mm, 710);
  assert.equal(card.power_type, "electric");
  assert.equal(card.typical_headspeed_rpm, 2100);
  assert.equal(card.drive, "torque_tube_tail");

  // The anonymous craft id: minted on first save, a v4
  // UUID, and STABLE across edits — it is what groups this
  // craft's contributions without carrying its name.
  assert.match(
    card.craft_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );

  saveCraftCard(storage, "Goosky RS7", { ...card, blade_length_mm: 715 });
  const edited = getCraftCard(storage, "Goosky RS7");
  assert.equal(edited.blade_length_mm, 715);
  assert.equal(edited.craft_id, card.craft_id, "craft_id changed on edit");
});

test("craft card writes are allowlisted: unknown fields and values dropped", () => {
  const storage = memoryStorage();

  saveCraftCard(storage, "Test Heli", {
    size_class: "731",
    power_type: "warp_drive",
    drive: "belt",
    pilot_email: "vince@example.com"
  });

  const card = getCraftCard(storage, "Test Heli");
  assert.equal(card.size_class, null, "unknown size class survived");
  assert.equal(card.power_type, null, "unknown power type survived");
  assert.equal(card.drive, "belt");
  assert.ok(
    !JSON.stringify(card).includes("example.com"),
    "unlisted field survived into the card"
  );
});

test("craft dump round-trips scrubbed-only, per craft", () => {
  const storage = memoryStorage();

  assert.equal(getCraftDump(storage, "Goosky RS7"), null);

  const scrubbed = scrubDump(SAMPLE_DUMP);
  saveCraftDump(storage, "Goosky RS7", scrubbed);

  const stored = getCraftDump(storage, "Goosky RS7");
  assert.equal(stored.parsed.gov_headspeed, "2100");
  assert.ok(stored.scrubbedText.includes("set gear_ratio = 1090"));
  assert.ok(Number.isFinite(stored.savedAtMs));
  assert.ok(
    !JSON.stringify(stored).includes("003800233438510534383538"),
    "device id survived into the stored craft dump"
  );

  assert.equal(getCraftDump(storage, "Other Heli"), null);
});

test("the dump fills the craft card's numbers and power type", () => {
  const fromDump = craftCardFromDump({
    gov_mode: "ELECTRIC",
    gov_headspeed: "1830"
  });

  assert.equal(fromDump.power_type, "electric");
  assert.equal(fromDump.typical_headspeed_rpm, 1830);
  assert.equal(fromDump.size_class, null, "size class invented from nothing");

  const nitro = craftCardFromDump({ gov_mode: "NITRO" });
  assert.equal(nitro.power_type, "nitro");
  assert.equal(nitro.typical_headspeed_rpm, null);

  const empty = craftCardFromDump({});
  assert.equal(empty.power_type, null);
});

test("craft card pre-fill suggests, never invents", () => {
  const fromLog = prefillCraftCard({
    medianHeadspeedRpm: 2087,
    hasElectricalTelemetry: true
  });

  assert.equal(fromLog.typical_headspeed_rpm, 2090);
  assert.equal(fromLog.power_type, "electric");
  assert.equal(fromLog.size_class, null);
  assert.equal(fromLog.blade_length_mm, null);

  const empty = prefillCraftCard({});
  assert.equal(empty.typical_headspeed_rpm, null);
  assert.equal(empty.power_type, null);
});

test("fingerprint reuses computed outputs and is versioned", () => {
  const fingerprint = buildFingerprint({
    dataset: {
      markers: [
        {
          hz: 34.8,
          label: "main rotor 1/rev · 35 Hz",
          magnitude: 12.34,
          classification: "main_rotor_1rev"
        }
      ],
      labs: {
        governor: {
          droopRpm: 48.2,
          droopPercent: 2.31,
          averageHeadspeed: 2085
        },
        esc: { saturationPercent: 1.27 }
      }
    },
    pidAnalysis: {
      score: "87",
      detectedColumns: {
        trackingAnalysis: {
          averageAbsoluteAxisError: [
            { axis: "Roll", averageAbsoluteError: 3.456 }
          ],
          averageAbsoluteAxisResponse: [
            { axis: "Roll", averageAbsoluteResponse: 41.2 }
          ],
          instantaneousExceedanceAnalysis: [
            { axis: "Roll", exceedancePercent: 4.567 }
          ]
        }
      }
    }
  });

  assert.equal(fingerprint.fingerprint_version, 1);
  assert.equal(fingerprint.tracking_score, 87);
  assert.deepEqual(fingerprint.tracking, [
    {
      axis: "Roll",
      average_absolute_error: 3.46,
      average_absolute_response: 41.2,
      exceedance_percent: 4.57
    }
  ]);
  assert.deepEqual(fingerprint.noise_peaks, [
    { hz: 34.8, magnitude: 12.3, classification: "main_rotor_1rev" }
  ]);
  assert.equal(fingerprint.governor.droop_rpm, 48.2);
  assert.equal(fingerprint.saturation.esc_throttle_percent, 1.27);
});

test("fingerprint degrades to nulls when analyses are absent", () => {
  const fingerprint = buildFingerprint({ dataset: null, pidAnalysis: null });

  assert.equal(fingerprint.fingerprint_version, 1);
  assert.equal(fingerprint.tracking_score, null);
  assert.deepEqual(fingerprint.tracking, []);
  assert.deepEqual(fingerprint.noise_peaks, []);
  assert.equal(fingerprint.governor, null);
  assert.equal(fingerprint.saturation, null);
});

test("bucket paths follow the schema version, keyed by content hash", () => {
  const paths = contributionPaths("abc123");

  assert.equal(paths.payload, "contrib/1.2/abc123/payload.json");
  assert.equal(paths.frames, "contrib/1.2/abc123/frames.bin.gz");
  assert.equal(paths.dump, "contrib/1.2/abc123/dump.txt");
});

test("schema 1.1: events travel compact and capped; absent stays honest", async () => {
  const flightEvents = {
    events: Array.from({ length: 350 }, (_, i) => ({
      t: i, axis: "Roll", kind: "command", magnitude: 100,
      direction: 1, overshoot_percent: null, settling_ms: 80,
      verdict: "clean"
    })),
    summary: { total: 350, clean: 350, overshoot: 0, slow: 0, worst: null, sentence: "x" }
  };

  const withEvents = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.5.0",
    { flightEvents }
  );
  assert.equal(withEvents.payload.events.length, 300, "events not capped");
  assert.equal(withEvents.payload.events_summary.total, 350);
  assert.ok(
    !("sentence" in (withEvents.payload.events_summary ?? {})),
    "UI sentence leaked into the payload summary"
  );

  const withoutEvents = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "0.5.0"
  );
  assert.deepEqual(withoutEvents.payload.events, []);
  assert.equal(withoutEvents.payload.events_summary, null);
});

test("upload ledger: a confirmed hash is never offered twice", () => {
  const storage = memoryStorage();

  assert.equal(hasContributed(storage, "hash-a"), false);
  recordContributed(storage, "hash-a");
  assert.equal(hasContributed(storage, "hash-a"), true);
  assert.equal(hasContributed(storage, "hash-b"), false);
});

test("schema 1.2: governor events travel allowlisted; stories and ids stay local", async () => {
  const governorEvents = {
    events: Array.from({ length: 120 }, (_, i) => ({
      id: `gov:${i}:${i + 50}`,
      kind: i % 2 ? "under" : "over",
      cause: "collective-drop",
      hunting: true,
      t: i,
      tPeak: i + 0.2,
      tEnd: i + 0.5,
      durationMs: 500,
      peakErrorPercent: 7.1,
      peakErrorRpm: 142,
      targetRpm: 2000,
      outputMaxPercent: 71.5,
      collectiveBefore: "drop",
      story: "PILOT-FACING STORY MUST NOT TRAVEL"
    })),
    summary: {
      total: 120, totalFound: 120, dropped: 0,
      under: 60, over: 60, powerLimit: 0, hunting: 120,
      worst: null, sentence: "UI SENTENCE MUST NOT TRAVEL"
    }
  };

  const precomp = {
    transientCount: 40, riseCount: 20, dropCount: 20,
    governor: {
      balance: "high", riseDroopPercent: 0.4,
      dropOvershootPercent: 4.4, riseCount: 20, dropCount: 20,
      story: "STORY MUST NOT TRAVEL"
    },
    tail: {
      balance: "coupled", kickRatio: 5.1, baselineError: 4,
      transientError: 62, consistency: 0.9, kickCount: 18,
      story: "STORY MUST NOT TRAVEL"
    }
  };

  const result = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "1.1.0",
    { governorEvents, precomp }
  );

  assert.equal(result.payload.governor_events.length, 100, "not capped");

  const [event] = result.payload.governor_events;
  assert.equal(event.cause, "collective-drop");
  assert.equal(event.peak_error_percent, 7.1);
  assert.ok(!("story" in event), "story leaked");
  assert.ok(!("id" in event), "local id leaked");
  assert.ok(!("collectiveBefore" in event), "unlisted field leaked");

  assert.equal(result.payload.governor_events_summary.power_limit, 0);
  assert.ok(
    !("sentence" in result.payload.governor_events_summary),
    "UI sentence leaked"
  );

  assert.equal(result.payload.precomp.governor.balance, "high");
  assert.equal(result.payload.precomp.tail.kick_ratio, 5.1);
  assert.ok(!("story" in result.payload.precomp.governor), "story leaked");
  assert.ok(!("story" in result.payload.precomp.tail), "story leaked");

  const withoutAny = await buildContributionV1(
    makeFlight(), "Blackbox BBL Log", V1_ALL_ON, "1.1.0"
  );
  assert.deepEqual(withoutAny.payload.governor_events, []);
  assert.equal(withoutAny.payload.governor_events_summary, null);
  assert.equal(withoutAny.payload.precomp, null);
});
