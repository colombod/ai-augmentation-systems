#!/usr/bin/env node
// scripts/team-revive.js — the product team's role sessions on this host are running whenever the product
// has work in flight, on the Remote Control links the owner follows (dec-chief-of-staff-000279);
// lib/team-revive.js holds the rules.
//   team-revive.js check [--json] [--project <root>]   read-only: for each role instance of this team on
//                                                      this host, whether a session runs in its role
//                                                      directory, the work in flight, and per missing
//                                                      instance the command start would run. A source that
//                                                      cannot be read is a line that says so.
//   team-revive.js start [--dry-run] [--project <root>] starts each missing instance, detached, in its role
//                                                      directory: `claude remote-control --name <instance>@<team>
//                                                      --spawn session --permission-mode <team mode>`, or with
//                                                      `--session-id <id>` in place of `--spawn session` when a
//                                                      Remote Control session was recorded for it. Only with
//                                                      work in flight and no owner pause; one start per
//                                                      instance an hour, six a day; each start is a row in
//                                                      the watchdog's revive.ndjson, its output in its logs.
// The host job runs start each pass (watchdog.js run). In a role session only the Chief of Staff may run
// start: no other role starts sessions (R-42). Exit codes: 0 ok (a missing session is not an error); 1
// refused; 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('./lib/team-revive.js');
const WD = require('./lib/watchdog.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: team-revive.js check [--json] | team-revive.js start [--dry-run]   (each takes --project <root>)';
const CHIEF = 'chief-of-staff';

function parse(argv) {
  const o = { _: [], json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--project') { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); o.project = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

// A Remote Control server alive at pid: a pid the system gave to another program since is not ours.
// true, false, or null when ps fails (throws, exits non-zero, times out): the process list could not be
// read, which is neither running nor gone (lib/team-revive.js assess names it and starts nothing).
const psCommand = (pid) => require('child_process').execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
function serverAlive(pid, { exec = psCommand, kill = (p) => process.kill(p, 0) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid); } catch (err) { if (err.code !== 'EPERM') return false; }
  let cmd;
  try { cmd = String(exec(pid)); } catch (err) { return null; }
  return !cmd.trim() || /remote-control/.test(cmd);
}

// The open pull requests of the product repository, or { unreadable } with why.
function openPrs(team, env) {
  const repo = require('./lib/gh-pr.js').productRepoOf(team);
  if (!repo) return { unreadable: 'the product repository is not known: team.json has no product_github' };
  const r = require('child_process').spawnSync('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,headRefName', '--limit', '200'], { encoding: 'utf8', env, timeout: 20000 });
  if (r.status !== 0) return { unreadable: `gh pr list --repo ${repo} failed: ${String(r.stderr || r.error || `exit ${r.status}`).trim().split('\n')[0].slice(0, 160)}` };
  let j = null;
  try { j = JSON.parse(r.stdout); } catch (err) { return { unreadable: 'gh pr list gave no JSON' }; }
  return Array.isArray(j) ? j : { unreadable: 'gh pr list gave no list' };
}

// The facts the rules read, each from its own source; deps replace any of them in a test.
function gather(root, team, { env = process.env, now, bd, live, prs, alive, hostname, home, configDir, pause } = {}) {
  const config = configDir || R.configDirOf(env, home);
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const store = bd || require('./lib/bd.js').makeBd({ cwd: root, env, timeoutMs: 15000 });
  let inProgress;
  try { inProgress = store.list({ status: 'in_progress' }) || []; } catch (err) { inProgress = { unreadable: String(err.message || err).split('\n')[0].slice(0, 160) }; }
  let paused;
  try { paused = Boolean((pause || ((r) => require('./lib/goal.js').activePause(r, { warn: false })))(root).paused); } catch (err) { paused = { unreadable: String(err.message || err).split('\n')[0].slice(0, 160) }; }
  let roster = {};
  try { roster = require('./lib/roster.js').readRoster(root).instances || {}; } catch (err) { roster = {}; }
  return {
    now: now || new Date().toISOString(),
    host: R.hostOf(env, hostname !== undefined ? hostname : os.hostname()),
    team,
    roster,
    live: live !== undefined ? live : require('./watchdog.js').liveSessions(bin, env),
    bridges: R.bridgeSessions(config),
    pointer: (dir) => R.pointerOf(config, dir),
    defaultDir: (instance) => path.join(root, '..', `${team && team.project}-team`, instance),
    exists: (dir) => fs.existsSync(dir),
    inProgress,
    prs: prs !== undefined ? (typeof prs === 'function' ? prs(team) : prs) : openPrs(team, env),
    messages: require('./lib/inbox.js').pending(root),
    handoffs: require('./lib/handoff.js').pending(root),
    paused,
    rows: R.ledger(root),
    alive: alive || serverAlive,
  };
}

// The environment of a started session: no identity of the session that ran this (a Chief of Staff's
// role, actor and Remote Control bridge variables would make the new session answer as it), and the
// role it serves; its role directory's settings set the rest at its start, as for every role session.
const CALLER_VARS = ['DELIVERY_ROLE_ID', 'DELIVERY_ROLE_DIR', 'DELIVERY_PROJECT_ROOT', 'DELIVERY_RUNNER', 'DELIVERY_MODE', 'DELIVERY_LARGE_MODEL', 'DELIVERY_WAKE', 'DELIVERY_WAKE_ID', 'DELIVERY_WAKE_KICK', 'BEADS_ACTOR'];
function startEnv(env, instance) {
  const out = require('./lib/fresh-session-env.js').freshSessionEnv(env, {});
  for (const k of CALLER_VARS) delete out[k];
  for (const k of Object.keys(out)) if (/^CLAUDE_CODE_(BRIDGE_|SESSION_ACCESS_TOKEN|ENVIRONMENT_KIND|WORKER_EPOCH|RESUME_INTERRUPTED_TURN)/.test(k)) delete out[k];
  return { ...out, DELIVERY_ROLE: instance };
}

// Detached, its output in a log: a Remote Control server lives as long as its session, never bounded by
// the wake's two-hour limit (lib/wake-run.js), and outlives the run or the session that started it.
function spawnRemote(bin, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = require('child_process').spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', (err) => { try { fs.appendFileSync(logPath, `team-revive: could not start ${bin}: ${err.message}\n`); } catch (e) { /* the log is best effort */ } });
  child.unref();
  fs.closeSync(fd);
  return child.pid || null;
}

// check, or start: { a, lines, started }. The remote session ids claude recorded are copied into the
// roster on a start pass, so the next start reattaches the owner's link even when claude's own files go.
// A start pass holds the project's start lock (lib/team-revive.js startLock) from its read of the facts to
// its last ledger row, so a second pass (the Chief of Staff's beside the host job's) sees the first's
// starts or starts nothing. check and --dry-run read only and take no lock.
function revive(root, team, opts = {}) {
  if (!opts.start || opts.dryRun) return revivePass(root, team, opts);
  const lock = R.startLock(root);
  if (lock.held) {
    const { start, dryRun, env = process.env, spawn, ...deps } = opts;
    const a = { ...R.assess(gather(root, team, { env, ...deps })), go: false, locked: lock.held };
    return { a, started: {}, lines: [`Not started now: another start pass holds the start lock (pid ${lock.held.pid || 'unknown'}, ${path.relative(root, R.lockFile(root))}); it starts what is missing.`] };
  }
  try { return revivePass(root, team, opts); } finally { lock.release(); }
}

function revivePass(root, team, { start = false, dryRun = false, env = process.env, spawn = spawnRemote, ...deps } = {}) {
  const f = gather(root, team, { env, ...deps });
  const a = R.assess(f);
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const started = {};
  if (start && !dryRun) {
    const RO = require('./lib/roster.js');
    for (const i of a.instances) if (i.remoteId && f.roster[i.instance] && f.roster[i.instance].remote_session_id !== i.remoteId) { try { RO.setRemoteSession(root, { instance: i.instance, remote_session_id: i.remoteId }); } catch (err) { /* the next pass records it */ } }
  }
  if (start && !dryRun && a.go) {
    for (const i of a.missing.filter((x) => !x.skip && !x.held)) {
      const at = f.now;
      const logPath = path.join(root, WD.REL, 'logs', `revive-${i.instance}-${at.replace(/[:.]/g, '-')}.log`);
      const pid = spawn(bin, i.args, { cwd: i.roleDir, env: startEnv(env, i.instance), logPath });
      R.record(root, { type: 'start', at, instance: i.instance, pid, args: i.args, session_id: i.remoteId, mode: i.mode, log: path.relative(root, logPath) });
      started[i.instance] = { pid, log: path.relative(root, logPath) };
    }
  }
  return { a, started, lines: R.lines(a, { bin, started, dryRun: start && dryRun }) };
}

// A role session other than the Chief of Staff's never starts sessions; outside any role session (the
// host job, the owner's shell) start runs. The role is read from the marker in or above the directory,
// else from the session's environment, as the watchdog reads it.
function refusal(cwd, env, who) {
  const role = require('./watchdog.js').roleContext(cwd, env);
  if (!role) return null;
  const id = who.roleId || env.DELIVERY_ROLE_ID || require('./lib/manifest.js').canonicalRoleId(env.DELIVERY_ROLE) || null;
  if (id === CHIEF) return null;
  return `team-revive.js: start is the Chief of Staff's and the host job's (${role}${id ? `, role ${id}` : ''}); run team-revive.js check and tell the Chief of Staff what is missing.`;
}

function main(argv, { cwd = process.cwd(), env = process.env, ...deps } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `team-revive.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['check', 'start'].includes(cmd) || o._.length > 1) return { code: 2, out: USAGE };
  const { who: given, ...rest } = deps;
  const who = given || whoAmI({ cwd, env, project: o.project });
  if (cmd === 'start') { const no = refusal(cwd, env, who); if (no) return { code: 1, out: no }; }
  if (!who.root) return { code: 2, out: 'team-revive.js: no project found; pass --project <root>' };
  const r = revive(who.root, who.team, { start: cmd === 'start', dryRun: o.dryRun, env, ...rest });
  if (o.json) return { code: 0, out: JSON.stringify({ ...r.a, started: r.started }, null, 2) };
  return { code: 0, out: r.lines.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `team-revive.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, revive, gather, startEnv, refusal, serverAlive };
