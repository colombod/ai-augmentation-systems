#!/usr/bin/env node
// scripts/judge-smoke.js — opt-in live smoke test of the typed judge; not part of the test suite.
//
// Runs the 10 J1 relay_request cases (judge/smoke-relay-cases.json) through the relay guard's own judge
// path (same stripping, state filter and question) against the real provider, and prints accuracy.
// Needs TYPESAFE_API_KEY in the environment (it is read there only, never printed). Sends the 10 case
// messages to the provider. Exit 0 at 9/10 or better, 1 below, 2 when the key is not set.
//
// --set message runs the owner-message cases (judge/smoke-message-cases.json: orders_owner, tone_violation,
// jargon, 10 each) through the Stop hook's own message path (message-checks.js judgeMessage) and prints
// accuracy per question and any wrong answer at or above the block threshold (0.8). A question may block
// only at 9/10 or better with no such wrong answer; exit 0 when every question meets that.
const fs = require('fs');
const path = require('path');
const { judgeRelay } = require('../hooks/scripts/relay-guard.js');

async function messageSet(team) {
  const { judgeMessage } = require('../hooks/scripts/message-checks.js');
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'judge', 'smoke-message-cases.json'), 'utf8'));
  const by = {};
  for (const c of cases) {
    const all = await judgeMessage({ input: { last_assistant_message: c.state.message }, team, role: 'chief-of-staff', projectRoot: null });
    const r = all[c.question];
    const score = r ? (typeof r.p === 'number' ? r.p : r.confidence) : null;
    const said = !r ? null : typeof r.p === 'number' ? r.p >= 0.5 : r.answer;
    const ok = said !== null && said === c.label;
    const s = by[c.question] || (by[c.question] = { right: 0, n: 0, wrongAtBlock: 0 });
    s.n++;
    if (ok) s.right++;
    if (!ok && score !== null && score >= 0.8) s.wrongAtBlock++;
    process.stdout.write(`${c.question}\t${c.id}\tlabel ${c.label}\t${r ? `${r.answer} ${score.toFixed(2)}` : 'no answer'}\t${ok ? 'ok' : 'WRONG'}\t${r && r.model ? r.model : ''}\t${r && r.latencyMs ? `${r.latencyMs} ms` : ''}\n`);
  }
  let pass = true;
  for (const [q, s] of Object.entries(by)) {
    const blocks = s.right >= 9 && s.wrongAtBlock === 0;
    if (!blocks) pass = false;
    process.stdout.write(`${q}: ${s.right}/${s.n}, wrong at or above 0.8: ${s.wrongAtBlock}; ${blocks ? 'may block' : 'warn-only'}\n`);
  }
  return pass ? 0 : 1;
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    process.stderr.write('judge-smoke: TYPESAFE_API_KEY is not set; nothing was sent\n');
    return 2;
  }
  const team = { judge: { provider: 'typesafe', model: 'jev-latest' } };
  if (process.argv.includes('--set') && process.argv[process.argv.indexOf('--set') + 1] === 'message') return messageSet(team);
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'judge', 'smoke-relay-cases.json'), 'utf8'));
  let right = 0;
  const lat = [];
  for (const c of cases) {
    const r = await judgeRelay({ input: { last_assistant_message: c.state.message }, team, role: 'chief-of-staff', projectRoot: null });
    const p = r && typeof r.p === 'number' ? r.p : null;
    const ok = p !== null && (p >= 0.5) === c.label;
    if (ok) right++;
    if (r && r.latencyMs) lat.push(r.latencyMs);
    const verdict = p === null ? `no answer (${r ? r.reason : 'judge off'})` : p >= r.block_threshold ? 'block' : p >= r.warn_threshold ? 'warn' : 'pass';
    process.stdout.write(`${c.id}\tlabel ${c.label ? 'yes' : 'no '}\tp ${p === null ? '-   ' : p.toFixed(2)}\t${verdict}\t${ok ? 'ok' : 'WRONG'}\t${r && r.model ? r.model : ''}\n`);
  }
  lat.sort((a, b) => a - b);
  process.stdout.write(`accuracy ${right}/${cases.length}; latency p50 ${lat[Math.floor(lat.length / 2)] || '-'} ms, max ${lat[lat.length - 1] || '-'} ms\n`);
  return right >= 9 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (err) => { process.stderr.write(`judge-smoke: ${err.message}\n`); process.exitCode = 1; });
