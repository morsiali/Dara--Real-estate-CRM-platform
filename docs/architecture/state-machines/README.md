# State machines — v1 (implemented in `server/services/rules.js`)

## Lead
States: `new` (unworked) · `contacted` · `qualified` (requirement confirmed) · `nurturing` (not ready) · `disqualified` (with reason) · `converted` (linked to a deal; terminal)
Initial: new · Terminal: converted

| From | To | Trigger | Actor | Preconditions | Side effects | Audit |
|---|---|---|---|---|---|---|
| new | contacted / qualified / nurturing / disqualified | Status change | Owner, team lead (team), management | Disqualify needs a reason (BR-002) | First-contact time set; +10 points to owner on qualified | `lead.status_changed` |
| contacted | qualified / nurturing / disqualified | Status change | same | same | same | same |
| nurturing | contacted / qualified / disqualified | Status change | same | same | same | same |
| qualified | nurturing / disqualified | Status change | same | same | — | same |
| qualified | converted | Convert to deal | same | Status = qualified (BR-003) | Deal created in `new`, owned by lead owner; +15 points | `lead.converted` |
| disqualified | nurturing | Re-open | same | — | — | `lead.status_changed` |

Consistency (C2): lead status describes qualification only. Pursuit state lives on the deal. Conversion links the two records; nothing is duplicated.

## Deal (opportunity)
States: `new` · `viewing` · `offer` · `negotiation` · `reservation` · `won` (terminal) · `lost` (terminal)

| From | To | Actor | Preconditions | Side effects | Audit |
|---|---|---|---|---|---|
| any open | any other open | Owner / team lead / management | — | Stage history row | `deal.stage_changed` |
| offer / negotiation / reservation | won | same | Linked property and value > 0 (BR-011, BR-012) | closed_at; +100 points; platform-controlled listing → sold/rented (external listings unchanged, with a note); management notified; company channel post | `deal.stage_changed` |
| any open | lost | same | Reason required (BR-013) | closed_at | `deal.stage_changed` |
| won / lost | negotiation | **Management only** | Reason required (BR-014) | closed_at cleared | `deal.reopened` |

Closed deals cannot be edited (BR-015). Points use `ON CONFLICT DO NOTHING` per (user, source), so a reopen + re-win never double-awards (BR-016).

## Task (review workflow)
States: `todo` · `in_progress` · `submitted` · `changes_requested` · `approved` (terminal) · `cancelled` (terminal)

| Action | From | To | Actor | Rule |
|---|---|---|---|---|
| start | todo, changes_requested | in_progress | Assignee | — |
| submit | todo, in_progress, changes_requested | submitted | Assignee | Note optional; creator (or team lead + management for self-assigned work) notified |
| approve | submitted | approved | Reviewer: management, or team lead of the assignee's team, never the assignee unless management (BR-021) | +5/10/15/25 by priority; +5 if submitted ≤ due (BR-024) |
| request_changes | submitted | changes_requested | Reviewer | Note required (BR-022) |
| cancel | any non-terminal | cancelled | Reviewer or creator | — |

## Calendar event
States: `scheduled` · `completed` · `no_show` · `cancelled` (the last three are terminal)
- Create/edit checks overlaps for organizer and attendees (BR-070). A conflict returns `409 CALENDAR_CONFLICT` unless `allow_conflicts` is set.
- An outcome (completed / no_show) can be recorded only once the event has started (BR-071). Cancel is allowed any time.
- Completed viewing +20, meeting +10, call +3 points to the organizer, once.
- Rescheduling resets attendee RSVPs to pending and notifies attendees.

## Reservation (E2) — implemented
States: `held` (48h timer) · `pending_confirmation` (deposit recorded) · `confirmed` (reference recorded) · `expired` · `cancelled` · `converted` (the last three are terminal)

| From | To | Trigger | Actor | Preconditions | Side effects | Audit |
|---|---|---|---|---|---|---|
| — | held | Hold unit | Agent (own) / team lead / management | Unit available, not an unverified import (BR-080); **no other active reservation — DB partial unique index (BR-021)** | Unit → on_hold; linked open deal → reservation stage | `reservation.held` / `reservation.conflict` |
| held | pending_confirmation | Submit | Reserving agent or their lead | Deposit reference (BR-081) | Management notified | `reservation.submitted` |
| pending_confirmation | confirmed | Confirm | Management | Developer/registration reference **always** (BR-082, AC-RES-03) | Unit → reserved; timer cleared | `reservation.confirmed` |
| held | held | Renew | Management | renewals < 1 (BR-083) | Expiry +48h | `reservation.renewed` |
| held / pending | expired | Timer | System (30s sweep) | Not renewed | Unit → available; agent notified once (AC-RES-02) | `reservation.expired` |
| held / pending / confirmed | cancelled | Cancel | Owner side for held/pending; management for confirmed (BR-084) | Reason | Unit → available | `reservation.cancelled` |
| any active | converted | Deal won | Deal owner | Reservation belongs to that deal; another deal's hold blocks the win (BR-086) | Unit → sold/rented (platform authority) | `deal.stage_changed` |

Label (AC-RES-03): on external-authority units, held and pending reservations display "Internal hold — not confirmed with developer".

## Not yet implemented
Offer, Contract, Lease, Payment. Commission splits are excluded (Q-05).
