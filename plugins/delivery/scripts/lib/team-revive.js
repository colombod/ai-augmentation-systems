// scripts/lib/team-revive.js — brings a product team's missing role sessions back on the links the owner
// follows (dec-chief-of-staff-000279).
//
// After a network loss the role sessions the owner follows in the Claude app through Remote Control
// dropped, and the watchdog only brought work back as headless `claude --resume -p` wakes: the owner's
// links stayed gone until the owner restarted each one. The decision: when a product has work in
// flight and its team is not running, the team is started, with no step from the owner. So for each
// role instance on this host whose role directory has no open session, this starts
// `claude remote-control` there, detached; with the Remote Control session id last recorded for that
// directory it reattaches (`--session-id`), so the link the owner follows comes back.
//
// Where the Remote Control session id comes from (claude 2.1.318, read on a real host, undocumented):
//   - <config>/projects/<dir as claude names it>/bridge-pointer.json, written by `claude remote-control`
//     for the directory it serves: { sessionId: "session_...", environmentId, pid, procStart }. It is
//     what `remote-control --continue` reads, and it stays after the server exits.
//   - <config>/sessions/<pid>.json, one per open session (what `claude agents` reads): a Remote
//     Control session carries bridgeSessionId, the same "session_..." id.
// Either can change form in a later claude: unreadable is "no id", and the start is then a new session.
//
// Facts in, plan out: the reads and the spawn are the script's (scripts/team-revive.js), injected, so
// every rule here runs in a test with no claude, bd or gh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const WD = require('./watchdog.js');
const SN = require('./session-name.js');
const M = require('./manifest.js');
const PV = require('./plugin-version.js');

const LEDGER = 'revive.ndjson';
const ledgerFile = (root) => path.join(root, WD.REL, LEDGER);
// one start per instance an hour and six a day, the wake's own caps: a session that dies at once
// (no login, a bad flag) is retried hourly, never in a loop
const START_EVERY_MS = WD.WAKE_EVERY_MS;
const DAILY_CAP = WD.DAILY_CAP;
const DAY = 24 * 3600e3;
// the modes `claude remote-control --permission-mode` takes on claude 2.1.318: its help lists acceptEdits,
// auto, bypassPermissions, default, dontAsk, plan, and its parser takes acceptEdits, auto, bypassPermissions,
// manual, dontAsk, plan. Only the five both agree on are passed: "default" (the help's) and "manual" (the
// parser's) are claude's own default mode, which a start gets by sending no --permission-mode at all
// (team-revive.test.js pins this to the quoted help).
const RC_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan'];
const RC_DEFAULT_MODES = ['default', 'manual'];
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };

// this host's name as team.json names hosts: DELIVERY_HOST (a role session and the macOS job carry it),
// else the machine's short hostname, as start.js names the host it sets up
const hostOf = (env = process.env, hostname = os.hostname()) => String(env.DELIVERY_HOST || String(hostname || '').split('.')[0] || '');
const configDirOf = (env = process.env, home = os.homedir()) => env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
// claude keeps a directory's state under projects/ with every character but a letter or digit made "-"
// (a path over 200 characters is shortened with a hash there: not read, so such a directory has no id)
const projectKey = (dir) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');

function readJson(file) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return null; }
  return j && typeof j === 'object' ? j : null;
}

// the Remote Control session claude last recorded for a directory, or null
function pointerOf(configDir, dir) {
  const j = readJson(path.join(configDir, 'projects', projectKey(dir), 'bridge-pointer.json'));
  return j && ID_RE.test(String(j.sessionId || '')) ? { sessionId: j.sessionId, pid: Number(j.pid) || null } : null;
}

// the open sessions' own files that name a Remote Control session: [{ sessionId, cwd, bridgeSessionId, pid }]
function bridgeSessions(configDir) {
  let names = [];
  try { names = fs.readdirSync(path.join(configDir, 'sessions')).filter((f) => /^\d+\.json$/.test(f)); } catch (err) { return []; }
  const out = [];
  for (const f of names) {
    const j = readJson(path.join(configDir, 'sessions', f));
    if (j && ID_RE.test(String(j.bridgeSessionId || ''))) out.push({ sessionId: j.sessionId || null, cwd: j.cwd || null, bridgeSessionId: j.bridgeSessionId, pid: j.pid || null });
  }
  return out;
}

