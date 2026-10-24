#!/usr/bin/env node
// sweep.js -- research spike: run map-spike's impact over the last N commits and measure how
// often the runtime-reach relation fires, so its noise is a number rather than a guess.
// Usage: node sweep.js [N]
'use strict';
const { execFileSync } = require('child_process');
const M = require('./map-spike.js');
const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const N = Number(process.argv[2] || 150);
const shas = git(['log', '--no-merges', '--format=%h', `-${N}`, '--', 'plugins']).split('\n').filter(Boolean);
const rows = [];
for (const sha of shas) {
  let parent; try { parent = git(['rev-parse', `${sha}^`]).trim(); } catch { continue; }
  const changed = git(['show', '--name-only', '--format=', sha]).split('\n').filter(Boolean);
  const afterFiles = git(['ls-tree', '-r', '--name-only', sha, 'plugins']).split('\n');
  const after = (dir) => afterFiles.some((f) => f.startsWith(dir + '/'));
  const g = M.build(parent);
  const r = M.impact(g, changed, after);
  const runtime = r.filter((x) => x.via.startsWith('pattern:'));
  const subj = git(['log', '-1', '--format=%s', sha]).trim().slice(0, 70);
  rows.push({ sha, changed: changed.length, features: r.length, runtime: runtime.length, runtimeWhy: [...new Set(runtime.map((x) => x.why))], subj });
}
const fired = rows.filter((r) => r.runtime);
console.log(JSON.stringify({ commits: rows.length, runtimeFired: fired.length, fired, featuresPerCommit: rows.map((r) => r.features).sort((a, b) => a - b) }, null, 1));
