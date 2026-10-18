// Authentication: scrypt password hashing, opaque session tokens (stored hashed), login throttling.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { nowIso } from './db.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'dara_sid';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export const passwordPolicy = (pw) => typeof pw === 'string' && pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const tokenHash = sha;

export function createSession(db, userId, ttlHours) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  db.run('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', sha(token), userId, expires, nowIso());
  return { token, expires };
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.get(
    `SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
  if (!row) return null;
  if (row.expires_at < nowIso() || !row.active) { db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token)); return null; }
  return row;
}

export function destroySession(db, token) { if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token)); }

export function cookieHeader(token, expires, secure) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
export const clearCookieHeader = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/** Sliding-window login throttle: 8 failures per 15 minutes per (ip,email). In-memory: resets on restart. */
export class LoginThrottle {
  constructor(max = 8, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  key(ip, email) { return `${ip}|${String(email).toLowerCase()}`; }
  check(ip, email) {
    const k = this.key(ip, email); const now = Date.now();
    const hits = (this.map.get(k) || []).filter((t) => now - t < this.windowMs);
    this.map.set(k, hits);
    if (hits.length >= this.max) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait 15 minutes and try again.');
  }
  fail(ip, email) { const k = this.key(ip, email); this.map.set(k, [...(this.map.get(k) || []), Date.now()]); }
  reset(ip, email) { this.map.delete(this.key(ip, email)); }
}
