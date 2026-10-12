import fs from "node:fs";
import { chromium } from "playwright";
import { loadEnv } from "./load-env";
loadEnv();

/** Playwright screenshots of the production dashboard into docs/screenshots/. */
const BASE = (process.argv[2] || process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT = "docs/screenshots";
const SECTIONS = ["articles", "draft", "voice", "approval", "subscribers", "logs", "how"];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

  await desktop.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await desktop.screenshot({ path: `${OUT}/01-overview-collapsed.png`, fullPage: true });
  console.log("01-overview-collapsed.png");

  for (const [i, id] of SECTIONS.entries()) {
    await desktop.goto(`${BASE}/?open=${id}#${id}`, { waitUntil: "networkidle" });
    // Expand the first row of the section too, to show "details on click".
    const firstRow = desktop.locator(`#${id} details.row > summary`).first();
    if (await firstRow.count()) await firstRow.click();
    if (id === "draft") {
      const preview = desktop.locator("#draft details.nested > summary", { hasText: "Preview email" });
      if (await preview.count()) await preview.click();
    }
    if (id === "articles") {
      const health = desktop.locator("#articles details.nested > summary").first();
      if (await health.count()) await health.click();
    }
    await desktop.locator(`#${id}`).screenshot({ path: `${OUT}/${String(i + 2).padStart(2, "0")}-section-${id}.png` });
    console.log(`${String(i + 2).padStart(2, "0")}-section-${id}.png`);
  }

  await desktop.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await desktop.locator("details.menu > summary").click();
  await desktop.screenshot({ path: `${OUT}/09-run-manually-menu.png` });
  console.log("09-run-manually-menu.png");

  if (process.env.ADMIN_PASSWORD) {
    await desktop.fill('details.menu input[name="password"]', process.env.ADMIN_PASSWORD);
    await desktop.click('details.menu button[type="submit"]');
    await desktop.waitForLoadState("networkidle");
    await desktop.locator("details.menu > summary").click();
    await desktop.screenshot({ path: `${OUT}/10-run-manually-admin.png` });
    console.log("10-run-manually-admin.png");
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await phone.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await phone.screenshot({ path: `${OUT}/11-phone-overview.png`, fullPage: true });
  await phone.goto(`${BASE}/?open=draft#draft`, { waitUntil: "networkidle" });
  await phone.screenshot({ path: `${OUT}/12-phone-draft.png` });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`11/12 phone screenshots (horizontal overflow: ${overflow}px)`);

  const unsub = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await unsub.goto(`${BASE}/unsubscribe?token=tampered.token`, { waitUntil: "networkidle" });
  await unsub.screenshot({ path: `${OUT}/13-unsubscribe-invalid-token.png` });
  console.log("13-unsubscribe-invalid-token.png");
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
