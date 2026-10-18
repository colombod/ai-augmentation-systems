#!/usr/bin/env node
// PreToolUse on shell tools (Bash, Monitor, PowerShell): no claim on a live holder; structure only by
// the Delivery Manager; the ready gate on claim and the done gate on close (bd-guard.js gateChecks).
// Deny JSON, or a warning (recorded in .delivery/warnings/ and shown), or nothing; exit 0.
async function main() {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const { shellCommandOf } = require('./lane.js');
  const { decideBd, staleHoursOf, gateChecks } = require('./bd-guard.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  const command = input && input.tool_name ? shellCommandOf(input.tool_name, input.tool_input || {}) : null;
  if (command === null || !/\bbd\b/.test(command)) return '';
  const valid = validMarker(findRoleMarker(input.cwd));
  if (!valid) return '';
  const deny = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
  const bd = makeBd(bdOptionsFor(valid.marker, input.cwd));
  const d = decideBd({ command, actor: actorOf(valid.marker), roleId: valid.role.id, staleHours: staleHoursOf(valid.team), bd });
  if (d) return deny(d.reason);
  const root = valid.marker.project_root;
  let ask = null;
  try {
    const J = require('../../scripts/lib/judge.js');
    const config = J.judgeConfig(valid.team);
    if (config.enabled) ask = (q, state) => J.ask(q, state, { config, projectRoot: root, gate: 'bd-guard' });
  } catch (err) { ask = null; }
  const g = await gateChecks({ command, roleId: valid.role.id, bd, root, team: valid.team, ask });
  if (g.deny) return deny(g.deny);
  if (!g.warnings.length) return '';
  const W = require('../../scripts/lib/warnings.js');
  const lines = g.warnings.map((w) => {
    const row = W.record(root, { ...w, raisedBy: valid.marker.instance, instance: valid.marker.instance });
    return `${row ? row.id : 'unrecorded'} ${w.rule} ${w.bead}: ${w.detail}`;
  });
  const text = `delivery: allowed with ${lines.length} warning(s), recorded for the Delivery Manager:\n${lines.join('\n')}`;
  return JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
}

main().then((out) => { if (out) process.stdout.write(out); }, () => { /* allow */ }).finally(() => { process.exitCode = 0; });
