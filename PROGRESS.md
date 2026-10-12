# PROGRESS — The Dispatch

## Phases
- [x] Phase 0 — Environment (node 24.19, npm 11.17, git 2.55; installed vercel 63.1.2, neonctl 8.3.5, gh 2.102.0, gitleaks; Playwright Chromium)
- [x] Phase 1 — Credentials validated (Gemini, GNews, Neon via API key, Telegram getMe, Resend, GitHub user, Vercel whoami)
- [x] Phase 2/3 — Next.js 16 scaffold, schema `db/migrations/001_init.sql`, migrate + seed scripts; Neon project `the-dispatch` (Singapore) + `test` branch
- [x] Phase 4 — Jobs: ingest, draft, reminder, send (+ dry run), schedule gates, workflow_runs logging
- [x] Section 6 — Telegram review flow: webhook registered; live test passed (docs/evidence/telegram-live-test.txt); fresh pending draft left for Shreya
- [x] Section 8 — Email: gate, template, unsubscribe, Resend webhook (created via API), real test-mode send verified
- [x] Section 10 — Dashboard (deployed)
- [x] Section 11 — Unit/integration tests (Vitest on Neon test branch), e2e against production, live ingestion, live Gemini draft, live email
- [~] Section 12 — Vercel deployed + env + crons + Resend + Telegram webhooks ✅; GitHub ✅ pushed to https://github.com/helenamaria-byte/shreya (repo created by the user; token could not create repos)
- [x] Section 13 — README, SCHEMA, ASSUMPTIONS, diagrams, sample run, screenshots, RUBRIC (all rows ✅)

## Round 2 (after reading Problem Statement 17)
- [x] Per-story approval (✅ Keep) in Telegram + dashboard; final confirmation names unkept stories
- [x] Reminder cron moved to 30 16 * * 3 (22:00–22:59 IST)
- [x] Soft bounces (3 in a row → suppressed); Thursday 6 PM delivery report cron
- [x] Learn my voice (Gemini) · CSV subscriber import · time-saved card
- [x] Newspaper redesign: crumpled paper, fold page-turn, collage scatter, rubber stamp, 7 pages, Gemini-generated topic art
- [x] 66/66 tests, e2e all passing on production, docs + rubric + screenshots updated

## Production
- URL: https://the-dispatch-murex.vercel.app (Vercel project `the-dispatch`)
- Resend webhook id 39f6cb43-15e5-42f3-bda5-f93e09338af8 → /api/resend/webhook

## Remaining
- Nothing blocked. Shreya can approve the pending issue #5 draft in Telegram; Thursday 08:00 IST cron sends it in test mode.
