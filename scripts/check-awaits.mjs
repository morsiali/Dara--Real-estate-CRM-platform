// Dev check: flags calls to async functions that are not awaited/returned (a missing await on a permission
// check would silently pass). Heuristic, line-based; prints candidates for review. Exit 1 if any found.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['server', 'tests'];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
roots.forEach(walk);
const names = new Set(['postSystemMessage', 'sweep', 'sweepReservations', 'withContext', 'asSystem', 'tx', 'migrateUp', 'migrateDown', 'tableExists']);
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/async function (\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let) (\w+) = async\b/g)) names.add(m[1]);
}
['describe', 'test', 'before', 'after', 'fn', 'as', 'run', 'get', 'all', 'call', 'login', 'send'].forEach((n) => names.delete(n));
let bad = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const n of names) {
      const re = new RegExp(`(^|[^\\w.$])${n}\\(`, 'g');
      let m;
      while ((m = re.exec(line))) {
        const before = line.slice(0, m.index + m[1].length);
        if (/(await\s*\(?|return|function|async|=>|Promise\.all\(|\.map\(|\.then\(|safely\()\s*$/.test(before)) continue;
        if (/(async function|const \w+ = async|let \w+ = async)/.test(line) && line.indexOf(n) > line.search(/async/)) { if (/^\s*(export )?(async function|const|let)/.test(line) && before.trim().endsWith(n) === false && /\b(function|const|let)\s+$/.test(before)) continue; }
        if (/^\s*(export\s+)?async\s+function\s+\w+\(/.test(line) && line.indexOf(`function ${n}(`) >= 0) continue;
        if (/\/\//.test(before)) continue;
        console.log(`${f}:${i + 1}: ${n}( — ${line.trim().slice(0, 140)}`); bad++;
      }
    }
  });
}
console.log(bad ? `\n${bad} possible missing await(s).` : 'No missing awaits found.');
process.exit(bad ? 1 : 0);
