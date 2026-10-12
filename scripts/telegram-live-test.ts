import fs from "node:fs";
import { loadEnv } from "./load-env";
loadEnv();

/**
 * Live Telegram check against production (rubric E1–E5):
 *  1. Admin "Run selection" (force) → real Gemini draft delivered to Telegram.
 *  2. Posts signed test updates to the deployed webhook: edit (button + reply), /edit, swap, reject,
 *     approve (ask + confirm), edit-after-approval revocation, plus wrong secret / wrong chat.
 *  3. Verifies every DB change, then regenerates a fresh pending draft for Shreya.
 */
const BASE = process.env.APP_BASE_URL!;
const CHAT = Number(process.env.TELEGRAM_CHAT_ID);
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };

async function main() {
  const { sql } = await import("../lib/db");
  const { weekKey } = await import("../lib/time");
  const week = weekKey(new Date());

  const lf = new FormData(); lf.set("password", process.env.ADMIN_PASSWORD!);
  const cookie = ((await fetch(`${BASE}/api/admin/login`, { method: "POST", body: lf, redirect: "manual" })).headers.get("set-cookie") || "").split(";")[0];
  const admin = async (fields: Record<string, string>) => {
    const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return (await (await fetch(`${BASE}/api/admin/action`, { method: "POST", body: f, headers: { cookie, accept: "application/json" } })).json()) as any;
  };
  let n = 1000;
  const post = async (update: object, secret = process.env.TELEGRAM_WEBHOOK_SECRET!) => {
    const res = await fetch(`${BASE}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ update_id: ++n, ...update }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const cb = (data: string, chat = CHAT) => ({ callback_query: { id: `test-${n}`, data, from: { id: chat }, message: { message_id: 1, chat: { id: chat } } } });
  const msg = (text: string, chat = CHAT) => ({ message: { message_id: n, text, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, from: { id: chat } } });
  const issue = async () => (await sql`SELECT * FROM issues WHERE week_key = ${week}`)[0];
  const stories = async (id: number) => sql`SELECT s.id, s.position, s.state, s.commentary, a.title FROM issue_stories s JOIN articles a ON a.id = s.article_id WHERE s.issue_id = ${id} AND s.state = 'selected' ORDER BY s.position`;

  say(`# Live Telegram test — ${new Date().toISOString()} — ${BASE}`);
  const d1 = await admin({ action: "run_draft", force: "on" });
  say(`1. run_draft (force) → ${d1.message}`);
  let is = await issue();
  say(`   issue #${is.issue_number} status=${is.status} draft_sent_to_telegram_at=${is.draft_sent_to_telegram_at}`);
  let st = await stories(is.id);

  const bad1 = await post(cb(`ay:${is.id}`), "wrong-secret");
  const bad2 = await post(cb(`ay:${is.id}`, 1));
  say(`2. wrong secret → HTTP ${bad1.status}; wrong chat → ${JSON.stringify(bad2.body)}; status still ${(await issue()).status}`);

  say(`3. ✏️ Edit story 1 → ${JSON.stringify((await post(cb(`e:${st[0].id}`))).body)}`);
  say(`   reply → ${JSON.stringify((await post(msg("Test edit from the live check: this replaces Gemini's commentary. It should appear in Neon immediately."))).body)}`);
  say(`   DB story 1 commentary: "${(await sql`SELECT commentary FROM issue_stories WHERE id = ${st[0].id}`)[0].commentary}"`);
  say(`4. /edit 2 → ${JSON.stringify((await post(msg("/edit 2 Edited with the /edit command. Two sentences, as required."))).body)}`);
  say(`   DB story 2 commentary: "${(await sql`SELECT commentary FROM issue_stories WHERE id = ${st[1].id}`)[0].commentary}"`);

  const before3 = st[2];
  say(`5. 🔄 Swap story 3 ("${before3.title}") → ${JSON.stringify((await post(cb(`s:${before3.id}`))).body)}`);
  const after = await stories(is.id);
  say(`   DB: old story state=${(await sql`SELECT state FROM issue_stories WHERE id = ${before3.id}`)[0].state}; position 3 is now "${after[2].title}"`);

  say(`6. ❌ Reject story 4 ("${after[3].title}") → ${JSON.stringify((await post(cb(`r:${after[3].id}`))).body)}`);
  say(`   DB: state=${(await sql`SELECT state FROM issue_stories WHERE id = ${after[3].id}`)[0].state}; selected stories now ${(await stories(is.id)).length}`);

  say(`7. ✅ Approve → ${JSON.stringify((await post(cb(`a:${is.id}`))).body)}; status still ${(await issue()).status} (confirmation asked)`);
  say(`   Yes → ${JSON.stringify((await post(cb(`ay:${is.id}`))).body)}`);
  is = await issue();
  say(`   DB: status=${is.status} approved_at=${is.approved_at} approved_via=${is.approved_via}`);

  say(`8. Edit after approval → ${JSON.stringify((await post(msg("/edit 1 A change after approval. It must revoke the approval."))).body)}`);
  is = await issue();
  say(`   DB: status=${is.status} approved_at=${is.approved_at}`);
  say(`9. /status → ${JSON.stringify((await post(msg("/status"))).body)}`);

  const ev = await sql`SELECT event, channel, detail FROM issue_events WHERE issue_id = ${is.id} ORDER BY id DESC LIMIT 10`;
  say(`   latest events: ${ev.map((e) => `${e.event}(${e.channel})`).reverse().join(" → ")}`);

  const d2 = await admin({ action: "run_draft", force: "on" });
  is = await issue();
  say(`10. fresh draft for Shreya → ${d2.message}`);
  say(`    issue #${is.issue_number} status=${is.status} (left pending for manual approval in Telegram)`);
  fs.writeFileSync("docs/evidence/telegram-live-test.txt", log.join("\n") + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
