#!/usr/bin/env node
// scripts/watchdog.js — the stall alarm and the wake (R-04, R-43, R-25); lib/watchdog.js holds the rules.
//   watchdog.js check [--json] [--project <root>]   the stalls in plain lines (an idle team, a bead in
//                                                   progress with nothing moving, a ready P0 unclaimed over
//                                                   an hour, a session stopped on a usage limit and when it
//                                                   resumes) and tight gh polling; each is a warning in
//                                                   the ledger. Never pauses or blocks anything.
//   watchdog.js wake [--dry-run] [--project <root>] wakes the session each due stall names, within the
//                                                   caps (one wake per session an hour, six a day, a doubling
//                                                   wait per stall); a usage-limit wake waits for the reset.
//                                                   `claude --resume <id> -p` in the role directory, or a fork
//                                                   when the session is open; logged in .delivery/watchdog/
//   watchdog.js run [--project <root>]              check, then wake, under one lock: what the host job runs
//   watchdog.js install [--every 15m] [--apply] [--project <root>]
//                                                   the host job (launchd on macOS, a systemd user timer
//                                                   or cron on Linux) that runs `run`; prints what it would
//                                                   write unless --apply. Never installed automatically.
//   watchdog.js uninstall [--project <root>]        removes that job; nothing to remove is not an error
// wake, run, install and uninstall are refused inside a role directory or a role session's environment.
// Exit codes: 0 ok (a stall is not an error); 1 refused; 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WD = require('./lib/watchdog.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: watchdog.js check [--json] | watchdog.js wake [--dry-run] | watchdog.js run | watchdog.js install [--every 15m] [--apply] | watchdog.js uninstall   (each takes --project <root>)';
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const RUN_LOCK_STALE_MS = 20 * 60e3;
const KEEP_WAKE_LOGS = 50;

