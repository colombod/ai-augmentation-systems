#!/usr/bin/env node
// PreToolUse on Bash: evidence on close; no claim on a live holder. Deny JSON or nothing; exit 0.
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf } = require('./role-context.js');
  const { decideBd } = require('./bd-guard.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  if (input && input.tool_name === 'Bash' && /\bbd\b/.test(String((input.tool_input || {}).command || ''))) {
    const valid = validMarker(findRoleMarker(input.cwd));
    if (valid) {
      const staleHours = (valid.team.budget && valid.team.budget.staleness_hours) || 2;
      const d = decideBd({ command: input.tool_input.command, actor: actorOf(valid.marker), staleHours, bd: makeBd({ cwd: input.cwd }) });
      if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch (err) { /* allow */ }
process.exit(0);
