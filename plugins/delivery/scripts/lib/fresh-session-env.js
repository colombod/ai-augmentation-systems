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

// A live session is no test run: the mark of an unsealed test run never passes to a session or a scope
// started from it, which inherit their caller's environment and would then skip the service directory.
function withoutTestRunMark(env) {
  if (!env || env.DELIVERY_UNSEALED_TEST_RUN === undefined) return env;
  const out = { ...env };
  delete out.DELIVERY_UNSEALED_TEST_RUN;
  return out;
}

module.exports = { freshSessionEnv, withoutTestRunMark, PARENT_SESSION_VARS };
