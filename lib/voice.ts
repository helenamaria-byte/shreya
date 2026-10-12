import { sql } from "./db";
import { generateJson } from "./gemini";
import { latestVoiceGuide } from "./editorial";

export const MIN_SAMPLE_CHARS = 400;

/**
 * "Learn my voice": Gemini Flash reads Shreya's own past commentary and writes the
 * style guide that every later prompt uses. Saved as a new version (source = learned).
 */
export async function learnVoice(samples: string) {
  const text = samples.trim().slice(0, 30000);
  if (text.length < MIN_SAMPLE_CHARS) throw new Error(`Paste at least ${MIN_SAMPLE_CHARS} characters of past newsletters (got ${text.length}).`);
  const current = await latestVoiceGuide();
  const out = await generateJson<{ content: string }>({
    system: "You are an editor who documents a writer's voice precisely. Return JSON only.",
    prompt: [
      `Below are past newsletter issues written by Shreya for "The Dispatch", a weekly newsletter on the Indian startup ecosystem.`,
      `Write her editorial voice guide in markdown, about 300 words, describing HOW she writes so another writer could imitate it.`,
      `Structure:`,
      `# The Dispatch — editorial voice guide`,
      `## Who we sound like (tone, sentence length, vocabulary)`,
      `## What each commentary does (what she focuses on, how she frames opinions, how she uses Indian context)`,
      `## Examples (3 short lines quoted or closely paraphrased from her samples)`,
      `## Never do (habits she clearly avoids)`,
      `Base every statement on the samples. Do not invent facts about her. Keep the 2–3 sentence commentary format.`,
      current ? `\nThe current guide, for reference only (replace anything the samples contradict):\n${current.content}` : "",
      `\nSamples:\n${text}`,
    ].join("\n"),
    schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
    temperature: 0.3,
  });
  const content = `> Learned by Gemini Flash from ${text.length.toLocaleString("en-IN")} characters of Shreya's own writing on ${new Date().toISOString().slice(0, 10)}. Edit freely.\n\n${out.content.trim()}`;
  const v = await sql`INSERT INTO voice_guide (content, version, is_assumption, source)
                      VALUES (${content}, (SELECT COALESCE(MAX(version), 0) + 1 FROM voice_guide), false, 'learned') RETURNING version`;
  return { version: v[0].version as number, content };
}
