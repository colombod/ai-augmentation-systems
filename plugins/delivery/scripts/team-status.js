#!/usr/bin/env node
// scripts/team-status.js — roster versus manifest: who is live, who is missing, what drifted.
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, loadManifest, expandInstances, manifestWarnings } = require('./lib/manifest.js');
const { readRoster } = require('./lib/roster.js');
const fs = require('fs');

// Can bd find a database from the project root? Role directories need BEADS_DIR (prepare-role
// writes it when <project>/.beads exists); a failure here means the hooks cannot see beads either.
function bdReachable(projectRoot) {
  try {
    execFileSync('bd', ['where'], { cwd: projectRoot, stdio: ['ignore', 'ignore', 'ignore'], timeout: 10000 });
    return true;
  } catch (err) {
    return false;
  }
}

// Operator decisions at a glance: entries in this host's private operator store that the remote's
// delivery-operator branch does not hold yet ("no remote" without one), human inputs with no record or
// ack, inferred answers awaiting ratification. All zero when the operator directory does not exist.
// Read-only: no refresh, no network, no git writes; a failure becomes a note, never an exit code.
function operatorStatus(projectRoot, team, { host, deps = {} } = {}) {
  const res = { unpublished: 0, pending_inputs: [], unratified: [], notes: [] };
  const log = deps.log || require('./lib/operator-log.js');
  if (!fs.existsSync(log.opDir(projectRoot))) return res;
  const R = deps.records || require('./lib/operator-records.js');
  try {
    const h = host || process.env.DELIVERY_HOST;
    const instances = h ? expandInstances(team).filter((i) => i.role.host === h).map((i) => i.instance) : [];
    const u = log.unpublished(projectRoot, h ? { host: h, instances } : { all: true });
    res.unpublished = u.count || 0;
    if (u.no_remote && u.reason === 'no remote') res.no_remote = true;
    if (res.unpublished && u.oldest) res.unpublished_since = u.oldest;
    // a count that could not be taken (not a git repository, an error) is not "all published"
    if (!res.no_remote && u.reason && !/^not pushed/.test(u.reason)) res.unpublished_reason = u.reason;
  } catch (err) { res.notes.push(`unpublished count unavailable: ${err.message}`); }
  try {
    const p = R.pending(projectRoot, {});
    res.pending_inputs = (p.inputs || []).map((e) => e.id);
    res.unratified = (p.unratified_answers || []).map((a) => a.id);
    if ((p.problems || []).length) res.notes.push(`${p.problems.length} operator record problem(s): run operator.js problems`);
  } catch (err) { res.notes.push(`operator pending unavailable: ${err.message}`); }
  return res;
}

// The gates at a glance (R-12, ruling 3): open warnings by kind and those over 24 h, and the story
// states merged / deployed / verified with any area over the unverified cap. Read-only; a failed bead
// read becomes a note.
function gateStatus(projectRoot, team, { now, storyBeads } = {}) {
  const W = require('./lib/warnings.js');
  const G = require('./lib/gates.js');
  const { maxUnverified } = require('./lib/gate-context.js');
  const out = { warnings: W.summary(W.list(projectRoot), now), states: null, notes: [] };
  try {
    const beads = storyBeads ? storyBeads() : require('./lib/bd.js').makeBd({ cwd: projectRoot }).list({ label: 'story', all: true });
    out.states = G.stateCounts(beads.filter((b) => b.status !== 'closed' || G.stateOf(b) === 'verified'), maxUnverified(team));
  } catch (err) { out.notes.push(`story states unavailable: ${String(err.message).split('\n')[0]}`); }
  return out;
}

function teamStatus(projectRoot, { now, staleHours, bdCheck, host, operatorDeps, storyBeads } = {}) {
  const { team } = loadManifest(projectRoot);
  const roster = readRoster(projectRoot);
  const nowMs = Date.parse(now || new Date().toISOString());
  const staleMs = (staleHours ?? (team.budget && team.budget.staleness_hours) ?? 2) * 3600 * 1000;
  const drift = { missing: [], extra: [], wrong_model: [], stale: [] };
  const rows = [];
  const expected = expandInstances(team);
  const expectedIds = new Set(expected.map((i) => i.instance));

  for (const { instance, role } of expected) {
    const entry = roster.instances[instance];
    // a retired role stays listed so its operator records keep verifying on every host; it is not
    // expected to run, so it is never missing, stale or drift
    if (role.retired) {
      rows.push({ instance, role: role.id, host: role.host, model: role.model, session_id: entry ? entry.session_id : '', last_seen: entry ? entry.last_seen : '', state: 'retired' });
      continue;
    }
    if (!entry) {
      drift.missing.push(instance);
      rows.push({ instance, role: role.id, host: role.host, model: role.model, session_id: '', last_seen: '', state: 'missing' });
      continue;
    }
    const age = nowMs - Date.parse(entry.last_seen);
    const state = age <= staleMs ? 'live' : 'stale';
    if (state === 'stale') drift.stale.push(instance);
    if (entry.model !== role.model) drift.wrong_model.push({ instance, expected: role.model, actual: entry.model });
    rows.push({ instance, role: role.id, host: entry.host, model: entry.model, session_id: entry.session_id, last_seen: entry.last_seen, state });
  }
  for (const instance of Object.keys(roster.instances)) {
    if (!expectedIds.has(instance)) drift.extra.push(instance);
  }
  let bd_reachable = false;
  try { bd_reachable = Boolean((bdCheck || bdReachable)(projectRoot)); } catch (err) { bd_reachable = false; }
  const operator = operatorStatus(projectRoot, team, { host, deps: operatorDeps });
  const gates = gateStatus(projectRoot, team, { now, storyBeads: storyBeads || (bd_reachable ? undefined : () => { throw new Error('bd unreachable'); }) });
  return { rows, drift, recovered_from: roster.recovered_from, bd_reachable, operator, gates, warnings: manifestWarnings(team) };
}

