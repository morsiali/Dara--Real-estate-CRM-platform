# Open questions

| ID | Question | Class | Blocks | Proposed default (built today) | Round | Status |
|---|---|---|---|---|---|---|
| Q-01 | Is this an internal tool for your brokerage, a multi-tenant SaaS you will sell, or a dedicated enterprise deployment? | **Blocking** | Hosting, billing (Part F), isolation design | Internal tool, tenant-ready schema | 1 | Answered 2026-10-19: SaaS sold to other brokerages |
| Q-02 | Who is the first customer: brokerage, developer sales, leasing or mixed? How many users and branches? | **Blocking** | Reservations, offers, leasing scope | Brokerage sales + rentals, about 10 users | 1 | Answered: both brokerage and developer sales |
| Q-03 | Which emirates and countries? Any data-residency requirement (UAE cloud region)? | **Blocking** | Hosting region, Part G rules, PDPL regime | Dubai only; local machine | 1 | Answered: Dubai, UAE (residency → Q-13) |
| Q-04 | Who is the source of truth for unit availability: this platform, developer systems, portals, or mixed per project? | **Blocking** | Reservation state machine (E2), DB holds | Mixed, per-listing authority field | 1 | Answered: depends on the project |
| Q-05 | Should the platform compute commissions with splits and payables, import payment status, or neither? | **Blocking** | Finance model | Gross commission display only | 1 | Answered: show total commission only |
| Q-06 | What do you use today, and do we need to migrate data (CSV/CRM export)? | Reversible default | Import tooling | No migration | 1 | Open |
| Q-07 | Which channels are required in Release 2 (WhatsApp Business, email, SMS, portals)? Which provider accounts exist? | Deferred (R2) | Comms adapters | None | 1 | Open |
| Q-08 | Confirm the point values and achievements, and whether points should be visible company-wide | Reversible default | Leaderboard incentives | Visible to all; values in `POINT_RULES` | 1 | Open |
| Q-09 | Is MFA required for administrators at launch? Which identity provider (Microsoft 365, Google)? | Blocking before production | Auth adapter | Password + scrypt; no MFA | 2 | Open |
| Q-10 | Expected volumes: contacts, listings, messages per month, concurrent users? | Reversible default | DB choice (SQLite → Postgres) | <50 concurrent users | 2 | Open |
| Q-11 | Who will review the Arabic translation? | Deferred | Localization quality | Draft strings | 2 | Open |
| Q-12 | Which RERA/DLD fields are mandatory for you (BRN, ORN, Trakheesi permit enforcement)? | Deferred | Part G rules (all `[Verify]`) | Permit number recorded, not enforced | 2 | Open |
| Q-13 | Where should production be hosted (UAE cloud region required?), and under which data-protection regime are the brokerages (PDPL / DIFC / ADGM)? | **Blocking before production** | Hosting, DPA terms | Local machine only | 2 | Open |
| Q-14 | What pricing do you want to test (per seat vs per plan; monthly vs annual), and which payment provider? | **Blocking before charging** | Part F billing adapter | No prices shown; manual status changes | 2 | Open |
| Q-15 | Should holds be blocked for agents whose BRN has expired, and should listings without a valid permit be hidden from public sharing? | Reversible default (needs counsel) | Part G enforcement | Reminders only, nothing blocked | 2 | Open |