function parse(argv) {
  const o = { _: [], json: false, apply: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (['--project', '--every'].includes(a)) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`); o[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

// A role session never wakes another session or installs a job (R-42): a role marker in or above the
// working directory, or a role session's environment, refuses it whatever DELIVERY_ROLE says.
function roleContext(cwd, env) {
  for (const k of ['DELIVERY_ROLE', 'DELIVERY_ROLE_ID', 'DELIVERY_ROLE_DIR']) if (env[k]) return `${k} is set`;
  let d = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(d, '.delivery-role.json'))) return `${d} is a role directory`;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function check(root, { bd, now, team, rows, record = true }) {
  const store = bd || require('./lib/bd.js').makeBd({ cwd: root, timeoutMs: 10000 });
  const res = WD.read(root, { bd: store, now, team, rows });
  if (record && !res.unreadable) WD.recordAll(root, res, res.polls, { now });
  return res;
}

function checkLines(res) {
  if (res.unreadable) return [`Watchdog: the record could not be read (${res.unreadable}); no stall is reported. Check: bd where`];
  if (res.paused) return [`Paused by the owner (${res.paused === true ? 'a verified pause' : res.paused}): no stall is raised and nobody is woken.`];
  const lines = res.stalls.map((s) => s.line);
  lines.push(...res.polls.map((p) => p.line));
  return lines.length ? lines : ['No stall: work is moving.'];
}

// the sessions open on this host (`claude agents --json`), or null when that cannot be read
function liveSessions(bin, env) {
  try {
    const out = require('child_process').execFileSync(bin, ['agents', '--json'], { env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(out);
    return Array.isArray(j) ? j : null;
  } catch (err) { return null; }
}

// The wake runs under lib/wake-run.js, which stops it after WAKE_TIMEOUT_H (DELIVERY_WAKE_TIMEOUT_MIN may
// only shorten it); the pid logged is the supervisor's, alive exactly as long as the wake.
function wakeLimitMs(env) {
  const asked = Number(env.DELIVERY_WAKE_TIMEOUT_MIN) * 60e3;
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, WD.WAKE_TIMEOUT_H * 3600e3) : WD.WAKE_TIMEOUT_H * 3600e3;
}
function spawnWake(bin, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'lib', 'wake-run.js'), String(wakeLimitMs(env)), bin, ...args], { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', (err) => { try { fs.appendFileSync(logPath, `watchdog: could not start ${bin}: ${err.message}\n`); } catch (e) { /* the log is best effort */ } });
  child.unref();
  fs.closeSync(fd);
  return child.pid || null;
}

// the newest KEEP_WAKE_LOGS wake logs stay; the rest go
function pruneWakeLogs(root) {
  const dir = path.join(root, WD.REL, 'logs');
  try {
    const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(KEEP_WAKE_LOGS)) fs.unlinkSync(path.join(dir, x.f));
  } catch (err) { /* no logs yet */ }
}

// The mode a wake runs in: team.json permission_mode (start.js records it); for a team recorded before
// that field existed, the mode the session itself started in (the first permissionMode its transcript
// records), so a wake never runs with more than the owner chose; auto, start.js's default, when neither
// says. An unreadable team.json or a value claude would refuse is no wake at all, with the reason:
// claude exits on an invalid mode, and the wake would be logged and its messages marked delivered.
const MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'];
function teamOf(root) {
  try { return { team: require('./lib/manifest.js').loadManifest(root).team }; } catch (err) { return { unreadable: String(err.message || err).split('\n')[0].slice(0, 120) }; }
}
function startedMode(file) {
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = /"permissionMode":"([A-Za-z]+)"/.exec(buf.slice(0, n).toString('utf8'));
    return m && MODES.includes(m[1]) ? m[1] : null;
  } catch (err) { return null; }
}
// team.json wake_fresh_above_tokens: the context above which a wake starts a fresh session (0: never)
function freshAboveOf(t) {
  const v = t && t.team ? t.team.wake_fresh_above_tokens : undefined;
  return Number.isInteger(v) && v >= 0 ? v : WD.FRESH_ABOVE;
}
// an owner's limit the watchdog cannot use is said, not silently replaced ("0" as text is not 0)
function freshAboveProblem(t) {
  const v = t && t.team ? t.team.wake_fresh_above_tokens : undefined;
  return v === undefined || (Number.isInteger(v) && v >= 0) ? null : `team.json wake_fresh_above_tokens ${JSON.stringify(v).slice(0, 40)} is not a whole number of tokens; using ${WD.FRESH_ABOVE}`;
}

function wakeMode(t, s) {
  if (t.unreadable) return { skip: `team.json cannot be read (${t.unreadable}), so the team's permission mode is not known; alarm only` };
  const m = t.team.permission_mode;
  if (m !== undefined) return MODES.includes(m) ? { mode: m } : { skip: `team.json permission_mode "${String(m).slice(0, 40)}" is not a Claude Code mode (${MODES.join(', ')}); alarm only` };
  return { mode: startedMode(s && s.transcript) || 'auto' };
}

// A headless claude -p stops the background tasks its turn started 10 minutes after the turn ends
// ("Background tasks still running 10m after the last turn ... stopping them"): the Delivery Manager's
// reviewer subagent was killed mid-review and no verdict was recorded. A wake waits for them; the
// wake's own limit (wake-run.js) still bounds the whole run.
const HEADLESS_WAIT = { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' };

function wake(root, res, { now, dryRun, env = process.env, live, spawn = spawnWake }) {
  const at = now || new Date().toISOString();
  if (res.unreadable || res.paused) return [];
  const p = WD.plan(res, { root, now: at });
  const lines = [];
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const open = p.wakes.length ? (live !== undefined ? live : liveSessions(bin, env)) : null;
  const rows = WD.logRows(root);
  const manifest = p.wakes.length ? teamOf(root) : null;
  const limitProblem = freshAboveProblem(manifest);
  if (limitProblem) lines.push(`Warning: ${limitProblem}.`);
  for (const w of p.wakes) {
    const s = res.sessions.find((x) => x.instance === w.target) || null;
    const wm = wakeMode(manifest, s);
    const c = wm.skip ? { skip: wm.skip } : WD.wakeCommand(s, w.prompt, open, wm.mode, { freshAbove: freshAboveOf(manifest) });
    if (c.skip) {
      lines.push(`Not woken: ${w.target}: ${c.skip}. ${w.lines[0]}`);
      // one skip row an hour per session keeps the log short while a session is busy
      const lastSkip = rows.filter((r) => r.type === 'skip' && r.instance === w.target).pop();
      if (!dryRun && (!lastSkip || Date.parse(at) - Date.parse(lastSkip.at) >= WD.WAKE_EVERY_MS)) WD.log(root, { type: 'skip', at, keys: w.keys, instance: w.target, reason: c.skip });
      continue;
    }
    const shown = `${bin} ${c.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
    if (dryRun) { lines.push(`Would wake ${w.target} (${c.mode}) in ${s.roleDir}: ${shown}`); continue; }
    const logPath = path.join(root, WD.REL, 'logs', `${w.target}-${at.replace(/[:.]/g, '-')}.log`);
    // DELIVERY_WAKE tells the session's hooks this is the watchdog's: a fork is recorded beside the
    // owner's open session, never in its place
    // each wake has its own id: a fork records its session under it (lib/roster.js sessionLocator)
    const wakeId = crypto.randomBytes(6).toString('hex');
    const pid = spawn(bin, c.args, { cwd: s.roleDir, env: require('./lib/fresh-session-env.js').freshSessionEnv(env, { DELIVERY_ROLE: w.target, DELIVERY_WAKE: c.mode, DELIVERY_WAKE_ID: wakeId, ...HEADLESS_WAIT }), logPath });
    WD.log(root, { type: 'wake', at, keys: w.keys, instance: w.target, session: s.session, mode: c.mode, wake_id: wakeId, prompt: w.prompt, pid, log: path.relative(root, logPath) });
    // the messages it carries are handed over: the next run does not wake for them again
    for (const d of w.delivers || []) require('./lib/inbox.js').markDelivered(root, d.to, d.upTo);
    lines.push(`Woke ${w.target} (${c.mode}${s.session ? ` of ${s.session}` : ''}): ${w.lines.join(' ')}`);
  }
  for (const h of p.held) lines.push(`Alarm only: ${h.target}: ${h.reason}. ${h.lines[0]}`);
  const logged = new Set(rows.filter((r) => r.type === 'scheduled').map((r) => r.key));
  for (const s of p.waiting) {
    lines.push(`Scheduled: ${s.target} at ${WD.clock(Date.parse(s.wakeAt))}. ${s.line}`);
    if (!dryRun && s.kind === 'limit' && !logged.has(s.key)) WD.log(root, { type: 'scheduled', at, key: s.key, instance: s.target, due: s.wakeAt });
  }
  if (!dryRun) pruneWakeLogs(root);
  return lines.length ? lines : ['Nothing to wake.'];
}

// One run at a time: a second run while one holds the lock does nothing (a lock older than 20 min is stale).
function withRunLock(root, fn) {
  WD.ensureDir(root);
  const lock = path.join(root, WD.REL, 'run.lock');
  let fd = null;
  try { fd = fs.openSync(lock, 'wx'); } catch (err) {
    let age = 0;
    try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch (e) { age = Infinity; }
    if (age < RUN_LOCK_STALE_MS) return null;
    try { fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx'); } catch (e) { return null; }
  }
  try { fs.writeSync(fd, String(process.pid)); return fn(); } finally { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (e) { /* gone */ } }
}

// ---- the host job ----
// cron runs on clock minutes, so only an interval that divides the hour keeps its cadence there (Copilot 471)
function everySeconds(s, { cron = false } = {}) {
  const m = /^(\d+)(m|h)$/.exec(String(s || '15m'));
  if (!m) return { error: '--every takes minutes or hours, as 15m or 1h' };
  const sec = Number(m[1]) * (m[2] === 'h' ? 3600 : 60);
  if (sec < 300 || sec > 3600) return { error: '--every must be between 5m and 1h (15m is the default)' };
  if (cron && 3600 % sec) return { error: `cron runs on clock minutes, so --every must divide the hour (5m, 10m, 12m, 15m, 20m, 30m or 1h), not ${s}` };
  return { sec };
}

const tagOf = (root) => crypto.createHash('sha256').update(root).digest('hex').slice(0, 8);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// systemd: each word in double quotes with \\ and " escaped, and % doubled (its specifier sign), so a
// path with spaces stays one argument (Copilot 984)
const sdPct = (a) => String(a).replace(/%/g, '%%');
const sdq = (a) => `"${sdPct(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const sq = (a) => `'${String(a).replace(/'/g, "'\\''")}'`;
// the installing shell's PATH, then the usual places for node, bd and claude: nothing versioned is pinned
function jobPath(env, home) {
  const parts = [...String(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(home, '.local', 'bin')].filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}

// The job runs this shim, which finds the plugin at run time: a checkout stays where it is; a plugin
// installed by Claude Code is looked up in installed_plugins.json, so an update is picked up.
function shimBody(root, pluginRoot, configDir) {
  return `#!/usr/bin/env node
// written by watchdog.js install for ${root}; finds the delivery plugin each run, then runs watchdog.js run
const fs = require('fs');
const os = require('os');
const path = require('path');
const PROJECT = ${JSON.stringify(root)};
const AT_INSTALL = ${JSON.stringify(pluginRoot)};
// the Claude configuration the installing shell used: the plugin lookup and every wake use it too
const AT_CONFIG = ${JSON.stringify(configDir || null)};
if (AT_CONFIG && !process.env.CLAUDE_CONFIG_DIR) process.env.CLAUDE_CONFIG_DIR = AT_CONFIG;
const ok = (p) => p && fs.existsSync(path.join(p, 'scripts', 'watchdog.js'));
function pluginRoot() {
  const cache = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
  if (ok(AT_INSTALL) && !AT_INSTALL.startsWith(cache + path.sep)) return AT_INSTALL;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cache, 'installed_plugins.json'), 'utf8'));
    for (const [k, v] of Object.entries(j.plugins || j)) {
      if (!/^delivery@/.test(k)) continue;
      const found = (Array.isArray(v) ? v : [v]).map((e) => e && e.installPath).filter(ok);
      if (found.length) return found[found.length - 1];
    }
  } catch (err) { /* fall back below */ }
  return ok(AT_INSTALL) ? AT_INSTALL : null;
}
const root = pluginRoot();
if (!root) { console.error(new Date().toISOString() + ' watchdog job: the delivery plugin was not found; install it, then run watchdog.js install --apply again'); process.exit(1); }
const log = path.join(PROJECT, '.delivery', 'watchdog', 'job.log');
try { if (fs.statSync(log).size > ${WD.LOG_MAX_BYTES}) fs.renameSync(log, log + '.1'); } catch (err) { /* no log yet */ }
const r = require('child_process').spawnSync(process.execPath, [path.join(root, 'scripts', 'watchdog.js'), 'run', '--project', PROJECT], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`;
}

function jobFiles(root, { platform, home, sec, env, has }) {
  const tag = tagOf(root);
  const logPath = path.join(root, WD.REL, 'job.log');
  const shim = path.join(root, WD.REL, 'job.js');
  const argv = ['/usr/bin/env', 'node', shim];
  const PATH = jobPath(env, home);
  const config = env.CLAUDE_CONFIG_DIR || null;
  const base = { shim, shimBody: shimBody(root, PLUGIN_ROOT, config) };
  if (platform === 'darwin') {
    const label = `com.delivery-plugin.watchdog.${tag}`;
    const file = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
    const vars = { PATH, HOME: home, ...(env.DELIVERY_HOST ? { DELIVERY_HOST: env.DELIVERY_HOST } : {}), ...(env.TZ ? { TZ: env.TZ } : {}), ...(config ? { CLAUDE_CONFIG_DIR: config } : {}) };
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>${argv.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>StartInterval</key><integer>${sec}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>${Object.entries(vars).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    return { ...base, kind: 'launchd', file, files: [{ file, body }], commands: [['launchctl', ['bootout', `gui/${uid}`, file], true], ['launchctl', ['bootstrap', `gui/${uid}`, file]]],
      removeCommands: [['launchctl', ['bootout', `gui/${uid}`, file], true]] };
  }
  if (has('systemctl')) {
    const name = `delivery-watchdog-${tag}`;
    const dir = path.join(home, '.config', 'systemd', 'user');
    const service = path.join(dir, `${name}.service`);
    const timer = path.join(dir, `${name}.timer`);
    // KillMode=process: the wake started by the run outlives the oneshot service (Copilot 440)
    return {
      ...base,
      kind: 'systemd',
      file: timer,
      files: [
        { file: service, body: `[Unit]\nDescription=delivery watchdog for ${sdPct(root)}\n\n[Service]\nType=oneshot\nKillMode=process\nWorkingDirectory=${sdPct(root)}\nEnvironment=${sdq(`PATH=${PATH}`)}\n${config ? `Environment=${sdq(`CLAUDE_CONFIG_DIR=${config}`)}\n` : ''}ExecStart=${argv[0]} ${argv.slice(1).map(sdq).join(' ')}\nStandardOutput=append:${sdPct(logPath)}\nStandardError=append:${sdPct(logPath)}\n` },
        { file: timer, body: `[Unit]\nDescription=delivery watchdog every ${sec / 60} min for ${root}\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=${sec}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n` },
      ],
      commands: [['systemctl', ['--user', 'daemon-reload']], ['systemctl', ['--user', 'enable', '--now', `${name}.timer`]]],
      removeCommands: [['systemctl', ['--user', 'disable', '--now', `${name}.timer`], true], ['systemctl', ['--user', 'daemon-reload'], true]],
    };
  }
  const marker = `# delivery-watchdog ${tag}`;
  const when = sec === 3600 ? '0 * * * *' : `*/${sec / 60} * * * *`;
  const line = `${when} cd ${sq(root)} && PATH=${sq(PATH)}${config ? ` CLAUDE_CONFIG_DIR=${sq(config)}` : ''} ${argv.map(sq).join(' ')} >> ${sq(logPath)} 2>&1 ${marker}`;
  // cron reads an unescaped % as a newline: every one in the command is escaped (\%), which cron removes
  return { ...base, kind: 'cron', file: null, cron: { line: line.replace(/%/g, '\\%'), marker }, files: [], commands: [], removeCommands: [] };
}

