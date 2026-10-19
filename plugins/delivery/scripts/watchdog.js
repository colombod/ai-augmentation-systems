#!/usr/bin/env node
// scripts/watchdog.js — the stall alarm and the wake (R-04, R-43, R-25); lib/watchdog.js holds the rules.
//   watchdog.js check [--json] [--project <root>]   the stalls in plain lines (an idle team, a bead in
//                                                   progress with nothing moving, a P0 unclaimed over an
//                                                   hour, a session stopped on a usage limit and when it
//                                                   resumes) and tight gh polling; each is a warning in
//                                                   the ledger. Never pauses or blocks anything.
//   watchdog.js wake [--dry-run] [--project <root>] wakes the session each due stall names, at most once
//                                                   an hour per stall; a usage-limit wake waits for the
//                                                   reset. `claude --resume <id> -p` in the role directory,
//                                                   or a fork when the session is open; logged in
//                                                   .delivery/watchdog/wakes.ndjson
//   watchdog.js run [--project <root>]              check, then wake: what the host job runs
//   watchdog.js install [--every 15m] [--apply] [--project <root>]
//                                                   the host job (launchd on macOS, a systemd user timer
//                                                   or cron on Linux) that runs `run`; prints what it would
//                                                   write unless --apply. Never installed automatically.
// Exit codes: 0 ok (a stall is not an error); 1 refused; 2 usage.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WD = require('./lib/watchdog.js');
const { whoAmI } = require('./lib/gate-context.js');

const USAGE = 'usage: watchdog.js check [--json] | watchdog.js wake [--dry-run] | watchdog.js run | watchdog.js install [--every 15m] [--apply]   (each takes --project <root>)';
const SELF = path.resolve(__filename);

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

function spawnWake(bin, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = require('child_process').spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', (err) => { try { fs.appendFileSync(logPath, `watchdog: could not start ${bin}: ${err.message}\n`); } catch (e) { /* the log is best effort */ } });
  child.unref();
  fs.closeSync(fd);
  return child.pid || null;
}

function wake(root, res, { now, dryRun, env = process.env, live, spawn = spawnWake }) {
  const at = now || new Date().toISOString();
  if (res.unreadable || res.paused) return [];
  const p = WD.plan(res, { root, now: at });
  const lines = [];
  const bin = env.DELIVERY_CLAUDE_BIN || 'claude';
  const open = p.wakes.length ? (live !== undefined ? live : liveSessions(bin, env)) : null;
  for (const w of p.wakes) {
    const s = res.sessions.find((x) => x.instance === w.target) || null;
    const c = WD.wakeCommand(s, w.prompt, open);
    if (c.skip) {
      lines.push(`Not woken: ${w.target}: ${c.skip}. ${w.lines[0]}`);
      if (!dryRun) WD.log(root, { type: 'skip', at, keys: w.keys, instance: w.target, reason: c.skip });
      continue;
    }
    const shown = `${bin} ${c.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
    if (dryRun) { lines.push(`Would wake ${w.target} (${c.mode}) in ${s.roleDir}: ${shown}`); continue; }
    const logPath = path.join(root, WD.REL, 'logs', `${w.target}-${at.replace(/[:.]/g, '-')}.log`);
    const pid = spawn(bin, c.args, { cwd: s.roleDir, env: { ...env, DELIVERY_ROLE: w.target }, logPath });
    WD.log(root, { type: 'wake', at, keys: w.keys, instance: w.target, session: s.session, mode: c.mode, prompt: w.prompt, pid, log: path.relative(root, logPath) });
    lines.push(`Woke ${w.target} (${c.mode}${s.session ? ` of ${s.session}` : ''}): ${w.lines.join(' ')}`);
  }
  const logged = new Set(WD.logRows(root).filter((r) => r.type === 'scheduled').map((r) => r.key));
  for (const s of p.waiting) {
    lines.push(`Scheduled: ${s.target} at ${WD.clock(Date.parse(s.wakeAt))}. ${s.line}`);
    if (!dryRun && !logged.has(s.key)) WD.log(root, { type: 'scheduled', at, key: s.key, instance: s.target, due: s.wakeAt });
  }
  return lines.length ? lines : ['Nothing to wake.'];
}

// ---- the host job ----
function everySeconds(s) {
  const m = /^(\d+)(m|h)$/.exec(String(s || '15m'));
  if (!m) return { error: '--every takes minutes or hours, as 15m or 1h' };
  const sec = Number(m[1]) * (m[2] === 'h' ? 3600 : 60);
  if (sec < 300 || sec > 3600) return { error: '--every must be between 5m and 1h (15m is the default)' };
  return { sec };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function jobFiles(root, { platform, home, sec, env, node = process.execPath, has }) {
  const tag = crypto.createHash('sha256').update(root).digest('hex').slice(0, 8);
  const logPath = path.join(root, WD.REL, 'job.log');
  const argv = [node, SELF, 'run', '--project', root];
  const PATH = env.PATH || '/usr/bin:/bin';
  if (platform === 'darwin') {
    const label = `com.delivery-plugin.watchdog.${tag}`;
    const file = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
    const vars = { PATH, HOME: home, ...(env.DELIVERY_HOST ? { DELIVERY_HOST: env.DELIVERY_HOST } : {}) };
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
    return { kind: 'launchd', files: [{ file, body }], commands: [['launchctl', ['bootout', `gui/${uid}`, file], true], ['launchctl', ['bootstrap', `gui/${uid}`, file]]], remove: `launchctl bootout gui/${uid} ${file} && rm ${file}` };
  }
  const q = (a) => `'${String(a).replace(/'/g, "'\\''")}'`;
  if (has('systemctl')) {
    const name = `delivery-watchdog-${tag}`;
    const dir = path.join(home, '.config', 'systemd', 'user');
    return {
      kind: 'systemd',
      files: [
        { file: path.join(dir, `${name}.service`), body: `[Unit]\nDescription=delivery watchdog for ${root}\n\n[Service]\nType=oneshot\nWorkingDirectory=${root}\nEnvironment=PATH=${PATH}\nExecStart=${argv.map(q).join(' ')}\nStandardOutput=append:${logPath}\nStandardError=append:${logPath}\n` },
        { file: path.join(dir, `${name}.timer`), body: `[Unit]\nDescription=delivery watchdog every ${sec / 60} min for ${root}\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=${sec}s\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n` },
      ],
      commands: [['systemctl', ['--user', 'daemon-reload']], ['systemctl', ['--user', 'enable', '--now', `${name}.timer`]]],
      remove: `systemctl --user disable --now ${name}.timer && rm ${path.join(dir, name)}.service ${path.join(dir, name)}.timer`,
    };
  }
  const marker = `# delivery-watchdog ${tag}`;
  const line = `*/${sec / 60} * * * * cd ${q(root)} && PATH=${q(PATH)} ${argv.map(q).join(' ')} >> ${q(logPath)} 2>&1 ${marker}`;
  return { kind: 'cron', cron: { line, marker }, files: [], commands: [], remove: `crontab -l | grep -v '${marker}' | crontab -` };
}

