#!/usr/bin/env node
// scripts/assumptions.js — the assumption register (R-14), probes (R-17, R-18) and the spike gate (R-16).
//   assumptions.js list [--initiative <slug>] [--plain] [--json]          read only; --plain is the
//       Chief of Staff's wording ("blocked until we check whether ...")
//   assumptions.js add --statement '<claim>' --kind <kind> --criteria '<story>#<n> ...' --owner DM|PM|owner
//       [--initiative <slug>]                                             Product or Delivery Manager
//   assumptions.js probe <spike bead> --host <where it ran> --observed '<what was seen>' --artifact <capture>
//       [--twin <recording>]   a probe row on the spike: the Reality Checker in the real host; a builder
//       holding the spike or the Spike Researcher for a local probe of an internal kind, or on a twin
//       built from a recording (source, date, request/response pairs); any other twin is not evidence
//   assumptions.js observe|refute <A-n> --evidence <ev-id> [--initiative <slug>]
//       Product or Delivery Manager, Spike Researcher, or the builder holding the spike. The row must be
//       an observation in the real host. A refutation stops the dependent stories and pauses their area.
//   assumptions.js ack <spike bead> --decision '<the decision taken>' [--record dec-...]
//       the decision owner's acknowledgement of the result: Delivery or Product Manager, citing the
//       owner's record when the spike's decision owner is the owner
// Exit codes: 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./lib/assumptions.js');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { whoAmI, ownerRecord } = require('./lib/gate-context.js');
const { parseStories } = require('./lib/plan-docs.js');

const USAGE = "usage: assumptions.js list [--initiative <slug>] [--plain] [--json] | add --statement '<claim>' --kind <kind> --criteria '<story>#<n> ...' --owner DM|PM|owner | probe <spike> --host <h> --observed '<seen>' --artifact <file> [--twin <recording>] | observe|refute <A-n> --evidence <ev-id> | ack <spike> --decision '<decision>' [--record dec-...]";
const VALUE = ['--initiative', '--statement', '--kind', '--criteria', '--owner', '--host', '--observed', '--artifact', '--twin', '--evidence', '--decision', '--record', '--project'];
const ROLE_WORD = { 'delivery-lead': 'Delivery Manager', 'product-manager': 'Product Manager', 'reality-checker': 'Reality Checker', 'spike-researcher': 'Spike Researcher', builder: 'builder' };

function parse(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plain' || a === '--json') out.flags.add(a.slice(2));
    else if (VALUE.includes(a)) { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); out[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out._.push(a);
  }
  return out;
}

const refuse = (text) => ({ code: 1, out: `assumptions.js: ${text}` });
// the role comes from the session marker; no marker, no write (fails closed)
function roleProblem(who, allowed) {
  if (!who.roleId) return 'this writes a gate record and needs a role session; none is active here.';
  if (!allowed.includes(who.roleId)) return `this is for the ${allowed.map((r) => ROLE_WORD[r]).join(' or ')} (this session is ${who.roleId}).`;
  return null;
}

// the initiative: named, else the only one (with a register, when one is needed)
function initiativeOf(root, given, { needRegister = true } = {}) {
  if (given) return given;
  const dir = path.join(root, '.delivery', 'initiatives');
  let all = [];
  try { all = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()); } catch (err) { all = []; }
  const hits = needRegister ? all.filter((d) => fs.existsSync(A.fileOf(root, d))) : all;
  return hits.length === 1 ? hits[0] : null;
}

const evBead = (id) => { const m = /^ev-(.+)-\d+$/.exec(String(id || '')); return m ? m[1] : null; };

// the row behind an ev- id, read against the head recorded in its bead
function evidenceRow(root, store, id) {
  const beadId = evBead(id);
  if (!beadId) return { problem: `${id} is not an evidence row id (ev-<bead>-<n>)` };
  const bead = store.show(beadId);
  const checked = G.readEvidenceChecked(root, beadId);
  const problem = G.headProblem(checked, bead);
  if (problem) return { problem: `${id}: ${problem}` };
  const row = checked.rows.find((r) => r.id === id);
  return row ? { row } : { problem: `no evidence row ${id}` };
}

