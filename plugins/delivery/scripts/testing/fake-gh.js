#!/usr/bin/env node
// scripts/testing/fake-gh.js — a fake `gh` for tests: `pr view <n|url> --json ...`, `run list --branch <b>` and `pr merge <n|url>
// --match-head-commit <sha>`, over the JSON file named in GH_FAKE_STORE ({ repo: "owner/name", prs:
// { "<n>": view } }). Like gh outside a checkout of the product, it needs -R (or a URL target) naming
// that repository and fails on any other. Without the store it fails the way a signed-out gh does.
// With rest_only in the store, GraphQL commands fail with the cloud's 403 and `api` serves the
// REST endpoints from the same store. Never used in production.
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
// rest_only in the store: GraphQL is refused the way Claude Code's cloud sessions refuse it, and the
// REST endpoints the plugin reads (and the merge endpoint) answer from the same store
if (s.rest_only && group !== 'api' && !(group === 'run' && cmd === 'list')) fail('HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...). (https://api.github.com/graphql)');
if (group === 'api') {
  let method = null;
  let endpoint = null;
  const fields = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = String(args[++i]).toUpperCase();
    else if (['-f', '-F', '--field', '--raw-field'].includes(a)) { const kv = args[++i]; const k = kv.indexOf('='); fields[kv.slice(0, k)] = kv.slice(k + 1); }
    else if (a === '-H' || a === '--header') i++;
    else if (!a.startsWith('-')) endpoint = a;
  }
  method = method || (Object.keys(fields).length ? 'POST' : 'GET');
  const m = /^\/?repos\/([^/]+\/[^/]+)\/(pulls\/(\d+)(\/files|\/merge)?|commits\/([0-9a-f]+)\/(check-runs|status))(?:\?(.*))?$/.exec(endpoint || '');
  if (!m) fail(`fake gh: unsupported api ${endpoint}`);
  if (m[1].toLowerCase() !== String(s.repo).toLowerCase()) fail('gh: Not Found (HTTP 404)');
  const out = (j) => { fs.writeSync(1, `${JSON.stringify(j)}\n`); process.exit(0); };
  if (m[5]) {
    const pr = Object.values(s.prs || {}).find((p) => p.headRefOid === m[5]) || { statusCheckRollup: [] };
    const roll = pr.statusCheckRollup || [];
    // GitHub pages both lists (per_page, default 30) and reports the full count; the combined status
    // state covers every status, listed or not
    const q = new URLSearchParams(m[7] || '');
    const per = Number(q.get('per_page') || 30);
    const page = Number(q.get('page') || 1);
    const slice = (list) => list.slice((page - 1) * per, page * per);
    const runs = roll.filter((c) => c.__typename !== 'StatusContext').map((c) => ({ name: c.name, status: String(c.status || '').toLowerCase(), conclusion: c.conclusion ? String(c.conclusion).toLowerCase() : null }));
    if (m[6] === 'check-runs') out({ total_count: runs.length, check_runs: slice(runs) });
    const sts = roll.filter((c) => c.__typename === 'StatusContext').map((c) => ({ context: c.context, state: String(c.state || '').toLowerCase() }));
    const combined = !sts.length ? 'pending' : sts.some((x) => ['failure', 'error'].includes(x.state)) ? 'failure' : sts.some((x) => x.state === 'pending') ? 'pending' : 'success';
    out({ state: combined, total_count: sts.length, statuses: slice(sts) });
  }
  const pr = s.prs && s.prs[m[3]];
  if (!pr) fail('gh: Not Found (HTTP 404)');
  if (m[4] === '/files') {
    const page = Number((/(?:^|&)page=(\d+)/.exec(m[7] || '') || [])[1] || 1);
    out(page === 1 ? (pr.files || []).map((f) => ({ filename: f.path, additions: f.additions, deletions: f.deletions })) : []);
  }
  if (m[4] === '/merge') {
    if (method !== 'PUT') out({ message: 'Not Found' });
    if (fields.sha && fields.sha !== pr.headRefOid) fail('gh: Head branch was modified. Review and try the merge again. (HTTP 409)');
    pr.state = 'MERGED';
    fs.writeFileSync(store, JSON.stringify(s, null, 2));
    out({ sha: 'f'.repeat(40), merged: true, message: 'Pull Request successfully merged' });
  }
  const conflicting = String(pr.mergeable || '').toUpperCase() === 'CONFLICTING';
  out({ number: Number(m[3]), state: pr.state === 'MERGED' ? 'closed' : 'open', merged: pr.state === 'MERGED', merged_at: pr.mergedAt || null, head: { sha: pr.headRefOid, ref: pr.headRefName },
    mergeable: String(pr.mergeable || '').toUpperCase() === 'MERGEABLE' ? true : conflicting ? false : null, additions: pr.additions, deletions: pr.deletions, body: pr.body, title: pr.title });
}
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
