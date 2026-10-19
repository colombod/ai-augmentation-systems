#!/usr/bin/env node
// scripts/andon.js — what stops the line, and its records (R-22).
//   andon.js show [--plain] [--json]                         read only: stopped areas, a red main, flaky tests,
//                                                            open A3s, fix-on-fix spikes
//   andon.js ci red|green --sha <sha> --run <ref>            Delivery Manager: CI on the product's main, where gh
//                                                            cannot read it (gh run list -R product_github first)
//   andon.js flaky <test> --sha <sha> --fail-run <ref> --pass-run <ref> [--area <area>]
//                                                            a reviewer or the Delivery Manager: one test failed then
//                                                            passed on the same sha; its A3 is due within 24 h. A warning;
//                                                            a stop on the named area only once confirmed and late
//   andon.js flaky confirm <test>                            Delivery Manager: confirms another session's record
//   andon.js ack <chain row> --reason '<the spike's answer>' Delivery Manager: a fix-on-fix spike was answered
// Exit codes: 0 done; 1 refused; 2 usage.
const A = require('./lib/andon.js');
const W = require('./lib/warnings.js');
const { whoAmI, writerProblem } = require('./lib/gate-context.js');

const USAGE = "usage: andon.js show [--plain] [--json] | ci red|green --sha <sha> --run <ref> | flaky <test> --sha <sha> --fail-run <ref> --pass-run <ref> [--area <a>] | flaky confirm <test> | ack <chain row> --reason '<text>'";
const VALUE = ['--sha', '--run', '--fail-run', '--pass-run', '--area', '--reason', '--project'];
const SHA = /^[0-9a-f]{7,40}$/i;

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2).replace('-', '_')] = argv[++i]; }
    else if (a === '--plain' || a === '--json') out[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}
const refuse = (why, fix) => ({ code: 1, out: `andon.js: ${why}.${fix ? `\n${fix}` : ''}` });

