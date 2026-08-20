// ======================================================
// INTERFERENCE GROUPS — which settings share an observable
// ======================================================
//
// Derived from the flight-controller control law at source
// level: settings inside one group shape the SAME observable
// in a log, so their effects cannot be told apart within a
// single flight. The pack builder takes at most one member
// per group — that is the whole change-pack doctrine in one
// rule ("one change per instrument").
//
// Groups are deliberately coarser than the firmware's term
// structure where telling members apart would need a
// dedicated maneuver we cannot assume (yaw P and the stop
// gains multiply, so they live together).
//
// ======================================================

export const SETTING_GROUP = {
  // Cyclic feedback paths — P and D act on the same filtered
  // gyro signal per axis; oscillation and damping verdicts
  // cannot split them in one flight.
  roll_p_gain: "roll-feedback",
  roll_d_gain: "roll-feedback",
  pitch_p_gain: "pitch-feedback",
  pitch_d_gain: "pitch-feedback",

  // Cyclic command response — feedforward and boost both
  // shape the leading edge of the same step.
  roll_f_gain: "roll-command",
  roll_b_gain: "roll-command",
  pitch_f_gain: "pitch-command",
  pitch_b_gain: "pitch-command",

  // Cyclic slow trim — I and O and their decay family share
  // the sub-Hz drift observable.
  roll_i_gain: "roll-drift",
  roll_o_gain: "roll-drift",
  pitch_i_gain: "pitch-drift",
  pitch_o_gain: "pitch-drift",

  // Yaw: P multiplies with the stop gains and shares the
  // filtered signal with D — one yaw-response change per
  // pack, full stop.
  yaw_p_gain: "yaw-response",
  yaw_d_gain: "yaw-response",
  yaw_cw_stop_gain: "yaw-response",
  yaw_ccw_stop_gain: "yaw-response",
  yaw_i_gain: "yaw-drift",
  yaw_f_gain: "yaw-command",
  yaw_b_gain: "yaw-command",

  // Yaw precomp family — all of it sums into one injected
  // signal; only dedicated maneuvers separate the members.
  yaw_collective_ff_gain: "yaw-precomp",
  yaw_cyclic_ff_gain: "yaw-precomp",
  yaw_precomp_cutoff: "yaw-precomp",
  yaw_inertia_precomp_gain: "yaw-precomp",
  yaw_inertia_precomp_cutoff: "yaw-precomp",

  // Governor: the feedback gains share the regulation trace;
  // the feedforward weights share the separately-logged
  // anticipation trace; the master gain scales BOTH and
  // therefore conflicts with everything governor.
  gov_p_gain: "gov-feedback",
  gov_i_gain: "gov-feedback",
  gov_d_gain: "gov-feedback",
  gov_gain: "gov-master",
  gov_f_gain: "gov-feedforward",
  gov_collective_ff_weight: "gov-feedforward",
  gov_cyclic_ff_weight: "gov-feedforward",
  gov_yaw_ff_weight: "gov-feedforward"
};

export function groupOf(setting) {
  return SETTING_GROUP[setting] ?? null;
}

// Two groups conflict when their members' effects land on the
// same observable. Identity aside, the governor master gain
// multiplies both governor paths at once, so it conflicts with
// every governor group.
export function groupsConflict(groupA, groupB) {
  if (!groupA || !groupB) {
    return false;
  }
  if (groupA === groupB) {
    return true;
  }
  const governor = (group) => group.startsWith("gov-");
  if (
    (groupA === "gov-master" && governor(groupB)) ||
    (groupB === "gov-master" && governor(groupA))
  ) {
    return true;
  }
  return false;
}

export function isGovernorGroup(group) {
  return typeof group === "string" && group.startsWith("gov-");
}
