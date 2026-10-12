import { loadEnv } from "./load-env";
loadEnv();

/**
 * One-off repair: bring this week's draft back to the brief's minimum (8 stories, 3+ topics)
 * after rejects left it short, revoke any approval it got while short, and resend it to Telegram.
 */
async function main() {
  const { sql } = await import("../lib/db");
  const { addReplacement, draftHealth, getStories, logEvent, revokeApprovalIfApproved } = await import("../lib/issues");
  const { MIN_STORIES, MIN_TOPICS } = await import("../lib/editorial");
  const { send, sendDraft } = await import("../lib/telegram");
  const { weekKey } = await import("../lib/time");

  const issue = (await sql`SELECT * FROM issues WHERE week_key = ${weekKey(new Date())}`)[0];
  if (!issue) throw new Error("no issue this week");
  let h = draftHealth(await getStories(issue.id));
  console.log(`before: issue #${issue.issue_number} ${issue.status}, ${h.count} stories, ${h.topics.length} topics`);
  if (h.count >= MIN_STORIES && h.topics.length >= MIN_TOPICS) { console.log("nothing to do"); return; }

  const revoked = await revokeApprovalIfApproved(issue.id, "system", `Draft had ${h.warnings.join(" and ")}; topped up to meet the 8–10 stories / 3+ topics rule`);
  const added: string[] = [];
  while (h.count < MIN_STORIES || (h.topics.length < MIN_TOPICS && h.count < 10)) {
    const r = await addReplacement(issue.id, "system");
    added.push(`${r.newStory.position}. ${r.newStory.title} (${r.newStory.topic}, ${r.via})`);
    h = draftHealth(await getStories(issue.id));
  }
  await logEvent(issue.id, "story_added", "system", `Topped up to ${h.count} stories, ${h.topics.length} topics`);
  console.log(`revoked approval: ${revoked}`);
  console.log(`added:\n  ${added.join("\n  ")}`);
  console.log(`after: ${h.count} stories, ${h.topics.length} topics (${h.topics.join(", ")})`);

  await send(
    `ℹ️ <b>Issue #${issue.issue_number} was topped back up to ${h.count} stories.</b>\n` +
    `After the rejects it had fewer than 8 stories, and the newsletter must have 8–10 stories across at least 3 topics, so ${added.length} replacement${added.length === 1 ? " was" : "s were"} added from the reserves / this week's unused articles.` +
    `${revoked ? "\nYour earlier approval was revoked because the draft changed — please review the new stories and confirm again." : ""}\nThe full draft follows.`,
  );
  await sendDraft(issue.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
