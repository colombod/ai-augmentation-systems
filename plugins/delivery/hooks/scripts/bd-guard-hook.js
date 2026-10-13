#!/usr/bin/env node
// PreToolUse on shell tools (Bash, Monitor, PowerShell): evidence on close; no claim on a live holder.
// Deny JSON or nothing; exit 0.
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const { shellCommandOf } = require('./lane.js');
  const { decideBd } = require('./bd-guard.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  const command = input && input.tool_name ? shellCommandOf(input.tool_name, input.tool_input || {}) : null;
  if (command !== null && /\bbd\b/.test(command)) {
    const valid = validMarker(findRoleMarker(input.cwd));
    if (valid) {
      const staleHours = (valid.team.budget && valid.team.budget.staleness_hours) || 2;
      const d = decideBd({ command, actor: actorOf(valid.marker), staleHours, bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
      if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch (err) { /* allow */ }
process.exit(0);
