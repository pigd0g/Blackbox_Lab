const { _electron } = require("playwright-core");
const os = require("node:os"); const path = require("node:path"); const fs = require("node:fs");
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbl-repro-"));
  const dumpText = fs.readFileSync("samples/sample-academy-stale-dump.dump.txt", "utf8");
  const app = await _electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, BLACKBOX_LAB_USER_DATA: tmp } });
  const w = await app.firstWindow();
  await w.waitForTimeout(1500);
  if (await w.isVisible("#contributeAsk")) await w.click("#askNo");
  await w.evaluate(() => { document.getElementById("academyShelf").open = true; });
  await w.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-academy-list] .academy-entry"));
    rows.find(r => r.querySelector("strong")?.textContent === "The dump that lied")?.querySelector("button.academy-load")?.click();
  });
  await w.waitForTimeout(4500);
  const txt = (sel) => w.evaluate((s) => document.querySelector(s)?.innerText?.replace(/\s+/g," ").trim() ?? "(missing)", sel);
  console.log("BEFORE pack:", (await txt("#packCard")).slice(0, 260));
  console.log("unlock card hidden:", await w.evaluate(() => document.getElementById("unlockDumpCard")?.hidden));

  // open the craft panel the way the unlock card does
  const opened = await w.evaluate(() => {
    const btn = document.querySelector("#unlockDumpCard button");
    if (btn) { btn.click(); return "via unlock button"; }
    return "no unlock button";
  });
  console.log("panel open:", opened, "| overlay hidden:", await w.evaluate(() => document.getElementById("craftCardAsk")?.hidden));

  // paste + fire input event + save
  await w.evaluate((text) => {
    const ta = document.getElementById("craftDumpPaste");
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, dumpText);
  await w.waitForTimeout(400);
  console.log("staged status:", await txt("#craftDumpStatus"));
  await w.evaluate(() => document.getElementById("craftCardSave")?.click());
  await w.waitForTimeout(800);

  console.log("AFTER pack:", (await txt("#packCard")).slice(0, 500));
  console.log("dumpNote hidden:", await w.evaluate(() => document.getElementById("packDumpNote")?.hidden), "| text:", (await txt("#packDumpNote")).slice(0,200));
  console.log("snippet fold hidden:", await w.evaluate(() => document.getElementById("packSnippetFold")?.hidden));
  console.log("note color:", await w.evaluate(() => getComputedStyle(document.getElementById("packDumpNote")).color));
  console.log("fileStatus:", await w.evaluate(() => document.getElementById("fileStatus")?.textContent ?? document.querySelector(".file-status")?.textContent ?? "(?)"));
  // ---- act two: the FRESH dump clears the flag ----
  const freshText = fs.readFileSync("samples/sample-academy-stale-dump.fresh.dump.txt", "utf8");
  await w.evaluate(() => document.getElementById("packDumpUpdateButton")?.click());
  await w.waitForTimeout(400);
  await w.evaluate((text) => {
    const ta = document.getElementById("craftDumpPaste");
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, freshText);
  await w.waitForTimeout(400);
  await w.evaluate(() => document.getElementById("craftCardSave")?.click());
  await w.waitForTimeout(800);
  console.log("FRESH: dumpNote hidden:", await w.evaluate(() => document.getElementById("packDumpNote")?.hidden));
  console.log("FRESH: fileStatus:", await w.evaluate(() => document.getElementById("fileStatus")?.textContent));
  console.log("FRESH: pack:", (await txt("#packCard")).slice(0, 250));
  await app.close(); fs.rmSync(tmp, {recursive:true, force:true});
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
