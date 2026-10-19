// scripts/lib/watchdog.js — the stall alarm and the wake (R-04, R-43, R-25).
//
// In the Vault nothing woke the team for 4 days after the weekly usage reset (the owner typed "Try
// again" twice), a top-priority bead sat unclaimed 15.5 h overnight, and a watcher polled 30 pull
// requests every 90 s. This reads the record and finds the stalls:
//   idle   ready work and nothing in progress for more than idle_minutes, with no verified pause (lib/idle.js)
//   quiet  a bead in progress with no bead update and no activity of its holder's session for more
//          than stall_hours (an owner-set goal field, 2 by default)
//   p0     a top-priority (P0) bead open and unclaimed for more than an hour
//   limit  a role session whose transcript ends on a usage limit: the wake is due at the reset time
//          plus RESET_GRACE_MIN, and the plan says when the team resumes
// It never pauses or blocks anything: each stall is a plain line, a warning in the ledger and, for the
// wake (watchdog.js wake), a target session and its prompt. An owner pause that verifies silences it.
//
// The probe (phase 7) found one documented way for a host job to wake a stopped role session:
// `claude --resume <session-id> -p "<prompt>"` run in the role directory (its settings and hooks load;
// the conversation, model and permission mode are restored). A session still open in another process
// cannot be resumed in place; `--fork-session` continues a copy of it. Hooks, /loop and CronCreate live
// and die with their session, and cloud routines cannot reach a local session. The usage-limit row in a
// transcript (error "rate_limit", quotaLimits.resetsAt) is undocumented, so the reader fails open.
const fs = require('fs');
const path = require('path');
const W = require('./warnings.js');
const I = require('./idle.js');

const REL = path.join('.delivery', 'watchdog');
const P0_HOURS = 1;
const WAKE_EVERY_MS = 3600e3;
const RESET_GRACE_MIN = 5;
const TAIL_BYTES = 512 * 1024;
const MIN_POLL_S = 240;
const DM = 'delivery-lead';

