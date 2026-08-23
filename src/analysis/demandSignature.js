// ======================================================
// DEMAND SIGNATURE — what a flight asked of the machine
// ======================================================
//
// Two flights can only carry a before/after verdict when they asked
// comparable things of the helicopter: similar stick demand on each
// axis, enough clean commands on each axis to judge, the same
// headspeed, similar collective work, similar length, and scores
// that both rest on real evidence. Flight-to-flight variation in any
// of these is as large as a tuning change — so the comparison states
// each dimension, side by side, and lets the mismatches visibly
// lower the verdict's confidence instead of quietly calling a change
// "a keeper" (#4, #32 / incubator #38).
//
// The signature is read from what the dataset already measured; the
// matching rules are stated once, here, and the Compare page, the
// causal/neutral wording and the confidence line all read them.
//
// ======================================================

const AXES = ["Roll", "Pitch", "Yaw"];

// Per-axis clean command events both sides need before that axis is
// judged (the confirmation ledger's adequacy bar, kept in one place).
export const ADEQUATE_AXIS_EVENTS = 8;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function dominantHeadspeed(dataset) {
  const governor = dataset?.labs?.governor;
  const banks = Array.isArray(governor?.perBank) ? governor.perBank : [];
  if (banks.length > 0) {
    const top = [...banks].sort(
      (a, b) => (b.sampleCount ?? 0) - (a.sampleCount ?? 0)
    )[0];
    return {
      rpm: finiteOrNull(top.averageRpm ?? top.targetRpm),
      banks: banks
        .map((bank) => finiteOrNull(bank.averageRpm ?? bank.targetRpm))
        .filter((rpm) => rpm !== null)
    };
  }
  const average = finiteOrNull(governor?.averageHeadspeed);
  return { rpm: average, banks: average === null ? [] : [average] };
}

// How much the collective was worked: mean absolute change per
// second of the collective setpoint over the flight — pumps and
// climbs raise it, a hover leaves it near zero. Read from the
// dataset's collective column when it carries data.
function collectiveWork(dataset) {
  const collective = dataset?.collective;
  const time = dataset?.timeSeconds;
  if (!Array.isArray(collective) || !Array.isArray(time)) return null;
  const n = Math.min(collective.length, time.length);
  if (n < 100) return null;
  let sum = 0;
  let count = 0;
  for (let i = 1; i < n; i += 1) {
    const a = collective[i - 1];
    const b = collective[i];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      sum += Math.abs(b - a);
      count += 1;
    }
  }
  const duration = time[n - 1] - time[0];
  if (count === 0 || !(duration > 0)) return null;
  return sum / duration;
}

export function demandSignature(dataset) {
  const time = dataset?.timeSeconds;
  const duration =
    Array.isArray(time) && time.length ? finiteOrNull(time[time.length - 1]) : null;
  const rates = dataset?.demandRates ?? null;
  const axisRates = {};
  AXES.forEach((axis, index) => {
    axisRates[axis] = finiteOrNull(rates?.[index]);
  });
  const axisEvents = {};
  for (const axis of AXES) {
    axisEvents[axis] = Number.isFinite(dataset?.axisEvidence?.[axis])
      ? dataset.axisEvidence[axis]
      : null;
  }
  const headspeed = dominantHeadspeed(dataset);
  return {
    durationSeconds: duration,
    demandLevel: dataset?.pidConfidence?.demand ?? null,
    axisRates,
    axisEvents,
    headspeedRpm: headspeed.rpm,
    headspeedBanks: headspeed.banks,
    collectiveWork: collectiveWork(dataset),
    evidence: dataset?.pidConfidence?.level ?? null
  };
}

// ---- matching rules ----

function ratioVerdict(a, b, { match, partial }) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return ratio >= match ? "match" : ratio >= partial ? "partial" : "mismatch";
}

function worst(verdicts) {
  const order = { mismatch: 0, partial: 1, match: 2 };
  const known = verdicts.filter(Boolean);
  if (known.length === 0) return null;
  return known.sort((a, b) => order[a] - order[b])[0];
}

