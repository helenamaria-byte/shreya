import { loadEnv } from "./load-env";
loadEnv();

/**
 * End-to-end checks against the deployed URL (default: APP_BASE_URL).
 * Usage: npm run e2e [-- https://your-app.vercel.app]
 * Never prints secret values.
 */
const BASE = (process.argv[2] || process.env.APP_BASE_URL || "").replace(/\/$/, "");
if (!BASE) throw new Error("Pass the base URL or set APP_BASE_URL");

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    console.log(`PASS  ${name}${note ? ` — ${note}` : ""}`);
  } catch (e: any) {
    failures++;
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}
const expectStatus = async (res: Response, status: number) => {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}`);
};

async function main() {
  console.log(`E2E against ${BASE} at ${new Date().toISOString()}\n`);

  await check("health: DB reachable and env var names present (values never returned)", async () => {
    const res = await fetch(`${BASE}/api/health`);
    const j = (await res.json()) as any;
    if (!j.db?.ok) throw new Error("db not reachable");
    const missing = Object.entries(j.env).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);
    const text = JSON.stringify(j);
    for (const k of ["GEMINI_API_KEY", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "CRON_SECRET", "ADMIN_PASSWORD"]) {
      if (process.env[k] && text.includes(process.env[k]!)) throw new Error(`health leaks ${k}`);
    }
    return `db ok, ${Object.keys(j.env).length} env vars present, model ${j.geminiModel}, email mode ${j.emailMode}`;
  });

  for (const path of ["/", "/?p=draft", "/?p=articles", "/?p=voice", "/?p=subscribers", "/?p=logs", "/?p=how", "/unsubscribe",
    "/diagrams/components-map.svg", "/diagrams/workflow-flowchart.svg", "/topics/fintech.jpg"]) {
    await check(`GET ${path} → 200`, async () => expectStatus(await fetch(`${BASE}${path}`), 200));
  }

  await check("front page: banner, workflow, what-to-do-next, unsubscribes card, draft link and all page tabs", async () => {
    const html = (await (await fetch(`${BASE}/`)).text()).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    for (const s of ["Assignment prototype — sample data is labelled", "Weekly workflow", "What to do next", "Unsubscribes & bounces", "View this week's draft",
      "Newsletter draft", "Articles", "Editorial voice", "Subscribers", "Logs", "How it works", "Track delivery"]) {
      if (!html.includes(s)) throw new Error(`missing “${s}”`);
    }
  });
  await check("public subscriber page masks every email", async () => {
    const html = await (await fetch(`${BASE}/?p=subscribers`)).text();
    if (/[\w.+-]+@example\.com/.test(html) || html.includes(process.env.OWNER_EMAIL ?? "@@none@@")) throw new Error("unmasked subscriber email on a public page");
  });

  for (const job of ["ingest", "draft", "reminder", "send"]) {
    await check(`cron /api/cron/${job} without secret → 401`, async () => expectStatus(await fetch(`${BASE}/api/cron/${job}`), 401));
    await check(`cron /api/cron/${job} with wrong secret → 401`, async () => expectStatus(await fetch(`${BASE}/api/cron/${job}`, { headers: { Authorization: "Bearer wrong" } }), 401));
  }

  await check("telegram webhook without secret → 401", async () =>
    expectStatus(await fetch(`${BASE}/api/telegram/webhook`, { method: "POST", body: JSON.stringify({ update_id: 1 }), headers: { "content-type": "application/json" } }), 401));
  await check("resend webhook with bad signature → 401", async () =>
    expectStatus(await fetch(`${BASE}/api/resend/webhook`, { method: "POST", body: JSON.stringify({ type: "email.bounced", data: {} }), headers: { "svix-id": "msg_x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,bad" } }), 401));
  await check("unsubscribe with tampered token → 400", async () =>
    expectStatus(await fetch(`${BASE}/api/unsubscribe?token=MQ.tampered`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }), 400));
  await check("admin action without login → 401", async () => {
    const form = new FormData(); form.set("action", "run_send");
    await expectStatus(await fetch(`${BASE}/api/admin/action`, { method: "POST", body: form, headers: { accept: "application/json" } }), 401);
  });
  await check("admin login with wrong password is refused", async () => {
    const form = new FormData(); form.set("password", "definitely-wrong");
    const res = await fetch(`${BASE}/api/admin/login`, { method: "POST", body: form, redirect: "manual" });
    if (!(res.headers.get("location") || "").includes("login=failed") || res.headers.get("set-cookie")) throw new Error("wrong password accepted");
  });

  if (process.env.ADMIN_PASSWORD) {
    await check("admin login + dry-run email (no send) works", async () => {
      const form = new FormData(); form.set("password", process.env.ADMIN_PASSWORD!);
      const login = await fetch(`${BASE}/api/admin/login`, { method: "POST", body: form, redirect: "manual" });
      const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
      if (!cookie.startsWith("dispatch_admin=")) throw new Error("no admin cookie");
      const act = new FormData(); act.set("action", "dry_run_email");
      const res = await fetch(`${BASE}/api/admin/action`, { method: "POST", body: act, headers: { cookie, accept: "application/json" } });
      const j = (await res.json()) as any;
      if (!j.ok) throw new Error(j.message);
      return j.message;
    });
  }

  console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
}
main();
