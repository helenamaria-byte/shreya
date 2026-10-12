import { loadEnv } from "./load-env";
loadEnv();

/**
 * Live email check (rubric G3, G5): sends a clearly labelled TEST issue (#0, week_key TEST-SEND-n)
 * that reuses this week's draft stories, through the normal approval gate in `test` mode,
 * to the owner + Resend test addresses. Its week_key never sorts before a real week, so it is
 * never counted as one of the "last four issues". Then waits for the Resend webhooks.
 */
async function main() {
  if (process.env.EMAIL_MODE !== "test") throw new Error("Refusing: EMAIL_MODE must be test");
  const { sql } = await import("../lib/db");
  const { sendIssue, recipients } = await import("../lib/email");
  const { weekKey } = await import("../lib/time");
  const week = weekKey(new Date());
  const current = (await sql`SELECT id, issue_number FROM issues WHERE week_key = ${week}`)[0];
  if (!current) throw new Error("No current issue to copy stories from");
  const n = (await sql`SELECT count(*)::int AS n FROM issues WHERE week_key LIKE 'TEST-SEND-%'`)[0].n + 1;
  const issue = (await sql`INSERT INTO issues (issue_number, week_key, status, approved_at, approved_via, is_sample)
                           VALUES (${-n}, ${`TEST-SEND-${n}`}, 'approved', now(), 'dashboard', true) RETURNING *`)[0];
  await sql`INSERT INTO issue_stories (issue_id, article_id, position, commentary, original_commentary, state, gemini_rationale)
            SELECT ${issue.id}, article_id, position, commentary, original_commentary, 'selected', gemini_rationale
            FROM issue_stories WHERE issue_id = ${current.id} AND state = 'selected'`;
  await sql`INSERT INTO issue_events (issue_id, event, channel, detail) VALUES (${issue.id}, 'approved', 'dashboard', 'Live email test issue (copy of the current draft)')`;
  console.log(`test issue id=${issue.id} (${issue.week_key}) approved; recipients (test mode):`, (await recipients("test")).map((r) => r.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")));

  const r1 = await sendIssue(issue.id, { channel: "system" });
  console.log("first send:", r1);
  const r2 = await sendIssue(issue.id, { channel: "system" });
  console.log("second send (must not claim):", r2);

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const d = await sql`SELECT s.email, s.status AS sub, d.status AS delivery FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id WHERE d.issue_id = ${issue.id} ORDER BY s.id`;
    const done = d.every((x) => x.delivery !== "sent" && x.delivery !== "queued");
    console.log(`t+${(i + 1) * 10}s`, d.map((x) => `${x.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}: delivery=${x.delivery} subscriber=${x.sub}`).join(" | "));
    if (done) break;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
