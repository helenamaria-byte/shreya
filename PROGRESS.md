# PROGRESS — The Dispatch

## Phases
- [x] Phase 0 — Environment inspected (node 24.19, npm 11.17, git 2.55; installed vercel 63.1.2, neonctl 8.3.5, gh 2.102.0, gitleaks via winget; Playwright to be installed per project)
- [ ] Phase 1 — Credentials received and validated (waiting on user)
- [ ] Phase 2/3 — Next.js scaffold, schema, migrations, seed
- [ ] Phase 4 — Workflow jobs (ingest, draft, reminder, send)
- [ ] Section 6 — Telegram review flow
- [ ] Section 8 — Email delivery, unsubscribe, Resend webhook
- [ ] Section 10 — Dashboard
- [ ] Section 11 — Tests (unit + live)
- [ ] Section 12 — GitHub + Vercel deploy, webhooks
- [ ] Section 13 — Docs, diagrams, screenshots, RUBRIC evidence

## Notes
- Project lives in `Desktop/Shreya/the-dispatch` (separate from the aangan-studio repo).
- gh is at `C:\Program Files\GitHub CLI\gh.exe`; gitleaks is under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gitleaks.Gitleaks_*\gitleaks.exe` (new shells pick both up on PATH).

## Blocked — needs user
- GitHub: the fine-grained token cannot create repositories (`Resource not accessible by personal access token` on POST /user/repos and GraphQL createRepository). Needs a token with Repository access = All repositories and Administration: Read and write + Contents: Read and write. Code is committed locally and ready to push.
