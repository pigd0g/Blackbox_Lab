// ======================================================
// BLACKBOX LAB — ONE-FILE REPORT BUILDER
// ======================================================
//
// Builds a single self-contained HTML file: verdict,
// lab findings and chart images embedded as data URLs.
// Works on any forum, chat or email — no server, no
// account, nothing to install. Styled to feel like the
// app: clean paper, navy masthead, dark instrument
// panels for the charts.
//
// ======================================================

function chartImage(entry) {
  if (entry.image) {
    return entry.image;
  }

  const canvas = entry.element?.querySelector("canvas");

  if (!canvas || canvas.width === 0) {
    return null;
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const STATUS = {
  good: { color: "#1e8449", soft: "#e9f7ef", word: "Looks good" },
  watch: { color: "#b9770e", soft: "#fdf3e3", word: "Worth watching" },
  attention: { color: "#c0392b", soft: "#fdedec", word: "Needs attention" },
  // A status the map has never heard of must read as unjudged,
  // never borrow "Looks good" — missing data limits the
  // conclusion, it does not upgrade it.
  insufficient: { color: "#5d6d7e", soft: "#eef1f4", word: "Not evaluated" }
};

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// A shared report is read by people who never saw the app. Inside
// the app, the Log Quality gate says what this log could and could
// not support — the report has to say the same, or its reader
// cannot tell "this area was fine" from "this area was never
// judged". A fully qualified report depends on complete data;
// where data was missing, the report says so instead of staying
// silent.
const QUALITY_LEVELS = {
  full: { word: "FULL DATA", color: "#1f8f5f" },
  partial: { word: "PARTIAL DATA", color: "#b07d10" },
  missing: { word: "NO JUDGMENT", color: "#b3423a" }
};

function buildQualityHtml(quality) {
  if (!quality || !Array.isArray(quality.capabilities)) {
    return "";
  }

  const rows = quality.capabilities
    .map((capability) => {
      const level =
        QUALITY_LEVELS[capability.level] ?? QUALITY_LEVELS.partial;

      const note =
        capability.level === "missing"
          ? `No judgment was possible on this area: ${escapeHtml(
              capability.note
            )}`
          : escapeHtml(capability.note);

      return `
      <div class="basis-row">
        <span class="basis-name">${escapeHtml(capability.name)}</span>
        <span class="basis-level" style="color:${level.color};">${
          level.word
        }</span>
        <div class="basis-note">${note}</div>
      </div>`;
    })
    .join("");

  const warnings = (quality.warnings ?? [])
    .map(
      (warning) =>
        `<div class="basis-note basis-warning">${escapeHtml(warning)}</div>`
    )
    .join("");

  return `
  <h2>Log Quality: What This Report Is Based On</h2>
  <p class="summary">${escapeHtml(quality.summary ?? "")} A fully
  qualified report depends on all telemetry being logged. Areas
  without their data are stated below rather than judged.</p>
  <div class="basis">${rows}${warnings}</div>`;
}

// One "What To Try Next" block per recommendation — the same
// object the in-app cards render, phrased for the second pair of
// eyes a report is made for.
function buildRecommendationsHtml(recommendations) {
  const all = [
    ...(recommendations?.pid ?? []),
    ...(recommendations?.governor ?? [])
  ];

  if (all.length === 0) {
    return "";
  }

  const blocks = all
    .map((rec) => {
      const action = rec.suggestion
        ? `<div class="verdict-action"><b>Try:</b> one ${escapeHtml(rec.suggestion.magnitudeClass)} ${rec.suggestion.direction === "up" ? "up" : "down"} on <code>${escapeHtml(rec.suggestion.family)}</code>. Change only this, fly the same moves again, and watch ${escapeHtml(rec.verifyMetric ?? "the same finding")}.</div>`
        : `<div class="verdict-action"><b>Not calling it yet:</b> ${escapeHtml(rec.gatedReason ?? "more evidence needed.")}</div>`;

      return `
      <div class="verdict" style="border-left-color:#4f7dc4;background:#f2f6fc;">
        <div class="verdict-headline">${escapeHtml(rec.finding)}</div>
        <div class="verdict-detail">${escapeHtml(rec.hypothesis)}</div>
        ${action}
        <div class="verdict-detail" style="margin-top:6px;color:#7c8da1;">Confidence: ${escapeHtml(rec.confidence)} · based on ${rec.evidence.length} event${rec.evidence.length === 1 ? "" : "s"} in this flight</div>
      </div>`;
    })
    .join("");

  return `<h2>What To Try Next</h2>
  <p class="summary">One change at a time, then fly the same moves again: the numbers each card names are the judge.</p>
  ${blocks}`;
}

// The rotor's event story beside the labs: excursion summary and
// the precomp balance reads, when the flight could measure them.
function buildRotorBehaviourHtml(governorEvents, precomp) {
  const lines = [
    governorEvents?.summary?.sentence ?? null,
    precomp?.governor?.story ?? null,
    precomp?.tail?.story ?? null
  ].filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return `<h2>Headspeed Events &amp; Precomp</h2>
  ${lines
    .map(
      (line) =>
        `<p class="summary" style="margin-bottom:10px;">${escapeHtml(line)}</p>`
    )
    .join("")}`;
}

export function buildReportHtml({
  fileName,
  craftName,
  firmware,
  durationSeconds,
  verdict,
  labs,
  chartElements,
  quality = null,
  recommendations = null,
  governorEvents = null,
  precomp = null
}) {
  const date = new Date().toLocaleString();

  const metaItems = [
    craftName ? ["Craft", craftName] : null,
    firmware ? ["Firmware", firmware] : null,
    durationSeconds
      ? ["Flight length", `${durationSeconds.toFixed(1)} s`]
      : null,
    ["Log file", fileName]
  ].filter(Boolean);

  const metaHtml = metaItems
    .map(
      ([label, value]) => `
      <div class="meta-item">
        <div class="meta-label">${escapeHtml(label)}</div>
        <div class="meta-value">${escapeHtml(value)}</div>
      </div>`
    )
    .join("");

  const cardsHtml = (verdict?.cards ?? [])
    .map((card) => {
      const status = STATUS[card.status] ?? STATUS.insufficient;

      return `
      <div class="verdict" style="border-left-color:${status.color};background:${status.soft};">
        <div class="verdict-top">
          <span class="verdict-title">${escapeHtml(card.title)}</span>
          <span class="verdict-status" style="color:${status.color};">${escapeHtml(card.statusLabel ?? status.word)}</span>
        </div>
        <div class="verdict-headline">${escapeHtml(card.headline)}</div>
        <div class="verdict-detail">${escapeHtml(card.detail)}</div>
        ${
          card.action
            ? `<div class="verdict-action"><b>What to do:</b> ${escapeHtml(card.action)}</div>`
            : ""
        }
      </div>`;
    })
    .join("");

  const labsHtml = (labs ?? [])
    .filter((lab) => lab && lab.analysis)
    .map((lab) => {
      const status = STATUS[lab.analysis.status] ?? STATUS.insufficient;

      // A lab that could only run a partial analysis must not wear
      // a scored-quality word: "Looks good" on a governor page that
      // could not measure the governor reads as a judgment it never
      // made. The capability state the app renders governs the
      // report too — one semantics, two surfaces.
      const capability = lab.analysis.capability ?? "full";

      const statusWord =
        capability === "partial"
          ? "Partial: stability only"
          : capability === "unavailable"
            ? "Not evaluated"
            : status.word;

      const statusColor =
        capability === "full" ? status.color : "#7c8da1";

      const tiles = lab.analysis.metrics
        .map(
          (metric) => `
          <div class="tile">
            <div class="tile-label">${escapeHtml(metric.label)}</div>
            <div class="tile-value">${escapeHtml(metric.value)}</div>
          </div>`
        )
        .join("");

      return `
      <div class="lab">
        <div class="lab-head">
          <span class="lab-name">${escapeHtml(lab.title)}</span>
          <span class="lab-status" style="color:${statusColor};">${escapeHtml(statusWord)}</span>
        </div>
        <p class="lab-story" style="border-left-color:${statusColor};">${escapeHtml(lab.analysis.story)}</p>
        <div class="tiles">${tiles}</div>
      </div>`;
    })
    .join("");

  const chartsHtml = (chartElements ?? [])
    .map((entry) => {
      const image = chartImage(entry);

      return image
        ? `
        <div class="chart-panel">
          <div class="chart-title">${escapeHtml(entry.title)}</div>
          <img src="${image}" alt="${escapeHtml(entry.title)}" />
        </div>`
        : "";
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blackbox Lab Report — ${escapeHtml(fileName)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #eef1f6;
    font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
    color: #1c2733;
    line-height: 1.55;
    font-size: 16px;
  }
  .page { max-width: 880px; margin: 0 auto; padding: 26px 18px 60px 18px; }
  .masthead {
    background: linear-gradient(135deg, #0d1524, #16324f);
    color: #ffffff;
    border-radius: 16px;
    padding: 26px 30px;
    box-shadow: 0 10px 30px rgba(13, 21, 36, 0.25);
  }
  .masthead h1 { margin: 0; font-size: 26px; letter-spacing: 0.2px; }
  .masthead .sub { color: #9cc3f5; margin-top: 3px; font-size: 15px; }
  .meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-top: 20px;
  }
  .meta-label { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #8fb3dd; }
  .meta-value { font-weight: 600; font-size: 16px; margin-top: 2px; color: #ffffff; overflow-wrap: anywhere; }

  h2 {
    font-size: 16px; letter-spacing: 1.6px; text-transform: uppercase;
    color: #5a6b80; margin: 34px 4px 12px 4px;
  }
  .summary { font-size: 18px; margin: 0 4px 14px 4px; color: #1c2733; }

  .verdict {
    background: #ffffff; border: 1px solid #e3e8ef; border-left: 6px solid;
    border-radius: 12px; padding: 15px 18px; margin: 10px 0;
    box-shadow: 0 2px 8px rgba(13, 21, 36, 0.05);
  }
  .verdict-top { display: flex; align-items: baseline; }
  .verdict-title { font-weight: 700; }
  .verdict-status { margin-left: auto; font-size: 12.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .verdict-headline { font-size: 17.5px; font-weight: 650; margin-top: 4px; }
  .verdict-detail { color: #46586d; margin-top: 3px; font-size: 15px; }
  .verdict-action {
    margin-top: 9px; font-size: 14.5px; color: #2c3e50;
    background: rgba(255, 255, 255, 0.75); border-radius: 8px; padding: 8px 12px;
  }

  .lab {
    background: #ffffff; border: 1px solid #e3e8ef; border-radius: 12px;
    padding: 16px 18px; margin: 10px 0;
    box-shadow: 0 2px 8px rgba(13, 21, 36, 0.05);
  }
  .lab-head { display: flex; align-items: baseline; }
  .lab-name { font-weight: 700; font-size: 17px; }
  .lab-status { margin-left: auto; font-size: 12.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .lab-story { border-left: 3px solid; padding-left: 12px; margin: 10px 0 12px 0; color: #2c3e50; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .tile { background: #f4f7fb; border: 1px solid #e3e8ef; border-radius: 9px; padding: 9px 12px; }
  .tile-label { font-size: 12px; letter-spacing: 0.8px; text-transform: uppercase; color: #71839a; }
  .tile-value { font-weight: 650; margin-top: 2px; font-size: 15.5px; }

  .basis {
    background: #ffffff; border: 1px solid #e3e8ef; border-radius: 12px;
    padding: 8px 18px 12px 18px; margin: 10px 0;
    box-shadow: 0 2px 8px rgba(13, 21, 36, 0.05);
  }
  .basis-row { padding: 10px 0; border-bottom: 1px solid #eef1f6; }
  .basis-row:last-of-type { border-bottom: none; }
  .basis-name { font-weight: 700; }
  .basis-level { float: right; font-size: 12.5px; font-weight: 700; letter-spacing: 1px; }
  .basis-note { color: #46586d; font-size: 14.5px; margin-top: 3px; clear: both; }
  .basis-warning { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e3e8ef; }

  .chart-panel {
    background: #101a2c; border-radius: 14px; padding: 14px 14px 8px 14px;
    margin: 12px 0; box-shadow: 0 6px 18px rgba(13, 21, 36, 0.18);
  }
  .chart-title { color: #b9c9e6; font-size: 14px; font-weight: 600; letter-spacing: 0.4px; margin: 0 4px 10px 4px; }
  .chart-panel img { width: 100%; display: block; border-radius: 8px; }

  .footer {
    margin-top: 40px; padding-top: 14px; border-top: 1px solid #d7dee8;
    color: #7c8da1; font-size: 13px;
  }
  @media print {
    body { background: #ffffff; }
    .masthead, .chart-panel { box-shadow: none; }
    .verdict, .lab, .chart-panel { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="masthead">
    <h1>Blackbox Lab · Flight Report</h1>
    <div class="sub">Simple first. Deeper when you want it. · Generated ${escapeHtml(date)}</div>
    <div class="meta">${metaHtml}</div>
  </div>

  <h2>Verdict</h2>
  <p class="summary">${escapeHtml(verdict?.summary ?? "")}</p>
  ${cardsHtml}

  ${buildRecommendationsHtml(recommendations)}

  ${buildQualityHtml(quality)}

  ${labsHtml ? `<h2>Lab Details</h2>${labsHtml}` : ""}

  ${buildRotorBehaviourHtml(governorEvents, precomp)}

  ${chartsHtml ? `<h2>The Evidence</h2>${chartsHtml}` : ""}

  <div class="footer">
    Generated by Blackbox Lab: free Rotorflight log analysis, a passion project by Daniel Sink.
    Values marked (est.) are estimated from logged raw data. Blackbox Lab never changes any
    settings; every decision is the pilot's.
  </div>
</div>
</body>
</html>`;
}

export function downloadReport(html, fileName) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
