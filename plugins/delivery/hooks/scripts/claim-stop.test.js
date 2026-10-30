// hooks/scripts/claim-stop.test.js — run with: node --test hooks/scripts/claim-stop.test.js
// The Stop hook composes: capture, then the chief of staff's operator checks, then the claim note.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');
const R = require('../../scripts/lib/operator-records.js');
const { relayReason, RELAY_REASON, RELAY_REASON_NO_RECORD } = require('./relay-guard.js');
// the relay reason quotes the flagged clause from the first block on
const NO_ID = (clause) => relayReason('', clause);
const WITH_ID = (clause) => relayReason('dec-1', clause);

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const SID = 'sess-stop-1';

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const human = (text, n) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2099-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID, message: { role: 'user', content: text },
});
function transcript(records) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stop-tr-')), `${SID}.jsonl`);
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}

// bd is kept off PATH so the claim-note check allows: only the operator checks can block here,
// unless binDir supplies a fake bd.
function runStop(instance, input, binDir) {
  const env = { ...process.env, DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PATH: `${binDir || fs.mkdtempSync(path.join(os.tmpdir(), 'stop-nobd-'))}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  delete env.DELIVERY_ROLE_DIR;
  return spawnSync(process.execPath, [path.join(__dirname, 'claim-stop.js')], { input: JSON.stringify({ session_id: SID, hook_event_name: 'Stop', stop_hook_active: false, ...input }), env, encoding: 'utf8' });
}
const reasonOf = (r) => (r.stdout ? JSON.parse(r.stdout) : null);

const COS_BY = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };
// a fake bd whose answer is read from a file, so a test can make the claim check fire or not
function fakeBd() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-bd-'));
  const answer = path.join(bin, 'answer.json');
  fs.writeFileSync(answer, '[]');
  fs.writeFileSync(path.join(bin, 'bd'), `#!/bin/sh\ncat '${answer}'\n`, { mode: 0o755 });
  return { bin, stale: () => fs.writeFileSync(answer, '[{"id":"ex-7","updated_at":"2020-01-01T00:00:00Z"}]'), none: () => fs.writeFileSync(answer, '[]') };
}
const UNRECORDED = /You have an operator input with no record: in-pc-000001/;
const CLAIM = /You hold ex-7 and this turn left no note in it/;

test('the chief of staff\'s stop captures the operator\'s words, then blocks until the input is recorded or acked', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B for the importer', 1)]);
  const first = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' });
  assert.equal(first.status, 0);
  const out = reasonOf(first);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^You have an operator input with no record: in-pc-000001 \("go with option B for the importer"\)\. Record it, or ack it/);
  // the continuation is not blocked again for the same kind
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Noted.' }).stdout, '');
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'recorded as a decision in another way', by: COS_BY });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Recorded and sent dec-1 to the builder.' }).stdout, '');
  // a relay request in the final message blocks with the carry reason; with no record id, ask here first
  const relay = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(relay.status, 0);
  assert.deepEqual(reasonOf(relay), { decision: 'block', reason: NO_ID('Please tell the Delivery Lead session to proceed with the migration') });
  const withId = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: "Recorded as dec-000002. Reply 'go' in the builder's session." });
  assert.deepEqual(reasonOf(withId), { decision: 'block', reason: WITH_ID("Reply 'go' in the builder's session") });
  assert.ok(RELAY_REASON && RELAY_REASON_NO_RECORD);
});

test('C1: a pending input does not mask a relay request: both reasons arrive in the first block', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B', 1)]);
  const msg = 'Recorded as dec-1. Please tell the builder session to proceed with option B.';
  const first = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }));
  assert.match(first.reason, UNRECORDED);
  assert.ok(first.reason.includes(WITH_ID('Please tell the builder session to proceed with option B')), first.reason);
});

