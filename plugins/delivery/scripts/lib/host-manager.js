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
const PV = require('./plugin-version.js');

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

// What a restart acts on: each host job stopped (its timer not running), each host job whose timer runs
// but which is silent (its service keeps failing or never runs: one run of its service is started), and
// per team the instances down that hold work. An idle instance that is down stays down: it is listed,
// never started. silent: what silences() found, or none.
function restartPlan(read, silent = []) {
  const jobs = read.units.filter((u) => u.job && u.loaded && !u.running && !u.unavailable).map((u) => u.unit);
  const kick = [];
  for (const s of silent.filter((x) => x.kind === 'job')) {
    const timer = read.units.find((u) => u.root === s.root && u.service);
    if (timer && timer.loaded && timer.running && !timer.unavailable) kick.push({ root: s.root, team: s.team, timer: timer.unit, service: timer.service, lastPass: s.lastPass, what: s.what });
  }
  const instances = {};
  for (const t of read.teams) {
    if (t.manifestUnavailable) continue;
    const want = t.down.filter((i) => t.holding.includes(i));
    if (want.length) instances[t.root] = want;
  }
  return { jobs, kick, instances };
}

// A minute and second count, for how long a restart waited for a session to be listed.
function duration(msec) {
  const sec = Math.max(0, Math.round(msec / 1000));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`;
}

// Whether an instance a restart started is confirmed back: the session list read after the restart shows
// a session in its role directory, and the roster records, for that very session, the plugin version the
// session started under (the version the stale-session restart reads), and it is the installed one. A
// server whose pid is alive is not enough: it may never have joined, or joined on an older plugin.
// live: the session list ([{ cwd, sessionId }] or null); entry: the instance's roster entry.
// -> { state: 'back' | 'unlisted' | 'unrecorded' | 'older' | 'unread' | 'noinstalled', version, installed }
function confirmation({ live, entry, roleDir, installed }) {
  if (!Array.isArray(live)) return { state: 'unread', installed };
  const row = live.find((x) => x && x.cwd && path.resolve(x.cwd) === path.resolve(roleDir));
  if (!row) return { state: 'unlisted', installed };
  const e = entry || {};
  const version = e.plugin_version && e.session_id && row.sessionId && e.session_id === row.sessionId ? e.plugin_version : null;
  if (!version) return { state: 'unrecorded', installed };
  if (!installed) return { state: 'noinstalled', version, installed };
  const c = PV.compare(version, installed);
  if (c === null) return { state: 'unrecorded', installed };
  return c < 0 ? { state: 'older', version, installed } : { state: 'back', version, installed };
}
// still to wait for: a session not listed yet, or listed but not yet recorded by its own start
const waiting = (c) => c.state === 'unlisted' || c.state === 'unrecorded';

// What came back and what did not, each from the read made after the restart.
// before/after: reads; plan: restartPlan's; o: refused { root: { instance: why } }, jobErrors { unit: why },
// started { root: { instance: { pid } } }, confirmed { root: { instance: confirmation() } }, waited (ms),
// restarted { root: { instance: { pid } | { why }, from, to } } (the stale-session restarts revive made),
// passes { root: ms of its last host job pass, read after the restart }, kickErrors { service: why },
// silent (what silences() found)
function restartLines(before, after, plan, o = {}) {
  const { refused = {}, jobErrors = {}, started = {}, confirmed = {}, waited = 0, restarted = {}, passes = {}, kickErrors = {}, silent = [] } = o;
  const out = [];
  const unit = (read, name) => read.units.find((u) => u.unit === name);
  const at = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : 'an unknown time');
  for (const j of plan.jobs) {
    const u = unit(after, j);
    if (u && u.running) out.push(`Back: ${j} is running.`);
    else out.push(`Not back: ${j}${jobErrors[j] ? ` (start failed: ${jobErrors[j]})` : ''}; ${u ? unitLine(u) : 'its state could not be read'}.`);
  }
  for (const k of plan.kick || []) {
    const p = passes[k.root];
    if (kickErrors[k.service]) out.push(`Not back: ${k.team}'s host job, still silent: its timer runs but no pass since ${at(k.lastPass)}, and starting ${k.service} once failed (${kickErrors[k.service]}).`);
    else if (Number.isFinite(p) && (!Number.isFinite(k.lastPass) || p > k.lastPass)) out.push(`Back: ${k.team}'s host job ran a pass at ${at(p)}.`);
    else out.push(`Not back: ${k.team}'s host job, still silent: its timer runs but no pass since ${at(k.lastPass)}; ${k.service} was started once and the read after it shows no new pass.`);
  }
  for (const [root, want] of Object.entries(plan.instances)) {
    const t = after.teams.find((x) => x.root === root);
    const name = (t && t.name) || root;
    for (const i of want) {
      const c = (confirmed[root] || {})[i] || { state: 'unread' };
      const s = (started[root] || {})[i];
      const why = (refused[root] || {})[i];
      if (c.state === 'back') out.push(`Back: ${name} ${i} is running, listed, on the installed plugin ${c.version}.`);
      else if (s && c.state === 'unlisted') out.push(`Not back: ${name} ${i}: started (pid ${s.pid}) but not listed after ${duration(waited)}.`);
      else if (s && c.state === 'older') out.push(`Not back: ${name} ${i}: running an older plugin (${c.version}, installed ${c.installed}).`);
      else if (s && c.state === 'unrecorded') out.push(`Not back: ${name} ${i}: started (pid ${s.pid}) and listed, but its session recorded no plugin version after ${duration(waited)}, so it is not known to run the installed ${c.installed || 'plugin'}.`);
      else if (s && c.state === 'noinstalled') out.push(`Not back: ${name} ${i}: started (pid ${s.pid}) and listed on ${c.version}, but the installed plugin version could not be read.`);
      else if (s) out.push(`Not back: ${name} ${i}: started (pid ${s.pid}), but the session list could not be read after the restart.`);
      else out.push(`Not back: ${name} ${i}${why ? ` (${why})` : t && t.unknown.includes(i) ? ' (whether it runs could not be read)' : ''}.`);
    }
  }
  for (const [root, byInstance] of Object.entries(restarted)) {
    const t = after.teams.find((x) => x.root === root) || before.teams.find((x) => x.root === root);
    const name = (t && t.name) || root;
    for (const [i, r] of Object.entries(byInstance)) {
      const was = `it ran the older plugin ${r.from || 'unknown'}, installed ${r.to || 'unknown'}`;
      if (r.pid) out.push(`Restarted: ${name} ${i} (pid ${r.pid}): ${was}.`);
      else out.push(`Not restarted: ${name} ${i} (${was}): ${r.why}.`);
    }
  }
  for (const s of silent) {
    if (s.kind === 'running') out.push(`Silent while running: ${s.what}. Not stopped: a session that may be in the middle of a turn is not stopped here; it is restarted only when it runs an older plugin and is idle between turns.`);
  }
  for (const t of before.teams) {
    const idle = (t.down || []).filter((i) => !(t.holding || []).includes(i));
    if (idle.length) out.push(`Left down (no work held): ${t.name} ${idle.join(', ')}.`);
  }
  if (!out.length) out.push('Nothing was down that holds work and nothing is silent: nothing was restarted.');
  for (const u of after.unavailable || []) out.push(`SOURCE UNAVAILABLE: ${u}`);
  for (const t of after.teams) for (const u of t.unavailable || []) out.push(`SOURCE UNAVAILABLE: ${t.name}: ${u}`);
  return out;
}

