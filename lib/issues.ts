import { query, sql } from "./db";
import { candidates, checkCommentary, geminiReplacement, latestVoiceGuide, MAX_STORIES, MIN_STORIES, MIN_TOPICS } from "./editorial";
import { istDate, istParts, SEND_AT, weekDate } from "./time";
import { distinctTopics } from "./topics";

export type Issue = {
  id: number; issue_number: number; week_key: string; status: string;
  draft_sent_to_telegram_at: string | null; reminder_sent_at: string | null; approved_at: string | null;
  approved_via: string | null; sent_at: string | null; created_at: string; is_sample: boolean;
};

export type Story = {
  id: number; issue_id: number; article_id: number; position: number | null; commentary: string | null;
  original_commentary: string | null; state: string; edited_at: string | null; gemini_rationale: string | null;
  connects_with: string | null; reserve_rank: number | null; needs_review: boolean; review_notes: string | null;
  title: string; url: string; source_name: string; topic: string | null; summary: string | null; published_at: string | null;
};

export type Channel = "telegram" | "dashboard" | "cron" | "system" | "test";

export async function getIssueByWeek(week: string): Promise<Issue | null> {
  return ((await sql`SELECT * FROM issues WHERE week_key = ${week}`)[0] as Issue) ?? null;
}

export async function getIssue(id: number): Promise<Issue | null> {
  return ((await sql`SELECT * FROM issues WHERE id = ${id}`)[0] as Issue) ?? null;
}

export async function getOrCreateIssue(week: string): Promise<Issue> {
  await sql`INSERT INTO issues (issue_number, week_key, status)
            VALUES ((SELECT COALESCE(MAX(issue_number), 0) + 1 FROM issues), ${week}, 'collecting')
            ON CONFLICT (week_key) DO NOTHING`;
  return (await getIssueByWeek(week))!;
}

export async function logEvent(issueId: number, event: string, channel: Channel, detail?: string) {
  await sql`INSERT INTO issue_events (issue_id, event, channel, detail) VALUES (${issueId}, ${event}, ${channel}, ${detail ?? null})`;
}

export async function getStories(issueId: number, states: string[] = ["selected"]): Promise<Story[]> {
  return query(
    `SELECT s.*, a.title, a.url, a.source_name, a.topic, a.summary, a.published_at
     FROM issue_stories s JOIN articles a ON a.id = s.article_id
     WHERE s.issue_id = $1 AND s.state = ANY($2)
     ORDER BY CASE s.state WHEN 'selected' THEN 0 WHEN 'reserve' THEN 1 ELSE 2 END, s.position NULLS LAST, s.reserve_rank NULLS LAST, s.id`,
    [issueId, states],
  ) as Promise<Story[]>;
}

export async function getStory(storyId: number): Promise<(Story & { issue_status: string; issue_number: number; week_key: string }) | null> {
  const rows = await sql`SELECT s.*, a.title, a.url, a.source_name, a.topic, a.summary, a.published_at,
                                i.status AS issue_status, i.issue_number, i.week_key
                         FROM issue_stories s JOIN articles a ON a.id = s.article_id JOIN issues i ON i.id = s.issue_id
                         WHERE s.id = ${storyId}`;
  return (rows[0] as any) ?? null;
}

export function draftHealth(stories: Pick<Story, "topic" | "needs_review">[]) {
  const topics = distinctTopics(stories.map((s) => s.topic));
  const warnings: string[] = [];
  if (stories.length < MIN_STORIES) warnings.push(`only ${stories.length} stories (target ${MIN_STORIES}–${MAX_STORIES})`);
  if (stories.length > MAX_STORIES) warnings.push(`${stories.length} stories (target ${MIN_STORIES}–${MAX_STORIES})`);
  if (topics.length < MIN_TOPICS) warnings.push(`only ${topics.length} topic(s) (target ${MIN_TOPICS}+)`);
  return { count: stories.length, topics, needsReview: stories.filter((s) => s.needs_review).length, warnings };
}

/** End of the Thursday (IST) on which this issue is due. */
export function sendWindow(week: string) {
  const thu = weekDate(week, 4);
  return { sendAt: istDate(thu, Math.floor(SEND_AT / 60), SEND_AT % 60), thursdayEnd: istDate(thu, 23, 59) };
}

const EDITABLE = ["pending_approval", "approved", "skipped"];

export class IssueError extends Error {}

