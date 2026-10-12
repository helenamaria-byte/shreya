import { GoogleGenAI } from "@google/genai";

/** The only AI used by the app: a Gemini Flash model via the official SDK. */
export function geminiModel(): string {
  const m = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!/flash/i.test(m)) throw new Error(`GEMINI_MODEL must be a Flash model, got ${m}`);
  return m;
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One JSON-mode call with a response schema. Retries 429/5xx with exponential
 * backoff (free-tier friendly); other errors are thrown immediately.
 */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
  retries?: number;
}): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: geminiModel(),
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
          temperature: opts.temperature ?? 0.4,
        },
      });
      const text = res.text;
      if (!text) throw new Error("Gemini returned an empty response");
      return JSON.parse(text) as T;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.code ?? Number(String(err?.message).match(/\b(429|5\d\d)\b/)?.[1]);
      const retryable = status === 429 || (status >= 500 && status < 600) || err instanceof SyntaxError;
      if (!retryable || attempt === retries) break;
      await sleep(Math.min(30000, 1500 * 2 ** attempt) + Math.random() * 500);
    }
  }
  throw lastErr;
}
