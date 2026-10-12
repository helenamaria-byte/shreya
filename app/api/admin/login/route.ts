import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionValue, COOKIE_MAX_AGE, passwordMatches } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const url = new URL("/", req.url);
  if (!passwordMatches(String(form.get("password") ?? ""))) {
    url.searchParams.set("login", "failed");
    return NextResponse.redirect(url, 303);
  }
  url.searchParams.set("login", "ok");
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(ADMIN_COOKIE, adminSessionValue(), { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE });
  return res;
}
