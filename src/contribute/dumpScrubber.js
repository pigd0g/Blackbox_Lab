// ======================================================
// BLACKBOX LAB — CLI DUMP SCRUBBER
//
// Turns a raw Rotorflight `dump all` into the settings
// payload that travels with a contributed flight. Strict
// ALLOWLIST design, same philosophy as contributionBuilder:
// nothing survives unless a rule here names it.
//
// Privacy properties (tested in test/dumpScrubber.test.mjs):
//   - craft name never survives unless explicitly allowed
//   - board identity, MCU id, serial numbers: never
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
  "failsafe_"
];

// Whole-line commands that carry setup information worth
// keeping, verbatim.
const ALLOWED_LINE_COMMANDS = [
  /^profile\s+\d+$/,
  /^rateprofile\s+\d+$/,
  /^feature\s+-?[A-Z0-9_]+$/,
  /^mixer\s+/,
  /^servo\s+\d+\s/,
  /^adjrange\s+/,
  /^# (Rotorflight|Betaflight|version)/i
];

// Keys and commands that must never survive, even if a
// future firmware nests them under an allowed prefix.
const DENY_PATTERNS = [
  /name/i,
  /board/i,
  /mcu/i,
  /signature/i,
  /manufacturer/i,
  /serial/i,
  /passwd|password|token|key|secret/i,
  /vtx/i,
  /(^|_)bind/i,
  /rx_spi/i,
  /resource/i,
  /mac_|uid/i
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
