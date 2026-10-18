// Subscription & entitlements (Part F). The server-side entitlement service is the source of truth for limits.
// Plan names and limits are PROPOSED — UNVALIDATED (no pricing evidence yet). No payment provider is integrated.
import { HttpError } from '../http.js';

export const PLANS = {
  trial:        { name: 'Trial',        seats: 5,    listings: 200,   proposed: true },
  starter:      { name: 'Starter',      seats: 10,   listings: 500,   proposed: true },
  professional: { name: 'Professional', seats: 30,   listings: 3000,  proposed: true },
  business:     { name: 'Business',     seats: 100,  listings: 20000, proposed: true },
  enterprise:   { name: 'Enterprise',   seats: null, listings: null,  proposed: true }, // null = by contract
};
export const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'];
export const TRIAL_DAYS = 14;
export const WARN_AT = 0.8;

/** Effective access mode: 'full' or 'read_only' (suspended, cancelled, or trial ended). Data is never deleted here. */
export function accessMode(tenant, now = new Date().toISOString()) {
  if (!tenant || tenant.is_platform) return 'full';
  if (['suspended', 'cancelled'].includes(tenant.status)) return 'read_only';
  if (tenant.status === 'trial' && tenant.trial_ends_at && tenant.trial_ends_at < now) return 'read_only';
  return 'full';
}

export async function usage(db, tenantId) {
  return {
    seats: (await db.get('SELECT COUNT(*) n FROM users WHERE tenant_id = ? AND active = 1', tenantId)).n,
    listings: (await db.get(`SELECT COUNT(*) n FROM properties WHERE tenant_id = ? AND status NOT IN ('sold','rented','off_market')`, tenantId)).n,
  };
}

/** Limit check. kind: 'seats' | 'listings'. Hard limits block; returns a warning flag at >= 80%. */
export async function checkLimit(db, tenant, kind, adding = 1) {
  const plan = PLANS[tenant.plan] || PLANS.trial;
  const limit = plan[kind];
  const used = (await usage(db, tenant.id))[kind];
  if (limit != null && used + adding > limit) {
    throw new HttpError(409, 'ENTITLEMENT_LIMIT', `Your ${plan.name} plan includes ${limit} ${kind === 'seats' ? 'active users' : 'active listings'}. Deactivate one or upgrade the plan.`, { kind, limit, used });
  }
  return { limit, used: used + adding, warn: limit != null && (used + adding) / limit >= WARN_AT };
}

export async function planSummary(db, tenant) {
  const plan = PLANS[tenant.plan] || PLANS.trial;
  const u = await usage(db, tenant.id);
  const pct = (used, limit) => (limit ? Math.round((used / limit) * 100) : null);
  return {
    plan: tenant.plan, plan_name: plan.name, proposed: plan.proposed, status: tenant.status, trial_ends_at: tenant.trial_ends_at,
    access: accessMode(tenant),
    limits: { seats: plan.seats, listings: plan.listings },
    usage: u,
    percent: { seats: pct(u.seats, plan.seats), listings: pct(u.listings, plan.listings) },
  };
}
