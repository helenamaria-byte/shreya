import { loadEnv } from "./load-env";

loadEnv();

export const VOICE_GUIDE = `# The Dispatch — editorial voice guide

> **ASSUMPTION — Assumed voice for the assignment — no real writing samples of Shreya were provided.**

## Who we sound like
A sharp friend who works in Indian venture and reads everything so you don't have to. Conversational and easy to read: short words, plain English, no jargon you'd be embarrassed to say out loud.

## What each commentary does
- **Insight over description.** The headline already says what happened. Say *why it matters*: what it changes, who it hurts, what it signals.
- **Short and sharp.** Two or three sentences. One idea per story. If there is nothing to add, say less.
- **Analytical about India.** Read every story through the Indian ecosystem: capital cycles (is money loosening or tightening, and for whom?), regulation (SEBI, RBI, MeitY, DPIIT as actors with incentives), unit economics (does this make money per order, per user, per loan?), Tier-2 and Tier-3 demand, and how the Indian version differs from the global playbook.
- **Opinionated but balanced.** Take a position and own it ("my read is…", "I'd bet…"), then acknowledge the strongest counter-argument in a clause, not a paragraph.
- **Connect the dots.** The best line links two stories or trends that others treat separately.

## Examples (fictional companies)
- *Kiranaflow's Series B is less about kirana credit and more about data: whoever sees the daily cash flow of a corner shop gets to underwrite it. My read is the lenders should be more worried than the distributors, though thin margins could still make this a very expensive dataset.*
- *Voltwheel cutting its scooter price by a fifth looks like a demand play, but it is really a subsidy hedge. If the incentive taper arrives on schedule, the brands that already sell without it win; the risk is that buyers simply wait for the next cut.*
- *Another quick-commerce startup promising ten-minute pharmacy delivery. The regulation is the moat here, not the logistics, and I'm not convinced the licence math works outside the top eight cities.*

## Never do
- Hype words: "game-changer", "revolutionary", "disrupt", "unicorn-in-the-making", "massive".
- Numbers, quotes or valuations that are not in the source.
- A sneering or gleeful tone about layoffs, shutdowns or founders.
- Emojis, exclamation marks, or rhetorical questions as filler.
`;

