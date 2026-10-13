#!/usr/bin/env node
// hooks/scripts/ask-guard.js — PreToolUse (matcher AskUserQuestion): workers never address the operator.
// Only the Chief of Staff and the Product Manager ask the operator; every other role messages the
// Chief of Staff with the one question and gets a decision record id back. Deny JSON or nothing;
// inert without a valid role marker; exit 0 always.
const ASKERS = new Set(['chief-of-staff', 'product-manager']);
const REASON = 'You do not address the operator. Message the Chief of Staff with the one question (SendMessage to the chief-of-staff session); the answer comes back to you as a decision record id you verify with operator.js verify.';

// null (allow) or { reason } (deny). Never throws.
function decideAsk(input) {
  try {
    if (!input || input.tool_name !== 'AskUserQuestion') return null;
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const valid = validMarker(findRoleMarker(input.cwd));
    if (!valid || !valid.role || ASKERS.has(valid.role.id)) return null;
    return { reason: REASON };
  } catch (err) {
    return null;
  }
}

module.exports = { decideAsk, REASON };

if (require.main === module) {
  try {
    const { readHookInput } = require('./role-context.js');
    const d = decideAsk(readHookInput());
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  } catch (err) { /* allow */ }
  process.exit(0);
}
