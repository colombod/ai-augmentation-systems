// scripts/lib/role-watch.js — the Delivery Manager's pass over the role instances holding work.
//
// A builder once spent its whole daily wake budget on beads that sat waiting for a review, so the
// review that came back for it went unread for over an hour, while merges queued on a quiet manager.
// The watchdog wakes sessions one at a time; nothing read the team as a whole and said who is stuck
// and what the Delivery Manager does about it (dec-chief-of-staff-000264, 000266). A pass does, in
// this order:
//   1. what waits on the Delivery Manager itself comes first: a handoff or message for it, a pull
//      request it has to get reviewed, merge or send back, a shipped bead it has to deploy or check.
//      A builder whose pull request sits in review is not stuck: that wait is the manager's own.
//   2. each instance with a bead in progress: is its session up, did its beads change within
//      stall_hours, and the count of today's wakes that found nothing to do.
//   3. one action for each instance that fails a check, and for the team when every builder is stuck
//      and top-priority work is ready (add a builder through Staffing's roster command, 000265).
// Data it cannot read is said so, never shown as healthy. `record` keeps the pass in the watchdog's
// directory (passes.ndjson) and writes the action and its reason as a note on the held bead, once
// per change of action, so a stall the owner's briefing shows always has the note beside it.
const fs = require('fs');
const path = require('path');
const W = require('./watchdog.js');

const FILE = 'passes.ndjson';
// a session active this recently is running a turn (the watchdog's assigned-work rule uses the same gap)
const RUNNING_MIN = W.ASSIGNED_IDLE_MIN;
// wakes that found nothing to do: three in a day is a pattern, long before the 48-wake cap is spent
const WASTED_MAX = 3;
const DAY = 24 * 3600e3;
// the pull request states that wait on the Delivery Manager, not on the builder (lib/reviews.js stateOf)
const PR_DM = { waiting: 'get it reviewed (review.js request), then record the result', stale: 'ask for a review of its new head', changes: 'send it back to its owner (review.js send-back --reason changes)', failing: 'send it back to its owner (review.js send-back --reason ci)', passed: 'run the merge check and merge it (merge-gate.js check)', ready: 'merge it (merge-gate.js check, then gh pr merge)', damaged: 'restore its review record before anything merges' };

const ms = (x) => { const t = Date.parse(x); return Number.isNaN(t) ? -Infinity : t; };
const typeOf = (b) => b.type || b.issue_type || null;
const instanceOf = (assignee) => { const a = String(assignee || ''); return a.includes('/') ? a.split('/').pop() : a; };
// the bead a wake key names: assigned:<bead>, quiet:<bead>:<at>, evidence:<bead>:<at>
const beadOfKey = (k) => { const m = /^(assigned|quiet|evidence):([^:]+)/.exec(String(k || '')); return m ? m[2] : null; };

