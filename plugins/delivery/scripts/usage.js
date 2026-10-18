#!/usr/bin/env node
// scripts/usage.js — the usage readings the budget uses (lib/usage.js).
//   usage.js show [--project <root>]   weighted tokens from the role transcripts this period, and the
//                                      status line's weekly reading when a fresh one exists
//   usage.js statusline                a statusLine command: reads Claude Code's status JSON on stdin,
//                                      keeps rate_limits.seven_day as .delivery/usage/statusline.json
//                                      and prints one short line. Opt-in: point a role session's
//                                      statusLine at it; without it the budget uses transcripts alone.
const fs = require('fs');
const U = require('./lib/usage.js');
const { findProjectRoot } = require('./lib/manifest.js');

function statusline(input, { now } = {}) {
  const dir = (input && input.workspace && input.workspace.current_dir) || (input && input.cwd) || process.cwd();
  let root = null;
  try { root = findProjectRoot(dir); } catch (err) { root = null; }
  const snap = U.snapshotOf(input, now);
  if (snap && root) { try { U.writeSnapshot(root, snap); } catch (err) { /* the line still prints */ } }
  return snap ? `week ${Math.round(snap.seven_day.used_percentage)}% used` : 'week usage not reported';
}

function show(root, { now } = {}) {
  const snap = U.readSnapshot(root, now);
  const since = snap ? snap.periodStart : new Date(Date.parse(now || new Date().toISOString()) - U.WEEK_MS).toISOString();
  const t = U.tokensSince(root, since);
  return [
    `Role transcripts since ${since.slice(0, 16)}: ${Math.round(t.tokens).toLocaleString('en-US')} weighted tokens in ${t.messages} replies across ${t.files} files${t.unreadable ? ` (${t.unreadable} unreadable lines skipped)` : ''}${t.note ? `; ${t.note}` : ''}.`,
    snap ? `Status line: ${snap.usedPct}% of the weekly allowance used, resets ${snap.resetsAt.slice(0, 16)} (read ${snap.at.slice(0, 16)}).` : 'Status line: no fresh weekly reading (usage.js statusline is not wired, or the account reports none).',
  ].join('\n');
}

if (require.main === module) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'statusline') {
    let input = null;
    try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (err) { input = null; }
    process.stdout.write(`${statusline(input)}\n`);
  } else if (cmd === 'show') {
    const i = process.argv.indexOf('--project');
    const root = i >= 0 ? require('path').resolve(process.argv[i + 1] || '.') : findProjectRoot(process.cwd());
    if (!root) { process.stderr.write('usage.js: no project found; pass --project <root>\n'); process.exitCode = 2; } else process.stdout.write(`${show(root)}\n`);
  } else { process.stderr.write('usage: usage.js show [--project <root>] | usage.js statusline\n'); process.exitCode = 2; }
}

module.exports = { statusline, show };
