import fs from "node:fs";
import { chromium } from "playwright";
import { loadEnv } from "./load-env";
loadEnv();

/** Playwright screenshots of the dashboard (default: production) into docs/screenshots/. */
const BASE = (process.argv[2] || process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT = process.argv[3] || "docs/screenshots";
const PAGES = [
  ["02-draft", "draft"], ["03-articles", "articles"], ["04-voice", "voice"], ["05-subscribers", "subscribers"],
] as const;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith(".png")) fs.unlinkSync(`${OUT}/${f}`);
  const browser = await chromium.launch();
  const desk = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });

  await desk.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await desk.waitForTimeout(1200); // fonts, stamp animation
  await desk.screenshot({ path: `${OUT}/01-front-page.png`, fullPage: true });
  console.log("01-front-page.png");

  // The page turn: click "View this week's draft" and capture mid-fold, then the landed page.
  await desk.click("a[data-scatter]");
  await desk.waitForTimeout(380);
  await desk.screenshot({ path: `${OUT}/01b-pictures-move-aside.png` });
  await desk.waitForTimeout(260);
  await desk.screenshot({ path: `${OUT}/01c-paper-folding.png` });
  await desk.waitForURL(/p=draft/);
  await desk.waitForTimeout(1500);
  console.log("01b/01c transition frames");

  for (const [name, p] of PAGES) {
    await desk.goto(`${BASE}/?p=${p}`, { waitUntil: "networkidle" });
    await desk.waitForTimeout(900);
    const row = desk.locator(".rows .row > summary").first();
    if (p !== "draft" && (await row.count())) await row.click();
    if (p === "draft") {
      const why = desk.locator(".story .why > summary").first();
      if (await why.count()) await why.click();
    }
    await desk.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(`${name}.png`);
  }

  await desk.goto(`${BASE}/?p=draft`, { waitUntil: "networkidle" });
  const preview = desk.locator("details.nested > summary", { hasText: "printed edition" });
  if (await preview.count()) { await preview.click(); await desk.waitForTimeout(600); await desk.locator("iframe.preview").screenshot({ path: `${OUT}/08-email-preview.png` }); console.log("08-email-preview.png"); }

  await desk.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await desk.locator("details.menu > summary").click();
  await desk.screenshot({ path: `${OUT}/09-run-manually-login.png` });
  if (process.env.ADMIN_PASSWORD) {
    await desk.fill('details.menu input[name="password"]', process.env.ADMIN_PASSWORD);
    await desk.click('details.menu button[type="submit"]');
    await desk.waitForLoadState("networkidle");
    await desk.locator("details.menu > summary").click();
    await desk.screenshot({ path: `${OUT}/10-run-manually-admin.png` });
    await desk.goto(`${BASE}/?p=draft`, { waitUntil: "networkidle" });
    await desk.waitForTimeout(900);
    await desk.locator(".story").nth(1).screenshot({ path: `${OUT}/10b-admin-story-actions.png` });
    console.log("09/10 admin menu, 10b story actions");
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${OUT}/11-phone-front-page.png`, fullPage: true });
  await phone.goto(`${BASE}/?p=draft`, { waitUntil: "networkidle" });
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${OUT}/12-phone-draft.png`, fullPage: false });
  const overflow = await phone.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth) - 390);
  console.log(`11/12 phone (horizontal overflow: ${overflow}px)`);

  const unsub = await browser.newPage({ viewport: { width: 800, height: 520 } });
  await unsub.goto(`${BASE}/unsubscribe?token=tampered.token`, { waitUntil: "networkidle" });
  await unsub.screenshot({ path: `${OUT}/13-unsubscribe-invalid-token.png` });
  console.log("13-unsubscribe-invalid-token.png");
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
