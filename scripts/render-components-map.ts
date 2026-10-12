import fs from "node:fs";
import { chromium } from "playwright";

/**
 * Renders the Components Map as a swimlane grid (actors × Trigger/Input/Context/Processing/AI/Output)
 * with dashed arrows following one weekly issue. Output: docs/components-map.png (+ .html source).
 */
const W = 2000, H = 1440;
const LEFT = 38, ACTOR_W = 225, TOP = 176, ROW_H = 147.5, RIGHT = 1962;
const COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"];
const COL_W = (RIGHT - (LEFT + ACTOR_W)) / COLS.length;
const BOX_W = 248, BOX_H = 112;

type Row = { name: string; sub: string; bg: string; fill: string; border: string };
const ROWS: Row[] = [
  { name: "Code & Schedule", sub: "(GitHub, Vercel Cron)", bg: "#e6ecf8", fill: "#dfe7fb", border: "#3d7bd9" },
  { name: "News Sources", sub: "(RSS, Google News, GNews)", bg: "#e6ecf8", fill: "#d8e9f9", border: "#2f87d6" },
  { name: "Database", sub: "(Neon Postgres)", bg: "#e5f2e5", fill: "#d4edd6", border: "#2e9e4a" },
  { name: "AI Editor", sub: "(Gemini Flash)", bg: "#eee5f8", fill: "#e5dbfa", border: "#7a4fd6" },
  { name: "Review", sub: "(Telegram Bot)", bg: "#e2f2ee", fill: "#ffffff", border: "#d63c3c" },
  { name: "System", sub: "(App on Vercel)", bg: "#fdf6e4", fill: "#fcecc1", border: "#d9a21b" },
  { name: "Email Service", sub: "(Resend)", bg: "#fce8ef", fill: "#f8d6e2", border: "#d63c6d" },
  { name: "People", sub: "(Shreya, Subscribers)", bg: "#fcefe5", fill: "#ffffff", border: "#d63c3c" },
];
const RED = "#d63c3c";

// [row, col, text, override border/fill]
const BOXES: { id: string; row: number; col: number; text: string; fill?: string; border?: string }[] = [
  { id: "code", row: 0, col: 0, text: "Code on GitHub deploys to Vercel. Cron (IST): Mon–Wed ingest, Wed 3 PM draft, Wed 10 PM reminder, Thu 8 AM send." },
  { id: "news", row: 1, col: 1, text: "Live Indian startup news: 15 RSS feeds, 4 Google News searches and 6 GNews queries." },
  { id: "db", row: 2, col: 2, text: "Stores each article once. Drops repeats and stories from the last 4 issues. Holds the voice guide." },
  { id: "ai", row: 3, col: 4, text: "Tags topics, picks 8–10 stories across 3+ topics, writes 2–3 lines in Shreya's voice. No invented facts." },
  { id: "review", row: 4, col: 3, text: "Draft sent to Shreya: keep, edit, swap or reject each story, then confirm. Reminder Wed 10 PM." },
  { id: "s1", row: 5, col: 0, text: "Approval recorded (Telegram only). Thu 8 AM cron starts the send job (secret-checked)." },
  { id: "s2", row: 5, col: 1, text: "Approved draft and active subscribers; unsubscribed, bounced and spam removed." },
  { id: "s3", row: 5, col: 2, text: "Approval gate: sends only if status is 'approved'. Otherwise sends nothing." },
  { id: "s4", row: 5, col: 3, text: "Builds the email. One send per issue, no duplicates. Logs every run." },
  { id: "dash", row: 5, col: 5, text: "Dashboard (view only): Overview, Draft, Articles, Voice, Subscribers. Any article → Send to Telegram.", fill: "#ffffff", border: RED },
  { id: "email", row: 6, col: 5, text: "Sends The Dispatch Thursday. One-click unsubscribe. Bounces and spam logged in Neon." },
  { id: "people", row: 7, col: 5, text: "Subscribers read the issue. Shreya gets the delivery report in Telegram, Thu 6 PM.", fill: "#ffffff", border: RED },
];

const colX = (c: number) => LEFT + ACTOR_W + c * COL_W;
const rowY = (r: number) => TOP + r * ROW_H;
const box = (id: string) => {
  const b = BOXES.find((x) => x.id === id)!;
  const x = colX(b.col) + (COL_W - BOX_W) / 2, y = rowY(b.row) + (ROW_H - BOX_H) / 2;
  return { l: x, r: x + BOX_W, t: y, b: y + BOX_H, cx: x + BOX_W / 2, cy: y + BOX_H / 2 };
};

