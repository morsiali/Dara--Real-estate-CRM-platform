// Role-based access control. Server-side checks on every request; the UI only mirrors these.
// Scope values follow the master prompt: Own / Team / Tenant / None.
import { forbidden } from './http.js';

export const ROLES = ['admin', 'manager', 'team_lead', 'agent'];
export const ROLE_RANK = { agent: 1, team_lead: 2, manager: 3, admin: 4 };
export const isManagement = (u) => u.role === 'admin' || u.role === 'manager';
export const isLeadOrAbove = (u) => ROLE_RANK[u.role] >= ROLE_RANK.team_lead;

/** Documented permission matrix (also rendered in docs/product/permissions.md). */
export const MATRIX = {
  'leads.read':          { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'leads.create':        { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'leads.update':        { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'leads.assign':        { agent: 'None', team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'deals.read':          { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'deals.update':        { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'deals.reopen':        { agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'properties.read':     { agent: 'Tenant', team_lead: 'Tenant', manager: 'Tenant', admin: 'Tenant' },
  'properties.update':   { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'tasks.read':          { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'tasks.assign':        { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'tasks.review':        { agent: 'None', team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'events.read':         { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'events.create':       { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'dashboard.member':    { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'dashboard.main':      { agent: 'Tenant', team_lead: 'Tenant', manager: 'Tenant', admin: 'Tenant' },
  'leaderboard.read':    { agent: 'Tenant', team_lead: 'Tenant', manager: 'Tenant', admin: 'Tenant' },
  'analytics.time':      { agent: 'None', team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'goals.set':           { agent: 'None', team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'announcements.create':{ agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'users.manage':        { agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'teams.manage':        { agent: 'None', team_lead: 'None', manager: 'None', admin: 'Tenant' },
  'audit.read':          { agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'projects.manage':     { agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'reservations.read':   { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'reservations.create': { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'reservations.confirm':{ agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'reservations.renew':  { agent: 'None', team_lead: 'None', manager: 'Tenant', admin: 'Tenant' },
  'compliance.read':     { agent: 'Own',  team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
  'workspace.manage':    { agent: 'None', team_lead: 'None', manager: 'None', admin: 'Tenant' },
  'data.export':         { agent: 'None', team_lead: 'None', manager: 'None', admin: 'Tenant' },
  'chat.use':            { agent: 'Tenant', team_lead: 'Tenant', manager: 'Tenant', admin: 'Tenant' },
  'channels.create':     { agent: 'None', team_lead: 'Team', manager: 'Tenant', admin: 'Tenant' },
};

export const scopeOf = (user, action) => MATRIX[action]?.[user.role] ?? 'None';

/** User ids whose records `user` may see for an Own/Team/Tenant-scoped action. */
export function visibleUserIds(db, user, action) {
  const scope = scopeOf(user, action);
  if (scope === 'None') return [];
  if (scope === 'Own') return [user.id];
  if (scope === 'Team') {
    if (!user.team_id) return [user.id];
    return db.all('SELECT id FROM users WHERE tenant_id = ? AND team_id = ?', user.tenant_id, user.team_id).map((r) => r.id);
  }
  return db.all('SELECT id FROM users WHERE tenant_id = ?', user.tenant_id).map((r) => r.id);
}

/** Can `user` act on a record owned by `ownerId` under `action`? */
export function canOnOwner(db, user, action, ownerId) {
  const scope = scopeOf(user, action);
  if (scope === 'None') return false;
  if (scope === 'Tenant') {
    if (!ownerId) return true;
    const o = db.get('SELECT tenant_id FROM users WHERE id = ?', ownerId);
    return !!o && o.tenant_id === user.tenant_id;
  }
  if (ownerId === user.id) return true;
  if (scope === 'Team' && ownerId && user.team_id) {
    const o = db.get('SELECT team_id, tenant_id FROM users WHERE id = ?', ownerId);
    return !!o && o.tenant_id === user.tenant_id && o.team_id === user.team_id;
  }
  return false;
}

export function require(db, user, action, ownerId) {
  if (!canOnOwner(db, user, action, ownerId)) throw forbidden();
}

export function requireScope(user, action) {
  if (scopeOf(user, action) === 'None') throw forbidden();
}

/** SQL fragment restricting `col` to the visible user ids. */
export function ownerFilter(db, user, action, col) {
  const ids = visibleUserIds(db, user, action);
  if (!ids.length) return { sql: '1=0', params: [] };
  return { sql: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
