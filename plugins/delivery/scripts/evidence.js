#!/usr/bin/env node
// scripts/evidence.js — evidence rows (R-11) and the merged / deployed / verified states (R-12).
//   evidence.js add <bead> --criterion <n> --result pass|fail --surface <id> --sha <deployed sha>
//               [--run <run id, log query or URL>] [--host h] [--app a] [--mode m] [--install-artifact x]
//   evidence.js state <bead> merged [--pr <n>] | deployed --sha <sha> [--version <what the surface shows>]
//   evidence.js waive <bead> --criterion <n> --record <dec-...> --risk '<risk accepted>'
//   evidence.js cut <bead> --record <dec-...> --reason '<why the story is not delivered>'
//   evidence.js list <bead> | evidence.js check <bead>       read only
// Rows go to <project>/.delivery/evidence/<bead>.ndjson: append-only and hash-chained, with the
// writer's role (from the session marker), actor, time and the criterion's own hash. Writes need a
// role session: rows by the Delivery Manager, or by a Reality Checker through reality-check.js run-record
// (which checks the version on screen and the capture first), never by an author of the story;
// states, waivers and cuts by the Delivery Manager. A row whose surface or observed tuple
// (--host/--app/--mode override the declared one) differs from the story's is kept as a side arm (D2);
// one on another sha than the deployed one is a side arm (D3). When every criterion has a counting row
// the bead gets state-verified. Exit codes: 0 done; 1 refused; 2 usage.
const G = require('./lib/gates.js');
const { tupleOf, sameTuple, describe, TUPLE } = require('./lib/surface.js');
const { whoAmI, gateInputs, writerProblem, recordChecker, EVIDENCE_WRITERS } = require('./lib/gate-context.js');

const USAGE = 'usage: evidence.js add <bead> --criterion <n> --result pass|fail --surface <id> --sha <sha> [--run <ref>] | state <bead> merged|deployed [--pr <n>|--sha <sha> [--version <v>]] | waive <bead> --criterion <n> --record <dec-...> --risk <text> | cut <bead> --record <dec-...> --reason <text> | list <bead> | check <bead>';
const VALUE = ['--criterion', '--result', '--surface', '--sha', '--run', '--pr', '--record', '--risk', '--reason', '--project', '--host', '--app', '--mode', '--install-artifact', '--version'];

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2).replace('-', '_')] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const refuse = (text) => ({ code: 1, out: `evidence.js: ${text}` });

function done(bead, inp) {
  if (inp.evidenceProblem) return { ok: false, criteria: [], problem: inp.evidenceProblem };
  const drift = G.scopeDrift(inp.story, bead);
  if (drift) return { ok: false, criteria: [], problem: `${drift.detail} (D1)` };
  return G.doneCheck({ story: inp.story, bead, rows: inp.rows, surface: inp.surface, noSurface: inp.noSurface, instances: inp.instances, recordOk: inp.recordOk });
}

// Append a row and record the new chain head in the bead (evidence_head), so the gate can tell a row
// written here from one written by hand, the last row included.
function record(store, root, id, row) {
  const full = G.appendEvidence(root, id, row);
  const fresh = store.show(id) || { metadata: {} };
  store.update(id, { metadata: { ...(fresh.metadata || {}), evidence_head: full.head } });
  return full;
}

// state-verified follows the rows: set when every criterion counts, removed when they no longer do
function syncVerified(store, bead, inp) {
  const d = done(bead, inp);
  const has = (bead.labels || []).includes(G.STATE.verified);
  if (d.ok && !d.cut && !has) store.update(bead.id, { addLabels: [G.STATE.verified] });
  if (!d.ok && has) store.update(bead.id, { removeLabels: [G.STATE.verified] });
  return d;
}

function doneText(d) {
  if (d.problem) return d.problem;
  if (d.cut) return `cut (${d.cut}): closes without verification`;
  if (d.empty) return 'the story has no acceptance criteria';
  return d.criteria.map((c) => `criterion ${c.n}: ${c.row ? `pass ${c.row}` : c.waiver ? `waived ${c.waiver}` : c.why}`).join('\n') + (d.ok ? '\nall criteria verified: state-verified' : '');
}

function unverifiedRecord(who, record, verifyRecord) {
  const v = (verifyRecord || require('./lib/operator-records.js').verifyRecord)(who.root, record);
  return v && v.ok ? null : `${record} does not verify (${v ? v.error || v.code : 'no result'}): cite an owner record`;
}

