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
const { RELAY_REASON } = require('./relay-guard.js');

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
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

const human = (text, n) => ({
  type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n,
  timestamp: `2026-10-13T10:00:${String(n).padStart(2, '0')}.000Z`, sessionId: SID, message: { role: 'user', content: text },
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

test('the chief of staff\'s stop captures the operator\'s words, then blocks until the input is recorded or acked', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('go with option B for the importer', 1)]);
  const first = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' });
  assert.equal(first.status, 0);
  const out = reasonOf(first);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^You have an operator input with no record: in-pc-000001 \("go with option B for the importer"\)\. Record the decision/);
  // the hook's own retry is never blocked twice
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, stop_hook_active: true }).stdout, '');
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'recorded as a decision in another way', by: { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' } });
  assert.equal(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Recorded and sent dec-1 to the builder.' }).stdout, '');
  // a relay request in the final message blocks with the carry reason
  const relay = runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(relay.status, 0);
  assert.deepEqual(reasonOf(relay), { decision: 'block', reason: RELAY_REASON });
});

test('other roles are not subject to the operator stop checks', () => {
  const { roleDir } = preparedRole('builder-1');
  const tr = transcript([human('just a note', 1)]);
  const r = runStop('builder-1', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Please tell the Delivery Lead session to proceed with the migration' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
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

test('order: the operator checks block before the claim-note check, which still runs once they pass', () => {
  const { projectRoot, roleDir } = preparedRole('chief-of-staff');
  const tr = transcript([human('ship the importer behind a flag', 1)]);
  // a fake bd that reports a held bead last touched long before this turn
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-bd-'));
  fs.writeFileSync(path.join(bin, 'bd'), `#!/bin/sh\necho '[{"id":"ex-7","updated_at":"2020-01-01T00:00:00Z"}]'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(roleDir, '.delivery-turn'), '2026-10-13T10:00:00Z\n');
  const first = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Noted.' }, bin));
  assert.match(first.reason, /^You have an operator input with no record: in-pc-000001/);
  R.ack({ projectRoot, input: 'in-pc-000001', reason: 'an instruction already in the plan', by: { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' } });
  const relay = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Could you forward this to the builder session?' }, bin));
  assert.equal(relay.reason, RELAY_REASON);
  const claim = reasonOf(runStop('chief-of-staff', { cwd: roleDir, transcript_path: tr, last_assistant_message: 'Sent dec-1 to the builder.' }, bin));
  assert.match(claim.reason, /^You hold ex-7 and this turn left no note in it/);
});
