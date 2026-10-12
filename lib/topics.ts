import { generateJson } from "./gemini";

export const TOPICS = [
  "Funding & Deals",
  "AI & Deeptech",
  "Policy & Regulation",
  "Fintech",
  "Consumer & Commerce",
  "Markets & IPOs",
  "Talent & Layoffs",
  "Climate & Mobility",
  "Other",
] as const;
export type Topic = (typeof TOPICS)[number];

/** Topic spread counts every topic except "Other", which is not a real area. */
export function distinctTopics(topics: (string | null | undefined)[]): string[] {
  return [...new Set(topics.filter((t): t is string => !!t && t !== "Other"))];
}

const KEYWORDS: [Topic, RegExp][] = [
  ["Markets & IPOs", /\b(ipo|drhp|listing|listed|sebi nod|stock|shares|sensex|nifty|market cap|valuation cut|anchor investors)\b/i],
  ["Policy & Regulation", /\b(sebi|rbi|meity|dpiit|regulat|policy|ministry|government|govt|tax|gst|compliance|ban|court|parliament|bill|rules|norms|data protection)\b/i],
  ["Fintech", /\b(fintech|upi|payment|lending|nbfc|credit|neobank|insurtech|wealthtech|bank|loan|wallet|bnpl)\b/i],
  ["AI & Deeptech", /\b(ai|artificial intelligence|genai|llm|machine learning|deeptech|semiconductor|chip|robotic|quantum|space ?tech|saas)\b/i],
  ["Talent & Layoffs", /\b(layoff|lay off|laid off|fires|hiring|job cuts|employees|esop|talent|attrition|ceo steps down|appoints)\b/i],
  ["Climate & Mobility", /\b(ev|electric vehicle|climate|solar|renewable|battery|mobility|charging|green hydrogen|carbon)\b/i],
  ["Consumer & Commerce", /\b(quick commerce|q-?comm|d2c|ecommerce|e-commerce|retail|consumer|brand|delivery|zepto|blinkit|swiggy|zomato|food|fashion)\b/i],
  ["Funding & Deals", /\b(raises|raised|funding|series [a-f]|seed round|pre-series|investment|acquires|acquisition|merger|backed|crore round|led by|valuation)\b/i],
];

export function keywordTopic(text: string): { topic: Topic; confidence: number } {
  for (const [topic, re] of KEYWORDS) if (re.test(text)) return { topic, confidence: 0.4 };
  return { topic: "Other", confidence: 0.2 };
}

type TagInput = { id: number; title: string; summary?: string | null };

/** Batch topic classification with Gemini; falls back to keywords per article if the call fails. */
export async function tagTopics(items: TagInput[]): Promise<{ results: Map<number, { topic: Topic; confidence: number; method: "gemini" | "keyword" }>; geminiCalls: number; fallback: boolean; error?: string }> {
  const results = new Map<number, { topic: Topic; confidence: number; method: "gemini" | "keyword" }>();
  let geminiCalls = 0, fallback = false, error: string | undefined;
  const BATCH = 120;
  const batches: TagInput[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  await Promise.all(batches.map(async (batch) => {
    try {
      geminiCalls++;
      const out = await generateJson<{ items: { id: number; topic: Topic; confidence: number }[] }>({
        system: "You classify Indian startup and technology news headlines into a fixed topic list. Return JSON only.",
        prompt:
          `Topics (use exactly one of these strings): ${TOPICS.join(" | ")}.\n` +
          `Pick the single best topic for each article. Use "Other" only when nothing fits (e.g. gadget reviews, general politics, sport).\n` +
          `confidence is 0..1.\n\nArticles:\n` +
          batch.map((a) => `${a.id}\t${a.title}\t${(a.summary || "").slice(0, 160)}`).join("\n"),
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  topic: { type: "string", enum: [...TOPICS] },
                  confidence: { type: "number" },
                },
                required: ["id", "topic", "confidence"],
              },
            },
          },
          required: ["items"],
        },
        temperature: 0,
      });
      for (const r of out.items) {
        if (batch.some((b) => b.id === r.id) && (TOPICS as readonly string[]).includes(r.topic))
          results.set(r.id, { topic: r.topic, confidence: Math.max(0, Math.min(1, r.confidence)), method: "gemini" });
      }
    } catch (e: any) {
      fallback = true;
      error = String(e?.message || e).slice(0, 300);
    }
    for (const a of batch) if (!results.has(a.id)) results.set(a.id, { ...keywordTopic(`${a.title} ${a.summary ?? ""}`), method: "keyword" });
  }));
  return { results, geminiCalls, fallback, error };
}
