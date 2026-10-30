#!/usr/bin/env node
// scripts/amplifier.js — is Microsoft Amplifier on this machine, and is its work-tracker healthy.
//   amplifier.js detect [--json]     read only: paths, version, work-tracker service and doctor
// It never starts an Amplifier agent: that call is the session's own (`amplifier run "<request>"`),
// in the open, so Claude Code's permission check judges the real command (skills/amplifier).
// Exit codes: 0 Amplifier found; 3 not installed here; 2 usage.
const { execFileSync } = require('child_process');
const A = require('./lib/amplifier.js');

function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out, err: '' };
  } catch (err) {
    return { ok: false, out: String(err.stdout || ''), err: String(err.stderr || err.message || '') };
  }
}

function main(argv, { env = process.env, platform = process.platform, runner = run, write = (s) => process.stdout.write(s) } = {}) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'detect' || rest.some((x) => x !== '--json')) {
    write('usage: amplifier.js detect [--json]\n');
    return 2;
  }
  const d = A.detect({ env, platform, run: runner });
  if (rest.includes('--json')) write(`${JSON.stringify(d)}\n`);
  else if (!d.amplifier) write('Amplifier is not installed on this machine (no `amplifier` on PATH).\n');
  else for (const r of A.checkRows(d)) write(`${r.name}: ${r.status}: ${r.detail}${r.fix ? `\n  fix: ${r.fix}` : ''}\n`);
  return d.amplifier ? 0 : 3;
}

module.exports = { main };
if (require.main === module) process.exit(main(process.argv.slice(2)));
