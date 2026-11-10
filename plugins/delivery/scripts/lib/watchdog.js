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
//   install  the job's self-update refused a version for an install (lib/self-update.js) and no later
//          install of it or a newer one went through: that install runs an old plugin until the Delivery
//          Manager settles the refusal, so it is a stall, never a healthy team (bqj.2)
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

// How every wake prompt opens. In a role session's transcript a wake and a prompt the operator typed are
// the same record shape, and these words are the one difference, so lib/transcript.js requires this
// copy instead of keeping its own: rewording the wake can never let one pass as the operator's.
const WAKE_OPENING = 'Watchdog (a host job, not the owner)';
// hjx.1.6.12: a wake names the stall that caused it, then gives the same first turn as a session start
// (lib/first-turn.js), so a woken role reads its whole backlog and takes the next item, not only the one stall
const wakePrompt = (prompts, verb) => `${WAKE_OPENING}: ${prompts.join(' ')} ${require('./first-turn.js').FIRST_TURN} Reply in one line with what you ${verb}.`;

const REL = path.join('.delivery', 'watchdog');
const P0_HOURS = 1;
const WAKE_EVERY_MS = 3600e3;
const DAILY_CAP = 6;
// a waiting message wakes its target sooner and more often than a stall does: it is the team's handoff.
// The gap between wakes now holds assigned work alone; a new message or handoff goes at once (hjx.1.3)
const MESSAGE_EVERY_MS = 5 * 60e3;
// a role quiet this long while holding assigned or claimed work it can start is woken for it (hjx.1)
const ASSIGNED_IDLE_MIN = 10;
// a session the team revive started gets its first turn once it has had this long to come up, and only
// while the start is this fresh (hjx.1.6.12)
const START_SETTLE_MIN = 2;
const START_FRESH_H = 6;
const MESSAGE_DAILY_CAP = 48;
// The Delivery Manager assigns, reviews and merges for every other role, so its wakes are the team's
// flow: on a real team it spent its six stall wakes by mid-day and ready top-priority work then waited
// hours unassigned behind "alarm only" (7ax). Its day holds more: still at most one stall wake an hour
// (the hourly gate and each stall's doubling backoff are unchanged), and twice the handover wakes.
const MANAGER_DAILY_CAP = 24;
const MANAGER_MESSAGE_DAILY_CAP = 96;
// Wakes that carry assigned work alone have a day of their own, so they can never spend the one that
// carries messages and handoffs (6z5): on a real team a builder was woken every pass overnight for beads
// it could not move, spent its 48 by midday, and the review that sent its pull request back was held.
// Each assigned bead also waits twice as long after each wake that carried it (5, 10, 20 ... min).
const ASSIGNED_DAILY_CAP = 12;
const MANAGER_ASSIGNED_DAILY_CAP = 24;
const isManagerInstance = (instance) => /^delivery-lead(?:-\d+)?$/.test(String(instance || ''));
const capsOf = (instance) => (isManagerInstance(instance) ? { daily: MANAGER_DAILY_CAP, messages: MANAGER_MESSAGE_DAILY_CAP, assigned: MANAGER_ASSIGNED_DAILY_CAP } : { daily: DAILY_CAP, messages: MESSAGE_DAILY_CAP, assigned: ASSIGNED_DAILY_CAP });
const RESET_GRACE_MIN = 5;
const TAIL_BYTES = 512 * 1024;
const MIN_POLL_S = 240;
// a wake runs under a supervisor (lib/wake-run.js) that stops its process group after WAKE_TIMEOUT_H and
// lives until the group is gone; the guard holds while that supervisor lives, whatever the clock says
const WAKE_TIMEOUT_H = 2;
const LOG_MAX_BYTES = 1 << 20;
const DM = 'delivery-lead';
// the review record states (lib/reviews.js stateOf, read without gh) that wait on the Delivery Manager
const MANAGER_STEP = {
  passed: { what: 'has a passing review and waits for its merge', plain: 'passed its review and waits to be merged', next: (pr) => `merge-gate.js check ${pr}, then merge it` },
  ready: { what: 'has a passing review and waits for its merge', plain: 'passed its review and waits to be merged', next: (pr) => `merge-gate.js check ${pr}, then merge it` },
  waiting: { what: 'waits for its independent review', plain: 'waits for its review', next: (pr) => `dispatch its reviewer (review.js request ${pr})` },
  changes: { what: 'has a review asking for changes', plain: 'has review findings to send back', next: (pr) => `send it back to its owner (review.js send-back ${pr} --reason changes)` },
  failing: { what: 'has a passing review but red CI', plain: 'has a failing build to send back', next: (pr) => `send it back to its owner (review.js send-back ${pr} --reason ci)` },
};

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
      // the plugin version it last ran: what its start recorded, else the last plugin path its own
      // commands named (a session started before the roster kept the version)
      let pluginVersion = (e && typeof e.plugin_version === 'string' && e.plugin_version) || null;
      for (const f of [t, ...forks].filter(Boolean)) {
        try { lastActive = Math.max(lastActive, fs.statSync(f).mtimeMs); } catch (err) { /* not on disk */ }
        const tail = rows(f);
        const l = limitOf(tail);
        if (l && (!limit || ms(l.at) > ms(limit.at))) limit = l;
        waitUntil = Math.max(waitUntil, waitingUntil(tail));
        if (f === t) {
          polls.push(...tightPolls(tail)); context = contextOf(tail);
          if (!pluginVersion) pluginVersion = require('./plugin-version.js').versionInText(toolUses(tail).map((u) => u.command).join('\n'));
        }
      }
      return { ...base, lastActive, transcript: t, forks, limit, waitUntil, polls, context, pluginVersion };
    } catch (err) { return { ...base, lastActive: ms(e && e.last_seen), transcript: null, limit: null, waitUntil: -Infinity, polls: [], pluginVersion: (e && e.plugin_version) || null }; }
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
function stalls({ beads = [], ready = [], now, idleMinutes = 30, stallHours = 2, pause = { paused: false }, openSteps = [], sessions: list = [], team, installed = true, messages = [], handoffs = [], prs = [], reviews = [], woken = [], wakes = [], refusedInstalls: refused = [], claimable = () => true, starts = [] } = {}) {
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
  // Assigned work runs (hjx.1): a role holding assigned or claimed work it can start (in progress, or
  // open and ready) and quiet for ASSIGNED_IDLE_MIN is woken to work it, whether or not a message
  // waits. Before, a role was woken only for a message or a two-hour stall, so a builder handed a story
  // with no message sat idle for hours. It is a handover like a message (five minutes apart, the
  // message caps), not a warning, and it never targets a session that is running a turn. Work an open
  // owner-queue step names waits for the owner, as the idle and P0 rules read it (bd ready does not
  // know those steps). In a stopped area only the stop's recovery work runs (recovering, as for handoffs).
  const readySet = new Set((ready || []).map((b) => b && b.id));
  // 6z5: work its holder cannot move is not woken. A bead whose pull request waits for its review (any
  // state but changes asked or sent back: those are the builder's, and a send-back wakes it below), and
  // an open bead queued behind another bead its holder has in progress (one at a time).
  const reviewing = (b) => reviews.some((r) => (r.beads || []).includes(b.id) && !['changes', 'sent-back', 'merged'].includes(r.state));
  // hjx.1.1: work its holder has said it cannot move is not woken either: the bead's last note names a
  // blocker (team rule 7 raises a blocker as a bead note). Only the deliberate marker counts: the entry
  // starts "Blocked:" after its date and author. Matching the word anywhere caught prose ("no longer
  // blocked") and the Delivery Manager's own pass notes ("action unblock"), and left work its holder
  // could move unwoken (rv-179). Pass notes are the watchdog's, not the holder's, so they are skipped:
  // the holder's last dated entry decides, and a later note that moves the work on makes it the
  // holder's again. Past stall_hours it is the Delivery Manager's, below.
  const PASS_NOTE = /^\d{4}-\d{2}-\d{2}\S*\s+[^\s:]+\s+pass:/;
  // the stamp is a date, or a date with a full time (2026-11-07T12:00:00Z): a time's own colons are not
  // the author's (rv-179 note 4)
  const NOTE_STAMP = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
  const BLOCKED_NOTE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?:\s+[^:\n]+?)?:\s*Blocked:/;
  const blockedBy = (b) => {
    const entries = String((b && b.notes) || '').split(/\n(?=\d{4}-\d{2}-\d{2})/).map((x) => x.trim()).filter((x) => x && !PASS_NOTE.test(x));
    const last = entries[entries.length - 1] || '';
    return BLOCKED_NOTE.test(last) ? last : null;
  };
  // hjx.1.1.1 (rv-179 note 2): when the blocker was noted. updated_at moves on every later note, the
  // Delivery Manager's own pass notes included, and re-armed the ask each pass. A full-time stamp is
  // exact; a date-only stamp bounds the bead's update to that day, so a note on a later day leaves it.
  const blockedSince = (b, note) => {
    const m = NOTE_STAMP.exec(note);
    const upd = Math.max(ms(b.updated_at), ms(b.created_at));
    if (!m) return upd;
    if (m[2]) { const at = ms(m[1] + m[2]); if (Number.isFinite(at)) return at; }
    const day = ms(`${m[1]}T00:00:00Z`);
    if (!Number.isFinite(day)) return upd;
    return Number.isFinite(upd) ? Math.min(Math.max(upd, day), day + 24 * 60 * 60e3 - 1) : day;
  };
  // hjx.1.1: a wake's own turn is not a move. lastMove took the holder's lastActive, so every wake reset
  // the stall clock and a bead its holder could not move never reached stall_hours: the holder was woken
  // to its daily cap instead. Session activity counts only from before this bead's last wake (the wake
  // log's assigned: and quiet: keys); the bead's own updates still count.
  const lastWakeOf = (id) => Math.max(-Infinity, ...(wakes || []).filter((w) => w && (w.keys || []).some((k) => k === `assigned:${id}` || String(k).startsWith(`quiet:${id}:`))).map((w) => ms(w.at)).filter(Number.isFinite));
  const activeFor = (b, h) => {
    const a = h && Number.isFinite(h.lastActive) ? h.lastActive : -Infinity;
    const w = lastWakeOf(b.id);
    return Number.isFinite(w) && a >= w ? -Infinity : a;
  };
  const busyWith = (b, h) => b.status === 'open' && beads.some((x) => x && x.id !== b.id && x.status === 'in_progress' && !waitingEvidence(x) && typeOf(x) !== 'epic' && (holderOf(x, list) || {}).instance === h.instance);
  for (const b of beads.filter((x) => x && x.assignee && !(inStop(x) && !recovering(x)) && !waiting.has(x.id) && !waitingEvidence(x) && typeOf(x) !== 'epic'
    && (x.status === 'in_progress' || (x.status === 'open' && readySet.has(x.id))))) {
    const h = holderOf(b, list);
    if (!h || limited.has(h.instance) || (h.waitUntil && h.waitUntil > t)) continue;
    if (reviewing(b) || busyWith(b, h)) continue;
    if (b.status === 'in_progress' && blockedBy(b)) continue;
    const quiet = (t - (Number.isFinite(h.lastActive) ? h.lastActive : -Infinity)) / 60000;
    if (!(quiet > ASSIGNED_IDLE_MIN)) continue;
    // an open bead must still be one its holder may claim: bd ready knows nothing of a red main, which
    // the claim check refuses (lib/andon.js ciRedBlock). Asked last, so CI is read only for a real wake.
    if (b.status === 'open' && !claimable(b)) continue;
    // past stall_hours the in-progress stall below wakes the holder already: one wake, not two. That
    // stall skips a stopped area, so recovery work there keeps its assigned wake.
    const lastMove = Math.max(ms(b.updated_at), ms(b.created_at), activeFor(b, h));
    if (b.status === 'in_progress' && !inStop(b) && (t - lastMove) / 60000 > stallHours * 60) continue;
    out.push({ kind: 'assigned', key: `assigned:${b.id}`, bead: b.id, target: h.instance, due: true,
      line: `Assigned and waiting: ${b.id} is with ${h.instance}, whose session has been quiet for ${span(quiet)}.`,
      plain: 'Work handed to a team member is waiting for them; they are started on it.',
      detail: `${b.status}, assigned to ${b.assignee}; session quiet since ${Number.isFinite(h.lastActive) ? new Date(h.lastActive).toISOString() : 'unknown'}`,
      prompt: `${b.id} is assigned to you and waiting (${b.status}). Work it now: bd show ${b.id}, take its next step and keep going to a pull request or a recorded result; if something blocks it, add a bead note that starts "Blocked:" naming the blocker and who can unblock it.` });
  }
  // hjx.1.6.12 criterion 1: `claude remote-control` takes no prompt, so a session the team revive starts
  // (lib/team-revive.js, a start row in revive.ndjson) comes up with no turn and sat idle with ready work.
  // Its newest start, once it has had time to come up and while the session has not been active since,
  // is a handover: one wake, keyed on that start, carrying the first turn (wakePrompt). An older start is
  // the revive's own to retry, not a first turn.
  const newestStart = new Map();
  for (const r of starts || []) {
    // a restart onto the installed plugin (lib/team-revive.js staleOf) also brings a session up with no turn
    if (!r || !['start', 'restart'].includes(r.type) || !r.instance || !Number.isFinite(ms(r.at))) continue;
    const had = newestStart.get(r.instance);
    if (!had || ms(r.at) > ms(had.at)) newestStart.set(r.instance, r);
  }
  const carriedKeys = new Set((wakes || []).flatMap((w) => (w && w.keys) || []));
  for (const r of newestStart.values()) {
    const at = ms(r.at);
    const age = (t - at) / 60000;
    if (!(age >= START_SETTLE_MIN && age <= START_FRESH_H * 60)) continue;
    const h = list.find((s) => s && s.instance === r.instance);
    if (!h || limited.has(h.instance)) continue;
    if (Number.isFinite(h.lastActive) && h.lastActive >= at) continue;
    const key = `started:${r.instance}:${r.at}`;
    if (carriedKeys.has(key)) continue;
    out.push({ kind: 'started', key, target: r.instance, due: true,
      line: `Started with no turn: ${r.instance} was started by the team revive at ${clock(at)} and has done nothing since.`,
      plain: 'A team member restarted after an outage is given its first turn, so it picks its work up.',
      detail: `revive start at ${r.at}; session last active ${Number.isFinite(h.lastActive) ? new Date(h.lastActive).toISOString() : 'unknown'}`,
      prompt: `Your session was started by the team revive at ${clock(at)} and has had no turn yet.` });
  }
  // hjx.1.6.12 criterion 4: idle with ready work is a stall within one pass. The idle rule above
  // (lib/idle.js) fires only when nothing at all is in progress, so a builder idle beside ready stories
  // went unseen while any other bead moved. A builder holding nothing it can move (work waiting on its
  // evidence rows is the other roles' to move), quiet past the assigned gap, is woken to claim a ready
  // story no one holds. Each idle builder is offered a different story, so two never race for one; the
  // wake is paced like assigned work (handover() below), and recorded as a warning the Delivery Manager sees.
  const holdsWork = (h) => beads.some((x) => x && typeOf(x) !== 'epic' && !waitingEvidence(x)
    && (x.status === 'in_progress' || (x.status === 'open' && readySet.has(x.id))) && (holderOf(x, list) || {}).instance === h.instance);
  // what a builder may be offered: a story, or a fix (a bug or security bead). Fix work goes first (rv-190):
  // a fix linked to a failed check or a stop (metadata.fixes, or a stop's recovery work), then security,
  // then any other bug, then stories, each in bd ready's own order
  const hasLabel = (b, l) => (b.labels || []).includes(l);
  const isFix = (b) => hasLabel(b, 'bug') || hasLabel(b, 'security');
  const rankOf = (b) => (isFix(b) && (String((b.metadata || {}).fixes || '').trim() || (inStop(b) && recovering(b))) ? 0
    : hasLabel(b, 'security') ? 1 : hasLabel(b, 'bug') ? 2 : 3);
  const offer = (ready || []).filter((b) => b && b.status === 'open' && !b.assignee && (hasLabel(b, 'story') || isFix(b))
    && !waiting.has(b.id) && !(inStop(b) && !recovering(b)))
    .map((b, i) => ({ b, i, r: rankOf(b) })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.b);
  let nextOffer = 0;
  for (const h of list.filter((s) => s && s.role === 'builder')) {
    if (limited.has(h.instance) || (h.waitUntil && h.waitUntil > t) || holdsWork(h)) continue;
    const quiet = (t - (Number.isFinite(h.lastActive) ? h.lastActive : -Infinity)) / 60000;
    if (!(quiet > ASSIGNED_IDLE_MIN)) continue;
    let b = null;
    while (!b && nextOffer < offer.length) { const c = offer[nextOffer++]; if (claimable(c)) b = c; }
    if (!b) break;
    out.push({ kind: 'unclaimed', key: `unclaimed:${h.instance}:${b.id}`, bead: b.id, target: h.instance, due: true,
      line: `Idle with ready work: ${h.instance} holds nothing and has been quiet for ${span(quiet)} while ${b.id} is ready.`,
      plain: 'A builder with nothing to do is started on the next ready item.',
      detail: `${h.instance} holds nothing; ready ${hasLabel(b, 'story') ? 'story' : 'fix'} ${b.id}; session quiet since ${Number.isFinite(h.lastActive) ? new Date(h.lastActive).toISOString() : 'unknown'}`,
      prompt: `You hold nothing and ${b.id} is ready${b.title ? ` (${b.title})` : ''}. Claim it now: bd update ${b.id} --claim, then ${hasLabel(b, 'story') ? 'read its story file and build it' : 'fix it test-first'}; if another builder claimed it first, take the next one from bd ready.` });
  }
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
    // a bead whose pull request waits for its review is the Delivery Manager's to move (it asks for the
    // review), as a story waiting on evidence is: keyed on the bead alone, so it backs off (6z5)
    if (reviewing(b)) {
      const since = Math.max(ms(b.updated_at), ms(b.created_at));
      const waited = (t - since) / 60000;
      if (!(waited > stallHours * 60)) continue;
      const pr = reviews.filter((r) => (r.beads || []).includes(b.id) && !['changes', 'sent-back', 'merged'].includes(r.state)).map((r) => r.pr).join(', ');
      out.push({ kind: 'quiet', key: `reviewing:${b.id}`, bead: b.id, target: dm, due: true,
        line: `Waiting on review: ${b.id}'s PR ${pr} has waited ${span(waited)} for its review.`,
        plain: `A finished item has waited ${span(waited)} for its review; the Delivery Manager moves it.`,
        detail: `PR ${pr} open for review; no bead update since ${Number.isFinite(since) ? new Date(since).toISOString() : 'unknown'}`,
        prompt: `${b.id}'s PR ${pr} has waited ${span(waited)} for its review. Take its next step now: request the review (review.js request), record it, or merge it; or note on the bead what blocks it.` });
      continue;
    }
    const h = holderOf(b, list);
    // hjx.1.1: a noted blocker is the Delivery Manager's to clear (rule 7), not its holder's to be woken for.
    // Keyed and timed on the blocker note alone: the holder's session activity and later notes are not
    // the blocker moving, so they neither renew the key nor hold the ask back, and one blocker note is one
    // ask (rv-179). Asked before the holder's own limit and wait skips: they hold the holder's wake, not
    // the Delivery Manager's (rv-179 note 3).
    const blocker = blockedBy(b);
    if (!blocker && h && limited.has(h.instance)) continue;
    // a holder inside a watch.js wait is waiting within the limit it declared
    if (!blocker && h && h.waitUntil > t) continue;
    if (blocker) {
      const since = blockedSince(b, blocker);
      const waited = (t - since) / 60000;
      if (!(waited > stallHours * 60)) continue;
      out.push({ kind: 'quiet', key: `blocked:${b.id}:${Number.isFinite(since) ? new Date(since).toISOString() : 'never'}`, bead: b.id, target: dm, due: true,
        line: `Blocked: ${b.id} has a blocker noted and nothing has moved for ${span(waited)}.`,
        plain: `A started item has been blocked for ${span(waited)}; the Delivery Manager clears it.`,
        detail: `in progress with ${h ? h.instance : b.assignee || 'nobody named'}; last note names a blocker`,
        prompt: `${b.id} has a blocker noted by its holder and has not moved for ${span(waited)}: ${blocker.replace(/\s+/g, ' ').slice(0, 400)} Clear it now (unblock, reassign or release it), or note on the bead what it waits for.` });
      continue;
    }
    const last = Math.max(ms(b.updated_at), ms(b.created_at), activeFor(b, h));
    const minutes = (t - last) / 60000;
    if (minutes <= stallHours * 60) continue;
    const who = h ? h.instance : b.assignee || 'nobody named';
    out.push({ kind: 'quiet', key: `quiet:${b.id}:${Number.isFinite(last) ? new Date(last).toISOString() : 'never'}`, bead: b.id, target: h ? h.instance : dm, due: true,
      line: `Stalled: ${b.id} is in progress with ${who}, and nothing has moved for ${span(minutes)} (the limit is ${stallHours} h).`,
      plain: `A started item has not moved for ${span(minutes)}; its holder is asked to continue it.`,
      detail: `in progress with ${who}; no bead update or session activity since ${Number.isFinite(last) ? new Date(last).toISOString() : 'unknown'}`,
      prompt: h && ['verified', 'cut'].includes(G.stateOf(b)) ? `${b.id} is ${G.stateOf(b)} and has not moved for ${span(minutes)}. Close it now (bd close ${b.id}), or note in the bead what blocks the close.`
        : h ? `${b.id} has not moved for ${span(minutes)}. Continue it now (bd show ${b.id}), or add a bead note that starts "Blocked:" saying what blocks it, and tell the Delivery Manager.` : `${b.id} is in progress with ${who}, whose session is not on this host's roster, and has not moved for ${span(minutes)}: release or reassign it.` });
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
  // Work waiting on the Delivery Manager itself (bqj, dec-chief-of-staff-000266): a pull request whose
  // review passed and waits for the merge, a review asked for with no verdict yet, or a verdict to send
  // back. Its session stopped with that waiting stalled the whole team three times (7ax), and nothing
  // woke it but a message or the two-hour quiet rule. Read from the review records alone; the key is
  // the record's last row, so a new row (a verdict, a send-back) is new work and the same row is the
  // same stall: plan() wakes for a key at once the first time and backs it off like a stall after that.
  const dmSession = list.find((s) => s.instance === dm) || null;
  const dmQuiet = dmSession ? (t - (Number.isFinite(dmSession.lastActive) ? dmSession.lastActive : -Infinity)) / 60000 : 0;
  if (dmSession && !limited.has(dm) && !(dmSession.waitUntil > t) && dmQuiet > ASSIGNED_IDLE_MIN) {
    for (const p of prs.filter((x) => x && x.pr && MANAGER_STEP[x.state])) {
      // no age cut-off: an old record with its bead open is still work stuck on the Delivery Manager. A
      // pull request merged or closed on GitHub with no merged row (PR 102) ends with its beads closed.
      const named = beads.filter((x) => x && (p.beads || []).includes(x.id));
      if (named.length && named.every((x) => x.status === 'closed')) continue;
      const b = named.find((x) => x.status !== 'closed') || null;
      if (b && inStop(b) && !recovering(b)) continue;
      const step = MANAGER_STEP[p.state];
      out.push({ kind: 'manager', key: `manager:${p.pr}:${p.last || p.state}`, bead: (p.beads || [])[0], pr: p.pr, target: dm, due: true,
        line: `Waiting on the Delivery Manager: PR ${p.pr} ${step.what}, and its session has been quiet for ${span(dmQuiet)}.`,
        plain: `A change ${step.plain}; the Delivery Manager was stopped and is restarted to take it.`,
        detail: `PR ${p.pr} ${p.state}; ${dm} quiet since ${Number.isFinite(dmSession.lastActive) ? new Date(dmSession.lastActive).toISOString() : 'unknown'}`,
        prompt: `PR ${p.pr}${(p.beads || []).length ? ` (${p.beads.join(', ')})` : ''} ${step.what}. Take it now, before anything else: ${step.next(p.pr)}.` });
    }
  }
  // bqj.2: a refused self-update stands until a later install covers it. The job retries it every pass
  // on its own, so the stall is what is left: the Delivery Manager settles the refusal (the gate row it
  // names, or the stale install), and the briefing says part of the team runs an old plugin meanwhile.
  // The key holds the version and the install, so a newer refusal is new work and the same one backs off.
  for (const r of refused.filter((x) => x && x.version)) {
    const where = r.target === 'user' ? 'the user install' : `the install ${String(r.target).replace(/^\S+ /, '')}`;
    out.push({ kind: 'install', key: `install:${r.version}:${r.target}`, target: dm, due: true,
      line: `Install refused: plugin ${r.version} for ${where} (still on ${r.from || 'an older version'}) since ${clock(ms(r.at))}: ${r.why || 'no reason recorded'}.`,
      plain: 'An update of the team\'s plugin was refused, so part of the team still runs an older version; the Delivery Manager is asked to settle it.',
      detail: `self-update ${r.version} refused for ${r.target}: ${r.why || 'no reason recorded'}`,
      prompt: `The self-update of plugin ${r.version} was refused for ${where}: ${r.why || 'no reason recorded'}. Settle it now: record the gate row it names (a merged row with its merge commit), or have the stale install removed so the user install applies; the next host-job pass installs it.` });
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
  // 6z5: a pull request sent back to its author is handed to it at once, like a handoff: never held by a
  // daily cap, once per send-back (a wake that carried its key already handed it over), and only while
  // the send-back is the pull request's last review record (a new request means the fix is in)
  const wokenKeys = new Set(woken);
  for (const r of reviews.filter((x) => x && x.state === 'sent-back' && x.sentBack && x.sentBack.id)) {
    const key = `review:${r.pr}:${r.sentBack.id}`;
    if (wokenKeys.has(key)) continue;
    for (const owner of r.owners || []) {
      if (!list.some((x) => x.instance === owner)) continue;
      const named = (r.beads || []).join(', ') || 'its bead';
      out.push({ kind: 'review', key, bead: (r.beads || [])[0], target: owner, due: true,
        line: `Sent back: PR ${r.pr} (${named}) went back to ${owner} at ${clock(ms(r.sentBack.at))}${r.sentBack.reason ? ` (${r.sentBack.reason})` : ''}.`,
        plain: 'A pull request went back to its builder to fix; it is woken to fix it.',
        detail: `PR ${r.pr} sent back to ${owner} (${r.sentBack.id})`,
        prompt: `PR ${r.pr} was sent back to you (${r.sentBack.id}${r.sentBack.reason ? `, ${r.sentBack.reason}` : ''})${r.sentBack.note ? `: ${String(r.sentBack.note).replace(/\s+/g, ' ').slice(0, 600)}` : ''}. Read the send-back note on ${named}, fix it on your branch, push, and tell the Delivery Manager.` });
    }
  }
  // the next step a merge or a deploy handed to a role (lib/handoff.js): a handoff, woken like a message,
  // once; a step the record already shows taken is closed instead (handoffsDone), with no wake
  const HO = require('./handoff.js');
  const handoffsDone = [];
  for (const r of handoffs.filter((x) => x && x.id && x.bead)) {
    const b = beads.find((x) => x && x.id === r.bead) || null;
    // closed with what in the record shows the step taken, never silently (hjx.1.3)
    const why = HO.doneWhy(r, b, beads);
    if (why) { handoffsDone.push({ id: r.id, why }); continue; }
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

const KIND = { idle: 'idle', quiet: 'stall', p0: 'p0-unclaimed', limit: 'usage-limit', manager: 'stall', install: 'install-refused', unclaimed: 'idle-role' };
// no fixed instance: each host appends to its own ledger file, as team-status does (review on aaea37c)
function recordAll(root, res, polls, { now, instance } = {}) {
  for (const s of res.stalls) {
    // a message or a handoff is a handover, not a warning; KIND has no entry for either, and the ledger
    // refuses a row with no kind, so this skip is the first of two guards
    // an idle builder is both: woken like assigned work, and kept as a warning, so idle is never quiet (hjx.1.6.12)
    if (isHandover(s) && s.kind !== 'unclaimed') continue;
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

// Where each pull request's review stands, from the review records alone (no gh): its state, the beads
// and owners its last request names, and its last send-back. A damaged chain gives nothing. Fails open.
function reviewFacts(root) {
  try {
    const R = require('./reviews.js');
    return R.listPrs(root).map((pr) => {
      const { rows, problem } = R.read(root, pr);
      if (problem || !rows.length) return null;
      const req = R.lastRequest(rows);
      const sb = [...rows].reverse().find((r) => r.type === 'sent-back') || null;
      const owners = sb && sb.owners && sb.owners.length ? sb.owners : req ? (req.owner ? [req.owner] : (req.authors || [])) : [];
      return { pr: String(pr), state: R.stateOf(rows, null), beads: (req && req.beads) || [], owners: [...new Set(owners.map(R.norm))], sentBack: sb ? { id: sb.id, at: sb.at, reason: sb.reason || null, note: sb.note || null } : null };
    }).filter(Boolean);
  } catch (err) { return []; }
}

// Read the record for a project: beads from bd (a lib/bd.js store), the goal sheet, the owner queue,
// the roster and the transcripts. Fails open: a failed read gives no stalls and says so.
// the team revive's start rows (lib/team-revive.js keeps revive.ndjson beside this log; it requires this
// file, so the ledger is read here directly rather than through it). An unreadable line is skipped.
function reviveStarts(root) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, REL, 'revive.ndjson'), 'utf8'); } catch (err) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && (r.type === 'start' || r.type === 'restart')) out.push(r); } catch (err) { /* a torn line */ }
  }
  return out;
}