test('C1: a relay request first written on the continuation still blocks once (the turn\'s second block)', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B', 1)]);
  assert.match(reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' })).reason, UNRECORDED);
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'x', by: COS_BY });
  const second = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Acked. Please tell the builder session to proceed with option B.' }));
  assert.deepEqual(second, { decision: 'block', reason: NO_ID('Please tell the builder session to proceed with option B') });
  // the same kind never blocks twice in a turn
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session to proceed.' }).stdout, '');
});

test('termination, worst case: all three kinds block at stop 1, relay once more with the clause, stop 3 passes', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  bd.stale();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const msg = 'Could you forward this to the builder session?';
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }, bd.bin));
  assert.match(s1.reason, UNRECORDED);
  assert.ok(s1.reason.includes(NO_ID('Could you forward this to the builder session')), s1.reason);
  assert.doesNotMatch(s1.reason, CLAIM, 'a missing claim note no longer blocks (A2)');
  assert.match(fs.readFileSync(path.join(roleDir, '.delivery-claim-reminder'), 'utf8'), CLAIM);
  const s2 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: msg }, bd.bin));
  // the second relay block repeats the quoted reason; it is not quoted twice
  assert.equal(s2.reason, NO_ID('Could you forward this to the builder session'));
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: msg }, bd.bin).stdout, '');
  // the next turn (a first stop) evaluates afresh
  assert.match(reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: msg }, bd.bin)).reason, UNRECORDED);
});

test('B1: a second chief-of-staff session in the same role directory cannot reset the first one (conc.js)', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1)]);
  const trB = path.join(path.dirname(tr), 'sess-B.jsonl');
  fs.writeFileSync(trB, '');
  const M = 'Please tell the builder session to proceed.';
  const A = (active) => runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: active, last_assistant_message: M }).stdout !== '';
  const B = () => runStop('chief-of-staff', { session_id: 'sess-B', cwd: roleDir, transcript_path: trB, last_assistant_message: 'hi' });
  let blocks = 0;
  if (A(false)) blocks++;
  if (A(true)) blocks++;
  for (let i = 0; i < 3; i++) { B(); if (A(true)) blocks++; }
  assert.equal(blocks, 2);
});

test('torn tail: the repair note joins the unrecorded check instead of replacing it', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1)]);
  runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'ok' });
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'a', by: COS_BY });
  fs.appendFileSync(path.join(require('../../scripts/lib/operator-log.js').opDir(projectRoot), 'records', 'chief-of-staff.ndjson'), '{"id":"partial');
  const tr2 = transcript([human('use postgres', 1), human('ship friday', 2)]);
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr2, last_assistant_message: 'ok' }));
  assert.match(s1.reason, /has an incomplete last line \(torn_tail/);
  assert.match(s1.reason, /no record: in-pc-000002/);
  assert.doesNotMatch(s1.reason, /Nothing can be recorded/);
  // and it is true: an ack still works and repairs the tail
  R.ack({ projectRoot, input: 'in-pc-000002', reason: 'b', by: COS_BY });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr2, last_assistant_message: 'ok' }).stdout, '');
});

test('termination, staggered worst case: kinds appearing one per stop still end by the third stop', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' }, bd.bin));
  assert.match(s1.reason, UNRECORDED);
  assert.doesNotMatch(s1.reason, CLAIM);
  const s2 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session yes.' }, bd.bin));
  assert.equal(s2.reason, NO_ID('Please tell the builder session yes'));
  bd.stale();
  const s3 = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'Please tell the builder session yes.' }, bd.bin);
  assert.equal(s3.status, 0);
  assert.equal(s3.stdout, '', 'a third stop in a turn always passes');
  // a new prompt resets the turn: UserPromptSubmit rewrites .delivery-turn and clears the state
  require('./turn.js').markTurnStart(roleDir, '2026-10-13T10:10:00Z');
  assert.ok(!fs.existsSync(path.join(roleDir, '.delivery-stop-state.json')));
});

