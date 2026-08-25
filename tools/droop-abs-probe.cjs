const { _electron } = require("playwright-core");
const os = require("node:os"); const path = require("node:path"); const fs = require("node:fs");
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbl-dabs-"));
  const dumpText = fs.readFileSync("samples/sample-academy-governor-droop.dump.txt", "utf8");
  const app = await _electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, BLACKBOX_LAB_USER_DATA: tmp } });
  const w = await app.firstWindow();
  await w.waitForTimeout(1500);
  if (await w.isVisible("#contributeAsk")) await w.click("#askNo");
  await w.evaluate(() => { document.getElementById("academyShelf").open = true; });
  await w.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-academy-list] .academy-entry"));
    rows.find(r => r.querySelector("strong")?.textContent === "The headspeed that gave way")?.querySelector("button.academy-load")?.click();
  });
  await w.waitForTimeout(4500);
  await w.evaluate(() => document.querySelector("#unlockDumpCard button")?.click());
  await w.waitForTimeout(300);
  await w.evaluate((text) => {
    const ta = document.getElementById("craftDumpPaste");
    ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, dumpText);
  await w.waitForTimeout(400);
  await w.evaluate(() => document.getElementById("craftCardSave")?.click());
  await w.waitForTimeout(900);
  const out = await w.evaluate(() => {
    const t = (id) => document.getElementById(id)?.innerText?.replace(/\s+/g," ").trim() ?? "(missing)";
    return {
      dumpNoteHidden: document.getElementById("packDumpNote")?.hidden,
      pack: t("packCard").slice(0, 450),
      snippetHidden: document.getElementById("packSnippetFold")?.hidden,
      snippet: (document.getElementById("packSnippetText")?.textContent ?? "").replace(/\n/g," | ").slice(0, 350),
      revertHidden: document.getElementById("packRevertFold")?.hidden,
      revert: t("packRevertText").slice(0, 200)
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await app.close(); fs.rmSync(tmp, {recursive:true, force:true});
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
