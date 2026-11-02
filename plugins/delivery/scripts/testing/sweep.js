#!/usr/bin/env node
// sweep.js — remove what the plugin's own test runs left in the host's temp directory.
//   node sweep.js [--dry-run] [--min-age <minutes>] [--json]
//
// A suite run through the sealed runner leaves nothing on the host; a run made around it (node --test
// straight, before the lane refused that) leaves its fixtures in the shared /tmp, and on a server whose
// /tmp is memory-backed they pile up until the disk is full. The owner's rule (dec-chief-of-staff-000014,
// dec-chief-of-staff-000211): the host is never left to a restart or a person to clean, so the watchdog
// runs this every cycle and logs what it removed.
//
// It removes an entry only when every one of these holds, and nothing else, ever:
//   - it sits directly in the temp directory (os.tmpdir() and /tmp), never deeper;
//   - its name is one of the plugin's fixture prefixes followed by mkdtemp's six random characters, the
//     prefixes read at run time from the plugin's own test sources (every hyphen-ended string literal in
//     a *.test.js or scripts/testing/*.js file), so a new test's fixtures are covered without a list to keep;
//   - it is a real directory, not a symlink and not a file;
//   - it belongs to the user running the sweep;
//   - nothing in it has changed for --min-age minutes (60 by default), so a run still in progress is never
//     touched.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const MIN_AGE_MIN = 60;

function sourceFiles(root) {
  const out = [];
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 6) walk(p, depth + 1);
      else if (e.isFile() && (/\.test\.js$/.test(e.name) || (path.basename(d) === 'testing' && /\.js$/.test(e.name)))) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

// one RegExp per fixture prefix; `${...}` inside a template literal stands for any name-safe text
function fixturePatterns(root = PLUGIN_ROOT) {
  const seen = new Set();
  for (const f of sourceFiles(root)) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    for (const m of text.matchAll(/(['"`])([A-Za-z][A-Za-z0-9._]*(?:-[A-Za-z0-9._]*|\$\{[^}`'"]{1,40}\})*-)\1/g)) seen.add(m[2]);
  }
  return [...seen].map((p) => {
    const parts = p.split(/\$\{[^}]*\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^${parts.join('[A-Za-z0-9._-]+')}[A-Za-z0-9]{6}$`);
  });
}

// the newest modification anywhere under dir, bounded: a run still writing keeps it young
function newestChange(dir, limit = 5000) {
  let newest = 0;
  let n = 0;
  const stack = [dir];
  while (stack.length && n < limit) {
    const d = stack.pop();
    let st;
    try { st = fs.lstatSync(d); } catch (e) { continue; }
    newest = Math.max(newest, st.mtimeMs);
    n += 1;
    if (!st.isDirectory()) continue;
    let list;
    try { list = fs.readdirSync(d); } catch (e) { continue; }
    for (const x of list) stack.push(path.join(d, x));
  }
  return n >= limit ? Infinity : newest; // too large to read cheaply: treat as busy, never guess
}

function sweep({ dirs = [...new Set([os.tmpdir(), '/tmp'])], minAgeMin = MIN_AGE_MIN, now = Date.now(), uid = process.getuid ? process.getuid() : null, dryRun = false, patterns = fixturePatterns() } = {}) {
  const removed = [];
  const failed = [];
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      if (!patterns.some((re) => re.test(name))) continue;
      const p = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(p); } catch (e) { continue; }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (uid !== null && st.uid !== uid) continue;
      if (now - newestChange(p) < minAgeMin * 60000) continue;
      if (!dryRun) {
        try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { failed.push({ path: p, error: e.code || e.message }); continue; }
      }
      removed.push(p);
    }
  }
  return { removed, failed };
}

function summary(r, dryRun) {
  if (!r.removed.length && !r.failed.length) return 'sweep: no test leftovers in the temp directory';
  const lines = [`sweep: ${dryRun ? 'would remove' : 'removed'} ${r.removed.length} test leftover(s) from the temp directory${r.removed.length ? `: ${r.removed.map((p) => path.basename(p)).join(' ')}` : ''}`];
  for (const f of r.failed) lines.push(`sweep: could not remove ${f.path} (${f.error})`);
  return lines.join('\n');
}

module.exports = { sweep, fixturePatterns, summary, MIN_AGE_MIN };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--min-age');
  const minAgeMin = i >= 0 ? Number(argv[i + 1]) : MIN_AGE_MIN;
  if (!Number.isFinite(minAgeMin) || minAgeMin < 5) { process.stderr.write('sweep: --min-age must be a number of minutes, at least 5\n'); process.exit(2); }
  const dryRun = argv.includes('--dry-run');
  const r = sweep({ minAgeMin, dryRun });
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(r, null, 2)}\n` : `${summary(r, dryRun)}\n`);
  process.exit(r.failed.length ? 1 : 0);
}
