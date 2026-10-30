// scripts/lib/handoff.js — the next step a record change hands to a role, for the watchdog to wake it.
// On a host with no scheduler a team stops for hours after a merge: the Delivery Manager's turn ends
// right after `merge-gate.js merged`, and the deploy, then the reality check, wait for the two-hour
// stall limit (lib/watchdog.js, the evidence stall) or for a loop someone keeps alive (dlv-4oj). The
// merge gate and the deploy record now queue the next owner's step here, and the watchdog wakes that
// role at its next pass under the message rules (five minutes apart), once per step: a row is handed
// over when its wake starts, and closed without a wake when the record already shows the step done
// (the bead deployed, its reality check created, the story verified or closed). Host-local, under the
// watchdog's git-ignored directory, like the inbox: the bead stays the record (team rule 5).
const fs = require('fs');
const path = require('path');
const { withLock } = require('./lock.js');

const REL = path.join('.delivery', 'watchdog');
const FILE = 'handoffs.ndjson';
const STEPS = ['deploy', 'check'];
const KEEP_MS = 7 * 24 * 3600e3;
const file = (root) => path.join(root, REL, FILE);
const lockOf = (root) => `${file(root)}.lock`;

function rows(root) {
  try { return fs.readFileSync(file(root), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter((r) => r && typeof r === 'object' && r.id); } catch (err) { return []; }
}
// The file is rewritten whole (rows change state), so every change runs under the lock, read to write,
// and lands by rename: the merge gate, the deploy record and a watchdog pass may write at the same
// moment, and a lost row is a story left to the two-hour stall, a lost mark a second wake for one step.
function write(root, list) {
  fs.mkdirSync(path.join(root, REL), { recursive: true });
  const ig = path.join(root, REL, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  const tmp = `${file(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, list.map((r) => JSON.stringify(r)).join('\n') + (list.length ? '\n' : ''));
  fs.renameSync(tmp, file(root));
}
const locked = (root, fn) => withLock(lockOf(root), fn, { strict: true });

// Queue one step for a role. The same step for the same bead and the same pull request (a deploy) or
// sha (a check) is queued once while it is open: a retry of `merge-gate.js merged` (it is retry-safe)
// adds nothing. An open row for another pull request or sha is stale (a new merge of the same story
// while its area was stopped, or while nobody could be woken): it is closed and the new one takes its
// place, so the wake names the current one. Returns the row, or null when nothing was added.
function queue(root, { bead, step, to, from, pr, sha, at }) {
  if (!bead || !STEPS.includes(step) || !to) return null;
  const now = at || new Date().toISOString();
  // a random suffix: two rows for one bead and step in the same second (another PR or sha) never share
  // an id, so marking one done or delivered cannot consume the other (Copilot, #86)
  const row = { id: `h-${bead}-${step}-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${require('crypto').randomBytes(3).toString('hex')}`, at: now, bead, step, to, from: from || null, pr: pr ? String(pr) : null, sha: sha || null };
  const same = (r) => (step === 'deploy' ? String(r.pr || '') === String(row.pr || '') : String(r.sha || '') === String(row.sha || ''));
  return locked(root, () => {
    const list = rows(root);
    const open = list.filter((r) => r.bead === bead && r.step === step && !r.delivered_at && !r.done_at);
    // a row already handed over (its wake started) and not yet closed counts too: a retry of
    // `merge-gate.js merged` after the wake started adds nothing (Copilot, #86)
    const live = list.filter((r) => r.bead === bead && r.step === step && !r.done_at);
    if (live.some(same)) return null;
    const kept = list.map((r) => (open.includes(r) ? { ...r, done_at: now, superseded_by: row.id } : r));
    // rows settled over a week ago go; the open ones stay whatever their age
    write(root, [...kept.filter((r) => !(r.done_at || r.delivered_at) || Date.parse(now) - Date.parse(r.done_at || r.delivered_at) < KEEP_MS), row]);
    return row;
  });
}

// the rows no wake has carried and no record has closed
const pending = (root) => rows(root).filter((r) => !r.delivered_at && !r.done_at);

function mark(root, ids, field, at) {
  const want = new Set(ids || []);
  if (!want.size) return;
  const now = at || new Date().toISOString();
  locked(root, () => write(root, rows(root).map((r) => (want.has(r.id) && !r[field] ? { ...r, [field]: now } : r))));
}
const markDelivered = (root, ids, at) => mark(root, ids, 'delivered_at', at);
const markDone = (root, ids, at) => mark(root, ids, 'done_at', at);

// Whether the record shows the step taken, from the bead as bd lists it and the beads list (for the
// reality-check child). A bead that cannot be found counts as done: there is nothing to wake for.
function done(row, bead, beads = []) {
  if (!bead) return true;
  const G = require('./gates.js');
  const st = G.stateOf(bead);
  if (bead.status === 'closed' || ['verified', 'cut'].includes(st)) return true;
  if (row.step === 'deploy') return st === 'deployed';
  // check: the reality check for the deployed sha exists (reality-check.js plan creates <bead>-rc-<sha7>)
  const sha = (bead.metadata && bead.metadata.deployed_sha) || row.sha;
  if (!sha) return false;
  const child = `${bead.id}-rc-${String(sha).slice(0, 7)}`;
  return beads.some((b) => b && b.id === child);
}

// what the woken role is told, with the exact commands of the step
function prompt(row, bead) {
  const b = row.bead;
  if (row.step === 'deploy') return `PR ${row.pr || '?'} is merged (${b}). Deploy it now and record it: evidence.js state ${b} deployed --sha <the live sha>; then dispatch its reality check (reality-check.js plan ${b}, and message the Reality Checker with the child's id) or record its evidence (evidence.js add ${b} ...).`;
  const sha = (bead && bead.metadata && bead.metadata.deployed_sha) || row.sha;
  return `${b} is deployed${sha ? ` at ${String(sha).slice(0, 7)}` : ''}. Dispatch its reality check now (reality-check.js plan ${b}, then message the Reality Checker with the child's id), or record its evidence (evidence.js add ${b} --criterion <n> --result pass --surface <id> --sha ${sha || '<sha>'} --run <ref>).`;
}

module.exports = { REL, FILE, STEPS, queue, pending, rows, markDelivered, markDone, done, prompt };
