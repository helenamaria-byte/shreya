# Assignment Rubric — The Dispatch: Newsletter Intelligence Engine

Self-assessment and acceptance checklist. Claude Code fills the **Implementation** and **Evidence** columns with real file paths and real test output. A row is only marked ✅ when evidence exists. Use ⚠️ for partial and ❌ for not done, with a reason.

Evidence files live in [`docs/evidence/`](docs/evidence/): `test-results.txt` (full Vitest run), `e2e.txt` (production checks), `live-email-test.txt`, `cron-triggers.txt`, `broken-feed-run.txt`, `telegram-live-test.txt`, `gitleaks.txt`, `gemini-only-grep.txt`. Real Gemini output: [`docs/sample-run/`](docs/sample-run/README.md). Screenshots: [`docs/screenshots/`](docs/screenshots/).

**Total: 100 points**

## A. Submission requirements (gate: all must pass)

| ID | Requirement | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|
| A1 | Public Vercel URL | Production URL loads without login for read-only pages | ✅ | https://the-dispatch-murex.vercel.app (Vercel project `the-dispatch`, region `sin1`, no Deployment Protection) | `docs/evidence/e2e.txt`: `GET / → 200`, `/unsubscribe → 200`, diagrams 200; admin writes return 401 without login |
| A2 | GitHub repository | Public repo with code, README, docs; no secrets in history (scan output attached) | {{A2_STATUS}} | {{A2_IMPL}} | `docs/evidence/gitleaks.txt` (`gitleaks git` over full history: no leaks found) |
| A3 | Components Map | Mermaid source + rendered diagram showing every tool, its role, and data flow | ✅ | `docs/components-map.mmd` → `docs/components-map.svg` (rendered by `scripts/render-diagrams.ts`); embedded in README and dashboard "How it works" | GitHub → Vercel → Cron → RSS/GNews → Neon → Gemini → Neon → Telegram → Neon → Resend → Subscribers → webhooks → Neon → Dashboard, with a labelled arrow and role for each; `screenshots/08-section-how.png` |
| A4 | Live external data | Real articles from live feeds present at submission time | ✅ | `lib/ingest.ts`, `lib/sources.ts`; production cron `/api/cron/ingest` | `docs/evidence/cron-triggers.txt`: production cron run "45 new articles from 24/25 sources"; dashboard shows 400+ articles for 2026-W42 (`screenshots/02-section-articles.png`) |
| A5 | Gemini Flash only | All in-app AI calls use a Gemini Flash model; no Claude/other API in app code (grep result attached) | ✅ | `lib/gemini.ts` (only AI client; refuses non-Flash model names), model `gemini-3.8-flash` | `docs/evidence/gemini-only-grep.txt` |

## B. Ingestion — 12 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| B1 | Multiple RSS feeds | 4 | ≥10 verified live Indian startup/tech feeds | ✅ | `lib/sources.ts`: 15 direct feeds (Inc42, YourStory, Entrackr, ET Tech, ET Startups, ET IPOs, Mint ×2, Business Standard, MediaNama, TechCrunch India, BusinessLine, Business Today, The Hindu Business, Indian Express Tech) + 4 Google News RSS searches | `docs/evidence/broken-feed-run.txt`: 18 RSS feeds `ok` from Vercel (MediaNama 403 from cloud IPs is logged); dead feeds dropped are listed in `docs/ASSUMPTIONS.md` #17 |
| B2 | News API queries | 3 | GNews (and/or Google News search) queries for funding, AI, policy, etc. | ✅ | 6 GNews queries (funding, AI, IPOs, fintech, layoffs, EV) + 4 Google News searches (funding, AI startups, SEBI/RBI/MeitY/DPIIT policy, quick commerce/D2C) | `broken-feed-run.txt`: GNews sources `fetched=10` each; Google News feeds 11–14 items |
| B3 | Runs Monday–Wednesday | 2 | Cron configured for Mon–Wed IST; run logs show it | ✅ | `vercel.json` `30 1 * * 1-3` (07:00 IST Mon–Wed); `scheduleGate("ingest")` | `cron-triggers.txt` (Monday run: success); `test-results.txt` › "decides act/skip for each job" (Thu/Fri ingest skipped); Workflow Logs section |
| B4 | Graceful feed failure | 3 | A deliberately broken feed is logged as failed while the run succeeds | ✅ | per-source try/catch + 12 s timeout in `lib/ingest.ts#ingest`; `BROKEN_TEST_SOURCE` | `broken-feed-run.txt`: `failed TEST broken feed … error: fetch failed`, run `status=success`; test "logs a broken feed as failed while the run succeeds" |