/** Fictional past issues (issue numbers 1–4). Companies and events are invented for the assignment. */
export const PAST_ISSUES: { topic: string; title: string; source: string }[][] = [
  [
    { topic: "Funding & Deals", title: "Kiranaflow raises Series B to take kirana credit to Tier-3 towns", source: "Sample Wire" },
    { topic: "Fintech", title: "Paisaleaf pauses buy-now-pay-later product after RBI digital lending review", source: "Sample Wire" },
    { topic: "AI & Deeptech", title: "Bengaluru's Tarangini AI open-sources a Hindi speech model for call centres", source: "Sample Daily" },
    { topic: "Consumer & Commerce", title: "Doodhwala Direct expands ten-minute dairy delivery to Jaipur and Indore", source: "Sample Daily" },
    { topic: "Policy & Regulation", title: "Sample ministry floats draft rules for AI labelling on social platforms", source: "Sample Policy Review" },
    { topic: "Talent & Layoffs", title: "Edtech firm Shikshaverse trims sales team as offline centres take priority", source: "Sample Wire" },
    { topic: "Climate & Mobility", title: "Voltwheel cuts electric scooter prices ahead of subsidy taper", source: "Sample Auto" },
    { topic: "Markets & IPOs", title: "Logistics startup Raahi Freight files draft papers for a mainboard IPO", source: "Sample Markets" },
    { topic: "Funding & Deals", title: "Agritech platform Khetsetu acquires a cold-chain startup in Nashik", source: "Sample Wire" },
  ],
  [
    { topic: "Fintech", title: "Neobank Udaan Money gets in-principle nod for a payment aggregator licence", source: "Sample Wire" },
    { topic: "AI & Deeptech", title: "Chip design startup Silicore Labs tapes out its first edge-AI processor", source: "Sample Tech" },
    { topic: "Consumer & Commerce", title: "D2C skincare brand Neemleaf turns profitable after cutting marketplace spend", source: "Sample Daily" },
    { topic: "Policy & Regulation", title: "Sample market-regulator consultation proposes tighter rules on finfluencer tie-ups", source: "Sample Policy Review" },
    { topic: "Funding & Deals", title: "Healthtech startup Aarogya Loop raises seed round for rural diagnostics", source: "Sample Wire" },
    { topic: "Talent & Layoffs", title: "Gig platform Kaamsetu introduces ESOPs for its delivery partners", source: "Sample Daily" },
    { topic: "Climate & Mobility", title: "Battery-swapping network ChargeChakra signs deal with three state transport bodies", source: "Sample Auto" },
    { topic: "Markets & IPOs", title: "Fintech lender Rinvest's shares slide on debut after a muted IPO", source: "Sample Markets" },
  ],
  [
    { topic: "AI & Deeptech", title: "Legal AI startup Nyayamitra signs up 40 district courts for case summaries", source: "Sample Tech" },
    { topic: "Funding & Deals", title: "Spacetech firm Gaganyatri Labs closes Series A led by a sample deeptech fund", source: "Sample Wire" },
    { topic: "Consumer & Commerce", title: "Quick-commerce player Turant launches pharmacy delivery in Hyderabad", source: "Sample Daily" },
    { topic: "Fintech", title: "UPI credit line pilot by Sample Bank sees strong uptake in small towns", source: "Sample Wire" },
    { topic: "Policy & Regulation", title: "Sample government notification widens the definition of a startup for tax benefits", source: "Sample Policy Review" },
    { topic: "Talent & Layoffs", title: "SaaS company Ledgerly moves 200 roles to its Coimbatore office", source: "Sample Daily" },
    { topic: "Climate & Mobility", title: "Rooftop solar startup Suryaghar crosses 50,000 home installations", source: "Sample Auto" },
    { topic: "Markets & IPOs", title: "Two consumer-tech startups pull IPO plans citing market volatility", source: "Sample Markets" },
    { topic: "Funding & Deals", title: "Creator-economy platform Kalakaar Studio raises bridge round from angels", source: "Sample Wire" },
    { topic: "AI & Deeptech", title: "Agritech drone maker Udaan Krishi wins approval for pesticide spraying trials", source: "Sample Tech" },
  ],
  [
    { topic: "Fintech", title: "Insurtech Surakshit launches pay-per-ride cover for gig workers", source: "Sample Wire" },
    { topic: "AI & Deeptech", title: "Indic language model from Bhashaverse tops a sample benchmark for Tamil", source: "Sample Tech" },
    { topic: "Consumer & Commerce", title: "Ethnic-wear D2C brand Rangrez opens 30 stores in Tier-2 cities", source: "Sample Daily" },
    { topic: "Funding & Deals", title: "B2B marketplace Thokbazaar raises growth round to expand into textiles", source: "Sample Wire" },
    { topic: "Policy & Regulation", title: "Sample central-bank circular tightens default loss guarantee rules for fintech lenders", source: "Sample Policy Review" },
    { topic: "Talent & Layoffs", title: "Mobility startup Safarnama lays off staff after exiting two cities", source: "Sample Daily" },
    { topic: "Climate & Mobility", title: "EV truck maker Bharvahan begins deliveries to a cement major", source: "Sample Auto" },
    { topic: "Markets & IPOs", title: "SME exchange sample listing of a drone startup is oversubscribed", source: "Sample Markets" },
  ],
];

export const SAMPLE_COMMENTARY =
  "Sample commentary for the assignment: this past-issue story is fictional and exists so the four-issue exclusion can be demonstrated. It is not real news.";

const FICTIONAL_SUBSCRIBERS: [string, string, "active" | "unsubscribed"][] = [
  ["Aarav Mehta", "aarav.mehta@example.com", "active"],
  ["Diya Raman", "diya.raman@example.com", "active"],
  ["Kabir Sethi", "kabir.sethi@example.com", "active"],
  ["Ananya Iyer", "ananya.iyer@example.com", "active"],
  ["Rohan Kulkarni", "rohan.kulkarni@example.com", "active"],
  ["Meera Nair", "meera.nair@example.com", "active"],
  ["Vihaan Gupta", "vihaan.gupta@example.com", "active"],
  ["Ishita Bose", "ishita.bose@example.com", "active"],
  ["Arjun Reddy", "arjun.reddy@example.com", "active"],
  ["Sara Khan", "sara.khan@example.com", "unsubscribed"],
  ["Nikhil Joshi", "nikhil.joshi@example.com", "unsubscribed"],
];

