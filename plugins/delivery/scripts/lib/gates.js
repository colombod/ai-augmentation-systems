// scripts/lib/gates.js — the ready gate (R-10, R-19, R-35), the done gate (R-11, R-12) and the
// evidence rows they read. Pure functions over a story's text, its bead, the initiative's surface and
// the evidence rows; the hook (bd-guard), ready.js and evidence.js supply the reads.
//
// Enforcement (ruling 3): a missing section or a mechanism-worded criterion is a finding with
// level 'warn' (recorded in the warnings ledger, never blocking); only a checkable divergence (D1 scope,
// D2 surface, D3 criteria) has level 'block'. D5 waits for waves (phase 2): an area over the
// unverified cap is a warning here. The judge is advisory and never blocks.
//
// The hard done gate applies to a story the Delivery Manager made ready (metadata.ready_hash): its
// agreed criteria. A story never made ready (one written before 0.22, or on the old template) closes
// with a warning, so in-flight work is never locked out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter } = require('./compose-brief.js');
const { tupleOf, sameTuple, describe } = require('./surface.js');
const { withLock } = require('./lock.js');

const STATE = { merged: 'state-merged', deployed: 'state-deployed', verified: 'state-verified', cut: 'state-cut' };
const DEFAULT_MAX_UNVERIFIED = 2;
// What a customer-observable outcome says: someone sees, reads, finds or finishes something.
const OUTCOME = /\b(sees?|seen|shown|shows|displays?|displayed|appears?|reads?|hears?|finds?|completes?|finishes|notices?|is told)\b/i;
const MECHANISM = /\b(tools?|endpoints?|api|tests?|links?|tickets?|pr|functions?|schema|tables?|returns?|handlers?|routes?|ci|migrations?|logs?)\b/gi;
const PLACEHOLDER = /<[^>\n]+>/;
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

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

// numbered or bulleted items at column 0; an indented "Probe:" line belongs to the item above it.
// A template placeholder (<persona> ...) is not a criterion; it is counted so ready can say so.
function criteriaOf(section) {
  const out = [];
  let placeholders = 0;
  let last = null;
  for (const line of String(section || '').split(/\r?\n/)) {
    const item = /^(?:\d+[.)]|[-*](?:\s*\[[ xX]\])?)\s+(.*)$/.exec(line);
    if (item) {
      const text = item[1].trim();
      last = null;
      if (PLACEHOLDER.test(text)) { placeholders++; continue; }
      if (placeholderFree(text.replace(/`?FR-\d+`?/g, ''))) { last = { n: out.length + 1, text, probe: null }; out.push(last); }
      continue;
    }
    const probe = /^\s+(?:[-*]\s+)?probe:\s*(.+)$/i.exec(line);
    if (probe && last) { last.probe = probeOf(probe[1]); continue; }
    // an indented continuation line is part of the criterion (its text and its hash)
    if (last && /^\s+\S/.test(line) && !last.probe) last.text = `${last.text} ${line.trim()}`;
  }
  return { criteria: out, placeholders };
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
  const c = criteriaOf(s.get('acceptance criteria'));
  return {
    meta: meta || {},
    ownersAsk: s.get("owner's ask"),
    surfaceSection: s.get('customer surface'),
    criteria: c.criteria,
    placeholders: c.placeholders,
    measurement: s.has('measurement plan') ? planRows(s.get('measurement plan')) : null,
    shippable: s.get('shippable unit'),
    goal: s.get('goal'),
  };
}

const normText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// One criterion's own hash: evidence and waivers bind to it, so a reworded or reordered criterion
// needs new evidence.
const criterionHash = (c) => sha12(normText(c.text));
// The agreed scope (D1): the criteria and the story's requirements.
function storyHash(story) {
  const req = normText(story.meta && story.meta.requirements).replace(/\s*,\s*/g, ',');
  return sha12(JSON.stringify({ criteria: story.criteria.map((c) => normText(c.text)), requirements: req }));
}

