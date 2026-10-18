#!/usr/bin/env node
// scripts/assumptions.js — the assumption register (R-14), probes (R-17, R-18) and the spike gate (R-16).
// The only writer of .delivery/initiatives/<slug>/assumptions.md: every lane refuses a direct write.
//   assumptions.js list [--initiative <slug>] [--plain] [--json]          read only; --plain is the
//       Chief of Staff's wording ("blocked until we check whether ..."), over every initiative
//   assumptions.js add --statement '<claim>' --kind <kind> --criteria '<story>#<n> ...' --owner DM|PM|owner
//       [--initiative <slug>]                                             Product or Delivery Manager
//   assumptions.js probe <spike bead> --host <where it ran> --observed '<what was seen>' --artifact <capture>
//       [--twin <recording>]   a probe row on the spike. An external host: the Reality Checker, in the
//       real host, never a twin. Other kinds: also a builder holding the spike or the Spike Researcher;
//       a twin counts only for internal and platform kinds, built from a recording (source, capture time,
//       recorder, request/response pairs), whose sha256, recorder and time the row keeps
//   assumptions.js observe|refute <A-n> --evidence <ev-id> [--initiative <slug>]
//       Product or Delivery Manager, Spike Researcher, or the builder holding the spike. A refuted
//       assumption is not observed again: it returns only through a new design (a new row) or reopen.
//   assumptions.js reopen <A-n> [--initiative <slug>]   Product Manager: a refuted assumption back to
//       assumed; only a Reality Checker probe newer than the reopen observes it again
//   assumptions.js ack <spike bead> --result <ev-id> --decision '<the decision taken>' [--record dec-...]
//       the decision owner's acknowledgement of that result: the Delivery or Product Manager named as
//       its owner, or either citing the owner's record scoped to the spike when the owner decides
// Exit codes: 0 done; 1 refused; 2 usage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./lib/assumptions.js');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { whoAmI, ownerRecord } = require('./lib/gate-context.js');
const { parseStories } = require('./lib/plan-docs.js');

const USAGE = "usage: assumptions.js list [--initiative <slug>] [--plain] [--json] | add --statement '<claim>' --kind <kind> --criteria '<story>#<n> ...' --owner DM|PM|owner | probe <spike> --host <h> --observed '<seen>' --artifact <file> [--twin <recording>] | observe|refute|reopen <A-n> [--evidence <ev-id>] | ack <spike> --result <ev-id> --decision '<decision>' [--record dec-...]";
const VALUE = ['--initiative', '--statement', '--kind', '--criteria', '--owner', '--host', '--observed', '--artifact', '--twin', '--evidence', '--result', '--decision', '--record', '--project'];
const ROLE_WORD = { 'delivery-lead': 'Delivery Manager', 'product-manager': 'Product Manager', 'reality-checker': 'Reality Checker', 'spike-researcher': 'Spike Researcher', builder: 'builder' };
const DM = 'Message the Delivery Manager';

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

// a refusal is two lines: what and why, then the way out (a command, or whom to message)
const refuse = (text, way) => ({ code: 1, out: `assumptions.js: ${text}\n${way}` });
// the role comes from the session marker; no marker, no write (fails closed)
function roleProblem(who, allowed) {
  if (!who.roleId) return 'this writes a gate record and needs a role session; none is active here.';
  if (!allowed.includes(who.roleId)) return `this is for the ${allowed.map((r) => ROLE_WORD[r]).join(' or ')} (this session is ${who.roleId}).`;
  return null;
}

function initiatives(root) {
  const dir = path.join(root, '.delivery', 'initiatives');
  try { return fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort(); } catch (err) { return []; }
}
const withRegister = (root) => initiatives(root).filter((d) => fs.existsSync(A.fileOf(root, d)));
// the initiative: named, else the only one (with a register, when one is needed)
function initiativeOf(root, given, { needRegister = true } = {}) {
  if (given) return given;
  const hits = needRegister ? withRegister(root) : initiatives(root);
  return hits.length === 1 ? hits[0] : null;
}
const noInitiative = { code: 2, out: 'assumptions.js: name the initiative (--initiative <slug>)' };
const holds = (who, bead) => Boolean(bead && who.actor && bead.assignee === who.actor);
const showOf = (store, id) => { try { return store.show(id); } catch (err) { return null; } };

