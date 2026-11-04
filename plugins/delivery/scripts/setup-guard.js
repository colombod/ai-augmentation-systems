#!/usr/bin/env node
// scripts/setup-guard.js install [--config-dir <dir>]
// Installs the setup guard as a user-level hook (lib/user-guard.js), so it binds every Claude Code
// session on this host, plugin enabled or not. Idempotent; the watchdog host job runs the same step
// every cycle, so this is for the team to run at once after setting a host up, never for the operator.
const path = require('path');
const { ensureUserGuard } = require('./lib/user-guard.js');

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'install') return { code: 2, out: 'usage: setup-guard.js install [--config-dir <dir>]' };
  let configDir = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--config-dir' && rest[i + 1]) configDir = rest[++i];
    else return { code: 2, out: `setup-guard.js: unknown argument ${rest[i]}` };
  }
  const r = ensureUserGuard({ configDir: configDir ? path.resolve(configDir) : undefined, pluginRoot: path.join(__dirname, '..') });
  const failed = /not installed|does not parse|not a settings object/.test(r.line || '');
  return { code: failed ? 1 : 0, out: r.line || 'setup guard: already installed' };
}

module.exports = { main };

if (require.main === module) {
  const r = main(process.argv.slice(2));
  (r.code ? console.error : console.log)(r.out);
  process.exit(r.code);
}
