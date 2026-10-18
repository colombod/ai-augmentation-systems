// scripts/lib/warnings.js — the warnings ledger: what a gate let through, counted, visible and owned.
//
// A gate that does not block (ruling 3: everything short of a listed divergence or an authority rule)
// records a warning here. Append-only: one file per instance under <project>/.delivery/warnings/, so
// sessions on different hosts never write the same file and the files merge cleanly in git. An
// acknowledgement is a second row naming the warning's id; nothing is ever rewritten. Only the
// Delivery Manager acknowledges (warnings.js ack checks the role; the lane gives it the command).
const fs = require('fs');
const path = require('path');

const OVERDUE_HOURS = 24;
const INSTANCE = /^[a-z0-9][a-z0-9-]*$/;

function dirOf(root) { return path.join(root, '.delivery', 'warnings'); }
const instanceOf = (x) => (INSTANCE.test(String(x || '')) ? String(x) : 'local');

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

// Record a warning; an open warning of the same kind on the same bead is not repeated (a retried claim
// must not turn one finding into ten). Returns the warning row (new or existing). Never throws.
function record(root, { kind, rule, bead, detail, raisedBy, instance, now } = {}) {
  try {
    if (!root || !kind) return null;
    const open = list(root).find((w) => !w.acked_by && w.kind === kind && (w.bead || null) === (bead || null));
    if (open) return open;
    const inst = instanceOf(instance);
    const n = rowsOf(path.join(dirOf(root), `${inst}.ndjson`)).filter((r) => r.type === 'warning').length + 1;
    const row = { type: 'warning', id: `w-${inst}-${n}`, kind, rule: rule || null, bead: bead || null, detail: String(detail || '').slice(0, 500), raised_by: raisedBy || inst, at: now || new Date().toISOString() };
    append(root, inst, row);
    return row;
  } catch (err) { return null; }
}

// { ok, row } or { ok: false, error }
function ack(root, { id, reason, by, instance, now } = {}) {
  if (!reason || !String(reason).trim()) return { ok: false, error: 'an acknowledgement needs --reason' };
  const w = list(root).find((x) => x.id === id);
  if (!w) return { ok: false, error: `no warning ${id}` };
  if (w.acked_by) return { ok: false, error: `${id} was acknowledged by ${w.acked_by} at ${w.acked_at}` };
  const row = { type: 'ack', id, acked_by: by, acked_at: now || new Date().toISOString(), reason: String(reason).slice(0, 500) };
  append(root, instance, row);
  return { ok: true, row };
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

module.exports = { record, ack, list, summary, dirOf, OVERDUE_HOURS };
