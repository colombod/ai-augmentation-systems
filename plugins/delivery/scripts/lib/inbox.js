// scripts/lib/inbox.js — messages for a role whose session is not running.
// A role session that sends to another one gets "No agent named '<x>' is reachable" when that session
// is not running (measured 2026-10-25: a launched team's sessions run one turn at a time, so between
// turns every send failed and the message was lost; the sender then had nobody to tell). The SendMessage
// hook keeps such a message here, and the watchdog wakes its target with it (lib/watchdog.js, kind
// 'message'). Host-local, under the watchdog's git-ignored directory: messages are between sessions on
// this host, and the bead stays the record (team rule 5).
const fs = require('fs');
const path = require('path');

const REL = path.join('.delivery', 'watchdog', 'inbox');
const MAX_TEXT = 1200;
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '_');
const file = (root, to) => path.join(root, REL, `${safe(to)}.ndjson`);
const mark = (root, to) => path.join(root, REL, `${safe(to)}.delivered`);

function queue(root, { to, from, summary, message, at }) {
  if (!to) return false;
  const dir = path.join(root, REL);
  fs.mkdirSync(dir, { recursive: true });
  const ig = path.join(root, '.delivery', 'watchdog', '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  fs.appendFileSync(file(root, to), `${JSON.stringify({ at: at || new Date().toISOString(), from: from || null, summary: summary ? String(summary).slice(0, 200) : null, message: String(message || '').slice(0, MAX_TEXT) })}\n`);
  return true;
}

function delivered(root, to) {
  try { return Number(fs.readFileSync(mark(root, to), 'utf8').trim()) || 0; } catch (err) { return 0; }
}

// [{ to, entries, upTo }] for every role with messages not yet handed over; upTo is the count to mark
function pending(root) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, REL)).filter((f) => f.endsWith('.ndjson')); } catch (err) { return []; }
  const out = [];
  for (const f of names) {
    const to = f.replace(/\.ndjson$/, '');
    let rows = [];
    try { rows = fs.readFileSync(path.join(root, REL, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter(Boolean); } catch (err) { continue; }
    const from = delivered(root, to);
    if (rows.length > from) out.push({ to, entries: rows.slice(from), upTo: rows.length });
  }
  return out;
}

function markDelivered(root, to, upTo) {
  fs.mkdirSync(path.join(root, REL), { recursive: true });
  fs.writeFileSync(mark(root, to), `${Math.max(upTo, delivered(root, to))}\n`);
}

// the send failed because its target is not running: the name it was sent to, or null
function unreachableTarget(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response || '');
  const m = /No agent named \\?['"]([^'"\\]+)\\?['"] is reachable/.exec(text);
  return m ? m[1] : null;
}

// Who a message sent to `name` is for. A role session once sent to "steward" (a duty some roles have,
// team.json `steward: true`, not a session name) and to a misspelt role: the message was kept under that
// name, the watchdog found no session for it at every run, and nobody ever read it.
// -> { to, via } for a role instance on the team ("steward" is this host's steward role), or
//    { unknown: true, names } when no instance on the team answers to it
function resolveTarget(team, name, host) {
  const M = require('./manifest.js');
  const active = M.expandInstances(team || {}).filter((i) => !(i.role && i.role.retired));
  const names = active.map((i) => i.instance);
  const want = M.canonicalRoleId(String(name || '').trim());
  if (want === 'steward') {
    const s = active.find((i) => i.role && i.role.steward && (!host || i.role.host === host));
    return s ? { to: s.instance, via: 'steward' } : { unknown: true, names };
  }
  return names.includes(want) ? { to: want, via: null } : { unknown: true, names };
}

module.exports = { REL, queue, pending, markDelivered, delivered, unreachableTarget, resolveTarget };
