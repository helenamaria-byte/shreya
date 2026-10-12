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
- [~] Section 12 — Vercel deployed + env + crons + Resend + Telegram webhooks ✅; GitHub ❌ (token cannot create repos)
- [x] Section 13 — README, SCHEMA, ASSUMPTIONS, diagrams, sample run, screenshots, RUBRIC (E rows pending live Telegram)

## Production
- URL: https://the-dispatch-murex.vercel.app (Vercel project `the-dispatch`)
- Resend webhook id 39f6cb43-15e5-42f3-bda5-f93e09338af8 → /api/resend/webhook

## Remaining once unblocked
- GitHub: once the empty repo exists (or the token has Administration: write): `git remote add origin https://github.com/helenamaria-byte/the-dispatch-newsletter-engine.git && git push -u origin main` (gitleaks first), then set RUBRIC A2 to ✅.

## Blocked — needs user
- GitHub: the fine-grained token cannot create repositories (`Resource not accessible by personal access token` on POST /user/repos and GraphQL createRepository). Second token (All repositories) still lacks Administration: write. Simplest fix: create an empty public repo `the-dispatch-newsletter-engine` at github.com/new (no README/licence) — the current token can then push.
