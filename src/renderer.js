// ======================================================
// BLACKBOX LAB — MAIN RENDERER
// ======================================================
import { aircraftProfiles } from "./profiles/aircraftProfiles.js";
import { updateScreen } from "./ui/screenUpdater.js";
import { initNavigation } from "./ui/navigation.js";
import {
  renderTimeSeriesChart,
  renderSpectrumChart,
  CHART_COLORS
} from "./ui/charts.js";
import { buildReportHtml, downloadReport } from "./ui/reportBuilder.js";
import { readLogFile } from "./analysis/logFileReader.js";
import {
  buildContributionV1,
  describeContribution
} from "./contribute/contributionBuilder.js";
import { uploadContributionV1 } from "./contribute/uploader.js";
import {
  scrubDump,
  looksLikeDump,
  readDumpIdentity
} from "./contribute/dumpScrubber.js";
import { buildFingerprint } from "./contribute/fingerprint.js";
import {
  hasContributed,
  recordContributed
} from "./contribute/uploadLedger.js";
import {
  CONTRIBUTE_ENDPOINT,
  CONTRIBUTE_APP_VERSION
} from "./contribute/config.js";
import { APP_VERSION, checkForUpdate } from "./version.js";
import { buildLogAnalysis } from "./analysis/logAnalysisBuilder.js";
import { findTelemetryHeaderIndex } from "./analysis/telemetryHeader.js";
import { getColumnValues } from "./analysis/mathHelpers.js";
import {
  getMetadataValue,
  isPlausibleFlightDate,
  resolveFlightDateMs
} from "./analysis/metadataReader.js";
import {
  isSettingsDumpFile,
  LARGEST_PLAUSIBLE_DUMP_BYTES
} from "./analysis/fileIdentification.js";
import {
  computeNoiseSpectrum,
  computeNoiseSpectrumOverRuns,
  estimateSampleRate,
  peakMagnitudeAbove
} from "./analysis/dsp/fft.js";
import {
  isUsableGovernorTarget,
  detectStableFlightPhase,
  detectInFlightSamples,
  qualifiedLoadEnvelope
} from "./analysis/flightPhase.js";
import { buildFlightVerdict } from "./analysis/flightVerdict.js";
import {
  compareFlights,
  extractComparableSetup,
  diffSetups,
  chronologicalOrder
} from "./analysis/compareFlights.js";
import { longestFlightIndex } from "./analysis/flightSelection.js";
import {
  assessLogQuality,
  columnCarriesData
} from "./analysis/logQuality.js";
import {
  buildErrorBundle,
  bundleFingerprint,
  formatBundleText,
  installErrorCapture,
  alreadySent,
  markSent,
  sendErrorReport
} from "./errorReport.js";

// What the pilot last asked for — one line of context that turns
// "it crashed" into a reproducible report.
let lastUserAction = null;

function noteAction(action) {
  lastUserAction = action;
}
import { buildFlightEvents, eventChartWindow } from "./analysis/flightEvents.js";
import {
  readPilotInput,
  createStickDisplay,
  getStickMode,
  setStickMode,
  timeToRowIndex
} from "./ui/stickDisplay.js";
import { adviseFilters } from "./analysis/filterAdvisor.js";
import {
  loadHistory,
  recordFlight,
  buildHistoryEntry,
  hashFlightLines,
  migrateHistory,
  assessTrends,
  rotorTrendWording,
  deleteFlight,
  clearHistory,
  getCraftCard,
  saveCraftCard,
  prefillCraftCard,
  craftCardFromDump,
  getCraftDump,
  saveCraftDump
} from "./analysis/craftHistory.js";
import { analyzeGovernorLab } from "./analysis/governorLabAnalysis.js";
import { ACADEMY_ENTRIES } from "./academy.js";
import {
  detectGovernorEvents,
  governorEventWindow
} from "./analysis/governorEvents.js";
import { buildRecommendations } from "./analysis/recommendationEngine.js";
import { buildPack } from "./analysis/packBuilder.js";
import { packSnippet, revertSnippet } from "./analysis/packSnippet.js";
import {
  fileAnalysis,
  latestPack
} from "./analysis/confirmationLedger.js";
import {
  assessAppliedState,
  assessDumpFreshness
} from "./analysis/appliedState.js";
import { gradeAppliedPack } from "./analysis/verificationAutopilot.js";
import {
  analyzeServoLimits,
  servoDisplayName
} from "./analysis/servoLimitAnalysis.js";
import { analyzeSignalLab } from "./analysis/signalLabAnalysis.js";
import {
  analyzeBecLab,
  correlateSignalAndPower
} from "./analysis/becLabAnalysis.js";
import { analyzePrecomp } from "./analysis/precompAnalysis.js";
import { chooseVoltageSource } from "./analysis/batteryLabAnalysis.js";
import {
  sliceWindow,
  windowStats,
  findHighestLoadEvents,
  explainLoadEvent,
  isCollectiveDriven,
  groupByGovernorTarget,
  longestConsecutiveRun,
  allConsecutiveRuns
} from "./analysis/evidenceViews.js";
import { analyzeProfileResponse } from "./analysis/profilePidBreakdown.js";
import { analyzeEscLab } from "./analysis/escLabAnalysis.js";
import { analyzeBatteryLab } from "./analysis/batteryLabAnalysis.js";
//
// SECTION MAP
// 01. DOM REFERENCES
// 02. NAVIGATION + SETTINGS
// 03. FILE PICKER + SAMPLE FLIGHT
// 04. FLIGHT SELECTION
// 05. DATASET (columns, spectra, labs, verdict)
// 06. RENDERING (charts, labs, verdict)
// 07. REPORT BUILDER
//
// ======================================================
//
// 01. DOM REFERENCES
// ======================================================

const el = (id) => document.getElementById(id);

const chooseFileButton = el("chooseFileButton");
const openLogButton = el("openLogButton");
const trySampleButton = el("trySampleButton");
const logFileInput = el("logFileInput");

const fileStatus = el("fileStatus");
const flightPicker = el("flightPicker");
const flightSelect = el("flightSelect");
const decodeInfo = el("decodeInfo");

const summaryFileName = el("summaryFileName");
const summaryFileSize = el("summaryFileSize");
const summaryStatus = el("summaryStatus");
const rawPreview = el("rawPreview");
const telemetryColumns = el("telemetryColumns");

const verdictCard = el("verdictCard");
const verdictSummary = el("verdictSummary");
const verdictCards = el("verdictCards");

const filterAnalysisStatus = el("filterAnalysisStatus");
const filterAnalysisScore = el("filterAnalysisScore");
const filterAnalysisConfidence = el("filterAnalysisConfidence");
const filterAnalysisFindings = el("filterAnalysisFindings");
const filterAnalysisRecommendations = el("filterAnalysisRecommendations");

const pidAnalysisStatus = el("pidAnalysisStatus");
const pidAnalysisScore = el("pidAnalysisScore");
const pidAnalysisConfidence = el("pidAnalysisConfidence");
const pidAnalysisFindings = el("pidAnalysisFindings");
const pidAnalysisRecommendations = el("pidAnalysisRecommendations");

const chartGyro = el("chartGyro");
const chartThrottle = el("chartThrottle");
const chartTracking = el("chartTracking");
const chartTrackingPitch = el("chartTrackingPitch");
const chartTrackingYaw = el("chartTrackingYaw");
const chartFfRoll = el("chartFfRoll");
const chartFfPitch = el("chartFfPitch");
const chartFfYaw = el("chartFfYaw");
const chartTermsRoll = el("chartTermsRoll");
const chartTermsPitch = el("chartTermsPitch");
const chartTermsYaw = el("chartTermsYaw");
const chartHeadspeed = el("chartHeadspeed");
const chartPower = el("chartPower");
const chartSpectrum = el("chartSpectrum");
const chartGovernor = el("chartGovernor");
const governorChartTitle = el("governorChartTitle");
const governorChartHint = el("governorChartHint");
const chartEsc = el("chartEsc");
const chartBattery = el("chartBattery");

const governorStory = el("governorStory");
const governorMetrics = el("governorMetrics");
const escStory = el("escStory");
const escMetrics = el("escMetrics");

// ---- pilot-input (stick) insets ----
// One reading of the rcCommand columns per flight; each inset
// binds its own canvas. A log without rcCommand simply shows no
// pilot-input evidence.
let currentPilotInput = null;
const stickControllers = new Map();

function mountStickInset({ wrapId, canvasId, chartElements, anchorTime, playFrom }) {
  const wrap = el(wrapId);
  const canvas = el(canvasId);

  if (!wrap || !canvas) return;

  stickControllers.get(canvasId)?.controller.stop();
  stickControllers.delete(canvasId);

  if (!currentPilotInput?.available || !currentDataset || !Number.isFinite(anchorTime)) {
    wrap.hidden = true;
    return;
  }

  const controller = createStickDisplay(canvas, {
    dataset: currentDataset,
    pilotInput: currentPilotInput
  });

  if (!controller) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;

  const replayWindow =
    playFrom && Number.isFinite(playFrom.min) && Number.isFinite(playFrom.max)
      ? playFrom
      : { min: Math.max(0, anchorTime - 2.5), max: anchorTime + 2.5 };

  stickControllers.set(canvasId, {
    controller,
    anchorTime,
    replayWindow
  });

  if (playFrom) {
    controller.playWindow(replayWindow.min, replayWindow.max, { restTime: anchorTime });
  } else {
    controller.showTime(anchorTime);
  }

  // Hovering any of the linked charts scrubs the sticks to the
  // hovered moment; leaving parks them back on the anchor.
  for (const chartElement of chartElements ?? []) {
    if (!chartElement || chartElement.__stickHoverWired === canvasId) continue;
    chartElement.__stickHoverWired = canvasId;

    chartElement.addEventListener("mousemove", () => {
      const chart = chartElement.__blackboxLabChart;
      const active = stickControllers.get(canvasId);
      if (!chart || !active || chart.cursor.idx == null) return;
      const t = chart.data?.[0]?.[chart.cursor.idx];
      if (Number.isFinite(t)) {
        active.controller.stop();
        active.controller.showTime(t);
      }
    });

    chartElement.addEventListener("mouseleave", () => {
      const active = stickControllers.get(canvasId);
      const anchor = chartElement.__stickAnchorTime;
      if (active && Number.isFinite(anchor)) {
        active.controller.showTime(anchor);
      }
    });
  }

  for (const chartElement of chartElements ?? []) {
    if (chartElement) chartElement.__stickAnchorTime = anchorTime;
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".stick-replay-btn");
  if (!button) return;

  const entry = stickControllers.get(button.dataset.stickReplay);
  if (!entry) return;

  entry.controller.playWindow(
    entry.replayWindow.min,
    entry.replayWindow.max,
    { restTime: entry.anchorTime }
  );
});


// ======================================================
// REPLAY — fly the log again (Log Viewer transport)
// ======================================================
//
// A video-editor timeline for the flight: play/pause and
// speed, a scrub bar with the Flight Events as colored
// ticks, a playhead running through every chart on the
// viewer page, live readouts, and the stick display
// following the pilot's hands. Scrubbing and chart zoom
// stay exactly as they were — the playhead is a guest in
// the charts, never their owner.
// ======================================================


// ------------------------------------------------------
// Replay graph stack — the pilot builds the working view.
// Curated presets, one shared timeline (linked zoom), the
// layout remembered across sessions. This stack is also
// the layout a future video export will render.
// ------------------------------------------------------

const REPLAY_LAYOUT_KEY = "blackboxLabReplayLayout";
const REPLAY_DEFAULT_LAYOUT = ["tracking-roll", "headspeed", "throttle", "power"];

const REPLAY_GRAPH_PRESETS = [
  {
    key: "tracking-roll",
    label: "Roll: target vs gyro",
    yLabel: "deg/s",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^setpoint\[0\]$/i], color: PRESET_COLORS.setpoint },
      { patterns: [/^gyroADC\[0\]$/i], color: PRESET_COLORS.gyro }
    ])
  },
  {
    key: "tracking-pitch",
    label: "Pitch: target vs gyro",
    yLabel: "deg/s",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^setpoint\[1\]$/i], color: PRESET_COLORS.setpoint },
      { patterns: [/^gyroADC\[1\]$/i], color: PRESET_COLORS.gyro }
    ])
  },
  {
    key: "tracking-yaw",
    label: "Yaw: target vs gyro",
    yLabel: "deg/s",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^setpoint\[2\]$/i], color: PRESET_COLORS.setpoint },
      { patterns: [/^gyroADC\[2\]$/i], color: PRESET_COLORS.gyro }
    ])
  },
  {
    key: "gyro",
    label: "Gyro (filtered, all axes)",
    yLabel: "deg/s",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^gyroADC\[0\]$/i], color: CHART_COLORS[0] },
      { patterns: [/^gyroADC\[1\]$/i], color: CHART_COLORS[1] },
      { patterns: [/^gyroADC\[2\]$/i], color: CHART_COLORS[2] }
    ])
  },
  {
    key: "gyro-raw",
    label: "Gyro (unfiltered)",
    yLabel: "deg/s",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^gyroUnfilt\[0\]$/i, /^gyroRAW\[0\]$/i], color: CHART_COLORS[0] },
      { patterns: [/^gyroUnfilt\[1\]$/i, /^gyroRAW\[1\]$/i], color: CHART_COLORS[1] },
      { patterns: [/^gyroUnfilt\[2\]$/i, /^gyroRAW\[2\]$/i], color: CHART_COLORS[2] }
    ])
  },
  {
    key: "headspeed",
    label: "Headspeed & governor target",
    yLabel: "rpm",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^governorTarget$/i, /^govTarget$/i], color: CHART_COLORS[0] },
      { patterns: [/^headspeed$/i, /^erpm/i], color: CHART_COLORS[1] }
    ])
  },
  {
    key: "collective",
    label: "Collective",
    yLabel: "collective",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^setpoint\[3\]$/i], color: CHART_COLORS[5] }
    ])
  },
  {
    key: "throttle",
    label: "Motor output (%)",
    yLabel: "output (%)",
    series: (dataset) => presetSeries(dataset, [
      { patterns: [/^motor\[0\]$/i], color: CHART_COLORS[3], convert: toThrottlePercent },
      { patterns: [/^motor\[1\]$/i], color: CHART_COLORS[4], convert: toThrottlePercent }
    ])
  },
  {
    key: "power",
    label: "Voltage & current",
    yLabel: "V · A",
    series: (dataset) => presetSeries(dataset, [
      { patterns: dataset.voltagePatterns, color: CHART_COLORS[0], convert: toVolts },
      { patterns: [/^EscI$/i, /^amperageLatest$/i], color: CHART_COLORS[1], convert: toAmps }
    ])
  }
];

function presetSeries(dataset, entries) {
  const series = [];

  for (const entry of entries) {
    const column = dataset.findColumnsIn(entry.patterns)[0];
    if (!column) continue;

    const raw = dataset.columnValues(column);
    series.push({
      label: column,
      values: decimate(entry.convert ? entry.convert(raw) : raw),
      color: entry.color
    });
  }

  return series;
}

function loadReplayLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem(REPLAY_LAYOUT_KEY));
    // An EMPTY stored layout is a deliberate choice — the
    // sticks-only view, the classic video-overlay composition.
    // Only a record that never existed gets the default.
    if (Array.isArray(stored)) {
      return stored.filter((key) =>
        REPLAY_GRAPH_PRESETS.some((preset) => preset.key === key)
      );
    }
  } catch {
    // fall through to the default
  }
  return [...REPLAY_DEFAULT_LAYOUT];
}

function saveReplayLayout(layout) {
  localStorage.setItem(REPLAY_LAYOUT_KEY, JSON.stringify(layout));
}

function renderReplayStack(dataset) {
  const stack = el("replayGraphStack");
  const addSelect = el("replayAddGraph");

  if (!stack) return;

  const layout = loadReplayLayout();
  stack.innerHTML = "";

  const controls = el("replayStackControls");

  if (!dataset) {
    if (controls) controls.hidden = true;
    stack.innerHTML =
      '<p class="chart-empty">Open a log first. Then stack the charts you want to replay here.</p>';
    return;
  }

  if (controls) controls.hidden = false;

  if (layout.length === 0) {
    stack.innerHTML =
      '<p class="chart-empty">Sticks-only view: no graphs stacked. The playhead, sticks and readouts still run above; add a graph anytime.</p>';
  }

  for (const key of layout) {
    const preset = REPLAY_GRAPH_PRESETS.find((entry) => entry.key === key);
    if (!preset) continue;

    const series = preset.series(dataset);

    const row = document.createElement("div");
    row.className = "replay-graph-row";
    row.innerHTML = `
      <div class="replay-graph-head">
        <span>${preset.label}</span>
        <span class="replay-graph-tools">
          <button data-stack-move="-1" data-stack-key="${key}" title="Move up">▲</button>
          <button data-stack-move="1" data-stack-key="${key}" title="Move down">▼</button>
          <button data-stack-remove="${key}" title="Remove">✕</button>
        </span>
      </div>
      <div class="chart-container"></div>
    `;
    stack.appendChild(row);

    const container = row.querySelector(".chart-container");

    if (series.length === 0) {
      container.innerHTML =
        '<p class="chart-empty">This log has no data for this chart.</p>';
      continue;
    }

    renderTimeSeriesChart(container, {
      timeSeconds: decimate(dataset.timeSeconds),
      series,
      yLabel: preset.yLabel,
      height: 170,
      linkGroup: "replayStack"
    });
  }

  // The add-menu offers what is not already in the stack.
  if (addSelect) {
    addSelect.innerHTML = "";
    for (const preset of REPLAY_GRAPH_PRESETS) {
      if (layout.includes(preset.key)) continue;
      const option = document.createElement("option");
      option.value = preset.key;
      option.textContent = preset.label;
      addSelect.appendChild(option);
    }
    addSelect.disabled = addSelect.options.length === 0;
    const addButton = el("replayAddButton");
    if (addButton) addButton.disabled = addSelect.options.length === 0;
  }
}

el("replayAddButton")?.addEventListener("click", () => {
  const addSelect = el("replayAddGraph");
  if (!addSelect || !addSelect.value) return;

  const layout = loadReplayLayout();
  layout.push(addSelect.value);
  saveReplayLayout(layout);
  renderReplayStack(currentDataset);
  replay.playheads = [];
});

// Before any log, the picker would offer graphs with nothing to
// draw them from — the stack says what to do instead.
renderReplayStack(null);

el("replayGraphStack")?.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-stack-remove]");
  const move = event.target.closest("[data-stack-move]");

  if (!remove && !move) return;

  const layout = loadReplayLayout();

  if (remove) {
    saveReplayLayout(layout.filter((key) => key !== remove.dataset.stackRemove));
  } else {
    const key = move.dataset.stackKey;
    const delta = Number(move.dataset.stackMove);
    const index = layout.indexOf(key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= layout.length) return;
    [layout[index], layout[target]] = [layout[target], layout[index]];
    saveReplayLayout(layout);
  }

  renderReplayStack(currentDataset);
  replay.playheads = [];
});


const replay = {
  time: 0,
  duration: 0,
  rate: 1,
  playing: false,
  frameHandle: null,
  lastTick: null,
  sticks: null,
  readout: null,
  playheads: []
};

function replayElements() {
  return {
    card: el("replayCard"),
    play: el("replayPlay"),
    speed: el("replaySpeed"),
    time: el("replayTime"),
    readout: el("replayReadout"),
    scrub: el("replayScrub"),
    ticks: el("replayTicks"),
    sticksCanvas: el("replaySticks")
  };
}

function setupReplay(dataset, pilotInput, flightEvents) {
  const ui = replayElements();

  if (!ui.card) return;

  replayPause();
  replay.time = 0;
  replay.playheads = [];

  if (!dataset || !Array.isArray(dataset.timeSeconds) || dataset.timeSeconds.length < 2) {
    ui.card.hidden = true;
    return;
  }

  ui.card.hidden = false;
  replay.duration = dataset.timeSeconds[dataset.timeSeconds.length - 1];

  renderReplayStack(dataset);

  // The sticks follow when the log recorded the pilot's hands;
  // without rcCommand the transport still runs, sticks hidden.
  replay.sticks =
    pilotInput?.available
      ? createStickDisplay(ui.sticksCanvas, { dataset, pilotInput })
      : null;

  const stickCol = ui.sticksCanvas?.closest(".stick-col");
  if (stickCol) stickCol.hidden = !replay.sticks;

  // Live readouts: headspeed and pack voltage at the playhead.
  const voltageColumn = dataset.findColumnsIn(dataset.voltagePatterns)[0] ?? null;
  replay.readout = {
    headspeed: Array.isArray(dataset.headspeed) ? dataset.headspeed : null,
    volts: voltageColumn ? toVolts(dataset.columnValues(voltageColumn)) : null,
    timeSeconds: dataset.timeSeconds
  };

  // Flight events as timeline ticks — the debrief on the scrub bar.
  if (ui.ticks) {
    ui.ticks.innerHTML = "";
    for (const event of flightEvents?.events ?? []) {
      if (!Number.isFinite(event.t) || replay.duration <= 0) continue;
      const tick = document.createElement("span");
      tick.className = `replay-tick tick-${event.verdict}`;
      tick.style.left = `${(event.t / replay.duration) * 100}%`;
      tick.title = `${event.axis}: ${event.t.toFixed(1)} s`;
      ui.ticks.appendChild(tick);
    }

    // Headspeed excursions ride the same scrub bar: the governor's
    // moments are as scrubbable as the pilot's.
    for (const event of dataset?.governorEvents?.events ?? []) {
      if (!Number.isFinite(event.t) || replay.duration <= 0) continue;
      const tick = document.createElement("span");
      tick.className = `replay-tick ${
        event.cause === "power-limit" ? "tick-overshoot" : "tick-slow"
      }`;
      tick.style.left = `${(event.t / replay.duration) * 100}%`;
      tick.title = `Headspeed ${event.kind}: ${event.t.toFixed(1)} s`;
      ui.ticks.appendChild(tick);
    }
  }

  if (ui.speed) replay.rate = Number(ui.speed.value) || 1;

  replayUpdateUI();
}

function replayCollectPlayheads() {
  replay.playheads = [];

  document
    .querySelectorAll('section[data-screen="replay"] .chart-container')
    .forEach((element) => {
      const chart = element.__blackboxLabChart;
      if (!chart || !chart.over || !chart.over.isConnected) return;

      let line = chart.over.querySelector(".replay-playhead");
      if (!line) {
        line = document.createElement("div");
        line.className = "replay-playhead";
        chart.over.appendChild(line);
      }
      replay.playheads.push({ chart, line });
    });
}

function replayUpdateUI() {
  const ui = replayElements();
  const t = replay.time;

  if (ui.time) {
    ui.time.textContent = `${t.toFixed(1)} / ${replay.duration.toFixed(1)} s`;
  }

  if (ui.scrub && replay.duration > 0) {
    ui.scrub.value = String(Math.round((t / replay.duration) * 1000));
  }

  if (ui.readout && replay.readout) {
    const row = timeToRowIndex(replay.readout.timeSeconds, t);
    const parts = [];
    const rpm = replay.readout.headspeed?.[row];
    const volts = replay.readout.volts?.[row];
    if (Number.isFinite(rpm) && rpm > 0) parts.push(`${Math.round(rpm)} rpm`);
    if (Number.isFinite(volts) && volts > 0) parts.push(`${volts.toFixed(1)} V`);
    ui.readout.textContent = parts.join(" · ");
  }

  replay.sticks?.showTime(t);

  for (const { chart, line } of replay.playheads) {
    if (!chart.over.isConnected) continue;
    const { min, max } = chart.scales.x;
    if (min == null || t < min || t > max) {
      line.style.display = "none";
    } else {
      line.style.display = "";
      line.style.left = `${chart.valToPos(t, "x")}px`;
    }
  }
}

function replayFrame(now) {
  if (!replay.playing) return;

  if (replay.lastTick !== null) {
    replay.time += ((now - replay.lastTick) / 1000) * replay.rate;
  }
  replay.lastTick = now;

  if (replay.time >= replay.duration) {
    replay.time = replay.duration;
    replayUpdateUI();
    replayPause();
    return;
  }

  replayUpdateUI();
  replay.frameHandle = requestAnimationFrame(replayFrame);
}

function replayPlay() {
  const ui = replayElements();
  if (replay.duration <= 0) return;
  if (replay.time >= replay.duration) replay.time = 0;

  replay.playing = true;
  replay.lastTick = null;
  replayCollectPlayheads();
  if (ui.play) ui.play.textContent = "⏸";
  replay.frameHandle = requestAnimationFrame(replayFrame);
}

function replayPause() {
  const ui = replayElements();
  replay.playing = false;
  if (replay.frameHandle !== null) {
    cancelAnimationFrame(replay.frameHandle);
    replay.frameHandle = null;
  }
  if (ui.play) ui.play.textContent = "▶";
}

el("replayPlay")?.addEventListener("click", () => {
  if (replay.playing) {
    replayPause();
  } else {
    replayPlay();
  }
});

el("replaySpeed")?.addEventListener("change", () => {
  replay.rate = Number(el("replaySpeed").value) || 1;
});

el("replayScrub")?.addEventListener("input", () => {
  if (replay.duration <= 0) return;
  replay.time =
    (Number(el("replayScrub").value) / 1000) * replay.duration;
  if (replay.playheads.length === 0) replayCollectPlayheads();
  replayUpdateUI();
});


const droopContextCard = el("droopContextCard");
const droopContextTitle = el("droopContextTitle");
const droopContextHint = el("droopContextHint");
const droopGovBlock = el("droopGovBlock");
const chartDroopRpm = el("chartDroopRpm");
const chartDroopDrive = el("chartDroopDrive");
const chartDroopPower = el("chartDroopPower");
const chartDroopGov = el("chartDroopGov");

const loadEventsCard = el("loadEventsCard");
const escEventsTable = el("escEventsTable");
const escEventsStories = el("escEventsStories");
const chartLoadOutput = el("chartLoadOutput");
const chartLoadCollective = el("chartLoadCollective");
const chartLoadPower = el("chartLoadPower");
const chartLoadWatts = el("chartLoadWatts");
const chartLoadTemp = el("chartLoadTemp");
const escProfileCard = el("escProfileCard");
const escProfileTable = el("escProfileTable");
const batteryStory = el("batteryStory");
const batteryMetrics = el("batteryMetrics");

const qualityCard = el("qualityCard");
const qualitySummary = el("qualitySummary");
const qualityChips = el("qualityChips");
const qualityWarnings = el("qualityWarnings");

