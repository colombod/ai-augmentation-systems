#!/usr/bin/env node
// scripts/a3.js — the A3: a short root-cause record that lifts a stop (R-22).
//   a3.js new --trigger andon:<failed ev row>|ci:main|flaky:<test> [--title ..] [--problem ..] [--evidence ..]
//             [--expected ..] [--cause ..] [--class ..] [--countermeasure ..] [--check ..]
//   a3.js close <a3> --fix <bead> [--fix <bead>]... --proof <ev row | run ref> [--cause ..] [--class ..] ...
//   a3.js show <a3> | a3.js list [--json]                                  read only
// The record is .delivery/reviews/<a3>.md (templates/a3.md: problem as observed, the evidence row, what
// was expected, the root cause, the class of defect, the fix across the class, the check that proves
// it); its open and close are rows in the andon ledger (lib/andon.js). The Delivery Manager and the
// Product Manager write and close it; the Reality Checker may open one and draft its problem, evidence
// and expected sections from its own row. Close needs every section filled, the fix beads, and the
// proof: for a failed check, a counting pass on the same criterion after the failure, on the deployed
// version; otherwise the green run or the passing check. Exit codes: 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./lib/andon.js');
const G = require('./lib/gates.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: a3.js new --trigger andon:<ev row>|ci:main|flaky:<test> [--title t] [--problem t] [--evidence t] [--expected t] [--cause t] [--class t] [--countermeasure t] [--check t] | close <a3> --fix <bead>... --proof <ev row|run> [section flags] | show <a3> | list [--json]';
const SECTION_FLAGS = A.SECTIONS.map(([k]) => `--${k}`);
const VALUE = ['--trigger', '--title', '--proof', '--project', ...SECTION_FLAGS];
const WRITERS = ['delivery-lead', 'product-manager'];
const DRAFTERS = ['reality-checker'];
const DRAFT = ['problem', 'evidence', 'expected'];
const TEMPLATE = path.join(__dirname, '..', 'templates', 'a3.md');
const EV = /^ev-(.+)-(\d+)$/;

function parse(argv) {
  const out = { _: [], fix: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fix') { if (argv[i + 1] === undefined) throw new Error('--fix needs a value'); out.fix.push(argv[++i]); }
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}
const refuse = (why, fix) => ({ code: 1, out: `a3.js: ${why}.${fix ? `\n${fix}` : ''}` });
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const fileOf = (root, id) => path.join(root, A.a3File(id));
const readText = (root, id) => { try { return fs.readFileSync(fileOf(root, id), 'utf8'); } catch (err) { return null; } };
const roleName = (r) => ({ 'delivery-lead': 'Delivery Manager', 'product-manager': 'Product Manager', 'reality-checker': 'Reality Checker' }[r] || r);

// fill the named sections of an A3 file that are still empty
function fill(text, a) {
  let out = text;
  for (const [k, head] of A.SECTIONS) {
    if (a[k] === undefined) continue;
    const re = new RegExp(`(## ${head}\\n(?:<!--[\\s\\S]*?-->\\n)?)([\\s\\S]*?)(?=\\n## |$)`);
    out = out.replace(re, (all, lead, body) => (body.replace(/\{\{[a-z]+\}\}/g, '').trim() ? all : `${lead}${String(a[k]).trim()}\n`));
  }
  return out;
}

// the failed row an andon trigger names, with its bead: { row, bead } or { why }
function failedRow(root, store, rowId) {
  const m = EV.exec(rowId);
  if (!m) return { why: `${rowId} is not an evidence row id (ev-<bead>-<n>)` };
  const row = G.readEvidence(root, m[1]).find((r) => r.id === rowId);
  if (!row || row.type !== 'row' || row.result !== 'fail') return { why: `${rowId} is not a failed check row` };
  let bead = null;
  try { bead = store().show(m[1]); } catch (err) { bead = null; }
  return { row, bead, beadId: m[1] };
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, who: given } = {}) {
  const a = parse(argv);
  const [sub, id] = a._;
  if (!sub) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'a3.js: no project found; pass --project <root>' };
  const at = now || new Date().toISOString();
  const store = () => bd || require('./lib/bd.js').makeBd({ cwd: who.root, timeoutMs: 10000 });
  const { rows } = A.read(who.root);
  const all = A.a3s(who.root, rows);

  if (sub === 'list') {
    if (a.json) return { code: 0, out: JSON.stringify(all) };
    if (!all.length) return { code: 0, out: 'No A3 records.' };
    return { code: 0, out: all.map((x) => `${x.id} ${x.closed ? `closed ${String(x.closed.at).slice(0, 16)}` : 'open'} ${x.trigger}${x.area ? ` (area ${x.area})` : ''}${x.closed ? `; fixes ${x.closed.fixes.join(', ')}, proof ${x.closed.proof}` : `; missing: ${A.missingSections(readText(who.root, x.id) || '').join(', ') || 'nothing, close it'}`}`).join('\n') };
  }
  if (sub === 'show') {
    const x = all.find((y) => y.id === id);
    if (!x) return refuse(`no A3 ${id}`, 'List them: a3.js list');
    return { code: 0, out: `${x.id}: ${x.closed ? `closed by ${x.closed.by} at ${x.closed.at}` : 'open'} (${x.trigger})\n\n${readText(who.root, x.id) || '(the record file is missing)'}` };
  }

  if (!who.roleId) return refuse('an A3 is written from a role session; none is active here');
  const writer = WRITERS.includes(who.roleId);
  if (sub === 'new') {
    if (!writer && !DRAFTERS.includes(who.roleId)) return refuse(`an A3 is the Delivery Manager's or Product Manager's to write (this session is ${who.roleId})`, 'Message the Delivery Manager with what failed and the evidence.');
    if (!writer) {
      const other = A.SECTIONS.map(([k]) => k).filter((k) => !DRAFT.includes(k) && a[k] !== undefined);
      if (other.length) return refuse(`the ${roleName(who.roleId)} drafts the problem, evidence and expected sections only (not ${other.join(', ')})`, 'The cause and the fix are the Delivery Manager\'s: message it.');
    }
    const t = String(a.trigger || '');
    let area = null;
    let title = a.title || null;
    const draft = {};
    if (/^andon:/.test(t)) {
      const f = failedRow(who.root, store, t.slice(6));
      if (f.why) return refuse(f.why);
      area = f.bead ? G.areaOf(f.bead) : null;
      title = title || `${f.bead ? f.bead.title || f.bead.id : f.beadId} failed criterion ${f.row.criterion}`;
      const crit = f.bead ? ((require('./lib/gate-context.js').readStory(who.root, f.bead) || { criteria: [] }).criteria.find((c) => c.n === Number(f.row.criterion))) : null;
      if (crit) draft.expected = `Criterion ${crit.n}: ${crit.text}`;
      draft.evidence = `${f.row.id}: criterion ${f.row.criterion} failed on ${f.row.surface || 'the declared surface'} at ${String(f.row.sha || '').slice(0, 12)}${f.row.capture ? ` (capture ${f.row.capture.path})` : ''}${f.row.run ? `, run ${f.row.run}` : ''}.`;
    } else if (t === 'ci:main') {
      title = title || 'CI on main is red';
    } else if (/^flaky:.+/.test(t)) {
      const fl = [...rows].reverse().find((r) => r.type === 'flaky' && r.test === t.slice(6));
      if (!fl) return refuse(`no flaky test ${t.slice(6)} is recorded`, 'Record it first: andon.js flaky <test> --sha <sha> --fail-run <ref> --pass-run <ref>');
      area = fl.area || null;
      title = title || `${fl.test} is flaky`;
      draft.evidence = `${fl.test} failed (${fl.fail_run}) then passed (${fl.pass_run}) on ${String(fl.sha).slice(0, 12)}.`;
    } else return { code: 2, out: USAGE };
    const open = A.openA3For(who.root, t, rows);
    if (open) return refuse(`${open.id} is already open for ${t}`, `Fill it in (.delivery/reviews/${open.id}.md) and close it: a3.js close ${open.id} --fix <bead> --proof <row>`);
    const row = A.append(who.root, { type: 'a3-open', trigger: t, area, by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    const a3 = `a3-${row.id.replace(/^an-/, '')}`;
    // the ledger row names its A3 by its own id: an-<writer>-<n> opens a3-<writer>-<n>
    const tpl = fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{id\}\}/g, a3).replace(/\{\{trigger\}\}/g, t).replace(/\{\{area\}\}/g, area || 'product').replace(/\{\{opened\}\}/g, at).replace(/\{\{title\}\}/g, title);
    const text = fill(tpl, { ...draft, ...Object.fromEntries(A.SECTIONS.map(([k]) => [k, a[k]]).filter(([, v]) => v !== undefined)) });
    fs.mkdirSync(path.dirname(fileOf(who.root, a3)), { recursive: true });
    fs.writeFileSync(fileOf(who.root, a3), text);
    const missing = A.missingSections(text);
    return { code: 0, a3, out: `${a3}: opened for ${t}${area ? ` (area ${area})` : ''}, in .delivery/reviews/${a3}.md\n${missing.length ? `To fill in: ${missing.join(', ')}. ` : ''}Then: a3.js close ${a3} --fix <bead> --proof <the passing row or run>` };
  }

  if (sub === 'close') {
    if (!writer) return refuse(`closing an A3 is the Delivery Manager's or Product Manager's (this session is ${who.roleId})`, 'Message the Delivery Manager.');
    const x = all.find((y) => y.id === id);
    if (!x) return refuse(`no A3 ${id}`, 'List them: a3.js list');
    if (x.closed) return refuse(`${id} was closed at ${x.closed.at}`);
    let text = readText(who.root, id);
    if (text === null) return refuse(`the record .delivery/reviews/${id}.md is missing`, `Restore it from git: \`git log -p -- .delivery/reviews/${id}.md\``);
    text = fill(text, a);
    const missing = A.missingSections(text);
    if (missing.length) return refuse(`${id} has no ${missing.join(', ')}`, `Fill it in (.delivery/reviews/${id}.md, or a3.js close ${id} --${A.SECTIONS.find(([, h]) => h === missing[0])[0]} '...'), then close it`);
    if (!a.fix.length || !a.proof) return refuse('a close links the fix bead(s) and the proving check', `a3.js close ${id} --fix <bead> --proof <ev row or run>`);
    for (const b of a.fix) {
      let bead = null;
      try { bead = store().show(b); } catch (err) { bead = null; }
      if (!bead) return refuse(`no bead ${b}`, `Name the fix: \`bd show ${b}\``);
    }
    if (/^andon:/.test(x.trigger)) {
      const f = failedRow(who.root, store, x.trigger.slice(6));
      if (f.why) return refuse(f.why);
      const m = EV.exec(a.proof);
      const deployed = f.bead && f.bead.metadata && f.bead.metadata.deployed_sha;
      const pass = m && m[1] === f.beadId ? G.readEvidence(who.root, m[1]).find((r) => r.id === a.proof) : null;
      const ok = pass && pass.type === 'row' && pass.result === 'pass' && pass.arm !== 'side' && pass.criterion === f.row.criterion && pass.seq > f.row.seq && ['delivery-lead', 'reality-checker'].includes(pass.by);
      if (!ok) return refuse(`${a.proof} is not a counting pass of criterion ${f.row.criterion} of ${f.beadId} after ${f.row.id}`, 'Prove it on the customer\'s app first: the Reality Checker runs the check on the new deploy (reality-check.js run-record), then close with that row');
      if (deployed && !G.shaMatch(pass.sha, deployed)) return refuse(`${a.proof} passed on ${pass.sha}, not the deployed ${deployed}`, 'Check the deployed version again, then close with that row');
    }
    fs.writeFileSync(fileOf(who.root, id), text.replace(/^(---[\s\S]*?\n)(---)/, `$1closed: ${at}\n$2`));
    const row = A.append(who.root, { type: 'a3-close', a3: id, fixes: a.fix, proof: a.proof, hash: sha12(text), by: who.roleId, actor: who.actor || who.instance, at }, who.instance);
    return { code: 0, row, out: `${id}: closed (${row.id}); fixes ${a.fix.join(', ')}, proved by ${a.proof}. The stop on ${x.trigger} lifts once nothing else holds it.` };
  }
  return { code: 2, out: USAGE };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `a3.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