function install(root, o, { platform = process.platform, home = os.homedir(), env = process.env, exec, has } = {}) {
  const e = everySeconds(o.every);
  if (e.error) return { code: 2, out: `watchdog.js: ${e.error}\n${USAGE}` };
  const run = exec || ((cmd, args, input) => require('child_process').execFileSync(cmd, args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }));
  const which = has || ((cmd) => { try { require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (err) { return false; } });
  const j = jobFiles(root, { platform, home, sec: e.sec, env, has: which });
  const lines = [];
  const head = `The ${j.kind} job runs \`watchdog.js run --project ${root}\` every ${e.sec / 60} min on this host: it checks for stalls and wakes the role session each one names. Its log: ${path.join(root, WD.REL, 'job.log')}.`;
  if (!o.apply) {
    lines.push(`Dry run. ${head}`);
    for (const f of j.files) lines.push(`Would write ${f.file}:`, f.body.trimEnd());
    if (j.cron) lines.push('Would add this line to your crontab:', j.cron.line);
    for (const [cmd, args] of j.commands) lines.push(`Would run: ${cmd} ${args.join(' ')}`);
    lines.push('Nothing was written. To install it: watchdog.js install --apply' + (o.every ? ` --every ${o.every}` : ''));
    return { code: 0, out: lines.join('\n') };
  }
  try {
    fs.mkdirSync(path.join(root, WD.REL), { recursive: true });
    for (const f of j.files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.body); lines.push(`Wrote ${f.file}`); }
    if (j.cron) {
      let cur = '';
      try { cur = run('crontab', ['-l']); } catch (err) { cur = ''; }
      const kept = cur.split('\n').filter((l) => l.trim() && !l.includes(j.cron.marker));
      run('crontab', ['-'], `${[...kept, j.cron.line].join('\n')}\n`);
      lines.push('Added the watchdog line to your crontab.');
    }
    for (const [cmd, args, mayFail] of j.commands) {
      try { run(cmd, args); lines.push(`Ran: ${cmd} ${args.join(' ')}`); } catch (err) { if (!mayFail) throw err; }
    }
  } catch (err) { return { code: 1, out: `${lines.join('\n')}\nwatchdog.js: the job was not installed (${String(err.message).split('\n')[0]})`.trim() }; }
  lines.push(`Installed. ${head}`, `To remove it: ${j.remove}`);
  return { code: 0, out: lines.join('\n') };
}

function main(argv, { cwd = process.cwd(), env = process.env, now, bd, rows, live, spawn, platform, home, exec, has } = {}) {
  let o;
  try { o = parse(argv); } catch (err) { return { code: 2, out: `watchdog.js: ${err.message}\n${USAGE}` }; }
  const [cmd] = o._;
  if (!['check', 'wake', 'run', 'install'].includes(cmd)) return { code: 2, out: USAGE };
  const who = whoAmI({ cwd, env, project: o.project });
  if (!who.root) return { code: 2, out: 'watchdog.js: no project found; pass --project <root>' };
  if (who.roleId && cmd !== 'check') return { code: 1, out: `watchdog.js: ${cmd} is the host job's (the owner installs it once); a role session reads the stalls with \`watchdog.js check\` and acts on its own items.` };
  if (cmd === 'install') return install(who.root, o, { platform, home, env, exec, has });
  const res = check(who.root, { bd, now, team: who.team, rows, record: !(cmd === 'wake' && o.dryRun) });
  if (cmd === 'check') {
    if (o.json) return { code: 0, out: JSON.stringify({ paused: res.paused || null, stalls: res.stalls, polls: res.polls, unreadable: res.unreadable || null }, null, 2) };
    return { code: 0, out: checkLines(res).join('\n') };
  }
  const woke = wake(who.root, res, { now, dryRun: o.dryRun, env, live, spawn });
  const out = cmd === 'run' ? [`${now || new Date().toISOString()} watchdog`, ...checkLines(res), ...woke] : (woke.length ? woke : checkLines(res));
  return { code: 0, out: out.join('\n') };
}

if (require.main === module) {
  let r;
  try { r = main(process.argv.slice(2)); } catch (err) { r = { code: 2, out: `watchdog.js: ${err.message}\n${USAGE}` }; }
  (r.code ? process.stderr : process.stdout).write(`${r.out}\n`);
  process.exitCode = r.code;
}

module.exports = { main, checkLines, jobFiles, everySeconds };
