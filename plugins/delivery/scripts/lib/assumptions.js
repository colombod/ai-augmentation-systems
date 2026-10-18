// scripts/lib/assumptions.js — the assumption register (R-14), the external-assumption gate (D4, R-15),
// the spike gate (R-16) and the twins rule (R-18). Pure over the register's text, a story's links and the
// evidence rows; assumptions.js, ready.js, materialise and the bd guard supply the reads.
//
// The register is .delivery/initiatives/<slug>/assumptions.md, one table row per assumption: id (A-n),
// statement, kind, the criteria it sits on (<story>#<n>, or <story> for all of them), status (assumed,
// observed, refuted), evidence (an ev- row id) and the decision owner (DM, PM or owner). The register's
// Criteria column is the one link between a story and its assumptions, so a builder cannot drop one by
// editing the story file (the register is in the Product Manager's lane, and written by script).
//
// Enforcement (ruling 3): only an external-host assumption blocks, because that is the divergence the
// Vault paid for (#478 built on the documentation's reading of the file host). A story whose criteria
// sit on one that is assumed, or that has a spike whose result the decision owner has not acknowledged,
// is not ready and its claim is refused (D4); a refuted one stops the dependent stories and pauses their
// area (fixes only) until the design changes and ready is re-recorded. Every other kind is a warning.
const fs = require('fs');
const path = require('path');
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
    r.criteria = criteriaOf(r.criteria);
    r.line = end;
    if (!/^A-\d+$/.test(r.id)) problems.push(`assumption "${r.id}": the id is not A-<n>`);
    if (!KINDS.includes(r.kind)) problems.push(`${r.id}: kind "${r.kind}" is not one of ${KINDS.join(', ')}`);
    if (!STATUSES.includes(r.status)) problems.push(`${r.id}: status "${r.status}" is not one of ${STATUSES.join(', ')}`);
    if (r.status !== 'assumed' && !/^ev-/.test(r.evidence)) problems.push(`${r.id} is ${r.status} with no ev- evidence row`);
    if (!r.criteria.length) problems.push(`${r.id} sits on no criteria (<story>#<n>)`);
    rows.push(r);
  }
  return { rows, problems, table: { start, end }, lines };
}

const loadRegister = (root, slug) => { try { return parseRegister(fs.readFileSync(fileOf(root, slug), 'utf8')); } catch (err) { return { rows: [], problems: [], table: null, missing: true }; } };

const esc = (s) => String(s || '').replace(/\|/g, '\\|');
const renderCriteria = (cs) => cs.map((c) => (c.ns.length ? c.ns.map((n) => `${c.story}#${n}`).join(' ') : c.story)).join(' ');
const renderRow = (r) => `| ${[r.id, esc(r.statement), r.kind, renderCriteria(r.criteria), r.status, r.evidence || '', OWNER_WORD[r.owner] || ''].join(' | ')} |`;

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

// ---- the twins rule (R-18): a recording with its source, date and real request/response pairs ----
function recordingProblem(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return 'no readable recording (a JSON file of captured request/response pairs)'; }
  const har = j && j.log && Array.isArray(j.log.entries) ? j.log.entries : null;
  const pairs = har || j.exchanges || j.entries;
  const source = j.source || (har && har[0] && har[0].request && har[0].request.url);
  const date = j.recorded_at || j.date || (har && har[0] && har[0].startedDateTime);
  if (!source) return 'the recording names no source (the real host it was captured from)';
  if (!date) return 'the recording has no capture date';
  if (!Array.isArray(pairs) || !pairs.length || !pairs.every((e) => e && e.request && e.response)) return 'the recording holds no captured request and response';
  return null;
}

// Why an evidence row is not an observation of assumption a in the real host, or null when it is.
// A probe row (assumptions.js probe) or a Reality Checker's run on a deployed story counts; a twin not
// built from recorded traffic, a reading of the documentation, or anyone else's row does not.
function observationProblem(row, a) {
  if (!row) return 'no such evidence row';
  if (row.type === 'probe') {
    if (row.assumption !== a.id) return `${row.id} probed ${row.assumption || 'no assumption'}, not ${a.id}`;
    if (row.counts === false) return `${row.id} ran on a twin not built from recorded real traffic (${row.why}): an assumption, not evidence (R-18)`;
    if (!PROBERS.includes(row.by)) return `${row.id} was written by ${row.by}, not a probe`;
    if (a.kind === 'external-host' && row.via !== 'twin' && row.by !== 'reality-checker') return `${row.id} is a local probe: an external host is observed by the Reality Checker in the real host`;
    return null;
  }
  if (row.type === 'row' && row.via === 'reality-check' && row.by === 'reality-checker' && row.arm !== 'side') return null;
  return `${row.id} is not an observation in the real host (a probe row, or a Reality Checker's run)`;
}

// ---- the spike gate (R-16) ----
// { id, exists, result, acked, owner, problem } from the spike bead and its evidence chain.
// recordOk re-verifies an owner's record at the gate, as cuts and waivers are.
function spikeState(root, bead, { recordOk = () => false, owner = null } = {}) {
  if (!bead) return { exists: false, result: false, acked: false };
  const checked = G.readEvidenceChecked(root, bead.id);
  const problem = G.headProblem(checked, bead);
  const rows = problem ? [] : checked.rows;
  const who = ownerOf((bead.metadata || {}).decision_owner) || owner;
  const acked = rows.some((r) => r.type === 'ack' && (who !== 'owner' || (r.record && recordOk(r.record))));
  return { id: bead.id, exists: true, result: rows.some((r) => r.type === 'probe'), acked, owner: who, problem, closed: bead.status === 'closed' };
}

