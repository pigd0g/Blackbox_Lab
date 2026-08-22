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
import {
  distinctProfiles,
  attributeRows,
  profileName
} from "./profileSegments.js";

export const PACK_CAP = 3;

const CONFIDENCE_ORDER = { High: 0, Medium: 1, Low: 2 };

export function buildPack({
  recommendations = null,
  craftDumpParsed = null,
  firmwareRevision = "",
  packCap = PACK_CAP,
  getHeaderValue = null,
  dumpFreshness = null,
  headspeedBanks = null,
  profileSegments = null
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

  // A flight that held two or more distinct headspeed banks mixed
  // two regimes into every instrument that earned these changes —
  // and the verifying flight could not attribute its deltas either.
  // When the log recorded no profile switch to segment by, tuning
  // members are withheld on such flights: honest refusal over
  // confident misattribution. Evidence prescriptions still ride
  // along. (A recorded switch lifts this — see the per-profile
  // attribution below, which knows which rows flew which tune.)
  // Bank clusters within a few percent are one flown regime: a
  // drooping acro bank smears across the lab's 1.5% clusters, and
  // telling a pilot who flew hover + acro that they "held four
  // banks" would be the instrument talking, not the flight.
  const bankRpms = (Array.isArray(headspeedBanks) ? headspeedBanks : [])
    .map((bank) => bank?.averageRpm ?? bank?.targetRpm)
    .filter((rpm) => Number.isFinite(rpm) && rpm > 0)
    .sort((a, b) => a - b);

  const regimes = [];
  for (const rpm of bankRpms) {
    const last = regimes[regimes.length - 1];
    if (last && rpm <= last.max * 1.03) {
      last.max = rpm;
      last.sum += rpm;
      last.count += 1;
    } else {
      regimes.push({ max: rpm, sum: rpm, count: 1 });
    }
  }
  const sustainedBanks = regimes.map((regime) => ({
    averageRpm: Math.round(regime.sum / regime.count)
  }));

  // Per-profile segmentation: when the log RECORDED its profile
  // switches, each earned change is attributed to the profile whose
  // rows its evidence lives in — and the blanket multi-bank refusal
  // above gives way to that attribution: the flight can say which
  // tune earned what, so it does. The pack verifies ONE profile per
  // flight; members attributed elsewhere queue for their own pack.
  // Changes whose evidence spans profiles, or carries no row
  // anchors, still queue — attribution is never guessed.
  const segments = Array.isArray(profileSegments)
    ? profileSegments
    : [];
  const flownProfiles = distinctProfiles(segments);
  const multiProfile = flownProfiles.length >= 2;
  const multiBankWithheld =
    !multiProfile && sustainedBanks.length >= 2;
  let packProfile;

  for (const rec of ordered) {
    if (multiBankWithheld) {
      queued.push({
        rec,
        reason:
          "this flight held " +
          `${sustainedBanks.length} different headspeed banks — ` +
          "its evidence mixes two regimes, so tuning changes wait " +
          "for a single-bank flight"
      });
      continue;
    }

    let memberProfile = null;

    if (multiProfile) {
      const anchoredRows = (rec.evidence ?? [])
        .map((item) => item?.rowIndex)
        .filter(Number.isInteger);

      if (anchoredRows.length === 0) {
        queued.push({
          rec,
          reason:
            "this flight flew " +
            `${flownProfiles.length} PID profiles and this change's ` +
            "evidence carries no row anchors — it cannot say which " +
            "profile earned it, so it waits for a single-profile flight"
        });
        continue;
      }

      const owners = attributeRows(segments, anchoredRows);

      if (owners.profiles.length !== 1 || owners.unanchored > 0) {
        const names = owners.profiles.map(profileName).join(" and ");

        queued.push({
          rec,
          reason:
            owners.profiles.length > 1
              ? `its evidence spans ${names} — mixed-profile evidence ` +
                "cannot be attributed, so it waits for a " +
                "single-profile flight"
              : "part of its evidence falls outside every profile " +
                "segment — it waits for a single-profile flight"
        });
        continue;
      }

      memberProfile = owners.profiles[0];

      if (packProfile === undefined) {
        packProfile = memberProfile;
      } else if (memberProfile !== packProfile) {
        queued.push({
          rec,
          reason:
            `earned in ${profileName(memberProfile)} — this pack ` +
            `verifies ${profileName(packProfile)}, so it waits for ` +
            "its own pack"
        });
        continue;
      }
    }

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

    // The log's headers (and the saved dump) describe the profile
    // the log STARTED in — for a change earned in a switched-to
    // profile, no source names that profile's current values, so
    // the member stays directional and says why.
    const numbersDescribeThisProfile =
      !multiProfile || memberProfile === null;

    const step =
      numericAllowed && numbersDescribeThisProfile
        ? numericStep(setting, current, direction)
        : null;

    let numericNote = null;
    if (!step) {
      if (!numbersDescribeThisProfile) {
        numericNote =
          `the log's headers describe the profile it started in, not ` +
          `${profileName(memberProfile)} — direction only until a ` +
          `log flown in ${profileName(memberProfile)} from the start`;
      } else if (!numericAllowed) {
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
      profile: multiProfile ? memberProfile : undefined,
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
    firmwarePin: CARDS_FIRMWARE_PIN,
    // Multi-profile flights: which profiles flew, and which one this
    // pack's members belong to (undefined when nothing attributed).
    profiles: multiProfile
      ? {
          flown: flownProfiles,
          packProfile: packProfile === undefined ? null : packProfile,
          packProfileName:
            packProfile === undefined
              ? null
              : profileName(packProfile)
        }
      : null,
    withheld: multiBankWithheld
      ? {
          reason: "multi-bank flight",
          banks: sustainedBanks.map(
            (bank) => bank.averageRpm ?? bank.targetRpm
          )
        }
      : null
  };
}
