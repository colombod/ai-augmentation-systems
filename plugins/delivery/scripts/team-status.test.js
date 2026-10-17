// scripts/team-status.test.js — run with: node --test scripts/team-status.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teamStatus, renderStatus } = require('./team-status.js');
const { registerInstance } = require('./lib/roster.js');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

const NOW = '2026-10-12T12:00:00Z';

test('every manifest instance is missing when the roster is empty', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.equal(s.rows.length, 8);
  assert.deepEqual(s.drift.missing, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder-1', 'builder-2']);
  assert.ok(renderStatus(s).includes('Missing: chief-of-staff'));
});

test('live, stale, extra and wrong_model are reported', () => {
  const root = scratchProject();
  registerInstance(root, { instance: 'chief-of-staff', session_id: 'a', host: 'pc', model: 'opus', role_dir: '/x', now: '2026-10-12T11:30:00Z' });
  registerInstance(root, { instance: 'staffing', session_id: 'b', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T08:00:00Z' });
  registerInstance(root, { instance: 'builder-1', session_id: 'c', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  registerInstance(root, { instance: 'wizard', session_id: 'd', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const byId = Object.fromEntries(s.rows.map((r) => [r.instance, r]));
  assert.equal(byId['chief-of-staff'].state, 'live');
  assert.equal(byId['staffing'].state, 'stale');
  assert.deepEqual(s.drift.stale, ['staffing']);
  assert.deepEqual(s.drift.extra, ['wizard']);
  assert.deepEqual(s.drift.wrong_model, [{ instance: 'builder-1', expected: 'sonnet', actual: 'haiku' }]);
  const text = renderStatus(s);
  assert.ok(text.includes('| chief-of-staff | chief-of-staff | pc | opus | a | live |'));
  assert.ok(text.includes('Wrong model: builder-1 expected sonnet, running haiku'));
});

test('renderStatus says No drift when the roster matches', () => {
  const root = scratchProject();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['spike-researcher', 'sonnet'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now: NOW });
  }
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.ok(renderStatus(s).includes('No drift.'));
});

test('CLI exits 2 with a team-status message on a nonexistent project path', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'team-status.js');
  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, '--project', '/nonexistent'], { stdio: 'pipe' }),
    (err) => err.status === 2 && String(err.stderr).includes('team-status:')
  );
});

test('CLI exits 1 when drift exists', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'team-status.js');
  const root = scratchProject();
  assert.throws(
    () => execFileSync(process.execPath, [scriptPath, '--project', root], { stdio: 'pipe' }),
    (err) => err.status === 1
  );
});

test('renderStatus with a project root prints a Manifest line, "not a git repo" outside git', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const text = renderStatus(s, root);
  assert.ok(text.includes(`Manifest: ${root} at `));
});

test('C: an unreachable bd is a warning line, not drift', () => {
  const root = scratchProject();
  const warning = 'bd unreachable from role directories: set BEADS_DIR or provision beads (phase 3)';
  const down = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => false });
  assert.equal(down.bd_reachable, false);
  assert.ok(renderStatus(down).includes(warning));
  const up = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true });
  assert.ok(!renderStatus(up).includes(warning));
  // CLI: no drift and no beads database at the project root still exits 0, with the warning.
  const now = new Date().toISOString();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['spike-researcher', 'sonnet'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now });
  }
  const { execFileSync } = require('child_process');
  const env = { ...process.env, PATH: fs.mkdtempSync(path.join(os.tmpdir(), 'nobd-')) + path.delimiter + '/usr/bin' + path.delimiter + '/bin' };
  delete env.BEADS_DIR;
  const out = execFileSync(process.execPath, [path.join(__dirname, 'team-status.js'), '--project', root], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(out.includes('No drift.'));
  assert.ok(out.includes(warning));
});

