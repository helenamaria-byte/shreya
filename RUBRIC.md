# Assignment Rubric — The Dispatch: Newsletter Intelligence Engine

Self-assessment and acceptance checklist against **Problem Statement 17 (MESA Cohort C4, AI and its Applications — Section 1)**. A row is ✅ only when evidence exists; ⚠️ = partial, ❌ = not done (with the reason).

Evidence lives in [`docs/evidence/`](docs/evidence/): `test-results.txt` (full Vitest run: 66 tests in 6 files, all passing), `e2e.txt` (production checks), `live-email-test.txt`, `cron-triggers.txt`, `broken-feed-run.txt`, `telegram-live-test.txt`, `gitleaks.txt`, `gemini-only-grep.txt`. Real Gemini output: [`docs/sample-run/`](docs/sample-run/README.md). Screenshots: [`docs/screenshots/`](docs/screenshots/).

## Trace: every sentence of the brief

| Brief | Status | Where / evidence |
|---|---|---|
| "use live external data … must work with some data at the time of submission" | ✅ | A4 below |
| "All AI tasks must use Gemini Flash. Do not use Claude API." | ✅ | A5 below |
| "Deploy … on Vercel … public URL … GitHub repository … Components Map" | ✅ | A1–A3 |
| "runs Monday through Wednesday: ingesting … multiple RSS feeds and news API queries" | ✅ | B1–B3 |
| "storing each article to prevent duplication — both within a week and across the previous four weeks' newsletters" | ✅ | C1–C3 |
| "Wednesday afternoon, Gemini runs an editorial selection pass … eight to ten … high signal-to-noise relative to this week's batch … haven't been covered in any of the last four newsletters … at least three different topic areas" | ✅ | D1–D3 |
| "two to three lines of commentary in Shreya's documented editorial voice, stored as a style guide" | ✅ | D4–D6, I3 |
| "delivered to Shreya via Telegram by Wednesday evening" | ✅ | E1 |
| "She reviews, edits, approves or swaps stories individually" | ✅ | E2, E3, **I1** |
| "when she confirms the final draft, the system assembles it into a formatted email and sends it … Thursday morning" | ✅ | E4, G3 |
| "must never send the newsletter autonomously — it waits for Shreya's explicit confirmation" | ✅ | G1, G2 |
| "If no confirmation arrives by Wednesday 10 PM, it sends her a reminder" | ✅ | F2 (cron now fires 22:00–22:59 IST) |
| "Unsubscribes from Gmail bounces must be handled gracefully" | ✅ | G4, G5, **I2** |
| Context: "2,200 subscribers", "four hours every week" | ✅ | I4, I5 |

**Total: 100 points**

## A. Submission requirements (gate: all must pass)

| ID | Requirement | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|
| A1 | Public Vercel URL | Production URL loads without login for read-only pages | ✅ | https://the-dispatch-murex.vercel.app (Vercel project `the-dispatch`, region `sin1`) | `e2e.txt`: all 7 pages, unsubscribe page, diagrams and images → 200; admin writes → 401 without login |
| A2 | GitHub repository | Public repo with code, README, docs; no secrets in history | ✅ | https://github.com/helenamaria-byte/shreya | `gitleaks.txt` (full history: no leaks; none of the 12 credential values in any commit) |
| A3 | Components Map | Mermaid source + rendered diagram showing every tool, its role, and data flow | ✅ | `docs/components-map.mmd` → `.svg`; in README and on the dashboard's "How it works" page | `screenshots/07-how-it-works.png` |
| A4 | Live external data | Real articles from live feeds present at submission time | ✅ | `lib/ingest.ts`, `lib/sources.ts` | `cron-triggers.txt` (production cron run: 45 new articles, 24/25 sources); 432 articles for 2026-W42 on the front page |
| A5 | Gemini Flash only | All in-app AI uses a Gemini Flash model; no Claude/other API in app code | ✅ | `lib/gemini.ts` (refuses non-Flash model names), `gemini-3.8-flash`; topic art made once with `gemini-3.1-flash-image` | `gemini-only-grep.txt` |

