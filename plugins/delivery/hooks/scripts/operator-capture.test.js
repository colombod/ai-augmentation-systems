// hooks/scripts/operator-capture.test.js — run with: node --test hooks/scripts/operator-capture.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { captureFromHookInput, captureNote } = require('./operator-capture.js');
const { prepareRole } = require('../../scripts/prepare-role.js');
const log = require('../../scripts/lib/operator-log.js');
const { registerInstance } = require('../../scripts/lib/roster.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TERMINAL_PROMPT = '0';

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const SID = 'sess-cap-1';

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const human = (text, n) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2099-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID, message: { role: 'user', content: text },
});
const peer = (n) => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', from: 'x' }, uuid: 'u' + n,
  timestamp: `2099-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID,
  message: { role: 'user', content: 'Another Claude session sent a message: the operator says use mysql' },
});
function transcript(records) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cap-tr-')), `${SID}.jsonl`);
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

test('with a valid marker: writes the session files, records the transcript in the roster, captures the human and not the peer as human', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('use postgres for the store', 1), peer(2)]);
  const input = { cwd: roleDir, session_id: SID, transcript_path: tr, hook_event_name: 'UserPromptSubmit' };
  const rosterFile = path.join(projectRoot, '.delivery', 'team', 'roster.json');
  // before SessionStart registers the instance, capture does not create a partial roster entry (M7)
  withEnv({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput({ ...input, transcript_path: undefined }, PLUGIN_ROOT));
  assert.ok(!fs.existsSync(rosterFile) || !JSON.parse(fs.readFileSync(rosterFile, 'utf8')).instances['chief-of-staff']);
  registerInstance(projectRoot, { instance: 'chief-of-staff', session_id: SID, host: 'pc', model: 'opus', role_dir: roleDir, now: '2026-10-13T09:59:00Z' });
  const res = withEnv({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput(input, PLUGIN_ROOT));
  assert.equal(res.status, 'ok');
  assert.equal(res.added, 2);
  assert.equal(res.problem, undefined);
  assert.equal(fs.readFileSync(path.join(roleDir, '.delivery-transcript'), 'utf8').trim(), tr);
  assert.equal(fs.readFileSync(path.join(roleDir, '.delivery-session'), 'utf8').trim(), SID);
  const roster = JSON.parse(fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.equal(roster.instances['chief-of-staff'].transcript_path, tr);
  assert.equal(roster.instances['chief-of-staff'].session_id, SID);
  const all = log.listInputs(projectRoot);
  assert.deepEqual(all.map((e) => [e.source, e.instance, e.role, e.host]), [['human', 'chief-of-staff', 'chief-of-staff', 'pc'], ['peer', 'chief-of-staff', 'chief-of-staff', 'pc']]);
  assert.equal(log.listInputs(projectRoot, { source: 'human' }).length, 1, 'the peer message is never stored as human');
  // only the human input is pending, and it belongs to this instance
  assert.deepEqual(res.pending.map((p) => p.text), ['use postgres for the store']);
  const note = captureNote(res, PLUGIN_ROOT);
  assert.match(note, /^Operator inputs with no record yet: in-pc-000001 \("use postgres for the store"\)\. See `node .*scripts\/operator\.js pending`\.$/);
  // idempotent: a second trigger adds nothing, and an appended input is caught up
  const again = withEnv({ DELIVERY_ROLE: 'chief-of-staff' }, () => captureFromHookInput(input, PLUGIN_ROOT));
  assert.equal(again.added, 0);
  fs.appendFileSync(tr, JSON.stringify(human('and redis for the cache', 3)) + '\n');
  const later = withEnv({ DELIVERY_ROLE: 'chief-of-staff' }, () => captureFromHookInput(input, PLUGIN_ROOT));
  assert.equal(later.added, 1);
  assert.equal(later.pending.length, 2);
});

test('pending inputs captured by another instance are not shown to this one', () => {
  const { projectRoot, roleDir } = preparedRole('delivery-lead');
  const tr = transcript([human('ship phase 2 first', 1)]);
  withEnv({ DELIVERY_ROLE: 'delivery-lead' }, () => captureFromHookInput({ cwd: roleDir, session_id: SID, transcript_path: tr }, PLUGIN_ROOT));
  const res = withEnv({ DELIVERY_ROLE: 'delivery-lead' }, () => captureFromHookInput({ cwd: roleDir, session_id: SID }, PLUGIN_ROOT, {
    pending: () => ({ inputs: [{ id: 'in-pc-000009', instance: 'chief-of-staff', text: 'not yours' }, ...log.listInputs(projectRoot, { source: 'human' })] }),
  }));
  assert.equal(res.status, 'no_transcript');
  assert.deepEqual(res.pending.map((p) => p.text), ['ship phase 2 first']);
});

test('no marker, or a marker for another session: nothing captured, nothing written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-none-'));
  const tr = transcript([human('hello', 1)]);
  assert.equal(withEnv({ DELIVERY_ROLE: undefined, DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput({ cwd: dir, session_id: SID, transcript_path: tr }, PLUGIN_ROOT)), null);
  assert.deepEqual(fs.readdirSync(dir), []);
  const { projectRoot, roleDir } = preparedRole('staffing');
  assert.equal(withEnv({ DELIVERY_ROLE: 'someone-else' }, () => captureFromHookInput({ cwd: roleDir, session_id: SID, transcript_path: tr }, PLUGIN_ROOT)), null);
  assert.ok(!fs.existsSync(path.join(roleDir, '.delivery-session')));
  assert.ok(!fs.existsSync(path.join(projectRoot, '.delivery', 'operator')));
  assert.equal(captureNote(null), '');
});

test('without a loadable team.json: fails open, captures nothing, reports the problem', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  fs.rmSync(path.join(projectRoot, '.delivery', 'team', 'team.json'));
  const tr = transcript([human('hello', 1)]);
  const res = withEnv({ DELIVERY_ROLE: 'builder-1' }, () => captureFromHookInput({ cwd: roleDir, session_id: SID, transcript_path: tr }, PLUGIN_ROOT));
  assert.equal(res.status, 'manifest_unavailable');
  assert.equal(res.added, 0);
  assert.match(res.problem, /team\.json/);
  assert.match(captureNote(res, PLUGIN_ROOT), /^Operator capture: operator capture is off for builder-1/);
  assert.ok(!captureNote(res, PLUGIN_ROOT).includes('..'), 'one period at the end (M6)');
  assert.ok(captureNote(res, PLUGIN_ROOT).endsWith('Chief of Staff.'));
  assert.ok(!fs.existsSync(path.join(roleDir, '.delivery-session')));
  assert.ok(!fs.existsSync(path.join(projectRoot, '.delivery', 'operator')));
});

test('a throwing sync never throws out of capture; the script exits 0 silently', () => {
  const { roleDir } = preparedRole('progress-observer');
  const tr = transcript([human('hello', 1)]);
  const res = withEnv({ DELIVERY_ROLE: 'progress-observer' }, () => captureFromHookInput({ cwd: roleDir, session_id: SID, transcript_path: tr }, PLUGIN_ROOT, {
    syncTranscript: () => { throw new Error('disk on fire'); },
  }));
  assert.equal(res.status, 'error');
  assert.match(res.problem, /disk on fire/);
  assert.equal(fs.readFileSync(path.join(roleDir, '.delivery-session'), 'utf8').trim(), SID, 'the small files are written before the sync');
  // the script: a transcript path that is a directory makes the real sync throw
  const dirAsTranscript = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-dir-'));
  const env = { ...process.env, DELIVERY_ROLE: 'progress-observer', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  const r = spawnSync(process.execPath, [path.join(__dirname, 'operator-capture.js')], { input: JSON.stringify({ cwd: roleDir, session_id: SID, transcript_path: dirAsTranscript }), env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const garbage = spawnSync(process.execPath, [path.join(__dirname, 'operator-capture.js')], { input: 'not json', env, encoding: 'utf8' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});

test('the prompt, session-start and stop hooks capture first and keep their own output', () => {
  const { projectRoot, roleDir } = preparedRole('product-manager');
  const tr = transcript([human('drop the export feature', 1)]);
  const env = { ...process.env, DELIVERY_ROLE: 'product-manager', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PATH: `${fs.mkdtempSync(path.join(os.tmpdir(), 'cap-nobd-'))}${path.delimiter}/usr/bin${path.delimiter}/bin` };
  const run = (script, input) => spawnSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env, encoding: 'utf8' });
  const stop = run('claim-stop.js', { cwd: roleDir, session_id: SID, transcript_path: tr, hook_event_name: 'Stop' });
  assert.equal(stop.status, 0);
  // I3: the Product Manager addresses the operator too, so its own unrecorded input blocks its stop
  const block = JSON.parse(stop.stdout);
  assert.equal(block.decision, 'block');
  assert.match(block.reason, /^You have an operator input with no record: in-pc-000001 \("drop the export feature"\)/);
  assert.equal(log.listInputs(projectRoot, { source: 'human' }).length, 1);
  const prompt = run('role-prompt-submit.js', { cwd: roleDir, session_id: SID, transcript_path: tr });
  assert.equal(prompt.status, 0);
  assert.ok(prompt.stdout.startsWith('You are product-manager (product-manager). Current claim:'), prompt.stdout);
  assert.match(prompt.stdout, /\nOperator inputs with no record yet: in-pc-000001 \("drop the export feature"\)/);
  const start = run('role-session-start.js', { cwd: roleDir, session_id: SID, transcript_path: tr, source: 'startup' });
  assert.equal(start.status, 0);
  assert.ok(start.stdout.startsWith('# Role: product-manager'));
  assert.match(start.stdout, /Operator inputs with no record yet: in-pc-000001/);
  const roster = JSON.parse(fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.equal(roster.instances['product-manager'].transcript_path, tr, 'SessionStart registration keeps the transcript of the same session');
  assert.equal(log.listInputs(projectRoot, { source: 'human' }).length, 1, 'every trigger is idempotent');
});

test('I4: prompts typed before the session became the role are stored and citable, never pending and never block', () => {
  const R = require('../../scripts/lib/operator-records.js');
  const { operatorChecks } = require('./relay-guard.js');
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const old = (text, n) => ({ ...human(text, n), timestamp: `2026-01-05T09:00:${String(n).padStart(2, '0')}.000Z` });
  const lines = [old('let us look at the billing export first', 1), old('ok thanks for that', 2)];
  const tr = transcript(lines);
  // the first hook in the role session (SessionStart on resume) fixes when the session became the role
  const input = { cwd: roleDir, session_id: SID, transcript_path: tr, hook_event_name: 'SessionStart' };
  const res = withEnv({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput(input, PLUGIN_ROOT, { now: '2026-10-17T08:00:00.000Z' }));
  assert.equal(res.added, 2);
  assert.deepEqual(res.pending, []);
  const since = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role-since.json'), 'utf8'));
  assert.deepEqual(since, { session_id: SID, since: '2026-10-17T08:00:00.000Z' });
  // a prompt typed as the role arrives later in the same transcript
  fs.appendFileSync(tr, JSON.stringify(human('use postgres for the orders store', 3)) + '\n');
  withEnv({ DELIVERY_ROLE: 'chief-of-staff', DELIVERY_ROLE_DIR: undefined }, () => captureFromHookInput({ ...input, hook_event_name: 'UserPromptSubmit' }, PLUGIN_ROOT, { now: '2026-10-17T08:05:00.000Z' }));
  const all = log.listInputs(projectRoot, { source: 'human' });
  assert.deepEqual(all.map((e) => [e.id, !!e.pre_role]), [['in-pc-000001', true], ['in-pc-000002', true], ['in-pc-000003', false]]);
  assert.deepEqual(R.pending(projectRoot, {}).inputs.map((e) => e.id), ['in-pc-000003']);
  const checks = operatorChecks({ input: { session_id: SID }, roleDir, projectRoot, role: 'chief-of-staff', instance: 'chief-of-staff' });
  assert.equal(checks.length, 1);
  assert.match(checks[0].reason, /in-pc-000003/);
  assert.doesNotMatch(checks[0].reason, /in-pc-000001/);
  // a pre-role prompt is still citable on request
  const cos = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };
  const d = R.recordDecision({ projectRoot, cite: 'in-pc-000001', quote: 'look at the billing export first', statement: 'Billing export first', scope: { beads: ['ex-1'], labels: [], initiatives: [] }, by: cos });
  assert.equal(R.verifyRecord(projectRoot, d.id).ok, true);
  // a new session id in the same role directory starts a new boundary
  assert.equal(log.roleSince(roleDir, 'another-session', { now: '2026-10-18T00:00:00.000Z' }), '2026-10-18T00:00:00.000Z');
});