// Dashed paths (orthogonal), each ending in an arrowhead.
const P: string[] = [];
const path = (pts: [number, number][]) => P.push(pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
{
  const a = box("code"), b = box("news"), x = colX(1) - 4;
  path([[a.r, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]]);
}
{
  const a = box("news"), b = box("db"), x = colX(2) - 4;
  path([[a.r, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]]);
}
{
  const a = box("db"), b = box("ai");
  path([[a.r, a.cy], [b.cx, a.cy], [b.cx, b.t]]);
}
{
  const a = box("ai"), b = box("review"), y = rowY(4);
  path([[a.cx, a.b], [a.cx, y], [b.cx, y], [b.cx, b.t]]);
}
{
  const a = box("review"), b = box("s1"), y = rowY(5);
  path([[a.cx, a.b], [a.cx, y], [b.cx, y], [b.cx, b.t]]);
}
for (const [f, t] of [["s1", "s2"], ["s2", "s3"], ["s3", "s4"], ["s4", "dash"]]) {
  const a = box(f), b = box(t);
  path([[a.r, a.cy], [b.l, b.cy]]);
}
{
  const a = box("s4"), b = box("email");
  path([[a.cx, a.b], [a.cx, b.cy], [b.l, b.cy]]);
}
{
  const a = box("email"), b = box("people");
  path([[a.cx, a.b], [b.cx, b.t]]);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #fff; font-family: "DejaVu Sans", Verdana, "Segoe UI", sans-serif; }
  .stage { position: relative; width: ${W}px; height: ${H}px; }
  .title { position: absolute; top: 26px; left: 0; right: 0; text-align: center; font-size: 40px; font-weight: 700; color: #1b2c4b; letter-spacing: .3px; }
  .head { position: absolute; top: 100px; left: ${LEFT}px; width: ${RIGHT - LEFT}px; height: 65px; background: #172b4d; border-radius: 9px; }
  .head span { position: absolute; top: 0; height: 65px; line-height: 65px; text-align: center; color: #fff; font-size: 25px; }
  .row { position: absolute; left: ${LEFT + ACTOR_W}px; width: ${RIGHT - LEFT - ACTOR_W}px; height: ${ROW_H - 2}px; }
  .vline { position: absolute; top: ${TOP}px; width: 2px; height: ${ROWS.length * ROW_H}px; background: rgba(255,255,255,.85); }
  .actor { position: absolute; left: ${LEFT}px; width: ${ACTOR_W}px; height: ${ROW_H - 2}px; background: #172b4d; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .actor b { font-size: 21px; letter-spacing: .1px; white-space: nowrap; }
  .actor small { font-size: 16px; color: #d7deea; margin-top: 8px; }
  .box { position: absolute; width: ${BOX_W}px; height: ${BOX_H}px; border: 3px solid; border-radius: 12px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px 12px; font-size: 15.5px; line-height: 1.3; color: #1b2c4b; }
  .note { position: absolute; top: ${TOP + ROWS.length * ROW_H + 26}px; left: ${LEFT}px; font-size: 18px; color: #5f6b7a; }
  svg { position: absolute; inset: 0; }
</style></head><body><div class="stage">
  <div class="title">The Dispatch · Newsletter Intelligence Engine — Components Map</div>
  <div class="head">
    <span style="left:0;width:${ACTOR_W}px">Actor</span>
    ${COLS.map((c, i) => `<span style="left:${ACTOR_W + i * COL_W}px;width:${COL_W}px">${c}</span>`).join("")}
  </div>
  ${ROWS.map((r, i) => `<div class="row" style="top:${rowY(i)}px;background:${r.bg}"></div>
  <div class="actor" style="top:${rowY(i)}px"><b>${r.name}</b><small>${r.sub}</small></div>`).join("\n  ")}
  ${COLS.slice(1).map((_, i) => `<div class="vline" style="left:${colX(i + 1) - 1}px"></div>`).join("")}
  ${BOXES.map((b) => {
    const p = box(b.id), r = ROWS[b.row];
    return `<div class="box" style="left:${p.l}px;top:${p.t}px;background:${b.fill ?? r.fill};border-color:${b.border ?? r.border}">${b.text}</div>`;
  }).join("\n  ")}
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#172b4d"/></marker></defs>
    ${P.map((d) => `<path d="${d}" fill="none" stroke="#172b4d" stroke-width="2.6" stroke-dasharray="9 7" marker-end="url(#arrow)"/>`).join("\n    ")}
  </svg>
  <div class="note">Dashed arrows follow one weekly issue from collection to the inbox. Red boxes are what Shreya and subscribers see. Nothing is emailed without her approval in Telegram.</div>
</div></body></html>`;

async function main() {
  fs.writeFileSync("docs/components-map.html", html);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.waitForTimeout(300);
  await p.screenshot({ path: "docs/components-map.png", clip: { x: 0, y: 0, width: W, height: H } });
  await b.close();
  console.log(`docs/components-map.png (${W * 2}x${H * 2}), ${Math.round(fs.statSync("docs/components-map.png").size / 1024)} KB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