const filterAdvisorCard = el("filterAdvisorCard");
const filterAdvisorStory = el("filterAdvisorStory");
const filterAdvisorTable = el("filterAdvisorTable");
const filterAdvisorRecommendations = el("filterAdvisorRecommendations");

const filterProfileCard = el("filterProfileCard");
const filterProfileBlocks = el("filterProfileBlocks");
const pidProfileCard = el("pidProfileCard");
const pidProfileTable = el("pidProfileTable");
const pidProfileNote = el("pidProfileNote");

const compareBaselineInfo = el("compareBaselineInfo");
const compareOpenButton = el("compareOpenButton");
const compareSampleButton = el("compareSampleButton");
const compareFileInput = el("compareFileInput");
const compareFlightPicker = el("compareFlightPicker");
const compareFlightSelect = el("compareFlightSelect");
const compareResultCard = el("compareResultCard");
const compareChartCard = el("compareChartCard");
const compareSummary = el("compareSummary");
const comparePairInfo = el("comparePairInfo");
const compareRows = el("compareRows");
const chartCompareSpectrum = el("chartCompareSpectrum");

const historyCraftSelect = el("historyCraftSelect");
const historyNote = el("historyNote");
const historyFindings = el("historyFindings");
const historyTrendCard = el("historyTrendCard");
const historyTableCard = el("historyTableCard");
const chartTrendVibration = el("chartTrendVibration");
const chartTrendDroop = el("chartTrendDroop");
const historyTable = el("historyTable");
const clearHistoryButton = el("clearHistoryButton");

const buildReportButton = el("buildReportButton");
const reportStatus = el("reportStatus");
const advancedModeToggle = el("advancedModeToggle");

// ======================================================
// 02. NAVIGATION + SETTINGS
// ======================================================

const navigation = initNavigation();

// One source of truth: the same constant the update check uses.
el("sidebarVersion").textContent = `v${APP_VERSION}`;

// Two controls, one state: the always-visible sidebar
// switch and the Settings checkbox both go through here,
// so they can never disagree.
const sidebarAdvancedToggle = el("sidebarAdvancedToggle");


function applyAdvancedMode(enabled) {
  document.body.classList.toggle("advanced-mode", enabled);
  localStorage.setItem("blackboxLabAdvanced", enabled ? "1" : "0");
  advancedModeToggle.checked = enabled;
  sidebarAdvancedToggle.setAttribute("aria-pressed", String(enabled));

  // Advanced blocks are always present; the mode only decides
  // whether they start unfolded. Pilots can still open any
  // fold by hand in beginner mode — that is the point.
  document.querySelectorAll("details.advanced-block").forEach((block) => {
    block.open = enabled;
  });
}

applyAdvancedMode(localStorage.getItem("blackboxLabAdvanced") === "1");

// ---- transmitter stick mode (pilot-input display) ----
const stickModeSelect = el("stickModeSelect");

if (stickModeSelect) {
  stickModeSelect.value = String(getStickMode());
  stickModeSelect.addEventListener("change", () => {
    setStickMode(Number(stickModeSelect.value));
  });
}

advancedModeToggle.addEventListener("change", () => {
  applyAdvancedMode(advancedModeToggle.checked);
});

sidebarAdvancedToggle.addEventListener("click", () => {
  applyAdvancedMode(!document.body.classList.contains("advanced-mode"));
});

// Maximize: any chart living in a grid cell can take the
// full row width for a closer look — the ResizeObserver
// machinery re-renders it at the new size automatically.
document.querySelectorAll(".chart-max-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const cell = button.closest(".chart-cell");
    const maximized = cell.classList.toggle("chart-max");
    button.textContent = maximized ? "⤡" : "⤢";
  });
});

// Peek: the link under a page's verdict reveals THAT page's
// advanced content without leaving beginner mode — every
// verdict is backed by data, and this is where it lives.
document.querySelectorAll(".peek-advanced-link").forEach((link) => {
  link.addEventListener("click", () => {
    const screen = link.closest("[data-screen]");
    const peeking = screen.classList.toggle("peek-advanced");

    // Revealing folded handles is only half the promise: the link
    // says "show the advanced data", so every fold on this page
    // opens with it — including the technical drilldown — and all
    // of them fold shut again on the way back.
    screen
      .querySelectorAll("details.advanced-block, details.drilldown")
      .forEach((fold) => {
        fold.open = peeking;
      });

    link.textContent = peeking
      ? "Hide the advanced data again"
      : "Show the advanced data behind this page";

    const note = link.parentElement.querySelector(".peek-advanced-note");
    if (note) {
      note.hidden = !peeking;
    }
  });
});

// ======================================================
// 03. FILE PICKER + SAMPLE FLIGHT
// ======================================================

function openFilePicker() {
  logFileInput.click();
}

chooseFileButton.addEventListener("click", openFilePicker);

// The sidebar "Open Blackbox Log" sits between navigation tabs and
// is easy to hit by accident once a log is loaded. After the first
// load it locks: one click arms it (🔓 — "click again"), a second
// click within a few seconds opens the picker. Before any log is
// loaded it behaves like a normal button.
const openLogLock = el("openLogLock");
let openLogArmed = false;
let openLogArmTimer = null;

function disarmOpenLog() {
  openLogArmed = false;
  openLogButton.classList.remove("armed");
  openLogButton.title = "";
  if (openLogLock && !openLogLock.hidden) {
    openLogLock.textContent = "🔒";
    openLogButton.title = "Click the lock to open another log";
  }
  if (openLogArmTimer) {
    clearTimeout(openLogArmTimer);
    openLogArmTimer = null;
  }
}

// Only the lock icon itself unlocks — clicks on the button
// body do nothing while locked, so "toggle" habits can't
// accidentally reopen the file dialog.
openLogButton.addEventListener("click", () => {
  if (!loadedLog) {
    openFilePicker();
    return;
  }

  if (openLogArmed) {
    disarmOpenLog();
    openFilePicker();
  }
});

openLogLock.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!loadedLog) return;

  if (openLogArmed) {
    disarmOpenLog();
    return;
  }

  openLogArmed = true;
  openLogLock.textContent = "🔓";
  openLogButton.classList.add("armed");
  openLogButton.title = "Unlocked: click to open another log";
  openLogArmTimer = setTimeout(disarmOpenLog, 4000);
});

let loadedLog = null;

// The helicopter whose flight is open, so settings opened afterwards
// can be filed against it.
let currentCraftName = null;

// ---- load progress overlay ----
// The inline status lives on Home. A log opened from any other
// screen (sidebar button, drag & drop) would load invisibly and
// feel like a hang — so those loads get a small progress dialog,
// which ends by asking: jump to the overview, or stay here?
const loadProgress = el("loadProgress");
const loadProgressTitle = el("loadProgressTitle");
const loadProgressText = el("loadProgressText");
const loadProgressActions = el("loadProgressActions");
const loadSpinner = el("loadSpinner");
const loadGoOverview = el("loadGoOverview");
const loadStayHere = el("loadStayHere");

function currentScreenName() {
  return (
    document.querySelector("[data-screen].screen-active")?.dataset
      .screen ?? "home"
  );
}

function beginLoadProgress() {
  // Every load gets the dialog — a 15-second decode with no
  // feedback reads as a hang wherever it starts. On Home it
  // closes itself when done (the pilot is already at the
  // overview); elsewhere it ends with the stay-or-go choice.
  loadProgressTitle.textContent = "Reading your flight…";
  loadProgressText.textContent = "";
  loadSpinner.hidden = false;
  loadProgressActions.hidden = true;
  loadProgress.hidden = false;
}

function setLoadStatus(text) {
  fileStatus.textContent = text;

  if (!loadProgress.hidden) {
    loadProgressText.textContent = text;
  }
}

function finishLoadProgress(succeeded) {
  if (loadProgress.hidden) {
    return;
  }

  // Already at the overview: a successful load needs no
  // stay-or-go question — show the arrival for a beat, then get
  // out of the way. Failures stay up everywhere until dismissed.
  if (succeeded && currentScreenName() === "home") {
    loadProgressTitle.textContent = "Flight analyzed";
    loadSpinner.hidden = true;
    setTimeout(() => {
      loadProgress.hidden = true;
    }, 650);
    return;
  }

  loadProgressTitle.textContent = succeeded
    ? "Flight analyzed"
    : "Could not read this log";
  loadSpinner.hidden = true;
  loadProgressActions.hidden = false;

  // On Home the stay-or-go question makes no sense — offer only
  // a dismiss for the failure case.
  const onHome = currentScreenName() === "home";
  loadGoOverview.hidden = onHome;
  loadStayHere.textContent = onHome ? "Close" : "Stay on this page";
}

loadGoOverview.addEventListener("click", () => {
  loadProgress.hidden = true;
  navigation.showScreen("home");
  document.querySelector(".workspace").scrollTop = 0;
});

loadStayHere.addEventListener("click", () => {
  loadProgress.hidden = true;
});

const DUMP_SNIFF_BYTES = 64 * 1024;

async function looksLikeSettingsDump(file) {
  if (
    file.size > LARGEST_PLAUSIBLE_DUMP_BYTES ||
    /\.(bbl|bfl|csv)$/i.test(file.name)
  ) {
    return false;
  }

  return isSettingsDumpFile({
    name: file.name,
    size: file.size,
    head: await file.slice(0, DUMP_SNIFF_BYTES).text()
  });
}

/**
 * Send a settings dump to the helicopter it describes.
 *
 * Returns true when the file was handled here, so the caller stops
 * treating it as a flight.
 */
async function routeSettingsDump(file) {
  if (!(await looksLikeSettingsDump(file))) {
    return false;
  }

  // Settings explain a flight; without one loaded there is nothing to
  // attach them to, and no way to know which helicopter they belong to.
  if (!currentCraftName) {
    setLoadStatus(
      `${file.name} looks like a Rotorflight settings dump. Open the flight it belongs to first, then add the dump from the model card on Home. The settings are filed against that helicopter.`
    );
    finishLoadProgress(false);
    return true;
  }

  const text = await file.text();

  openCraftCardPanel(currentCraftName);
  stageCraftDump(text);
  navigation.showScreen("home");

  setLoadStatus(
    `${file.name} read into your ${currentCraftName} model card. The flight stays open.`
  );
  finishLoadProgress(true);
  return true;
}

async function loadFromFile(file) {
  noteAction(`opening ${file.name}`);
  // Any load starts as a normal flight; the Academy loader
  // re-arms its card only after this completes for its file.
  setAcademyEntry(null);
  beginLoadProgress();
  setLoadStatus(`Reading ${file.name}...`);
  await new Promise((resolve) => setTimeout(resolve, 30));

  // A settings dump describes the machine, not a flight. Opening one
  // here is the natural thing to try, so it is taken as "attach this
  // to my helicopter" rather than as a file to display in place of the
  // flight — which would close the flight the settings are meant to
  // explain.
  if (await routeSettingsDump(file)) {
    return;
  }

  const logData = await readLogFile(file);

  if (!logData || logData.flights.length === 0) {
    setLoadStatus(
      "Could not read any flight data from this file."
    );
    finishLoadProgress(false);
    return;
  }

  loadedLog = logData;

  // A log is in — lock the sidebar button against stray clicks.
  if (openLogLock) {
    openLogLock.hidden = false;
  }
  disarmOpenLog();

  flightSelect.innerHTML = "";

  logData.flights.forEach((flight, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = flight.label;
    flightSelect.appendChild(option);
  });

  flightPicker.hidden = logData.flights.length < 2;

  setLoadStatus(
    "Analyzing flight... (big logs take a few seconds)"
  );
  await new Promise((resolve) => setTimeout(resolve, 30));

  // Multi-flight files open on the LONGEST flight — the same
  // default Compare Flights uses. A "Save All Logs" file often
  // starts with a short hover that cannot support half the labs;
  // analyzing it by position number reads as a broken app.
  const initialFlight = longestFlightIndex(logData.flights);
  flightSelect.value = String(initialFlight);
  analyzeFlight(initialFlight);

  // Swap the welcome hero for the working Home layout.
  document.body.classList.add("log-loaded");

  const startHereHeading = el("startHereHeading");
  if (startHereHeading) {
    startHereHeading.textContent = "Load Another Log";
  }

  if (!loadProgress.hidden) {
    loadProgressText.textContent = `${file.name} analyzed: the verdict is ready on the overview.`;
  }
  finishLoadProgress(true);
}

logFileInput.addEventListener("change", async () => {
  if (logFileInput.files[0]) {
    try {
      await loadFromFile(logFileInput.files[0]);
    } catch (error) {
      setLoadStatus(
        "Something went wrong reading this log: " + error.message
      );
      finishLoadProgress(false);
      // A file the decoder cannot read is exactly the failure the
      // project most needs to hear about.
      showErrorReport(error);
    }
  }

  // Allow re-opening the same file after a fix.
  logFileInput.value = "";
});

trySampleButton.addEventListener("click", async () => {
  if (!window.blackboxLab) {
    fileStatus.textContent =
      "Samples are available when running the desktop app.";
    return;
  }

  fileStatus.textContent = "Loading sample flight...";

  const bytes = await window.blackboxLab.readSampleLog(
    "sample-bell-222ut.bbl"
  );

  if (!bytes) {
    fileStatus.textContent = "Could not load the sample flight.";
    return;
  }

  const file = new File(
    [new Uint8Array(bytes)],
    "sample-bell-222ut.bbl"
  );

  await loadFromFile(file);

  fileStatus.textContent =
    "Loaded: sample flight (a helicopter with a mechanical problem. Can you find it?)";
});

flightSelect.addEventListener("change", () => {
  if (loadedLog) {
    analyzeFlight(Number(flightSelect.value));
  }
});

// ======================================================
// 04. DATASET
// ======================================================

const UNFILTERED_GYRO_PATTERNS = [/^gyroUnfilt/i, /^gyroRAW/i];

function hasOwnUnfiltered(headerLine) {
  return findColumns(headerLine, UNFILTERED_GYRO_PATTERNS).length > 0;
}

function findColumns(headerLine, patterns) {
  const names = headerLine
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^"|"$/g, "")
    );

  return names.filter((name) =>
    patterns.some((pattern) =>
      pattern.test(name)
    )
  );
}

function decimate(values, maximumPoints = 60000) {
  if (values.length <= maximumPoints) {
    return values;
  }

  const stride = Math.ceil(values.length / maximumPoints);
  const output = [];

  for (let i = 0; i < values.length; i += stride) {
    output.push(values[i]);
  }

  return output;
}

function averageOf(values) {
  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return values.length ? sum / values.length : null;
}

// Parse every data row exactly once. On big logs (100k+
// frames) splitting the lines per column read costs seconds;
// this table makes each column access instant.
function buildColumnTable(lines, headerIndex) {
 const names = lines[headerIndex]
  .split(",")
  .map((name) =>
    name
      .trim()
      .replace(/^"|"$/g, "")
  );
  const table = new Map(names.map((name) => [name, []]));
  const columns = names.map((name) => table.get(name));

  for (let row = headerIndex + 1; row < lines.length; row += 1) {
    const parts = lines[row].split(",");

    for (let i = 0; i < columns.length; i += 1) {
      const value = Number(parts[i]);

      if (Number.isFinite(value)) {
        columns[i].push(value);
      }
    }
  }

  return table;
}

function buildDataset(lines, pidAnalysis) {
  const headerIndex = findTelemetryHeaderIndex(lines);

  if (headerIndex < 0) {
    return null;
  }

  const headerLine = lines[headerIndex];
  const columnTable = buildColumnTable(lines, headerIndex);
  const columnValues = (name) => columnTable.get(name) ?? [];
  const alignedColumnValues = (columnName) => {
  if (!columnName) {
    return [];
  }

  const headers = headerLine
    .split(",")
    .map((header) =>
      header
        .trim()
        .replace(/^"|"$/g, "")
    );

  const normalizedColumnName =
    String(columnName)
      .trim()
      .replace(/^"|"$/g, "");

  const columnIndex =
    headers.indexOf(normalizedColumnName);

  if (columnIndex < 0) {
    return [];
  }

  const values = [];

  for (
    let rowIndex = headerIndex + 1;
    rowIndex < lines.length;
    rowIndex += 1
  ) {
    const cells = lines[rowIndex].split(",");

    const rawValue =
      cells[columnIndex]
        ?.trim()
        .replace(/^"|"$/g, "") ?? "";

    if (rawValue === "") {
      values.push(null);
      continue;
    }

    const value = Number(rawValue);

    values.push(
      Number.isFinite(value)
        ? value
        : null
    );
  }

  return values;
};
  const firstColumn = (patterns) => {
    const matches = findColumns(headerLine, patterns);

    if (!matches.length) {
      return null;
    }

    const values = columnValues(matches[0]);
    return values.length > 0 ? values : null;
  };

  const timeColumnName = findColumns(headerLine, [/time/i])[0];

  if (!timeColumnName) {
    return null;
  }

  const timeMicroseconds = columnValues(timeColumnName);
  const startTime = timeMicroseconds[0] ?? 0;
  const timeSeconds = timeMicroseconds.map(
    (value) => (value - startTime) / 1_000_000
  );

  const headspeed = firstColumn([/headspeed/i, /^rpm/i]);
  const governorTargetRaw = firstColumn([/governorTarget/i, /govTarget/i, /governor/i]);
  // DIRECT-mode / passthrough targets are not rotor-speed targets —
  // treat them as absent so every consumer (labs, events, precomp,
  // phase detection, verdict) falls back to headspeed-only reads.
  // The Log Viewer still charts the raw column as recorded.
  const governorTarget = isUsableGovernorTarget(
    headspeed,
    governorTargetRaw
  )
    ? governorTargetRaw
    : [];
  const vbat = firstColumn([/^vbat/i]);
const escVoltage = firstColumn([/^EscV$/i]);
const amperage = firstColumn([/^amperage/i, /^Ibat/i, /^current/i]);
const escCurrent = firstColumn([/^EscI$/i]);
const escThrottle = firstColumn([/^EscThr$/i]);
 const motor = firstColumn([/^motor\[0\]/i]);

  // ---- spectra + labelled peaks ----
  // Analyze the governed part of the flight only: during
  // spool-up the rotor frequency sweeps, which smears the
  // vibration peaks across the spectrum.
  const sampleRate = estimateSampleRate(timeMicroseconds);
  // Noise lives in the UNFILTERED gyro. findColumns keeps
  // header order, so ask for unfiltered explicitly first
  // and fall back to the filtered trace only if a log has
  // nothing better.
  const unfilteredColumns = findColumns(headerLine, UNFILTERED_GYRO_PATTERNS);
  const gyroColumnNames = (
    unfilteredColumns.length > 0
      ? unfilteredColumns
      : findColumns(headerLine, [/^gyroADC/i])
  ).slice(0, 3);

  const fftWindowSize = 4096;

const headspeedColumnName =
  findColumns(
    headerLine,
    [/headspeed/i, /^rpm$/i]
  )[0] ?? null;

const governorTargetColumnName =
  findColumns(
    headerLine,
    [
      /governorTarget/i,
      /govTarget/i,
      /governor/i
    ]
  )[0] ?? null;

const alignedTimeMicroseconds =
  alignedColumnValues(timeColumnName);

const alignedHeadspeed =
  alignedColumnValues(headspeedColumnName);

const alignedGovernorTarget =
  alignedColumnValues(
    governorTargetColumnName
  );

const firstAlignedTime =
  alignedTimeMicroseconds.find(
    Number.isFinite
  ) ?? 0;

const alignedTimeSeconds =
  alignedTimeMicroseconds.map((value) =>
    Number.isFinite(value)
      ? (
          value -
          firstAlignedTime
        ) / 1_000_000
      : Number.NaN
  );

const spectrumFlightPhase =
  detectStableFlightPhase({
    timeSeconds: alignedTimeSeconds,
    headspeed: alignedHeadspeed,
    governorTarget:
      alignedGovernorTarget
  });

// The noise picture is averaged across EVERY stable run of the
// flight, not read from one slice. A single window makes the
// spectrum hostage to where the slice happens to land: an
// intermittent shake scores very differently between two flights
// of the same machine purely by window luck.
const minimumSpectrumRun = 1024;

const stableSpectrumRuns = (columnName) => {
  if (!columnName) {
    return [];
  }

  const values = alignedColumnValues(columnName);
  const runs = [];

  for (const segment of spectrumFlightPhase.segments ?? []) {
    if (
      !Number.isInteger(segment.startIndex) ||
      segment.sampleCount < minimumSpectrumRun
    ) {
      continue;
    }

    const run = values.slice(
      segment.startIndex,
      segment.startIndex + segment.sampleCount
    );

    if (run.every(Number.isFinite)) {
      runs.push(run);
    }
  }

  return runs;
};

const hasSpectrumRuns = (
  spectrumFlightPhase.segments ?? []
).some(
  (segment) =>
    Number.isInteger(segment.startIndex) &&
    segment.sampleCount >= minimumSpectrumRun
);

const spectra = [];

// When the chart cannot be drawn, the empty state must name the
// actual gate that failed — telling a pilot with 300k gyro samples
// that there is "not enough gyro data" contradicts the verdict
// sitting right above the chart.
let spectraUnavailableReason = null;

if (gyroColumnNames.length === 0) {
  spectraUnavailableReason = "no-gyro";
} else if (!sampleRate) {
  spectraUnavailableReason = "no-rate";
} else if (!hasSpectrumRuns) {
  spectraUnavailableReason = "no-stable-run";
}

if (sampleRate && hasSpectrumRuns) {
  gyroColumnNames.forEach(
    (name, index) => {
      const spectrum =
        computeNoiseSpectrumOverRuns(
          stableSpectrumRuns(name),
          sampleRate,
          {
            segmentSize: fftWindowSize
          }
        );

      if (spectrum) {
        spectra.push({
          label: name,
          spectrum,
          color:
            CHART_COLORS[
              index %
                CHART_COLORS.length
            ]
        });
      }
    }
  );
}

 

  // Anchor rotor-harmonic classification to the rotor speed the
  // machine actually flew at. The stable-flight samples are the
  // authority; the tail-of-log average is only a fallback for logs
  // with no detectable stable phase, because ground idle and
  // spool-down in the tail drag that average away from flight rpm
  // and shift every harmonic ratio with it.
  const stableMeanHeadspeed = (() => {
    const indexes = spectrumFlightPhase.stableIndexes ?? [];

    if (!alignedHeadspeed || indexes.length < 100) {
      return null;
    }

    let sum = 0;
    let count = 0;

    for (const index of indexes) {
      const value = alignedHeadspeed[index];

      if (Number.isFinite(value) && value > 0) {
        sum += value;
        count += 1;
      }
    }

    return count >= 100 ? sum / count : null;
  })();

  const governedHeadspeed =
    stableMeanHeadspeed ??
    (headspeed
      ? averageOf(headspeed.slice(-Math.floor(headspeed.length / 3)))
      : null);

  if (spectra.length === 0 && spectraUnavailableReason === null) {
    spectraUnavailableReason = "no-stable-run";
  }

  const markers = buildSpectrumMarkers(spectra, governedHeadspeed);

  // ---- filter advisor: unfiltered vs filtered gyro ----
  const filteredColumns = findColumns(headerLine, [/^gyroADC/i]).slice(0, 3);
  let filteredSpectrumStrongest = null;

  if (
  sampleRate &&
  unfilteredColumns.length > 0 &&
  filteredColumns.length > 0
) {
  // Match the axis of the strongest unfiltered spectrum
  // so attenuation is measured apples-to-apples.
  let strongestIndex = 0;
  let strongestValue = 0;

  spectra.forEach((entry, index) => {
    const peak = spectrumPeakValue(entry.spectrum);

    if (peak > strongestValue) {
      strongestValue = peak;
      strongestIndex = index;
    }
  });

  const filteredName =
    filteredColumns[strongestIndex] ??
    filteredColumns[0];

  filteredSpectrumStrongest =
    computeNoiseSpectrumOverRuns(
      stableSpectrumRuns(filteredName),
      sampleRate,
      {
        segmentSize: fftWindowSize
      }
    );
}
  const unfilteredSpectrumStrongest = (() => {
    if (spectra.length === 0) {
      return null;
    }

    let strongest = spectra[0];

    for (const entry of spectra) {
      if (
        spectrumPeakValue(entry.spectrum) >
        spectrumPeakValue(strongest.spectrum)
      ) {
        strongest = entry;
      }
    }

    return strongest.spectrum;
  })();

  const filterAdvice = adviseFilters({
    unfilteredSpectrum: unfilteredSpectrumStrongest,
    filteredSpectrum: hasOwnUnfiltered(headerLine)
      ? filteredSpectrumStrongest
      : null,
    headspeedRpm: governedHeadspeed
  });

  // ---- filter behavior per headspeed bank ----
  // Rotor harmonics move with rpm, so each bank gets its own
  // spectrum and its own advice — computed only from that
  // bank's longest unbroken stable stretch. Evidence only.
  const perBankFilter = (() => {
    const banks = groupByGovernorTarget({
      governorTarget: alignedGovernorTarget,
      sampleIndexes: spectrumFlightPhase.stableIndexes ?? []
    });

    if (banks.length < 2 || !sampleRate) {
      return [];
    }

    let strongestAxisIndex = 0;
    let strongestPeak = 0;

    spectra.forEach((entry, index) => {
      for (const value of entry.spectrum.magnitudes) {
        if (value > strongestPeak) {
          strongestPeak = value;
          strongestAxisIndex = index;
        }
      }
    });

    const unfilteredName =
      gyroColumnNames[strongestAxisIndex] ?? gyroColumnNames[0];
    const filteredName =
      filteredColumns[strongestAxisIndex] ?? filteredColumns[0];

    // A bank's spectrum averages across all of its stable runs,
    // matching the flight-wide spectra: one slice per bank made
    // the per-bank story hostage to where that slice landed.
    const bankRunSamples = (columnName, runs) => {
      if (!columnName) {
        return [];
      }

      const values = alignedColumnValues(columnName);

      return runs
        .filter((run) => run.length >= minimumSpectrumRun)
        .map((run) =>
          values.slice(run.startIndex, run.startIndex + run.length)
        )
        .filter((run) => run.every(Number.isFinite));
    };

    return banks.map((bank) => {
      const runs = allConsecutiveRuns(bank.indexes);
      const longestRun = longestConsecutiveRun(bank.indexes);

      if (!longestRun || longestRun.length < minimumSpectrumRun) {
        return {
          targetRpm: bank.targetRpm,
          stableSampleCount: bank.indexes.length,
          insufficient: true
        };
      }

      const unfilteredSpectrum = computeNoiseSpectrumOverRuns(
        bankRunSamples(unfilteredName, runs),
        sampleRate,
        { segmentSize: fftWindowSize }
      );

      if (!unfilteredSpectrum) {
        return {
          targetRpm: bank.targetRpm,
          stableSampleCount: bank.indexes.length,
          insufficient: true
        };
      }

      const filteredSpectrum = hasOwnUnfiltered(headerLine)
        ? computeNoiseSpectrumOverRuns(
            bankRunSamples(filteredName, runs),
            sampleRate,
            { segmentSize: fftWindowSize }
          )
        : null;

      // The bank's rpm is read over its whole stable set, not a
      // single window, to match the spectra.
      const bankRpm = (() => {
        let sum = 0;
        let count = 0;

        for (const index of bank.indexes) {
          const value = Number(alignedHeadspeed[index]);

          if (Number.isFinite(value) && value > 0) {
            sum += value;
            count += 1;
          }
        }

        return count > 0 ? sum / count : bank.targetRpm;
      })();

      return {
        targetRpm: bank.targetRpm,
        actualRpm: Math.round(bankRpm),
        stableSampleCount: bank.indexes.length,
        insufficient: false,
        spectra: [
          {
            label: `${unfilteredName} (raw)`,
            spectrum: unfilteredSpectrum,
            color: CHART_COLORS[1]
          },
          ...(filteredSpectrum
            ? [
                {
                  label: `${filteredName} (filtered)`,
                  spectrum: filteredSpectrum,
                  color: CHART_COLORS[0]
                }
              ]
            : [])
        ],
        advice: adviseFilters({
          unfilteredSpectrum,
          filteredSpectrum,
          headspeedRpm: bankRpm
        })
      };
    });
  })();

  // One voltage-source decision for every chart and readout: the
  // same cross-check the Labs use (FC's calibrated reading wins on
  // real disagreement), so a chart never contradicts the story
  // beside it.
  const voltagePatterns =
    chooseVoltageSource(escVoltage, vbat).selected === escVoltage
      ? [/^EscV$/i, /^vbatLatest$/i]
      : [/^vbat/i, /^vbatLatest$/i];

  // ---- labs + verdict ----
  const motorOutputForGovernor =
    Array.isArray(escThrottle) &&
    escThrottle.some((value) => Number(value) > 0)
      ? escThrottle
      : motor;

  const collective = firstColumn([/^setpoint\[3\]$/i]);

  const labs = {
    governor: analyzeGovernorLab({
      timeSeconds,
      headspeed,
      governorTarget,
      // Output context for the worst-droop event: a dip with the
      // throttle at its ceiling is a power limit, not a gain issue.
      motorOutput: motorOutputForGovernor
    }),
   esc: analyzeEscLab({
  timeSeconds,
  motor,
  escThrottle,
  amperage,
  escCurrent,
  vbat,
  escVoltage,
  headspeed,
  governorTarget
}),
    battery: analyzeBatteryLab({
  timeSeconds,
  vbat,
  escVoltage,
  amperage,
  escCurrent,
  headspeed,
  governorTarget
})
  };

  // Radio-link and receiver-power health, computed before the
  // verdict so Home can carry their cards. The BEC lab reads the
  // Signal lab's conclusion: a "brownout" on the voltage trace
  // while the receiver demonstrably kept flying is a
  // measurement-path story, not a power-loss story.
  const servoColumnsForLabs = findColumns(headerLine, [
    /^servo\[\d\]$/i
  ]).map((name) => ({ name, values: columnValues(name) }));

  const signalLab = analyzeSignalLab({
    timeSeconds,
    rssi: firstColumn([/^rssi$/i]),
    failsafePhase: firstColumn([/^failsafePhase$/i]),
    rxSignalReceived: firstColumn([/^rxSignalReceived$/i]),
    rxFlightChannelsValid: firstColumn([/^rxFlightChannelsValid$/i]),
    headspeed
  });

  const becLab = analyzeBecLab({
    timeSeconds,
    vbec: firstColumn([/^Vbec$/i]),
    servos: servoColumnsForLabs,
    headspeed,
    receiverStayedAlive: signalLab
      ? signalLab.counts.failsafe === 0 &&
        signalLab.counts.linkLoss === 0
      : null
  });

  const verdict = buildFlightVerdict({
  spectra,
  headspeed,
  governorTarget,
  vbat,
  pidAnalysis,
  labs,
  anchorHeadspeedRpm: governedHeadspeed,
  filterAdvice,
  signalLab,
  becLab
});

  // Evidence that zooms to the moment: attach a focus
  // window (chart + x-range) to the cards that have one.
  for (const card of verdict.cards) {
    if (card.key === "vibration" && markers.length > 0) {
      card.focus = {
        chartId: "chartSpectrum",
        min: Math.max(0, markers[0].hz - 30),
        max: markers[0].hz + 30
      };
    }

    if (card.key === "rotor" && labs.governor) {
      card.focus = {
        chartId: "chartGovernor",
        min: Math.max(0, labs.governor.droopTimeSeconds - 3),
        max: labs.governor.droopTimeSeconds + 3
      };
    }
  }

  return {
    // Which helicopter this flight came from. A before/after
    // comparison is only a before/after when both are the same
    // machine; otherwise the difference is the aircraft.
    craftName: getMetadataValue(lines, "Craft name"),
    pidScore: Number.isFinite(pidAnalysis?.score) ? pidAnalysis.score : null,
    // Carried so a comparison can say how much each side's score rests
    // on. Two tracking numbers are only worth subtracting when both
    // were measured from enough clean responses to mean anything.
    pidConfidence: pidAnalysis?.confidence ?? null,
    // Clean command-response counts per axis — a comparison is only a
    // comparison where both flights interrogated the same axes (#32).
    axisEvidence: Object.fromEntries(
      (pidAnalysis?.detectedColumns?.trackingAnalysis?.commandEvents ?? []).map(
        (axisResult) => [
          axisResult.axis,
          (axisResult.events ?? []).filter((event) =>
            Number.isFinite(event.responsePeak)
          ).length
        ]
      )
    ),
    batterySagPercent: labs.battery ? labs.battery.sagPercent : null,
    filterAdvice,
    sampleRateHz: sampleRate,
    // "Present" means CARRIES DATA: a headspeed column logged as
    // constant zero (RPM wire unplugged) must not promise governor
    // analysis, title a chart "vs Target", or mark a craft
    // electric. 16 % of contributed flights carry at least one
    // such dead column.
    columnPresence: {
      hasUnfilteredGyro: unfilteredColumns.length > 0,
      hasFilteredGyro: filteredColumns.length > 0,
      hasHeadspeed: columnCarriesData(headspeed),
      hasGovernorTarget: columnCarriesData(governorTarget),
      hasVbat: columnCarriesData(vbat),
      hasAmperage: columnCarriesData(amperage),
      // The labs already decided what their telemetry supports —
      // the chips repeat that decision, never re-derive it.
      hasRssi: signalLab?.capability === "full",
      hasLinkFlags: Boolean(signalLab),
      hasVbec: Boolean(becLab)
    },
    headerLine,
    timeSeconds,
    columnValues,
    findColumnsIn: (patterns) => findColumns(headerLine, patterns),
    headspeed,
    governorTarget,
    collective,
    vbat,
    voltagePatterns,
    amperage,
    spectra,
    spectraUnavailableReason,
    markers,
    perBankFilter,
    labs,
    // The Governor Lab's event layer: sustained over/under-target
    // excursions with their context, measured by the analysis
    // module on the same arrays the lab charts read.
    governorEvents: detectGovernorEvents({
      timeSeconds,
      headspeed,
      governorTarget,
      motorOutput: motorOutputForGovernor,
      collective
    }),
    // How the anticipation worked: collective transients against
    // headspeed error (governor precomp) and yaw error (tail
    // torque precomp).
    precomp: analyzePrecomp({
      timeSeconds,
      headspeed,
      governorTarget,
      collective,
      yawSetpoint: firstColumn([/^setpoint\[2\]$/i]),
      yawGyro: firstColumn([/^gyroADC\[2\]$/i])
    }),
    signalLab,
    becLab,
    // Servo commands frozen at their own travel edge — the
    // second layer that confirms whether a saturation condition
    // reached the actual servo command.
    servoLimits: analyzeServoLimits({
      timeSeconds,
      headspeed,
      servos: findColumns(headerLine, [/^servo\[\d\]$/i]).map(
        (name) => ({ name, values: columnValues(name) })
      )
    }),
    // The stick-command event layer lives ON the dataset so every
    // consumer — the PID page, Compare Flights, contributions —
    // reads the same list.
    flightEvents: buildFlightEvents({
      trackingAnalysis:
        pidAnalysis?.detectedColumns?.trackingAnalysis,
      timeSeconds,
      dataRowOffset: headerIndex + 1
    }),
    verdict
  };
}