// A session started under Remote Control (its environment says so: CLAUDE_CODE_ENVIRONMENT_KIND=bridge,
// read from a real Remote Control session) learns its Remote Control id at its start: its own session
// file when claude has written the id there, else the pointer the server wrote for its directory.
// Any other session gets null and the roster keeps what it had.
function remoteSessionOf({ env = process.env, sessionId, roleDir, configDir = configDirOf(env) } = {}) {
  if (env.CLAUDE_CODE_ENVIRONMENT_KIND !== 'bridge') return null;
  const own = sessionId ? bridgeSessions(configDir).find((s) => s.sessionId === sessionId) : null;
  if (own) return own.bridgeSessionId;
  const p = roleDir ? pointerOf(configDir, roleDir) : null;
  return p ? p.sessionId : null;
}

// the starts this host made, oldest first; a torn last line (a write cut short) is skipped
function ledger(root) {
  let text = '';
  try { text = fs.readFileSync(ledgerFile(root), 'utf8'); } catch (err) { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r = null;
    try { r = JSON.parse(line); } catch (err) { r = null; }
    if (r && typeof r === 'object') rows.push(r);
  }
  return rows;
}
// One start pass at a time per project: the Chief of Staff's `team-revive.js start` and the host job's
// pass both go through revive(start), and two passes within seconds would each read a ledger without the
// other's start and open two links in one directory. An exclusive lock file ('wx') beside the ledger
// holds { pid, at }; a lock older than LOCK_STALE_MS (a pass spawns and records in well under that) or
// whose pid no longer runs is a pass that died, and is broken. Held: { held: { pid } }; taken: { release }.
const LOCK = 'revive.lock';
const lockFile = (root) => path.join(root, WD.REL, LOCK);
const LOCK_STALE_MS = 2 * 60e3;
function pidRuns(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}
function startLock(root, { now = Date.now(), runs = pidRuns } = {}) {
  const file = lockFile(root);
  WD.ensureDir(root);
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd = null;
    try { fd = fs.openSync(file, 'wx'); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = null;
      let age = 0;
      try { age = now - fs.statSync(file).mtimeMs; holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* not written yet, or gone */ }
      const pid = holder && Number(holder.pid);
      // a lock whose content is not written yet is judged by its age alone
      if (age > LOCK_STALE_MS || (pid && !runs(pid))) { try { fs.unlinkSync(file); } catch (e) { /* another pass broke it first */ } continue; }
      return { held: { pid: pid || null } };
    }
    const token = `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`;
    try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString(), token })); } finally { fs.closeSync(fd); }
    return {
      release() {
        // only our own lock: one broken as stale and taken by another pass is that pass's
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file); } catch (e) { /* gone already */ }
      },
    };
  }
  return { held: { pid: null } };
}

function record(root, row) {
  WD.ensureDir(root);
  WD.rotate(ledgerFile(root));
  fs.appendFileSync(ledgerFile(root), `${JSON.stringify(row)}\n`);
  return row;
}

// The mode a started session runs in: team.json permission_mode, as for a wake; auto, start.js's default,
// when the team has none. default or manual is claude's own default: no mode flag ({ mode: null }). Any
// other mode Remote Control does not take is no start, with the reason: a session must never run with
// more than the owner chose, and claude exits on a mode it refuses.
function modeOf(team) {
  const m = team && team.permission_mode;
  if (m === undefined) return { mode: 'auto' };
  if (RC_DEFAULT_MODES.includes(m)) return { mode: null };
  return RC_MODES.includes(m) ? { mode: m } : { skip: `team.json permission_mode "${String(m).slice(0, 40)}" is not one Remote Control takes (${RC_MODES.join(', ')})` };
}

