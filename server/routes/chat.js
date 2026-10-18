// Team chat: company channel, team channels, direct messages; real-time delivery over SSE; @mentions notify.
import { notFound, forbidden, badRequest, respond } from '../http.js';
import { uuidv7, nowIso } from '../db.js';
import { validator } from '../validate.js';
import { scopeOf, isManagement } from '../rbac.js';
import { notify, audit } from '../services/notify.js';

export function registerChat(router, ctx) {
  const { db, hub } = ctx;

  const memberOf = (channelId, userId) => db.get('SELECT * FROM channel_members WHERE channel_id = ? AND user_id = ?', channelId, userId);
  const loadChannel = (user, id) => {
    const c = db.get('SELECT * FROM channels WHERE id = ? AND tenant_id = ?', id, user.tenant_id);
    if (!c) throw notFound('Channel');
    if (!memberOf(c.id, user.id)) {
      // Public channels: auto-join on first open. Team/DM channels: members only.
      if (c.kind !== 'public') throw notFound('Channel');
      db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT DO NOTHING', c.id, user.id, nowIso());
    }
    return c;
  };

  router.get('/api/channels', (req) => {
    const u = req.user;
    // Ensure membership of all public channels.
    for (const c of db.all(`SELECT id FROM channels WHERE tenant_id = ? AND kind = 'public'`, u.tenant_id)) db.run('INSERT INTO channel_members(channel_id, user_id, last_read_at) VALUES (?,?,NULL) ON CONFLICT DO NOTHING', c.id, u.id);
    const rows = db.all(`SELECT c.*, m.last_read_at,
        (SELECT COUNT(*) FROM messages x WHERE x.channel_id = c.id AND (m.last_read_at IS NULL OR x.created_at > m.last_read_at) AND (x.user_id IS NULL OR x.user_id != ?)) unread,
        (SELECT MAX(created_at) FROM messages x WHERE x.channel_id = c.id) last_message_at,
        (SELECT body FROM messages x WHERE x.channel_id = c.id ORDER BY created_at DESC LIMIT 1) last_message
      FROM channels c JOIN channel_members m ON m.channel_id = c.id AND m.user_id = ? WHERE c.tenant_id = ? ORDER BY c.kind, COALESCE(last_message_at, c.created_at) DESC`, u.id, u.id, u.tenant_id);
    const items = rows.map((c) => {
      if (c.kind !== 'dm') return c;
      const other = db.get(`SELECT u.id, u.name, u.color FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.user_id != ?`, c.id, u.id);
      return { ...c, name: other?.name ?? 'Direct message', other };
    });
    return { items, online: hub.online() };
  });

  router.post('/api/channels', (req) => {
    if (scopeOf(req.user, 'channels.create') === 'None') throw forbidden('Only team leads and management can create channels.');
    const v = validator(req.body).str('name', { required: true, max: 40 }).str('topic', { max: 200 }).oneOf('kind', ['public', 'team']).done();
    const name = v.name.toLowerCase().replace(/[^a-z0-9؀-ۿ-]+/g, '-').replace(/^-|-$/g, '');
    if (!name) throw badRequest('Use letters or numbers in the channel name.', { name: 'invalid' });
    const kind = v.kind ?? 'public';
    if (kind === 'public' && !isManagement(req.user)) throw forbidden('Only management can create company-wide channels.');
    const id = uuidv7();
    db.tx(() => {
      db.run('INSERT INTO channels(id, tenant_id, name, kind, team_id, topic, created_at) VALUES (?,?,?,?,?,?,?)', id, req.user.tenant_id, name, kind, kind === 'team' ? req.user.team_id : null, v.topic ?? null, nowIso());
      const members = kind === 'team'
        ? db.all('SELECT id FROM users WHERE team_id = ? UNION SELECT id FROM users WHERE tenant_id = ? AND role IN (\'admin\',\'manager\')', req.user.team_id, req.user.tenant_id)
        : db.all('SELECT id FROM users WHERE tenant_id = ?', req.user.tenant_id);
      for (const m of members) db.run('INSERT INTO channel_members(channel_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', id, m.id);
      audit(ctx, req.user, 'channel.created', 'channel', id, { name, kind });
    });
    return respond(201, { item: db.get('SELECT * FROM channels WHERE id = ?', id) });
  });

  router.post('/api/channels/dm', (req) => {
    const { user_id } = validator(req.body).str('user_id', { required: true }).done();
    if (user_id === req.user.id) throw badRequest('Pick someone else to message.');
    const other = db.get('SELECT id, name FROM users WHERE id = ? AND tenant_id = ?', user_id, req.user.tenant_id);
    if (!other) throw notFound('User');
    const key = [req.user.id, other.id].sort().join(':');
    let c = db.get('SELECT * FROM channels WHERE tenant_id = ? AND dm_key = ?', req.user.tenant_id, key);
    if (!c) {
      const id = uuidv7();
      db.tx(() => {
        db.run(`INSERT INTO channels(id, tenant_id, name, kind, dm_key, created_at) VALUES (?,?,?,'dm',?,?)`, id, req.user.tenant_id, 'dm', key, nowIso());
        db.run('INSERT INTO channel_members(channel_id, user_id) VALUES (?,?), (?,?)', id, req.user.id, id, other.id);
      });
      c = db.get('SELECT * FROM channels WHERE id = ?', id);
    }
    return { item: { ...c, name: other.name } };
  });

  router.get('/api/channels/:id/messages', (req) => {
    const c = loadChannel(req.user, req.params.id);
    const before = req.query.before || '9999';
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const rows = db.all(`SELECT m.*, u.name user_name, u.color user_color FROM messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.channel_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`, c.id, before, limit).reverse();
    return { items: rows, has_more: rows.length === limit };
  });

  router.post('/api/channels/:id/messages', (req) => {
    const c = loadChannel(req.user, req.params.id);
    const { body } = validator(req.body).str('body', { required: true, max: 4000 }).done();
    const msg = { id: uuidv7(), channel_id: c.id, user_id: req.user.id, kind: 'user', body, created_at: nowIso(), user_name: req.user.name, user_color: req.user.color };
    db.run('INSERT INTO messages(id, channel_id, user_id, kind, body, created_at) VALUES (?,?,?,?,?,?)', msg.id, c.id, req.user.id, 'user', body, msg.created_at);
    db.run('UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?', msg.created_at, c.id, req.user.id);
    const members = db.all('SELECT user_id FROM channel_members WHERE channel_id = ?', c.id).map((r) => r.user_id);
    hub.sendMany(members, 'message', msg);
    // @mentions: match "@First" or "@First Last" against channel members' names.
    if (body.includes('@')) {
      const people = db.all(`SELECT u.id, u.name FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.id != ?`, c.id, req.user.id);
      const lower = body.toLowerCase();
      for (const p of people) {
        const first = p.name.split(' ')[0].toLowerCase();
        if (lower.includes('@' + p.name.toLowerCase()) || new RegExp(`@${first}\\b`, 'i').test(body)) {
          notify(ctx, p.id, { type: 'mention', title: `${req.user.name} mentioned you`, body: body.slice(0, 140), link: `#/chat/${c.id}`, dedupeKey: `mention:${msg.id}` });
        }
      }
    } else if (c.kind === 'dm') {
      const other = members.find((id) => id !== req.user.id);
      if (other && !hub.clients.has(other)) notify(ctx, other, { type: 'dm', title: `New message from ${req.user.name}`, body: body.slice(0, 140), link: `#/chat/${c.id}`, dedupeKey: `dm:${msg.id}` });
    }
    return respond(201, { item: msg });
  });

  router.post('/api/channels/:id/read', (req) => {
    const c = loadChannel(req.user, req.params.id);
    db.run('UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?', nowIso(), c.id, req.user.id);
    return { ok: true };
  });

  /* ---------------- Notifications ---------------- */
  router.get('/api/notifications', (req) => {
    const items = db.all('SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.id);
    const unread = db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n;
    return { items, unread };
  });
  router.post('/api/notifications/read-all', (req) => { db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), req.user.id); return { ok: true }; });
  router.post('/api/notifications/:id/read', (req) => {
    const r = db.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', nowIso(), req.params.id, req.user.id);
    if (!r.changes) throw notFound('Notification');
    return { ok: true };
  });
}
