// scripts/lib/watchdog.js — the stall alarm and the wake (R-04, R-43, R-25).
//
// In the Vault nothing woke the team for 4 days after the weekly usage reset (the owner typed "Try
// again" twice), a top-priority bead sat unclaimed 15.5 h overnight, and a watcher polled 30 pull
// requests every 90 s. This reads the record and finds the stalls:
//   idle   ready work and nothing in progress for more than idle_minutes, with no verified pause (lib/idle.js)
//   quiet  a bead in progress with no bead update and no activity of its holder's session for more
//          than stall_hours (an owner-set goal field, 2 by default), unless the holder is inside a
//          watch.js wait within its declared limit
//   p0     a top-priority (P0) bead ready (open, not blocked, not an epic) and unclaimed for over an hour
//   limit  a role session whose transcript ends on a usage limit: the wake is due at the reset time
//          plus RESET_GRACE_MIN, and the plan says when the team resumes (only if the job is installed)
// Beads in an area stopped on a failed check (an open andon) wait for their fix and raise no stall. It
// never pauses or blocks anything: each stall is a plain line, a warning in the ledger and, for the
// wake (watchdog.js wake), a target session and its prompt. An owner pause that verifies silences it all.
//
// The probe (phase 7) found one documented way for a host job to wake a stopped role session:
// `claude --resume <session-id> -p "<prompt>"` run in the role directory (its settings and hooks load;
// the conversation and model are restored; the permission mode is not, so the wake passes the team's). A session still open in another process
// cannot be resumed in place; `--fork-session` continues a copy of it. Hooks, /loop and CronCreate live
// and die with their session, and cloud routines cannot reach a local session. The usage-limit row in a
// transcript (error "rate_limit", quotaLimits.resetsAt) is undocumented, so the reader fails open.
//
// The wake is bounded: one wake per session per hour whatever the stalls, at most DAILY_CAP a day, each
// stall retried with a doubling wait (1, 2, 4 h ...), never while the session's last wake still runs,
// never before its own usage limit resets; past that the stall stays an alarm only.
const fs = require('fs');
const path = require('path');
const W = require('./warnings.js');
const I = require('./idle.js');

const REL = path.join('.delivery', 'watchdog');
const P0_HOURS = 1;
const WAKE_EVERY_MS = 3600e3;
const DAILY_CAP = 6;
// a waiting message wakes its target sooner and more often than a stall does: it is the team's handoff
const MESSAGE_EVERY_MS = 5 * 60e3;
const MESSAGE_DAILY_CAP = 48;
const RESET_GRACE_MIN = 5;
const TAIL_BYTES = 512 * 1024;
const MIN_POLL_S = 240;
// a wake runs under a supervisor (lib/wake-run.js) that stops its process group after WAKE_TIMEOUT_H and
// lives until the group is gone; the guard holds while that supervisor lives, whatever the clock says
const WAKE_TIMEOUT_H = 2;
const LOG_MAX_BYTES = 1 << 20;
const DM = 'delivery-lead';

