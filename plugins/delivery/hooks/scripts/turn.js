// hooks/scripts/turn.js — a turn that holds a claim leaves a note.
const fs = require('fs');
const path = require('path');

// bd records updated_at to the second, so the start is truncated to the second: a note appended
// in the same second as the prompt still counts as this turn's.
function toSecond(now) {
  const ms = Date.parse(now || new Date().toISOString());
  return Number.isNaN(ms) ? String(now) : new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function markTurnStart(roleDir, now) {
  try { fs.writeFileSync(path.join(roleDir, '.delivery-turn'), `${toSecond(now)}\n`); } catch (err) { /* ignore */ }
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