// The current crontab: '' only when there is none (or no crontab command at all); any other failure is
// an error, so the table is never replaced by our line alone (Copilot 829).
function readCrontab(run) {
  try { return { text: run('crontab', ['-l']) || '' }; } catch (err) {
    const why = `${err && err.stderr ? err.stderr : ''} ${err && err.message ? err.message : ''}`;
    if (/no crontab for/i.test(why) || (err && err.code === 'ENOENT')) return { text: '' };
    return { error: String(err && err.stderr ? err.stderr : err && err.message).trim().split('\n')[0] || 'unknown error' };
  }
}
const runner = (exec) => exec || ((cmd, args, input) => require('child_process').execFileSync(cmd, args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }));
const whichOf = (has) => has || ((cmd) => { try { require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (err) { return false; } });

function install(root, o, { platform = process.platform, home = os.homedir(), env = process.env, exec, has } = {}) {
  const which = whichOf(has);
  const cron = platform !== 'darwin' && !which('systemctl');
  const e = everySeconds(o.every, { cron });
  if (e.error) return { code: 2, out: `watchdog.js: ${e.error}\n${USAGE}` };
  const run = runner(exec);
  const j = jobFiles(root, { platform, home, sec: e.sec, env, has: which });
  const lines = [];
  const head = `The ${j.kind} job runs \`watchdog.js run --project ${root}\` every ${e.sec / 60} min on this host, through ${j.shim}, which finds the plugin each run: it checks for stalls and wakes the role session each one names. Its log: ${path.join(root, WD.REL, 'job.log')}.`;
  const removal = `To remove it: node ${path.join(PLUGIN_ROOT, 'scripts', 'watchdog.js')} uninstall --project ${root}`;
  if (!o.apply) {
    lines.push(`Dry run. ${head}`, `Would write ${j.shim} (the shim).`);
    for (const f of j.files) lines.push(`Would write ${f.file}:`, f.body.trimEnd());
    if (j.cron) lines.push('Would add this line to your crontab:', j.cron.line);
    for (const [cmd, args] of j.commands) lines.push(`Would run: ${cmd} ${args.join(' ')}`);
    if (j.kind === 'systemd') lines.push('A user timer runs only while you are logged in, unless lingering is on: loginctl enable-linger $USER.');
    lines.push(`Nothing was written. To install it: watchdog.js install --apply${o.every ? ` --every ${o.every}` : ''}`, removal);
    return { code: 0, out: lines.join('\n') };
  }
  try {
    WD.ensureDir(root);
    fs.writeFileSync(j.shim, j.shimBody, { mode: 0o755 });
    for (const f of j.files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.body); lines.push(`Wrote ${f.file}`); }
    if (j.cron) {
      const r = readCrontab(run);
      if (r.error) throw new Error(`the crontab could not be read (${r.error}); nothing was changed`);
      const cur = r.text;
      const kept = cur.split('\n').filter((l) => l.trim() && !l.includes(j.cron.marker));
      run('crontab', ['-'], `${[...kept, j.cron.line].join('\n')}\n`);
      lines.push('Added the watchdog line to your crontab.');
    }
    for (const [cmd, args, mayFail] of j.commands) {
      try { run(cmd, args); lines.push(`Ran: ${cmd} ${args.join(' ')}`); } catch (err) { if (!mayFail) throw err; }
    }
    fs.writeFileSync(WD.installedFile(root), `${JSON.stringify({ kind: j.kind, file: j.file, every_s: e.sec, at: new Date().toISOString() })}\n`);
  } catch (err) { return { code: 1, out: `${lines.join('\n')}\nwatchdog.js: the job was not installed (${String(err.message).split('\n')[0]})\n${removal}`.trim() }; }
  lines.push(`Installed. ${head}`);
  if (j.kind === 'systemd') lines.push('A user timer runs only while you are logged in, unless lingering is on: loginctl enable-linger $USER.');
  lines.push(removal);
  return { code: 0, out: lines.join('\n') };
}