const holds = (who, bead) => Boolean(bead && who.actor && bead.assignee === who.actor);

function list(root, a) {
  const slug = initiativeOf(root, a.initiative);
  if (!slug) return { code: 2, out: 'assumptions.js: name the initiative (--initiative <slug>)' };
  const reg = A.loadRegister(root, slug);
  if (a.flags.has('json')) return { code: 0, out: JSON.stringify({ initiative: slug, rows: reg.rows.map(({ line, ...r }) => r), problems: reg.problems }, null, 2) };
  if (a.flags.has('plain')) {
    const titles = new Map(parseStories(path.join(root, '.delivery', 'stories')).map((s) => [s.id, s.title]));
    const lines = [];
    for (const r of reg.rows.filter((x) => x.status === 'refuted' || (x.status === 'assumed' && x.kind === 'external-host'))) {
      for (const c of r.criteria) lines.push(A.plainLine(titles.get(c.story) || c.story, r));
    }
    return { code: 0, out: lines.join('\n') || 'Nothing is waiting on a check of the outside world.' };
  }
  const out = reg.rows.map((r) => `${r.id} ${r.kind} ${r.status}: ${r.statement} (on ${r.criteria.map((c) => (c.ns.length ? `${c.story}#${c.ns.join('#')}` : c.story)).join(' ') || 'nothing'}; evidence ${r.evidence || '-'}; owner ${A.OWNER_WORD[r.owner] || '-'})`);
  for (const p of reg.problems) out.push(`warning: ${p}`);
  return { code: 0, out: out.join('\n') || `no assumptions in ${path.relative(root, A.fileOf(root, slug))}` };
}

function add(root, who, a) {
  const wp = roleProblem(who, A.ACKERS);
  if (wp) return refuse(wp);
  const slug = initiativeOf(root, a.initiative, { needRegister: false });
  if (!slug) return { code: 2, out: 'assumptions.js: name the initiative (--initiative <slug>)' };
  const kind = String(a.kind || '').toLowerCase();
  if (!a.statement || !A.KINDS.includes(kind) || !A.ownerOf(a.owner) || !A.criteriaOf(a.criteria).length) return { code: 2, out: `assumptions.js: add needs --statement, --kind (${A.KINDS.join('|')}), --criteria '<story>#<n> ...' and --owner DM|PM|owner` };
  const file = A.fileOf(root, slug);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(__dirname, '..', 'templates', 'assumptions.md'), 'utf8');
  const reg = A.parseRegister(text);
  // an assumption starts assumed: only a probe in the real host makes it observed
  const row = { id: A.nextId(reg.rows), statement: a.statement, kind, criteria: A.criteriaOf(a.criteria), status: 'assumed', evidence: '', owner: A.ownerOf(a.owner) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, A.writeRow(text, reg, row));
  const next = kind === 'external-host' ? `; run materialise for its spike (it blocks ${row.criteria.map((c) => c.story).join(', ')})` : '';
  return { code: 0, out: `${row.id} added (${kind}, assumed)${next}` };
}

