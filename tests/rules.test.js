// Unit tests: pure business rules (state machines, assignment, matching, money, periods, streaks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadTransition, dealTransition, taskTransition, roundRobinNext, matchProperties, overlaps } from '../server/services/rules.js';
import { commission, toMinor } from '../server/services/money.js';
import { periodRange } from '../server/services/analytics.js';
import { longestStreak } from '../server/services/gamification.js';
import { uuidv7 } from '../server/db.js';

test('BR-001 lead: valid and invalid transitions', () => {
  assert.equal(leadTransition('new', 'contacted').ok, true);
  assert.equal(leadTransition('new', 'converted').code, 'INVALID_TRANSITION');
  assert.equal(leadTransition('converted', 'nurturing').code, 'INVALID_TRANSITION');
  assert.equal(leadTransition('qualified', 'converted').ok, true);
  assert.equal(leadTransition('new', 'bogus').code, 'INVALID_STATUS');
});

test('BR-002 lead: disqualify requires a reason', () => {
  assert.equal(leadTransition('contacted', 'disqualified').code, 'REASON_REQUIRED');
  assert.equal(leadTransition('contacted', 'disqualified', { reason: 'No budget' }).ok, true);
});

test('BR-010..016 deal: winning needs offer stage, property and value', () => {
  const base = { stage: 'viewing', property_id: 'p1', value: 100 };
  assert.equal(dealTransition(base, 'won').code, 'INVALID_TRANSITION');
  assert.equal(dealTransition({ ...base, stage: 'offer', property_id: null }, 'won').code, 'PROPERTY_REQUIRED');
  assert.equal(dealTransition({ ...base, stage: 'offer', value: 0 }, 'won').code, 'VALUE_REQUIRED');
  assert.equal(dealTransition({ ...base, stage: 'negotiation' }, 'won').ok, true);
  assert.equal(dealTransition(base, 'lost').code, 'REASON_REQUIRED');
  assert.equal(dealTransition(base, 'viewing').code, 'NO_CHANGE');
  assert.equal(dealTransition(base, 'reservation').ok, true, 'open stages move freely');
});

test('BR-014 deal: only management reopens, into negotiation, with reason', () => {
  const won = { stage: 'won', property_id: 'p', value: 1 };
  assert.equal(dealTransition(won, 'negotiation', { reason: 'x' }).code, 'CLOSED_DEAL');
  assert.equal(dealTransition(won, 'offer', { reason: 'x', isManagement: true }).code, 'INVALID_TRANSITION');
  assert.equal(dealTransition(won, 'negotiation', { isManagement: true }).code, 'REASON_REQUIRED');
  assert.equal(dealTransition(won, 'negotiation', { reason: 'Buyer returned', isManagement: true }).reopen, true);
});

test('BR-020..025 task review workflow', () => {
  const t = (status) => ({ status, creator_id: 'm', assignee_id: 'a' });
  assert.equal(taskTransition(t('todo'), 'submit', { isAssignee: true }).to, 'submitted');
  assert.equal(taskTransition(t('todo'), 'submit', { isAssignee: false }).code, 'FORBIDDEN');
  assert.equal(taskTransition(t('submitted'), 'approve', { isReviewer: false, isAssignee: true }).code, 'FORBIDDEN');
  assert.equal(taskTransition(t('submitted'), 'approve', { isReviewer: true }).to, 'approved');
  assert.equal(taskTransition(t('submitted'), 'request_changes', { isReviewer: true }).code, 'NOTE_REQUIRED');
  assert.equal(taskTransition(t('approved'), 'cancel', { isReviewer: true }).code, 'INVALID_TRANSITION');
  assert.equal(taskTransition(t('changes_requested'), 'start', { isAssignee: true }).to, 'in_progress');
});

