# CLAUDE.md — The Dispatch

Weekly Indian startup/tech newsletter engine (assignment prototype).

## Stack
Next.js 16 (App Router, TypeScript) on Vercel (region `sin1`) · Neon Postgres via `@neondatabase/serverless` (HTTP) ·
Gemini Flash via `@google/genai` (the only AI in the app) · `rss-parser` + GNews REST · Resend (`resend`, `svix` for webhooks) ·
Telegram Bot API (raw `fetch`, webhook mode) · Vitest + Playwright.

## Commands
- `npm run dev` / `npm run build` / `npm run typecheck`
- `npm run db:migrate` — applies `db/migrations/*.sql` once each
- `npm run db:seed` — voice guide, 4 sample past issues, sample subscribers (idempotent)
- `npm test` — Vitest against `TEST_DATABASE_URL` (a separate Neon branch; Telegram/Resend HTTP intercepted)
- `npx tsx scripts/run-job.ts <ingest|draft|reminder|send|report|dry_run> [--at=YYYY-MM-DDTHH:mm] [--force]` — run a job locally (IST)
- `npx tsx scripts/telegram-setup.ts [--webhook]` · `scripts/telegram-live-test.ts` · `scripts/live-email-test.ts` · `scripts/generate-topic-art.ts`
- `npm run e2e` — checks the production URL · `npm run screenshots` — Playwright screenshots into docs/screenshots
- `npx tsx scripts/render-diagrams.ts` — Mermaid → SVG (docs/ and public/diagrams/)

## Layout
`lib/` (ingest, editorial = selection/commentary/validation, issues = state machine, email = gate + template,
telegram, jobs = cron jobs + run logging, time = IST schedule) · `app/api/*` (cron, webhooks, admin, unsubscribe, health) ·
`app/page.tsx` (dashboard) · `tests/` · `scripts/` · `docs/`.

## Safety invariants (each has a test in tests/)
1. No email is ever sent unless the issue status is `approved` at the moment of the atomic claim
   (`UPDATE issues SET status='sending' WHERE id=$1 AND status='approved' AND sent_at IS NULL RETURNING id` in `lib/email.ts#sendIssue`, the only send path).
2. An issue is sent at most once; re-running any job is safe (atomic claim + `deliveries` UNIQUE(issue_id, subscriber_id) + Resend idempotency key).
3. Suppressed (unsubscribed/bounced/complained) addresses never receive email (`status = 'active'` filter at send time).
4. In `test`/`dry_run` mode nothing goes to non-test recipients. Live needs `EMAIL_MODE=live` AND `LIVE_SEND_CONFIRMED=true`, and never with simulated time.
5. Edits after approval revoke approval (`revokeApprovalIfApproved`).
6. Only the configured Telegram chat, with the correct webhook secret, can change drafts or approve.
7. Cron routes reject requests without `CRON_SECRET`. The dashboard is open by the owner's choice (no login); its actions always use the real clock.
8. Secrets never appear in the repo, logs, responses, or UI. Run gitleaks before every push.

## Rules for agents
- Never switch `EMAIL_MODE` to live or email anyone other than Resend test addresses and `OWNER_EMAIL`.
- Keep all scheduling in IST via `lib/time.ts` (`now()` accepts a simulated time; scripts/tests only).
