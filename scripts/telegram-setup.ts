import fs from "node:fs";
import { loadEnv } from "./load-env";
loadEnv();

/**
 * 1. Read the chat ID from getUpdates (works only before a webhook is set) and save it to .env.local.
 * 2. With --webhook: register the production webhook with the secret token.
 */
async function tg(method: string, body: object = {}) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return (await res.json()) as any;
}

async function main() {
  if (process.argv.includes("--webhook")) {
    const url = `${process.env.APP_BASE_URL}/api/telegram/webhook`;
    const r = await tg("setWebhook", { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    console.log("setWebhook:", r.ok, r.description);
    await tg("setMyCommands", { commands: [
      { command: "status", description: "This week's issue status" },
      { command: "draft", description: "Resend the current draft" },
      { command: "edit", description: "/edit <position> <text>" },
      { command: "help", description: "How to use the bot" },
    ] });
    const info = await tg("getWebhookInfo");
    console.log("webhook:", info.result.url, "pending:", info.result.pending_update_count, "last error:", info.result.last_error_message ?? "none");
    return;
  }
  const u = await tg("getUpdates");
  const chats = [...new Set((u.result || []).map((x: any) => (x.message ?? x.my_chat_member)?.chat?.id).filter(Boolean))];
  if (!chats.length) { console.log("No updates yet — send /start to the bot first."); process.exit(2); }
  const chatId = String(chats[chats.length - 1]);
  const env = fs.readFileSync(".env.local", "utf8").replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${chatId}`);
  fs.writeFileSync(".env.local", env);
  console.log(`Saved TELEGRAM_CHAT_ID (${chats.length} chat(s) seen; using the latest).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
