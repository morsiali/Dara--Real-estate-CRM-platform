// Runs the whole test suite against in-process PostgreSQL (PGlite) with row-level security enforced.
// Cross-platform replacement for `DB_BACKEND=pglite npm test` (works in Windows cmd too).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync('tests').filter((f) => f.endsWith('.test.js')).map((f) => `tests/${f}`);
const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=spec', '--test-concurrency=2', ...files],
  { stdio: 'inherit', env: { ...process.env, DB_BACKEND: 'pglite' } });
process.exit(r.status ?? 1);