const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };
const span = (m) => (m === Infinity ? 'a long time' : m >= 2880 ? `${(m / 1440).toFixed(1)} days` : m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.max(0, Math.round(m))} min`);
const clock = (t) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// ---- what a session transcript says: the last usage limit, and tight GitHub polling ----
function tailRows(file, bytes = TAIL_BYTES) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (err) { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (size > len) lines.shift();
    const out = [];
    for (const l of lines) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch (err) { /* a torn line */ } }
    return out;
  } finally { fs.closeSync(fd); }
}

const isLimit = (r) => r && r.type === 'assistant' && (r.error === 'rate_limit' || r.apiError === 'usage_limit_reached');
const textOf = (r) => { const c = r && r.message && r.message.content; return Array.isArray(c) ? c.map((b) => (b && b.text) || '').join(' ') : String(c || ''); };

// { at, resetsAt, window, text } when the transcript's last word is a usage limit; null otherwise.
function limitOf(rows) {
  if (!rows) return null;
  let i = rows.length - 1;
  while (i >= 0 && !isLimit(rows[i])) {
    // a real reply after the limit means the session went on
    if (rows[i].type === 'assistant' && !rows[i].isApiErrorMessage) return null;
    i--;
  }
  if (i < 0) return null;
  const r = rows[i];
  const q = r.quotaLimits || (r.apiErrorParams && r.apiErrorParams.rate_limit_info) || {};
  const reset = Number(q.resetsAt);
  return { at: r.timestamp || null, resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null, window: q.rateLimitType || null, text: textOf(r).slice(0, 120) };
}

// Bash or Monitor commands that poll gh in a loop faster than every MIN_POLL_S seconds.
const LOOP = /\b(?:while|until|for)\b[\s\S]*?\bgh\s[\s\S]*?\bsleep\s+(\d+)|\bwatch\b[^|;&]*?-n\s*(\d+)[\s\S]*?\bgh\s|\bgh\s+(?:run|pr)\s+(?:watch|checks)\b[^|;&]*?(?:-i|--interval)[ =](\d+)/;
function tightPolls(rows) {
  const out = [];
  for (const r of rows || []) {
    const c = r && r.type === 'assistant' && r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const b of c) {
      const cmd = b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string' ? b.input.command : null;
      const m = cmd && LOOP.exec(cmd);
      const every = m ? Number(m[1] || m[2] || m[3]) : NaN;
      if (Number.isFinite(every) && every < MIN_POLL_S) out.push({ at: r.timestamp || null, every, command: cmd.slice(0, 120) });
    }
  }
  return out;
}

// ---- the sessions on the roster, with their last activity and their transcript's word ----
function sessions(root, { team, rows = tailRows } = {}) {
  let roster = { instances: {} };
  try { roster = require('./roster.js').readRoster(root); } catch (err) { roster = { instances: {} }; }
  let roles = new Map();
  try { roles = new Map(require('./manifest.js').expandInstances(team || require('./manifest.js').loadManifest(root).team).map((i) => [i.instance, i.role])); } catch (err) { roles = new Map(); }
  return Object.entries(roster.instances || {}).map(([instance, e]) => {
    const t = e && typeof e.transcript_path === 'string' ? e.transcript_path : null;
    let mtime = -Infinity;
    if (t) { try { mtime = fs.statSync(t).mtimeMs; } catch (err) { mtime = -Infinity; } }
    const tail = t ? rows(t) : null;
    const role = roles.get(instance);
    return { instance, role: role ? role.id : null, retired: Boolean(role && role.retired), session: (e && e.session_id) || null, roleDir: (e && e.role_dir) || null, host: (e && e.host) || null,
      lastActive: Math.max(ms(e && e.last_seen), mtime), transcript: t, limit: limitOf(tail), polls: tightPolls(tail) };
  }).filter((s) => !s.retired);
}

// the session holding a bead: its assignee is the instance or an actor ending in /<instance>
function holderOf(b, list) {
  const a = String((b && b.assignee) || '');
  if (!a) return null;
  const inst = a.includes('/') ? a.split('/').pop() : a;
  return list.find((s) => s.instance === inst) || null;
}
const dmOf = (list, team) => {
  const s = list.find((x) => x.role === DM);
  if (s) return s.instance;
  try { const i = require('./manifest.js').expandInstances(team).find((x) => x.role.id === DM); return i ? i.instance : DM; } catch (err) { return DM; }
};

// ---- the stalls ----
// facts: { beads, ready, now, idleMinutes, stallHours, pause, openSteps, sessions, team }
// { paused?, stalls: [{ kind, key, bead?, target, line, detail, prompt, due, wakeAt? }] }
function stalls({ beads = [], ready = [], now, idleMinutes = 30, stallHours = 2, pause = { paused: false }, openSteps = [], sessions: list = [], team } = {}) {
  const t = ms(now || new Date().toISOString());
  if (pause && pause.paused) return { paused: pause.by || true, stalls: [] };
  const out = [];
  const dm = dmOf(list, team);
  const waiting = new Set(openSteps.map((s) => s && s.bead).filter(Boolean));
  // usage limits first: the rest of the team's quiet follows from them
  const limited = new Set();
  for (const s of list.filter((x) => x.limit && x.lastActive <= ms(x.limit.at) + 60e3)) {
    limited.add(s.instance);
    const reset = ms(s.limit.resetsAt);
    const wakeAt = Number.isFinite(reset) ? reset + RESET_GRACE_MIN * 60e3 : t;
    const held = beads.filter((b) => b.status === 'in_progress' && holderOf(b, [s])).map((b) => b.id);
    const due = t >= wakeAt;
    const what = `${s.instance} stopped on the ${s.limit.window ? `${s.limit.window.replace('_', '-')} ` : ''}usage limit at ${clock(ms(s.limit.at))}`;
    out.push({ kind: 'limit', key: `limit:${s.instance}:${s.limit.at}`, target: s.instance, due, wakeAt: new Date(wakeAt).toISOString(),
      line: Number.isFinite(reset) ? (due ? `Resume now: ${what}; it reset at ${clock(reset)}.` : `The team resumes at ${clock(wakeAt)}: ${what}, which resets at ${clock(reset)}.`) : `Resume now: ${what}; the reset time is not known, so the wake is tried each hour.`,
      detail: `${what}; resets ${s.limit.resetsAt || 'unknown'}`,
      plain: due || !Number.isFinite(reset) ? 'A session stopped on the usage limit is being restarted.' : `The team resumes at ${clock(wakeAt)}, when the usage limit resets.`,
      prompt: `The usage limit has reset. Continue where you stopped${held.length ? `: ${held.join(', ')} (bd show ${held[0]})` : ': bd ready'}.` });
  }
  const idle = I.idleState({ beads, ready, now, idleMinutes, pause, openSteps });
  if (idle.idle) {
    out.push({ kind: 'idle', key: `idle:${idle.since}`, target: dm, due: true, idle,
      line: I.idleLine(idle).split('\n')[0], plain: `Nobody is working although work is ready (for ${span(idle.minutes)}); the Delivery Manager starts it first.`, detail: `ready work (${idle.ready.slice(0, 3).join(', ')}) and nothing in progress since ${idle.since || 'unknown'}`,
      prompt: `Nothing is in progress although ${idle.ready.length} item${idle.ready.length > 1 ? 's are' : ' is'} ready (${idle.ready.slice(0, 3).join(', ')}). Start the next one now: bd ready, then assign it to a builder.` });
  }
  for (const b of beads.filter((x) => x && x.status === 'in_progress')) {
    const h = holderOf(b, list);
    if (h && limited.has(h.instance)) continue;
    const last = Math.max(ms(b.updated_at), ms(b.created_at), h ? h.lastActive : -Infinity);
    const minutes = (t - last) / 60000;
    if (minutes <= stallHours * 60) continue;
    const who = h ? h.instance : b.assignee || 'nobody named';
    out.push({ kind: 'quiet', key: `quiet:${b.id}:${Number.isFinite(last) ? new Date(last).toISOString() : 'never'}`, bead: b.id, target: h ? h.instance : dm, due: true,
      line: `Stalled: ${b.id} is in progress with ${who}, and nothing has moved for ${span(minutes)} (the limit is ${stallHours} h).`,
      plain: `A started item has not moved for ${span(minutes)}; its holder is asked to continue it.`,
      detail: `in progress with ${who}; no bead update or session activity since ${Number.isFinite(last) ? new Date(last).toISOString() : 'unknown'}`,
      prompt: h ? `${b.id} has not moved for ${span(minutes)}. Continue it now (bd show ${b.id}), or note in the bead what blocks it and tell the Delivery Manager.` : `${b.id} is in progress with ${who}, whose session is not on this host's roster, and has not moved for ${span(minutes)}: release or reassign it.` });
  }
  for (const b of beads.filter((x) => x && x.status === 'open' && Number(x.priority) === 0 && !x.assignee && !waiting.has(x.id))) {
    const minutes = (t - ms(b.created_at || b.updated_at)) / 60000;
    if (!(minutes > P0_HOURS * 60)) continue;
    out.push({ kind: 'p0', key: `p0:${b.id}`, bead: b.id, target: dm, due: true,
      line: `Unclaimed: top-priority ${b.id} has waited ${span(minutes)} for a claim.`,
      plain: `A top-priority item has waited ${span(minutes)} for someone to take it; the Delivery Manager assigns it first.`,
      detail: `P0 open and unclaimed since ${b.created_at || b.updated_at}`,
      prompt: `Top-priority ${b.id} has waited ${span(minutes)} unclaimed. Assign it to a builder now (bd show ${b.id}).` });
  }
  return { stalls: out };
}

