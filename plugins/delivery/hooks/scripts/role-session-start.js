#!/usr/bin/env node
// SessionStart: capture the operator's words (operator-capture.js), re-inject the role brief,
// register the session in the roster. Never exits non-zero: a session without a role must start normally.
const path = require('path');
try {
  const { readHookInput, sessionStartText } = require('./role-context.js');
  const text = sessionStartText(readHookInput(), path.join(__dirname, '..', '..'), { warn: (m) => process.stderr.write(m) });
  // every session, role or not: on a machine with Amplifier, the first thing it knows is to lean on it
  let hint = '';
  try { hint = require('../../scripts/lib/amplifier.js').sessionHint(process.env); } catch (err) { hint = ''; }
  if (text || hint) process.stdout.write(`${text || ''}${hint}`);
} catch (err) {
  // swallow: observing hook
}
process.exit(0);
