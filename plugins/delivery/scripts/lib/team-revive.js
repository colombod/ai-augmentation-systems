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

const LEDGER = 'revive.ndjson';
const ledgerFile = (root) => path.join(root, WD.REL, LEDGER);
// one start per instance an hour and six a day, the wake's own caps: a session that dies at once
// (no login, a bad flag) is retried hourly, never in a loop
const START_EVERY_MS = WD.WAKE_EVERY_MS;
const DAILY_CAP = WD.DAILY_CAP;
const DAY = 24 * 3600e3;
// the modes `claude remote-control --permission-mode` takes; "manual" is a Claude Code mode it does not
const RC_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'];
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
function record(root, row) {
  WD.ensureDir(root);
  WD.rotate(ledgerFile(root));
  fs.appendFileSync(ledgerFile(root), `${JSON.stringify(row)}\n`);
  return row;
}

// The mode a started session runs in: team.json permission_mode, as for a wake; auto, start.js's default,
// when the team has none. A mode Remote Control does not take is no start, with the reason: a session
// must never run with more than the owner chose, and claude exits on a mode it refuses.
function modeOf(team) {
  const m = team && team.permission_mode;
  if (m === undefined) return { mode: 'auto' };
  return RC_MODES.includes(m) ? { mode: m } : { skip: `team.json permission_mode "${String(m).slice(0, 40)}" is not one Remote Control takes (${RC_MODES.join(', ')})` };
}

// What there is to bring back, and what holds it.
// facts: { now, host, team, roster (instances), live: [{cwd,sessionId,name}] | null, bridges, pointer(dir),
//   defaultDir(instance), exists(dir), inProgress: [bead] | { unreadable }, prs: [{number, headRefName}] |
//   { unreadable }, messages: inbox.pending(), handoffs: handoff.pending(), paused: bool | { unreadable },
//   rows: ledger rows, alive(pid) }
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
    const starts = rows.filter((r) => r.type === 'start' && r.instance === instance);
    const last = starts[starts.length - 1] || null;
    if (open) it.running = `session ${open.name || open.sessionId || 'open'} in ${roleDir}`;
    // the server this started last still runs: its session may not be listed yet, and a second server
    // in one directory would be a second link
    else if (last && f.alive(last.pid)) it.running = `its Remote Control server started ${WD.clock(ms(last.at))} (pid ${last.pid}) still runs`;
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
      it.args = ['remote-control', '--name', it.name, ...(it.remoteId ? ['--session-id', it.remoteId] : ['--spawn', 'session']), ...(it.mode ? ['--permission-mode', it.mode] : [])];
    }
    out.instances.push(it);
  }
  if (!mine.length) out.none = `no role of this team runs on host "${f.host}" (team.json names ${[...new Set(team.roles.map((r) => r.host))].join(', ')}); set DELIVERY_HOST to the name team.json gives this host`;
  out.missing = out.instances.filter((i) => !i.running);
  // Start only on a full read of the sessions: an unknown session list could hide a running session, and
  // a second session in one directory is a second link the owner did not ask for. An unreadable work
  // source only narrows what counts as work: what was read still starts the team.
  out.inFlight = out.work.length > 0;
  out.go = out.inFlight && !out.paused && f.live !== null && !(f.paused && f.paused.unreadable);
  return out;
}

const shown = (bin, args) => `${bin} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

// The plain lines: one per missing instance with the action, an unreadable source said as such, never
// "all running" over a read that failed. started: { instance: { pid, log } } after a start.
function lines(a, { bin = 'claude', started = null, dryRun = false } = {}) {
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
  const unknown = a.instances.filter((i) => i.running === 'not known');
  const known = a.instances.filter((i) => i.running && i.running !== 'not known');
  if (unknown.length) out.push(`Not known whether running: ${unknown.map((i) => i.instance).join(', ')}.`);
  if (a.instances.length && !a.missing.length && !unknown.length && !a.unreadable.length) out.push(`All ${a.instances.length} role sessions of ${a.team || 'this team'} on ${a.host} are running.`);
  else if (known.length) out.push(`Running: ${known.map((i) => i.instance).join(', ')}.`);
  return out;
}

module.exports = { LEDGER, ledgerFile, START_EVERY_MS, DAILY_CAP, RC_MODES, hostOf, configDirOf, projectKey, pointerOf, bridgeSessions, remoteSessionOf, ledger, record, modeOf, assess, lines, shown };
