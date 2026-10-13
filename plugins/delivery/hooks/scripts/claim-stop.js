#!/usr/bin/env node
// Stop: capture the operator's words first (operator-capture.js; never affects the decision), then
// the Chief of Staff's operator checks (relay-guard.js: an unrecorded input of its own session, or a
// request that the operator relay something), then a session holding a claim does not end a turn
// without a note. The first reason blocks. Block JSON or nothing; exit 0.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const input = readHookInput();
  let cap = null;
  try {
    const { captureFromHookInput } = require('./operator-capture.js');
    cap = captureFromHookInput(input, path.join(__dirname, '..', '..'));
    if (cap && cap.problem) process.stderr.write(`delivery: ${cap.problem}\n`);
  } catch (err) { /* capture never affects the stop decision */ }
  let valid = null;
  try { valid = input ? validMarker(findRoleMarker(input.cwd)) : null; } catch (err) { valid = null; }
  if (valid) {
    let d = null;
    try {
      const { decideStopForOperator } = require('./relay-guard.js');
      d = decideStopForOperator({ input, roleDir: valid.roleDir, projectRoot: valid.marker.project_root, role: valid.role.id,
        instance: valid.marker.instance, captureStatus: cap && cap.status, now: new Date().toISOString(),
        deps: { warn: (m) => process.stderr.write(m) } });
    } catch (err) { d = null; }
    if (!d) {
      const { decideStop } = require('./turn.js');
      const { makeBd } = require('../../scripts/lib/bd.js');
      d = decideStop({ input, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
    }
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (err) { /* allow */ }
process.exit(0);
