#!/usr/bin/env node
// scripts/map.js — the feature map: what a repository ships, and what a change reaches, before code.
//   map.js features [--repo <dir>] [--at <ref>] [--json]
//       every feature at the commit, derived (plugin skills, agents, commands, hooks; package bins)
//       and declared (.delivery/features.json), with its anchors
//   map.js impact [--repo <dir>] [--at <ref>] (<path>... | --diff <base> [<head>] | --story <file>) [--json]
//       the features a change reaches: each with the shortest chain from the feature to the changed
//       file, the hop count and file:line evidence for every step; hubs, unreached files and the
//       blind count. --diff maps at <base> (what the change lands on) the files changed in base..head;
//       --story reads the paths in a story's "Files and modules" table.
//   map.js blind [--repo <dir>] [--at <ref>] [--json]   the files no rule reads, by extension
// Every answer names the 40-hex commit it was computed at. Exit codes: 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const C = require('./lib/codemap.js');
const F = require('./lib/features.js');

function parse(argv) {
  const o = { cmd: argv[0], repo: process.cwd(), at: 'HEAD', json: false, paths: [], diff: null, story: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--at') o.at = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--story') o.story = argv[++i];
    else if (a === '--diff') { o.diff = [argv[++i]]; if (argv[i + 1] && !argv[i + 1].startsWith('--')) o.diff.push(argv[++i]); }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.paths.push(a);
  }
  return o;
}

// paths in a story's "Files and modules" section: the first backticked path of each table row
function storyPaths(text) {
  const sec = /^##\s+Files and modules\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text);
  if (!sec) return [];
  return [...sec[1].matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]).filter((p) => !p.includes('...'));
}

function main(argv, { write = (s) => process.stdout.write(s) } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { write(`map.js: ${err.message}\n`); return 2; }
  if (!['features', 'impact', 'blind'].includes(o.cmd)) {
    write('usage: map.js features|impact|blind [--repo <dir>] [--at <ref>] [--json] ...\n');
    return 2;
  }
  const repo = path.resolve(o.repo);
  let map;
  try {
    const base = o.diff ? o.diff[0] : o.at;
    map = C.buildMap(repo, base);
  } catch (err) { write(`map.js: refused: ${err.message}\n`); return 1; }
  const feats = F.featuresOf(map);
  if (o.cmd === 'features') {
    if (o.json) { write(`${JSON.stringify({ sha: map.sha, features: feats, analysed: map.analysed.length, blind: map.blind.length })}\n`); return 0; }
    write(`Features at ${map.sha}: ${feats.length} (${feats.filter((f) => f.source === 'derived').length} derived, ${feats.filter((f) => f.source === 'declared').length} declared); ${map.analysed.length} files analysed, ${map.blind.length} blind (map.js blind lists them)\n`);
    for (const f of feats) write(`  ${f.id} (${f.kind})  ${f.anchors.join(', ')}${f.dangling && f.dangling.length ? `  dangling: ${f.dangling.join(', ')}` : ''}\n`);
    if (!feats.some((f) => f.source === 'declared')) write(`No declared features: name what you ship in ${F.REGISTER} ({"features": [{"id", "name", "anchors": [...]}]}).\n`);
    return 0;
  }
  if (o.cmd === 'blind') {
    const by = {};
    for (const f of map.blind) { const e = path.posix.extname(f) || path.posix.basename(f); (by[e] = by[e] || []).push(f); }
    if (o.json) { write(`${JSON.stringify({ sha: map.sha, blind: map.blind })}\n`); return 0; }
    write(`Blind at ${map.sha}: ${map.blind.length} of ${map.files.length} files (no rule reads them)\n`);
    for (const [e, fs_] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) write(`  ${e}: ${fs_.length}\n`);
    return 0;
  }
  // impact
  let paths = o.paths;
  if (o.story) {
    let text;
    try { text = fs.readFileSync(path.resolve(o.story), 'utf8'); } catch (err) { write(`map.js: refused: cannot read ${o.story}\n`); return 1; }
    paths = paths.concat(storyPaths(text));
  }
  if (o.diff) {
    let head;
    try { head = C.resolveCommit(repo, o.diff[1] || o.at); } catch (err) { write(`map.js: refused: ${err.message}\n`); return 1; }
    const out = require('child_process').spawnSync('git', ['diff', '--name-only', '--no-renames', map.sha, head], { cwd: repo, encoding: 'utf8' });
    if (out.status !== 0) { write(`map.js: refused: git diff failed: ${out.stderr.trim()}\n`); return 1; }
    paths = paths.concat(out.stdout.split('\n').filter(Boolean));
  }
  if (!paths.length) { write('map.js: impact needs paths, --diff or --story\n'); return 2; }
  const r = F.impact(map, feats, paths);
  if (o.json) { write(`${JSON.stringify(r)}\n`); return 0; }
  write(`Impact at ${r.sha} of ${r.changed.length} changed file${r.changed.length === 1 ? '' : 's'}: ${r.reached.length} of ${r.features} features reached\n`);
  for (const f of r.reached) {
    write(`  ${f.id} (${f.kind}, ${f.source}), ${f.hops} hop${f.hops === 1 ? '' : 's'}\n`);
    const v = f.via[0];
    if (v.chain.length) for (const s of v.chain) write(`      ${s.from}:${s.line} -> ${s.to} (${s.kind})\n`);
    else write(`      ${v.path} is the feature's own file\n`);
    if (f.via.length > 1) write(`      and ${f.via.length - 1} more changed file${f.via.length > 2 ? 's' : ''}: ${f.via.slice(1).map((x) => x.path).join(', ')}\n`);
  }
  for (const h of r.hubs) write(`Hub: ${h.path} is reached by ${h.features} features; a change there reaches most of the product.\n`);
  for (const u of r.unreached) write(`Unreached: ${u.path}${u.blind ? ' (blind: no rule reads its kind of file)' : ': no feature reaches it (dead code, an undeclared feature, or a reference no rule reads)'}\n`);
  for (const u of r.unknown) write(`Not in the commit: ${u}${o.story ? ' (a new file reaches nothing yet)' : ''}\n`);
  for (const a of r.ambiguous) write(`Ambiguous: ${a.path} matches ${a.candidates.join(', ')}\n`);
  write(`Blind spots: ${r.blind} of ${r.analysed + r.blind} files are read by no rule; reach through them is not seen (map.js blind).\n`);
  return 0;
}

module.exports = { main, storyPaths };
if (require.main === module) process.exit(main(process.argv.slice(2)));