function list(root, a, store, verifyRecord) {
  if (a.flags.has('plain')) {
    const slugs = a.initiative ? [a.initiative] : withRegister(root);
    if (!slugs.length) return { code: 0, out: 'No assumptions recorded.' };
    const titles = new Map(parseStories(path.join(root, '.delivery', 'stories')).map((s) => [s.id, s.title]));
    const R = A.registers(root, { bd: store, verifyRecord });
    const lines = [];
    for (const slug of slugs) {
      for (const r of R.rowsFor(slug).filter((x) => x.kind === 'external-host' && (x.status !== 'observed' || !x.acked))) {
        for (const c of r.criteria) lines.push(A.plainLine(titles.get(c.story) || 'A story not yet written up', r));
      }
    }
    return { code: 0, out: lines.join('\n') || 'Nothing is waiting on a check of the outside world or on a decision about one.' };
  }
  const slug = initiativeOf(root, a.initiative);
  if (!slug) return withRegister(root).length ? noInitiative : { code: 0, out: 'No assumptions recorded.' };
  const reg = A.loadRegister(root, slug);
  if (a.flags.has('json')) return { code: 0, out: JSON.stringify({ initiative: slug, rows: reg.rows.map(({ line, ...r }) => r), problems: reg.problems }, null, 2) };
  const out = reg.rows.map((r) => `${r.id} ${r.kind} ${r.status}: ${r.statement} (on ${r.criteria.map((c) => (c.ns.length ? `${c.story}#${c.ns.join('#')}` : c.story)).join(' ') || 'nothing'}; evidence ${r.evidence || '-'}; owner ${A.OWNER_WORD[r.owner] || '-'})`);
  for (const p of reg.problems) out.push(`warning: ${p}`);
  return { code: 0, out: out.join('\n') || `no assumptions in ${path.relative(root, A.fileOf(root, slug))}` };
}

function add(root, who, a) {
  const wp = roleProblem(who, A.ACKERS);
  if (wp) return refuse(wp, `${DM} or the Product Manager with the assumption and the criteria it sits on.`);
  const slug = initiativeOf(root, a.initiative, { needRegister: false });
  if (!slug) return noInitiative;
  const kind = String(a.kind || '').toLowerCase();
  if (!a.statement || !A.KINDS.includes(kind) || !A.ownerOf(a.owner) || !A.criteriaOf(a.criteria).length) return { code: 2, out: `assumptions.js: add needs --statement, --kind (${A.KINDS.join('|')}), --criteria '<story>#<n> ...' and --owner DM|PM|owner` };
  const file = A.fileOf(root, slug);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(__dirname, '..', 'templates', 'assumptions.md'), 'utf8');
  const reg = A.parseRegister(text);
  // an assumption starts assumed: only a probe makes it observed
  const row = { id: A.nextId(reg.rows), statement: a.statement, kind, criteria: A.criteriaOf(a.criteria), status: 'assumed', evidence: '', owner: A.ownerOf(a.owner) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, A.writeRow(text, reg, row));
  const next = kind === 'external-host' ? `; run materialise for its spike (it blocks ${row.criteria.map((c) => c.story).join(', ')})` : '';
  return { code: 0, out: `${row.id} added (${kind}, assumed)${next}` };
}

function appendRow(root, store, id, row) {
  const full = G.appendEvidence(root, id, row);
  store.update(id, { metadata: { ...((showOf(store, id) || {}).metadata || {}), evidence_head: full.head } });
  return full;
}
const isSpike = (bead) => Boolean(bead && ((bead.labels || []).includes('spike') || (bead.metadata && bead.metadata.assumption)));

