// scripts/lib/assumptions.js — the assumption register (R-14), the external-assumption gate (D4, R-15),
// the spike gate (R-16) and the twins rule (R-18). Pure over the register's text, a story's links and the
// evidence rows; assumptions.js, ready.js, materialise and the bd guard supply the reads.
//
// The register is .delivery/initiatives/<slug>/assumptions.md, one table row per assumption: id (A-n),
// statement, kind, the criteria it sits on (<story>#<n>, or <story> for all of them), status (assumed,
// observed, refuted), evidence (an ev- row id) and the decision owner (DM, PM or owner). The register's
// Criteria column is the one link between a story and its assumptions. Every lane refuses a direct
// write to the register (only assumptions.js writes it), and the gates still re-verify every observed or
// refuted status against its evidence row, treating one without a valid row as assumed.
//
// Enforcement (ruling 3): only an external-host assumption blocks, because that is the divergence the
// Vault paid for (#478 built on the documentation's reading of the file host). A story whose criteria
// sit on one that is assumed, or that has a spike whose result the decision owner has not acknowledged,
// is not ready and its claim is refused (D4); a refuted one stops the dependent stories and pauses their
// area (fixes only) until the design changes and ready is re-recorded. Every other kind is a warning.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./gates.js');
const { splitCells, spikeKey } = require('./plan-docs.js');

const KINDS = ['external-host', 'platform', 'data', 'customer', 'internal'];
const STATUSES = ['assumed', 'observed', 'refuted'];
const COLS = ['id', 'statement', 'kind', 'criteria', 'status', 'evidence', 'owner'];
const HEADER = '| Id | Statement | Kind | Criteria | Status | Evidence | Decision owner |';
// who may write a probe row: the Reality Checker in the real host; a builder or Spike Researcher for a
// local probe of an internal kind, or a twin built from recorded traffic
const PROBERS = ['reality-checker', 'spike-researcher', 'builder'];
const ACKERS = ['delivery-lead', 'product-manager'];

const fileOf = (root, slug) => path.join(root, '.delivery', 'initiatives', slug, 'assumptions.md');
const ownerOf = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (/^(dm|delivery manager|delivery-lead)$/.test(s)) return 'delivery-lead';
  if (/^(pm|product manager|product-manager)$/.test(s)) return 'product-manager';
  if (s === 'owner') return 'owner';
  return null;
};
const OWNER_WORD = { 'delivery-lead': 'DM', 'product-manager': 'PM', owner: 'owner' };

