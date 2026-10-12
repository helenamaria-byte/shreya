import { query, sql } from "./db";
import {
  candidates, checkCommentary, latestVoiceGuide, pastHeadlines, selectStories, sufficiency, writeCommentary,
} from "./editorial";
import { previewEmail, recipients, sendIssue, effectiveMode } from "./email";
import { ingest } from "./ingest";
import { getOrCreateIssue, getIssueByWeek, getStories, logEvent, type Channel } from "./issues";
import { BROKEN_TEST_SOURCE } from "./sources";
import { send, sendDraft } from "./telegram";
import { istParts, now, scheduleGate, weekKey, type Job } from "./time";
import { distinctTopics } from "./topics";

export type Trigger = "cron" | "manual" | "test";
export type JobResult = { runId: number; status: "success" | "failed" | "skipped"; summary: string; details: Record<string, unknown> };

type Outcome = { status: "success" | "skipped"; summary: string; details?: Record<string, unknown> };

/** Every run writes a workflow_runs row (start, finish, status, summary, details). */
async function recordRun(job: string, trigger: Trigger, at: Date, simulated: boolean, fn: () => Promise<Outcome>): Promise<JobResult> {
  const run = await sql`INSERT INTO workflow_runs (job, trigger, simulated_now) VALUES (${job}, ${trigger}, ${simulated ? at.toISOString() : null}) RETURNING id`;
  const runId = run[0].id as number;
  try {
    const out = await fn();
    const details = { ...(out.details ?? {}), ...(simulated ? { simulated_now: at.toISOString() } : {}) };
    await sql`UPDATE workflow_runs SET finished_at = now(), status = ${out.status}, summary = ${out.summary}, details = ${JSON.stringify(details)} WHERE id = ${runId}`;
    return { runId, status: out.status, summary: out.summary, details };
  } catch (e: any) {
    const summary = `Failed: ${String(e?.message || e).slice(0, 300)}`;
    await sql`UPDATE workflow_runs SET finished_at = now(), status = 'failed', summary = ${summary}, details = ${JSON.stringify({ error: String(e?.stack || e).slice(0, 2000) })} WHERE id = ${runId}`;
    return { runId, status: "failed", summary, details: { error: String(e?.message || e) } };
  }
}

/** Cron and simulated runs obey the IST schedule; a plain manual run of ingest/draft is a deliberate override. */
function gate(job: Job, trigger: Trigger, at: Date, simulated: boolean, force = false) {
  const g = scheduleGate(job, at);
  const enforce = job === "reminder" || job === "send" || trigger === "cron" || simulated || (trigger === "test" && !force);
  return enforce && !g.act ? g : null;
}

async function notify(text: string, keyboard?: Parameters<typeof send>[1]) {
  if (!process.env.TELEGRAM_CHAT_ID) return "skipped: TELEGRAM_CHAT_ID not set";
  try { await send(text, keyboard); return "sent"; } catch (e: any) { return `failed: ${e.message}`; }
}

/** Articles fetched Thursday–Sunday belong to next week's issue (this week's has already been drafted and sent). */
export function collectionAt(at: Date): Date {
  return istParts(at).weekday >= 4 ? new Date(at.getTime() + (8 - istParts(at).weekday) * 86400000) : at;
}

// ---------------------------------------------------------------------------
export async function runIngest(o: { trigger: Trigger; at?: Date; simulated?: boolean; includeBrokenFeed?: boolean; force?: boolean }) {
  const at = o.at ?? now();
  return recordRun("ingest", o.trigger, at, !!o.simulated, async () => {
    const blocked = gate("ingest", o.trigger, at, !!o.simulated, o.force);
    if (blocked) return { status: "skipped", summary: `Skipped: ${blocked.reason}` };
    const effective = collectionAt(at);
    await getOrCreateIssue(weekKey(effective));
    const r = await ingest(effective, { extraSources: o.includeBrokenFeed ? [BROKEN_TEST_SOURCE] : [] });
    const failed = r.perSource.filter((s) => s.status === "failed");
    return {
      status: "success",
      summary: `${r.inserted} new articles from ${r.perSource.length - failed.length}/${r.perSource.length} sources · ${r.dedup.sameUrl + r.dedup.similarTitle} duplicates · ${r.dedup.pastIssue} covered before · ${failed.length} feed(s) failed`,
      details: r as unknown as Record<string, unknown>,
    };
  });
}