// facts: { now, dm, staffing, builders, beads, ready, sessions (lib/watchdog sessions()), wakes (wake rows),
// prs: [{ pr, state, beads, sentBackAt, note }], handoffs, messages, stallHours, alive, cap (budget.builders_cap), chief }
function pass({ now, dm = 'delivery-lead', staffing = 'staffing', chief = 'chief-of-staff', cap, builders = [], beads = [], ready = [], sessions = [], wakes = [], prs = [], handoffs = [], messages = [], stallHours = 2, alive = () => false, caps = W.capsOf } = {}) {
  const t = ms(now || new Date().toISOString());
  const byId = new Map(beads.filter(Boolean).map((b) => [b.id, b]));
  const G = require('./gates.js');
  const shipped = (b) => ['merged', 'deployed'].includes(G.stateOf(b));
  const openPrOf = (id) => prs.find((p) => p.state !== 'merged' && (p.beads || []).includes(id)) || null;

  // ---- 1. the Delivery Manager's own waiting work ----
  const own = [];
  const known = new Set(sessions.map((s) => s.instance));
  for (const h of handoffs.filter((r) => r && (r.to === dm || !known.has(r.to)))) own.push({ kind: 'handoff', ref: h.bead, line: `${h.bead}: ${h.step === 'deploy' ? `PR ${h.pr || '?'} is merged; deploy it and record it` : 'deployed; dispatch its reality check'}` });
  for (const m of messages.filter((x) => x && x.to === dm && x.entries && x.entries.length)) own.push({ kind: 'message', ref: m.to, line: `${m.entries.length} message${m.entries.length > 1 ? 's' : ''} waiting for you; read and act on them` });
  for (const p of prs.filter((x) => PR_DM[x.state])) own.push({ kind: 'pr', ref: `PR ${p.pr}`, line: `PR ${p.pr} (${(p.beads || []).join(', ') || 'no bead'}) is ${p.state}: ${PR_DM[p.state]}` });
  for (const b of beads.filter((x) => x && x.status === 'in_progress' && shipped(x)).filter((x) => !own.some((o) => o.ref === x.id))) own.push({ kind: 'evidence', ref: b.id, line: `${b.id} is ${G.stateOf(b)}: ${G.stateOf(b) === 'merged' ? 'deploy it and record it' : 'dispatch its reality check or record its evidence'}` });

  // ---- 2. every role instance holding in-progress work ----
  const holding = new Map();
  for (const b of beads.filter((x) => x && x.status === 'in_progress' && x.assignee && typeOf(x) !== 'epic')) {
    const i = instanceOf(b.assignee);
    if (!i || i === dm) continue;
    if (!holding.has(i)) holding.set(i, []);
    holding.get(i).push(b);
  }
  const instances = [];
  for (const [instance, held] of [...holding.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s = sessions.find((x) => x.instance === instance) || null;
    const mine = wakes.filter((r) => r && r.type === 'wake' && r.instance === instance).sort((a, b) => ms(a.at) - ms(b.at));
    const last = mine[mine.length - 1];
    const lastActive = s && Number.isFinite(s.lastActive) ? s.lastActive : -Infinity;
    const limit = s && s.limit && lastActive <= ms(s.limit.at) + 60e3 ? s.limit : null;
    const running = Boolean(s) && !limit && ((last && alive(last.pid)) || t - lastActive <= RUNNING_MIN * 60e3);
    // held work that waits on the Delivery Manager (a review, a merge, a deploy or a check) is not the holder's to move
    const onDm = held.filter((b) => shipped(b) || (openPrOf(b.id) && openPrOf(b.id).state !== 'sent-back'));
    const movable = held.filter((b) => !onDm.includes(b));
    const lastMove = Math.max(...held.map((b) => Math.max(ms(b.updated_at), ms(b.created_at))));
    const moving = Boolean(s && s.waitUntil > t) || t - lastMove <= stallHours * 3600e3;
    // a wake that named beads none of which was updated after it found nothing to do; message, handoff
    // and usage-limit wakes carry their own work and never count
    const today = mine.filter((r) => t - ms(r.at) < DAY);
    const wasted = today.filter((r) => {
      const named = (r.keys || []).map(beadOfKey).filter(Boolean);
      return named.length > 0 && named.every((id) => { const b = byId.get(id); return !b || ms(b.updated_at) < ms(r.at); });
    }).length;
    // a send-back the holder has not acted on since: a review result waiting for it
    const sentBack = prs.filter((p) => p.state === 'sent-back' && (p.beads || []).some((id) => held.some((b) => b.id === id)) && ms(p.sentBackAt) > Math.max(lastMove, lastActive));
    // held work quiet past stall_hours that only the manager can move: the watchdog raises it as a quiet
    // stall, so the pass names it too, and the note beside it says the wait is the manager's
    const quietOnDm = onDm.filter((b) => t - Math.max(ms(b.updated_at), ms(b.created_at)) > stallHours * 3600e3);
    const fails = [];
    if (!s) fails.push('not on this host\'s roster');
    if (limit) fails.push(`stopped on the usage limit${limit.resetsAt ? `, resumes ${W.clock(ms(limit.resetsAt))}` : ', reset time unknown'}`);
    if (sentBack.length) fails.push(`a review result waits for it (PR ${sentBack.map((p) => p.pr).join(', ')} sent back)`);
    if (wasted >= WASTED_MAX) fails.push(`${wasted} wakes today found nothing to do (cap ${caps(instance).messages})`);
    if (movable.length && !moving && !limit) fails.push(`nothing moved for ${W.span((t - lastMove) / 60000)} (limit ${stallHours} h)`);
    // only when nothing else fails: any other failure already notes every held bead
    const quietOnly = !fails.length && quietOnDm.length > 0;
    if (quietOnly) fails.push(`${quietOnDm.map((b) => b.id).join(', ')} wait on ${dm} past ${stallHours} h`);
    instances.push({ instance, beads: held.map((b) => b.id), onDm: onDm.map((b) => b.id), quietOnDm: quietOnDm.map((b) => b.id), quietOnly, movable: movable.map((b) => b.id), running, moving, wasted, wakesToday: today.length, limit, sentBack, fails });
  }

  // ---- 3. one action for each failing instance, and the team's ----
  const top = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).some((b) => Number(b.priority) === 0);
  const busy = new Set(instances.map((x) => x.instance));
  const free = builders.filter((i) => !busy.has(i) && !(sessions.find((s) => s.instance === i) || {}).limit);
  for (const x of instances.filter((y) => y.fails.length)) x.action = actionOf(x, { free, top, dm });
  const p0 = ready.filter((b) => b && Number(b.priority) === 0 && !b.assignee && typeOf(b) !== 'epic' && !shipped(b));
  const holdingBuilders = instances.filter((x) => builders.includes(x.instance));
  let team = null;
  if (p0.length && free.length) team = { kind: 'assign', bead: p0[0].id, to: free[0], why: `top-priority ${p0[0].id} is ready and ${free[0]} holds no work`, command: `bd update ${p0[0].id} --assignee <actor>/${free[0]}, then message ${free[0]} (--record does both)` };
  // a builder whose only failure is work waiting on the manager is not stuck: that wait is the manager's,
  // and another builder would only queue behind the same review
  else if (p0.length && builders.length && holdingBuilders.length === builders.length && holdingBuilders.every((x) => x.fails.length && !x.quietOnly)) {
    const why = `every builder (${builders.join(', ')}) holds stuck work and top-priority ${p0[0].id} is ready`;
    // at budget.builders_cap the roster command refuses: raising the cap is the owner's, asked once through the Chief of Staff
    if (Number.isFinite(Number(cap)) && cap !== null && builders.length + 1 > Number(cap)) team = { kind: 'raise-cap', bead: p0[0].id, count: builders.length + 1, to: chief, why: `${why}, and builders_cap ${cap} is reached`,
      command: `Message ${chief} once: one more builder needs the owner to raise builders_cap to ${builders.length + 1} (team-role.js set-cap builders ${builders.length + 1} --record <dec-id>) (--record queues the message)` };
    else team = { kind: 'add-builder', bead: p0[0].id, count: builders.length + 1, to: staffing,
      why, command: `Message ${staffing} to add one with its roster command (approved, dec-chief-of-staff-000265; the owner is not asked): node \${CLAUDE_PLUGIN_ROOT}/scripts/team-role.js add builder --count ${builders.length + 1}; then assign ${p0[0].id} to the new builder (--record queues the message; the pass after the builder registers assigns it)` };
  }
  return { at: new Date(t).toISOString(), dm, own, instances, team };
}