// "Strongest" always means strongest ABOVE the vibration floor:
// a plain max is dominated by near-DC maneuver energy and elects
// the most-flown axis, while the verdict names its peak from the
// most-shaking one — and the two must never disagree.
function spectrumPeakValue(spectrum) {
  return peakMagnitudeAbove(spectrum);
}

function buildSpectrumMarkers(spectra, headspeedRpm) {
  if (!spectra.length) {
    return [];
  }

  // Strongest axis carries the story.
  let strongest = spectra[0];

  for (const entry of spectra) {
    if (spectrumPeakValue(entry.spectrum) > spectrumPeakValue(strongest.spectrum)) {
      strongest = entry;
    }
  }

  const { frequencies, magnitudes } = strongest.spectrum;
  const peaks = [];

  for (let i = 2; i < frequencies.length - 2; i += 1) {
    if (
      frequencies[i] > 10 &&
      magnitudes[i] > magnitudes[i - 1] &&
      magnitudes[i] > magnitudes[i + 1]
    ) {
      peaks.push({ hz: frequencies[i], magnitude: magnitudes[i] });
    }
  }

  peaks.sort((a, b) => b.magnitude - a.magnitude);

  const chosen = [];

  for (const peak of peaks) {
    if (chosen.every((other) => Math.abs(other.hz - peak.hz) > 8)) {
      chosen.push(peak);
    }

    if (chosen.length === 3) {
      break;
    }
  }

  return chosen.map((peak) => {
    let name = `${peak.hz.toFixed(0)} Hz`;
    let classification = "unclassified";

    if (headspeedRpm && headspeedRpm > 300) {
      const ratio = peak.hz / (headspeedRpm / 60);

      if (Math.abs(ratio - 1) < 0.15) {
        name = `main rotor 1/rev · ${name}`;
        classification = "main_rotor_1rev";
      } else if (Math.abs(ratio - 2) < 0.2) {
        name = `main rotor 2/rev · ${name}`;
        classification = "main_rotor_2rev";
      } else if (ratio > 3.5 && ratio < 6.5) {
        name = `tail region · ${name}`;
        classification = "tail_region";
      }
    }

    return {
      hz: peak.hz,
      label: name,
      magnitude: peak.magnitude,
      classification
    };
  });
}

// ======================================================
// 05. RENDERING
// ======================================================

const STATUS_WORDS = {
  good: "Looks good",
  watch: "Worth watching",
  attention: "Needs attention"
};

// The Flight Events card: every stick command as one row,
// worst first, each with a jump to the exact moment on the
// matching tracking chart.
const EVENT_CHART_BY_AXIS = {
  roll: "chartTracking",
  pitch: "chartTrackingPitch",
  yaw: "chartTrackingYaw"
};

let currentFlightEvents = null;
let currentRecommendations = null;

function renderFlightEvents(flightEvents) {
  const card = el("pidEventsCard");
  const summary = el("pidEventsSummary");
  const list = el("pidEventsList");

  if (!card) return;

  currentFlightEvents = flightEvents;

  if (!flightEvents) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  summary.textContent = flightEvents.summary.sentence;
  list.innerHTML = "";
  list.className = "events-timeline";
  hideEventDetail();

  // Every event as a small card on the time axis — click one
  // and its evidence unfolds RIGHT HERE: what happened, and
  // the matching chart zoomed to the moment. No teleporting.
  const shown = flightEvents.events.slice(0, 60);

  if (shown.length < flightEvents.events.length) {
    summary.textContent += ` Showing the first ${shown.length} of ${flightEvents.events.length}.`;
  }

  for (const event of shown) {
    const chip = document.createElement("button");
    chip.className = `event-card chip-${event.verdict}`;

    const metric =
      event.verdict === "overshoot"
        ? `+${event.overshoot_ds ?? event.overshoot_percent}°/s`
        : event.verdict === "oscillation"
          ? `±${event.oscillation_ds}°/s`
          : event.verdict === "slow"
            ? `${event.settling_ms} ms`
            : event.verdict === "lagging"
              ? "late"
              : "clean";

    chip.innerHTML = `
      <span class="event-card-time">${event.t?.toFixed(1) ?? "?"} s</span>
      <span class="event-card-axis">${event.axis}</span>
      <span class="event-card-metric">${metric}</span>
    `;

    chip.addEventListener("click", () => {
      const wasSelected = chip.classList.contains("selected");
      list
        .querySelectorAll(".event-card.selected")
        .forEach((node) => node.classList.remove("selected"));

      if (wasSelected) {
        hideEventDetail();
        return;
      }

      chip.classList.add("selected");
      // Re-resolve by ID from the current event list, so a chip
      // that somehow outlives a re-render can never open another
      // event's evidence under its own label.
      const canonical =
        currentFlightEvents?.events.find(
          (candidate) => candidate.id === event.id
        ) ?? null;

      if (canonical) {
        showEventDetail(canonical);
      } else {
        hideEventDetail();
      }
    });

    list.appendChild(chip);
  }
}

// ---- Governor Lab headspeed events ----
//
// Same interaction contract as the PID Flight Events strip:
// event cards on a time axis, click one and its evidence
// unfolds in place — never a jump to another screen.

function hideGovernorEventDetail() {
  const detail = el("governorEventDetail");
  if (detail) detail.hidden = true;
  stickControllers.get("governorEventSticks")?.controller.stop();
}

function showGovernorEventDetail(event) {
  const detail = el("governorEventDetail");
  const explain = el("governorEventExplain");
  const rpmChart = el("governorEventChartRpm");
  const driveChart = el("governorEventChartDrive");

  if (!detail || !currentDataset) return;

  detail.hidden = false;
  explain.textContent = `At ${event.t.toFixed(1)} s: ${event.story}`;

  const eventWindow = governorEventWindow(event);
  const window = sliceWindow(
    currentDataset.timeSeconds,
    (eventWindow.min + eventWindow.max) / 2,
    (eventWindow.max - eventWindow.min) / 2,
    (eventWindow.max - eventWindow.min) / 2
  );

  if (!window) {
    rpmChart.innerHTML = "";
    driveChart.innerHTML = "";
    return;
  }

  const markers = [{ x: event.t, label: "excursion" }];

  if (
    Number.isFinite(event.tPeak) &&
    event.tPeak - event.t > 0.15
  ) {
    markers.push({ x: event.tPeak, label: "peak" });
  }

  const targetValues = currentDataset.governorTarget ?? [];
  const actualValues = currentDataset.headspeed ?? [];

  renderSyncedChart(
    rpmChart,
    currentDataset,
    window,
    [
      { label: "govTarget", values: targetValues, color: CHART_COLORS[0] },
      { label: "headspeed", values: actualValues, color: CHART_COLORS[1] }
    ],
    { yLabel: "rpm", markers, linkGroup: "governorEventSync" }
  );

  // One output series, picked the way the ANALYSIS picked it — by
  // carrying data, not by existing. An all-zero EscThr column must
  // not put a flat line under a power-limit classification that
  // motor[0] produced.
  const escThrottleColumn =
    currentDataset.findColumnsIn([/^EscThr$/i])[0] ?? null;
  const escThrottleCarriesData =
    escThrottleColumn &&
    currentDataset
      .columnValues(escThrottleColumn)
      .some((value) => Number(value) > 0);
  const outputPatterns = escThrottleCarriesData
    ? [/^EscThr$/i]
    : [/^motor\[0\]$/i];

  renderSyncedChart(
    driveChart,
    currentDataset,
    window,
    [
      {
        patterns: outputPatterns,
        label: "Motor output (%)",
        convert: toThrottlePercent,
        color: CHART_COLORS[3]
      },
      {
        patterns: [/^setpoint\[3\]$/i],
        label: "Collective target",
        color: CHART_COLORS[5]
      }
    ],
    { yLabel: "% · collective", markers, linkGroup: "governorEventSync" }
  );

  mountStickInset({
    wrapId: "governorEventSticksWrap",
    canvasId: "governorEventSticks",
    chartElements: [rpmChart, driveChart],
    anchorTime: event.tPeak ?? event.t,
    playFrom: { min: eventWindow.min, max: eventWindow.max }
  });

  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderGovernorEvents(dataset) {
  const card = el("governorEventsCard");
  const summary = el("governorEventsSummary");
  const list = el("governorEventsList");

  if (!card) return;

  const governorEvents = dataset?.governorEvents;

  hideGovernorEventDetail();

  // No usable target = no excursion measurements; the card stays
  // away entirely — the lab verdict already explains capability.
  if (!governorEvents) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  summary.textContent = governorEvents.summary.sentence;
  list.innerHTML = "";
  list.className = "events-timeline";

  for (const event of governorEvents.events) {
    const chip = document.createElement("button");

    // Power-limit events carry the attention colour — the dip the
    // governor could not have fixed. Everything else is a watch.
    chip.className = `event-card ${
      event.cause === "power-limit" ? "chip-overshoot" : "chip-slow"
    }`;

    const label = event.kind === "under" ? "Under" : "Over";
    const metric = `${event.kind === "under" ? "−" : "+"}${event.peakErrorPercent}%`;

    chip.innerHTML = `
      <span class="event-card-time">${event.t.toFixed(1)} s</span>
      <span class="event-card-axis">${label}</span>
      <span class="event-card-metric">${metric}${event.hunting ? " ~" : ""}</span>
    `;

    chip.title =
      event.cause === "power-limit"
        ? "Power-system limit"
        : event.cause === "load"
          ? "Load droop after a collective increase"
          : event.cause === "collective-drop"
            ? "Overspeed after a collective drop"
            : "Unexplained excursion";

    chip.addEventListener("click", () => {
      const wasSelected = chip.classList.contains("selected");
      list
        .querySelectorAll(".event-card.selected")
        .forEach((node) => node.classList.remove("selected"));

      if (wasSelected) {
        hideGovernorEventDetail();
        return;
      }

      chip.classList.add("selected");

      const canonical =
        currentDataset?.governorEvents?.events.find(
          (candidate) => candidate.id === event.id
        ) ?? null;

      if (canonical) {
        showGovernorEventDetail(canonical);
      } else {
        hideGovernorEventDetail();
      }
    });

    list.appendChild(chip);
  }
}

// ---- "Try first": the one pointer under every verdict ----
//
// The journey Home starts — load, see the cards, open the
// reddest one — ends HERE: each lab answers "what do I try
// first?" beside its verdict. The answer is the top earned
// recommendation when the evidence carries one, the gate reason
// when it does not (that reason IS the next step), a concrete
// check for power/link findings, and an honest "nothing to
// change" on clean labs. It always answers.
function setFirstStep(stepId, text, tone = "action") {
  const panel = el(stepId);
  const textElement = el(`${stepId}Text`);

  if (!panel || !textElement) return;

  if (!text) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  panel.dataset.tone = tone;
  textElement.textContent = text;
}

function recommendationFirstStep(rec) {
  if (!rec) return null;

  if (rec.suggestion) {
    return {
      text: `Try one ${rec.suggestion.magnitudeClass} step ${rec.suggestion.direction === "up" ? "up" : "down"} on ${rec.suggestion.family}. Change only this, fly the same moves again, and watch ${rec.verifyMetric ?? "the same finding"}. Compare Flights is the judge.`,
      tone: "action"
    };
  }

  if (rec.gatedReason) {
    return { text: rec.gatedReason, tone: "action" };
  }

  return null;
}

// One tone system: the panel's color IS the verdict's color —
// attention, watch or clear, taken from the same verdict card the
// pilot just read. "info" (accent) exists only for
// enable-this-telemetry pointers, where there is no verdict.
function statusTone(status) {
  return status === "attention"
    ? "attention"
    : status === "watch"
      ? "watch"
      : "clear";
}

// The change pack: the earned changes this flight supports, bundled
// so each is verified by its own instrument next flight. Hidden when
// the flight earned nothing and asks for no evidence — What To Do
// First already tells that story.
function renderPackCard(dataset, nextSteps, firmwareRevision, context = {}) {
  const card = el("packCard");
  if (!card) return;

  const rawCraftName = dataset?.craftName;
  const craftName =
    !rawCraftName || rawCraftName === "Not found"
      ? "Unknown craft"
      : rawCraftName;
  const dump = getCraftDump(localStorage, craftName);

  const getHeaderValue = (header) =>
    getMetadataValue(currentFlightLines, header);

  // A dump read once can silently go stale behind configurator
  // sessions. The flown headers of THIS log are the arbiter: any
  // disagreement flags the dump, and mapped settings use the flown
  // value regardless — a stale dump can never mis-number a pack for
  // settings the log itself carries.
  const dumpFreshness = dump?.parsed
    ? assessDumpFreshness({ dumpParsed: dump.parsed, getHeaderValue })
    : null;

  const pack = buildPack({
    recommendations: nextSteps,
    craftDumpParsed: dump?.parsed ?? null,
    firmwareRevision: firmwareRevision ?? "",
    getHeaderValue,
    dumpFreshness,
    // The governor lab's sustained banks: two or more means this
    // flight mixed regimes and tuning members are withheld.
    headspeedBanks: dataset?.labs?.governor?.perBank ?? null
  });

  const dumpNote = el("packDumpNote");
  const dumpUpdateRow = el("packDumpUpdateRow");
  const dumpIsStale = Boolean(dumpFreshness && !dumpFreshness.fresh);
  if (dumpNote && dumpUpdateRow) {
    dumpNote.hidden = !dumpIsStale;
    dumpUpdateRow.hidden = !dumpIsStale;
    if (dumpIsStale) {
      const savedDate = dump?.savedAtMs
        ? new Date(dump.savedAtMs).toLocaleDateString()
        : null;
      dumpNote.textContent =
        `The saved settings dump${savedDate ? ` (read ${savedDate})` : ""} disagrees with this flight on ` +
        `${dumpFreshness.mismatches.length} setting${
          dumpFreshness.mismatches.length === 1 ? "" : "s"
        } (${dumpFreshness.mismatches
          .slice(0, 3)
          .map((m) => m.setting)
          .join(", ")}${dumpFreshness.mismatches.length > 3 ? ", \u2026" : ""}) — the configuration changed since it was read. ` +
        "This flight's own values are used where the log carries them; refresh the dump for the rest.";
      const updateButton = el("packDumpUpdateButton");
      if (updateButton) {
        updateButton.onclick = () =>
          openCraftCardPanel(context.craftKey ?? "Unknown craft");
      }
    }
  }

  // The craft's memory: check the previous pack against this log's
  // own headers, and file this flight's findings. Bundled samples are
  // shipped data, not the pilot's craft — they never touch the ledger.
  let appliedAssessment = null;
  let openItems = [];
  if (!context.isSample && context.craftKey && context.sourceHash) {
    const previous = latestPack(localStorage, context.craftKey, {
      excludeSourceHash: context.sourceHash
    });
    if (previous) {
      appliedAssessment = assessAppliedState({
        packMembers: previous.members,
        getHeaderValue: (header) =>
          getMetadataValue(currentFlightLines, header)
      });
      appliedAssessment.grading = gradeAppliedPack({
        pack: previous,
        appliedState: appliedAssessment
      });
    }
    openItems = fileAnalysis(localStorage, context.craftKey, {
      sourceHash: context.sourceHash,
      dateMs: context.dateMs ?? 0,
      confirms: [...(nextSteps?.pid ?? []), ...(nextSteps?.governor ?? [])]
        .filter((rec) => rec.level === "confirm"),
      axisEvidence: context.axisEvidence ?? {},
      pack
    });
  }

  const banner = el("packAppliedBanner");
  const bannerText =
    appliedAssessment?.verdict === "applied"
      ? "Previous change pack confirmed on this log \u2713 \u2014 per-change verification verdicts arrive with the field calibration."
      : appliedAssessment?.verdict === "partial"
        ? `Previous change pack partially applied (${appliedAssessment.applied} of ${appliedAssessment.applied + appliedAssessment.missed} confirmed on this log) \u2014 unapplied changes are not graded.`
        : appliedAssessment?.verdict === "not-applied"
          ? "Previous change pack not found on this log \u2014 nothing is graded against it."
          : null;
  if (banner) {
    banner.hidden = !bannerText;
    if (bannerText) banner.textContent = bannerText;
  }

  const show =
    pack.members.length > 0 ||
    pack.prescriptions.length > 0 ||
    Boolean(pack.withheld && pack.queued.length > 0) ||
    Boolean(bannerText) ||
    dumpIsStale;
  card.hidden = !show;
  if (!show) return;

  el("packIntro").textContent =
    pack.withheld && pack.queued.length > 0
      ? `This flight held ${pack.withheld.banks.length} different headspeed banks (${pack.withheld.banks
          .map((rpm) => `${rpm} rpm`)
          .join(", ")}), so its evidence mixes two flight regimes. ` +
        `${pack.queued.length} earned change${pack.queued.length === 1 ? " waits" : "s wait"} for a single-bank flight — fly one bank and the pack unlocks.`
      : pack.members.length > 0
        ? `${pack.members.length} change${pack.members.length === 1 ? "" : "s"} earned by this flight — each verified by its own instrument on the next log. Change nothing else alongside.`
        : "No change is earned yet, but the evidence flights below would settle the open questions.";

  const members = el("packMembers");
  members.innerHTML = "";
  for (const member of pack.members) {
    const row = document.createElement("div");
    row.className = "pack-member";
    const change = Number.isFinite(member.to)
      ? `${member.from} \u2192 ${member.to}`
      : `one ${member.magnitudeClass} ${member.direction}`;
    const noteText = member.freshnessNote ?? member.numericNote;
    const note = noteText
      ? `<div class="chart-hint">${noteText}</div>`
      : "";
    row.innerHTML = `
      <div class="pack-member-head"><code>${member.setting}</code> <b>${change}</b></div>
      <div class="chart-hint">${member.card?.meaning ?? ""}</div>
      <div class="chart-hint">Why: ${member.finding ?? ""}</div>
      <div class="chart-hint">Verified by: ${member.instrument ?? "its lab"}${
        member.expectedResult ? ` \u00b7 expect: ${member.expectedResult}` : ""
      }</div>
      ${note}`;
    members.appendChild(row);
  }

  el("packHeadspeedNote").hidden = !pack.requiresHeadspeedHold;

  const forward = packSnippet(pack);
  const fold = el("packSnippetFold");
  fold.hidden = !forward;
  if (forward) el("packSnippetText").textContent = forward;

  const revert = revertSnippet(pack);
  const revertFold = el("packRevertFold");
  revertFold.hidden = !revert;
  if (revert) el("packRevertText").textContent = revert.text;

  const queuedFold = el("packQueuedFold");
  queuedFold.hidden = pack.queued.length === 0;
  if (pack.queued.length > 0) {
    el("packQueuedList").innerHTML = pack.queued
      .map(
        (entry) =>
          `<p class="chart-hint"><code>${entry.rec.suggestion?.family ?? ""}</code> \u2014 ${entry.reason}</p>`
      )
      .join("");
  }

  const prescriptions = el("packPrescriptions");
  prescriptions.hidden = pack.prescriptions.length === 0;
  if (pack.prescriptions.length > 0) {
    const seenCounts = new Map();
    for (const item of openItems) {
      if (item.nextManeuver && item.flights?.length > 1) {
        seenCounts.set(item.nextManeuver, item.flights.length);
      }
    }
    el("packPrescriptionList").innerHTML = pack.prescriptions
      .map((text) => {
        const seen = seenCounts.get(text);
        return `<li>${text}${
          seen ? ` <b>\u2014 pattern seen in ${seen} flights now.</b>` : ""
        }</li>`;
      })
      .join("");
  }
}

const copyPackText = (sourceId, button) => {
  const text = el(sourceId)?.textContent ?? "";
  if (!text) return;
  const done = () => {
    const previous = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = previous; }, 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {});
  }
};

