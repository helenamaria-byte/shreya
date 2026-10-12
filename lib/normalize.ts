import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|source|cmpid|_ga|yclid|spm|s_cid|ocid|from|trk)$/i;

/** Lowercase host, drop tracking params, fragment, default ports, trailing slash and "www.". */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  u.protocol = "https:";
  u.port = "";
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = keep.length ? "?" + new URLSearchParams(keep).toString() : "";
  let path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith("/amp")) path = path.slice(0, -4);
  u.pathname = path || "/";
  return u.toString().replace(/\/$/, "").replace(/\/\?/, "?");
}

/**
 * Google News RSS links are opaque redirects. Older ones carry the target URL in
 * base64 inside the path; decode it when possible, otherwise keep the link
 * (title similarity still catches the duplicate).
 */
export function resolveGoogleNewsUrl(link: string): string {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith("news.google.com")) return link;
    const id = u.pathname.split("/").pop() || "";
    const bytes = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const m = bytes.match(/https?:\/\/[\x21-\x7e]+/);
    if (m && !m[0].includes("news.google.com")) return m[0].replace(/[\x00-\x1f\xd2].*$/, "");
  } catch { /* keep original */ }
  return link;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s: string | undefined | null, max = 600): string {
  if (!s) return "";
  const text = decodeEntities(
    s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

/** Google News titles end in " - Publisher"; strip it so similarity compares the headline itself. */
export function cleanTitle(title: string, sourceHint?: string): string {
  let t = decodeEntities(title).replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*\S)\s+[-–|]\s+([^-–|]{2,40})$/);
  if (m && (sourceHint?.startsWith("Google News") || sourceHint?.startsWith("GNews"))) t = m[1];
  return t;
}