// R-25: a role whose transcript shows gh polled in a loop faster than every 4 minutes
function pollWarnings(list) {
  return list.filter((s) => s.polls && s.polls.length).map((s) => ({ instance: s.instance, every: Math.min(...s.polls.map((p) => p.every)), count: s.polls.length,
    line: `Polling: ${s.instance} ran ${s.polls.length} gh polling loop${s.polls.length > 1 ? 's' : ''} every ${Math.min(...s.polls.map((p) => p.every))} s; use watch.js (at least every 4 min, with an exit and a time limit).` }));
}

const KIND = { idle: 'idle', quiet: 'stall', p0: 'p0-unclaimed', limit: 'usage-limit' };
function recordAll(root, res, polls, { now, instance = 'watchdog' } = {}) {
  for (const s of res.stalls) {
    if (s.kind === 'idle') I.recordIdle(root, s.idle, { now, instance });
    else W.record(root, { kind: KIND[s.kind], rule: 'R-04', bead: s.bead, detail: s.detail, raisedBy: instance, instance, now });
  }
  for (const p of polls) W.record(root, { kind: 'tight-poll', rule: 'R-25', detail: `${p.instance} polled gh every ${p.every} s`, raisedBy: instance, instance, now });
}

// Read the record for a project: beads from bd (a lib/bd.js store), the goal sheet, the owner queue,
// the roster and the transcripts. Fails open: a failed read gives no stalls and says so.
function read(root, { bd, now, team, rows } = {}) {
  try {
    const Goal = require('./goal.js');
    const Q = require('./owner-queue.js');
    const beads = bd.list({ all: true }) || [];
    const ready = bd.ready() || [];
    const beadOf = (id) => { try { return bd.show(id); } catch (err) { return null; } };
    const list = sessions(root, { team, rows });
    const res = stalls({ beads, ready, now, team, idleMinutes: Goal.value(root, 'idle_minutes'), stallHours: Goal.value(root, 'stall_hours'),
      pause: Goal.activePause(root, { beadOf, maxLookups: 4 }), openSteps: Q.open(root), sessions: list });
    return { ...res, polls: pollWarnings(list), sessions: list };
  } catch (err) { return { stalls: [], polls: [], sessions: [], unreadable: String(err.message).split('\n')[0] }; }
}

