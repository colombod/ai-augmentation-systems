#!/usr/bin/env node
// SessionStart: capture the operator's words (operator-capture.js), re-inject the role brief,
// register the session in the roster. Never exits non-zero: a session without a role must start normally.
const path = require('path');
try {
  const { readHookInput, sessionStartText } = require('./role-context.js');
  const input = readHookInput();
  const text = sessionStartText(input, path.join(__dirname, '..', '..'), { warn: (m) => process.stderr.write(m) });
  // every session, role or not: on a machine with Amplifier, the first thing it knows is to lean on it
  let hint = '';
  try { hint = require('../../scripts/lib/amplifier.js').sessionHint(process.env); } catch (err) { hint = ''; }
  // the Delivery Manager and the Product Manager start knowing whether the plan is behind what shipped
  let plan = '';
  try {
    const rc = require('./role-context.js');
    const ctx = rc.validMarker(rc.findRoleMarker((input && input.cwd) || process.cwd()));
    if (ctx && ['delivery-lead', 'product-manager'].includes(ctx.role.id)) {
      let beads = null;
      try { beads = require('../../scripts/lib/bd.js').makeBd({ cwd: ctx.marker.project_root, timeoutMs: 8000 }).list({ all: true }); } catch (err) { beads = null; }
      const d = require('../../scripts/lib/plan-sync.js').drift(ctx.marker.project_root, { beads });
      if (d.length) plan = `\nThe plan is behind what shipped (${d.length}: ${d[0].detail}). Bring it up to date first: \`node ${path.join(__dirname, '..', '..', 'scripts', 'plan-sync.js')} apply\`; the merge gate refuses merges until it is.\n`;
    }
  } catch (err) { plan = ''; }
  if (text || hint || plan) process.stdout.write(`${text || ''}${plan}${hint}`);
} catch (err) {
  // swallow: observing hook
}
process.exit(0);
