// ======================================================
// RECOMMENDATION CONTRACT — the one shape every surface
// renders and every pack is built from.
// ======================================================
//
// A recommendation is a claim with its evidence attached:
// what was found, how sure we are, what to do about it,
// and — critically — which INSTRUMENT in the next log will
// judge it. Labs emit these; the Lab pages, Home, Compare
// and the exported report render them; the pack builder
// selects among them; the confirmation ledger files them.
// Nothing composes its own recommendation text anymore.
//
// The shape is deliberately also the training-data schema:
// a verified pack member is this object plus an outcome.
//
// Levels (evidence-gated, see the doctrine):
//   observed — a finding exists; evidence too thin or the
//              item is blocked. No knob.
//   confirm  — plausible pattern; the exact next-flight
//              maneuver that would confirm it is named.
//   earned   — evidence cleared its gates; the change is
//              stated (numeric only with a dump on file).
//
// Domains: tuning | mechanical | data | setup | none.
//
// ======================================================

export const CONTRACT_VERSION = 1;

// The maneuver a "confirm" asks for, per axis family. One
// sentence, flyable, demand-matched by construction (same
// headspeed, deliberate inputs).
const CONFIRM_MANEUVERS = {
  Roll: "Repeat 4-6 deliberate roll inputs with clean stops and reversals at the same headspeed.",
  Pitch: "Repeat 4-6 deliberate pitch inputs with clean stops and reversals at the same headspeed.",
  Yaw: "Repeat 4-6 deliberate yaw stops in both directions at the same headspeed.",
  governor: "Fly the same collective work at the same headspeed bank, including a few firm pitch pumps."
};

// Machine-readable instrument key per recommendation family —
// the observable that verifies this change on the next log.
// The verification autopilot compares exactly this metric.
function instrumentFor(rec) {
  if (rec.lab === "governor") {
    return "governor.droop";
  }
  if (/overshoot/.test(rec.id ?? "")) {
    return `pid.${(rec.axis ?? "").toLowerCase()}.overshoot`;
  }
  return `pid.${(rec.axis ?? "").toLowerCase()}.settle`;
}

// Level derivation from the engine's existing gate outputs.
// An earned change requires a concrete suggestion; a gated
// finding whose gate asks for more evidence is a confirm;
// a gate that points at a PRECEDING problem (vibration
// first) blocks the item instead — it stays observed with
// the blocker named, and the pack builder must not pick it.
function levelFor(rec) {
  if (rec.suggestion) {
    return { level: "earned", blockedBy: null };
  }

  const gate = rec.gatedReason ?? "";

  if (/vibration|filters come before/i.test(gate)) {
    return { level: "observed", blockedBy: "vibration" };
  }

  if (/fly a log|another log|more distinct|repeat|confirm the pattern|re-read this page/i.test(gate)) {
    return { level: "confirm", blockedBy: null };
  }

  return { level: "observed", blockedBy: null };
}

// Augment one engine recommendation with its contract
// fields, in place and non-breaking: every existing
// consumer keeps working, every new surface reads the
// contract fields only.
export function finalizeRecommendation(rec, { domain = "tuning" } = {}) {
  if (!rec || typeof rec !== "object") {
    return rec;
  }

  const { level, blockedBy } = levelFor(rec);

  rec.contractVersion = CONTRACT_VERSION;
  rec.level = level;
  rec.domain = domain;
  rec.blockedBy = blockedBy;
  rec.instrument = rec.instrument ?? instrumentFor(rec);

  // Contract guarantee: every renderer may map over the evidence
  // list without ceremony — an entry born without one gets the
  // empty list, never undefined (v1.4.0 field crash, RS6 log).
  if (!Array.isArray(rec.evidence)) {
    rec.evidence = [];
  }

  // The count a confidence line quotes. Engine entries keep up to
  // six anchored rows but were measured on every qualifying event;
  // the number shown is the number measured, never the number kept.
  if (!Number.isInteger(rec.evidenceCount)) {
    rec.evidenceCount = rec.evidence.length;
  }

  if (level === "confirm" && !rec.nextManeuver) {
    rec.nextManeuver =
      CONFIRM_MANEUVERS[rec.axis] ??
      CONFIRM_MANEUVERS[rec.lab] ??
      "Fly the same maneuvers again at the same headspeed.";
  }

  return rec;
}