// Task 5: operator lines. A fixture project with five captured operator inputs, one decision, one
// ack and one inferred answer; then a git clone with an upstream to count unpublished entries.
test('operator lines: unpublished entries, inputs pending a record and inferred answers awaiting ratification', () => {
  const log = require('./lib/operator-log.js');
  const R = require('./lib/operator-records.js');
  const cp = require('child_process');
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd, ...a) => cp.execFileSync('git', a, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  // without an operator directory: all zero
  const empty = teamStatus(scratchProject(), { now: NOW, staleHours: 2, bdCheck: () => true });
  assert.deepEqual(empty.operator, { unpublished: 0, pending_inputs: [], unratified: [], notes: [] });
  const emptyText = renderStatus(empty);
  assert.ok(emptyText.includes('Operator entries unpublished: 0'));
  assert.ok(emptyText.includes('Operator inputs pending a record: 0\n'));
  assert.ok(emptyText.includes('Inferred answers awaiting ratification: 0\n'));

  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'status-remote-'));
  git(remote, 'init', '-q', '--bare');
  const root = scratchProject();
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.test'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'init');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', '-u', 'origin', 'HEAD');

  const SID = 'sess-cos';
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'status-tr-')), 't.jsonl');
  const texts = ['Use Postgres for the orders service.', 'ok thanks', 'Ship the checkout flow behind a flag.', 'What about the mobile app?', 'Also look at billing later.'];
  fs.writeFileSync(tr, texts.map((t, i) => JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p' + i, uuid: 'u' + i,
    timestamp: `2026-10-13T10:00:0${i}.000Z`, sessionId: SID, message: { role: 'user', content: t } })).join('\n') + '\n');
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc' });
  const COS = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc', machine: R.machineId() };
  const scope = (o) => ({ beads: [], labels: [], initiatives: [], ...o });
  const d = R.recordDecision({ projectRoot: root, cite: 'in-pc-000001', quote: 'use postgres for the orders service', statement: 'Orders use Postgres', scope: scope({ beads: ['ex-1'] }), by: COS });
  R.ack({ projectRoot: root, input: 'in-pc-000002', reason: 'conversational', by: COS });
  const a = R.recordAnswer({ projectRoot: root, cites: [d.id], question: 'Which database does the orders worker use?', answer: 'Postgres, like the service.',
    confidence: 'inferred', rationale: 'Same service family as ex-1, a reversible configuration choice.', scope: scope({ beads: ['ex-2'] }), by: COS });

  const s = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'pc' });
  assert.deepEqual(s.operator.pending_inputs, ['in-pc-000003', 'in-pc-000004', 'in-pc-000005']);
  assert.deepEqual(s.operator.unratified, [a.id]);
  // 5 inputs on host pc and 3 records by chief-of-staff (on pc), none pushed
  assert.equal(s.operator.unpublished, 8);
  const text = renderStatus(s, root);
  assert.ok(text.includes('Operator entries unpublished: 8'), text);
  assert.ok(text.includes('Operator inputs pending a record: 3 (in-pc-000003, in-pc-000004, in-pc-000005)'), text);
  assert.ok(text.includes(`Inferred answers awaiting ratification: 1 (${a.id})`), text);
  // a host with no operator chains of its own has nothing unpublished
  assert.equal(teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'buildbox' }).operator.unpublished, 0);
  // once pushed, nothing is unpublished
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'operator'); git(root, 'push', '-q');
  assert.equal(teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'pc' }).operator.unpublished, 0);
  // a fourth input listed as "..." after three ids
  const four = renderStatus({ ...s, operator: { ...s.operator, pending_inputs: ['a', 'b', 'c', 'd'] } });
  assert.ok(four.includes('Operator inputs pending a record: 4 (a, b, c, ...)'));
});

test('operator lines leave the exit code alone: no drift still exits 0 with pending inputs', () => {
  const log = require('./lib/operator-log.js');
  const root = scratchProject();
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'status-tr-')), 't.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p1', uuid: 'u1', timestamp: '2026-10-13T10:00:00.000Z',
    sessionId: 's', message: { role: 'user', content: 'Ship the checkout flow behind a flag.' } }) + '\n');
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: 's', instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc' });
  const now = new Date().toISOString();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['spike-researcher', 'sonnet'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now });
  }
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, 'team-status.js'), '--project', root], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(out.includes('No drift.'));
  assert.ok(out.includes('Operator inputs pending a record: 1 (in-pc-000001)'), out);
  assert.ok(out.includes('Operator entries unpublished: 0'), out);
});
