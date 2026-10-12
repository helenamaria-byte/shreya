# Assumptions

Every decision taken without asking, so it can be reviewed or reversed.

## Product and data
1. **Editorial voice is assumed.** No writing samples from Shreya were provided. The voice guide (v1, seeded in `voice_guide`, flagged `is_assumption`) is an invented, plausible voice built from the brief. It is labelled as an assumption in the UI and is editable (versioned) from the dashboard.
2. **Sample data.** The four past issues (#1–#4), their 35 stories and 11 of the 15 subscribers are fictional. They use invented companies and `example.com` links and are flagged `is_sample`. Fictional headlines avoid naming real regulators or companies as actors. The real list (2,200 subscribers) would be imported via CSV; there is no import tool in the prototype.
3. **Test recipients.** `OWNER_EMAIL` and Resend's `delivered@`, `bounced@` and `complained@resend.dev` are the only `is_test_recipient` rows. In `test` mode (the default and current mode) nobody else can receive email.
4. **Test-send issue.** To prove real delivery without spending this week's real issue, `scripts/live-email-test.ts` sends a copy of the current draft as a separate, labelled issue (`TEST-SEND-n`, negative issue number, `is_sample`). It goes through the same approval gate. Its week key never sorts before a real week, so it is never counted as one of the "last four issues".
5. **"Topic spread" ignores `Other`.** The 3-topic minimum counts the 8 real topic areas only. Articles tagged `Other` (gadget reviews, general politics, global big tech) are not candidates.
6. **Candidates.** A candidate is a non-duplicate, non-sample article collected in the current ISO week (IST), tagged with a real topic. At most the 150 most recent are sent to Gemini, to keep one call within free-tier limits.
7. **Articles collected Thursday–Sunday** belong to the next week's issue, because this week's issue is already drafted and sent.

## Schedule
8. **Vercel Hobby crons** run at most once a day, anywhere within the scheduled hour (verified in the Vercel docs on 2026-10-12). Schedules are set so the whole hour lands after each IST target. Every job re-checks the IST weekday and time and the issue state before acting:
   - ingest `30 1 * * 1-3` → Mon–Wed 07:00–07:59 IST
   - draft `30 9 * * 3` → Wed 15:00–15:59 IST
   - reminder `30 16 * * 3` → Wed 22:00–22:59 IST (any time from Wed 22:00 until the Thursday send is accepted)
   - send `30 2 * * 4` → Thu 08:00–08:59 IST
   - delivery report `30 12 * * 4` → Thu 18:00–18:59 IST (once per sent issue)
9. India has no DST, so IST is treated as a fixed UTC+05:30 offset when converting wall-clock times. Display and weekday logic use `Intl` with `Asia/Kolkata`.
10. **Manual runs.** A manual "Run ingestion now" or "Run selection" without a simulated time is a deliberate override of the schedule. The reminder and send checks always obey the schedule, so a send can never happen outside Thursday. With a simulated time, every job obeys the schedule as of that moment.
11. **Late approval.** If the issue was not approved at the Thursday send run, it becomes `skipped`. Approving it later that same Thursday (IST) offers a "Send now" button with a confirmation. From Friday on it can't be approved and stays unsent.
12. **"Send dry-run email"** (admin menu) renders the current draft and records who *would* receive it in the run log. It makes no API call and changes no state. `EMAIL_MODE=dry_run` is separate: it makes a real (gated) send that records `dry_run` deliveries.

## Technical
13. **Gemini model.** `gemini-3.8-flash` is the newest stable (non-preview) Flash model listed for this key on 2026-10-12. `gemini-2.5-flash` returns 404 for new users.
14. **Similar-title threshold = 0.5** (pg_trgm `similarity`). It was tuned on the first live batch: every pair between 0.50 and 0.60 was the same story from two outlets (e.g. "Tonbo Imaging sets IPO price band…"), and below 0.47 different stories start to appear. Same-event stories with very different wording are left to Gemini's "skip duplicates of the same event" instruction. The past-issue threshold is 0.55.
15. **Same-URL dedup.** `url_hash` (sha256 of the raw link) is UNIQUE, so exact re-fetches are dropped on insert. `canonical_hash` (sha256 of the normalised link) flags tracking-parameter variants as `same_url` duplicates, which stay visible in the dashboard.
16. **Google News links** are opaque redirect URLs. The newer format can't be decoded offline, so those keep the Google link and are deduplicated by title (the " - Publisher" suffix is stripped first).
17. **Feeds.** Verified live on 2026-10-12: Inc42, YourStory, Entrackr (`/rss`), ET Tech, ET Startups, ET Markets IPOs, Mint Technology, Mint Companies, Business Standard Technology, MediaNama, TechCrunch India, BusinessLine Info-Tech, Business Today Tech, The Hindu Business, Indian Express Tech, plus 4 Google News search feeds and 6 GNews queries. Dropped: Moneycontrol (403/503 bot block), Financial Express and Analytics India Mag (malformed XML), VCCircle (404). MediaNama returns 403 to Vercel's IPs, though not from a home connection; it is kept and shows as a failed feed when blocked. TechCrunch's India tag is live but rarely updated.
18. **GNews free plan.** Parallel requests get HTTP 429 and long AND-queries return almost nothing, so the 6 broad queries (`country=in`) run one at a time, about 1.2 s apart. That is 18 requests a day on collection days, within the 100/day free quota.
19. **Resend batch + idempotency.** The batch endpoint takes one `Idempotency-Key` per request. The key is `dispatch-issue-<id>-<subscriber ids in the batch>`, so a retried batch is a no-op. Per-recipient duplicate protection comes from `deliveries` UNIQUE(issue_id, subscriber_id) and from skipping rows already `sent`.
20. **Bounces.** A `email.bounced` event with no type, or a Permanent/hard type, suppresses the subscriber. Transient bounces only update the delivery row.
21. **Telegram wrong-chat updates** get HTTP 200 with `ignored` (so Telegram doesn't retry) and change nothing. A wrong secret gets 401.
22. **Sender** is `onboarding@resend.dev`; no domain is verified on the Resend account.
23. **Neon.** The project `the-dispatch` is in AWS Singapore (`aws-ap-southeast-1`), with Vercel functions in `sin1`. Tests run on a separate Neon branch `test`, which each test truncates and re-seeds.
24. **Admin session.** A 12-hour signed cookie (HMAC keyed by the admin password and cron secret). There are no user accounts.

## Added after reading the full problem statement
25. **Approving stories individually.** The brief says she "reviews, edits, approves or swaps stories individually". Each story has its own approval (✅ Keep). Her own edit to a story counts as approving it, and a swapped-in story starts unapproved. Per-story approval never sends anything. Only **✅ Confirm final draft** (with a confirmation step) approves the issue, and it approves any stories she hadn't kept yet, naming them in the confirmation.
26. **Graceful bounces.** A temporary (soft) bounce increments `soft_bounces` and does not suppress. Three in a row mark the subscriber `bounced`. A delivery resets the count. Hard bounces and spam complaints suppress immediately.
27. **Learn my voice.** Pasting at least 400 characters of her past newsletters asks Gemini Flash to document the voice as a new guide version (`source = learned`, `is_assumption = false`). The guide stays editable and versioned.
28. **Time saved** is measured from when the draft reached Telegram to her final confirmation, compared with the 4 hours a week the brief quotes.
29. **CSV import** accepts `email` (required) and `name` (optional) columns, up to 10,000 rows per upload. Existing addresses are never modified, so a suppressed person can't be re-activated by an import.
30. **Dashboard design.** The earlier "collapsible sections" layout was the author's own suggestion, not part of the brief. It was replaced by a newspaper with pages, turned by a fold animation. Read-only without login; every write needs the admin password.
31. **Topic illustrations** were generated once (`scripts/generate-topic-art.ts`, Gemini Flash image model) and are committed as static images, so drafts never depend on a slow or fragile image step. Each story shows its topic's illustration. No publisher photos are used.
