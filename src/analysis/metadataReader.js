// When the flight happened, in epoch milliseconds.
//
// The log's own "Log start datetime" header is the authority: it
// travels inside the file, so a copied, renamed or re-exported log
// still reports the flight it actually holds. A file timestamp is
// only the fallback, and a poor one — a flight controller with no
// RTC set writes a zeroed timestamp that reaches JavaScript as the
// Windows zero FILETIME (1601-01-01), which is a real number and
// would otherwise render as a real, wrong date.
//
// Returns null when no trustworthy date exists. Callers must show
// that as unavailable rather than inventing one.
const EARLIEST_PLAUSIBLE_FLIGHT_MS = Date.UTC(2010, 0, 1);

export function resolveFlightDateMs(lines, fileLastModifiedMs) {
  const header = getMetadataValue(lines, "Log start datetime");

  if (header && header !== "Not found") {
    const headerMs = Date.parse(header);

    if (isPlausibleFlightDate(headerMs)) {
      return headerMs;
    }
  }

  return isPlausibleFlightDate(fileLastModifiedMs)
    ? Number(fileLastModifiedMs)
    : null;
}

export function isPlausibleFlightDate(value) {
  const milliseconds = Number(value);

  return (
    Number.isFinite(milliseconds) &&
    milliseconds >= EARLIEST_PLAUSIBLE_FLIGHT_MS &&
    milliseconds <= Date.now() + ONE_DAY_MS
  );
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function getMetadataValue(lines, key) {
  const target = `"${key}"`;
  const foundLine = lines.find((line) => line.startsWith(target));

  if (!foundLine) {
    return "Not found";
  }

  const parts = foundLine.split(",");

  if (parts.length < 2) {
    return "Not found";
  }

  return parts
    .slice(1)
    .join(",")
    .replaceAll('"', "")
    .trim();
}