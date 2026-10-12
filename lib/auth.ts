import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "dispatch_admin";
const SESSION_HOURS = 12;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Safety invariant 7: cron routes need `Authorization: Bearer ${CRON_SECRET}`. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") || "";
  return !!secret && safeEqual(header, `Bearer ${secret}`);
}

export function passwordMatches(input: string | null | undefined): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  return !!pw && !!input && safeEqual(input, pw);
}

function sign(payload: string) {
  return createHmac("sha256", `${process.env.ADMIN_PASSWORD}:${process.env.CRON_SECRET}`).update(payload).digest("base64url");
}

/** Signed cookie value: "<expiry ms>.<hmac>". */
export function adminSessionValue(): string {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}

export function validAdminSession(value: string | undefined | null): boolean {
  if (!value || !process.env.ADMIN_PASSWORD) return false;
  const [exp, sig] = value.split(".");
  return !!exp && !!sig && Number(exp) > Date.now() && safeEqual(sig, sign(exp));
}

export function cookieValueFrom(req: Request): string | undefined {
  const raw = req.headers.get("cookie") || "";
  return raw.split(/;\s*/).find((c) => c.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
}

export function isAdminRequest(req: Request): boolean {
  return validAdminSession(cookieValueFrom(req));
}

export const COOKIE_MAX_AGE = SESSION_HOURS * 3600;