test('A2: the claim-note check still runs, as a reminder for the next prompt, never a block', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  const bd = fakeBd();
  bd.stale();
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const first = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' }, bd.bin));
  assert.match(first.reason, /You have an operator input/);
  assert.doesNotMatch(first.reason, CLAIM);
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'an instruction already in the plan', by: COS_BY });
  const reminder = path.join(roleDir, '.delivery-claim-reminder');
  fs.rmSync(reminder, { force: true });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Sent dec-1 to the builder.' }, bd.bin).stdout, '', 'nothing blocks');
  assert.match(fs.readFileSync(reminder, 'utf8'), /^Reminder: You hold ex-7 and this turn left no note in it/);
  // the next prompt says it once, then it is gone
  const { promptSubmitText } = require('./role-context.js');
  const prev = process.env.DELIVERY_ROLE;
  process.env.DELIVERY_ROLE = 'chief-of-staff';
  try {
    assert.match(promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-7: importer' }), /^Reminder: You hold ex-7/);
    assert.ok(!fs.existsSync(reminder));
    assert.doesNotMatch(promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-7: importer' }), /Reminder/);
  } finally { if (prev === undefined) delete process.env.DELIVERY_ROLE; else process.env.DELIVERY_ROLE = prev; }
});

test('I3: a broken own records chain blocks once per turn with the repair path, not with an ack it cannot write', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres', 1), human('and ship friday', 2)]);
  runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true });
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'a', by: COS_BY });
  R.ack({ projectRoot, input: 'in-pc-000002', reason: 'b', by: COS_BY });
  const rf = path.join(require('../../scripts/lib/operator-log.js').opDir(projectRoot), 'records', 'chief-of-staff.ndjson');
  const txt = fs.readFileSync(rf, 'utf8');
  fs.writeFileSync(rf, txt.slice(0, txt.length - 40));
  const s1 = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'ok' }));
  assert.match(s1.reason, /^Your own operator records chain \(records\/chief-of-staff\.ndjson\) fails verification/);
  assert.match(s1.reason, /operator\.js quarantine --file records\/chief-of-staff\.ndjson/);
  assert.doesNotMatch(s1.reason, /no record: in-pc/);
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true, last_assistant_message: 'ok' }).stdout, '');
});

test('other roles are not subject to the operator input check; a relay request blocks them (rule 0)', () => {
  const { roleDir } = preparedRole('builder-1');
  const tr = transcript([human('just a note', 1)]);
  const quiet = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Migration branch pushed; bead updated.' });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
  const r = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(r.status, 0);
  assert.match(reasonOf(r).reason, /^The operator is never the messenger \(team rule 0\)/);
});

test('without a role, an unloadable manifest or garbage input, the stop hook allows and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-none-'));
  assert.equal(runStop('chief-of-staff', { cwd: dir, last_assistant_message: 'Please tell the builder session to stop' }).stdout, '');
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  fs.rmSync(path.join(projectRoot, '.delivery', 'team', 'team.json'));
  const r = runStop('chief-of-staff', { cwd: roleDir, last_assistant_message: 'Please tell the builder session to stop' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const env = { ...process.env, DELIVERY_ROLE: 'chief-of-staff' };
  const g = spawnSync(process.execPath, [path.join(__dirname, 'claim-stop.js')], { input: 'not json', env, encoding: 'utf8' });
  assert.equal(g.status, 0);
  assert.equal(g.stdout, '');
});

// ---- the relay guard on the typed judge, against a local fake provider (never the real API) ----
const http = require('http');
const { spawn } = require('child_process');
const { findRelayRequest, relayCandidates, judgeRelay } = require('./relay-guard.js');
const { stopStateFile } = require('./turn.js');
const { JUDGE_REMINDER } = require('./role-context.js');

