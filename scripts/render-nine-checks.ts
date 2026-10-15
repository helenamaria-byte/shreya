import fs from "node:fs";
import { chromium } from "playwright";

/** "The Nine Checks" slide for The Dispatch → docs/nine-checks.png (+ .html). */
const col = (emoji: string, title: string, color: string, rule: string, items: [string, string][]) => `
  <div class="col">
    <h2 style="color:${color}">${emoji} ${title}</h2>
    <p class="rule">${rule}</p>
    <ul>${items.map(([q, a]) => `<li>${q} <b>YES</b> — ${a}</li>`).join("")}</ul>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  body { margin: 0; background: #e3f2e6; font-family: Manrope, "Segoe UI", Arial, sans-serif; color: #1d2b25; }
  .wrap { width: 1600px; padding: 56px 64px 44px; box-sizing: border-box; }
  h1 { margin: 0 0 40px; font-size: 46px; white-space: nowrap; font-weight: 800; color: #17382e; letter-spacing: -.5px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; }
  h2 { margin: 0 0 10px; font-size: 30px; font-weight: 800; }
  .rule { margin: 0 0 18px; font-style: italic; font-size: 17px; color: #33443c; }
  ul { margin: 0; padding-left: 26px; }
  li { font-size: 22px; line-height: 1.45; margin-bottom: 16px; font-weight: 500; }
  li b { font-weight: 800; }
  hr { border: 0; border-top: 2px solid #8fa596; margin: 26px 0 22px; }
  .killed { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; font-size: 18px; line-height: 1.5; color: #2a3a33; }
  .killed i { color: #17382e; }
</style></head><body><div class="wrap">
  <h1>The Nine Checks — Does The Dispatch Deserve to Be Built?</h1>
  <div class="grid">
    ${col("🛑", "Kill Switches", "#d62f2f", "Any No means: don't build it.", [
      ["01 Problem real?", "Shreya spends four hours a week reading 20+ sources and 60+ articles to make one issue."],
      ["02 Workflow repeated?", "every week, Monday to Thursday. Same read, shortlist, write, assemble."],
      ["03 Input available?", "live RSS, Google News and GNews feeds, her last four issues and her style guide."],
    ])}
    ${col("⚖️", "Sizing", "#e07b12", "Any No means: build something smaller.", [
      ["04 Output valuable?", "a ready draft: 8–10 stories, 3+ topics, 2–3 lines each in her voice, in Telegram by Wednesday."],
      ["05 Impact measurable?", "review time vs four hours, stories kept vs swapped, delivered, bounced and unsubscribed."],
      ["08 ROI worth it?", "free tiers (Gemini Flash, Neon, Vercel, Resend). Built once, runs every week for 2,200 readers."],
    ])}
    ${col("🔒", "Boundary", "#2563d6", "Any No means: put a human exactly here.", [
      ["06 Failure risk OK?", "worst case is a weak draft she swaps or rejects. Nothing is emailed without her confirm."],
      ["07 Judgment protected?", "Gemini shortlists and drafts. Shreya keeps, edits, swaps and confirms every story."],
      ["09 Owner clear?", "the final call on every issue is Shreya's, in her Telegram. The system owns collection and delivery."],
    ])}
  </div>
  <hr>
  <div class="killed">
    <div><i>“Just let Gemini send it every Thursday.”</i> → Killed by 07. The AI drafts. Shreya decides.</div>
    <div><i>“Let anyone approve from the dashboard.”</i> → Killed by 09. Approval lives only in Shreya's Telegram.</div>
  </div>
</div></body></html>`;

async function main() {
  fs.writeFileSync("docs/nine-checks.html", html);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.screenshot({ path: "docs/nine-checks.png", fullPage: true });
  await b.close();
  console.log("docs/nine-checks.png");
}
main().catch((e) => { console.error(e); process.exit(1); });