## B. Ingestion — 12 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| B1 | Multiple RSS feeds | 4 | ≥10 verified live Indian startup/tech feeds | ✅ | 15 direct feeds + 4 Google News RSS searches (`lib/sources.ts`) | `broken-feed-run.txt`: 18 RSS feeds `ok` from Vercel; dropped feeds listed in `docs/ASSUMPTIONS.md` #17 |
| B2 | News API queries | 3 | GNews / Google News queries for funding, AI, policy, etc. | ✅ | 6 GNews queries + 4 Google News searches (incl. SEBI/RBI/MeitY/DPIIT policy) | `broken-feed-run.txt`: GNews sources `fetched=10` |
| B3 | Runs Monday–Wednesday | 2 | Cron configured for Mon–Wed IST; run logs show it | ✅ | `vercel.json` `30 1 * * 1-3`; `scheduleGate("ingest")` | `vercel crons ls` (5 crons) in `cron-triggers.txt`; test "decides act/skip for each job" |
| B4 | Graceful feed failure | 3 | A deliberately broken feed is logged as failed while the run succeeds | ✅ | per-source try/catch + 12 s timeout | `broken-feed-run.txt` (`failed TEST broken feed`, run `success`); test "logs a broken feed as failed while the run succeeds" |

## C. Storage and deduplication (Neon) — 15 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| C1 | Articles stored in Neon | 3 | Schema migrated; articles populated from live run | ✅ | `db/migrations/001…`, `002…`; Neon `the-dispatch` (Singapore) | migration logs; front page "432 articles collected" |
| C2 | Within-week dedup | 4 | Same URL (tracking params) and near-identical titles detected; test passes | ✅ | `normalizeUrl`, `url_hash` UNIQUE + `canonical_hash`, `pg_trgm` > 0.5 | tests "same URL with tracking params → same_url", "near-identical titles → similar_title"; 37 live duplicates flagged |
| C3 | Previous four newsletters excluded | 5 | Article matching a story from the last 4 issues is excluded; test passes | ✅ | `dedupe()` step 1 + past headlines passed to Gemini | tests "matching a story from the last four issues … dropped from candidates", "same link with tracking parameters" |
| C4 | State tracked in DB | 3 | Voice guide, approvals, subscribers, deliveries, run logs in Neon | ✅ | `voice_guide`, `issues`/`issue_stories` (per-story `approved_at`)/`issue_events`, `subscribers`/`subscriber_events`, `deliveries`, `workflow_runs` | `docs/SCHEMA.md` |

## D. AI selection and commentary (Gemini Flash) — 20 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| D1 | Selects 8–10 stories | 4 | Live run has 8–10; validator rejects other counts | ✅ | `selectStories`, `validateSelection`, `repairSelection` | `sample-run/README.md` (9 stories); tests "rejects too few and too many", "retried once … repaired in code" |
| D2 | ≥3 topic areas | 3 | Live draft spans ≥3 topics; validator enforces | ✅ | `validateSelection` | sample run: 7 topics; test "rejects fewer than 3 topics" |
| D3 | Editorial criteria | 4 | Prompt encodes signal-to-noise vs this week's batch, counterintuitive, under-reported, connecting trends; rationale per story | ✅ | `SELECTION_CRITERIA` (verbatim), `gemini_rationale`, `connects_with` | test "states the editorial criteria verbatim"; "Why Gemini picked it" on every story card |
| D4 | 2–3 lines of commentary | 3 | 2–3 sentences, checked in code | ✅ | `checkCommentary()` | tests "counts sentences", "trims to 3 … flags fewer than 2" |
| D5 | Uses stored voice guide | 3 | Guide loaded from Neon into prompt; editing it changes the next output | ✅ | `latestVoiceGuide()` → both prompts | tests "uses the latest voice guide version…", "Learn my voice … the next draft uses it" |
| D6 | No invented facts | 3 | Grounding rules; numbers not in source flagged `needs_review` | ✅ | `GROUNDING_RULES`, `unsupportedNumbers()`, "Check facts" badge | tests "flags numbers that are not in the source" (+ B2B regression found live) |

