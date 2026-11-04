#!/usr/bin/env node
// PreToolUse: machine setup the operator has ruled on is not a session's call (setup.js). Unlike the
// lane and leak guards this one is NOT inert without a role marker: it binds every Claude Code session
// on the host, because the session that moved the team's temp files was not a role session.
// Deny JSON or nothing; exit 0 always.
//
// The operator records are read only when the tool call is a candidate machine-setup change (decideSetup
// calls the records function lazily), so ordinary writes and commands cost no store read.
//
// Fails open on an internal error, since a broken guard must not stop every session on the host, with
// one exception: an input that plainly targets a Claude settings file and names a temp variable is
// denied anyway, because that is exactly the change this guard exists to stop.
const os = require('os');
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
const UNJUDGED = 'Refused: this looks like a change of where temp files go in a Claude settings file, and the setup guard could not check it. If you believe it must change, message the Chief of Staff; do not ask the operator.';
let input = null;
const home = process.env.HOME || os.homedir();
try {
  const { readHookInput } = require('./role-context.js');
  const S = require('./setup.js');
  input = readHookInput();
  if (input && typeof input.tool_name === 'string') {
    const cwd = input.cwd || process.cwd();
    const fs = require('fs');
    const d = S.decideSetup({
      toolName: input.tool_name, toolInput: input.tool_input || {}, cwd, home, env: process.env,
      readFile: (f) => fs.readFileSync(f, 'utf8'),
      records: () => S.loadRecords(S.projectRoots({ cwd, home, env: process.env })),
    });
    if (d) deny(d.reason);
  }
} catch (err) {
  if (process.env.SETUP_GUARD_DEBUG) console.error(err);
  try {
    if (input && require('./setup.js').obviousTempSettings(input.tool_input, { cwd: input.cwd || process.cwd(), home, env: process.env })) deny(UNJUDGED);
  } catch (e) { /* outside what we can judge: allow */ }
}
process.exit(0);
