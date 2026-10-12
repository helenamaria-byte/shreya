import { query, sql } from "../lib/db";
import { normalizeUrl, sha256 } from "../lib/normalize";
import { istDate, weekDate, weekKey } from "../lib/time";
import { migrate } from "../scripts/migrate";
import { seed } from "../scripts/seed";

/**
 * Tests use NEXT week (relative to today) so that handlers which read the real clock
 * (e.g. the Telegram webhook) are always before that week's Thursday deadline.
 */
export const WEEK = weekKey(new Date(Date.now() + 7 * 86400000));
export const day = (weekday: number) => weekDate(WEEK, weekday);
export const MON_0900 = istDate(day(1), 9, 0);
export const WED_1500 = istDate(day(3), 15, 0);
export const WED_2159 = istDate(day(3), 21, 59);
export const WED_2201 = istDate(day(3), 22, 1);
export const THU_0800 = istDate(day(4), 8, 0);
export const THU_1200 = istDate(day(4), 12, 0);
export const FRI_1000 = istDate(day(5), 10, 0);

let migrated = false;

/** Empty the test branch and re-seed (voice guide, past issues 1–4, subscribers). */
export async function resetDb() {
  if (!migrated) { await migrate(() => {}); migrated = true; }
  await sql`TRUNCATE workflow_runs, telegram_pending_actions, deliveries, subscriber_events, subscribers, voice_guide,
            issue_events, issue_stories, issues, articles, sources RESTART IDENTITY CASCADE`;
  await seed({ at: MON_0900, log: () => {} });
}

const TOPIC_POOL = ["Funding & Deals", "AI & Deeptech", "Fintech", "Policy & Regulation", "Consumer & Commerce", "Markets & IPOs", "Talent & Layoffs", "Climate & Mobility"];

export async function addArticle(title: string, opts: { url?: string; topic?: string; summary?: string; week?: string; at?: Date } = {}) {
  const url = opts.url ?? `https://news.test/${encodeURIComponent(title.toLowerCase().replace(/\W+/g, "-"))}`;
  const r = await sql`INSERT INTO articles (source_name, title, url, canonical_url, url_hash, canonical_hash, summary, published_at, fetched_at, issue_week, topic, topic_confidence, topic_method)
    VALUES ('Test Source', ${title}, ${url}, ${normalizeUrl(url)}, ${sha256(url)}, ${sha256(normalizeUrl(url))}, ${opts.summary ?? `Summary of ${title}.`},
            ${(opts.at ?? MON_0900).toISOString()}, ${(opts.at ?? MON_0900).toISOString()}, ${opts.week ?? WEEK}, ${opts.topic ?? null}, 0.9, 'test')
    RETURNING id`;
  return r[0].id as number;
}

/** Create this week's issue with `n` selected stories across topics plus `reserves` reserve stories. */
export async function makeDraft(opts: { n?: number; reserves?: number; status?: string; topics?: number } = {}) {
  const n = opts.n ?? 9, reserveCount = opts.reserves ?? 3, topicCount = opts.topics ?? 4;
  const issue = (await sql`INSERT INTO issues (issue_number, week_key, status) VALUES (5, ${WEEK}, ${opts.status ?? "pending_approval"}) RETURNING *`)[0];
  const ids: number[] = [];
  for (let i = 0; i < n + reserveCount; i++) {
    const topic = TOPIC_POOL[i % (i < n ? topicCount : TOPIC_POOL.length)];
    ids.push(await addArticle(`Test story ${i + 1} about ${topic} and Indian startups`, { topic }));
  }
  await query(
    `INSERT INTO issue_stories (issue_id, article_id, position, reserve_rank, state, commentary, original_commentary, gemini_rationale)
     SELECT $1, a, CASE WHEN o <= $2 THEN o END, CASE WHEN o > $2 THEN o - $2 END, CASE WHEN o <= $2 THEN 'selected' ELSE 'reserve' END,
            'First sentence of commentary. Second sentence of commentary.', 'First sentence of commentary. Second sentence of commentary.', 'test rationale'
     FROM unnest($3::int[]) WITH ORDINALITY AS t(a, o)`,
    [issue.id, n, ids],
  );
  return issue as { id: number; issue_number: number };
}

export async function issueStatus(id: number) {
  return (await sql`SELECT * FROM issues WHERE id = ${id}`)[0];
}

export async function deliveriesCount(issueId: number) {
  return (await sql`SELECT count(*)::int AS n FROM deliveries WHERE issue_id = ${issueId}`)[0].n as number;
}
