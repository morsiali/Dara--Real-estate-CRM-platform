# Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger to revisit |
|---|---|---|---|---|---|---|
| RISK-01 | The uploaded zip contains live database credentials and secrets in `.env` | H | H | Rotate those credentials. Never commit `.env`; `.gitignore` covers it here | Operator | Now |
| RISK-02 | `node:sqlite` is marked experimental by Node.js | M | M | API surface is tiny and wrapped in `server/db.js`; switching to Postgres touches only that layer | Lead engineer | Node release notes; before production |
| RISK-03 | Multi-tenant SaaS on SQLite: no DB-level RLS; single process limits scale | **H** | **H** | WAL mode, busy timeout; plan Postgres + RLS for multi-tenant or more than 50 concurrent users | Lead engineer | Q-10 volumes |
| RISK-04 | Leaderboard incentives drive gaming or unhealthy competition | M | M | Daily activity cap, outcome-based points, transparent rules page; review with the sales director | Sales director | First month of use |
| RISK-05 | No MFA and no password reset by email | H (prod) | H | Admin-reset flow plus forced change; add an identity provider adapter before production | Lead engineer | Before any production use |
| RISK-06 | Regulatory fields (permits, forms, KYC) are unverified | H | H | All Part G items stay `[Verify]`; no enforcement or compliance claims | Operator + counsel | Before go-live |
| RISK-07 | No backup/restore drill has been run | M | H | SQLite file copy or `.backup` is trivial; schedule and test a restore before go-live | Operator | Before go-live |
| RISK-08 | Arabic UI is partial (navigation, headings and core labels; detail text is English) | H | M | Externalized dictionary; native review (Q-11) | Product | Arabic-first users |
| RISK-09 | Plan limits and trial terms are unvalidated; no pricing evidence | H | M | Labelled *proposed*; no prices shown; validate with 5–10 brokerages | Operator | Before charging |
| RISK-10 | Signup abuse (fake workspaces) | M | M | Signup throttle (5/hour/IP), terms checkbox, platform suspension; add email verification | Eng | Before public launch |