test('BR-030 round-robin cycles in stable order and wraps', () => {
  const ids = ['c', 'a', 'b'];
  assert.equal(roundRobinNext(ids, null), 'a');
  assert.equal(roundRobinNext(ids, 'a'), 'b');
  assert.equal(roundRobinNext(ids, 'c'), 'a');
  assert.equal(roundRobinNext(ids, 'zz-removed'), 'a');
  assert.equal(roundRobinNext([], 'a'), null);
});

test('BR-050..053 matching: must-criteria filter, prefer-criteria rank, reasons cite criteria', () => {
  const P = (o) => ({ id: o.id, status: 'available', authority: 'platform', availability_confidence: 'confirmed', listing_type: 'sale', currency: 'AED', type: 'apartment', price: 200_000_000, bedrooms: 2, community: 'Dubai Marina', ...o });
  const props = [
    P({ id: 'match-loc' }),
    P({ id: 'other-loc', community: 'JVC', price: 150_000_000 }),
    P({ id: 'too-expensive', price: 300_000_000 }),
    P({ id: 'sold', status: 'sold' }),
    P({ id: 'villa', type: 'villa' }),
    P({ id: 'unverified', authority: 'unverified' }),
    P({ id: 'rental', listing_type: 'rent' }),
  ];
  const req = { transaction_type: 'buy', currency: 'AED', budget_max: 250_000_000, property_types: ['apartment'], locations: ['Dubai Marina'], bedrooms_min: 2 };
  const m = matchProperties(req, props);
  assert.deepEqual(m.map((x) => x.property.id), ['match-loc', 'other-loc']);
  assert.ok(m[0].reasons.some((r) => r.includes('Preferred location')));
  assert.ok(m[0].reasons.some((r) => r.startsWith('Within budget')));
  assert.ok(matchProperties(req, props, { includeUnverified: true }).some((x) => x.property.id === 'unverified'));
});

test('BR-070 calendar overlap is half-open', () => {
  assert.equal(overlaps('10', '11', '11', '12'), false);
  assert.equal(overlaps('10', '11', '10:30', '12'), true);
});

test('BR-040 commission: integer math, round half away from zero', () => {
  assert.equal(commission(250_000_000, 200), 5_000_000); // AED 2.5M × 2% = AED 50,000
  assert.equal(commission(12_345, 250), 309); // 308.625 → 309
  assert.equal(commission(10_002, 5000), 5001);
  assert.equal(commission(1, 5000), 1); // 0.5 → 1
  assert.equal(commission(-1, 5000), -1);
  assert.throws(() => commission(1.5, 200));
  assert.equal(toMinor('1999.995'), 200000);
});

test('periodRange: Dubai-local week starts Monday 00:00 (UTC+4)', () => {
  const now = new Date('2026-10-18T19:30:00Z'); // Sunday 23:30 in Dubai
  const w = periodRange('week', 240, now);
  assert.equal(w.start, '2026-10-11T20:00:00.000Z'); // Mon 12 Oct 00:00 Dubai
  assert.equal(w.end, '2026-10-18T20:00:00.000Z');
  assert.equal(w.buckets.length, 7);
  const m = periodRange('month', 240, new Date('2026-10-31T21:00:00Z')); // already 1 Nov in Dubai
  assert.equal(m.start, '2026-10-31T20:00:00.000Z');
  assert.equal(m.buckets.length, 30);
  const prev = periodRange('month', 240, now, -1);
  assert.equal(prev.start, '2026-08-31T20:00:00.000Z');
  assert.equal(periodRange('year', 240, now).buckets.length, 12);
  assert.equal(periodRange('today', 240, now).buckets.length, 24);
  assert.equal(periodRange('nonsense', 240, now).period, 'week');
});

test('longest streak of consecutive days', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-06']), 3);
});

test('uuidv7 is time-ordered and well-formed', () => {
  const a = uuidv7(); const b = uuidv7();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a.slice(0, 13) <= b.slice(0, 13));
});

