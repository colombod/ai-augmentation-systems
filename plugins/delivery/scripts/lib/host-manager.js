// scripts/lib/host-manager.js — the rules of the host manager: one role session per machine that tells
// the owner which role sessions and host jobs of every product team on this machine are down, brings
// them back on one message, and does so by itself when a team goes silent.
//
// Facts in, lines and plans out. Every read (systemctl, `claude agents`, bd, the clock, the files under
// the user's configuration and state directories) is the script's (scripts/host-manager.js), injected,
// so each rule here runs in a test with fakes.
const fs = require('fs');
const os = require('os');
const path = require('path');

// The units the host manager owns: its own Remote Control session, kept alive by systemd, and the
// timer that runs the unattended pass. The watchdog's host job checks the first (watchdog.js run).
const UNIT = 'delivery-host-manager.service';
const TICK_SERVICE = 'delivery-host-manager-tick.service';
const TICK_TIMER = 'delivery-host-manager-tick.timer';
const ROLE = 'host-manager';
// Silence long enough to act on: an instance holding work with no bead note and no wake, or a host job
// with no pass, for this long.
const SILENT_MS = 30 * 60e3;
const WATCHDOG_UNIT_RE = /^delivery-watchdog-([0-9a-f]+)\.service$/;

const configHome = (env = process.env, home = os.homedir()) => env.XDG_CONFIG_HOME || path.join(home, '.config');
const stateHome = (env = process.env, home = os.homedir()) => env.XDG_STATE_HOME || path.join(home, '.local', 'state');
// the list of product teams this machine serves, written by every install (watchdog.js, host-manager.js)
const hostFile = (env, home) => path.join(configHome(env, home), 'delivery', 'host-teams.json');
const stateDir = (env, home) => path.join(stateHome(env, home), 'delivery', 'host-manager');
const outageFile = (env, home) => path.join(stateDir(env, home), 'outages.ndjson');
const unitDir = (home = os.homedir()) => path.join(home, '.config', 'systemd', 'user');

// { teams: [root] }, or { teams: [], unreadable } when the file is there but cannot be read: a missing
// file is an empty list (no install has run yet), never an error
function readHostTeams(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return { teams: [] }; }
  try {
    const j = JSON.parse(text);
    const teams = j && Array.isArray(j.teams) ? j.teams.filter((t) => typeof t === 'string' && path.isAbsolute(t)) : null;
    return teams ? { teams } : { teams: [], unreadable: `${file} has no "teams" list` };
  } catch (err) { return { teams: [], unreadable: `${file} is not JSON` }; }
}

// Adds root to the host file, sorted and once: running an install twice leaves the file as it was.
// Written aside and renamed in, so a reader never sees half a file. Returns whether the file changed.
function addHostTeam(file, root) {
  const r = readHostTeams(file);
  if (r.unreadable) throw new Error(`${r.unreadable}; it was left as it is`);
  const teams = [...new Set([...r.teams, path.resolve(root)])].sort();
  if (teams.length === r.teams.length && teams.every((t, i) => t === r.teams[i])) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ teams }, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return true;
}