const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };
const span = (m) => (m === Infinity ? 'a long time' : m >= 2880 ? `${(m / 1440).toFixed(1)} days` : m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.max(0, Math.round(m))} min`);
// owner-facing times: the host's local time with its zone (TZ decides), as 2026-10-17 16:06 BST
function clock(t) {
  if (!Number.isFinite(t)) return 'an unknown time';
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
  } catch (err) { return 'an unknown time'; }
}

// ---- what a session transcript says: the last usage limit, a watch.js wait, tight GitHub polling ----
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
    // a torn, null or non-object line is skipped: one bad line never silences the watchdog
    for (const l of lines) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r); } catch (err) { /* skipped */ } }
    return out;
  } catch (err) { return null; } finally { fs.closeSync(fd); }
}

const isLimit = (r) => r && r.type === 'assistant' && (r.error === 'rate_limit' || r.apiError === 'usage_limit_reached');
const textOf = (r) => { const c = r && r.message && r.message.content; return Array.isArray(c) ? c.map((b) => (b && b.text) || '').join(' ') : String(c || ''); };
// epoch seconds, or milliseconds written by a newer client: an ISO time, or null when out of range
function resetIso(v) {
  let n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e11) n /= 1000;
  const t = n * 1000;
  return t < Date.parse('2020-01-01') || t > Date.parse('2100-01-01') ? null : new Date(t).toISOString();
}

// The context the session's last turn carried (input, cache read and cache written, from the usage
// Claude Code records on each reply), or null when the tail shows none. Every resume reloads the whole
// conversation, so this is what the next wake would carry too.
function contextOf(rows) {
  if (!Array.isArray(rows)) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const u = rows[i] && rows[i].type === 'assistant' && rows[i].message && rows[i].message.usage;
    if (u && typeof u === 'object') {
      const n = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
      if (n > 0) return n;
    }
  }
  return null;
}

// { at, resetsAt, window, text } when the transcript's last word is a usage limit; null otherwise.
function limitOf(rows) {
  if (!Array.isArray(rows)) return null;
  let i = rows.length - 1;
  while (i >= 0 && !isLimit(rows[i])) {
    // a real reply after the limit means the session went on
    if (rows[i] && rows[i].type === 'assistant' && !rows[i].isApiErrorMessage) return null;
    i--;
  }
  if (i < 0) return null;
  const r = rows[i];
  const q = r.quotaLimits || (r.apiErrorParams && r.apiErrorParams.rate_limit_info) || {};
  return { at: r.timestamp || null, resetsAt: resetIso(q.resetsAt), window: q.rateLimitType || null, text: textOf(r).slice(0, 120) };
}

const toolUses = (rows) => (rows || []).flatMap((r) => (r && r.type === 'assistant' && r.message && Array.isArray(r.message.content) ? r.message.content : [])
  .filter((b) => b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string').map((b) => ({ id: b.id, command: b.input.command, at: r.timestamp })));
const resultIds = (rows) => new Set((rows || []).flatMap((r) => (r && r.type === 'user' && r.message && Array.isArray(r.message.content) ? r.message.content : []).filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id)));

// The end of a watch.js wait still running (its result not written yet), or -Infinity.
function waitingUntil(rows) {
  const done = resultIds(rows);
  let until = -Infinity;
  for (const u of toolUses(rows)) {
    if (!/\bwatch\.js['"]?\s+until\b/.test(u.command) || (u.id && done.has(u.id))) continue;
    const m = /--max\s+(\d+(?:\.\d+)?)(s|m|h)?\b/.exec(u.command);
    if (m) until = Math.max(until, ms(u.at) + Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] || 's'] * 1000);
  }
  return until;
}

// A shell loop that itself calls gh (in its condition or body) and sleeps less than MIN_POLL_S, `watch -n N gh ...`, or gh's own
// --watch/--interval polling. A loop that only runs gh once after it ends is not polling.
const LOOP_BODY = /\b(?:while|until|for)\b([\s\S]*?)\bdone\b/g;
function pollEvery(cmd) {
  let m;
  LOOP_BODY.lastIndex = 0;
  while ((m = LOOP_BODY.exec(cmd))) {
    const s = /\bsleep\s+(\d+(?:\.\d+)?)([smhd])?\b/.exec(m[1]);
    if (s && /(?:^|[\s;|&(])gh\s+\w/.test(m[1])) return Number(s[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[s[2] || 's'];
  }
  const w = /(?:^|[;&|(]\s*)watch\s+(?:-\w+\s+)*-n\s*(\d+)\s[^;&|]*\bgh\s/.exec(cmd);
  if (w) return Number(w[1]);
  const g = /\bgh\s+(?:run|pr)\s+(?:watch|checks)\b[^;&|]*?(?:-i|--interval)[ =](\d+)/.exec(cmd);
  if (g) return Number(g[1]);
  if (/\bgh\s+pr\s+checks\b[^;&|]*\s--watch\b/.test(cmd)) return 10;
  // gh's own default intervals: `run watch` 3 s
  if (/\bgh\s+run\s+watch\b/.test(cmd)) return 3;
  return NaN;
}
// Quoted text is an argument, not a loop (`echo "while ... done"`), unless a shell runs it (`bash -c '...'`).
const executed = (cmd) => String(cmd).replace(/(\b(?:bash|sh|zsh|dash|ksh)\s+(?:-\w+\s+)*-\w*c\w*\s+)?('[^']*'|"(?:[^"\\]|\\.)*")/g, (m, sh, q) => (sh ? `${sh}${q.slice(1, -1)}` : ' '));
function tightPolls(rows) {
  return toolUses(rows).map((u) => ({ at: u.at || null, every: pollEvery(executed(u.command)), command: u.command.slice(0, 120) })).filter((p) => Number.isFinite(p.every) && p.every < MIN_POLL_S);
}

// ---- the sessions on the roster, with their last activity and their transcript's word ----
function sessions(root, { team, rows = tailRows } = {}) {
  let roster = { instances: {} };
  try { roster = require('./roster.js').readRoster(root); } catch (err) { roster = { instances: {} }; }
  let roles = new Map();
  try { roles = new Map(require('./manifest.js').expandInstances(team || require('./manifest.js').loadManifest(root).team).map((i) => [i.instance, i.role])); } catch (err) { roles = new Map(); }
  return Object.entries(roster.instances || {}).map(([instance, e]) => {
    const role = roles.get(instance);
    const base = { instance, role: role ? role.id : null, retired: Boolean(role && role.retired), session: (e && e.session_id) || null, roleDir: (e && e.role_dir) || null, host: (e && e.host) || null };
    // one session's unreadable transcript costs only its own reading
    // the owner's primary session routes the wake; its watchdog forks (a day at most) count for the
    // activity and the quota state, so a fork on the usage limit holds the next wake too (Copilot 092);
    // activity in any of them after the limit row clears it (stalls() compares lastActive with it)
    try {
      const t = e && typeof e.transcript_path === 'string' ? e.transcript_path : null;
      const forks = (Array.isArray(e && e.forks) ? e.forks : []).map((f) => f && f.transcript_path).filter((p) => typeof p === 'string' && p);
      let lastActive = ms(e && e.last_seen);
      let limit = null;
      let waitUntil = -Infinity;
      const polls = [];
      let context = null;
      for (const f of [t, ...forks].filter(Boolean)) {
        try { lastActive = Math.max(lastActive, fs.statSync(f).mtimeMs); } catch (err) { /* not on disk */ }
        const tail = rows(f);
        const l = limitOf(tail);
        if (l && (!limit || ms(l.at) > ms(limit.at))) limit = l;
        waitUntil = Math.max(waitUntil, waitingUntil(tail));
        if (f === t) { polls.push(...tightPolls(tail)); context = contextOf(tail); }
      }
      return { ...base, lastActive, transcript: t, forks, limit, waitUntil, polls, context };
    } catch (err) { return { ...base, lastActive: ms(e && e.last_seen), transcript: null, limit: null, waitUntil: -Infinity, polls: [] }; }
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
const typeOf = (b) => b.type || b.issue_type || null;

// ---- the stalls ----
// facts: { beads, ready, now, idleMinutes, stallHours, pause, openSteps, sessions, team, installed }
// { paused?, stalls: [{ kind, key, bead?, target, line, plain, detail, prompt, due, scheduled?, wakeAt? }] }
function stalls({ beads = [], ready = [], now, idleMinutes = 30, stallHours = 2, pause = { paused: false }, openSteps = [], sessions: list = [], team, installed = true, messages = [], handoffs = [] } = {}) {
  const t = ms(now || new Date().toISOString());
  if (pause && pause.paused) return { paused: pause.by || true, stalls: [] };
  const out = [];
  const dm = dmOf(list, team);
  const waiting = new Set(openSteps.map((s) => s && s.bead).filter(Boolean));
  const G = require('./gates.js');
  const stopped = new Set(((pause && pause.stops) || []).map((s) => s.area).filter(Boolean));
  const inStop = (b) => stopped.size > 0 && stopped.has(G.areaOf(b));
  // the recovery work of a stop goes on in its area (lib/andon.js claimFindings, D3c): the failed bead
  // or its story, a fix linked to the failed row or bead, its A3's work. Read from the trigger
  // (andon:ev-<bead>-<n>), since a stop carries only its trigger and area here.
  const recovering = (b) => ((pause && pause.stops) || []).filter((s) => s.area === G.areaOf(b)).some((s) => {
    const row = String(s.trigger || '').replace(/^andon:/, '');
    const failed = (/^ev-(.+)-\d+$/.exec(row) || [])[1];
    const m = b.metadata || {};
    const link = String(m.fixes || '').replace(/\s+#.*$/, '').trim();
    // a fix may name the failed story by its story id, as the claim check accepts (lib/andon.js s.story)
    const failedBead = beads.find((x) => x && x.id === failed);
    const story = String(((failedBead || {}).metadata || {}).story || '');
    return Boolean(failed) && (b.id === failed || b.parent === failed || [row, failed].includes(link) || (Boolean(story) && link === story) || Boolean(s.a3 && m.a3 && String(m.a3) === s.a3));
  });
  // usage limits first: the rest of the team's quiet follows from them
  const limited = new Set();
  for (const s of list.filter((x) => x.limit && x.lastActive <= ms(x.limit.at) + 60e3)) {
    limited.add(s.instance);
    const reset = ms(s.limit.resetsAt);
    const known = Number.isFinite(reset);
    const wakeAt = known ? reset + RESET_GRACE_MIN * 60e3 : t;
    const held = beads.filter((b) => b.status === 'in_progress' && holderOf(b, [s])).map((b) => b.id);
    // due from the reset alone: an operator's own `watchdog.js wake` works without the job (Copilot 118);
    // the job only decides whether the plan may promise the restart
    const due = t >= wakeAt;
    const scheduled = installed && known && !due;
    const what = `${s.instance} stopped on the ${s.limit.window ? `${s.limit.window.replace('_', '-')} ` : ''}usage limit at ${clock(ms(s.limit.at))}`;
    let line;
    let plain;
    if (!installed) {
      line = due ? `Resume now: ${what}${known ? `; it reset at ${clock(reset)}` : ''}; the watchdog is not installed, so only an operator's watchdog.js wake restarts it.`
        : `Stalled: ${what}${known ? `; it resets at ${clock(reset)}` : ''}; the watchdog is not installed, so nothing restarts it (watchdog.js install).`;
      plain = `The team is stalled; the watchdog is not installed${known ? `: the usage limit resets at ${clock(reset)}` : ''}.`;
    } else if (scheduled) {
      line = `The team resumes at ${clock(wakeAt)}: ${what}, which resets at ${clock(reset)} (restart scheduled).`;
      plain = `The team resumes at ${clock(wakeAt)}, when the usage limit resets (restart scheduled).`;
    } else {
      line = known ? `Resume now: ${what}; it reset at ${clock(reset)}.` : `Resume now: ${what}; the reset time is not known, so the wake is retried with a doubling wait.`;
      plain = 'A session stopped on the usage limit is being restarted.';
    }
    // the key and the detail stay the same while the limit holds, however often a wake is rejected again
    out.push({ kind: 'limit', key: `limit:${s.instance}:${s.limit.resetsAt || 'unknown'}`, target: s.instance, due, scheduled, wakeAt: new Date(wakeAt).toISOString(), line, plain,
      detail: `${s.instance} stopped on the usage limit; resets ${s.limit.resetsAt || 'unknown'}`,
      prompt: `The usage limit has reset. Continue where you stopped${held.length ? `: ${held.join(', ')} (bd show ${held[0]})` : ': bd ready'}.` });
  }
  const idle = I.idleState({ beads, ready, now, idleMinutes, pause, openSteps });
  if (idle.idle) {
    out.push({ kind: 'idle', key: `idle:${idle.since}`, target: dm, due: true, idle,
      line: I.idleLine(idle).split('\n')[0], plain: `Nobody is working although work is ready (for ${span(idle.minutes)}); the Delivery Manager starts it first.`, detail: `ready work (${idle.ready.slice(0, 3).join(', ')}) and nothing in progress since ${idle.since || 'unknown'}`,
      prompt: `Nothing is in progress although ${idle.ready.length} item${idle.ready.length > 1 ? 's are' : ' is'} ready (${idle.ready.slice(0, 3).join(', ')}). Start the next one now: bd ready, then assign it to a builder.` });
  }
  // A story merged or deployed waits on its evidence rows, which other roles record (the Delivery
  // Manager deploys, dispatches the reality check, records evidence): its builder has nothing to
  // continue, and waking it every two hours spent its whole daily wake budget (dlv-2et). Such a story
  // goes to the Delivery Manager, keyed on the bead alone so the builder's own activity cannot renew
  // it: the key holds still, so its retries back off (1 h, 2 h, 4 h) like every stall's. Verified or cut stories stay with their holder: closing them is its job.
  const waitingEvidence = (b) => ['merged', 'deployed'].includes(G.stateOf(b));
  for (const b of beads.filter((x) => x && x.status === 'in_progress' && !inStop(x) && waitingEvidence(x))) {
    const last = Math.max(ms(b.updated_at), ms(b.created_at));
    const minutes = (t - last) / 60000;
    if (!(minutes > stallHours * 60)) continue;
    const st = G.stateOf(b);
    out.push({ kind: 'quiet', key: `evidence:${b.id}:${Number.isFinite(last) ? new Date(last).toISOString() : 'never'}`, bead: b.id, target: dm, due: true,
      line: `Waiting on evidence: ${b.id} is ${st} and nothing has moved for ${span(minutes)}.`,
      plain: `A shipped item has waited ${span(minutes)} to be checked on the customer's app; the Delivery Manager moves it.`,
      detail: `${st}; no bead update since ${Number.isFinite(last) ? new Date(last).toISOString() : 'unknown'}`,
      prompt: `${b.id} is ${st} and has not moved for ${span(minutes)}. Take its next step now: ${st === 'merged' ? 'deploy it and record it (evidence.js state deployed)' : 'dispatch its reality check (reality-check.js plan) or record its evidence (evidence.js add)'}, or note on the bead what blocks it.` });
  }
  for (const b of beads.filter((x) => x && x.status === 'in_progress' && !inStop(x) && !waitingEvidence(x))) {
    const h = holderOf(b, list);
    if (h && limited.has(h.instance)) continue;
    // a holder inside a watch.js wait is waiting within the limit it declared
    if (h && h.waitUntil > t) continue;
    const last = Math.max(ms(b.updated_at), ms(b.created_at), h ? h.lastActive : -Infinity);
    const minutes = (t - last) / 60000;
    if (minutes <= stallHours * 60) continue;
    const who = h ? h.instance : b.assignee || 'nobody named';
    out.push({ kind: 'quiet', key: `quiet:${b.id}:${Number.isFinite(last) ? new Date(last).toISOString() : 'never'}`, bead: b.id, target: h ? h.instance : dm, due: true,
      line: `Stalled: ${b.id} is in progress with ${who}, and nothing has moved for ${span(minutes)} (the limit is ${stallHours} h).`,
      plain: `A started item has not moved for ${span(minutes)}; its holder is asked to continue it.`,
      detail: `in progress with ${who}; no bead update or session activity since ${Number.isFinite(last) ? new Date(last).toISOString() : 'unknown'}`,
      prompt: h && ['verified', 'cut'].includes(G.stateOf(b)) ? `${b.id} is ${G.stateOf(b)} and has not moved for ${span(minutes)}. Close it now (bd close ${b.id}), or note in the bead what blocks the close.`
        : h ? `${b.id} has not moved for ${span(minutes)}. Continue it now (bd show ${b.id}), or note in the bead what blocks it and tell the Delivery Manager.` : `${b.id} is in progress with ${who}, whose session is not on this host's roster, and has not moved for ${span(minutes)}: release or reassign it.` });
  }
  // a P0 counts when it can be taken now: ready (not blocked), not an epic, not in a stopped area
  const readyIds = new Set(ready.map((b) => b && b.id));
  for (const b of beads.filter((x) => x && x.status === 'open' && Number(x.priority) === 0 && !x.assignee && readyIds.has(x.id) && typeOf(x) !== 'epic' && !inStop(x) && !waiting.has(x.id))) {
    const minutes = (t - ms(b.created_at || b.updated_at)) / 60000;
    if (!(minutes > P0_HOURS * 60)) continue;
    out.push({ kind: 'p0', key: `p0:${b.id}`, bead: b.id, target: dm, due: true,
      line: `Unclaimed: top-priority ${b.id} has waited ${span(minutes)} for a claim.`,
      plain: `A top-priority item has waited ${span(minutes)} for someone to take it; the Delivery Manager assigns it first.`,
      detail: `P0 open and unclaimed since ${b.created_at || b.updated_at}`,
      prompt: `Top-priority ${b.id} has waited ${span(minutes)} unclaimed. Assign it to a builder now (bd show ${b.id}).` });
  }
  // messages sent to a role while its session was not running (lib/inbox.js): its next turn starts with them
  for (const m of messages.filter((x) => x && x.to && x.entries && x.entries.length)) {
    // "steward" goes to the steward role; a name no role on the team answers to wakes nobody (the
    // sender was told when it sent, route-check.js), rather than reporting it at every run
    // the steward is the one on the sender's host, as when it was sent
    const sender = team && require('./manifest.js').expandInstances(team).find((i) => i.instance === (m.entries[0] || {}).from);
    const r = team ? require('./inbox.js').resolveTarget(team, m.to, sender && sender.role ? sender.role.host : null) : { to: m.to };
    if (r.unknown) continue;
    const shown = m.entries.slice(-5).map((e) => `[from ${e.from || 'unknown'}${e.summary ? `: ${e.summary}` : ''}] ${String(e.message || '').replace(/\s+/g, ' ').slice(0, 600)}`);
    out.push({ kind: 'message', key: `message:${m.to}:${m.upTo}`, target: r.to, inbox: m.to, due: true, upTo: m.upTo,
      line: `Waiting: ${m.entries.length} message${m.entries.length > 1 ? 's' : ''} for ${m.to}, sent while its session was not running.`,
      plain: `A message is waiting for ${m.to}; it is woken to read it.`,
      detail: `${m.entries.length} undelivered message(s) for ${m.to}`,
      prompt: `${m.entries.length > 5 ? `${m.entries.length} messages arrived; the last 5:` : `Message${m.entries.length > 1 ? 's' : ''} sent to you while your session was not running:`} ${shown.join(' ')} Act on them now, as your brief says.` });
  }
  // the next step a merge or a deploy handed to a role (lib/handoff.js): a handoff, woken like a message,
  // once; a step the record already shows taken is closed instead (handoffsDone), with no wake
  const HO = require('./handoff.js');
  const handoffsDone = [];
  for (const r of handoffs.filter((x) => x && x.id && x.bead)) {
    const b = beads.find((x) => x && x.id === r.bead) || null;
    if (HO.done(r, b, beads)) { handoffsDone.push(r.id); continue; }
    if (inStop(b) && !recovering(b)) continue;
    const target = list.some((s) => s.instance === r.to) ? r.to : dm;
    out.push({ kind: 'handoff', key: `handoff:${r.id}`, bead: r.bead, target, handoff: r.id, due: true,
      line: `Handed over: ${r.bead} waits for its ${r.step === 'deploy' ? 'deploy' : 'reality check'} (${r.step === 'deploy' ? `PR ${r.pr || '?'} merged` : 'deployed'} at ${clock(ms(r.at))}).`,
      plain: r.step === 'deploy' ? 'A merged item is handed to the Delivery Manager to deploy.' : 'A deployed item is handed to the Delivery Manager for its check on the customer\'s app.',
      detail: `${r.step} handed to ${target} at ${r.at}`, prompt: HO.prompt(r, b) });
  }
  return { stalls: out, handoffsDone };
}

