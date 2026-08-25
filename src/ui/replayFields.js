// ======================================================
// REPLAY FIELDS — every logged channel, offered as it is
// ======================================================
//
// The curated Replay presets answer the usual questions. A real
// anomaly asks "what changed at exactly the same moment?" — and
// the answer may sit in a PID term, a mixer input, a servo output
// or a governor term the presets never show. This catalog reads
// the field names the loaded log actually carries and groups them
// so any numeric time-series channel can join the synchronized
// timeline (#63).
//
// Rules of the catalog:
//   - Fields come from the log's own header, never from a fixed
//     schema: Rotorflight logs channels conditionally, and future
//     firmware fields must appear without a UI change.
//   - A friendly alias may be shown, but the original field name
//     stays visible beside it — the alias never replaces identity.
//   - Nothing is guessed: a servo is "Servo 4", not "tail servo",
//     unless the log says which output is which. The Rotorflight
//     convention (S1-S3 cyclic, S4 tail) is stated once as the
//     group's note, not stamped on a field.
//   - Header-only configuration values (yaw precomp gains and the
//     like) are not time series and are not in this catalog.
//
// ======================================================

const AXES = ["Roll", "Pitch", "Yaw", "Collective", "Throttle"];

// Ordered: the groups a tuner reaches for first come first.
export const FIELD_GROUPS = [
  {
    key: "commands",
    label: "Commands",
    test: (name) => /^rcCommand\[\d\]$/i.test(name)
  },
  {
    key: "setpoints",
    label: "Setpoints",
    test: (name) => /^setpoint\[\d\]$/i.test(name)
  },
  {
    key: "pid",
    label: "PID terms",
    test: (name) => /^axis[PIDFBO]\[\d\]$/i.test(name)
  },
  {
    key: "gyro",
    label: "Gyro",
    test: (name) => /^(gyroADC|gyroRAW|gyroUnfilt)\[\d\]$/i.test(name)
  },
  {
    key: "mixer",
    label: "Mixer inputs",
    test: (name) => /^mixer\[\d\]$/i.test(name)
  },
  {
    key: "servos",
    label: "Servo outputs",
    note: "Rotorflight convention: S1–S3 cyclic, S4 tail — this log does not say which output is which, so fields are named by number only.",
    test: (name) => /^servo\[\d\]$/i.test(name)
  },
  {
    key: "motors",
    label: "Motor outputs",
    test: (name) => /^motor\[\d\]$/i.test(name)
  },
  {
    key: "governor",
    label: "Governor",
    test: (name) =>
      /^gov(P|I|D|F|Sum|Target|Request)$/i.test(name) ||
      /^governorTarget$/i.test(name)
  },
  {
    key: "rotor",
    label: "Rotor speed",
    test: (name) => /^(headspeed|tailspeed|erpm\d*|rpm)$/i.test(name)
  },
  {
    key: "esc",
    label: "ESC telemetry",
    test: (name) => /^Esc2?(V|I|Cap|RPM|Thr|Pwm)$/i.test(name)
  },
  {
    key: "bec",
    label: "BEC telemetry",
    test: (name) => /^Bec(V|I)$/i.test(name)
  },
  {
    key: "power",
    label: "Power",
    test: (name) =>
      /^(Vbat|Ibat|Vbec|Vbus|vbatLatest|amperageLatest|energyCumulative)$/i.test(
        name
      )
  },
  {
    key: "temperature",
    label: "Temperatures",
    test: (name) => /^T(mcu|esc2?|bec)$/i.test(name)
  },
  {
    key: "attitude",
    label: "Attitude",
    test: (name) => /^attitude\[\d\]$/i.test(name)
  },
  {
    key: "accel",
    label: "Accelerometer",
    test: (name) => /^acc(ADC|Smooth)\[\d\]$/i.test(name)
  },
  {
    key: "mag",
    label: "Magnetometer",
    test: (name) => /^magADC\[\d\]$/i.test(name)
  },
  {
    key: "altitude",
    label: "Altitude / vario",
    test: (name) => /^(altitude|vario|baroAlt)$/i.test(name)
  },
  {
    key: "receiver",
    label: "Receiver",
    test: (name) =>
      /^(rssi|rxSignalReceived|rxFlightChannelsValid)$/i.test(name)
  },
  {
    key: "gps",
    label: "GPS",
    test: (name) => /^GPS_/i.test(name)
  },
  {
    key: "state",
    label: "State / status",
    test: (name) =>
      /^(flightModeFlags|stateFlags|failsafePhase)$/i.test(name)
  },
  {
    key: "debug",
    label: "Debug",
    test: (name) => /^debug\[\d\]$/i.test(name)
  },
  {
    key: "core",
    label: "Core",
    test: (name) => /^loopIteration$/i.test(name)
  },
  {
    key: "other",
    label: "Other logged fields",
    test: () => true
  }
];