function read(root, { bd, now, team, rows, installed, pause: given } = {}) {
  try {
    const Goal = require('./goal.js');
    const Q = require('./owner-queue.js');
    const beads = bd.list({ all: true }) || [];
    // a store with no readiness of its own has nothing ready, as the daily plan reads it (lib/daily-plan.js)
    const ready = (typeof bd.ready === 'function' && bd.ready()) || [];
    const beadOf = (id) => { try { return bd.show(id); } catch (err) { return null; } };
    const list = sessions(root, { team, rows });
    // the claim check's red-main rule for open assigned work, CI read once per pass and only when asked;
    // a fix (as the claim check links it) or the ci:main A3's work is still claimable. Fails open.
    let ciNow;
    const claimable = (b) => {
      try {
        const AN = require('./andon.js');
        if (ciNow === undefined) ciNow = AN.ciState(root, { team });
        if (!ciNow || !ciNow.red) return true;
        const G = require('./gates.js');
        const fix = require('./waves.js').fixLink(b, null, { root, beadOf, ownerRecord: (r) => require('./gate-context.js').ownerRecord(root, r),
          byStoryId: (sid) => beads.find((x) => G.isStoryBead(x) && String((x.metadata || {}).story || '') === sid) || null });
        // a check of shipped work starts under a red main only in the Reality Checker's hands, as at the claim
        let insts = [];
        try { insts = require('./manifest.js').expandInstances(team); } catch (err) { insts = []; }
        return !AN.ciRedBlock(b, ciNow, fix, { beadOf, prover: G.roleOfActor(b.assignee, insts) === 'reality-checker' });
      } catch (err) { return true; }
    };
    const parts = [];
    const prs = managerPrs(root, parts);
    const res = stalls({ prs, claimable, beads, ready, now, team, starts: reviveStarts(root), idleMinutes: Goal.value(root, 'idle_minutes'), stallHours: Goal.value(root, 'stall_hours'),
      pause: withA3s(root, given || Goal.activePause(root, { beadOf, maxLookups: 4 })), openSteps: Q.open(root), sessions: list, installed: installed !== undefined ? installed : Boolean(installedJob(root)), messages: require('./inbox.js').pending(root), handoffs: require('./handoff.js').pending(root), reviews: reviewFacts(root), wakes: logRows(root).filter((r) => r.type === 'wake').map((r) => ({ at: r.at, keys: r.keys || [] })), refusedInstalls: refusedInstalls(logRows(root), { installs: require('./self-update.js').installTargets('delivery') }), woken: logRows(root).filter((r) => r.type === 'wake').flatMap((r) => r.keys || []).filter((k) => /^review:/.test(String(k))) });
    // a verified pause silences the polling warnings too
    return { ...res, polls: res.paused ? [] : pollWarnings(list), sessions: list, ...(parts.length ? { unreadableParts: parts } : {}) };
  } catch (err) { return { stalls: [], polls: [], sessions: [], unreadable: String(err.message).split('\n')[0] }; }
}

