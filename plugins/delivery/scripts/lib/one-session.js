// scripts/lib/one-session.js — one live session per role instance: the guard every path that starts a
// role session asks first (the watchdog's wake, team-revive's start, its stale restart and its plain
// fallback).
//
// After the 0.43.94 install a role could run twice: the wake forked the role's open idle session on
// purpose, and it looked for the role's session only under the id the roster recorded, so a session the
// role ran under any other id (a hand-made unit, a Remote Control start, a fresh session) was not seen
// and the wake resumed a second one beside it. Two sessions of one instance claim and push as one actor
// and cannot tell their work apart.
//
// A live session is the instance's when its working directory is the instance's role directory or a
// directory inside it (a builder runs in role-dir/product), or its name is the instance's own session
// name (<instance>@<team>, lib/session-name.js). The session list is `claude agents --json`; a list that
// could not be read is not "none": the caller starts nothing.
const path = require('path');
const SN = require('./session-name.js');

const inside = (dir, root) => {
  if (!dir || !root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// The live sessions of instance: [] for none, null when live is null (the list could not be read).
// live: [{ sessionId, cwd, name, status, pid }]; prefix: the team's bead prefix (its session names).
function liveOf(instance, { roleDir, live, prefix = null } = {}) {
  if (live === null || live === undefined) return null;
  // the name counts only when it is the team's own <instance>@<team>: without a prefix the bare
  // instance name is shared by every team on the host
  const name = prefix ? SN.sessionName(instance, prefix) : null;
  return live.filter((s) => s && (inside(s.cwd, roleDir) || (name && s.name === name)));
}

// One line naming them, for a held start or a wake not taken.
function described(sessions) {
  return sessions.map((s) => `${s.name || s.sessionId || 'a session'}${s.status ? ` (${s.status})` : ''}${s.cwd ? ` in ${s.cwd}` : ''}`).join(', ');
}

module.exports = { liveOf, described, inside };
