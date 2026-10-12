# Database schema (Neon Postgres)

Source: [`db/migrations/001_init.sql`](../db/migrations/001_init.sql) and [`002_story_approval_soft_bounces_report.sql`](../db/migrations/002_story_approval_soft_bounces_report.sql). Applied with `npm run db:migrate` (tracked in `schema_migrations`). Extension: `pg_trgm`.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `sources` | RSS feeds and GNews queries, plus their health | `name` UNIQUE, `type` ∈ rss/gnews, `active`, `last_fetched_at`, `last_status` (ok/failed), `last_error`, `last_count` |
| `articles` | Every collected article | `pinned_at` (saved by Shreya for the next issue), `url_hash` **UNIQUE** (sha256 of raw link), `canonical_hash` (normalised link), `duplicate_of` → articles, `duplicate_reason` ∈ same_url / similar_title / covered_in_past_issue, `duplicate_score`, `topic`, `topic_confidence`, `topic_method` (gemini/keyword), `issue_week` (ISO week in IST), `is_sample`. GIN trigram index on `title` |
| `issues` | One per week | `week_key` **UNIQUE**, `issue_number` UNIQUE, `status` ∈ collecting / drafting / insufficient_stories / pending_approval / approved / rejected / sending / sent / skipped, `draft_sent_to_telegram_at`, `reminder_sent_at`, `approved_at`, `approved_via` ∈ telegram/dashboard, `sent_at`, `report_sent_at` (delivery report, once), `is_sample` |
| `issue_stories` | Draft stories and reserves | **UNIQUE(issue_id, article_id)**, `state` ∈ selected / reserve / rejected / swapped_out, `position`, `reserve_rank`, `commentary`, `original_commentary`, `edited_at`, `approved_at` (per-story approval), `gemini_rationale`, `connects_with`, `needs_review`, `review_notes` |
| `issue_events` | Approval timeline (draft sent, edits, reminder, approval, revocation, send) | `issue_id`, `event`, `channel`, `detail`, `created_at` |
| `voice_guide` | Versioned editorial voice | `version` UNIQUE, `content` (markdown), `is_assumption`, `source` (assumed / edited / learned). The latest version goes into every Gemini prompt |
| `subscribers` | Mailing list | `email` UNIQUE, `status` ∈ active / unsubscribed / bounced / complained, `is_test_recipient`, `is_sample`, `unsubscribed_at`, `status_reason`, `soft_bounces` (3 in a row → bounced) |
| `subscriber_events` | Subscriber status history | `subscriber_id`, `status`, `reason` |
| `deliveries` | One row per issue × subscriber | **UNIQUE(issue_id, subscriber_id)**, `resend_email_id`, `status` ∈ queued / sent / delivered / bounced / complained / failed / dry_run, `mode`, `last_event_at` |
| `telegram_pending_actions` | Open "✏️ Edit" prompts | `chat_id`, `action` = edit_commentary, `issue_story_id`, `expires_at` (30 min) |
| `workflow_runs` | Log of every job run | `job`, `trigger` ∈ cron/manual/test, `status` ∈ success/failed/skipped, `summary`, `details` jsonb, `simulated_now` |

## How the invariants are enforced

| Invariant | Mechanism | Test |
|---|---|---|
| 1. No email unless approved | `sendIssue()` (`lib/email.ts`) is the only send path. It starts with `UPDATE issues SET status='sending' WHERE id=$1 AND status='approved' AND sent_at IS NULL RETURNING *`; no row means return before any recipient query or API call | `tests/workflow.test.ts` › approval gate (5 non-approved statuses → 0 emails, 0 deliveries) |
| 2. Sent at most once | The atomic claim (only one caller wins, also under concurrency), `deliveries` UNIQUE(issue, subscriber) inserted *before* sending, rows already `sent` skipped on retry, Resend `Idempotency-Key` per batch | "re-running sends nothing extra", "two concurrent sends: only one claims" |
| 3. Suppressed never emailed | Recipients are filtered on `status='active'` at send time, and re-checked in the pending-delivery join. Webhooks set bounced/complained; unsubscribe sets unsubscribed | suppression tests, Resend webhook test |
| 4. Test/dry-run → test recipients only | `recipients(mode)` adds `AND is_test_recipient` unless mode is live. Live needs `EMAIL_MODE=live` **and** `LIVE_SEND_CONFIRMED=true`, and is forced to test under simulated time | "test mode only returns…", "simulated time can never trigger a live send" |
| 5. Edits revoke approval | `revokeApprovalIfApproved()` runs after every edit/swap/reject/add | "edit, swap and reject each revert approved → pending_approval" |
| 6. Only Shreya's chat + secret | The webhook route checks `X-Telegram-Bot-Api-Secret-Token` (timing-safe) and the chat ID before `handleUpdate` | "wrong secret → 401; wrong chat → ignored" |
| 7. Cron secret; Telegram-only approval | `cronAuthorized()` on every cron route. `/api/admin/action` has no approve or story actions, so the website can't change the draft; it ignores simulated time | "cron routes reject…", "the website is view-only for the draft…" |
| 8. No secrets leak | Secrets only in `.env.local` (gitignored) and Vercel env. `/api/health` returns names + booleans only. Gitleaks runs before each push | `scripts/e2e.ts` checks health output for secret values; gitleaks output in `docs/evidence/` |

## State machine (issues.status)

```
collecting ──draft (≥12 candidates, ≥3 topics)──▶ drafting ──▶ pending_approval ──approve (confirm)──▶ approved ──Thu send claim──▶ sending ──▶ sent
     │                                                            ▲   │                                 │
     └─(too few)─▶ insufficient_stories ──"Draft anyway"──────────┘   │◀──── any edit revokes ──────────┘
                                                                      ├──reject draft──▶ rejected
                                                                      └──not approved at Thu send──▶ skipped ──late approval (same Thursday)──▶ approved
```