// "<story>#<n>" items (a bare story id means every criterion), separated by spaces or commas
function criteriaOf(cell) {
  const out = [];
  for (const t of String(cell || '').replace(/`/g, '').split(/[\s,;]+/).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9.-]*?)(?:#(\d+))?$/i.exec(t);
    if (!m) continue;
    const hit = out.find((x) => x.story === m[1]);
    const n = m[2] ? Number(m[2]) : null;
    if (!hit) out.push({ story: m[1], ns: n ? [n] : [] });
    else if (n && hit.ns.length && !hit.ns.includes(n)) hit.ns.push(n);
    else if (!n) hit.ns = [];
  }
  return out;
}

// { rows, problems, table: { start, end } } — the first table whose header starts with Id
function parseRegister(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  const problems = [];
  const start = lines.findIndex((l) => /^\|\s*id\s*\|/i.test(l.trim()));
  if (start < 0) return { rows, problems, table: null, lines };
  let end = start + 1;
  for (; end < lines.length && lines[end].trim().startsWith('|'); end++) {
    const cells = splitCells(lines[end]);
    if (cells.every((c) => /^:?-+:?$/.test(c)) || !cells[0]) continue;
    const r = Object.fromEntries(COLS.map((k, i) => [k, (cells[i] || '').trim()]));
    r.kind = r.kind.toLowerCase();
    r.status = r.status.toLowerCase();
    r.owner = ownerOf(r.owner);
    // a refuted row's links, once the Product Manager retires it: kept in the cell as history
    const retired = /^retired:\s*(.*)$/i.exec(r.criteria);
    r.retired = retired ? criteriaOf(retired[1]) : [];
    r.criteria = retired ? [] : criteriaOf(r.criteria);
    r.line = end;
    if (!/^A-\d+$/.test(r.id)) problems.push(`assumption "${r.id}": the id is not A-<n>`);
    if (!KINDS.includes(r.kind)) problems.push(`${r.id}: kind "${r.kind}" is not one of ${KINDS.join(', ')}`);
    if (!STATUSES.includes(r.status)) problems.push(`${r.id}: status "${r.status}" is not one of ${STATUSES.join(', ')}`);
    if (r.status !== 'assumed' && !/^ev-/.test(r.evidence)) problems.push(`${r.id} is ${r.status} with no ev- evidence row`);
    if (!r.criteria.length && !r.retired.length) problems.push(`${r.id} sits on no criteria (<story>#<n>)`);
    rows.push(r);
  }
  return { rows, problems, table: { start, end }, lines };
}

const loadRegister = (root, slug) => { try { return parseRegister(fs.readFileSync(fileOf(root, slug), 'utf8')); } catch (err) { return { rows: [], problems: [], table: null, missing: true }; } };

const esc = (s) => String(s || '').replace(/\|/g, '\\|');
const renderCriteria = (cs) => cs.map((c) => (c.ns.length ? c.ns.map((n) => `${c.story}#${n}`).join(' ') : c.story)).join(' ');
const criteriaCell = (r) => ((r.retired || []).length ? `retired: ${renderCriteria(r.retired)}` : renderCriteria(r.criteria));
const renderRow = (r) => `| ${[r.id, esc(r.statement), r.kind, criteriaCell(r), r.status, r.evidence || '', OWNER_WORD[r.owner] || ''].join(' | ')} |`;

// the register's text with one row replaced (patch) or appended (row without a line)
function writeRow(text, reg, row) {
  const lines = String(text || '').split(/\r?\n/);
  if (row.line !== undefined) { lines[row.line] = renderRow(row); return lines.join('\n'); }
  if (!reg.table) return `${String(text || '').replace(/\s*$/, '')}\n\n## Register\n\n${HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n${renderRow(row)}\n`;
  lines.splice(reg.table.end, 0, renderRow(row));
  return lines.join('\n');
}

const nextId = (rows) => `A-${rows.reduce((n, r) => Math.max(n, Number((/^A-(\d+)$/.exec(r.id) || [0, 0])[1])), 0) + 1}`;

// the assumptions a story sits on: [{ a, ns }] (ns empty: every criterion)
const linksFor = (rows, storyId) => rows.flatMap((a) => a.criteria.filter((c) => c.story === storyId).map((c) => ({ a, ns: c.ns })));

// the spike bead that answers an assumption: <prefix>-<initiative>-spike-<a-n>, the id materialise gives it
const spikeIdFor = (prefix, initiative, aId) => `${prefix}-${initiative}-spike-${spikeKey(aId)}`;
// a story bead is <prefix>-<story id>; the prefix is what is left
function prefixOf(bead, team) {
  const story = String((bead.metadata && bead.metadata.story) || '');
  if (story && bead.id.endsWith(`-${story}`)) return bead.id.slice(0, -(story.length + 1));
  return (team && team.prefix) || String(bead.id).split('-')[0];
}

// ---- the twins rule (R-18) ----
// A twin counts as a probe only for an internal or platform assumption, and only when built from a
// recording: its source, capture time and recorder, and the captured request/response pairs. The probe
// row keeps the recording's sha256, recorder and capture time, so a recording changed afterwards no
// longer matches. Who made the recording is what the file says: cooperative trust, like the rest of the
// record. An external host is never observed through a twin.
const TWIN_KINDS = ['internal', 'platform'];
function readRecording(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { problem: 'no readable recording (a JSON file of captured request/response pairs)' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { problem: 'the recording is not a JSON object of captured traffic' };
  const har = j.log && Array.isArray(j.log.entries) ? j.log.entries : null;
  const pairs = har || j.exchanges || j.entries;
  const first = har && har[0] && typeof har[0] === 'object' ? har[0] : {};
  const source = j.source || (first.request && first.request.url);
  const date = j.recorded_at || j.date || first.startedDateTime;
  const by = j.recorded_by || (j.log && j.log.creator && j.log.creator.recorded_by);
  if (!source) return { problem: 'the recording names no source (the real host it was captured from)' };
  if (!date || Number.isNaN(Date.parse(date))) return { problem: 'the recording has no capture date and time' };
  if (!by) return { problem: 'the recording names no recorder (recorded_by: the role that captured it)' };
  const real = (x) => x && typeof x === 'object' && Object.keys(x).length > 0;
  if (!Array.isArray(pairs) || !pairs.length || !pairs.every((e) => e && real(e.request) && real(e.response))) return { problem: 'the recording holds no captured request and response' };
  return { problem: null, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), recorded_by: String(by), recorded_at: String(date), source: String(source) };
}
const recordingProblem = (file) => readRecording(file).problem;

// Why an evidence row is not an observation of assumption a, or null when it is. Only a counting probe
// row on that assumption counts: for an external host the Reality Checker's, in the real host; for the
// other kinds a probe by a builder, Spike Researcher or Reality Checker, through a recorded twin only for
// internal and platform kinds.
function observationProblem(row, a) {
  if (!row) return 'no such evidence row';
  if (row.type !== 'probe') return `${row.id} is not a probe in the real host (assumptions.js probe)`;
  if (row.assumption !== a.id) return `${row.id} probed ${row.assumption || 'no assumption'}, not ${a.id}`;
  if (row.counts === false) return `${row.id} does not count (${row.why}): an assumption, not evidence (R-18)`;
  if (!PROBERS.includes(row.by)) return `${row.id} was written by ${row.by}, not a probe`;
  if (a.kind === 'external-host' && (row.by !== 'reality-checker' || row.via !== 'host')) return `${row.id} is not the Reality Checker's probe of the real host, the only observation of an external host`;
  if (row.via === 'twin' && !TWIN_KINDS.includes(a.kind)) return `${row.id} ran on a twin, which counts only for internal and platform assumptions`;
  return null;
}

// ---- re-verifying the register at the gates ----
// The register's status is a claim; the gates believe it only when its evidence row backs it: the row
// exists on an intact chain, on a bead of this initiative, is an observation of this assumption, and
// no reopen of the assumption came after it. Anything else is treated as assumed (D4 for an external
// host). An observed row also carries whether its decision owner acknowledged that result.
const decisionOwner = (a, bead) => {
  const m = ownerOf(bead && bead.metadata && bead.metadata.decision_owner);
  return a.owner === 'owner' || m === 'owner' ? 'owner' : a.owner || m || null;
};
// the owner's record behind an owner-decided acknowledgement must be scoped to that spike or assumption
const scopedTo = (head, spikeId, aId) => {
  const sc = (head && head.scope) || {};
  return (sc.beads || []).includes(spikeId) || (sc.labels || []).some((l) => l === `assumption:${aId}` || l === `spike:${spikeId}`);
};
// the acknowledgement of `row` (a result on this chain): newer than it, naming it, by its decision owner
function ackOf(rows, row, owner, { ownerOk = () => false, spikeId, aId } = {}) {
  return rows.find((r) => r.type === 'ack' && r.result === row.id && r.seq > row.seq
    && (owner === 'owner' ? Boolean(r.record) && ownerOk(r.record, spikeId, aId) : owner ? r.by === owner : ACKERS.includes(r.by))) || null;
}
const latestResult = (rows) => [...rows].reverse().find((r) => r.type === 'probe' && r.counts !== false) || null;

// forStatus: the status the row is to back; once an assumption was reopened, only the Reality Checker's
// probe in the real host observes it again, whatever its kind (a refutation is not restricted).
function evidenceOf(root, bd, slug, a, evId, { forStatus = a.status } = {}) {
  const m = /^ev-(.+)-\d+$/.exec(String(evId || ''));
  if (!m) return { why: `${evId || 'no evidence'} is not an evidence row id` };
  let bead = null;
  try { bead = bd ? bd.show(m[1]) : null; } catch (err) { bead = null; }
  if (!bead) return { why: `its evidence bead ${m[1]} is not there` };
  if (G.initiativeOf(bead) !== slug) return { why: `${evId} is on a bead of another initiative` };
  const checked = G.readEvidenceChecked(root, bead.id);
  const problem = G.headProblem(checked, bead);
  if (problem) return { why: `${evId}: ${problem}` };
  const row = checked.rows.find((r) => r.id === evId);
  const why = observationProblem(row, a);
  if (why) return { why };
  if (checked.rows.some((r) => r.type === 'reopen' && r.assumption === a.id && r.seq > row.seq)) return { why: `${a.id} was reopened after ${evId}: a new probe is needed` };
  if (forStatus === 'observed' && checked.rows.some((r) => r.type === 'reopen' && r.assumption === a.id) && (row.by !== 'reality-checker' || row.via !== 'host')) return { why: `${a.id} was reopened: only the Reality Checker's probe in the real host observes it again` };
  return { why: null, bead, row, rows: checked.rows };
}

// rows as the gates see them: status re-verified, acked for observed ones. ownerOk(record, spikeId, aId)
// Retired links count as retired only on a refuted row whose chain holds a retire row after the
// refutation (assumptions.js retire); anywhere else they are live links again.
function verifyRows(root, bd, slug, rows, { ownerOk } = {}) {
  return rows.map((a0) => {
    const live = { ...a0, criteria: [...a0.criteria, ...(a0.retired || [])], retired: [] };
    if (a0.status !== 'observed' && a0.status !== 'refuted') return (a0.retired || []).length ? { ...live, unverified: `${a0.id} has retired links but is ${a0.status}, so they stay live` } : { ...a0 };
    const ev = evidenceOf(root, bd, slug, a0, a0.evidence);
    const retiredOk = a0.status === 'refuted' && !ev.why && ev.rows.some((r) => r.type === 'retire' && r.assumption === a0.id && r.seq > ev.row.seq);
    const a = (a0.retired || []).length && !retiredOk ? { ...live, unverified: `${a0.id}'s links are marked retired with no retire row, so they stay live` } : { ...a0 };
    if (ev.why) return { ...a, status: 'assumed', unverified: `${a.id} says ${a.status}, but ${ev.why}; treated as assumed` };
    const owner = decisionOwner(a, ev.bead);
    return { ...a, owner, spike: ev.bead.id, acked: Boolean(ackOf(ev.rows, ev.row, owner, { ownerOk, spikeId: ev.bead.id, aId: a.id })) };
  });
}

// ---- the spike gate (R-16) ----
// { exists, result, acked, owner, problem } for a spike bead. The result is the assumption's settling
// row when its register row is backed by one on this spike, else the latest counting probe.
function spikeState(root, bead, { a = null, slug = null, bd = null, ownerOk } = {}) {
  if (!bead) return { exists: false, result: null, acked: false };
  const checked = G.readEvidenceChecked(root, bead.id);
  const problem = G.headProblem(checked, bead);
  const rows = problem ? [] : checked.rows;
  let result = latestResult(rows);
  if (a && a.status !== 'assumed' && bd && slug) {
    const ev = evidenceOf(root, bd, slug, a, a.evidence);
    if (!ev.why && ev.bead.id === bead.id) result = ev.row;
  }
  const owner = a ? decisionOwner(a, bead) : ownerOf((bead.metadata || {}).decision_owner);
  const acked = Boolean(result && ackOf(rows, result, owner, { ownerOk, spikeId: bead.id, aId: a ? a.id : null }));
  return { id: bead.id, exists: true, result, acked, owner, problem, rows };
}

const warn = (code, rule, detail, extra = {}) => ({ level: 'warn', code, rule, detail, ...extra });
const block = (code, rule, detail, extra = {}) => ({ level: 'block', code, rule, detail, ...extra });
const where = (ns) => (ns.length ? `criterion ${ns.join(', ')} rests` : 'its criteria rest');
const ext = (a) => a.kind === 'external-host';

// Findings for one story over verified rows. spikeOf(a): the spike id materialise gives a's spike.
// stamp: the assumption ids ready was recorded on (metadata.ready_assumptions), read only at claim, so a
// refuted external one holds the story until ready is re-recorded after the design change.
function storyFindings({ links, spikeOf = () => null, stamp = null, rows = [] }) {
  const f = [];
  for (const { a, ns } of links) {
    if (a.unverified) f.push(warn('assumption-unverified', 'R-15', a.unverified, { assumption: a.id }));
    if (a.status === 'refuted') {
      if (ext(a)) f.push(block('assumption-refuted', 'D4', `${where(ns)} on ${a.id}, refuted by ${a.evidence}`, { assumption: a.id }));
      else f.push(warn('assumption-refuted', 'R-15', `${where(ns)} on ${a.id} (${a.kind}), refuted by ${a.evidence}: change the design`, { assumption: a.id }));
      continue;
    }
    if (a.status === 'assumed') {
      if (ext(a)) f.push(block('assumption-unobserved', 'D4', `${where(ns)} on ${a.id}, not yet observed in the real host: run spike ${spikeOf(a)} first`, { assumption: a.id, spike: spikeOf(a) }));
      else f.push(warn('assumption-unobserved', 'R-15', `${where(ns)} on ${a.id} (${a.kind}), still assumed: probe it`, { assumption: a.id }));
      continue;
    }
    if (!a.acked) {
      const text = `spike ${a.spike} for ${a.id} has no acknowledgement of its result from its decision owner (${OWNER_WORD[a.owner] || 'DM or PM'})`;
      f.push(ext(a) ? block('spike-unacked', 'D4', text, { assumption: a.id, spike: a.spike }) : warn('spike-unacked', 'R-16', text, { assumption: a.id, spike: a.spike }));
    }
  }
  const linked = new Set(links.map((l) => l.a.id));
  for (const id of Array.isArray(stamp) ? stamp : []) {
    const a = rows.find((r) => r.id === id);
    if (a && a.status === 'refuted' && ext(a) && !linked.has(id)) f.push(block('assumption-refuted', 'D4', `ready was recorded on ${id}, since refuted: re-record ready on the changed design`, { assumption: id }));
  }
  return f;
}

// the refuted external-host assumptions a story is held by: linked now, or stamped at ready
function andonOf(rows, storyId, stamp) {
  const refuted = new Set(rows.filter((r) => r.status === 'refuted' && ext(r)).map((r) => r.id));
  const ids = new Set([...linksFor(rows, storyId).map((l) => l.a.id), ...(Array.isArray(stamp) ? stamp : [])]);
  return [...ids].filter((id) => refuted.has(id));
}

// R-22's andon for a refuted external assumption: other stories in the area wait (fixes go on) while a
// story there is held by one. rowsOf(story bead) gives the verified rows of that story's own initiative.
function areaAndon(bead, stories, rowsOf) {
  if ((bead.labels || []).some((l) => l === 'bug' || l === 'security')) return null;
  const area = G.areaOf(bead);
  for (const s of stories) {
    if (s.id === bead.id || s.status === 'closed' || G.areaOf(s) !== area) continue;
    const m = s.metadata || {};
    const held = andonOf(rowsOf(s), String(m.story || ''), m.ready_assumptions);
    if (held.length) return block('area-andon', 'D4', `area ${area} is paused: ${s.id} rests on refuted ${held.join(', ')}; fixes only until its design changes and ready is re-recorded`, { assumption: held[0] });
  }
  return null;
}

// The gates' view of one initiative's register, verified once per call: rowsFor(slug).
function registers(root, { bd, verifyRecord } = {}) {
  const cache = new Map();
  const ownerOk = (() => {
    const seen = new Map();
    return (rec, spikeId, aId) => {
      const k = `${rec} ${spikeId} ${aId}`;
      if (!seen.has(k)) {
        const r = require('./gate-context.js').ownerRecord(root, rec, verifyRecord);
        seen.set(k, r.ok && scopedTo(r.head, spikeId, aId));
      }
      return seen.get(k);
    };
  })();
  const rowsFor = (slug) => {
    if (!slug) return [];
    if (!cache.has(slug)) cache.set(slug, verifyRows(root, bd, slug, loadRegister(root, slug).rows, { ownerOk }));
    return cache.get(slug);
  };
  return { rowsFor, ownerOk };
}

// The register's findings for a story bead: { rows, links, findings }. storyId defaults to the one
// materialise stamped; atClaim adds what ready was recorded on; criterion narrows it to one criterion
// (a child bead of the story); initiative for a story with no bead yet (ready.js --story).
function forStory(root, bead, { bd, team, verifyRecord, storyId, atClaim = false, criterion = null, initiative, regs } = {}) {
  const slug = initiative || G.initiativeOf(bead);
  const R = regs || registers(root, { bd, verifyRecord });
  const rows = R.rowsFor(slug);
  const m = bead.metadata || {};
  const id = storyId || String(m.story || '');
  if (!rows.length || !id) return { rows, links: [], findings: [] };
  const prefix = prefixOf(bead, team);
  const n = criterion === null || criterion === undefined || criterion === '' ? null : Number(criterion);
  const links = linksFor(rows, id).filter((l) => n === null || !l.ns.length || l.ns.includes(n));
  return { rows, links, findings: storyFindings({ links, spikeOf: (a) => spikeIdFor(prefix, slug, a.id), stamp: atClaim && n === null ? m.ready_assumptions : null, rows }) };
}

// The Chief of Staff's lines: what waits on a check of the outside world, or on a decision
const lowerFirst = (s) => (/^[A-Z][a-z]*(?=\s|$)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function plainLine(title, a) {
  const what = lowerFirst(String(a.statement || '').replace(/\.\s*$/, ''));
  if (a.status === 'refuted') return `${title}: on hold until the design changes: we checked, and it is not true that ${what}`;
  if (a.status === 'observed') return a.owner === 'owner' ? `${title}: waiting for your decision: we checked whether ${what}, and what to do next is your call` : `${title}: waiting for the team's decision on the check of whether ${what}`;
  return `${title}: blocked until we check whether ${what}`;
}

module.exports = { KINDS, STATUSES, HEADER, PROBERS, ACKERS, TWIN_KINDS, OWNER_WORD, fileOf, ownerOf, criteriaOf, parseRegister, loadRegister, renderRow, writeRow, nextId, linksFor,
  spikeIdFor, prefixOf, forStory, registers, verifyRows, evidenceOf, ackOf, decisionOwner, scopedTo, latestResult, readRecording, recordingProblem, observationProblem, spikeState, storyFindings, andonOf, areaAndon, plainLine };
