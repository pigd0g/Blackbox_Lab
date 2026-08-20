// ======================================================
// CONFIRMATION LEDGER — the craft remembers what it is
// waiting to find out
// ======================================================
//
// Evidence accumulates across flights instead of resetting
// every log. Two kinds of memory per craft:
//
//   Open confirmations — a pattern was seen (a confirm-
//   level entry); the ledger counts the flights that showed
//   it. A later flight with ADEQUATE evidence on that axis
//   and no pattern closes the item as not-reproduced —
//   silence with adequate evidence is an answer; silence
//   without evidence is not.
//
//   Issued packs — the last change pack this craft was
//   shown, so the next log can be checked for whether it
//   was applied before anything is graded.
//
// Same storage discipline as the craft history: plain
// localStorage, exact-key craft scoping, storage-truth.
//
// ======================================================

const LEDGER_KEY = "bbl.confirmationLedger.v1";

// A flight answers "pattern absent" only if it actually
// interrogated the axis: at least this many clean command
// events.
export const ADEQUATE_AXIS_EVENTS = 8;

function loadLedger(storage) {
  try {
    return JSON.parse(storage.getItem(LEDGER_KEY)) ?? { crafts: {} };
  } catch {
    return { crafts: {} };
  }
}

function saveLedger(storage, ledger) {
  storage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

function craftEntry(ledger, craftKey) {
  if (!ledger.crafts[craftKey]) {
    ledger.crafts[craftKey] = { openItems: [], packs: [] };
  }
  return ledger.crafts[craftKey];
}

/**
 * File one analyzed flight: reconcile open confirmations against
 * what this flight showed, and record the pack it was issued.
 *
 * confirms:  contract entries at confirm level from THIS flight
 * axisEvidence: { Roll: cleanEventCount, ... } from THIS flight
 * pack: the built pack (members recorded only when present)
 *
 * Returns the craft's open items after reconciliation, each with
 * its confirmation count — the pack card renders "seen in N
 * flights" from exactly this.
 */
export function fileAnalysis(
  storage,
  craftKey,
  { sourceHash, dateMs = 0, confirms = [], axisEvidence = {}, pack = null }
) {
  const ledger = loadLedger(storage);
  const craft = craftEntry(ledger, craftKey);

  const seenIds = new Set();

  for (const rec of confirms) {
    const id = rec.id ?? `${rec.axis}:${rec.instrument}`;
    seenIds.add(id);

    const existing = craft.openItems.find((item) => item.id === id);

    if (existing) {
      if (!existing.flights.includes(sourceHash)) {
        existing.flights.push(sourceHash);
        existing.lastSeenMs = dateMs;
      }
    } else {
      craft.openItems.push({
        id,
        axis: rec.axis ?? null,
        instrument: rec.instrument ?? null,
        finding: rec.finding ?? null,
        nextManeuver: rec.nextManeuver ?? null,
        status: "open",
        flights: [sourceHash],
        filedMs: dateMs,
        lastSeenMs: dateMs
      });
    }
  }

  // Absence with adequate evidence closes; absence without
  // evidence changes nothing.
  for (const item of craft.openItems) {
    if (item.status !== "open" || seenIds.has(item.id)) {
      continue;
    }
    if (item.flights.includes(sourceHash)) {
      continue;
    }
    const evidence = axisEvidence[item.axis];
    if (Number.isFinite(evidence) && evidence >= ADEQUATE_AXIS_EVENTS) {
      item.status = "not-reproduced";
      item.closedBy = sourceHash;
      item.closedMs = dateMs;
    }
  }

  if (pack?.members?.length) {
    craft.packs.push({
      filedMs: dateMs,
      sourceHash,
      members: pack.members.map((member) => ({
        setting: member.setting,
        direction: member.direction,
        from: member.from,
        to: member.to,
        instrument: member.instrument
      }))
    });
    // The ledger keeps a short trail, not an archive.
    if (craft.packs.length > 10) {
      craft.packs = craft.packs.slice(-10);
    }
  }

  saveLedger(storage, ledger);

  return craft.openItems.filter((item) => item.status === "open");
}

export function openConfirmations(storage, craftKey) {
  const craft = loadLedger(storage).crafts[craftKey];
  return craft
    ? craft.openItems.filter((item) => item.status === "open")
    : [];
}

/**
 * The most recent pack issued to this craft on a DIFFERENT flight —
 * the one the current log should be checked against.
 */
export function latestPack(storage, craftKey, { excludeSourceHash } = {}) {
  const craft = loadLedger(storage).crafts[craftKey];
  if (!craft) {
    return null;
  }
  for (let i = craft.packs.length - 1; i >= 0; i -= 1) {
    if (craft.packs[i].sourceHash !== excludeSourceHash) {
      return craft.packs[i];
    }
  }
  return null;
}
