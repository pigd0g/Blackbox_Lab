// ======================================================
// BLACKBOX LAB — UI SMOKE TEST (Playwright drives the
// real Electron app; screenshots land in smoke-shots/)
// Run:  node tools/ui-smoke.cjs
// ======================================================

const { _electron } = require("playwright-core");
const { mkdirSync } = require("node:fs");

(async () => {
  mkdirSync("smoke-shots", { recursive: true });

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
