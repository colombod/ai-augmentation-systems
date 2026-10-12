#!/usr/bin/env node
// PostToolUse on Bash: after a git push from a product worktree, re-scan the pushed messages.
// Prints an instruction line for the model; never calls bd itself.
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, scanPushed } = require('./leak.js');
  const { splitCommand, tokens } = require('./lane.js');
  const input = readHookInput();
  const cmd = input && input.tool_name === 'Bash' ? String((input.tool_input || {}).command || '') : '';
  const pushed = splitCommand(cmd).some((s) => { const t = tokens(s); return t[0] === 'git' && t.includes('push'); });
  const ctx = pushed ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const hits = scanPushed({ cwd: input.cwd, roleDir: ctx.roleDir, denylist: loadDenylist(ctx.marker.project_root) });
    if (hits.length) process.stdout.write(`Strategy leak suspected in pushed commits: "${hits[0]}". Create a strategy review bead now: bd create "Strategy leak: ${hits[0]}" --labels strategy-review, and tell the Delivery Lead.\n`);
  }
} catch (err) { /* observe only */ }
process.exit(0);
