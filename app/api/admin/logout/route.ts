import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