// Removes the job this project installed on this host, in every form it may have taken; running it
// again finds nothing and says so.
function uninstall(root, { platform = process.platform, home = os.homedir(), env = process.env, exec, has } = {}) {
  const run = runner(exec);
  const which = whichOf(has);
  const j = jobFiles(root, { platform, home, sec: 900, env, has: which });
  const lines = [];
  for (const f of j.files) {
    if (!fs.existsSync(f.file)) continue;
    if (f === j.files[0]) for (const [cmd, args] of j.removeCommands) { try { run(cmd, args); lines.push(`Ran: ${cmd} ${args.join(' ')}`); } catch (err) { /* already stopped */ } }
    fs.unlinkSync(f.file);
    lines.push(`Removed ${f.file}`);
  }
  if (platform !== 'darwin') {
    const r = readCrontab(run);
    if (r.error) return { code: 1, out: `${lines.length ? `${lines.join('\n')}\n` : ''}watchdog.js: the crontab could not be read (${r.error}); it was left as it is` };
    const cur = r.text;
    const marker = `# delivery-watchdog ${tagOf(root)}`;
    if (cur && cur.includes(marker)) {
      const kept = cur.split('\n').filter((l) => l.trim() && !l.includes(marker));
      run('crontab', ['-'], kept.length ? `${kept.join('\n')}\n` : '');
      lines.push('Removed the watchdog line from your crontab.');
    }
  }
  for (const f of [j.shim, WD.installedFile(root)]) if (fs.existsSync(f)) { fs.unlinkSync(f); lines.push(`Removed ${f}`); }
  return { code: 0, out: lines.length ? `${lines.join('\n')}\nThe watchdog job for ${root} is removed from this host.` : `Nothing to remove: no watchdog job for ${root} on this host.` };
}

