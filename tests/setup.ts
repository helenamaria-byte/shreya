import { afterEach, beforeEach, vi } from "vitest";
import { loadEnv } from "../scripts/load-env";
import { calls } from "./calls";

loadEnv();

// Tests run against a separate Neon branch, never the production database.
if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be set to a separate Neon branch");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.EMAIL_MODE = "test";
delete process.env.LIVE_SEND_CONFIRMED;
process.env.TELEGRAM_CHAT_ID = "424242";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-telegram-secret";
process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("test-resend-webhook-secret-32bytes!").toString("base64");
process.env.APP_BASE_URL = "https://dispatch.test";

/** Calls to Telegram and Resend are intercepted (and counted); everything else (Neon HTTP) passes through. */

const realFetch = globalThis.fetch;
beforeEach(() => {
  calls.telegram.length = 0;
  calls.resend.length = 0;
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.telegram.org")) {
      const method = url.split("/").pop()!;
      calls.telegram.push({ method, body: init?.body ? JSON.parse(init.body) : {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.telegram.length } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.resend.com")) {
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(init.body) : {};
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.resend.push({ path, body, headers });
      const data = Array.isArray(body) ? { data: body.map((_: unknown, i: number) => ({ id: `re_test_${calls.resend.length}_${i}` })) } : { id: `re_test_${calls.resend.length}` };
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());
