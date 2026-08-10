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
  detectStableFlightPhase
} from "./analysis/flightPhase.js";
import { buildFlightVerdict } from "./analysis/flightVerdict.js";
import { compareFlights } from "./analysis/compareFlights.js";
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
import { buildFlightEvents } from "./analysis/flightEvents.js";
import { adviseFilters } from "./analysis/filterAdvisor.js";
import {
  loadHistory,
  recordFlight,
  buildHistoryEntry,
  assessTrends,
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
  openLogButton.title = "Unlocked — click to open another log";
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
  if (currentScreenName() === "home") {
    return;
  }

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

  loadProgressTitle.textContent = succeeded
    ? "Flight analyzed"
    : "Could not read this log";
  loadSpinner.hidden = true;
  loadProgressActions.hidden = false;
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
      `${file.name} looks like a Rotorflight settings dump. Open the flight it belongs to first, then add the dump from the model card on Home — the settings are filed against that helicopter.`
    );
    finishLoadProgress(false);
    return true;
  }

  const text = await file.text();

  openCraftCardPanel(currentCraftName);
  stageCraftDump(text);
  navigation.showScreen("home");

  setLoadStatus(
    `${file.name} read into your ${currentCraftName} model card — the flight stays open.`
  );
  finishLoadProgress(true);
  return true;
}

