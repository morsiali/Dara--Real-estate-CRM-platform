# Assumptions

| ID | Assumption | Source | Impact if wrong | Reversibility | Validate by | Status |
|---|---|---|---|---|---|---|
| A-01 | Multi-tenant SaaS for many brokerages | Operator (Q-01) | — | Costly once data exists | — | Confirmed |
| A-02 | Both brokerage and developer sales | Operator (Q-02) | — | — | — | Confirmed |
| A-03 | Dubai, UAE; AED; Asia/Dubai (UTC+4, no DST) | Operator (Q-03) | Expansion beyond the UAE needs IANA time zones | Reversible | — | Confirmed |
| A-04 | Availability authority depends on the project | Operator (Q-04) | — | — | — | Confirmed (ADR-010) |
| A-05 | Show total (gross) commission only; no splits or payables | Operator (Q-05) | — | — | — | Confirmed |
| A-06 | Roles: Admin, Manager, Team lead, Agent | Default Profile H3 (Sales Admin folded into Manager) | Matrix changes | Reversible | B1 review | Open |
| A-07 | Weekdays are Monday–Friday; analytics weeks start Monday | Default (G11 [Verify]) | Week buckets shift | Reversible | Operator | Open |
| A-08 | Default commission 2% on sales and 5% on rentals in demo data | Synthetic placeholder | Wrong gross commission | Reversible (per deal) | Commission policy | Open |
| A-09 | Points values in `POINT_RULES` reflect what management wants to reward | Proposed | Leaderboard incentives skew | Reversible (ledger keeps history) | Sales director review | Open |
| A-10 | Arabic UI strings are a first draft | Inferred | Poor Arabic UX | Reversible | Native-speaker review | Open |
| A-11 | Single server process; under 50 concurrent users | Default | SQLite or SSE limits | Reversible (ADR-002, ADR-003) | Volumes (Q-10) | Open |
| A-12 | All demo people, phones, emails, projects, developers and prices are synthetic | Fact — `server/seed.js` | — | — | — | Confirmed |
| A-13 | Trial = 14 days, 5 users, 200 active listings; plans Starter 10 / Professional 30 / Business 100 users | Proposed (F2) | Wrong packaging | Reversible (code table) | Pricing research (Q-14) | Open |
| A-14 | Reminder lead times: BRN 30 days, permit 14 days, trade licence 60 days | Proposed | Late renewals | Reversible | Operator / counsel | Open |
| A-15 | Hold length 48h, one renewal (Part H default) | Default Profile | Developer policies differ | Reversible (constant) | Developer agreements | Open |
