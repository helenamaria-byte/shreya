import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "../lib/db";
import { candidates } from "../lib/editorial";
import { dedupe, ingest, insertArticles } from "../lib/ingest";
import { normalizeUrl, resolveGoogleNewsUrl, stripHtml } from "../lib/normalize";
import { BROKEN_TEST_SOURCE } from "../lib/sources";
import { MON_0900, resetDb, WEEK } from "./helpers";

const raw = (title: string, url: string) => ({ title, url, summary: "", publishedAt: MON_0900, sourceName: "Test Source" });

describe("URL normalisation (C2)", () => {
  it("strips tracking params, fragments, www, trailing slash and lowercases the host", () => {
    const a = normalizeUrl("https://WWW.Inc42.com/buzz/startup-raises-funds/?utm_source=twitter&utm_medium=social&fbclid=abc#comments");
    const b = normalizeUrl("http://inc42.com/buzz/startup-raises-funds");
    expect(a).toBe("https://inc42.com/buzz/startup-raises-funds");
    expect(a).toBe(b);
  });
  it("keeps meaningful query params, sorted", () => {
    expect(normalizeUrl("https://example.com/a?b=2&utm_campaign=x&a=1")).toBe("https://example.com/a?a=1&b=2");
  });
  it("leaves non-Google links untouched when resolving Google News links", () => {
    expect(resolveGoogleNewsUrl("https://inc42.com/x")).toBe("https://inc42.com/x");
  });
  it("strips HTML and decodes entities from summaries", () => {
    expect(stripHtml("<p>Zepto &amp; Blinkit<br/>expand&nbsp;<b>fast</b></p>")).toBe("Zepto & Blinkit expand fast");
  });
});

describe("within-week dedup in Neon (C2)", () => {
  beforeEach(resetDb);

  it("drops exact re-fetches and flags the same URL with tracking params as same_url", async () => {
    const first = await insertArticles(null, [raw("Kirana startup raises funding", "https://news.test/kirana-raises")], MON_0900);
    const again = await insertArticles(null, [raw("Kirana startup raises funding", "https://news.test/kirana-raises")], MON_0900);
    expect(first.insertedIds).toHaveLength(1);
    expect(again.insertedIds).toHaveLength(0); // url_hash UNIQUE + ON CONFLICT DO NOTHING
    const tracked = await insertArticles(null, [raw("Kirana startup raises funding round", "https://news.test/kirana-raises/?utm_source=newsletter&utm_medium=email")], MON_0900);
    const r = await dedupe(tracked.insertedIds, WEEK);
    expect(r.sameUrl).toBe(1);
    const row = (await sql`SELECT duplicate_of, duplicate_reason FROM articles WHERE id = ${tracked.insertedIds[0]}`)[0];
    expect(row).toEqual({ duplicate_of: first.insertedIds[0], duplicate_reason: "same_url" });
  });

  it("flags near-identical titles from different outlets as similar_title", async () => {
    const a = await insertArticles(null, [raw("Zetwerk sets IPO price band at Rs 143-151; eyes Rs 5,012 Cr from issue", "https://a.test/zetwerk")], MON_0900);
    const b = await insertArticles(null, [raw("Zetwerk Sets IPO Price Band At ₹143-₹151 For ₹5,012 Cr Issue", "https://b.test/zetwerk-ipo")], MON_0900);
    const c = await insertArticles(null, [raw("Ola Electric shares fall after pledge news", "https://c.test/ola")], MON_0900);
    const r = await dedupe([...a.insertedIds, ...b.insertedIds, ...c.insertedIds], WEEK);
    expect(r.similarTitle).toBe(1);
    const rows = await sql`SELECT id, duplicate_of, duplicate_reason FROM articles WHERE NOT is_sample ORDER BY id`;
    expect(rows[1]).toMatchObject({ duplicate_of: a.insertedIds[0], duplicate_reason: "similar_title" });
    expect(rows[2].duplicate_of).toBeNull();
  });
});

describe("previous four newsletters are excluded (C3)", () => {
  beforeEach(resetDb);

  it("marks an article matching a story from the last four issues as covered_in_past_issue and drops it from candidates", async () => {
    // Seeded issue #1 contains "Kiranaflow raises Series B to take kirana credit to Tier-3 towns".
    const ins = await insertArticles(null, [
      raw("Kiranaflow raises Series B to take kirana credit into Tier-3 towns", "https://other-outlet.test/kiranaflow-series-b"),
      raw("A genuinely new story about Indian SaaS exports", "https://other-outlet.test/saas"),
    ], MON_0900);
    const r = await dedupe(ins.insertedIds, WEEK);
    expect(r.pastIssue).toBe(1);
    const row = (await sql`SELECT a.duplicate_reason, p.title FROM articles a JOIN articles p ON p.id = a.duplicate_of WHERE a.id = ${ins.insertedIds[0]}`)[0];
    expect(row.duplicate_reason).toBe("covered_in_past_issue");
    expect(row.title).toBe("Kiranaflow raises Series B to take kirana credit to Tier-3 towns");
    await sql`UPDATE articles SET topic = 'Funding & Deals' WHERE id = ANY(${ins.insertedIds})`;
    const ids = (await candidates(WEEK)).map((c) => c.id);
    expect(ids).not.toContain(ins.insertedIds[0]);
    expect(ids).toContain(ins.insertedIds[1]);
  });

  it("also catches the same link with tracking parameters", async () => {
    const past = (await sql`SELECT url FROM articles WHERE is_sample LIMIT 1`)[0].url;
    const ins = await insertArticles(null, [raw("Different headline, same link", `${past}?utm_source=x`)], MON_0900);
    await dedupe(ins.insertedIds, WEEK);
    expect((await sql`SELECT duplicate_reason FROM articles WHERE id = ${ins.insertedIds[0]}`)[0].duplicate_reason).toBe("covered_in_past_issue");
  });
});

describe("graceful feed failure (B4)", () => {
  beforeEach(resetDb);

  it("logs a broken feed as failed while the run succeeds", async () => {
    const r = await ingest(MON_0900, { extraSources: [BROKEN_TEST_SOURCE], sourceFilter: (s) => s.name === BROKEN_TEST_SOURCE.name });
    expect(r.perSource).toHaveLength(1);
    expect(r.perSource[0]).toMatchObject({ name: BROKEN_TEST_SOURCE.name, status: "failed" });
    const src = (await sql`SELECT last_status, last_error FROM sources WHERE name = ${BROKEN_TEST_SOURCE.name}`)[0];
    expect(src.last_status).toBe("failed");
    expect(src.last_error).toBeTruthy();
  });
});
