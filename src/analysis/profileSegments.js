// ======================================================
// PID-PROFILE SEGMENTS — which profile flew which rows
// ======================================================
//
// A helicopter can switch PID profiles mid-flight (hover
// profile in, acro profile out). The whole-flight analysis
// then mixes two tunes, and a recommendation cannot say
// which profile it applies to. This module reads the
// pidProfile column — present only when the log carried
// actual in-flight switches — and cuts the flight into
// contiguous segments of one active profile each.
//
// Profile number 0 means "the profile the log started in":
// the log records a switch's TARGET profile but never names
// the starting one (the headers carry that profile's
// settings, not its number). Segments report it as null.
//
// Everything is expressed in absolute data-row indexes —
// the same space as the recommendation evidence anchors
// (sampleRowIndex) — so attribution is a plain lookup.
//
// ======================================================

export const PID_PROFILE_COLUMN = "pidProfile";

/**
 * @returns {Array} contiguous segments, in flight order:
 *   { profile,        // number, or null for the log-start profile
 *     firstRowIndex,  // absolute line index of the first row
 *     lastRowIndex,   // absolute line index of the last row
 *     sampleCount }
 *   Empty array when the log carries no pidProfile column —
 *   i.e. no in-flight switch happened.
 */
export function buildProfileSegments({
  lines,
  telemetryHeaderIndex
}) {
  if (
    !Array.isArray(lines) ||
    !Number.isInteger(telemetryHeaderIndex) ||
    telemetryHeaderIndex < 0 ||
    telemetryHeaderIndex >= lines.length
  ) {
    return [];
  }

  const headers = lines[telemetryHeaderIndex]
    .split(",")
    .map((name) => name.trim().replace(/^"|"$/g, ""));

  const columnIndex = headers.indexOf(PID_PROFILE_COLUMN);

  if (columnIndex < 0) {
    return [];
  }

  const segments = [];

  for (
    let rowIndex = telemetryHeaderIndex + 1;
    rowIndex < lines.length;
    rowIndex += 1
  ) {
    const raw = lines[rowIndex].split(",")[columnIndex];
    const value = Number(raw);

    if (!Number.isFinite(value)) {
      continue;
    }

    const profile = value === 0 ? null : value;
    const last = segments[segments.length - 1];

    if (last && last.profile === profile) {
      last.lastRowIndex = rowIndex;
      last.sampleCount += 1;
    } else {
      segments.push({
        profile,
        firstRowIndex: rowIndex,
        lastRowIndex: rowIndex,
        sampleCount: 1
      });
    }
  }

  return segments;
}

// The distinct profiles a flight visited, in first-seen order.
export function distinctProfiles(segments) {
  const seen = [];

  for (const segment of segments ?? []) {
    if (!seen.some((profile) => profile === segment.profile)) {
      seen.push(segment.profile);
    }
  }

  return seen;
}

/**
 * Which profiles own these evidence rows?
 *
 * @returns {{ profiles: Array, unanchored: number }}
 *   profiles: distinct owning profiles (null = log-start),
 *   unanchored: rows that fell outside every segment or were
 *   not finite numbers — those cannot be attributed.
 */
export function attributeRows(segments, rowIndexes) {
  const profiles = [];
  let unanchored = 0;

  for (const rowIndex of rowIndexes ?? []) {
    const owner = Number.isInteger(rowIndex)
      ? (segments ?? []).find(
          (segment) =>
            rowIndex >= segment.firstRowIndex &&
            rowIndex <= segment.lastRowIndex
        )
      : null;

    if (!owner) {
      unanchored += 1;
      continue;
    }

    if (!profiles.some((profile) => profile === owner.profile)) {
      profiles.push(owner.profile);
    }
  }

  return { profiles, unanchored };
}

// Display name shared by the pack card and the queue reasons.
export function profileName(profile) {
  return profile === null
    ? "the log-start profile"
    : `profile ${profile}`;
}
