#!/usr/bin/env node
// scripts/evidence.js — evidence rows (R-11) and the merged / deployed / verified states (R-12).
//   evidence.js add <bead> --criterion <n> --result pass|fail --surface <id> --sha <deployed sha>
//               [--by <role>] [--run <run id, log query or URL>] [--host h] [--app a] [--mode m] [--install-artifact x]
//   evidence.js state <bead> merged [--pr <n>] | deployed --sha <sha>
//   evidence.js waive <bead> --criterion <n> --record <dec-...> --risk '<risk accepted>'
//   evidence.js list <bead> | evidence.js check <bead>
// Rows go to <project>/.delivery/evidence/<bead>.ndjson, append-only, with the writer's role, actor and
// time. A row by the story's author is refused (authority). A row whose surface, observed tuple
// (--host/--app/--mode override the declared one) or sha differs from the story's declared surface and
// deployed sha is kept as a side arm and refused as verification (D2). When every criterion has a
// counting row, the bead gets state-verified. Exit codes: 0 recorded; 1 refused; 2 usage.
const G = require('./lib/gates.js');
const { tupleOf, sameTuple, describe, TUPLE } = require('./lib/surface.js');
const { whoAmI, gateInputs } = require('./lib/gate-context.js');

const USAGE = 'usage: evidence.js add <bead> --criterion <n> --result pass|fail --surface <id> --sha <sha> [--by <role>] [--run <ref>] | state <bead> merged|deployed [--pr <n>|--sha <sha>] | waive <bead> --criterion <n> --record <dec-...> --risk <text> | list <bead> | check <bead>';
const VALUE = ['--criterion', '--result', '--surface', '--sha', '--by', '--run', '--pr', '--record', '--risk', '--project', '--host', '--app', '--mode', '--install-artifact'];

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

const DM_ONLY = (who, env, what) => (env.DELIVERY_ROLE && who.roleId !== 'delivery-lead' ? { code: 1, out: `evidence.js: ${what} is the Delivery Manager's; message the Delivery Manager.` } : null);

function verifyIfDone(store, bead, inp) {
  const done = G.doneCheck({ story: inp.story, bead, rows: inp.rows, surface: inp.surface, instances: inp.instances });
  if (done.ok && !done.migrate && !(bead.labels || []).includes(G.STATE.verified)) store.update(bead.id, { addLabels: [G.STATE.verified] });
  return done;
}

