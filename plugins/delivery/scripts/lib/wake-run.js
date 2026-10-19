#!/usr/bin/env node
// scripts/lib/wake-run.js — runs one watchdog wake in its own process group and stops the whole group
// (the session and every tool subprocess it started) after its time limit: SIGTERM, then SIGKILL once
// DELIVERY_WAKE_KILL_GRACE_MS (30 s) has passed (Copilot 144, 857). The supervisor lives until the group
// is gone, so the watchdog's live-process guard, which checks this pid, covers the wake for as long as
// any of it runs. A group still alive when the session exits on its own is stopped the same way.
// usage: wake-run.js <limit ms> <claude> <args...>
const { spawn } = require('child_process');

const [limit, bin, ...args] = process.argv.slice(2);
const grace = Number(process.env.DELIVERY_WAKE_KILL_GRACE_MS) || 30e3;
const child = spawn(bin, args, { stdio: 'inherit', detached: true });
const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
let stopping = false;
function stopGroup(code) {
  if (stopping) return;
  stopping = true;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (err) { /* already gone */ }
  const until = Date.now() + grace;
  let killed = false;
  const tick = setInterval(() => {
    if (!groupAlive()) { clearInterval(tick); process.exit(code); }
    if (!killed && Date.now() >= until) { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch (err) { /* gone */ } }
  }, 100);
}
const timer = setTimeout(() => {
  process.stderr.write(`watchdog: the wake ran past its limit of ${Math.round(Number(limit) / 60000)} min; stopped\n`);
  stopGroup(124);
}, Number(limit) || 2 * 3600e3);
child.on('error', (err) => { process.stderr.write(`watchdog: could not start ${bin}: ${err.message}\n`); process.exit(127); });
child.on('exit', (code) => {
  clearTimeout(timer);
  if (stopping) return;
  const c = code === null ? 1 : code;
  if (groupAlive()) stopGroup(c); else process.exit(c);
});
