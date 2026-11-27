// scripts/testing/compare-reach.js — experiment: today's file-level reach against syntax-level reach on
// past changes, with today's declared features applied at each commit. Reads git; writes nothing.
//   node scripts/testing/compare-reach.js [<tip commit>] [<count>]
const cp = require('child_process');
const path = require('path');
const C = require('../lib/codemap.js');
const F = require('../lib/features.js');
const S = require('../lib/syntax.js');

(async () => {
  const [tip = '0788324', count = '30'] = process.argv.slice(2);
  const parser = await S.loadParser();
  const repo = cp.execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const git = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const paths = ['scripts', 'skills', 'agents', 'hooks', 'templates'].map((p) => `plugins/delivery/${p}`);
  const shas = git('log', '--first-parent', `-${count}`, '--format=%H', tip, '--', ...paths).trim().split('\n');
  const today = F.featuresOf(C.buildMap(repo, tip)).filter((f) => f.kind === 'declared');
  const cache = new Map();
  const parse = (text) => { if (!cache.has(text)) cache.set(text, S.parseFile(parser, text)); return cache.get(text); };
  const rows = [];
  const edges = { regexOnly: new Set(), treeOnly: new Set() };
  for (const sha of shas) {
    const status = git('diff', '--name-status', '--no-renames', `${sha}^`, sha, '--', ...paths).trim().split('\n').map((l) => l.split('\t')).filter(([s, p]) => p && s !== 'D' && !/\.test\./.test(p));
    if (!status.length) continue;
    const map = C.buildMap(repo, sha);
    const have = new Set(map.files);
    const parsed = new Map(Object.entries(map.texts).filter(([f]) => C.langOf(f) === 'js' && /\.[cm]?js$/.test(f)).map(([f, t]) => [f, parse(t)]));
    const feats = today.map((f) => ({ ...f, anchors: [...new Set((f.specs || []).flatMap((s) => (/[*]/.test(s) ? map.files.filter((x) => F.globRe(s).test(x)) : have.has(s) ? [s] : [])))] }));
    const changes = status.map(([s, file]) => {
      if (s !== 'M' || !parsed.has(file)) return [file, null];
      const before = parse(git('show', `${sha}^:${file}`));
      const oldLines = [];
      const newLines = [];
      for (const m of git('diff', '-U0', `${sha}^`, sha, '--', file).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
        for (let i = 0; i < Number(m[2] === undefined ? 1 : m[2]); i++) oldLines.push(Number(m[1]) + i);
        for (let i = 0; i < Number(m[4] === undefined ? 1 : m[4]); i++) newLines.push(Number(m[3]) + i);
      }
      return [file, S.changedSymbols(before, parsed.get(file), oldLines, newLines)];
    });
    const now = F.impact(map, feats, changes.map((c) => c[0])).reached.map((f) => f.id);
    const tree = feats.filter((f) => f.anchors.length).filter((f) => { const r = S.reach(map, parsed, f.anchors); return changes.some(([file, syms]) => S.touches(r, file, syms)); }).map((f) => f.id);
    rows.push({ sha: sha.slice(0, 7), files: changes.length, now, tree, changes });
    // file-level links each method sees, for the same files
    if (sha === shas[0]) {
      for (const [f, info] of parsed) {
        const regex = new Set((map.edges.get(f) || []).filter((e) => e.kind === 'require' || e.kind === 'import').map((e) => e.to));
        const syntax = new Set([...info.uses.values()].flat().filter((u) => u.spec).map((u) => S.resolveSpec(have, f, u.spec)).filter(Boolean));
        for (const t of regex) if (!syntax.has(t)) edges.regexOnly.add(`${f} -> ${t}`);
        for (const t of syntax) if (!regex.has(t)) edges.treeOnly.add(`${f} -> ${t}`);
      }
    }
  }
  const stat = (k) => `>=50%: ${rows.filter((r) => r[k].length >= 4).length}  8/8: ${rows.filter((r) => r[k].length === 8).length}  none: ${rows.filter((r) => !r[k].length).length}`;
  console.log(`changes ${rows.length}\nnow   ${stat('now')}\ntree  ${stat('tree')}`);
  console.log('sha     files now tree  symbols changed (first file)');
  for (const r of rows) console.log(r.sha, String(r.files).padStart(4), String(r.now.length).padStart(4), String(r.tree.length).padStart(4), ' ', r.changes.slice(0, 2).map(([f, s]) => `${path.basename(f)}:${s === null ? 'all' : [...s].slice(0, 4).join('|') || 'comments'}`).join(' ').slice(0, 110));
  console.log('features tree adds that now lacks:', rows.flatMap((r) => r.tree.filter((x) => !r.now.includes(x)).map((x) => `${r.sha}:${x}`)));
  console.log('file links only the regex sees:', edges.regexOnly.size, [...edges.regexOnly].slice(0, 8));
  console.log('file links only the syntax tree sees:', edges.treeOnly.size, [...edges.treeOnly].slice(0, 8));
})();