// the one action for an instance that fails a check, most specific first
function actionOf(x, { free, top, dm }) {
  if (x.limit) {
    const moveTo = top(x.movable) && free.length ? free[0] : null;
    return moveTo ? { kind: 'reassign', beads: x.movable, to: moveTo, why: `it is stopped on the usage limit and holds top-priority work; ${moveTo} is free` }
      : { kind: 'report', beads: x.beads, why: `stopped on the usage limit; it is not restarted, the watchdog resumes it ${x.limit.resetsAt ? `at ${W.clock(ms(x.limit.resetsAt))}` : 'once the reset is known'}` };
  }
  if (x.sentBack.length) {
    const p = x.sentBack[0];
    return { kind: 'unblock', beads: p.beads.filter((id) => x.beads.includes(id)), pr: p.pr, why: `PR ${p.pr} was sent back${p.note ? ` (${p.note})` : ''} and ${x.instance} has not taken it`,
      message: `PR ${p.pr} was sent back to you${p.note ? `: ${p.note}` : ''}. Fix it on your branch, push, and tell ${dm}; a new review follows.` };
  }
  if (x.wasted >= WASTED_MAX && x.onDm.length) return { kind: 'note-block', beads: x.onDm, why: `${x.instance} is woken for work that waits on ${dm} (${x.onDm.join(', ')}); ${dm} moves it, so the wakes stop` };
  if (x.quietOnly) return { kind: 'note-block', beads: x.quietOnDm, why: `${x.quietOnDm.join(', ')} wait${x.quietOnDm.length > 1 ? '' : 's'} on ${dm}, not on ${x.instance}; ${dm} takes it from its own list first` };
  if (!x.running && !x.moving) return { kind: 'restart', beads: x.movable.length ? x.movable : x.beads, why: `${x.instance} is not running and its work has not moved; start it on ${x.movable[0] || x.beads[0]}` };
  const moveTo = free[0] || null;
  if (moveTo && x.movable.length) return { kind: 'reassign', beads: x.movable, to: moveTo, why: `${x.instance} is not moving its work; ${moveTo} is free` };
  return { kind: 'raise', beads: x.movable.length ? x.movable : x.beads, why: `${x.fails.join('; ')}; no builder is free, so it goes to the Chief of Staff once, by message, with this note as the record` };
}