// The x-axis itself and anything that cannot be a y-series.
const EXCLUDED = [/^time$/i];

const WHOLE_NAME_ALIASES = {
  loopIteration: { alias: "Loop iteration", unit: "count" },
  headspeed: { alias: "Headspeed", unit: "rpm" },
  tailspeed: { alias: "Tail speed", unit: "rpm" },
  govTarget: { alias: "Governor target", unit: "rpm" },
  governorTarget: { alias: "Governor target", unit: "rpm" },
  govRequest: { alias: "Governor request", unit: "" },
  govP: { alias: "Governor P", unit: "" },
  govI: { alias: "Governor I", unit: "" },
  govD: { alias: "Governor D", unit: "" },
  govF: { alias: "Governor feedforward", unit: "" },
  govSum: { alias: "Governor sum", unit: "" },
  Vbat: { alias: "Pack voltage", unit: "logged units" },
  Ibat: { alias: "Pack current", unit: "logged units" },
  Vbec: { alias: "BEC voltage", unit: "logged units" },
  Vbus: { alias: "Bus voltage", unit: "logged units" },
  vbatLatest: { alias: "Pack voltage", unit: "logged units" },
  amperageLatest: { alias: "Pack current", unit: "logged units" },
  energyCumulative: { alias: "Energy used", unit: "logged units" },
  EscV: { alias: "ESC voltage", unit: "logged units" },
  EscI: { alias: "ESC current", unit: "logged units" },
  EscCap: { alias: "ESC consumed capacity", unit: "logged units" },
  EscRPM: { alias: "ESC motor RPM", unit: "logged units" },
  EscThr: { alias: "ESC throttle", unit: "logged units" },
  EscPwm: { alias: "ESC PWM", unit: "logged units" },
  Esc2V: { alias: "ESC 2 voltage", unit: "logged units" },
  Esc2I: { alias: "ESC 2 current", unit: "logged units" },
  Esc2Cap: { alias: "ESC 2 consumed capacity", unit: "logged units" },
  Esc2RPM: { alias: "ESC 2 motor RPM", unit: "logged units" },
  BecV: { alias: "BEC voltage (ESC-reported)", unit: "logged units" },
  BecI: { alias: "BEC current (ESC-reported)", unit: "logged units" },
  Tmcu: { alias: "MCU temperature", unit: "logged units" },
  Tesc: { alias: "ESC temperature", unit: "logged units" },
  Tesc2: { alias: "ESC 2 temperature", unit: "logged units" },
  Tbec: { alias: "BEC temperature", unit: "logged units" },
  rssi: { alias: "Link strength (RSSI)", unit: "logged units" },
  rxSignalReceived: { alias: "RX signal received", unit: "flag" },
  rxFlightChannelsValid: { alias: "RX flight channels valid", unit: "flag" },
  altitude: { alias: "Altitude", unit: "logged units" },
  baroAlt: { alias: "Barometric altitude", unit: "logged units" },
  vario: { alias: "Vario", unit: "logged units" },
  flightModeFlags: { alias: "Flight mode flags", unit: "bitmask" },
  stateFlags: { alias: "State flags", unit: "bitmask" },
  failsafePhase: { alias: "Failsafe phase", unit: "enum" },
  GPS_numSat: { alias: "GPS satellites", unit: "count" },
  GPS_altitude: { alias: "GPS altitude", unit: "logged units" },
  GPS_speed: { alias: "GPS speed", unit: "logged units" },
  GPS_ground_course: { alias: "GPS ground course", unit: "logged units" }
};

