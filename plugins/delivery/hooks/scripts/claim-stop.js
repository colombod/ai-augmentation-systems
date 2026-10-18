#!/usr/bin/env node
// Stop: capture the operator's words first (operator-capture.js; never affects the decision), then
// collect every applicable reason: the Chief of Staff's operator checks (relay-guard.js: an
// unrecorded input of its own session or a broken own records chain, and a request that the
// operator relay something) and the claim note (turn.js: a session holding a claim leaves a note).
// turn.composeStop joins them into one block, each kind at most once per turn and never a third
// blocking stop, so a relay request is not masked by another reason and the hook cannot loop.
// With the typed judge on, relay_request is asked first (2 s timeout) and the regex is the fallback.
// Block JSON or nothing; exit 0.
const path = require('path');

// Every role and instance id in the manifest is a party the operator could be asked to reach.
function partiesOf(valid) {
  try {
    const { expandInstances } = require('../../scripts/lib/manifest.js');
    const out = new Set();
    for (const i of expandInstances(valid.team)) { out.add(i.instance); if (i.role && i.role.id) out.add(i.role.id); }
    return [...out];
  } catch (err) { return []; }
}

// The judge summary kept in the stop state: what it answered, or why it did not.
function judgeSummary(j) {
  if (!j) return null;
  const keep = ['question', 'version', 'model', 'answer', 'p', 'latencyMs', 'skipped', 'error', 'reason', 'regex'];
  return Object.fromEntries(keep.filter((k) => j[k] !== undefined).map((k) => [k, j[k]]));
}

// true at most once every 10 minutes per role directory (the stamp is the file's mtime)
function idleCheckDue(roleDir) {
  const f = path.join(roleDir, '.delivery-idle-check');
  try { if (Date.now() - require('fs').statSync(f).mtimeMs < 10 * 60e3) return false; } catch (e) { /* first time */ }
  try { require('fs').writeFileSync(f, `${new Date().toISOString()}\n`); } catch (e) { /* run anyway */ }
  return true;
}

// every bd read takes its timeout from turn.js stopBudget (12 s deadline; the idle check needs 4 s left)
const T0 = Date.now();
const budget = () => require('./turn.js').stopBudget(Date.now() - T0);

