// Academy audit probe: load every academy flight in the real app
// and dump what the pilot actually sees — verdict tiles, What To Do
// First, each lab's Try This First. Isolated user-data dir.
const { _electron } = require("playwright-core");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbl-academy-"));
  const app = await _electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: { ...process.env, BLACKBOX_LAB_USER_DATA: tmp }
  });
  const w = await app.firstWindow();
  w.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await w.waitForTimeout(1500);
  if (await w.isVisible("#contributeAsk")) await w.click("#askNo");

  const titles = await w.evaluate(() =>
    Array.from(document.querySelectorAll("[data-academy-list] .academy-entry strong")).map(e => e.textContent)
  );
  console.log("academy entries:", JSON.stringify(titles));

  for (let i = 0; i < titles.length; i++) {
    // re-open the academy shelf each round (home re-rendered after load)
    await w.evaluate(() => {
      document.querySelector('[data-target="home"]')?.click();
      const shelf = document.getElementById("academyShelf");
      if (shelf) shelf.open = true;
    });
    await w.waitForTimeout(300);
    const clicked = await w.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll("[data-academy-list] .academy-entry"));
      const row = rows.find(r => r.querySelector("strong")?.textContent === title);
      const btn = row?.querySelector("button.academy-load");
      if (btn) { btn.click(); return true; }
      return false;
    }, titles[i]);
    if (!clicked) { console.log("== " + titles[i] + " == could not click load"); continue; }
    await w.waitForTimeout(4000);

    const report = await w.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll(".verdict-tile")).map(t => ({
        title: t.querySelector(".verdict-item-title")?.textContent?.trim(),
        status: Array.from(t.classList).filter(c => c.startsWith("is-")).join(","),
        text: t.textContent.replace(/\s+/g, " ").trim().slice(0, 160)
      }));
      const first = Array.from(document.querySelectorAll("#firstStepsList *")).length
        ? document.getElementById("firstStepsList").innerText.replace(/\s+/g, " ").slice(0, 500)
        : "(empty)";
      const ttf = {};
      for (const id of ["filterFirstStepText","pidFirstStepText","governorFirstStepText","escFirstStepText","batteryFirstStepText","signalFirstStepText","becFirstStepText"]) {
        const el = document.getElementById(id);
        if (el && el.textContent.trim()) ttf[id.replace("FirstStepText","")] = el.textContent.replace(/\s+/g," ").trim().slice(0,200);
      }
      const pack = document.getElementById("packCard");
      const packText = pack && !pack.hidden ? pack.innerText.replace(/\s+/g, " ").slice(0, 300) : "(hidden)";
      return { tiles, first, ttf, packText };
    });
    console.log("\n== " + titles[i] + " ==");
    for (const t of report.tiles) console.log("  tile:", t.status, "|", t.text);
    console.log("  WTDF:", report.first);
    console.log("  TTF:", JSON.stringify(report.ttf, null, 1));
    console.log("  PACK:", report.packText);
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error("PROBE FAILED:", e.message); process.exit(1); });