/**
 * Safety invariant 5: any edit after approval revokes approval.
 * Returns true when approval was revoked so the caller can tell Shreya.
 */
export async function revokeApprovalIfApproved(issueId: number, channel: Channel, why: string): Promise<boolean> {
  const rows = await sql`UPDATE issues SET status = 'pending_approval', approved_at = NULL, approved_via = NULL
                         WHERE id = ${issueId} AND status = 'approved' RETURNING id`;
  if (rows.length) await logEvent(issueId, "approval_revoked", channel, why);
  return rows.length > 0;
}

async function editableStory(storyId: number) {
  const story = await getStory(storyId);
  if (!story) throw new IssueError("That story no longer exists.");
  if (!EDITABLE.includes(story.issue_status)) throw new IssueError(`Issue #${story.issue_number} is ${story.issue_status.replace(/_/g, " ")}; edits are closed.`);
  if (story.state !== "selected") throw new IssueError("That story is no longer in the draft.");
  return story;
}

export async function editCommentary(storyId: number, text: string, channel: Channel) {
  const story = await editableStory(storyId);
  const clean = text.trim().slice(0, 1200);
  if (!clean) throw new IssueError("Commentary can't be empty.");
  const check = checkCommentary(clean, `${story.title} ${story.summary ?? ""}`);
  // Shreya's own words are kept verbatim; the check only flags.
  await sql`UPDATE issue_stories SET commentary = ${clean}, edited_at = now(), needs_review = ${check.needsReview && /number/.test(check.notes.join())},
            review_notes = ${check.notes.filter((n) => /number/.test(n)).join("; ") || null} WHERE id = ${storyId}`;
  await logEvent(story.issue_id, "edited", channel, `Story ${story.position}: commentary edited`);
  const revoked = await revokeApprovalIfApproved(story.issue_id, channel, `Story ${story.position} edited`);
  return { story: (await getStory(storyId))!, revoked };
}

async function renumber(issueId: number) {
  await sql`UPDATE issue_stories s SET position = x.rn FROM (
              SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn FROM issue_stories WHERE issue_id = ${issueId} AND state = 'selected') x
            WHERE s.id = x.id`;
}

export async function rejectStory(storyId: number, channel: Channel) {
  const story = await editableStory(storyId);
  await sql`UPDATE issue_stories SET state = 'rejected', position = NULL, edited_at = now() WHERE id = ${storyId}`;
  await renumber(story.issue_id);
  await logEvent(story.issue_id, "story_rejected", channel, `Removed: ${story.title}`);
  const revoked = await revokeApprovalIfApproved(story.issue_id, channel, "Story removed");
  const health = draftHealth(await getStories(story.issue_id));
  return { story, revoked, health };
}

/**
 * Bring one story into the draft at `position`: the best unused reserve (preferring one
 * that keeps 3+ topics), else one replacement picked by Gemini from unused candidates.
 */
async function bringInReplacement(issueId: number, position: number, remaining: Story[]) {
  const remainingTopics = distinctTopics(remaining.map((s) => s.topic));
  const reserves = await getStories(issueId, ["reserve"]);
  const keepsSpread = (topic: string | null) => distinctTopics([...remainingTopics, topic]).length >= MIN_TOPICS;
  const pick = reserves.find((r) => keepsSpread(r.topic)) ?? reserves[0];
  if (pick) {
    await sql`UPDATE issue_stories SET state = 'selected', position = ${position}, reserve_rank = NULL WHERE id = ${pick.id}`;
    return { id: pick.id, via: "reserve" as const };
  }
  const issue = (await getIssue(issueId))!;
  const pool = await candidates(issue.week_key, issue.id);
  if (!pool.length) throw new IssueError("No reserves or unused candidates left to swap in.");
  const voice = (await latestVoiceGuide())?.content ?? "";
  const rep = await geminiReplacement(pool, remaining.map((s) => ({ title: s.title, topic: s.topic ?? "Other" })), voice);
  const art = pool.find((c) => c.id === rep.article_id)!;
  const check = checkCommentary(rep.commentary, `${art.title} ${art.summary ?? ""}`);
  const ins = await sql`INSERT INTO issue_stories (issue_id, article_id, position, commentary, original_commentary, state, gemini_rationale, needs_review, review_notes)
                        VALUES (${issueId}, ${art.id}, ${position}, ${check.commentary}, ${check.commentary}, 'selected', ${rep.rationale},
                                ${check.needsReview}, ${check.notes.join("; ") || null}) RETURNING id`;
  return { id: ins[0].id as number, via: "gemini" as const };
}

