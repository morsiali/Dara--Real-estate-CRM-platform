// Pure business rules: state machines, assignment and matching. No I/O, fully unit-testable.

/* ---------- Lead state machine (BR-001..BR-005) ---------- */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'nurturing', 'disqualified', 'converted'];
const LEAD_TRANSITIONS = {
  new: ['contacted', 'qualified', 'nurturing', 'disqualified'],
  contacted: ['qualified', 'nurturing', 'disqualified'],
  qualified: ['nurturing', 'disqualified', 'converted'],
  nurturing: ['contacted', 'qualified', 'disqualified'],
  disqualified: ['nurturing'],
  converted: [],
};
export function leadTransition(from, to, { reason } = {}) {
  if (!LEAD_STATUSES.includes(to)) return { ok: false, code: 'INVALID_STATUS', message: `Unknown status “${to}”.` };
  if (!LEAD_TRANSITIONS[from]?.includes(to)) return { ok: false, code: 'INVALID_TRANSITION', message: `A lead cannot move from ${from} to ${to}.` };
  if (to === 'disqualified' && !reason) return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason when disqualifying a lead.' };
  return { ok: true };
}

/* ---------- Deal (opportunity) state machine (BR-010..BR-016) ---------- */
export const DEAL_STAGES = ['new', 'viewing', 'offer', 'negotiation', 'reservation', 'won', 'lost'];
export const OPEN_STAGES = ['new', 'viewing', 'offer', 'negotiation', 'reservation'];
export function dealTransition(deal, to, { reason, isManagement = false } = {}) {
  const from = deal.stage;
  if (!DEAL_STAGES.includes(to)) return { ok: false, code: 'INVALID_STAGE', message: `Unknown stage “${to}”.` };
  if (from === to) return { ok: false, code: 'NO_CHANGE', message: 'The deal is already in that stage.' };
  if (from === 'won' || from === 'lost') {
    if (!isManagement) return { ok: false, code: 'CLOSED_DEAL', message: 'Closed deals can only be reopened by management.' };
    if (to !== 'negotiation') return { ok: false, code: 'INVALID_TRANSITION', message: 'A closed deal reopens into negotiation.' };
    if (!reason) return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for reopening.' };
    return { ok: true, reopen: true };
  }
  if (to === 'won') {
    if (!['offer', 'negotiation', 'reservation'].includes(from)) return { ok: false, code: 'INVALID_TRANSITION', message: 'A deal can be won only after an offer.' };
    if (!deal.property_id) return { ok: false, code: 'PROPERTY_REQUIRED', message: 'Link a property before marking the deal won.' };
    if (!(deal.value > 0)) return { ok: false, code: 'VALUE_REQUIRED', message: 'Set the agreed transaction value before marking the deal won.' };
  }
  if (to === 'lost' && !reason) return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason when marking a deal lost.' };
  return { ok: true };
}

/* ---------- Task review workflow (BR-020..BR-025) ---------- */
export const TASK_ACTIONS = {
  start:           { from: ['todo', 'changes_requested'], to: 'in_progress', actor: 'assignee' },
  submit:          { from: ['todo', 'in_progress', 'changes_requested'], to: 'submitted', actor: 'assignee' },
  approve:         { from: ['submitted'], to: 'approved', actor: 'reviewer' },
  request_changes: { from: ['submitted'], to: 'changes_requested', actor: 'reviewer', noteRequired: true },
  cancel:          { from: ['todo', 'in_progress', 'changes_requested', 'submitted'], to: 'cancelled', actor: 'reviewer' },
};
export function taskTransition(task, action, { isAssignee, isReviewer, note } = {}) {
  const a = TASK_ACTIONS[action];
  if (!a) return { ok: false, code: 'INVALID_ACTION', message: `Unknown action “${action}”.` };
  if (!a.from.includes(task.status)) return { ok: false, code: 'INVALID_TRANSITION', message: `A ${task.status.replace('_', ' ')} task cannot be ${action.replace('_', ' ')}ed.` };
  if (a.actor === 'assignee' && !isAssignee) return { ok: false, code: 'FORBIDDEN', message: 'Only the assignee can do this.' };
  if (a.actor === 'reviewer' && !isReviewer) return { ok: false, code: 'FORBIDDEN', message: 'Only the task creator or management can do this.' };
  if (a.noteRequired && !note) return { ok: false, code: 'NOTE_REQUIRED', message: 'Say what needs to change.' };
  return { ok: true, to: a.to };
}

/* ---------- Lead assignment (BR-030) ---------- */
/** Round-robin: next eligible agent after `lastId` in a stable order; wraps around. */
export function roundRobinNext(eligibleIds, lastId) {
  if (!eligibleIds.length) return null;
  const ids = [...eligibleIds].sort();
  if (!lastId) return ids[0];
  const next = ids.find((id) => id > lastId);
  return next ?? ids[0];
}

/* ---------- Explainable property matching (BR-050..BR-053) ---------- */
/**
 * Must-criteria filter; prefer-criteria score. Only available, non-unverified inventory is matched
 * unless includeUnverified. Every match carries human-readable reasons citing the criterion.
 */
