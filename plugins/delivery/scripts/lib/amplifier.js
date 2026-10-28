// scripts/lib/amplifier.js — Microsoft Amplifier on this machine, found first.
// The owner's ruling (2026-10-28): a session on a machine where Amplifier is installed leans on it
// first. Amplifier owns that machine's own setup there (the amplifier-work-tracker service, its Dolt
// server and the login it uses), so a Claude session hands a host problem to one `amplifier run` call
// instead of improvising administration: on Wintermute a session tried to edit the work-tracker's
// service and to read its credential file, and Claude Code refused both, as it should.
// Detection reads PATH only (no process is started), so the SessionStart hook can afford it; the
// version and the work-tracker's health are read by `amplifier.js detect`, on request.
const fs = require('fs');
const path = require('path');

const AMPLIFIER = 'amplifier';
const WORK_TRACKER = 'amplifier-work-tracker';

// the executable's full path on PATH, or null; no process started
function onPath(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const f = path.join(d, name + e);
      try {
        const st = fs.statSync(f);
        if (st.isFile() && (platform === 'win32' || (st.mode & 0o111))) return f;
      } catch (err) { /* not here */ }
    }
  }
  return null;
}

// { amplifier, workTracker }: full paths or null
function present(env, platform) {
  return { amplifier: onPath(AMPLIFIER, env, platform), workTracker: onPath(WORK_TRACKER, env, platform) };
}

// The line a session starts with on such a machine, or '' where Amplifier is absent. One line: it
// is in every session's context, so it names the skill and holds the rule, nothing else.
function sessionHint(env, platform) {
  const p = present(env, platform);
  if (!p.amplifier) return '';
  const wt = p.workTracker ? ' and amplifier-work-tracker' : '';
  return `Microsoft Amplifier${wt} is installed on this machine. A problem with this machine's own setup (its services, the work-tracker, its Dolt server and logins, installs) goes to Amplifier first: invoke the delivery:amplifier skill before changing anything yourself, and never read a credential file to get past one.\n`;
}

// The full picture, for `amplifier.js detect` and start.js --check. run(cmd, args) -> { ok, out, err }.
function detect({ env = process.env, platform = process.platform, run } = {}) {
  const p = present(env, platform);
  const out = { ...p, version: null, service: null, doctor: null };
  if (!run) return out;
  if (p.amplifier) {
    const v = run(p.amplifier, ['--version']);
    out.version = v.ok ? String(v.out).trim().split('\n')[0] : null;
  }
  if (p.workTracker) {
    if (platform === 'linux') {
      const s = run('systemctl', ['--user', 'is-active', 'amplifier-work-tracker.service']);
      out.service = String(s.out || '').trim() || (s.ok ? 'active' : 'unknown');
    }
    const d = run(p.workTracker, ['doctor', '--quick']);
    const text = `${d.out || ''}\n${d.err || ''}`.trim();
    out.doctor = { ok: d.ok, line: text.split('\n').filter(Boolean).slice(-1)[0] || '' };
  }
  return out;
}

// bd puts the cause last ("... on server 127.0.0.1:3308: Error 1045 (28000): Access denied for user
// 'root'"): a long line keeps its end, where the cause is (found running it on Wintermute)
const tail = (s, n) => (s.length > n ? `...${s.slice(-n)}` : s);

// start.js --check rows: none where Amplifier is absent (it is not a prerequisite)
function checkRows(d) {
  if (!d.amplifier) return [];
  const rows = [{ name: 'amplifier', status: 'pass', detail: `${d.version || 'installed'} (${d.amplifier}): host problems go to it first (/delivery:amplifier)`, hard: false }];
  if (d.workTracker) {
    const svc = d.service ? `service ${d.service}; ` : '';
    rows.push(d.doctor && d.doctor.ok
      ? { name: 'amplifier-work-tracker', status: 'pass', detail: `${svc}doctor passes`, hard: false }
      : { name: 'amplifier-work-tracker', status: 'warn', detail: `${svc}doctor fails: ${d.doctor ? tail(d.doctor.line, 200) : 'not run'}`,
        fix: 'ask Amplifier to fix its own setup (/delivery:amplifier); do not repair the service or its login by hand', hard: false });
  }
  return rows;
}

module.exports = { onPath, present, sessionHint, detect, checkRows, AMPLIFIER, WORK_TRACKER };