// The self-update refusals still standing (bqj.2), from the job's log: per install the latest refusal,
// unless a later installed row of its version or a newer one names that install. An installed row from
// before installs were named covers the user install only, so an older row never hides a refusal.
// `installs` are the installs recorded now (self-update.js installTargets: { target, version }, or a
// bare target): a refusal for one no longer there ends, since removing the stale install is one way to
// settle it and no install will name it again; so does one whose install is recorded at the refused
// version or newer, since an update outside the job (`claude plugin update`) writes no installed row
// (rv-167). Unknown (null) keeps every refusal: an unreadable record never reads as healthy, and an
// install with no recorded version keeps its refusal.
function refusedInstalls(rows, { installs = null } = {}) {
  const { compare } = require('./plugin-version.js');
  const ups = rows.filter((r) => r && r.type === 'self-update');
  const latest = new Map();
  for (const r of ups.filter((x) => x.result === 'refused')) {
    const target = r.target || 'user';
    const was = latest.get(target);
    if (!was || ms(r.at) >= ms(was.at)) latest.set(target, { target, key: r.key || null, version: r.version, from: r.from || null, why: r.why || null, at: r.at, pr: r.pr || null });
  }
  const covers = (i, target) => (Array.isArray(i.targets) ? i.targets.includes(target) : target === 'user' && (!i.scope || i.scope === 'user'));
  const now = Array.isArray(installs) ? installs.map((i) => (typeof i === 'string' ? { target: i, version: null } : i)).filter((i) => i && i.target) : null;
  // a refusal names the plugin key it was refused for ('<name>@<marketplace>'), and only that key's
  // installs settle it: a same-named plugin from another marketplace at a higher version never does. A
  // refusal from before keys were recorded is matched only while the record holds one key for the name;
  // with two it cannot be told apart and stands (rv-167-delivery-lead-14)
  const keys = now ? new Set(now.map((i) => i.key || null)) : new Set();
  const ambiguous = (r) => !r.key && keys.size > 1;
  const mine = (r) => now.filter((i) => i.target === r.target && (!r.key || i.key === r.key));
  // compare is null for a version it cannot read: only 0 or 1 (at or past the refused one) settles it
  const atOrPast = (a, b) => [0, 1].includes(compare(String(a), String(b)));
  const caughtUp = (r) => mine(r).some((i) => i.version && atOrPast(i.version, r.version));
  return [...latest.values()].filter((r) => !now || ambiguous(r) || (mine(r).length > 0 && !caughtUp(r))).filter((r) => !ups.some((i) => i.result === 'installed' && ms(i.at) > ms(r.at) && covers(i, r.target) && atOrPast(i.version, r.version)));
}

