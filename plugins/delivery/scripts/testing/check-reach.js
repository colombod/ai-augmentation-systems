// scripts/testing/check-reach.js — soundness of the syntax map against what really runs: for every node
// process of a coverage run (NODE_V8_COVERAGE=<dir>), every function that executed must be in the
// syntax reach of what that process started from (its test files and the scripts it ran as main).
// A function that ran and is not reached is a link the map misses. Reads only.
//   node scripts/testing/check-reach.js <coverage dir>
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const C = require('../lib/codemap.js');
const S = require('../lib/syntax.js');

(async () => {
  const dir = process.argv[2];
  const parser = await S.loadParser();
  const top = require('child_process').execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const map = C.buildMap(top, 'HEAD');
  const parsed = new Map(Object.entries(map.texts).filter(([f]) => /\.[cm]?js$/.test(f)).map(([f, t]) => [f, S.parseFile(parser, t)]));
  // a start: a test file, a script whose main block ran, or a script that exports nothing (a hook or
  // tool that works as it loads)
  const starts = (f, ran) => f.endsWith('.test.js') || ran.has('<main>') || (!parsed.get(f).exports.size && !parsed.get(f).openExports && !f.includes('/testing/'));
  const lineAt = new Map();
  const lineOf = (f, offset) => {
    if (!lineAt.has(f)) { const at = [0]; const t = map.texts[f]; for (let i = t.indexOf('\n'); i >= 0; i = t.indexOf('\n', i + 1)) at.push(i + 1); lineAt.set(f, at); }
    const at = lineAt.get(f); let lo = 0; let hi = at.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const cache = new Map();
  const missed = new Map();
  let processes = 0; let checked = 0; const ranAll = new Set(); let fromScripts = 0; const scriptRan = new Set(); let skipped = 0; const noStart = new Map();
  for (const name of fs.readdirSync(dir)) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (err) { continue; }
    const ran = new Map(); // file -> Set of symbols that executed
    for (const script of data.result || []) {
      if (!script.url.startsWith('file://')) continue;
      const f = path.relative(top, fileURLToPath(script.url)).split(path.sep).join('/');
      const info = parsed.get(f);
      if (!info) continue;
      if (!ran.has(f)) ran.set(f, new Set());
      for (const fn of script.functions) {
        const outer = fn.ranges[0];
        // block coverage marks what ran inside an executed function: the main block sits in the module's
        if (outer.count > 0 && outer.startOffset === 0) {
          const dead = fn.ranges.slice(1).filter((r) => r.count === 0);
          for (const s of info.spans.filter((x) => x.sym === '<main>')) if (!dead.some((r) => { const a = lineOf(f, r.startOffset); const b = lineOf(f, r.endOffset - 1); return a >= s.from && a <= s.from + 1 && b >= s.to; })) ran.get(f).add('<main>');
          continue;
        }
        if (outer.count > 0) { const sym = S.symbolAt(info, lineOf(f, outer.startOffset)); if (!sym.startsWith('<')) ran.get(f).add(sym); }
      }
    }
    const from = [...ran].filter(([f, r]) => starts(f, r)).map(([f]) => f).sort();
    if (!from.length) { if (ran.size) { skipped++; const k = [...ran.keys()].map((f) => path.basename(f)).sort().slice(0, 3).join(','); noStart.set(k, (noStart.get(k) || 0) + 1); } continue; }
    processes++;
    const script = !from.some((f) => f.endsWith('.test.js'));
    if (script) fromScripts++;
    const key = from.join();
    if (!cache.has(key)) cache.set(key, S.reach(map, parsed, from));
    const reached = cache.get(key);
    for (const [f, syms] of ran) {
      for (const sym of syms) {
        if (sym === '<main>') continue;
        checked++; ranAll.add(`${f}#${sym}`); if (script) scriptRan.add(`${f}#${sym}`);
        const have = reached.get(f);
        if (!have || !(have.has('*') || have.has(sym))) { const k = `${f}#${sym}`; if (!missed.has(k)) missed.set(k, from.slice(0, 3)); }
      }
    }
  }
  console.log(`processes checked ${processes}; executed definitions checked ${checked} (${ranAll.size} distinct); not reached by the syntax map: ${missed.size}`);
  const defined = [...parsed].filter(([f]) => /(^|\/)(scripts|hooks)\//.test(f) && !/\.test\.js$|\/testing\//.test(f)).flatMap(([f, i]) => [...i.uses.keys()].filter((s) => !s.startsWith('<')).map((s) => `${f}#${s}`));
  console.log(`of ${defined.length} product definitions, ${defined.filter((d) => ranAll.has(d)).length} ran; ${defined.filter((d) => scriptRan.has(d)).length} in the ${fromScripts} processes started by a script alone`);
  console.log(`processes with no recognised start (not checked): ${skipped}`, [...noStart].sort((a, b) => b[1] - a[1]).slice(0, 6));
  for (const [k, from] of [...missed].slice(0, 25)) console.log('  MISSED', k, '<- from', from.map((x) => path.basename(x)).join(', '));
})();
