import { query } from "./db";

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;
export const MAX_IMPORT_ROWS = 10000;

/** Minimal CSV line parser (handles quoted fields with commas). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Import a subscriber CSV (e.g. the 2,200-person list exported from her current tool).
 * Columns: email (required), name (optional); a header row is detected. Existing
 * addresses are left untouched, so unsubscribed/bounced people are never re-activated.
 */
export async function importSubscribersCsv(csv: string) {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: 0, added: 0, alreadyListed: 0, invalid: 0, invalidExamples: [] as string[] };
  let header = parseLine(lines[0]).map((h) => h.toLowerCase());
  let emailCol = header.findIndex((h) => /e-?mail/.test(h));
  let nameCol = header.findIndex((h) => /name/.test(h));
  const hasHeader = emailCol >= 0;
  if (!hasHeader) { emailCol = 0; nameCol = 1; header = []; }
  const body = lines.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + MAX_IMPORT_ROWS);

  const seen = new Set<string>();
  const valid: { email: string; name: string | null }[] = [];
  const invalidExamples: string[] = [];
  let invalid = 0;
  for (const line of body) {
    const cols = parseLine(line);
    const email = (cols[emailCol] ?? "").toLowerCase();
    if (!EMAIL.test(email)) { invalid++; if (invalidExamples.length < 5) invalidExamples.push(email || "(blank)"); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push({ email, name: nameCol >= 0 && cols[nameCol] ? cols[nameCol].slice(0, 120) : null });
  }
  const inserted = valid.length
    ? await query(
        `WITH ins AS (
           INSERT INTO subscribers (email, name, status, is_test_recipient, is_sample)
           SELECT e, n, 'active', false, false FROM unnest($1::text[], $2::text[]) AS t(e, n)
           ON CONFLICT (email) DO NOTHING RETURNING id)
         INSERT INTO subscriber_events (subscriber_id, status, reason) SELECT id, 'active', 'Imported via CSV' FROM ins RETURNING subscriber_id`,
        [valid.map((v) => v.email), valid.map((v) => v.name)],
      )
    : [];
  return { rows: body.length, added: inserted.length, alreadyListed: valid.length - inserted.length, invalid, invalidExamples };
}
