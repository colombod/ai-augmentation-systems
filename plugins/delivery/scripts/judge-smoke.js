#!/usr/bin/env node
// scripts/judge-smoke.js — opt-in live smoke test of the typed judge; not part of the test suite.
//
// Runs the 10 J1 relay_request cases (judge/smoke-relay-cases.json) through the relay guard's own judge
// path (same stripping, state filter and question) against the real provider, and prints accuracy.
// Needs TYPESAFE_API_KEY in the environment (it is read there only, never printed). Sends the 10 case
// messages to the provider. Exit 0 at 9/10 or better, 1 below, 2 when the key is not set.
const fs = require('fs');
const path = require('path');
const { judgeRelay } = require('../hooks/scripts/relay-guard.js');

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    process.stderr.write('judge-smoke: TYPESAFE_API_KEY is not set; nothing was sent\n');
    return 2;
  }
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'judge', 'smoke-relay-cases.json'), 'utf8'));
  const team = { judge: { provider: 'typesafe', model: 'jev-latest' } };
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