function probe(root, who, store, id, a, now) {
  if (!a.host || !a.observed || !a.artifact) return { code: 2, out: "assumptions.js: probe needs --host <where it ran>, --observed '<what was seen>' and --artifact <capture file>" };
  const wp = roleProblem(who, A.PROBERS);
  if (wp) return refuse(wp, `${DM} to dispatch the probe.`);
  const bead = showOf(store, id);
  const m = (bead && bead.metadata) || {};
  if (!isSpike(bead)) return refuse(`${id} is not a spike bead.`, 'Find the spike: `bd list --label spike`.');
  const slug = G.initiativeOf(bead);
  const asm = slug ? A.loadRegister(root, slug).rows.find((r) => r.id === m.assumption) || null : null;
  if (who.roleId === 'builder' && !holds(who, bead)) return refuse('a builder probes only the spike it holds.', `Claim it first: \`bd update ${id} --claim\`.`);
  if (asm && asm.kind === 'external-host' && (a.twin || who.roleId !== 'reality-checker')) return refuse(`${asm.id} is about an external host: only the Reality Checker's probe in the real host observes it, never a twin.`, `${DM} to dispatch ${id} to the Reality Checker.`);
  const base = who.cwd || process.cwd();
  const file = path.resolve(base, a.artifact);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return refuse(`no capture file at ${a.artifact}.`, "Save what the probe showed (page text, log lines, the tool's input) to a file, then run `assumptions.js probe` again.");
  let twin = null;
  if (a.twin) {
    const tf = path.resolve(base, a.twin);
    const rec = A.readRecording(tf);
    const why = rec.problem || (asm && !A.TWIN_KINDS.includes(asm.kind) ? `a twin counts only for internal and platform assumptions, not ${asm.kind}` : null);
    twin = { why, rec, file: tf };
  }
  const rel = (p) => (p.startsWith(root + path.sep) ? path.relative(root, p) : p);
  const row = { type: 'probe', assumption: asm ? asm.id : null, host: a.host, observed: a.observed, artifact: rel(file),
    artifact_sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12), via: twin ? 'twin' : 'host',
    ...(twin ? { recording: rel(twin.file), ...(twin.why ? {} : { recording_sha256: twin.rec.sha256, recorded_by: twin.rec.recorded_by, recorded_at: twin.rec.recorded_at, recorded_from: twin.rec.source }) } : {}),
    counts: !(twin && twin.why), ...(twin && twin.why ? { why: twin.why } : {}),
    by: who.roleId, actor: who.actor || who.instance, at: now || new Date().toISOString() };
  const full = appendRow(root, store, id, row);
  if (twin && twin.why) {
    W.record(root, { kind: 'twin-unrecorded', rule: 'R-18', bead: id, detail: `${full.id} ran on a twin: ${twin.why}; it counts as an assumption, not evidence`, raisedBy: who.instance, instance: who.instance, now });
    return { code: 0, row: full, out: `${full.id}: recorded, but it does not count: ${twin.why} (R-18).\nProbe the real host, or rebuild the twin from a recording: \`assumptions.js probe ${id} ... --twin <recording>\`` };
  }
  const next = asm ? `assumptions.js observe|refute ${asm.id} --evidence ${full.id}` : `assumptions.js ack ${id} --result ${full.id} --decision '<decision>' (the decision owner)`;
  return { code: 0, row: full, out: `${full.id}: probe recorded on ${a.host}. Next: ${next}` };
}

function loadRow(root, a, aId) {
  const slug = initiativeOf(root, a.initiative);
  if (!slug) return { usage: noInitiative };
  const file = A.fileOf(root, slug);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { text = ''; }
  const reg = A.parseRegister(text);
  return { slug, file, text, reg, row: reg.rows.find((r) => r.id === aId) || null };
}

