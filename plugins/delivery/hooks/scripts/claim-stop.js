#!/usr/bin/env node
// Stop: capture the operator's words first (operator-capture.js; never affects the decision), then
// a session holding a claim does not end a turn without a note. Block JSON or nothing; exit 0.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const input = readHookInput();
  try {
    const { captureFromHookInput } = require('./operator-capture.js');
    const cap = captureFromHookInput(input, path.join(__dirname, '..', '..'));
    if (cap && cap.problem) process.stderr.write(`delivery: ${cap.problem}\n`);
  } catch (err) { /* capture never affects the stop decision */ }
  const { decideStop } = require('./turn.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const valid = input ? validMarker(findRoleMarker(input.cwd)) : null;
  if (valid) {
    const d = decideStop({ input, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (err) { /* allow */ }
process.exit(0);