function main(argv, { cwd = process.cwd(), env = process.env, now, bd, rows, live, spawn, platform, home, exec, has } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `watchdog.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['check', 'wake', 'run', 'install', 'uninstall'].includes(cmd)) return { code: 2, out: USAGE };
  if (cmd !== 'check') {
    const role = roleContext(cwd, env);
    if (role) return { code: 1, out: `watchdog.js: ${cmd} is the host job's, installed by the owner from a shell outside any role directory (${role}); a role session reads the stalls with \`watchdog.js check\` and acts on its own items.` };
  }
  const who = whoAmI({ cwd, env, project: o.project });
  if (!who.root) return { code: 2, out: 'watchdog.js: no project found; pass --project <root>' };
  if (cmd === 'install') return install(who.root, o, { platform, home, env, exec, has });
  if (cmd === 'uninstall') return uninstall(who.root, { platform, home, env, exec, has });
  const go = () => {
    const res = check(who.root, { bd, now, team: who.team, rows, record: !(cmd === 'wake' && o.dryRun) });
    if (cmd === 'check') {
      if (o.json) return { code: 0, out: JSON.stringify({ paused: res.paused || null, stalls: res.stalls, polls: res.polls, unreadable: res.unreadable || null }, null, 2) };
      return { code: 0, out: checkLines(res).join('\n') };
    }
    const woke = wake(who.root, res, { now, dryRun: o.dryRun, env, live, spawn });
    const out = cmd === 'run' ? [`${now || new Date().toISOString()} watchdog`, ...checkLines(res), ...woke] : (woke.length ? woke : checkLines(res));
    return { code: 0, out: out.join('\n') };
  };
  if (cmd === 'check' || o.dryRun) return go();
  const r = withRunLock(who.root, go);
  return r || { code: 0, out: 'Another watchdog run holds the lock; this one does nothing.' };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `watchdog.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, checkLines, jobFiles, everySeconds, roleContext };
