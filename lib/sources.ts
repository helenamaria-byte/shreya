/**
 * News sources. Every direct RSS feed below was verified live on 2026-10-12
 * (see docs/ASSUMPTIONS.md for the ones that were dropped and why).
 */
export type SourceDef = { name: string; type: "rss" | "gnews"; url_or_query: string };

const gn = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:7d")}&hl=en-IN&gl=IN&ceid=IN:en`;

export const SOURCES: SourceDef[] = [
  // Indian startup / tech publications (direct RSS)
  { name: "Inc42", type: "rss", url_or_query: "https://inc42.com/feed/" },
  { name: "YourStory", type: "rss", url_or_query: "https://yourstory.com/feed" },
  { name: "Entrackr", type: "rss", url_or_query: "https://entrackr.com/rss" },
  { name: "ET Tech", type: "rss", url_or_query: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms" },
  { name: "ET Startups", type: "rss", url_or_query: "https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570550.cms" },
  { name: "ET Markets IPOs", type: "rss", url_or_query: "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms" },
  { name: "Mint Technology", type: "rss", url_or_query: "https://www.livemint.com/rss/technology" },
  { name: "Mint Companies", type: "rss", url_or_query: "https://www.livemint.com/rss/companies" },
  { name: "Business Standard Technology", type: "rss", url_or_query: "https://www.business-standard.com/rss/technology-108.rss" },
  { name: "MediaNama", type: "rss", url_or_query: "https://www.medianama.com/feed/" },
  { name: "TechCrunch India", type: "rss", url_or_query: "https://techcrunch.com/tag/india/feed/" },
  { name: "BusinessLine Info-Tech", type: "rss", url_or_query: "https://www.thehindubusinessline.com/info-tech/feeder/default.rss" },
  { name: "Business Today Tech", type: "rss", url_or_query: "https://www.businesstoday.in/rss/technology" },
  { name: "The Hindu Business", type: "rss", url_or_query: "https://www.thehindu.com/business/feeder/default.rss" },
  { name: "Indian Express Tech", type: "rss", url_or_query: "https://indianexpress.com/section/technology/feed/" },
  // Google News search feeds (RSS)
  { name: "Google News: startup funding", type: "rss", url_or_query: gn("India startup funding raises") },
  { name: "Google News: AI startups", type: "rss", url_or_query: gn("Indian AI startup") },
  { name: "Google News: startup policy", type: "rss", url_or_query: gn("startup India SEBI OR RBI OR MeitY OR DPIIT") },
  { name: "Google News: quick commerce & D2C", type: "rss", url_or_query: gn("India quick commerce OR D2C brand") },
  // GNews API queries (country=in, English). The free plan returns little for long AND-queries, so terms are broad.
  { name: "GNews: startup funding", type: "gnews", url_or_query: "startup funding" },
  { name: "GNews: AI startups", type: "gnews", url_or_query: "AI startup" },
  { name: "GNews: IPOs", type: "gnews", url_or_query: "startup IPO" },
  { name: "GNews: fintech", type: "gnews", url_or_query: "fintech" },
  { name: "GNews: layoffs & talent", type: "gnews", url_or_query: "layoffs" },
  { name: "GNews: climate & EV", type: "gnews", url_or_query: "electric vehicle" },
];

/** A deliberately broken feed used by the graceful-failure test (B4). */
export const BROKEN_TEST_SOURCE: SourceDef = {
  name: "TEST broken feed", type: "rss", url_or_query: "https://example.invalid/this-feed-does-not-exist.xml",
};