## E. Telegram review and approval — 15 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| E1 | Draft delivered by Wednesday evening | 3 | Cron Wed afternoon IST; real draft in Telegram | ✅ | `30 9 * * 3` (15:00 IST); `sendDraft` | `telegram-live-test.txt` steps 1/10; test "sends the draft to Telegram" (header + cards + footer, ≤4,096 chars) |
| E2 | Edit commentary | 3 | Edit via Telegram updates DB | ✅ | ✏️ ForceReply (30 min) + `/edit n text` | `telegram-live-test.txt` steps 3–4; test "Edit via ForceReply and /edit" |
| E3 | Swap / reject individual stories | 4 | Swap uses reserves; reject removes; DB reflects both | ✅ | `swapStory` (reserve keeping ≥3 topics, Gemini fallback), `rejectStory` (warns, offers swap) | `telegram-live-test.txt` steps 5–6; test "Swap uses the reserves … Reject removes and warns" |
| E4 | Explicit approval recorded | 3 | Confirmation step; status, time and channel stored | ✅ | ✅ Confirm final draft → "Approve issue #N …? k of n approved individually" → Yes | `telegram-live-test.txt` steps 7–8; tests "Approve asks for confirmation…", "final confirmation names unapproved stories" |
| E5 | Secure bot | 2 | Wrong secret or chat rejected | ✅ | secret header + chat ID check | test "wrong secret → 401; wrong chat → ignored"; `e2e.txt` |

## F. Scheduling and reminder — 8 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| F1 | Asia/Kolkata scheduling | 3 | Cron UTC → IST mapping correct and documented | ✅ | `lib/time.ts`, `vercel.json`, README table | test "maps the Vercel cron UTC times…" (01:30Z→Mon 07:00 … 16:30Z→Wed 22:00, 12:30Z→Thu 18:00) |
| F2 | Wed 10 PM reminder | 3 | Sent when pending after 22:00, not when approved, never twice | ✅ | `runReminder`, cron `30 16 * * 3` (22:00–22:59 IST) | tests "not sent before 22:00, sent once after 22:00, never twice", "not sent when approved" |
| F3 | Testable without waiting | 2 | Simulated time from dashboard and tests | ✅ | Run manually ▾ → Simulate time (IST); `run-job.ts --at=` | tests "jobs respect simulated time"; `screenshots/10-run-manually-admin.png` |

## G. Email delivery and safety (Resend) — 20 pts

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| G1 | Never sends without approval | 6 | pending/rejected/skipped → zero emails, zero delivery rows | ✅ | atomic claim in `sendIssue` (single send path) | tests "sends nothing for a pending_approval / rejected / skipped / insufficient_stories / collecting issue", "Thursday send with a pending issue → skipped" |
| G2 | No duplicate sends | 3 | Re-running sends nothing extra | ✅ | claim + `deliveries` UNIQUE + idempotency key | tests "re-running sends nothing extra", "two concurrent sends: only one claims"; `live-email-test.txt` second send `claimed: false` |
| G3 | Formatted email Thursday morning | 3 | Thu IST cron; real test-mode email with HTML + text | ✅ | `30 2 * * 4`; `renderEmail()` | `live-email-test.txt` (delivered); `screenshots/08-email-preview.png` |
| G4 | Unsubscribe handling | 4 | Signed link + Gmail one-click headers; status updated | ✅ | HMAC tokens, `/unsubscribe`, `POST /api/unsubscribe`, `List-Unsubscribe(-Post)` | tests "valid token unsubscribes … tampered rejected", "every sent email carries List-Unsubscribe + one-click headers" |
| G5 | Bounces and complaints | 4 | Webhook verified; bounced@/complained@ update status and suppress | ✅ | Svix-verified `/api/resend/webhook` | `live-email-test.txt` (bounced → bounced, complained → complained in 10 s); tests "bad signature", "hard bounce and complaint suppress" |