const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };

// The silences the unattended pass acts on, from a read and each team's own records:
//   an instance that holds an in-progress bead, whose beads have had no note and which has had no
//   watchdog wake for SILENT_MS: down (kind 'instance', which a restart starts) or still listed as running
//   (kind 'running', which only an alert names: a session that may be mid-turn is never stopped by an
//   unattended pass); a team's host job that has run no pass for SILENT_MS (kind 'job').
// Each carries its key, team plus instance or team plus host job: the outage ledger opens, alerts and
// closes per key.
// facts per team root: { inProgress: [bead], wakes: [{ instance, at }], lastPass: ms | null, jobInstalled }
function silences(read, facts, now) {
  const t0 = ms(now);
  const out = [];
  const at = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : 'an unknown time');
  for (const t of read.teams) {
    if (t.manifestUnavailable) continue;
    const f = facts[t.root] || {};
    const beads = Array.isArray(f.inProgress) ? f.inProgress : [];
    for (const [kind, list] of [['instance', t.down], ['running', t.running]]) {
      for (const i of list) {
        const mine = beads.filter((b) => holderOf(b && b.assignee) === i);
        if (!mine.length) continue;
        const lastNote = Math.max(...mine.map((b) => Math.max(ms(b.updated_at), ms(b.created_at))));
        const lastWake = Math.max(-Infinity, ...(f.wakes || []).filter((w) => w && w.instance === i).map((w) => ms(w.at)));
        const since = Math.max(lastNote, lastWake);
        if (t0 - since < SILENT_MS) continue;
        const what = kind === 'running'
          ? `${t.name} ${i} is running but silent (holding ${mine.map((b) => b.id).join(', ')}; no bead note and no watchdog wake since ${at(since)})`
          : `${t.name} ${i} (holding ${mine.map((b) => b.id).join(', ')}; no note or wake since ${at(since)})`;
        out.push({ kind, key: `${t.root}#instance:${i}`, team: t.name, root: t.root, instance: i, since: Number.isFinite(since) ? since : null, what });
      }
    }
    const last = f.lastPass;
    if (f.jobInstalled && (last === null || last === undefined || t0 - last >= SILENT_MS)) out.push({ kind: 'job', key: `${t.root}#job`, team: t.name, root: t.root, lastPass: Number.isFinite(last) ? last : null, what: `${t.name}'s host job (no pass since ${at(last)})` });
  }
  return out;
}