// R-25: a role whose transcript shows gh polled in a loop faster than every 4 minutes
function pollWarnings(list) {
  return list.filter((s) => s.polls && s.polls.length).map((s) => ({ instance: s.instance, every: Math.min(...s.polls.map((p) => p.every)), count: s.polls.length,
    line: `Polling: ${s.instance} ran ${s.polls.length} gh polling loop${s.polls.length > 1 ? 's' : ''} every ${Math.min(...s.polls.map((p) => p.every))} s; use watch.js (at least every 4 min, with an exit and a time limit).` }));
}

const KIND = { idle: 'idle', quiet: 'stall', p0: 'p0-unclaimed', limit: 'usage-limit' };
// no fixed instance: each host appends to its own ledger file, as team-status does (review on aaea37c)
function recordAll(root, res, polls, { now, instance } = {}) {
  for (const s of res.stalls) {
    // a message or a handoff is a handover, not a warning; KIND has no entry for either, and the ledger
    // refuses a row with no kind, so this skip is the first of two guards
    if (s.kind === 'message' || s.kind === 'handoff') continue;
    if (s.kind === 'idle') I.recordIdle(root, s.idle, { now, instance });
    else W.record(root, { kind: KIND[s.kind], rule: 'R-04', bead: s.bead, detail: s.detail, raisedBy: instance || 'watchdog', instance, now });
  }
  for (const p of polls) W.record(root, { kind: 'tight-poll', rule: 'R-25', detail: `${p.instance} polled gh every ${p.every} s`, raisedBy: instance || 'watchdog', instance, now });
}