// ---- reading the record ----
function prsOf(root) {
  const R = require('./reviews.js');
  return R.listPrs(root).map((pr) => {
    const { rows, problem } = R.read(root, pr);
    const req = R.lastRequest(rows);
    const sent = [...rows].reverse().find((r) => r.type === 'sent-back') || null;
    return { pr: Number(pr), state: problem ? 'damaged' : R.stateOf(rows, null), beads: (req && req.beads) || [], sentBackAt: sent && sent.at, note: sent && sent.note };
  });
}

// facts from the project's record, or { unreadable } with what could not be read
function read(root, { bd, now, team, rows } = {}) {
  try {
    const M = require('./manifest.js');
    const t = team || M.loadManifest(root).team;
    const expanded = M.expandInstances(t);
    const dm = (expanded.find((i) => i.role.id === 'delivery-lead') || {}).instance || 'delivery-lead';
    const staffing = (expanded.find((i) => i.role.id === 'staffing' && !i.role.retired) || {}).instance || 'staffing';
    const chief = (expanded.find((i) => i.role.id === 'chief-of-staff' && !i.role.retired) || {}).instance || 'chief-of-staff';
    const cap = t.budget && t.budget.builders_cap !== undefined ? t.budget.builders_cap : undefined;
    const builders = expanded.filter((i) => i.role.id === 'builder' && !i.role.retired).map((i) => i.instance);
    const beads = bd.list({ all: true }) || [];
    const ready = bd.ready() || [];
    return { now, dm, staffing, chief, cap, builders, beads, ready, sessions: W.sessions(root, { team: t, rows }), wakes: W.logRows(root).filter((r) => r.type === 'wake'), prs: prsOf(root),
      handoffs: require('./handoff.js').pending(root), messages: require('./inbox.js').pending(root), stallHours: require('./goal.js').value(root, 'stall_hours'), alive: W.pidAlive };
  } catch (err) { return { unreadable: String(err.message).split('\n')[0] }; }
}

// ---- the pass in lines: the Delivery Manager's own work first, then each instance ----
function lines(res) {
  if (res.unreadable) return [`The record could not be read (${res.unreadable}): no role instance is reported healthy. Check: bd where, then watchdog.js pass again.`];
  const out = [`Pass at ${res.at}`];
  out.push(res.own.length ? `1. Yours first (${res.own.length}):` : '1. Yours first: nothing waits on you.');
  out.push(...res.own.map((o) => `   - ${o.line}`));
  out.push(res.instances.length ? `2. Role instances holding work (${res.instances.length}):` : '2. Role instances holding work: none.');
  for (const x of res.instances) {
    out.push(`   - ${x.instance}: running ${x.running ? 'yes' : 'no'}, moving ${x.moving ? 'yes' : 'no'}, wasted wakes ${x.wasted} of ${x.wakesToday} today; holds ${x.beads.join(', ')}${x.onDm.length ? ` (waiting on you: ${x.onDm.join(', ')})` : ''}`);
    if (x.action) out.push(`     fails: ${x.fails.join('; ')}`, `     action: ${x.action.kind}${x.action.to ? ` to ${x.action.to}` : ''}: ${x.action.why}${x.action.message ? `. Message ${x.instance}: "${x.action.message}"` : ''}`);
  }
  if (res.team) out.push(`3. Team: ${res.team.kind}: ${res.team.why}. ${res.team.command}`);
  return out;
}

