/** Topic → illustration (generated once by scripts/generate-topic-art.ts with Gemini's Flash image model). */
export const TOPIC_IMAGE: Record<string, string> = {
  "Funding & Deals": "/topics/funding.jpg",
  "AI & Deeptech": "/topics/ai.jpg",
  "Policy & Regulation": "/topics/policy.jpg",
  Fintech: "/topics/fintech.jpg",
  "Consumer & Commerce": "/topics/consumer.jpg",
  "Markets & IPOs": "/topics/markets.jpg",
  "Talent & Layoffs": "/topics/talent.jpg",
  "Climate & Mobility": "/topics/climate.jpg",
  Other: "/topics/other.jpg",
};

export const topicImage = (topic: string | null | undefined) => TOPIC_IMAGE[topic ?? "Other"] ?? TOPIC_IMAGE.Other;

/** Muted "ink" colour per topic — used for labels, tags and thin rules, never large fills. */
export const TOPIC_COLOR: Record<string, string> = {
  "Funding & Deals": "#8a6a2f",
  "AI & Deeptech": "#3f6474",
  "Policy & Regulation": "#6b4a6e",
  Fintech: "#3e6b55",
  "Consumer & Commerce": "#9a5b3c",
  "Markets & IPOs": "#2f5175",
  "Talent & Layoffs": "#7a4a4a",
  "Climate & Mobility": "#4f6b33",
  Other: "#6e655a",
};

export const topicColor = (topic: string | null | undefined) => TOPIC_COLOR[topic ?? "Other"] ?? TOPIC_COLOR.Other;

/** Inline style that exposes the topic colour as the CSS variable --tc. */
export const tc = (topic: string | null | undefined) => ({ "--tc": topicColor(topic) }) as React.CSSProperties;
