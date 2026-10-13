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

// A new prompt starts a new turn. The session's stop state is cleared; a first stop would reset it
// anyway, so this only tidies up.
function markTurnStart(roleDir, now, sessionId) {
  try { fs.writeFileSync(path.join(roleDir, '.delivery-turn'), `${toSecond(now)}\n`); } catch (err) { /* ignore */ }
  if (sessionId) { try { fs.rmSync(stopStateFile(roleDir, sessionId), { force: true }); } catch (err) { /* ignore */ } }
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

// Joins every applicable stop reason into one block, limited per turn and per session so a stop
// always ends:
// - each kind (unrecorded, integrity, relay, claim, ...) blocks at most LIMITS[kind] times per turn
//   (default once; relay twice, the second time quoting the clause);
// - at most two stops per turn block; the third always passes.
// State is per session (input.session_id) in its own file, written atomically. A first stop
// (stop_hook_active false) starts a fresh state. On a continuation, a missing, unreadable or
// foreign state counts as exhausted and the stop passes, and so does a state that cannot be saved.
// candidates: [{ kind, reason, detail? }]. Returns null or { reason, kinds }.
const LIMITS = { relay: 2 };
const MAX_BLOCKING_STOPS = 2;

function stopStateFile(roleDir, sessionId) {
  const key = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return path.join(roleDir, `${STOP_STATE.replace(/\.json$/, '')}-${key}.json`);
}

function readStopState(file, sessionId) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!st || typeof st !== 'object' || st.session_id !== sessionId || !st.blocks || typeof st.blocks !== 'object'
      || !Number.isInteger(st.blocking_stops) || st.blocking_stops < 0) return null;
    return st;
  } catch (err) { return null; }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (e) { /* ignore */ }
    return false;
  }
}

// sessionId is a fallback for callers whose input carries no session_id; the hook input wins. It is
// never .delivery-session, which capture rewrites on every stop of any session in the role dir.
function composeStop({ input, roleDir, candidates, sessionId: fallbackSession }) {
  const active = !!(input && input.stop_hook_active);
  const sessionId = (input && typeof input.session_id === 'string' && input.session_id)
    || (typeof fallbackSession === 'string' && fallbackSession) || 'unknown';
  const file = stopStateFile(roleDir, sessionId);
  let st;
  if (active) {
    st = readStopState(file, sessionId);
    if (!st) return null; // nothing trustworthy about this turn: exhausted
  } else {
    st = { session_id: sessionId, turn: readTurnStart(roleDir), blocks: {}, blocking_stops: 0 };
  }
  st.last_message_hash = crypto.createHash('sha256').update(String((input && input.last_assistant_message) || '')).digest('hex');
  const fresh = st.blocking_stops >= MAX_BLOCKING_STOPS ? []
    : (candidates || []).filter((c) => c && c.kind && c.reason && (Number(st.blocks[c.kind]) || 0) < (LIMITS[c.kind] || 1));
  const reasons = fresh.map((c) => {
    const seen = Number(st.blocks[c.kind]) || 0;
    return seen > 0 && c.detail ? `${c.reason} You wrote: "${String(c.detail).slice(0, 160)}".` : c.reason;
  });
  if (fresh.length) {
    for (const c of fresh) st.blocks[c.kind] = (Number(st.blocks[c.kind]) || 0) + 1;
    st.blocking_stops += 1;
  }
  const saved = writeAtomic(file, `${JSON.stringify(st)}\n`);
  if (!fresh.length || !saved) return null;
  return { reason: reasons.join('\n\n'), kinds: fresh.map((c) => c.kind) };
}

module.exports = { markTurnStart, readTurnStart, decideStop, composeStop, stopStateFile, STOP_STATE };