async function main() {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor, JUDGE_REMINDER, MESSAGE_REMINDER } = require('./role-context.js');
  const input = readHookInput();
  let cap = null;
  try {
    const { captureFromHookInput } = require('./operator-capture.js');
    cap = captureFromHookInput(input, path.join(__dirname, '..', '..'));
    if (cap && cap.problem) process.stderr.write(`delivery: ${cap.problem}\n`);
  } catch (err) { /* capture never affects the stop decision */ }
  let valid = null;
  try { valid = input ? validMarker(findRoleMarker(input.cwd)) : null; } catch (err) { valid = null; }
  if (valid) {
    const { operatorChecks, judgeRelay } = require('./relay-guard.js');
    const { decideStop, composeStop, relayBudgetSpent } = require('./turn.js');
    const candidates = [];
    const parties = partiesOf(valid);
    let judged = null;
    let overruled = false;
    const M = require('./message-checks.js');
    const jargs = { input, team: valid.team, role: valid.role.id, retired: !!valid.role.retired, projectRoot: valid.marker.project_root, parties };
    let msgJudged = {};
    const msgCandidates = [];
    try {
      // the typed judge, when enabled (manifest judge block and its key variable); null otherwise.
      // Nothing is sent when this turn can no longer block; the message questions (orders, tone,
      // jargon) are asked at the same time as the relay question.
      const spent = relayBudgetSpent({ input, roleDir: valid.roleDir });
      [judged, msgJudged] = spent ? [null, {}] : await Promise.all([judgeRelay(jargs).catch(() => null), M.judgeMessage(jargs).catch(() => ({}))]);
    } catch (err) { judged = null; }
    try {
      // what the message tells the owner (R-03, R-44, R-45): an out-of-queue order may block once; the rest warns
      const root = valid.marker.project_root;
      const turn = require('../../scripts/lib/transcript.js').currentTurn(input.transcript_path);
      const found = M.messageFindings({ message: input.last_assistant_message, owner: turn.owner, commands: turn.commands, role: valid.role.id,
        judged: msgJudged || {}, openSteps: require('../../scripts/lib/owner-queue.js').open(root), briefingLines: require('../../scripts/lib/goal.js').value(root, 'briefing_lines'),
        prefix: valid.team.prefix, parties, queueCmd: `node ${require('../../scripts/lib/plugin-root.js').shellPath(path.join(__dirname, '..', '..', 'scripts', 'owner-queue.js'))}` });
      if (!valid.role.retired) msgCandidates.push(...found.candidates);
      const W = require('../../scripts/lib/warnings.js');
      for (const w of found.warnings) W.record(root, { ...w, raisedBy: valid.marker.instance, instance: valid.marker.instance });
      const text = M.reminderText(found.warnings);
      if (text) { try { require('fs').writeFileSync(path.join(valid.roleDir, MESSAGE_REMINDER), text); } catch (e) { /* best effort */ } }
    } catch (err) { /* the message checks fail open */ }
    try {
      const found = operatorChecks({ input, roleDir: valid.roleDir, projectRoot: valid.marker.project_root, role: valid.role.id,
        instance: valid.marker.instance, captureStatus: cap && cap.status, parties, pluginRoot: path.join(__dirname, '..', '..'), retired: !!valid.role.retired, judged, deps: { warn: (m) => process.stderr.write(m) } });
      candidates.push(...found.filter((c) => !c.advisory));
      // an overruled regex hit is recorded in the judge log; a warning-band answer is said once on the next prompt
      for (const c of found.filter((x) => x.advisory && x.record)) {
        overruled = true;
        try {
          const judge = require('../../scripts/lib/judge.js');
          judge.writeLog(judge.logDirOf(valid.marker.project_root), { time: new Date().toISOString(), advisory: true, event: 'regex_overruled', question: 'relay_request', version: judged && judged.version, gate: 'relay-guard', p: c.p });
        } catch (e) { /* best effort */ }
      }
      const advisory = found.filter((c) => c.advisory && !c.record).map((c) => c.reason).join('\n');
      if (advisory) { try { require('fs').writeFileSync(path.join(valid.roleDir, JUDGE_REMINDER), advisory); } catch (e) { /* best effort */ } }
    } catch (err) { /* the operator checks fail open */ }
    // a relay block already says it: an order to the owner in the same message is not said twice
    candidates.push(...msgCandidates.filter((c) => !(c.kind === 'orders' && candidates.some((x) => x.kind === 'relay'))));
    try {
      const { makeBd } = require('../../scripts/lib/bd.js');
      // composeStop limits repeats, so the claim check runs on a continuation too
      const claim = decideStop({ input: { ...input, stop_hook_active: false }, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd({ ...bdOptionsFor(valid.marker, input.cwd), timeoutMs: budget().claimMs }) });
      // a missing claim note is a reminder for the next prompt, not a block (A2)
      if (claim) { try { require('fs').writeFileSync(path.join(valid.roleDir, require('./role-context.js').CLAIM_REMINDER), `Reminder: ${claim.reason}`); } catch (e) { /* best effort */ } }
    } catch (err) { /* allow */ }
    // idle with ready work (R-43), for the two roles that start work: a warning and a reminder, never a
    // block. At most every 10 minutes per role (two bd reads), so the stop stays inside its timeout.
    if (['chief-of-staff', 'delivery-lead'].includes(valid.role.id) && !valid.role.retired && !input.stop_hook_active && budget().idle && idleCheckDue(valid.roleDir)) {
      try {
        const I = require('../../scripts/lib/idle.js');
        const { makeBd } = require('../../scripts/lib/bd.js');
        const s = I.readIdle(valid.marker.project_root, { bd: makeBd({ ...bdOptionsFor(valid.marker, input.cwd), timeoutMs: budget().idleMs }), deadline: T0 + require('./turn.js').IDLE_DEADLINE_MS });
        if (s.idle) {
          I.recordIdle(valid.marker.project_root, s, { instance: valid.marker.instance });
          const f = path.join(valid.roleDir, MESSAGE_REMINDER);
          let prev = '';
          try { prev = require('fs').readFileSync(f, 'utf8'); } catch (e) { /* none */ }
          require('fs').writeFileSync(f, `${I.idleLine(s)}${prev ? `\n${prev}` : ''}`);
        }
      } catch (err) { /* the idle check fails open */ }
    }
    const d = composeStop({ input, roleDir: valid.roleDir, candidates, judge: judged ? { ...judgeSummary(judged), ...(overruled ? { overruled: true } : {}) } : null });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
}

main().catch(() => { /* allow */ }).finally(() => process.exit(0));
