import { query, sql } from "./db";
import { generateJson } from "./gemini";
import { distinctTopics } from "./topics";

export const MIN_STORIES = 8;
export const MAX_STORIES = 10;
export const MIN_TOPICS = 3;
export const MIN_CANDIDATES = 12;
export const RESERVE_COUNT = 5;
const MAX_CANDIDATES_IN_PROMPT = 150;

export type Candidate = {
  id: number; title: string; source_name: string; topic: string; summary: string | null;
  published_at: string | null; url: string;
};

export async function latestVoiceGuide(): Promise<{ id: number; version: number; content: string; updated_at: string } | null> {
  const rows = await sql`SELECT id, version, content, updated_at FROM voice_guide ORDER BY version DESC LIMIT 1`;
  return (rows[0] as any) ?? null;
}

/** Non-duplicate, tagged, on-topic articles collected this week that aren't already part of the issue. */
export async function candidates(week: string, excludeIssueId?: number): Promise<Candidate[]> {
  return query(
    `SELECT a.id, a.title, a.source_name, a.topic, a.summary, a.published_at, a.url
     FROM articles a
     WHERE a.issue_week = $1 AND a.duplicate_of IS NULL AND NOT a.is_sample
       AND a.topic IS NOT NULL AND a.topic <> 'Other'
       AND ($2::int IS NULL OR a.id NOT IN (SELECT article_id FROM issue_stories WHERE issue_id = $2))
     ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT $3`,
    [week, excludeIssueId ?? null, MAX_CANDIDATES_IN_PROMPT],
  ) as Promise<Candidate[]>;
}

export async function pastHeadlines(week: string): Promise<{ issue_number: number; title: string }[]> {
  return query(
    `WITH recent AS (SELECT id, issue_number FROM issues WHERE status = 'sent' AND week_key < $1 ORDER BY week_key DESC LIMIT 4)
     SELECT r.issue_number, a.title FROM issue_stories s JOIN recent r ON r.id = s.issue_id JOIN articles a ON a.id = s.article_id
     WHERE s.state = 'selected' ORDER BY r.issue_number DESC, s.position`,
    [week],
  ) as any;
}

export function sufficiency(cands: Pick<Candidate, "topic">[]) {
  const topics = distinctTopics(cands.map((c) => c.topic));
  return { count: cands.length, topics, enough: cands.length >= MIN_CANDIDATES && topics.length >= MIN_TOPICS };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
export type Selection = {
  selected: { article_id: number; position: number; rationale: string; connects_with?: string }[];
  reserves: { article_id: number; rank: number; rationale: string }[];
};

/** The editorial criteria, stated verbatim in the prompt (rubric D3). */
export const SELECTION_CRITERIA = `Selection criteria:
- High signal-to-noise relative to this week's batch: pick what matters most compared with everything else in this list.
- Prefer stories that are counterintuitive, under-reported, or connect two trends others haven't linked.
- Skip PR fluff, routine announcements, and duplicates of the same event.
- Choose 8–10 stories.
- Cover at least 3 different topics.
- Include nothing from the last four issues (headlines below), including the same underlying event reported by a different outlet.`;

const SELECTION_SCHEMA = {
  type: "object",
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          article_id: { type: "integer" },
          position: { type: "integer" },
          rationale: { type: "string", description: "One sentence: why this story earns a place this week." },
          connects_with: { type: "string", description: "Optional: the trend or other selected story this links to." },
        },
        required: ["article_id", "position", "rationale"],
      },
    },
    reserves: {
      type: "array",
      items: {
        type: "object",
        properties: { article_id: { type: "integer" }, rank: { type: "integer" }, rationale: { type: "string" } },
        required: ["article_id", "rank", "rationale"],
      },
    },
  },
  required: ["selected", "reserves"],
};