## C. Storage and deduplication (Neon) — 15 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| C1 | Articles stored in Neon | 3 | Schema migrated; articles table populated from live run | ✅ | `db/migrations/001_init.sql`, `npm run db:migrate`; Neon project `the-dispatch` (Singapore) | migration log `+ 001_init.sql (18 statements)`; dashboard "431 collected" for 2026-W42 (`screenshots/01-overview-collapsed.png`) |
| C2 | Within-week dedup | 4 | Same URL (with tracking params) and near-identical titles detected; test passes | ✅ | `lib/normalize.ts#normalizeUrl`, `url_hash` UNIQUE + `canonical_hash`, `lib/ingest.ts#dedupe` (pg_trgm > 0.5) | tests "flags the same URL with tracking params as same_url", "flags near-identical titles … as similar_title"; live: 37 duplicates flagged (e.g. "Zetwerk Sets IPO Price Band At ₹143-₹151…" → 0.78 similar) |
| C3 | Previous four newsletters excluded | 5 | Article matching a story from the last 4 issues is excluded; test passes | ✅ | `dedupe()` step 1 (`covered_in_past_issue`), `candidates()` excludes duplicates; past headlines also passed to Gemini | test "marks an article matching a story from the last four issues … and drops it from candidates" + "same link with tracking parameters" |
| C4 | State tracked in DB | 3 | Voice guide, approval status, subscribers, deliveries, run logs all in Neon | ✅ | tables `voice_guide`, `issues` (+`issue_events`), `subscribers` (+`subscriber_events`), `deliveries`, `workflow_runs` | `docs/SCHEMA.md`; dashboard sections read all of them live |

## D. AI selection and commentary (Gemini Flash) — 20 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| D1 | Selects 8–10 stories | 4 | Live run output has 8–10; validator rejects other counts | ✅ | `lib/editorial.ts#selectStories`, `validateSelection`, `repairSelection` | `docs/sample-run/README.md`: 10 stories; tests "rejects too few and too many stories", "retried once … then repaired in code" |
| D2 | ≥3 topic areas | 3 | Live draft spans ≥3 topics; validator enforces | ✅ | `validateSelection` (distinct non-"Other" topics ≥3) | sample run: 6 topics; test "rejects fewer than 3 topics", repair restores 3 |
| D3 | Editorial criteria | 4 | Prompt encodes signal-to-noise vs. this week's batch, counterintuitive, under-reported, connecting trends; rationale stored per story | ✅ | `SELECTION_CRITERIA` in `lib/editorial.ts` (verbatim), `issue_stories.gemini_rationale`, `connects_with` | test "states the editorial criteria verbatim"; every story in `docs/sample-run/README.md` has "Why Gemini picked it" |
| D4 | 2–3 lines of commentary | 3 | Every story's commentary is 2–3 sentences (checked in code) | ✅ | `checkCommentary()` (trims >3, flags <2) | tests "counts sentences", "trims to 3 sentences and flags fewer than 2"; sample run: all 10 commentaries are 3 sentences |
| D5 | Uses stored voice guide | 3 | Guide loaded from Neon into prompt; editing the guide changes the next output | ✅ | `latestVoiceGuide()` → selection + commentary prompts; dashboard editor saves new versions | test "uses the latest voice guide version; editing the guide changes the next prompt" (v2 marker appears in both prompts; `voiceGuideVersion: 2`) |
| D6 | No invented facts | 3 | Grounding rules in prompt; numbers not in source flagged `needs_review` | ✅ | `GROUNDING_RULES`, `unsupportedNumbers()`, `needs_review` + `review_notes` shown in Telegram header/cards and dashboard | test "flags numbers that are not in the source" (`₹9,000 crore`, `40%` flagged; `Rs 5,012` passes) |

