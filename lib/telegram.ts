import { timingSafeEqual } from "node:crypto";
import { sql } from "./db";
import { sendIssue } from "./email";
import {
  addReplacement, approveIssue, draftHealth, editCommentary, getIssue, getIssueByWeek, getStories, getStory, IssueError,
  logEvent, rejectIssue, rejectStory, swapStory, type Issue, type Story,
} from "./issues";
import { formatIst, now, weekKey } from "./time";

const MAX_LEN = 4096;

type Button = { text: string; callback_data: string };
type Keyboard = Button[][];

export async function tg(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: any; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
  return data.result;
}

const chatId = () => {
  const id = process.env.TELEGRAM_CHAT_ID;
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return id;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Truncate to Telegram's 4,096-char limit (HTML-safe: cut before escaping the tail). */
function fit(text: string) {
  return text.length <= MAX_LEN ? text : text.slice(0, MAX_LEN - 2) + "…";
}

export async function send(text: string, keyboard?: Keyboard, extra: Record<string, unknown> = {}) {
  for (const row of keyboard ?? []) for (const b of row) if (Buffer.byteLength(b.callback_data) > 64) throw new Error(`callback_data too long: ${b.callback_data}`);
  return tg("sendMessage", {
    chat_id: chatId(), text: fit(text), parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}), ...extra,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
export function headerText(issue: Issue, stories: Story[]) {
  const h = draftHealth(stories);
  const lines = [
    `<b>📰 The Dispatch — Issue #${issue.issue_number} draft</b>`,
    `Week ${issue.week_key} · ${h.count} stories · ${h.topics.length} topics`,
    `Topics: ${h.topics.join(", ") || "—"}`,
  ];
  if (h.needsReview) lines.push(`⚠️ ${h.needsReview} stor${h.needsReview === 1 ? "y needs" : "ies need"} review (numbers not found in the source)`);
  for (const w of h.warnings) lines.push(`⚠️ ${w}`);
  lines.push("", "Edit, swap or reject any story below, then approve at the bottom. Nothing is emailed until you approve.");
  return lines.join("\n");
}

export function storyText(s: Story) {
  return [
    `<b>${s.position ?? "–"}. <a href="${esc(s.url)}">${esc(s.title)}</a></b>`,
    `<i>${esc(s.source_name)} · ${esc(s.topic ?? "Other")}</i>`,
    "",
    esc(s.commentary ?? ""),
    s.needs_review ? `\n⚠️ Needs review: ${esc(s.review_notes ?? "")}` : "",
  ].join("\n").trim();
}

export const storyKeyboard = (s: Pick<Story, "id">): Keyboard => [[
  { text: "✏️ Edit", callback_data: `e:${s.id}` },
  { text: "🔄 Swap", callback_data: `s:${s.id}` },
  { text: "❌ Reject", callback_data: `r:${s.id}` },
]];

export const footerKeyboard = (issueId: number): Keyboard => [[
  { text: "✅ Approve draft", callback_data: `a:${issueId}` },
  { text: "🚫 Reject entire draft", callback_data: `x:${issueId}` },
]];

/** Header, one message per story, footer with Approve / Reject. */
export async function sendDraft(issueId: number) {
  const issue = (await getIssue(issueId))!;
  const stories = await getStories(issueId);
  await send(headerText(issue, stories));
  for (const s of stories) await send(storyText(s), storyKeyboard(s));
  await send(`<b>Ready?</b> Approve issue #${issue.issue_number} to send it on Thursday at 8 AM IST.`, footerKeyboard(issueId));
  await sql`UPDATE issues SET draft_sent_to_telegram_at = now() WHERE id = ${issueId}`;
  await logEvent(issueId, "draft_sent", "telegram", `${stories.length} story cards sent to Telegram`);
}

// ---------------------------------------------------------------------------
// Webhook security (safety invariant 6)
// ---------------------------------------------------------------------------
export function validSecret(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function updateChatId(update: any): string | null {
  const id = update?.message?.chat?.id ?? update?.edited_message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  return id === undefined || id === null ? null : String(id);
}

// ---------------------------------------------------------------------------
// Update handling
// ---------------------------------------------------------------------------
const HELP = [
  "<b>The Dispatch bot</b>",
  "/status — this week's issue status",
  "/draft — resend the current draft",
  "/edit &lt;position&gt; &lt;text&gt; — replace a story's commentary",
  "/help — this message",
  "",
  "Story buttons: ✏️ Edit · 🔄 Swap (uses reserves) · ❌ Reject. Approve at the bottom of the draft.",
].join("\n");

async function currentIssue(at: Date) {
  return getIssueByWeek(weekKey(at));
}

async function statusText(at: Date) {
  const issue = await currentIssue(at);
  if (!issue) return `No issue yet for ${weekKey(at)}. Collection runs Mon–Wed; the draft arrives Wednesday afternoon.`;
  const stories = await getStories(issue.id);
  const h = draftHealth(stories);
  return [
    `<b>Issue #${issue.issue_number}</b> (${issue.week_key}) — <b>${issue.status.replace(/_/g, " ")}</b>`,
    `${h.count} stories · ${h.topics.length} topics${h.needsReview ? ` · ${h.needsReview} need review` : ""}`,
    issue.draft_sent_to_telegram_at ? `Draft sent ${formatIst(issue.draft_sent_to_telegram_at)}` : "",
    issue.reminder_sent_at ? `Reminder sent ${formatIst(issue.reminder_sent_at)}` : "",
    issue.approved_at ? `Approved ${formatIst(issue.approved_at)} via ${issue.approved_via}` : "",
    issue.sent_at ? `Sent ${formatIst(issue.sent_at)}` : "",
  ].filter(Boolean).join("\n");
}

async function revokedNote(revoked: boolean) {
  if (revoked) await send("↩️ That change revoked your approval. The issue is back to <b>pending approval</b> — please approve again.");
}

async function answer(cbId: string, text?: string) {
  await tg("answerCallbackQuery", { callback_query_id: cbId, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {});
}

export async function handleUpdate(update: any, at: Date = now()): Promise<string> {
  try {
    if (update.callback_query) return await handleCallback(update.callback_query, at);
    const msg = update.message;
    if (!msg?.text) return "ignored: no text";
    const text: string = msg.text.trim();

    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.split(/\s+/);
      switch (cmd.split("@")[0]) {
        case "/start":
        case "/help":
          await send(HELP); return "help";
        case "/status":
          await send(await statusText(at)); return "status";
        case "/draft": {
          const issue = await currentIssue(at);
          if (!issue || !["pending_approval", "approved", "skipped"].includes(issue.status)) { await send("There's no draft to resend right now."); return "draft: none"; }
          await sendDraft(issue.id); return "draft resent";
        }
        case "/edit": {
          const pos = Number(rest[0]);
          const newText = rest.slice(1).join(" ");
          const issue = await currentIssue(at);
          const story = issue ? (await getStories(issue.id)).find((s) => s.position === pos) : undefined;
          if (!story || !newText) { await send("Usage: /edit &lt;position&gt; &lt;new commentary&gt;"); return "edit: usage"; }
          const r = await editCommentary(story.id, newText, "telegram");
          await send(`✏️ Updated story ${pos}:\n\n${storyText(r.story)}`, storyKeyboard(r.story));
          await revokedNote(r.revoked);
          return "edited via /edit";
        }
        default:
          await send(HELP); return "unknown command";
      }
    }

    // Plain text: completes a pending ✏️ Edit (ForceReply), if one is open and unexpired.
    const pending = (await sql`DELETE FROM telegram_pending_actions WHERE id = (
                                 SELECT id FROM telegram_pending_actions WHERE chat_id = ${String(msg.chat.id)} AND expires_at > ${at.toISOString()}
                                 ORDER BY created_at DESC LIMIT 1) RETURNING issue_story_id`)[0];
    if (!pending) { await send("I only take commands here. Tap ✏️ Edit on a story first, or use /help."); return "ignored: no pending action"; }
    const r = await editCommentary(pending.issue_story_id, text, "telegram");
    await send(`✏️ Updated story ${r.story.position}:\n\n${storyText(r.story)}`, storyKeyboard(r.story));
    await revokedNote(r.revoked);
    return "edited via reply";
  } catch (e) {
    if (e instanceof IssueError) { await send(`⚠️ ${esc(e.message)}`); return `refused: ${e.message}`; }
    throw e;
  }
}

async function handleCallback(cb: any, at: Date): Promise<string> {
  const [kind, idStr] = String(cb.data || "").split(":");
  const id = Number(idStr);
  const cbChat = String(cb.message?.chat?.id ?? "");
  try {
    switch (kind) {
      case "e": {
        const story = await getStory(id);
        if (!story || story.state !== "selected") { await answer(cb.id, "That story is no longer in the draft."); return "edit: gone"; }
        await sql`DELETE FROM telegram_pending_actions WHERE chat_id = ${cbChat}`;
        await sql`INSERT INTO telegram_pending_actions (chat_id, action, issue_story_id, created_at, expires_at)
                  VALUES (${cbChat}, 'edit_commentary', ${id}, ${at.toISOString()}, ${new Date(at.getTime() + 30 * 60000).toISOString()})`;
        await answer(cb.id);
        await send(`✏️ Send the new commentary for story ${story.position} (“${esc(story.title.slice(0, 80))}”). This expires in 30 minutes.`, undefined, {
          reply_markup: { force_reply: true, input_field_placeholder: "New 2–3 sentence commentary" },
        });
        return "edit: awaiting reply";
      }
      case "s": {
        await answer(cb.id, "Swapping…");
        const r = await swapStory(id, "telegram");
        await send(`🔄 Swapped story ${r.newStory.position} (${r.via === "reserve" ? "from reserves" : "new pick by Gemini"}):\n\n${storyText(r.newStory)}`, storyKeyboard(r.newStory));
        await revokedNote(r.revoked);
        return `swapped via ${r.via}`;
      }
      case "r": {
        const r = await rejectStory(id, "telegram");
        await answer(cb.id, "Story removed");
        const warn = r.health.warnings.length ? `\n⚠️ The draft now has ${r.health.warnings.join(" and ")}. Consider swapping a story back in.` : "";
        await send(`❌ Removed “${esc(r.story.title)}”. ${r.health.count} stories across ${r.health.topics.length} topics remain.${warn}`,
          r.health.warnings.length ? [[{ text: "🔄 Swap one in", callback_data: `u:${r.story.issue_id}` }]] : undefined);
        await revokedNote(r.revoked);
        return "story rejected";
      }
      case "u": {
        const r = await addReplacement(id, "telegram");
        await answer(cb.id);
        await send(`🔄 Added a replacement (${r.via === "reserve" ? "from reserves" : "new pick by Gemini"}):\n\n${storyText(r.newStory)}`, storyKeyboard(r.newStory));
        await revokedNote(r.revoked);
        return "replacement added";
      }
      case "a": {
        const issue = await getIssue(id);
        const stories = issue ? await getStories(id) : [];
        const h = draftHealth(stories);
        await answer(cb.id);
        await send(
          `Approve issue #${issue?.issue_number} with ${h.count} stories for Thursday 8 AM?${h.warnings.length ? `\n⚠️ Note: ${h.warnings.join("; ")}. You can still approve — it's your call.` : ""}`,
          [[{ text: "Yes, approve", callback_data: `ay:${id}` }, { text: "No", callback_data: `an:${id}` }]],
        );
        return "approve: confirm asked";
      }
      case "ay": {
        const r = await approveIssue(id, "telegram", at);
        await answer(cb.id, r.ok ? "Approved" : "Not approved");
        await send(`${r.ok ? "✅" : "⚠️"} ${esc(r.message)}`, r.offerSendNow ? [[{ text: "📨 Send now", callback_data: `n:${id}` }]] : undefined);
        return r.ok ? "approved" : `approve refused: ${r.message}`;
      }
      case "an":
        await answer(cb.id, "Not approved");
        await send("OK — not approved. The draft is still waiting for you.");
        return "approve: cancelled";
      case "x":
        await answer(cb.id);
        await send("Reject the entire draft? Nothing will be sent this week unless a new draft is created and approved.",
          [[{ text: "Yes, reject draft", callback_data: `xy:${id}` }, { text: "No", callback_data: `xn:${id}` }]]);
        return "reject: confirm asked";
      case "xy": {
        const ok = await rejectIssue(id, "telegram");
        await answer(cb.id);
        await send(ok ? "🚫 Draft rejected. Nothing will be sent this week. (An admin can re-run selection from the dashboard.)" : "That draft can't be rejected in its current state.");
        return ok ? "draft rejected" : "reject refused";
      }
      case "xn":
        await answer(cb.id, "Kept");
        return "reject: cancelled";
      case "d": {
        await answer(cb.id, "Drafting…");
        const { runDraft } = await import("./jobs");
        const r = await runDraft({ trigger: "manual", at, draftAnyway: true, channel: "telegram" });
        return `draft anyway: ${r.summary}`;
      }
      case "n": {
        await answer(cb.id);
        await send("Send this issue to subscribers now?", [[{ text: "Yes, send now", callback_data: `ny:${id}` }, { text: "No", callback_data: `nn:${id}` }]]);
        return "send now: confirm asked";
      }
      case "ny": {
        await answer(cb.id, "Sending…");
        const issue = await getIssue(id);
        const { sendWindow } = await import("./issues");
        if (!issue || at > sendWindow(issue.week_key).thursdayEnd) { await send("The send window for this issue has closed; it stays unsent."); return "send now: window closed"; }
        const r = await sendIssue(id, { channel: "telegram" });
        await send(r.claimed && r.sent ? `📨 Sent issue #${issue.issue_number}: ${r.sent} emails (${r.mode} mode).` : `Nothing sent: ${esc(r.reason)}.`);
        return `send now: ${r.reason}`;
      }
      case "nn":
        await answer(cb.id, "Not sent");
        return "send now: cancelled";
      default:
        await answer(cb.id);
        return "ignored: unknown callback";
    }
  } catch (e) {
    if (e instanceof IssueError) { await answer(cb.id, e.message); await send(`⚠️ ${esc(e.message)}`); return `refused: ${e.message}`; }
    throw e;
  }
}
