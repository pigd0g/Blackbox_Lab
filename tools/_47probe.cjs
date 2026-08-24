const { _electron } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const outDir = path.resolve("smoke-shots");
  const app = await _electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, BLACKBOX_LAB_SMOKE_PDF_DIR: outDir } });
  const window = await app.firstWindow();
  await window.waitForTimeout(1200);
  if (await window.isVisible("#contributeAsk")) await window.click("#askNo");
  await window.setInputFiles("#logFileInput", "/home/offenbeck1/egodrift/docs/reports/blackbox/stefano-tron70-8runs.bbl");
  await window.waitForSelector("#loadProgressActions:not([hidden])", { timeout: 120000 }).catch(() => {});
  if (await window.isVisible("#loadGoOverview")) await window.click("#loadGoOverview");
  await window.waitForTimeout(1200);
  if (await window.isVisible("#craftCardLater").catch(() => false)) await window.click("#craftCardLater").catch(() => {});
  await window.selectOption("#flightSelect", "0");
  await window.waitForSelector("#loadProgressActions:not([hidden])", { timeout: 120000 }).catch(() => {});
  if (await window.isVisible("#loadGoOverview")) await window.click("#loadGoOverview");
  await window.waitForTimeout(2000);
  const texts = await window.evaluate(() => ({
    profileNote: document.getElementById("pidProfileNote")?.textContent?.trim() ?? null,
    profileCardVisible: document.getElementById("pidProfileCard")?.offsetParent !== null,
    pidVerdict: document.getElementById("pidVerdictStory")?.textContent?.trim().slice(0, 260),
    technicalRankLine: [...document.querySelectorAll("#pidAnalysisFindings, [id*=pidAnalysis]")].map((n) => n.textContent).join(" ").match(/[^.]*RPM showed the lowest observed[^.]*\./)?.[0] ?? null
  }));
  console.log(JSON.stringify(texts, null, 1));
  // PDF
  await window.click('.nav-button[data-target="reports"]');
  await window.waitForTimeout(300);
  for (const stale of fs.readdirSync(outDir)) if (/\.pdf$/.test(stale)) fs.unlinkSync(path.join(outDir, stale));
  await window.click("#buildReportButton");
  await window.waitForFunction(() => /Report saved|could not|not saved/.test(document.getElementById("reportStatus")?.textContent ?? ""), null, { timeout: 90000 });
  const pdfName = fs.readdirSync(outDir).find((n) => /\.pdf$/.test(n));
  const text = execFileSync("pdftotext", [path.join(outDir, pdfName), "-"]).toString().replace(/\s+/g, " ");
  console.log("PDF ranking:", text.match(/[^.]*1830 RPM[^.]*\./g)?.slice(0, 2) ?? "none");
  await app.close();
})();