export function matchProperties(req, properties, { includeUnverified = false, fmt = (v) => v } = {}) {
  const wantListing = req.transaction_type === 'rent' ? 'rent' : 'sale';
  const out = [];
  for (const p of properties) {
    if (p.status !== 'available') continue;
    if (!includeUnverified && p.authority === 'unverified') continue;
    if (p.listing_type !== wantListing) continue;
    if (p.currency !== req.currency) continue;
    if (req.budget_max && p.price > req.budget_max) continue;
    if (req.property_types?.length && !req.property_types.includes(p.type)) continue;
    const reasons = [];
    let score = 0;
    if (req.budget_max) {
      reasons.push(`Within budget: ${fmt(p.price)} ≤ ${fmt(req.budget_max)}`);
      if (p.price >= req.budget_max * 0.8) { score += 1; reasons.push('Uses 80–100% of budget'); }
    }
    if (req.property_types?.length) reasons.push(`Type matches: ${p.type}`);
    if (req.locations?.length) {
      const hit = req.locations.find((l) => [p.community, p.project, p.city].filter(Boolean).some((x) => x.toLowerCase() === l.toLowerCase()));
      if (hit) { score += 2; reasons.push(`Preferred location: ${hit}`); }
    }
    if (req.bedrooms_min != null && p.bedrooms != null) {
      if (p.bedrooms >= req.bedrooms_min) { score += 1; reasons.push(`${p.bedrooms} bedrooms (wanted ${req.bedrooms_min}+)`); }
      else reasons.push(`Only ${p.bedrooms} bedrooms (wanted ${req.bedrooms_min}+)`);
    }
    if (p.availability_confidence !== 'confirmed') reasons.push(`Availability ${p.availability_confidence} — verify before sharing`);
    out.push({ property: p, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.property.price - b.property.price);
}

/* ---------- Calendar conflicts (BR-070) ---------- */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/* ---------- Reservation state machine (E2, BR-080..BR-087) ---------- */
export const HOLD_HOURS = 48;
export const MAX_RENEWALS = 1;
export const RESERVATION_ACTIVE = ['held', 'pending_confirmation', 'confirmed'];
/**
 * hold: unit must be available and not an unverified import (BR-080). Concurrency is enforced by the DB index (BR-021).
 * submit: owner side, from held, deposit reference required (BR-081).
 * confirm: management, from pending_confirmation, external/developer reference ALWAYS required (BR-082, AC-RES-03).
 * renew: management, from held, at most MAX_RENEWALS times (BR-083).
 * cancel: owner side for held/pending; confirmed needs management; reason required (BR-084).
 */
export function reservationTransition(r, action, o = {}) {
  if (action === 'hold') {
    const p = o.property;
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'Unit not found.' };
    if (p.authority === 'unverified') return { ok: false, code: 'UNVERIFIED_UNIT', message: 'Verify this listing before holding it.' };
    if (p.status !== 'available') return { ok: false, code: 'UNIT_UNAVAILABLE', message: `This unit is ${p.status.replace('_', ' ')}, not available.` };
    return { ok: true, to: 'held' };
  }
  const A = {
    submit:  { from: ['held'], to: 'pending_confirmation' },
    confirm: { from: ['pending_confirmation'], to: 'confirmed' },
    renew:   { from: ['held'], to: 'held' },
    cancel:  { from: ['held', 'pending_confirmation', 'confirmed'], to: 'cancelled' },
  }[action];
  if (!A) return { ok: false, code: 'INVALID_ACTION', message: `Unknown action “${action}”.` };
  if (!A.from.includes(r.status)) return { ok: false, code: 'INVALID_TRANSITION', message: `A ${r.status.replace('_', ' ')} reservation can’t be ${{ submit: 'submitted', confirm: 'confirmed', renew: 'renewed', cancel: 'cancelled' }[action]}.` };
  if (action === 'submit') { if (!o.isOwnerSide) return { ok: false, code: 'FORBIDDEN', message: 'Only the reserving agent or their lead can submit.' }; if (!o.depositNote) return { ok: false, code: 'DEPOSIT_REQUIRED', message: 'Add the deposit reference before submitting.' }; }
  if (action === 'confirm') { if (!o.canConfirm) return { ok: false, code: 'FORBIDDEN', message: 'Only management can confirm reservations.' }; if (!o.externalRef) return { ok: false, code: 'REFERENCE_REQUIRED', message: 'Record the developer or registration reference to confirm.' }; }
  if (action === 'renew') { if (!o.canRenew) return { ok: false, code: 'FORBIDDEN', message: 'Only management can renew a hold.' }; if (r.renewals >= MAX_RENEWALS) return { ok: false, code: 'RENEWAL_LIMIT', message: `A hold can be renewed ${MAX_RENEWALS} time${MAX_RENEWALS > 1 ? 's' : ''}.` }; }
  if (action === 'cancel') {
    if (r.status === 'confirmed' && !o.isManagement) return { ok: false, code: 'FORBIDDEN', message: 'Only management can cancel a confirmed reservation.' };
    if (r.status !== 'confirmed' && !o.isOwnerSide && !o.isManagement) return { ok: false, code: 'FORBIDDEN', message: 'Only the reserving agent, their lead or management can cancel.' };
    if (!o.reason) return { ok: false, code: 'REASON_REQUIRED', message: 'Give a reason for cancelling.' };
  }
  return { ok: true, to: A.to };
}
