// Can a versed user SEE the lesson's evidence? Load the roll and
// weak-FF academy flights, dump the PID lab's full evidence surface
// (events, behavior checks, technical tables) and the Replay/preset
// term data.
const { _electron } = require("playwright-core");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbl-evidence-"));
  const app = await _electron.launch({
    args: ["."], cwd: process.cwd(),
    env: { ...process.env, BLACKBOX_LAB_USER_DATA: tmp }
  });
  const w = await app.firstWindow();
  await w.waitForTimeout(1500);
  if (await w.isVisible("#contributeAsk")) await w.click("#askNo");

  for (const title of ["The roll that always came back", "The heli that leaned on I"]) {
    await w.evaluate(() => {
      document.querySelector('[data-target="home"]')?.click();
      const shelf = document.getElementById("academyShelf");
      if (shelf) shelf.open = true;
    });
    await w.waitForTimeout(300);
    await w.evaluate((t) => {
      const rows = Array.from(document.querySelectorAll("[data-academy-list] .academy-entry"));
      rows.find(r => r.querySelector("strong")?.textContent === t)?.querySelector("button.academy-load")?.click();
    }, title);
    await w.waitForTimeout(4000);

    const report = await w.evaluate(() => {
      // go to PID lab, advanced view on
      document.querySelector('[data-target="pid"]')?.click();
      document.body.classList.add("advanced-mode");
      const txt = (id) => document.getElementById(id)?.innerText?.replace(/\s+/g, " ").trim() ?? "";
      // click first event for detail
      const firstEvent = document.querySelector("#pidEventsList button, #pidEventsList .event-row");
      firstEvent?.click();
      return {
        eventsSummary: txt("pidEventsSummary").slice(0, 400),
        eventsList: txt("pidEventsList").slice(0, 700),
        eventExplain: txt("pidEventExplain").slice(0, 400),
        techFindings: (txt("pidLabSection") || "").slice(0, 1800)
      };
    });
    console.log("\n==== " + title + " ====");
    for (const [k, v] of Object.entries(report)) console.log("--" + k + ":", v || "(empty)");
  }
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error("PROBE FAILED:", e.message); process.exit(1); });