// The project root of each watchdog host job installed for this user: its service's WorkingDirectory
// (watchdog.js jobFiles writes it, with % doubled as systemd's specifier sign). A team whose host job
// was installed before the host file existed is still found this way.
function unitRoots(dir, { readdir = fs.readdirSync, readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  let names = [];
  try { names = readdir(dir).filter((f) => WATCHDOG_UNIT_RE.test(f)); } catch (err) { return []; }
  const out = [];
  for (const f of names.sort()) {
    let body = '';
    try { body = readFile(path.join(dir, f)); } catch (err) { continue; }
    const m = /^WorkingDirectory=(.+)$/m.exec(body);
    if (m) out.push(m[1].trim().replace(/%%/g, '%'));
  }
  return out;
}

// The teams: the host file and the installed host jobs together, each root once, sorted.
const teamRoots = (fromFile, fromUnits) => [...new Set([...fromFile, ...fromUnits].map((r) => path.resolve(r)))].sort();

// `systemctl show` output (Key=Value per line) as an object
function parseShow(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const k = line.indexOf('=');
    if (k > 0) out[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  return out;
}

// One unit's state from its `show`: { unit, loaded, running, since }. A unit systemd does not know
// (LoadState=not-found) is not installed; anything else not active is stopped, since the time systemd
// gives (InactiveEnterTimestamp, else StateChangeTimestamp), or "an unknown time".
function unitState(unit, show) {
  const loaded = show.LoadState !== 'not-found' && show.LoadState !== undefined;
  const running = show.ActiveState === 'active' || show.ActiveState === 'reloading' || show.ActiveState === 'activating';
  const since = show.InactiveEnterTimestamp || show.StateChangeTimestamp || '';
  return { unit, loaded, running, since: since && since !== 'n/a' ? since : null };
}

function unitLine(u) {
  if (u.unavailable) return `SOURCE UNAVAILABLE: the state of ${u.unit} (${u.unavailable})`;
  if (!u.loaded) return `${u.unit}: not installed`;
  return u.running ? `${u.unit}: running` : `${u.unit}: stopped since ${u.since || 'an unknown time'}`;
}

// The instance a bead's assignee names: the instance itself, or an actor ending in /<instance>.
const holderOf = (assignee) => { const a = String(assignee || ''); return a ? a.split('/').pop() : null; };

// Who holds work, per instance: an in-progress bead assigned to it, a message or a handoff waiting for
// it, a pull request open from its team branch. Unreadable beads make the answer unknown.
function holding(f) {
  const out = new Set();
  if (Array.isArray(f.inProgress)) for (const b of f.inProgress) { const h = holderOf(b && b.assignee); if (h) out.add(h); }
  for (const m of f.messages || []) if (m && m.to) out.add(m.to);
  for (const h of f.handoffs || []) if (h && h.to) out.add(h.to);
  if (Array.isArray(f.prs)) for (const p of f.prs) { const m = /^team\/(.+)$/.exec(String(p && p.headRefName || '')); if (m) out.add(m[1]); }
  return out;
}

// One team, read: { name, root, total, running: [], down: [], unknown: [], holding: [], holdingUnknown,
// unavailable: [] }. An instance whose state could not be read is unknown: never running, never down.
function teamState(root, a, f) {
  const name = (f.team && f.team.project) || path.basename(root);
  const held = holding(f);
  const st = { name, root, total: a.instances.length, running: [], down: [], unknown: [], holding: [], holdingUnknown: Boolean(f.inProgress && f.inProgress.unreadable), unavailable: a.unreadable.slice() };
  for (const i of a.instances) {
    if (i.running === 'not known') st.unknown.push(i.instance);
    else if (i.running) st.running.push(i.instance);
    else st.down.push(i.instance);
    if (held.has(i.instance)) st.holding.push(i.instance);
  }
  return st;
}

const list = (xs) => (xs.length ? xs.join(', ') : 'none');
function teamLine(t) {
  const work = t.holdingUnknown ? `${t.holding.length ? `${list(t.holding)}, ` : ''}the rest not known (beads unreadable)` : list(t.holding);
  return `${t.name}: ${t.running.length} of ${t.total} sessions running; down: ${list(t.down)}; holding work: ${work}${t.unknown.length ? `; not known whether running: ${list(t.unknown)}` : ''}`;
}

// The health reply: a line per team, a line per host job unit, a line per source that could not be read.
function statusLines(read) {
  const out = [];
  for (const u of read.unavailable || []) out.push(`SOURCE UNAVAILABLE: ${u}`);
  for (const t of read.teams) {
    if (t.manifestUnavailable) { out.push(`SOURCE UNAVAILABLE: the team at ${t.root} (${t.manifestUnavailable})`); continue; }
    out.push(teamLine(t));
    for (const u of t.unavailable) out.push(`SOURCE UNAVAILABLE: ${t.name}: ${u}`);
  }
  for (const u of read.units) out.push(unitLine(u));
  if (!read.teams.length) out.push('No product team is known on this host: none in the host file and no watchdog host job installed.');
  return out;
}

// What a restart acts on: each host job stopped (its timer not running), and per team the instances
// down that hold work. An idle instance that is down stays down: it is listed, never started.
function restartPlan(read) {
  const jobs = read.units.filter((u) => u.job && u.loaded && !u.running && !u.unavailable).map((u) => u.unit);
  const instances = {};
  for (const t of read.teams) {
    if (t.manifestUnavailable) continue;
    const want = t.down.filter((i) => t.holding.includes(i));
    if (want.length) instances[t.root] = want;
  }
  return { jobs, instances };
}

// What came back and what did not, each from the read made after the restart.
// before/after: reads; started: { root: { instance: true } } from the start passes; held: { root: [lines] }
function restartLines(before, after, plan, { refused = {}, jobErrors = {} } = {}) {
  const out = [];
  const unit = (read, name) => read.units.find((u) => u.unit === name);
  for (const j of plan.jobs) {
    const u = unit(after, j);
    if (u && u.running) out.push(`Back: ${j} is running.`);
    else out.push(`Not back: ${j}${jobErrors[j] ? ` (start failed: ${jobErrors[j]})` : ''}; ${u ? unitLine(u) : 'its state could not be read'}.`);
  }
  for (const [root, want] of Object.entries(plan.instances)) {
    const t = after.teams.find((x) => x.root === root);
    for (const i of want) {
      const why = (refused[root] || {})[i];
      if (t && t.running.includes(i)) out.push(`Back: ${t.name} ${i} is running.`);
      else out.push(`Not back: ${(t && t.name) || root} ${i}${why ? ` (${why})` : t && t.unknown.includes(i) ? ' (whether it runs could not be read)' : ''}.`);
    }
  }
  for (const t of before.teams) {
    const idle = (t.down || []).filter((i) => !(t.holding || []).includes(i));
    if (idle.length) out.push(`Left down (no work held): ${t.name} ${idle.join(', ')}.`);
  }
  if (!out.length) out.push('Nothing was down that holds work: nothing was restarted.');
  for (const u of after.unavailable || []) out.push(`SOURCE UNAVAILABLE: ${u}`);
  for (const t of after.teams) for (const u of t.unavailable || []) out.push(`SOURCE UNAVAILABLE: ${t.name}: ${u}`);
  return out;
}

const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };

// The silences the unattended pass acts on, from a read and each team's own records:
//   an instance down that holds an in-progress bead, whose beads have had no note and which has had no
//   watchdog wake for SILENT_MS; a team's host job that has run no pass for SILENT_MS.
// facts per team root: { inProgress: [bead], wakes: [{ instance, at }], lastPass: ms | null }
function silences(read, facts, now) {
  const t0 = ms(now);
  const out = [];
  for (const t of read.teams) {
    if (t.manifestUnavailable) continue;
    const f = facts[t.root] || {};
    const beads = Array.isArray(f.inProgress) ? f.inProgress : [];
    for (const i of t.down) {
      const mine = beads.filter((b) => holderOf(b && b.assignee) === i);
      if (!mine.length) continue;
      const lastNote = Math.max(...mine.map((b) => Math.max(ms(b.updated_at), ms(b.created_at))));
      const lastWake = Math.max(-Infinity, ...(f.wakes || []).filter((w) => w && w.instance === i).map((w) => ms(w.at)));
      if (t0 - Math.max(lastNote, lastWake) >= SILENT_MS) out.push({ kind: 'instance', team: t.name, root: t.root, instance: i, what: `${t.name} ${i} (holding ${mine.map((b) => b.id).join(', ')}; no note or wake since ${Number.isFinite(Math.max(lastNote, lastWake)) ? new Date(Math.max(lastNote, lastWake)).toISOString() : 'an unknown time'})` });
    }
    const last = f.lastPass;
    if (f.jobInstalled && (last === null || last === undefined || t0 - last >= SILENT_MS)) out.push({ kind: 'job', team: t.name, root: t.root, what: `${t.name}'s host job (no pass since ${Number.isFinite(last) ? new Date(last).toISOString() : 'an unknown time'})` });
  }
  return out;
}

// The outage ledger: one open row when a silence is first seen, an alert row with it, a close row on the
// first pass that finds none. A pass during an open outage restarts again but sends no second alert.
function readLedger(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return []; }
  const rows = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r && typeof r === 'object') rows.push(r); } catch (err) { /* a torn line */ } }
  return rows;
}
function openOutage(rows) {
  for (let k = rows.length - 1; k >= 0; k--) {
    if (rows[k].type === 'close') return null;
    if (rows[k].type === 'open') return rows[k];
  }
  return null;
}
function appendRow(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

// The owner's alert, in plain words: what was down, what came back, what did not.
function alertText(silent, result) {
  const back = result.filter((l) => /^Back: /.test(l)).map((l) => l.replace(/^Back: /, '').replace(/ is running\.$/, ''));
  const notBack = result.filter((l) => /^Not back: /.test(l)).map((l) => l.replace(/^Not back: /, '').replace(/\.$/, ''));
  return `The team on this machine went silent: ${silent.map((s) => s.what).join('; ')}. I restarted what was down. Came back: ${back.length ? back.join(', ') : 'nothing'}. Not back: ${notBack.length ? notBack.join('; ') : 'nothing'}.`;
}

module.exports = { UNIT, TICK_SERVICE, TICK_TIMER, ROLE, SILENT_MS, WATCHDOG_UNIT_RE, configHome, stateHome, hostFile, stateDir, outageFile, unitDir, readHostTeams, addHostTeam, unitRoots, teamRoots, parseShow, unitState, unitLine, holderOf, holding, teamState, teamLine, statusLines, restartPlan, restartLines, silences, readLedger, openOutage, appendRow, alertText };
