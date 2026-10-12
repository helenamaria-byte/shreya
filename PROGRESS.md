# PROGRESS — The Dispatch

## Phases
- [x] Phase 0 — Environment (node 24.19, npm 11.17, git 2.55; installed vercel 63.1.2, neonctl 8.3.5, gh 2.102.0, gitleaks; Playwright Chromium)
- [x] Phase 1 — Credentials validated (Gemini, GNews, Neon via API key, Telegram getMe, Resend, GitHub user, Vercel whoami)
- [x] Phase 2/3 — Next.js 16 scaffold, schema `db/migrations/001_init.sql`, migrate + seed scripts; Neon project `the-dispatch` (Singapore) + `test` branch
- [x] Phase 4 — Jobs: ingest, draft, reminder, send (+ dry run), schedule gates, workflow_runs logging
- [x] Section 6 — Telegram review flow (code + tests); ⏳ live: waiting for chat ID
- [x] Section 8 — Email: gate, template, unsubscribe, Resend webhook (created via API), real test-mode send verified
- [x] Section 10 — Dashboard (deployed)
- [x] Section 11 — Unit/integration tests (Vitest on Neon test branch), e2e against production, live ingestion, live Gemini draft, live email
- [~] Section 12 — Vercel deployed + env + crons + Resend webhook ✅; GitHub ❌ (token); Telegram webhook ⏳ (chat ID)
- [x] Section 13 — README, SCHEMA, ASSUMPTIONS, diagrams, sample run, screenshots, RUBRIC (E rows pending live Telegram)

## Production
- URL: https://the-dispatch-murex.vercel.app (Vercel project `the-dispatch`)
- Resend webhook id 39f6cb43-15e5-42f3-bda5-f93e09338af8 → /api/resend/webhook

## Remaining once unblocked
1. Telegram: `npx tsx scripts/telegram-setup.ts` (saves chat ID) → `vercel env add TELEGRAM_CHAT_ID production` → `vercel --prod` →
   `npx tsx scripts/telegram-setup.ts --webhook` → `npx tsx scripts/telegram-live-test.ts` → fill RUBRIC E rows → screenshots.
2. GitHub: new token → `gh repo create the-dispatch-newsletter-engine --public --source . --push` (after gitleaks).

## Blocked — needs user
- GitHub: the fine-grained token cannot create repositories (`Resource not accessible by personal access token` on POST /user/repos and GraphQL createRepository). Needs Repository access = All repositories, Administration: Read and write, Contents: Read and write.
- Telegram: no `/start` received yet, so TELEGRAM_CHAT_ID is unknown (getUpdates is empty).