// ---- the host job's install record: whether a restart can be promised ----
const installedFile = (root) => path.join(root, REL, 'installed.json');
function installedJob(root) {
  try {
    const j = JSON.parse(fs.readFileSync(installedFile(root), 'utf8'));
    if (!j || !j.kind) return null;
    if (j.file && !fs.existsSync(j.file)) return null;
    return j;
  } catch (err) { return null; }
}

// each stop's open A3, by id: its work goes on in the stopped area, unrelated A3 work does not
// (lib/andon.js claimFindings; Copilot, #86). Fails open to no A3.
function withA3s(root, pause) {
  if (!pause || !Array.isArray(pause.stops) || !pause.stops.length) return pause;
  try {
    const A = require('./andon.js');
    const rows = A.read(root).rows;
    return { ...pause, stops: pause.stops.map((s) => ({ ...s, a3: (A.openA3For(root, s.trigger, rows) || {}).id || null })) };
  } catch (err) { return pause; }
}

// Read the record for a project: beads from bd (a lib/bd.js store), the goal sheet, the owner queue,
// the roster and the transcripts. Fails open: a failed read gives no stalls and says so.
function read(root, { bd, now, team, rows, installed, pause: given } = {}) {
  try {
    const Goal = require('./goal.js');
    const Q = require('./owner-queue.js');
    const beads = bd.list({ all: true }) || [];
    const ready = bd.ready() || [];
    const beadOf = (id) => { try { return bd.show(id); } catch (err) { return null; } };
    const list = sessions(root, { team, rows });
    const res = stalls({ beads, ready, now, team, idleMinutes: Goal.value(root, 'idle_minutes'), stallHours: Goal.value(root, 'stall_hours'),
      pause: withA3s(root, given || Goal.activePause(root, { beadOf, maxLookups: 4 })), openSteps: Q.open(root), sessions: list, installed: installed !== undefined ? installed : Boolean(installedJob(root)), messages: require('./inbox.js').pending(root), handoffs: require('./handoff.js').pending(root) });
    // a verified pause silences the polling warnings too
    return { ...res, polls: res.paused ? [] : pollWarnings(list), sessions: list };
  } catch (err) { return { stalls: [], polls: [], sessions: [], unreadable: String(err.message).split('\n')[0] }; }
}

