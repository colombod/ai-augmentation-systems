// scripts/lib/andon.js — stop the line (R-22) and flow limits (R-23).
//
// The andon ledger, <project>/.delivery/andon/<writer>.ndjson: append-only and chained (n, prev = sha12
// of the previous line) like the review records, written only by a3.js, andon.js and merge-gate.js
// (every lane refuses a hand write). Rows:
//   a3-open  { a3, trigger, area, file }              an A3 (root-cause record) was opened for a trigger
//   a3-close { a3, fixes, proof, hash }               closed, linking the fix beads and the proving row
//   ci       { result: red|green, sha, run }          CI on the product's main, recorded where gh cannot read it
//   flaky    { test, sha, fail_run, pass_run, area }  one test failed then passed on the same sha
//   chain    { symptom, prs, beads, spike }           two fixes on one symptom merged within 48 h
//   ack      { target, reason }                       the Delivery Manager acknowledged a chain's spike
// Triggers an A3 answers: andon:<failed ev row> (an area stop), ci:main (a red main), flaky:<test>.
// What stops a claim (D3, serious divergence): an area whose agreed criterion failed its reality
// check, until that failure's A3 closes on a proved fix (final: a later deploy stops nothing); a red
// main (its required workflows), until green or an A3 closed after it went red; a confirmed flaky test
// in a named area with no A3 opened within 24 h. Linked
// fixes and the A3's own work (a3: <id> in the bead's metadata, set by the Delivery Manager or Product
// Manager) always go on. Everything else here is a warning.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { withLock } = require('./lock.js');
const G = require('./gates.js');

const REL = path.join('.delivery', 'andon');
const WRITER = /^[a-z0-9][a-z0-9-]*$/;
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const writerOf = (w) => (WRITER.test(String(w || '')) ? String(w) : 'local');
const dirOf = (root) => path.join(root, REL);
const H = 3600e3;
const FLAKY_HOURS = 24;
const CHAIN_HOURS = 48;
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

function readChain(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return { rows: [] }; }
  const rows = [];
  let prev = 'start';
  for (const line of text.split('\n').filter((l) => l.trim())) {
    let r;
    try { r = JSON.parse(line); } catch (err) { return { rows, problem: `${path.basename(file)} line ${rows.length + 1} is not a row` }; }
    if (!r || r.n !== rows.length + 1 || r.prev !== prev) return { rows, problem: `row ${(r && r.id) || rows.length + 1} breaks the andon chain ${path.basename(file)} (edited or deleted line)` };
    rows.push(r);
    prev = sha12(line);
  }
  return { rows };
}

// { rows, problem }: every writer's chain, in time order. A broken chain is reported and its readable
// rows are kept: an edit can only hide a close (the stop stays) or a stop (status shows the problem).
function read(root) {
  let files = [];
  try { files = fs.readdirSync(dirOf(root)).filter((f) => f.endsWith('.ndjson')).sort(); } catch (err) { return { rows: [] }; }
  const rows = [];
  const problems = [];
  for (const f of files) {
    const c = readChain(path.join(dirOf(root), f));
    rows.push(...(c.problem ? c.rows.filter((r) => r.type !== 'a3-close' && r.type !== 'ack') : c.rows));
    if (c.problem) problems.push(c.problem);
  }
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { rows, ...(problems.length ? { problem: problems.join('; ') } : {}) };
}

