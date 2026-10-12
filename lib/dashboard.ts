import { query, sql } from "./db";
import { MIN_CANDIDATES } from "./editorial";
import { deliveryStats } from "./email";
import { draftHealth, getStories, sendWindow, type Issue, type Story } from "./issues";
import { formatIst, istDate, istParts, now, weekDate, weekKey } from "./time";
import { TOPICS } from "./topics";

export type Dot = "grey" | "blue" | "amber" | "green" | "red";
export type Step = { label: string; when: string; dot: Dot; state: string };

export const maskEmail = (e: string) => e.replace(/^(.{1,2})[^@]*(@.*)$/, "$1•••$2");

/** Shreya's stated manual effort in the brief: four hours a week. */
export const MANUAL_MINUTES = 240;

export async function loadDashboard(opts: { articleTopic?: string; articleStatus?: string } = {}) {
  const at = now();
  const week = weekKey(at);
  const issue = ((await sql`SELECT * FROM issues WHERE week_key = ${week}`)[0] as Issue & { report_sent_at: string | null }) ?? null;
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
      count(*) FILTER (WHERE duplicate_of IS NULL AND topic = 'Other')::int AS off_topic,
      max(fetched_at) AS latest
    FROM articles WHERE issue_week = ${week} AND NOT is_sample`)[0];
  const sources = await sql`SELECT name, type, url_or_query, active, last_fetched_at, last_status, last_error, last_count FROM sources WHERE active OR last_status IS NOT NULL ORDER BY (last_status = 'failed') DESC NULLS LAST, name`;
  const activeSources = sources.filter((s) => s.active);
  const failedFeeds = activeSources.filter((s) => s.last_status === "failed").length;
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
    `SELECT a.id, a.title, a.url, a.source_name, a.topic, a.topic_confidence, a.topic_method, a.summary, a.published_at, a.fetched_at, a.pinned_at,
            a.duplicate_reason, a.duplicate_score, o.title AS duplicate_title, o.is_sample AS duplicate_is_sample,
            (SELECT i.issue_number FROM issue_stories s JOIN issues i ON i.id = s.issue_id WHERE s.article_id = o.id AND s.state = 'selected' LIMIT 1) AS duplicate_issue,
            (SELECT s.state FROM issue_stories s WHERE s.article_id = a.id AND s.issue_id = $${params.length + 1}) AS draft_state
     FROM articles a LEFT JOIN articles o ON o.id = a.duplicate_of
     WHERE ${where.join(" AND ")} ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT 150`,
    [...params, issue?.id ?? 0],
  );
  const filteredTotal = (await query(`SELECT count(*)::int AS n FROM articles a WHERE ${where.join(" AND ")}`, params))[0].n;
  const topicCounts = await sql`SELECT topic, count(*)::int AS n FROM articles WHERE issue_week = ${week} AND NOT is_sample AND topic IS NOT NULL GROUP BY topic ORDER BY n DESC`;

  // ---- Topic mix: this draft vs the last four sent issues ------------------
  const pastIssues = await sql`SELECT id, issue_number, week_key, sent_at, is_sample FROM issues WHERE status = 'sent' AND week_key < ${week} ORDER BY week_key DESC LIMIT 4`;
  const pastTopicRows = pastIssues.length
    ? await query(`SELECT a.topic, count(*)::int AS n FROM issue_stories s JOIN articles a ON a.id = s.article_id WHERE s.issue_id = ANY($1) AND s.state = 'selected' GROUP BY a.topic`, [pastIssues.map((p) => p.id)])
    : [];
  const topicMix = TOPICS.filter((t) => t !== "Other").map((t) => ({
    topic: t,
    now: stories.filter((s) => s.topic === t).length,
    pastAvg: pastIssues.length ? (pastTopicRows.find((r) => r.topic === t)?.n ?? 0) / pastIssues.length : 0,
  }));

  // ---- Voice, approval, subscribers, runs ----------------------------------
  const voices = await sql`SELECT id, version, content, updated_at, is_assumption, source FROM voice_guide ORDER BY version DESC`;
  const events = issue ? await sql`SELECT * FROM issue_events WHERE issue_id = ${issue.id} ORDER BY created_at, id` : [];
  const subscribers = await sql`SELECT s.*, (SELECT json_agg(json_build_object('status', e.status, 'reason', e.reason, 'at', e.created_at) ORDER BY e.created_at)
                                             FROM subscriber_events e WHERE e.subscriber_id = s.id) AS history,
                                       (SELECT json_agg(json_build_object('issue', i.issue_number, 'status', d.status, 'mode', d.mode, 'at', d.last_event_at) ORDER BY d.id)
                                             FROM deliveries d JOIN issues i ON i.id = d.issue_id WHERE d.subscriber_id = s.id) AS deliveries
                                FROM subscribers s ORDER BY (s.status <> 'active') DESC, s.is_test_recipient DESC, s.id`;
  const subCounts = Object.fromEntries(["active", "unsubscribed", "bounced", "complained"].map((k) => [k, subscribers.filter((s) => s.status === k).length])) as Record<string, number>;
  const softWatch = subscribers.filter((s) => s.status === "active" && s.soft_bounces > 0).length;
  const suppressionEvents = await sql`SELECT e.status, e.reason, e.created_at, s.email, s.is_sample FROM subscriber_events e JOIN subscribers s ON s.id = e.subscriber_id
                                      WHERE e.status IN ('unsubscribed', 'bounced', 'complained') ORDER BY e.created_at DESC LIMIT 20`;
  const runs = await sql`SELECT * FROM workflow_runs ORDER BY started_at DESC, id DESC LIMIT 40`;
  const monday = istDate(weekDate(week, 1), 0, 0);
  const failuresThisWeek = runs.filter((r) => r.status === "failed" && new Date(r.started_at) >= monday).length;

  // ---- Delivery (this week's issue, or the most recent real send) ---------
  const lastSent = (await sql`SELECT id, issue_number, week_key, sent_at, report_sent_at FROM issues WHERE status = 'sent' AND (NOT is_sample OR week_key LIKE 'TEST-SEND-%') ORDER BY sent_at DESC LIMIT 1`)[0] ?? null;
  const deliveryIssue = issue?.status === "sent" ? issue : lastSent;
  const delivery = deliveryIssue ? { issue: deliveryIssue, ...(await deliveryStats(deliveryIssue.id)) } : null;

  // ---- Time saved: Telegram review time vs the 4-hour manual process -------
  const reviewStart = issue?.draft_sent_to_telegram_at ? new Date(issue.draft_sent_to_telegram_at) : null;
  const reviewEnd = issue?.approved_at ? new Date(issue.approved_at) : null;
  const review = reviewStart
    ? { minutes: Math.max(1, Math.round(((reviewEnd ?? at).getTime() - reviewStart.getTime()) / 60000)), done: !!reviewEnd }
    : null;

  return {
    at, week, issue, stories, reserves, removed, health, topicMix,
    counts, sources, activeSources, failedFeeds, articles, filteredTotal, topicCounts,
    voices, events, subscribers, subCounts, softWatch, suppressionEvents, runs, failuresThisWeek, pastIssues,
    delivery, review,
    overview: overview(at, week, issue, health, counts),
  };
}

export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${Math.round(m / 1440)} days`);