function probe(root, who, store, id, a, now) {
  if (!a.host || !a.observed || !a.artifact) return { code: 2, out: "assumptions.js: probe needs --host <where it ran>, --observed '<what was seen>' and --artifact <capture file>" };
  const wp = roleProblem(who, A.PROBERS);
  if (wp) return refuse(wp);
  const bead = store.show(id);
  if (!bead || !(bead.labels || []).includes('spike')) return refuse(`${id} is not a spike bead`);
  const m = bead.metadata || {};
  const slug = G.initiativeOf(bead);
  const reg = slug ? A.loadRegister(root, slug) : { rows: [] };
  const asm = reg.rows.find((r) => r.id === m.assumption) || null;
  if (who.roleId === 'builder' && !holds(who, bead)) return refuse(`a builder probes only the spike it holds: claim ${id} first (bd update ${id} --claim)`);
  if (asm && asm.kind === 'external-host' && !a.twin && who.roleId !== 'reality-checker') return refuse(`${asm.id} is about an external host: the Reality Checker probes it in the real host. Message the Delivery Manager to dispatch ${id}.`);
  const file = path.resolve(who.cwd || process.cwd(), a.artifact);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return refuse(`no capture file at ${a.artifact}: save what the probe showed (page text, log lines, the tool's input) first`);
  const twinWhy = a.twin ? A.recordingProblem(path.resolve(who.cwd || process.cwd(), a.twin)) : null;
  const rel = (p) => (p.startsWith(root + path.sep) ? path.relative(root, p) : p);
  const row = { type: 'probe', assumption: asm ? asm.id : null, host: a.host, observed: a.observed, artifact: rel(file),
    artifact_sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12), via: a.twin ? 'twin' : 'host',
    ...(a.twin ? { recording: rel(path.resolve(who.cwd || process.cwd(), a.twin)) } : {}), counts: !twinWhy, ...(twinWhy ? { why: twinWhy } : {}),
    by: who.roleId, actor: who.actor || who.instance, at: now || new Date().toISOString() };
  const full = G.appendEvidence(root, id, row);
  store.update(id, { metadata: { ...((store.show(id) || {}).metadata || m), evidence_head: full.head } });
  if (twinWhy) {
    W.record(root, { kind: 'twin-unrecorded', rule: 'R-18', bead: id, detail: `${full.id} ran on a twin: ${twinWhy}; it counts as an assumption, not evidence`, raisedBy: who.instance, instance: who.instance, now });
    return { code: 0, row: full, out: `${full.id}: recorded, but it does not count: ${twinWhy} (R-18). Probe the real host, or rebuild the twin from a recording.` };
  }
  const next = asm ? `assumptions.js observe|refute ${asm.id} --evidence ${full.id}` : `assumptions.js ack ${id} --decision '<decision>' (the decision owner)`;
  return { code: 0, row: full, out: `${full.id}: probe recorded on ${a.host}. Next: ${next}` };
}

