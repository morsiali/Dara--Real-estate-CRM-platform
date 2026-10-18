# Metric definitions

All windows use the tenant's local time (Asia/Dubai). Periods: Today, Week (Mon–Sun), Month, Quarter, Year. Deltas compare against the immediately preceding period of the same length. Source: `server/services/analytics.js`.

| Metric | Definition | Formula | Data source | Time window | Currency handling | Refresh | Owner | Caveats |
|---|---|---|---|---|---|---|---|---|
| Closed volume | Agreed transaction value of deals won | Σ deals.value where stage = won and closed_at in window | `deals` | closed_at | AED only; other currencies excluded (none exist in R1) | On request | Sales director | Rentals count annual rent as value |
| Deals won | Count of deals moved to won | COUNT(stage = won, closed_at in window) | `deals` | closed_at | — | On request | Sales director | Reopened deals leave the count until won again |
| Win rate | Share of closed deals that were won | won / (won + lost) in window | `deals` | closed_at | — | On request | Sales director | Null when nothing closed |
| Gross commission | Brokerage revenue implied by won deals before splits | Σ commission(value, commission_bp), half away from zero | `deals` | closed_at | AED | On request | Finance lead | Not "earned" or "collected" (C7); no splits, VAT or clawbacks |
| Open pipeline | Unweighted value of open deals | Σ value where stage ∉ {won, lost} | `deals` | Snapshot (now) | AED | On request | Sales director | Not a forecast; no probability weighting |
| New leads | Leads created | COUNT(leads.created_at in window) by current owner | `leads` | created_at | — | On request | Team leads | Attributed to the current owner, not the original |
| Leads qualified | Distinct leads moved to qualified | COUNT DISTINCT lead_status_history(to = qualified) | `lead_status_history` | at | — | On request | Team leads | Owner at the time of change |
| Viewings done | Viewings marked completed | COUNT(events type = viewing, status = completed, start_at in window) by organizer | `events` | start_at | — | On request | Team leads | Unrecorded outcomes don't count |
| Calls | Logged calls + completed call events | COUNT(activities type = call) + completed call events | `activities`, `events` | occurred_at / start_at | — | On request | Team leads | Self-reported |
| Tasks approved / On-time rate | Tasks approved in window; share submitted before due | COUNT(approved_at in window); on-time = submitted_at ≤ due_at | `tasks` | approved_at | — | On request | Managers | Tasks without a due date count as not on time |
| Hours in meetings | Duration of completed events organized | Σ(end − start) of completed events | `events` | start_at | — | On request | Managers | Organizer only (team view) |
| Scheduled hours (time insights) | Hours on calendar as organizer or non-declining attendee | Σ(end − start), excluding cancelled | `events`, `event_attendees` | start_at | — | On request | Managers | Includes future scheduled events in the window |
| Double bookings | Overlapping non-cancelled events for the same person | Count of overlapping pairs | `events` | start_at | — | On request | Managers | Allowed when saved with "Save anyway" |
| No-show rate | Share of past client events where the client didn't attend | no_show / (completed + no_show) | `events` | start_at | — | On request | Managers | Depends on agents recording outcomes |
| Points | Engagement score from the points ledger | Σ points_ledger.points in window | `points_ledger` | at | — | On request | Sales director | Not compensation (ADR-005); activity capped at 30 per day |

**Attribution caveat (C8):** these are recorded outcomes, not causal impact. Nothing in the product claims the platform caused revenue changes.