// ---------------------------------------------------------------------------
export async function runDraft(o: { trigger: Trigger; at?: Date; simulated?: boolean; draftAnyway?: boolean; force?: boolean; channel?: Channel }) {
  const at = o.at ?? now();
  return recordRun("draft", o.trigger, at, !!o.simulated, async () => {
    const blocked = gate("draft", o.trigger, at, !!o.simulated, o.force || o.draftAnyway);
    if (blocked) return { status: "skipped", summary: `Skipped: ${blocked.reason}` };
    const week = weekKey(at);
    const issue = await getOrCreateIssue(week);
    const regenerable = ["collecting", "insufficient_stories", "drafting"];
    if (o.force) regenerable.push("pending_approval", "rejected");
    if (!regenerable.includes(issue.status)) {
      return { status: "skipped", summary: `Skipped: issue #${issue.issue_number} is already ${issue.status.replace(/_/g, " ")}` };
    }

    const cands = await candidates(week);
    const suff = sufficiency(cands);
    if (!suff.enough && !o.draftAnyway) {
      await sql`UPDATE issues SET status = 'insufficient_stories' WHERE id = ${issue.id}`;
      await logEvent(issue.id, "insufficient_stories", o.channel ?? "cron", `${suff.count} candidates across ${suff.topics.length} topics`);
      const tg = await notify(
        `⚠️ <b>Not enough stories for issue #${issue.issue_number} yet.</b>\n` +
        `This week has ${suff.count} usable candidates across ${suff.topics.length} topic(s) (${suff.topics.join(", ") || "none"}). ` +
        `The bar is 12 candidates and 3 topics.\n\nDraft anyway with what's available?`,
        [[{ text: "📝 Draft anyway", callback_data: `d:${issue.id}` }]],
      );
      return { status: "success", summary: `Insufficient stories: ${suff.count} candidates, ${suff.topics.length} topics — asked Shreya (Telegram ${tg})`, details: { sufficiency: suff } };
    }
    if (!cands.length) throw new Error("No candidates at all this week");

    await sql`UPDATE issues SET status = 'drafting' WHERE id = ${issue.id}`;
    try {
      const voice = await latestVoiceGuide();
      const past = await pastHeadlines(week);
      const sel = await selectStories(cands, voice?.content ?? "", past);
      const byId = new Map(cands.map((c) => [c.id, c]));
      const toWrite = [...sel.selection.selected.map((s) => s.article_id), ...sel.selection.reserves.map((r) => r.article_id)].map((id) => byId.get(id)!);
      const commentary = await writeCommentary(toWrite, voice?.content ?? "");

      const rows = [
        ...sel.selection.selected.map((s) => ({ id: s.article_id, state: "selected", position: s.position, rank: null as number | null, rationale: s.rationale, connects: s.connects_with ?? null })),
        ...sel.selection.reserves.map((r) => ({ id: r.article_id, state: "reserve", position: null as number | null, rank: r.rank, rationale: r.rationale, connects: null })),
      ].map((r) => {
        const a = byId.get(r.id)!;
        const raw = commentary.get(r.id) ?? "";
        const check = raw ? checkCommentary(raw, `${a.title} ${a.summary ?? ""}`) : { commentary: "", needsReview: true, notes: ["Gemini returned no commentary"] };
        return { ...r, commentary: check.commentary, needsReview: check.needsReview, notes: check.notes.join("; ") || null };
      });

      await sql`DELETE FROM telegram_pending_actions WHERE issue_story_id IN (SELECT id FROM issue_stories WHERE issue_id = ${issue.id})`;
      await sql`DELETE FROM issue_stories WHERE issue_id = ${issue.id}`;
      await query(
        `INSERT INTO issue_stories (issue_id, article_id, state, position, reserve_rank, gemini_rationale, connects_with, commentary, original_commentary, needs_review, review_notes)
         SELECT $1::int, * FROM unnest($2::int[], $3::text[], $4::int[], $5::int[], $6::text[], $7::text[], $8::text[], $8::text[], $9::boolean[], $10::text[])`,
        [issue.id, rows.map((r) => r.id), rows.map((r) => r.state), rows.map((r) => r.position), rows.map((r) => r.rank), rows.map((r) => r.rationale),
          rows.map((r) => r.connects), rows.map((r) => r.commentary), rows.map((r) => r.needsReview), rows.map((r) => r.notes)],
      );
      await sql`UPDATE issues SET status = 'pending_approval', approved_at = NULL, approved_via = NULL, reminder_sent_at = NULL, draft_sent_to_telegram_at = NULL WHERE id = ${issue.id}`;
      const selected = rows.filter((r) => r.state === "selected");
      const topics = distinctTopics(selected.map((r) => byId.get(r.id)!.topic));
      await logEvent(issue.id, "draft_created", o.channel ?? (o.trigger === "cron" ? "cron" : "dashboard"),
        `${selected.length} stories, ${topics.length} topics, ${rows.filter((r) => r.needsReview).length} need review${sel.repairLog.length ? "; repaired: " + sel.repairLog.join(", ") : ""}`);

      let telegram = "skipped: TELEGRAM_CHAT_ID not set";
      if (process.env.TELEGRAM_CHAT_ID) {
        try { await sendDraft(issue.id); telegram = "sent"; } catch (e: any) { telegram = `failed: ${e.message}`; }
      }
      return {
        status: "success",
        summary: `Issue #${issue.issue_number}: ${selected.length} stories across ${topics.length} topics from ${cands.length} candidates · Telegram ${telegram}`,
        details: {
          issue: issue.issue_number, candidates: cands.length, topics, telegram, geminiCalls: sel.geminiCalls + 1,
          validation: sel.attempts, repairLog: sel.repairLog, voiceGuideVersion: voice?.version,
          selected: selected.map((r) => ({ position: r.position, title: byId.get(r.id)!.title, topic: byId.get(r.id)!.topic, source: byId.get(r.id)!.source_name, rationale: r.rationale, connects_with: r.connects, commentary: r.commentary, needs_review: r.needsReview, notes: r.notes })),
          reserves: rows.filter((r) => r.state === "reserve").map((r) => ({ rank: r.rank, title: byId.get(r.id)!.title, topic: byId.get(r.id)!.topic })),
        },
      };
    } catch (e) {
      await sql`UPDATE issues SET status = 'collecting' WHERE id = ${issue.id} AND status = 'drafting'`;
      await notify(`⚠️ Drafting issue #${issue.issue_number} failed: ${String((e as Error).message).slice(0, 200)}. It will be retried by an admin run.`);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
export async function runReminder(o: { trigger: Trigger; at?: Date; simulated?: boolean }) {
  const at = o.at ?? now();
  return recordRun("reminder", o.trigger, at, !!o.simulated, async () => {
    const blocked = gate("reminder", o.trigger, at, !!o.simulated);
    if (blocked) return { status: "skipped", summary: `Skipped: ${blocked.reason}` };
    const issue = await getIssueByWeek(weekKey(at));
    if (!issue) return { status: "skipped", summary: "Skipped: no issue this week" };
    // Atomic: only one reminder per issue, and only while still pending.
    const claimed = await sql`UPDATE issues SET reminder_sent_at = ${at.toISOString()}
                              WHERE id = ${issue.id} AND status = 'pending_approval' AND reminder_sent_at IS NULL RETURNING id`;
    if (!claimed.length) {
      return { status: "skipped", summary: `Skipped: issue #${issue.issue_number} is ${issue.status.replace(/_/g, " ")}${issue.reminder_sent_at ? ", reminder already sent" : ""}` };
    }
    const tg = await notify(
      `⏰ <b>Reminder:</b> issue #${issue.issue_number} is still waiting for your approval. It goes out Thursday at 8 AM IST only if approved.`,
      [[{ text: "✅ Approve draft", callback_data: `a:${issue.id}` }]],
    );
    await logEvent(issue.id, "reminder_sent", "cron", `Telegram ${tg}`);
    return { status: "success", summary: `Reminder sent for issue #${issue.issue_number} (Telegram ${tg})` };
  });
}

// ---------------------------------------------------------------------------
export async function runSend(o: { trigger: Trigger; at?: Date; simulated?: boolean; channel?: Channel }) {
  const at = o.at ?? now();
  return recordRun("send", o.trigger, at, !!o.simulated, async () => {
    const blocked = gate("send", o.trigger, at, !!o.simulated);
    if (blocked) return { status: "skipped", summary: `Skipped: ${blocked.reason}` };
    const issue = await getIssueByWeek(weekKey(at));
    if (!issue) return { status: "skipped", summary: "Skipped: no issue this week" };
    if (issue.status === "sent") return { status: "skipped", summary: `Skipped: issue #${issue.issue_number} already sent` };
    if (issue.status === "approved") {
      const r = await sendIssue(issue.id, { channel: o.channel ?? (o.trigger === "cron" ? "cron" : "dashboard"), simulated: o.simulated });
      const tg = await notify(r.claimed && r.sent ? `📨 Issue #${issue.issue_number} sent: ${r.sent} emails (${r.mode} mode).` : `⚠️ Issue #${issue.issue_number} send: ${r.reason}.`);
      return { status: "success", summary: `Issue #${issue.issue_number}: ${r.reason} · ${r.sent} sent, ${r.failed} failed (${r.mode ?? "-"} mode)`, details: { ...r, telegram: tg } };
    }
    if (["skipped", "rejected", "sending"].includes(issue.status)) {
      return { status: "skipped", summary: `Skipped: issue #${issue.issue_number} is ${issue.status}` };
    }
    // Not approved by Thursday 8 AM: send nothing.
    await sql`UPDATE issues SET status = 'skipped' WHERE id = ${issue.id} AND status = ${issue.status}`;
    await logEvent(issue.id, "skipped", "cron", `Not approved at the Thursday send (was ${issue.status})`);
    const tg = await notify(
      `🚫 Issue #${issue.issue_number} was <b>not approved</b>, so nothing was sent this morning.\n` +
      `If you approve it today (Thursday), you'll get a "Send now" button. After today it stays unsent.`,
      issue.status === "pending_approval" ? [[{ text: "✅ Approve draft", callback_data: `a:${issue.id}` }]] : undefined,
    );
    return { status: "success", summary: `Issue #${issue.issue_number} not approved (${issue.status}) → skipped, nothing sent (Telegram ${tg})` };
  });
}

// ---------------------------------------------------------------------------
/** "Send dry-run email": render the current draft and list who would receive it. No API call, no state change. */
export async function runDryRunEmail(o: { trigger: Trigger; at?: Date; simulated?: boolean }) {
  const at = o.at ?? now();
  return recordRun("dry_run_email", o.trigger, at, !!o.simulated, async () => {
    const issue = await getIssueByWeek(weekKey(at));
    if (!issue) return { status: "skipped", summary: "Skipped: no issue this week" };
    const stories = await getStories(issue.id);
    if (!stories.length) return { status: "skipped", summary: `Skipped: issue #${issue.issue_number} has no draft yet` };
    const { mode } = effectiveMode({ simulated: true });
    const list = await recipients(mode);
    const email = await previewEmail(issue.id);
    return {
      status: "success",
      summary: `Dry run: issue #${issue.issue_number} rendered (${stories.length} stories); would go to ${list.length} ${mode}-mode recipient(s). Nothing sent.`,
      details: { subject: email.subject, htmlBytes: email.html.length, text: email.text, wouldSendTo: list.length, mode },
    };
  });
}

export const JOBS = { ingest: runIngest, draft: runDraft, reminder: runReminder, send: runSend } as const;