// ---- the wake log: what the watchdog did, append-only, rotated at LOG_MAX_BYTES ----
const logFile = (root) => path.join(root, REL, 'wakes.ndjson');
const rowsIn = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (err) { return null; } }).filter((r) => r && typeof r === 'object'); } catch (err) { return []; } };
// the rotated file too: the caps look back a week
function logRows(root) { return [...rowsIn(`${logFile(root)}.1`), ...rowsIn(logFile(root))]; }
function ensureDir(root) {
  fs.mkdirSync(path.join(root, REL), { recursive: true });
  // host-local: the log, the job's output and the wake logs stay out of git
  const ig = path.join(root, REL, '.gitignore');
  if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
}
function rotate(file, max = LOG_MAX_BYTES) {
  try { if (fs.statSync(file).size > max) fs.renameSync(file, `${file}.1`); } catch (err) { /* nothing to rotate */ }
}
function log(root, row) {
  ensureDir(root);
  rotate(logFile(root));
  fs.appendFileSync(logFile(root), `${JSON.stringify(row)}\n`);
  return row;
}

// alive, and still a wake supervisor: a pid the system gave to another program since is not ours
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try {
    const cmd = require('child_process').execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return !cmd.trim() || /wake-run\.js/.test(cmd);
  } catch (err) { return true; }
}

