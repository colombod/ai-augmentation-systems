#!/usr/bin/env node
// scripts/lib/wake-run.js — runs one watchdog wake and stops it after its time limit (Copilot 144), so the
// watchdog's live-process guard (lib/watchdog.js, an hour longer than the limit) always covers a wake
// that is still running. usage: wake-run.js <limit ms> <claude> <args...>
const { spawn } = require('child_process');

const [limit, bin, ...args] = process.argv.slice(2);
const child = spawn(bin, args, { stdio: 'inherit' });
const timer = setTimeout(() => {
  process.stderr.write(`watchdog: the wake ran past its limit of ${Math.round(Number(limit) / 60000)} min; stopped\n`);
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 30e3).unref();
}, Number(limit) || 2 * 3600e3);
child.on('error', (err) => { process.stderr.write(`watchdog: could not start ${bin}: ${err.message}\n`); process.exit(127); });
child.on('exit', (code) => { clearTimeout(timer); process.exit(code === null ? 1 : code); });
