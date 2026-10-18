// Email adapter. No provider is connected (sending real messages needs operator authorization — Master Prompt A5),
// so the default implementation writes each message to an outbox folder as a .eml file and logs a one-line notice.
// A production adapter (SES, SendGrid, Postmark…) implements the same send({ to, subject, text }) contract.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createOutbox(dir) {
  const sent = [];
  return {
    kind: 'outbox',
    sent,
    async send({ to, subject, text }) {
      const msg = { to, subject, text, at: new Date().toISOString() };
      sent.push(msg);
      if (dir) {
        try {
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${msg.at.replace(/[:.]/g, '-')}-${to.replace(/[^a-z0-9@.]/gi, '_')}.eml`);
          writeFileSync(file, `To: ${to}\nSubject: ${subject}\nDate: ${msg.at}\nContent-Type: text/plain; charset=utf-8\n\n${text}\n`);
          console.log(`[outbox] "${subject}" → ${to} (saved to ${file})`);
        } catch (e) { console.error('[outbox] could not write message', e.message); }
      }
      return { queued: true, delivered: false }; // honest delivery state (C6): queued only
    },
  };
}
