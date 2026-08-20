// ======================================================
// VERIFICATION AUTOPILOT — the grader (skeleton, silent)
// ======================================================
//
// After a pack is applied, the next log is graded per
// member against that member's own instrument: improved /
// unchanged / worse. This module is deliberately WIRED BUT
// SILENT: a verdict requires the instrument's minimum
// detectable effect under prescribed maneuvers, and those
// floors come from the field calibration, not from code.
// Until they arrive, every member grades as
// awaiting-calibration and no verdict is shown as fact.
//
// The null-variance study behind this restraint: on
// ordinary flights, no-change variance meets or exceeds
// typical change effects on every instrument — grading
// without floors would be confident noise.
//
// ======================================================

// Populated by the Phase-0 field calibration (same maneuver
// script flown twice, nothing changed). Keys are instrument
// ids; values are the minimum detectable effect per metric.
// Empty on purpose until the data exists.
export const INSTRUMENT_FLOORS = {};

export const GRADE = {
  AWAITING_CALIBRATION: "awaiting-calibration",
  NOT_APPLIED: "not-applied",
  UNVERIFIABLE: "unverifiable"
};

/**
 * Grade an applied pack against the verifying flight.
 * Every member returns a grade object; while INSTRUMENT_FLOORS
 * is empty every applied member is awaiting-calibration — the
 * card says the verification is pending, never a guessed verdict.
 */
export function gradeAppliedPack({ pack, appliedState }) {
  if (!pack?.members?.length) {
    return { members: [], status: "nothing-to-grade" };
  }

  const stateOf = new Map(
    (appliedState?.members ?? []).map((member) => [
      member.setting,
      member.state
    ])
  );

  const members = pack.members.map((member) => {
    const applied = stateOf.get(member.setting);

    if (applied === "not-applied") {
      return {
        setting: member.setting,
        instrument: member.instrument,
        grade: GRADE.NOT_APPLIED
      };
    }
    if (applied === "unverifiable") {
      return {
        setting: member.setting,
        instrument: member.instrument,
        grade: GRADE.UNVERIFIABLE
      };
    }

    const floor = INSTRUMENT_FLOORS[member.instrument];
    return {
      setting: member.setting,
      instrument: member.instrument,
      grade: floor ? null : GRADE.AWAITING_CALIBRATION
    };
  });

  return {
    members,
    status: members.every((m) => m.grade === GRADE.AWAITING_CALIBRATION)
      ? "awaiting-calibration"
      : "mixed"
  };
}