// a message and a handoff (lib/handoff.js) are the team's handovers, not stalls: woken by the message rules
const isHandoff = (s) => s.kind === 'message' || s.kind === 'handoff';
// what a wake hands over: the inbox messages (marked delivered by count) and the handoff rows it carries
const deliversOf = (stalls) => stalls.filter((s) => s.kind === 'message').map((s) => ({ to: s.inbox || s.target, upTo: s.upTo }));
const handoffsOf = (stalls) => stalls.filter((s) => s.kind === 'handoff').map((s) => s.handoff);

// The wakes due now, one per target session, carrying the stall lines it may still be woken for.
// { wakes: [{ target, keys, lines, prompt }], waiting: [stall], held: [{ target, lines, reason }] }
function plan(res, { root, now, alive = pidAlive } = {}) {
  const t = ms(now || new Date().toISOString());
  const rows = logRows(root).filter((r) => r.type === 'wake');
  // a session on its own usage limit is woken for nothing before its reset (Copilot 416)
  const limitedUntil = new Map(res.stalls.filter((s) => s.kind === 'limit' && !s.due).map((s) => [s.target, s.wakeAt]));
  const by = new Map();
  const waiting = [];
  for (const s of res.stalls) {
    if (!s.due) { waiting.push(s); continue; }
    if (limitedUntil.has(s.target)) { waiting.push({ ...s, wakeAt: limitedUntil.get(s.target) }); continue; }
    const w = by.get(s.target) || { target: s.target, stalls: [] };
    w.stalls.push(s);
    by.set(s.target, w);
  }
  const wakes = [];
  const held = [];
  for (const w of by.values()) {
    const mine = rows.filter((r) => r.instance === w.target).sort((a, b) => ms(a.at) - ms(b.at));
    const last = mine[mine.length - 1];
    const lines = w.stalls.map((s) => s.line);
    // a message is a handoff, not a stall: its target is woken within MESSAGE_EVERY_MS, not an hour
    const onlyMessages = w.stalls.every((s) => isHandoff(s));
    let reason = null;
    if (onlyMessages) {
      if (last && alive(last.pid)) reason = 'its last wake is still running; the message waits for it';
      else if (last && t - ms(last.at) < MESSAGE_EVERY_MS) reason = `woken at ${clock(ms(last.at))}; messages wait ${MESSAGE_EVERY_MS / 60000} min between wakes`;
      else if (mine.filter((r) => t - ms(r.at) < 24 * 3600e3).length >= MESSAGE_DAILY_CAP) reason = `woken ${MESSAGE_DAILY_CAP} times in a day; alarm only until the count falls`;
      if (reason) { held.push({ target: w.target, lines, reason }); continue; }
      wakes.push({ target: w.target, keys: w.stalls.map((s) => s.key), lines, delivers: deliversOf(w.stalls), handoffs: handoffsOf(w.stalls), prompt: `Watchdog (a host job, not the owner): ${w.stalls.map((s) => s.prompt).join(' ')} Reply in one line with what you did.` });
      continue;
    }
    // the stall gates count stall wakes only: a role woken often for messages is still told about its
    // stall (each message wake would otherwise push "one wake an hour" forward and fill the day's six)
    const stallRows = mine.filter((r) => (r.keys || []).some((k) => !/^(message|handoff):/.test(String(k))));
    const lastStall = stallRows[stallRows.length - 1];
    if (last && alive(last.pid)) reason = 'its last wake is still running';
    else if (lastStall && t - ms(lastStall.at) < WAKE_EVERY_MS) reason = `woken at ${clock(ms(lastStall.at))}; one wake an hour`;
    else if (stallRows.filter((r) => t - ms(r.at) < 24 * 3600e3).length >= DAILY_CAP) reason = `woken ${DAILY_CAP} times in a day; alarm only until the count falls`;
    // each stall waits 1, 2, 4 ... hours after each wake that carried it
    const ok = reason ? [] : w.stalls.filter((s) => {
      const k = mine.filter((r) => (r.keys || []).includes(s.key) && t - ms(r.at) < 7 * 24 * 3600e3);
      return !k.length || t - ms(k[k.length - 1].at) >= WAKE_EVERY_MS * 2 ** (k.length - 1);
    });
    // a wake that would carry only messages is not a stall wake: it goes by the message rules below
    // (five minutes apart, 48 a day), or a stall still waiting out its backoff would let a message wake
    // the role every minute through this path
    if (!reason && !ok.some((s) => !isHandoff(s))) reason = 'woken for these already; waiting longer before the next try';
    // A message waiting beside a held stall is still a handoff: a role that spent its stall wakes (or
    // was woken for the stall within the hour) gets its messages by the message rules, not left until
    // the stall count falls. Seen on a real team: the Delivery Manager's work waited hours behind its cap.
    const msgs = w.stalls.filter((s) => isHandoff(s));
    if (reason && msgs.length) {
      let mReason = null;
      if (last && alive(last.pid)) mReason = 'its last wake is still running; the message waits for it';
      else if (last && t - ms(last.at) < MESSAGE_EVERY_MS) mReason = `woken at ${clock(ms(last.at))}; messages wait ${MESSAGE_EVERY_MS / 60000} min between wakes`;
      else if (mine.filter((r) => t - ms(r.at) < 24 * 3600e3).length >= MESSAGE_DAILY_CAP) mReason = `woken ${MESSAGE_DAILY_CAP} times in a day; alarm only until the count falls`;
      if (!mReason) {
        wakes.push({ target: w.target, keys: msgs.map((s) => s.key), lines: msgs.map((s) => s.line), delivers: deliversOf(msgs), handoffs: handoffsOf(msgs), prompt: `Watchdog (a host job, not the owner): ${msgs.map((s) => s.prompt).join(' ')} Reply in one line with what you did.` });
        const rest = w.stalls.filter((s) => !isHandoff(s));
        if (rest.length) held.push({ target: w.target, lines: rest.map((s) => s.line), reason });
        continue;
      }
      // both held: each line says its own cause
      const rest = w.stalls.filter((s) => !isHandoff(s));
      held.push({ target: w.target, lines: msgs.map((s) => s.line), reason: mReason });
      if (rest.length) held.push({ target: w.target, lines: rest.map((s) => s.line), reason });
      continue;
    }
    if (reason) { held.push({ target: w.target, lines, reason }); continue; }
    // the messages a stall wake carries are handed over too, so the next run does not send them again
    wakes.push({ target: w.target, keys: ok.map((s) => s.key), lines: ok.map((s) => s.line), delivers: deliversOf(ok), handoffs: handoffsOf(ok), prompt: `Watchdog (a host job, not the owner): ${ok.map((s) => s.prompt).join(' ')} Reply in one line with what you started.` });
  }
  return { wakes, waiting, held };
}

