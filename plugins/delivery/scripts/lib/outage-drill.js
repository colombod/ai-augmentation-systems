// scripts/lib/outage-drill.js — the rules of the owner-consented outage drill (outage-drill.js): the
// commands it runs, the timers that bring the network back and restart the host, and the ledger that
// holds one drill per consent record. The CLI holds the order; this file holds no side effect beyond
// the ledger.
const fs = require('fs');
const path = require('path');
const WD = require('./watchdog.js');

const MAX_CUT_MINUTES = 30;
const RESTART_AFTER = 1;
// The cut drops the session that runs it, so the restore and the restart run in transient system units
// (systemd-run without --user): they belong to PID 1, not to the session, its process group or the
// user manager, and outlive all three. Their services run as root, so the restore needs no polkit rule.
const COMMANDS = {
  cut: ['nmcli', 'networking', 'off'],
  restore: ['nmcli', 'networking', 'on'],
  reboot: ['systemctl', 'reboot'],
};
// The system manager and NetworkManager's off switch need root: sudo -n fails at once instead of waiting
// on a password nobody can type in a role session. DELIVERY_DRILL_PRIVILEGE replaces it (`pkexec`, or
// empty when the session already runs as root).
function privilegeOf(env = {}) {
  if (env.DELIVERY_DRILL_PRIVILEGE === undefined) return ['sudo', '-n'];
  return String(env.DELIVERY_DRILL_PRIVILEGE).split(/\s+/).filter(Boolean);
}

const unitName = (kind, record) => `delivery-drill-${kind}-${String(record).replace(/[^A-Za-z0-9_.-]/g, '-')}`;

// One transient timer: <seconds> after it is made, its service runs cmd once.
function timerArgs(kind, record, seconds, cmd, env) {
  return [...privilegeOf(env), 'systemd-run', `--on-active=${seconds}s`, '--timer-property=AccuracySec=1s',
    `--unit=${unitName(kind, record)}`, `--description=delivery outage drill ${kind} (${record})`, ...cmd];
}
const stopArgs = (kind, record, env) => [...privilegeOf(env), 'systemctl', 'stop', `${unitName(kind, record)}.timer`];
const cutArgs = (env) => [...privilegeOf(env), ...COMMANDS.cut];
// the restore run at once, as the restore timer's service would run it, when a cut fails part way
const restoreArgs = (env) => [...privilegeOf(env), ...COMMANDS.restore];

// n in 1..30 minutes of cut; the restart follows the restore after a fixed minute. The consent is one
// cut of up to 30 minutes and one restart: a longer offline gap is not covered.
function checkMinutes(cut) {
  if (!/^\d+$/.test(String(cut)) || Number(cut) < 1 || Number(cut) > MAX_CUT_MINUTES) return `--cut-minutes must be a whole number from 1 to ${MAX_CUT_MINUTES} (got ${cut === undefined ? 'nothing' : cut})`;
  return null;
}

function times(now, cut, after = RESTART_AFTER) {
  const t0 = Date.parse(now);
  const restore = t0 + cut * 60e3;
  return { started_at: new Date(t0).toISOString(), restore_at: new Date(restore).toISOString(), restart_at: new Date(restore + after * 60e3).toISOString() };
}

// The ledger beside the watchdog's files, never rotated: a row is the consent spent.
const ledgerFile = (root) => path.join(root, WD.REL, 'drills.ndjson');
function drills(root) {
  let text = '';
  try { text = fs.readFileSync(ledgerFile(root), 'utf8'); } catch (err) { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch (err) { row = null; }
    if (row && typeof row === 'object') rows.push(row);
  }
  return rows;
}
// A run's claim on its record, beside the ledger: made by one exclusive create before anything is scheduled.
const CLAIM_RE = /^drill-.*\.claim$/;
const claimFile = (root, record) => path.join(path.dirname(ledgerFile(root)), `drill-${String(record).replace(/[^A-Za-z0-9._-]/g, '_')}.claim`);
const drillOf = (root, record) => drills(root).find((r) => r.type === 'drill' && r.record === record) || null;
function append(root, row) {
  WD.ensureDir(root);
  fs.appendFileSync(ledgerFile(root), `${JSON.stringify(row)}\n`);
  return row;
}

// A headless claude child (--print with --sdk-url) left running after its session's process group was
// killed: it must not be there before a reattach. psText is `ps -eo pid,args`.
function leftoverChildren(psText) {
  const found = [];
  for (const line of String(psText || '').split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const words = m[2].trim().split(/\s+/);
    const isClaude = words.slice(0, 2).some((w) => /(^|\/)claude$/.test(w));
    if (isClaude && words.includes('--print') && words.some((w) => w === '--sdk-url' || w.startsWith('--sdk-url='))) found.push({ pid: Number(m[1]), args: m[2].trim() });
  }
  return found;
}

module.exports = { MAX_CUT_MINUTES, RESTART_AFTER, COMMANDS, privilegeOf, unitName, timerArgs, stopArgs, cutArgs, restoreArgs, checkMinutes, times, ledgerFile, claimFile, CLAIM_RE, drills, drillOf, append, leftoverChildren };
