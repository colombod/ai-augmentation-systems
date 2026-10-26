#!/usr/bin/env node
// hooks/scripts/route-check.js — the Chief of Staff's messages against the routing table (R-06).
// PostToolUse, matcher SendMessage|mcp__ccd_session_mgmt__send_message. In the Vault the Chief of Staff
// sent 65 messages to the Product Manager and 9 to the Delivery Manager, who owned acceptance and merging.
// After a sent message, each of today's plan items it carries (its reference) gets a sent row in the plan
// record (lib/daily-plan.js), and one sent to a role other than its owner is a warning in the ledger and
// a line of context: warn only, never a block. A send that fails because its target is not running is
// kept for the target in any role (keepUndelivered). Exit 0 always.
const TOOLS = new Set(['SendMessage', 'mcp__ccd_session_mgmt__send_message']);

// A send to a role whose session is not running is kept for it (lib/inbox.js), for every role: the
// watchdog wakes the target with it, and the sender is told so, instead of losing the message. A name
// that is no role on the team is not kept (no session would ever read it) and the sender is told whom
// it can reach; a role never started is kept, and the sender is told the watchdog cannot wake it.
function keepUndelivered(input, valid, now) {
  const IB = require('../../scripts/lib/inbox.js');
  const named = IB.unreachableTarget(input.tool_response);
  if (!named) return null;
  const host = valid.role && valid.role.host;
  const r = IB.resolveTarget(valid.team, named, host);
  if (r.unknown) {
    const what = named === 'steward' ? `"steward" is a duty, not a session, and no role on host ${host || 'this host'} has it` : `${named} is not a role on this team`;
    return `${what}, so the message was not kept: nobody would read it. Send it to one of: ${r.names.join(', ')}. A blocker nobody on the team can clear goes on its bead (bd update <id> --append-notes "...").`;
  }
  const ti = input.tool_input || {};
  const root = valid.marker.project_root;
  IB.queue(root, { to: r.to, from: valid.marker.instance, summary: ti.summary, message: ti.message, at: now });
  const label = r.via === 'steward' ? `${r.to} (this host's steward)` : r.to;
  let started = true;
  try { started = Boolean(require('../../scripts/lib/roster.js').readRoster(root).instances[r.to]); } catch (err) { /* unreadable: assume started */ }
  if (!started) return `${label} has never been started on this team, so the message is kept for it but the watchdog cannot wake it: nobody reads it until ${r.to} is started (start.js prints its command). Do not wait on it; record the blocker on its bead (bd update <id> --append-notes "...") and carry on.`;
  return `${label} is not running, so the message is kept for it: the watchdog wakes ${r.to} with it at its next run. Carry on; do not ask the operator to pass it on (team rule 0).`;
}

// { context } or null. Never throws.
function check(input, { now } = {}) {
  try {
    if (!input || !TOOLS.has(input.tool_name)) return null;
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const valid = validMarker(findRoleMarker(input.cwd));
    if (!valid || !valid.role) return null;
    const kept = keepUndelivered(input, valid, now);
    if (kept) return { context: kept };
    if (valid.role.id !== 'chief-of-staff') return null;
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
