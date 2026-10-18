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

async function main() {
  const { readHookInput, findRoleMarker, validMarker, actorOf, bdOptionsFor, JUDGE_REMINDER } = require('./role-context.js');
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
    try {
      // the typed judge, when enabled (manifest judge block and its key variable); null otherwise
      // nothing is sent when this turn can no longer block a relay
      if (!relayBudgetSpent({ input, roleDir: valid.roleDir })) judged = await judgeRelay({ input, team: valid.team, role: valid.role.id, retired: !!valid.role.retired, projectRoot: valid.marker.project_root, parties });
    } catch (err) { judged = null; }
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
    try {
      const { makeBd } = require('../../scripts/lib/bd.js');
      // composeStop limits repeats, so the claim check runs on a continuation too
      const claim = decideStop({ input: { ...input, stop_hook_active: false }, roleDir: valid.roleDir, actor: actorOf(valid.marker), bd: makeBd(bdOptionsFor(valid.marker, input.cwd)) });
      // a missing claim note is a reminder for the next prompt, not a block (A2)
      if (claim) { try { require('fs').writeFileSync(path.join(valid.roleDir, require('./role-context.js').CLAIM_REMINDER), `Reminder: ${claim.reason}`); } catch (e) { /* best effort */ } }
    } catch (err) { /* allow */ }
    const d = composeStop({ input, roleDir: valid.roleDir, candidates, judge: judged ? { ...judgeSummary(judged), ...(overruled ? { overruled: true } : {}) } : null });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
}

main().catch(() => { /* allow */ }).finally(() => process.exit(0));