function settle(root, who, store, verb, aId, a) {
  if (!a.evidence) return { code: 2, out: `assumptions.js: ${verb} needs --evidence <ev-id>` };
  const wp = roleProblem(who, [...A.ACKERS, 'spike-researcher', 'builder']);
  if (wp) return refuse(wp);
  const slug = initiativeOf(root, a.initiative);
  if (!slug) return { code: 2, out: 'assumptions.js: name the initiative (--initiative <slug>)' };
  const file = A.fileOf(root, slug);
  const text = fs.readFileSync(file, 'utf8');
  const reg = A.parseRegister(text);
  const row = reg.rows.find((r) => r.id === aId);
  if (!row) return refuse(`no ${aId} in ${path.relative(root, file)}`);
  const prefix = (who.team && who.team.prefix) || 'x';
  const spikeId = A.spikeIdFor(prefix, slug, row.id);
  if (who.roleId === 'builder' && !holds(who, store.show(spikeId))) return refuse(`a builder settles only the assumption of the spike it holds (${spikeId}): message the Delivery Manager`);
  const ev = evidenceRow(root, store, a.evidence);
  const why = ev.problem || A.observationProblem(ev.row, row);
  if (why) {
    W.record(root, { kind: 'assumption-not-observed', rule: 'R-15', bead: spikeId, detail: `${aId} not ${verb}d: ${why}`, raisedBy: who.instance, instance: who.instance });
    return refuse(`${aId} stays ${row.status}: ${why}.\nProbe it in the real host: assumptions.js probe ${spikeId} --host <h> --observed '<seen>' --artifact <capture>`);
  }
  const status = verb === 'observe' ? 'observed' : 'refuted';
  fs.writeFileSync(file, A.writeRow(text, reg, { ...row, status, evidence: a.evidence }));
  if (status === 'observed') return { code: 0, out: `${aId} observed (${a.evidence}).${row.kind === 'external-host' ? ` The dependent stories wait for the decision owner's acknowledgement: assumptions.js ack ${spikeId} --decision '<decision>'` : ''}` };
  // the andon: every dependent story stops, its area pauses for anything but fixes
  const stories = row.criteria.map((c) => `${prefix}-${c.story}`);
  for (const s of stories) W.record(root, { kind: 'assumption-refuted', rule: 'R-15', bead: s, detail: `${aId} refuted by ${a.evidence}: ${row.statement}. The story and its area wait until the design changes and ready is re-recorded`, raisedBy: who.instance, instance: who.instance });
  return { code: 0, out: `${aId} refuted (${a.evidence}): andon on ${stories.join(', ')}; their area takes fixes only.\nThe Product Manager changes the design (architecture and this register), then the Delivery Manager re-records ready: ready.js <story> --record` };
}

function ack(root, who, store, id, a, verifyRecord, now) {
  if (!a.decision) return { code: 2, out: "assumptions.js: ack needs --decision '<the decision taken>'" };
  const wp = roleProblem(who, A.ACKERS);
  if (wp) return refuse(wp);
  const bead = store.show(id);
  if (!bead || !(bead.labels || []).includes('spike')) return refuse(`${id} is not a spike bead`);
  const slug = G.initiativeOf(bead);
  const asm = slug ? A.loadRegister(root, slug).rows.find((r) => r.id === (bead.metadata || {}).assumption) : null;
  const st = A.spikeState(root, bead, { owner: asm ? asm.owner : null });
  if (st.problem) return refuse(`${id}'s evidence does not match what was recorded: ${st.problem}`);
  if (!st.result) return refuse(`${id} has no result yet: the probe comes first (assumptions.js probe ${id} ...)`);
  if (st.owner === 'owner') {
    const v = a.record ? ownerRecord(root, a.record, verifyRecord) : null;
    if (!v || !v.ok) return refuse(`${id} decides scope, so its decision owner is the owner: cite the owner's record (--record dec-...)${v ? `; ${v.why}` : ''}.\nAsk the Chief of Staff to put the result and its decision rule to the owner.`);
  }
  const full = G.appendEvidence(root, id, { type: 'ack', decision: a.decision, ...(a.record ? { record: a.record } : {}), by: who.roleId, actor: who.actor || who.instance, at: now || new Date().toISOString() });
  store.update(id, { metadata: { ...((store.show(id) || {}).metadata || {}), evidence_head: full.head } });
  return { code: 0, row: full, out: `${full.id}: ${id} acknowledged: ${a.decision}. Dependent stories may start once their assumptions are observed; close the spike with bd close ${id} --reason '<the answer, ${full.id}>'` };
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord, who: given } = {}) {
  const a = parse(argv);
  const [cmd, id] = a._;
  if (!cmd) return { code: 2, out: USAGE };
  const who = { cwd, ...(given || whoAmI({ cwd, env, project: a.project })) };
  if (!who.root) return { code: 2, out: 'assumptions.js: no project found; pass --project <root>' };
  if (cmd === 'list') return list(who.root, a);
  if (cmd === 'add') return add(who.root, who, a);
  if (!id) return { code: 2, out: USAGE };
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  if (cmd === 'probe') return probe(who.root, who, store, id, a, now);
  if (cmd === 'observe' || cmd === 'refute') return settle(who.root, who, store, cmd, id, a);
  if (cmd === 'ack') return ack(who.root, who, store, id, a, verifyRecord, now);
  return { code: 2, out: USAGE };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `assumptions.js: ${err.message}\n${USAGE}` }; }
  process.stdout.write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main };
