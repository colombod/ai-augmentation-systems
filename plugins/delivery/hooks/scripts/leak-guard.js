#!/usr/bin/env node
// PreToolUse: no plan text or files reach the product repo. Deny JSON or nothing; exit 0 always.
// Fails closed: if the guard itself errors on a shell call (Bash, Monitor, PowerShell) in product, at the role directory, or one
// whose text pairs git/gh with a directory change, it denies.
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
let input = null;
let ctx = null;
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, decideLeak } = require('./leak.js');
  const { shellCommandOf } = require('./lane.js');
  input = readHookInput();
  ctx = input && input.tool_name ? validMarker(findRoleMarker(input.cwd)) : null;
  if (ctx) {
    const toolInput = input.tool_input || {};
    const shell = shellCommandOf(input.tool_name, toolInput);
    const scansText = shell !== null || String(input.tool_name).startsWith('mcp__');
    const writesFile = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(input.tool_name);
    const root = ctx.marker.project_root;
    const denylist = scansText || writesFile ? loadDenylist(root) : [];
    // The plan's fingerprint (rebuilt only when a plan file changed) and the product repository's slug,
    // so the Delivery Manager's gh writes to it are checked from the project directory too.
    const print = scansText || writesFile ? require('../../scripts/lib/plan-print.js').load(root) : null;
    let productRepo = null;
    try { productRepo = JSON.parse(require('fs').readFileSync(require('path').join(root, '.delivery', 'team', 'team.json'), 'utf8')).product_github || null; } catch (e) { productRepo = null; }
    const d = decideLeak({ toolName: input.tool_name, toolInput, cwd: input.cwd, roleDir: ctx.roleDir, denylist, roleId: ctx.role.id, print, productRepo });
    if (d) deny(d.reason);
  }
} catch (err) {
  if (process.env.LEAK_DEBUG) console.error(err);
  try {
    const { failClosed, UNANALYSABLE } = require('./leak.js');
    if (!ctx && input && input.tool_name) { const rc = require('./role-context.js'); ctx = rc.validMarker(rc.findRoleMarker(input.cwd)); }
    const command = require('./lane.js').shellCommandOf(input.tool_name, input.tool_input || {});
    if (ctx && command !== null && failClosed({ command, cwd: input.cwd, roleDir: ctx.roleDir })) deny(UNANALYSABLE);
  } catch (e) { /* outside what we can judge: stay inert */ }
}
process.exit(0);
