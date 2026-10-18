// scripts/team-status.test.js — run with: node --test scripts/team-status.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teamStatus, renderStatus } = require('./team-status.js');
const { registerInstance } = require('./lib/roster.js');

const TEMPLATES = path.join(__dirname, '..', 'templates');
// the full manifest the tests run against (templates/ holds the minimal one users start from)
const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
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
  const warning = 'bd unreachable from role directories: run bd init in the project root, then rerun prepare-role so the roles get BEADS_DIR';
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
  // the records are not in the user's checkout; once published to the delivery-operator branch, nothing is unpublished
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(log.publish(root, { force: true, host: 'pc' }).published, true);
  assert.equal(teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'pc' }).operator.unpublished, 0);
  // without a remote the line says so instead of a count
  git(root, 'remote', 'remove', 'origin');
  const local = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'pc' });
  assert.equal(local.operator.no_remote, true);
  assert.ok(local.operator.unpublished > 0, 'a local-only store still counts its entries');
  assert.ok(renderStatus(local, root).includes(`Operator entries unpublished: ${local.operator.unpublished} (no remote: the operator store is local only)`));
  // entries left unpublished for more than a day are called out
  const old = renderStatus({ ...s, operator: { ...s.operator, unpublished: 2, unpublished_since: new Date(Date.now() - 30 * 3600e3).toISOString() } });
  assert.ok(old.includes('Warning: operator entries unpublished for 30 hours: run operator.js publish, or check the remote'), old);
  assert.ok(!renderStatus(s).includes('unpublished for'), 'fresh entries are not a warning');
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

test('a configured staleness_hours of 0 stays 0, like the bd guard', () => {
  const root = scratchProject();
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.budget.staleness_hours = 0;
  fs.writeFileSync(file, JSON.stringify(team));
  const probe = teamStatus(root, { now: NOW });
  const instance = probe.rows[0].instance;
  const role = probe.rows[0].role;
  registerInstance(root, { instance, role, host: probe.rows[0].host, model: probe.rows[0].model, session_id: 's1', now: '2026-10-12T11:59:00Z' });
  const s = teamStatus(root, { now: NOW });
  assert.equal(s.rows.find((r) => r.instance === instance).state, 'stale');
});

test('I6: a retired role stays listed but is never missing or drift, and prepare-role refuses it', () => {
  const root = scratchProject();
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles.find((r) => r.id === 'spike-researcher').retired = true;
  fs.writeFileSync(file, JSON.stringify(team));
  const now = new Date().toISOString();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now });
  }
  const s = teamStatus(root, { bdCheck: () => true });
  assert.equal(s.rows.find((r) => r.instance === 'spike-researcher').state, 'retired');
  assert.deepEqual(s.drift.missing, []);
  assert.ok(renderStatus(s).includes('No drift.'));
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(__dirname, 'team-status.js'), '--project', root], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(out.includes('| spike-researcher | spike-researcher | pc | sonnet |  | retired |'), out);
  const { validateManifest } = require('./lib/manifest.js');
  const hosts = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), 'utf8'));
  assert.deepEqual(validateManifest(team, hosts), []);
  assert.ok(validateManifest({ ...team, roles: team.roles.map((r) => (r.id === 'staffing' ? { ...r, retired: 'yes' } : r)) }, hosts).some((p) => /non-boolean "retired"/.test(p)));
  const { prepareRole } = require('./prepare-role.js');
  assert.throws(() => prepareRole({ projectRoot: root, instance: 'spike-researcher', teamDir: fs.mkdtempSync(path.join(os.tmpdir(), 'team-')), pluginRoot: path.join(__dirname, '..'), user: 't' }), /retired/);
});

test('A5: /delivery:team says how to change a model, and warns on a model name it does not know', () => {
  const root = scratchProject();
  const file = path.join(root, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(file, 'utf8'));
  team.roles[0].model = 'claude-opus-9';
  fs.writeFileSync(file, JSON.stringify(team));
  const text = renderStatus(teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true }));
  assert.ok(text.includes('To change a model: edit roles[].model in .delivery/team/team.json, rerun prepare-role for that instance, restart its session.'));
  assert.match(text, /Warning: team.json: role "chief-of-staff" has model "claude-opus-9"/);
});

test('Copilot: when the unpublished count is not available, the status says why instead of a bare 0', () => {
  const log = require('./lib/operator-log.js');
  const root = scratchProject(); // not a git repository: the records are local only
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'status-tr-')), 't.jsonl');
  fs.writeFileSync(tr, JSON.stringify({ type: 'user', origin: { kind: 'human' }, promptId: 'p1', uuid: 'u1', timestamp: '2026-10-13T10:00:00.000Z', sessionId: 's', message: { role: 'user', content: 'Ship it.' } }) + '\n');
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: 's', instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc' });
  const s = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, host: 'pc' });
  assert.equal(s.operator.unpublished_reason, 'not a git repository');
  assert.ok(renderStatus(s, root).includes('Operator entries unpublished: 0 (not a git repository: the records stay on this host)'));
});

test('1a: warnings over 24 h head the status; counts and story states use merged / deployed / verified, with the unverified cap', () => {
  const root = scratchProject();
  const W = require('./lib/warnings.js');
  W.record(root, { kind: 'mechanism', rule: 'R-10', bead: 'ex-wxy-6', detail: 'criterion 1 names a mechanism', instance: 'builder-1', now: '2026-10-11T08:01:00Z' });
  W.record(root, { kind: 'probe', rule: 'R-10', bead: 'ex-wxy-7', detail: 'no probe', instance: 'builder-1', now: NOW });
  const story = (id, state) => ({ id, status: id === 'ex-469' ? 'closed' : 'open', labels: ['story', `state-${state}`], metadata: { area: 'collection' } });
  const s = teamStatus(root, { now: NOW, staleHours: 2, bdCheck: () => true, storyBeads: () => ['469', '470', '471'].map((n) => story(`ex-${n}`, 'merged')).concat([story('ex-478', 'deployed'), story('ex-1', 'verified')]) });
  const text = renderStatus(s);
  assert.ok(text.startsWith('Warnings unacknowledged over 24 h: 1'), text.slice(0, 80));
  assert.match(text, /- w-builder-1-[a-z0-9]+ R-10 ex-wxy-6/);
  assert.match(text, /Warnings open: 2 \(mechanism 1, probe 1\); acknowledged: 0/);
  assert.match(text, /Stories: merged 3, deployed 1, verified 1/);
  assert.match(text, /area collection has 4 merged-but-unverified stories \(cap 2\)/);
});
