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
//   - a role name qualified with another team's prefix ("chief-of-staff@other");
//   - an "@" with nothing on one side ("builder@");
//   - a name that is no role but starts another team's live role session's name ("chief"), since Claude
//     Code resolves a send by prefix too.
// The refusal names this team's session to send to; for a while, a bare name of this team's own
// instance passes with a warning, running or not, unless another team's live session holds it (below). A name that
// is no role at all ("main", a subagent or raw agent id) and this team's qualified names pass. A
// trailing " [ref]" is ignored. Deny JSON, warning JSON or nothing; inert outside a role session (no
// valid role marker); exit 0 always.
const fs = require('fs');
const os = require('os');
const path = require('path');
const TOOLS = new Set(['SendMessage', 'mcp__ccd_session_mgmt__send_message']);

// the role ids the plugin ships (roles/*.md): a team without one may still reach another team's
let pluginRoles = null;
function pluginRoleIds() {
  if (pluginRoles) return pluginRoles;
  try { pluginRoles = fs.readdirSync(path.join(__dirname, '..', '..', 'roles')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch (err) { pluginRoles = []; }
  return pluginRoles;
}

// a session name as a role id: any case, spaces and underscores as hyphens. A session can carry a display
// name ("Chief of Staff"), and a send to it reaches the role all the same: the quick-start team that
// reached ours sent to "Chief of Staff [a1fbfe]" as well as "chief-of-staff" (tqv.5)
const slug = (name) => String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');

// true when `name` (an unqualified name, any case) is a role or instance name a session could carry
function roleish(name, team) {
  const M = require('../../scripts/lib/manifest.js');
  const n = slug(name);
  if (!n) return false;
  const insts = M.expandInstances(team || {});
  const names = new Set(['steward', 'delivery-manager', ...pluginRoleIds(), ...insts.map((i) => i.instance), ...insts.map((i) => i.role && i.role.id)].filter(Boolean).map((x) => String(x).toLowerCase()));
  // a numbered instance of any role ("builder-3") is one too, on this team or another
  return [n, n.replace(/-\d+$/, '')].some((x) => names.has(x) || names.has(String(M.canonicalRoleId(x)).toLowerCase()));
}

// the name a message to `name` should go to on this team, or null when no session of the team answers
function ownTarget(team, name, host) {
  const SN = require('../../scripts/lib/session-name.js');
  const r = require('../../scripts/lib/inbox.js').resolveTarget(team, slug(name), host);
  return r.unknown ? null : SN.sessionName(r.to, team.prefix);
}

function teamSessions(team) {
  const SN = require('../../scripts/lib/session-name.js');
  return require('../../scripts/lib/manifest.js').expandInstances(team || {}).filter((i) => !(i.role && i.role.retired)).map((i) => SN.sessionName(i.instance, team.prefix));
}

// TODO(delivery-plugin-planning-tqv.5): remove this bare-name fallback once every role has started fresh under its qualified name.
// Sessions started before qualified names still run under their bare instance name, so a bare send to
// one of this team's instances passes, with a warning, unless a live session it can reach is not this
// team's: the name exactly or as a prefix, so "chief-of-staff" while "chief-of-staff@beta" runs is refused. A teammate that is not running is no reason to refuse: the send fails as unreachable, route-check.js
// (PostToolUse) keeps it for that role and the watchdog wakes the role with it. A live session counts as
// this team's when its cwd is that instance's role directory (<team dir>/<instance>, beside the sender's)
// and the directory holds that instance's role marker for this project. Claude Code writes one JSON per
// session to ~/.claude/sessions/<pid>.json (pid, cwd, name, status); a pid that no longer runs is no
// session, and no such directory means none runs. A live one elsewhere (a scratch team's chief-of-staff),
// or a record or role directory that cannot be read (it may be another team's): refused.
function sessionsDir() {
  return process.env.DELIVERY_CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}
// the live sessions a send to `name` can reach: Claude Code resolves a name exactly or as a prefix, so
// every live session whose name (as a slug) starts with it: "chief-of-staff" reaches "chief-of-staff@beta"
// and "chief" reaches both teams' chiefs of staff. Throws when a record cannot be read
function liveSessionsReached(dir, name) {
  const want = slug(name);
  const out = [];
  let files;
  try { files = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return out; throw err; }
  for (const f of files.filter((x) => /^\d+\.json$/.test(x))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!s || !Number.isInteger(s.pid) || s.pid <= 0 || !pidAlive(s.pid)) continue;
    if (typeof s.name === 'string' && want && slug(s.name).startsWith(want)) out.push(s);
  }
  return out;
}
const real = (p) => { try { return fs.realpathSync(p); } catch (err) { return null; } };
// true when live session `s` is this team's: its name is one of this team's instances, bare or with this
// team's prefix, and its cwd is that instance's role directory, holding that instance's marker for this project
function ourSession(s, team, { teamDir, projectRoot }) {
  const SN = require('../../scripts/lib/session-name.js');
  const { instance, prefix } = SN.parseSessionName(s.name);
  if (prefix !== null && !SN.samePrefix(prefix, team.prefix)) return false;
  const inst = require('../../scripts/lib/manifest.js').expandInstances(team).find((i) => i.instance.toLowerCase() === slug(instance));
  if (!inst) return false;
  const roleDir = real(path.join(teamDir, inst.instance));
  if (!roleDir || typeof s.cwd !== 'string' || real(s.cwd) !== roleDir) return false;
  const marker = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8'));
  return !!marker && marker.instance === inst.instance && real(marker.project_root) === real(projectRoot);
}
// true when every live session a send to `name` can reach is this team's (none live at all included)
function noOtherLiveSession(name, team, own) {
  try {
    return liveSessionsReached(own.dir || sessionsDir(), name).every((s) => ourSession(s, team, own));
  } catch (err) {
    return false;
  }
}
// the live role sessions of another team a send to `name` can reach (a role name, bare or qualified, outside
// this team's role directories); [{ name }] when the records cannot be read (it may be another team's)
function otherRoleSessionsReached(name, team, own) {
  const SN = require('../../scripts/lib/session-name.js');
  try {
    return liveSessionsReached(own.dir || sessionsDir(), name).filter((s) => roleish(SN.parseSessionName(s.name).instance, team) && !ourSession(s, team, own));
  } catch (err) {
    return [{ name: 'an unreadable session record' }];
  }
}

// the live sessions outside this team that a send to this team's full name `full` can reach: none when a live
// session of ours holds that name exactly (an exact name is delivered to directly); [{ name }] when the
// records cannot be read (it may be another team's)
function otherSessionsReachedByOwnName(full, team, own) {
  try {
    const reached = liveSessionsReached(own.dir || sessionsDir(), full);
    if (reached.some((s) => slug(s.name) === slug(full) && ourSession(s, team, own))) return [];
    return reached.filter((s) => !ourSession(s, team, own));
  } catch (err) {
    return [{ name: 'an unreadable session record' }];
  }
}

// null (allow), { reason } (deny) or { warn } (allow with a warning), for a send from a role session of
// `team` on `host` to `to`; own: { teamDir, projectRoot } of the sender, for the bare-name fallback
function judge(team, to, host, own = null) {
  const SN = require('../../scripts/lib/session-name.js');
  if (!team || !SN.teamTag(team.prefix) || typeof to !== 'string') return null;
  const { instance, prefix } = SN.parseSessionName(to);
  if (prefix !== null && SN.samePrefix(prefix, team.prefix)) {
    // our own full name is safe unless, with no live session of ours holding it, it is the start of another
    // team's live session's name: "chief-of-staff@alpha" reaches "chief-of-staff@alpha-scratch"
    const full = SN.sessionName(slug(instance), team.prefix);
    const other = own ? otherSessionsReachedByOwnName(full, team, own) : [];
    if (!other.length) return null;
    return { reason: `"${SN.bareTarget(to)}" is this team's name, but no session of this team holds it now and it is the start of ${other.map((x) => `"${x.name}"`).join(', ')}, a live session outside this team, which a send to it can reach.\nWait for ${full} to run (a send to a teammate that is not running is kept for it once it is), or send to another of this team's sessions: ${teamSessions(team).join(', ')}.` };
  }
  // "builder@" or "@alpha": an "@" with no team after it, or no instance before it, names no session of ours
  if (prefix === null && instance.includes('@')) {
    return { reason: `"${SN.bareTarget(to)}" is no full session name: an "@" needs an instance before it and a team after it.\nRole sessions are named <instance>@<team>; this team's sessions are ${teamSessions(team).join(', ')}.` };
  }
  if (!roleish(instance, team)) {
    // a name that is no role ("main", an agent id) passes, unless it is the start of another team's live
    // role session's name ("chief", "deliv"), which a prefix send would reach
    const other = prefix === null && own ? otherRoleSessionsReached(instance, team, own) : [];
    if (!other.length) return null;
    return { reason: `"${SN.bareTarget(to)}" is the start of ${other.map((s) => `"${s.name}"`).join(', ')}, a live session outside this team, and a send to it can reach that session.\nRole sessions are named <instance>@<team>: this team's sessions are ${teamSessions(team).join(', ')}.` };
  }
  const mine = ownTarget(team, instance, host);
  if (prefix === null && own) {
    const inst = require('../../scripts/lib/manifest.js').expandInstances(team).find((i) => i.instance.toLowerCase() === slug(instance));
    if (inst && noOtherLiveSession(instance, team, own)) {
      return { warn: `delivery: "${SN.bareTarget(to)}" is a bare session name; allowed for now because it is this team's instance and no other team's live session holds it. Send to ${SN.sessionName(inst.instance, team.prefix)} from now on: session names are shared by every team on this machine.` };
    }
  }
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
    return judge(valid.team, targetOf(input), valid.role.host, { teamDir: path.dirname(valid.roleDir), projectRoot: valid.marker.project_root });
  } catch (err) {
    return null;
  }
}

module.exports = { decideSend, judge, TOOLS };

if (require.main === module) {
  try {
    const d = decideSend(require('./role-context.js').readHookInput());
    if (d && d.warn) process.stdout.write(JSON.stringify({ systemMessage: d.warn, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: d.warn } }));
    else if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  } catch (err) { /* allow */ }
  process.exit(0);
}
