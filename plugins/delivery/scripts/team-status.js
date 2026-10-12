#!/usr/bin/env node
// scripts/team-status.js — roster versus manifest: who is live, who is missing, what drifted.
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, loadManifest, expandInstances } = require('./lib/manifest.js');
const { readRoster } = require('./lib/roster.js');

function teamStatus(projectRoot, { now, staleHours } = {}) {
  const { team } = loadManifest(projectRoot);
  const roster = readRoster(projectRoot);
  const nowMs = Date.parse(now || new Date().toISOString());
  const staleMs = (staleHours || (team.budget && team.budget.staleness_hours) || 2) * 3600 * 1000;
  const drift = { missing: [], extra: [], wrong_model: [], stale: [] };
  const rows = [];
  const expected = expandInstances(team);
  const expectedIds = new Set(expected.map((i) => i.instance));

  for (const { instance, role } of expected) {
    const entry = roster.instances[instance];
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
  return { rows, drift, recovered_from: roster.recovered_from };
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

function renderStatus({ rows, drift, recovered_from }, projectRoot) {
  const lines = ['| Instance | Role | Host | Model | Session | State |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.instance} | ${r.role} | ${r.host} | ${r.model} | ${r.session_id} | ${r.state} |`);
  lines.push('');
  if (projectRoot) { lines.push(`Manifest: ${projectRoot} at ${manifestRev(projectRoot)}`); lines.push(''); }
  if (recovered_from) { lines.push(`Note: roster.json was unreadable and moved to ${recovered_from}; the roster restarts empty.`); lines.push(''); }
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

module.exports = { teamStatus, renderStatus };