## H. Dashboard, documentation, deliverables — 10 pts

The original "collapsible sections" criterion was the author's own suggestion, not part of the brief. It is replaced here by the newspaper design that was built.

| ID | Requirement | Pts | Pass criteria | Status | Implementation | Evidence |
|---|---|---|---|---|---|---|
| H1 | Every part of the pipeline visible | 2 | Front page, draft, articles, voice, subscribers, logs, how it works — all working | ✅ | `app/page.tsx`, `lib/dashboard.ts` | `screenshots/01`–`07`; `e2e.txt` (every page 200, all tabs present) |
| H2 | Big picture first | 1 | Front page shows the workflow, status headline, what to do next, key numbers and this week's edition at a glance | ✅ | 5-step workflow strip, rubber stamp, 5 cards, topic collage | `screenshots/01-front-page.png` |
| H3 | Details on click / page turning | 1 | "View this week's draft" moves the collage aside and folds to the draft; tabs, ← → and swipe turn pages; rows expand to detail | ✅ | `app/paper.tsx` (fold animation, keyboard, swipe, reduced-motion fallback) | `screenshots/01b-pictures-move-aside.png`, `01c-paper-folding.png`, `02-draft.png` |
| H4 | Clean newspaper design, works on mobile | 1 | Newsprint fonts, crumpled edges with a flat reading area, plain-word statuses with dots, one main button per page, admin actions in one menu, no horizontal scroll on a phone | ✅ | `app/globals.css`, `app/layout.tsx` (Playfair Display, Libre Caslon, IBM Plex Mono, Caveat) | `screenshots/11-phone-front-page.png`, `12-phone-draft.png` (overflow 0 px on all 7 pages) |
| H5 | README + setup + `.env.example` | 2 | Fresh setup possible from README alone | ✅ | README (brief trace, 10 setup steps, 5-minute demo, limitations, going live), `.env.example` | — |
| H6 | Workflow flowchart | 1 | Mermaid source + render with the decision points | ✅ | `docs/workflow-flowchart.mmd` → `.svg` | diamonds: in last four issues? · duplicate this week? · enough stories? · final draft confirmed? · still pending at Wed 10 PM? · approval before the Thursday send? · duplicate-send guard |
| H7 | Screenshots / demo | 1 | Front page, each page, transition frames, phone view | ✅ | `scripts/screenshots.ts` against production | `docs/screenshots/01`–`13` |
| H8 | Sample data and assumptions labelled | 1 | UI banner, `is_sample` flags, `ASSUMPTIONS.md` | ✅ | banner, "sample" tags, voice-guide source label | `docs/ASSUMPTIONS.md` (31 items) |

## I. Brief-driven additions (no extra points — they close gaps in the wording of the brief)

| ID | Addition | Status | Implementation | Evidence |
|---|---|---|---|---|
| I1 | Approve stories **individually** | ✅ | ✅ Keep per story (Telegram + dashboard), "k of n approved" progress, final confirmation names unkept stories | tests "✅ Keep marks one story approved…", "approving the last story offers the final confirmation", "Shreya's edit approves that story; a swapped-in story starts unapproved" |
| I2 | Graceful soft bounces + delivery report | ✅ | soft bounces counted (3 → suppressed), Thursday 6 PM Telegram report, front-page unsubscribes & bounces card, Subscribers page | tests "a temporary bounce is counted, not suppressed…", "waits until Thu 18:00, reports once…" |
| I3 | Documented voice learned from her writing | ✅ | Editorial voice → Learn my voice (`lib/voice.ts`) | tests "asks Gemini to document the voice … next draft uses it", "refuses samples that are too short" |
| I4 | Import the 2,200-subscriber list | ✅ | Subscribers → Import (CSV) (`lib/subscribers.ts`) | tests "adds valid new rows … never re-activates suppressed people", "header-less one-column list" |
| I5 | Show the time saved vs 4 h/week | ✅ | front-page card: review time vs ~4 h by hand | `screenshots/01-front-page.png` |

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
