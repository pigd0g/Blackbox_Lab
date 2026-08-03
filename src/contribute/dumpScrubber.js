// ======================================================
// BLACKBOX LAB — CLI DUMP SCRUBBER
//
// Turns a raw Rotorflight `dump all` into the settings
// payload that travels with a contributed flight. Strict
// ALLOWLIST design, same philosophy as contributionBuilder:
// nothing survives unless a rule here names it.
//
// The line the allowlist draws: PERSONAL identity out,
// HARDWARE context in. Board model and firmware identify
// equipment, not people, and explain the data — they stay.
// Names, serial numbers, MCU ids, usage statistics and
// anything location- or credential-like never survive.
//
// Privacy properties (tested in test/dumpScrubber.test.mjs):
//   - craft name never survives unless explicitly allowed
//   - MCU id, serial numbers, usage stats, timezone: never
//   - serial-port config, resource mapping, RX binding,
//     VTX config, anything password/token-like: never
//   - unknown commands and unknown `set` keys are dropped
//     and counted, not forwarded
// ======================================================

// `set` keys that describe the SETUP and TUNE of the
// aircraft — the reason the dump travels at all. Everything
// tuning-relevant, nothing identifying.
const ALLOWED_SET_PREFIXES = [
  "gyro_",
  "dterm_",
  "d_min",
  "rpm_",
  "gov_",
  "governor_",
  "motor_",
  "gear_ratio",
  "main_rotor_",
  "tail_rotor_",
  "tail_",
  "swash_",
  "mixer_",
  "servo_",
  "collective_",
  "cyclic_",
  "pitch_",
  "roll_",
  "yaw_",
  "rates_type",
  "rc_",
  "rates",
  "pid_",
  "iterm_",
  "acro_trainer_",
  "angle_",
  "horizon_",
  "rescue_",
  "cross_coupling_",
  "filter",
  "dyn_notch",
  "acc_",
  "looptime",
  "blackbox_",
  "esc_",
  "bat_",
  "vbat_",
  "ibat_",
  "current_",
  "failsafe_",
  // Verified against the Rotorflight firmware settings table
  // (all 728 CLI keys, 2026-08-02) — tuning families the
  // original list missed:
  "error_", // PID error-decay tuning
  "offset_", // high-collective O-term tuning
  "setpoint_", // setpoint boost
  "d_max", // D-term ceiling (list had d_min only)
  "min_throttle",
  "max_throttle",
  "min_command",
  "battery_", // cell count contextualizes sag numbers
  "dshot_", // RPM-telemetry provenance (rpm filter source)
  "ibata_", // current-meter calibration scale — data QA
  "imu_", // attitude estimator gains
  // Verified against a real RF 4.6 `dump all` (2026-08):
  "deadband", // roll/pitch RC deadband (yaw_ already covered)
  "freq_input_", // RPM-sensor provenance for headspeed
  "use_unsynced_pwm" // motor drive mode
];

// Whole-line commands that carry setup information worth
// keeping, verbatim. Board model lines identify hardware,
// not people (owner ruling 2026-08-03) — they explain the
// data and stay.
const ALLOWED_LINE_COMMANDS = [
  /^profile\s+\d+$/,
  /^rateprofile\s+\d+$/,
  /^feature\s+-?[A-Z0-9_]+$/,
  /^mixer\s+/,
  /^servo\s+\d+\s/,
  /^adjrange\s+/, // Betaflight-family name for the below
  /^aux\s+\d+\s/, // mode-switch assignments
  /^adjfunc\s+\d+\s/, // in-flight adjustment mappings
  /^# (Rotorflight|Betaflight|version)/i
];

// Board-model lines double as parsed keys so the payload
// can be queried by hardware without text-scraping.
const PARSED_LINE_COMMANDS = [
  /^(board_name)\s+(.+)$/,
  /^(board_design)\s+(.+)$/,
  /^(manufacturer_id)\s+(.+)$/
];

// Keys and commands that must never survive, even if a
// future firmware nests them under an allowed prefix.
// Deliberately absent: board_name / manufacturer_id — the
// board MODEL identifies hardware, not a person, and is
// explicitly allowlisted above.
const DENY_PATTERNS = [
  /name/i,
  /mcu/i,
  /signature/i,
  /serial/i,
  /passwd|password|token|key|secret/i,
  /vtx/i,
  /(^|_)bind/i,
  /rx_spi/i,
  /resource/i,
  /mac_|uid/i,
  // Usage statistics are a fingerprint of one pilot's
  // flying history — never tuning.
  /^stats_/i,
  // Per-device calibration constants (e.g. acc_calibration)
  // are a stable fingerprint of one specific board with zero
  // tuning value — the opposite of what the dump is for.
  // Pilot trims (acc_trim_*) are tuning and stay.
  /calibration/i
];