// ---- the wake log: what the watchdog did, append-only ----
const logFile = (root) => path.join(root, REL, 'wakes.ndjson');
function logRows(root) {
  try { return fs.readFileSync(logFile(root), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter(Boolean); } catch (err) { return []; }
}
function log(root, row) {
  fs.mkdirSync(path.join(root, REL), { recursive: true });
  // host-local: the log, the job's output and the wake logs stay out of git
  const ig = path.join(root, REL, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
  fs.appendFileSync(logFile(root), `${JSON.stringify(row)}\n`);
  return row;
}

// The wakes due now, one per target session, carrying every stall line for it. A stall is woken at most
// once an hour; a limit wake waits for its reset. { wakes: [{ target, keys, prompt }], waiting: [...] }
function plan(res, { root, now } = {}) {
  const t = ms(now || new Date().toISOString());
  const recent = logRows(root).filter((r) => r.type === 'wake' && t - ms(r.at) < WAKE_EVERY_MS);
  const woken = new Set(recent.flatMap((r) => r.keys || []));
  const by = new Map();
  const waiting = [];
  for (const s of res.stalls) {
    if (!s.due) { waiting.push(s); continue; }
    if (woken.has(s.key)) continue;
    const w = by.get(s.target) || { target: s.target, keys: [], lines: [], prompts: [] };
    w.keys.push(s.key); w.lines.push(s.line); w.prompts.push(s.prompt);
    by.set(s.target, w);
  }
  const wakes = [...by.values()].map((w) => ({ target: w.target, keys: w.keys, lines: w.lines, prompt: `Watchdog (a host job, not the owner): ${w.prompts.join(' ')} Reply in one line with what you started.` }));
  return { wakes, waiting };
}

// How to wake one session: resume it in place when it is not open, fork it when it is open and idle,
// leave it when it is busy, continue the role directory's latest conversation when no id is known.
// live: claude agents --json rows (null when unknown). { mode, args } or { skip }
function wakeCommand(s, prompt, live) {
  if (!s || !s.roleDir) return { skip: 'no session of this role on this host\'s roster' };
  if (!fs.existsSync(s.roleDir)) return { skip: `its role directory ${s.roleDir} is not on this host` };
  if (!s.session) return { mode: 'continue', args: ['-c', '-p', prompt] };
  const row = Array.isArray(live) ? live.find((r) => r && r.sessionId === s.session) : undefined;
  if (row && row.status === 'busy') return { skip: 'it is working (busy)' };
  // open and idle, or not known: a copy never collides with an open session
  if (row || live === null) return { mode: 'fork', args: ['--resume', s.session, '--fork-session', '-p', prompt] };
  return { mode: 'resume', args: ['--resume', s.session, '-p', prompt] };
}

module.exports = { REL, P0_HOURS, WAKE_EVERY_MS, RESET_GRACE_MIN, MIN_POLL_S, tailRows, limitOf, tightPolls, sessions, stalls, pollWarnings, recordAll, read, plan, wakeCommand, log, logRows, clock, span };
