#!/usr/bin/env node
// scripts/testing/fake-gh.js — a fake `gh` for tests: `pr view <n|url> --json ...`, `run list --branch <b>` and `pr merge <n|url>
// --match-head-commit <sha>`, over the JSON file named in GH_FAKE_STORE ({ repo: "owner/name", prs:
// { "<n>": view } }). Like gh outside a checkout of the product, it needs -R (or a URL target) naming
// that repository and fails on any other. Without the store it fails the way a signed-out gh does.
// Never used in production.
const fs = require('fs');

const store = process.env.GH_FAKE_STORE;
const fail = (msg) => { process.stderr.write(`${msg}\n`); process.exit(1); };
if (!store || !fs.existsSync(store)) fail('gh: not logged in to any hosts (fake)');
const s = JSON.parse(fs.readFileSync(store, 'utf8'));
// GH_FAKE_LOG: each call appends its arguments, so a test can count the calls that reached gh
if (process.env.GH_FAKE_LOG) fs.appendFileSync(process.env.GH_FAKE_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
// GH_FAKE_DELAY_MS: a slow GitHub, so concurrent callers overlap
if (process.env.GH_FAKE_DELAY_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.GH_FAKE_DELAY_MS));
const argv = process.argv.slice(2);
let repo = null;
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-R' || argv[i] === '--repo') repo = argv[++i];
  else if (argv[i].startsWith('--repo=')) repo = argv[i].slice(7);
  else args.push(argv[i]);
}
const [group, cmd, target] = args;
if (group === 'run' && cmd === 'list') {
  // `run list -R <repo> --branch <b> --json ...`: the store's runs on that branch, newest first
  if (!repo) fail('failed to run git: fatal: not a git repository (or any of the parent directories): .git');
  if (String(repo).toLowerCase() !== String(s.repo).toLowerCase()) fail(`GraphQL: Could not resolve to a Repository with the name '${repo}'.`);
  const b = args.indexOf('--branch');
  const runs = (s.runs || []).filter((r) => b < 0 || (r.headBranch || 'main') === args[b + 1]);
  process.stdout.write(`${JSON.stringify(runs)}\n`);
  process.exit(0);
}
if (group !== 'pr' || !['view', 'merge'].includes(cmd)) fail(`fake gh: unsupported ${args.join(' ')}`);
const url = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(target || '');
if (url) repo = url[1];
if (!repo) fail('failed to run git: fatal: not a git repository (or any of the parent directories): .git');
if (String(repo).toLowerCase() !== String(s.repo).toLowerCase()) fail(`GraphQL: Could not resolve to a Repository with the name '${repo}'.`);
const n = url ? url[2] : target;
const pr = s.prs && s.prs[n];
if (!pr) fail(`GraphQL: Could not resolve to a PullRequest with the number of ${n}.`);
// written synchronously: process.exit would cut an asynchronous write to a pipe short
if (cmd === 'view') { fs.writeSync(1, `${JSON.stringify({ number: Number(n), state: 'OPEN', ...pr })}\n`); process.exit(0); }
const at = args.indexOf('--match-head-commit');
if (at >= 0 && args[at + 1] !== pr.headRefOid) fail('Head branch was modified. Review and try the merge again.');
pr.state = 'MERGED';
fs.writeFileSync(store, JSON.stringify(s, null, 2));
process.stdout.write(`✓ Merged pull request #${n}\n`);
