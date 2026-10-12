# The Dispatch — Newsletter Intelligence Engine

A weekly newsletter about the Indian startup and tech ecosystem, run almost hands-free. News is collected Monday to Wednesday. On Wednesday afternoon Gemini Flash picks 8–10 stories and drafts the commentary in Shreya's style guide. She reviews the draft in Telegram story by story (keep, edit, swap or reject) and then confirms the final draft. It is emailed through Resend on Thursday morning, and only if she confirmed it. Unsubscribes and bounces from Gmail and other providers are handled automatically.

> **Assignment prototype.** Sample data is labelled in the UI (`is_sample`), and the starting voice guide is an assumption that can be replaced with one learned from her writing ([docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)). Email runs in **test mode**: only the owner's inbox and Resend's test addresses can receive it.

- **Live dashboard:** https://the-dispatch-murex.vercel.app (read-only without the admin password)
- **Repository:** https://github.com/helenamaria-byte/shreya
- **Health:** https://the-dispatch-murex.vercel.app/api/health (env var *names* + DB check, never values)

## The brief, line by line

| The problem statement asks… | Where it is |
|---|---|
| Live external data at submission time | 15 Indian startup/tech RSS feeds, 4 Google News searches and 6 GNews API queries, collected Mon–Wed (`lib/ingest.ts`, `lib/sources.ts`) |
| All AI tasks use Gemini Flash, not the Claude API | `lib/gemini.ts` is the only AI client, model `gemini-3.8-flash`. Topic illustrations were made once with Gemini's Flash image model |
| Vercel URL + GitHub repo + Components Map | links above · [docs/components-map.svg](docs/components-map.svg) |
| Runs Mon–Wed from multiple RSS feeds and news API queries | cron `30 1 * * 1-3` (07:00 IST) |
| Storing each article to prevent duplication within a week and across the previous four weeks' newsletters | Neon: `url_hash` UNIQUE, normalised-URL match, `pg_trgm` title similarity, plus a check against the stories of the last four sent issues |
| Wednesday afternoon: 8–10 high signal-to-noise stories, none from the last 4 issues, at least 3 topics | `lib/editorial.ts`: the prompt states the criteria verbatim, then a **code validator** checks the result, retries once and repairs it deterministically if needed |
| 2–3 lines of commentary in her documented voice, stored as a style guide | `voice_guide` table (versioned). **Learn my voice** documents the guide from her past issues. Sentence count and unsupported numbers are checked in code |
| Delivered via Telegram by Wednesday evening | cron `30 9 * * 3` (15:00 IST) → header, one card per story, confirm/reject footer |
| She reviews, edits, **approves or swaps stories individually** | per story ✅ Keep · ✏️ Edit · 🔄 Swap · ❌ Reject, with progress "6 of 9 approved". Rejecting at 8 stories brings in a replacement automatically, and the final confirmation is refused outside 8–10 stories / below 3 topics |
| When she confirms the final draft, it is assembled into a formatted email and sent Thursday morning | ✅ Confirm final draft (with confirmation) → cron `30 2 * * 4` (08:00 IST) → HTML + plain-text email |
| Never sends autonomously; waits for explicit confirmation | one send function starting with an atomic `UPDATE … WHERE status='approved'` claim. Any edit after approval revokes it |
| Reminder if no confirmation by Wednesday 10 PM | cron `30 16 * * 3` → fires 22:00–22:59 IST, once, only while still pending |
| Unsubscribes and bounces from Gmail handled gracefully | Gmail one-click `List-Unsubscribe` + signed footer link. Hard bounces and spam complaints suppressed via signed Resend webhooks. Soft bounces are counted and only suppress after 3 in a row. Thursday-evening delivery report to Telegram. Front-page card for unsubscribes & bounces |
| 2,200 subscribers | CSV import (admin) that never re-activates a suppressed address |
| "It takes her four hours every week" | front-page card: time from draft to her confirmation vs ~4 h by hand |

## Architecture

