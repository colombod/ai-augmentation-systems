#!/usr/bin/env node
// hooks/scripts/ask-guard.js — the operator channel guard. PreToolUse, matcher
// AskUserQuestion|PushNotification|SendUserFile: workers never address the operator.
// Only the Chief of Staff and the Product Manager reach the operator through these tools; every
// other role messages the Chief of Staff, which decides what reaches the operator, and gets a
// decision record id back for a question. Deny JSON or nothing; inert without a valid role marker;
// exit 0 always. Other channels (MCP session tools, desktop and browser control, shell) are lane
// matters; see the Task 4 report for the residual.
const ASKERS = new Set(['chief-of-staff', 'product-manager']);
const path = require('path');
const { operatorCommand } = require('../../scripts/lib/plugin-root.js');
const REASON = `You do not address the operator. Message the Chief of Staff with the one question (SendMessage to the chief-of-staff session); the answer comes back to you as a decision record id you verify with \`${operatorCommand(path.join(__dirname, '..', '..'))} verify <id>\`.`;
const CHANNEL_REASON = 'You do not address the operator. Message the Chief of Staff; the Chief of Staff decides what reaches the operator.';
const CHANNELS = { AskUserQuestion: REASON, PushNotification: CHANNEL_REASON, SendUserFile: CHANNEL_REASON };

// null (allow) or { reason } (deny). Never throws.
function decideAsk(input) {
  try {
    if (!input || typeof input.tool_name !== 'string' || !Object.prototype.hasOwnProperty.call(CHANNELS, input.tool_name)) return null;
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const valid = validMarker(findRoleMarker(input.cwd));
    if (!valid || !valid.role || ASKERS.has(valid.role.id)) return null;
    return { reason: CHANNELS[input.tool_name] };
  } catch (err) {
    return null;
  }
}

module.exports = { decideAsk, REASON, CHANNEL_REASON };

if (require.main === module) {
  try {
    const { readHookInput } = require('./role-context.js');
    const d = decideAsk(readHookInput());
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  } catch (err) { /* allow */ }
  process.exit(0);
}
