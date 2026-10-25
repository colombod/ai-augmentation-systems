// scripts/lib/fresh-session-env.js — the environment for a session the plugin starts (start.js --launch,
// watchdog wake). A process started from inside a Claude Code session inherits that session's identity
// in these variables, and `claude` then reuses it: measured on 2026-10-25, four roles launched from one
// session all registered on the roster under the launching session's id, so each would have been woken
// as that session. Without them each started session gets its own id. Authentication is not in them.
const PARENT_SESSION_VARS = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID'];

function freshSessionEnv(env, extra = {}) {
  const out = { ...env };
  for (const k of PARENT_SESSION_VARS) delete out[k];
  return { ...out, ...extra };
}

module.exports = { freshSessionEnv, PARENT_SESSION_VARS };