function append(root, row, writer) {
  const file = path.join(dirOf(root), `${writerOf(writer)}.ndjson`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLock(`${file}.lock`, () => {
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()); } catch (err) { lines = []; }
    const n = lines.length + 1;
    const full = { id: `an-${writerOf(writer)}-${n}`, n, prev: lines.length ? sha12(lines[lines.length - 1]) : 'start', ...row };
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`);
    return full;
  }, { strict: true, waitMs: 2000 });
}

// ---- A3 records ----
const a3File = (id) => path.join('.delivery', 'reviews', `${id}.md`);
const SECTIONS = [
  ['problem', 'Problem as observed on the surface'], ['evidence', 'Evidence row'], ['expected', 'What was expected'],
  ['cause', 'Root cause'], ['class', 'Class of defect'], ['countermeasure', 'Fix across the class'], ['check', 'Check that proves it'],
];
// the section texts of an A3 file, comments and unfilled placeholders dropped
function sectionsOf(text) {
  const out = {};
  const parts = String(text || '').split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const head = (nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase();
    const s = SECTIONS.find(([, h]) => h.toLowerCase() === head);
    if (s) out[s[0]] = (nl < 0 ? '' : p.slice(nl + 1)).replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[a-z]+\}\}/g, '').trim();
  }
  return out;
}
const missingSections = (text) => { const s = sectionsOf(text); return SECTIONS.filter(([k]) => !s[k]).map(([, h]) => h); };
// filled with a placeholder (TBD, TODO, n/a, -), fewer than MIN_WORDS words or single letters only: not an answer
const MIN_WORDS = 8;
const PLACEHOLDER = /^(?:tbd|tba|todo|fixme|wip|n\/?a|none|unknown|-+|\.+|\?+|x+)[.!]?$/i;
function weakSections(text) {
  const s = sectionsOf(text);
  const words = (t) => t.match(/[\p{L}\p{N}]+/gu) || [];
  return SECTIONS.filter(([k]) => s[k] && (PLACEHOLDER.test(s[k].trim()) || words(s[k]).length < MIN_WORDS || words(s[k]).every((w) => w.length < 2))).map(([, h]) => h);
}
// a fix bead is merged: its state label, or a merged review record that carried it
function mergedBead(root, bead) {
  if (['merged', 'deployed', 'verified'].includes(G.stateOf(bead))) return true;
  const R = require('./reviews.js');
  return R.listPrs(root).some((p) => R.read(root, p).rows.some((r) => r.type === 'merged' && (r.beads || []).includes(bead.id)));
}

// Every A3 with its close folded in: { id, trigger, area, at, by, closed: row|null }
function a3s(root, rows = read(root).rows) {
  const out = new Map();
  for (const r of rows) {
    const id = r.a3 || `a3-${String(r.id).replace(/^an-/, '')}`;
    if (r.type === 'a3-open' && !out.has(id)) out.set(id, { id, trigger: r.trigger, area: r.area || null, at: r.at, by: r.by, closed: null });
    if (r.type === 'a3-close' && out.has(r.a3) && !out.get(r.a3).closed) out.get(r.a3).closed = r;
  }
  return [...out.values()];
}
const openA3For = (root, trigger, rows) => a3s(root, rows).find((a) => a.trigger === trigger && !a.closed) || null;
// the latest closed A3 for a trigger, closed after `after` when given
const closedA3For = (root, trigger, { after, rows } = {}) => a3s(root, rows).filter((a) => a.trigger === trigger && a.closed && (!after || String(a.closed.at) >= String(after)))
  .sort((a, b) => String(b.closed.at).localeCompare(String(a.closed.at)))[0] || null;
function classOf(root, id) {
  try { return (sectionsOf(fs.readFileSync(path.join(root, a3File(id)), 'utf8')).class || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || null; } catch (err) { return null; }
}

// ---- area stops: a failed counting reality-check row (goal.js pause_triggers andon:<row>) ----
// [{ trigger, row, bead, story, area, criterion, a3, missing }] for each that is still open
function areaStops(root, { beadOf = () => null, g } = {}) {
  const Goal = require('./goal.js');
  const sheet = g || Goal.read(root);
  // both stored forms: the list, and the singular pause_trigger goal.js still reads
  const stored = [...(Array.isArray(sheet.fields.pause_triggers) ? sheet.fields.pause_triggers : []), ...(sheet.fields.pause_trigger ? [sheet.fields.pause_trigger] : [])];
  const triggers = [...new Set(stored.map((t) => t && t.trigger).filter((t) => /^andon:ev-/.test(String(t))))];
  const rows = read(root).rows;
  const out = [];
  for (const trigger of triggers) {
    const rowId = trigger.slice(6);
    const beadId = /^ev-(.+)-\d+$/.exec(rowId)[1];
    let bead = null;
    try { bead = beadOf(beadId); } catch (err) { bead = null; }
    // without the bead its area is not known: the claim check cannot place it (it fails open there), but
    // the status keeps it, read on its chain alone, so a stop never disappears from view (fail closed)
    if (!bead) {
      const alone = Goal.triggerState(root, trigger, {});
      if (alone.open) out.push({ trigger, row: rowId, bead: beadId, story: '', area: null, areaName: null, unreadable: true, criterion: null, title: beadId, a3: openA3For(root, trigger, rows), missing: alone.missing || null });
      continue;
    }
    const st = Goal.triggerState(root, trigger, { bead });
    if (!st.open) continue;
    const row = G.readEvidence(root, beadId).find((r) => r.id === rowId) || {};
    out.push({ trigger, row: rowId, bead: beadId, story: String((bead.metadata || {}).story || ''), area: G.areaOf(bead), areaName: (bead.metadata || {}).area || null, criterion: row.criterion, title: bead.title || beadId, a3: openA3For(root, trigger, rows), missing: st.missing || st.held || null });
  }
  return out;
}

// ---- CI on the product's main ----
function ghRuns(repo, branch, { cwd, timeoutMs = 4000 } = {}) {
  let r;
  try { r = spawnSync('gh', ['run', 'list', '-R', repo, '--branch', branch, '--limit', '30', '--json', 'databaseId,workflowName,event,status,conclusion,headSha,createdAt,updatedAt,url'], { cwd, encoding: 'utf8', timeout: timeoutMs }); } catch (err) { return { unavailable: err.message }; }
  if (r.error || r.status !== 0) return { unavailable: r.error ? r.error.message : String(r.stderr || '').trim().split('\n')[0] };
  try { const runs = JSON.parse(r.stdout); return Array.isArray(runs) ? { runs } : { unavailable: 'no runs' }; } catch (err) { return { unavailable: 'gh run list returned no JSON' }; }
}

// The required workflows (team.json required_workflows; by default the push-triggered workflows that ran on
// the newest main sha, so a manual or scheduled job does not stop the product), each by its latest run
// with a verdict (a cancelled or skipped run is none); red when one failed, since its first failure in a
// row. Times are when a run finished (updatedAt), so a run that started earlier and failed later counts late.
const NO_VERDICT = new Set(['cancelled', 'skipped', 'neutral', 'stale', 'action_required', '']);
const doneAt = (r) => r.updatedAt || r.createdAt;
function redFromRuns(runs, { required } = {}) {
  const done = runs.filter((x) => String(x.status).toLowerCase() === 'completed' && !NO_VERDICT.has(String(x.conclusion || '').toLowerCase()));
  let names;
  let verdicts = done;
  const isPush = (x) => !x.event || x.event === 'push';
  if (Array.isArray(required) && required.length) names = new Set(required);
  else {
    // by default only push runs give a verdict: a manual run neither clears nor breaks main
    verdicts = done.filter(isPush);
    const push = runs.filter(isPush);
    const head = [...push].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    names = new Set(head ? push.filter((x) => x.headSha === head.headSha).map((x) => x.workflowName) : []);
  }
  const by = new Map();
  for (const r of verdicts.filter((x) => names.has(x.workflowName))) (by.get(r.workflowName) || by.set(r.workflowName, []).get(r.workflowName)).push(r);
  const red = [];
  for (const [name, list] of by) {
    list.sort((a, b) => String(doneAt(b)).localeCompare(String(doneAt(a))));
    let k = 0;
    while (k < list.length && FAILED.has(String(list[k].conclusion).toLowerCase())) k++;
    if (k) red.push({ workflow: name, since: doneAt(list[k - 1]), sha: list[0].headSha, run: list[0].url || String(list[0].databaseId), reds: list.slice(0, k).map(doneAt) });
  }
  return red;
}

// { red, since, sha, run, source, workflows, a3 } — gh first; the Delivery Manager's ci rows where gh cannot read
function ciState(root, { team, gh, rows = read(root).rows, cwd } = {}) {
  const repo = require('./gh-pr.js').productRepoOf(team);
  const branch = (team && typeof team.product_branch === 'string' && team.product_branch) || 'main';
  let st = null;
  const live = repo ? (gh ? gh(repo, branch) : ghRuns(repo, branch, { cwd: cwd || root })) : { unavailable: 'the product repository is not known' };
  if (live && live.runs) {
    const red = redFromRuns(live.runs, { required: team && team.required_workflows });
    st = red.length ? { red: true, source: 'gh', since: red.map((x) => x.since).sort()[0], sha: red[0].sha, run: red[0].run, workflows: red.map((x) => x.workflow) } : { red: false, source: 'gh' };
  } else {
    // the Delivery Manager's rows, one chain of verdicts per workflow (a row with none is "main")
    const ci = rows.filter((r) => r.type === 'ci');
    const by = new Map();
    for (const r of ci) (by.get(r.workflow || 'main') || by.set(r.workflow || 'main', []).get(r.workflow || 'main')).push(r);
    const red = [];
    for (const [name, list] of by) {
      let k = list.length;
      while (k > 0 && list[k - 1].result === 'red') k--;
      if (k < list.length) red.push({ workflow: name, since: list[k].at, sha: list[list.length - 1].sha, run: list[list.length - 1].run });
    }
    st = red.length ? { red: true, source: 'recorded', since: red.map((x) => x.since).sort()[0], sha: red[0].sha, run: red[0].run, workflows: red.map((x) => x.workflow) } : { red: false, source: ci.length ? 'recorded' : null };
  }
  // the stop holds while any required workflow is red, whatever the A3 (the owner: red main stops new work)
  if (st.red) st.a3 = openA3For(root, 'ci:main', rows);
  return { ...st, branch, repo: repo || null };
}

// ---- flaky tests: an A3 within 24 h ----
function flakyOpen(root, { now, rows = read(root).rows } = {}) {
  const t = Date.parse(now || new Date().toISOString());
  // per test, its first recording since its last closed A3: a later recording never moves the due time
  const seen = new Map();
  for (const r of rows.filter((x) => x.type === 'flaky')) {
    const done = closedA3For(root, `flaky:${r.test}`, { rows });
    if (!seen.has(r.test) && !(done && String(done.closed.at) >= String(r.at))) seen.set(r.test, r);
  }
  // confirmed: recorded by the Delivery Manager, or confirmed by it since (andon.js flaky confirm)
  return [...seen.values()].map((r) => ({ ...r, due: new Date(Date.parse(r.at) + FLAKY_HOURS * H).toISOString(), overdue: t - Date.parse(r.at) > FLAKY_HOURS * H, a3: openA3For(root, `flaky:${r.test}`, rows),
    confirmed: r.by === 'delivery-lead' || rows.some((x) => x.type === 'flaky-confirm' && x.test === r.test && String(x.at) >= String(r.at)),
    a3Opened: a3s(root, rows).some((a) => a.trigger === `flaky:${r.test}` && String(a.at) >= String(r.at)) }));
}

// ---- fix on fix: two merged fixes on one symptom within 48 h ----
// the fix labels, review findings included (bd-guard's tier-1 fix labels)
const FIX = ['bug', 'security', 'finding'];
function symptomsOf(root, bead) {
  const m = (bead && bead.metadata) || {};
  if (!(bead && (bead.labels || []).some((l) => FIX.includes(l)))) return [];
  const out = [];
  const link = String(m.fixes || m.finding || '').replace(/\s+#.*$/, '').trim();
  if (link) out.push(`fixes ${link}`);
  if (m.a3) { const c = classOf(root, String(m.a3)); if (c) out.push(`class ${c}`); }
  return out;
}

// chains with their acknowledgement folded in: { id, symptom, prs, beads, spike, at, acked, ackedAt }.
// Only the Delivery Manager's ack answers a spike: closing the spike bead alone does not (beadOf is kept
// for the callers' shape).
function chains(root, { rows = read(root).rows } = {}) {
  const acks = new Map(rows.filter((r) => r.type === 'ack').map((r) => [r.target, r.at]));
  return rows.filter((r) => r.type === 'chain').map((r) => ({ ...r, acked: acks.has(r.id), ackedAt: acks.get(r.id) || null }));
}

// After a merge (merge-gate.js merged): each symptom of the merged PR's fix beads that another fix
// merged within 48 h shares opens a chain and a spike for its cause, once. Returns the lines to print.
function fixChain(root, { pr, bd, now, who }) {
  const R = require('./reviews.js');
  const at = now || new Date().toISOString();
  const merged = [];
  for (const p of R.listPrs(root)) {
    const m = R.read(root, p).rows.find((r) => r.type === 'merged');
    if (m) merged.push({ pr: Number(p), at: m.at, beads: m.beads || [] });
  }
  const self = merged.find((m) => m.pr === Number(pr));
  if (!self) return [];
  const show = (id) => { try { return bd.show(id); } catch (err) { return null; } };
  const keysOf = (m) => new Map(m.beads.map(show).filter(Boolean).flatMap((b) => symptomsOf(root, b).map((k) => [k, b.id])));
  const mine = keysOf(self);
  const rows = read(root).rows;
  const known = chains(root, { rows, beadOf: show });
  const lines = [];
  for (const [symptom, beadId] of mine) {
    // one open spike per symptom; once it is answered, only fixes merged after the answer count again,
    // this one included (a re-run of merged for an older pull request pairs with nothing)
    const prior = known.filter((c) => c.symptom === symptom);
    if (prior.some((c) => !c.acked)) continue;
    const since = prior.map((c) => c.ackedAt).sort().pop() || '';
    if (String(self.at) <= since) continue;
    const others = merged.filter((m) => m.pr !== self.pr && String(m.at) > since && Math.abs(Date.parse(m.at) - Date.parse(self.at)) <= CHAIN_HOURS * H && keysOf(m).has(symptom));
    if (!others.length) continue;
    const prs = [...others.map((m) => m.pr), self.pr].sort((a, b) => a - b);
    let spike = `${beadId}-spike`;
    for (let k = 2; show(spike); k++) spike = `${beadId}-spike-${k}`;
    const subject = symptom.replace(/^(fixes|class) /, '');
    try {
      bd.create({ id: spike, title: `Why does ${subject} keep coming back?`, type: 'task', labels: ['spike'],
        metadata: { question: `Why did ${subject} need fixes in PRs ${prs.join(', ')} within 48 h?`, decision: 'how to fix the class of defect behind the symptom', decision_rule: 'a cause found: fix across the class; none found: stop fixing and change the design', fix_chain: symptom } });
    } catch (err) { spike = null; }
    const row = append(root, { type: 'chain', symptom, prs, beads: [...new Set([beadId, ...others.flatMap((m) => [...keysOf(m)].filter(([k]) => k === symptom).map(([, b]) => b))])], spike, by: who.roleId, at }, who.instance);
    require('./warnings.js').record(root, { kind: 'fix-on-fix', rule: 'R-22', bead: beadId, detail: `${subject}: fixes merged in PRs ${prs.join(', ')} within 48 h; spike ${spike || '(not created)'} looks for the cause`, raisedBy: who.instance, instance: who.instance, now: at });
    lines.push(`fix on fix: ${subject} was fixed in PRs ${prs.join(', ')} within 48 h. ${spike ? `Spike ${spike} created` : 'The spike could not be created (bd)'}: find the cause before another fix. Fix claims on it warn until it is acknowledged (${row.id}: andon.js ack ${row.id} --reason '...').`);
  }
  return lines;
}

// ---- the claim check ----
const warn = (code, rule, detail, extra = {}) => ({ level: 'warn', code, rule, detail, ...extra });
const block = (code, rule, detail, extra = {}) => ({ level: 'block', code, rule, detail, ...extra });
const norm = (id) => String(id || '').trim().toLowerCase().split('/').pop().replace(/@.*$/, '');

// Findings for claiming `bead`. ctx: { root, parent, fix (fixLink), stories, beadOf, team, now, ci, builder, starts, wipPerSession }
function claimFindings(bead, { root, parent = null, fix = { ok: false }, stories = [], beadOf = () => null, team, now, ci, builder, starts = true, wipPerSession } = {}) {
  const f = [];
  if (!root || !bead) return f;
  const rows = read(root).rows;
  const m = bead.metadata || {};
  const story = parent && G.isStoryBead(parent) && !G.isStoryBead(bead) ? parent : null;
  const area = story ? G.areaOf(story) : G.areaOf(bead);
  const tagged = (a3) => Boolean(a3 && m.a3 && String(m.a3) === a3.id);
  const link = String(m.fixes || '').replace(/\s+#.*$/, '').trim();
  // an area stopped on a failed check: only the recovery work of a failure there goes on (D3c): a fix
  // linked to it, its own story, or its A3's work; recovery for one failure is never held by another
  const here = areaStops(root, { beadOf }).filter((s) => s.area === area);
  const recovery = (s) => bead.id === s.bead || bead.parent === s.bead || (fix.ok && [s.row, s.bead, s.story].includes(link)) || tagged(s.a3);
  if (here.length && !here.some(recovery)) {
    const s = here[0];
    const next = s.a3 ? `its A3 ${s.a3.id} is open` : `no A3 yet (a3.js new --trigger ${s.trigger})`;
    f.push(block('area-stopped', 'D3', `area ${area} is stopped: ${s.row} failed criterion ${s.criterion} of ${s.bead} on the customer's app; fixes only until its A3 closes on a passing check of the fix (${next})`, { stop: s }));
  }
  // a red main stops new claims across the product, until green or an A3 closed after it went red
  const c = ci || ciState(root, { team, rows });
  if (c.red && !fix.ok && !tagged(c.a3)) f.push(block('ci-red', 'D3', `CI on ${c.repo ? `${c.repo} ` : ''}${c.branch} is red since ${String(c.since).slice(0, 16)}${c.workflows && c.workflows.length ? ` (${c.workflows.join(', ')})` : ''}: fixes only until every required workflow is green (${c.a3 ? `A3 ${c.a3.id} is open` : 'a3.js new --trigger ci:main'})`));
  // a flaky test wants an A3 within 24 h: a warning; a stop (D3) only on a named area, once the Delivery
  // Manager confirmed the record and no A3 was opened within 24 h; never the whole product
  for (const r of flakyOpen(root, { now, rows })) {
    if (r.area && r.area !== area) continue;
    if (fix.ok || tagged(r.a3)) continue;
    if (r.overdue && r.area && r.confirmed && !r.a3Opened) f.push(block('flaky-overdue', 'D3', `${r.test} failed then passed on ${String(r.sha).slice(0, 12)}, confirmed, and no A3 was opened within 24 h (due ${r.due.slice(0, 16)}): area ${r.area} takes fixes only until one is (a3.js new --trigger flaky:${r.test})`));
    else f.push(warn('flaky-a3', 'R-22', `${r.test} is flaky (failed then passed on ${String(r.sha).slice(0, 12)}${r.confirmed ? '' : ', unconfirmed'}): its A3 is ${r.overdue && !r.a3Opened ? 'overdue' : `due by ${r.due.slice(0, 16)}`}`));
  }
  // fix on fix: a fix on a symptom with an unacknowledged spike warns
  const mine = symptomsOf(root, bead);
  for (const ch of chains(root, { rows, beadOf })) {
    if (ch.acked || !mine.includes(ch.symptom)) continue;
    f.push(warn('fix-on-fix', 'R-22', `${ch.symptom.replace(/^(fixes|class) /, '')} already had fixes in PRs ${ch.prs.join(', ')} within 48 h: spike ${ch.spike} looks for the cause first (andon.js ack ${ch.id} once its answer is in)`));
  }
  // per-session WIP (R-23): one story in progress and one queued
  if (builder && G.isStoryBead(bead)) {
    const limit = Number.isInteger(wipPerSession) && wipPerSession > 0 ? wipPerSession : 1;
    // merged, deployed, verified or cut work has left the builder's hands
    const held = stories.filter((s) => s.id !== bead.id && s.status !== 'closed' && !G.stateOf(s) && s.assignee && norm(s.assignee) === norm(builder));
    const going = held.filter((s) => s.status === 'in_progress').length + (starts ? 1 : 0);
    const queued = held.filter((s) => s.status !== 'in_progress').length + (starts ? 0 : 1);
    if (going > limit || queued > 1) f.push(warn('wip-session', 'R-23', `${norm(builder)} would hold ${going} in progress and ${queued} queued (limit ${limit} in progress and 1 queued): finish one first`));
  }
  return f;
}

