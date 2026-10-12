import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "../lib/db";
import { recipients, sendIssue, effectiveMode } from "../lib/email";
import { approveIssue, editCommentary, getStories, rejectStory, swapStory } from "../lib/issues";
import { runDraft, runIngest, runReminder, runSend } from "../lib/jobs";
import { istDate, istParts, scheduleGate, weekKey, type Job } from "../lib/time";
import { calls } from "./calls";
import { day, deliveriesCount, FRI_1000, WEEK, issueStatus, makeDraft, MON_0900, resetDb, THU_0800, THU_1200, WED_1500, WED_2159, WED_2201 } from "./helpers";

describe("Asia/Kolkata schedule (F1)", () => {
  it("maps the Vercel cron UTC times to the intended IST times", () => {
    // 30 1 * * 1-3 → 07:00 IST; 30 9 * * 3 → 15:00 IST; 0 17 * * 3 → 22:30 IST; 30 2 * * 4 → 08:00 IST
    const at = (iso: string) => istParts(new Date(iso));
    expect(at("2026-10-12T01:30:00Z")).toMatchObject({ weekday: 1, hour: 7, minute: 0 });
    expect(at("2026-10-14T09:30:00Z")).toMatchObject({ weekday: 3, hour: 15, minute: 0 });
    expect(at("2026-10-14T17:00:00Z")).toMatchObject({ weekday: 3, hour: 22, minute: 30 });
    expect(at("2026-10-15T02:30:00Z")).toMatchObject({ weekday: 4, hour: 8, minute: 0 });
    expect(weekKey(new Date("2026-10-12T01:30:00Z"))).toBe("2026-W42");
  });

  it("decides act/skip for each job at the simulated times", () => {
    const table: [Date, Record<Job, boolean>][] = [
      [MON_0900, { ingest: true, draft: false, reminder: false, send: false }],
      [WED_1500, { ingest: true, draft: true, reminder: false, send: false }],
      [WED_2159, { ingest: true, draft: true, reminder: false, send: false }],
      [WED_2201, { ingest: true, draft: true, reminder: true, send: false }],
      [THU_0800, { ingest: false, draft: false, reminder: false, send: true }],
      [istDate(day(4), 7, 59), { ingest: false, draft: false, reminder: true, send: false }],
      [FRI_1000, { ingest: false, draft: false, reminder: false, send: false }],
    ];
    for (const [at, expected] of table) {
      for (const job of Object.keys(expected) as Job[]) expect([job, at.toISOString(), scheduleGate(job, at).act]).toEqual([job, at.toISOString(), expected[job]]);
    }
  });
});

describe("jobs respect simulated time (F3)", () => {
  beforeEach(resetDb);

  it("ingest and draft skip outside their windows and log the run", async () => {
    const i = await runIngest({ trigger: "test", at: THU_0800, simulated: true });
    expect(i.status).toBe("skipped");
    const dr = await runDraft({ trigger: "test", at: MON_0900, simulated: true });
    expect(dr.status).toBe("skipped");
    const runs = await sql`SELECT job, status, simulated_now FROM workflow_runs ORDER BY id`;
    expect(runs.map((r) => [r.job, r.status, !!r.simulated_now])).toEqual([["ingest", "skipped", true], ["draft", "skipped", true]]);
  });

  it("Wed 15:00 draft with too few candidates → insufficient_stories + Telegram 'Draft anyway'", async () => {
    const r = await runDraft({ trigger: "test", at: WED_1500, simulated: true });
    expect(r.status).toBe("success");
    expect(r.summary).toMatch(/Insufficient stories/);
    const issue = (await sql`SELECT status FROM issues WHERE week_key = ${WEEK}`)[0];
    expect(issue.status).toBe("insufficient_stories");
    const msg = calls.telegram.find((c) => c.method === "sendMessage");
    expect(JSON.stringify(msg?.body.reply_markup)).toMatch(/Draft anyway/);
  });
});

