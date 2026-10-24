#!/usr/bin/env node
// db-spike.js -- research spike for the feature-map initiative. NOT shipped code.
//
// Question: can the map live in a real database, built from git at one commit and queried by
// SQL, with no dependency outside Node itself (the npm registry is unreachable here)? And does a
// query on that database give the same answer as map-spike.js's in-memory walk?
//
// The database is named by the commit it describes (map-<sha>.db): a database whose name is not
// the asked commit is stale by construction, and the query refuses it rather than answering.
//
// Usage:
//   node db-spike.js build [--rev <rev>] [--out <dir>]      writes <dir>/map-<sha>.db
//   node db-spike.js impact --commit <sha> [--out <dir>]    builds at <sha>^ if needed, SQL replay
//   node db-spike.js search <text> [--rev <rev>] [--out <dir>]   full-text search over edge evidence
'use strict';
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const M = require('./map-spike.js');

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const sha = (rev) => git(['rev-parse', '--verify', `${rev}^{commit}`]);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

const SCHEMA = `
create table meta(key text primary key, value text not null);
create table node(id text primary key, kind text not null, plugin text);
create table feature(id text primary key, kind text not null, plugin text not null);
create table entry(feature text not null references feature(id), node text not null references node(id));
create table edge(src text not null, dst text not null, rel text not null, evidence text not null, commit_sha text not null);
create index edge_src on edge(src);
create index edge_dst on edge(dst);
create table blind(path text not null, reason text not null);
create virtual table evidence_fts using fts5(src, dst, rel, evidence);
`;

function build(rev, outDir) {
  const commit = sha(rev);
  const file = path.join(outDir, `map-${commit}.db`);
  if (fs.existsSync(file)) return { file, commit, reused: true };
  fs.mkdirSync(outDir, { recursive: true });
  const g = M.build(commit);
  const tmp = `${file}.tmp-${process.pid}`;
  const db = new DatabaseSync(tmp);
  db.exec(SCHEMA);
  const ins = (sql) => db.prepare(sql);
  const meta = ins('insert into meta values (?, ?)');
  meta.run('commit', commit);
  meta.run('built_at', new Date().toISOString());
  meta.run('extractor', 'map-spike.js');
  db.exec('begin');
  const n = ins('insert or ignore into node values (?, ?, ?)');
  for (const f of g.snap.files) n.run(f, M.kindOf(f), f.split('/')[1] || null);
  const fe = ins('insert into feature values (?, ?, ?)');
  const en = ins('insert into entry values (?, ?)');
  for (const f of g.feats) { fe.run(f.id, f.kind, f.plugin); for (const e of f.entry) { n.run(e, M.kindOf(e), f.plugin); en.run(f.id, e); } }
  const ed = ins('insert into edge values (?, ?, ?, ?, ?)');
  const fts = ins('insert into evidence_fts values (?, ?, ?, ?)');
  for (const e of g.allEdges) {
    if (e.to.startsWith('pattern:')) n.run(e.to, 'runtime-pattern', null);
    ed.run(e.from, e.to, e.rel, e.evidence, commit);
    fts.run(e.from, e.to, e.rel, e.evidence);
  }
  const bl = ins('insert into blind values (?, ?)');
  for (const d of g.dangling) bl.run(d.to, `referenced by ${d.from} (${d.rel}) but not in git`);
  db.exec('commit');
  db.close();
  fs.renameSync(tmp, file); // atomic: a reader never sees a half-built map
  return { file, commit, reused: false };
}

// Open a map only for the commit asked about: a different commit is refused, never answered.
function open(file, commit) {
  const db = new DatabaseSync(file, { readOnly: true });
  const got = db.prepare("select value from meta where key = 'commit'").get().value;
  if (got !== commit) { db.close(); throw new Error(`stale: map ${got}, asked ${commit}`); }
  return db;
}

// Features reached by a set of changed nodes: walk edges backwards to entry points, in SQL.
const IMPACT_SQL = `
with recursive changed(node) as (select value from json_each(?)),
reach(node, depth) as (
  select node, 0 from changed
  union
  select e.src, r.depth + 1 from edge e join reach r on e.dst = r.node
  where e.rel <> 'documents' and r.depth < 50
)
select distinct en.feature as feature, min(r.depth) as hops
from reach r join entry en on en.node = r.node
group by en.feature order by en.feature`;

function impact(commitArg, outDir) {
  const commit = sha(commitArg);
  const parent = sha(`${commit}^`);
  const { file } = build(parent, outDir);
  const db = open(file, parent);
  const changed = git(['diff', '--name-only', parent, commit, '--', 'plugins']).split('\n').filter(Boolean);
  // runtime reach: a discovered directory name appearing or disappearing
  const before = new Set(git(['ls-tree', '-r', '--name-only', parent, 'plugins']).split('\n'));
  const after = new Set(git(['ls-tree', '-r', '--name-only', commit, 'plugins']).split('\n'));
  const has = (set, dir) => [...set].some((f) => f.startsWith(dir + '/'));
  const patterns = db.prepare("select id from node where kind = 'runtime-pattern'").all().map((r) => r.id);
  const hit = new Set(changed);
  for (const c of changed) {
    const seg = c.split('/');
    for (const p of patterns) {
      const name = p.slice('pattern:'.length, -1);
      const i = seg.indexOf(name);
      if (i < 0) continue;
      const dir = seg.slice(0, i + 1).join('/');
      if (has(before, dir) !== has(after, dir)) hit.add(p);
    }
  }
  const rows = db.prepare(IMPACT_SQL).all(JSON.stringify([...hit]));
  db.close();
  return { mappedAt: parent, commit, changed: changed.length, runtimePatternsHit: [...hit].filter((h) => h.startsWith('pattern:')), featuresReached: rows.length, rows };
}

if (require.main === module) {
  const out = arg('--out', path.join(require('os').tmpdir(), 'feature-map-db'));
  const cmd = process.argv[2];
  if (cmd === 'build') console.log(JSON.stringify(build(arg('--rev', 'HEAD'), out)));
  else if (cmd === 'impact') console.log(JSON.stringify(impact(arg('--commit'), out), null, 2));
  else if (cmd === 'search') {
    const { file, commit } = build(arg('--rev', 'HEAD'), out);
    const db = open(file, commit);
    console.log(JSON.stringify(db.prepare('select src, rel, dst, evidence from evidence_fts where evidence_fts match ? limit 20').all(process.argv[3]), null, 2));
  } else { console.error('usage: build [--rev r] | impact --commit <sha> | search <text>'); process.exit(2); }
}
module.exports = { build, open, impact };
