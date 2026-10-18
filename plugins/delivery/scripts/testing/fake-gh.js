#!/usr/bin/env node
// scripts/testing/fake-gh.js — a fake `gh` for tests: `pr view <n> --json ...` and `pr merge <n>
// --match-head-commit <sha>`, over the JSON file named in GH_FAKE_STORE ({ prs: { "<n>": view } }).
// Without the store it fails the way a signed-out gh does. Never used in production.
const fs = require('fs');

const store = process.env.GH_FAKE_STORE;
const fail = (msg) => { process.stderr.write(`${msg}\n`); process.exit(1); };
if (!store || !fs.existsSync(store)) fail('gh: not logged in to any hosts (fake)');
const s = JSON.parse(fs.readFileSync(store, 'utf8'));
const args = process.argv.slice(2).filter((a, i, all) => a !== '-R' && all[i - 1] !== '-R');
const [group, cmd, n] = args;
const pr = s.prs && s.prs[n];
if (group !== 'pr' || !['view', 'merge'].includes(cmd)) fail(`fake gh: unsupported ${args.join(' ')}`);
if (!pr) fail(`GraphQL: Could not resolve to a PullRequest with the number of ${n}.`);
if (cmd === 'view') { process.stdout.write(`${JSON.stringify({ number: Number(n), state: 'OPEN', ...pr })}\n`); process.exit(0); }
const at = args.indexOf('--match-head-commit');
if (at >= 0 && args[at + 1] !== pr.headRefOid) fail(`Head branch was modified. Review and try the merge again.`);
pr.state = 'MERGED';
fs.writeFileSync(store, JSON.stringify(s, null, 2));
process.stdout.write(`✓ Merged pull request #${n}\n`);
