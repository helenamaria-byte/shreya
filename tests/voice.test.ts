import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "../lib/db";
import { runDraft } from "../lib/jobs";
import { calls } from "./calls";
import { addArticle, resetDb, WED_1500, WEEK } from "./helpers";

const TOPICS = ["Funding & Deals", "AI & Deeptech", "Fintech", "Policy & Regulation", "Markets & IPOs"];

/** Fake Gemini: picks the first 9 candidate ids as selected and the next 5 as reserves; writes 2-sentence commentary. */
function responder(prompt: string) {
  const ids = [...prompt.matchAll(/^(\d+) \| /gm)].map((m) => Number(m[1]));
  if (prompt.includes("Selection criteria")) {
    return {
      selected: ids.slice(0, 9).map((id, i) => ({ article_id: id, position: i + 1, rationale: `Reason ${i + 1}` })),
      reserves: ids.slice(9, 14).map((id, i) => ({ article_id: id, rank: i + 1, rationale: `Backup ${i + 1}` })),
    };
  }
  return { items: ids.map((id) => ({ article_id: id, commentary: `This matters for founders. My read is the market will notice.` })) };
}

describe("voice guide from Neon drives the prompts (D5) and a full draft run (D1–D4)", () => {
  beforeEach(async () => {
    await resetDb();
    for (let i = 0; i < 16; i++) await addArticle(`Candidate story number ${i + 1} on ${TOPICS[i % 5]}`, { topic: TOPICS[i % 5] });
  });

  it("uses the latest voice guide version; editing the guide changes the next prompt", async () => {
    calls.geminiResponder = responder;
    const r1 = await runDraft({ trigger: "test", at: WED_1500, simulated: true });
    expect(r1.status).toBe("success");
    expect(calls.gemini).toHaveLength(2); // selection + commentary
    for (const c of calls.gemini) expect(c.prompt).toContain("Assumed voice for the assignment");

    await sql`INSERT INTO voice_guide (content, version) VALUES ('# Voice v2\nVOICE-V2-MARKER: write like a dry, numbers-first analyst.', 2)`;
    calls.gemini.length = 0;
    const r2 = await runDraft({ trigger: "test", at: WED_1500, simulated: true, force: true });
    expect(r2.status).toBe("success");
    expect(r2.details.voiceGuideVersion).toBe(2);
    for (const c of calls.gemini) {
      expect(c.prompt).toContain("VOICE-V2-MARKER");
      expect(c.prompt).not.toContain("Assumed voice for the assignment");
    }
  });

  it("stores 9 selected + 5 reserves with rationale and 2–3 sentence commentary, then sends the draft to Telegram", async () => {
    calls.geminiResponder = responder;
    const r = await runDraft({ trigger: "test", at: WED_1500, simulated: true });
    expect(r.summary).toMatch(/9 stories across 5 topics/);
    const issue = (await sql`SELECT * FROM issues WHERE week_key = ${WEEK}`)[0];
    expect(issue.status).toBe("pending_approval");
    expect(issue.draft_sent_to_telegram_at).not.toBeNull();
    const rows = await sql`SELECT state, gemini_rationale, commentary FROM issue_stories WHERE issue_id = ${issue.id}`;
    expect(rows.filter((x) => x.state === "selected")).toHaveLength(9);
    expect(rows.filter((x) => x.state === "reserve")).toHaveLength(5);
    expect(rows.every((x) => x.gemini_rationale)).toBe(true);
    // header + 9 story cards + footer
    const sent = calls.telegram.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(11);
    expect(JSON.stringify(sent[1].body.reply_markup)).toMatch(/Keep.*Edit.*Swap.*Reject/);
    expect(JSON.stringify(sent[10].body.reply_markup)).toMatch(/Confirm final draft.*Reject entire draft/);
    for (const m of sent) expect(m.body.text.length).toBeLessThanOrEqual(4096);
  });

  it("an invalid model selection is retried once with the errors, then repaired in code", async () => {
    let n = 0;
    calls.geminiResponder = (p) => {
      if (p.includes("Selection criteria")) {
        n++;
        return { selected: [{ article_id: 99999, position: 1, rationale: "x" }], reserves: [] }; // invalid both times
      }
      return responder(p);
    };
    const r = await runDraft({ trigger: "test", at: WED_1500, simulated: true });
    expect(n).toBe(2);
    expect(r.status).toBe("success");
    expect((r.details.validation as any[])[1].errors.join()).toMatch(/99999 is not in the candidate list/);
    expect((r.details.repairLog as string[]).join()).toMatch(/dropped invalid\/duplicate id 99999/);
    expect(r.summary).toMatch(/(8|9|10) stories across [3-5] topics/);
  });
});