async function loadFromFile(file) {
  noteAction(`opening ${file.name}`);
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

  analyzeFlight(0);

  // Swap the welcome hero for the working Home layout.
  document.body.classList.add("log-loaded");

  if (!loadProgress.hidden) {
    loadProgressText.textContent = `${file.name} analyzed — the verdict is ready on the overview.`;
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
    "Loaded: sample flight (a helicopter with a mechanical problem — can you find it?)";
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
  const governorTarget = firstColumn([/governorTarget/i, /govTarget/i, /governor/i]);
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

  // ---- labs + verdict ----
  const labs = {
    governor: analyzeGovernorLab({
      timeSeconds,
      headspeed,
      governorTarget,
      // Output context for the worst-droop event: a dip with the
      // throttle at its ceiling is a power limit, not a gain issue.
      motorOutput:
        Array.isArray(escThrottle) &&
        escThrottle.some((value) => Number(value) > 0)
          ? escThrottle
          : motor
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

  const verdict = buildFlightVerdict({
  spectra,
  headspeed,
  governorTarget,
  vbat,
  pidAnalysis,
  labs,
  anchorHeadspeedRpm: governedHeadspeed
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
      hasAmperage: columnCarriesData(amperage)
    },
    headerLine,
    timeSeconds,
    columnValues,
    findColumnsIn: (patterns) => findColumns(headerLine, patterns),
    headspeed,
    governorTarget,
    vbat,
    amperage,
    spectra,
    markers,
    perBankFilter,
    labs,
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
  for (const event of flightEvents.events.slice(0, 60)) {
    const chip = document.createElement("button");
    chip.className = `event-card chip-${event.verdict}`;

    const metric =
      event.verdict === "overshoot"
        ? `+${event.overshoot_percent}%`
        : event.verdict === "slow"
          ? `${event.settling_ms} ms`
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
      showEventDetail(event);
    });

    list.appendChild(chip);
  }
}

const AXIS_INDEX = { roll: 0, pitch: 1, yaw: 2 };

function hideEventDetail() {
  const detail = el("pidEventDetail");
  if (detail) detail.hidden = true;
}

function showEventDetail(event) {
  const detail = el("pidEventDetail");
  const explain = el("pidEventExplain");
  const chartElement = el("pidEventChart");
  if (!detail || !currentDataset) return;

  detail.hidden = false;

  const asked = `At ${event.t?.toFixed(1)} s you asked for a ${event.magnitude ?? "?"}°/s ${event.axis.toLowerCase()} rotation.`;
  explain.textContent =
    event.verdict === "overshoot"
      ? `${asked} The response went ${event.overshoot_percent}% PAST the target before coming back — visible below as the gyro line crossing beyond the setpoint line. Occasional overshoot on hard inputs is normal; a pattern of it is tune feedback.`
      : event.verdict === "slow"
        ? `${asked} The response reached the target but took ${event.settling_ms} ms to settle — watch the gyro line hunting around the setpoint below.`
        : `${asked} The gyro followed the setpoint cleanly — this is what good tracking looks like.`;

  // The evidence, right here: the same setpoint-vs-gyro chart
  // the Tuning matrix draws, zoomed to this moment, with the
  // command marked.
  const axisIndex = AXIS_INDEX[event.axis.toLowerCase()] ?? 0;
  const column = (base) =>
    new RegExp(`^${base}\\[${axisIndex}\\]$`, "i");

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
      markers:
        event.t !== null ? [{ x: event.t, label: "command" }] : []
    }
  );

  if (event.t !== null) {
    const chart = chartElement.__blackboxLabChart;
    if (chart) {
      chart.setScale("x", {
        min: Math.max(0, event.t - 2),
        max: event.t + 3
      });
    }
  }

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
    ? `${currentFlightSummary} — ${verdict.summary}`
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
        <span class="verdict-item-title">${card.title}</span>
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

function renderGovernorEvidence(dataset) {
  const droopTime = dataset.labs.governor?.droopTimeSeconds;

  const window = Number.isFinite(droopTime)
    ? sliceWindow(dataset.timeSeconds, droopTime, 4, 6)
    : null;

  if (!window) {
    droopContextCard.hidden = true;
    return;
  }

  droopContextCard.hidden = false;

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
      ? "The seconds around the biggest dip, lined up on one clock — zoom any chart and the others follow. Read top to bottom: what the rotor did, what the pilot and governor asked for, and what the power system delivered."
      : "The seconds around the largest short-term headspeed swing, lined up on one clock — zoom any chart and the others follow. No governor target is logged, so this shows steadiness, not droop against a target.";
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
       patterns: [/^EscV$/i],
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
    dataset.findColumnsIn([/^EscV$/i])[0] ??
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

  const events = findHighestLoadEvents(
    { timeSeconds: dataset.timeSeconds, load: currentAmps },
    { windowSeconds: 2, count: 3 }
  );

  if (events.length === 0) {
    loadEventsCard.hidden = true;
  } else {
    loadEventsCard.hidden = false;

    // Voltage baseline: the calm top end of the whole flight.
    const sortedVoltage = voltageVolts
      .filter(Number.isFinite)
      .sort((first, second) => first - second);
    const baselineVoltage =
      sortedVoltage[Math.floor(sortedVoltage.length * 0.95)] ?? null;

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

      const sagPercent =
        baselineVoltage && voltage
          ? ((baselineVoltage - voltage.min) / baselineVoltage) * 100
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

      return { event, output, voltage, sagPercent, watts, explanation };
    });

    const cell = (value, digits = 1, suffix = "") =>
      Number.isFinite(value)
        ? `${value.toFixed(digits)}${suffix}`
        : "—";

    escEventsTable.innerHTML = `
      <tr>
        <th>When</th><th>Avg current</th><th>Peak current</th>
        <th>Peak output</th><th>Peak power</th><th>Sag</th><th>Reading</th>
      </tr>
      ${describedEvents
        .map(
          ({ event, output, sagPercent, watts, explanation }) => `
        <tr>
          <td>${event.startSeconds.toFixed(1)}–${event.endSeconds.toFixed(1)} s</td>
          <td>${cell(event.averageLoad, 1, " A")}</td>
          <td>${cell(event.peakLoad, 1, " A")}</td>
          <td>${cell(output?.max, 0, "%")}</td>
          <td>${cell(watts?.max, 0, " W")}</td>
          <td>${cell(sagPercent, 1, "%")}</td>
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

    if (window) {
      const markers = [
        { x: biggest.event.peakSeconds, label: "peak load" }
      ];

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

      renderSyncedChart(
        chartLoadPower,
        dataset,
        window,
        [
          { label: "Current (A)", values: currentAmps, color: CHART_COLORS[1] },
          { label: "Voltage (V)", values: voltageVolts, color: CHART_COLORS[0] }
        ],
        { yLabel: "amps · volts", markers, linkGroup: "loadSync" }
      );

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
        <td>${profileCell(averageAt(currentAmps, bank.indexes), 1, " A")}</td>
        <td>${profileCell(averageAt(wattValues, bank.indexes), 0, " W")}</td>
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
        ? "Zoom into collective inputs — dips below the target line are droop."
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
     patterns: [/^EscV$/i],
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
    chartSpectrum.innerHTML =
      '<p class="chart-empty">Not enough gyro data for a spectrum.</p>';
  }

  renderGovernorEvidence(dataset);
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

  pidProfileNote.textContent =
    best.targetRpm === worst.targetRpm
      ? ""
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
        "Not enough continuous stable time at this headspeed for a spectrum — fly a longer steady stretch in this bank to analyze it.";
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
    ? `Binary .bbl decoded natively — ${flight.decodeInfo}`
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

  currentDataset = buildDataset(lines, pidAnalysis);

  renderFlightEvents(
    buildFlightEvents({
      trackingAnalysis:
        pidAnalysis?.detectedColumns?.trackingAnalysis,
      timeSeconds: currentDataset?.timeSeconds,
      dataRowOffset: findTelemetryHeaderIndex(lines) + 1
    })
  );

  renderVerdict(currentDataset);
  renderQuality(currentDataset, flight.stats);
  renderFilterAdvisor(currentDataset);
  renderAllCharts(currentDataset);
  renderPidProfileBreakdown(pidAnalysis, lines);
  renderFilterProfileBreakdown(currentDataset);

  renderLab(
    currentDataset?.labs.governor,
    governorStory,
    governorMetrics,
    "Headspeed data is present, but governor-target telemetry is unavailable. Rotor-speed can still be viewed, but governor tracking and droop cannot be scored."
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
    ? "Ready — the report includes whatever the Labs found."
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
    labs: [
      { title: "Governor Lab", analysis: currentDataset.labs.governor },
      { title: "ESC Lab", analysis: currentDataset.labs.esc },
      { title: "Battery Lab", analysis: currentDataset.labs.battery }
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
    "Report saved — check your downloads folder.";
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
        ? `${logData.file.name} — ${flight.label}`
        : logData.file.name;

    datasets.set(flightIndex, {
      dataset: buildDataset(lines, pidAnalysis),
      name
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
    : 'No baseline yet — open a log first (Home screen).';
}

function renderComparison(comparisonDataset, comparisonName) {
  if (!currentDataset || !comparisonDataset) {
    return;
  }

  const result = compareFlights(currentDataset, comparisonDataset);

  compareResultCard.hidden = false;
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
      renderComparison(result.dataset, result.name);
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
  renderComparison(result.dataset, result.name);
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
    renderComparison(result.dataset, result.name);
  }
});

// ======================================================
// 09. HEALTH RECORD (per-craft history)
// ======================================================

function refreshHistoryScreen(selectedCraft) {
  const history = loadHistory(localStorage);
  const craftNames = Object.keys(history).sort();

  historyCraftSelect.innerHTML = "";

  if (craftNames.length === 0) {
    historyNote.textContent =
      "No flights recorded yet — every log you open is filed here automatically.";
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
      height: 200
    });
  };

  historyTrendCard.hidden = false;
  trendChart(chartTrendVibration, "vibrationPeak", "vibration peak");
  trendChart(chartTrendDroop, "droopRpm", "largest RPM deviation");

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
        flightEvents: currentFlightEvents
      }
    );

    // Same flight already confirmed uploaded from this
    // install — nothing new to say, skip entirely.
    if (hasContributed(localStorage, contribution.contentHash)) {
      if (contributeStatus) {
        contributeStatus.textContent =
          "This flight was already shared earlier — not sent again.";
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
        ? "Last log shared anonymously — thank you for helping the tool learn. ✓"
        : `Sharing failed (server said ${result.status}) — the tool keeps working normally.`;
    }
  } catch {
    if (contributeStatus) {
      contributeStatus.textContent =
        "Sharing failed (no connection) — the tool keeps working normally.";
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
      `${existingDump.stats.kept} settings kept — read a dump again only to replace them.`
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
    " Now check the values above and add what's missing — Save model closes the card.";

  if (who && !matches) {
    showDumpResult(
      "warn",
      `✓ Configuration read — but it says "${who}", and this panel is about "${craftCardTarget}". Right file?`,
      detail
    );
  } else {
    showDumpResult(
      "good",
      who
        ? `✓ Configuration read: ${who} — that's this model.`
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
    `A new version of Blackbox Lab is out (${update.version} — you have v${APP_VERSION}).`;
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
    ? "Report already sent — thank you!"
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
      errorReportSend.textContent = "Sent — thank you!";
    } else {
      errorReportSend.disabled = false;
      errorReportSend.textContent = "Send failed — use Copy details";
    }
  });
}

installErrorCapture({ onError: showErrorReport });
