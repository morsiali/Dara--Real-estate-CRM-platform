// Two-step sign-in: RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) and one-time recovery codes. node:crypto only.
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20));

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const counterAt = (ms = Date.now(), step = 30) => Math.floor(ms / 1000 / step);
export const totp = (secret, ms = Date.now()) => hotp(secret, counterAt(ms));

/**
 * Verifies a code within ±window steps. Returns the matched counter (store it to block replay) or null.
 * lastCounter: the last accepted counter for this user — codes at or before it are rejected (RFC 6238 §5.2).
 */
export function verifyTotp(secret, code, { ms = Date.now(), window = 1, lastCounter = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = counterAt(ms);
  for (let d = -window; d <= window; d++) {
    const ctr = now + d;
    if (ctr <= lastCounter) continue;
    const expected = Buffer.from(hotp(secret, ctr));
    if (timingSafeEqual(expected, Buffer.from(c))) return ctr;
  }
  return null;
}

export function otpauthUri(secret, account, issuer = 'Dara') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ---------- Recovery codes: shown once, stored as SHA-256 hashes, each usable once ---------- */
const hashCode = (c) => createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
export function generateRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}
/** Returns the remaining hashes if `code` matched one (consuming it), else null. */
export function consumeRecoveryCode(hashes, code) {
  const h = hashCode(code);
  const i = (hashes || []).indexOf(h);
  if (i < 0) return null;
  return hashes.filter((_, k) => k !== i);
}