## E. Telegram review and approval — 15 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| E1 | Draft delivered by Wednesday evening | 3 | Cron set for Wed afternoon IST; real draft received in Telegram | ✅ | `vercel.json` `30 9 * * 3` (15:00 IST); `lib/telegram.ts#sendDraft` (header, 1 card per story, footer) | `docs/evidence/telegram-live-test.txt` step 1: real Gemini draft (issue #5, 9 stories, 7 topics) delivered to Shreya's chat, `draft_sent_to_telegram_at` set; step 10 left a fresh pending draft; test "sends the draft to Telegram" (header + 9 cards + footer, all ≤4,096 chars) |
| E2 | Edit commentary | 3 | Edit via Telegram updates DB | ✅ | ✏️ → ForceReply + `telegram_pending_actions` (30 min); `/edit <n> <text>` | test "Edit via ForceReply and /edit update the commentary in Neon"; live: `docs/evidence/telegram-live-test.txt` steps 3–4 (✏️ + reply and `/edit 2` → commentary changed in Neon) |
| E3 | Swap / reject individual stories | 4 | Swap uses reserves; reject removes; DB reflects both | ✅ | `swapStory` (best reserve keeping ≥3 topics; Gemini replacement when reserves run out), `rejectStory` (warns <8 stories / <3 topics, offers swap) | test "Swap uses the reserves and keeps the position; Reject removes and warns below 8 stories"; live: `docs/evidence/telegram-live-test.txt` steps 5–6 (swap → old story `swapped_out`, reserve at position 3; reject → `rejected`, 8 stories left) |
| E4 | Explicit approval recorded | 3 | Approve requires confirmation; status, time, and channel stored | ✅ | `a:` → "Approve issue #N with X stories for Thursday 8 AM?" → `ay:` → `approveIssue()` stores `approved_at`, `approved_via` | test "Approve asks for confirmation, then stores status, time and channel"; live: `docs/evidence/telegram-live-test.txt` step 7 (confirmation asked, then `status=approved`, `approved_at`, `approved_via=telegram`); step 8 edit after approval → `pending_approval`, `approval_revoked` event |
| E5 | Secure bot | 2 | Wrong webhook secret or wrong chat ID rejected (test) | ✅ | `app/api/telegram/webhook/route.ts` (timing-safe secret check + chat ID) | test "wrong secret → 401; wrong chat → ignored with no state change"; `e2e.txt` "telegram webhook without secret → 401" |

## F. Scheduling and reminder — 8 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| F1 | Asia/Kolkata scheduling | 3 | Cron UTC expressions map to correct IST times; documented | ✅ | `lib/time.ts` (`istParts`, `scheduleGate`, `SCHEDULE`), `vercel.json`; README table, ASSUMPTIONS #8 | test "maps the Vercel cron UTC times to the intended IST times" (01:30Z→Mon 07:00, 09:30Z→Wed 15:00, 17:00Z→Wed 22:30, 02:30Z→Thu 08:00) |
| F2 | Wed 10 PM reminder | 3 | Simulated-time test: sent when pending after 22:00, not when approved, never twice | ✅ | `runReminder` (atomic `reminder_sent_at IS NULL` claim) | tests "not sent before 22:00, is sent once after 22:00 when pending, never twice" and "not sent when the issue is already approved" |
| F3 | Testable without waiting | 2 | Simulated time works from dashboard and tests | ✅ | `now(simulated)`; dashboard "Run manually ▾ → Simulate time (IST)" (admin only, logged in `workflow_runs.simulated_now`); `scripts/run-job.ts --at=` | tests "jobs respect simulated time"; `screenshots/10-run-manually-admin.png` |