function isDenied(text) {
  return DENY_PATTERNS.some((pattern) => pattern.test(text));
}

function isAllowedSetKey(key) {
  if (isDenied(key)) return false;
  return ALLOWED_SET_PREFIXES.some((prefix) =>
    key.startsWith(prefix)
  );
}

// Scrub a raw `dump all` text.
//
// Options:
//   includeCraftName — keep `set craft_name` / `name` lines.
//     Follows the same consent category as the craft name in
//     the frame payload. Default: false.
//
// Returns:
//   {
//     scrubbedText,   // the surviving lines, original order
//     parsed,         // flat { key: value } of surviving `set` lines
//     report,         // human-readable scrub summary entries
//     stats: { kept, dropped }
//   }
export function scrubDump(rawText, options = {}) {
  const includeCraftName = options.includeCraftName === true;

  const keptLines = [];
  const parsed = {};
  const droppedCounts = new Map();

  let kept = 0;
  let dropped = 0;

  const lines = String(rawText ?? "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) continue;

    // Craft name: its own consent, checked before anything.
    const nameMatch =
      line.match(/^set\s+(craft_)?name\s*=\s*(.*)$/i) ||
      line.match(/^name\s+(.*)$/i);

    if (nameMatch) {
      if (includeCraftName) {
        keptLines.push(line);
        kept += 1;
      } else {
        dropped += 1;
        bump(droppedCounts, "craft name");
      }
      continue;
    }

    // Board-model lines: checked before the deny patterns
    // (`board_name` would otherwise die on /name/). The
    // board MODEL is hardware context, not personal
    // identity — kept verbatim and parsed for querying.
    const boardMatch = PARSED_LINE_COMMANDS
      .map((pattern) => line.match(pattern))
      .find(Boolean);

    if (boardMatch) {
      keptLines.push(line);
      parsed[boardMatch[1].toLowerCase()] = boardMatch[2].trim();
      kept += 1;
      continue;
    }

    // `set key = value` lines: allowlist on the key.
    const setMatch = line.match(/^set\s+([a-z0-9_]+)\s*=\s*(.*)$/i);

    if (setMatch) {
      const key = setMatch[1].toLowerCase();
      const value = setMatch[2].trim();

      if (isAllowedSetKey(key)) {
        keptLines.push(line);
        parsed[key] = value;
        kept += 1;
      } else {
        dropped += 1;
        bump(
          droppedCounts,
          isDenied(key) ? "denied setting" : "unlisted setting"
        );
      }
      continue;
    }

    // Whole-line commands.
    if (
      !isDenied(line) &&
      ALLOWED_LINE_COMMANDS.some((pattern) => pattern.test(line))
    ) {
      keptLines.push(line);
      kept += 1;
      continue;
    }

    dropped += 1;
    bump(
      droppedCounts,
      isDenied(line) ? "denied command" : "unlisted command"
    );
  }

  const report = [];
  for (const [reason, count] of droppedCounts) {
    report.push(
      `removed ${count} ${reason}${count === 1 ? "" : "s"}`
    );
  }

  return {
    scrubbedText: keptLines.join("\n"),
    parsed,
    report,
    stats: { kept, dropped }
  };
}

// What the pilot pasted, identified for REASSURANCE in the
// UI only ("it read the right aircraft / I picked the right
// file"). Reads the RAW text — the craft name shown here is
// never what travels; the payload carries an anonymous
// craft id instead.
export function readDumpIdentity(rawText) {
  const text = String(rawText ?? "");

  const nameMatch =
    text.match(/^set\s+(?:craft_)?name\s*=\s*(.+)$/im) ||
    text.match(/^#\s*name:\s*(.+)$/im) ||
    text.match(/^name\s+(.+)$/im);

  const boardMatch = text.match(/^board_name\s+(.+)$/im);

  return {
    craftName: nameMatch ? nameMatch[1].trim() : null,
    boardName: boardMatch ? boardMatch[1].trim() : null
  };
}

// Quick sanity check that a paste looks like a Rotorflight
// dump at all, before scrubbing.
export function looksLikeDump(rawText) {
  const text = String(rawText ?? "");
  return (
    /^set\s+[a-z0-9_]+\s*=/im.test(text) &&
    /rotorflight|betaflight|# version|profile/i.test(text)
  );
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