function doneText(done) {
  if (done.migrate) return 'the story has no acceptance criteria: the done gate cannot run';
  return done.criteria.map((c) => `criterion ${c.n}: ${c.row ? `pass ${c.row}` : c.waiver ? `waived ${c.waiver}` : c.why}`).join('\n') + (done.ok ? '\nall criteria verified: state-verified' : '');
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord } = {}) {
  const a = parse(argv);
  const [cmd, id, word] = a._;
  if (!cmd || !id) return { code: 2, out: USAGE };
  const who = whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'evidence.js: no project found; pass --project <root>' };
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  const bead = store.show(id);
  if (!bead) return { code: 1, out: `evidence.js: no bead ${id}` };
  const inp = gateInputs(who.root, bead, { bd: store, team: who.team });
  const at = now || new Date().toISOString();
  const m = bead.metadata || {};

  if (cmd === 'list') return { code: 0, out: inp.rows.map((r) => JSON.stringify(r)).join('\n') || `no evidence for ${id}` };
  if (cmd === 'check') { const done = verifyIfDone(store, bead, inp); return { code: done.ok ? 0 : 1, out: doneText(done) }; }

  if (cmd === 'state') {
    const refused = DM_ONLY(who, env, 'recording a state');
    if (refused) return refused;
    if (word === 'merged') {
      store.update(id, { addLabels: [G.STATE.merged], metadata: { ...m, ...(a.pr ? { merged_pr: a.pr } : {}) } });
      return { code: 0, out: `${id}: merged${a.pr ? ` (${a.pr})` : ''}, not verified` };
    }
    if (word === 'deployed' && a.sha) {
      // a new deploy needs its own verification: an earlier state-verified goes
      const verified = (bead.labels || []).includes(G.STATE.verified) && m.deployed_sha !== a.sha;
      store.update(id, { addLabels: [G.STATE.merged, G.STATE.deployed], removeLabels: verified ? [G.STATE.verified] : [], metadata: { ...m, deployed_sha: a.sha, deployed_at: at } });
      return { code: 0, out: `${id}: deployed at ${a.sha}, not verified${verified ? ' (the earlier verification was for another sha)' : ''}` };
    }
    return { code: 2, out: USAGE };
  }

  const by = who.roleId || a.by;
  if (who.roleId && a.by && a.by !== who.roleId) return { code: 1, out: `evidence.js: --by ${a.by} does not match this session's role ${who.roleId}` };
  if (!by) return { code: 2, out: 'evidence.js: --by <role> is required outside a role session' };
  const actor = who.actor || `operator/${by}`;
  const criteria = inp.story ? inp.story.criteria : [];
  if (!criteria.some((c) => String(c.n) === String(a.criterion))) return { code: 1, out: `evidence.js: ${id} has no criterion ${a.criterion} (criteria: ${criteria.map((c) => c.n).join(', ') || 'none'})` };

  if (cmd === 'waive') {
    const refused = DM_ONLY(who, env, 'waiving a criterion');
    if (refused) return refused;
    if (G.stateOf(bead) === 'deployed' || G.stateOf(bead) === 'verified' || bead.status === 'closed') return { code: 1, out: `evidence.js: refused (D3): criterion ${a.criterion} of ${id} is past its gate (${bead.status === 'closed' ? 'closed' : G.stateOf(bead)}); a waiver is recorded before the gate is due` };
    if (!a.record || !a.risk) return { code: 2, out: 'evidence.js: a waiver needs --record <dec-...> and --risk <the risk accepted>' };
    const v = (verifyRecord || require('./lib/operator-records.js').verifyRecord)(who.root, a.record);
    if (!v || !v.ok) return { code: 1, out: `evidence.js: ${a.record} does not verify (${v ? v.error || v.code : 'no result'}); a waiver cites an owner record` };
    const row = G.appendEvidence(who.root, id, { type: 'waiver', criterion: Number(a.criterion), record: a.record, risk: a.risk, by, actor, at });
    return { code: 0, out: `${row.id}: criterion ${a.criterion} waived under ${a.record}` };
  }

  if (cmd !== 'add') return { code: 2, out: USAGE };
  if (!['pass', 'fail'].includes(a.result) || !a.surface || !a.sha) return { code: 2, out: USAGE };
  const author = bead.assignee || m.author || null;
  const authorRole = G.roleOfActor(author, inp.instances);
  if ((author && actor === author) || (authorRole && by === authorRole)) return { code: 1, out: `evidence.js: refused: ${by} is the author's role (${author || authorRole}); the builder is not its own inspector. The Delivery Manager or a reality check records the row.` };
  const declared = inp.surfaces.find((s) => s.id === a.surface) || null;
  const observed = { ...tupleOf(declared) };
  for (const k of TUPLE) if (a[k] !== undefined) observed[k] = a[k];
  let why = null;
  if (!inp.surface) why = `the story declares no surface in surface.json`;
  else if (!declared) why = `${a.surface} is not in surface.json`;
  else if (a.surface !== inp.surface.id || !sameTuple(observed, tupleOf(inp.surface))) why = `observed on ${observed.app}, ${observed.mode} (${observed.host}), not ${describe(inp.surface)}`;
  else if (m.deployed_sha && a.sha !== m.deployed_sha) why = `on ${a.sha}, not the deployed ${m.deployed_sha}`;
  const row = G.appendEvidence(who.root, id, { type: 'row', criterion: Number(a.criterion), result: a.result, surface: a.surface, tuple: observed, sha: a.sha, run: a.run || null, by, actor, at, arm: why ? 'side' : 'main', ...(why ? { why } : {}) });
  if (why) return { code: 1, out: `evidence.js: refused as verification of ${inp.surface ? inp.surface.id : 'the story'} (D2): ${why}. Kept as side arm ${row.id}.` };
  const done = verifyIfDone(store, bead, { ...inp, rows: [...inp.rows, row] });
  return { code: 0, out: `${row.id}: criterion ${a.criterion} ${a.result} on ${a.surface} at ${a.sha}${m.deployed_sha ? '' : ' (the story has no deployed sha yet: it counts once the deploy is recorded at this sha)'}\n${doneText(done)}` };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `evidence.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
