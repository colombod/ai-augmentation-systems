#!/usr/bin/env node
// PreToolUse: keep the role in its lane. Prints a deny decision or nothing. Never exits non-zero.
const path = require('path');
try {
  const { readHookInput } = require('./role-context.js');
  const { laneDecisionForHook } = require('./lane.js');
  const input = readHookInput();
  const d = input && input.tool_name ? laneDecisionForHook(input, path.join(__dirname, '..', '..')) : null;
  if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
} catch (err) {
  // allow on any failure
}
process.exit(0);
