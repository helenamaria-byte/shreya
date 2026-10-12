import { beforeEach, describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { sql } from "../lib/db";
import { unsubscribeToken, verifyUnsubscribeToken } from "../lib/email";
import { approveIssue, getStories } from "../lib/issues";
import { handleUpdate } from "../lib/telegram";
import { GET as cronIngest } from "../app/api/cron/ingest/route";
import { GET as cronSend } from "../app/api/cron/send/route";
import { POST as resendWebhook } from "../app/api/resend/webhook/route";
import { POST as telegramWebhook } from "../app/api/telegram/webhook/route";
import { POST as unsubscribeRoute } from "../app/api/unsubscribe/route";
import { POST as adminAction } from "../app/api/admin/action/route";
import { calls } from "./calls";
import { issueStatus, makeDraft, resetDb, WED_2159 } from "./helpers";

const tgReq = (body: unknown, secret?: string) => new Request("https://dispatch.test/api/telegram/webhook", {
  method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(body),
});
const callback = (data: string, chat = 424242) => ({ update_id: 1, callback_query: { id: "cb1", data, message: { chat: { id: chat } }, from: { id: chat } } });
const text = (t: string, chat = 424242) => ({ update_id: 2, message: { message_id: 9, text: t, chat: { id: chat }, from: { id: chat } } });

describe("unsubscribe (G4)", () => {
  beforeEach(resetDb);

  it("valid token unsubscribes via one-click POST; tampered token is rejected", async () => {
    const sub = (await sql`SELECT id FROM subscribers WHERE email = 'delivered@resend.dev'`)[0];
    const token = unsubscribeToken(sub.id);
    expect(verifyUnsubscribeToken(token)).toBe(sub.id);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
    const otherId = Buffer.from(String(sub.id + 1)).toString("base64url") + "." + token.split(".")[1];
    expect(verifyUnsubscribeToken(otherId)).toBeNull();

    const bad = await unsubscribeRoute(new Request(`https://dispatch.test/api/unsubscribe?token=${tampered}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(bad.status).toBe(400);
    expect((await sql`SELECT status FROM subscribers WHERE id = ${sub.id}`)[0].status).toBe("active");

    const ok = await unsubscribeRoute(new Request(`https://dispatch.test/api/unsubscribe?token=${token}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(ok.status).toBe(200);
    const row = (await sql`SELECT status, unsubscribed_at FROM subscribers WHERE id = ${sub.id}`)[0];
    expect(row.status).toBe("unsubscribed");
    expect(row.unsubscribed_at).not.toBeNull();
  });

  it("every sent email carries List-Unsubscribe + one-click headers and an unsubscribe link", async () => {
    const issue = await makeDraft({ status: "approved" });
    const { sendIssue } = await import("../lib/email");
    await sendIssue(issue.id, { channel: "test" });
    const emails = calls.resend.flatMap((c) => c.body);
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) {
      expect(e.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/dispatch\.test\/api\/unsubscribe\?token=[\w-]+\.[\w-]+>, <mailto:/);
      expect(e.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(e.html).toMatch(/\/unsubscribe\?token=/);
      expect(e.text).toMatch(/Unsubscribe: https:\/\/dispatch\.test\/unsubscribe\?token=/);
      expect(e.from).toBe("The Dispatch <onboarding@resend.dev>");
    }
  });
});

describe("Resend webhook (G5)", () => {
  beforeEach(resetDb);
  const signed = (payload: object, secret = process.env.RESEND_WEBHOOK_SECRET!) => {
    const body = JSON.stringify(payload);
    const id = "msg_" + Math.random().toString(36).slice(2);
    const ts = new Date();
    const sig = new Webhook(secret).sign(id, ts, body);
    return new Request("https://dispatch.test/api/resend/webhook", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": sig } });
  };

  it("rejects a bad signature", async () => {
    const otherSecret = "whsec_" + Buffer.from("some-other-secret-value-32-bytes!!").toString("base64");
    const res = await resendWebhook(signed({ type: "email.bounced", data: { email_id: "x", to: ["bounced@resend.dev"] } }, otherSecret));
    expect(res.status).toBe(401);
    expect((await sql`SELECT status FROM subscribers WHERE email = 'bounced@resend.dev'`)[0].status).toBe("active");
  });

  it("hard bounce and complaint suppress the subscriber; delivery rows update", async () => {
    const issue = await makeDraft({ status: "approved" });
    const { sendIssue, recipients } = await import("../lib/email");
    await sendIssue(issue.id, { channel: "test" });
    const d = await sql`SELECT d.resend_email_id, s.email FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id WHERE d.issue_id = ${issue.id}`;
    const idOf = (email: string) => d.find((x) => x.email === email)!.resend_email_id;
    expect((await resendWebhook(signed({ type: "email.bounced", data: { email_id: idOf("bounced@resend.dev"), to: ["bounced@resend.dev"], bounce: { type: "Permanent", message: "mailbox does not exist" } } }))).status).toBe(200);
    expect((await resendWebhook(signed({ type: "email.complained", data: { email_id: idOf("complained@resend.dev"), to: ["complained@resend.dev"] } }))).status).toBe(200);
    expect((await resendWebhook(signed({ type: "email.delivered", data: { email_id: idOf("delivered@resend.dev"), to: ["delivered@resend.dev"] } }))).status).toBe(200);
    const subs = Object.fromEntries((await sql`SELECT email, status FROM subscribers WHERE is_test_recipient`).map((r) => [r.email, r.status]));
    expect(subs["bounced@resend.dev"]).toBe("bounced");
    expect(subs["complained@resend.dev"]).toBe("complained");
    expect(subs["delivered@resend.dev"]).toBe("active");
    const ds = Object.fromEntries((await sql`SELECT s.email, d.status FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id`).map((r) => [r.email, r.status]));
    expect(ds).toMatchObject({ "bounced@resend.dev": "bounced", "complained@resend.dev": "complained", "delivered@resend.dev": "delivered" });
    const next = (await recipients("test")).map((r) => r.email);
    expect(next).not.toContain("bounced@resend.dev");
    expect(next).not.toContain("complained@resend.dev");
  });
});

describe("Telegram webhook security (E5) and cron auth (invariant 7)", () => {
  beforeEach(resetDb);

  it("wrong secret → 401; wrong chat → ignored with no state change", async () => {
    const issue = await makeDraft();
    const noSecret = await telegramWebhook(tgReq(callback(`ay:${issue.id}`)));
    expect(noSecret.status).toBe(401);
    const wrongSecret = await telegramWebhook(tgReq(callback(`ay:${issue.id}`), "nope"));
    expect(wrongSecret.status).toBe(401);
    const wrongChat = await telegramWebhook(tgReq(callback(`ay:${issue.id}`, 999), "test-telegram-secret"));
    expect(await wrongChat.json()).toMatchObject({ ok: false, ignored: "unauthorized chat" });
    expect((await issueStatus(issue.id)).status).toBe("pending_approval");
    expect(calls.telegram).toHaveLength(0);
    const right = await telegramWebhook(tgReq(callback(`ay:${issue.id}`), "test-telegram-secret"));
    expect(await right.json()).toMatchObject({ ok: true, result: "approved" });
    expect((await issueStatus(issue.id)).status).toBe("approved");
  });

  it("cron routes reject requests without CRON_SECRET", async () => {
    for (const handler of [cronIngest, cronSend]) {
      expect((await handler(new Request("https://dispatch.test/api/cron/x"))).status).toBe(401);
      expect((await handler(new Request("https://dispatch.test/api/cron/x", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    }
    expect((await sql`SELECT count(*)::int AS n FROM workflow_runs`)[0].n).toBe(0);
  });

  it("dashboard write actions require the admin session", async () => {
    const issue = await makeDraft();
    const form = new FormData();
    form.set("action", "approve"); form.set("issue_id", String(issue.id)); form.set("confirm", "on");
    const res = await adminAction(new Request("https://dispatch.test/api/admin/action", { method: "POST", body: form, headers: { accept: "application/json" } }));
    expect(res.status).toBe(401);
    expect((await issueStatus(issue.id)).status).toBe("pending_approval");
  });
});

describe("Telegram review flow (E2, E3, E4)", () => {
  beforeEach(resetDb);

  it("Edit via ForceReply and /edit update the commentary in Neon", async () => {
    const issue = await makeDraft();
    const [s1, s2] = await getStories(issue.id);
    expect(await handleUpdate(callback(`e:${s1.id}`))).toBe("edit: awaiting reply");
    expect(calls.telegram.some((c) => c.body.reply_markup?.force_reply)).toBe(true);
    expect(await handleUpdate(text("Shreya's own take. It has two sentences."))).toBe("edited via reply");
    expect((await sql`SELECT commentary, edited_at FROM issue_stories WHERE id = ${s1.id}`)[0]).toMatchObject({ commentary: "Shreya's own take. It has two sentences." });
    expect(await handleUpdate(text("A stray message"))).toBe("ignored: no pending action");
    expect(await handleUpdate(text(`/edit 2 Edited by command. Second line.`), WED_2159)).toBe("edited via /edit");
    expect((await sql`SELECT commentary FROM issue_stories WHERE id = ${s2.id}`)[0].commentary).toBe("Edited by command. Second line.");
  });

  it("an expired edit prompt (30 min) is not applied", async () => {
    const issue = await makeDraft();
    const [s1] = await getStories(issue.id);
    await handleUpdate(callback(`e:${s1.id}`), WED_2159);
    const later = new Date(WED_2159.getTime() + 31 * 60000);
    expect(await handleUpdate(text("Too late. Two sentences."), later)).toBe("ignored: no pending action");
  });

  it("Swap uses the reserves and keeps the position; Reject removes and warns below 8 stories", async () => {
    const issue = await makeDraft({ n: 8, reserves: 2 });
    const stories = await getStories(issue.id);
    const reserves = await getStories(issue.id, ["reserve"]);
    expect(await handleUpdate(callback(`s:${stories[3].id}`))).toBe("swapped via reserve");
    const after = await getStories(issue.id);
    expect(after[3].position).toBe(4);
    expect(reserves.map((r) => r.id)).toContain(after[3].id);
    expect((await sql`SELECT state FROM issue_stories WHERE id = ${stories[3].id}`)[0].state).toBe("swapped_out");

    expect(await handleUpdate(callback(`r:${stories[0].id}`))).toBe("story rejected");
    expect((await sql`SELECT state FROM issue_stories WHERE id = ${stories[0].id}`)[0].state).toBe("rejected");
    const remaining = await getStories(issue.id);
    expect(remaining).toHaveLength(7);
    expect(remaining.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const warn = calls.telegram.find((c) => /only 7 stories/.test(c.body.text ?? ""));
    expect(warn).toBeTruthy();
    expect(JSON.stringify(warn!.body.reply_markup)).toMatch(/Swap one in/);
  });

  it("Approve asks for confirmation, then stores status, time and channel", async () => {
    const issue = await makeDraft();
    expect(await handleUpdate(callback(`a:${issue.id}`))).toBe("approve: confirm asked");
    expect((await issueStatus(issue.id)).status).toBe("pending_approval");
    const confirm = calls.telegram.find((c) => /Approve issue #5 with 9 stories for Thursday 8 AM\?/.test(c.body.text ?? ""));
    expect(confirm).toBeTruthy();
    expect(await handleUpdate(callback(`ay:${issue.id}`), WED_2159)).toBe("approved");
    const row = await issueStatus(issue.id);
    expect(row.status).toBe("approved");
    expect(row.approved_via).toBe("telegram");
    expect(new Date(row.approved_at).toISOString()).toBe(WED_2159.toISOString());
  });

  it("approving with fewer than 8 stories warns but is allowed", async () => {
    const issue = await makeDraft({ n: 6, topics: 2 });
    await handleUpdate(callback(`a:${issue.id}`));
    expect(calls.telegram.some((c) => /only 6 stories/.test(c.body.text ?? "") && /only 2 topic/.test(c.body.text ?? ""))).toBe(true);
    const r = await approveIssue(issue.id, "telegram", WED_2159);
    expect(r.ok).toBe(true);
  });
});
