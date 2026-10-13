#!/usr/bin/env node
// Stop: a session holding a claim does not end a turn without a note. Block JSON or nothing; exit 0.
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor } = require('./role-context.js');
  const { decideStop } = require('./turn.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  const valid = input ? validMarker(findRoleMarker(input.cwd)) : null;
  if (valid) {
    const d = decideStop({ input, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (err) { /* allow */ }
process.exit(0);
