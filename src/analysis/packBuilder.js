// ======================================================
// PACK BUILDER — bundle the earned changes that can be
// told apart, and nothing else
// ======================================================
//
// Input: the contract recommendations of one analyzed
// flight plus (optionally) the craft's saved CLI dump and
// the log's firmware revision. Output: one change pack —
// at most PACK_CAP tuning changes, at most one per
// interference group, each verified next flight by its own
// instrument — plus the confirm-level maneuver
// prescriptions (those bundle freely: one evidence flight
// can collect them all) and the queue of earned changes
// that did NOT make the pack, each with its reason stated.
//
// Numeric from → to values appear only when the craft's
// dump supplies the current value AND the knowledge cards'
// firmware pin matches the log — otherwise the member stays
// directional and says why.
//
// ======================================================

import {
  groupOf,
  groupsConflict,
  isGovernorGroup
} from "./interferenceGroups.js";
import {
  getCard,
  numericStep,
  cardsApplyTo,
  CARDS_FIRMWARE_PIN
} from "./knowledgeCards.js";
import { readHeaderSetting } from "./appliedState.js";

export const PACK_CAP = 3;

const CONFIDENCE_ORDER = { High: 0, Medium: 1, Low: 2 };

export function buildPack({
  recommendations = null,
  craftDumpParsed = null,
  firmwareRevision = "",
  packCap = PACK_CAP,
  getHeaderValue = null,
  dumpFreshness = null
} = {}) {
  const all = [
    ...(recommendations?.pid ?? []),
    ...(recommendations?.governor ?? [])
  ];

  const earned = all.filter(
    (rec) => rec.level === "earned" && !rec.blockedBy && rec.suggestion?.family
  );
  const confirms = all.filter((rec) => rec.level === "confirm");
  const blocked = all.filter((rec) => rec.blockedBy);

  // Strongest evidence first; ties keep engine order (which already
  // ranks by finding severity within each lab).
  const ordered = [...earned].sort(
    (a, b) =>
      (CONFIDENCE_ORDER[a.confidence] ?? 3) -
      (CONFIDENCE_ORDER[b.confidence] ?? 3)
  );

  const numericAllowed = cardsApplyTo(firmwareRevision);
  const members = [];
  const queued = [];

  for (const rec of ordered) {
    const setting = rec.suggestion.family;
    const group = groupOf(setting);

    const clash = members.find((member) =>
      groupsConflict(member.group, group)
    );

    if (clash) {
      queued.push({
        rec,
        reason: `shares the ${clash.group} instrument with the ${clash.setting} change — next pack`
      });
      continue;
    }

    if (members.length >= packCap) {
      queued.push({ rec, reason: "pack is full — next pack" });
      continue;
    }

    const card = getCard(setting);
    const direction = rec.suggestion.direction === "down" ? "down" : "up";
    // The truest current value is what the helicopter actually FLEW:
    // the log's own headers beat the saved dump wherever both exist,
    // which makes numeric steps immune to a stale dump for every
    // mapped setting. The dump remains the source for settings the
    // headers do not carry.
    const flown = getHeaderValue
      ? readHeaderSetting(getHeaderValue, setting)
      : null;
    const current = flown ?? craftDumpParsed?.[setting];
    const currentSource = flown !== null ? "log" : "dump";
    const step = numericAllowed
      ? numericStep(setting, current, direction)
      : null;

    let numericNote = null;
    if (!step) {
      if (!numericAllowed) {
        numericNote = `numeric values need a firmware ${CARDS_FIRMWARE_PIN} log — direction only`;
      } else if (craftDumpParsed == null) {
        numericNote = "no CLI dump on file for this craft — direction only";
      } else if (!Number.isFinite(Number(current))) {
        numericNote = "the saved dump does not carry this setting — direction only";
      } else {
        numericNote =
          "the current value already sits at the fleet band edge — direction only, and worth a second look before pushing further";
      }
    }

    let freshnessNote = null;
    if (
      step &&
      currentSource === "dump" &&
      dumpFreshness &&
      !dumpFreshness.fresh
    ) {
      freshnessNote =
        `the saved dump disagrees with this flight on ${dumpFreshness.mismatches.length} setting${
          dumpFreshness.mismatches.length === 1 ? "" : "s"
        } — refresh it before trusting dump-only numbers like this one`;
    }

    members.push({
      rec,
      setting,
      group,
      direction,
      currentSource,
      freshnessNote,
      magnitudeClass: rec.suggestion.magnitudeClass ?? "small step",
      from: step?.from ?? null,
      to: step?.to ?? null,
      numericNote,
      card,
      instrument: rec.instrument ?? null,
      expectedResult: rec.expectedResult ?? null,
      finding: rec.finding ?? null
    });
  }

  // Confirm-level prescriptions bundle freely: they are evidence
  // requests on DIFFERENT instruments by construction, and one
  // flight can collect them all.
  const prescriptionSet = [];
  for (const rec of confirms) {
    if (rec.nextManeuver && !prescriptionSet.includes(rec.nextManeuver)) {
      prescriptionSet.push(rec.nextManeuver);
    }
  }

  return {
    members,
    queued,
    prescriptions: prescriptionSet,
    blocked: blocked.map((rec) => ({
      finding: rec.finding ?? rec.id ?? "finding",
      blockedBy: rec.blockedBy
    })),
    // A governor member means the verifying flight only counts for
    // the cyclic members if headspeed held as tightly as before —
    // the evaluation checks this; the pack card says it.
    requiresHeadspeedHold:
      members.some((member) => isGovernorGroup(member.group)) &&
      members.some((member) => !isGovernorGroup(member.group)),
    numericAllowed,
    firmwarePin: CARDS_FIRMWARE_PIN
  };
}
