#!/usr/bin/env node
// scripts/ready.js — the ready gate (R-10, R-19, R-35) on one story.
//   ready.js <bead> [--record [--owner-record dec-...]] [--json] [--project <root>]
//   ready.js --story <story file> [--initiative <slug>] [--json] [--project <root>]
// Missing sections and mechanism-worded criteria are warnings, a divergence (D1, D2, D4) is a block:
// criteria resting on an external-host assumption still assumed, or on a spike result its decision
// owner has not acknowledged, or on a refuted assumption (the register, lib/assumptions.js).
// Without --record it only reports. --record (the Delivery Manager's role session) stamps the hash of
// the agreed criteria and requirements that the claim and close checks compare, writes what is still
// wrong to the ledger and resolves what was fixed; re-recording changed criteria needs a verified
// owner record and drops an earlier state-verified.
// With the typed judge on, the story is also asked shippable_unit (advisory: a warning at most).
// Exit codes: 0 ready (warnings allowed); 1 blocked or refused; 2 usage.
const fs = require('fs');
const path = require('path');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { loadSurface } = require('./lib/surface.js');
const { whoAmI, gateInputs, writerProblem, recordChecker } = require('./lib/gate-context.js');
const A = require('./lib/assumptions.js');

// the warnings a ready check raises; --record resolves the ones it no longer finds
const READY_KINDS = ['owners-ask', 'surface-missing', 'surface-unnamed', 'placeholder', 'no-criteria', 'mechanism', 'probe', 'reality-check-required', 'measurement-plan', 'shippable-unit', 'shippable-judge', 'not-ready', 'child-scope', 'assumption-unobserved', 'spike-unacked'];

const USAGE = 'usage: ready.js <bead> [--record [--owner-record dec-...]] [--json] | ready.js --story <file> [--initiative <slug>]';

function parse(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--record' || a === '--json') out.flags.add(a.slice(2));
    else if (['--owner-record', '--story', '--initiative', '--project'].includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2).replace('-', '_')] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

async function judgeShippable(story, surface, who, deps) {
  if (deps.ask) return deps.ask('shippable_unit', G.shippableState(story, surface));
  const J = require('./lib/judge.js');
  const config = J.judgeConfig(who.team);
  return config.enabled ? J.ask('shippable_unit', G.shippableState(story, surface), { config, projectRoot: who.root, gate: 'ready' }) : null;
}

function render(id, findings, extra, json) {
  if (json) return JSON.stringify({ id, ready: !findings.some((f) => f.level === 'block'), findings, ...extra }, null, 2);
  const blocks = findings.filter((f) => f.level === 'block');
  const head = blocks.length ? `${id}: not ready (${blocks.length} divergence(s))` : `${id}: ready${findings.length ? ` with ${findings.length} warning(s)` : ''}`;
  return [head, ...findings.map((f) => `  ${f.level} ${f.rule} ${f.code}: ${f.detail}${f.warning ? ` [${f.warning}]` : ''}`), ...(extra.recorded ? [`  recorded criteria hash ${extra.recorded}`] : [])].join('\n');
}

async function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord, ask, who: given } = {}) {
  const a = parse(argv);
  const who = given || whoAmI({ cwd, env, project: a.project });
  if (!who.root) return { code: 2, out: 'ready.js: no project found; pass --project <root>' };
  const deps = { ask };
  if (a.story) {
    const story = G.parseStory(fs.readFileSync(path.resolve(cwd, a.story), 'utf8'));
    const s = a.initiative ? loadSurface(who.root, a.initiative) : { surfaces: [], missing: true, problems: [] };
    const { surface } = G.storySurface(story, null, s.surfaces);
    const judged = await judgeShippable(story, surface, who, deps).catch(() => null);
    const findings = G.readyFindings({ story, surfaces: s.surfaces, surfaceMissing: s.missing || s.problems.length > 0, judged });
    return { code: findings.some((f) => f.level === 'block') ? 1 : 0, out: render(path.basename(a.story), findings, { hash: G.storyHash(story) }, a.flags.has('json')) };
  }
  const id = a._[0];
  if (!id) return { code: 2, out: USAGE };
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  const bead = store.show(id);
  if (!bead) return { code: 1, out: `ready.js: no bead ${id}` };
  const inp = gateInputs(who.root, bead, { bd: store, team: who.team });
  if (!inp.story) return { code: 1, out: `ready.js: ${id} has no readable story file (metadata story_file under .delivery/stories/)` };
  const judged = await judgeShippable(inp.story, inp.surface, who, deps).catch(() => null);
  const record = a.flags.has('record');
  // the pre-check reports only; nothing was claimed, so not-ready and scope drift are not findings here
  const findings = [...G.readyFindings({ story: inp.story, surfaces: inp.surfaces, surfaceMissing: inp.surfaceMissing, bead, judged }),
    ...G.claimDivergence({ story: inp.story, bead, parent: inp.parent, parentStory: inp.parentStory }).filter((f) => f.code !== 'not-ready' && f.code !== 'criteria-changed')];
  const asm = A.forStory(who.root, bead, { bd: store, team: who.team, recordOk: recordChecker(who.root, verifyRecord), storyId: (bead.metadata || {}).story || String(inp.story.meta.id || '') });
  findings.push(...asm.findings);
  const extra = {};
  if (record && !findings.some((f) => f.level === 'block')) {
    const wp = writerProblem(who);
    if (wp) return { code: 1, out: `ready.js: ${wp}` };
    const hash = G.storyHash(inp.story);
    const m = bead.metadata || {};
    const changed = m.ready_hash && m.ready_hash !== hash;
    if (changed) {
      // the owner's record: a peer agent's message is never one (PR 54 review B-1)
      const v = a.owner_record ? require('./lib/gate-context.js').ownerRecord(who.root, a.owner_record, verifyRecord) : null;
      if (!v || !v.ok) return { code: 1, out: `ready.js: ${id}'s criteria changed since they were made ready (D1).\nRe-record with an owner record: ready.js ${id} --record --owner-record <dec-...>${v ? ` (${v.why})` : ''}` };
    }
    // the assumptions ready was recorded on: a later refutation holds the story until ready is re-recorded
    const stamp = asm.links.length || m.ready_assumptions ? { ready_assumptions: [...new Set(asm.links.map((l) => l.a.id))] } : {};
    store.update(id, { metadata: { ...m, ready_hash: hash, ready_at: now || new Date().toISOString(), ...(a.owner_record ? { ready_record: a.owner_record } : {}), ...stamp } });
    // new agreed criteria need new evidence: an earlier verification no longer stands
    if (changed && (bead.labels || []).includes(G.STATE.verified)) store.update(id, { removeLabels: [G.STATE.verified] });
    // what is still wrong stays in the ledger; what was fixed is resolved
    const warns = findings.filter((x) => x.level === 'warn');
    for (const f of warns) {
      const row = W.record(who.root, { kind: f.code, rule: f.rule, bead: id, detail: f.detail, raisedBy: who.instance, instance: who.instance, now });
      if (row) f.warning = row.id;
    }
    W.resolve(who.root, { bead: id, kinds: READY_KINDS, still: warns.map((f) => f.detail), by: who.instance, instance: who.instance, reason: 'resolved: ready.js --record found it fixed', now });
    extra.recorded = hash;
  }
  return { code: findings.some((f) => f.level === 'block') ? 1 : 0, out: render(id, findings, extra, a.flags.has('json')) };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.stdout.write(`${r.out}\n`); process.exitCode = r.code; },
    (err) => { process.stderr.write(`ready.js: ${err.message}\n${USAGE}\n`); process.exitCode = 2; });
}

module.exports = { main };
