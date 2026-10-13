#!/usr/bin/env node
// Stop: capture the operator's words first (operator-capture.js; never affects the decision), then
// collect every applicable reason: the Chief of Staff's operator checks (relay-guard.js: an
// unrecorded input of its own session or a broken own records chain, and a request that the
// operator relay something) and the claim note (turn.js: a session holding a claim leaves a note).
// turn.composeStop joins them into one block, each kind at most once per turn and never a third
// blocking stop, so a relay request is not masked by another reason and the hook cannot loop.
// Block JSON or nothing; exit 0.
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
    const { operatorChecks, sessionIdOf } = require('./relay-guard.js');
    const { decideStop, composeStop } = require('./turn.js');
    const candidates = [];
    try {
      candidates.push(...operatorChecks({ input, roleDir: valid.roleDir, projectRoot: valid.marker.project_root, role: valid.role.id,
        instance: valid.marker.instance, captureStatus: cap && cap.status, deps: { warn: (m) => process.stderr.write(m) } }));
    } catch (err) { /* the operator checks fail open */ }
    try {
      const { makeBd } = require('../../scripts/lib/bd.js');
      // composeStop limits repeats, so the claim check runs on a continuation too
      const claim = decideStop({ input: { ...input, stop_hook_active: false }, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
      if (claim) candidates.push({ kind: 'claim', reason: claim.reason });
    } catch (err) { /* allow */ }
    const d = composeStop({ input, roleDir: valid.roleDir, sessionId: sessionIdOf(valid.roleDir, input), candidates });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (err) { /* allow */ }
process.exit(0);
