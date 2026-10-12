import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { geminiModel } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const REQUIRED = [
  "DATABASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL", "GNEWS_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  "TELEGRAM_WEBHOOK_SECRET", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "OWNER_EMAIL", "CRON_SECRET",
  "UNSUBSCRIBE_SIGNING_SECRET", "APP_BASE_URL", "EMAIL_MODE", "TZ_NAME",
];

/** Names of env vars and whether each is present — never their values. */
export async function GET() {
  const env = Object.fromEntries(REQUIRED.map((k) => [k, !!process.env[k]]));
  let db: { ok: boolean; error?: string } = { ok: false };
  try {
    const r = await sql`SELECT 1 AS ok`;
    db = { ok: r[0]?.ok === 1 };
  } catch (e: any) {
    db = { ok: false, error: String(e?.message || e).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]").slice(0, 120) };
  }
  const allEnv = Object.values(env).every(Boolean);
  return NextResponse.json(
    { ok: db.ok && allEnv, db, env, emailMode: process.env.EMAIL_MODE ?? "test", geminiModel: geminiModel(), time: new Date().toISOString() },
    { status: db.ok ? 200 : 503 },
  );
}
