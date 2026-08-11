// Settings dumps are text and small; a flight log is neither. Judging
// from a head of the file keeps a hundred-megabyte log from being
// pulled into a string just to find out it is not a dump.
export const LARGEST_PLAUSIBLE_DUMP_BYTES = 4 * 1024 * 1024;

/**
 * Is this file a Rotorflight settings dump rather than a flight?
 *
 * @param name  file name
 * @param size  file size in bytes
 * @param head  the first few kilobytes, decoded as text
 */
export function isSettingsDumpFile({ name = "", size = 0, head = "" } = {}) {
  if (size > LARGEST_PLAUSIBLE_DUMP_BYTES) {
    return false;
  }

  // A log names itself, whatever it contains.
  if (/\.(bbl|bfl|csv)$/i.test(name)) {
    return false;
  }

  const text = String(head);

  return (
    /^set\s+[a-z0-9_]+\s*=/im.test(text) &&
    /rotorflight|betaflight|# version|profile/i.test(text)
  );
}

export function identifyFile(lines, fileName = "") {
  const firstLine = lines[0] || "";
  const firstLineLower = firstLine.toLowerCase();
  const joinedStart = lines.slice(0, 30).join("\n").toLowerCase();
  const nameLower = String(fileName).toLowerCase();

  // Content wins over file name: a blackbox_decode export is named
  // *.csv but carries the full Blackbox log inside, and deserves the
  // full analysis. Only when the content does not identify itself do
  // we fall back to the extension checks below.
  if (joinedStart.includes("blackbox flight data recorder")) {
    return "Blackbox BBL Log";
  }

  // Check the final file extension next.
  // Explorer exports can be named *.bbl.csv but are still CSV files.
  if (nameLower.endsWith(".csv")) {
    return "CSV Telemetry Export";
  }

  if (nameLower.endsWith(".bbl")) {
    return "Blackbox BBL Log";
  }

  if (
    firstLineLower.includes("resource ") ||
    joinedStart.includes("# resource")
  ) {
    return "Rotorflight CLI Dump";
  }

  if (
    firstLineLower.includes("time") &&
    firstLine.includes(",")
  ) {
    return "CSV Telemetry Export";
  }

  return "Unknown File Type";
}