// ---- recording: the pass row, and a note on each held bead an action names (once per change) ----
const file = (root) => path.join(root, W.REL, FILE);
function previous(root) {
  let text = '';
  try { text = fs.readFileSync(file(root), 'utf8'); } catch (err) { return []; }
  const out = [];
  // a torn line (two writers, a crash) is skipped: one bad row never hides the rest
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch (err) { /* skipped */ } }
  return out;
}
// the same action on the same beads for the same reasons is noted once; a count in a reason may grow
const actionKey = (x) => (x.action ? `${x.action.kind}:${x.action.to || ''}:${(x.action.beads || []).join(',')}:${x.fails.map((f) => f.replace(/\d+(\.\d+)?/g, 'n')).join('|')}` : null);
// the team's action, once per change: the same kind on the same bead to the same instance
const teamKey = (t) => (t ? `${t.kind}:${t.bead}:${t.to || ''}:${t.count || ''}` : null);
// the bead's assignee for an instance, in the recording actor's form (<user>@<host>/<instance>)
const assigneeFor = (actor, to) => (actor ? `${String(actor).replace(/\/[^/]*$/, '')}/${to}` : to);
function record(root, res, { bd, actor } = {}) {
  if (res.unreadable) return { noted: [] };
  const dm = res.dm || 'delivery-lead';
  const before = previous(root);
  const lastFor = (i) => { for (let k = before.length - 1; k >= 0; k--) { const r = (before[k].instances || []).find((x) => x.instance === i); if (r) return r; } return null; };
  const noted = [];
  for (const x of res.instances.filter((y) => y.action)) {
    const prev = lastFor(x.instance);
    if (prev && prev.key === actionKey(x)) continue;
    const text = `${res.at.slice(0, 10)} ${dm} pass: ${x.instance} fails (${x.fails.join('; ')}); action ${x.action.kind}${x.action.to ? ` to ${x.action.to}` : ''}: ${x.action.why}`;
    // on every bead it holds: whichever of them a stall line names, the note is beside it
    for (const id of x.beads) {
      try { bd.update(id, { appendNotes: text }); noted.push(id); } catch (err) { /* the pass row still records the action */ }
    }
  }
  // the team's action is carried out, not only printed: a free builder is assigned the top-priority bead
  // and told; with every builder stuck, Staffing (the one lane that runs the roster command) is sent the
  // command to add one, and the pass after the new builder registers assigns the bead to it (TR-6)
  let teamDone = null;
  // against the last row that carried a team action: a quiet pass in between does not queue it again
  const lastTeam = (before.slice().reverse().find((r) => r.teamKey) || {}).teamKey || null;
  if (res.team && teamKey(res.team) !== lastTeam) {
    const T = res.team;
    const I = require('./inbox.js');
    try {
      if (T.kind === 'assign') {
        bd.update(T.bead, { assignee: assigneeFor(actor, T.to), appendNotes: `${res.at.slice(0, 10)} ${dm} pass: assigned to ${T.to}: ${T.why}` });
        I.queue(root, { to: T.to, from: dm, summary: `${T.bead} assigned to you`, message: `${dm} here: top-priority ${T.bead} is assigned to you (${T.why}). Claim it and build it.`, at: res.at });
      } else if (T.kind === 'raise-cap') {
        bd.update(T.bead, { appendNotes: `${res.at.slice(0, 10)} ${dm} pass: ${T.why}; asked ${T.to} once for the owner to raise builders_cap to ${T.count}` });
        I.queue(root, { to: T.to, from: dm, summary: `builders_cap for ${T.bead}`, message: `${dm} here: ${T.why}. One more builder needs the owner to raise builders_cap to ${T.count} (team-role.js set-cap builders ${T.count} --record <dec-id>); please put it in the owner queue once. Staffing adds the builder after it.`, at: res.at });
      } else if (T.kind === 'add-builder') {
        bd.update(T.bead, { appendNotes: `${res.at.slice(0, 10)} ${dm} pass: ${T.why}; asked ${T.to} to add builder ${T.count} through its roster command; the pass after it registers assigns this bead` });
        I.queue(root, { to: T.to, from: dm, summary: `add a builder for ${T.bead}`, message: `${dm} here: ${T.why}. Add one builder with your roster command (approved, dec-chief-of-staff-000265): node \${CLAUDE_PLUGIN_ROOT}/scripts/team-role.js add builder --count ${T.count}. My next pass assigns ${T.bead} to it.`, at: res.at });
      }
      teamDone = T.kind;
      noted.push(T.bead);
    } catch (err) { /* the pass row keeps the action; the next pass tries again */ }
  }
  W.ensureDir(root);
  const row = { type: 'pass', at: res.at, own: res.own.map((o) => `${o.kind}:${o.ref}`), team: res.team, teamKey: !res.team ? null : teamDone ? teamKey(res.team) : lastTeam,
    instances: res.instances.map((x) => ({ instance: x.instance, beads: x.beads, running: x.running, moving: x.moving, wasted: x.wasted, fails: x.fails, action: x.action || null, key: actionKey(x) })) };
  W.rotate(file(root));
  fs.appendFileSync(file(root), `${JSON.stringify(row)}\n`);
  return { noted, row, team: teamDone };
}

module.exports = { FILE, RUNNING_MIN, WASTED_MAX, pass, actionOf, read, lines, record, previous, prsOf, file };
