import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { loadEnv } from "./load-env";
loadEnv();

/**
 * One-time generation of the topic illustrations used on the dashboard (public/topics/*.jpg),
 * with Gemini's Flash image model (keeps the app Gemini-Flash-only). Re-run with --force to redo.
 */
export const TOPIC_ART: Record<string, { slug: string; scene: string }> = {
  "Funding & Deals": { slug: "funding", scene: "two hands shaking over a table with stacks of rupee coins and a signed term sheet, a Bengaluru office window behind" },
  "AI & Deeptech": { slug: "ai", scene: "a microchip drawn like a city map with circuit lines, a small satellite and a robotic arm beside it" },
  "Policy & Regulation": { slug: "policy", scene: "a classical government building with columns, a gavel and a stack of official files tied with red tape" },
  "Fintech": { slug: "fintech", scene: "a phone showing a QR code at a small kirana shop counter, a customer's hand scanning it to pay" },
  "Consumer & Commerce": { slug: "consumer", scene: "a delivery rider on a scooter with an insulated box weaving through a busy Indian market street" },
  "Markets & IPOs": { slug: "markets", scene: "a stock exchange trading board with rising and falling line charts and a ringing opening bell" },
  "Talent & Layoffs": { slug: "talent", scene: "rows of office desks with laptops, some chairs empty, a cardboard box of belongings on one desk" },
  "Climate & Mobility": { slug: "climate", scene: "an electric three-wheeler auto rickshaw at a charging point, solar panels and wind turbines on the horizon" },
  Other: { slug: "other", scene: "a rolled newspaper, a cup of chai and a pair of reading glasses on a wooden table" },
};

const STYLE = "Vintage newspaper illustration: black ink etching with halftone dot shading, printed on cream newsprint, high contrast, " +
  "slightly worn print texture, square composition. Absolutely no writing of any kind: no text, letters, numbers, signs, labels or characters in any script or language, and blank surfaces where labels would be. No logos, no real or recognisable people.";

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  for (const [topic, { slug, scene }] of Object.entries(TOPIC_ART)) {
    if (only && only !== slug) continue;
    const out = `public/topics/${slug}.jpg`;
    if (fs.existsSync(out) && !process.argv.includes("--force")) { console.log(`= ${out}`); continue; }
    const res = await ai.models.generateContent({ model, contents: `${STYLE} Scene for the news topic "${topic}" in India: ${scene}.`, config: { responseModalities: ["IMAGE"] } });
    const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error(`no image returned for ${topic}`);
    fs.writeFileSync(out, Buffer.from(part.inlineData.data, "base64"));
    console.log(`+ ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, ${part.inlineData.mimeType})`);
  }
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/generate-topic-art.ts")) main().catch((e) => { console.error(String(e?.message || e).slice(0, 400)); process.exit(1); });