el("packCopyButton")?.addEventListener("click", (event) =>
  copyPackText("packSnippetText", event.currentTarget)
);
el("packRevertCopyButton")?.addEventListener("click", (event) =>
  copyPackText("packRevertText", event.currentTarget)
);

function renderFirstSteps(dataset, nextSteps, pidAnalysis) {
  const cardStatus = (key) =>
    dataset?.verdict?.cards?.find((card) => card.key === key)?.status ??
    null;

  const events = dataset?.flightEvents?.summary ?? null;
  const entries = [];

  const add = (stepId, screen, title, text, tone) => {
    setFirstStep(stepId, text, tone);
    if (text) {
      entries.push({ screen, title, text, tone });
    }
  };

  // ---- PID ----
  const pidRec = recommendationFirstStep(nextSteps?.pid?.[0]);
  const gentleDemand =
    pidAnalysis?.technicalSummary?.demand?.hoverLevel === true;

  // The deep behavior checks (bounce-back, settling, ringing) can
  // flag Review while every individual command still tracked in
  // band. The card must not answer that verdict with an
  // unqualified all-clear: the honest next step is the
  // confirming flight.
  const behaviorReviews = (pidAnalysis?.findings ?? []).filter(
    (line) =>
      typeof line === "string" &&
      / (bounce-back|settling|ringing) status: Review$/.test(line)
  ).length;

  const nonCleanEvents = events
    ? (events.overshoot ?? 0) +
      (events.oscillation ?? 0) +
      (events.slow ?? 0) +
      (events.lagging ?? 0)
    : 0;

  const eventBits = events
    ? [
        events.overshoot > 0 ? `${events.overshoot} overshot` : null,
        events.oscillation > 0
          ? `${events.oscillation} oscillated`
          : null,
        events.slow > 0 ? `${events.slow} settled slowly` : null
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  add(
    "pidFirstStep",
    "pid",
    "Tuning",
    pidRec?.text ??
      (nonCleanEvents > 0
        ? `Of ${events.total} commands, ${eventBits}. That rate is inside the fleet's normal range, so no tuning change is earned from this flight alone.\n\nWhat flips this into advice is repetition: fly the same moves again, and if the ${events.worst?.axis ? events.worst.axis.toLowerCase() + " " : ""}events keep coming back, the card below will name the knob.`
        : behaviorReviews > 0
          ? `Nothing to change yet: every measured command tracked inside the fleet's normal range, but ${behaviorReviews} response behavior${behaviorReviews === 1 ? "" : "s"} (bounce-back, settling or ringing) ${behaviorReviews === 1 ? "is" : "are"} flagged for confirmation in the findings below.\n\nFly the same maneuvers again: if the pattern returns, it has earned a closer look.`
          : gentleDemand
            ? "Nothing stands out at this flight's gentle demand. For directional tuning advice, fly deliberate stick steps: clear inputs, held briefly. Then read this page again."
            : "Nothing to change from this flight: every measured command tracked inside the fleet's normal range. After any change, fly the same moves and let Compare Flights be the judge."),
    statusTone(cardStatus("tuning"))
  );

  // ---- Governor: answer the dip from the data ----
  const govRec = recommendationFirstStep(nextSteps?.governor?.[0]);
  const governor = dataset?.labs?.governor;
  const governorTone = statusTone(cardStatus("rotor") ?? governor?.status);

  let governorText = null;

  if (govRec) {
    governorText = govRec.text;
  } else if (
    governor?.status === "attention" ||
    governor?.status === "watch"
  ) {
    const dipRpm = Math.round(governor.droopRpm ?? 0);
    const dipOutput =
      governor.stableDipOutputPercent ??
      governor.flightDroopOutputPercent ??
      null;

    const loadDriven = (dataset?.governorEvents?.events ?? []).some(
      (event) =>
        event.cause === "load" || event.cause === "collective-drop"
    );

    if (
      governor.stableDipAtPowerLimit ||
      (Number.isFinite(dipOutput) && dipOutput >= 95)
    ) {
      governorText = `The ${dipRpm} rpm dip is a power-system limit, not a tuning problem: the motor output was already at ${Math.round(dipOutput)}% when it happened, so no governor setting can add power that isn't there. Adjust the gearing/Kv to match your target headspeed, or lower the target.`;
    } else if (loadDriven) {
      governorText = `The ${dipRpm} rpm dip followed a real load demand with output headroom to spare: the governor answered a hard ask, which is a power system doing its job. Nothing to change; if the same maneuver keeps dipping deeper across flights, that trend is the signal.`;
    } else if (governor.capability === "full") {
      governorText = `The ${dipRpm} rpm dip happened with output headroom remaining${Number.isFinite(dipOutput) ? ` (${Math.round(dipOutput)}%)` : ""} and no matching load demand. That is governor-tune territory. One dip is not a pattern: fly the same load again, and if it repeats, the What To Try Next card below will carry the gated advice.`;
    } else {
      // Headspeed-only log: without a governor target, stability is
      // visible but tuning attribution is not — the wording must not
      // outrun the capability the quality gate declared.
      governorText = `The ${dipRpm} rpm short-term swing happened with output headroom remaining${Number.isFinite(dipOutput) ? ` (${Math.round(dipOutput)}%)` : ""} and no obvious matching load demand. Without a logged governor target this log can judge stability, not governor tuning.\n\nRepeat the same maneuver, and if the swing keeps returning, that pattern is the signal worth acting on.`;
    }
  } else if (governor) {
    governorText =
      "Nothing to change: the governor is holding. Keep logging flights; the Health Record turns them into trends.";
  }

  add(
    "governorFirstStep",
    "governor",
    "Rotor speed",
    governorText,
    governorTone
  );

  // ---- Filter: speak about THE peak the verdict named ----
  const advisorRecs = dataset?.filterAdvice?.recommendations ?? [];
  const topAdvisor =
    advisorRecs.find((rec) => rec.priority === "first") ??
    advisorRecs[0] ??
    null;

  const vibrationCard = dataset?.verdict?.cards?.find(
    (card) => card.key === "vibration"
  );
  const peak = vibrationCard?.peak ?? null;

  let filterText = null;

  if (vibrationCard?.status === "attention" && peak) {
    filterText = `Address the mechanical source first: the ${peak.hz} Hz peak points at ${peak.identified ? peak.source : "a physical source"}. Filters can only hide it from the gyro: they never remove the shake from the airframe.\n\nThe Filter Advisor below carries the exact frequencies.`;
  } else if (peak?.managed && peak.magnitude > 3) {
    filterText = `Filtering is containing the ${peak.hz} Hz shake${Number.isFinite(peak.reductionPercent) ? ` (${peak.reductionPercent}% suppressed, nothing meaningful reaching the control loop)` : ""}. But the vibration itself is mechanical: ${peak.identified ? peak.source : "a physical source worth locating"}.\n\nA bench check when convenient is the real fix; across flights, a growing raw peak is the signal to act.`;
  } else if (topAdvisor?.priority === "filters") {
    filterText =
      "Turn the RPM filter loose on this: the biggest peaks follow rotor speed, which is exactly what it exists for. The Filter Advisor below lists the peaks and the setting to review.";
  } else if (topAdvisor) {
    filterText =
      "Vibration is present but well managed: no change recommended. Keep an eye on the trend across flights; a growing peak is the real signal.";
  } else if (dataset?.spectra?.length) {
    filterText =
      "No filter change indicated: the noise picture is clean at this log's resolution.";
  } else {
    filterText =
      "This flight never held steady long enough for a noise reading, so no filter advice can be earned from it. A longer stretch of steady flight gives the spectrum its window; on a multi-flight log, try a longer flight from the picker.";
  }

  add(
    "filterFirstStep",
    "filter",
    "Vibration",
    filterText,
    statusTone(cardStatus("vibration"))
  );

  // ---- ESC ----
  const escLab = dataset?.labs?.esc;

  add(
    "escFirstStep",
    "esc",
    "Power & ESC",
    escLab
      ? escLab.status === "attention"
        ? "Adjust the gearing/Kv to match your target headspeed, take some pitch out, or lower the headspeed. The highest-load moments below name exactly when the system ran out."
        : escLab.status === "watch"
          ? "Fine for now: remember this margin before asking the machine for more headspeed or pitch."
          : "Nothing to change: healthy headroom throughout the flight."
      : null,
    statusTone(cardStatus("power") ?? escLab?.status)
  );

  // ---- Battery ----
  const batteryLab = dataset?.labs?.battery;

  add(
    "batteryFirstStep",
    "battery",
    "Battery",
    batteryLab
      ? batteryLab.status === "attention"
        ? "Review pack condition, connectors and load before another hard flight. The voltage and current charts below show the worst dip in context."
        : batteryLab.status === "watch"
          ? "Compare the voltage dip with current demand below, and keep logging: the Health Record turns single dips into a trend you can trust."
          : "Nothing to change: the pack held up well."
      : null,
    statusTone(cardStatus("battery") ?? batteryLab?.status)
  );

  // ---- Signal ----
  const signalLab = dataset?.signalLab;

  if (signalLab) {
    add(
      "signalFirstStep",
      "signal",
      "Signal",
      signalLab.status === "attention"
        ? "Check receiver antenna placement, orientation and condition before the next flight. The events below name each moment the link struggled."
        : signalLab.status === "watch"
          ? "Glance at the dip moments below: repeated dips in the same flight orientation point at antenna placement or shading."
          : "Nothing to change: the link held all flight.",
      statusTone(cardStatus("signal") ?? signalLab.status)
    );
  } else {
    setFirstStep(
      "signalFirstStep",
      "Enable RSSI telemetry on the receiver and re-log. Then this page can watch the link for you.",
      "info"
    );
  }

  // ---- BEC ----
  const becLab = dataset?.becLab;

  if (becLab) {
    add(
      "becFirstStep",
      "bec",
      "Receiver power",
      becLab.status === "attention"
        ? "Work through the receiver power path: BEC setting and current capability, wiring, connectors. Start at the worst event below."
        : becLab.status === "watch"
          ? becLab.implausibleBrownout
            ? "Inspect the voltage-measurement path (sensor wiring and its connector): the receiver flew on through the reading, so the measurement, not the power, is the suspect."
            : "Keep an eye on the dip moments below: with power, repetition is what matters."
          : "Nothing to change: receiver power is solid.",
      statusTone(cardStatus("bec") ?? becLab.status)
    );
  } else {
    setFirstStep(
      "becFirstStep",
      "Enable BEC voltage telemetry and re-log. Then this page can watch your receiver power for you.",
      "info"
    );
  }

  renderHomeFirstSteps(entries);
}

// ---- Home: the aggregated to-do list, severity first ----
//
// The same seven answers, gathered where the journey starts.
// Attention before watch, tuning-order within a severity
// (mechanics → tune → power → link), clear items summarized as
// one green line — a to-do list never pads itself with done.
const FIRST_STEP_LAB_ORDER = [
  "filter",
  "pid",
  "governor",
  "esc",
  "battery",
  "signal",
  "bec"
];

function renderHomeFirstSteps(entries) {
  const card = el("firstStepsCard");
  const list = el("firstStepsList");

  if (!card || !list) return;

  if (!entries.length) {
    card.hidden = true;
    return;
  }

  card.hidden = false;

  const rank = { attention: 0, watch: 1 };

  const actionable = entries
    .filter((entry) => entry.tone in rank)
    .sort(
      (a, b) =>
        rank[a.tone] - rank[b.tone] ||
        FIRST_STEP_LAB_ORDER.indexOf(a.screen) -
          FIRST_STEP_LAB_ORDER.indexOf(b.screen)
    );

  list.innerHTML = "";

  if (actionable.length === 0) {
    const line = document.createElement("p");
    line.className = "first-steps-clear";
    line.textContent =
      "Nothing needs your attention: this flight is healthy. The Labs carry the details.";
    list.appendChild(line);
    return;
  }

  for (const entry of actionable) {
    const row = document.createElement("button");
    row.className = "first-steps-row";
    row.dataset.tone = entry.tone;
    row.innerHTML = `<span class="status-dot"></span><strong>${entry.title}</strong><span>${entry.text}</span>`;
    row.addEventListener("click", () => {
      navigation.showScreen(entry.screen);
    });
    list.appendChild(row);
  }
}

// ---- signal + BEC labs ----
//
// Both labs stay honest about scope: a missing column means the
// verdict says what could not be judged, never a guessed score.
// When a link event and a power event overlap, each page points
// at the other — correlation named, causation never claimed.
function renderEventTable(tableElement, headers, rows) {
  tableElement.innerHTML = `
    <table class="history-table">
      <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      ${rows.join("")}
    </table>
  `;
}

function renderSignalLab(dataset) {
  const story = el("signalStory");
  const metricsElement = el("signalMetrics");
  const eventsCard = el("signalEventsCard");
  const eventsTable = el("signalEventsTable");
  const chartCard = el("signalChartCard");

  if (!story || !metricsElement) return;

  const lab = dataset?.signalLab ?? null;

  if (!lab) {
    story.textContent =
      "This log carries no link telemetry (no signal strength and no receiver flags), so radio-link health cannot be assessed.";
    metricsElement.innerHTML = "";
    if (eventsCard) eventsCard.hidden = true;
    if (chartCard) chartCard.hidden = true;
    return;
  }

  const correlation = correlateSignalAndPower(
    lab,
    dataset?.becLab ?? null
  );

  story.textContent =
    lab.story + (correlation ? correlation.signalSentence : "");
  story.className = `lab-story status-text-${lab.status}`;

  renderMetricGrid(metricsElement, lab.metrics);

  if (eventsCard && eventsTable) {
    if (lab.events.length === 0) {
      eventsCard.hidden = true;
    } else {
      eventsCard.hidden = false;
      renderEventTable(
        eventsTable,
        ["When", "What", "Duration", "Detail"],
        lab.events.map(
          (event) => `
          <tr>
            <td>${event.startSeconds.toFixed(1)} s</td>
            <td>${
              event.kind === "failsafe"
                ? "Failsafe"
                : event.kind === "link-loss"
                  ? "Link loss"
                  : event.kind === "deep-degradation"
                    ? "Deep signal dip"
                    : "Signal dip"
            }</td>
            <td>${event.durationMs} ms</td>
            <td>${event.detail}</td>
          </tr>`
        )
      );
    }
  }

  if (chartCard) {
    const hasRssi = lab.capability === "full";
    chartCard.hidden = !hasRssi;
    if (hasRssi) {
      renderSeriesChart(el("chartSignal"), dataset, [/^rssi$/i], {
        yLabel: "signal (as logged)"
      });
    }
  }
}

function renderBecLab(dataset) {
  const story = el("becStory");
  const metricsElement = el("becMetrics");
  const eventsCard = el("becEventsCard");
  const eventsTable = el("becEventsTable");
  const chartCard = el("becChartCard");

  if (!story || !metricsElement) return;

  const lab = dataset?.becLab ?? null;

  if (!lab) {
    story.textContent =
      "This log carries no usable BEC voltage telemetry, so receiver power cannot be assessed.";
    metricsElement.innerHTML = "";
    if (eventsCard) eventsCard.hidden = true;
    if (chartCard) chartCard.hidden = true;
    return;
  }

  const correlation = correlateSignalAndPower(
    dataset?.signalLab ?? null,
    lab
  );

  story.textContent =
    lab.story + (correlation ? correlation.becSentence : "");
  story.className = `lab-story status-text-${lab.status}`;

  renderMetricGrid(metricsElement, lab.metrics);

  if (eventsCard && eventsTable) {
    if (lab.events.length === 0) {
      eventsCard.hidden = true;
    } else {
      eventsCard.hidden = false;
      renderEventTable(
        eventsTable,
        ["When", "Lowest", "Depth", "Duration", "Servo context"],
        lab.events.map(
          (event) => `
          <tr>
            <td>${event.startSeconds.toFixed(1)} s</td>
            <td>${event.lowestVolts.toFixed(2)} V</td>
            <td>${event.depthPercent.toFixed(1)}%</td>
            <td>${event.durationMs} ms${event.sustained ? " (sustained)" : ""}</td>
            <td>${
              event.demandContext === "high-demand"
                ? "high servo demand, consistent with load"
                : event.demandContext === "quiet"
                  ? "servos quiet: look at wiring/BEC"
                  : "—"
            }</td>
          </tr>`
        )
      );
    }
  }

  if (chartCard) {
    chartCard.hidden = false;
    const scale = lab.scale ?? 100;
    renderScaledChart(
      el("chartBecVoltage"),
      dataset,
      [
        {
          patterns: [/^Vbec$/i],
          label: "BEC voltage (V)",
          // renderScaledChart hands convert the whole VALUES ARRAY
          // (see toVolts) — a per-value converter renders an empty
          // chart with healthy-looking axes.
          convert: (values) =>
            values.map((value) =>
              Number.isFinite(value) ? value / scale : null
            )
        }
      ],
      "BEC voltage (V)"
    );
    renderSeriesChart(el("chartBecServo"), dataset, [/^servo\[\d\]$/i], {
      yLabel: "servo command (µs)"
    });
  }
}

// ---- servo travel check ----
//
// Hidden entirely when the log offers nothing to judge (no servo
// columns, or servos that never moved) — a check that never ran
// must not imply it passed.
function renderServoLimits(servoLimits) {
  const card = el("servoLimitCard");
  const summary = el("servoLimitSummary");
  const table = el("servoLimitTable");

  if (!card || !summary || !table) {
    return;
  }

  if (!servoLimits) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  summary.textContent = servoLimits.summary;

  if (servoLimits.status !== "detected") {
    table.innerHTML = "";
    return;
  }

  const rows = servoLimits.events
    .map(
      (event) => `
        <tr>
          <td>${servoDisplayName(event.servo)}</td>
          <td>${event.startSeconds.toFixed(1)}–${event.endSeconds.toFixed(1)} s</td>
          <td>${event.side === "max" ? "upper" : "lower"} edge</td>
          <td>${event.durationMs} ms</td>
          <td>${Math.round(event.valueUs)} µs</td>
        </tr>`
    )
    .join("");

  table.innerHTML = `
    <table class="history-table">
      <tr>
        <th>Servo</th><th>When</th><th>Edge</th><th>Held for</th><th>Command</th>
      </tr>
      ${rows}
    </table>
  `;
}

// ---- "What to try next" — recommendation cards ----
//
// One block per recommendation. Above the gate it names one
// setting family, a direction and a magnitude class; below it,
// the same object renders as the review finding it is.

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderNextSteps(cardId, listId, recommendations) {
  const card = el(cardId);
  const list = el(listId);

  if (!card || !list) return;

  if (!recommendations || recommendations.length === 0) {
    card.hidden = true;
    list.innerHTML = "";
    return;
  }

  card.hidden = false;
  list.innerHTML = recommendations
    .map((rec) => {
      const action = rec.suggestion
        ? `<p><strong>Try:</strong> one ${escapeHtml(rec.suggestion.magnitudeClass)} ${rec.suggestion.direction === "up" ? "up" : "down"} on <code>${escapeHtml(rec.suggestion.family)}</code>. Change only this, fly the same moves again, and watch ${escapeHtml(rec.verifyMetric ?? "the same finding")}. Expected: ${escapeHtml(rec.expectedResult ?? "")}</p>`
        : `<p><strong>Not calling it yet:</strong> ${escapeHtml(rec.gatedReason ?? "more evidence needed.")}</p>`;

      return `
        <div class="event-detail-explain">
          <p><strong>${escapeHtml(rec.finding)}</strong></p>
          <p>${escapeHtml(rec.hypothesis ?? "")}</p>
          ${action}
          <p class="chart-hint">Confidence: ${escapeHtml(rec.confidence ?? "\u2014")} · based on ${(rec.evidence ?? []).length} event${(rec.evidence ?? []).length === 1 ? "" : "s"} on this page</p>
        </div>`;
    })
    .join("");
}

// The governor- and precomp-family settings worth showing beside
// the headspeed events, in reading order. Names verified against a
// real Rotorflight 4.6 `dump all`; keys a firmware version does not
// have simply do not appear — nothing is guessed or defaulted.
const GOVERNOR_SETTING_KEYS = [
  "gov_mode",
  "gov_headspeed",
  "gov_gain",
  "gov_p_gain",
  "gov_i_gain",
  "gov_d_gain",
  "gov_f_gain",
  "gov_tta_gain",
  "gov_cyclic_ff_weight",
  "gov_collective_ff_weight",
  "gov_spoolup_time",
  "gov_min_throttle",
  "gov_max_throttle",
  "yaw_collective_ff_gain",
  "yaw_cyclic_ff_gain",
  "pitch_f_gain",
  "pitch_o_gain"
];

function renderPrecompBalance(dataset) {
  const card = el("precompBalanceCard");
  const governorStoryElement = el("precompGovernorStory");
  const tailStoryElement = el("precompTailStory");
  const metricsElement = el("precompMetrics");

  if (!card) return;

  const precomp = dataset?.precomp;

  if (!precomp || (!precomp.governor && !precomp.tail)) {
    card.hidden = true;
    return;
  }

  card.hidden = false;

  if (governorStoryElement) {
    governorStoryElement.hidden = !precomp.governor;
    governorStoryElement.textContent =
      precomp.governor?.story ?? "";
  }

  if (tailStoryElement) {
    tailStoryElement.hidden = !precomp.tail;
    tailStoryElement.textContent = precomp.tail?.story ?? "";
  }

  const metrics = [];

  if (Number.isFinite(precomp.governor?.riseDroopPercent)) {
    metrics.push({
      label: "Rise droop (median)",
      value: `${precomp.governor.riseDroopPercent}%`
    });
  }

  if (Number.isFinite(precomp.governor?.dropOvershootPercent)) {
    metrics.push({
      label: "Drop overspeed (median)",
      value: `${precomp.governor.dropOvershootPercent}%`
    });
  }

  if (precomp.transientCount > 0) {
    metrics.push({
      label: "Collective moves read",
      value: `${precomp.riseCount} up · ${precomp.dropCount} down`
    });
  }

  if (Number.isFinite(precomp.tail?.kickRatio)) {
    metrics.push({
      label: "Tail kick vs baseline",
      value: `${precomp.tail.kickRatio}×`
    });
  }

  renderMetricGrid(metricsElement, metrics);
}

function renderGovernorSettings(dataset) {
  const card = el("governorSettingsCard");
  const table = el("governorSettingsTable");

  if (!card || !table) return;

  // Dumps are filed under the NORMALIZED craft key — a log without
  // a craft-name header reads "Not found" here but saves under
  // "Unknown craft", and the two must meet or the card never shows.
  const rawCraftName = dataset?.craftName;
  const craftName =
    !rawCraftName || rawCraftName === "Not found"
      ? "Unknown craft"
      : rawCraftName;
  const dump = getCraftDump(localStorage, craftName);
  const parsed = dump?.parsed ?? null;

  const rows = parsed
    ? GOVERNOR_SETTING_KEYS.filter((key) => parsed[key] !== undefined)
    : [];

  if (rows.length === 0) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  table.innerHTML = `
    <tr><th>Setting</th><th>Value</th></tr>
    ${rows
      .map(
        (key) => `
      <tr>
        <td>${key}</td>
        <td>${String(parsed[key])}</td>
      </tr>`
      )
      .join("")}
  `;
}

const AXIS_INDEX = { roll: 0, pitch: 1, yaw: 2 };

function hideEventDetail() {
  const detail = el("pidEventDetail");
  if (detail) detail.hidden = true;
  stickControllers.get("pidEventSticks")?.controller.stop();
}

function showEventDetail(event) {
  const detail = el("pidEventDetail");
  const explain = el("pidEventExplain");
  const chartElement = el("pidEventChart");
  if (!detail || !currentDataset) return;

  detail.hidden = false;

  // An event without a timeline anchor gets no invented moment —
  // the card says what is known and the chart stays un-zoomed.
  if (!Number.isFinite(event.t)) {
    explain.textContent = `A ${event.magnitude ?? "?"}°/s ${event.axis.toLowerCase()} setpoint step was analyzed, but its exact position on the flight timeline could not be anchored, so no zoomed chart is shown for it.`;
    chartElement.innerHTML = "";
    return;
  }

  // The magnitude is the setpoint STEP, not the absolute rate — a
  // pirouette already running at 200°/s can step by 23°/s, and the
  // chart plots the absolute target. The words must match the chart.
  const asked = `At ${event.t.toFixed(1)} s the ${event.axis.toLowerCase()} setpoint ${event.direction === -1 ? "stepped down" : "stepped up"} by ${event.magnitude ?? "?"}°/s.`;
  explain.textContent =
    event.verdict === "overshoot"
      ? `${asked} The response went ${event.overshoot_ds ?? "?"}°/s PAST the target (${event.overshoot_percent}% of the step) before coming back: visible below as the gyro line crossing beyond the setpoint line. Occasional overshoot on hard inputs is normal; a pattern of it is tune feedback.`
      : event.verdict === "oscillation"
        ? `${asked} After the input the response swung back and forth across the target, up to ±${event.oscillation_ds}°/s: an oscillation, not a single overshoot. If this repeats on hard inputs, it is classic gain feedback: watch the gyro line below.`
        : event.verdict === "slow"
          ? `${asked} The response reached the target but took ${event.settling_ms} ms to settle. Watch the gyro line hunting around the setpoint below.`
          : event.verdict === "lagging"
            ? `${asked} The response was still approaching the target when its measurement window closed, so it is not scored as overshoot or settling. If this repeats on deliberate inputs, it reads as a slow response.`
            : `${asked} The gyro followed the setpoint cleanly: this is what good tracking looks like.`;

  // The evidence, right here: the same setpoint-vs-gyro chart the
  // Tuning matrix draws, windowed to THIS event's own extent —
  // command start through response — so the selected event is
  // always inside the frame it is described by.
  const axisIndex = AXIS_INDEX[event.axis.toLowerCase()] ?? 0;
  const column = (base) =>
    new RegExp(`^${base}\\[${axisIndex}\\]$`, "i");

  const markers = [{ x: event.t, label: "command" }];

  if (
    Number.isFinite(event.tResponsePeak) &&
    event.tResponsePeak - event.t > 0.15
  ) {
    markers.push({ x: event.tResponsePeak, label: "response peak" });
  }

  renderPresetChart(
    chartElement,
    currentDataset,
    [
      { patterns: [column("setpoint")], color: PRESET_COLORS.setpoint },
      { patterns: [column("gyroADC")], color: PRESET_COLORS.gyro }
    ],
    "deg/s",
    {
      height: 240,
      markers
    }
  );

  // Zoom only the chart that was just rendered for this event: a
  // handle left over from an earlier selection (its canvas is no
  // longer attached) must never receive this event's window.
  const chart = chartElement.__blackboxLabChart;
  const window = eventChartWindow(event);

  if (chart && chart.root?.isConnected && window) {
    chart.setScale("x", window);
  }

  // The pilot's hands beside the machine's answer: replay the
  // event window once, then park at the command moment.
  mountStickInset({
    wrapId: "pidEventSticksWrap",
    canvasId: "pidEventSticks",
    chartElements: [chartElement],
    anchorTime: event.t,
    playFrom: window
  });

  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// The Filter and PID pages open with the SAME verdict Home
// shows for them — one engine, one sentence, no page left
// without its verdict.
function renderLabVerdictStories(verdict) {
  const stories = [
    { key: "vibration", element: el("filterVerdictStory") },
    { key: "tuning", element: el("pidVerdictStory") }
  ];

  for (const { key, element } of stories) {
    if (!element) continue;
    const card = verdict?.cards.find((entry) => entry.key === key);
    if (card) {
      element.textContent = `${card.headline}. ${card.detail}`;
      // Same status treatment as every other lab verdict.
      element.className = `lab-story status-text-${card.status}`;
    } else {
      // A loaded flight with no verdict for this lab must say so —
      // leaving the open-a-log placeholder on screen reads as a
      // broken page, not a capability limit.
      element.textContent =
        key === "vibration"
          ? "This flight offered no usable noise window (too little steady flight), so vibration and filtering cannot be judged from it."
          : "This flight could not support this analysis.";
      element.className = "lab-story status-text-insufficient";
    }
  }
}

function renderVerdict(dataset) {
  const verdict = dataset?.verdict;

  renderLabVerdictStories(verdict);

  if (!verdict || verdict.cards.length === 0) {
    verdictCard.hidden = true;
    return;
  }

  verdictCard.hidden = false;
  verdictSummary.textContent = currentFlightSummary
    ? `${currentFlightSummary}: ${verdict.summary}`
    : verdict.summary;
  verdictCards.innerHTML = "";

  // A one-look dashboard: compact tiles side by side. Their
  // whole job is a color, a sentence and a destination — the
  // full story, action and evidence live on each lab page,
  // one click away.
  verdictCards.className = "verdict-grid";

  for (const card of verdict.cards) {
    const tile = document.createElement("div");
    tile.className = `verdict-tile status-${card.status}`;
    tile.title = `${card.detail}${card.action ? ` What to do: ${card.action}` : ""}`;

    tile.innerHTML = `
      <div class="verdict-item-top">
        <span class="status-dot"></span>
        <span class="verdict-item-title">${card.statusLabel ? `${card.title} · ${card.statusLabel}` : card.title}</span>
      </div>
      <div class="verdict-tile-headline">${card.headline}</div>
      <div class="verdict-tile-evidence">Show me → ${card.evidence}</div>
    `;

    tile.addEventListener("click", () => {
      navigation.showScreen(card.screen);

      if (card.focus) {
        // Let the screen become visible, then zoom the
        // evidence chart to the exact moment.
        setTimeout(() => {
          const chart =
            el(card.focus.chartId)?.__blackboxLabChart;

          if (chart) {
            chart.setScale("x", {
              min: card.focus.min,
              max: card.focus.max
            });
          }
        }, 120);
      }
    });

    verdictCards.appendChild(tile);
  }
}

function renderMetricGrid(element, metrics) {
  element.innerHTML = "";

  for (const metric of metrics) {
    const tile = document.createElement("div");
    tile.className = "metric-tile";
    tile.innerHTML = `<span class="label">${metric.label}</span><strong>${metric.value}</strong>`;
    element.appendChild(tile);
  }
}

function renderLab(analysis, storyElement, metricsElement, emptyText) {
  if (!analysis) {
    storyElement.textContent = emptyText;
    metricsElement.innerHTML = "";
    return;
  }

  storyElement.textContent = analysis.story;
  storyElement.className = `lab-story status-text-${analysis.status}`;
  renderMetricGrid(metricsElement, analysis.metrics);
}

function renderSeriesChart(element, dataset, patterns, options = {}) {
  const columns = dataset.findColumnsIn(patterns).slice(0, 6);

  if (columns.length === 0) {
    element.innerHTML =
      '<p class="chart-empty">This log has no data for this chart.</p>';
    return;
  }

  const series = columns.map((name, index) => ({
    label: name,
    values: decimate(dataset.columnValues(name)),
    color: CHART_COLORS[index % CHART_COLORS.length]
  }));

  renderTimeSeriesChart(element, {
    timeSeconds: decimate(dataset.timeSeconds),
    series,
    yLabel: options.yLabel ?? ""
  });
}

// ---- unit conversion for display ----
// Logs store raw units: throttle 0-1000 (Rotorflight) or
// 1000-2000 (Betaflight-style), volts x100, amps x100.
function toThrottlePercent(values) {
  let max = 0;

  for (const value of values) {
    if (value > max) max = value;
  }

  if (max > 1100) {
    return values.map((value) => Math.max(0, (value - 1000) / 10));
  }

  if (max > 100) {
    return values.map((value) => value / 10);
  }

  return values;
}

function toVolts(values) {
  let sum = 0;

  for (const value of values) sum += value;
  const average = values.length ? sum / values.length : 0;
  const scale = average > 1000 ? 100 : average > 100 ? 10 : 1;
  return values.map((value) => value / scale);
}

function toAmps(values) {
  let max = 0;

  for (const value of values) {
    if (value > max) max = value;
  }

  const scale = max > 500 ? 100 : 1;
  return values.map((value) => value / scale);
}

function renderScaledChart(element, dataset, entries, yLabel) {
  const series = [];

  for (const entry of entries) {
    const column = dataset.findColumnsIn(entry.patterns)[0];

    if (column) {
      series.push({
        label: entry.label ?? column,
        values: decimate(entry.convert(dataset.columnValues(column))),
        color: CHART_COLORS[series.length % CHART_COLORS.length]
      });
    }
  }

  if (series.length === 0) {
    element.innerHTML =
      '<p class="chart-empty">This log has no data for this chart.</p>';
    return;
  }

  renderTimeSeriesChart(element, {
    timeSeconds: decimate(dataset.timeSeconds),
    series,
    yLabel
  });
}

// ---- Ben's preset grid: per axis, three opinionated charts ----
// Tracking (setpoint + gyro), FF check (+ I-term: I ≈ 0 during a
// followed command = feedforward carrying the work), term balance
// (setpoint anchors P/I/D activity to pilot input). Colors stay
// per-role across all nine charts so the eye can jump between them.
const PRESET_COLORS = {
  setpoint: CHART_COLORS[0], // blue — the target
  gyro: CHART_COLORS[1], // orange — the response
  i: CHART_COLORS[2], // green — I-term
  p: CHART_COLORS[3], // amber — P-term
  d: CHART_COLORS[4] // magenta — D-term
};

function renderPresetChart(element, dataset, entries, yLabel, options = {}) {
  const series = [];

  for (const entry of entries) {
    const column = dataset.findColumnsIn(entry.patterns)[0];

    if (column) {
      series.push({
        label: column,
        values: decimate(dataset.columnValues(column)),
        color: entry.color
      });
    }
  }

  // One lonely line can't show a relationship — every preset
  // compares traces, so ask for at least two.
  if (series.length < 2) {
    element.innerHTML =
      '<p class="chart-empty">This log has no data for this chart.</p>';
    return;
  }

  renderTimeSeriesChart(element, {
    timeSeconds: decimate(dataset.timeSeconds),
    series,
    yLabel,
    height: options.height ?? 220,
    markers: options.markers ?? []
  });
}

function renderTuningPresets(dataset) {
  const axes = [
    { index: 0, tracking: chartTracking, ff: chartFfRoll, terms: chartTermsRoll },
    { index: 1, tracking: chartTrackingPitch, ff: chartFfPitch, terms: chartTermsPitch },
    { index: 2, tracking: chartTrackingYaw, ff: chartFfYaw, terms: chartTermsYaw }
  ];

  for (const axis of axes) {
    const column = (base) =>
      new RegExp(`^${base}\\[${axis.index}\\]$`, "i");

    const setpoint = { patterns: [column("setpoint")], color: PRESET_COLORS.setpoint };
    const gyro = { patterns: [column("gyroADC")], color: PRESET_COLORS.gyro };
    const iTerm = { patterns: [column("axisI")], color: PRESET_COLORS.i };
    const pTerm = { patterns: [column("axisP")], color: PRESET_COLORS.p };
    const dTerm = { patterns: [column("axisD")], color: PRESET_COLORS.d };

    renderPresetChart(axis.tracking, dataset, [setpoint, gyro], "deg/s");
    renderPresetChart(axis.ff, dataset, [setpoint, gyro, iTerm], "deg/s · term output");
    renderPresetChart(axis.terms, dataset, [setpoint, pTerm, iTerm, dTerm], "deg/s · term output");
  }
}

// ---- synchronized evidence views (Governor & ESC Labs) ----
// Evidence only: these read what the labs already computed and
// what the log genuinely recorded. No score is touched here.

function toDegreesCelsius(values) {
  let max = 0;

  for (const value of values) {
    if (value > max) max = value;
  }

  // Logs store temperature either directly or ×10.
  return max > 200
    ? values.map((value) => value / 10)
    : values;
}

function slicedSeries(dataset, window, entries) {
  const series = [];

  for (const entry of entries) {
    let values = entry.values;

    if (!values) {
      const column = dataset.findColumnsIn(entry.patterns)[0];

      if (!column) {
        continue;
      }

      values = dataset.columnValues(column);
      values = entry.convert ? entry.convert(values) : values;
    }

    series.push({
      label: entry.label,
      values: values.slice(window.startIndex, window.endIndex + 1),
      color: entry.color
    });
  }

  return series;
}

function renderSyncedChart(element, dataset, window, entries, options) {
  const series = slicedSeries(dataset, window, entries);

  if (series.length === 0) {
    element.innerHTML = "";
    element.hidden = true;
    return false;
  }

  element.hidden = false;
  renderTimeSeriesChart(element, {
    timeSeconds: dataset.timeSeconds.slice(
      window.startIndex,
      window.endIndex + 1
    ),
    series,
    height: 190,
    ...options
  });

  return true;
}

// The audit trail behind the Governor verdict: capability, target
// provenance, per-bank evidence weight, telemetry availability and
// precomp counts — the same numbers-on-request the Filter and PID
// Labs already offer, without touching the pilot-facing story.
function renderGovernorTechnical(dataset) {
  const card = el("governorTechnicalCard");
  const grid = el("governorTechnicalGrid");
  if (!card || !grid) return;

  const gov = dataset?.labs?.governor;
  if (!gov || gov.capability === "unavailable") {
    card.hidden = true;
    return;
  }

  const rows = [];

  rows.push({
    label: "Analysis capability",
    value:
      gov.capability === "full"
        ? "Full: a logged governor target was accepted; droop is target-relative"
        : "Partial: headspeed stability only; swings are measured against the rotor's own trend"
  });

  const targetColumns = dataset.findColumnsIn([
    /governorTarget/i,
    /govTarget/i
  ]);
  rows.push({
    label: "Governor-target source",
    value:
      targetColumns.length === 0
        ? "no governor-target column in this log"
        : gov.capability === "full"
          ? `${targetColumns[0]}: accepted as a rotor-speed target`
          : `${targetColumns[0]}, present but rejected: it does not behave like a rotor-speed target (constant or passthrough, e.g. DIRECT mode)`
  });

  for (const bank of gov.perBank ?? []) {
    rows.push({
      label: `Bank ${bank.targetRpm} rpm${bank.observed ? " (observed)" : ""}`,
      value:
        `avg ${bank.averageRpm} rpm · dip ${Math.round(bank.droopRpm)} rpm` +
        (Number.isFinite(bank.droopPercent)
          ? ` (${bank.droopPercent.toFixed(1)}%)`
          : "") +
        (Number.isFinite(bank.rmsError)
          ? ` · RMS ${bank.rmsError.toFixed(1)} rpm`
          : "") +
        (Number.isFinite(bank.sampleCount)
          ? ` · ${bank.sampleCount.toLocaleString()} samples${
              bank.sampleCount < 2000 ? ", limited evidence" : ""
            }`
          : "")
    });
  }

  if (gov.capability !== "full" && Number.isFinite(gov.droopRpm)) {
    rows.push({
      label: "Largest short-term swing",
      value:
        `${gov.droopRpm} rpm` +
        (Number.isFinite(gov.droopPercent)
          ? ` (${gov.droopPercent}%)`
          : "") +
        (Number.isFinite(gov.droopTimeSeconds)
          ? ` at ${gov.droopTimeSeconds} s`
          : "") +
        ": against the rotor's own trend, not a target"
    });
  }

  const stableSamples = gov.stableSampleCount ?? 0;
  rows.push({
    label: "Stable samples used",
    value: stableSamples.toLocaleString()
  });
  rows.push({
    label: "Evidence confidence",
    value:
      stableSamples >= 5000
        ? "High: a long stable-flight window backs these numbers"
        : stableSamples >= 1500
          ? "Moderate: a usable but not generous stable window"
          : "Low: short stable window; treat conclusions as provisional"
  });

  const excursions = dataset.governorEvents?.summary;
  if (excursions) {
    rows.push({
      label: "Headspeed excursions",
      value:
        excursions.totalFound === 0
          ? "none detected in stable flight"
          : `${excursions.totalFound} (${excursions.under} under · ${excursions.over} over)`
    });
  }

  rows.push({
    label: "ESC output telemetry",
    value:
      dataset.findColumnsIn([/^escThr/i, /throttle/i]).length > 0
        ? "available: significant dips carry output/headroom context"
        : "not logged: output/headroom context unavailable for events"
  });

  const governorTerms = ["govP", "govI", "govD", "govF"].filter(
    (name) =>
      dataset.findColumnsIn([new RegExp(`^${name}`, "i")]).length > 0
  );
  rows.push({
    label: "Governor P/I/D/F telemetry",
    value: governorTerms.length > 0 ? governorTerms.join(", ") : "not logged"
  });

  const precompGovernor = dataset.precomp?.governor;
  if (precompGovernor) {
    rows.push({
      label: "Collective precomp evidence",
      value:
        `${precompGovernor.riseCount ?? 0} rise / ${precompGovernor.dropCount ?? 0} drop transients` +
        (Number.isFinite(precompGovernor.riseDroopPercent)
          ? `: rise droop ${precompGovernor.riseDroopPercent}%`
          : "") +
        (Number.isFinite(precompGovernor.dropOvershootPercent)
          ? `, drop overspeed ${precompGovernor.dropOvershootPercent}%`
          : "")
    });
  }
  const precompTail = dataset.precomp?.tail;
  if (precompTail && Number.isFinite(precompTail.kickRatio)) {
    rows.push({
      label: "Tail-kick evidence",
      value: `${precompTail.kickRatio}× the tail's baseline error on collective moves`
    });
  }

  card.hidden = false;
  renderMetricGrid(grid, rows);
}

function renderGovernorEvidence(dataset) {
  const droopTime = dataset.labs.governor?.droopTimeSeconds;

  const window = Number.isFinite(droopTime)
    ? sliceWindow(dataset.timeSeconds, droopTime, 4, 6)
    : null;

  if (!window) {
    droopContextCard.hidden = true;
    const droopWrap = el("droopSticksWrap");
    if (droopWrap) droopWrap.hidden = true;
    return;
  }

  droopContextCard.hidden = false;

  mountStickInset({
    wrapId: "droopSticksWrap",
    canvasId: "droopSticks",
    chartElements: [chartDroopRpm, chartDroopDrive, chartDroopPower],
    anchorTime: droopTime,
    playFrom: null
  });

  // Droop is measured against a target. Without one, the same
  // moment is the largest short-term swing — the card says which
  // it is showing, and the target/error traces stay off the chart.
  const hasTarget =
    dataset.labs.governor?.capability === "full";

  if (droopContextTitle) {
    droopContextTitle.textContent = hasTarget
      ? "The Worst Droop, In Context"
      : "The Largest Swing, In Context";
  }

  if (droopContextHint) {
    droopContextHint.textContent = hasTarget
      ? "The seconds around the biggest dip, lined up on one clock. Zoom any chart and the others follow. Read top to bottom: what the rotor did, what the pilot and governor asked for, and what the power system delivered."
      : "The seconds around the largest short-term headspeed swing, lined up on one clock. Zoom any chart and the others follow. No governor target is logged, so this shows steadiness, not droop against a target.";
  }

  const markerLabel = hasTarget ? "worst droop" : "largest swing";
  const markers = [{ x: droopTime, label: markerLabel }];

  const targetValues = dataset.governorTarget ?? [];
  const actualValues = dataset.headspeed ?? [];
  const errorValues = actualValues.map((actual, index) => {
    const target = targetValues[index];
    return Number.isFinite(target) && Number.isFinite(actual)
      ? target - actual
      : null;
  });

  renderSyncedChart(
    chartDroopRpm,
    dataset,
    window,
    hasTarget
      ? [
          { label: "govTarget", values: targetValues, color: CHART_COLORS[0] },
          { label: "headspeed", values: actualValues, color: CHART_COLORS[1] },
          { label: "RPM error", values: errorValues, color: CHART_COLORS[4] }
        ]
      : [
          { label: "headspeed", values: actualValues, color: CHART_COLORS[1] }
        ],
    { yLabel: "rpm", markers, linkGroup: "droopSync" }
  );

  renderSyncedChart(
    chartDroopDrive,
    dataset,
    window,
    [
      {
        patterns: [/^motor\[0\]$/i],
        label: "Motor output (%)",
        convert: toThrottlePercent,
        color: CHART_COLORS[3]
      },
      {
        patterns: [/^setpoint\[3\]$/i],
        label: "Collective target",
        color: CHART_COLORS[5]
      }
    ],
    { yLabel: "% · collective", markers, linkGroup: "droopSync" }
  );

  renderSyncedChart(
    chartDroopPower,
    dataset,
    window,
    [
      {
       patterns: dataset.voltagePatterns,
        label: "Pack voltage (V)",
        convert: toVolts,
        color: CHART_COLORS[0]
      },
      
      {
  patterns: [/^EscI$/i],
  label: "Current (A)",
  convert: toAmps,
  color: CHART_COLORS[1]
}
    ],
    { yLabel: "volts · amps", markers, linkGroup: "droopSync" }
  );

  // Real recorded governor terms only — never derived.
  const governorTermEntries = [
    { patterns: [/^govP$/i], label: "govP", color: CHART_COLORS[3] },
    { patterns: [/^govI$/i], label: "govI", color: CHART_COLORS[2] },
    { patterns: [/^govD$/i], label: "govD", color: CHART_COLORS[4] },
    { patterns: [/^govF$/i], label: "govF", color: CHART_COLORS[5] },
    { patterns: [/^govSum$/i], label: "govSum", color: CHART_COLORS[0] }
  ].filter(
    (entry) => dataset.findColumnsIn(entry.patterns).length > 0
  );

  if (governorTermEntries.length === 0) {
    droopGovBlock.hidden = true;
  } else {
    droopGovBlock.hidden = false;
    renderSyncedChart(
      chartDroopGov,
      dataset,
      window,
      governorTermEntries,
      { yLabel: "governor terms", markers, linkGroup: "droopSync" }
    );
  }
}

function renderEscEvidence(dataset) {
  const outputColumn =
    dataset.findColumnsIn([/^EscThr$/i])[0] ??
    dataset.findColumnsIn([/^motor\[0\]$/i])[0];

  const currentColumn =
    dataset.findColumnsIn([/^EscI$/i])[0] ??
    dataset.findColumnsIn([/^Ibat$/i, /amperage/i, /current/i])[0];

  const voltageColumn =
    dataset.findColumnsIn(dataset.voltagePatterns)[0] ??
    dataset.findColumnsIn([/^vbat/i])[0];

  if (!outputColumn || !currentColumn || !voltageColumn) {
    loadEventsCard.hidden = true;
    escProfileCard.hidden = true;
    return;
  }

  const outputPercent = toThrottlePercent(
    dataset.columnValues(outputColumn)
  );
  const currentAmps = toAmps(dataset.columnValues(currentColumn));
  const voltageVolts = toVolts(dataset.columnValues(voltageColumn));

  const wattValues = currentAmps.map((amps, index) => {
    const volts = voltageVolts[index];
    return Number.isFinite(amps) && Number.isFinite(volts)
      ? amps * volts
      : null;
  });

  // Collective demand lets the app prove a pitch-pump load
  // instead of leaving the pilot to correlate charts by hand.
  const collectiveColumn =
    dataset.findColumnsIn([/^setpoint\[3\]$/i])[0] ?? null;

  const collectiveAbs = collectiveColumn
    ? dataset
        .columnValues(collectiveColumn)
        .map((value) =>
          Number.isFinite(value) ? Math.abs(value) : null
        )
    : null;

  const collectiveFlightStats = (() => {
    if (!collectiveAbs) {
      return null;
    }

    const sorted = collectiveAbs
      .filter(Number.isFinite)
      .sort((first, second) => first - second);

    if (sorted.length === 0) {
      return null;
    }

    return {
      peak: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)]
    };
  })();

  // An all-zero temperature column means the sensor isn't
  // fitted (e.g. no second ESC) — don't plot a dead line.
  const temperatureEntries = [
    { patterns: [/^Tesc$/i], label: "Tesc", color: CHART_COLORS[1] },
    { patterns: [/^Tesc2$/i], label: "Tesc2", color: CHART_COLORS[4] },
    { patterns: [/^tempEsc/i, /escTemp/i], label: "ESC temp", color: CHART_COLORS[1] }
  ].filter((entry) => {
    const column = dataset.findColumnsIn(entry.patterns)[0];
    return (
      Boolean(column) &&
      dataset.columnValues(column).some((value) => value > 0)
    );
  });

  // Load = current when the sensor actually reported any, ESC
  // output otherwise — an all-zero current column must not zero
  // out the ranking (that made spool-up windows "win"). Windows
  // must also be flown: startup/spool-up/shutdown are excluded by
  // the in-flight mask.
  const currentCarriesData = currentAmps.some(
    (value) => Number.isFinite(value) && value !== 0
  );
  const loadSeries = currentCarriesData ? currentAmps : outputPercent;

  const airborneIndexes =
    detectInFlightSamples({
      timeSeconds: dataset.timeSeconds,
      headspeed: dataset.headspeed
    }) ?? null;
  const airborneMask = airborneIndexes
    ? (() => {
        const mask = new Uint8Array(dataset.timeSeconds.length);
        for (const index of airborneIndexes) mask[index] = 1;
        return mask;
      })()
    : null;

  // The airborne mask alone still admits the tail of the spool-up
  // ramp and the governor's first settling seconds — an elevated
  // output plateau that outranks real flight moments. The stable
  // phase bounds the flight (first sustained stable segment → last
  // stable sample); inside those bounds the permissive mask stays,
  // so a hard collective pump that droops the rotor out of the
  // stable mask remains exactly as eligible as it should be.
  const loadEnvelope = airborneMask
    ? qualifiedLoadEnvelope({
        timeSeconds: dataset.timeSeconds,
        headspeed: dataset.headspeed,
        governorTarget: dataset.governorTarget
      })
    : null;

  if (loadEnvelope && airborneMask) {
    for (let i = 0; i < airborneMask.length; i += 1) {
      if (i < loadEnvelope.startIndex || i > loadEnvelope.endIndex) {
        airborneMask[i] = 0;
      }
    }
  }

  const events = findHighestLoadEvents(
    { timeSeconds: dataset.timeSeconds, load: loadSeries },
    { windowSeconds: 2, count: 3, qualifiedMask: airborneMask }
  );

  // No qualifying windows is an answer, not an absence: the card
  // stays and says so, instead of silently vanishing (or worse,
  // padding itself with spool-up windows).
  const escEventsEmpty = el("escEventsEmpty");
  const escEventsTableWrap = el("escEventsTableWrap");

  if (events.length === 0) {
    loadEventsCard.hidden = false;
    if (escEventsEmpty) escEventsEmpty.hidden = false;
    if (escEventsTableWrap) escEventsTableWrap.hidden = true;
    const stories = el("escEventsStories");
    if (stories) stories.innerHTML = "";
    const sticksWrap = el("escSticksWrap");
    if (sticksWrap) sticksWrap.hidden = true;
    for (const chartId of [
      "chartLoadOutput",
      "chartLoadCollective",
      "chartLoadPower",
      "chartLoadWatts",
      "chartLoadTemp"
    ]) {
      const chart = el(chartId);
      if (chart) chart.innerHTML = "";
    }
  } else {
    loadEventsCard.hidden = false;
    if (escEventsEmpty) escEventsEmpty.hidden = true;
    if (escEventsTableWrap) escEventsTableWrap.hidden = false;

    // Voltage baseline: the pack's level JUST BEFORE each event.
    // A whole-flight baseline conflates ordinary discharge with
    // load sag — an event late in the pack always looked "sagged"
    // against the fresh-pack top end, which is exactly the
    // unfounded read the field called out. The calm top end of
    // the flight remains only as a fallback for an event with no
    // usable run-up.
    const sortedVoltage = voltageVolts
      .filter(Number.isFinite)
      .sort((first, second) => first - second);
    const flightTopVoltage =
      sortedVoltage[Math.floor(sortedVoltage.length * 0.95)] ?? null;

    const sampleRateHz = dataset.sampleRateHz ?? 100;

    const preEventVoltage = (startIndex) => {
      const lookback = Math.round(sampleRateHz * 3);
      const from = Math.max(0, startIndex - lookback);
      const values = voltageVolts
        .slice(from, startIndex)
        .filter(Number.isFinite)
        .sort((first, second) => first - second);

      // A meaningful local baseline needs at least a second of
      // pre-event samples; otherwise fall back to the flight's
      // calm top end.
      if (values.length < sampleRateHz) {
        return {
          volts: flightTopVoltage,
          reference: "flight"
        };
      }

      return {
        volts: values[Math.floor(values.length / 2)],
        reference: "pre-event"
      };
    };

    const describedEvents = events.map((event) => {
      const output = windowStats(
        outputPercent,
        event.startIndex,
        event.endIndex
      );

      let saturatedCount = 0;
      let outputCount = 0;

      for (let i = event.startIndex; i <= event.endIndex; i += 1) {
        if (Number.isFinite(outputPercent[i])) {
          outputCount += 1;
          if (outputPercent[i] >= 97) {
            saturatedCount += 1;
          }
        }
      }

      const voltage = windowStats(
        voltageVolts,
        event.startIndex,
        event.endIndex
      );

      const baseline = preEventVoltage(event.startIndex);

      const sagPercent =
        Number.isFinite(baseline.volts) &&
        baseline.volts > 0 &&
        voltage
          ? ((baseline.volts - voltage.min) / baseline.volts) * 100
          : null;

      const watts = windowStats(
        wattValues,
        event.startIndex,
        event.endIndex
      );

      const eventCollective =
        collectiveAbs && collectiveFlightStats
          ? windowStats(
              collectiveAbs,
              event.startIndex,
              event.endIndex
            )
          : null;

      const explanation = explainLoadEvent({
        outputPeakPercent: output?.max ?? null,
        outputSaturatedShare:
          outputCount > 0 ? saturatedCount / outputCount : null,
        voltageSagPercent: sagPercent,
        collectiveDriven: isCollectiveDriven({
          eventPeakCollective: eventCollective?.max ?? null,
          flightPeakCollective: collectiveFlightStats?.peak ?? null,
          flightMedianCollective:
            collectiveFlightStats?.median ?? null
        })
      });

      return {
        event,
        output,
        voltage,
        baseline,
        sagPercent,
        watts,
        explanation
      };
    });

    const cell = (value, digits = 1, suffix = "") =>
      Number.isFinite(value)
        ? `${value.toFixed(digits)}${suffix}`
        : "—";

    // When the ranking runs on ESC output (no usable current), the
    // load figures ARE output percentages — printing them in amps
    // would invent current measurements the log never made, and the
    // watt figures built on that dead channel go with them.
    escEventsTable.innerHTML = `
      <tr>
        <th>When</th><th>Avg current</th><th>Peak current</th>
        <th>Peak output</th><th>Peak power</th><th>Sag under load</th><th>Reading</th>
      </tr>
      ${describedEvents
        .map(
          ({ event, output, voltage, baseline, sagPercent, watts, explanation }) => `
        <tr>
          <td>${event.startSeconds.toFixed(1)}–${event.endSeconds.toFixed(1)} s</td>
          <td>${currentCarriesData ? cell(event.averageLoad, 1, " A") : "—"}</td>
          <td>${currentCarriesData ? cell(event.peakLoad, 1, " A") : "—"}</td>
          <td>${cell(output?.max, 0, "%")}</td>
          <td>${currentCarriesData ? cell(watts?.max, 0, " W") : "—"}</td>
          <td>${
            Number.isFinite(sagPercent) &&
            Number.isFinite(baseline?.volts) &&
            Number.isFinite(voltage?.min)
              ? `${baseline.volts.toFixed(1)} → ${voltage.min.toFixed(1)} V (${sagPercent.toFixed(1)}%)`
              : "—"
          }</td>
          <td>${
            explanation.cause === "headroom-limit"
              ? "At the limit"
              : explanation.cause === "collective-load"
                ? "Collective load"
                : explanation.cause === "battery-sag"
                  ? "Battery sag"
                  : "Normal load"
          }</td>
        </tr>`
        )
        .join("")}
    `;

    escEventsStories.innerHTML = "";

    for (const { event, explanation } of describedEvents) {
      const story = document.createElement("p");
      story.className = "chart-hint";
      story.textContent = `${event.startSeconds.toFixed(1)}–${event.endSeconds.toFixed(1)} s: ${explanation.sentence}`;
      escEventsStories.appendChild(story);
    }

    // The biggest event gets the synchronized picture.
    const biggest = describedEvents.reduce((best, candidate) =>
      (candidate.event.averageLoad ?? 0) >
      (best.event.averageLoad ?? 0)
        ? candidate
        : best
    );

    const window = sliceWindow(
      dataset.timeSeconds,
      biggest.event.peakSeconds,
      3,
      3
    );

    if (!window) {
      const escWrap = el("escSticksWrap");
      if (escWrap) escWrap.hidden = true;
    }

    if (window) {
      const markers = [
        { x: biggest.event.peakSeconds, label: "peak load" }
      ];

      // The collective tells the load story better than any
      // sentence — pilot input at the peak, scrubbed by hover.
      mountStickInset({
        wrapId: "escSticksWrap",
        canvasId: "escSticks",
        chartElements: [
          chartLoadOutput,
          chartLoadCollective,
          chartLoadPower,
          chartLoadWatts,
          chartLoadTemp
        ],
        anchorTime: biggest.event.peakSeconds,
        playFrom: null
      });

      renderSyncedChart(
        chartLoadOutput,
        dataset,
        window,
        [
          {
            label: "ESC output (%)",
            values: outputPercent,
            color: CHART_COLORS[3]
          }
        ],
        { yLabel: "output (%)", markers, linkGroup: "loadSync" }
      );

      if (collectiveColumn) {
        renderSyncedChart(
          chartLoadCollective,
          dataset,
          window,
          [
            {
              patterns: [/^setpoint\[3\]$/i],
              label: "Collective target",
              color: CHART_COLORS[5]
            }
          ],
          { yLabel: "collective", markers, linkGroup: "loadSync" }
        );
      } else {
        chartLoadCollective.hidden = true;
      }

      // A dead current channel earns no trace and no watt chart —
      // the same capability state the table and the rest of ESC Lab
      // report. Voltage stands on its own.
      renderSyncedChart(
        chartLoadPower,
        dataset,
        window,
        [
          currentCarriesData && {
            label: "Current (A)",
            values: currentAmps,
            color: CHART_COLORS[1]
          },
          { label: "Voltage (V)", values: voltageVolts, color: CHART_COLORS[0] }
        ].filter(Boolean),
        {
          yLabel: currentCarriesData ? "amps · volts" : "volts",
          markers,
          linkGroup: "loadSync"
        }
      );

      chartLoadWatts.hidden = !currentCarriesData;

      if (currentCarriesData) {
        renderSyncedChart(
          chartLoadWatts,
          dataset,
          window,
          [
            {
              label: "Electrical power (W)",
              values: wattValues,
              color: CHART_COLORS[2]
            }
          ],
          { yLabel: "watts", markers, linkGroup: "loadSync" }
        );
      } else {
        chartLoadWatts.innerHTML = "";
      }

      if (temperatureEntries.length > 0) {
        renderSyncedChart(
          chartLoadTemp,
          dataset,
          window,
          temperatureEntries.map((entry) => ({
            ...entry,
            convert: toDegreesCelsius
          })),
          { yLabel: "°C", markers, linkGroup: "loadSync" }
        );
      } else {
        chartLoadTemp.hidden = true;
      }
    }
  }

  // ---- per-profile averages (stable flight only) ----
  const phase =
    dataset.headspeed && dataset.governorTarget
      ? detectStableFlightPhase({
          timeSeconds: dataset.timeSeconds,
          headspeed: dataset.headspeed,
          governorTarget: dataset.governorTarget
        })
      : null;

  const banks = phase
    ? groupByGovernorTarget({
        governorTarget: dataset.governorTarget,
        sampleIndexes: phase.stableIndexes ?? []
      })
    : [];

  if (banks.length === 0) {
    escProfileCard.hidden = true;
    return;
  }

  const averageAt = (values, indexes) => {
    let sum = 0;
    let count = 0;

    for (const index of indexes) {
      if (Number.isFinite(values[index])) {
        sum += values[index];
        count += 1;
      }
    }

    return count > 0 ? sum / count : null;
  };

  const maximumAt = (values, indexes) => {
    let max = null;

    for (const index of indexes) {
      if (
        Number.isFinite(values[index]) &&
        (max === null || values[index] > max)
      ) {
        max = values[index];
      }
    }

    return max;
  };

  const temperatureValues =
    temperatureEntries.length > 0
      ? toDegreesCelsius(
          dataset.columnValues(
            dataset.findColumnsIn(temperatureEntries[0].patterns)[0]
          )
        )
      : null;

  const profileCell = (value, digits = 1, suffix = "") =>
    Number.isFinite(value)
      ? `${value.toFixed(digits)}${suffix}`
      : "—";

  escProfileCard.hidden = false;
  escProfileTable.innerHTML = `
    <tr>
      <th>Bank</th><th>Avg output</th><th>Avg current</th>
      <th>Avg power</th><th>Max temp</th>
    </tr>
    ${banks
      .map(
        (bank) => `
      <tr>
        <td>${bank.targetRpm} rpm</td>
        <td>${profileCell(averageAt(outputPercent, bank.indexes), 1, "%")}</td>
        <td>${
          currentCarriesData
            ? profileCell(averageAt(currentAmps, bank.indexes), 1, " A")
            : "—"
        }</td>
        <td>${
          currentCarriesData
            ? profileCell(averageAt(wattValues, bank.indexes), 0, " W")
            : "—"
        }</td>
        <td>${
          temperatureValues
            ? profileCell(maximumAt(temperatureValues, bank.indexes), 0, " °C")
            : "—"
        }</td>
      </tr>`
      )
      .join("")}
  `;
}

