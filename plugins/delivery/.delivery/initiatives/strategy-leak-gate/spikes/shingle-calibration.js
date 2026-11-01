// spike: how many n-word passages from a private plan appear in a public repo's text
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const [plan, pub] = process.argv.slice(2);
const words = (t) => t.toLowerCase().normalize('NFKC').replace(/[`*_#>|\[\]()]/g, ' ').match(/[a-z0-9][a-z0-9'-]*/g) || [];
const files = (dir, re) => execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => re.test(f));
const planFiles = files(plan, /\.(md|txt|json|ya?ml)$/);
const pubFiles = files(pub, /\.(md|txt|py|js|ts|html|ya?ml|json|toml)$/).filter((f) => !/node_modules|\.lock|public\/.*\.json$/.test(f));
const read = (d, f) => { try { const s = fs.readFileSync(path.join(d, f), 'utf8'); return s.length < 2e6 ? s : ''; } catch (e) { return ''; } };
const msgs = execFileSync('git', ['-C', pub, 'log', '--format=%B%x00'], { encoding: 'utf8' }).split('\0');
for (const n of [4, 5, 6, 8, 10]) {
  const sh = new Map();
  for (const f of planFiles) { const w = words(read(plan, f)); for (let i = 0; i + n <= w.length; i++) { const k = w.slice(i, i + n).join(' '); if (!sh.has(k)) sh.set(k, f); } }
  const hits = (text) => { const w = words(text); const out = new Set(); for (let i = 0; i + n <= w.length; i++) { const k = w.slice(i, i + n).join(' '); if (sh.has(k)) out.add(k); } return out; };
  let fileHits = 0; let fileHitN = 0; const ex = [];
  for (const f of pubFiles) { const h = hits(read(pub, f)); if (h.size) { fileHits++; fileHitN += h.size; if (ex.length < 4) ex.push(`${f}: "${[...h][0]}"`); } }
  let msgHits = 0; const mex = [];
  for (const m of msgs) { const h = hits(m); if (h.size) { msgHits++; if (mex.length < 3) mex.push(`"${[...h][0]}"`); } }
  console.log(`n=${n}: plan shingles ${sh.size}; public files with a hit ${fileHits}/${pubFiles.length} (${fileHitN} distinct shingles); commit messages with a hit ${msgHits}/${msgs.length - 1}`);
  for (const e of ex) console.log('   file  ' + e.slice(0, 160)); for (const e of mex) console.log('   msg   ' + e.slice(0, 160));
}
