#!/usr/bin/env node
// PreToolUse: no plan text or files reach the product repo. Deny JSON or nothing; exit 0 always.
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, decideLeak } = require('./leak.js');
  const input = readHookInput();
  const ctx = input && input.tool_name ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const d = decideLeak({ toolName: input.tool_name, toolInput: input.tool_input || {}, cwd: input.cwd, roleDir: ctx.roleDir, denylist: loadDenylist(ctx.marker.project_root) });
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  }
} catch (err) { if (process.env.LEAK_DEBUG) console.error(err); }
process.exit(0);
