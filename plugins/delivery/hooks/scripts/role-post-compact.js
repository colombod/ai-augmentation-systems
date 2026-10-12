#!/usr/bin/env node
// PostCompact: restate the role after context compaction.
const path = require('path');
try {
  const { readHookInput, postCompactText } = require('./role-context.js');
  const text = postCompactText(readHookInput(), path.join(__dirname, '..', '..'));
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow
}
process.exit(0);
