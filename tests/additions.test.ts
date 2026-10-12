import { beforeEach, describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { sql } from "../lib/db";
import { recipients, sendIssue } from "../lib/email";
import { approveIssue, editCommentary, getStories, swapStory } from "../lib/issues";
import { runDraft, runReport } from "../lib/jobs";
import { importSubscribersCsv } from "../lib/subscribers";
import { handleUpdate, storyKeyboard } from "../lib/telegram";
import { istDate } from "../lib/time";
import { learnVoice } from "../lib/voice";
import { POST as resendWebhook } from "../app/api/resend/webhook/route";
import { calls } from "./calls";
import { addArticle, day, issueStatus, makeDraft, resetDb, THU_1200, WED_1500, WED_2159 } from "./helpers";

const callback = (data: string, messageId = 77) => ({ update_id: 1, callback_query: { id: "cb", data, message: { message_id: messageId, chat: { id: 424242 } }, from: { id: 424242 } } });

describe("approve stories individually (PDF: “approves or swaps stories individually”)", () => {
  beforeEach(resetDb);

  it("✅ Keep marks one story approved, updates its card, and counts progress", async () => {
    const issue = await makeDraft({ n: 8 });
    const [s1] = await getStories(issue.id);
    expect(JSON.stringify(storyKeyboard(s1))).toMatch(/✅ Keep.*Edit.*Swap.*Reject/);
    expect(await handleUpdate(callback(`k:${s1.id}`), WED_2159)).toBe("story kept");
    expect((await sql`SELECT approved_at FROM issue_stories WHERE id = ${s1.id}`)[0].approved_at).not.toBeNull();
    const edit = calls.telegram.find((c) => c.method === "editMessageReplyMarkup");
    expect(edit?.body.message_id).toBe(77);
    expect(JSON.stringify(edit?.body.reply_markup)).toMatch(/✅ Kept/);
    expect(calls.telegram.find((c) => c.method === "answerCallbackQuery")?.body.text).toMatch(/1 of 8 approved/);
    expect(await handleUpdate(callback(`k:${s1.id}`), WED_2159)).toBe("keep: already");
    // the issue itself is still pending: per-story approval never sends anything
    expect((await issueStatus(issue.id)).status).toBe("pending_approval");
  });

  it("approving the last story offers the final confirmation", async () => {
    const issue = await makeDraft({ n: 8 });
    for (const s of await getStories(issue.id)) await handleUpdate(callback(`k:${s.id}`), WED_2159);
    const last = calls.telegram.filter((c) => c.method === "sendMessage").pop();
    expect(last?.body.text).toMatch(/All 8 stories approved/);
    expect(JSON.stringify(last?.body.reply_markup)).toMatch(/Confirm final draft/);
  });

  it("Shreya's edit approves that story; a swapped-in story starts unapproved", async () => {
    const issue = await makeDraft({ n: 8 });
    const [s1, s2] = await getStories(issue.id);
    await editCommentary(s1.id, "Her own words. Two sentences.", "test");
    expect((await sql`SELECT approved_at FROM issue_stories WHERE id = ${s1.id}`)[0].approved_at).not.toBeNull();
    const r = await swapStory(s2.id, "test");
    expect(r.newStory.approved_at).toBeNull();
  });

  it("the final confirmation names unapproved stories and then approves them all", async () => {
    const issue = await makeDraft({ n: 8 });
    const stories = await getStories(issue.id);
    for (const s of stories.slice(0, 5)) await handleUpdate(callback(`k:${s.id}`), WED_2159);
    await handleUpdate(callback(`a:${issue.id}`), WED_2159);
    const ask = calls.telegram.filter((c) => c.method === "sendMessage").pop();
    expect(ask?.body.text).toMatch(/5 of 8 stories approved individually — confirming also approves stories 6, 7, 8/);
    const r = await approveIssue(issue.id, "telegram", WED_2159);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/stories 6, 7, 8 were approved by the final confirmation/);
    expect((await sql`SELECT count(*)::int AS n FROM issue_stories WHERE issue_id = ${issue.id} AND state = 'selected' AND approved_at IS NULL`)[0].n).toBe(0);
  });
});

describe("graceful bounces (PDF: “bounces must be handled gracefully”)", () => {
  beforeEach(resetDb);
  const signed = (payload: object) => {
    const body = JSON.stringify(payload);
    const id = "msg_" + Math.random().toString(36).slice(2);
    const ts = new Date();
    return new Request("https://dispatch.test/api/resend/webhook", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, ts, body) } });
  };

  it("a temporary bounce is counted, not suppressed; three in a row suppress; a delivery resets the count", async () => {
    const email = "delivered@resend.dev";
    const soft = { type: "email.bounced", data: { email_id: "none", to: [email], bounce: { type: "Transient", message: "mailbox full" } } };
    await resendWebhook(signed(soft));
    await resendWebhook(signed(soft));
    let sub = (await sql`SELECT status, soft_bounces FROM subscribers WHERE email = ${email}`)[0];
    expect(sub).toMatchObject({ status: "active", soft_bounces: 2 });
    await resendWebhook(signed({ type: "email.delivered", data: { email_id: "none", to: [email] } }));
    expect((await sql`SELECT soft_bounces FROM subscribers WHERE email = ${email}`)[0].soft_bounces).toBe(0);
    for (let i = 0; i < 3; i++) await resendWebhook(signed(soft));
    sub = (await sql`SELECT status, status_reason FROM subscribers WHERE email = ${email}`)[0];
    expect(sub.status).toBe("bounced");
    expect(sub.status_reason).toMatch(/3 temporary bounces in a row/);
    expect((await recipients("test")).map((r) => r.email)).not.toContain(email);
  });
});

