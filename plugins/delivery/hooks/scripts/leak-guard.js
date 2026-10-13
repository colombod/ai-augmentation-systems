#!/usr/bin/env node
// PreToolUse: no plan text or files reach the product repo. Deny JSON or nothing; exit 0 always.
// Fails closed in the product worktree: if the guard itself errors on a Bash call there, it denies.
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
let input = null;
let ctx = null;
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, decideLeak, pushInfo, recordPrepush } = require('./leak.js');
  input = readHookInput();
  ctx = input && input.tool_name ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const toolInput = input.tool_input || {};
    const denylist = input.tool_name === 'Bash' ? loadDenylist(ctx.marker.project_root) : [];
    const d = decideLeak({ toolName: input.tool_name, toolInput, cwd: input.cwd, roleDir: ctx.roleDir, denylist });
    if (d) deny(d.reason);
    else if (input.tool_name === 'Bash') {
      // Remember where each push started so the post-push scan covers exactly the pushed range.
      for (const p of pushInfo(String(toolInput.command || ''), input.cwd, ctx.roleDir)) { try { recordPrepush({ roleDir: ctx.roleDir, dir: p.dir }); } catch (e) { /* best effort */ } }
    }
  }
} catch (err) {
  if (process.env.LEAK_DEBUG) console.error(err);
  try {
    const { inProductWorktree, UNANALYSABLE } = require('./leak.js');
    if (!ctx && input && input.tool_name) { const rc = require('./role-context.js'); ctx = rc.validMarker(rc.findRoleMarker(input.cwd)); }
    if (ctx && input.tool_name === 'Bash' && inProductWorktree(input.cwd, ctx.roleDir)) deny(UNANALYSABLE);
  } catch (e) { /* outside what we can judge: stay inert */ }
}
process.exit(0);
