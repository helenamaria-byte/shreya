import Parser from "rss-parser";
import { query, sql } from "./db";
import { cleanTitle, normalizeUrl, resolveGoogleNewsUrl, sha256, stripHtml } from "./normalize";
import { SOURCES, type SourceDef } from "./sources";
import { weekKey } from "./time";
import { tagTopics } from "./topics";

/** Trigram similarity above which two headlines are treated as the same story (tuned on live data, see docs/ASSUMPTIONS.md). */
export const SIMILAR_TITLE_THRESHOLD = 0.5;
/** Slightly looser threshold for "already covered in one of the last four issues". */
export const PAST_ISSUE_THRESHOLD = 0.55;
const FEED_TIMEOUT_MS = 12000;
const MAX_ITEMS_PER_SOURCE = 30;
const MAX_AGE_DAYS = 5;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type RawItem = { title: string; url: string; summary: string; publishedAt: Date | null; sourceName: string };

const parser = new Parser({ customFields: { item: [["source", "gnSource"]] } });

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,application/json,*/*", ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`timeout after ${FEED_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchSource(src: SourceDef): Promise<RawItem[]> {
  if (src.type === "gnews") {
    const key = process.env.GNEWS_API_KEY;
    if (!key) throw new Error("GNEWS_API_KEY is not set");
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(src.url_or_query)}&lang=en&country=in&max=10&sortby=publishedAt&apikey=${key}`;
    const res = await fetchWithTimeout(url).catch((e) => { throw new Error(String(e.message).replace(key, "***")); });
    const data = (await res.json()) as { articles?: { title: string; url: string; description?: string; publishedAt?: string; source?: { name?: string } }[] };
    return (data.articles || []).map((a) => ({
      title: cleanTitle(a.title, src.name),
      url: a.url,
      summary: stripHtml(a.description),
      publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
      sourceName: a.source?.name ? `${a.source.name} (via GNews)` : src.name,
    }));
  }
  const res = await fetchWithTimeout(src.url_or_query);
  const feed = await parser.parseString(await res.text());
  const isGoogle = src.url_or_query.includes("news.google.com");
  return feed.items.slice(0, isGoogle ? 20 : MAX_ITEMS_PER_SOURCE).map((i: any) => {
    const publisher = typeof i.gnSource === "string" ? i.gnSource : i.gnSource?._;
    return {
      title: cleanTitle(i.title || "", isGoogle ? "Google News" : src.name),
      url: isGoogle ? resolveGoogleNewsUrl(i.link || "") : (i.link || ""),
      // Google News descriptions only repeat the headline as a link list, so drop them.
      summary: isGoogle ? "" : stripHtml(i.contentSnippet || i.content || i.summary || ""),
      publishedAt: i.isoDate ? new Date(i.isoDate) : i.pubDate ? new Date(i.pubDate) : null,
      sourceName: isGoogle && publisher ? `${publisher} (via Google News)` : src.name,
    };
  });
}

/** Insert raw items; exact re-fetches (same raw link) are skipped by the url_hash UNIQUE constraint. */
export async function insertArticles(sourceId: number | null, items: RawItem[], at: Date): Promise<{ insertedIds: number[]; skippedExisting: number }> {
  const seen = new Set<string>();
  const rows = items
    .filter((i) => i.title && /^https?:\/\//.test(i.url))
    .map((i) => ({ ...i, url: i.url.trim(), canonical: normalizeUrl(i.url) }))
    .filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
  if (!rows.length) return { insertedIds: [], skippedExisting: 0 };
  const week = weekKey(at);
  const inserted = await query(
    `INSERT INTO articles (source_id, source_name, title, url, canonical_url, url_hash, canonical_hash, summary, published_at, fetched_at, issue_week)
     SELECT $1::int, u.sn, u.t, u.url, u.cu, u.uh, u.ch, u.s, u.p, $10::timestamptz, $11::text
     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[])
       AS u(sn, t, url, cu, uh, ch, s, p)
     ON CONFLICT (url_hash) DO NOTHING RETURNING id`,
    [
      sourceId,
      rows.map((r) => r.sourceName),
      rows.map((r) => r.title.slice(0, 500)),
      rows.map((r) => r.url),
      rows.map((r) => r.canonical),
      rows.map((r) => sha256(r.url)),
      rows.map((r) => sha256(r.canonical)),
      rows.map((r) => r.summary || null),
      rows.map((r) => (r.publishedAt && !isNaN(r.publishedAt.getTime()) ? r.publishedAt.toISOString() : null)),
      at.toISOString(),
      week,
    ],
  );
  return { insertedIds: inserted.map((r) => r.id), skippedExisting: rows.length - inserted.length };
}

/** Last four sent issues before the given week (newest first). */
export async function lastFourSentIssues(beforeWeek: string) {
  return sql`SELECT id, issue_number, week_key, sent_at FROM issues
             WHERE status = 'sent' AND week_key < ${beforeWeek} ORDER BY week_key DESC LIMIT 4`;
}

/**
 * Dedup pipeline for newly inserted rows, applied in priority order:
 *  1. covered_in_past_issue — same normalised URL or similar title to a story in the last four sent issues
 *  2. same_url — same normalised URL (tracking params etc. removed) as an earlier article
 *  3. similar_title — trigram similarity > threshold with an earlier article fetched in the last 7 days
 */
export async function dedupe(ids: number[], week: string) {
  if (!ids.length) return { pastIssue: 0, sameUrl: 0, similarTitle: 0 };
  const past = await query(
    `WITH recent AS (SELECT id FROM issues WHERE status = 'sent' AND week_key < $2 ORDER BY week_key DESC LIMIT 4),
     past AS (SELECT ar.id, ar.title, ar.canonical_hash FROM issue_stories s JOIN recent r ON r.id = s.issue_id
              JOIN articles ar ON ar.id = s.article_id WHERE s.state = 'selected'),
     m AS (SELECT DISTINCT ON (n.id) n.id, p.id AS pid,
             CASE WHEN p.canonical_hash = n.canonical_hash THEN 1 ELSE similarity(p.title, n.title) END AS score
           FROM articles n JOIN past p ON p.canonical_hash = n.canonical_hash OR similarity(p.title, n.title) > $3
           WHERE n.id = ANY($1) AND n.duplicate_of IS NULL AND p.id <> n.id
           ORDER BY n.id, score DESC)
     UPDATE articles a SET duplicate_of = m.pid, duplicate_reason = 'covered_in_past_issue', duplicate_score = m.score
     FROM m WHERE a.id = m.id RETURNING a.id`,
    [ids, week, PAST_ISSUE_THRESHOLD],
  );
  const same = await query(
    `WITH m AS (SELECT DISTINCT ON (n.id) n.id, o.id AS oid FROM articles n
                JOIN articles o ON o.canonical_hash = n.canonical_hash AND o.id < n.id AND o.duplicate_of IS NULL AND NOT o.is_sample
                WHERE n.id = ANY($1) AND n.duplicate_of IS NULL ORDER BY n.id, o.id)
     UPDATE articles a SET duplicate_of = m.oid, duplicate_reason = 'same_url', duplicate_score = 1
     FROM m WHERE a.id = m.id RETURNING a.id`,
    [ids],
  );
  const similar = await query(
    `WITH m AS (SELECT DISTINCT ON (n.id) n.id, o.id AS oid, similarity(o.title, n.title) AS score FROM articles n
                JOIN articles o ON o.id < n.id AND o.duplicate_of IS NULL AND NOT o.is_sample
                  AND o.fetched_at > n.fetched_at - interval '7 days'
                  AND similarity(o.title, n.title) > $2
                WHERE n.id = ANY($1) AND n.duplicate_of IS NULL ORDER BY n.id, score DESC)
     UPDATE articles a SET duplicate_of = m.oid, duplicate_reason = 'similar_title', duplicate_score = m.score
     FROM m WHERE a.id = m.id RETURNING a.id`,
    [ids, SIMILAR_TITLE_THRESHOLD],
  );
  return { pastIssue: past.length, sameUrl: same.length, similarTitle: similar.length };
}

/** Tag every untagged, non-duplicate article of the week (also retries anything a failed run left untagged). */
export async function tagWeek(week: string) {
  const rows = await sql`SELECT id, title, summary FROM articles
                         WHERE issue_week = ${week} AND duplicate_of IS NULL AND topic IS NULL AND NOT is_sample ORDER BY id`;
  if (!rows.length) return { tagged: 0, geminiCalls: 0, fallback: false };
  const { results, geminiCalls, fallback, error } = await tagTopics(rows as any);
  const ids = [...results.keys()];
  await query(
    `UPDATE articles a SET topic = x.topic, topic_confidence = x.conf, topic_method = x.method
     FROM unnest($1::int[], $2::text[], $3::real[], $4::text[]) AS x(id, topic, conf, method) WHERE a.id = x.id`,
    [ids, ids.map((i) => results.get(i)!.topic), ids.map((i) => results.get(i)!.confidence), ids.map((i) => results.get(i)!.method)],
  );
  return { tagged: ids.length, geminiCalls, fallback, error };
}

export async function syncSources(extra: SourceDef[] = []) {
  const all = [...SOURCES, ...extra];
  await query(
    `INSERT INTO sources (name, type, url_or_query) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, url_or_query = EXCLUDED.url_or_query`,
    [all.map((s) => s.name), all.map((s) => s.type), all.map((s) => s.url_or_query)],
  );
  const names = all.map((s) => s.name);
  return query(`SELECT * FROM sources WHERE name = ANY($1) AND (active OR name = ANY($2)) ORDER BY id`, [names, extra.map((s) => s.name)]);
}

export type IngestResult = {
  week: string;
  perSource: { name: string; status: "ok" | "failed"; fetched: number; inserted: number; error?: string }[];
  inserted: number;
  dedup: { pastIssue: number; sameUrl: number; similarTitle: number };
  tagging: { tagged: number; geminiCalls: number; fallback: boolean; error?: string };
};

/** Fetch every active source; one failing feed never fails the run. */
export async function ingest(at: Date, opts: { extraSources?: SourceDef[]; sourceFilter?: (s: SourceDef) => boolean } = {}): Promise<IngestResult> {
  const week = weekKey(at);
  let sources = await syncSources(opts.extraSources);
  if (opts.sourceFilter) sources = sources.filter(opts.sourceFilter);
  const minDate = new Date(at.getTime() - MAX_AGE_DAYS * 86400000);
  const perSource: IngestResult["perSource"] = [];
  const allIds: number[] = [];

  // GNews' free plan rejects parallel bursts (HTTP 429), so its queries run one per ~1.2 s; RSS feeds run in parallel.
  const gnewsQueue = sources.filter((s: any) => s.type === "gnews");
  const runOne = async (s: any) => {
      try {
        const items = (await fetchSource(s)).filter((i) => !i.publishedAt || isNaN(i.publishedAt.getTime()) || i.publishedAt >= minDate);
        const { insertedIds } = await insertArticles(s.id, items, at);
        allIds.push(...insertedIds);
        perSource.push({ name: s.name, status: "ok", fetched: items.length, inserted: insertedIds.length });
        await sql`UPDATE sources SET last_fetched_at = now(), last_status = 'ok', last_error = NULL, last_count = ${items.length} WHERE id = ${s.id}`;
      } catch (e: any) {
        const error = String(e?.message || e).slice(0, 300);
        perSource.push({ name: s.name, status: "failed", fetched: 0, inserted: 0, error });
        await sql`UPDATE sources SET last_fetched_at = now(), last_status = 'failed', last_error = ${error}, last_count = 0 WHERE id = ${s.id}`;
      }
  };
  await Promise.all([
    ...sources.filter((s: any) => s.type !== "gnews").map(runOne),
    (async () => { for (const [i, s] of gnewsQueue.entries()) { if (i) await new Promise((r) => setTimeout(r, 1200)); await runOne(s); } })(),
  ]);

  // Re-check the whole week (not just this run's rows) so every pair is compared under the current thresholds.
  const weekIds = (await sql`SELECT id FROM articles WHERE issue_week = ${week} AND duplicate_of IS NULL AND NOT is_sample ORDER BY id`).map((r) => r.id as number);
  const dedup = await dedupe(weekIds, week);
  const tagging = await tagWeek(week);
  perSource.sort((a, b) => a.name.localeCompare(b.name));
  return { week, perSource, inserted: allIds.length, dedup, tagging };
}
