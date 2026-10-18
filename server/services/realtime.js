// Server-Sent Events hub: pushes chat messages, notifications and presence to connected users.
export class RealtimeHub {
  constructor() { this.clients = new Map(); /* userId -> Set<res> */ this.tenantOf = new Map(); this.onPresence = null; }
  connect(user, req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    this.tenantOf.set(user.id, user.tenant_id);
    let set = this.clients.get(user.id);
    const wasOffline = !set || set.size === 0;
    if (!set) { set = new Set(); this.clients.set(user.id, set); }
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    if (wasOffline) this.broadcastTenant(user.tenant_id, 'presence', { userId: user.id, online: true });
    const close = () => {
      clearInterval(ping);
      set.delete(res);
      if (set.size === 0) { this.clients.delete(user.id); this.broadcastTenant(user.tenant_id, 'presence', { userId: user.id, online: false }); this.onPresence?.(user.id); }
    };
    req.on('close', close);
  }
  online() { return [...this.clients.keys()]; }
  send(userId, event, data) {
    const set = this.clients.get(userId);
    if (!set) return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(payload);
    return set.size;
  }
  sendMany(userIds, event, data) { for (const id of new Set(userIds)) this.send(id, event, data); }
  broadcastTenant(tenantId, event, data) {
    for (const [uid] of this.clients) if (this.tenantOf.get(uid) === tenantId) this.send(uid, event, data);
  }
  closeAll() { for (const set of this.clients.values()) for (const res of set) res.end(); this.clients.clear(); }
}