describe("Wednesday 10 PM reminder (F2)", () => {
  beforeEach(resetDb);

  it("is not sent before 22:00, is sent once after 22:00 when pending, never twice", async () => {
    const issue = await makeDraft();
    expect((await runReminder({ trigger: "test", at: WED_2159, simulated: true })).status).toBe("skipped");
    expect(calls.telegram).toHaveLength(0);
    const first = await runReminder({ trigger: "test", at: WED_2201, simulated: true });
    expect(first.status).toBe("success");
    expect(calls.telegram.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect((await issueStatus(issue.id)).reminder_sent_at).not.toBeNull();
    const second = await runReminder({ trigger: "test", at: istDate(day(3), 23, 30), simulated: true });
    expect(second.status).toBe("skipped");
    expect(calls.telegram.filter((c) => c.method === "sendMessage")).toHaveLength(1);
  });

  it("is not sent when the issue is already approved", async () => {
    await makeDraft({ status: "approved" });
    const r = await runReminder({ trigger: "test", at: WED_2201, simulated: true });
    expect(r.status).toBe("skipped");
    expect(calls.telegram).toHaveLength(0);
  });
});

describe("approval gate (G1) and duplicate-send guard (G2)", () => {
  beforeEach(resetDb);

  for (const status of ["pending_approval", "rejected", "skipped", "insufficient_stories", "collecting"]) {
    it(`sends nothing for a ${status} issue: zero emails, zero delivery rows`, async () => {
      const issue = await makeDraft({ status });
      const r = await sendIssue(issue.id, { channel: "test" });
      expect(r.claimed).toBe(false);
      expect(calls.resend).toHaveLength(0);
      expect(await deliveriesCount(issue.id)).toBe(0);
      expect((await issueStatus(issue.id)).status).toBe(status);
    });
  }

  it("Thursday send run with a pending issue → skipped, nothing sent, Shreya notified", async () => {
    const issue = await makeDraft({ status: "pending_approval" });
    const r = await runSend({ trigger: "test", at: THU_0800, simulated: true });
    expect(r.summary).toMatch(/not approved/);
    expect((await issueStatus(issue.id)).status).toBe("skipped");
    expect(calls.resend).toHaveLength(0);
    expect(await deliveriesCount(issue.id)).toBe(0);
    expect(calls.telegram.some((c) => c.method === "sendMessage" && /not approved/.test(c.body.text))).toBe(true);
  });

  it("approved → sends once to test recipients only; re-running sends nothing extra", async () => {
    const issue = await makeDraft({ status: "approved" });
    const r1 = await runSend({ trigger: "test", at: THU_0800, simulated: true });
    expect(r1.status).toBe("success");
    const batch = calls.resend.filter((c) => c.path === "/emails/batch");
    expect(batch).toHaveLength(1);
    const to = batch[0].body.map((e: any) => e.to[0]).sort();
    expect(to).toEqual(["bounced@resend.dev", "complained@resend.dev", "delivered@resend.dev", process.env.OWNER_EMAIL].sort());
    expect(batch[0].headers["idempotency-key"]).toMatch(/^dispatch-issue-/);
    expect(await deliveriesCount(issue.id)).toBe(4);
    expect((await issueStatus(issue.id)).status).toBe("sent");

    const r2 = await runSend({ trigger: "test", at: istDate(day(4), 8, 45), simulated: true });
    expect(r2.status).toBe("skipped");
    const r3 = await sendIssue(issue.id, { channel: "test" });
    expect(r3.claimed).toBe(false);
    expect(calls.resend.filter((c) => c.path === "/emails/batch")).toHaveLength(1);
    expect(await deliveriesCount(issue.id)).toBe(4);
  });

  it("two concurrent sends: only one claims the issue", async () => {
    const issue = await makeDraft({ status: "approved" });
    const [a, b] = await Promise.all([sendIssue(issue.id, { channel: "test" }), sendIssue(issue.id, { channel: "test" })]);
    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
    expect(calls.resend.filter((c) => c.path === "/emails/batch")).toHaveLength(1);
  });

  it("dry_run mode records dry_run deliveries without calling Resend", async () => {
    const issue = await makeDraft({ status: "approved" });
    const r = await sendIssue(issue.id, { channel: "test", forceMode: "dry_run" });
    expect(r.mode).toBe("dry_run");
    expect(calls.resend).toHaveLength(0);
    expect((await sql`SELECT DISTINCT status FROM deliveries WHERE issue_id = ${issue.id}`).map((x) => x.status)).toEqual(["dry_run"]);
  });

  it("simulated time can never trigger a live send", () => {
    process.env.LIVE_SEND_CONFIRMED = "true";
    expect(effectiveMode({ forceMode: "live", simulated: true }).mode).toBe("test");
    expect(effectiveMode({ forceMode: "live" }).mode).toBe("live");
    delete process.env.LIVE_SEND_CONFIRMED;
    expect(effectiveMode({ forceMode: "live" }).mode).toBe("test");
  });
});

describe("edits after approval revoke approval (invariant 5)", () => {
  beforeEach(resetDb);

  it("edit, swap and reject each revert approved → pending_approval", async () => {
    const issue = await makeDraft({ status: "pending_approval" });
    const stories = await getStories(issue.id);
    for (const [i, change] of [
      () => editCommentary(stories[0].id, "New first sentence. New second sentence.", "test"),
      () => swapStory(stories[1].id, "test"),
      () => rejectStory(stories[2].id, "test"),
    ].entries()) {
      expect((await approveIssue(issue.id, "dashboard", WED_2159)).ok).toBe(true);
      expect((await issueStatus(issue.id)).status).toBe("approved");
      const r = await change();
      expect([i, r.revoked]).toEqual([i, true]);
      const after = await issueStatus(issue.id);
      expect(after.status).toBe("pending_approval");
      expect(after.approved_at).toBeNull();
    }
    const events = (await sql`SELECT event FROM issue_events WHERE issue_id = ${issue.id} AND event = 'approval_revoked'`).length;
    expect(events).toBe(3);
  });

  it("approval after Thursday is refused; late approval on Thursday offers Send now", async () => {
    const issue = await makeDraft({ status: "skipped" });
    const late = await approveIssue(issue.id, "telegram", THU_1200);
    expect(late.ok).toBe(true);
    expect(late.offerSendNow).toBe(true);
    await sql`UPDATE issues SET status = 'skipped', approved_at = NULL WHERE id = ${issue.id}`;
    const tooLate = await approveIssue(issue.id, "telegram", FRI_1000);
    expect(tooLate.ok).toBe(false);
  });
});

describe("suppression (invariants 3, 4)", () => {
  beforeEach(resetDb);

  it("test mode only returns active test recipients; live mode never returns suppressed addresses", async () => {
    await sql`UPDATE subscribers SET status = 'bounced' WHERE email = 'bounced@resend.dev'`;
    await sql`UPDATE subscribers SET status = 'complained' WHERE email = 'complained@resend.dev'`;
    await sql`UPDATE subscribers SET status = 'bounced' WHERE email = 'kabir.sethi@example.com'`;
    const test = (await recipients("test")).map((r) => r.email);
    expect(test.sort()).toEqual(["delivered@resend.dev", process.env.OWNER_EMAIL].sort());
    const live = (await recipients("live")).map((r) => r.email);
    const suppressed = (await sql`SELECT email FROM subscribers WHERE status <> 'active'`).map((r) => r.email);
    expect(suppressed).toEqual(expect.arrayContaining(["sara.khan@example.com", "nikhil.joshi@example.com", "bounced@resend.dev", "complained@resend.dev", "kabir.sethi@example.com"]));
    for (const s of suppressed) expect(live).not.toContain(s);
    expect(live.some((e) => e.endsWith("@example.com"))).toBe(true);
  });

  it("an approved send in test mode never emails @example.com sample subscribers", async () => {
    const issue = await makeDraft({ status: "approved" });
    await sendIssue(issue.id, { channel: "test" });
    const to = calls.resend.flatMap((c) => (Array.isArray(c.body) ? c.body.map((e: any) => e.to[0]) : []));
    expect(to.some((e: string) => e.endsWith("@example.com"))).toBe(false);
  });
});