import { reservationTransition, MAX_RENEWALS } from '../server/services/rules.js';
import { accessMode, checkLimit, PLANS } from '../server/services/billing.js';

test('BR-080..084 reservation transitions', () => {
  const unit = (o) => ({ status: 'available', authority: 'platform', ...o });
  assert.equal(reservationTransition({}, 'hold', { property: unit() }).to, 'held');
  assert.equal(reservationTransition({}, 'hold', { property: unit({ authority: 'unverified' }) }).code, 'UNVERIFIED_UNIT');
  assert.equal(reservationTransition({}, 'hold', { property: unit({ status: 'on_hold' }) }).code, 'UNIT_UNAVAILABLE');
  const held = { status: 'held', renewals: 0 };
  assert.equal(reservationTransition(held, 'submit', { isOwnerSide: true }).code, 'DEPOSIT_REQUIRED');
  assert.equal(reservationTransition(held, 'submit', { isOwnerSide: true, depositNote: 'chq 1' }).to, 'pending_confirmation');
  assert.equal(reservationTransition(held, 'confirm', { canConfirm: true, externalRef: 'X' }).code, 'INVALID_TRANSITION');
  const pending = { status: 'pending_confirmation' };
  assert.equal(reservationTransition(pending, 'confirm', { canConfirm: false, externalRef: 'X' }).code, 'FORBIDDEN');
  assert.equal(reservationTransition(pending, 'confirm', { canConfirm: true }).code, 'REFERENCE_REQUIRED');
  assert.equal(reservationTransition(pending, 'confirm', { canConfirm: true, externalRef: 'DEV-1' }).to, 'confirmed');
  assert.equal(reservationTransition(held, 'renew', { canRenew: true }).to, 'held');
  assert.equal(reservationTransition({ status: 'held', renewals: MAX_RENEWALS }, 'renew', { canRenew: true }).code, 'RENEWAL_LIMIT');
  assert.equal(reservationTransition({ status: 'confirmed' }, 'cancel', { isOwnerSide: true, reason: 'x' }).code, 'FORBIDDEN');
  assert.equal(reservationTransition({ status: 'confirmed' }, 'cancel', { isManagement: true }).code, 'REASON_REQUIRED');
  assert.equal(reservationTransition({ status: 'expired' }, 'cancel', { isManagement: true, reason: 'x' }).code, 'INVALID_TRANSITION');
});

test('F3 access mode: suspended, cancelled and expired trials are read-only; data stays', () => {
  const now = '2026-10-19T00:00:00.000Z';
  assert.equal(accessMode({ status: 'active' }, now), 'full');
  assert.equal(accessMode({ status: 'trial', trial_ends_at: '2026-10-20T00:00:00.000Z' }, now), 'full');
  assert.equal(accessMode({ status: 'trial', trial_ends_at: '2026-10-18T00:00:00.000Z' }, now), 'read_only');
  assert.equal(accessMode({ status: 'suspended' }, now), 'read_only');
  assert.equal(accessMode({ status: 'past_due' }, now), 'full', 'grace period keeps access');
  assert.equal(accessMode({ status: 'suspended', is_platform: 1 }, now), 'full');
});

test('F4 seat limit is a hard limit with an 80% warning', async () => {
  const fakeDb = (seats) => ({ get: (sql) => ({ n: sql.includes('users') ? seats : 0 }) });
  const t = { id: 't', plan: 'trial' };
  assert.equal(PLANS.trial.seats, 5);
  assert.equal((await checkLimit(fakeDb(3), t, 'seats')).warn, true); // 4 of 5
  assert.equal((await checkLimit(fakeDb(1), t, 'seats')).warn, false);
  await assert.rejects(() => checkLimit(fakeDb(5), t, 'seats'), /includes 5 active users/);
  await assert.doesNotReject(() => checkLimit(fakeDb(5000), { id: 't', plan: 'enterprise' }, 'seats'));
});