function overview(at: Date, week: string, issue: (Issue & { report_sent_at?: string | null }) | null, health: ReturnType<typeof draftHealth>, counts: any) {
  const d = (wd: number, h: number, m = 0) => istDate(weekDate(week, wd), h, m);
  const t = (x: Date) => formatIst(x, { weekday: "short", hour: "numeric", minute: "2-digit", day: undefined, month: undefined });
  const status = issue?.status ?? "none";
  const n = issue ? `Issue #${issue.issue_number}` : `Week ${week}`;
  const { weekday } = istParts(at);
  const isThursday = istParts(at).dateStr === weekDate(week, 4);
  const pastSend = issue ? at >= sendWindow(week).sendAt : false;

  const steps: Step[] = [
    { label: "News collection", when: "Mon–Wed, 7 AM", dot: "grey", state: "Not started" },
    { label: "AI selection", when: t(d(3, 15)), dot: "grey", state: "Not started" },
    { label: "Editorial review", when: "Telegram, by Wed 10 PM", dot: "grey", state: "Not started" },
    { label: "Send newsletter", when: t(d(4, 8)), dot: "grey", state: "Not started" },
    { label: "Track delivery", when: t(d(4, 18)), dot: "grey", state: "Pending" },
  ];
  const set = (i: number, dot: Dot, state: string) => { steps[i].dot = dot; steps[i].state = state; };
  let current = 0;
  let headline = "", next = "", telegram = false;

  switch (status) {
    case "none":
    case "collecting":
      set(0, weekday <= 3 ? "blue" : "grey", weekday <= 3 ? `Fetching · ${counts.total} so far` : "Waiting");
      headline = `${n} is being collected — ${counts.candidates} usable stories so far.`;
      next = weekday <= 3 ? "Nothing to do yet. Gemini picks the draft on Wednesday at 3 PM and sends it to Telegram." : "Nothing to do. Collection for the next issue starts Monday at 7 AM.";
      break;
    case "drafting":
      set(0, "green", "Done"); set(1, "blue", "Selecting now"); current = 1;
      headline = `${n}: Gemini is choosing stories and writing commentary.`;
      next = "Nothing to do. The draft will arrive in Telegram in a minute or two.";
      break;
    case "insufficient_stories":
      set(0, "green", "Done"); set(1, "amber", "Too few stories"); current = 1;
      headline = `${n}: not enough strong stories yet (${counts.candidates} of ${MIN_CANDIDATES}).`;
      next = "Choose “Draft anyway” in Telegram, or wait for more stories to come in.";
      telegram = true;
      break;
    case "pending_approval":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "amber", `${health.approved} of ${health.count} approved`); current = 2;
      headline = health.approved < health.count
        ? `${health.count - health.approved}/${health.count} stories awaiting Shreya's approval on Telegram`
        : `All ${health.count} stories approved — final confirmation awaiting Shreya on Telegram`;
      next = pastSend ? "Approve today in Telegram to get a “Send now” button." : `Keep, edit or swap each story in Telegram, then confirm the final draft before Wed 10 PM${health.needsReview ? ` (${health.needsReview} stor${health.needsReview === 1 ? "y needs" : "ies need"} a check)` : ""}.`;
      telegram = true;
      break;
    case "approved":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "green", "Approved"); set(3, "blue", pastSend ? "Sending soon" : "Scheduled"); current = 3;
      headline = `${n} is approved and goes out ${pastSend ? "this morning" : "Thursday at 8 AM"}.`;
      next = pastSend ? "Use “Send now” in Telegram if it hasn't gone out yet." : "All set. Nothing to do until Thursday.";
      break;
    case "sending":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "green", "Approved"); set(3, "blue", "Sending"); current = 3;
      headline = `${n} is being sent to subscribers.`;
      next = "Nothing to do. Sending is in progress.";
      break;
    case "sent":
      [0, 1, 2, 3].forEach((i) => set(i, "green", "Done")); current = 4;
      set(4, issue?.report_sent_at ? "green" : "blue", issue?.report_sent_at ? "Report sent" : "Collecting results");
      headline = `${n} was sent ${formatIst(issue!.sent_at)}.`;
      next = "Done for this week. The delivery report arrives in Telegram on Thursday evening.";
      break;
    case "skipped":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "red", "Not approved"); set(3, "red", "Not sent"); current = 3;
      headline = `${n} was not approved in time, so nothing was sent.`;
      next = isThursday ? "You can still approve today in Telegram; you'll then get a “Send now” button." : "This issue stays unsent. The next issue starts collecting on Monday.";
      telegram = isThursday;
      break;
    case "rejected":
      set(0, "green", "Done"); set(1, "green", "Done"); set(2, "red", "Rejected"); set(3, "grey", "Won't send"); current = 2;
      headline = `${n}: the draft was rejected, nothing will be sent.`;
      next = "To try again, an admin can re-run selection from “Run manually”.";
      break;
  }
  const stamp = ({ approved: ["Approved", "for Thursday"], sending: ["Approved", "sending"], sent: ["Sent", "to subscribers"], skipped: ["Not sent", "no approval"], rejected: ["Rejected", "by the editor"] } as Record<string, [string, string]>)[status] ?? null;
  return { headline, steps, current, next, telegram, status, stamp };
}