function renderAllCharts(dataset) {
  if (!dataset) {
    for (const element of [
      chartGyro, chartTracking, chartTrackingPitch, chartTrackingYaw,
      chartFfRoll, chartFfPitch, chartFfYaw,
      chartTermsRoll, chartTermsPitch, chartTermsYaw,
      chartHeadspeed, chartThrottle, chartPower,
      chartSpectrum, chartGovernor, chartEsc, chartBattery
    ]) {
      element.innerHTML =
        '<p class="chart-empty">No plottable telemetry found in this log.</p>';
    }

    droopContextCard.hidden = true;
    loadEventsCard.hidden = true;
    escProfileCard.hidden = true;
    pidProfileCard.hidden = true;
    filterProfileCard.hidden = true;

    return;
  }

  renderSeriesChart(chartGyro, dataset, [/^gyroADC/i, /^gyroUnfilt/i, /^gyroRAW/i], {
    yLabel: "deg/s"
  });

  renderTuningPresets(dataset);

  renderSeriesChart(
    chartHeadspeed,
    dataset,
    [/headspeed/i, /^rpm/i, /governor/i],
    { yLabel: "rpm" }
  );

  renderScaledChart(
    chartThrottle,
    dataset,
    [
      { patterns: [/^motor\[0\]/i], label: "main motor %", convert: toThrottlePercent },
      { patterns: [/^motor\[1\]/i], label: "motor 2 %", convert: toThrottlePercent }
    ],
    "throttle (%)"
  );

  renderScaledChart(
    chartPower,
    dataset,
    [
      { patterns: [/^vbat/i], label: "pack voltage (V)", convert: toVolts },
      { patterns: [/amperage/i, /^Ibat/i, /current/i], label: "current (A)", convert: toAmps }
    ],
    "volts · amps"
  );

  {
    const governorColumns = dataset.findColumnsIn([
      /headspeed/i,
      /governorTarget/i,
      /govTarget/i
    ]).slice(0, 6);

    // Models on an ESC or external governor log rotor speed with
    // no target beside it. The chart then carries one trace, so it
    // says what it shows: rotor speed over time, and that droop —
    // which is measured against a target — is not on offer here.
    const hasTarget = dataset.columnPresence?.hasGovernorTarget;

    if (governorChartTitle) {
      governorChartTitle.textContent = hasTarget
        ? "Headspeed vs Target"
        : "Headspeed Over Time";
    }

    if (governorChartHint) {
      governorChartHint.textContent = hasTarget
        ? "Zoom into collective inputs: dips below the target line are droop."
        : "View rotor-speed stability throughout the flight. Governor target telemetry was not available, so tracking error and droop cannot be measured.";
    }

    if (governorColumns.length === 0) {
      chartGovernor.innerHTML =
        '<p class="chart-empty">This log has no data for this chart.</p>';
    } else {
      renderTimeSeriesChart(chartGovernor, {
        timeSeconds: decimate(dataset.timeSeconds),
        series: governorColumns.map((name, index) => ({
          label: name,
          values: decimate(dataset.columnValues(name)),
          color: CHART_COLORS[index % CHART_COLORS.length]
        })),
        yLabel: "rpm",
        markers: dataset.labs.governor
          ? [
              {
                x: dataset.labs.governor.droopTimeSeconds,
                label:
                  dataset.labs.governor.capability === "full"
                    ? "worst droop"
                    : "largest swing"
              }
            ]
          : []
      });
    }
  }

  renderScaledChart(
    chartEsc,
    dataset,
    [
      { patterns: [/^motor\[0\]/i], label: "main motor %", convert: toThrottlePercent },
      { patterns: [/^motor\[1\]/i], label: "motor 2 %", convert: toThrottlePercent }
    ],
    "throttle (%)"
  );

 renderScaledChart(
  chartBattery,
  dataset,
  [
    {
     patterns: dataset.voltagePatterns,
      label: "pack voltage (V)",
      convert: toVolts
    }
  ],
  "pack voltage (V)"
);

  if (dataset.spectra.length > 0) {
    renderSpectrumChart(chartSpectrum, dataset.spectra, {
      markers: dataset.markers
    });
  } else {
    chartSpectrum.innerHTML = `<p class="chart-empty">${
      dataset.spectraUnavailableReason === "no-stable-run"
        ? "No uninterrupted stable-flight stretch long enough for a spectrum window: the flight's stable phase was too fragmented. Gyro data itself is present; the verdict's peak numbers come from the filter analysis, which reads shorter windows."
        : dataset.spectraUnavailableReason === "no-rate"
          ? "The logging rate could not be determined, so the spectrum's frequency axis cannot be computed."
          : "No gyro data in this log for a spectrum."
    }</p>`;
  }

  renderGovernorEvidence(dataset);
  renderGovernorTechnical(dataset);
  renderEscEvidence(dataset);
}

