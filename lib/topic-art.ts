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
