// ======================================================
// APPLIED-STATE CHECK — did the pack actually reach the
// helicopter?
// ======================================================
//
// Before any verdict about a change, the change itself must
// be confirmed on the aircraft: typos, partial pastes and
// wrong-profile writes must read as "pack not applied",
// never as false verdicts. The blackbox headers of the NEXT
// log carry the flown PID arrays, so most tuning members
// verify from the log itself; settings the headers don't
// carry are reported unverifiable — honestly — and confirm
// via a fresh CLI dump instead.
//
// Header layout verified empirically against a paired
// log + CLI dump (roll/pitch arrays match value for value)
// and against the firmware's own header writer for the
// governor line:
//   <axis>PID = P,I,D,F,B      govPID = P,I,D,F,gain
//
// ======================================================

const HEADER_MAP = {
  roll_p_gain: { header: "rollPID", index: 0 },
  roll_i_gain: { header: "rollPID", index: 1 },
  roll_d_gain: { header: "rollPID", index: 2 },
  roll_f_gain: { header: "rollPID", index: 3 },
  roll_b_gain: { header: "rollPID", index: 4 },
  pitch_p_gain: { header: "pitchPID", index: 0 },
  pitch_i_gain: { header: "pitchPID", index: 1 },
  pitch_d_gain: { header: "pitchPID", index: 2 },
  pitch_f_gain: { header: "pitchPID", index: 3 },
  pitch_b_gain: { header: "pitchPID", index: 4 },
  yaw_p_gain: { header: "yawPID", index: 0 },
  yaw_i_gain: { header: "yawPID", index: 1 },
  yaw_d_gain: { header: "yawPID", index: 2 },
  yaw_f_gain: { header: "yawPID", index: 3 },
  yaw_b_gain: { header: "yawPID", index: 4 },
  gov_p_gain: { header: "govPID", index: 0 },
  gov_i_gain: { header: "govPID", index: 1 },
  gov_d_gain: { header: "govPID", index: 2 },
  gov_f_gain: { header: "govPID", index: 3 },
  gov_gain: { header: "govPID", index: 4 }
};

export function readHeaderSetting(getHeaderValue, setting) {
  const entry = HEADER_MAP[setting];
  if (!entry) {
    return null;
  }

  const raw = getHeaderValue(entry.header);
  if (typeof raw !== "string" || raw === "Not found") {
    return null;
  }

  const value = Number(raw.split(",")[entry.index]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Compare an issued pack against the headers of a later log.
 * Per member: applied | not-applied | unverifiable. Overall:
 *   applied     — every verifiable member matches its target
 *   partial     — some match, some don't
 *   not-applied — verifiable members all still read their old value
 *   unknown     — nothing was verifiable from the headers
 */
export function assessAppliedState({ packMembers = [], getHeaderValue }) {
  const members = [];
  let applied = 0;
  let missed = 0;

  for (const member of packMembers) {
    const actual = readHeaderSetting(getHeaderValue, member.setting);

    if (actual === null || !Number.isFinite(member.to)) {
      members.push({
        setting: member.setting,
        state: "unverifiable",
        actual,
        expected: Number.isFinite(member.to) ? member.to : null
      });
      continue;
    }

    const state = actual === member.to ? "applied" : "not-applied";
    if (state === "applied") applied += 1;
    else missed += 1;

    members.push({
      setting: member.setting,
      state,
      actual,
      expected: member.to
    });
  }

  const verdict =
    applied + missed === 0
      ? "unknown"
      : missed === 0
        ? "applied"
        : applied === 0
          ? "not-applied"
          : "partial";

  return { verdict, members, applied, missed };
}