/** Swap a story for a reserve (or a Gemini pick when reserves run out). */
export async function swapStory(storyId: number, channel: Channel) {
  const story = await editableStory(storyId);
  const remaining = (await getStories(story.issue_id)).filter((s) => s.id !== storyId);
  await sql`UPDATE issue_stories SET state = 'swapped_out', position = NULL, edited_at = now() WHERE id = ${storyId}`;
  const { id, via } = await bringInReplacement(story.issue_id, story.position!, remaining).catch(async (e) => {
    await sql`UPDATE issue_stories SET state = 'selected', position = ${story.position} WHERE id = ${storyId}`;
    throw e;
  });
  await logEvent(story.issue_id, "swapped", channel, `Story ${story.position}: "${story.title}" swapped out (${via})`);
  const revoked = await revokeApprovalIfApproved(story.issue_id, channel, `Story ${story.position} swapped`);
  return { oldStory: story, newStory: (await getStory(id))!, via, revoked };
}

/** After a reject leaves the draft short, append one replacement at the end. */
export async function addReplacement(issueId: number, channel: Channel) {
  const issue = await getIssue(issueId);
  if (!issue || !EDITABLE.includes(issue.status)) throw new IssueError("Edits are closed for this issue.");
  const remaining = await getStories(issueId);
  const { id, via } = await bringInReplacement(issueId, remaining.length + 1, remaining);
  await logEvent(issueId, "story_added", channel, `Replacement added (${via})`);
  const revoked = await revokeApprovalIfApproved(issueId, channel, "Story added");
  return { newStory: (await getStory(id))!, via, revoked };
}

export type ApproveResult = { ok: boolean; message: string; offerSendNow: boolean; warnings: string[] };

/**
 * Explicit approval. Allowed from pending_approval until Thursday ends (IST), and
 * from skipped only on the Thursday itself (late approval → "Send now").
 */
export async function approveIssue(issueId: number, via: "telegram" | "dashboard", at: Date): Promise<ApproveResult> {
  const issue = await getIssue(issueId);
  if (!issue) return { ok: false, message: "Issue not found.", offerSendNow: false, warnings: [] };
  const { sendAt, thursdayEnd } = sendWindow(issue.week_key);
  if (at > thursdayEnd) return { ok: false, message: `Issue #${issue.issue_number}'s send window ended on Thursday; it stays unsent.`, offerSendNow: false, warnings: [] };
  const lateOk = issue.status === "skipped" && istParts(at).dateStr === istParts(sendAt).dateStr;
  if (issue.status !== "pending_approval" && !lateOk) {
    return { ok: false, message: `Issue #${issue.issue_number} is ${issue.status.replace(/_/g, " ")}; it can't be approved now.`, offerSendNow: false, warnings: [] };
  }
  const rows = await sql`UPDATE issues SET status = 'approved', approved_at = ${at.toISOString()}, approved_via = ${via}
                         WHERE id = ${issueId} AND status = ${issue.status} RETURNING id`;
  if (!rows.length) return { ok: false, message: "The issue changed while approving; please try again.", offerSendNow: false, warnings: [] };
  const health = draftHealth(await getStories(issueId));
  await logEvent(issueId, "approved", via, `${health.count} stories, ${health.topics.length} topics${health.warnings.length ? "; warnings: " + health.warnings.join(", ") : ""}`);
  const offerSendNow = at >= sendAt;
  return {
    ok: true,
    message: offerSendNow
      ? `Issue #${issue.issue_number} approved. The scheduled Thursday send has already passed — use "Send now" to send it today.`
      : `Issue #${issue.issue_number} approved. It will go out on Thursday at 8 AM IST.`,
    offerSendNow,
    warnings: health.warnings,
  };
}

export async function rejectIssue(issueId: number, via: Channel) {
  const rows = await sql`UPDATE issues SET status = 'rejected', approved_at = NULL, approved_via = NULL
                         WHERE id = ${issueId} AND status IN ('pending_approval', 'approved', 'insufficient_stories') RETURNING issue_number`;
  if (rows.length) await logEvent(issueId, "rejected", via, "Entire draft rejected; nothing will be sent");
  return rows.length > 0;
}
