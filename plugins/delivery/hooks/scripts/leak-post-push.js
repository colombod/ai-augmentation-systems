#!/usr/bin/env node
// PostToolUse on Bash: after a git push from a product worktree, re-scan the pushed messages.
// Prints an instruction line for the model; never calls bd itself.
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, scanPushed, pushInfo, clearPrepush } = require('./leak.js');
  const input = readHookInput();
  const cmd = input && input.tool_name === 'Bash' ? String((input.tool_input || {}).command || '') : '';
  const ctx = cmd.includes('push') ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const denylist = loadDenylist(ctx.marker.project_root);
    for (const p of pushInfo(cmd, input.cwd, ctx.roleDir)) {
      const hits = scanPushed({ cwd: p.dir, roleDir: ctx.roleDir, denylist, tags: p.tags });
      clearPrepush(ctx.roleDir, p.dir);
      if (hits.length) {
        process.stdout.write(`Strategy leak suspected in pushed commits: "${hits[0]}". Create a strategy review bead now: bd create "Strategy leak: ${hits[0]}" --labels strategy-review, and tell the Delivery Lead.\n`);
        break;
      }
    }
  }
} catch (err) { /* observe only */ }
process.exit(0);
