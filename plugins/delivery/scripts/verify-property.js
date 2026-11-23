#!/usr/bin/env node
// scripts/verify-property.js — check a feature's properties by every method that can run here, and say
// which ran.
//   node scripts/verify-property.js [P1 ...] [--without-lean] [--json] [--verbose] [--register <file>]
//   node scripts/verify-property.js --write-examples     regenerate Model/Examples.lean from examples.json
// The owner's ask: use Lean to validate properties of features against the code, but a proof is not
// always applicable, so it must work with and without Lean. So a property (in .delivery/properties.json)
// lists its methods, and this runs each one that is available:
//   check   a function of this plugin (a property test, fixed examples): needs nothing installed
//   lean    a Lake project: built and audited when elan is present, "unavailable, not run" when not
// One line per method with its verdict, then the property's state in the verification contract's own
// words (met, unverified, contradicted; .delivery/direction/contracts/verification-and-evidence.md).
// A property is called proven only when the Lean proof passed AND the examples tie the model to the
// code: a proof about a model alone is not a claim about the code. Without Lean it is reported as
// checked by property test only, never as proven. --without-lean forces that path on a machine that
// has Lean, to compare the two. Methods that disagree are named, and the exit code is 1.
// Exit: 0 every method that ran agrees and none failed · 1 a method failed or two disagree · 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REGISTER = path.join(ROOT, '.delivery', 'properties.json');
// the three axioms Lean's own library rests on; anything else (and `sorryAx`, an unfinished proof) is refused
const AXIOMS = new Set(['propext', 'Classical.choice', 'Quot.sound']);

// the elan binary, or null. DELIVERY_ELAN names one (tests use it; an empty value means "none").
function findElan(env = process.env) {
  if (env.DELIVERY_ELAN !== undefined) return env.DELIVERY_ELAN && fs.existsSync(env.DELIVERY_ELAN) ? env.DELIVERY_ELAN : null;
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(env.HOME || os.homedir(), '.elan', 'bin'));
  for (const d of dirs) {
    const p = path.join(d, 'elan');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (err) { /* next */ }
  }
  return null;
}

// `#print axioms` output -> [{ name, axioms: [..] }]
function parseAxioms(text) {
  const out = [];
  const re = /'([^']+)' (does not depend on any axioms|depends on axioms: \[([^\]]*)\])/g;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], axioms: m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [] });
  return out;
}

const firstLine = (s) => (String(s || '').split('\n').find((l) => /error/i.test(l)) || String(s || '').trim().split('\n')[0] || '').trim().slice(0, 200);

function runCheck(method) {
  const started = Date.now();
  try {
    const fn = require(path.resolve(ROOT, method.module))[method.export];
    if (typeof fn !== 'function') return { ran: true, verdict: 'contradicted', detail: `${method.module} exports no ${method.export}` };
    const r = fn();
    return { ran: true, verdict: r.ok ? 'met' : 'contradicted', detail: r.detail, ms: Date.now() - started };
  } catch (err) {
    return { ran: true, verdict: 'contradicted', detail: `the check threw: ${err.message}`, ms: Date.now() - started };
  }
}