export function selectionPrompt(cands: Candidate[], voice: string, past: { issue_number: number; title: string }[], feedback?: string[]) {
  return [
    `You are the editor of "The Dispatch", a weekly newsletter on the Indian startup and tech ecosystem written by Shreya.`,
    `Pick this week's stories from the candidate list.`,
    ``,
    SELECTION_CRITERIA,
    ``,
    `Return ${RESERVE_COUNT} ranked reserves (backups) that are not in the selection.`,
    `Use only article_id values from the candidate list. Positions start at 1 (lead story first).`,
    ``,
    `Editorial voice guide (for judging what Shreya would find interesting):`,
    voice,
    ``,
    `Headlines from the last four issues (do NOT repeat these stories or the same underlying events):`,
    past.length ? past.map((p) => `#${p.issue_number}: ${p.title}`).join("\n") : "(none)",
    ``,
    `Candidates (id | topic | source | published | title | summary):`,
    cands.map((c) => `${c.id} | ${c.topic} | ${c.source_name} | ${c.published_at ? new Date(c.published_at).toISOString().slice(0, 10) : "?"} | ${c.title} | ${(c.summary || "").slice(0, 220)}`).join("\n"),
    feedback?.length ? `\nYour previous answer was invalid. Fix these problems:\n- ${feedback.join("\n- ")}` : "",
  ].join("\n");
}

/** Validate the model's selection in code; never trust it blindly (rubric D1, D2). */
export function validateSelection(sel: Selection, cands: Candidate[], pastArticleIds: Set<number> = new Set()): string[] {
  const errors: string[] = [];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const ids = sel.selected.map((s) => s.article_id);
  for (const id of ids) {
    if (!byId.has(id)) errors.push(`article_id ${id} is not in the candidate list`);
    if (pastArticleIds.has(id)) errors.push(`article_id ${id} was covered in one of the last four issues`);
  }
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`duplicate article_id(s): ${[...new Set(dupes)].join(", ")}`);
  if (ids.length < MIN_STORIES || ids.length > MAX_STORIES) errors.push(`selected ${ids.length} stories; must be ${MIN_STORIES}–${MAX_STORIES}`);
  const topics = distinctTopics(ids.map((id) => byId.get(id)?.topic));
  if (topics.length < MIN_TOPICS) errors.push(`only ${topics.length} topic(s) (${topics.join(", ") || "none"}); need at least ${MIN_TOPICS}`);
  for (const r of sel.reserves) {
    if (!byId.has(r.article_id)) errors.push(`reserve article_id ${r.article_id} is not in the candidate list`);
    if (ids.includes(r.article_id)) errors.push(`reserve article_id ${r.article_id} is also selected`);
  }
  return errors;
}

/**
 * Deterministic repair: drop invalid/duplicate IDs, trim to 10, fill to 8 from
 * reserves then the most recent candidates, then swap in stories from missing
 * topics until there are 3 topics. Rebuilds reserves to 5 valid IDs.
 */
