# Risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Trigger to revisit |
|---|---|---|---|---|---|---|
| RISK-01 | The uploaded zip contains live database credentials and secrets in `.env` | H | H | Rotate those credentials. Never commit `.env`; `.gitignore` covers it here | Operator | Now |
| RISK-02 | `node:sqlite` is marked experimental by Node.js | M | M | API surface is tiny and wrapped in `server/db.js`; switching to Postgres touches only that layer | Lead engineer | Node release notes; before production |
| RISK-03 | Single process: SSE chat, sweeps and throttles live in one Node process | M | M | Postgres + RLS now available (ADR-013); horizontal scale needs a shared pub/sub and job lock | Lead engineer | Q-10 volumes / >1 instance |
| RISK-04 | Leaderboard incentives drive gaming or unhealthy competition | M | M | Daily activity cap, outcome-based points, transparent rules page; review with the sales director | Sales director | First month of use |
| RISK-05 | No SSO / identity provider; email delivery not connected | M | H | Built-in TOTP + email flows (ADR-014); connect a mail provider and decide on SSO (Q-09) before launch | Lead engineer | Before public launch |
| RISK-06 | Regulatory fields (permits, forms, KYC) are unverified | H | H | All Part G items stay `[Verify]`; no enforcement or compliance claims | Operator + counsel | Before go-live |
| RISK-07 | No backup/restore drill has been run | M | H | SQLite file copy or `.backup` is trivial; schedule and test a restore before go-live | Operator | Before go-live |
| RISK-08 | Arabic UI is partial (navigation, headings and core labels; detail text is English) | H | M | Externalized dictionary; native review (Q-11) | Product | Arabic-first users |
| RISK-09 | Plan limits and trial terms are unvalidated; no pricing evidence | H | M | Labelled *proposed*; no prices shown; validate with 5–10 brokerages | Operator | Before charging |
| RISK-10 | Signup abuse (fake workspaces) | M | M | Signup throttle (5/hour/IP), terms checkbox, platform suspension, email verification (owners can't invite until verified) | Eng | Before public launch |
| RISK-11 | RLS context settings can be changed by any SQL running as the app role | L | H | All SQL parameterized; no raw SQL input; app never connects as superuser; RLS is defence against app bugs (ADR-013) | Lead engineer | Any feature that accepts query text |
| RISK-12 | Losing or rotating `DARA_SECRET_KEY` makes stored two-step secrets unreadable | M | M | Keep it in a secrets manager with backup; recovery path = admin reset + re-setup | Operator | Key rotation |
| RISK-13 | `DEV_LINKS=1` on a public server would expose reset links in API responses | L | H | Off by default in production; startup warning when on | Operator | Every deployment |