const INDEXED_ALIASES = [
  { pattern: /^rcCommand\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? `Channel ${i + 1}`} stick`, unit: "logged units" },
  { pattern: /^setpoint\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? `Setpoint ${i + 1}`} target`, unit: (i) => (i < 3 ? "deg/s" : "logged units") },
  { pattern: /^mixer\[(\d)\]$/i, alias: (i) => `Stabilized ${(AXES[i] ?? `mixer ${i + 1}`).toLowerCase()}`, unit: "logged units" },
  { pattern: /^axisP\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} P-term`, unit: "" },
  { pattern: /^axisI\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} I-term`, unit: "" },
  { pattern: /^axisD\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} D-term`, unit: "" },
  { pattern: /^axisF\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} feedforward`, unit: "" },
  { pattern: /^axisB\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} feedforward boost`, unit: "" },
  { pattern: /^axisO\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} offset (HSI)`, unit: "" },
  { pattern: /^gyroADC\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} gyro (filtered)`, unit: "deg/s" },
  { pattern: /^(gyroRAW|gyroUnfilt)\[(\d)\]$/i, index: 2, alias: (i) => `${AXES[i] ?? i} gyro (raw)`, unit: "deg/s" },
  { pattern: /^attitude\[(\d)\]$/i, alias: (i) => `${AXES[i] ?? i} attitude`, unit: "logged units" },
  { pattern: /^acc(?:ADC|Smooth)\[(\d)\]$/i, alias: (i) => `Accelerometer ${["X", "Y", "Z"][i] ?? i}`, unit: "logged units" },
  { pattern: /^magADC\[(\d)\]$/i, alias: (i) => `Magnetometer ${["X", "Y", "Z"][i] ?? i}`, unit: "logged units" },
  { pattern: /^motor\[(\d)\]$/i, alias: (i) => `Motor ${i + 1} output`, unit: "logged units" },
  { pattern: /^servo\[(\d)\]$/i, alias: (i) => `Servo ${i + 1} output`, unit: "logged units" },
  { pattern: /^debug\[(\d)\]$/i, alias: (i) => `Debug ${i}`, unit: "logged units" },
  { pattern: /^GPS_coord\[(\d)\]$/i, alias: (i) => `GPS ${["latitude", "longitude"][i] ?? `coord ${i}`}`, unit: "logged units" },
  { pattern: /^GPS_home\[(\d)\]$/i, alias: (i) => `GPS home ${["latitude", "longitude"][i] ?? i}`, unit: "logged units" }
];

export function describeField(name) {
  const whole = WHOLE_NAME_ALIASES[name];
  if (whole) {
    return { alias: whole.alias, unit: whole.unit || "logged units" };
  }

  for (const entry of INDEXED_ALIASES) {
    const match = entry.pattern.exec(name);
    if (!match) continue;
    const index = Number(match[entry.index ?? 1]);
    const unit = typeof entry.unit === "function" ? entry.unit(index) : entry.unit;
    return { alias: entry.alias(index), unit: unit || "logged units" };
  }

  return { alias: null, unit: "logged units" };
}

// The catalog for one log: every header field that can be a
// y-series, in group order, header order inside each group.
export function catalogLogFields(headerNames) {
  const names = (headerNames ?? [])
    .map((name) => String(name ?? "").trim().replace(/^"|"$/g, ""))
    .filter((name) => name && !EXCLUDED.some((pattern) => pattern.test(name)));

  const seen = new Set();
  const entries = [];

  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);

    const group = FIELD_GROUPS.find((candidate) => candidate.test(name));
    const { alias, unit } = describeField(name);

    entries.push({
      name,
      key: fieldGraphKey(name),
      group: group.key,
      groupLabel: group.label,
      groupNote: group.note ?? null,
      alias,
      unit
    });
  }

  const order = new Map(FIELD_GROUPS.map((group, index) => [group.key, index]));
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      order.get(a.entry.group) - order.get(b.entry.group) || a.index - b.index
    )
    .map(({ entry }) => entry);
}

// Grouped view for a picker: [{key, label, note, fields: [...]}] in
// catalog order, empty groups omitted.
export function groupLogFields(headerNames) {
  const groups = [];
  for (const entry of catalogLogFields(headerNames)) {
    let group = groups.find((candidate) => candidate.key === entry.group);
    if (!group) {
      group = {
        key: entry.group,
        label: entry.groupLabel,
        note: entry.groupNote,
        fields: []
      };
      groups.push(group);
    }
    group.fields.push(entry);
  }
  return groups;
}

// A field's graph key in a stored Replay layout. Presets keep
// their bare keys; fields are prefixed so a future preset can never
// collide with a logged field name.
const FIELD_KEY_PREFIX = "field:";

export function fieldGraphKey(name) {
  return `${FIELD_KEY_PREFIX}${name}`;
}

export function fieldNameFromKey(key) {
  return typeof key === "string" && key.startsWith(FIELD_KEY_PREFIX)
    ? key.slice(FIELD_KEY_PREFIX.length)
    : null;
}

// Search: case-insensitive substring over the original name, the
// alias and the group label, so "yaw ff", "axisF" and "servo" all
// find what they mean.
export function fieldMatchesSearch(entry, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  const haystack = [entry.name, entry.alias ?? "", entry.groupLabel ?? ""]
    .join(" ")
    .toLowerCase()
    // The shorthand tuners actually type.
    .replace(/feedforward/g, "feedforward ff")
    .replace(/governor/g, "governor gov");
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

// The row heading: alias first when one exists, the original name
// always — the alias never hides the field's identity.
export function fieldHeading(entry) {
  return entry.alias ? `${entry.alias} · ${entry.name}` : entry.name;
}
