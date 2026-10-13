// hooks/scripts/turn.js — a turn that holds a claim leaves a note.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Per-turn stop state: which kinds of block this turn has already shown.
const STOP_STATE = '.delivery-stop-state.json';

// bd records updated_at to the second, so the start is truncated to the second: a note appended
// in the same second as the prompt still counts as this turn's.
function toSecond(now) {
  const ms = Date.parse(now || new Date().toISOString());
  return Number.isNaN(ms) ? String(now) : new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function markTurnStart(roleDir, now) {
  try { fs.writeFileSync(path.join(roleDir, '.delivery-turn'), `${toSecond(now)}\n`); } catch (err) { /* ignore */ }
  try { fs.rmSync(path.join(roleDir, STOP_STATE), { force: true }); } catch (err) { /* ignore */ }
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

// Joins every applicable stop reason into one block, limited per turn so a stop always ends:
// - each kind (unrecorded, integrity, relay, claim, ...) blocks at most once per turn;
// - at most two stops per turn block; the third always passes.
// A first stop (stop_hook_active false), a new session or a new turn start resets the state.
// candidates: [{ kind, reason }]. Returns null or { reason, kinds }. Fails open on a continuation
// whose state cannot be saved, so a broken role directory can never loop.
function composeStop({ input, roleDir, sessionId, candidates }) {
  const active = !!(input && input.stop_hook_active);
  const file = path.join(roleDir, STOP_STATE);
  const turn = readTurnStart(roleDir);
  let st = null;
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { st = null; }
  if (!active || !st || typeof st !== 'object' || st.session_id !== (sessionId || null) || st.turn !== turn
    || !st.blocks || typeof st.blocks !== 'object' || !Number.isInteger(st.blocking_stops)) {
    st = { session_id: sessionId || null, turn, blocks: {}, blocking_stops: 0 };
  }
  st.last_message_hash = crypto.createHash('sha256').update(String((input && input.last_assistant_message) || '')).digest('hex');
  const fresh = st.blocking_stops >= 2 ? [] : (candidates || []).filter((c) => c && c.kind && c.reason && !st.blocks[c.kind]);
  if (fresh.length) {
    for (const c of fresh) st.blocks[c.kind] = (st.blocks[c.kind] || 0) + 1;
    st.blocking_stops += 1;
  }
  let saved = true;
  try { fs.writeFileSync(file, `${JSON.stringify(st)}\n`); } catch (err) { saved = false; }
  if (!fresh.length || (active && !saved)) return null;
  return { reason: fresh.map((c) => c.reason).join('\n\n'), kinds: fresh.map((c) => c.kind) };
}

module.exports = { markTurnStart, readTurnStart, decideStop, composeStop, STOP_STATE };
