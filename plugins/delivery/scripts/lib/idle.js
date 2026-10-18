// scripts/lib/idle.js — idle with ready work is a defect (R-43).
//
// In the Vault the team sat idle for 4 days after the weekly usage reset (10-13 to 10-17) and GW1 for
// 4.5 hours waiting for a bead; nothing noticed. The team is idle when ready work exists, nothing is in
// progress, the last bead activity is older than idle_minutes (30; the owner may change it on the goal
// sheet), and no pause holds (a pause counts only while its owner record verifies or its andon is open).
// "Waiting for the owner" excuses a ready bead only when an open owner-queue step names it.
const W = require('./warnings.js');

const stamp = (b) => Math.max(...['closed_at', 'updated_at', 'created_at'].map((k) => Date.parse(b && b[k])).filter((t) => !Number.isNaN(t)), -Infinity);

// { idle, since?, minutes?, ready?, paused?, why? }
function idleState({ beads = [], ready = [], now, idleMinutes = 30, pause = { paused: false }, openSteps = [] }) {
  if (beads.some((b) => b && b.status === 'in_progress')) return { idle: false, why: 'in-progress' };
  const owners = new Set(openSteps.map((s) => s && s.bead).filter(Boolean));
  const work = ready.filter((b) => b && b.id && !owners.has(b.id) && b.status !== 'closed');
  if (!work.length) return { idle: false, why: ready.length ? 'waiting-owner' : 'no-ready-work' };
  const last = Math.max(...[...beads, ...ready].map(stamp));
  const t = Date.parse(now || new Date().toISOString());
  const minutes = Number.isFinite(last) ? Math.floor((t - last) / 60000) : Infinity;
  if (minutes <= idleMinutes) return { idle: false, why: 'recent' };
  if (pause.paused) return { idle: false, why: 'paused', paused: pause.by };
  return { idle: true, since: Number.isFinite(last) ? new Date(last).toISOString() : null, minutes, ready: work.map((b) => b.id) };
}

const hours = (m) => (m === Infinity ? 'a long time' : m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m} min`);

// One plain line for the top of the status and the plan, and the next step.
function idleLine(s) {
  return `Idle: ${s.ready.length} ready item${s.ready.length > 1 ? 's' : ''} and nothing in progress for ${hours(s.minutes)}, with no owner pause.\nThe Delivery Manager starts the next one now: bd ready.`;
}

// Records one warning per idle stretch (the detail names its start, so a re-check does not repeat it).
function recordIdle(root, s, { instance, now } = {}) {
  if (!s || !s.idle) return null;
  return W.record(root, { kind: 'idle', rule: 'R-43', detail: `ready work (${s.ready.slice(0, 3).join(', ')}) and nothing in progress since ${s.since || 'unknown'}`, raisedBy: instance, instance, now });
}

// Read the beads and the pause for a project; bd is a lib/bd.js store. Fails open (not idle).
function readIdle(root, { bd, now } = {}) {
  try {
    const Goal = require('./goal.js');
    const Q = require('./owner-queue.js');
    const beads = bd.list({ all: true });
    const ready = bd.ready();
    return idleState({ beads, ready, now, idleMinutes: Goal.value(root, 'idle_minutes'), pause: Goal.activePause(root, { beadOf: (id) => bd.show(id) }), openSteps: Q.open(root) });
  } catch (err) { return { idle: false, why: 'unreadable' }; }
}

module.exports = { idleState, idleLine, recordIdle, readIdle };
