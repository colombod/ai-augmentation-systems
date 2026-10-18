#!/usr/bin/env node
// hooks/scripts/ask-guard.js — the operator channel guard. PreToolUse, matcher
// AskUserQuestion|PushNotification|SendUserFile: workers never address the operator.
// Only the Chief of Staff and the Product Manager reach the operator through these tools; every
// other role messages the Chief of Staff, which decides what reaches the operator, and gets a
// decision record id back for a question. Deny JSON or nothing; inert without a valid role marker;
// exit 0 always. Other channels are lane matters: MCP session tools and the shell by lane group, and
// desktop and browser control only in a reach lane (the Reality Checker), refused to every other role.
const ASKERS = new Set(['chief-of-staff', 'product-manager']);
const path = require('path');
const { operatorCommand } = require('../../scripts/lib/plugin-root.js');
const REASON = `You do not address the operator: message the Chief of Staff with the one question.\nThe answer comes back as a record id; verify it with \`${operatorCommand(path.join(__dirname, '..', '..'))} verify <id>\`.`;
const CHANNEL_REASON = 'You do not address the operator.\nMessage the Chief of Staff; it decides what reaches the operator.';
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
