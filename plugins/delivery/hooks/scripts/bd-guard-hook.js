#!/usr/bin/env node
// PreToolUse on shell tools (Bash, Monitor, PowerShell): no claim on a live holder; structure only by
// the Delivery Manager; the ready gate on claim and the done gate on close (bd-guard.js gateChecks).
// Deny JSON, or a warning (recorded in .delivery/warnings/ and shown), or nothing; exit 0.
async function main() {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const { shellCommandOf } = require('./lane.js');
  const { decideBd, staleHoursOf, gateChecks, budgeted } = require('./bd-guard.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  const command = input && input.tool_name ? shellCommandOf(input.tool_name, input.tool_input || {}) : null;
  // bd named anywhere, quotes and backslashes dropped ("b"d, b\d), so a disguised call still reaches the guard
  if (command === null || !/\bbd\b/.test(String(command).replace(/['"\\]/g, ''))) return '';
  const valid = validMarker(findRoleMarker(input.cwd));
  if (!valid) return '';
  const deny = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
  // the hook timeout is 15 s; every bd call and the gates keep to one 8 s budget (each call at most 4 s)
  const deadline = Date.now() + 8000;
  const bd = budgeted(makeBd({ ...bdOptionsFor(valid.marker, input.cwd), timeoutMs: 4000 }), deadline);
  const d = decideBd({ command, actor: actorOf(valid.marker), roleId: valid.role.id, staleHours: staleHoursOf(valid.team), bd });
  if (d) return deny(d.reason);
  const root = valid.marker.project_root;
  let ask = null;
  try {
    const J = require('../../scripts/lib/judge.js');
    const config = J.judgeConfig(valid.team);
    if (config.enabled) ask = (q, state) => J.ask(q, state, { config, projectRoot: root, gate: 'bd-guard' });
  } catch (err) { ask = null; }
  const g = await gateChecks({ command, roleId: valid.role.id, actor: actorOf(valid.marker), instance: valid.marker.instance, bd, root, team: valid.team, ask, deadline });
  if (g.deny) return deny(g.deny);
  if (!g.warnings.length) return '';
  const W = require('../../scripts/lib/warnings.js');
  const lines = g.warnings.map((w) => {
    const row = W.record(root, { ...w, raisedBy: valid.marker.instance, instance: valid.marker.instance });
    return `${row ? row.id : 'unrecorded'} ${w.rule} ${w.bead}: ${w.detail}`;
  });
  // at most three lines in the session; the ledger holds them all
  const more = lines.length > 3 ? `\n... and ${lines.length - 3} more: warnings.js list --open` : '';
  const text = `delivery: allowed with ${lines.length} warning(s), recorded for the Delivery Manager:\n${lines.slice(0, 3).join('\n')}${more}`;
  return JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } });
}

main().then((out) => { if (out) process.stdout.write(out); }, () => { /* allow */ }).finally(() => { process.exitCode = 0; });