const warn = (code, rule, detail, extra = {}) => ({ level: 'warn', code, rule, detail, ...extra });
const block = (code, rule, detail, extra = {}) => ({ level: 'block', code, rule, detail, ...extra });
const where = (ns) => (ns.length ? `criterion ${ns.join(', ')}` : 'its criteria');

// Findings for one story. links: linksFor(); spikeOf(a) -> spikeState; stamp: the assumption ids ready
// was recorded on (metadata.ready_assumptions), read only at claim, so a refuted one holds the story
// until ready is re-recorded after the design change.
function storyFindings({ links, spikeOf = () => ({ exists: false }), stamp = null, rows = [] }) {
  const f = [];
  for (const { a, ns } of links) {
    const sp = spikeOf(a);
    const ext = a.kind === 'external-host';
    if (a.status === 'refuted') { f.push(block('assumption-refuted', 'D4', `${where(ns)} rests on ${a.id}, refuted by ${a.evidence}`, { assumption: a.id })); continue; }
    if (a.status === 'assumed') {
      if (ext) f.push(block('assumption-unobserved', 'D4', `${where(ns)} rests on ${a.id}, not yet observed in the real host: run spike ${sp.id} first`, { assumption: a.id, spike: sp.id }));
      else f.push(warn('assumption-unobserved', 'R-15', `${where(ns)} rests on ${a.id} (${a.kind}), still assumed: probe it`, { assumption: a.id }));
      continue;
    }
    if (sp.exists && !sp.acked) {
      const text = `spike ${sp.id} for ${a.id} has no acknowledgement from its decision owner (${OWNER_WORD[sp.owner] || 'DM or PM'})`;
      f.push(ext ? block('spike-unacked', 'D4', text, { assumption: a.id, spike: sp.id }) : warn('spike-unacked', 'R-16', text, { assumption: a.id, spike: sp.id }));
    }
  }
  const linked = new Set(links.map((l) => l.a.id));
  for (const id of Array.isArray(stamp) ? stamp : []) {
    const a = rows.find((r) => r.id === id);
    if (a && a.status === 'refuted' && !linked.has(id)) f.push(block('assumption-refuted', 'D4', `ready was recorded on ${id}, since refuted: re-record ready on the changed design`, { assumption: id }));
  }
  return f;
}

// the refuted assumptions a story is held by: linked now, or stamped at ready
function andonOf(rows, storyId, stamp) {
  const refuted = new Set(rows.filter((r) => r.status === 'refuted').map((r) => r.id));
  const ids = new Set([...linksFor(rows, storyId).map((l) => l.a.id), ...(Array.isArray(stamp) ? stamp : [])]);
  return [...ids].filter((id) => refuted.has(id));
}

// R-22's andon for a refuted assumption: other stories in the area wait (fixes go on) while a story there
// is held by one. stories: story beads (metadata.story, ready_assumptions, area).
function areaAndon(bead, stories, rows) {
  if ((bead.labels || []).some((l) => l === 'bug' || l === 'security')) return null;
  const area = G.areaOf(bead);
  for (const s of stories) {
    if (s.id === bead.id || s.status === 'closed' || G.areaOf(s) !== area) continue;
    const m = s.metadata || {};
    const held = andonOf(rows, String(m.story || ''), m.ready_assumptions);
    if (held.length) return block('area-andon', 'D4', `area ${area} is paused: ${s.id} rests on refuted ${held.join(', ')}; fixes only until its design changes and ready is re-recorded`, { assumption: held[0] });
  }
  return null;
}

// The register's findings for a story bead: { rows, links, findings }. storyId defaults to the one
// materialise stamped; atClaim adds what ready was recorded on (the andon holds until it is re-recorded).
function forStory(root, bead, { bd, team, recordOk, storyId, atClaim = false } = {}) {
  const initiative = G.initiativeOf(bead);
  const reg = initiative ? loadRegister(root, initiative) : { rows: [] };
  const m = bead.metadata || {};
  const id = storyId || String(m.story || '');
  if (!reg.rows.length || !id) return { rows: reg.rows, links: [], findings: [] };
  const prefix = prefixOf(bead, team);
  const spikeOf = (a) => {
    const sid = spikeIdFor(prefix, initiative, a.id);
    let b = null;
    try { b = bd ? bd.show(sid) : null; } catch (err) { b = null; }
    return { ...spikeState(root, b, { recordOk, owner: a.owner }), id: sid };
  };
  const links = linksFor(reg.rows, id);
  return { rows: reg.rows, links, findings: storyFindings({ links, spikeOf, stamp: atClaim ? m.ready_assumptions : null, rows: reg.rows }) };
}

// "blocked until we check whether the ChatGPT app passes an attached file as an https link"
// only an ordinary first word is lowered: "The app" reads "the app", "ChatGPT shows" stays as it is
const lowerFirst = (s) => (/^[A-Z][a-z]*(?=\s|$)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function plainLine(title, a) {
  const what = lowerFirst(String(a.statement || '').replace(/\.\s*$/, ''));
  if (a.status === 'refuted') return `${title}: on hold until the design changes, because ${what} turned out not to hold`;
  return `${title}: blocked until we check whether ${what}`;
}

module.exports = { KINDS, STATUSES, HEADER, PROBERS, ACKERS, OWNER_WORD, fileOf, ownerOf, criteriaOf, parseRegister, loadRegister, renderRow, writeRow, nextId, linksFor,
  spikeIdFor, prefixOf, forStory, recordingProblem, observationProblem, spikeState, storyFindings, andonOf, areaAndon, plainLine };
