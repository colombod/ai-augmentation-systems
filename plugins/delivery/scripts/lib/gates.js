// scripts/lib/gates.js — the ready gate (R-10, R-19, R-35), the done gate (R-11, R-12) and the
// evidence rows they read. Pure functions over a story's text, its bead, the initiative's surface and
// the evidence rows; the hook (bd-guard), ready.js and evidence.js supply the reads.
//
// Enforcement (ruling 3): a missing section or a mechanism-worded criterion is a finding with
// level 'warn' (recorded in the warnings ledger, never blocking); only a checkable divergence (D1 scope,
// D2 surface, D3 criteria, D5 half-built) has level 'block'. The judge is advisory and never blocks here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter } = require('./compose-brief.js');
const { tupleOf, sameTuple, describe } = require('./surface.js');

const STATE = { merged: 'state-merged', deployed: 'state-deployed', verified: 'state-verified' };
const DEFAULT_MAX_UNVERIFIED = 2;
// What a customer-observable outcome says: someone sees, reads, finds or finishes something.
const OUTCOME = /\b(sees?|seen|shown|shows|displays?|displayed|appears?|reads?|hears?|finds?|completes?|finishes|notices?|is told)\b/i;
const MECHANISM = /\b(tools?|endpoints?|api|tests?|links?|tickets?|pr|functions?|schema|tables?|returns?|handlers?|routes?|ci|migrations?|logs?)\b/gi;