// A role session still open on an older plugin than the installed one (delivery-plugin-planning-hjx.1.6.7).
// Claude Code loads a plugin's hooks when a session starts, so a session that was running when a new
// version was installed keeps the old version's lane (its hooks judge every command against the old
// roles and groups) for as long as it runs; the watchdog's fresh wakes only reach a session that is not
// open. Such a session is restarted on the installed version: its Remote Control server is stopped while
// the session is idle between turns, and a new server reattaches the same Remote Control session
// (--session-id), so the owner's link and the conversation come back, now under the installed hooks.
// Which version it runs: what its start recorded in the roster (roster.js plugin_version), only when the
// roster names this very session; another session's version says nothing about this one.
// null when it is not stale; else { version, installed, server, remoteId, args } with skip or held when
// it is not restarted now, and why.
function staleOf(f, { e, open, starts, last, t, team, name, same }) {
  if (!f.installed || !e.session_id || e.session_id !== open.sessionId) return null;
  if (PV.compare(e.plugin_version, f.installed) !== -1) return null;
  const st = { version: e.plugin_version, installed: f.installed, session: open.sessionId, pid: open.pid || null, server: null, remoteId: null, skip: null, held: null };
  const server = f.serverOf ? f.serverOf(open.pid) : null;
  const bridge = (f.bridges || []).find((s) => same(s.cwd) && (!s.sessionId || s.sessionId === open.sessionId));
  st.remoteId = bridge ? bridge.bridgeSessionId : null;
  const m = modeOf(team);
  st.mode = m.mode || null;
  if (server && server.unreadable) st.held = `the process list could not be read, so its Remote Control server is not known (${server.unreadable})`;
  else if (!server || !server.pid) st.skip = 'it does not run under a Remote Control server this host started, so it is not stopped here; it runs the installed plugin from its next start';
  else if (server.self) st.skip = 'this pass runs inside it, so it is not stopped from here; the host job restarts it';
  else if (!st.remoteId) st.skip = 'no Remote Control session id is recorded for it, so a restart would give the owner a new link';
  else if (m.skip) st.skip = m.skip;
  if (server && server.pid) st.server = server.pid;
  if (st.skip || st.held) return st;
  // a restart onto this version that did not take (the session still records the older one since) is
  // not tried again: a loop of stops would cost the owner the link each hour
  const tried = starts.filter((r) => r.type === 'restart' && r.to === f.installed);
  const lastTry = tried[tried.length - 1];
  if (lastTry && ms(e.last_seen) > ms(lastTry.at)) st.held = `restarted ${WD.clock(ms(lastTry.at))} onto ${f.installed}, and its session still records ${e.plugin_version}; not tried again`;
  else if (open.status !== 'idle') st.held = `it is ${open.status || 'busy'}; it is restarted only when idle between turns`;
  else if (last && t - ms(last.at) < START_EVERY_MS) st.held = `started ${WD.clock(ms(last.at))}; the next start is after ${WD.clock(ms(last.at) + START_EVERY_MS)} (one start an hour)`;
  else if (starts.filter((r) => t - ms(r.at) < DAY).length >= DAILY_CAP) st.held = 'started the most times a day allows';
  st.args = ['remote-control', '--name', name, '--session-id', st.remoteId, ...(st.mode ? ['--permission-mode', st.mode] : [])];
  return st;
}