| Piece | Role |
|---|---|
| **Vercel** (Next.js 16, region `sin1`) | Newspaper-style dashboard, API routes, cron targets |
| **Vercel Cron** | Mon–Wed ingest · Wed draft · Wed 10 PM reminder · Thu send · Thu 6 PM delivery report (UTC expressions mapped to IST; each job re-checks the IST time and the issue's state) |
| **RSS + Google News RSS + GNews API** | Live Indian startup/tech news |
| **Neon Postgres** (Singapore) | Articles, dedup, past-4-issues check, drafts, per-story approval, subscribers, deliveries, run logs |
| **Gemini Flash** (`@google/genai`) | Topic tagging, editorial selection, commentary, voice learning, JSON-schema output, validated in code |
| **Telegram bot** | Story-by-story review, final confirmation, reminder, late "Send now", delivery report |
| **Resend** | Gated batch send with idempotency keys, one-click unsubscribe headers, signed webhooks for bounces/complaints |

![Components map](docs/components-map.svg)

<details><summary>Weekly workflow flowchart (decision points)</summary>

![Workflow flowchart](docs/workflow-flowchart.svg)

Mermaid sources: [docs/components-map.mmd](docs/components-map.mmd), [docs/workflow-flowchart.mmd](docs/workflow-flowchart.mmd).
</details>

### The weekly cycle (all times IST)

| Job | Route | Target | Vercel cron (UTC) | Fires (Hobby: within the hour) |
|---|---|---|---|---|
| Ingest news | `/api/cron/ingest` | Mon–Wed 07:00 | `30 1 * * 1-3` | 07:00–07:59 |
| Select + draft + send to Telegram | `/api/cron/draft` | Wed 15:00 | `30 9 * * 3` | 15:00–15:59 |
| Reminder if still unconfirmed | `/api/cron/reminder` | Wed 22:00 | `30 16 * * 3` | 22:00–22:59 |
| Send newsletter if confirmed | `/api/cron/send` | Thu 08:00 | `30 2 * * 4` | 08:00–08:59 |
| Delivery report to Telegram | `/api/cron/report` | Thu 18:00 | `30 12 * * 4` | 18:00–18:59 |

### Safety guarantees (each has a test)
1. **No email is ever sent unless the issue is `approved`** at the moment of an atomic `UPDATE … WHERE status='approved' AND sent_at IS NULL` claim, in the one function every send path uses.
2. **At most once:** the atomic claim, `deliveries` UNIQUE(issue, subscriber), and Resend idempotency keys.
3. **Suppressed addresses never get mail:** recipients are filtered to `active` at send time.
4. **Test mode only reaches test recipients.** Live needs `EMAIL_MODE=live` **and** `LIVE_SEND_CONFIRMED=true`, and simulated time can never send live.
5. **Any edit after approval revokes it.**
6. **Only Shreya's chat, with the webhook secret, can change or approve a draft.**
7. **Cron needs `CRON_SECRET`; dashboard writes need the admin password.**
8. **Secrets** stay out of the repo, logs and UI; gitleaks runs before each push.

Details: [docs/SCHEMA.md](docs/SCHEMA.md).

## The dashboard: a newspaper you can page through

- **Top navigation:** Overview · Draft · Articles · Voice · Subscribers · Logs · How it works, right under the masthead.
- **Front page, kept deliberately simple:** one status headline with the next action, a five-step status line (Collect → Select → Review → Send → Track delivery), four numbers (articles, stories approved, unsubscribes & bounces, review time vs ~4 h by hand), a rubber stamp when approved or sent, and a collage with one picture per story (8–10) around one button: **View this week's draft**.
- **Turning pages:** the paper **folds** to the next page. From the front page the collage pictures move aside first. Arrow keys and swipes work too, and reduced-motion users get no animation.
- **Inside pages:** the draft (illustrated story cards with keep/edit/swap/reject, Gemini's reasons, approval history, topic mix vs the last four issues, and the email as subscribers will see it), articles (why each was kept or dropped, source health), editorial voice (Learn my voice, edit, version history), subscribers (unsubscribes, bounces, delivery tracking, CSV import), logs, and how it works.
- **Two fonts (Playfair Display headlines, Libre Caslon text), paper creased only at the edges.** Topic illustrations are newsprint etchings generated once with Gemini Flash image (`scripts/generate-topic-art.ts`).

## Setup (≤10 steps)

1. `git clone https://github.com/helenamaria-byte/shreya && cd shreya && npm i` (Node 20+).
2. `cp .env.example .env.local` and fill in the keys (each line explains where to get it). Generate `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET` and `ADMIN_PASSWORD` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
3. Send `/start` to your bot, then run `npx tsx scripts/telegram-setup.ts` (saves `TELEGRAM_CHAT_ID`).
4. `npm run db:migrate && npm run db:seed`.
5. `npm run dev` → http://localhost:3000. Try a job: `npx tsx scripts/run-job.ts ingest`, then `npx tsx scripts/run-job.ts draft --force`.
6. Tests: create a Neon branch, put its URL in `TEST_DATABASE_URL`, then run `npm test`.
7. Deploy: `vercel link`, add each variable with `vercel env add NAME production`, then `vercel --prod`.
8. Set `APP_BASE_URL` to the production URL and redeploy.
9. Webhooks: `npx tsx scripts/telegram-setup.ts --webhook`. For Resend, `POST /webhooks` to `<APP_BASE_URL>/api/resend/webhook` with events `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, and save `signing_secret` as `RESEND_WEBHOOK_SECRET`.
10. Check it: `npm run e2e` and `npm run screenshots`.

## Demo the whole week in five minutes (simulated time)

Open the dashboard → **Run manually ▾** → admin password. A **Simulate time (IST)** value makes a job behave as if it were that moment. It is logged, and it can never trigger a live send.

1. **Collect:** *Run ingestion now* (tick the broken test feed to see graceful failure). Look at **Articles**.
2. **Select:** simulate *Wednesday 15:00* → *Run selection + send draft to Telegram* (tick *regenerate* if needed). Open **View this week's draft**.
3. **Review:** in Telegram, tap ✅ Keep / ✏️ Edit / 🔄 Swap / ❌ Reject per story, then ✅ Confirm final draft → *Yes*. A later edit drops it back to pending, and the stamp disappears.
4. **Reminder:** without confirming, simulate *Wednesday 21:59* → *Run reminder check* (skips), then *22:01* (sends one; a second run skips).
5. **Send:** simulate *Thursday 08:00* → *Run send check*. If confirmed, test-mode email goes out and the stamp reads SENT. If not, nothing is sent and the issue shows NOT SENT.
6. **Track delivery:** simulate *Thursday 18:05* → *Run delivery report*. The Telegram report arrives, and **Subscribers** shows bounces and unsubscribes.
7. **Voice:** **Editorial voice → Learn my voice**: paste past issues to save a learned version; the next draft uses it.

## Repository map

```
app/                 page.tsx (newspaper pages), paper.tsx (page-turn client), unsubscribe page, API routes
lib/                 ingest · editorial (selection, validation, commentary) · issues (state machine, per-story approval)
                     email (gate, template, delivery stats) · telegram · jobs (cron jobs + run log) · voice · subscribers (CSV)
                     time (IST schedule) · topics · topic-art · normalize · sources · auth · dashboard
db/migrations/       SQL migrations (001 schema, 002 per-story approval / soft bounces / report / voice source)
scripts/             migrate, seed, run-job, e2e, screenshots, render-diagrams, generate-topic-art, telegram-setup,
                     telegram-live-test, live-email-test, export-sample-run
tests/               Vitest suites against a Neon test branch (Telegram, Resend and Gemini HTTP intercepted)
docs/                schema, assumptions, diagrams, sample-run (real Gemini output), screenshots, evidence
```

## Known limitations
- **Resend sandbox sender:** without a verified domain, mail comes from `onboarding@resend.dev` and only reaches the account owner and Resend's test addresses.
- **Hobby cron precision:** each cron fires once, somewhere within its hour (see the table).
- **Free tiers:** Gemini and GNews rate limits apply. Calls are batched and retried with backoff.
- **Google News links** stay as Google redirect URLs when they can't be decoded offline.
- Some publishers block cloud IPs (e.g. MediaNama returns 403 from Vercel). Those feeds show as failed and never fail the run.
- Title similarity catches near-identical headlines. Same-event stories worded very differently are left to Gemini's judgement.

## Switching to live sending (later)
1. Verify a sending domain in Resend and change `SENDER` in `lib/email.ts`.
2. Import the real list from **Subscribers → Import subscribers (CSV)**.
3. Set `EMAIL_MODE=live` **and** `LIVE_SEND_CONFIRMED=true` in Vercel, then redeploy.
