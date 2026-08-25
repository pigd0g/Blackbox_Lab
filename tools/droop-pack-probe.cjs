const { _electron } = require("playwright-core");
const os = require("node:os"); const path = require("node:path"); const fs = require("node:fs");
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bbl-droop-"));
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
  const out = await w.evaluate(() => {
    const t = (id) => document.getElementById(id)?.innerText?.replace(/\s+/g," ").trim() ?? "(missing)";
    return {
      pack: t("packCard").slice(0, 600),
      snippetHidden: document.getElementById("packSnippetFold")?.hidden,
      snippetText: t("packSnippetText").slice(0, 400),
      revertHidden: document.getElementById("packRevertFold")?.hidden
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await app.close(); fs.rmSync(tmp, {recursive:true, force:true});
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