// ---- status ----
// where the fix of a stop stands, in plain words: from its linked fix beads and their review records
function stageOf(root, stop, fixBeads) {
  const R = require('./reviews.js');
  const link = (b) => String(((b && b.metadata) || {}).fixes || '').replace(/\s+#.*$/, '').trim();
  const fixes = fixBeads.filter((b) => [stop.row, stop.bead, stop.story].includes(link(b)) || (stop.a3 && String((b.metadata || {}).a3 || '') === stop.a3.id));
  if (!fixes.length) return stop.a3 ? 'the cause is being written up' : 'the cause is being looked into';
  const ids = new Set(fixes.map((b) => b.id));
  const prs = R.listPrs(root).map((p) => R.read(root, p).rows).filter((rows) => rows.some((r) => r.type === 'request' && (r.beads || []).some((b) => ids.has(b))));
  if (prs.some((rows) => rows.some((r) => r.type === 'merged'))) return 'the fix is merged; checking it on the customer\'s app next';
  if (prs.length) return 'the fix is in review';
  return fixes.some((b) => b.status === 'in_progress') ? 'the fix is being built' : 'a fix is planned';
}

// { stops, ci, flaky, a3s (open), chains (unacknowledged), problem }; fixBeads: the bug and security beads
function summary(root, { beadOf = () => null, team, now, ci, fixBeads = [] } = {}) {
  const { rows, problem } = read(root);
  const stops = areaStops(root, { beadOf }).map((s) => {
    const p = s.a3 ? sectionsOf((() => { try { return fs.readFileSync(path.join(root, a3File(s.a3.id)), 'utf8'); } catch (err) { return ''; } })()).problem : '';
    return { ...s, what: p ? p.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '') : null, stage: stageOf(root, s, fixBeads) };
  });
  return {
    stops,
    ci: ci || ciState(root, { team, rows }),
    flaky: flakyOpen(root, { now, rows }),
    a3s: a3s(root, rows).filter((a) => !a.closed),
    chains: chains(root, { rows, beadOf }).filter((c) => !c.acked),
    ...(problem ? { problem } : {}),
  };
}

