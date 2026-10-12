import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const SOFT_BOUNCE_LIMIT = 3;
const RANK: Record<string, number> = { queued: 0, failed: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 };

/**
 * Resend → Svix-signed events. Bad signature → 401. Hard bounces and complaints
 * suppress the subscriber from every future send (safety invariant 3).
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const payload = await req.text();
  let event: any;
  try {
    if (!secret) throw new Error("no secret configured");
    // svix 2.x verify() only checks the signature (throws on mismatch); parse afterwards.
    new Webhook(secret).verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    });
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  const type: string = event.type;
  const emailId: string | undefined = event.data?.email_id;
  const to: string | undefined = Array.isArray(event.data?.to) ? event.data.to[0] : event.data?.to;
  const status = ({ "email.sent": "sent", "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained" } as Record<string, string>)[type];
  if (!status) return NextResponse.json({ ok: true, ignored: type });

  const delivery = emailId
    ? (await sql`SELECT d.id, d.status, d.subscriber_id FROM deliveries d WHERE d.resend_email_id = ${emailId}`)[0]
    : undefined;
  if (delivery && RANK[status] >= (RANK[delivery.status] ?? 0)) {
    await sql`UPDATE deliveries SET status = ${status}, last_event_at = now() WHERE id = ${delivery.id}`;
  }

  const bounceType: string | undefined = event.data?.bounce?.type;
  const hardBounce = status === "bounced" && (!bounceType || /permanent|hard/i.test(bounceType));
  const subId: number | undefined = delivery?.subscriber_id
    ?? (to ? (await sql`SELECT id FROM subscribers WHERE lower(email) = lower(${to})`)[0]?.id : undefined);

  // Graceful handling: a temporary (soft) bounce is only counted; three in a row suppress the address.
  if (status === "bounced" && !hardBounce && subId) {
    const r = (await sql`UPDATE subscribers SET soft_bounces = soft_bounces + 1 WHERE id = ${subId} RETURNING soft_bounces, status`)[0];
    if (r && r.soft_bounces >= SOFT_BOUNCE_LIMIT && r.status === "active") {
      const reason = `${r.soft_bounces} temporary bounces in a row (Resend webhook${bounceType ? `: ${bounceType}` : ""})`;
      await sql`UPDATE subscribers SET status = 'bounced', status_reason = ${reason} WHERE id = ${subId}`;
      await sql`INSERT INTO subscriber_events (subscriber_id, status, reason) VALUES (${subId}, 'bounced', ${reason})`;
    }
    return NextResponse.json({ ok: true, type, matched: !!delivery, softBounces: r?.soft_bounces });
  }
  if (status === "delivered" && subId) await sql`UPDATE subscribers SET soft_bounces = 0 WHERE id = ${subId} AND soft_bounces > 0`;
  if (hardBounce || status === "complained") {
    const newStatus = status === "complained" ? "complained" : "bounced";
    const reason = status === "complained"
      ? "Marked the email as spam (Resend complaint webhook)"
      : `Hard bounce (Resend webhook${bounceType ? `: ${bounceType}` : ""}${event.data?.bounce?.message ? ` — ${String(event.data.bounce.message).slice(0, 120)}` : ""})`;
    const sub = subId ? { id: subId } : undefined;
    if (sub) {
      const changed = await sql`UPDATE subscribers SET status = ${newStatus}, status_reason = ${reason}
                                WHERE id = ${sub.id} AND status NOT IN ('complained', ${newStatus}) RETURNING id`;
      if (changed.length) await sql`INSERT INTO subscriber_events (subscriber_id, status, reason) VALUES (${sub.id}, ${newStatus}, ${reason})`;
    }
  }
  return NextResponse.json({ ok: true, type, matched: !!delivery });
}