## G. Email delivery and safety (Resend) — 20 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| G1 | Never sends without approval | 6 | Test: pending/rejected/skipped issues produce zero emails and zero delivery rows | ✅ | `lib/email.ts#sendIssue` atomic claim (single send path for cron, dashboard, Telegram) | tests "sends nothing for a pending_approval / rejected / skipped / insufficient_stories / collecting issue: zero emails, zero delivery rows"; "Thursday send run with a pending issue → skipped" |
| G2 | No duplicate sends | 3 | Re-running send job sends nothing extra (test) | ✅ | atomic claim + `deliveries` UNIQUE + Resend `Idempotency-Key` | tests "re-running sends nothing extra", "two concurrent sends: only one claims"; live: `live-email-test.txt` second send `claimed: false` |
| G3 | Formatted email Thursday morning | 3 | Thu IST cron; real test-mode email delivered with HTML + plain text | ✅ | `vercel.json` `30 2 * * 4` (08:00 IST); `renderEmail()` (inline-styled responsive HTML + text) | `live-email-test.txt`: 4 sent in test mode, owner + `delivered@resend.dev` → `delivered` via webhook; preview in `screenshots/03-section-draft.png` |
| G4 | Unsubscribe handling | 4 | Signed link + Gmail one-click List-Unsubscribe headers; status updated (test) | ✅ | HMAC tokens (`unsubscribeToken`), `/unsubscribe` page, `POST /api/unsubscribe`, `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | tests "valid token unsubscribes via one-click POST; tampered token is rejected", "every sent email carries List-Unsubscribe + one-click headers" |
| G5 | Bounces and complaints | 4 | Resend webhook verified; `bounced@resend.dev` / `complained@resend.dev` sends update subscriber status and suppress future sends | ✅ | Resend webhook created via API → `/api/resend/webhook` (Svix verification) | `live-email-test.txt`: `bounced@…: delivery=bounced subscriber=bounced`, `complained@…: delivery=complained subscriber=complained` within 10 s; `e2e.txt` dry run then targets only 2 recipients; tests "rejects a bad signature", "hard bounce and complaint suppress the subscriber" |

## H. Dashboard, documentation, deliverables — 10 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| H1 | Seven dashboard sections | 2 | Overview, Articles, Draft, Voice, Approval, Subscribers, Logs all present and working | ✅ | `app/page.tsx`, `lib/dashboard.ts` | `screenshots/01`–`08`; `e2e.txt` "dashboard shows the sample-data banner and overview" checks every section title |
| H2 | Big picture first | 1 | Overview (status headline, weekly stepper, "What to do next", 4 number cards) visible without clicking, understandable in ~5 seconds | ✅ | Overview block in `app/page.tsx` | `screenshots/01-overview-collapsed.png` |
| H3 | Details on click | 1 | All other sections collapsed by default; each shows a one-line summary when collapsed; rows expand to full detail | ✅ | native `<details>` sections and rows | `screenshots/01` (all collapsed with summaries), `02`–`07` (row expanded) |
| H4 | Clean, uncluttered design | 1 | One page, plain-word status labels with coloured dots, tables ≤5 columns, ≤1 primary button visible, admin actions in one menu, works on mobile | ✅ | `app/globals.css` (one font, neutral palette, one indigo accent; grid tables ≤5 cols) | `screenshots/11-phone-overview.png`, `12-phone-draft.png` (no horizontal overflow: 0 px), `09`/`10` menu |
| H5 | README + setup + `.env.example` | 2 | Fresh setup possible from README alone | ✅ | `README.md` (10 setup steps, demo, limitations, going live), `.env.example` (every variable explained) | — |
| H6 | Workflow flowchart | 1 | Mermaid source + render with all five decision points | ✅ | `docs/workflow-flowchart.mmd` → `.svg` | diamonds: enough stories? · in last four issues? · approved? · still pending at Wed 10 PM? · approval recorded before Thursday send? · plus the duplicate-send guard |
| H7 | Screenshots / demo | 1 | Screenshots of the collapsed page, each expanded section, and a phone-width view in `docs/screenshots/` | ✅ | `scripts/screenshots.ts` (Playwright against production) | `docs/screenshots/01`–`13`; README "Demo the whole week in five minutes" |
| H8 | Sample data and assumptions labelled | 1 | UI banner, `is_sample` flags, `ASSUMPTIONS.md` | ✅ | banner in `app/layout.tsx`, `is_sample` on issues/articles/subscribers, "SAMPLE — assignment data" tags, voice guide assumption note | `docs/ASSUMPTIONS.md`; `screenshots/05`, `06` |

## Score summary

| Section | Max | Score |
|---|---|---|
| B. Ingestion | 12 | 12 |
| C. Storage and dedup | 15 | 15 |
| D. AI selection and commentary | 20 | 20 |
| E. Telegram approval | 15 | 15 |
| F. Scheduling and reminder | 8 | 8 |
| G. Email delivery and safety | 20 | 20 |
| H. Dashboard and docs | 10 | 10 |
| **Total** | **100** | **100** |
