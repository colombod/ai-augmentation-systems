// scripts/lib/wake-ledger.js — the sender's record of each wake prompt (hb1.2).
// A watchdog wake reaches a role session in the same transcript shape as a prompt the operator types;
// only its opening words (WAKE_OPENING) differ, and the operator can type those too. So the watchdog
// writes one row here before it starts the wake: the hash of the exact prompt it sends, the session and
// the wake id. The capture hook counts a prompt as a wake only when a row here holds it; a prompt that
// opens with the same words and has no row is the operator's. Host-local, beside the wake log under the
// watchdog's git-ignored directory; rotated like it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REL = path.join('.delivery', 'watchdog');
const FILE = 'wake-ledger.ndjson';
const MAX_BYTES = 1024 * 1024;
// a wake prompt reaches the transcript seconds after its row; a row stands for this long, so a prompt
// typed later that repeats an old wake word for word is still the operator's
const BEFORE_MS = 5 * 60 * 1000; // clock skew between the row and the transcript stamp
const AFTER_MS = 2 * 60 * 60 * 1000; // the longest a wake can wait to start (WAKE_TIMEOUT_H)

const fileOf = (root) => path.join(root, REL, FILE);
const hashOf = (text) => crypto.createHash('sha256').update(String(text).trim()).digest('hex');

// Record each prompt a wake sends. Written before the wake starts, so the capture never reads the
// prompt before its row. Throws when it cannot write: a wake with no row would read as the operator.
function record(root, { at, instance, session, wakeId, prompts }) {
  const dir = path.join(root, REL);
  fs.mkdirSync(dir, { recursive: true });
  const ig = path.join(dir, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  const file = fileOf(root);
  try { if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`); } catch (err) { /* nothing to rotate */ }
  const rows = (prompts || []).filter((p) => typeof p === 'string' && p.trim())
    .map((p) => JSON.stringify({ at, instance: instance || null, session: session || null, wake_id: wakeId || null, sha256: hashOf(p) }));
  if (rows.length) fs.appendFileSync(file, `${rows.join('\n')}\n`);
  return rows.length;
}

// every ledger row, the rotated file first; a torn or foreign line is skipped
function ledgerRows(root) {
  const out = [];
  for (const f of [`${fileOf(root)}.1`, fileOf(root)]) {
    let body = '';
    try { body = fs.readFileSync(f, 'utf8'); } catch (err) { continue; }
    for (const line of body.split('\n')) {
      if (!line) continue;
      let row = null;
      try { row = JSON.parse(line); } catch (err) { /* torn */ }
      if (row && typeof row.sha256 === 'string') out.push(row);
    }
  }
  return out;
}

// Does a sender-side record hold this prompt, sent at most AFTER_MS before `timestamp`? The files are
// read once per matcher. A wake log row written before the ledger existed (it carries the prompt
// itself) counts too, so a wake in flight across the upgrade is not read as the operator.
function matcher(root) {
  const byHash = new Map();
  const logged = [];
  if (root) {
    for (const r of ledgerRows(root)) { if (!byHash.has(r.sha256)) byHash.set(r.sha256, []); byHash.get(r.sha256).push(r.at); }
    for (const r of require('./watchdog.js').logRows(root)) if (r.type === 'wake' && typeof r.prompt === 'string' && r.prompt.trim()) logged.push(r);
  }
  const inWindow = (at, timestamp) => {
    const a = Date.parse(at);
    const t = Date.parse(timestamp);
    if (!Number.isFinite(a)) return false;
    if (!Number.isFinite(t)) return true; // a record with no stamp: the hash alone decides
    return t >= a - BEFORE_MS && t <= a + AFTER_MS;
  };
  return (text, timestamp) => {
    if ((byHash.get(hashOf(text)) || []).some((at) => inWindow(at, timestamp))) return true;
    // the wake log keeps the prompt as planned; a fresh session's preamble goes after its opening
    // words, so the planned prompt is matched whole, or by what follows its opening
    const body = String(text).trim();
    return logged.some((r) => {
      const planned = r.prompt.trim();
      const rest = planned.slice(planned.indexOf(':') + 1).trim();
      return inWindow(r.at, timestamp) && (body === planned || (rest.length > 40 && body.endsWith(rest)));
    });
  };
}

module.exports = { FILE, fileOf, hashOf, record, matcher, BEFORE_MS, AFTER_MS };