function runLean(method, opts) {
  if (opts.withoutLean) return { ran: false, detail: 'not run (--without-lean)' };
  const elan = findElan(opts.env);
  if (!elan) return { ran: false, detail: 'unavailable, not run (elan not found; install Lean 4 with elan to run the proof)' };
  const project = path.join(ROOT, method.project);
  let toolchain;
  try { toolchain = fs.readFileSync(path.join(project, 'lean-toolchain'), 'utf8').trim(); } catch (err) { return { ran: true, verdict: 'contradicted', detail: `no lean-toolchain in ${method.project}` }; }
  const started = Date.now();
  // elan has no default toolchain here by design: every call names the project's pinned one
  const lake = (args) => spawnSync(elan, ['run', toolchain, 'lake', ...args], { cwd: project, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const build = lake(['build']);
  if (build.error) return { ran: false, detail: `unavailable, not run (${build.error.message})` };
  if (build.status !== 0 && opts.verbose) process.stderr.write(`${build.stdout}\n${build.stderr}\n`);
  if (build.status !== 0) return { ran: true, verdict: 'contradicted', detail: `the proof does not build: ${firstLine(`${build.stdout}\n${build.stderr}`)}`, toolchain, ms: Date.now() - started, output: `${build.stdout}\n${build.stderr}` };
  const audited = [];
  for (const file of method.audit || []) {
    const r = lake(['env', 'lean', file]);
    if (r.status !== 0) return { ran: true, verdict: 'contradicted', detail: `${file} does not check: ${firstLine(`${r.stdout}\n${r.stderr}`)}`, toolchain, ms: Date.now() - started };
    audited.push(...parseAxioms(`${r.stdout}\n${r.stderr}`));
  }
  const ms = Date.now() - started;
  const bad = audited.filter((a) => a.axioms.some((x) => !AXIOMS.has(x)));
  if (bad.length) return { ran: true, verdict: 'contradicted', detail: `${bad[0].name} rests on ${bad[0].axioms.filter((x) => !AXIOMS.has(x)).join(', ')}${bad[0].axioms.includes('sorryAx') ? ' (an unfinished proof)' : ''}`, toolchain, ms };
  const missing = (method.theorems || []).filter((t) => !audited.some((a) => a.name === t));
  if (missing.length) return { ran: true, verdict: 'contradicted', detail: `the audit does not cover ${missing.join(', ')}`, toolchain, ms };
  return { ran: true, verdict: 'met', detail: `proved in the model for every finite graph; ${audited.length} theorems audited, no sorry, no axiom beyond Lean's standard three (${toolchain})`, toolchain, ms };
}

// one property -> its record: per-method results, which ran, the state and what the state rests on
function verify(prop, opts = {}) {
  const methods = [];
  for (const m of prop.methods || []) {
    const r = m.kind === 'lean' ? runLean(m, opts) : m.kind === 'check' ? runCheck(m) : { ran: false, detail: `not run (unknown kind "${m.kind}")` };
    methods.push({ id: m.id, kind: m.kind, files: m.files || [], limit: m.limit || null, ...r, output: undefined });
  }
  const ran = methods.filter((m) => m.ran);
  const met = ran.filter((m) => m.verdict === 'met');
  const failed = ran.filter((m) => m.verdict === 'contradicted');
  const disagree = met.length > 0 && failed.length > 0;
  const proofs = methods.filter((m) => m.kind === 'lean');
  const proven = proofs.length > 0 && proofs.every((m) => m.verdict === 'met');
  let state;
  let basis;
  if (failed.length) {
    state = 'contradicted';
    basis = disagree
      ? `methods disagree: ${met.map((m) => m.id).join(', ')} say met, ${failed.map((m) => m.id).join(', ')} ${failed.length > 1 ? 'say' : 'says'} contradicted`
      : `${failed.map((m) => m.id).join(', ')} failed`;
  } else if (!met.length) {
    state = 'unverified';
    basis = 'no method ran';
  } else if (proven) {
    state = 'met';
    basis = `proven in the Lean model, and tied to the code by ${met.filter((m) => m.kind !== 'lean').map((m) => m.id).join(' and ')}`;
  } else {
    state = 'met';
    basis = `checked by ${met.map((m) => m.id).join(' and ')} only; not proven (the Lean proof did not run)`;
  }
  return { id: prop.id, feature: prop.feature, statement: prop.statement, methods, ran: ran.map((m) => m.id), notRun: methods.filter((m) => !m.ran).map((m) => m.id), state, proven: state === 'met' && proven, disagree, basis };
}

function report(rec) {
  const lines = [`${rec.id} (${rec.feature}): ${rec.statement}`];
  for (const m of rec.methods) lines.push(`  ${m.id}: ${m.ran ? `${m.verdict} (${m.detail})` : m.detail}`);
  lines.push(`  ${rec.id}: ${rec.state}, ${rec.basis}`);
  lines.push(`  ran: ${rec.ran.join(', ') || 'none'}; not run: ${rec.notRun.join(', ') || 'none'}`);
  return lines.join('\n');
}

function main(argv, env = process.env) {
  const opts = { withoutLean: false, env };
  const ids = [];
  let json = false;
  let register = REGISTER;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--without-lean') opts.withoutLean = true;
    else if (a === '--json') json = true;
    else if (a === '--verbose') opts.verbose = true; // print Lean's own output when the proof does not build
    else if (a === '--register') register = argv[++i];
    else if (a === '--write-examples') {
      const P = require('./lib/retire-property.js');
      fs.writeFileSync(P.EXAMPLES_LEAN, P.toLean(P.loadExamples()));
      console.log(`wrote ${path.relative(ROOT, P.EXAMPLES_LEAN)}`);
      return 0;
    } else if (a.startsWith('--')) { console.error(`verify-property: unknown option ${a}`); return 2; } else ids.push(a);
  }
  let props;
  try { props = JSON.parse(fs.readFileSync(register, 'utf8')).properties || []; } catch (err) { console.error(`verify-property: cannot read ${register}: ${err.message}`); return 2; }
  const unknown = ids.filter((id) => !props.some((p) => p.id === id));
  if (unknown.length) { console.error(`verify-property: no property ${unknown.join(', ')} (known: ${props.map((p) => p.id).join(', ')})`); return 2; }
  const records = props.filter((p) => !ids.length || ids.includes(p.id)).map((p) => verify(p, opts));
  if (json) console.log(JSON.stringify({ properties: records }, null, 2));
  else for (const r of records) console.log(report(r));
  return records.some((r) => r.state === 'contradicted') ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { verify, report, main, findElan, parseAxioms };