function judgedRole() {
  const p = preparedRole('chief-of-staff');
  const f = path.join(p.projectRoot, '.delivery', 'team', 'team.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), judge: { provider: 'typesafe', model: 'jev-latest' } }));
  return p;
}
// a fake provider answering p (a function of the request, or a number); null p hangs
async function fakeJudge(pOf) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body);
      seen.push(b);
      const p = typeof pOf === 'function' ? pOf(b) : pOf;
      if (p === null) return;
      res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { relay_request: { type: 'noul', noul: p } }, usage: { input_tokens: 580 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1/systemone`, close: () => { server.closeAllConnections(); server.close(); } };
}
// async: the fake provider runs in this process, so the hook must not block the event loop
function runStopAsync(input, endpoint) {
  const env = { ...process.env, DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, TYPESAFE_API_KEY: 'test-key-not-real', DELIVERY_JUDGE_ENDPOINT: endpoint, PATH: `${fs.mkdtempSync(path.join(os.tmpdir(), 'stop-nobd-'))}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  delete env.DELIVERY_ROLE_DIR;
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'claim-stop.js')], { env });
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, stdout }));
    c.stdin.end(JSON.stringify({ session_id: SID, hook_event_name: 'Stop', stop_hook_active: false, ...input }));
  });
}
const REGEX_HIT = 'Please tell the builder session to use postgres.';
const REGEX_MISS = 'Good night. One thing waits for you in the morning: the sign-in fix is committed and reviewed but not pushed yet.';
const stateOf = (roleDir) => JSON.parse(fs.readFileSync(stopStateFile(roleDir, SID), 'utf8'));

test('relay rule, every cell: a regex hit blocks unless p < warn; without a hit p >= block blocks, the warn band reminds', () => {
  const t = { block_threshold: 0.8, warn_threshold: 0.5 };
  const hit = findRelayRequest(REGEX_HIT);
  const kinds = (relay, p) => relayCandidates(relay ? REGEX_HIT : REGEX_MISS, relay ? hit : null, p === null ? null : { ...t, p }).map((c) => c.kind);
  for (const [relay, p, want] of [[true, null, ['relay']], [false, null, []], [true, 0.9, ['relay']], [true, 0.8, ['relay']], [true, 0.5, ['relay']],
    [true, 0.49, ['relay-overruled']], [false, 0.8, ['relay']], [false, 0.79, ['relay-warn']], [false, 0.5, ['relay-warn']], [false, 0.49, []]]) {
    assert.deepEqual(kinds(relay, p), want, `regex ${relay ? 'hit' : 'miss'}, p ${p}`);
  }
  const [b] = relayCandidates(REGEX_HIT, hit, { ...t, p: 0.6 });
  assert.ok(b.reason.includes(`You wrote: "${hit.clause}"`) && /p 0\.60/.test(b.reason), 'the regex clause and p are quoted');
  assert.equal(relayCandidates(REGEX_HIT, null, { ...t, error: true }).length, 0, 'no p and no hit: nothing');
  // a regex hit is overruled only below min(warn_threshold, 0.5), whatever the thresholds say
  assert.deepEqual(relayCandidates(REGEX_HIT, hit, { block_threshold: 0.95, warn_threshold: 0.9, p: 0.5 }).map((c) => c.kind), ['relay']);
  assert.deepEqual(relayCandidates(REGEX_HIT, hit, { block_threshold: 0.95, warn_threshold: 0.9, p: 0.49 }).map((c) => c.kind), ['relay-overruled']);
  assert.deepEqual(relayCandidates(REGEX_HIT, hit, { block_threshold: 0.5, warn_threshold: 0.3, p: 0.31 }).map((c) => c.kind), ['relay']);
  assert.deepEqual(relayCandidates(REGEX_HIT, hit, { block_threshold: 0.5, warn_threshold: 0.3, p: 0.29 }).map((c) => c.kind), ['relay-overruled']);
});