export function repairSelection(sel: Selection, cands: Candidate[], pastArticleIds: Set<number> = new Set()): { selection: Selection; log: string[] } {
  const log: string[] = [];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const ok = (id: number) => byId.has(id) && !pastArticleIds.has(id);
  const seen = new Set<number>();
  let selected = [...sel.selected]
    .sort((a, b) => a.position - b.position)
    .filter((s) => {
      if (!ok(s.article_id) || seen.has(s.article_id)) { log.push(`dropped invalid/duplicate id ${s.article_id}`); return false; }
      seen.add(s.article_id); return true;
    });
  if (selected.length > MAX_STORIES) { log.push(`trimmed from ${selected.length} to ${MAX_STORIES}`); selected = selected.slice(0, MAX_STORIES); }

  const pool = [
    ...sel.reserves.sort((a, b) => a.rank - b.rank).map((r) => ({ id: r.article_id, rationale: r.rationale })),
    ...cands.map((c) => ({ id: c.id, rationale: "Added by the validator to meet the story/topic minimum." })),
  ].filter((p, i, arr) => ok(p.id) && arr.findIndex((x) => x.id === p.id) === i);
  const unused = () => pool.filter((p) => !selected.some((s) => s.article_id === p.id));
  const topicsOf = (list: { article_id: number }[]) => distinctTopics(list.map((s) => byId.get(s.article_id)?.topic));

  while (selected.length < MIN_STORIES && unused().length) {
    const have = new Set(topicsOf(selected));
    const next = unused().find((p) => !have.has(byId.get(p.id)!.topic)) ?? unused()[0];
    selected.push({ article_id: next.id, position: selected.length + 1, rationale: next.rationale });
    log.push(`filled with id ${next.id}`);
  }
  // Topic spread: replace the lowest-ranked story of an over-represented topic.
  let guard = 0;
  while (topicsOf(selected).length < MIN_TOPICS && guard++ < 10) {
    const have = new Set(topicsOf(selected));
    const add = unused().find((p) => { const t = byId.get(p.id)!.topic; return t !== "Other" && !have.has(t); });
    if (!add) break;
    const counts = new Map<string, number>();
    selected.forEach((s) => counts.set(byId.get(s.article_id)!.topic, (counts.get(byId.get(s.article_id)!.topic) || 0) + 1));
    const idx = [...selected.keys()].reverse().find((i) => (counts.get(byId.get(selected[i].article_id)!.topic) || 0) > 1);
    if (idx === undefined) { selected.push({ article_id: add.id, position: 0, rationale: add.rationale }); }
    else { log.push(`replaced id ${selected[idx].article_id} with id ${add.id} for topic spread`); selected[idx] = { article_id: add.id, position: 0, rationale: add.rationale }; }
    if (selected.length > MAX_STORIES) selected = selected.slice(0, MAX_STORIES);
  }
  selected = selected.map((s, i) => ({ ...s, position: i + 1 }));

  // `pool` already lists the model's reserves (by rank) before the other candidates.
  const reserves = unused().slice(0, RESERVE_COUNT);
  return {
    selection: { selected, reserves: reserves.map((p, i) => ({ article_id: p.id, rank: i + 1, rationale: p.rationale })) },
    log,
  };
}

export async function selectStories(cands: Candidate[], voice: string, past: { issue_number: number; title: string }[]) {
  const system = "You are a sharp, careful newsletter editor. Return JSON only, matching the schema.";
  let sel = await generateJson<Selection>({ system, prompt: selectionPrompt(cands, voice, past), schema: SELECTION_SCHEMA, temperature: 0.5 });
  let errors = validateSelection(sel, cands);
  const attempts: { attempt: number; errors: string[] }[] = [{ attempt: 1, errors }];
  if (errors.length) {
    sel = await generateJson<Selection>({ system, prompt: selectionPrompt(cands, voice, past, errors), schema: SELECTION_SCHEMA, temperature: 0.3 });
    errors = validateSelection(sel, cands);
    attempts.push({ attempt: 2, errors });
  }
  let repairLog: string[] = [];
  const reservesValid = sel.reserves.filter((r) => cands.some((c) => c.id === r.article_id) && !sel.selected.some((s) => s.article_id === r.article_id)).length >= Math.min(RESERVE_COUNT, cands.length - sel.selected.length);
  if (errors.length || !reservesValid) {
    const repaired = repairSelection(sel, cands);
    sel = repaired.selection;
    repairLog = repaired.log;
  }
  return { selection: sel, attempts, repairLog, geminiCalls: attempts.length };
}

// ---------------------------------------------------------------------------
// Commentary
// ---------------------------------------------------------------------------
export const GROUNDING_RULES = `Grounding rules (strict):
- Use only facts present in the provided title and summary. Do not add outside facts.
- Never invent numbers, amounts, percentages, quotes, names or valuations.
- When you make a judgment, frame it clearly as opinion ("I think", "my read", "worth watching whether").
- If the summary is too thin, say less rather than more.
- Exactly 2 or 3 sentences per story. No emojis, no hype words.
- Vary your phrasing across stories: don't open more than one story with the same words (e.g. "My read is").`;

const COMMENTARY_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: { type: "object", properties: { article_id: { type: "integer" }, commentary: { type: "string" } }, required: ["article_id", "commentary"] },
    },
  },
  required: ["items"],
};

