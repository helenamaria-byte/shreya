import { NextResponse } from "next/server";
import { handleUpdate, updateChatId, validSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Safety invariant 6: only updates carrying the webhook secret AND coming from
 * TELEGRAM_CHAT_ID can change drafts or approve. Wrong secret → 401. Wrong chat →
 * 200 (so Telegram doesn't retry) but ignored, with no state change.
 */
export async function POST(req: Request) {
  if (!validSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false, error: "invalid secret" }, { status: 401 });
  }
  let update: any;
  try { update = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const chat = updateChatId(update);
  if (!chat || chat !== process.env.TELEGRAM_CHAT_ID) {
    return NextResponse.json({ ok: false, ignored: "unauthorized chat" });
  }
  try {
    const result = await handleUpdate(update);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error("telegram update failed", e?.message);
    return NextResponse.json({ ok: false, error: "handler failed" });
  }
}
