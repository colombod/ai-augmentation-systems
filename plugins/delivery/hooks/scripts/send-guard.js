#!/usr/bin/env node
// hooks/scripts/send-guard.js — a role session sends only to its own team's sessions, by full name.
// PreToolUse, matcher SendMessage|mcp__ccd_session_mgmt__send_message. Claude Code session names are
// machine-wide: a scratch quick-start team's roles ran /delivery:team join, reported to the bare name
// "chief-of-staff", and reached another team's real Chief of Staff on the same host. Checking the name
// against the sender's own manifest cannot catch that (the scratch team lists a chief-of-staff too); only
// qualified names keep teams apart, so every role session is named <instance>@<team>
// (scripts/lib/session-name.js) and this guard refuses:
//   - a bare team role or instance name ("chief-of-staff", "builder-2", "delivery-manager", "steward"),
//     or any role the plugin defines, which another team on the host may run;
//   - a role name qualified with another team's prefix ("chief-of-staff@other").
// The refusal names this team's session to send to. A name that is no role at all ("main", a subagent
// or raw agent id) and this team's qualified names pass. A trailing " [ref]" is ignored. Deny JSON or
// nothing; inert outside a role session (no valid role marker); exit 0 always.
const fs = require('fs');
const path = require('path');
const TOOLS = new Set(['SendMessage', 'mcp__ccd_session_mgmt__send_message']);

// the role ids the plugin ships (roles/*.md): a team without one may still reach another team's
let pluginRoles = null;
function pluginRoleIds() {
  if (pluginRoles) return pluginRoles;
  try { pluginRoles = fs.readdirSync(path.join(__dirname, '..', '..', 'roles')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch (err) { pluginRoles = []; }
  return pluginRoles;
}

// true when `name` (an unqualified name, any case) is a role or instance name a session could carry
function roleish(name, team) {
  const M = require('../../scripts/lib/manifest.js');
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  const insts = M.expandInstances(team || {});
  const names = new Set(['steward', 'delivery-manager', ...pluginRoleIds(), ...insts.map((i) => i.instance), ...insts.map((i) => i.role && i.role.id)].filter(Boolean).map((x) => String(x).toLowerCase()));
  // a numbered instance of any role ("builder-3") is one too, on this team or another
  return [n, n.replace(/-\d+$/, '')].some((x) => names.has(x) || names.has(String(M.canonicalRoleId(x)).toLowerCase()));
}

// the name a message to `name` should go to on this team, or null when no session of the team answers
function ownTarget(team, name, host) {
  const SN = require('../../scripts/lib/session-name.js');
  const r = require('../../scripts/lib/inbox.js').resolveTarget(team, String(name || '').toLowerCase(), host);
  return r.unknown ? null : SN.sessionName(r.to, team.prefix);
}

function teamSessions(team) {
  const SN = require('../../scripts/lib/session-name.js');
  return require('../../scripts/lib/manifest.js').expandInstances(team || {}).filter((i) => !(i.role && i.role.retired)).map((i) => SN.sessionName(i.instance, team.prefix));
}

// null (allow) or { reason } (deny), for a send from a role session of `team` on `host` to `to`
function judge(team, to, host) {
  const SN = require('../../scripts/lib/session-name.js');
  if (!team || !SN.teamTag(team.prefix) || typeof to !== 'string') return null;
  const { instance, prefix } = SN.parseSessionName(to);
  if (prefix !== null && SN.samePrefix(prefix, team.prefix)) return null;
  if (!roleish(instance, team)) return null;
  const mine = ownTarget(team, instance, host);
  const where = mine ? `send to ${mine}` : `no session of this team is "${instance}"; this team's sessions are ${teamSessions(team).join(', ')}`;
  const why = prefix !== null
    ? `"${SN.bareTarget(to)}" is a session of another team (prefix ${prefix}), not of this one (${SN.teamTag(team.prefix)})`
    : `"${SN.bareTarget(to)}" is a bare role name; session names are shared by every team on this machine, so it can reach another team's session`;
  return { reason: `${why}.\nRole sessions are named <instance>@<team>: ${where}.` };
}

// the target a send names: SendMessage's `to`, the session tool's `session_id` or `name`
function targetOf(input) {
  const ti = (input && input.tool_input) || {};
  for (const k of ['to', 'session_id', 'name', 'session_name']) if (typeof ti[k] === 'string' && ti[k].trim()) return ti[k];
  return null;
}

function decideSend(input) {
  try {
    if (!input || !TOOLS.has(input.tool_name)) return null;
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const valid = validMarker(findRoleMarker(input.cwd));
    if (!valid || !valid.role) return null;
    return judge(valid.team, targetOf(input), valid.role.host);
  } catch (err) {
    return null;
  }
}

module.exports = { decideSend, judge, TOOLS };

if (require.main === module) {
  try {
    const d = decideSend(require('./role-context.js').readHookInput());
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  } catch (err) { /* allow */ }
  process.exit(0);
}