function settle(root, who, store, verb, aId, a) {
  if (!a.evidence) return { code: 2, out: `assumptions.js: ${verb} needs --evidence <ev-id>` };
  const wp = roleProblem(who, [...A.ACKERS, 'spike-researcher', 'builder']);
  if (wp) return refuse(wp, `${DM} with the evidence row id.`);
  const L = loadRow(root, a, aId);
  if (L.usage) return L.usage;
  const { slug, file, text, reg, row } = L;
  if (!row) return refuse(`no ${aId} in ${path.relative(root, file)}.`, `List them: \`assumptions.js list --initiative ${slug}\`.`);
  if (verb === 'observe' && row.status === 'refuted') return refuse(`${aId} was refuted; a later probe does not observe it again.`, `The Product Manager changes the design (a new row with \`assumptions.js add\`) or reopens it: \`assumptions.js reopen ${aId}\`.`);
  const ev = A.evidenceOf(root, store, slug, row, a.evidence);
  if (!ev.why && who.roleId === 'builder' && !holds(who, ev.bead)) return refuse(`a builder settles only the assumption of the spike it holds (${ev.bead.id}).`, `${DM} with ${a.evidence}.`);
  if (ev.why) {
    W.record(root, { kind: 'assumption-not-observed', rule: 'R-15', bead: null, detail: `${aId} not ${verb}d: ${ev.why}`, raisedBy: who.instance, instance: who.instance });
    return refuse(`${aId} stays ${row.status}: ${ev.why}.`, `${DM} to dispatch a probe of the real host (\`assumptions.js probe <spike> ...\`).`);
  }
  const status = verb === 'observe' ? 'observed' : 'refuted';
  fs.writeFileSync(file, A.writeRow(text, reg, { ...row, status, evidence: a.evidence }));
  const spike = ev.bead.id;
  if (status === 'observed') return { code: 0, out: `${aId} observed (${a.evidence}). Its decision owner (${A.OWNER_WORD[A.decisionOwner(row, ev.bead)] || 'DM or PM'}) acknowledges the result before a dependent story starts: assumptions.js ack ${spike} --result ${a.evidence} --decision '<decision>'` };
  const prefix = (who.team && who.team.prefix) || spike.slice(0, Math.max(0, spike.indexOf(`-${slug}-`)));
  const stories = row.criteria.map((c) => `${prefix}-${c.story}`);
  for (const s of stories) W.record(root, { kind: 'assumption-refuted', rule: 'R-15', bead: s, detail: `${aId} refuted by ${a.evidence}: ${row.statement}. Change the design, then re-record ready`, raisedBy: who.instance, instance: who.instance });
  if (row.kind !== 'external-host') return { code: 0, out: `${aId} refuted (${a.evidence}): a warning on ${stories.join(', ')}; change the design, then re-record ready.` };
  return { code: 0, out: `${aId} refuted (${a.evidence}): andon on ${stories.join(', ')}; their area takes fixes only.\nThe Product Manager changes the design (architecture and this register), then the Delivery Manager re-records ready: ready.js <story> --record` };
}

function reopen(root, who, store, aId, a, now) {
  const wp = roleProblem(who, ['product-manager']);
  if (wp) return refuse(wp, 'Message the Product Manager, who runs `assumptions.js reopen`.');
  const L = loadRow(root, a, aId);
  if (L.usage) return L.usage;
  const { slug, file, text, reg, row } = L;
  if (!row || row.status !== 'refuted') return refuse(`only a refuted assumption is reopened (${aId} is ${row ? row.status : 'not in the register'}).`, `List them: \`assumptions.js list --initiative ${slug}\`.`);
  const ev = /^ev-(.+)-\d+$/.exec(row.evidence || '');
  const spike = ev ? showOf(store, ev[1]) : null;
  if (!spike) return refuse(`${aId}'s refuting row is on no bead that is still there.`, 'Add the changed design as a new assumption: `assumptions.js add ...`.');
  // the reopen goes on the spike's chain, so a probe from before it no longer observes the assumption
  const full = appendRow(root, store, spike.id, { type: 'reopen', assumption: aId, after: row.evidence, by: who.roleId, actor: who.actor || who.instance, at: now || new Date().toISOString() });
  fs.writeFileSync(file, A.writeRow(text, reg, { ...row, status: 'assumed', evidence: '' }));
  return { code: 0, out: `${aId} reopened (${full.id}): assumed again; only a Reality Checker probe newer than this observes it.\n${DM} to dispatch ${spike.id}.` };
}