// The outage ledger, one outage per silence key: an open row when that silence is first seen, an alert
// row on the pass that opened one or more, a close row on the first pass that no longer finds it. A pass
// while an outage is open restarts again but alerts only for silences not already open.
function readLedger(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return []; }
  const rows = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r && typeof r === 'object') rows.push(r); } catch (err) { /* a torn line */ } }
  return rows;
}
// key -> its open row, for every outage opened and not closed since
function openOutages(rows) {
  const open = new Map();
  for (const r of rows) {
    if (!r || typeof r.key !== 'string') continue;
    if (r.type === 'open') open.set(r.key, r);
    else if (r.type === 'close') open.delete(r.key);
  }
  return open;
}
function appendRow(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

// The owner's alert, in plain words: what went silent, what came back, what did not, and for a silence
// nothing was started for (a session still running), why. Never "nothing came back, nothing failed".
function alertText(silent, result) {
  const back = result.filter((l) => /^Back: /.test(l)).map((l) => l.replace(/^Back: /, '').replace(/\.$/, ''));
  const notBack = result.filter((l) => /^Not back: /.test(l)).map((l) => l.replace(/^Not back: /, '').replace(/\.$/, ''));
  const down = silent.filter((s) => s.kind !== 'running');
  const running = silent.filter((s) => s.kind === 'running');
  const out = [];
  if (down.length) {
    out.push(`The team on this machine went silent: ${down.map((s) => s.what).join('; ')}.`);
    if (back.length || notBack.length) {
      out.push('I restarted what was down.');
      if (back.length) out.push(`Came back: ${back.join('; ')}.`);
      if (notBack.length) out.push(`Not back: ${notBack.join('; ')}.`);
    }
    // every silence of a down instance or a host job gets a Back or Not back line from the restart; this
    // is the guard against an alert that says nothing came back and nothing failed
    if (!back.length && !notBack.length) out.push('Nothing was started for it: what is silent was not found down when the restart read the machine.');
  }
  for (const s of running) out.push(`${s.what.charAt(0).toUpperCase()}${s.what.slice(1)}. I did not stop it: it may be in the middle of a turn. You can ask the host manager to restart the team.`);
  return out.join(' ');
}

module.exports = { UNIT, TICK_SERVICE, TICK_TIMER, ROLE, SILENT_MS, WATCHDOG_UNIT_RE, configHome, stateHome, hostFile, stateDir, outageFile, unitDir, readHostTeams, addHostTeam, unitRoots, teamRoots, parseShow, unitState, unitLine, holderOf, holding, teamState, teamLine, statusLines, restartPlan, restartLines, silences, readLedger, openOutages, appendRow, alertText, duration, confirmation, waiting };