// The story's surface: frontmatter `surface:`, else the bead's stamped id, else the only one declared.
function storySurface(story, bead, surfaces) {
  const clean = (v) => String(v || '').replace(/\s+#.*$/, '').replace(/<[^>]*>/g, '').trim();
  const id = clean(story && story.meta.surface) || clean(bead && bead.metadata && bead.metadata.surface);
  if (id) return { id, surface: surfaces.find((s) => s.id === id) || null };
  return surfaces.length === 1 ? { id: surfaces[0].id, surface: surfaces[0] } : { id: null, surface: null };
}

// A story bead: labelled story, or stamped by materialise (story_file). A label alone cannot be
// removed to switch the gate off.
const isStoryBead = (b) => Boolean(b && ((b.labels || []).includes('story') || (b.metadata && b.metadata.story_file)));

// ---- the ready gate ----
const warn = (code, rule, detail) => ({ level: 'warn', code, rule, detail });
const block = (code, rule, detail) => ({ level: 'block', code, rule, detail });

// Findings for a story at ready or claim time. judged: the judge's shippable_unit answer, or null.
function readyFindings({ story, surfaces = [], surfaceMissing = false, bead = null, judged = null }) {
  const f = [];
  const ask = story.ownersAsk === undefined ? null : placeholderFree(story.ownersAsk);
  if (!ask || !/(^|\n)\s*>|["“]/.test(story.ownersAsk)) f.push(warn('owners-ask', 'R-10', "no Owner's ask: quote the owner's words, with the dec- record id when there is one"));
  const { id: sid, surface } = storySurface(story, bead, surfaces);
  if (surfaceMissing || !surfaces.length) f.push(warn('surface-missing', 'R-09', 'no valid surface.json for the initiative: declare the customer surface'));
  else if (!sid) f.push(warn('surface-unnamed', 'R-09', `the story names no surface: add surface: to its frontmatter (${surfaces.map((s) => s.id).join(', ')})`));
  else if (!surface) f.push(block('surface-unknown', 'D2', `surface ${sid} is not in surface.json (${surfaces.map((s) => s.id).join(', ')})`));
  if (story.placeholders) f.push(warn('placeholder', 'R-10', `${story.placeholders} criterion line(s) still hold a template <placeholder>; they do not count`));
  if (!story.criteria.length) f.push(warn('no-criteria', 'R-10', 'no acceptance criteria: write each as "<persona> in <surface> does X and sees Y"'));
  for (const c of story.criteria) {
    if (!OUTCOME.test(c.text)) {
      const named = [...new Set((c.text.match(MECHANISM) || []).map((m) => m.toLowerCase()))];
      f.push(warn('mechanism', 'R-10', `criterion ${c.n} names a mechanism${named.length ? ` (${named.join(', ')})` : ''}; say what the customer sees on ${surface ? surface.app : 'the surface'}`));
    }
    if (!c.probe || !c.probe.by) f.push(warn('probe', 'R-10', `criterion ${c.n} has no probe line (Probe: what is observed; where: <surface>; by: test | reality-check)`));
    else if (surface && surface.scriptable === false && c.probe.by === 'test') f.push(warn('reality-check-required', 'R-33', `criterion ${c.n}: ${surface.id} is not scriptable, so its probe needs a reality check, not a test`));
  }
  if (story.measurement === null) f.push(warn('measurement-plan', 'R-19', 'no Measurement plan: per criterion a signal, a numeric threshold and where'));
  else if (!story.measurement.length) f.push(warn('measurement-plan', 'R-19', 'the Measurement plan has no row with a signal, a numeric threshold and where'));
  if (!placeholderFree(story.shippable)) f.push(warn('shippable-unit', 'R-35', 'no Shippable unit: what a person on the surface can do after this story alone ships'));
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

// D1 for a story made ready: the agreed scope (criteria and requirements) is unchanged, including
// when every criterion was deleted. null when it holds or the story was never made ready.
function scopeDrift(story, bead) {
  const recorded = bead && bead.metadata && bead.metadata.ready_hash;
  if (!recorded) return null;
  if (!story) return block('criteria-changed', 'D1', `the story file is missing or unreadable, so the agreed criteria (${recorded}) cannot be checked`);
  const now = storyHash(story);
  return recorded === now ? null : block('criteria-changed', 'D1', `the agreed criteria changed since ready (${recorded}, now ${now})`);
}

// Checked at claim, beyond readyFindings: D1 (scope drift; a child naming a criterion its story does
// not have) and the unverified cap (a warning until waves arrive in phase 2).
function claimDivergence({ story, bead, isStory = Boolean(story), parent = null, parentStory = null, overCap = null }) {
  const f = [];
  const m = (bead && bead.metadata) || {};
  if (isStory) {
    if (!m.ready_hash) { if (story) f.push(warn('not-ready', 'R-10', 'claimed before the Delivery Manager made it ready')); }
    else { const d = scopeDrift(story, bead); if (d) f.push(d); }
  }
  if (parent && parentStory && isStoryBead(parent)) {
    const n = m.criterion;
    if (n === undefined || n === null || n === '') f.push(warn('child-scope', 'D1', `child of ${parent.id} names no criterion it serves (metadata criterion)`));
    else if (!parentStory.criteria.some((c) => c.n === Number(n))) f.push(block('child-scope', 'D1', `names criterion ${n}, which ${parent.id} does not have (1..${parentStory.criteria.length}): new scope needs its own story`));
  }
  const fix = (bead.labels || []).some((l) => l === 'bug' || l === 'security');
  if (overCap && !fix) f.push(warn('unverified-cap', 'R-12', `area ${overCap.area} has ${overCap.count} merged-but-unverified stories (cap ${overCap.cap})`));
  return f;
}

// ---- states (R-12) ----
function stateOf(bead) {
  const l = (bead && bead.labels) || [];
  if (l.includes(STATE.cut)) return 'cut';
  if (l.includes(STATE.verified)) return 'verified';
  if (l.includes(STATE.deployed)) return 'deployed';
  if (l.includes(STATE.merged)) return 'merged';
  return null;
}
const areaOf = (b) => String((b.metadata && b.metadata.area) || b.parent || 'none');
// open or closed, a story counts by its labels: closed is not verified
const unverified = (b) => isStoryBead(b) && ['merged', 'deployed'].includes(stateOf(b));

// { area, count, cap, ids } when the area of `bead` holds more merged-but-unverified stories than the cap
function unverifiedOver(beads, bead, cap = DEFAULT_MAX_UNVERIFIED) {
  const area = areaOf(bead);
  const ids = beads.filter((b) => b.id !== bead.id && areaOf(b) === area && unverified(b)).map((b) => b.id);
  return ids.length > cap ? { area, count: ids.length, cap, ids } : null;
}

function stateCounts(beads, cap = DEFAULT_MAX_UNVERIFIED) {
  const out = { merged: 0, deployed: 0, verified: 0, cut: 0, overCap: [] };
  const byArea = new Map();
  for (const b of beads) {
    const s = stateOf(b);
    if (!s) continue;
    out[s]++;
    if (unverified(b)) (byArea.get(areaOf(b)) || byArea.set(areaOf(b), []).get(areaOf(b))).push(b.id);
  }
  for (const [area, ids] of byArea) if (ids.length > cap) out.overCap.push({ area, count: ids.length, cap, ids });
  return out;
}

// ---- evidence rows: .delivery/evidence/<bead>.ndjson, append-only, hash-chained ----
// Each row carries seq (1..n) and prev, a hash of the line before it, and evidence.js records the
// head (seq and the last line's hash) in the bead's metadata (evidence_head, a protected field). An
// edited, inserted, deleted or appended line, the last one included, no longer matches. A writer
// that can also set bead metadata could still forge both: cooperative trust.
const evidenceFile = (root, bead) => path.join(root, '.delivery', 'evidence', `${bead}.ndjson`);

// { rows, problem, head }: problem names the first line that breaks the chain; head is { seq, hash }
function readEvidenceChecked(root, bead) {
  let text = '';
  try { text = fs.readFileSync(evidenceFile(root, bead), 'utf8'); } catch (err) { return { rows: [], problem: null, head: null }; }
  const rows = [];
  let prev = 'start';
  for (const line of text.split('\n').filter((l) => l.trim())) {
    let r;
    try { r = JSON.parse(line); } catch (err) { return { rows, problem: `line ${rows.length + 1} is not a row`, head: null }; }
    if (r.seq !== rows.length + 1 || r.prev !== prev) return { rows, problem: `row ${r.id || rows.length + 1} breaks the chain (edited or deleted line)`, head: null };
    rows.push(r);
    prev = sha12(line);
  }
  return { rows, problem: null, head: rows.length ? { seq: rows.length, hash: prev } : null };
}
const readEvidence = (root, bead) => readEvidenceChecked(root, bead).rows;

// The file against the head recorded in the bead: rows with no recorded head, or a different head,
// were written or changed outside evidence.js.
function headProblem(checked, bead) {
  if (checked.problem) return checked.problem;
  const want = bead && bead.metadata && bead.metadata.evidence_head;
  const have = checked.head;
  if (!have && !want) return null;
  if (!want) return 'rows exist that evidence.js did not write (no recorded head)';
  if (!have || have.seq !== want.seq || have.hash !== want.hash) return `the file ends at row ${have ? have.seq : 0}, not the recorded row ${want.seq} (rows added, removed or edited by hand)`;
  return null;
}

// Append one row under a per-bead lock (strict: never two writers on one chain); returns the row and
// the new head for the caller to record in the bead.
function appendEvidence(root, bead, row) {
  const file = evidenceFile(root, bead);
  return withLock(`${file}.lock`, () => {
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()); } catch (err) { lines = []; }
    const seq = lines.length + 1;
    const full = { id: `ev-${bead}-${seq}`, bead, seq, prev: lines.length ? sha12(lines[lines.length - 1]) : 'start', ...row };
    const line = JSON.stringify(full);
    fs.appendFileSync(file, `${line}\n`);
    // the new head travels with the row, not in it
    return Object.defineProperty(full, 'head', { value: { seq, hash: sha12(line) }, enumerable: false });
  }, { strict: true, waitMs: 2000 });
}

// The role of an actor string (user@host/instance): the manifest's role for that instance, else the
// instance with its counter dropped.
function roleOfActor(actor, instances = []) {
  const inst = String(actor || '').split('/').pop();
  if (!inst) return null;
  const hit = instances.find((i) => i.instance === inst);
  return hit ? hit.role.id : inst.replace(/-\d+$/, '');
}

// Who built the story: every actor the claim check stamped (metadata.authors), and the assignee.
function authorsOf(bead, instances = []) {
  const m = (bead && bead.metadata) || {};
  const list = Array.isArray(m.authors) ? m.authors.filter((a) => a && a.actor) : [];
  if (bead && bead.assignee && !list.some((a) => a.actor === bead.assignee)) list.push({ actor: bead.assignee, role: roleOfActor(bead.assignee, instances) });
  return { actors: list.map((a) => a.actor), roles: [...new Set(list.map((a) => a.role || roleOfActor(a.actor, instances)).filter(Boolean))] };
}

// Lower case; equal, or one a prefix of the other of at least 7 characters.
function shaMatch(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
}

// Why a row does not count for criterion c, or null when it does (D2, D3).
function rowProblem(row, { c, surface, noSurface, sha, deployedAt, authors }) {
  if (row.type !== 'row' || Number(row.criterion) !== c.n) return 'not this criterion';
  if (row.criterion_hash !== criterionHash(c)) return `${row.id} checked another wording of criterion ${c.n}`;
  if (row.result !== 'pass') return `${row.id} is a ${row.result}`;
  if (row.arm === 'side') return `${row.id} is a side arm (${row.why || 'not the declared surface'})`;
  if (!noSurface && (!surface || row.surface !== surface.id || !sameTuple(row.tuple, tupleOf(surface)))) return `${row.id} ran on ${row.surface}${row.tuple ? ` (${row.tuple.app}, ${row.tuple.mode})` : ''}, not ${describe(surface)}`;
  if (!sha) return 'no deployed sha recorded';
  if (!shaMatch(row.sha, sha)) return `${row.id} is on ${String(row.sha).slice(0, 12)}, not the deployed ${String(sha).slice(0, 12)}`;
  if (deployedAt && String(row.at) < String(deployedAt)) return `${row.id} was recorded before the deploy`;
  if (authors.actors.includes(row.actor) || authors.roles.includes(row.by)) return `${row.id} was recorded by the author (${row.by})`;
  return null;
}

// The done gate: { ok, criteria: [{ n, row|waiver, why }], cut?, noSurface? }.
// recordOk(id): whether an owner record still verifies; a cut or waiver citing one that does not is
// ignored (re-verified at the gate, not only when it was written).
function doneCheck({ story, bead, rows = [], surface, noSurface = false, instances = [], recordOk = () => true }) {
  const m = bead.metadata || {};
  const cut = rows.find((r) => r.type === 'cut' && recordOk(r.record));
  if (cut) return { ok: true, cut: cut.id, criteria: [] };
  if (!story || !story.criteria.length) return { ok: false, criteria: [], empty: true };
  const ctx = { surface, noSurface, sha: m.deployed_sha || null, deployedAt: m.deployed_at || null, authors: authorsOf(bead, instances) };
  const out = story.criteria.map((c) => {
    const waiver = rows.find((r) => r.type === 'waiver' && Number(r.criterion) === c.n && r.criterion_hash === criterionHash(c) && (!m.deployed_at || r.at < m.deployed_at) && recordOk(r.record));
    if (waiver) return { n: c.n, waiver: waiver.id };
    const mine = rows.filter((r) => r.type === 'row' && Number(r.criterion) === c.n);
    const good = mine.find((r) => !rowProblem(r, { ...ctx, c }));
    if (good) return { n: c.n, row: good.id };
    const why = mine.length ? rowProblem(mine[mine.length - 1], { ...ctx, c }) : `no pass row${ctx.sha ? '' : ', no deployed sha'}`;
    return { n: c.n, why };
  });
  return { ok: out.every((x) => x.row || x.waiver), criteria: out, noSurface };
}

const initiativeOf = (bead) => { const m = /^([a-z0-9][a-z0-9-]*)\//.exec(String((bead && bead.metadata && bead.metadata.roadmap_ref) || '')); return m ? m[1] : null; };

module.exports = { parseStory, storyHash, criterionHash, storySurface, isStoryBead, readyFindings, shippableState, scopeDrift, claimDivergence, stateOf, stateCounts, unverifiedOver, areaOf,
  readEvidence, readEvidenceChecked, headProblem, appendEvidence, evidenceFile, roleOfActor, authorsOf, shaMatch, rowProblem, doneCheck, initiativeOf, STATE, DEFAULT_MAX_UNVERIFIED };