// How to wake one session: resume it in place when it is not open, fork it when it is open and idle,
// leave it when it is busy or when open sessions cannot be listed, continue the role directory's latest
// conversation when no id is known. live: claude agents --json rows (null when unknown). { mode, args } or { skip }
// mode: the team's permission_mode (team.json); a resumed session does not keep the mode it was
// started in, so every wake names it (default needs no flag)
// freshAbove: a session not open whose last turn carried more context than this is woken in a fresh
// session in its role directory instead of resumed (0: never). A resume reloads the whole
// conversation, and on a real team each wake piled onto it until a turn carried 236k tokens; the role
// brief and the team's records (beads, story files, review rows) are what a role works from, so a
// fresh session loses no state, only the chat.
const FRESH_ABOVE = 120000;
function wakeCommand(s, prompt, live, mode = 'auto', { freshAbove = FRESH_ABOVE } = {}) {
  const m = mode && mode !== 'default' ? ['--permission-mode', mode] : [];
  const r = wakeArgs(s, prompt, live);
  if (r.mode === 'resume' && freshAbove > 0 && Number.isFinite(s.context) && s.context > freshAbove) {
    // named like every role session (start.js --name), so peers reach it by name (team rule 13)
    return { mode: 'fresh', args: [...m, '--name', s.instance, '-p', `${freshPreamble(s)} ${prompt}`] };
  }
  return r.args ? { ...r, args: [...m, ...r.args] } : r;
}

