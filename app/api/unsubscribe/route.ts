import { NextResponse } from "next/server";
import { unsubscribe, verifyUnsubscribeToken } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/unsubscribe?token=… — used by Gmail's one-click List-Unsubscribe-Post
 * (body "List-Unsubscribe=One-Click") and by the confirmation page's form.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = verifyUnsubscribeToken(url.searchParams.get("token"));
  if (!id) return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  const form = (req.headers.get("content-type") || "").includes("form") ? await req.formData().catch(() => null) : null;
  const viaPage = form?.get("source") === "page";
  await unsubscribe(id, viaPage ? "Unsubscribed via the email link" : "One-click unsubscribe (List-Unsubscribe-Post)");
  if (viaPage) return NextResponse.redirect(new URL(`/unsubscribe?done=1`, url), 303);
  return NextResponse.json({ ok: true });
}