export async function writeCommentary(stories: Candidate[], voice: string): Promise<Map<number, string>> {
  const out = await generateJson<{ items: { article_id: number; commentary: string }[] }>({
    system: "You write short, insightful newsletter commentary in the author's voice. Return JSON only.",
    prompt: [
      `Write commentary for each story below for "The Dispatch" (Indian startup and tech newsletter).`,
      `Say why it matters, not what happened. Follow the voice guide exactly.`,
      ``,
      GROUNDING_RULES,
      ``,
      `Voice guide:`,
      voice,
      ``,
      `Stories (article_id | source | title | summary):`,
      stories.map((s) => `${s.id} | ${s.source_name} | ${s.title} | ${s.summary || "(no summary available — keep it short and cautious)"}`).join("\n"),
    ].join("\n"),
    schema: COMMENTARY_SCHEMA,
    temperature: 0.7,
  });
  return new Map(out.items.map((i) => [i.article_id, i.commentary.trim()]));
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    // Don't split after common abbreviations ("Rs. 5", "Mr. Rao", "U.S. firms").
    .split(/(?<!\b(?:Rs|Mr|Mrs|Ms|Dr|No|vs|Inc|Ltd|Co|St|Jr|Sr|approx|U\.S|e\.g|i\.e)\.)(?<=[.!?…]["'”’)]?)\s+(?=["'“‘(]?[A-Z0-9₹$])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Numbers in the commentary (₹500 crore, 12%, 3x, 2026 ...) that do not appear in the source text. */
export function unsupportedNumbers(commentary: string, source: string): string[] {
  const norm = (s: string) => s.replace(/(?<=\d),(?=\d)/g, "");
  const src = norm(source.toLowerCase());
  // Digits inside alphanumeric tokens (B2B, Q3, H1B) are not figures.
  const found = norm(commentary).match(/(?<![A-Za-z\d.])\d+(?:\.\d+)?/g) || [];
  return [...new Set(found.filter((n) => !new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(src)))];
}

/** Post-checks on commentary (rubric D4, D6): 2–3 sentences and no numbers absent from the source. */
export function checkCommentary(commentary: string, source: string): { commentary: string; needsReview: boolean; notes: string[] } {
  const notes: string[] = [];
  let sentences = splitSentences(commentary);
  if (sentences.length > 3) { notes.push(`trimmed from ${sentences.length} to 3 sentences`); sentences = sentences.slice(0, 3); }
  let needsReview = false;
  if (sentences.length < 2) { needsReview = true; notes.push(`only ${sentences.length} sentence(s)`); }
  const text = sentences.join(" ");
  const bad = unsupportedNumbers(text, source);
  if (bad.length) { needsReview = true; notes.push(`number(s) not in the source: ${bad.join(", ")}`); }
  return { commentary: text, needsReview, notes };
}

// ---------------------------------------------------------------------------
// Swap replacement when reserves run out
// ---------------------------------------------------------------------------
export async function geminiReplacement(cands: Candidate[], keep: { title: string; topic: string }[], voice: string, removed: string[] = []) {
  const out = await generateJson<{ article_id: number; rationale: string; commentary: string }>({
    system: "You are a sharp, careful newsletter editor. Return JSON only.",
    prompt: [
      `One story was removed from this week's issue of "The Dispatch". Pick ONE replacement from the candidates.`,
      SELECTION_CRITERIA.split("\n").filter((l) => !/8–10|3 different/.test(l)).join("\n"),
      `Prefer a topic that keeps the issue spread across at least 3 topics.`,
      `Then write its 2–3 sentence commentary.`,
      GROUNDING_RULES,
      `Voice guide:\n${voice}`,
      `Stories already in the issue:\n${keep.map((k) => `- [${k.topic}] ${k.title}`).join("\n")}`,
      removed.length ? `Shreya removed these stories from the draft. Do NOT pick them again, or any other article about the same events:\n${removed.map((t) => `- ${t}`).join("\n")}` : "",
      `Candidates (id | topic | source | title | summary):\n${cands.map((c) => `${c.id} | ${c.topic} | ${c.source_name} | ${c.title} | ${(c.summary || "").slice(0, 200)}`).join("\n")}`,
    ].join("\n\n"),
    schema: {
      type: "object",
      properties: { article_id: { type: "integer" }, rationale: { type: "string" }, commentary: { type: "string" } },
      required: ["article_id", "rationale", "commentary"],
    },
  });
  if (!cands.some((c) => c.id === out.article_id)) throw new Error(`Gemini picked unknown article ${out.article_id}`);
  return out;
}