// What there is to bring back, and what holds it.
// facts: { now, host, team, roster (instances), live: [{cwd,sessionId,name}] | null, bridges, pointer(dir),
//   defaultDir(instance), exists(dir), inProgress: [bead] | { unreadable }, prs: [{number, headRefName}] |
//   { unreadable }, messages: inbox.pending(), handoffs: handoff.pending(), paused: bool | { unreadable },
//   rows: ledger rows, alive(pid), installed: the installed plugin version, serverOf(pid): the Remote
//   Control server a session runs under, { pid, self } | null | { unreadable } }
function assess(f) {
  const team = f.team;
  const out = { host: f.host, team: (team && SN.teamTag(team.prefix)) || null, instances: [], work: [], unreadable: [], paused: false, missing: [], inFlight: false, go: false };
  if (!team || !Array.isArray(team.roles)) { out.unreadable.push('team.json (no team manifest found)'); return out; }
  const roster = f.roster || {};
  const mine = M.expandInstances(team).filter((i) => !(i.role && i.role.retired) && i.role.host === f.host);
  // the work in flight, product-wide: any one of them means the team must be up
  if (f.inProgress && f.inProgress.unreadable) out.unreadable.push(`beads in progress (${f.inProgress.unreadable})`);
  else if ((f.inProgress || []).length) out.work.push(`${f.inProgress.length} bead${f.inProgress.length === 1 ? '' : 's'} in progress (${f.inProgress.slice(0, 3).map((b) => b.id).join(', ')}${f.inProgress.length > 3 ? ', ...' : ''})`);
  if (f.prs && f.prs.unreadable) out.unreadable.push(`open pull requests (${f.prs.unreadable})`);
  else for (const p of (f.prs || []).filter((x) => /^team\//.test(String(x.headRefName || '')))) out.work.push(`pull request #${p.number} open from ${p.headRefName}`);
  for (const m of f.messages || []) out.work.push(`${m.entries.length} message${m.entries.length === 1 ? '' : 's'} waiting for ${m.to}`);
  for (const h of f.handoffs || []) out.work.push(`a ${h.step} handoff of ${h.bead} waiting for ${h.to}`);
  if (f.paused && f.paused.unreadable) out.unreadable.push(`the owner's pause (${f.paused.unreadable})`);
  else out.paused = Boolean(f.paused);
  if (f.live === null) out.unreadable.push('the open sessions (`claude agents --json` failed), so which role sessions run is not known');
  const t = ms(f.now);
  const rows = f.rows || [];
  for (const { instance } of mine) {
    const e = roster[instance] || {};
    const roleDir = e.role_dir || f.defaultDir(instance);
    const same = (d) => Boolean(d) && path.resolve(d) === path.resolve(roleDir);
    const it = { instance, roleDir, name: SN.sessionName(instance, team.prefix), running: null, remoteId: null, skip: null, held: null };
    const open = (f.live || []).find((s) => same(s.cwd));
    // a restart onto the installed plugin is a start too: the same caps hold both
    // and so is a restart whose server stopped but whose new one did not start (the session went down)
    const starts = rows.filter((r) => (r.type === 'start' || r.type === 'restart' || (r.type === 'restart-failed' && r.stopped)) && r.instance === instance);
    const last = starts[starts.length - 1] || null;
    // alive(pid) is true, false, or null when the process list could not be read: unknown is neither
    // running (the instance is named, not hidden in "all running") nor a start (it may be a second link)
    const alive = open || !last ? false : f.alive(last.pid);
    if (open) {
      it.running = `session ${open.name || open.sessionId || 'open'} in ${roleDir}`;
      it.stale = staleOf(f, { e, open, roleDir, starts, last, t, team, name: it.name, same });
    }
    // the server this started last still runs: its session may not be listed yet, and a second server
    // in one directory would be a second link
    else if (alive === true) it.running = `its Remote Control server started ${WD.clock(ms(last.at))} (pid ${last.pid}) still runs`;
    else if (f.live === null) it.running = 'not known';
    // the link: the session open there now, else the one claude last recorded for the directory, else the roster's
    const bridge = (f.bridges || []).find((s) => same(s.cwd));
    const pointer = f.pointer(roleDir);
    it.remoteId = (bridge && bridge.bridgeSessionId) || (pointer && pointer.sessionId) || (ID_RE.test(String(e.remote_session_id || '')) ? e.remote_session_id : null);
    if (!it.running) {
      if (!f.exists(roleDir)) it.skip = `its role directory ${roleDir} is not on this host (prepare-role.js prepares it)`;
      // a reattach whose session never joined (the roster's last_seen did not move past it) is not tried
      // again: the id is gone or refused, and the owner gets a new link rather than none
      else if (it.remoteId && last && last.session_id === it.remoteId && ms(e.last_seen) < ms(last.at)) { it.staleId = it.remoteId; it.remoteId = null; }
      const m = modeOf(team);
      if (!it.skip && m.skip) it.skip = m.skip;
      it.mode = m.mode || null;
      const today = starts.filter((r) => t - ms(r.at) < DAY);
      if (!it.skip && last && t - ms(last.at) < START_EVERY_MS) it.held = `started ${WD.clock(ms(last.at))}; the next start is after ${WD.clock(ms(last.at) + START_EVERY_MS)} (one start an hour)`;
      else if (!it.skip && today.length >= DAILY_CAP) it.held = `started ${today.length} times in the last day, the most a day allows; the next start is after ${WD.clock(ms(today[today.length - DAILY_CAP].at) + DAY)}`;
      if (!it.skip && alive === null) it.held = `the process list could not be read, so whether its Remote Control server started ${WD.clock(ms(last.at))} (pid ${last.pid}) still runs is not known`;
      it.args = ['remote-control', '--name', it.name, ...(it.remoteId ? ['--session-id', it.remoteId] : ['--spawn', 'session']), ...(it.mode ? ['--permission-mode', it.mode] : [])];
    }
    out.instances.push(it);
  }
  if (!mine.length) out.none = `no role of this team runs on host "${f.host}" (team.json names ${[...new Set(team.roles.map((r) => r.host))].join(', ')}); set DELIVERY_HOST to the name team.json gives this host`;
  out.missing = out.instances.filter((i) => !i.running);
  out.stale = out.instances.filter((i) => i.stale);
  // a restart needs a full read of the sessions (it checked the session is idle) and no owner pause; it
  // does not wait for work in flight: a lane older than the installed plugin is a defect on its own
  out.restart = f.live !== null && !out.paused && !(f.paused && f.paused.unreadable);
  // Start only on a full read of the sessions: an unknown session list could hide a running session, and
  // a second session in one directory is a second link the owner did not ask for. An unreadable work
  // source only narrows what counts as work: what was read still starts the team.
  out.inFlight = out.work.length > 0;
  out.go = out.inFlight && !out.paused && f.live !== null && !(f.paused && f.paused.unreadable);
  return out;
}

const shown = (bin, args) => `${bin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

// The plain lines: one per missing instance with the action, an unreadable source said as such, never
// "all running" over a read that failed. started: { instance: { pid, log } } after a start; restarted:
// { instance: { pid, log } | { why } } after a restart pass.
function lines(a, { bin = 'claude', started = null, restarted = null, dryRun = false } = {}) {
  const out = [];
  for (const u of a.unreadable) out.push(`Unreadable: ${u}.`);
  if (a.none) out.push(`Nothing to check here: ${a.none}.`);
  if (a.paused) out.push('Paused by the owner: no role session is started.');
  if (a.inFlight) out.push(`Work in flight: ${a.work.join('; ')}.`);
  else out.push(a.unreadable.length ? 'No work in flight in what could be read: no role session is started.' : 'No work in flight (no bead in progress, no open pull request from a team branch, no message or handoff waiting): no role session is started.');
  for (const i of a.missing) {
    const why = `no session in ${i.roleDir}`;
    if (i.skip) { out.push(`Missing: ${i.instance} (${why}); not started: ${i.skip}.`); continue; }
    if (i.held) { out.push(`Missing: ${i.instance} (${why}); held: ${i.held}.`); continue; }
    const how = `${shown(bin, i.args)} in ${i.roleDir}${i.remoteId ? `, reattaching Remote Control session ${i.remoteId}` : ', a new Remote Control session'}${i.staleId ? ` (its reattach to ${i.staleId} never joined)` : ''}`;
    const s = started && started[i.instance];
    if (s) out.push(`Started: ${i.instance} (pid ${s.pid}): ${how}; log ${s.log}.`);
    else if (a.go) out.push(`Missing: ${i.instance} (${why}); ${dryRun ? 'would start' : 'start runs'}: ${how}.`);
    else out.push(`Missing: ${i.instance} (${why}); not started now (${a.paused ? 'paused' : !a.inFlight ? 'no work in flight' : 'the open sessions could not be read'}); start would run: ${how}.`);
  }
  for (const i of a.stale || []) {
    const st = i.stale;
    const what = `${i.instance} runs the delivery plugin ${st.version} and ${st.installed} is installed`;
    if (st.skip) { out.push(`Stale: ${what}; not restarted: ${st.skip}.`); continue; }
    if (st.held) { out.push(`Stale: ${what}; held: ${st.held}.`); continue; }
    const how = `stop its Remote Control server (pid ${st.server}), then ${shown(bin, st.args)} in ${i.roleDir}, reattaching Remote Control session ${st.remoteId}`;
    const r = restarted && restarted[i.instance];
    if (r && r.pid) out.push(`Restarted: ${i.instance} on ${st.installed} (pid ${r.pid}): ${how}; log ${r.log}.`);
    else if (r) out.push(`Stale: ${what}; not restarted: ${r.why}.`);
    else if (a.restart) out.push(`Stale: ${what}; ${dryRun ? 'would restart' : 'restart runs'}: ${how}.`);
    else out.push(`Stale: ${what}; not restarted now (${a.paused ? 'paused' : 'the open sessions could not be read'}); restart would ${how}.`);
  }
  const unknown = a.instances.filter((i) => i.running === 'not known');
  const known = a.instances.filter((i) => i.running && i.running !== 'not known');
  if (unknown.length) out.push(`Not known whether running: ${unknown.map((i) => i.instance).join(', ')}.`);
  if (a.instances.length && !a.missing.length && !unknown.length && !a.unreadable.length) out.push(`All ${a.instances.length} role sessions of ${a.team || 'this team'} on ${a.host} are running.`);
  else if (known.length) out.push(`Running: ${known.map((i) => i.instance).join(', ')}.`);
  return out;
}

module.exports = { LEDGER, ledgerFile, LOCK, lockFile, LOCK_STALE_MS, startLock, START_EVERY_MS, DAILY_CAP, RC_MODES, hostOf, configDirOf, projectKey, pointerOf, bridgeSessions, remoteSessionOf, ledger, record, modeOf, staleOf, assess, lines, shown };