export function finalizeRecommendations(nextSteps) {
  for (const rec of nextSteps?.pid ?? []) {
    finalizeRecommendation(rec, { domain: "tuning" });
  }
  for (const rec of nextSteps?.governor ?? []) {
    finalizeRecommendation(rec, { domain: "tuning" });
  }
  return nextSteps;
}

// Response-behavior Reviews (bounce-back, settling, ringing) can
// exist without any engine recommendation: the pattern is real but
// below the recommendation gates. The exported report already
// prescribes the evidence flight for them — the contract must say
// the same thing, or the pack card and the report disagree. One
// confirm entry per axis with a Review and no engine entry.
const CHECK_INSTRUMENT = {
  "bounce-back": "overshoot",
  settling: "settle",
  ringing: "settle"
};

export function confirmsFromResponseBehavior(
  responseBehavior,
  existingRecommendations = []
) {
  const coveredAxes = new Set(
    existingRecommendations
      .map((rec) => rec.axis)
      .filter(Boolean)
  );

  const confirms = [];
  const seenAxes = new Set();

  for (const checkResult of responseBehavior ?? []) {
    if (checkResult.status !== "Review") continue;
    if (coveredAxes.has(checkResult.axis)) continue;
    if (seenAxes.has(checkResult.axis)) continue;
    seenAxes.add(checkResult.axis);

    // The confirm entry carries the check's own event rows: the
    // finding, the confidence line and the pack card all count the
    // same evidence, and a multi-profile flight can attribute it.
    const evidenceRows = Array.isArray(checkResult.evidenceRows)
      ? checkResult.evidenceRows
      : [];
    const eventCount = Number.isInteger(checkResult.eventCount)
      ? checkResult.eventCount
      : evidenceRows.length;

    confirms.push(
      finalizeRecommendation({
        id: `pid:${checkResult.axis}:${checkResult.check}:confirm`,
        lab: "pid",
        axis: checkResult.axis,
        suggestion: null,
        confidence: checkResult.confidence ?? null,
        evidence: evidenceRows,
        evidenceCount: eventCount,
        evidenceLabel:
          `${eventCount} valid ${checkResult.axis} ${checkResult.check} ` +
          `event${eventCount === 1 ? "" : "s"}; more repeat events are ` +
          "needed before a tuning change is earned",
        finding:
          `${checkResult.axis} ${checkResult.check} flagged for review` +
          (checkResult.evidence ? ` (${checkResult.evidence})` : "") +
          ".",
        hypothesis:
          "The pattern is real, but this flight offered too few clean commands to earn a change — one dedicated evidence flight settles it.",
        gatedReason:
          "The pattern is real but below the recommendation gates — confirm the pattern with a dedicated evidence flight before any change.",
        instrument: `pid.${checkResult.axis.toLowerCase()}.${
          CHECK_INSTRUMENT[checkResult.check] ?? "settle"
        }`
      })
    );
  }

  return confirms;
}

// The training-data view of a verified pack member (D5):
// the contract object plus what the verifying flight said.
// Kept here so the schema evolves WITH the contract, never
// beside it. Outcome: kept | revert | inconclusive.
export function toOutcomeRecord(rec, { outcome, verifyingFlightId = null } = {}) {
  return {
    contractVersion: rec.contractVersion ?? CONTRACT_VERSION,
    id: rec.id ?? null,
    lab: rec.lab ?? null,
    axis: rec.axis ?? null,
    level: rec.level ?? null,
    domain: rec.domain ?? null,
    instrument: rec.instrument ?? null,
    suggestion: rec.suggestion ?? null,
    confidence: rec.confidence ?? null,
    outcome: outcome ?? null,
    verifyingFlightId
  };
}
