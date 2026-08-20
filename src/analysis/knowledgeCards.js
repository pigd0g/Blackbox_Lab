// ======================================================
// KNOWLEDGE CARDS — what each tunable setting really does
// ======================================================
//
// One card per setting the engine may ever recommend:
// plain-words meaning, direction semantics, the firmware's
// real range, the scaling traps, the fleet's value band,
// and the numeric step a "small step" means for THIS
// setting. Cards are what turn "review the damping" into
// "raise roll damping 10 → 15".
//
// VERSION-PINNED: everything here was verified against the
// firmware source of the 4.6 line. On a log from any other
// firmware family the engine downgrades to directional
// advice — a card must never claim numeric knowledge it
// has not verified.
//
// Fleet bands come from contributed CLI dumps (percentiles
// of the values real machines fly). They are a plausibility
// guardrail, NOT proof of a good tune: a numeric step never
// crosses the band edge in its direction of travel.
//
// ======================================================

export const CARDS_FIRMWARE_PIN = "4.6";

export function cardsApplyTo(firmwareRevision) {
  return typeof firmwareRevision === "string" &&
    firmwareRevision.includes(CARDS_FIRMWARE_PIN);
}

const GAIN_RANGE = { min: 0, max: 1000 };

export const KNOWLEDGE_CARDS = {
  roll_d_gain: {
    axis: "Roll",
    meaning: "Roll damping — how firmly the roll axis is braked as it moves.",
    up: "calms overshoot and hunting after roll inputs",
    down: "frees a sluggish, over-braked roll response",
    range: GAIN_RANGE,
    fleetBand: { p10: 0, p90: 20 },
    step: 5,
    note: "Roll damping numbers are internally scaled far coarser than pitch — the same number is a much stronger brake on roll."
  },
  pitch_d_gain: {
    axis: "Pitch",
    meaning: "Pitch damping — how firmly the pitch axis is braked as it moves.",
    up: "calms overshoot and hunting after pitch inputs",
    down: "frees a sluggish, over-braked pitch response",
    range: GAIN_RANGE,
    fleetBand: { p10: 12, p90: 65 },
    step: 8
  },
  yaw_d_gain: {
    axis: "Yaw",
    meaning: "Tail damping — how firmly yaw motion is braked.",
    up: "calms tail wag and overshoot on stops",
    down: "frees a mushy, over-braked tail",
    range: GAIN_RANGE,
    fleetBand: { p10: 10, p90: 45 },
    step: 8
  },
  roll_f_gain: {
    axis: "Roll",
    meaning: "Roll feedforward — how much stick goes straight to the swash, ahead of the feedback loop.",
    up: "sharpens the first response to roll inputs and unloads the I-term",
    down: "softens an over-eager first response",
    range: GAIN_RANGE,
    fleetBand: { p10: 95, p90: 125 },
    step: 5
  },
  pitch_f_gain: {
    axis: "Pitch",
    meaning: "Pitch feedforward — how much stick goes straight to the swash, ahead of the feedback loop.",
    up: "sharpens the first response to pitch inputs and unloads the I-term",
    down: "softens an over-eager first response",
    range: GAIN_RANGE,
    fleetBand: { p10: 95, p90: 130 },
    step: 5
  },
  yaw_f_gain: {
    axis: "Yaw",
    meaning: "Yaw feedforward — stick straight to the tail, ahead of the feedback loop.",
    up: "sharpens yaw starts and unloads the I-term",
    down: "softens over-eager yaw starts",
    range: GAIN_RANGE,
    fleetBand: { p10: 0, p90: 15 },
    step: 5
  },
  roll_p_gain: {
    axis: "Roll",
    meaning: "Roll proportional gain — how hard the loop pushes against roll error.",
    up: "tightens tracking against disturbance",
    down: "calms a nervous, oscillation-prone roll",
    range: GAIN_RANGE,
    fleetBand: { p10: 48, p90: 70 },
    step: 5
  },
  pitch_p_gain: {
    axis: "Pitch",
    meaning: "Pitch proportional gain — how hard the loop pushes against pitch error.",
    up: "tightens tracking against disturbance",
    down: "calms a nervous, oscillation-prone pitch",
    range: GAIN_RANGE,
    fleetBand: { p10: 50, p90: 120 },
    step: 10
  },
  yaw_p_gain: {
    axis: "Yaw",
    meaning: "Yaw proportional gain — how hard the loop pushes against tail error. Multiplies with the stop gains.",
    up: "firms up tail hold and stops",
    down: "calms tail oscillation",
    range: GAIN_RANGE,
    fleetBand: { p10: 65, p90: 115 },
    step: 8
  },
  yaw_cw_stop_gain: {
    axis: "Yaw",
    meaning: "Clockwise stop gain — extra authority while arresting a clockwise yaw.",
    up: "crisper clockwise stops",
    down: "softer clockwise stops (less bounce)",
    range: { min: 25, max: 250 },
    fleetBand: { p10: 110, p90: 130 },
    step: 5,
    note: "Direction-specific: a one-sided stop problem points here, a symmetric one points at yaw P."
  },
  yaw_ccw_stop_gain: {
    axis: "Yaw",
    meaning: "Counter-clockwise stop gain — extra authority while arresting a counter-clockwise yaw.",
    up: "crisper counter-clockwise stops",
    down: "softer counter-clockwise stops (less bounce)",
    range: { min: 25, max: 250 },
    fleetBand: { p10: 80, p90: 85 },
    step: 5,
    note: "Direction-specific: a one-sided stop problem points here, a symmetric one points at yaw P."
  },
  yaw_collective_ff_gain: {
    axis: "Yaw",
    meaning: "Collective-to-yaw precomp — counters the tail kick that collective pitch produces.",
    up: "stronger counter to the kick on collective moves",
    down: "weaker counter (use when the tail overcorrects on collective)",
    range: { min: 0, max: 250 },
    fleetBand: { p10: 45, p90: 60 },
    step: 5
  },
  gov_gain: {
    meaning: "Governor master gain — scales the whole headspeed regulation at once.",
    up: "firmer headspeed hold overall",
    down: "calms governor hunting overall",
    range: { min: 0, max: 250 },
    fleetBand: { p10: 40, p90: 50 },
    step: 5,
    note: "Scales every governor term together — never change it alongside an individual governor gain."
  },
  gov_p_gain: {
    meaning: "Governor proportional gain — immediate response to headspeed error.",
    up: "quicker catch on droops",
    down: "calms fast governor oscillation",
    range: { min: 0, max: 250 },
    fleetBand: { p10: 25, p90: 40 },
    step: 5
  },
  gov_i_gain: {
    meaning: "Governor integral gain — how quickly sustained droop is worked away.",
    up: "faster recovery from sustained droop",
    down: "calms slow headspeed weave",
    range: { min: 0, max: 250 },
    fleetBand: { p10: 50, p90: 60 },
    step: 5
  }
};

export function getCard(setting) {
  return KNOWLEDGE_CARDS[setting] ?? null;
}

/**
 * The numeric step a recommendation means, from the craft's actual
 * current value. Returns { from, to } or null when no honest number
 * exists (no card, no finite current value, or the current value
 * already sits at/beyond the fleet band edge in the direction of
 * travel — then the recommendation stays directional and says why).
 */
export function numericStep(setting, currentValue, direction) {
  const card = getCard(setting);
  const from = Number(currentValue);

  if (!card || !Number.isFinite(from)) {
    return null;
  }

  const sign = direction === "down" ? -1 : 1;
  let to = from + sign * card.step;

  // Firmware range is a hard wall.
  to = Math.min(card.range.max, Math.max(card.range.min, to));

  // Fleet band edge is the guardrail in the direction of travel:
  // never step past it, and never issue a number when the craft
  // already sits at or beyond it.
  const edge = sign > 0 ? card.fleetBand.p90 : card.fleetBand.p10;
  const beyond = sign > 0 ? from >= edge : from <= edge;

  if (beyond) {
    return null;
  }

  to = sign > 0 ? Math.min(to, edge) : Math.max(to, edge);

  return to === from ? null : { from, to };
}