function lines(s) {
  const out = [];
  for (const x of s.stops) out.push(`Stopped: area ${x.area} on ${x.row} (criterion ${x.criterion} of ${x.bead}); needs ${x.missing || 'nothing'}; ${x.a3 ? `A3 ${x.a3.id} open` : `no A3 (a3.js new --trigger ${x.trigger})`}; ${x.stage}`);
  if (s.ci.red) out.push(`${s.ci.lifted ? 'Lifted' : 'Stopped'}: CI on ${s.ci.repo ? `${s.ci.repo} ` : ''}${s.ci.branch} red since ${s.ci.since} (${s.ci.source}${s.ci.run ? `, ${s.ci.run}` : ''})${s.ci.lifted ? ` by ${s.ci.lifted}` : `; fixes only until green or an A3 closes (${s.ci.a3 ? `${s.ci.a3.id} open` : 'a3.js new --trigger ci:main'})`}`);
  for (const r of s.flaky) out.push(`Flaky: ${r.test} on ${String(r.sha).slice(0, 12)}; A3 due ${r.due.slice(0, 16)}${r.overdue ? ' (late: claims there stop)' : ''}${r.a3 ? `; ${r.a3.id} open` : `; a3.js new --trigger flaky:${r.test}`}`);
  for (const a of s.a3s) out.push(`A3 open: ${a.id} for ${a.trigger}`);
  for (const c of s.chains) out.push(`Fix on fix: ${c.symptom} in PRs ${c.prs.join(', ')}; spike ${c.spike}; fix claims on it warn until andon.js ack ${c.id}`);
  if (s.problem) out.push(`Warning: ${s.problem}`);
  return out.length ? out : ['Nothing stops the line.'];
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, who: given, gh } = {}) {
  const a = parse(argv);
  const [sub, arg] = a._;
  if (!sub) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'andon.js: no project found; pass --project <root>' };
  const at = now || new Date().toISOString();
  const store = () => bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });
  const beadOf = (id) => { try { return store().show(id); } catch (err) { return null; } };

  if (sub === 'show') {
    let fixBeads = [];
    try { fixBeads = ['bug', 'security'].flatMap((l) => store().list({ label: l, all: true }) || []); } catch (err) { fixBeads = []; }
    const s = A.summary(who.root, { beadOf, team: who.team, now: at, fixBeads, ci: A.ciState(who.root, { team: who.team, gh }) });
    if (a.json) return { code: 0, out: JSON.stringify(s) };
    if (a.plain) { const p = A.plainLines(s); return { code: 0, out: p.length ? p.join('\n') : 'Nothing is stopped.' }; }
    return { code: 0, out: lines(s).join('\n') };
  }
  if (!who.roleId) return refuse('this records a stop and needs a role session; none is active here');

  if (sub === 'ci') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!['red', 'green'].includes(arg) || !a.sha || !SHA.test(a.sha) || !a.run) return { code: 2, out: USAGE };
    const row = A.append(who.root, { type: 'ci', result: arg, sha: a.sha, run: a.run, by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    return { code: 0, row, out: arg === 'red' ? `${row.id}: CI on main red at ${a.sha.slice(0, 12)} (${a.run}): new claims across the product stop; fixes go on until it is green or an A3 closes (a3.js new --trigger ci:main)` : `${row.id}: CI on main green at ${a.sha.slice(0, 12)}` };
  }

  if (sub === 'flaky' && arg === 'confirm') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    const test = a._[2];
    if (!test) return { code: 2, out: USAGE };
    if (!A.flakyOpen(who.root, { now: at }).some((r) => r.test === test)) return refuse(`no open flaky record for ${test}`, 'See them: andon.js show');
    const row = A.append(who.root, { type: 'flaky-confirm', test, by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    return { code: 0, row, out: `${row.id}: ${test} confirmed flaky: without an A3 opened within 24 h of its record, its area takes fixes only` };
  }
  if (sub === 'flaky') {
    if (who.roleId === 'chief-of-staff') return refuse('a flaky test is recorded by its reviewer or the Delivery Manager', 'Message the Delivery Manager with the test and the two runs.');
    if (!arg || !a.sha || !SHA.test(a.sha) || !a.fail_run || !a.pass_run) return { code: 2, out: USAGE };
    if (a.fail_run === a.pass_run) return refuse('the failing and the passing run are the same run', 'Name both runs on the same sha');
    const row = A.append(who.root, { type: 'flaky', test: arg, sha: a.sha, fail_run: a.fail_run, pass_run: a.pass_run, area: a.area || null, by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    const w = W.record(who.root, { kind: 'flaky', rule: 'R-22', bead: null, detail: `${arg} failed then passed on ${a.sha.slice(0, 12)}: an A3 is due within 24 h`, raisedBy: who.instance, instance: who.instance, now: at });
    const due = new Date(Date.parse(at) + A.FLAKY_HOURS * 3600e3).toISOString().slice(0, 16);
    const then = !a.area ? 'with no area named it only warns' : who.roleId === 'delivery-lead' ? `if none is opened by then, area ${a.area} takes fixes only` : `it is unconfirmed until the Delivery Manager confirms it (andon.js flaky confirm ${arg}); it only warns until then`;
    return { code: 0, row, out: `${row.id}: ${arg} is flaky on ${a.sha.slice(0, 12)}; warning ${w ? w.id : 'unrecorded'}. Its A3 is due by ${due} (a3.js new --trigger flaky:${arg}); ${then}` };
  }

  if (sub === 'ack') {
    const wp = writerProblem(who, ['delivery-lead']);
    if (wp) return refuse(wp.replace(/\.$/, ''));
    if (!arg || !a.reason || !String(a.reason).trim()) return { code: 2, out: USAGE };
    const ch = A.chains(who.root, { beadOf }).find((c) => c.id === arg);
    if (!ch) return refuse(`no fix-on-fix chain ${arg}`, 'See them: andon.js show');
    if (ch.acked) return refuse(`${arg} is already acknowledged`);
    const row = A.append(who.root, { type: 'ack', target: arg, reason: String(a.reason).slice(0, 500), by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    return { code: 0, row, out: `${row.id}: ${arg} acknowledged; fix claims on ${ch.symptom} no longer warn` };
  }
  return { code: 2, out: USAGE };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `andon.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
