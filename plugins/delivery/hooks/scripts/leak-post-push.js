#!/usr/bin/env node
// PostToolUse on Bash and Monitor: after a git push from a product worktree, re-scan the pushed messages.
// Prints an instruction line for the model; never calls bd itself.
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, scanPushed, pushInfo, clearPrepush } = require('./leak.js');
  const input = readHookInput();
  const shell = input && input.tool_name ? require('./lane.js').shellCommandOf(input.tool_name, input.tool_input || {}) : null;
  const cmd = shell || '';
  const ctx = cmd.includes('push') ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const denylist = loadDenylist(ctx.marker.project_root);
    let first = null;
    for (const p of pushInfo(cmd, input.cwd, ctx.roleDir)) {
      const hits = scanPushed({ cwd: p.dir, roleDir: ctx.roleDir, denylist, tags: p.tags });
      clearPrepush(ctx.roleDir, p.dir);
      if (hits.length && !first) first = hits[0];
    }
    if (first) {
      const line = `Strategy leak suspected in pushed commits: "${first}". Create a strategy review bead now: bd create "Strategy leak: ${first}" --parent <the bead you hold> --labels strategy-review, and tell the Delivery Lead.`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line } }));
    }
  }
} catch (err) { /* observe only */ }
process.exit(0);
