// SYNTHETIC demo data. Every person, phone number, listing, project and price here is invented
// for demonstration and must never be presented as real market data. Deterministic (seeded PRNG).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { openDb, uuidv7 } from './db.js';
import { hashPassword } from './auth.js';
import { award, evaluateAchievements, POINT_RULES } from './services/gamification.js';
import { createWorkspace } from './routes/saas.js';
import { HOLD_HOURS } from './services/rules.js';

export const DEMO_PASSWORD = 'DaraDemo2026';

function rng(seed = 20261018) {
  let a = seed;
  const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
}

export function seed(db, { now = new Date() } = {}) {
  const R = rng();
  const ctx = { db, hub: null, postSystemMessage: null };
  const NOW = now.getTime();
  const DAY = 864e5;
  // Dubai local working-hours timestamp `daysAgo` days back at local hour h (UTC+4).
  const at = (daysAgo, h = 10, m = 0) => {
    const d = new Date(NOW + 4 * 3600e3 - daysAgo * DAY);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 4, m)).toISOString();
  };
  const created = at(140, 9);

  db.tx(() => {
    const tenantId = uuidv7();
    db.run(`INSERT INTO tenants(id, name, currency, tz_offset_min, created_at, slug, plan, status, trade_licence_no, trade_licence_expiry, orn) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      tenantId, 'Dara Demo Realty (synthetic)', 'AED', 240, created, 'dara-demo', 'professional', 'active', 'SYN-TL-104455', at(-210, 12), 'SYN-ORN-0042');

    // Teams and people
    const teamMarina = uuidv7(); const teamDowntown = uuidv7();
    db.run('INSERT INTO teams(id, tenant_id, name, created_at) VALUES (?,?,?,?)', teamMarina, tenantId, 'Marina & Palm', created);
    db.run('INSERT INTO teams(id, tenant_id, name, created_at) VALUES (?,?,?,?)', teamDowntown, tenantId, 'Downtown & Hills', created);
    const hash = hashPassword(DEMO_PASSWORD);
    const people = [
      ['Layla Haddad', 'admin@dara.demo', 'admin', null, 'Operations & Systems Admin', '#6250d6'],
      ['Omar Farouk', 'manager@dara.demo', 'manager', null, 'Sales Director', '#008300'],
      ['Sara Malik', 'lead@dara.demo', 'team_lead', teamMarina, 'Team Lead — Marina & Palm', '#2a78d6'],
      ['Daniel Okafor', 'daniel@dara.demo', 'team_lead', teamDowntown, 'Team Lead — Downtown & Hills', '#eb6834'],
      ['Aisha Rahman', 'agent@dara.demo', 'agent', teamMarina, 'Senior Property Consultant', '#1baf7a'],
      ['Karim Nasser', 'karim@dara.demo', 'agent', teamMarina, 'Property Consultant', '#e87ba4'],
      ['Priya Menon', 'priya@dara.demo', 'agent', teamMarina, 'Leasing Consultant', '#eda100'],
      ['Yousef Al Amiri', 'yousef@dara.demo', 'agent', teamDowntown, 'Senior Property Consultant', '#e34948'],
      ['Elena Petrova', 'elena@dara.demo', 'agent', teamDowntown, 'Off-plan Specialist', '#2a78d6'],
      ['Hassan Qureshi', 'hassan@dara.demo', 'agent', teamDowntown, 'Property Consultant', '#6250d6'],
    ];
    const U = {};
    for (const [name, email, role, team, title, color] of people) {
      const id = uuidv7();
      const k = Object.keys(U).length;
      // Synthetic broker-card data; one card expiring soon and one expired, to exercise reminders.
      const brnExpiry = ['admin'].includes(role) ? null : email.startsWith('karim') ? at(-20, 12) : email.startsWith('hassan') ? at(5, 12) : at(-(90 + k * 37), 12);
      db.run(`INSERT INTO users(id, tenant_id, team_id, name, email, password_hash, role, title, phone, color, created_at, brn, brn_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, team, name, email, hash, role, title, `+971 50 000 ${String(1000 + k).slice(-4)}`, color, created, role === 'admin' ? null : `SYN-BRN-${30100 + k}`, brnExpiry);
      U[email.split('@')[0]] = db.get('SELECT * FROM users WHERE id = ?', id);
    }
    db.run('UPDATE teams SET lead_id = ? WHERE id = ?', U.lead.id, teamMarina);
    db.run('UPDATE teams SET lead_id = ? WHERE id = ?', U.daniel.id, teamDowntown);
    const agents = [U.agent, U.karim, U.priya, U.yousef, U.elena, U.hassan];
    const field = [...agents, U.lead, U.daniel];
    const teamOf = (u) => (u.team_id === teamMarina ? 'marina' : 'downtown');
    const leadOf = (u) => (u.team_id === teamMarina ? U.lead : U.daniel);
    // Skill weights so the leaderboard isn't flat.
    const skill = new Map([[U.agent.id, 1.0], [U.yousef.id, 0.9], [U.elena.id, 0.75], [U.karim.id, 0.6], [U.priya.id, 0.55], [U.hassan.id, 0.45], [U.lead.id, 0.5], [U.daniel.id, 0.45]]);

    // Properties (fictional projects and developers in real Dubai communities)
    const areas = {
      marina: [['Dubai Marina', 'Marina Sails Residences'], ['JBR', 'Shoreline Walk Towers'], ['Palm Jumeirah', 'Frond Bay Residences'], ['Bluewaters', 'Harbour Lights']],
      downtown: [['Downtown Dubai', 'Boulevard Crest'], ['Business Bay', 'Canal Point'], ['Dubai Hills Estate', 'Parkside Greens'], ['Jumeirah Village Circle', 'Circle Gardens']],
    };
    const developers = ['Harbour Crest Developments', 'Sandline Properties', 'Alcove Living', 'Northgate Estates'];
    const props = [];
    let refN = 0;
    for (const [teamKey, list] of Object.entries(areas)) {
      for (const [community, project] of list) {
        // Availability authority is decided per project (operator decision Q-04).
        const external = ['Harbour Lights', 'Circle Gardens', 'Canal Point'].includes(project);
        const proj = { id: uuidv7(), developer: R.pick(developers), completion: external ? 'off_plan' : 'ready', authority: external ? 'external' : 'platform' };
        db.run(`INSERT INTO projects(id, tenant_id, name, developer, community, city, completion, handover, authority, created_at, updated_at) VALUES (?,?,?,?,?,'Dubai',?,?,?,?,?)`,
          proj.id, tenantId, project, proj.developer, community, proj.completion, external ? at(-R.int(200, 700), 12) : null, proj.authority, created, created);
        for (let i = 0; i < 4; i++) {
          const type = community === 'Palm Jumeirah' || community === 'Dubai Hills Estate' ? R.pick(['villa', 'townhouse', 'apartment']) : R.pick(['apartment', 'apartment', 'penthouse', 'office']);
          const beds = type === 'office' ? null : type === 'villa' ? R.int(3, 6) : type === 'penthouse' ? R.int(3, 5) : type === 'townhouse' ? R.int(2, 4) : R.int(0, 3);
          const rent = R.chance(0.25);
          const base = { apartment: 1_400_000, penthouse: 7_500_000, villa: 6_000_000, townhouse: 2_900_000, office: 2_200_000 }[type];
          const prem = { 'Palm Jumeirah': 1.8, 'Downtown Dubai': 1.4, 'Bluewaters': 1.5, 'Dubai Marina': 1.15, JBR: 1.1, 'Business Bay': 1.0, 'Dubai Hills Estate': 1.2, 'Jumeirah Village Circle': 0.6 }[community];
          let priceAed = Math.round((base * prem * (0.7 + (beds ?? 1) * 0.2) * (0.85 + R.next() * 0.3)) / 5000) * 5000;
          if (rent) priceAed = Math.round(priceAed * 0.065 / 1000) * 1000; // annual rent
          const agent = R.pick(agents.filter((a) => teamOf(a) === teamKey));
          const authority = R.chance(0.08) ? 'unverified' : proj.authority;
          const id = uuidv7(); refN++;
          const p = { id, ref: `DR-${String(refN).padStart(5, '0')}`, title: `${beds === 0 ? 'Studio' : beds ? `${beds}-bed` : ''} ${type} · ${project}`.trim().replace(/^\w/, (c) => c.toUpperCase()), type, listing_type: rent ? 'rent' : 'sale',
            price: priceAed * 100, bedrooms: beds, bathrooms: beds == null ? 2 : Math.max(1, beds), area_sqft: Math.round(((beds ?? 1) + 1) * R.int(420, 700)), community, project,
            developer: proj.developer, completion: proj.completion, authority, agent_id: agent.id };
          const verified = authority === 'unverified' ? null : at(R.int(0, 40));
          const conf = authority === 'unverified' ? 'unverified' : verified < at(30) ? 'stale' : 'confirmed';
          db.run(`INSERT INTO properties(id, tenant_id, ref, title, type, listing_type, status, price, currency, bedrooms, bathrooms, area_sqft, community, project, developer, city, completion, authority, availability_confidence, last_verified_at, permit_no, agent_id, created_at, updated_at, project_id, permit_expiry)
            VALUES (?,?,?,?,?,?,'available',?,'AED',?,?,?,?,?,?,'Dubai',?,?,?,?,?,?,?,?,?,?)`, id, tenantId, p.ref, p.title, p.type, p.listing_type, p.price, p.bedrooms, p.bathrooms, p.area_sqft,
            p.community, p.project, p.developer, p.completion, p.authority, conf, verified, authority === 'unverified' ? null : `SYN-${R.int(100000, 999999)}`, p.agent_id, created, created,
            proj.id, authority === 'unverified' ? null : at(-R.int(4, 300), 12));
          props.push({ ...p, team: teamKey });
        }
      }
    }

    // Leads, contacts, deals
    const firstNames = ['Ahmed', 'Fatima', 'James', 'Mei', 'Rahul', 'Sofia', 'Khalid', 'Noor', 'Lucas', 'Hana', 'Viktor', 'Amira', 'Ethan', 'Zara', 'Mohammed', 'Chloe', 'Tariq', 'Ines', 'Arjun', 'Leila', 'Oliver', 'Mariam', 'Sven', 'Rania', 'Daniela', 'Faisal', 'Grace', 'Imran', 'Julia', 'Salem'];
    const lastNames = ['Al Mansoori', 'Khan', 'Whitfield', 'Chen', 'Sharma', 'Rossi', 'Al Hashimi', 'Haddad', 'Moreau', 'Sato', 'Ivanov', 'Saleh', 'Brooks', 'Malik', 'Al Suwaidi', 'Laurent', 'Aziz', 'Garcia', 'Patel', 'Nasser'];
    const sources = ['portal', 'portal', 'website', 'referral', 'social', 'phone', 'walk_in', 'event'];
    const leads = [];
    for (let i = 0; i < 96; i++) {
      const owner = R.next() < 0.85 ? R.pick(agents) : R.pick([U.lead, U.daniel]);
      const teamKey = teamOf(owner);
      const daysAgo = Math.floor(Math.pow(R.next(), 1.6) * 120);
      const createdAt = at(daysAgo, R.int(9, 19), R.int(0, 59));
      const tx = R.chance(0.25) ? 'rent' : 'buy';
      const pool = props.filter((p) => p.team === teamKey && p.listing_type === (tx === 'rent' ? 'rent' : 'sale'));
      const anchor = R.pick(pool.length ? pool : props);
      const contactId = uuidv7(); const leadId = uuidv7();
      const fn = R.pick(firstNames), ln = R.pick(lastNames);
      db.run('INSERT INTO contacts(id, tenant_id, owner_id, first_name, last_name, email, phone, roles, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        contactId, tenantId, owner.id, fn, ln, `${fn}.${ln}`.toLowerCase().replace(/\s+/g, '') + `${i}@example.com`, `+971 5${R.int(0, 8)} ${R.int(100, 999)} ${R.int(1000, 9999)}`, JSON.stringify([tx === 'rent' ? 'tenant' : 'buyer']), createdAt);
      const budget = Math.round(anchor.price * (1 + R.next() * 0.25) / 1e7) * 1e7;
      // Status distribution weighted by age.
      const roll = R.next();
      let status = daysAgo < 2 ? (roll < 0.6 ? 'new' : 'contacted') : roll < 0.10 ? 'new' : roll < 0.24 ? 'contacted' : roll < 0.36 ? 'nurturing' : roll < 0.46 ? 'disqualified' : roll < 0.58 ? 'qualified' : 'converted';
      db.run(`INSERT INTO leads(id, tenant_id, contact_id, owner_id, team_id, status, source, campaign, transaction_type, budget_max, currency, property_types, locations, bedrooms_min, notes, disqualify_reason, first_contact_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'AED',?,?,?,?,?,?,?,?)`, leadId, tenantId, contactId, owner.id, owner.team_id, status, R.pick(sources), R.chance(0.4) ? R.pick(['Q4 Waterfront', 'Golden Visa Webinar', 'Off-plan Week']) : null,
        tx, budget, JSON.stringify([anchor.type]), JSON.stringify([anchor.community]), anchor.bedrooms, R.chance(0.5) ? R.pick(['Relocating from London in January.', 'Investor — wants yield above 6%.', 'Needs school access for two kids.', 'Prefers high floor, sea view.', 'Cash buyer, flexible timing.']) : null,
        status === 'disqualified' ? R.pick(['Budget far below market for requested area', 'Not reachable after 5 attempts', 'Already bought elsewhere']) : null,
        status === 'new' ? null : at(Math.max(0, daysAgo - 0.2), R.int(9, 19)), createdAt, createdAt);
      db.run('INSERT INTO lead_assignments(id, lead_id, from_user_id, to_user_id, actor_id, method, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), leadId, null, owner.id, leadOf(owner).id, R.chance(0.6) ? 'round_robin' : 'manual', createdAt);
      db.run('INSERT INTO lead_status_history(id, lead_id, from_status, to_status, actor_id, owner_id, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), leadId, null, 'new', owner.id, owner.id, createdAt);
      if (['qualified', 'converted'].includes(status)) {
        const qAt = at(Math.max(0, daysAgo - R.int(1, 5)), R.int(10, 18));
        db.run('INSERT INTO lead_status_history(id, lead_id, from_status, to_status, actor_id, owner_id, at) VALUES (?,?,?,?,?,?,?)', uuidv7(), leadId, 'contacted', 'qualified', owner.id, owner.id, qAt < createdAt ? createdAt : qAt);
        award(ctx, owner, 'lead_qualified', leadId, POINT_RULES.lead_qualified, 'Lead qualified', qAt < createdAt ? createdAt : qAt);
      }
      leads.push({ id: leadId, contactId, owner, daysAgo, status, anchor, name: `${fn} ${ln}`, tx });
    }

    // Deals from converted leads; stage mix biased by owner skill and age.
    const deals = []; const reservationDeals = [];
    for (const l of leads.filter((x) => x.status === 'converted')) {
      const createdAt = at(Math.max(0, l.daysAgo - 4), 11);
      const s = skill.get(l.owner.id) ?? 0.5;
      const r = R.next();
      let stage;
      if (l.daysAgo > 25 && r < 0.12 + s * 0.3) stage = 'won';
      else if (l.daysAgo > 15 && r > 0.88) stage = 'lost';
      else stage = R.pick(['new', 'viewing', 'viewing', 'offer', 'negotiation', 'reservation']);
      const value = stage === 'won' || R.chance(0.7) ? l.anchor.price : 0;
      const closedAt = ['won', 'lost'].includes(stage) ? at(Math.max(0, Math.floor(R.next() * Math.min(l.daysAgo - 5, 85))), R.int(11, 18)) : null;
      const id = uuidv7();
      db.run(`INSERT INTO deals(id, tenant_id, title, contact_id, lead_id, property_id, owner_id, stage, value, currency, commission_bp, expected_close, closed_at, lost_reason, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'AED',?,?,?,?,?,?)`, id, tenantId, `${l.name} — ${l.anchor.project}`, l.contactId, l.id, value ? l.anchor.id : null, l.owner.id, stage, value,
        l.tx === 'rent' ? 500 : 200, stage === 'won' || stage === 'lost' ? null : at(-R.int(5, 60)), closedAt, stage === 'lost' ? R.pick(['Chose a competing listing', 'Mortgage not approved', 'Paused relocation']) : null,
        createdAt, closedAt ?? createdAt);
      db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, at) VALUES (?,?,?,?,?,?)', uuidv7(), id, null, 'new', l.owner.id, createdAt);
      if (stage !== 'new') db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, at) VALUES (?,?,?,?,?,?)', uuidv7(), id, 'new', stage, l.owner.id, closedAt ?? createdAt);
      award(ctx, l.owner, 'lead_converted', l.id, POINT_RULES.lead_converted, 'Lead converted to deal', createdAt);
      if (stage === 'won') {
        award(ctx, l.owner, 'deal_won', id, POINT_RULES.deal_won, `Deal won: ${l.name} — ${l.anchor.project}`, closedAt);
        if (l.anchor.authority === 'platform') db.run('UPDATE properties SET status = ? WHERE id = ?', l.anchor.listing_type === 'rent' ? 'rented' : 'sold', l.anchor.id);
      }
      if (stage === 'reservation') reservationDeals.push({ id, owner: l.owner, lead: l });
      deals.push({ id, owner: l.owner, stage, lead: l });
    }
    // Make sure there are fresh wins this week and today for a live-feeling dashboard.
    const openDeals = deals.filter((d) => ['negotiation', 'reservation', 'offer'].includes(d.stage));
    for (const [i, d] of openDeals.slice(0, 3).entries()) {
      const localHour = new Date(NOW + 4 * 3600e3).getUTCHours();
      const when = i === 0 && localHour >= 10 ? at(0, localHour - 1) : at(i + 1, 15);
      const p = d.lead.anchor;
      db.run(`UPDATE deals SET stage = 'won', value = ?, property_id = ?, closed_at = ?, expected_close = NULL, updated_at = ? WHERE id = ?`, p.price, p.id, when, when, d.id);
      db.run('INSERT INTO deal_stage_history(id, deal_id, from_stage, to_stage, actor_id, at) VALUES (?,?,?,?,?,?)', uuidv7(), d.id, d.stage, 'won', d.owner.id, when);
      if (p.authority === 'platform') db.run('UPDATE properties SET status = ? WHERE id = ?', p.listing_type === 'rent' ? 'rented' : 'sold', p.id);
      award(ctx, d.owner, 'deal_won', d.id, POINT_RULES.deal_won, `Deal won: ${d.lead.name} — ${p.project}`, when);
      d.stage = 'won';
    }

    // Reservations (E2) for deals in the reservation stage: a mix of held, awaiting confirmation and confirmed.
    reservationDeals.forEach((d, i) => {
      const p = d.lead.anchor;
      const unit = db.get('SELECT * FROM properties WHERE id = ?', p.id);
      if (unit.status !== 'available' || unit.authority === 'unverified') return;
      const status = ['held', 'pending_confirmation', 'confirmed', 'held', 'confirmed'][i % 5];
      const createdAt = new Date(NOW - R.int(2, 30) * 3600e3).toISOString();
      const expires = status === 'confirmed' ? null : new Date(Date.parse(createdAt) + HOLD_HOURS * 3600e3).toISOString();
      db.run(`INSERT INTO reservations(id, tenant_id, property_id, deal_id, contact_id, agent_id, status, authority, expires_at, deposit_note, external_ref, confirmed_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uuidv7(), tenantId, p.id, d.id, d.lead.contactId, d.owner.id, status, unit.authority, expires,
        status === 'held' ? null : `Deposit cheque SYN-${R.int(1000, 9999)}`, status === 'confirmed' ? `SYN-DEV-${R.int(10000, 99999)}` : null, status === 'confirmed' ? U.manager.id : null, createdAt, createdAt);
      db.run('UPDATE properties SET status = ? WHERE id = ?', status === 'confirmed' ? 'reserved' : 'on_hold', p.id);
      db.run(`UPDATE deals SET property_id = ?, value = CASE WHEN value = 0 THEN ? ELSE value END WHERE id = ?`, p.id, p.price, d.id);
    });
    // Holds not yet tied to a deal: one awaiting confirmation, one fresh, one on a developer-controlled project.
    const freeUnits = (auth) => props.filter((x) => x.authority === auth && db.get('SELECT status FROM properties WHERE id = ?', x.id).status === 'available');
    [[freeUnits('platform')[0], 'pending_confirmation', U.agent], [freeUnits('platform')[1], 'held', U.karim], [freeUnits('external')[0], 'held', U.yousef]].forEach(([p, status, ag], i) => {
      if (!p) return;
      const createdAt = new Date(NOW - (6 + i * 9) * 3600e3).toISOString();
      db.run(`INSERT INTO reservations(id, tenant_id, property_id, agent_id, status, authority, expires_at, deposit_note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uuidv7(), tenantId, p.id, ag.id, status, p.authority, new Date(Date.parse(createdAt) + HOLD_HOURS * 3600e3).toISOString(), status === 'pending_confirmation' ? 'Deposit transfer SYN-7731' : null, createdAt, createdAt);
      db.run(`UPDATE properties SET status = 'on_hold' WHERE id = ?`, p.id);
    });
    // One expired hold in history.
    { const p = props.find((x) => x.authority === 'platform' && db.get('SELECT status FROM properties WHERE id = ?', x.id).status === 'available');
      db.run(`INSERT INTO reservations(id, tenant_id, property_id, agent_id, status, authority, expires_at, created_at, updated_at) VALUES (?,?,?,?, 'expired', 'platform', ?,?,?)`,
        uuidv7(), tenantId, p.id, U.priya.id, at(3, 12), at(5, 12), at(3, 12)); }

    // Calendar: 35 days back, 14 days ahead. Viewings, client meetings, calls; weekly team reviews.
    const insEvent = (organizer, type, title, startIso, mins, status, extra = {}) => {
      const id = uuidv7();
      const end = new Date(Date.parse(startIso) + mins * 60000).toISOString();
      db.run(`INSERT INTO events(id, tenant_id, title, type, start_at, end_at, location, organizer_id, contact_id, deal_id, property_id, status, outcome, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, title, type, startIso, end, extra.location ?? null, organizer.id, extra.contact_id ?? null, extra.deal_id ?? null, extra.property_id ?? null, status, extra.outcome ?? null, startIso, startIso);
      for (const a of extra.attendees ?? []) db.run(`INSERT INTO event_attendees(event_id, user_id, response) VALUES (?,?,?)`, id, a.id, extra.response ?? 'accepted');
      if (status === 'completed') {
        const pts = { viewing: POINT_RULES.viewing_completed, meeting: POINT_RULES.meeting_completed, call: POINT_RULES.call_completed }[type];
        if (pts) award(ctx, organizer, `${type}_completed`, id, pts, `${type[0].toUpperCase() + type.slice(1)} completed: ${title}`, end);
      }
      return id;
    };
    const nowLocalHour = new Date(NOW + 4 * 3600e3).getUTCHours();
    for (let d = 35; d >= -14; d--) {
      const dow = new Date(NOW + 4 * 3600e3 - d * DAY).getUTCDay(); // 0 Sun … 6 Sat
      const weekend = dow === 0 || dow === 6;
      for (const ag of field) {
        const s = skill.get(ag.id) ?? 0.5;
        const n = weekend ? (R.chance(0.3) ? 1 : 0) : R.int(0, 1) + (R.chance(s) ? 1 : 0) + (R.chance(s * 0.6) ? 1 : 0);
        const used = new Set();
        for (let k = 0; k < n; k++) {
          let h = R.int(9, 18); while (used.has(h)) h = h >= 18 ? 9 : h + 1; used.add(h);
          const type = R.pick(['viewing', 'viewing', 'meeting', 'call']);
          const startIso = at(d, h, R.pick([0, 30]));
          const past = d > 0 || (d === 0 && h + 1 <= nowLocalHour);
          const status = !past ? 'scheduled' : R.chance(0.08) ? 'cancelled' : R.chance(0.1 * (1.2 - s)) ? 'no_show' : 'completed';
          const myLeads = leads.filter((l) => l.owner.id === ag.id);
          const l = myLeads.length ? R.pick(myLeads) : R.pick(leads);
          const p = l.anchor;
          const title = type === 'viewing' ? `Viewing — ${p.project} with ${l.name.split(' ')[0]}` : type === 'meeting' ? `Client meeting — ${l.name}` : `Follow-up call — ${l.name}`;
          insEvent(ag, type, title, startIso, type === 'call' ? 20 : type === 'viewing' ? 60 : 45, status, {
            contact_id: l.contactId, property_id: type === 'viewing' ? p.id : null, location: type === 'viewing' ? `${p.community}, ${p.project}` : type === 'meeting' ? 'Dara office, Business Bay' : null,
            outcome: status === 'completed' ? R.pick(['Client liked the layout; asked for service-charge details.', 'Shortlisted; second viewing requested.', 'Price feedback: 5% above expectation.', 'Positive — preparing offer.']) : status === 'no_show' ? 'Client did not attend; rescheduling.' : null,
          });
        }
      }
      // Team reviews: Monday 09:30 for each team; all-hands first Monday-ish; manager 1:1s Thursdays.
      if (dow === 1) {
        for (const [tl, members] of [[U.lead, agents.filter((a) => a.team_id === teamMarina)], [U.daniel, agents.filter((a) => a.team_id === teamDowntown)]]) {
          const past = d > 0;
          insEvent(tl, 'internal', 'Weekly pipeline review', at(d, 9, 30), 45, past ? 'completed' : 'scheduled', { attendees: [...members, U.manager], location: 'Meeting room 2' });
        }
      }
      if (dow === 4) {
        const ag = agents[(35 - d) % agents.length];
        insEvent(U.manager, 'meeting', `1:1 coaching — ${ag.name}`, at(d, 16), 30, d > 0 ? 'completed' : 'scheduled', { attendees: [ag], location: 'Director’s office' });
      }
    }
    // A pending invite for the demo agent so RSVP is visible.
    insEvent(U.lead, 'internal', 'Listing photo-shoot plan — Marina Sails', at(-2, 11), 30, 'scheduled', { attendees: [U.agent, U.karim], response: 'pending', location: 'Marina Sails lobby' });

    // Activities (calls, WhatsApp, email, notes) — daily cap applies via award().
    for (let i = 0; i < 520; i++) {
      const l = R.pick(leads.filter((x) => x.status !== 'new'));
      const ag = l.owner; const s = skill.get(ag.id) ?? 0.5;
      if (!R.chance(0.4 + s * 0.6)) continue;
      const daysAgo = Math.floor(R.next() * Math.min(l.daysAgo + 1, 60));
      const type = R.pick(['call', 'call', 'whatsapp', 'whatsapp', 'email', 'note']);
      const occurred = at(daysAgo, R.int(9, 19), R.int(0, 59));
      if (occurred > new Date(NOW).toISOString()) continue;
      const id = uuidv7();
      const summary = { call: R.pick(['Discussed budget and timeline.', 'Confirmed viewing slot.', 'Went through payment plan options.', 'Answered service-charge questions.']),
        whatsapp: R.pick(['Shared 3 shortlisted units.', 'Sent floor plans.', 'Sent location pin for viewing.']), email: R.pick(['Sent brochure and price list.', 'Followed up after viewing.']),
        note: R.pick(['Prefers weekend viewings.', 'Spouse decides; involve both.', 'Comparing with a competing agency.']) }[type];
      db.run('INSERT INTO activities(id, tenant_id, user_id, type, contact_id, lead_id, summary, duration_min, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, tenantId, ag.id, type, l.contactId, l.id, summary, type === 'call' ? R.int(2, 25) : null, occurred, occurred);
      award(ctx, ag, 'activity', id, POINT_RULES.activity[type], `Logged ${type}`, occurred);
    }

    // Tasks assigned by management/team leads, in every workflow state.
    const taskTemplates = [
      ['Re-verify availability for stale listings', 'high'], ['Collect signed buyer agreement', 'urgent'], ['Prepare comparable-sales sheet', 'medium'],
      ['Call back all uncontacted portal leads', 'high'], ['Update listing photos and floor plan', 'medium'], ['Draft offer summary for client', 'high'],
      ['Book second viewing', 'low'], ['Follow up on mortgage pre-approval', 'medium'], ['Send market update to nurture list', 'low'], ['Confirm handover checklist', 'medium'],
    ];
    for (let i = 0; i < 60; i++) {
      const assignee = R.pick(agents); const creator = R.chance(0.6) ? leadOf(assignee) : U.manager;
      const [title, priority] = R.pick(taskTemplates);
      const daysAgo = R.int(-3, 40);
      const createdAt = at(Math.max(0, daysAgo + 2), 9, R.int(0, 59));
      const due = at(daysAgo, 18);
      let status = daysAgo < 0 ? R.pick(['todo', 'todo', 'in_progress']) : daysAgo < 3 ? R.pick(['todo', 'in_progress', 'submitted', 'submitted', 'changes_requested']) : R.chance(0.82) ? 'approved' : R.pick(['cancelled', 'in_progress']);
      const s = skill.get(assignee.id) ?? 0.5;
      const submittedAt = ['submitted', 'approved', 'changes_requested'].includes(status) ? at(Math.max(0, daysAgo + (R.chance(s) ? 0.3 : -0.6)), R.int(10, 17)) : null;
      const approvedAt = status === 'approved' ? at(Math.max(0, daysAgo - 1), 11) : null;
      const id = uuidv7();
      db.run(`INSERT INTO tasks(id, tenant_id, title, description, priority, status, assignee_id, creator_id, due_at, submission_note, review_note, reviewer_id, submitted_at, approved_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, tenantId, title, 'Keep notes on the related lead or listing so the team can see progress.', priority, status, assignee.id, creator.id, due,
        submittedAt ? 'Done — details logged on the record.' : null, status === 'changes_requested' ? 'Please attach the client’s confirmation before resubmitting.' : status === 'approved' ? 'Good work.' : null,
        ['approved', 'changes_requested'].includes(status) ? creator.id : null, submittedAt, approvedAt, createdAt, approvedAt ?? submittedAt ?? createdAt);
      if (status === 'approved') {
        award(ctx, assignee, 'task_approved', id, POINT_RULES.task_approved[priority], `Task approved: ${title}`, approvedAt);
        if (submittedAt <= due) award(ctx, assignee, 'task_on_time', id, POINT_RULES.task_on_time_bonus, 'Submitted before due time', approvedAt);
      }
    }

    // Goals for the current month.
    const monthKey = new Date(NOW + 4 * 3600e3).toISOString().slice(0, 7);
    for (const ag of agents) {
      const s = skill.get(ag.id);
      db.run('INSERT INTO goals(id, user_id, month, metric, target, set_by) VALUES (?,?,?,?,?,?)', uuidv7(), ag.id, monthKey, 'won_volume', Math.round(s * 6_000_000) * 100, U.manager.id);
      db.run('INSERT INTO goals(id, user_id, month, metric, target, set_by) VALUES (?,?,?,?,?,?)', uuidv7(), ag.id, monthKey, 'viewings_done', Math.round(10 + s * 14), U.manager.id);
      db.run('INSERT INTO goals(id, user_id, month, metric, target, set_by) VALUES (?,?,?,?,?,?)', uuidv7(), ag.id, monthKey, 'calls_logged', Math.round(30 + s * 40), leadOf(ag).id);
    }

    // Chat: company channel, team channels, an intel channel, and a few DMs.
    const ch = (name, kind, team, topic) => { const id = uuidv7(); db.run('INSERT INTO channels(id, tenant_id, name, kind, team_id, topic, created_at) VALUES (?,?,?,?,?,?,?)', id, tenantId, name, kind, team, topic, created); return id; };
    const general = ch('general', 'public', null, 'Company-wide updates and wins');
    const intel = ch('listings-intel', 'public', null, 'New inventory, price changes and availability checks');
    const marina = ch('marina-palm', 'team', teamMarina, 'Team Marina & Palm');
    const downtown = ch('downtown-hills', 'team', teamDowntown, 'Team Downtown & Hills');
    const all = Object.values(U);
    for (const u of all) { db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?)', general, u.id, at(1, 9)); db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?)', intel, u.id, at(1, 9)); }
    for (const u of all.filter((x) => x.team_id === teamMarina || ['admin', 'manager'].includes(x.role))) db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?)', marina, u.id, at(1, 9));
    for (const u of all.filter((x) => x.team_id === teamDowntown || ['admin', 'manager'].includes(x.role))) db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?)', downtown, u.id, at(1, 9));
    const msg = (channel, user, body, when) => db.run('INSERT INTO messages(id, channel_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?,?)', uuidv7(), channel, user?.id ?? null, user ? 'user' : 'system', body, when);
    msg(general, U.manager, 'Morning all — Q4 push starts today. Pipeline review moves to 9:30 on Mondays.', at(6, 8, 45));
    msg(general, U.agent, 'Noted. I have two reservations that should convert this week.', at(6, 8, 52));
    msg(general, U.yousef, '@Omar can we get a second photographer for the Boulevard Crest listings?', at(5, 10, 12));
    msg(general, U.manager, 'Approved — Layla will book it. Send her the unit list.', at(5, 10, 30));
    msg(general, U.admin, 'Booked for Thursday 2–5pm. Calendar invite sent.', at(5, 11, 2));
    msg(intel, U.elena, 'Heads-up: Circle Gardens 1-beds are moving fast. Re-verify before you share any of them.', at(3, 12, 5));
    msg(intel, U.karim, 'Marina Sails 2-bed price dropped 4% on the developer’s side. Listing updated.', at(2, 15, 40));
    msg(marina, U.lead, 'Team, 3 uncontacted portal leads from last night are in the queue. First call within the hour please.', at(1, 9, 5));
    msg(marina, U.priya, 'Taking the two rental ones.', at(1, 9, 9));
    msg(marina, U.agent, 'I’ll take the Palm villa enquiry.', at(1, 9, 11));
    msg(downtown, U.daniel, 'Great week. Hassan — let’s pair on your Business Bay offer this afternoon.', at(2, 9, 20));
    msg(downtown, U.hassan, 'Thanks Daniel, 3pm works.', at(2, 9, 31));
    msg(general, U.manager, 'Reminder: log every viewing outcome in the calendar — it feeds the team dashboard.', at(0, 9, 0));
    const dm = (a, b) => { const id = uuidv7(); db.run(`INSERT INTO channels(id, tenant_id, name, kind, dm_key, created_at) VALUES (?,?,?,'dm',?,?)`, id, tenantId, 'dm', [a.id, b.id].sort().join(':'), created); db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?), (?,?,?)', id, a.id, at(1, 9), id, b.id, at(1, 9)); return id; };
    const dm1 = dm(U.lead, U.agent);
    msg(dm1, U.lead, 'Can you cover Karim’s 4pm viewing tomorrow? He’s at a developer launch.', at(1, 17, 10));
    msg(dm1, U.agent, 'Yes, send me the client notes.', at(1, 17, 14));
    msg(dm1, U.lead, 'Done — it’s on your calendar.', at(0, 9, 2));

    db.run('INSERT INTO announcements(id, tenant_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', uuidv7(), tenantId, U.manager.id, 'Q4 targets are live',
      'Each consultant’s monthly goals are on their dashboard. Viewings logged with an outcome count toward the leaderboard.', 1, at(6, 8, 30));
    db.run('INSERT INTO announcements(id, tenant_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', uuidv7(), tenantId, U.admin.id, 'Demo workspace',
      'All people, clients, listings and prices in this workspace are synthetic sample data.', 0, at(10, 9));

    for (const u of Object.values(U)) db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', new Date(NOW - R.int(5, 60 * 20) * 60000).toISOString(), u.id);
    for (const u of field) evaluateAchievements(ctx, u);

    // Platform tenant for Dara staff (Part F): manages workspaces, never touches brokerage data.
    const platformId = uuidv7();
    db.run(`INSERT INTO tenants(id, name, currency, tz_offset_min, created_at, slug, plan, status, is_platform) VALUES (?,?,?,?,?,?,?,?,1)`, platformId, 'Dara Platform', 'AED', 240, created, 'dara-platform', 'enterprise', 'active');
    db.run(`INSERT INTO users(id, tenant_id, name, email, password_hash, role, title, color, platform_admin, created_at) VALUES (?,?,?,?,?, 'admin', ?, ?, 1, ?)`,
      uuidv7(), platformId, 'Platform Operator', 'platform@dara.demo', hash, 'Dara customer success', '#0c1630', created);

    // A second, small brokerage on a trial — shows multi-tenancy and isolation in the platform console.
    const second = createWorkspace(db, { company: 'Palm Coast Realty (synthetic)', name: 'Nadia Karim', email: 'owner@palmcoast.demo', password: DEMO_PASSWORD, orn: 'SYN-ORN-0777', now: new Date(NOW - 4 * DAY) });
    const team2 = db.get('SELECT id FROM teams WHERE tenant_id = ?', second.tenantId).id;
    db.run(`INSERT INTO users(id, tenant_id, team_id, name, email, password_hash, role, title, color, created_at) VALUES (?,?,?,?,?,?, 'agent', 'Property Consultant', '#1baf7a', ?)`,
      uuidv7(), second.tenantId, team2, 'Rami Haddad', 'rami@palmcoast.demo', hash, at(4));
    for (let i = 1; i <= 3; i++) {
      db.run(`INSERT INTO properties(id, tenant_id, ref, title, type, listing_type, status, price, currency, bedrooms, community, city, authority, availability_confidence, last_verified_at, agent_id, created_at, updated_at)
        VALUES (?,?,?,?, 'apartment', 'sale', 'available', ?, 'AED', ?, 'Palm Jumeirah', 'Dubai', 'platform', 'confirmed', ?, ?, ?, ?)`, uuidv7(), second.tenantId, `DR-0000${i}`, `${i}-bed apartment · Shoreline (Palm Coast)`, (1_800_000 + i * 600_000) * 100, i, at(2), second.userId, at(3), at(3));
    }
  });
  return { password: DEMO_PASSWORD };
}

// CLI: `npm run seed` resets the database file and loads demo data.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.env.DB_FILE || './data/dara.db');
  if (process.argv.includes('--reset')) for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  const db = openDb(file);
  if (db.get('SELECT id FROM tenants LIMIT 1')) { console.log('Database already has data. Use `npm run seed` (resets) to reload demo data.'); process.exit(0); }
  seed(db);
  console.log(`Seeded synthetic demo data into ${file}. Password for all demo users: ${DEMO_PASSWORD}`);
  db.close();
}