export async function seed(opts: { at?: Date; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const { sql, query } = await import("../lib/db");
  const { normalizeUrl, sha256 } = await import("../lib/normalize");
  const { weekKey, previousWeekKey, weekDate, istDate } = await import("../lib/time");
  const at = opts.at ?? new Date();
  const current = weekKey(at);

  // Voice guide v1
  await sql`INSERT INTO voice_guide (content, version, is_assumption) VALUES (${VOICE_GUIDE}, 1, true) ON CONFLICT (version) DO NOTHING`;

  // Past four sent issues: weeks current-4 … current-1 → issue numbers 1 … 4
  const existing = await sql`SELECT count(*)::int AS n FROM issues WHERE is_sample`;
  if (existing[0].n === 0) {
    const src = await sql`INSERT INTO sources (name, type, url_or_query, active) VALUES ('Sample archive', 'rss', 'https://example.com/sample-archive.xml', false)
                          ON CONFLICT (name) DO UPDATE SET active = false RETURNING id`;
    for (let i = 0; i < 4; i++) {
      const wk = previousWeekKey(current, 4 - i);
      const thu = weekDate(wk, 4);
      const sentAt = istDate(thu, 8, 5);
      const iss = await sql`INSERT INTO issues (issue_number, week_key, status, draft_sent_to_telegram_at, approved_at, approved_via, sent_at, created_at, is_sample)
        VALUES (${i + 1}, ${wk}, 'sent', ${istDate(weekDate(wk, 3), 15, 10).toISOString()}, ${istDate(weekDate(wk, 3), 19, 40).toISOString()}, 'telegram',
                ${sentAt.toISOString()}, ${istDate(weekDate(wk, 1), 7, 0).toISOString()}, true)
        ON CONFLICT (week_key) DO NOTHING RETURNING id`;
      if (!iss.length) continue;
      const stories = PAST_ISSUES[i];
      for (let p = 0; p < stories.length; p++) {
        const s = stories[p];
        const url = `https://example.com/sample/issue-${i + 1}/${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
        const art = await sql`INSERT INTO articles (source_id, source_name, title, url, canonical_url, url_hash, canonical_hash, summary, published_at, fetched_at, topic, topic_confidence, topic_method, issue_week, is_sample)
          VALUES (${src[0].id}, ${s.source}, ${s.title}, ${url}, ${normalizeUrl(url)}, ${sha256(url)}, ${sha256(normalizeUrl(url))},
                  ${"SAMPLE — fictional story for assignment data."}, ${istDate(weekDate(wk, 2), 9, 0).toISOString()}, ${istDate(weekDate(wk, 2), 9, 30).toISOString()},
                  ${s.topic}, 1, 'sample', ${wk}, true)
          ON CONFLICT (url_hash) DO UPDATE SET title = EXCLUDED.title RETURNING id`;
        await sql`INSERT INTO issue_stories (issue_id, article_id, position, commentary, original_commentary, state, gemini_rationale)
                  VALUES (${iss[0].id}, ${art[0].id}, ${p + 1}, ${SAMPLE_COMMENTARY}, ${SAMPLE_COMMENTARY}, 'selected', 'Sample data')
                  ON CONFLICT (issue_id, article_id) DO NOTHING`;
      }
      for (const [ev, h, d] of [["draft_sent", 15, 3], ["approved", 19, 3], ["sent", 8, 4]] as const) {
        await sql`INSERT INTO issue_events (issue_id, event, channel, detail, created_at)
                  VALUES (${iss[0].id}, ${ev}, ${ev === "sent" ? "cron" : "telegram"}, 'Sample history', ${istDate(weekDate(wk, d), h, 5).toISOString()})`;
      }
      log(`+ sample issue #${i + 1} (${wk}) with ${stories.length} stories`);
    }
  } else log("= sample issues already present");

  // Subscribers: owner + Resend test addresses (test recipients) + fictional sample records
  const owner = process.env.OWNER_EMAIL;
  const test: [string, string][] = [
    ...(owner ? [["Owner (Resend account)", owner] as [string, string]] : []),
    ["Resend test: delivered", "delivered@resend.dev"],
    ["Resend test: bounced", "bounced@resend.dev"],
    ["Resend test: complained", "complained@resend.dev"],
  ];
  for (const [name, email] of test) {
    await sql`INSERT INTO subscribers (email, name, is_test_recipient, is_sample) VALUES (${email}, ${name}, true, false) ON CONFLICT (email) DO NOTHING`;
  }
  for (const [name, email, status] of FICTIONAL_SUBSCRIBERS) {
    const r = await sql`INSERT INTO subscribers (email, name, status, is_sample, unsubscribed_at, status_reason)
      VALUES (${email}, ${name}, ${status}, true, ${status === "unsubscribed" ? istDate(weekDate(previousWeekKey(current, 2), 4), 10, 0).toISOString() : null},
              ${status === "unsubscribed" ? "Sample: clicked unsubscribe in a past issue" : null})
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    if (r.length) {
      await sql`INSERT INTO subscriber_events (subscriber_id, status, reason, created_at) VALUES (${r[0].id}, 'active', 'Sample: imported', ${istDate(weekDate(previousWeekKey(current, 6), 1), 9, 0).toISOString()})`;
      if (status === "unsubscribed") await sql`INSERT INTO subscriber_events (subscriber_id, status, reason) VALUES (${r[0].id}, 'unsubscribed', 'Sample: clicked unsubscribe in a past issue')`;
    }
  }
  const counts = await query(`SELECT status, count(*)::int AS n FROM subscribers GROUP BY status ORDER BY status`);
  log(`subscribers: ${counts.map((c) => `${c.n} ${c.status}`).join(", ")}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed.ts")) {
  seed().then(() => console.log("seed complete"), (e) => { console.error(e); process.exit(1); });
}
