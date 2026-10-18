// scripts/lib/warnings.js — the warnings ledger: what a gate let through, counted, visible and owned.
//
// A gate that does not block (ruling 3: everything short of a listed divergence or an authority rule)
// records a warning here. Append-only: one file per instance under <project>/.delivery/warnings/, so
// sessions on different hosts never write the same file and the files merge cleanly in git (a session
// with no role writes local-<host hash>.ndjson). An acknowledgement is a second row naming the
// warning's id; nothing is ever rewritten. Ids are unique without coordination (time plus random);
// the check for an open duplicate and the append run under a lock file so parallel hooks do not
// repeat one finding. Only the Delivery Manager acknowledges (warnings.js ack checks the role).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { withLock } = require('./lock.js');

const OVERDUE_HOURS = 24;
const INSTANCE = /^[a-z0-9][a-z0-9-]*$/;

function dirOf(root) { return path.join(root, '.delivery', 'warnings'); }
const hostTag = () => crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 8);
const instanceOf = (x) => (INSTANCE.test(String(x || '')) ? String(x) : `local-${hostTag()}`);
const newId = (inst) => `w-${inst}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

function rowsOf(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return []; }
  const out = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch (err) { /* a torn line is skipped */ }
  }
  return out;
}

function readRows(root) {
  let files = [];
  try { files = fs.readdirSync(dirOf(root)).filter((f) => f.endsWith('.ndjson')).sort(); } catch (err) { return []; }
  return files.flatMap((f) => rowsOf(path.join(dirOf(root), f)));
}

// Every warning with its acknowledgement folded in (acked_by, acked_at, ack_reason), oldest first.
function list(root) {
  const rows = readRows(root);
  const acks = new Map(rows.filter((r) => r.type === 'ack').map((r) => [r.id, r]));
  return rows.filter((r) => r.type === 'warning').map((w) => {
    const a = acks.get(w.id);
    return a ? { ...w, acked_by: a.acked_by, acked_at: a.acked_at, ack_reason: a.reason } : w;
  }).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function append(root, instance, row) {
  fs.mkdirSync(dirOf(root), { recursive: true });
  fs.appendFileSync(path.join(dirOf(root), `${instanceOf(instance)}.ndjson`), `${JSON.stringify(row)}\n`);
}

const locked = (root, fn) => withLock(path.join(dirOf(root), '.lock'), fn);

// Record a warning; an open warning with the same kind, bead and detail is not repeated (a retried
// claim must not turn one finding into ten). Returns the warning row (new or existing). Never throws.
function record(root, { kind, rule, bead, detail, raisedBy, instance, now } = {}) {
  try {
    if (!root || !kind) return null;
    const text = String(detail || '').slice(0, 500);
    return locked(root, () => {
      const open = list(root).find((w) => !w.acked_by && w.kind === kind && (w.bead || null) === (bead || null) && w.detail === text);
      if (open) return open;
      const inst = instanceOf(instance);
      const row = { type: 'warning', id: newId(inst), kind, rule: rule || null, bead: bead || null, detail: text, raised_by: raisedBy || inst, at: now || new Date().toISOString() };
      append(root, inst, row);
      return row;
    });
  } catch (err) { return null; }
}

// { ok, row } or { ok: false, error }
function ack(root, { id, reason, by, instance, now } = {}) {
  if (!reason || !String(reason).trim()) return { ok: false, error: 'an acknowledgement needs --reason' };
  return locked(root, () => {
    const w = list(root).find((x) => x.id === id);
    if (!w) return { ok: false, error: `no warning ${id}` };
    if (w.acked_by) return { ok: false, error: `${id} was acknowledged by ${w.acked_by} at ${w.acked_at}` };
    const row = { type: 'ack', id, acked_by: by, acked_at: now || new Date().toISOString(), reason: String(reason).slice(0, 500) };
    append(root, instance, row);
    return { ok: true, row };
  });
}

// Acknowledge the open warnings on a bead whose kind is in `kinds` and whose detail is not in `still`
// (what the check found again): a fixed story clears its own warnings. Returns the ids resolved.
function resolve(root, { bead, kinds, still = [], by, instance, reason, now } = {}) {
  const done = [];
  for (const w of list(root)) {
    if (w.acked_by || w.bead !== bead || !kinds.includes(w.kind) || still.includes(w.detail)) continue;
    if (ack(root, { id: w.id, reason, by, instance, now }).ok) done.push(w.id);
  }
  return done;
}

// Counts per kind, the open ones, and those open longer than 24 h (they go to the top of the plan).
function summary(warnings, now) {
  const t = Date.parse(now || new Date().toISOString());
  const open = warnings.filter((w) => !w.acked_by);
  const byKind = {};
  for (const w of open) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
  const overdue = open.filter((w) => t - Date.parse(w.at) > OVERDUE_HOURS * 3600e3);
  return { total: warnings.length, open: open.length, acked: warnings.length - open.length, byKind, overdue };
}

module.exports = { record, ack, resolve, list, summary, dirOf, instanceOf, OVERDUE_HOURS };
