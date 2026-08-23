// ======================================================
// BLACKBOX LAB — BBL → CSV ADAPTER
// ======================================================
//
// Renders one decoded flight in the same shape as a
// classic Blackbox CSV export: quoted metadata lines,
// then a column header row, then one row per main frame
// (with the latest slow-frame values carried forward).
//
// This is the bridge that lets every existing Blackbox
// Lab analysis module work on raw .bbl files without
// changing a single line of analysis code.
//
// ======================================================

import { registerColumnTable } from "../columnTable.js";

// Rotorflight adjustment function id for the PID profile
// (fc/rc_adjustments.h: ADJUSTMENT_PID_PROFILE = 2).
const PID_PROFILE_ADJUSTMENT = 2;

export function decodedFlightToCsvLines(flight) {
  const lines = [];

  // ---- metadata block (blackbox_decode style) ----
  // "Field X ..." definition lines are skipped: their values
  // contain the whole comma-separated field list, which the
  // telemetry-header detector would mistake for the actual
  // column header row (off-by-one column bug).
  for (const [key, value] of flight.headers.entries()) {
    if (key.startsWith("Field ")) {
      continue;
    }

    lines.push(`"${key}","${value}"`);
  }

  // The analysis pipeline reads a lowercase "firmware" key.
  if (flight.sysConfig.firmwareType) {
    const firmware = [
      flight.sysConfig.firmwareType,
      flight.sysConfig.firmwareRevision
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(`"firmware","${firmware}"`);
  }

  // ---- column header row ----
  // Add compatibility aliases expected by the existing analysis pipeline.
  const mainNames = [...flight.mainFieldNames];

  const addAlias = (sourceName, aliasName) => {
    const sourceIndex = mainNames.indexOf(sourceName);

    if (sourceIndex >= 0 && !mainNames.includes(aliasName)) {
      mainNames.push(aliasName);
    }
  };

  addAlias("Vbat", "vbatLatest");

  const slowNames = flight.slowFieldNames;
  const columnNames = [...mainNames, ...slowNames];

  // In-flight PID profile switches, decoded from adjustment events.
  // The column carries the ACTIVE profile number per row — 0 until
  // the first switch, because the log never names the profile it
  // started in (headers record that profile's settings, not its
  // number). Flights without a switch get no column at all: absence
  // means single-profile, and the analysis stays exactly as it was.
  const profileSwitches = (flight.events ?? [])
    .filter(
      (event) =>
        event.adjustmentFunction === PID_PROFILE_ADJUSTMENT &&
        Number.isFinite(event.value) &&
        Number.isInteger(event.afterMainFrame)
    )
    .sort((a, b) => a.afterMainFrame - b.afterMainFrame);

  const emitPidProfile = profileSwitches.length > 0;

  if (emitPidProfile) {
    columnNames.push("pidProfile");
  }

  const headerIndex = lines.length;
  lines.push(columnNames.join(","));

  // The column table, filled from the typed frame values as the rows
  // are written — the analysis reads these numbers; the text is the
  // same numbers rendered. Metadata rows above the header stay NaN.
  const rowCount = headerIndex + 1 + flight.mainFrames.length;
  const width = columnNames.length;
  const columns = new Array(width);
  for (let c = 0; c < width; c += 1) {
    const column = new Float64Array(rowCount);
    column.fill(Number.NaN, 0, headerIndex + 1);
    columns[c] = column;
  }
  const empties = new Array(width).fill(null);

  // ---- data rows with slow values carried forward ----
  const slowCurrent = new Array(slowNames.length).fill(0);
  let slowCursor = 0;
  let activeProfile = 0;
  let profileCursor = 0;

  const vbatIndex = flight.mainFieldNames.indexOf("Vbat");
  const emitVbatAlias = vbatIndex >= 0 && mainNames.includes("vbatLatest");

  for (
    let frameIndex = 0;
    frameIndex < flight.mainFrames.length;
    frameIndex += 1
  ) {
    while (
      slowCursor < flight.slowFrames.length &&
      flight.slowFrames[slowCursor].afterMainFrame < frameIndex
    ) {
      const values = flight.slowFrames[slowCursor].values;

      for (let i = 0; i < slowNames.length; i += 1) {
        slowCurrent[i] = values[i];
      }

      slowCursor += 1;
    }

    const main = flight.mainFrames[frameIndex];
    const row = new Array(columnNames.length);

    for (let i = 0; i < main.length; i += 1) {
      row[i] = main[i];
    }

    let cursor = main.length;

    if (emitVbatAlias) {
      row[cursor] = main[vbatIndex];
      cursor += 1;
    }

    for (let i = 0; i < slowCurrent.length; i += 1) {
      row[cursor + i] = slowCurrent[i];
    }

    if (emitPidProfile) {
      while (
        profileCursor < profileSwitches.length &&
        profileSwitches[profileCursor].afterMainFrame < frameIndex
      ) {
        activeProfile = profileSwitches[profileCursor].value;
        profileCursor += 1;
      }

      row[cursor + slowCurrent.length] = activeProfile;
    }

    const lineIndex = lines.length;
    for (let c = 0; c < width; c += 1) {
      const value = row[c];
      if (value === undefined || value === null) {
        // join() renders a hole as "" — Number("") is 0, and the
        // aligned readers see a blank.
        columns[c][lineIndex] = 0;
        (empties[c] ??= []).push(lineIndex);
      } else {
        const number = typeof value === "number" ? value : Number(String(value));
        columns[c][lineIndex] = number === 0 ? 0 : number;
      }
    }

    lines.push(row.join(","));
  }

  registerColumnTable(lines, headerIndex, {
    headerCells: columnNames.map((name) => String(name)),
    columns,
    empties
  });

  return lines;
}
