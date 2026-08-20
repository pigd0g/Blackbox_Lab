// ======================================================
// PACK SNIPPETS — the pack as paste-ready CLI text
// ======================================================
//
// Two snippets per pack: the forward snippet (apply the
// changes) and the revert snippet (the guaranteed undo,
// from the values the craft's dump held). Both carry their
// safety lines as comments — bench only, hover check first.
// A member without a numeric value appears as a commented
// instruction, never as a guessed number.
//
// ======================================================

export function packSnippet(pack, { packLabel = "change pack" } = {}) {
  if (!pack?.members?.length) {
    return null;
  }

  const lines = [
    `# Blackbox Lab — ${packLabel}`,
    "# Apply on the bench, never while armed. Save a dump first.",
    "# First flight after: hover check with abort criteria before any full maneuver."
  ];

  for (const member of pack.members) {
    if (Number.isFinite(member.to)) {
      lines.push(`set ${member.setting} = ${member.to}`);
    } else {
      lines.push(
        `# ${member.setting}: one ${member.magnitudeClass} ${member.direction} (${member.numericNote})`
      );
    }
  }

  lines.push("save");
  return lines.join("\n");
}

export function revertSnippet(pack, { packLabel = "change pack" } = {}) {
  if (!pack?.members?.length) {
    return null;
  }

  const lines = [
    `# Blackbox Lab — revert ${packLabel} (restore previous values)`
  ];

  let restorable = 0;
  for (const member of pack.members) {
    if (Number.isFinite(member.from)) {
      lines.push(`set ${member.setting} = ${member.from}`);
      restorable += 1;
    } else {
      lines.push(
        `# ${member.setting}: previous value not on file — restore from your saved dump`
      );
    }
  }

  lines.push("save");
  return { text: lines.join("\n"), restorable };
}