function hasDrift(drift) {
  return Boolean(drift.missing.length || drift.extra.length || drift.wrong_model.length || drift.stale.length);
}

function manifestRev(projectRoot) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'not a git repo';
  } catch (err) {
    return 'not a git repo';
  }
}

const firstIds = (ids) => (ids.length ? ` (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', ...' : ''})` : '');

function renderStatus({ rows, drift, recovered_from, bd_reachable, operator, gates, warnings }, projectRoot) {
  const lines = [];
  // unacknowledged warnings older than 24 h come first: they head the Chief of Staff's plan
  if (gates && gates.warnings.overdue.length) {
    lines.push(`Warnings unacknowledged over 24 h: ${gates.warnings.overdue.length} (the Delivery Manager resolves or acks each: warnings.js ack <id> --reason '...')`);
    for (const w of gates.warnings.overdue.slice(0, 10)) lines.push(`- ${w.id} ${w.rule || ''} ${w.bead || '-'}: ${w.detail}`);
    lines.push('');
  }
  lines.push('| Instance | Role | Host | Model | Session | State |', '|---|---|---|---|---|---|');
  for (const r of rows) lines.push(`| ${r.instance} | ${r.role} | ${r.host} | ${r.model} | ${r.session_id} | ${r.state} |`);
  lines.push('');
  if (projectRoot) { lines.push(`Manifest: ${projectRoot} at ${manifestRev(projectRoot)}`); lines.push(''); }
  if (operator) {
    const why = operator.no_remote ? ' (no remote: the operator store is local only)'
      : operator.unpublished_reason === 'not a git repository' ? ' (not a git repository: the records stay on this host)'
        : operator.unpublished_reason ? ` (count unavailable: ${operator.unpublished_reason})` : '';
    lines.push(`Operator entries unpublished: ${operator.unpublished}${why}`);
    const hours = operator.unpublished_since ? Math.floor((Date.now() - Date.parse(operator.unpublished_since)) / 3600e3) : 0;
    if (hours >= 24 && !operator.no_remote) lines.push(`Warning: operator entries unpublished for ${hours} hours: run operator.js publish, or check the remote (push access, the delivery-operator branch rules)`);
    lines.push(`Operator inputs pending a record: ${operator.pending_inputs.length}${firstIds(operator.pending_inputs)}`);
    lines.push(`Inferred answers awaiting ratification: ${operator.unratified.length}${firstIds(operator.unratified)}`);
    for (const n of operator.notes) lines.push(`Note: ${n}`);
    lines.push('');
  }
  if (gates) {
    const kinds = Object.entries(gates.warnings.byKind).map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(`Warnings open: ${gates.warnings.open}${kinds ? ` (${kinds})` : ''}; acknowledged: ${gates.warnings.acked}`);
    if (gates.states) {
      lines.push(`Stories: merged ${gates.states.merged}, deployed ${gates.states.deployed}, verified ${gates.states.verified} (merged and deployed are not verified)`);
      for (const o of gates.states.overCap) lines.push(`Warning: area ${o.area} has ${o.count} merged-but-unverified stories (cap ${o.cap}): ${o.ids.join(', ')}; new work there is refused until they are verified`);
    }
    for (const n of gates.notes) lines.push(`Note: ${n}`);
    lines.push('');
  }
  if (bd_reachable === false) { lines.push('Warning: bd unreachable from role directories: run bd init in the project root, then rerun prepare-role so the roles get BEADS_DIR'); lines.push(''); }
  if (recovered_from) { lines.push(`Note: roster.json was unreadable and moved to ${recovered_from}; the roster restarts empty.`); lines.push(''); }
  for (const w of warnings || []) lines.push(`Warning: ${w}`);
  lines.push('To change a model: edit roles[].model in .delivery/team/team.json, rerun prepare-role for that instance, restart its session.');
  lines.push('');
  if (!hasDrift(drift)) { lines.push('No drift.'); return lines.join('\n'); }
  lines.push('## Roster drift');
  if (drift.missing.length) lines.push(`Missing: ${drift.missing.join(', ')}`);
  if (drift.stale.length) lines.push(`Stale: ${drift.stale.join(', ')}`);
  if (drift.extra.length) lines.push(`Extra (not in team.json): ${drift.extra.join(', ')}`);
  for (const w of drift.wrong_model) lines.push(`Wrong model: ${w.instance} expected ${w.expected}, running ${w.actual}`);
  return lines.join('\n');
}

if (require.main === module) {
  const idx = process.argv.indexOf('--project');
  if (idx >= 0 && (process.argv[idx + 1] === undefined || process.argv[idx + 1].startsWith('--'))) {
    console.error('team-status: --project needs a path'); process.exit(2);
  }
  const root = idx >= 0 ? path.resolve(process.argv[idx + 1]) : findProjectRoot(process.cwd());
  if (!root) { console.error('team-status: no .delivery/team/team.json found from here; pass --project <root>'); process.exit(2); }
  let status;
  try { status = teamStatus(root); } catch (err) { console.error(`team-status: ${err.message}`); process.exit(2); }
  console.log(renderStatus(status, root));
  process.exit(hasDrift(status.drift) ? 1 : 0);
}

module.exports = { teamStatus, renderStatus, operatorStatus, gateStatus };