test('relay guard on the judge: the message is stripped before it is sent', async () => {
  const f = await fakeJudge(0.1);
  try {
    const msg = 'Status: all green.\n```\nsecret code block\n```\nRun `inline code` later.\n> a quoted line\nHe said "a quoted span" today.';
    const r = await judgeRelay({ input: { last_assistant_message: msg }, team: { judge: { provider: 'typesafe' } }, role: 'chief-of-staff', projectRoot: null,
      deps: { env: { TYPESAFE_API_KEY: 'test-key-not-real', DELIVERY_JUDGE_ENDPOINT: f.url } } });
    assert.equal(r.p, 0.1);
    const sent = f.seen[0].state.message;
    for (const gone of ['secret code block', 'inline code', 'a quoted line', 'a quoted span']) assert.ok(!sent.includes(gone), gone);
    assert.match(sent, /Status: all green/);
    assert.deepEqual(Object.keys(f.seen[0].state).sort(), ['message', 'recipient', 'sender_role']);
  } finally { f.close(); }
});

test('relay guard on the judge through the Stop hook: miss at 0.9 blocks, 0.6 reminds; hit at 0.6 blocks, at 0.2 passes and is recorded', async () => {
  let p = 0.9;
  const f = await fakeJudge(() => p);
  try {
    const { projectRoot, roleDir } = judgedRole();
    assert.equal(findRelayRequest(REGEX_MISS), null, 'the regex misses this one');
    const blocked = reasonOf(await runStopAsync({ cwd: roleDir, last_assistant_message: REGEX_MISS }, f.url));
    assert.equal(blocked.decision, 'block');
    assert.ok(blocked.reason.includes(`You wrote: "${REGEX_MISS.slice(0, 160)}"`));
    assert.match(blocked.reason, /typed judge rates this message p 0\.90/);
    assert.deepEqual((({ p: q, model, regex }) => ({ q, model, regex }))(stateOf(roleDir).judge), { q: 0.9, model: 'jev-1.13.0', regex: false });

    p = 0.6;
    assert.equal((await runStopAsync({ cwd: roleDir, last_assistant_message: REGEX_MISS }, f.url)).stdout, '');
    assert.match(fs.readFileSync(path.join(roleDir, JUDGE_REMINDER), 'utf8'), /^Reminder: The typed judge rates this message p 0\.60/);
    assert.match(reasonOf(await runStopAsync({ cwd: roleDir, last_assistant_message: REGEX_HIT }, f.url)).reason, /You wrote: .*p 0\.60/);

    p = 0.2;
    assert.equal((await runStopAsync({ cwd: roleDir, last_assistant_message: REGEX_HIT }, f.url)).stdout, '', 'a clearly negative judge overrules the regex');
    assert.equal(stateOf(roleDir).judge.overruled, true);
    const log = require('../../scripts/lib/judge.js').readLog(path.join(projectRoot, '.delivery', 'judge'));
    assert.deepEqual(log.filter((e) => e.event === 'regex_overruled').map((e) => e.p), [0.2]);
  } finally { f.close(); }
});

test('relay guard on the judge: provider down or hanging, the regex decides as without the judge, inside 3 s', async () => {
  const { roleDir } = judgedRole();
  const r = reasonOf(await runStopAsync({ cwd: roleDir, last_assistant_message: REGEX_HIT }, 'http://127.0.0.1:1/v1/systemone'));
  assert.equal(r.reason, relayReason(REGEX_HIT, findRelayRequest(REGEX_HIT).clause));
  assert.equal(stateOf(roleDir).judge.reason, 'network');
  const hang = await fakeJudge(null);
  try {
    const t0 = Date.now();
    const h = reasonOf(await runStopAsync({ cwd: preparedRoleDir(), last_assistant_message: REGEX_HIT }, hang.url));
    assert.ok(Date.now() - t0 < 3000, `the hook took ${Date.now() - t0} ms`);
    assert.equal(h.reason, relayReason(REGEX_HIT, findRelayRequest(REGEX_HIT).clause));
    assert.equal(hang.seen.filter((b) => b.questions.relay_request).length, 1);
  } finally { hang.close(); }
});