describe("Thursday-evening delivery report", () => {
  beforeEach(resetDb);

  it("waits until Thu 18:00, reports once for a sent issue, never twice", async () => {
    const issue = await makeDraft({ status: "approved" });
    await sendIssue(issue.id, { channel: "test" });
    expect((await runReport({ trigger: "test", at: THU_1200, simulated: true })).status).toBe("skipped");
    calls.telegram.length = 0;
    const r = await runReport({ trigger: "test", at: istDate(day(4), 18, 5), simulated: true });
    expect(r.status).toBe("success");
    const msg = calls.telegram.find((c) => c.method === "sendMessage");
    expect(msg?.body.text).toMatch(/delivery report/);
    expect(msg?.body.text).toMatch(/4 awaiting confirmation/);
    const again = await runReport({ trigger: "test", at: istDate(day(4), 19, 0), simulated: true });
    expect(again.summary).toMatch(/already sent/);
  });

  it("does nothing for an issue that was not sent", async () => {
    await makeDraft({ status: "skipped" });
    const r = await runReport({ trigger: "test", at: istDate(day(4), 18, 5), simulated: true });
    expect(r.status).toBe("skipped");
    expect(calls.telegram).toHaveLength(0);
  });
});

describe("Learn my voice (documented editorial voice from her own writing)", () => {
  beforeEach(resetDb);
  const SAMPLES = "Zepto's new dark stores are not about speed, they are about owning the last mile of credit. ".repeat(8);

  it("asks Gemini to document the voice from the samples and stores a new learned version", async () => {
    calls.geminiResponder = () => ({ content: "# The Dispatch — editorial voice guide\n\n## Who we sound like\nLEARNED-VOICE-MARKER short, dry, contrarian." });
    const v = await learnVoice(SAMPLES);
    expect(v.version).toBe(2);
    expect(calls.gemini[0].prompt).toContain("Zepto's new dark stores");
    const row = (await sql`SELECT source, is_assumption, content FROM voice_guide WHERE version = 2`)[0];
    expect(row).toMatchObject({ source: "learned", is_assumption: false });
    expect(row.content).toMatch(/Learned by Gemini Flash from/);

    // …and the next draft uses it
    for (let i = 0; i < 14; i++) await addArticle(`Learn-voice candidate ${i}`, { topic: ["Fintech", "AI & Deeptech", "Markets & IPOs"][i % 3] });
    calls.gemini.length = 0;
    calls.geminiResponder = (p) => {
      const ids = [...p.matchAll(/^(\d+) \| /gm)].map((m) => Number(m[1]));
      return p.includes("Selection criteria")
        ? { selected: ids.slice(0, 9).map((id, i) => ({ article_id: id, position: i + 1, rationale: "r" })), reserves: ids.slice(9, 14).map((id, i) => ({ article_id: id, rank: i + 1, rationale: "r" })) }
        : { items: ids.map((id) => ({ article_id: id, commentary: "One sentence. Two sentences." })) };
    };
    await runDraft({ trigger: "test", at: WED_1500, simulated: true });
    expect(calls.gemini.every((c) => c.prompt.includes("LEARNED-VOICE-MARKER"))).toBe(true);
  });

  it("refuses samples that are too short", async () => {
    await expect(learnVoice("too short")).rejects.toThrow(/Paste at least/);
    expect(calls.gemini).toHaveLength(0);
  });
});

describe("subscriber CSV import (the real 2,200-person list)", () => {
  beforeEach(resetDb);

  it("adds valid new rows, skips duplicates/invalid, and never re-activates suppressed people", async () => {
    const csv = [
      "Name,Email,Joined",
      '"Rao, Priya",priya.rao@example.org,2024-01-02',
      "Dev,DEV@example.org,2024-02-01",
      "Dev again,dev@example.org,2024-02-01",
      "Broken,not-an-email,2024-03-01",
      "Sara,sara.khan@example.com,2023-05-05", // already in the list as unsubscribed
    ].join("\r\n");
    const r = await importSubscribersCsv(csv);
    expect(r).toMatchObject({ rows: 5, added: 2, alreadyListed: 1, invalid: 1 });
    const priya = (await sql`SELECT name, status, is_test_recipient FROM subscribers WHERE email = 'priya.rao@example.org'`)[0];
    expect(priya).toEqual({ name: "Rao, Priya", status: "active", is_test_recipient: false });
    expect((await sql`SELECT status FROM subscribers WHERE email = 'sara.khan@example.com'`)[0].status).toBe("unsubscribed");
    // imported people are real subscribers, but test mode still never emails them
    expect((await recipients("test")).map((x) => x.email)).not.toContain("priya.rao@example.org");
  });

  it("accepts a header-less one-column list", async () => {
    const r = await importSubscribersCsv("a@x.org\nb@x.org\n");
    expect(r.added).toBe(2);
  });
});