function freshPreamble(s) {
  // the Chief of Staff's Stop guard checks unrecorded operator input per session: a fresh session
  // would not be held for input left in the old one, so it is told to look
  const operator = s.role === 'chief-of-staff' ? ' Check first for operator input still unrecorded (operator.js pending) and record it.' : '';
  return `You are ${s.instance}, starting a fresh session: your earlier conversation (${Math.round(s.context / 1000)}k tokens) is not loaded, so each turn stays light. Your brief and the team's records are your memory: start with your own in-progress beads (bd list --assignee "$BEADS_ACTOR" --status in_progress) and their notes, and the files they name.${operator}`;
}

function wakeArgs(s, prompt, live) {
  if (!s || !s.roleDir) return { skip: 'no session of this role on this host\'s roster' };
  if (!fs.existsSync(s.roleDir)) return { skip: `its role directory ${s.roleDir} is not on this host` };
  if (live === null || live === undefined) return { skip: 'open sessions could not be listed (claude agents --json), so a wake could collide with one; alarm only' };
  if (!s.session) return { mode: 'continue', args: ['-c', '-p', prompt] };
  const row = live.find((r) => r && r.sessionId === s.session);
  if (row && row.status !== 'idle' && row.status !== 'waiting') return { skip: `it is working (${row.status || 'busy'})` };
  // open and idle: a copy never collides with the open session
  if (row) return { mode: 'fork', args: ['--resume', s.session, '--fork-session', '-p', prompt] };
  return { mode: 'resume', args: ['--resume', s.session, '-p', prompt] };
}

module.exports = { withA3s, FRESH_ABOVE, contextOf, MESSAGE_EVERY_MS, MESSAGE_DAILY_CAP, WAKE_TIMEOUT_H, REL, P0_HOURS, WAKE_EVERY_MS, DAILY_CAP, RESET_GRACE_MIN, MIN_POLL_S, LOG_MAX_BYTES, tailRows, limitOf, waitingUntil, tightPolls, pollEvery, sessions, stalls, pollWarnings, recordAll, read, plan, wakeCommand, log, logRows, rotate, ensureDir, installedJob, installedFile, pidAlive, clock, span };
