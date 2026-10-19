#!/usr/bin/env node
// scripts/testing/fake-claude.js — a fake `claude` for the watchdog tests: `agents --json` prints the
// sessions in FAKE_CLAUDE_AGENTS (a JSON array, default none open); any other call appends its argv,
// working directory, role, CLAUDE_CONFIG_DIR and DELIVERY_WAKE to the ndjson file FAKE_CLAUDE_LOG and prints "ok". Never used in production.
const fs = require('fs');

const argv = process.argv.slice(2);
if (argv[0] === 'agents') { process.stdout.write(`${process.env.FAKE_CLAUDE_AGENTS || '[]'}\n`); process.exit(0); }
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), role: process.env.DELIVERY_ROLE || null, config: process.env.CLAUDE_CONFIG_DIR || null, wake: process.env.DELIVERY_WAKE || null })}\n`);
process.stdout.write('ok\n');
