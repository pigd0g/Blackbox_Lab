// ======================================================
// BLACKBOX LAB — UI SMOKE TEST (Playwright drives the
// real Electron app; screenshots land in smoke-shots/)
// Run:  node tools/ui-smoke.cjs
// ======================================================

const { _electron } = require("playwright-core");
const { mkdirSync } = require("node:fs");

(async () => {
  mkdirSync("smoke-shots", { recursive: true });

  // CSS brace balance — an unclosed rule silently swallows
  // every rule after it (the v0.3.1 lesson). Fail loud.
  const css = require("node:fs").readFileSync("src/index.css", "utf8");
  const cssBalance = css.split("\n").reduce(
    (depth, line) =>
      depth + (line.split("{").length - 1) - (line.split("}").length - 1),
    0
  );
  if (cssBalance !== 0) {
    throw new Error(`index.css brace balance is ${cssBalance}, not 0`);
  }
  console.log("css brace balance ok");

  const app = await _electron.launch({ args: ["."], cwd: process.cwd() });
  const window = await app.firstWindow();

  const errors = [];
  window.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));

  await window.waitForTimeout(1200);
  await window.setViewportSize?.({ width: 1280, height: 900 }).catch(() => {});

  // ---- load the sample flight ----
  // First launch shows the data-sharing consent ask now that the
  // ingest endpoint is configured — answer it before anything else.
  if (await window.isVisible("#contributeAsk")) {
    await window.click("#askNo");
    console.log("consent ask shown and dismissed");
  }

  await window.evaluate(() => {
    localStorage.removeItem("blackboxLabCraftCards");
    localStorage.removeItem("blackboxLabCraftDumps");
    localStorage.removeItem("blackboxLabReplayLayout");
  });

  // Before any log: the unlock card must be INVISIBLE by
  // computed style, not just carry the hidden attribute —
  // a class with its own display value can defeat [hidden].
  const unlockPreLog = await window.evaluate(() => {
    const node = document.getElementById("unlockDumpCard");
    return node ? node.offsetParent !== null : null;
  });
  if (unlockPreLog !== false) {
    throw new Error("unlock card visible before any log: " + unlockPreLog);
  }
  console.log("unlock card ok: invisible before a log");

  await window.click("#welcomeSampleButton");
  // The sample is a real 134k-frame flight now — give the
  // decoder time before asserting.
  await window.waitForTimeout(15000);

  const verdictCount = await window.evaluate(
    () => document.querySelectorAll(".verdict-tile").length
  );
  console.log("verdict cards:", verdictCount);

  // After an analysis with no dump on file, the unlock card is
  // the discoverable entry point — visible for samples too.
  const unlockPostAnalysis = await window.evaluate(() => {
    const node = document.getElementById("unlockDumpCard");
    return node.offsetParent !== null;
  });
  if (!unlockPostAnalysis) {
    throw new Error("unlock card not visible after first analysis");
  }
  console.log("unlock card ok: visible after analysis, pre-dump");
  await window.screenshot({ path: "smoke-shots/01-verdict.png" });

  // ---- evidence zoom: click the vibration card's jump ----
  
  // Regression guard: charts must actually have scaled data —
  // a null x-scale means uPlot never autoscaled (blank charts).
  const chartState = await window.evaluate(() => {
    const el = document.getElementById("chartGyro");
    const u = el && el.__blackboxLabChart;
    return u ? { xMin: u.scales.x.min, xMax: u.scales.x.max, len: u.data[0].length } : null;
  });
  if (!chartState || chartState.xMin == null || chartState.xMax <= chartState.xMin) {
    throw new Error("chart x-scale not computed: " + JSON.stringify(chartState));
  }
  console.log("chart scale ok:", JSON.stringify(chartState));

  // Same guard for the per-axis tuning preset grid — all nine
  // charts must exist with scaled data (they render even while
  // their advanced blocks are hidden in beginner mode).
  const presetState = await window.evaluate(() => {
    const ids = [
      "chartTracking", "chartTrackingPitch", "chartTrackingYaw",
      "chartFfRoll", "chartFfPitch", "chartFfYaw",
      "chartTermsRoll", "chartTermsPitch", "chartTermsYaw"
    ];
    return ids.map((id) => {
      const el = document.getElementById(id);
      const u = el && el.__blackboxLabChart;
      return {
        id,
        ok: Boolean(u && u.scales.x.min != null && u.scales.x.max > u.scales.x.min)
      };
    });
  });
  const badPresets = presetState.filter((entry) => !entry.ok);
  if (badPresets.length) {
    throw new Error("preset charts without scaled data: " +
      badPresets.map((entry) => entry.id).join(", "));
  }
  console.log("preset grid ok: 9/9 charts scaled");
  // ---- Signal + BEC labs: verdicts filled, charts carry DATA ----
  // The v1.3 lesson repeated: a chart can render healthy-looking
  // axes with zero series (a per-value convert handed an array) —
  // assert scales, never just absence of errors.
  await window.click('.nav-button[data-target="signal"]');
  await window.waitForTimeout(400);
  const signalState = await window.evaluate(() => ({
    story: document.getElementById("signalStory")?.textContent ?? "",
    metrics: document.querySelectorAll("#signalMetrics .metric").length
  }));
  if (signalState.story.length < 20) {
    throw new Error(
      "signal lab verdict empty: " + JSON.stringify(signalState)
    );
  }
  console.log("signal lab ok:", signalState.story.slice(0, 70));

  await window.click('.nav-button[data-target="bec"]');
  await window.waitForTimeout(600);
  const becState = await window.evaluate(() => {
    const chart = document
      .getElementById("chartBecVoltage")
      ?.querySelector("canvas")
      ? document.getElementById("chartBecVoltage").__blackboxLabChart
      : null;
    return {
      story: document.getElementById("becStory")?.textContent ?? "",
      chartScaled: Boolean(
        chart &&
          chart.scales.x.min != null &&
          chart.scales.x.max > chart.scales.x.min
      ),
      chartHidden:
        document.getElementById("becChartCard")?.hidden ?? null
    };
  });
  if (becState.story.length < 20) {
    throw new Error("bec lab verdict empty: " + JSON.stringify(becState));
  }
  if (becState.chartHidden === false && !becState.chartScaled) {
    throw new Error(
      "bec voltage chart rendered without scaled data: " +
        JSON.stringify(becState)
    );
  }
  console.log(
    "bec lab ok:",
    becState.story.slice(0, 70),
    "| chart scaled:",
    becState.chartScaled
  );

  await window.click('.nav-button[data-target="home"]');
  await window.waitForTimeout(300);


  await window.click(".verdict-tile");
  await window.waitForTimeout(600);
  await window.screenshot({ path: "smoke-shots/02-filter-zoomed.png" });

  // ---- tuning matrix + maximize toggle ----
  await window.click('.nav-button[data-target="viewer"]');
  await window.waitForTimeout(300);
  await window.click(".chart-max-btn");
  // The ResizeObserver re-renders asynchronously.
  await window.waitForTimeout(500);
  const maxState = await window.evaluate(() => {
    const cell = document.querySelector(".chart-cell");
    const chart = document.getElementById("chartTracking").__blackboxLabChart;
    return {
      maximized: cell.classList.contains("chart-max"),
      width: chart ? chart.width : 0
    };
  });
  if (!maxState.maximized || maxState.width < 500) {
    throw new Error("chart maximize misbehaved: " + JSON.stringify(maxState));
  }
  await window.screenshot({ path: "smoke-shots/16-matrix-maximized.png" });
  await window.click(".chart-max-btn");
  console.log("tuning matrix ok: maximize expands to", maxState.width, "px and back");

  // Replay transport: play advances the clock, the playhead line
  // appears inside viewer charts, sticks follow, pause holds.
  await window.click('.nav-button[data-target="replay"]');
  await window.waitForTimeout(500);
  const stackState = await window.evaluate(() => ({
    rows: document.querySelectorAll(".replay-graph-row").length,
    charts: document.querySelectorAll(
      'section[data-screen="replay"] .chart-container canvas'
    ).length
  }));
  if (stackState.rows === 0 || stackState.charts === 0) {
    throw new Error("replay stack empty: " + JSON.stringify(stackState));
  }
  console.log("replay stack ok:", stackState.rows, "graphs");

  const replayBefore = await window.evaluate(() =>
    document.getElementById("replayTime")?.textContent
  );
  await window.click("#replayPlay");
  await window.waitForTimeout(1200);
  const replayState = await window.evaluate(() => ({
    time: document.getElementById("replayTime")?.textContent,
    playheads: document.querySelectorAll(
      'section[data-screen="replay"] .replay-playhead'
    ).length,
    sticksRendered:
      document.getElementById("replaySticks")?.dataset.stickRendered ===
      "1",
    playLabel: document.getElementById("replayPlay")?.textContent
  }));
  await window.click("#replayPlay");
  if (
    replayState.time === replayBefore ||
    replayState.playheads === 0 ||
    !replayState.sticksRendered ||
    replayState.playLabel !== "⏸"
  ) {
    throw new Error(
      "replay transport misbehaved: " + JSON.stringify(replayState)
    );
  }
  // All logged fields (#63): the add-menu lists the log's own
  // header fields by group beside the presets; adding a raw field
  // stacks it as its own synchronized chart with the original field
  // name in the heading; the search box narrows the menu.
  const fieldMenu = await window.evaluate(() => {
    const select = document.getElementById("replayAddGraph");
    const groups = [...select.querySelectorAll("optgroup")].map((g) => g.label);
    const option = [...select.options].find((o) => o.value === "field:axisP[0]");
    return { groups, hasAxisP: Boolean(option), text: option?.textContent ?? null };
  });
  if (!fieldMenu.groups.includes("Presets") || !fieldMenu.groups.includes("PID terms") || !fieldMenu.hasAxisP) {
    throw new Error("replay field menu incomplete: " + JSON.stringify(fieldMenu));
  }
  if (!/axisP\[0\]/.test(fieldMenu.text)) {
    throw new Error("field option hides the original name: " + fieldMenu.text);
  }
  const rowsBefore = stackState.rows;
  await window.selectOption("#replayAddGraph", "field:axisP[0]");
  await window.click("#replayAddButton");
  await window.waitForTimeout(400);
  const fieldRow = await window.evaluate(() => {
    const rows = [...document.querySelectorAll(".replay-graph-row")];
    const last = rows[rows.length - 1];
    return {
      rows: rows.length,
      heading: last?.querySelector(".replay-graph-head span")?.textContent ?? "",
      canvas: Boolean(last?.querySelector("canvas"))
    };
  });
  if (fieldRow.rows !== rowsBefore + 1 || !fieldRow.canvas || !/axisP\[0\]/.test(fieldRow.heading)) {
    throw new Error("raw field did not stack: " + JSON.stringify(fieldRow));
  }
  await window.fill("#replayFieldSearch", "yaw gyro");
  await window.waitForTimeout(200);
  const searched = await window.evaluate(() => {
    const select = document.getElementById("replayAddGraph");
    return [...select.options].map((o) => o.value);
  });
  if (!searched.includes("field:gyroADC[2]") || searched.some((v) => v === "field:axisP[1]")) {
    throw new Error("field search did not narrow the menu: " + JSON.stringify(searched));
  }
  await window.fill("#replayFieldSearch", "");
  await window.waitForTimeout(200);
  await window.screenshot({ path: "smoke-shots/17b-replay-fields.png" });
  console.log("replay fields ok:", fieldRow.heading, "| search narrows to", searched.length, "options");
  await window.screenshot({ path: "smoke-shots/17-replay.png" });
  await window.click('.nav-button[data-target="viewer"]');
  await window.waitForTimeout(300);
  console.log(
    "replay ok:",
    replayState.time,
    "|",
    replayState.playheads,
    "playheads | sticks follow"
  );

  // ---- walk the labs ----
  for (const [target, name] of [
    ["viewer", "03-viewer"],
    ["governor", "04-governor"],
    ["esc", "05-esc"],
    ["battery", "06-battery"],
    ["guide", "07-guide"]
  ]) {
    await window.click(`.nav-button[data-target="${target}"]`);
    await window.waitForTimeout(450);
    await window.screenshot({ path: `smoke-shots/${name}.png` });
  }

  // ---- compare with the clean sample ----
  await window.click('.nav-button[data-target="compare"]');
  await window.waitForTimeout(300);
  await window.click("#compareSampleButton");
  await window.waitForTimeout(3500);

  const compareRowCount = await window.evaluate(
    () => document.querySelectorAll(".compare-row").length
  );
  const compareSummary = await window.textContent("#compareSummary");
  console.log("compare rows:", compareRowCount, "| summary:", compareSummary);
  await window.screenshot({ path: "smoke-shots/08-compare.png" });

  // ---- multi-flight "after" file: the flight picker ----
  // Two known samples concatenated = one file, two flights.
  const twoFlightPath = require("node:path").join(
    require("node:os").tmpdir(),
    "bbl-smoke-two-flights.bbl"
  );
  require("node:fs").writeFileSync(
    twoFlightPath,
    Buffer.concat([
      require("node:fs").readFileSync("samples/sample-clean-tuned.bbl"),
      require("node:fs").readFileSync("samples/sample-vibration-problem.bbl")
    ])
  );
  await window.setInputFiles("#compareFileInput", twoFlightPath);
  await window.waitForSelector("#compareFlightPicker:not([hidden])", {
    timeout: 15000
  });
  const pickerState = await window.evaluate(() => ({
    options: document.getElementById("compareFlightSelect").options.length,
    selected: document.getElementById("compareFlightSelect").value,
    summary: document.getElementById("compareSummary").textContent,
    rows: document.getElementById("compareRows").innerText
  }));
  if (pickerState.options !== 2 || !pickerState.summary) {
    throw new Error(
      "compare flight picker misbehaved: " + JSON.stringify(pickerState)
    );
  }
  // Flip to the other flight — the comparison must re-render
  // with THAT flight's numbers (clean vs vibration sample, so
  // the row values must actually change).
  const otherFlight = pickerState.selected === "0" ? "1" : "0";
  await window.selectOption("#compareFlightSelect", otherFlight);
  await window.waitForTimeout(2500);
  const flippedRows = await window.evaluate(
    () => document.getElementById("compareRows").innerText
  );
  if (!flippedRows || flippedRows === pickerState.rows) {
    throw new Error(
      "comparison did not re-render with the picked flight's data"
    );
  }
  console.log(
    "compare flight picker ok:",
    pickerState.options,
    "flights | flipped to",
    otherFlight,
    "| rows changed:",
    flippedRows !== pickerState.rows
  );
  await window.screenshot({ path: "smoke-shots/08b-compare-picker.png" });

  // ---- load-from-another-screen: progress dialog ----
  await window.click('.nav-button[data-target="viewer"]');
  await window.waitForTimeout(300);
  await window.setInputFiles("#logFileInput", "samples/sample-clean-tuned.bbl");
  await window.waitForSelector("#loadProgress:not([hidden])", { timeout: 5000 });
  await window.waitForSelector("#loadProgressActions:not([hidden])", { timeout: 30000 });
  const loadTitle = await window.textContent("#loadProgressTitle");
  await window.click("#loadStayHere");
  const overlayState = await window.evaluate(() => ({
    overlayHidden: document.getElementById("loadProgress").hidden,
    screen: document.querySelector("[data-screen].screen-active")?.dataset.screen
  }));
  if (!overlayState.overlayHidden || overlayState.screen !== "viewer") {
    throw new Error("load progress dialog misbehaved: " + JSON.stringify(overlayState));
  }
  console.log("load progress dialog ok:", loadTitle, "| stayed on:", overlayState.screen);

  // ---- health record ----
  await window.click('.nav-button[data-target="history"]');
  await window.waitForTimeout(450);
  const historyNote = await window.textContent("#historyNote");
  console.log("history note:", historyNote);
  await window.screenshot({ path: "smoke-shots/09-history.png" });

  // ---- flight events: the PID Lab's beginner heart ----
  await window.click('.nav-button[data-target="pid"]');
  await window.waitForTimeout(300);
  const eventsState = await window.evaluate(() => ({
    visible:
      document.getElementById("pidEventsCard").offsetParent !== null,
    sentence: document.getElementById("pidEventsSummary").textContent
  }));
  if (!eventsState.visible || eventsState.sentence.length < 10) {
    throw new Error(
      "flight events card missing/empty: " + JSON.stringify(eventsState)
    );
  }
  console.log("flight events ok:", eventsState.sentence.slice(0, 90));

  // Click an event card: evidence unfolds IN PLACE (no screen
  // change), with a zoomed chart carrying real data.
  await window.click(".event-card");
  await window.waitForTimeout(600);
  const detailState = await window.evaluate(() => {
    const chart = document.getElementById("pidEventChart").__blackboxLabChart;
    return {
      screen: document.querySelector("[data-screen].screen-active")?.dataset
        .screen,
      detailVisible:
        document.getElementById("pidEventDetail").offsetParent !== null,
      explain: document
        .getElementById("pidEventExplain")
        .textContent.slice(0, 40),
      chartScaled: Boolean(
        chart && chart.scales.x.min != null && chart.scales.x.max > chart.scales.x.min
      )
    };
  });
  if (
    detailState.screen !== "pid" ||
    !detailState.detailVisible ||
    !detailState.chartScaled
  ) {
    throw new Error(
      "in-place event detail misbehaved: " + JSON.stringify(detailState)
    );
  }
  console.log("event detail ok: in place, chart scaled —", detailState.explain);

  // The event's stick inset replays the pilot's hands; give the
  // one-shot replay a moment, then require a painted canvas.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const eventSticks = await window.evaluate(() => ({
    visible:
      document.getElementById("pidEventSticksWrap")?.hidden === false,
    rendered:
      document.getElementById("pidEventSticks")?.dataset
        .stickRendered === "1"
  }));
  if (!eventSticks.visible || !eventSticks.rendered) {
    throw new Error(
      "event stick inset missing: " + JSON.stringify(eventSticks)
    );
  }
  console.log("event sticks ok: pilot input replayed beside the evidence");
  await window.screenshot({ path: "smoke-shots/15-flight-events.png" });
  await window.click('.nav-button[data-target="history"]');
  await window.waitForTimeout(300);

  // ---- craft card: opens from the health record, saves ----
  await window.click("#editCraftCardButton");
  await window.waitForSelector("#craftCardAsk:not([hidden])", { timeout: 3000 });
  await window.selectOption("#craftCardSize", "700");
  await window.click("#craftCardSave");
  const savedCard = await window.evaluate(() => {
    const cards = JSON.parse(
      localStorage.getItem("blackboxLabCraftCards") ?? "{}"
    );
    return Object.values(cards)[0] ?? null;
  });
  if (!savedCard || savedCard.size_class !== "700") {
    throw new Error("craft card did not save: " + JSON.stringify(savedCard));
  }
  console.log("craft card saved:", JSON.stringify(savedCard));

  // ---- craft dump: paste in the panel, prefill, persist ----
  await window.click("#editCraftCardButton");
  await window.waitForSelector("#craftCardAsk:not([hidden])", { timeout: 3000 });
  await window.fill(
    "#craftDumpPaste",
    "# Rotorflight 4.4.0\nboard_name SECRET\nset gov_mode = ELECTRIC\nset gov_headspeed = 2100\nset totally_unknown = 1\n"
  );
  await window.waitForTimeout(200);
  const dumpStatus = await window.textContent("#craftDumpStatus");
  // 4 kept = banner + board model + gov_mode + gov_headspeed.
  if (!dumpStatus.includes("4 settings kept")) {
    throw new Error("craft dump status unexpected: " + dumpStatus);
  }
  // The dump fills empty card fields — headspeed from gov_headspeed.
  const prefilled = await window.evaluate(() => ({
    headspeed: document.getElementById("craftCardHeadspeed").value,
    power: document.getElementById("craftCardPower").value
  }));
  if (prefilled.headspeed !== "2100" || prefilled.power !== "electric") {
    throw new Error("dump did not prefill card: " + JSON.stringify(prefilled));
  }
  await window.screenshot({ path: "smoke-shots/10-dump-paste.png" });
  await window.click("#craftCardSave");
  const storedDump = await window.evaluate(() => {
    const dumps = JSON.parse(
      localStorage.getItem("blackboxLabCraftDumps") ?? "{}"
    );
    return Object.values(dumps)[0] ?? null;
  });
  if (!storedDump || storedDump.parsed.gov_headspeed !== "2100") {
    throw new Error("craft dump did not persist: " + JSON.stringify(storedDump));
  }
  console.log("craft dump ok:", dumpStatus.trim().slice(0, 80), "| persisted");

  // ---- craft dump via FILE: realistic export (BOM, CRLF,
  // master/profile split) must fill the form fields ----
  const dumpFilePath = require("node:path").join(
    require("node:os").tmpdir(),
    "bbl-smoke-dump.txt"
  );
  require("node:fs").writeFileSync(
    dumpFilePath,
    "﻿# dump\r\n# version\r\n# Rotorflight / STM32F7X2 (S7X2) 4.6.0\r\n" +
      "batch start\r\nboard_name TESTBOARD\r\n" +
      "set gov_mode = NITRO\r\nset motor_poles = 10,0,0,0\r\n" +
      "profile 0\r\nset gov_headspeed = 1750\r\n" +
      "rateprofile 0\r\nbatch end\r\n"
  );
  await window.click("#editCraftCardButton");
  await window.waitForSelector("#craftCardAsk:not([hidden])", { timeout: 3000 });
  await window.setInputFiles("#craftDumpFileInput", dumpFilePath);
  await window.waitForTimeout(400);
  const fileFill = await window.evaluate(() => ({
    power: document.getElementById("craftCardPower").value,
    headspeed: document.getElementById("craftCardHeadspeed").value,
    status: document.getElementById("craftDumpStatus").textContent
  }));
  if (fileFill.power !== "nitro" || fileFill.headspeed !== "1750") {
    throw new Error(
      "dump FILE did not fill the form: " + JSON.stringify(fileFill)
    );
  }
  if (!fileFill.status.includes("Filled in:")) {
    throw new Error("fill note missing from status: " + fileFill.status);
  }
  console.log("craft dump file ok: form filled from file (nitro @ 1750)");
  await window.click("#craftCardClose");
  const panelClosed = await window.evaluate(
    () => document.getElementById("craftCardAsk").hidden
  );
  if (!panelClosed) {
    throw new Error("X did not close the model panel");
  }
  console.log("model panel X close ok");
  // ---- every lab page opens with its verdict ----
  const labVerdicts = await window.evaluate(() => ({
    filter: document.getElementById("filterVerdictStory").textContent,
    pid: document.getElementById("pidVerdictStory").textContent,
    homePower: Array.from(
      document.querySelectorAll(".verdict-item-title")
    ).some((node) => node.textContent === "Power & ESC")
  }));
  if (
    labVerdicts.filter.startsWith("Open a log") ||
    labVerdicts.pid.startsWith("Open a log") ||
    !labVerdicts.homePower
  ) {
    throw new Error(
      "lab verdict symmetry broken: " + JSON.stringify(labVerdicts)
    );
  }
  console.log("lab verdicts ok: filter + pid filled, power card on Home");

  // ---- change pack card: present and in a sane state ----
  const packState = await window.evaluate(() => {
    const card = document.getElementById("packCard");
    if (!card) return { exists: false };
    return {
      exists: true,
      hidden: card.hidden,
      intro: document.getElementById("packIntro")?.textContent ?? "",
      members: document.querySelectorAll("#packMembers .pack-member").length,
      prescriptions: document.querySelectorAll("#packPrescriptionList li").length
    };
  });
  if (!packState.exists) throw new Error("packCard missing from Home");
  if (!packState.hidden && !packState.intro)
    throw new Error("packCard visible without an intro sentence");
  console.log(
    `change pack card ok: ${
      packState.hidden
        ? "hidden (nothing earned, nothing to confirm)"
        : `${packState.members} member(s), ${packState.prescriptions} prescription(s)`
    }`
  );

  // ---- advanced re-triage: numbers hidden for beginners ----
  const gateProbe = () =>
    window.evaluate(() => {
      const visible = (id) => {
        const node = document.getElementById(id);
        return Boolean(node && node.offsetParent !== null);
      };
      return {
        advanced: document.body.classList.contains("advanced-mode"),
        governorMetrics: visible("governorMetrics"),
        escMetrics: visible("escMetrics"),
        droopContext: visible("droopContextCard"),
        loadEvents: visible("loadEventsCard"),
        pidFindings: visible("pidAnalysisFindings")
      };
    });

  // Force beginner mode via the Settings checkbox.
  await window.click('.nav-button[data-target="settings"]');
  await window.waitForTimeout(200);
  const advancedNow = await window.evaluate(() =>
    document.body.classList.contains("advanced-mode")
  );
  if (advancedNow) {
    await window.click("#advancedModeToggle");
  }
  await window.click('.nav-button[data-target="governor"]');
  await window.waitForTimeout(300);
  const beginnerState = await gateProbe();
  // Metric grids are beginner content again (owner round 3);
  // evidence views and findings stay advanced.
  if (
    !beginnerState.governorMetrics ||
    beginnerState.droopContext ||
    beginnerState.pidFindings
  ) {
    throw new Error(
      "advanced-only content visible in beginner mode: " +
        JSON.stringify(beginnerState)
    );
  }
  await window.screenshot({ path: "smoke-shots/13-governor-beginner.png" });

  // Headspeed events: with a governed sample the card must be
  // visible in beginner mode and carry a real summary sentence —
  // zero events is a legitimate summary, an empty one is not.
  const governorEventsState = await window.evaluate(() => {
    const card = document.getElementById("governorEventsCard");
    const summary = document.getElementById("governorEventsSummary");
    return {
      visible: card ? card.offsetParent !== null : null,
      sentence: summary?.textContent?.trim() ?? "",
      chips: document.querySelectorAll(
        "#governorEventsList .event-card"
      ).length
    };
  });
  if (!governorEventsState.visible || !governorEventsState.sentence) {
    throw new Error(
      "governor events card missing or empty: " +
        JSON.stringify(governorEventsState)
    );
  }
  // If the sample produced events, the first chip must open its
  // in-place evidence with a populated rpm chart.
  if (governorEventsState.chips > 0) {
    await window.click("#governorEventsList .event-card");
    await window.waitForTimeout(400);
    const detailState = await window.evaluate(() => ({
      detail:
        document.getElementById("governorEventDetail").offsetParent !==
        null,
      explain:
        document
          .getElementById("governorEventExplain")
          ?.textContent?.trim() ?? "",
      rpmChart: Boolean(
        document
          .getElementById("governorEventChartRpm")
          ?.querySelector("canvas")
      )
    }));
    if (!detailState.detail || !detailState.explain || !detailState.rpmChart) {
      throw new Error(
        "governor event detail broken: " + JSON.stringify(detailState)
      );
    }
    console.log(
      `governor events ok: ${governorEventsState.chips} chip(s), detail opens`
    );
    await window.screenshot({
      path: "smoke-shots/13c-governor-events.png"
    });
    await window.click("#governorEventsList .event-card");
  } else {
    console.log(
      "governor events ok: zero-event summary — " +
        governorEventsState.sentence
    );
  }

  // Peek: reveals this page's advanced content in beginner
  // mode, shows the teaching note, and toggles back off.
  await window.click('section[data-screen="governor"] .peek-advanced-link');
  const peekState = await window.evaluate(() => ({
    droop: document.getElementById("droopContextCard").offsetParent !== null,
    note: document.querySelector(
      'section[data-screen="governor"] .peek-advanced-note'
    ).hidden,
    // The dump saved earlier in this run carries gov_mode and
    // gov_headspeed — the settings card must surface them here.
    settingsRows: document.querySelectorAll(
      "#governorSettingsTable tr"
    ).length,
    settingsVisible:
      document.getElementById("governorSettingsCard").offsetParent !==
      null
  }));
  if (!peekState.droop || peekState.note) {
    throw new Error("peek did not reveal advanced data: " + JSON.stringify(peekState));
  }
  if (!peekState.settingsVisible || peekState.settingsRows < 3) {
    throw new Error(
      "governor settings card missing its dump values: " +
        JSON.stringify(peekState)
    );
  }
  console.log(
    `governor settings ok: ${peekState.settingsRows - 1} value row(s) from the saved dump`
  );
  await window.screenshot({ path: "smoke-shots/13b-governor-peek.png" });
  await window.click('section[data-screen="governor"] .peek-advanced-link');
  const peekOff = await window.evaluate(
    () => document.getElementById("droopContextCard").offsetParent === null
  );
  if (!peekOff) {
    throw new Error("peek did not toggle back off");
  }
  console.log("peek ok: reveals, teaches, hides again");

  // Screen intros: every analysis page opens with its
  // what-am-I-looking-at paragraph, deeper text folded behind
  // the summary — the one explanation home per screen.
  const introState = await window.evaluate(() => {
    const screens = ["viewer", "replay", "filter", "pid", "governor", "esc", "battery", "signal", "bec", "compare", "history", "reports"];
    return screens.map((name) => ({
      name,
      present: Boolean(
        document.querySelector(`section[data-screen="${name}"] .screen-intro details summary`)
      )
    }));
  });
  const missingIntros = introState.filter((entry) => !entry.present);
  if (missingIntros.length) {
    throw new Error("screen intros missing: " + missingIntros.map((entry) => entry.name).join(", "));
  }
  console.log(`screen intros ok: ${introState.length}/${introState.length} pages introduce themselves`);

  // Pilot-input inset: the governor droop card shows the sticks
  // at the marked moment (the Bell sample carries rcCommand).
  const stickState = await window.evaluate(() => ({
    wrapVisible:
      document.getElementById("droopSticksWrap")?.hidden === false,
    rendered:
      document.getElementById("droopSticks")?.dataset.stickRendered ===
      "1"
  }));
  if (!stickState.wrapVisible || !stickState.rendered) {
    throw new Error(
      "governor stick inset missing: " + JSON.stringify(stickState)
    );
  }
  await window.screenshot({ path: "smoke-shots/13d-gov-sticks.png" });
  console.log("stick inset ok: governor droop card shows pilot input");

  // Advanced mode reveals them, with live chart data in the
  // evidence views (the zero-width guard must have held).
  await window.click('.nav-button[data-target="settings"]');
  await window.waitForTimeout(200);
  await window.click("#advancedModeToggle");
  await window.click('.nav-button[data-target="governor"]');
  await window.waitForTimeout(300);
  const advancedState = await gateProbe();
  if (!advancedState.droopContext || !advancedState.governorMetrics) {
    throw new Error(
      "advanced content missing in advanced mode: " +
        JSON.stringify(advancedState)
    );
  }
  const droopChartOk = await window.evaluate(() => {
    const el = document.getElementById("chartDroopRpm");
    const u = el && el.__blackboxLabChart;
    return Boolean(u && u.scales.x.min != null && u.scales.x.max > u.scales.x.min);
  });
  if (!droopChartOk) {
    throw new Error("droop context chart has no scaled data in advanced mode");
  }
  // THE RULE: advanced folds are always present — closed in
  // beginner mode, pre-opened by the advanced switch.
  await window.click('.nav-button[data-target="settings"]');
  await window.waitForTimeout(200);
  await window.click("#advancedModeToggle"); // back to beginner
  await window.click('.nav-button[data-target="viewer"]');
  await window.waitForTimeout(300);
  const foldBeginner = await window.evaluate(() => {
    const block = document.querySelector(
      'section[data-screen="viewer"] details.advanced-block'
    );
    const summary = block?.querySelector("summary");
    return {
      summaryVisible: Boolean(summary && summary.offsetParent !== null),
      open: block?.open ?? null
    };
  });
  if (!foldBeginner.summaryVisible || foldBeginner.open !== false) {
    throw new Error(
      "advanced fold handle wrong in beginner mode: " +
        JSON.stringify(foldBeginner)
    );
  }
  await window.click('.nav-button[data-target="settings"]');
  await window.waitForTimeout(200);
  await window.click("#advancedModeToggle"); // advanced again
  const foldAdvanced = await window.evaluate(
    () =>
      document.querySelector(
        'section[data-screen="viewer"] details.advanced-block'
      ).open
  );
  if (!foldAdvanced) {
    throw new Error("advanced mode did not pre-open the folds");
  }
  console.log("advanced folds ok: handle always visible, mode pre-opens");

  console.log(
    "advanced re-triage ok: beginner hides numbers, advanced reveals with live charts"
  );
  await window.screenshot({ path: "smoke-shots/14-governor-advanced.png" });
  // ---- sidebar advanced-mode switch: one state, two controls ----
  const advBefore = await window.evaluate(() =>
    document.body.classList.contains("advanced-mode")
  );
  await window.click("#sidebarAdvancedToggle");
  const advAfter = await window.evaluate(() => ({
    body: document.body.classList.contains("advanced-mode"),
    settingsBox: document.getElementById("advancedModeToggle").checked,
    pressed: document
      .getElementById("sidebarAdvancedToggle")
      .getAttribute("aria-pressed")
  }));
  if (
    advAfter.body === advBefore ||
    advAfter.settingsBox !== advAfter.body ||
    advAfter.pressed !== String(advAfter.body)
  ) {
    throw new Error(
      "advanced-mode switch out of sync: " + JSON.stringify(advAfter)
    );
  }
  await window.click("#sidebarAdvancedToggle"); // restore
  console.log("advanced switch ok: toggled to", advAfter.body, "and back");
  await window.screenshot({ path: "smoke-shots/11-sidebar-advanced.png" });

  // ---- error-report dialog: the global net actually catches ----
  // A deliberate unhandled throw must raise the dialog with the
  // send path offered; the throw itself is expected, not a smoke
  // failure.
  const SYNTHETIC_ERROR = "smoke synthetic error (expected)";

  await window.evaluate((message) => {
    setTimeout(() => {
      throw new Error(message);
    }, 0);
  }, SYNTHETIC_ERROR);
  await window.waitForTimeout(600);

  const errorDialog = await window.evaluate(() => ({
    visible: !document.getElementById("errorReportOverlay").hidden,
    summary: document.getElementById("errorReportSummary").textContent,
    sendVisible: !document.getElementById("errorReportSend").hidden,
    sendLabel: document.getElementById("errorReportSend").textContent
  }));

  if (!errorDialog.visible) {
    throw new Error("error-report dialog did not appear");
  }
  if (!errorDialog.summary.includes("smoke synthetic error")) {
    throw new Error(
      "error-report summary missing the error: " + errorDialog.summary
    );
  }
  if (!errorDialog.sendVisible) {
    throw new Error("send button hidden despite configured endpoint");
  }

  // The backdrop owns most click points, so target the ✕ without
  // Playwright's hit-test; the closed-state assertion below is the
  // real check that the handler ran.
  await window.click("#errorReportClose", { force: true });

  const dialogClosed = await window.evaluate(
    () => document.getElementById("errorReportOverlay").hidden
  );
  if (!dialogClosed) {
    throw new Error("error-report dialog did not close");
  }

  console.log(
    "error report ok: dialog raised, send offered (" +
      errorDialog.sendLabel.trim() +
      "), closed"
  );
  await window.screenshot({ path: "smoke-shots/12-error-report.png" });

  const expectedErrorIndex = errors.findIndex((entry) =>
    entry.includes(SYNTHETIC_ERROR)
  );
  if (expectedErrorIndex >= 0) {
    errors.splice(expectedErrorIndex, 1);
  }

  if (errors.length) {
    console.log("\n==== ERRORS ====");
    for (const error of errors) console.log(error);
    process.exitCode = 1;
  } else {
    console.log("\nSMOKE TEST PASSED — no page errors");
  }

  await app.close();
})().catch((error) => {
  console.error("DRIVER FAILED:", error.message);
  process.exit(1);
});
