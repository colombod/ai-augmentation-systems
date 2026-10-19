#!/usr/bin/env node
// hooks/scripts/route-check.js — the Chief of Staff's messages against the routing table (R-06).
// PostToolUse, matcher SendMessage|mcp__ccd_session_mgmt__send_message. In the Vault the Chief of Staff
// sent 65 messages to the Product Manager and 9 to the Delivery Manager, who owned acceptance and merging.
// After a sent message, each of today's plan items it carries (its reference) gets a sent row in the plan
// record (lib/daily-plan.js), and one sent to a role other than its owner is a warning in the ledger and
// a line of context: warn only, never a block. Inert outside a Chief of Staff session; exit 0 always.
const TOOLS = new Set(['SendMessage', 'mcp__ccd_session_mgmt__send_message']);

// { context } or null. Never throws.
function check(input, { now } = {}) {
  try {
    if (!input || !TOOLS.has(input.tool_name)) return null;
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const valid = validMarker(findRoleMarker(input.cwd));
    if (!valid || !valid.role || valid.role.id !== 'chief-of-staff') return null;
    const ti = input.tool_input || {};
    const r = require('../../scripts/lib/daily-plan.js').noteSent(valid.marker.project_root, { team: valid.team, to: ti.to || ti.session_id, message: ti.message, now, by: valid.marker.instance });
    if (!r.misroutes.length) return null;
    const m = r.misroutes[0];
    return { context: `Misrouted (recorded as a warning): ${m.detail}.\nSend it to ${m.item.instance}, with its reference [${m.item.ref}].` };
  } catch (err) { return null; }
}

module.exports = { check, TOOLS };

if (require.main === module) {
  try {
    const d = check(require('./role-context.js').readHookInput());
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: d.context } }));
  } catch (err) { /* observe only */ }
  process.exit(0);
}