// plain lines for the Chief of Staff: no bead, row or PR numbers
function plainLines(s) {
  const out = [];
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  // the area's own name, never a bead id (a story with no area falls back to its parent's id for matching)
  if (s.stops.some((y) => y.unreadable)) out.push('A stop could not be read; the Delivery Manager checks it.');
  for (const x of s.stops.filter((y) => !y.unreadable)) out.push(`${x.areaName ? `The ${x.areaName} area` : 'An unassigned area'} is stopped until we fix why ${x.what ? lower(x.what) : `"${x.title}" failed on the customer's app`}; ${x.stage}.`);
  if (s.ci.red) out.push(`New work is paused across the product: the main build has been failing since ${String(s.ci.since).slice(0, 10)}; only fixes go on.`);
  for (const r of s.flaky) out.push(`A test that passes and fails on the same code is being looked into${r.area ? ` (${r.area})` : ''}${r.overdue && r.area && r.confirmed && !r.a3Opened ? '; its cause is overdue, so new work there waits' : ''}.`);
  for (const c of s.chains) out.push('One problem needed two fixes in two days; we are looking for its cause before fixing it again.');
  return out;
}

module.exports = { MIN_WORDS, weakSections, mergedBead, REL, SECTIONS, read, append, a3File, a3s, openA3For, closedA3For, sectionsOf, missingSections, classOf, areaStops, ciState, redFromRuns, ghRuns, flakyOpen, symptomsOf, chains, fixChain, claimFindings, summary, plainLines, FLAKY_HOURS, CHAIN_HOURS, FAILED };