// The pull requests the review records show waiting on the Delivery Manager, read without gh: { pr,
// state, beads, last, at }. A chain that cannot be read is named in parts, never read as nothing waiting.
function managerPrs(root, parts) {
  const out = [];
  let R;
  try { R = require('./reviews.js'); } catch (err) { parts.push(`the review records (${String(err.message).split('\n')[0]})`); return out; }
  for (const pr of R.listPrs(root)) {
    try {
      const r = R.read(root, pr);
      if (r.problem) { parts.push(`the review record of PR ${pr} (${r.problem})`); continue; }
      const req = R.lastRequest(r.rows);
      if (!req) continue;
      const state = R.stateOf(r.rows, null);
      const last = r.rows[r.rows.length - 1];
      if (MANAGER_STEP[state]) out.push({ pr: Number(pr), state, beads: Array.isArray(req.beads) ? req.beads : [], last: (last && last.id) || null, at: (last && last.at) || null });
    } catch (err) { parts.push(`the review record of PR ${pr} (${String(err.message).split('\n')[0]})`); }
  }
  return out;
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
const isHandover = (s) => s.kind === 'message' || s.kind === 'handoff' || s.kind === 'assigned' || s.kind === 'review' || s.kind === 'started' || s.kind === 'unclaimed';
// a standing condition, not a new handover: assigned work, and an idle builder's ready story (hjx.1.6.12),
// are paced five minutes apart with their own day and backoff, or they would re-wake a role every pass
const standing = (s) => s.kind === 'assigned' || s.kind === 'unclaimed';
// never held by a daily cap: a merge's deploy, a deploy's check, a send-back to its author, and the
// Delivery Manager's own waiting merge or review (bqj), each bounded by the record's new rows
const uncapped = (s) => s.kind === 'handoff' || s.kind === 'review' || s.kind === 'manager';
const assignedOnly = (r) => (r.keys || []).length > 0 && r.keys.every((k) => /^(assigned|unclaimed):/.test(String(k)));
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
    const cap = capsOf(w.target);
    const last = mine[mine.length - 1];
    const lines = w.stalls.map((s) => s.line);
    // work waiting on the Delivery Manager is a handover the first time a wake would carry it (bqj): its
    // stopped session is restarted at once, within the cycle; after that it is a stall like any other
    const carried = new Set(mine.flatMap((r) => r.keys || []));
    const isHandoff = (s) => isHandover(s) || (s.kind === 'manager' && !carried.has(s.key));
    // a message is a handoff, not a stall: its target is woken at once, not at the stall's hour
    const onlyMessages = w.stalls.every((s) => isHandoff(s));
    let reason = null;
    // hjx.1.3: the handovers that go now, and those held with their cause. A message or a handoff row is
    // new (each is handed over once, when its wake starts), so it waits only for a wake still running
    // (whose end kicks the next run, lib/kick.js); the five-minute gap holds a wake that would carry
    // assigned work alone, a standing condition that would otherwise re-wake a role every pass. A handoff
    // row (a merge's deploy, a deploy's check) is never held by a daily cap: merges and deploys bound it.
    const day = (f) => mine.filter((r) => f(r) && t - ms(r.at) < 24 * 3600e3);
    const handover = (items) => {
      if (last && alive(last.pid)) return { go: [], holds: [{ items, why: 'its last wake is still running; it is woken again when that wake ends' }] };
      if (items.every(standing) && last && t - ms(last.at) < MESSAGE_EVERY_MS) return { go: [], holds: [{ items, why: `woken at ${clock(ms(last.at))}; assigned work waits ${MESSAGE_EVERY_MS / 60000} min between wakes` }] };
      const holds = [];
      // the message day counts every wake but those for assigned work alone (6z5)
      const messagesFull = day((r) => !assignedOnly(r)).length >= cap.messages;
      const asg = items.filter(standing);
      const rest = items.filter((s) => !standing(s));
      const go = rest.filter((s) => uncapped(s) || !messagesFull);
      if (go.length < rest.length) holds.push({ items: rest.filter((s) => !go.includes(s)), why: `woken ${cap.messages} times in a day; alarm only until the count falls` });
      if (!asg.length) return { go, holds };
      // assigned work rides any wake that goes; alone, it waits out its own backoff and its own day
      if (go.length) return { go: [...go, ...asg], holds };
      if (day(assignedOnly).length >= cap.assigned) return { go, holds: [...holds, { items: asg, why: `woken ${cap.assigned} times in a day for assigned work alone; alarm only until the count falls` }] };
      const backoff = (s) => {
        const k = mine.filter((r) => (r.keys || []).includes(s.key) && t - ms(r.at) < 24 * 3600e3);
        return k.length > 0 && t - ms(k[k.length - 1].at) < MESSAGE_EVERY_MS * 2 ** (k.length - 1);
      };
      const due = asg.filter((s) => !backoff(s));
      if (due.length < asg.length) holds.push({ items: asg.filter((s) => !due.includes(s)), why: 'woken for this assigned work already; waiting longer before the next try' });
      return { go: due, holds };
    };
    const holdAll = (g) => { for (const h of g.holds) held.push({ target: w.target, lines: h.items.map((s) => s.line), reason: h.why }); };
    const handoverWake = (go) => ({ target: w.target, keys: go.map((s) => s.key), lines: go.map((s) => s.line), delivers: deliversOf(go), handoffs: handoffsOf(go), prompt: wakePrompt(go.map((s) => s.prompt), 'did') });
    if (onlyMessages) {
      const g = handover(w.stalls);
      if (g.go.length) wakes.push(handoverWake(g.go));
      holdAll(g);
      continue;
    }
    // the stall gates count stall wakes only: a role woken often for messages is still told about its
    // stall (each message wake would otherwise push "one wake an hour" forward and fill the day's six)
    // a start's first turn and an idle builder's ready item are handovers (isHandover) with their own pacing,
    // so they spend none of the stall budget either (rv-190)
    const stallRows = mine.filter((r) => (r.keys || []).some((k) => !/^(message|handoff|assigned|review|started|unclaimed):/.test(String(k))));
    const lastStall = stallRows[stallRows.length - 1];
    if (last && alive(last.pid)) reason = 'its last wake is still running';
    else if (lastStall && t - ms(lastStall.at) < WAKE_EVERY_MS) reason = `woken at ${clock(ms(lastStall.at))}; one wake an hour`;
    else if (stallRows.filter((r) => t - ms(r.at) < 24 * 3600e3).length >= cap.daily) reason = `woken ${cap.daily} times in a day; alarm only until the count falls`;
    // each stall waits 1, 2, 4 ... hours after each wake that carried it. A handover (message, handoff,
    // assigned work) is not a stall and goes by the message rules: a stall wake that goes out carries it,
    // or it would be dropped from the wake with no held line (Copilot 4436815462)
    const ok = reason ? [] : w.stalls.filter((s) => {
      if (isHandoff(s)) return true;
      const k = mine.filter((r) => (r.keys || []).includes(s.key) && t - ms(r.at) < 7 * 24 * 3600e3);
      return !k.length || t - ms(k[k.length - 1].at) >= WAKE_EVERY_MS * 2 ** (k.length - 1);
    });
    // a wake that would carry only messages is not a stall wake: it goes by the message rules below
    // (handover(): new handovers now, assigned work five minutes apart, 48 a day), or a stall still
    // waiting out its backoff would let assigned work wake the role every minute through this path
    if (!reason && !ok.some((s) => !isHandoff(s))) reason = 'woken for these already; waiting longer before the next try';
    // A message waiting beside a held stall is still a handoff: a role that spent its stall wakes (or
    // was woken for the stall within the hour) gets its messages by the message rules, not left until
    // the stall count falls. Seen on a real team: the Delivery Manager's work waited hours behind its cap.
    const msgs = w.stalls.filter((s) => isHandoff(s));
    if (reason && msgs.length) {
      // the stall's own cap or hour never holds a handover back (hjx.1.3): each line says its own cause
      const g = handover(msgs);
      if (g.go.length) wakes.push(handoverWake(g.go));
      holdAll(g);
      const rest = w.stalls.filter((s) => !isHandoff(s));
      if (rest.length) held.push({ target: w.target, lines: rest.map((s) => s.line), reason });
      continue;
    }
    if (reason) { held.push({ target: w.target, lines, reason }); continue; }
    // the messages a stall wake carries are handed over too, so the next run does not send them again
    wakes.push({ target: w.target, keys: ok.map((s) => s.key), lines: ok.map((s) => s.line), delivers: deliversOf(ok), handoffs: handoffsOf(ok), prompt: wakePrompt(ok.map((s) => s.prompt), 'started') });
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
// installed: the plugin version running now. A session that last ran an older one is woken fresh too:
// its conversation names that version's script paths, which the lane refuses after the install
// (delivery-plugin-planning-8wz). A wake still running is never stopped; the next one starts fresh.
const FRESH_ABOVE = 120000;
// prefix: the team's bead prefix; the fresh session is named <instance>@<team> (lib/session-name.js)
function wakeCommand(s, prompt, live, mode = 'auto', { freshAbove = FRESH_ABOVE, installed = null, prefix = null } = {}) {
  const m = mode && mode !== 'default' ? ['--permission-mode', mode] : [];
  const r = wakeArgs(s, prompt, live);
  const older = Boolean(installed) && require('./plugin-version.js').compare(s && s.pluginVersion, installed) === -1;
  if (r.mode === 'resume' && (older || (freshAbove > 0 && Number.isFinite(s.context) && s.context > freshAbove))) {
    // named like every role session (start.js --name), so peers reach it by name (team rule 13)
    const name = require('./session-name.js').sessionName(s.instance, prefix);
    return { mode: 'fresh', why: older ? 'plugin' : 'context', args: [...m, '--name', name, '-p', freshPrompt(s, prompt, older ? installed : null)] };
  }
  return r.args ? { ...r, args: [...m, ...r.args] } : r;
}

// the capture hook tells a wake from a typed prompt only by its opening words, so the fresh
// session's preamble goes after them, never before
function freshPrompt(s, prompt, installed = null) {
  const lead = `${WAKE_OPENING}: `;
  const rest = String(prompt).startsWith(lead) ? String(prompt).slice(lead.length) : String(prompt);
  return `${lead}${freshPreamble(s, installed)} ${rest}`;
}

function freshPreamble(s, installed = null) {
  // the Chief of Staff's Stop guard checks unrecorded operator input per session: a fresh session
  // would not be held for input left in the old one, so it is told to look
  const operator = s.role === 'chief-of-staff' ? ' Check first for operator input still unrecorded (operator.js pending) and record it.' : '';
  const why = installed ? `ran the delivery plugin ${s.pluginVersion}, and ${installed} is installed now, so its script paths are stale` : `(${Math.round(s.context / 1000)}k tokens) is not loaded, so each turn stays light`;
  return `You are ${s.instance}, starting a fresh session: your earlier conversation ${installed ? `is not loaded: it ${why}` : why}.`
    + ` Your brief and the team's records are your memory: start with your own in-progress beads (bd list --assignee "$BEADS_ACTOR" --status in_progress) and their notes, and the files they name.${operator}`;
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

module.exports = { reviveStarts, START_SETTLE_MIN, START_FRESH_H, MANAGER_STEP, managerPrs, refusedInstalls, MANAGER_DAILY_CAP, MANAGER_MESSAGE_DAILY_CAP, ASSIGNED_DAILY_CAP, MANAGER_ASSIGNED_DAILY_CAP, reviewFacts, capsOf, ASSIGNED_IDLE_MIN, WAKE_OPENING, wakePrompt, withA3s, FRESH_ABOVE, contextOf, MESSAGE_EVERY_MS, MESSAGE_DAILY_CAP, WAKE_TIMEOUT_H, REL, P0_HOURS, WAKE_EVERY_MS, DAILY_CAP, RESET_GRACE_MIN, MIN_POLL_S, LOG_MAX_BYTES, tailRows, limitOf, waitingUntil, tightPolls, pollEvery, sessions, stalls, pollWarnings, recordAll, read, plan, wakeCommand, log, logRows, rotate, ensureDir, installedJob, installedFile, pidAlive, clock, span };