// "Roll, Pitch and Yaw" — never "Roll and Pitch and Yaw".
function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const SHORT_LABEL = {
  demand: "flight demand",
  rates: "stick demand",
  coverage: "maneuver coverage",
  headspeed: "headspeed",
  collective: "collective work",
  duration: "flight length",
  evidence: "evidence quality"
};

const fmtRpm = (rpm) => (Number.isFinite(rpm) ? `${Math.round(rpm)} rpm` : "not logged");
const fmtRate = (rate) => (Number.isFinite(rate) ? `${Math.round(rate)}°/s` : "—");

// One row per dimension: before, after, verdict, and the sentence
// that says what the mismatch means. `null` verdict = could not be
// judged (data missing on a side) — shown, never counted as a match.
export function compareDemand(beforeSignature, afterSignature) {
  const b = beforeSignature;
  const a = afterSignature;
  const rows = [];

  // Flight demand (gentle vs real inputs), then per-axis stick demand.
  if (b.demandLevel && a.demandLevel) {
    const same = b.demandLevel === a.demandLevel;
    rows.push({
      key: "demand",
      dimension: "Flight demand",
      before: b.demandLevel === "gentle" ? "gentle" : "real inputs",
      after: a.demandLevel === "gentle" ? "gentle" : "real inputs",
      verdict: same ? "match" : "mismatch",
      note: same
        ? null
        : "One flight was flown gently, the other much harder: the measurements describe different flying, not the change."
    });
  }

  const rateVerdicts = [];
  const rateParts = [];
  for (const axis of AXES) {
    const verdict = ratioVerdict(b.axisRates[axis], a.axisRates[axis], { match: 0.6, partial: 0.4 });
    rateVerdicts.push(verdict);
    if (Number.isFinite(b.axisRates[axis]) || Number.isFinite(a.axisRates[axis])) {
      rateParts.push(`${axis} ${fmtRate(b.axisRates[axis])} vs ${fmtRate(a.axisRates[axis])}`);
    }
  }
  if (rateParts.length > 0) {
    const verdict = worst(rateVerdicts);
    rows.push({
      key: "rates",
      dimension: "Stick demand per axis",
      before: rateParts.map((p) => p.split(" vs ")[0]).join(" · "),
      after: rateParts.map((p) => `${p.split(" ")[0]} ${p.split(" vs ")[1]}`).join(" · "),
      verdict,
      note:
        verdict === "match" || verdict === null
          ? null
          : "An axis was worked much harder on one side: its tracking numbers measure different demand."
    });
  }

  // Maneuver coverage: clean commands per axis, both sides.
  const coverage = [];
  const coverageVerdicts = [];
  for (const axis of AXES) {
    const nb = b.axisEvents[axis];
    const na = a.axisEvents[axis];
    if (nb === null && na === null) continue;
    const bothOk = (nb ?? 0) >= ADEQUATE_AXIS_EVENTS && (na ?? 0) >= ADEQUATE_AXIS_EVENTS;
    const neither = (nb ?? 0) < ADEQUATE_AXIS_EVENTS && (na ?? 0) < ADEQUATE_AXIS_EVENTS;
    const verdict = bothOk ? "match" : neither ? "mismatch" : "partial";
    coverageVerdicts.push(verdict);
    coverage.push({ axis, before: nb ?? 0, after: na ?? 0, verdict });
  }
  if (coverage.length > 0) {
    const verdict = worst(coverageVerdicts);
    const thin = coverage.filter((c) => c.verdict !== "match").map((c) => c.axis);
    rows.push({
      key: "coverage",
      dimension: "Maneuver coverage (clean commands per axis)",
      before: coverage.map((c) => `${c.axis} ${c.before}`).join(" · "),
      after: coverage.map((c) => `${c.axis} ${c.after}`).join(" · "),
      verdict,
      note:
        verdict === "match"
          ? null
          : `${listWords(thin)}: fewer than ${ADEQUATE_AXIS_EVENTS} clean commands on one side — ${thin.length === 1 ? "that axis is" : "those axes are"} not judged.`
    });
  }

  // Headspeed: the dominant bank on each side.
  if (b.headspeedRpm !== null || a.headspeedRpm !== null) {
    const verdict = ratioVerdict(b.headspeedRpm, a.headspeedRpm, { match: 0.97, partial: 0.92 });
    rows.push({
      key: "headspeed",
      dimension: "Headspeed",
      before: fmtRpm(b.headspeedRpm) + (b.headspeedBanks.length > 1 ? ` (${b.headspeedBanks.length} banks)` : ""),
      after: fmtRpm(a.headspeedRpm) + (a.headspeedBanks.length > 1 ? ` (${a.headspeedBanks.length} banks)` : ""),
      verdict,
      note:
        verdict === "match"
          ? null
          : verdict === null
            ? "Headspeed is not logged on one side, so the flights cannot be matched on it."
            : "Different headspeeds change the machine's response on their own — a tuning change cannot be told apart from the bank change."
    });
  }

  // Collective work.
  if (b.collectiveWork !== null || a.collectiveWork !== null) {
    const verdict = ratioVerdict(b.collectiveWork, a.collectiveWork, { match: 0.5, partial: 0.3 });
    const fmt = (v) => (Number.isFinite(v) ? `${Math.round(v)}/s` : "—");
    rows.push({
      key: "collective",
      dimension: "Collective work",
      before: fmt(b.collectiveWork),
      after: fmt(a.collectiveWork),
      verdict,
      note:
        verdict === "match" || verdict === null
          ? null
          : "One flight worked the collective much harder: governor and power figures answer different loads."
    });
  }

  // Flight length.
  if (b.durationSeconds !== null && a.durationSeconds !== null) {
    const verdict = ratioVerdict(b.durationSeconds, a.durationSeconds, { match: 0.6, partial: 0.4 });
    rows.push({
      key: "duration",
      dimension: "Flight length",
      before: `${Math.round(b.durationSeconds)} s`,
      after: `${Math.round(a.durationSeconds)} s`,
      verdict,
      note:
        verdict === "match"
          ? null
          : "The longer flight simply had more chances to show events."
    });
  }

  // Evidence quality: what each score rests on.
  if (b.evidence || a.evidence) {
    const thin = (level) => level === "Low" || level === "Insufficient";
    const verdict =
      !b.evidence || !a.evidence
        ? null
        : thin(b.evidence) && thin(a.evidence)
          ? "mismatch"
          : thin(b.evidence) || thin(a.evidence)
            ? "partial"
            : "match";
    rows.push({
      key: "evidence",
      dimension: "Evidence quality (score confidence)",
      before: b.evidence ?? "—",
      after: a.evidence ?? "—",
      verdict,
      note:
        verdict === "match" || verdict === null
          ? null
          : `${thin(b.evidence) && thin(a.evidence) ? "Both scores are" : thin(b.evidence) ? "The earlier score is" : "The later score is"} thin on clean command responses.`
    });
  }

  // ---- the confidence the verdict can carry ----
  // Demand, headspeed and evidence are the dimensions that change
  // the measurement itself: a mismatch there makes the verdict Low.
  // Coverage, collective and length shape how much was seen: they
  // take it to Medium. Partial anywhere: Medium.
  const hard = new Set(["demand", "rates", "headspeed", "evidence"]);
  let confidence = "High";
  const reducedBy = [];
  for (const row of rows) {
    if (row.verdict === "mismatch") {
      confidence = hard.has(row.key) ? "Low" : confidence === "Low" ? "Low" : "Medium";
      reducedBy.push(SHORT_LABEL[row.key] ?? row.dimension.toLowerCase());
    } else if (row.verdict === "partial" && confidence === "High") {
      confidence = "Medium";
      reducedBy.push(SHORT_LABEL[row.key] ?? row.dimension.toLowerCase());
    } else if (row.verdict === "partial") {
      reducedBy.push(SHORT_LABEL[row.key] ?? row.dimension.toLowerCase());
    }
  }

  return {
    rows,
    confidence,
    reducedBy: [...new Set(reducedBy)],
    // The three-step footing the rest of Compare already speaks.
    level: confidence === "High" ? "comparable" : confidence === "Medium" ? "partial" : "weak"
  };
}