// The latest quality-gate result, kept for the contribution
// payload so it never has to be recomputed.
let currentLogQuality = null;

function renderQuality(dataset, flightStats) {
  if (!dataset) {
    qualityCard.hidden = true;
    currentLogQuality = null;
    return;
  }

  const quality = assessLogQuality({
    sampleRateHz: dataset.sampleRateHz,
    durationSeconds:
      dataset.timeSeconds[dataset.timeSeconds.length - 1],
    corruptFrames: flightStats?.corruptFrames ?? 0,
    totalFrames: flightStats
      ? flightStats.intraFrames + flightStats.interFrames
      : 0,
    ...dataset.columnPresence
  });

  currentLogQuality = quality;

  qualityCard.hidden = false;
  qualitySummary.textContent = quality.summary;
  qualityChips.innerHTML = "";

  for (const capability of quality.capabilities) {
    const chip = document.createElement("div");
    chip.className = `quality-chip quality-${capability.level}`;
    chip.innerHTML = `
      <strong><span class="status-dot"></span>${capability.name}</strong>
      ${capability.note}
    `;
    qualityChips.appendChild(chip);
  }

  qualityWarnings.innerHTML = "";

  for (const warning of quality.warnings) {
    const warningElement = document.createElement("div");
    warningElement.className = "quality-warning";
    warningElement.textContent = warning;
    qualityWarnings.appendChild(warningElement);
  }
}

function renderFilterAdvisor(dataset) {
  const advice = dataset?.filterAdvice;

  if (!advice) {
    filterAdvisorCard.hidden = true;
    return;
  }

  filterAdvisorCard.hidden = false;
  filterAdvisorStory.textContent = advice.story;

  if (advice.rows.length > 0) {
    filterAdvisorTable.innerHTML = `
      <tr>
        <th>Peak</th><th>Likely source</th><th>Raw</th>
        <th>Filtered peak</th><th>Peak reduction</th>
      </tr>
      ${advice.rows
        .map(
          (row) => `
        <tr>
          <td>${row.hz} Hz</td>
          <td>${row.source}</td>
          <td>${row.magnitude}</td>
          <td>${row.filteredMagnitude ?? "—"}</td>
          <td>${row.reductionPercent !== null ? row.reductionPercent + "%" : "—"}</td>
        </tr>`
        )
        .join("")}
    `;
  } else {
    filterAdvisorTable.innerHTML = "";
  }

  filterAdvisorRecommendations.innerHTML = "";

  advice.recommendations.forEach((recommendation, index) => {
    const item = document.createElement("div");
    item.className = `advisor-recommendation priority-${recommendation.priority}`;
    item.innerHTML = `<span>${
      recommendation.priority === "first"
        ? "Do this first:"
        : recommendation.priority === "filters"
          ? "Filters:"
          : "Worth knowing:"
    }</span> ${recommendation.text}`;
    filterAdvisorRecommendations.appendChild(item);
  });
}

// ---- per-headspeed-profile breakdowns (PID & Filter Labs) ----
// Evidence only: the headline results and all scoring stay
// exactly as they are; these cards break the same flight down
// by governor bank.

function renderPidProfileBreakdown(pidAnalysis, lines) {
  const trackingProfiles =
    pidAnalysis?.detectedColumns?.trackingAnalysis
      ?.profileTrackingAnalysis ?? [];

  const usableProfiles = trackingProfiles.filter((profile) =>
    Number.isFinite(profile.averageTrackingError)
  );

  if (usableProfiles.length < 2) {
    pidProfileCard.hidden = true;
    return;
  }

  const analysisContext = pidAnalysis.analysisContext ?? {};

  // The adapter's header line may quote column names — accept
  // both, like the PID analysis itself does.
  const gyroColumns = (analysisContext.telemetry?.allColumns ?? [])
    .filter((name) =>
      /^"?gyroADC\[[0-2]\]"?$/i.test(String(name).trim())
    )
    .sort();

  const responseProfiles = analyzeProfileResponse({
    lines,
    telemetryHeaderIndex:
      analysisContext.flight?.telemetryHeaderIndex,
    headspeedProfiles:
      analysisContext.flight?.headspeedProfiles ?? [],
    setpointColumns:
      pidAnalysis.detectedColumns?.axisSetpoint ?? [],
    gyroColumns
  });

  const responseByRpm = new Map(
    responseProfiles.map((profile) => [profile.targetRpm, profile])
  );

  const numberCell = (value, digits = 1, suffix = "") =>
    Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";

  pidProfileCard.hidden = false;
  pidProfileTable.innerHTML = `
    <tr>
      <th>Bank</th><th>Axis</th><th>Avg tracking error</th>
      <th>Overshoot rate</th><th>Peak overshoot</th>
    </tr>
    ${usableProfiles
      .map((profile) => {
        const response = responseByRpm.get(profile.targetRpm);

        return (profile.axisResults ?? [])
          .map((axisResult, axisIndex) => {
            const axisResponse = response?.axisResults?.find(
              (candidate) => candidate.axis === axisResult.axis
            );

            return `
        <tr>
          <td>${axisIndex === 0 ? `${profile.targetRpm} rpm` : ""}</td>
          <td>${axisResult.axis}</td>
          <td>${numberCell(axisResult.averageAbsoluteError, 2)}</td>
          <td>${numberCell(axisResponse?.exceedanceRatePercent, 1, "%")}</td>
          <td>${numberCell(axisResponse?.peakExceedancePercent, 0, "%")}</td>
        </tr>`;
          })
          .join("");
      })
      .join("")}
  `;

  const best = usableProfiles.reduce((a, b) =>
    a.averageTrackingError <= b.averageTrackingError ? a : b
  );
  const worst = usableProfiles.reduce((a, b) =>
    a.averageTrackingError >= b.averageTrackingError ? a : b
  );

  // Ranking is a claim the evidence must carry: the same
  // under-sampling bar the Technical PID Analysis applies (a thin
  // bank cannot be crowned) governs this sentence too — one
  // qualification standard on every surface (#33).
  const largestSampleCount = usableProfiles.reduce(
    (max, profile) => Math.max(max, profile.sampleCount ?? 0),
    0
  );
  const underSampled = (profile) =>
    (profile.sampleCount ?? 0) < 5000 ||
    (profile.sampleCount ?? 0) * 20 < largestSampleCount;

  pidProfileNote.textContent =
    best.targetRpm === worst.targetRpm
      ? ""
      : underSampled(best) || underSampled(worst)
        ? `${best.targetRpm} rpm showed the lowest observed tracking error, but the headspeeds carry very different amounts of evidence — collect more flight time at the thin one before deciding which tracks best. Overshoot rate = share of commanded samples where the response exceeded the target beyond a small deadband.`
        : `${best.targetRpm} rpm tracked best overall; ${worst.targetRpm} rpm tracked worst. Overshoot rate = share of commanded samples where the response exceeded the target beyond a small deadband.`;
}

function renderFilterProfileBreakdown(dataset) {
  const banks = dataset?.perBankFilter ?? [];

  if (banks.length < 2) {
    filterProfileCard.hidden = true;
    return;
  }

  filterProfileCard.hidden = false;
  filterProfileBlocks.innerHTML = "";

  for (const bank of banks) {
    const heading = document.createElement("h4");
    heading.textContent = bank.insufficient
      ? `${bank.targetRpm} rpm bank`
      : `${bank.targetRpm} rpm bank (flown at ~${bank.actualRpm} rpm)`;
    filterProfileBlocks.appendChild(heading);

    if (bank.insufficient) {
      const note = document.createElement("p");
      note.className = "chart-hint";
      note.textContent =
        "Not enough continuous stable time at this headspeed for a spectrum. Fly a longer steady stretch in this bank to analyze it.";
      filterProfileBlocks.appendChild(note);
      continue;
    }

    const chartElement = document.createElement("div");
    chartElement.className = "chart-container";
    filterProfileBlocks.appendChild(chartElement);

    renderSpectrumChart(chartElement, bank.spectra, {
      height: 220,
      markers: buildSpectrumMarkers(bank.spectra, bank.actualRpm)
    });

    const advice = bank.advice;

    if (advice && advice.rows.length > 0) {
      const table = document.createElement("table");
      table.className = "history-table";
      table.innerHTML = `
        <tr>
          <th>Peak</th><th>Likely source</th>
          <th>Peak reduction</th>
        </tr>
        ${advice.rows
          .map(
            (row) => `
          <tr>
            <td>${row.hz} Hz</td>
            <td>${row.source}</td>
            <td>${
              row.reductionPercent !== null
                ? row.reductionPercent + "%"
                : "—"
            }</td>
          </tr>`
          )
          .join("")}
      `;

      const scroll = document.createElement("div");
      scroll.className = "table-scroll";
      scroll.appendChild(table);
      filterProfileBlocks.appendChild(scroll);
    }

    for (const recommendation of advice?.recommendations ?? []) {
      if (recommendation.priority !== "filters") {
        continue;
      }

      const item = document.createElement("div");
      item.className =
        "advisor-recommendation priority-filters";
      item.innerHTML = `<span>Filters:</span> ${recommendation.text}`;
      filterProfileBlocks.appendChild(item);
    }
  }
}

// ======================================================
// 06. ANALYSIS + SCREEN UPDATE
// ======================================================

let currentDataset = null;
let currentFlightLines = null;
let currentFlightSummary = "";
// Kept for the exported report: the report's Lab Details must carry
// the same Filter/PID conclusions the app shows, not just the labs
// that happen to share the lab result shape.
let currentFilterAnalysisResult = null;
let currentPidAnalysisResult = null;

