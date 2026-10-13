#!/usr/bin/env node
// SessionStart: re-inject the role brief, register the session in the roster.
// Never exits non-zero: a session without a role must start normally.
const path = require('path');
try {
  const { readHookInput, sessionStartText } = require('./role-context.js');
  const text = sessionStartText(readHookInput(), path.join(__dirname, '..', '..'));
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow: observing hook
}
process.exit(0);