test('relay guard on the judge: nothing is sent when the turn can no longer block', async () => {
  const f = await fakeJudge(0.9);
  try {
    const { roleDir } = judgedRole();
    // a continuation with no trustworthy state is exhausted
    assert.equal((await runStopAsync({ cwd: roleDir, stop_hook_active: true, last_assistant_message: REGEX_MISS }, f.url)).stdout, '');
    assert.equal(f.seen.length, 0);
  } finally { f.close(); }
});
function preparedRoleDir() { return judgedRole().roleDir; }

// ---- what the message tells the owner (R-44, R-45), through the Stop hook ----
const { MESSAGE_REMINDER } = require('./role-context.js');
const W = require('../../scripts/lib/warnings.js');
// 10-12 19:27: an order with no other session in it (the relay guard does not see it)
const UNLOCK = 'The PC is locked, so the test cannot run. Please unlock it and tell me when it is unlocked.';

test('R-44 through the Stop hook: judge off, an order to the owner is recorded and reminded, never blocked', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const r = runStop('chief-of-staff', { cwd: roleDir, last_assistant_message: UNLOCK });
  assert.equal(r.stdout, '');
  assert.deepEqual(W.list(projectRoot).map((w) => [w.kind, w.rule]), [['orders-owner', 'R-44']]);
  assert.match(fs.readFileSync(path.join(roleDir, MESSAGE_REMINDER), 'utf8'), /an order to the owner outside the queue/);
});

test('R-44 through the Stop hook: judge on, orders_owner p 0.9 blocks once with the queue command; tone and jargon only warn', async () => {
  const seen = [];
  const answers = { relay_request: { type: 'noul', noul: 0.1 }, orders_owner: { type: 'noul', noul: 0.9 }, jargon: { type: 'noul', noul: 0.2 },
    tone_violation: { type: 'choice', choice: 'justifying', confidence: 0.9, probabilities: { none: 0.05, justifying: 0.9, condescending: 0.03, therapeutic: 0.02 } } };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const q = Object.keys(JSON.parse(body).questions)[0]; seen.push(q); res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { [q]: answers[q] } })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;
    const { projectRoot, roleDir } = judgedRole();
    const out = reasonOf(await runStopAsync({ cwd: roleDir, last_assistant_message: UNLOCK }, url));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /^You told the owner to do something: "Please unlock it and tell me when it is unlocked"\./);
    assert.match(out.reason, /owner-queue\.js add --kind/);
    assert.deepEqual([...new Set(seen)].sort(), ['jargon', 'orders_owner', 'relay_request', 'tone_violation']);
    assert.deepEqual(W.list(projectRoot).map((w) => w.kind).sort(), ['tone']);
    // the same turn's continuation does not block on it again
    assert.equal((await runStopAsync({ cwd: roleDir, stop_hook_active: true, last_assistant_message: UNLOCK }, url)).stdout, '');
  } finally { server.closeAllConnections(); server.close(); }
});

// Team rule 0, end to end through the Stop hook: a builder's turn that asks the operator to carry a
// result to another session is blocked once with the peer way out; a turn that commits it is not.
test('rule 0: a builder that asks the operator to relay is blocked by its Stop hook; one that commits the result is not', () => {
  const { roleDir } = preparedRole('builder-1');
  const tr = transcript([]);
  const asked = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Done. Please relay the summary above to the chief-of-staff session.' });
  assert.equal(asked.status, 0);
  const out = reasonOf(asked);
  assert.equal(out && out.decision, 'block', asked.stdout + asked.stderr);
  assert.match(out.reason, /The operator is never the messenger \(team rule 0\)/);
  const fine = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Done. Pushed the record as 27b7541; the chief-of-staff session reads it from the project repo.' });
  assert.equal(fine.stdout, '', fine.stdout);
});