function analyzeFlight(flightIndex) {
  const flight = loadedLog.flights[flightIndex];
  const { file, sizeKb, fileType } = loadedLog;
  const lines = flight.lines;
  currentFlightLines = lines;

  // A file holding several flights should never leave any doubt
  // about which one the verdict describes.
  currentFlightSummary =
    loadedLog.flights.length > 1
      ? `${flight.label} of ${loadedLog.flights.length}`
      : "";

  decodeInfo.textContent = flight.decodeInfo
    ? `Binary .bbl decoded natively: ${flight.decodeInfo}`
    : fileType;

  const {
    extraSummary,
    telemetryText,
    filterAnalysis,
    pidAnalysis
  } = buildLogAnalysis({
    fileType,
    lines,
    aircraftProfiles
  });

  updateScreen({
    telemetryText,
    file,
    sizeKb,
    lines,
    extraSummary,
    telemetryColumns,
    filterAnalysis,
    pidAnalysis,
    fileStatus,
    summaryFileName,
    summaryFileSize,
    summaryStatus,
    filterAnalysisStatus,
    filterAnalysisScore,
    filterAnalysisConfidence,
    filterAnalysisFindings,
    filterAnalysisRecommendations,
    pidAnalysisStatus,
    pidAnalysisScore,
    pidAnalysisConfidence,
    pidAnalysisFindings,
    pidAnalysisRecommendations,
    rawPreview
  });

  currentFilterAnalysisResult = filterAnalysis ?? null;
  currentPidAnalysisResult = pidAnalysis ?? null;

  currentDataset = buildDataset(lines, pidAnalysis);
  currentPilotInput = currentDataset
    ? readPilotInput(currentDataset)
    : null;

  renderFlightEvents(currentDataset?.flightEvents ?? null);
  renderServoLimits(currentDataset?.servoLimits ?? null);
  renderSignalLab(currentDataset);
  renderBecLab(currentDataset);

  renderVerdict(currentDataset);
  renderQuality(currentDataset, flight.stats);
  renderFilterAdvisor(currentDataset);
  renderAllCharts(currentDataset);
  setupReplay(currentDataset, currentPilotInput, currentFlightEvents);
  renderPidProfileBreakdown(pidAnalysis, lines);
  renderFilterProfileBreakdown(currentDataset);

  renderLab(
    currentDataset?.labs.governor,
    governorStory,
    governorMetrics,
    "Headspeed data is present, but governor-target telemetry is unavailable. Rotor-speed can still be viewed, but governor tracking and droop cannot be scored."
  );
  renderGovernorEvents(currentDataset);
  renderGovernorSettings(currentDataset);
  renderPrecompBalance(currentDataset);

  // One page, one story: when the flight produced excursions, the
  // verdict sentence carries their summary too — "excellent hold"
  // must never sit silently above an event strip that disagrees.
  if (
    currentDataset?.governorEvents?.summary?.total > 0 &&
    governorStory
  ) {
    governorStory.textContent += ` ${currentDataset.governorEvents.summary.sentence}`;
  }

  // "What to try next": the recommendation engine reads what the
  // analyses measured; the vibration precedence comes from the same
  // verdict card the pilot sees.
  const nextSteps = buildRecommendations({
    trackingAnalysis: pidAnalysis?.detectedColumns?.trackingAnalysis,
    commandBalanceReviewAxes:
      pidAnalysis?.technicalSummary?.commandBalanceReviewAxes ?? [],
    responseBehavior: pidAnalysis?.responseBehavior ?? null,
    timeSeconds: currentDataset?.timeSeconds,
    governorEvents: currentDataset?.governorEvents,
    precomp: currentDataset?.precomp,
    vibrationConcern: Boolean(
      currentDataset?.verdict?.cards?.some(
        (card) =>
          card.key === "vibration" && card.status === "attention"
      )
    )
  });
  currentRecommendations = nextSteps;
  renderFirstSteps(currentDataset, nextSteps, pidAnalysis);
  {
    const rawCraft = getMetadataValue(currentFlightLines, "Craft name");
    const axisEvidence = {};
    for (const axisResult of pidAnalysis?.detectedColumns?.trackingAnalysis
      ?.commandEvents ?? []) {
      axisEvidence[axisResult.axis] = (axisResult.events ?? []).filter(
        (event) => Number.isFinite(event.responsePeak)
      ).length;
    }
    renderPackCard(
      currentDataset,
      nextSteps,
      getMetadataValue(currentFlightLines, "Firmware revision"),
      {
        craftKey: rawCraft === "Not found" ? "Unknown craft" : rawCraft,
        sourceHash: hashFlightLines(currentFlightLines),
        dateMs: resolveFlightDateMs(currentFlightLines, file.lastModified),
        isSample: file.name.startsWith("sample-"),
        axisEvidence
      }
    );
  }
  renderNextSteps("pidNextCard", "pidNextList", nextSteps.pid);
  renderNextSteps(
    "governorNextCard",
    "governorNextList",
    nextSteps.governor
  );
  renderLab(
    currentDataset?.labs.esc,
    escStory,
    escMetrics,
    "This log has no motor data to analyze."
  );
  renderLab(
    currentDataset?.labs.battery,
    batteryStory,
    batteryMetrics,
    "This log has no voltage data to analyze."
  );

  buildReportButton.disabled = !currentDataset;
  reportStatus.textContent = currentDataset
    ? "Ready: the report includes whatever the Labs found."
    : "Open a log first.";

  // ---- file this flight in the craft's health record ----
  const rawCraftName = getMetadataValue(currentFlightLines, "Craft name");
  const craftKeyName =
    rawCraftName === "Not found" ? "Unknown craft" : rawCraftName;

  // Remembered so a settings dump opened afterwards knows which
  // helicopter it belongs to.
  currentCraftName = craftKeyName;

  if (currentDataset) {
    const craftName = rawCraftName;

    const entry = buildHistoryEntry({
      fileName: file.name,
      // The selected flight's own lines, so each flight of a
      // multi-flight file carries its own identity.
      sourceHash: hashFlightLines(currentFlightLines),
      flightDateMs: resolveFlightDateMs(
        currentFlightLines,
        file.lastModified
      ),
      durationSeconds:
        currentDataset.timeSeconds[currentDataset.timeSeconds.length - 1],
   dataset: {
  ...currentDataset,
  pidScore: Number.isFinite(
    Number.parseFloat(pidAnalysis?.score)
  )
    ? Number.parseFloat(pidAnalysis.score)
    : currentDataset.pidScore
}
});

    const craftKey = recordFlight(
      localStorage,
      craftName === "Not found" ? "Unknown craft" : craftName,
      entry
    );

    refreshHistoryScreen(craftKey);

    // First analysis of a new craft: offer the craft card,
    // pre-filled from the log. Local model info first,
    // contribution metadata second — independent of sharing.
    // Bundled sample flights are not the pilot's craft, so
    // they never prompt for one.
    if (!file.name.startsWith("sample-")) {
      maybeAskCraftCard(craftKey);
    }
    // The passive unlock card shows for samples too — trying
    // the sample is how many pilots first meet the app, and the
    // card is how they discover the unlock. Only the modal ask
    // stays sample-suppressed.
    setUnlockCraft(craftKey, false);
  }

  refreshCompareButtons();
  compareResultCard.hidden = true;
  compareChartCard.hidden = true;

  // ---- community data sharing (opt-in, anonymized) ----
  // Text exports carry no decoded flight, so they skip this
  // and sharing stays native-.bbl only.
  if (flight.decoded) {
    // Bundled sample flights are shipped data — everyone has
    // them, so contributing them would only fill the community
    // bucket with identical copies.
    if (!file.name.startsWith("sample-")) {
      maybeContributeFlight(flight.decoded, fileType, `${file.name}#${flightIndex}`, {
        dataset: currentDataset,
        pidAnalysis,
        logQuality: currentLogQuality,
        craftName: craftKeyName
      });
    }
  }

  // Land the pilot on the answers, not the data — unless the
  // load-progress dialog is up: then the jump is the pilot's
  // choice ("Go to the overview" vs "Stay on this page").
  if (loadProgress.hidden) {
    navigation.showScreen("home");
    document.querySelector(".workspace").scrollTop = 0;
  }
}

// ======================================================
// 07. REPORT BUILDER
// ======================================================

// The exported report's Lab Details renderer expects the lab shape
// ({status, story, metrics}). Filter and PID analyses carry richer
// shapes of their own — these adapters translate them so the report
// tells the same story as the app: score, confidence, Review
// conditions and the gated top recommendation all survive export.
function pidLabForReport(analysis) {
  if (!analysis || !Array.isArray(analysis.summary)) return null;

  const recommendations = analysis.recommendations ?? [];

  // The report is what gets handed to another pilot or tuner: a
  // Review status whose evidence stayed behind in the app cannot be
  // audited by whoever receives it. The response-behavior checks
  // (bounce-back, settling, ringing) therefore export WITH their
  // evidence counts — and when the evidence is too thin to earn a
  // tuning change, the report says what to fly next instead of
  // stopping at "worth reviewing".
  const behaviorReviews = (analysis.responseBehavior ?? []).filter(
    (checkResult) => checkResult.status === "Review"
  );

  // An axis under Review exports its WHOLE response story: the
  // sibling checks with real events ride along even below Review —
  // an intermittent pattern (one bounce-back, one slow settle, one
  // clean response) reads differently from a consistent fault, and
  // the report's recipient deserves that distinction (#36).
  const reviewAxes = new Set(behaviorReviews.map((c) => c.axis));
  const behaviorCompanions = (analysis.responseBehavior ?? []).filter(
    (checkResult) =>
      checkResult.status !== "Review" &&
      reviewAxes.has(checkResult.axis) &&
      checkResult.evidence &&
      !/^0 valid/.test(checkResult.evidence)
  );

  const describeCheck = (checkResult, flagged) =>
    `${checkResult.axis} ${checkResult.check}${
      flagged ? " flagged for review" : ` (${checkResult.status})`
    }` +
    (checkResult.evidence ? ` (${checkResult.evidence}` : "") +
    (checkResult.evidence && checkResult.stat
      ? `, ${checkResult.check === "settling" ? "median " : ""}${checkResult.stat}`
      : "") +
    (checkResult.evidence && checkResult.confidence
      ? `, ${checkResult.confidence} confidence)`
      : checkResult.evidence
        ? ")"
        : "") +
    (flagged && checkResult.recommendation
      ? `: ${checkResult.recommendation}`
      : ".");

  const behaviorStory = [
    ...behaviorReviews.map((c) => describeCheck(c, true)),
    ...behaviorCompanions.map((c) => describeCheck(c, false))
  ].join(" ");

  const reviewedAxisList = [...reviewAxes];

  const nextFlightStep =
    reviewedAxisList.length > 0
      ? `Repeat several deliberate ${reviewedAxisList.join(
          " and "
        )} inputs with clean stops and reversals at the same headspeed. If the same response pattern returns, those confirmed events determine the tuning change — this flight alone does not earn one.`
      : null;

  return {
    status:
      analysis.overallStatus === "Clear"
        ? "good"
        : analysis.overallStatus === "Review"
          ? "watch"
          : "insufficient",
    story: [analysis.summary.join(" "), behaviorStory]
      .filter(Boolean)
      .join(" "),
    metrics: [
      Number.isFinite(analysis.score) && {
        label: "Tracking score",
        value: `${analysis.score}/100`
      },
      analysis.confidence?.level && {
        label: "Confidence",
        value:
          `${analysis.confidence.level}` +
          (analysis.confidence.demand === "gentle"
            ? ": gentle flight demand"
            : "")
      },
      { label: "Overall status", value: analysis.overallStatus ?? "—" },
      behaviorReviews.length > 0 && {
        label: "Response behavior",
        value: behaviorReviews
          .map(
            (checkResult) =>
              `${checkResult.axis} ${checkResult.check}: Review` +
              (checkResult.evidence ? ` (${checkResult.evidence})` : "")
          )
          .join("; ")
      },
      nextFlightStep && {
        label: "Next flight",
        value: nextFlightStep
      },
      recommendations.length > 0 && {
        label: "Top recommendation",
        value:
          recommendations[0] +
          (recommendations.length > 1
            ? ` (+${recommendations.length - 1} more in the app)`
            : "")
      }
    ].filter(Boolean)
  };
}

function filterLabForReport(analysis) {
  if (!analysis) return null;

  const recommendations = analysis.recommendations ?? [];

  return {
    status: !Number.isFinite(analysis.score)
      ? "insufficient"
      : analysis.severity === "info"
        ? "good"
        : "watch",
    story:
      (analysis.summaryFindings ?? []).join(" ") ||
      String(analysis.status ?? ""),
    metrics: [
      Number.isFinite(analysis.score) && {
        label: "Filter score",
        value: `${analysis.score}/100`
      },
      analysis.confidence?.label && {
        label: "Confidence",
        value: `${analysis.confidence.label} (${analysis.confidence.score}/100)`
      },
      { label: "Status", value: String(analysis.status ?? "—") },
      recommendations.length > 0 && {
        label: "Key recommendation",
        value:
          recommendations[0] +
          (recommendations.length > 1
            ? ` (+${recommendations.length - 1} more in the app)`
            : "")
      }
    ].filter(Boolean)
  };
}

buildReportButton.addEventListener("click", () => {
  if (!currentDataset || !currentFlightLines) {
    return;
  }

  const craftName = getMetadataValue(currentFlightLines, "Craft name");
  const firmware = getMetadataValue(currentFlightLines, "firmware");
  const duration =
    currentDataset.timeSeconds[currentDataset.timeSeconds.length - 1];

  const html = buildReportHtml({
    fileName: summaryFileName.textContent,
    craftName: craftName === "Not found" ? null : craftName,
    firmware: firmware === "Not found" ? null : firmware,
    durationSeconds: duration,
    verdict: currentDataset.verdict,
    quality: currentLogQuality,
    recommendations: currentRecommendations,
    governorEvents: currentDataset.governorEvents,
    precomp: currentDataset.precomp,
    labs: [
      { title: "Filter Lab", analysis: filterLabForReport(currentFilterAnalysisResult) },
      { title: "PID Lab", analysis: pidLabForReport(currentPidAnalysisResult) },
      { title: "Governor Lab", analysis: currentDataset.labs.governor },
      { title: "ESC Lab", analysis: currentDataset.labs.esc },
      { title: "Battery Lab", analysis: currentDataset.labs.battery },
      { title: "Signal Lab", analysis: currentDataset.signalLab },
      { title: "BEC Lab", analysis: currentDataset.becLab }
    ],
    chartElements: [
      { title: "Noise Spectrum", element: chartSpectrum },
      { title: "Gyro", element: chartGyro },
      { title: "Roll: Target vs Gyro", element: chartTracking },
      { title: "Pitch: Target vs Gyro", element: chartTrackingPitch },
      { title: "Yaw: Target vs Gyro", element: chartTrackingYaw },
      { title: "Headspeed & Governor", element: chartGovernor },
      { title: "Throttle", element: chartThrottle },
      { title: "Battery & Current", element: chartPower }
    ]
  });

  const baseName = (summaryFileName.textContent || "flight")
    .replace(/\.[^.]+$/, "");

  downloadReport(html, `blackbox-lab-report-${baseName}.html`);
  reportStatus.textContent =
    "Report saved: check your downloads folder.";
});


// ======================================================
// 08. COMPARE FLIGHTS (before vs after)
// ======================================================

function strongestSpectrumOf(dataset) {
  if (!dataset || dataset.spectra.length === 0) {
    return null;
  }

  let strongest = dataset.spectra[0];

  for (const entry of dataset.spectra) {
    if (
      spectrumPeakValue(entry.spectrum) >
      spectrumPeakValue(strongest.spectrum)
    ) {
      strongest = entry;
    }
  }

  return strongest.spectrum;
}

// The loaded "after" log. Kept around so the flight picker
// can re-compare against any flight in the file without
// re-reading it; datasets build lazily, once per flight.
let comparisonLog = null;

function datasetForComparisonFlight(flightIndex) {
  const { logData, datasets } = comparisonLog;

  if (!datasets.has(flightIndex)) {
    const flight = logData.flights[flightIndex];
    const lines = flight.lines;

    const { pidAnalysis } = buildLogAnalysis({
      fileType: logData.fileType,
      lines,
      aircraftProfiles
    });

    const name =
      logData.flights.length > 1
        ? `${logData.file.name}, ${flight.label}`
        : logData.file.name;

    datasets.set(flightIndex, {
      dataset: buildDataset(lines, pidAnalysis),
      name,
      setup: extractComparableSetup(lines)
    });
  }

  return datasets.get(flightIndex);
}

// Load a file as the "after" side of the comparison. An
// "all flights" download holds several flights: the picker
// appears, preselected on the longest flight (the choice
// the app used to make silently), and switching it
// re-compares against that flight — so two flights of the
// SAME file can be compared without splitting the file.
async function loadComparisonFile(file) {
  const logData = await readLogFile(file);

  if (!logData || logData.flights.length === 0) {
    comparisonLog = null;
    compareFlightPicker.hidden = true;
    return null;
  }

  comparisonLog = { logData, datasets: new Map() };

  const defaultIndex = longestFlightIndex(logData.flights);

  compareFlightSelect.innerHTML = "";
  logData.flights.forEach((flight, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = flight.label;
    compareFlightSelect.appendChild(option);
  });
  compareFlightSelect.value = String(defaultIndex);
  compareFlightPicker.hidden = logData.flights.length < 2;

  return datasetForComparisonFlight(defaultIndex);
}

function refreshCompareButtons() {
  const ready = Boolean(currentDataset);
  compareOpenButton.disabled = !ready;
  compareSampleButton.disabled = !ready || !window.blackboxLab;

  compareBaselineInfo.textContent = ready
    ? `Before: ${summaryFileName.textContent}`
    : 'No baseline yet: open a log first (Home screen).';
}

// Which side plays "Before" is decided by the logs' own clocks
// when both are trustworthy: an unsynced FC logs year-2000 stamps,
// and those never decide anything. The pilot can overrule with the
// swap control; a fresh comparison re-derives the automatic choice.
let compareSwapped = false;
let lastComparison = null;

function renderComparison(comparisonDataset, comparisonName, opts = {}) {
  if (!currentDataset || !comparisonDataset) {
    return;
  }

  const comparisonSetup = opts.setup ?? lastComparison?.setup ?? null;
  const currentSetup = extractComparableSetup(currentFlightLines);
  lastComparison = {
    dataset: comparisonDataset,
    name: comparisonName,
    setup: comparisonSetup
  };

  if (opts.autoOrder !== false) {
    // "keep": the open log started earlier, so it stays Before.
    // "swap": the open log started later, so it becomes After.
    const order = chronologicalOrder(
      currentSetup?.startIso,
      comparisonSetup?.startIso
    );
    compareSwapped = order === "swap";
  }

  const openIdentity =
    summaryFileName.textContent +
    (currentFlightSummary ? `, ${currentFlightSummary}` : "");

  const beforeSide = compareSwapped
    ? { dataset: comparisonDataset, name: comparisonName, setup: comparisonSetup }
    : { dataset: currentDataset, name: openIdentity, setup: currentSetup };
  const afterSide = compareSwapped
    ? { dataset: currentDataset, name: openIdentity, setup: currentSetup }
    : { dataset: comparisonDataset, name: comparisonName, setup: comparisonSetup };

  const result = compareFlights(beforeSide.dataset, afterSide.dataset, {
    setupDiff: diffSetups(beforeSide.setup, afterSide.setup)
  });

  compareResultCard.hidden = false;
  const pairText =
    `Before: ${beforeSide.name} · After: ${afterSide.name}` +
    (compareSwapped ? " (ordered by the logs' own start times)" : "");
  if (comparePairInfo) {
    comparePairInfo.textContent = pairText;
  }
  compareBaselineInfo.textContent = pairText;
  if (compareSwapButton) {
    compareSwapButton.hidden = false;
  }
  // The footing first (#32): what the comparison stands on — demand
  // match, per-axis evidence, flight balance — shown BEFORE any
  // improvement wording, open by default whenever it is not clean.
  {
    const fold = el("compareComparability");
    if (fold) {
      const comparability = result.comparability;
      const show = Boolean(comparability?.lines?.length);
      fold.hidden = !show;
      if (show) {
        el("compareComparabilityHead").textContent =
          comparability.level === "comparable"
            ? "Comparability: good — these flights can carry a verdict"
            : comparability.level === "partial"
              ? "Comparability: partial — read the results as observations"
              : "Comparability: weak — these flights measured different things";
        el("compareComparabilityLines").innerHTML =
          comparability.lines
            .map((line) => `<p class="chart-hint">${line}</p>`)
            .join("") +
          (comparability.guidance
            ? `<p class="chart-hint"><b>${comparability.guidance}</b></p>`
            : "");
        fold.open = comparability.level !== "comparable";
      }
    }
  }

  compareSummary.textContent = result.summary;
  compareRows.innerHTML = "";

  for (const row of result.rows) {
    const rowElement = document.createElement("div");
    rowElement.className = `compare-row direction-${row.direction}`;
    rowElement.innerHTML = `
      <div class="compare-row-top">
        <span class="compare-row-title">${row.title}</span>
        <span class="compare-row-delta">${
          row.direction === "better"
            ? "improved"
            : row.direction === "worse"
              ? "got worse"
              : row.direction === "unknown"
                ? "not comparable"
                : "unchanged"
        }</span>
      </div>
      <div class="compare-row-sentence">${row.sentence}</div>
      <div class="compare-row-values">before: ${row.before} · after: ${row.after}</div>
    `;
    compareRows.appendChild(rowElement);
  }

  const beforeSpectrum = strongestSpectrumOf(currentDataset);
  const afterSpectrum = strongestSpectrumOf(comparisonDataset);

  if (beforeSpectrum && afterSpectrum) {
    compareChartCard.hidden = false;

    // The comparability ruling the result cards just made governs
    // this caption too: once the page has said "two different
    // machines", no corner of it may imply that a smaller peak on
    // the other machine means progress.
    const chartHint = el("compareChartHint");
    if (chartHint) {
      chartHint.textContent = result.sameAircraft
        ? "Two flights, one picture. Shrinking peaks = progress."
        : "Two machines, shown side by side for reference: their spectra are not directly comparable.";
    }
    renderSpectrumChart(chartCompareSpectrum, [
      {
        label: `Before (${summaryFileName.textContent})`,
        spectrum: beforeSpectrum,
        color: CHART_COLORS[1]
      },
      {
        label: `After (${comparisonName})`,
        spectrum: afterSpectrum,
        color: CHART_COLORS[0]
      }
    ]);
  }
}

const compareSwapButton = el("compareSwapButton");

if (compareSwapButton) {
  compareSwapButton.addEventListener("click", () => {
    if (!lastComparison) return;
    compareSwapped = !compareSwapped;
    renderComparison(lastComparison.dataset, lastComparison.name, {
      autoOrder: false,
      setup: lastComparison.setup
    });
  });
}

compareOpenButton.addEventListener("click", () => {
  compareFileInput.click();
});

compareFileInput.addEventListener("change", async () => {
  const file = compareFileInput.files[0];

  if (!file) {
    return;
  }

  try {
    const result = await loadComparisonFile(file);

    if (result && result.dataset) {
      renderComparison(result.dataset, result.name, { setup: result.setup });
    } else {
      compareBaselineInfo.textContent =
        "Could not read flight data from the comparison log.";
    }
  } catch (error) {
    compareBaselineInfo.textContent =
      "Something went wrong: " + error.message;
  }

  compareFileInput.value = "";
});

// Switching the picker re-compares on the spot — flipping
// between two flights of one file is the whole point.
compareFlightSelect.addEventListener("change", () => {
  if (!comparisonLog) {
    return;
  }

  const result = datasetForComparisonFlight(
    Number(compareFlightSelect.value)
  );
  renderComparison(result.dataset, result.name, { setup: result.setup });
});

compareSampleButton.addEventListener("click", async () => {
  const bytes = await window.blackboxLab.readSampleLog(
    "sample-clean-tuned.bbl"
  );

  if (!bytes) {
    return;
  }

  const file = new File(
    [new Uint8Array(bytes)],
    "sample-clean-tuned.bbl"
  );

  const result = await loadComparisonFile(file);

  if (result && result.dataset) {
    renderComparison(result.dataset, result.name, { setup: result.setup });
  }
});

// ======================================================
// 09. HEALTH RECORD (per-craft history)
// ======================================================

// Records written by earlier builds may already hold the same
// flight twice; fold those once, before the record is first shown.
migrateHistory(localStorage);

