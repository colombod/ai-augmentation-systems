#!/usr/bin/env node
// scripts/map.js — the feature map: what a repository ships, and what a change reaches, before code.
//   map.js features [--repo <dir>] [--at <ref>] [--json]
//       every feature at the commit, derived (plugin skills, agents, commands, hooks; package bins)
//       and declared (.delivery/features.json), with its anchors
//   map.js impact [--repo <dir>] [--at <ref>] (<path>... | --diff <base> [<head>] | --story <file>) [--all] [--json]
//       the features a change reaches: each with the shortest chain from the feature to the changed
//       file, the hop count and file:line evidence for every step; hubs, unreached files and the
//       blind count. --diff maps at <base> (what the change lands on) the files changed in base..head;
//       --story reads the paths in a story's "Files and modules" table.
//   map.js blind [--repo <dir>] [--at <ref>] [--json]   the files no rule reads, by extension
//   map.js retire <feature-id> [--repo <dir>] [--at <ref>] [--json]
//       what retiring a feature frees: the files only it reaches (deletable with it) and the files other
//       features reach too (retire the surface, keep the code); never a verdict on use or a deletion
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
    else if (a === '--all') o.all = true;
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
  // a row the story only reads (its action says read, reference, see or unchanged and names no change)
  // is context, not a change: counting it made a story reach 28 features instead of 17
  const READ = /\b(read|reads|reference|references|refer|see|context|unchanged|consult)\b/i;
  const CHANGE = /\b(modify|change|edit|create|add|delete|remove|rename|move|update|fix|replace|write|extend)\b/i;
  return [...sec[1].matchAll(/^\|\s*`([^`]+)`\s*\|([^|\n]*)/gm)]
    .filter((m) => !(READ.test(m[2]) && !CHANGE.test(m[2])))
    .map((m) => m[1]).filter((p) => !p.includes('...'));
}

function main(argv, { write = (s) => process.stdout.write(s) } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { write(`map.js: ${err.message}\n`); return 2; }
  if (!['features', 'impact', 'blind', 'retire'].includes(o.cmd)) {
    write('usage: map.js features|impact|blind|retire [--repo <dir>] [--at <ref>] [--json] ...\n');
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
  if (o.cmd === 'retire') {
    if (o.paths.length !== 1) { write('map.js: retire needs one feature id (map.js features lists them)\n'); return 2; }
    const r = F.retirement(map, feats, o.paths[0]);
    if (r.error) { write(o.json ? `${JSON.stringify(r)}\n` : `map.js: refused: ${r.error}\n`); return 1; }
    if (o.json) { write(`${JSON.stringify(r)}\n`); return 0; }
    write(`Retiring ${r.id} (${r.kind}, ${r.source}) at ${r.sha}: ${r.exclusive.length} file${r.exclusive.length === 1 ? '' : 's'} only it reaches, ${r.shared.length} shared\n`);
    write('  Deletable with it (no other feature reaches them):\n');
    for (const p of r.exclusive) write(`    ${p}\n`);
    if (r.shared.length) write('  Shared (retire the surface, keep the code):\n');
    for (const x of r.shared) write(`    ${x.path}  also reached by ${x.features.length > 3 ? `${x.features.slice(0, 3).join(', ')} and ${x.features.length - 3} more` : x.features.join(', ')}\n`);
    write('The map shows reach, not use. Before retiring, show from the product\'s own logs that the feature is no longer used; with no logs, instrument it first and decide later. Deleting is irreversible: it is the owner\'s decision, recorded (/delivery:decision), never inferred.\n');
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
    var headSha = head;
  }
  if (!paths.length) { write('map.js: impact needs paths, --diff or --story\n'); return 2; }
  const r = F.impact(map, feats, paths);
  // Files the change adds are not at the base: map them at the head, where they exist, so a new file
  // a feature reaches is reached, not reported "not in the commit" (found on the Vault, 92d8452).
  if (o.diff && r.unknown.length && headSha && headSha !== map.sha) {
    const headMap = C.buildMap(repo, headSha);
    const added = F.impact(headMap, F.featuresOf(headMap), r.unknown);
    const byId = new Map(r.reached.map((f) => [f.id, f]));
    for (const f of added.reached) {
      const have = byId.get(f.id);
      if (!have) { byId.set(f.id, { ...f, added: true }); continue; }
      have.via.push(...f.via);
      have.hops = Math.min(have.hops, f.hops);
    }
    r.reached = [...byId.values()].sort((a, b) => a.hops - b.hops || a.id.localeCompare(b.id));
    r.changed = r.changed.concat(added.changed);
    r.added = added.changed;
    r.unknown = added.unknown;
    r.unreached = r.unreached.concat(added.unreached);
  }
  if (o.json) { write(`${JSON.stringify(r)}\n`); return 0; }
  write(`Impact at ${r.sha} of ${r.changed.length} changed file${r.changed.length === 1 ? '' : 's'}: ${r.reached.length} of ${r.features} features reached\n`);
  // nearest first; past NEAR hops a reach is real but indirect: counted, and listed with --all
  const NEAR = 2;
  const throughHub = o.all ? [] : r.reached.filter((f) => f.viaHub);
  const shown = o.all ? r.reached : r.reached.filter((f) => !f.viaHub && f.hops <= NEAR);
  for (const f of shown) {
    write(`  ${f.id} (${f.kind}, ${f.source}), ${f.hops} hop${f.hops === 1 ? '' : 's'}\n`);
    const v = f.via[0];
    if (v.chain.length) for (const s of v.chain) write(`      ${s.from}:${s.line} -> ${s.to} (${s.kind})\n`);
    else write(`      ${v.path} is the feature's own file\n`);
    if (f.via.length > 1) write(`      and ${f.via.length - 1} more changed file${f.via.length > 2 ? 's' : ''}: ${f.via.slice(1).map((x) => x.path).join(', ')}\n`);
  }
  if (throughHub.length) {
    const hubs = [...new Set(throughHub.map((f) => f.viaHub))];
    write(`  and ${throughHub.length} reached only through shared hub file${hubs.length > 1 ? 's' : ''} ${hubs.join(', ')}: ${throughHub.slice(0, 6).map((f) => f.id).join(', ')}${throughHub.length > 6 ? ', ...' : ''}\n`);
  }
  const far = o.all ? [] : r.reached.filter((f) => !f.viaHub && f.hops > NEAR);
  if (far.length) {
    write(`  and ${far.length} more, ${NEAR + 1} to ${far[far.length - 1].hops} hops away: ${far.slice(0, 8).map((f) => f.id).join(', ')}${far.length > 8 ? ', ...' : ''} (--all lists them with their chains)\n`);
  }
  for (const h of r.hubs) write(`Hub: ${h.path} is reached by ${h.features} features; a change there reaches most of the product.\n`);
  for (const u of r.unreached) write(`Unreached: ${u.path}${u.blind ? ' (blind: no rule reads its kind of file)' : ': no feature reaches it (dead code, an undeclared feature, or a reference no rule reads)'}\n`);
  for (const u of r.unknown) write(`Not in the commit: ${u}${o.story ? ' (a new file reaches nothing yet)' : ''}\n`);
  for (const a of r.ambiguous) write(`Ambiguous: ${a.path} matches ${a.candidates.join(', ')}\n`);
  write(`Blind spots: ${r.blind} of ${r.analysed + r.blind} files are read by no rule; reach through them is not seen (map.js blind).\n`);
  return 0;
}

module.exports = { main, storyPaths };
// exitCode, not exit(): exit() drops output still queued for a pipe (a large --json was cut at 64 KB)
if (require.main === module) {
  // a reader that stops early (| head) is not an error
  process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); throw err; });
  process.exitCode = main(process.argv.slice(2));
}
