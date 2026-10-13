// hooks/scripts/turn.js — a turn that holds a claim leaves a note.
const fs = require('fs');
const path = require('path');

function markTurnStart(roleDir, now) {
  try { fs.writeFileSync(path.join(roleDir, '.delivery-turn'), `${now || new Date().toISOString()}\n`); } catch (err) { /* ignore */ }
}

function readTurnStart(roleDir) {
  try { return fs.readFileSync(path.join(roleDir, '.delivery-turn'), 'utf8').trim(); } catch (err) { return null; }
}

function decideStop({ input, roleDir, actor, bd }) {
  if (input && input.stop_hook_active) return null;
  const start = readTurnStart(roleDir);
  if (!start || !actor) return null;
  let held;
  try { held = bd.list({ assignee: actor, status: 'in_progress' }) || []; } catch (err) { return null; }
  if (!held.length) return null;
  const stale = held.filter((b) => !b.updated_at || Date.parse(b.updated_at) < Date.parse(start));
  if (!stale.length) return null;
  const id = stale[0].id;
  return { reason: `You hold ${id} and this turn left no note in it. Append one now: bd update ${id} --append-notes "<date>: what was done, where, proof" (or release the claim if you stopped working on it). Then finish.` };
}

module.exports = { markTurnStart, readTurnStart, decideStop };