function refreshHistoryScreen(selectedCraft) {
  const history = loadHistory(localStorage);
  const craftNames = Object.keys(history).sort();

  historyCraftSelect.innerHTML = "";

  if (craftNames.length === 0) {
    historyNote.textContent =
      "No flights recorded yet: every log you open is filed here automatically.";
    historyFindings.innerHTML = "";
    historyTrendCard.hidden = true;
    historyTableCard.hidden = true;
    return;
  }

  for (const name of craftNames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} (${history[name].length} flights)`;
    historyCraftSelect.appendChild(option);
  }

  const craft =
    selectedCraft && history[selectedCraft]
      ? selectedCraft
      : craftNames[0];
  historyCraftSelect.value = craft;

  const entries = history[craft];
  const trends = assessTrends(entries);

  historyNote.textContent = trends.note;
  historyFindings.innerHTML = "";

  for (const finding of trends.findings) {
    const findingElement = document.createElement("div");
    findingElement.className = "verdict-item status-attention";
    findingElement.innerHTML = `
      <div class="verdict-item-top">
        <span class="status-dot"></span>
        <span class="verdict-item-title">Trend</span>
        <span class="verdict-item-status">Needs attention</span>
      </div>
      <div class="verdict-item-detail">${finding.sentence}</div>
    `;
    historyFindings.appendChild(findingElement);
  }

  // ---- trend charts (x = flight number) ----
  const flightNumbers = entries.map((entry, index) => index + 1);

  const trendChart = (element, key, yLabel) => {
    const values = entries.map((entry) =>
      Number.isFinite(entry[key]) ? entry[key] : null
    );

    if (values.filter((value) => value !== null).length < 2) {
      element.innerHTML =
        '<p class="chart-empty">Not enough flights yet for a trend.</p>';
      return;
    }

    renderTimeSeriesChart(element, {
      timeSeconds: flightNumbers,
      series: [{ label: yLabel, values }],
      yLabel,
      xLabel: "Flight #",
      height: 200,
      formatX: (value) => `Flight ${Math.round(value)}`
    });
  };

  historyTrendCard.hidden = false;
  trendChart(chartTrendVibration, "vibrationPeak", "vibration peak");

  // Title, hint and axis follow what these flights measured:
  // target-relative droop only when every charted flight had a
  // logged governor target, rotor-speed stability otherwise.
  const rotorWording = rotorTrendWording(entries);
  const trendDroopTitle = el("trendDroopTitle");
  const trendDroopHint = el("trendDroopHint");
  if (trendDroopTitle) trendDroopTitle.textContent = rotorWording.title;
  if (trendDroopHint) trendDroopHint.textContent = rotorWording.hint;
  trendChart(
    chartTrendDroop,
    "droopRpm",
    rotorWording.label === "Governor droop"
      ? "worst droop (rpm)"
      : "largest RPM deviation"
  );

  // ---- flights table ----
  historyTableCard.hidden = false;

  const cell = (value, suffix = "") =>
    value === null || value === undefined ? "—" : `${value}${suffix}`;

  historyTable.innerHTML = `
    <tr>
      <th>Date</th><th>Log</th><th>Length</th><th>Vibration</th>
      <th>RPM dev.</th><th>Tracking</th><th>Sag</th><th>IR est.</th><th></th>
    </tr>
    ${entries
      .map(
        (entry, index) => `
      <tr>
        <td>${
          isPlausibleFlightDate(entry.flightDateMs)
            ? new Date(entry.flightDateMs).toLocaleDateString()
            : "Date unavailable"
        }</td>
        <td>${entry.fileName}</td>
        <td>${cell(entry.durationSeconds, " s")}</td>
        <td>${cell(entry.vibrationPeak)}${entry.vibrationHz ? ` @ ${entry.vibrationHz} Hz` : ""}</td>
        <td>${cell(entry.droopRpm, " rpm")}</td>
        <td>${cell(entry.trackingScore, "/100")}</td>
        <td>${cell(entry.batterySagPercent, "%")}</td>
        <td>${cell(entry.internalResistance, " mΩ")}</td>
        <td><button class="history-remove" data-index="${index}"
          title="Remove this flight from the record">✕</button></td>
      </tr>`
      )
      .join("")}
  `;
}

// The table is rebuilt on every refresh, so one delegated
// listener outlives all the rows it serves. Rows are looked up
// by index at click time — the table and storage can't drift
// apart because every write triggers a refresh.
historyTable.addEventListener("click", (event) => {
  const button = event.target.closest(".history-remove");

  if (!button) {
    return;
  }

  const craft = historyCraftSelect.value;
  const entries = loadHistory(localStorage)[craft] ?? [];
  const entry = entries[Number(button.dataset.index)];

  if (!entry) {
    return;
  }

  if (
    confirm(
      `Remove "${entry.fileName}" from the health record? Trends recompute without it.`
    )
  ) {
    deleteFlight(localStorage, craft, entry.fileName);
    refreshHistoryScreen(craft);
  }
});

historyCraftSelect.addEventListener("change", () => {
  refreshHistoryScreen(historyCraftSelect.value);
});

clearHistoryButton.addEventListener("click", () => {
  if (confirm("Delete the entire health record on this computer?")) {
    clearHistory(localStorage);
    refreshHistoryScreen();
  }
});

refreshHistoryScreen();
refreshCompareButtons();

// ======================================================
// Community data sharing — opt-in, anonymized.
// Dormant unless CONTRIBUTE_ENDPOINT is configured.
// ======================================================

const CONTRIBUTE_PREF_KEY = "blackboxLabContribute";
const CONTRIBUTE_CATS_KEY = "blackboxLabContributeCats";
const contributedThisSession = new Set();

const contributeCard = document.getElementById("contributeCard");
const contributeToggle = document.getElementById("contributeToggle");
const contributePower = document.getElementById("contributePower");
const contributeGps = document.getElementById("contributeGps");
const contributeSetup = document.getElementById("contributeSetup");
const contributeDump = document.getElementById("contributeDump");
const contributeStatus = document.getElementById("contributeStatus");
const contributeAsk = document.getElementById("contributeAsk");

const dumpConsentRow = document.getElementById("dumpConsentRow");
const dumpConsentInline = document.getElementById("dumpConsentInline");

function contributionEnabled() {
  return (
    Boolean(CONTRIBUTE_ENDPOINT) &&
    localStorage.getItem(CONTRIBUTE_PREF_KEY) === "on"
  );
}

function loadContributeCats() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(CONTRIBUTE_CATS_KEY) ?? ""
    );
    return {
      power: stored.power === true,
      gps: stored.gps === true,
      setup: stored.setup === true,
      dump: stored.dump === true
    };
  } catch {
    return { power: true, gps: false, setup: true, dump: false };
  }
}

// The dump category arrived after the first installs
// consented. Whether it was ever ANSWERED (either way) is
// what decides if the one-time inline ask still shows.
function dumpConsentAnswered() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(CONTRIBUTE_CATS_KEY) ?? ""
    );
    return typeof stored.dump === "boolean";
  } catch {
    return false;
  }
}

function saveContributeCats(cats) {
  localStorage.setItem(CONTRIBUTE_CATS_KEY, JSON.stringify(cats));
}

function refreshContributeCard() {
  if (!contributeCard) return;
  contributeCard.hidden = !CONTRIBUTE_ENDPOINT;
  if (!CONTRIBUTE_ENDPOINT) return;

  const cats = loadContributeCats();
  contributeToggle.checked =
    localStorage.getItem(CONTRIBUTE_PREF_KEY) === "on";
  contributePower.checked = cats.power;
  contributeGps.checked = cats.gps;
  contributeSetup.checked = cats.setup;
  contributeDump.checked = cats.dump;

  const disabled = !contributeToggle.checked;
  [contributePower, contributeGps, contributeSetup, contributeDump].forEach(
    (el) => {
      el.disabled = disabled;
    }
  );
}

async function maybeContributeFlight(flight, fileType, key, extras = {}) {
  if (!contributionEnabled()) return;
  if (contributedThisSession.has(key)) return;
  contributedThisSession.add(key);

  const cats = loadContributeCats();

  try {
    const contribution = await buildContributionV1(
      flight,
      fileType,
      cats,
      CONTRIBUTE_APP_VERSION,
      {
        scrubbedDump:
          cats.dump === true && extras.craftName
            ? getCraftDump(localStorage, extras.craftName)
            : null,
        craftCard: extras.craftName
          ? getCraftCard(localStorage, extras.craftName)
          : null,
        analysisContext: extras.pidAnalysis?.analysisContext ?? null,
        logQuality: extras.logQuality ?? null,
        fingerprint: buildFingerprint({
          dataset: extras.dataset,
          pidAnalysis: extras.pidAnalysis
        }),
        flightEvents: extras.dataset?.flightEvents ?? null,
        governorEvents: extras.dataset?.governorEvents ?? null,
        precomp: extras.dataset?.precomp ?? null
      }
    );

    // Same flight already confirmed uploaded from this
    // install — nothing new to say, skip entirely.
    if (hasContributed(localStorage, contribution.contentHash)) {
      if (contributeStatus) {
        contributeStatus.textContent =
          "This flight was already shared earlier: not sent again.";
      }
      return;
    }

    if (contributeStatus) {
      contributeStatus.textContent = `Sharing: ${describeContribution({
        fields: contribution.frames.fields,
        frames: contribution.frames.frames,
        gps: contribution.frames.gps,
        categories: contribution.payload.categories
      })} …`;
    }

    const result = await uploadContributionV1(
      CONTRIBUTE_ENDPOINT,
      contribution
    );

    if (result.ok) {
      recordContributed(localStorage, contribution.contentHash);
    }

    if (contributeStatus) {
      contributeStatus.textContent = result.ok
        ? "Last log shared anonymously. Thank you for helping the tool learn. ✓"
        : `Sharing failed (server said ${result.status}). The tool keeps working normally.`;
    }
  } catch {
    if (contributeStatus) {
      contributeStatus.textContent =
        "Sharing failed (no connection). The tool keeps working normally.";
    }
  }
}

if (contributeToggle) {
  contributeToggle.addEventListener("change", () => {
    localStorage.setItem(
      CONTRIBUTE_PREF_KEY,
      contributeToggle.checked ? "on" : "off"
    );
    refreshContributeCard();
  });

  [contributePower, contributeGps, contributeSetup, contributeDump].forEach(
    (el) => {
      el.addEventListener("change", () => {
        saveContributeCats({
          power: contributePower.checked,
          gps: contributeGps.checked,
          setup: contributeSetup.checked,
          dump: contributeDump.checked
        });
      });
    }
  );
}

if (contributeAsk && CONTRIBUTE_ENDPOINT) {
  const answered = localStorage.getItem(CONTRIBUTE_PREF_KEY) !== null;

  if (!answered) {
    contributeAsk.hidden = false;

    document.getElementById("askYes").addEventListener("click", () => {
      localStorage.setItem(CONTRIBUTE_PREF_KEY, "on");
      saveContributeCats({
        power: document.getElementById("askPower").checked,
        gps: document.getElementById("askGps").checked,
        setup: document.getElementById("askSetup").checked,
        dump: document.getElementById("askDump").checked
      });
      contributeAsk.hidden = true;
      refreshContributeCard();
    });

    document.getElementById("askNo").addEventListener("click", () => {
      localStorage.setItem(CONTRIBUTE_PREF_KEY, "off");
      contributeAsk.hidden = true;
      refreshContributeCard();
    });
  }
}

if (dumpConsentInline) {
  dumpConsentInline.addEventListener("change", () => {
    const cats = loadContributeCats();
    saveContributeCats({ ...cats, dump: dumpConsentInline.checked });
    refreshContributeCard();
  });
}

refreshContributeCard();

// ======================================================
// Craft class card — confirmed once per craft, local
// model info first, contribution metadata second.
// ======================================================

const craftCardAsk = document.getElementById("craftCardAsk");
const craftCardTitle = document.getElementById("craftCardTitle");
const craftCardSize = document.getElementById("craftCardSize");
const craftCardBlade = document.getElementById("craftCardBlade");
const craftCardPower = document.getElementById("craftCardPower");
const craftCardHeadspeed = document.getElementById("craftCardHeadspeed");
const craftCardDrive = document.getElementById("craftCardDrive");
const craftCardSave = document.getElementById("craftCardSave");
const craftCardLater = document.getElementById("craftCardLater");
const editCraftCardButton = document.getElementById("editCraftCardButton");

const craftDumpPaste = document.getElementById("craftDumpPaste");
const craftDumpStatus = document.getElementById("craftDumpStatus");
const craftDumpOpenButton = document.getElementById("craftDumpOpenButton");
const craftDumpFileInput = document.getElementById("craftDumpFileInput");

const craftCardSkippedThisSession = new Set();
let craftCardTarget = null;

// The scrubbed dump staged in the open panel — persisted
// per craft on Save. Only ever the SCRUBBED result; the
// raw paste is never kept.
let stagedCraftDump = null;

function openCraftCardPanel(craftName, prefill) {
  if (!craftCardAsk) return;

  craftCardTarget = craftName;
  craftCardTitle.textContent = `About your ${craftName}`;

  const card = getCraftCard(localStorage, craftName) ?? prefill ?? {};

  craftCardSize.value = card.size_class ?? "";
  craftCardBlade.value = card.blade_length_mm ?? "";
  craftCardPower.value = card.power_type ?? "";
  craftCardHeadspeed.value = card.typical_headspeed_rpm ?? "";
  craftCardDrive.value = card.drive ?? "";

  stagedCraftDump = null;
  craftDumpPaste.value = "";

  // The inline dump-consent checkbox exists for ONE moment:
  // a pilot who consented to sharing before the dump category
  // existed, at their first dump read. Once answered — there,
  // or on the first-run ask card — it never appears again.
  dumpConsentRow.hidden = !(
    contributionEnabled() && !dumpConsentAnswered()
  );

  const existingDump = getCraftDump(localStorage, craftName);
  if (existingDump) {
    showDumpResult(
      null,
      "This model already has its settings on file.",
      `${existingDump.stats.kept} settings kept. Read a dump again only to replace them.`
    );
  } else {
    craftDumpStatus.hidden = true;
  }

  craftCardAsk.hidden = false;
}

// A dump arriving for the open panel — from paste, file, or
// the Read-configuration button. Scrubbed immediately; the
// read-back is a verdict-style panel that cannot be missed,
// and the fields the dump filled flash green.
function showDumpResult(kind, headline, detail) {
  craftDumpStatus.hidden = false;
  craftDumpStatus.classList.remove("good", "warn");
  if (kind) {
    craftDumpStatus.classList.add(kind);
  }

  craftDumpStatus.textContent = "";
  const strong = document.createElement("strong");
  strong.textContent = headline;
  craftDumpStatus.appendChild(strong);
  if (detail) {
    craftDumpStatus.appendChild(document.createElement("br"));
    craftDumpStatus.appendChild(document.createTextNode(detail));
  }
}

function flashField(input) {
  input.classList.add("field-flash");
  setTimeout(() => input.classList.remove("field-flash"), 1400);
}

function stageCraftDump(text) {
  if (!text || text.trim().length === 0) {
    stagedCraftDump = null;
    craftDumpStatus.hidden = true;
    return;
  }

  if (!looksLikeDump(text)) {
    stagedCraftDump = null;
    showDumpResult(
      "warn",
      "That doesn't look like a Rotorflight `dump all` yet.",
      "Paste (or pick) the whole output of the `dump all` CLI command."
    );
    return;
  }

  stagedCraftDump = scrubDump(text);

  // Read from the RAW text for reassurance only — the pilot
  // should see "it read the right aircraft".
  const identity = readDumpIdentity(text);
  const who = identity.craftName
    ? `${identity.craftName}${identity.boardName ? ` on ${identity.boardName}` : ""}`
    : null;
  const matches =
    who &&
    craftCardTarget &&
    identity.craftName.trim().toLowerCase() ===
      craftCardTarget.trim().toLowerCase();

  // The dump is the authority on what it knows — its values
  // go straight into the form.
  const fromDump = craftCardFromDump(stagedCraftDump.parsed);
  const filled = [];
  if (fromDump.power_type) {
    craftCardPower.value = fromDump.power_type;
    flashField(craftCardPower);
    filled.push("power");
  }
  if (fromDump.typical_headspeed_rpm) {
    craftCardHeadspeed.value = fromDump.typical_headspeed_rpm;
    flashField(craftCardHeadspeed);
    filled.push("headspeed");
  }

  const detail =
    `${stagedCraftDump.stats.kept} settings kept, ` +
    `${stagedCraftDump.stats.dropped} scrubbed away` +
    (stagedCraftDump.report.length > 0
      ? ` (${stagedCraftDump.report.join(", ")})`
      : "") +
    "." +
    (filled.length > 0
      ? ` Filled in: ${filled.join(" + ")}.`
      : "") +
    " Now check the values above and add what's missing. Save model closes the card.";

  if (who && !matches) {
    showDumpResult(
      "warn",
      `✓ Configuration read, but it says "${who}", and this panel is about "${craftCardTarget}". Right file?`,
      detail
    );
  } else {
    showDumpResult(
      "good",
      who
        ? `✓ Configuration read: ${who}. That's this model.`
        : "✓ Configuration read.",
      detail
    );

    // Reading is not the end: the pilot reviews and completes
    // the card, and SAVE is the closing action. Steer there —
    // scroll the fields back into view and focus the first one
    // the dump could not know.
    const nextField =
      [craftCardSize, craftCardBlade, craftCardPower, craftCardHeadspeed, craftCardDrive]
        .find((field) => !field.value) ?? craftCardSize;
    nextField.scrollIntoView({ behavior: "smooth", block: "center" });
    nextField.focus({ preventScroll: true });
  }

  // Users who consented to sharing before the dump category
  // existed answer it once, right here: the pre-checked
  // checkbox appears, its shown state stored immediately.
  if (contributionEnabled() && !dumpConsentAnswered() && dumpConsentRow) {
    dumpConsentRow.hidden = false;
    saveContributeCats({
      ...loadContributeCats(),
      dump: dumpConsentInline.checked
    });
    refreshContributeCard();
  }
}

const craftDumpReadButton = document.getElementById("craftDumpReadButton");

if (craftDumpReadButton) {
  craftDumpReadButton.addEventListener("click", () => {
    if (craftDumpPaste.value.trim().length === 0) {
      showDumpResult(
        "warn",
        "Nothing to read yet.",
        "Paste your `dump all` above, or use the file button."
      );
      return;
    }
    stageCraftDump(craftDumpPaste.value);
  });
}

if (craftDumpPaste) {
  craftDumpPaste.addEventListener("input", () => {
    stageCraftDump(craftDumpPaste.value);
  });
}

if (craftDumpOpenButton) {
  craftDumpOpenButton.addEventListener("click", () => {
    craftDumpFileInput.click();
  });

  craftDumpFileInput.addEventListener("change", async () => {
    const file = craftDumpFileInput.files[0];
    if (file) {
      stageCraftDump(await file.text());
    }
    craftDumpFileInput.value = "";
  });
}

function maybeAskCraftCard(craftName) {
  if (!craftCardAsk) return;
  // Never stack on top of the sharing ask — the card
  // simply waits for a later analysis of this craft.
  if (contributeAsk && !contributeAsk.hidden) return;
  if (craftName === "Unknown craft") return;
  if (getCraftCard(localStorage, craftName)) return;
  if (craftCardSkippedThisSession.has(craftName)) return;

  openCraftCardPanel(
    craftName,
    prefillCraftCard({
      medianHeadspeedRpm:
        currentDataset?.labs?.governor?.averageHeadspeed ?? null,
      hasElectricalTelemetry:
        currentDataset?.columnPresence?.hasVbat === true
    })
  );
}

if (craftCardSave) {
  craftCardSave.addEventListener("click", () => {
    if (craftCardTarget) {
      saveCraftCard(localStorage, craftCardTarget, {
        size_class: craftCardSize.value || null,
        blade_length_mm: craftCardBlade.value,
        power_type: craftCardPower.value || null,
        typical_headspeed_rpm: craftCardHeadspeed.value,
        drive: craftCardDrive.value || null
      });

      if (stagedCraftDump) {
        saveCraftDump(localStorage, craftCardTarget, stagedCraftDump);
        // The Governor Lab's settings card reads from this dump —
        // reflect a fresh save without needing a reload.
        renderGovernorSettings(currentDataset);
      }
    }
    craftCardAsk.hidden = true;
    craftCardTarget = null;
    stagedCraftDump = null;
    refreshUnlockCard();
  });
}

if (craftCardLater) {
  craftCardLater.addEventListener("click", () => {
    if (craftCardTarget) {
      craftCardSkippedThisSession.add(craftCardTarget);
    }
    craftCardAsk.hidden = true;
    craftCardTarget = null;
  });
}

if (editCraftCardButton) {
  editCraftCardButton.addEventListener("click", () => {
    const craft = historyCraftSelect.value;
    if (craft) {
      openCraftCardPanel(craft, prefillCraftCard({}));
    }
  });
}

// ---- the unlock nudge on Home ----
// Visible while the analyzed craft has no CLI dump on
// file; one click opens the craft panel. Sample flights
// never nag — they are not the pilot's craft.
const unlockDumpCard = document.getElementById("unlockDumpCard");
const unlockDumpButton = document.getElementById("unlockDumpButton");
let unlockCraftTarget = null;

function refreshUnlockCard() {
  if (!unlockDumpCard) return;
  unlockDumpCard.hidden =
    !unlockCraftTarget ||
    Boolean(getCraftDump(localStorage, unlockCraftTarget));
}

function setUnlockCraft(craftName, isSample) {
  unlockCraftTarget =
    !isSample && craftName && craftName !== "Unknown craft"
      ? craftName
      : null;
  refreshUnlockCard();
}

const craftCardClose = document.getElementById("craftCardClose");

if (craftCardClose) {
  craftCardClose.addEventListener("click", () => {
    if (craftCardTarget) {
      craftCardSkippedThisSession.add(craftCardTarget);
    }
    craftCardAsk.hidden = true;
    craftCardTarget = null;
    stagedCraftDump = null;
  });
}

if (unlockDumpButton) {
  unlockDumpButton.addEventListener("click", () => {
    if (unlockCraftTarget) {
      openCraftCardPanel(
        unlockCraftTarget,
        prefillCraftCard({
          medianHeadspeedRpm:
            currentDataset?.labs?.governor?.averageHeadspeed ?? null,
          hasElectricalTelemetry:
            currentDataset?.columnPresence?.hasVbat === true
        })
      );
    }
  });
}

// ======================================================
// Welcome hero (empty state): extra open/sample buttons,
// window-wide drag & drop, and a status mirror so loading
// feedback is visible before the hero yields to the cards.
// ======================================================

const welcomeHero = el("welcomeHero");
const welcomeStatus = el("welcomeStatus");

el("welcomeOpenButton").addEventListener("click", openFilePicker);
el("welcomeSampleButton").addEventListener("click", () => {
  trySampleButton.click();
});

// ======================================================
// DIAGNOSIS ACADEMY — the shelf and the reveal card
// ======================================================

const academyCard = el("academyCard");
const academyCardTitle = el("academyCardTitle");
const academyCardBrief = el("academyCardBrief");
const academyRevealButton = el("academyRevealButton");
const academyReveal = el("academyReveal");
const academyRevealChain = el("academyRevealChain");
const academyRevealFix = el("academyRevealFix");
const academyDumpRow = el("academyDumpRow");
const academyDumpCopyButton = el("academyDumpCopyButton");
const academyList = el("academyList");

let activeAcademyEntry = null;

function setAcademyEntry(entry) {
  activeAcademyEntry = entry;

  if (!academyCard) return;

  if (!entry) {
    academyCard.hidden = true;
    return;
  }

  academyCardTitle.textContent = entry.title;
  academyCardBrief.textContent = entry.brief;
  academyReveal.hidden = true;
  academyRevealButton.hidden = false;
  academyDumpRow.hidden = !entry.dumpFile;

  academyRevealChain.textContent = "";
  for (const step of entry.reveal.diagnosis) {
    const item = document.createElement("li");
    item.textContent = step;
    academyRevealChain.appendChild(item);
  }
  academyRevealFix.textContent = entry.reveal.fix;

  academyCard.hidden = false;
}

if (academyRevealButton) {
  academyRevealButton.addEventListener("click", () => {
    academyReveal.hidden = false;
    academyRevealButton.hidden = true;
    noteAction(
      `academy reveal: ${activeAcademyEntry?.id ?? "unknown"}`
    );
  });
}

if (academyDumpCopyButton) {
  academyDumpCopyButton.addEventListener("click", async () => {
    const entry = activeAcademyEntry;
    if (!entry?.dumpFile || !window.blackboxLab?.readSampleText) {
      return;
    }
    const text = await window.blackboxLab.readSampleText(
      entry.dumpFile
    );
    if (!text) {
      academyDumpCopyButton.textContent =
        "Could not read the paired dump";
      return;
    }
    await navigator.clipboard.writeText(text);
    academyDumpCopyButton.textContent =
      "Copied — paste it via Add CLI settings";
  });
}

async function loadAcademyEntry(entry) {
  if (!window.blackboxLab) {
    fileStatus.textContent =
      "Academy flights are available when running the desktop app.";
    return;
  }

  fileStatus.textContent = `Loading: ${entry.title}...`;

  const bytes = await window.blackboxLab.readSampleLog(entry.file);

  if (!bytes) {
    fileStatus.textContent = "Could not load that academy flight.";
    return;
  }

  await loadFromFile(
    new File([new Uint8Array(bytes)], entry.file)
  );

  setAcademyEntry(entry);
  fileStatus.textContent = `Loaded: ${entry.title} — find the problem, then reveal.`;
}

if (academyList) {
  for (const entry of ACADEMY_ENTRIES) {
    const row = document.createElement("div");
    row.className = "academy-entry";

    const label = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const teaser = document.createElement("span");
    teaser.className = "academy-teaser";
    teaser.textContent = entry.teaser;
    label.appendChild(title);
    label.appendChild(teaser);

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "ghost";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => {
      loadAcademyEntry(entry);
    });

    row.appendChild(label);
    row.appendChild(loadButton);
    academyList.appendChild(row);
  }
}

// Mirror every fileStatus message into the hero while it is
// visible — loading feedback happens before .log-loaded flips.
new MutationObserver(() => {
  if (welcomeStatus) {
    welcomeStatus.textContent = fileStatus.textContent;
  }
}).observe(fileStatus, { childList: true, characterData: true, subtree: true });

// Drag & drop a log anywhere onto the window.
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (welcomeHero) welcomeHero.classList.add("drop-armed");
});

window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null && welcomeHero) {
    welcomeHero.classList.remove("drop-armed");
  }
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  if (welcomeHero) welcomeHero.classList.remove("drop-armed");

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  try {
    await loadFromFile(file);
  } catch (error) {
    setLoadStatus(
      "Something went wrong reading this log: " + error.message
    );
    finishLoadProgress(false);
  }
});

// ======================================================
// Update check on startup (silent when offline/current).
// ======================================================

const updateBanner = el("updateBanner");
const UPDATE_DISMISS_KEY = "blackboxLabUpdateDismissed";

checkForUpdate(APP_VERSION).then((update) => {
  if (!update || !updateBanner) return;
  if (localStorage.getItem(UPDATE_DISMISS_KEY) === update.version) return;

  el("updateBannerText").textContent =
    `A new version of Blackbox Lab is out (${update.version}, you have v${APP_VERSION}).`;
  updateBanner.hidden = false;

  el("updateBannerButton").addEventListener("click", () => {
    window.blackboxLab?.openExternal?.(update.url);
  });

  el("updateBannerDismiss").addEventListener("click", () => {
    localStorage.setItem(UPDATE_DISMISS_KEY, update.version);
    updateBanner.hidden = true;
  });
});

// ======================================================
// Error report — the global net under everything else.
// One dialog, one click; the pilot never debugs. The
// report describes the software, never the flight.
// ======================================================

const errorReportOverlay = el("errorReportOverlay");
const errorReportSummary = el("errorReportSummary");
const errorReportSend = el("errorReportSend");
const errorReportCopy = el("errorReportCopy");
const errorReportClose = el("errorReportClose");

let currentErrorBundle = null;

function describeLoadedFile() {
  if (!loadedLog) {
    return null;
  }

  const flight = loadedLog.flights?.[0] ?? null;
  const stats = flight?.stats ?? null;

  return {
    name: loadedLog.file?.name ?? null,
    sizeKb: Number(loadedLog.sizeKb) || null,
    frames: stats
      ? (stats.intraFrames ?? 0) + (stats.interFrames ?? 0)
      : null,
    corruptFrames: stats?.corruptFrames ?? null,
    sampleRateHz: currentDataset?.sampleRateHz ?? null
  };
}

function showErrorReport(error) {
  if (!errorReportOverlay) {
    return;
  }

  currentErrorBundle = buildErrorBundle({
    error,
    screen:
      document.querySelector("[data-screen].screen-active")?.dataset
        .screen ?? null,
    lastAction: lastUserAction,
    file: describeLoadedFile()
  });

  errorReportSummary.textContent = currentErrorBundle.message;

  // For support consoles and the smoke driver: the full bundle of
  // the last caught error, inspectable from devtools.
  window.__blackboxLabLastError = currentErrorBundle;

  const fingerprint = bundleFingerprint(currentErrorBundle);
  const canSend = Boolean(CONTRIBUTE_ENDPOINT);
  const sentBefore =
    canSend && alreadySent(localStorage, fingerprint);

  errorReportSend.hidden = !canSend;
  errorReportSend.disabled = sentBefore;
  errorReportSend.textContent = sentBefore
    ? "Report already sent. Thank you!"
    : "Send report";

  errorReportOverlay.hidden = false;
}

if (errorReportClose) {
  errorReportClose.addEventListener("click", () => {
    errorReportOverlay.hidden = true;
  });
}

if (errorReportCopy) {
  errorReportCopy.addEventListener("click", async () => {
    if (!currentErrorBundle) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        formatBundleText(currentErrorBundle)
      );
      errorReportCopy.textContent = "Copied!";
      setTimeout(() => {
        errorReportCopy.textContent = "Copy details";
      }, 2000);
    } catch {
      // No clipboard available — the dialog stays usable.
    }
  });
}

if (errorReportSend) {
  errorReportSend.addEventListener("click", async () => {
    if (!currentErrorBundle) {
      return;
    }

    errorReportSend.disabled = true;
    errorReportSend.textContent = "Sending…";

    const result = await sendErrorReport(
      CONTRIBUTE_ENDPOINT,
      currentErrorBundle
    );

    if (result.ok) {
      markSent(
        localStorage,
        bundleFingerprint(currentErrorBundle)
      );
      errorReportSend.textContent = "Sent. Thank you!";
    } else {
      errorReportSend.disabled = false;
      errorReportSend.textContent = "Send failed: use Copy details";
    }
  });
}

installErrorCapture({ onError: showErrorReport });
