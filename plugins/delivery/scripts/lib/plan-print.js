// scripts/lib/plan-print.js — the private plan's fingerprint, for the strategy leak gate.
// The owner's ask (2026-10-31): nothing of the plan, strategy or IP kept in the private repository may
// reach the public product repository's commits, pull requests, comments or issues; "do not make strong
// promises you will fail". So the gate catches what text matching can catch, and says so:
//   - exact terms: the denylist materialise writes, plus .delivery/team/leak-extras.txt (customer names,
//     codenames, pricing words the owner adds);
//   - copied passages: every 8-word run of the plan's text files (.delivery/**), hashed with a private
//     salt. 8 words, from the calibration spike on the Vault (spikes/shingle-calibration.md): shorter runs
//     match paths, number runs and common English. A run with fewer than 5 words of three letters or more
//     is dropped for the same reason.
// Paraphrase is not caught, and the docs say so. .delivery/team/leak-allow.txt lists what is public by
// design (the product's name, a public customer, a sentence meant for the README): its terms leave the
// term list and its passages leave the fingerprint.
// The fingerprint is rebuilt when any plan file is newer than it, so nobody runs a command to keep it fresh.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const N = 8;
// The fingerprint and its salt are local state, never committed: .delivery/cache/leak/ carries its own
// .gitignore. The extras and the allowlist are the owner's, tracked with the plan.
const CACHE = path.join('.delivery', 'cache', 'leak');
const FILE = path.join(CACHE, 'fingerprint.json');
const SALT = path.join(CACHE, 'salt');
const EXTRAS = path.join('.delivery', 'team', 'leak-extras.txt');
const ALLOW = path.join('.delivery', 'team', 'leak-allow.txt');
const TEXT = /\.(md|mdx|txt|json|ya?ml|toml|csv|dot)$/i;
// generated or bulky records that hold no prose of the plan, and the gate's own files
const SKIP_DIRS = new Set(['watchdog', 'artifacts', 'cache', 'node_modules', '.git']);
const OWN = new Set([FILE, SALT].map((p) => p.split(path.sep).join('/')));
const MAX_FILE = 2 * 1024 * 1024;

const words = (t) => String(t || '').normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
const meaningful = (ws) => ws.filter((w) => /\p{L}{3}/u.test(w)).length >= 5;

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch (err) { return []; }
}

// every text file under <root>/.delivery, as paths relative to root, with its mtime
function planFiles(root) {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (!e.isFile() || !TEXT.test(e.name) || OWN.has(rel)) continue;
      let st;
      try { st = fs.statSync(p); } catch (err) { continue; }
      if (st.size <= MAX_FILE) out.push({ rel, abs: p, mtime: st.mtimeMs });
    }
  };
  walk(path.join(root, '.delivery'));
  return out;
}

function ensureCache(root) {
  const dir = path.join(root, CACHE);
  fs.mkdirSync(dir, { recursive: true });
  const ig = path.join(dir, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
}

function salt(root) {
  const f = path.join(root, SALT);
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch (err) { /* make one */ }
  const s = crypto.randomBytes(16).toString('hex');
  try { ensureCache(root); fs.writeFileSync(f, `${s}\n`); } catch (err) { /* unwritable: a salt for this run only */ }
  return s;
}

// Fenced code in a Markdown plan is mostly the product's own code quoted back; fingerprinting it would
// refuse a builder who touches that code. The prose around it is what is private.
const prose = (rel, text) => (/\.mdx?$/i.test(rel) ? text.replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, ' ') : text);

const hashOf = (s, gram) => crypto.createHash('sha256').update(`${s}\n${gram}`).digest('hex').slice(0, 16);

function* grams(ws) {
  for (let i = 0; i + N <= ws.length; i++) {
    const g = ws.slice(i, i + N);
    if (meaningful(g)) yield g.join(' ');
  }
}

// Build the fingerprint now: { salt, n, built, shingles: { hash: source }, terms, allow }
function build(root, { now = Date.now() } = {}) {
  const s = salt(root);
  const allowLines = readLines(path.join(root, ALLOW));
  const allowed = new Set();
  for (const l of allowLines) for (const g of grams(words(l))) allowed.add(hashOf(s, g));
  const shingles = {};
  for (const f of planFiles(root)) {
    let text = '';
    try { text = fs.readFileSync(f.abs, 'utf8'); } catch (err) { continue; }
    for (const g of grams(words(prose(f.rel, text)))) {
      const h = hashOf(s, g);
      if (!allowed.has(h) && !(h in shingles)) shingles[h] = f.rel;
    }
  }
  const allowTerms = new Set(allowLines.map((l) => l.toLowerCase()));
  const terms = readLines(path.join(root, EXTRAS)).filter((t) => !allowTerms.has(t.toLowerCase()));
  return { salt: s, n: N, built: now, shingles, terms, allow: [...allowTerms] };
}

// The fingerprint, rebuilt when a plan file is newer than it or it is missing. Never throws: a project
// without .delivery gets an empty fingerprint.
function load(root, { now = Date.now() } = {}) {
  if (!fs.existsSync(path.join(root, '.delivery'))) return { salt: '', n: N, built: now, shingles: {}, terms: [], allow: [] };
  const f = path.join(root, FILE);
  let fp = null;
  try { fp = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { fp = null; }
  const newest = Math.max(0, ...planFiles(root).map((x) => x.mtime), ...[EXTRAS, ALLOW].map((p) => { try { return fs.statSync(path.join(root, p)).mtimeMs; } catch (err) { return 0; } }));
  if (fp && fp.n === N && fp.built >= newest) return fp;
  fp = build(root, { now: Math.max(now, newest) });
  try { ensureCache(root); fs.writeFileSync(f, `${JSON.stringify(fp)}\n`); } catch (err) { /* unwritable: use it in memory */ }
  return fp;
}

// The first copied passage in text: { words, source } or null
function passage(text, fp) {
  if (!fp || !fp.shingles) return null;
  for (const g of grams(words(text))) {
    const src = fp.shingles[hashOf(fp.salt, g)];
    if (src) return { words: g, source: src };
  }
  return null;
}

module.exports = { N, FILE, SALT, EXTRAS, ALLOW, words, build, load, passage, planFiles, hashOf };
