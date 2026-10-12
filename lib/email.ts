import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { query, sql } from "./db";
import { getStories, logEvent, type Channel, type Issue, type Story } from "./issues";
import { formatIstDate } from "./time";

export const SENDER = "The Dispatch <onboarding@resend.dev>";
export type EmailMode = "dry_run" | "test" | "live";

/** Live only when BOTH EMAIL_MODE=live and LIVE_SEND_CONFIRMED=true, and never for simulated-time runs. */
export function effectiveMode(opts: { simulated?: boolean; forceMode?: EmailMode } = {}): { mode: EmailMode; note?: string } {
  const configured = (opts.forceMode ?? process.env.EMAIL_MODE ?? "test") as EmailMode;
  if (configured === "dry_run") return { mode: "dry_run" };
  if (configured === "live") {
    if (process.env.LIVE_SEND_CONFIRMED !== "true") return { mode: "test", note: "EMAIL_MODE=live without LIVE_SEND_CONFIRMED=true → test mode" };
    if (opts.simulated) return { mode: "test", note: "simulated time can never trigger a live send → test mode" };
    return { mode: "live" };
  }
  return { mode: "test" };
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens: base64url(subscriberId).base64url(HMAC-SHA256)
// ---------------------------------------------------------------------------
function signingKey() {
  const k = process.env.UNSUBSCRIBE_SIGNING_SECRET;
  if (!k) throw new Error("UNSUBSCRIBE_SIGNING_SECRET is not set");
  return k;
}

export function unsubscribeToken(subscriberId: number): string {
  const id = Buffer.from(String(subscriberId)).toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(`unsub:${subscriberId}`).digest("base64url");
  return `${id}.${sig}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): number | null {
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [idPart, sig] = token.split(".");
  const id = Number(Buffer.from(idPart, "base64url").toString());
  if (!Number.isInteger(id) || id <= 0) return null;
  const expected = createHmac("sha256", signingKey()).update(`unsub:${id}`).digest();
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export async function unsubscribe(subscriberId: number, reason: string) {
  const rows = await sql`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now(), status_reason = ${reason}
                         WHERE id = ${subscriberId} AND status = 'active' RETURNING id`;
  if (rows.length) await sql`INSERT INTO subscriber_events (subscriber_id, status, reason) VALUES (${subscriberId}, 'unsubscribed', ${reason})`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const baseUrl = () => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

export function renderEmail(issue: Pick<Issue, "issue_number" | "week_key">, stories: Story[], opts: { unsubscribeUrl: string; date: Date }) {
  const date = formatIstDate(opts.date);
  const subject = `The Dispatch #${issue.issue_number} — ${stories[0]?.title ?? "This week in Indian startups"}`.slice(0, 140);
  const storyHtml = stories.map((s, i) => `
      <tr><td style="padding:22px 0;border-top:${i ? "1px solid #e7e5e4" : "0"};">
        <div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#b45309;">${esc(s.topic ?? "Other")}</div>
        <a href="${esc(s.url)}" style="display:block;margin:6px 0 4px;font:700 19px/1.35 Georgia,'Times New Roman',serif;color:#1c1917;text-decoration:none;">${i + 1}. ${esc(s.title)}</a>
        <div style="font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#78716c;">${esc(s.source_name)}</div>
        <p style="margin:10px 0 0;font:16px/1.6 Georgia,'Times New Roman',serif;color:#292524;">${esc(s.commentary ?? "")}</p>
      </td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(stories.slice(0, 3).map((s) => s.title).join(" · "))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;">
      <tr><td style="padding:28px 28px 8px;">
        <div style="font:700 30px/1.1 Georgia,'Times New Roman',serif;color:#1c1917;">The Dispatch</div>
        <div style="margin-top:6px;font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#78716c;">Issue #${issue.issue_number} · ${esc(date)} · Indian startups &amp; tech, with commentary</div>
      </td></tr>
      <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${storyHtml}</table></td></tr>
      <tr><td style="padding:20px 28px 28px;border-top:1px solid #e7e5e4;font:12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#a8a29e;">
        You're receiving this because you subscribed to The Dispatch.
        <a href="${esc(opts.unsubscribeUrl)}" style="color:#78716c;">Unsubscribe</a>.<br>
        Assignment prototype — commentary is AI-drafted with Gemini and approved by the editor before sending.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = [
    `THE DISPATCH — Issue #${issue.issue_number} · ${date}`,
    `Indian startups & tech, with commentary`,
    "",
    ...stories.flatMap((s, i) => [`${i + 1}. ${s.title}`, `   ${s.topic ?? "Other"} · ${s.source_name}`, `   ${s.url}`, "", `   ${s.commentary ?? ""}`, ""]),
    "—",
    `Unsubscribe: ${opts.unsubscribeUrl}`,
    "Assignment prototype — commentary is AI-drafted with Gemini and approved by the editor before sending.",
  ].join("\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Recipients and the send gate
// ---------------------------------------------------------------------------
/** Safety invariants 3 + 4: only active subscribers; only test recipients unless live. */
export async function recipients(mode: EmailMode) {
  return query(
    `SELECT id, email, name FROM subscribers WHERE status = 'active' AND ($1::boolean OR is_test_recipient) ORDER BY id`,
    [mode === "live"],
  ) as Promise<{ id: number; email: string; name: string | null }[]>;
}

export type SendResult = { claimed: boolean; reason: string; mode?: EmailMode; attempted: number; sent: number; failed: number; skippedAlreadySent: number; note?: string };

/**
 * THE approval gate (safety invariants 1, 2). Every send path — cron, dashboard,
 * Telegram "Send now" — goes through here. The atomic claim flips approved → sending;
 * if no row comes back, nothing is sent.
 */
export async function sendIssue(issueId: number, opts: { channel: Channel; simulated?: boolean; forceMode?: EmailMode } = { channel: "system" }): Promise<SendResult> {
  const claim = await sql`UPDATE issues SET status = 'sending' WHERE id = ${issueId} AND status = 'approved' AND sent_at IS NULL RETURNING *`;
  if (!claim.length) {
    const cur = (await sql`SELECT status, sent_at FROM issues WHERE id = ${issueId}`)[0];
    return { claimed: false, reason: cur ? `issue status is ${cur.status}${cur.sent_at ? " (already sent)" : ""}, not approved` : "issue not found", attempted: 0, sent: 0, failed: 0, skippedAlreadySent: 0 };
  }
  const issue = claim[0] as Issue;
  const { mode, note } = effectiveMode({ simulated: opts.simulated, forceMode: opts.forceMode });
  try {
    const stories = await getStories(issueId);
    const list = await recipients(mode);
    // Delivery rows first (UNIQUE issue_id+subscriber_id): a re-run never creates a second row.
    if (list.length) {
      await query(
        `INSERT INTO deliveries (issue_id, subscriber_id, status, mode) SELECT $1, unnest($2::int[]), 'queued', $3
         ON CONFLICT (issue_id, subscriber_id) DO NOTHING`,
        [issueId, list.map((r) => r.id), mode],
      );
    }
    // Only rows not yet sent, and only subscribers still active right now.
    const pending = (await query(
      `SELECT d.id AS delivery_id, s.id, s.email FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id
       WHERE d.issue_id = $1 AND d.status IN ('queued', 'failed') AND s.status = 'active' AND ($2::boolean OR s.is_test_recipient)`,
      [issueId, mode === "live"],
    )) as { delivery_id: number; id: number; email: string }[];
    const alreadySent = list.length - pending.length;
    let sent = 0, failed = 0;

    if (mode === "dry_run") {
      await query(`UPDATE deliveries SET status = 'dry_run', last_event_at = now() WHERE id = ANY($1)`, [pending.map((p) => p.delivery_id)]);
      sent = pending.length;
    } else if (pending.length) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      for (let i = 0; i < pending.length; i += 100) {
        const chunk = pending.slice(i, i + 100);
        const payload = chunk.map((r) => {
          const token = unsubscribeToken(r.id);
          const pageUrl = `${baseUrl()}/unsubscribe?token=${token}`;
          const { subject, html, text } = renderEmail(issue, stories, { unsubscribeUrl: pageUrl, date: new Date() });
          return {
            from: SENDER, to: [r.email], subject, html, text,
            headers: {
              "List-Unsubscribe": `<${baseUrl()}/api/unsubscribe?token=${token}>, <mailto:${process.env.OWNER_EMAIL}?subject=unsubscribe%20${r.id}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            tags: [{ name: "issue", value: String(issue.issue_number) }],
          };
        });
        // Idempotency key per issue + exact recipient set, so a retried batch is never delivered twice.
        const key = `dispatch-issue-${issueId}-${chunk.map((c) => c.id).join("-")}`.slice(0, 256);
        const { data, error } = await resend.batch.send(payload as any, { idempotencyKey: key });
        if (error || !data) {
          failed += chunk.length;
          await query(`UPDATE deliveries SET status = 'failed', error = $2, last_event_at = now() WHERE id = ANY($1)`, [chunk.map((c) => c.delivery_id), String(error?.message ?? "no data").slice(0, 300)]);
          continue;
        }
        const ids = (data as any).data as { id: string }[];
        await query(
          `UPDATE deliveries d SET status = 'sent', resend_email_id = x.rid, error = NULL, last_event_at = now()
           FROM unnest($1::int[], $2::text[]) AS x(did, rid) WHERE d.id = x.did`,
          [chunk.map((c) => c.delivery_id), ids.map((x) => x.id)],
        );
        sent += chunk.length;
      }
    }

    if (failed && !sent) {
      // Nothing went out: release the claim so a retry can send. Already-sent rows stay skipped.
      await sql`UPDATE issues SET status = 'approved' WHERE id = ${issueId} AND status = 'sending'`;
      await logEvent(issueId, "send_failed", opts.channel, `${failed} failed (${mode})`);
      return { claimed: true, reason: "all sends failed; claim released for retry", mode, attempted: pending.length, sent, failed, skippedAlreadySent: alreadySent, note };
    }
    await sql`UPDATE issues SET status = 'sent', sent_at = now() WHERE id = ${issueId}`;
    await logEvent(issueId, "sent", opts.channel, `${mode} mode: ${sent} sent${failed ? `, ${failed} failed` : ""}${note ? ` (${note})` : ""}`);
    return { claimed: true, reason: "sent", mode, attempted: pending.length, sent, failed, skippedAlreadySent: alreadySent, note };
  } catch (e) {
    await sql`UPDATE issues SET status = 'approved' WHERE id = ${issueId} AND status = 'sending'`;
    throw e;
  }
}

/** Render-only dry run to the dashboard / logs; never touches deliveries or the issue status. */
export async function previewEmail(issueId: number) {
  const issue = (await sql`SELECT * FROM issues WHERE id = ${issueId}`)[0] as Issue;
  const stories = await getStories(issueId);
  return renderEmail(issue, stories, { unsubscribeUrl: `${baseUrl()}/unsubscribe?token=preview`, date: new Date() });
}