function ack(root, who, store, id, a, verifyRecord, now) {
  if (!a.decision || !a.result) return { code: 2, out: "assumptions.js: ack needs --result <the probe row it acknowledges> and --decision '<the decision taken>'" };
  const wp = roleProblem(who, A.ACKERS);
  if (wp) return refuse(wp, `${DM} with the result and the decision it calls for.`);
  const bead = showOf(store, id);
  const m = (bead && bead.metadata) || {};
  if (!isSpike(bead)) return refuse(`${id} is not a spike bead.`, 'Find the spike: `bd list --label spike`.');
  const slug = G.initiativeOf(bead);
  const asm = slug ? A.loadRegister(root, slug).rows.find((r) => r.id === m.assumption) || null : null;
  const st = A.spikeState(root, bead, { a: asm });
  if (st.problem) return refuse(`${id}'s evidence does not match what was recorded: ${st.problem}.`, `${DM}: restore the evidence file to its last recorded row.`);
  const res = st.rows.find((r) => r.id === a.result);
  if (!res || res.type !== 'probe' || res.counts === false) return refuse(`${a.result} is not a counting result on ${id}.`, `Probe first: \`assumptions.js probe ${id} ...\`, then acknowledge that row.`);
  const owner = asm ? A.decisionOwner(asm, bead) : A.ownerOf(m.decision_owner);
  if (owner === 'owner') {
    const v = a.record ? ownerRecord(root, a.record, verifyRecord) : null;
    const why = !v ? "cite the owner's record (--record dec-...)" : !v.ok ? v.why : !A.scopedTo(v.head, id, asm ? asm.id : null) ? `${a.record} is not scoped to ${id}${asm ? ` or ${asm.id}` : ''}` : null;
    if (why) return refuse(`${id} decides scope, so its decision owner is the owner: ${why}.`, 'Message the Chief of Staff to put the result and its decision rule to the owner.');
  } else if (owner && owner !== who.roleId) return refuse(`${id}'s decision owner is the ${ROLE_WORD[owner]}, so the acknowledgement is theirs.`, `Message the ${ROLE_WORD[owner]} with ${a.result}; \`assumptions.js ack\` is theirs to run.`);
  const full = appendRow(root, store, id, { type: 'ack', assumption: asm ? asm.id : null, result: a.result, decision: a.decision, ...(a.record ? { record: a.record } : {}), by: who.roleId, actor: who.actor || who.instance, at: now || new Date().toISOString() });
  return { code: 0, row: full, out: `${full.id}: ${a.result} on ${id} acknowledged: ${a.decision}. Dependent stories may start once their assumptions are observed; close the spike with bd close ${id} --reason '<the answer, ${full.id}>'` };
}

function main(argv, { cwd = process.cwd(), env = process.env, bd, now, verifyRecord, who: given } = {}) {
  const a = parse(argv);
  const [cmd, id] = a._;
  if (!cmd) return { code: 2, out: USAGE };
  const who = { cwd, ...(given || whoAmI({ cwd, env, project: a.project })) };
  if (!who.root) return { code: 2, out: 'assumptions.js: no project found; pass --project <root>' };
  const store = bd || require('./lib/bd.js').makeBd({ cwd: who.root });
  if (cmd === 'list') return list(who.root, a, store, verifyRecord);
  if (cmd === 'add') return add(who.root, who, a);
  if (!id) return { code: 2, out: USAGE };
  if (cmd === 'probe') return probe(who.root, who, store, id, a, now);
  if (cmd === 'observe' || cmd === 'refute') return settle(who.root, who, store, cmd, id, a);
  if (cmd === 'reopen') return reopen(who.root, who, store, id, a, now);
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
