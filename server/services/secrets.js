// Field-level encryption for Restricted data (C13), e.g. two-step sign-in secrets. AES-256-GCM.
// Key: DARA_SECRET_KEY (base64, 32 bytes). In development a key file is created under ./data; in production the
// key must come from the environment / secrets manager or the server refuses to start encryption.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let KEY = null;
function key() {
  if (KEY) return KEY;
  if (process.env.DARA_SECRET_KEY) {
    KEY = Buffer.from(process.env.DARA_SECRET_KEY, 'base64');
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('DARA_SECRET_KEY is required in production (32 random bytes, base64).');
  } else if (process.env.NODE_TEST_CONTEXT || process.env.DARA_EPHEMERAL_KEY) {
    KEY = randomBytes(32); // tests: per-process key
  } else {
    const file = resolve(process.env.SECRET_KEY_FILE || './data/.secret_key');
    if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 }); }
    KEY = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  }
  if (KEY.length !== 32) throw new Error('DARA_SECRET_KEY must decode to 32 bytes.');
  return KEY;
}

export function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('unknown ciphertext version');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
