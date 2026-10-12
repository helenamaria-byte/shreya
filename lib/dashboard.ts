import { query, sql } from "./db";
import { MIN_CANDIDATES } from "./editorial";
import { draftHealth, getStories, sendWindow, type Issue, type Story } from "./issues";
import { formatIst, istDate, istParts, now, weekDate, weekKey } from "./time";

export type Dot = "grey" | "blue" | "amber" | "green" | "red";
export type Step = { label: string; when: string; dot: Dot; state: string };

export const maskEmail = (e: string) => e.replace(/^(.{1,2})[^@]*(@.*)$/, "$1•••$2");

export async function loadDashboard(opts: { articleTopic?: string; articleStatus?: string } = {}) {
  const at = now();
  const week = weekKey(at);
  const issue = ((await sql`SELECT * FROM issues WHERE week_key = ${week}`)[0] as Issue) ?? null;
  const allStories: Story[] = issue ? await getStories(issue.id, ["selected", "reserve", "rejected", "swapped_out"]) : [];
  const stories = allStories.filter((s) => s.state === "selected");
  const reserves = allStories.filter((s) => s.state === "reserve");
  const removed = allStories.filter((s) => s.state === "rejected" || s.state === "swapped_out");
  const health = draftHealth(stories);

  // ---- Articles ------------------------------------------------------------
  const counts = (await sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE duplicate_of IS NULL AND topic IS NOT NULL AND topic <> 'Other')::int AS candidates,
      count(*) FILTER (WHERE duplicate_reason IN ('same_url', 'similar_title'))::int AS duplicates,
      count(*) FILTER (WHERE duplicate_reason = 'covered_in_past_issue')::int AS covered,
      count(*) FILTER (WHERE duplicate_of IS NULL AND topic = 'Other')::int AS off_topic
    FROM articles WHERE issue_week = ${week} AND NOT is_sample`)[0];
  const sources = await sql`SELECT name, type, url_or_query, active, last_fetched_at, last_status, last_error, last_count FROM sources WHERE active OR last_status IS NOT NULL ORDER BY (last_status = 'failed') DESC NULLS LAST, name`;
  const failedFeeds = sources.filter((s) => s.active && s.last_status === "failed").length;
  const statusFilter: Record<string, string> = {
    candidate: "a.duplicate_of IS NULL AND a.topic IS NOT NULL AND a.topic <> 'Other'",
    duplicate: "a.duplicate_reason IN ('same_url', 'similar_title')",
    covered: "a.duplicate_reason = 'covered_in_past_issue'",
    off_topic: "a.duplicate_of IS NULL AND a.topic = 'Other'",
  };
  const where = [`a.issue_week = $1`, `NOT a.is_sample`];
  const params: unknown[] = [week];
  if (opts.articleTopic) { params.push(opts.articleTopic); where.push(`a.topic = $${params.length}`); }
  if (opts.articleStatus && statusFilter[opts.articleStatus]) where.push(statusFilter[opts.articleStatus]);
  const articles = await query(
    `SELECT a.id, a.title, a.url, a.source_name, a.topic, a.topic_confidence, a.topic_method, a.summary, a.published_at, a.fetched_at,
            a.duplicate_reason, a.duplicate_score, o.title AS duplicate_title, o.is_sample AS duplicate_is_sample,
            (SELECT i.issue_number FROM issue_stories s JOIN issues i ON i.id = s.issue_id WHERE s.article_id = o.id AND s.state = 'selected' LIMIT 1) AS duplicate_issue,
            (SELECT s.state FROM issue_stories s WHERE s.article_id = a.id AND s.issue_id = $${params.length + 1}) AS draft_state
     FROM articles a LEFT JOIN articles o ON o.id = a.duplicate_of
     WHERE ${where.join(" AND ")} ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT 150`,
    [...params, issue?.id ?? 0],
  );
  const filteredTotal = (await query(`SELECT count(*)::int AS n FROM articles a WHERE ${where.join(" AND ")}`, params))[0].n;
  const topicCounts = await sql`SELECT topic, count(*)::int AS n FROM articles WHERE issue_week = ${week} AND NOT is_sample AND topic IS NOT NULL GROUP BY topic ORDER BY n DESC`;

  // ---- Voice, approval, subscribers, runs ----------------------------------
  const voices = await sql`SELECT id, version, content, updated_at, is_assumption FROM voice_guide ORDER BY version DESC`;
  const events = issue ? await sql`SELECT * FROM issue_events WHERE issue_id = ${issue.id} ORDER BY created_at, id` : [];
  const subscribers = await sql`SELECT s.*, (SELECT json_agg(json_build_object('status', e.status, 'reason', e.reason, 'at', e.created_at) ORDER BY e.created_at)
                                             FROM subscriber_events e WHERE e.subscriber_id = s.id) AS history,
                                       (SELECT json_agg(json_build_object('issue', i.issue_number, 'status', d.status, 'mode', d.mode, 'at', d.last_event_at) ORDER BY d.id)
                                             FROM deliveries d JOIN issues i ON i.id = d.issue_id WHERE d.subscriber_id = s.id) AS deliveries
                                FROM subscribers s ORDER BY s.is_test_recipient DESC, s.id`;
  const subCounts = Object.fromEntries(["active", "unsubscribed", "bounced", "complained"].map((k) => [k, subscribers.filter((s) => s.status === k).length]));
  const runs = await sql`SELECT * FROM workflow_runs ORDER BY started_at DESC, id DESC LIMIT 40`;
  const monday = istDate(weekDate(week, 1), 0, 0);
  const failuresThisWeek = runs.filter((r) => r.status === "failed" && new Date(r.started_at) >= monday).length;
  const pastIssues = await sql`SELECT issue_number, week_key, sent_at, is_sample FROM issues WHERE status = 'sent' AND week_key < ${week} ORDER BY week_key DESC LIMIT 4`;

  return {
    at, week, issue, stories, reserves, removed, health,
    counts, sources, failedFeeds, articles, filteredTotal, topicCounts,
    voices, events, subscribers, subCounts, runs, failuresThisWeek, pastIssues,
    overview: overview(at, week, issue, health, counts),
  };
}

function overview(at: Date, week: string, issue: Issue | null, health: ReturnType<typeof draftHealth>, counts: any) {
  const d = (wd: number, h: number, m = 0) => istDate(weekDate(week, wd), h, m);
  const t = (x: Date) => formatIst(x, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => formatIst(x, { hour: undefined, minute: undefined });
  const status = issue?.status ?? "none";
  const n = issue ? `Issue #${issue.issue_number}` : `Week ${week}`;
  const { weekday } = istParts(at);
  const isThursday = istParts(at).dateStr === weekDate(week, 4);
  const pastSend = issue ? at >= sendWindow(week).sendAt : false;

  const steps: Step[] = [
    { label: "Collect", when: `${day(d(1, 7))} – ${day(d(3, 15))}`, dot: "grey", state: "Not started" },
    { label: "Select", when: t(d(3, 15)), dot: "grey", state: "Not started" },
    { label: "Review", when: "Telegram, by Wed 10 PM", dot: "grey", state: "Not started" },
    { label: "Send", when: t(d(4, 8)), dot: "grey", state: "Not started" },
  ];
  const set = (i: number, dot: Dot, state: string) => { steps[i].dot = dot; steps[i].state = state; };
  let current = 0;
  let headline = "", next = "", button: { label: string; href: string } | null = null;
  const tgLink = { label: "Open Telegram", href: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || ""}` };

  switch (status) {
    case "none":
    case "collecting":
      set(0, weekday <= 3 ? "blue" : "grey", weekday <= 3 ? "In progress" : "Waiting");
      headline = `${n} — Collecting news (${counts.candidates} candidates so far)`;
      next = weekday <= 3 ? "Nothing to do yet. The draft is picked on Wednesday at 3 PM and arrives in Telegram." : "Nothing to do. Collection for the next issue starts Monday at 7 AM.";
      break;
    case "drafting":
      set(0, "green", "Done"); set(1, "blue", "In progress"); current = 1;
      headline = `${n} — Gemini is selecting stories and writing commentary`;
      next = "Nothing to do. The draft will appear in Telegram in a minute or two.";
      break;
    case "insufficient_stories":
      set(0, "green", "Done"); set(1, "amber", "Not enough stories"); current = 1;
      headline = `${n} — Not enough stories yet (${counts.candidates} of ${MIN_CANDIDATES} candidates)`;
      next = "Choose “Draft anyway” in Telegram, or wait for more stories to be collected.";
      button = tgLink;
      break;
    case "pending_approval":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "amber", "Waiting on Shreya"); current = 2;
      headline = `${n} — Waiting for Shreya's approval in Telegram`;
      next = pastSend ? "Approve today in Telegram to get a “Send now” button." : `Review and approve the draft in Telegram before Wed 10 PM${health.needsReview ? ` (${health.needsReview} stor${health.needsReview === 1 ? "y needs" : "ies need"} a check)` : ""}.`;
      button = tgLink;
      break;
    case "approved":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "green", "Approved"); set(3, "blue", pastSend ? "Sending soon" : "Scheduled"); current = 3;
      headline = `${n} — Approved, goes out ${pastSend ? "now" : "Thursday 8 AM"}`;
      next = pastSend ? "Use “Send now” in Telegram if it hasn't gone out yet." : "All set. Nothing to do until Thursday's send.";
      break;
    case "sending":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "green", "Approved"); set(3, "blue", "Sending"); current = 3;
      headline = `${n} — Sending to subscribers`;
      next = "Nothing to do. Sending is in progress.";
      break;
    case "sent":
      steps.forEach((_, i) => set(i, "green", "Done")); current = 3;
      headline = `${n} — Sent ${formatIst(issue!.sent_at)}`;
      next = "Done for this week. Collection for the next issue starts Monday at 7 AM.";
      break;
    case "skipped":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "red", "Not approved"); set(3, "red", "Skipped"); current = 3;
      headline = `${n} — Not approved in time, nothing was sent`;
      next = isThursday ? "You can still approve today in Telegram; you'll then get a “Send now” button." : "This issue stays unsent. The next issue starts collecting on Monday.";
      if (isThursday) button = tgLink;
      break;
    case "rejected":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "red", "Rejected"); set(3, "grey", "Won't send"); current = 2;
      headline = `${n} — Draft rejected, nothing will be sent`;
      next = "To try again, an admin can re-run selection from “Run manually”.";
      break;
  }
  return { headline, steps, current, next, button, status };
}