// via: { by: 'reality-check', capture, observed_version } when reality-check.js run-record writes the row
function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord, who: given, via } = {}) {
  const a = parse(argv);
  const [cmd, id, word] = a._;
  if (!cmd || !id) return { code: 2, out: USAGE };
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'evidence.js: no project found; pass --project <root>' };
  // writes fail closed: the role comes from the session marker, and no marker means no write
  const reading = cmd === 'list' || cmd === 'check';
  const wp = reading ? null : writerProblem(who, cmd === 'add' ? EVIDENCE_WRITERS : ['delivery-lead']);
  if (wp) return refuse(wp);
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  const bead = store.show(id);
  if (!bead) return refuse(`no bead ${id}`);
  const inp = { ...gateInputs(who.root, bead, { bd: store, team: who.team }), recordOk: recordChecker(who.root, verifyRecord) };
  const at = now || new Date().toISOString();
  const m = bead.metadata || {};

  if (cmd === 'list') return { code: 0, out: inp.rows.map((r) => JSON.stringify(r)).join('\n') || `no evidence for ${id}` };
  if (cmd === 'check') { const d = done(bead, inp); return { code: d.ok ? 0 : 1, out: doneText(d) }; }

  const by = who.roleId;
  const actor = who.actor || who.instance;

  if (cmd === 'state') {
    if (word === 'merged') {
      store.update(id, { addLabels: [G.STATE.merged], metadata: { ...m, ...(a.pr ? { merged_pr: a.pr } : {}) } });
      return { code: 0, out: `${id}: merged${a.pr ? ` (${a.pr})` : ''}, not verified` };
    }
    if (word === 'deployed' && a.sha) {
      // the same sha again keeps its deploy time, so its rows still count
      const same = G.shaMatch(m.deployed_sha, a.sha);
      const meta = { ...m, deployed_sha: same ? m.deployed_sha : a.sha, deployed_at: same && m.deployed_at ? m.deployed_at : at };
      if (a.version) meta.deployed_version = a.version;
      else if (!same) delete meta.deployed_version;
      store.update(id, { addLabels: [G.STATE.merged, G.STATE.deployed], metadata: meta });
      const d = syncVerified(store, store.show(id), inp);
      return { code: 0, out: `${id}: deployed at ${meta.deployed_sha}, ${d.ok ? 'verified' : 'not verified'}` };
    }
    return { code: 2, out: USAGE };
  }

  if (cmd === 'cut') {
    if (!a.record || !a.reason) return { code: 2, out: 'evidence.js: a cut needs --record <dec-...> and --reason <why>' };
    const bad = unverifiedRecord(who, a.record, verifyRecord);
    if (bad) return refuse(bad);
    const row = record(store, who.root, id, { type: 'cut', record: a.record, reason: a.reason, by, actor, at });
    store.update(id, { addLabels: [G.STATE.cut], removeLabels: [G.STATE.verified] });
    return { code: 0, out: `${row.id}: ${id} cut under ${a.record}; it may close without verification` };
  }

  const criteria = inp.story ? inp.story.criteria : [];
  const c = criteria.find((x) => x.n === Number(a.criterion));
  if (!c) return refuse(`${id} has no criterion ${a.criterion} (criteria: ${criteria.map((x) => x.n).join(', ') || 'none'})`);

  if (cmd === 'waive') {
    if (['deployed', 'verified'].includes(G.stateOf(bead)) || bead.status === 'closed') return refuse(`criterion ${c.n} of ${id} is past its gate (D3); a waiver comes before the deploy. To stop the story: evidence.js cut ${id} --record <dec-...> --reason '<why>'`);
    if (!a.record || !a.risk) return { code: 2, out: 'evidence.js: a waiver needs --record <dec-...> and --risk <the risk accepted>' };
    const bad = unverifiedRecord(who, a.record, verifyRecord);
    if (bad) return refuse(bad);
    const row = record(store, who.root, id, { type: 'waiver', criterion: c.n, criterion_hash: G.criterionHash(c), record: a.record, risk: a.risk, by, actor, at });
    return { code: 0, out: `${row.id}: criterion ${c.n} waived under ${a.record}` };
  }

  if (cmd !== 'add') return { code: 2, out: USAGE };
  if (!['pass', 'fail'].includes(a.result) || !a.surface || !a.sha) return { code: 2, out: USAGE };
  if (by === 'reality-checker' && !via) return refuse('a Reality Checker records through the script, which checks the version on screen and the capture: reality-check.js run-record <bead> --criterion <n> --result pass|fail --artifact <path> --observed-version <v>');
  const authors = G.authorsOf(bead, inp.instances);
  if (authors.actors.includes(actor) || authors.roles.includes(by)) return refuse(`${actor} (${by}) is among the authors of ${id}, so its rows do not count: the builder is not its own inspector.`);
  if (!m.deployed_sha) return refuse(`${id} has no deployed sha: record the deploy first (evidence.js state ${id} deployed --sha <sha>), then the run.`);
  const declared = inp.surfaces.find((s) => s.id === a.surface) || null;
  const observed = { ...tupleOf(declared) };
  for (const k of TUPLE) if (a[k] !== undefined) observed[k] = a[k];
  let why = null;
  let gate = 'D2';
  if (!inp.noSurface) {
    if (!inp.surface) return refuse(`${id} names surface ${inp.surfaceId}, which is not in surface.json (D2): fix the story's surface: line, then record the run.`);
    if (!declared) why = `${a.surface} is not in surface.json`;
    else if (a.surface !== inp.surface.id || !sameTuple(observed, tupleOf(inp.surface))) why = `observed on ${observed.app}, ${observed.mode} (${observed.host}), not ${describe(inp.surface)}`;
  }
  if (!why && !G.shaMatch(a.sha, m.deployed_sha)) { why = `on ${a.sha}, not the deployed ${m.deployed_sha}`; gate = 'D3'; }
  const row = record(store, who.root, id, { type: 'row', criterion: c.n, criterion_hash: G.criterionHash(c), result: a.result, surface: a.surface, tuple: observed, sha: a.sha, run: a.run || null, by, actor, at, arm: why ? 'side' : 'main', ...(why ? { why } : {}), ...(via ? { via: via.by, capture: via.capture, observed_version: via.observed_version } : {}) });
  if (why) return { ...refuse(`not verification of ${id} (${gate}): ${why}. Kept as side arm ${row.id}.`), row };
  const d = syncVerified(store, bead, { ...inp, rows: [...inp.rows, row] });
  const note = inp.noSurface ? '\nwarning: the story declares no customer surface, so the surface was not checked (R-09)' : '';
  return { code: 0, row, out: `${row.id}: criterion ${c.n} ${a.result} at ${a.sha}${note}\n${doneText(d)}` };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `evidence.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