// ---- the story file ----
const placeholderFree = (s) => String(s || '').replace(/<[^>\n]*>/g, '').replace(/[`>*_\-|:—"“”()[\],.;\s]+/g, ' ').trim();

function sectionsOf(body) {
  const out = new Map();
  let name = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { name = m[1].toLowerCase().replace(/[’]/g, "'"); out.set(name, []); continue; }
    if (name) out.get(name).push(line);
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n')]));
}

function probeOf(text) {
  const where = /\bwhere:\s*([^;]+)/i.exec(text);
  const by = /\bby:\s*(test|reality-check)\b/i.exec(text);
  return { text: text.trim(), where: where ? where[1].trim() : null, by: by ? by[1].toLowerCase() : null };
}

// numbered or bulleted items at column 0; an indented "Probe:" line belongs to the item above it
function criteriaOf(section) {
  const out = [];
  for (const line of String(section || '').split(/\r?\n/)) {
    const item = /^(?:\d+[.)]|[-*](?:\s*\[[ xX]\])?)\s+(.*)$/.exec(line);
    if (item) {
      const text = item[1].trim();
      if (placeholderFree(text.replace(/`?FR-\d+`?/g, ''))) out.push({ n: out.length + 1, text, probe: null });
      continue;
    }
    const probe = /^\s+(?:[-*]\s+)?probe:\s*(.+)$/i.exec(line);
    if (probe && out.length) out[out.length - 1].probe = probeOf(probe[1]);
  }
  return out;
}

// rows of the first table in the section, as objects keyed by lower-cased header; bullet lines
// written "signal: ...; threshold: ...; where: ..." count as rows too
function planRows(section) {
  const lines = String(section || '').split(/\r?\n/);
  const table = lines.filter((l) => l.trim().startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const rows = [];
  if (table.length > 1) {
    const head = table[0].map((h) => h.toLowerCase());
    for (const cells of table.slice(1)) if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(Object.fromEntries(head.map((h, i) => [h, cells[i] || ''])));
  }
  for (const l of lines) {
    if (!/^\s*[-*]\s/.test(l)) continue;
    const get = (k) => { const m = new RegExp(`\\b${k}:\\s*([^;]+)`, 'i').exec(l); return m ? m[1].trim() : ''; };
    if (get('signal')) rows.push({ signal: get('signal'), threshold: get('threshold'), where: get('where') });
  }
  return rows.filter((r) => placeholderFree(r.signal) && /\d/.test(placeholderFree(r.threshold)) && placeholderFree(r.where));
}

function parseStory(text) {
  const raw = String(text || '').replace(/^<!--[\s\S]*?-->\s*/, '');
  const { meta, body } = parseFrontmatter(raw);
  const s = sectionsOf(body || raw);
  return {
    meta: meta || {},
    ownersAsk: s.get("owner's ask"),
    surfaceSection: s.get('customer surface'),
    criteria: criteriaOf(s.get('acceptance criteria')),
    measurement: s.has('measurement plan') ? planRows(s.get('measurement plan')) : null,
    shippable: s.get('shippable unit'),
    goal: s.get('goal'),
  };
}

function criteriaHash(criteria) {
  const norm = criteria.map((c) => c.text.replace(/\s+/g, ' ').trim());
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 12);
}

// The story's surface: frontmatter `surface:`, else the bead's stamped id, else the only one declared.
function storySurface(story, bead, surfaces) {
  const clean = (v) => String(v || '').replace(/\s+#.*$/, '').replace(/<[^>]*>/g, '').trim();
  const id = clean(story && story.meta.surface) || clean(bead && bead.metadata && bead.metadata.surface);
  if (id) return { id, surface: surfaces.find((s) => s.id === id) || null };
  return surfaces.length === 1 ? { id: surfaces[0].id, surface: surfaces[0] } : { id: null, surface: null };
}

// ---- the ready gate ----
const warn = (code, rule, detail) => ({ level: 'warn', code, rule, detail });
const block = (code, rule, detail) => ({ level: 'block', code, rule, detail });

// Findings for a story at ready or claim time. judged: the judge's shippable_unit answer, or null.
function readyFindings({ story, surfaces = [], surfaceMissing = false, bead = null, judged = null }) {
  const f = [];
  const ask = story.ownersAsk === undefined ? null : placeholderFree(story.ownersAsk);
  if (!ask || !/(^|\n)\s*>|["“]/.test(story.ownersAsk)) f.push(warn('owners-ask', 'R-10', "no Owner's ask: quote the owner's words verbatim, with the operator record id (dec-...) when there is one"));
  const { id: sid, surface } = storySurface(story, bead, surfaces);
  if (surfaceMissing || !surfaces.length) f.push(warn('surface-missing', 'R-09', 'the initiative has no valid surface.json: declare the customer surface (host, app, mode, install artifact, budgets)'));
  else if (!sid) f.push(warn('surface-unnamed', 'R-09', `the story names no customer surface (frontmatter surface:); declared: ${surfaces.map((s) => s.id).join(', ')}`));
  else if (!surface) f.push(block('surface-unknown', 'D2', `the story's surface ${sid} is not in surface.json (${surfaces.map((s) => s.id).join(', ')}); evidence on it could never count`));
  if (!story.criteria.length) f.push(warn('no-criteria', 'R-10', 'no acceptance criteria: write each as "<persona> in <surface> does X and sees Y"'));
  for (const c of story.criteria) {
    if (!OUTCOME.test(c.text)) {
      const named = [...new Set((c.text.match(MECHANISM) || []).map((m) => m.toLowerCase()))];
      f.push(warn('mechanism', 'R-10', `criterion ${c.n} names a mechanism${named.length ? ` (${named.join(', ')})` : ''}; say what the customer sees on ${surface ? surface.app : 'the surface'}`));
    }
    if (!c.probe || !c.probe.by) f.push(warn('probe', 'R-10', `criterion ${c.n} has no probe line (Probe: what is observed; where: <surface>; by: test | reality-check)`));
    else if (surface && surface.scriptable === false && c.probe.by === 'test') f.push(warn('reality-check-required', 'R-33', `criterion ${c.n}: ${surface.id} is not scriptable, so its probe needs a reality check on the real surface, not a test`));
  }
  if (story.measurement === null) f.push(warn('measurement-plan', 'R-19', 'no Measurement plan: per criterion a signal, a threshold (a number) and where (surface id)'));
  else if (!story.measurement.length) f.push(warn('measurement-plan', 'R-19', 'the Measurement plan has no row with a signal, a numeric threshold and where'));
  if (!placeholderFree(story.shippable)) f.push(warn('shippable-unit', 'R-35', 'no Shippable unit: the user-visible outcome on the surface after this story alone ships'));
  if (judged && !judged.skipped && !judged.error && (judged.answer === 'no' || judged.answer === 'partial')) {
    f.push(warn('shippable-judge', 'R-35', `the typed judge rates this story "${judged.answer}" as a shippable unit (confidence ${Number(judged.confidence).toFixed(2)}, advisory)`));
  }
  return f;
}

// The judge's state for shippable_unit (declared fields only).
function shippableState(story, surface) {
  return { story: String(story.meta.title || story.meta.id || ''), customer_surface: surface ? `${surface.app}, ${surface.mode}` : 'not declared',
    description: [placeholderFree(story.goal), placeholderFree(story.shippable)].filter(Boolean).join('\n') || 'none' };
}

// Divergences checked at claim, beyond readyFindings: D1 (criteria changed since ready; a child bead
// naming a criterion its story does not have) and D5 (the area is over the unverified cap).
function claimDivergence({ story, bead, parent = null, parentStory = null, overCap = null }) {
  const f = [];
  const m = (bead && bead.metadata) || {};
  if (story && story.criteria.length) {
    if (!m.ready_hash) f.push(warn('not-ready', 'R-10', 'claimed before the Delivery Manager made it ready (ready.js <bead> --record)'));
    else if (m.ready_hash !== criteriaHash(story.criteria)) f.push(block('criteria-changed', 'D1', `the story's criteria changed since they were made ready (hash ${m.ready_hash}, now ${criteriaHash(story.criteria)}); the Delivery Manager re-records them with ready.js --record --owner-record dec-...`));
  }
  if (parent && parentStory && (parent.labels || []).includes('story')) {
    const n = m.criterion;
    if (n === undefined || n === null || n === '') f.push(warn('child-scope', 'D1', `child of ${parent.id} names no criterion it serves (metadata criterion); new scope needs its own story`));
    else if (!parentStory.criteria.some((c) => String(c.n) === String(n))) f.push(block('child-scope', 'D1', `names criterion ${n}, which story ${parent.id} does not have (criteria 1..${parentStory.criteria.length}): new scope needs its own story and an owner record`));
  }
  const fix = (bead.labels || []).some((l) => l === 'bug' || l === 'security');
  if (overCap && !fix) f.push(block('unverified-cap', 'D5', `area ${overCap.area} has ${overCap.count} merged-but-unverified stories (cap ${overCap.cap}: ${overCap.ids.join(', ')}); verify them before starting new work there`));
  return f;
}

// ---- states (R-12) ----
function stateOf(bead) {
  const l = (bead && bead.labels) || [];
  if (l.includes(STATE.verified)) return 'verified';
  if (l.includes(STATE.deployed)) return 'deployed';
  if (l.includes(STATE.merged)) return 'merged';
  return null;
}
const areaOf = (b) => String((b.metadata && b.metadata.area) || b.parent || 'none');

// { area, count, cap, ids } when the area of `bead` holds more merged-but-unverified stories than the cap
function unverifiedOver(beads, bead, cap = DEFAULT_MAX_UNVERIFIED) {
  const area = areaOf(bead);
  const ids = beads.filter((b) => b.id !== bead.id && (b.labels || []).includes('story') && areaOf(b) === area && ['merged', 'deployed'].includes(stateOf(b))).map((b) => b.id);
  return ids.length > cap ? { area, count: ids.length, cap, ids } : null;
}

function stateCounts(beads, cap = DEFAULT_MAX_UNVERIFIED) {
  const out = { merged: 0, deployed: 0, verified: 0, overCap: [] };
  const byArea = new Map();
  for (const b of beads) {
    const s = stateOf(b);
    if (!s) continue;
    out[s]++;
    if (s !== 'verified') (byArea.get(areaOf(b)) || byArea.set(areaOf(b), []).get(areaOf(b))).push(b.id);
  }
  for (const [area, ids] of byArea) if (ids.length > cap) out.overCap.push({ area, count: ids.length, cap, ids });
  return out;
}

// ---- evidence rows: .delivery/evidence/<bead>.ndjson, append-only ----
const evidenceFile = (root, bead) => path.join(root, '.delivery', 'evidence', `${bead}.ndjson`);

function readEvidence(root, bead) {
  let text = '';
  try { text = fs.readFileSync(evidenceFile(root, bead), 'utf8'); } catch (err) { return []; }
  return text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter(Boolean);
}

function appendEvidence(root, bead, row) {
  const file = evidenceFile(root, bead);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const full = { id: `ev-${bead}-${readEvidence(root, bead).length + 1}`, bead, ...row };
  fs.appendFileSync(file, `${JSON.stringify(full)}\n`);
  return full;
}

// The role of an actor string (user@host/instance): the manifest's role for that instance, else the
// instance with its counter dropped.
function roleOfActor(actor, instances = []) {
  const inst = String(actor || '').split('/').pop();
  if (!inst) return null;
  const hit = instances.find((i) => i.instance === inst);
  return hit ? hit.role.id : inst.replace(/-\d+$/, '');
}

// Why a row does not count for criterion n, or null when it does (D2, D3).
function rowProblem(row, { n, surface, sha, author, authorRole }) {
  if (row.type !== 'row' || String(row.criterion) !== String(n)) return 'not this criterion';
  if (row.result !== 'pass') return `${row.id} is a ${row.result}`;
  if (row.arm === 'side') return `${row.id} is a side arm (${row.why || 'not the declared surface'})`;
  if (!surface || row.surface !== surface.id || !sameTuple(row.tuple, tupleOf(surface))) return `${row.id} ran on ${row.surface} ${row.tuple ? `(${row.tuple.app}, ${row.tuple.mode})` : ''}, not ${describe(surface)}`;
  if (!sha) return 'the story has no deployed sha (evidence.js state <bead> deployed --sha <sha>)';
  if (row.sha !== sha) return `${row.id} is on ${String(row.sha).slice(0, 12)}, not the deployed ${String(sha).slice(0, 12)}`;
  if ((author && row.actor === author) || (authorRole && row.by === authorRole)) return `${row.id} was recorded by the author (${row.by})`;
  return null;
}

// The done gate: { ok, criteria: [{ n, row|waiver, why }] }. Without criteria: { ok: true, migrate: true }.
function doneCheck({ story, bead, rows = [], surface, instances = [] }) {
  if (!story || !story.criteria.length) return { ok: true, migrate: true, criteria: [] };
  const m = bead.metadata || {};
  const author = bead.assignee || m.author || null;
  const authorRole = roleOfActor(author, instances);
  const ctx = { surface, sha: m.deployed_sha || null, author, authorRole };
  const out = story.criteria.map((c) => {
    const waiver = rows.find((r) => r.type === 'waiver' && String(r.criterion) === String(c.n) && (!m.deployed_at || r.at < m.deployed_at));
    if (waiver) return { n: c.n, waiver: waiver.id };
    const mine = rows.filter((r) => r.type === 'row' && String(r.criterion) === String(c.n));
    const good = mine.find((r) => !rowProblem(r, { ...ctx, n: c.n }));
    if (good) return { n: c.n, row: good.id };
    const why = mine.length ? rowProblem(mine[mine.length - 1], { ...ctx, n: c.n }) : `no pass row${ctx.sha ? '' : '; the story has no deployed sha'}`;
    return { n: c.n, why };
  });
  return { ok: out.every((x) => x.row || x.waiver), criteria: out };
}

const initiativeOf = (bead) => { const m = /^([a-z0-9][a-z0-9-]*)\//.exec(String((bead && bead.metadata && bead.metadata.roadmap_ref) || '')); return m ? m[1] : null; };

module.exports = { parseStory, criteriaHash, storySurface, readyFindings, shippableState, claimDivergence, stateOf, stateCounts, unverifiedOver, areaOf,
  readEvidence, appendEvidence, evidenceFile, roleOfActor, rowProblem, doneCheck, initiativeOf, STATE, DEFAULT_MAX_UNVERIFIED };
