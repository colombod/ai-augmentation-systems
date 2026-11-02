// scripts/team-role.test.js — run through scripts/testing/run-tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { addRole, setCap } = require('./team-role.js');

const MANIFEST_FIXTURE = path.join(__dirname, 'testing', 'manifest');
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'team-role-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return { root, git, team: () => JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'team.json'), 'utf8')) };
}

// dec-chief-of-staff-000177: team.json changes through a validating command, never a free-form edit
test('team-role add: adds a shipped role on the main host with its default model, validated and committed', () => {
  const p = project();
  const before = p.team().roles.length;
  const dry = addRole(p.root, 'tech-writer', { dryRun: true });
  assert.equal(dry.code, 0, dry.out);
  assert.equal(p.team().roles.length, before, 'a dry run writes nothing');
  const r = addRole(p.root, 'tech-writer');
  assert.equal(r.code, 0, r.out);
  const added = p.team().roles.find((x) => x.id === 'tech-writer');
  const hosts = p.team().roles.filter((x) => x.id !== 'tech-writer').map((x) => x.host);
  const main = hosts.sort((a, b) => hosts.filter((h) => h === b).length - hosts.filter((h) => h === a).length)[0];
  assert.deepEqual(added, { id: 'tech-writer', brief: 'delivery/tech-writer', host: main, model: 'sonnet' });
  assert.match(p.git('log', '-1', '--format=%s'), /team: add the tech-writer role/);
  assert.equal(p.git('status', '--porcelain').trim(), '', 'the change is committed');
});

test('team-role add: refuses an unknown role, a duplicate, a bad model and an unknown host, writing nothing', () => {
  const p = project();
  const text = () => fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const before = text();
  assert.match(addRole(p.root, 'astronaut').out, /not a role this plugin ships/);
  assert.match(addRole(p.root, 'chief-of-staff').out, /already on the team/);
  assert.match(addRole(p.root, 'tech-writer', { model: 'gpt' }).out, /--model must be one of/);
  const bad = addRole(p.root, 'tech-writer', { host: 'nowhere' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /invalid/);
  assert.equal(text(), before);
});

const rewrite = (p, f) => {
  const file = path.join(p.root, '.delivery', 'team', 'team.json');
  fs.writeFileSync(file, `${JSON.stringify(f(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2)}\n`);
  p.git('commit', '-q', '-am', 'fixture');
};

// Copilot on #118 (4437630094): delivery-manager is typed for delivery-lead wherever a role id is typed
test('team-role add: delivery-manager is the Delivery Manager\'s id, delivery-lead', () => {
  const p = project();
  assert.match(addRole(p.root, 'delivery-manager').out, /delivery-lead is already on the team/);
  rewrite(p, (t) => ({ ...t, roles: t.roles.filter((r) => r.id !== 'delivery-lead') }));
  const r = addRole(p.root, 'delivery-manager');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(p.team().roles.find((x) => x.id === 'delivery-lead'), { id: 'delivery-lead', brief: 'delivery/delivery-lead', host: 'pc', model: 'sonnet' });
  assert.equal(p.team().roles.some((x) => x.id === 'delivery-manager'), false);
});

// Copilot on #118 (4437630106): a retired role does not run, so its host does not vote
test('team-role add: the default host is the one most active roles run on; retired roles do not vote', () => {
  const p = project();
  // every active role moved to buildbox; eight retired roles left on pc outnumber them
  rewrite(p, (t) => ({ ...t, roles: [...t.roles.map((r) => ({ ...r, host: 'buildbox' })),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `old-${n}`, brief: `project/old-${n}`, host: 'pc', model: 'sonnet', retired: true }))] }));
  const r = addRole(p.root, 'tech-writer');
  assert.equal(r.code, 0, r.out);
  assert.equal(p.team().roles.find((x) => x.id === 'tech-writer').host, 'buildbox');
});

// Copilot on #118 (4437630064): in a role session the roster change goes to the role's own clone, which
// it then publishes; the shared checkout DELIVERY_PROJECT_ROOT names is never written
test('team-role add: from a role directory it commits in the role\'s clone, not the shared checkout', () => {
  const p = project();
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-role-staffing-'));
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), JSON.stringify({ role: 'staffing', instance: 'staffing', project_root: p.root }));
  execFileSync('git', ['clone', '-q', p.root, path.join(roleDir, 'project')], { stdio: 'pipe' });
  const clone = (...a) => execFileSync('git', ['-C', path.join(roleDir, 'project'), ...a], { stdio: 'pipe' }).toString();
  clone('config', 'user.email', 't@t'); clone('config', 'user.name', 't');
  const shared = fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const env = { ...process.env, DELIVERY_PROJECT_ROOT: p.root };
  const r = spawnSync(process.execPath, [path.join(__dirname, 'team-role.js'), 'add', 'tech-writer'], { cwd: roleDir, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /committed in your clone/);
  assert.match(r.stdout, /push origin HEAD:staffing\/add-tech-writer/);
  assert.equal(fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8'), shared, 'the shared checkout is untouched');
  assert.equal(p.git('status', '--porcelain').trim(), '');
  const mine = JSON.parse(fs.readFileSync(path.join(roleDir, 'project', '.delivery', 'team', 'team.json'), 'utf8'));
  assert.ok(mine.roles.some((x) => x.id === 'tech-writer'));
  assert.match(clone('log', '-1', '--format=%s'), /team: add the tech-writer role/);
  assert.equal(clone('status', '--porcelain').trim(), '', 'committed in the clone');
  // --project still names a checkout explicitly (the operator's own)
  const q = project();
  const r2 = spawnSync(process.execPath, [path.join(__dirname, 'team-role.js'), 'add', 'tech-writer', '--project', q.root], { cwd: roleDir, env, encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(q.team().roles.some((x) => x.id === 'tech-writer'));
});

// rv-129 finding 1: the command line's exit status is the contract scripts and sessions read, so an
// unknown role must fail as a process, not only as a returned code
const CLI = path.join(__dirname, 'team-role.js');
const cli = (root, ...args) => spawnSync(process.execPath, [CLI, ...args, '--project', root], { encoding: 'utf8' });
test('team-role add: an unknown role fails with exit 1 and says why on stderr', () => {
  const p = project();
  assert.equal(addRole(p.root, 'astronaut').code, 1);
  const r = cli(p.root, 'add', 'astronaut');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /astronaut is not a role this plugin ships/);
  assert.equal(r.stdout, '');
  const u = spawnSync(process.execPath, [CLI, 'remove', 'builder'], { encoding: 'utf8' });
  assert.equal(u.status, 2);
  assert.match(u.stderr, /usage: team-role.js add/);
});

// the manifest's path as git prints it
const TEAM_GIT = path.posix.join('.delivery', 'team', 'team.json');
const lastCommit = (p) => p.git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').filter(Boolean);

// the builders are one entry with a count, kept within budget.builders_cap (lib/manifest.js)
test('team-role add builder --count: sets the builders\' count within the cap and commits team.json alone', () => {
  const p = project();
  rewrite(p, (t) => ({ ...t, roles: t.roles.map((r) => (r.id === 'builder' ? { ...r, count: 1 } : r)) }));
  const head = p.git('rev-parse', 'HEAD');
  const dry = cli(p.root, 'add', 'builder', '--count', '3', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would set builder count to 3/);
  assert.equal(p.git('rev-parse', 'HEAD'), head, 'a dry run commits nothing');
  assert.equal(p.team().roles.find((r) => r.id === 'builder').count, 1, 'a dry run writes nothing');
  const r = cli(p.root, 'add', 'builder', '--count', '3');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /set builder count to 3; committed/);
  const b = p.team().roles.filter((x) => x.id === 'builder');
  assert.equal(b.length, 1, 'still one builder entry');
  assert.equal(b[0].count, 3);
  assert.equal(b[0].host, 'pc', 'the entry keeps its host');
  assert.deepEqual(lastCommit(p), ['team: 3 builders (team-role.js)', TEAM_GIT]);
  assert.equal(p.git('status', '--porcelain').trim(), '');
});

test('team-role add builder --count: refuses above builders_cap, naming it, and every malformed count', () => {
  const p = project();
  const text = () => fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const before = text();
  const head = p.git('rev-parse', 'HEAD');
  const over = cli(p.root, 'add', 'builder', '--count', '4');
  assert.equal(over.status, 1);
  assert.match(over.stderr, /4 builders is above builders_cap 3/);
  assert.match(over.stderr, /set-cap builders 4 --record <dec-id>/);
  for (const bad of ['0', '-1', '2.5', 'two', '']) {
    const r = cli(p.root, 'add', 'builder', '--count', bad);
    assert.equal(r.status, 1, `--count ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /--count must be a whole number from 1/);
  }
  const same = cli(p.root, 'add', 'builder', '--count', '2');
  assert.equal(same.status, 1);
  assert.match(same.stderr, /already has 2 builders/);
  const other = cli(p.root, 'add', 'tech-writer', '--count', '2');
  assert.equal(other.status, 1);
  assert.match(other.stderr, /--count is for the builders only/);
  const plain = cli(p.root, 'add', 'builder');
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /builder is already on the team; more builders: team-role.js add builder --count <n>/);
  assert.equal(text(), before);
  assert.equal(p.git('rev-parse', 'HEAD'), head);
});

// set-cap: the owner's decision, recorded and verifying, is the only way the cap moves
function capProject() {
  const { goalProject } = require('./testing/goal-fixture.js');
  const g = goalProject();
  const git = (...a) => execFileSync('git', a, { cwd: g.root, stdio: 'pipe' }).toString();
  const dec = g.decide(g.say('Yes, run two builders.'), 'Yes, run two builders.');
  // decisions the owner made: about something else, and about the cap in words that do not name it
  const unrelated = g.decide(g.say('Yes, only through a validated command.'), 'Yes, only through a validated command.');
  const labelled = g.decide(g.say('Yes, raise it.'), 'Yes, raise it.', 'budget:builders_cap');
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'team.json'), path.join(g.root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(MANIFEST_FIXTURE, 'hosts.json'), path.join(g.root, '.delivery', 'team', 'hosts.json'));
  git('add', '--', path.join('.delivery', 'team')); git('commit', '-q', '-m', 'init');
  const p = { root: g.root, git, team: () => JSON.parse(fs.readFileSync(path.join(g.root, '.delivery', 'team', 'team.json'), 'utf8')) };
  return { p, dec, unrelated, labelled };
}

test('team-role set-cap builders: raises builders_cap on a verifying owner decision, committing team.json alone', () => {
  const { p, dec } = capProject();
  const head = p.git('rev-parse', 'HEAD');
  const dry = cli(p.root, 'set-cap', 'builders', '5', '--record', dec, '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, new RegExp(`would set builders_cap to 5 under ${dec}`));
  assert.equal(p.team().budget.builders_cap, 3, 'a dry run writes nothing');
  assert.equal(p.git('rev-parse', 'HEAD'), head);
  const r = cli(p.root, 'set-cap', 'builders', '5', '--record', dec);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /set builders_cap to 5/);
  assert.deepEqual(p.team().budget, { max_roles: 12, builders_cap: 5, staleness_hours: 2 }, 'only the cap changes');
  assert.deepEqual(lastCommit(p), [`team: builders_cap 5 under ${dec} (team-role.js)`, TEAM_GIT]);
  // the raised cap is what add builder --count now reads
  const more = cli(p.root, 'add', 'builder', '--count', '5');
  assert.equal(more.status, 0, more.stderr);
  assert.equal(p.team().roles.find((x) => x.id === 'builder').count, 5);
});

test('team-role set-cap builders: refuses without a verifying owner decision, and any cap the team would break', () => {
  const { p, dec, unrelated } = capProject();
  const text = () => fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const before = text();
  const head = p.git('rev-parse', 'HEAD');
  const refused = (args, re) => {
    const r = cli(p.root, 'set-cap', ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
    assert.equal(r.stdout, '');
  };
  refused(['builders', '5'], /builders_cap stays as it is: the cap changes only on an owner decision record/);
  refused(['builders', '5', '--record', 'in-pc-000001'], /only on an owner decision record/);
  refused(['builders', '5', '--record', 'dec-chief-of-staff-999999'], /builders_cap stays as it is: dec-chief-of-staff-999999 does not verify/);
  refused(['builders', '5', '--record', unrelated], new RegExp(`builders_cap stays as it is: ${unrelated} is not about the builders`));
  refused(['builders', 'two', '--record', dec], /the cap must be a whole number from 1/);
  refused(['builders', '0', '--record', dec], /the cap must be a whole number from 1/);
  refused(['roles', '5', '--record', dec], /set-cap takes builders, not roles/);
  refused(['builders', '3', '--record', dec], /builders_cap is already 3/);
  // the fixture runs two builders: a cap of one would make the manifest invalid
  refused(['builders', '1', '--record', dec], /would make team.json invalid:\n {2}team.json: 2 builders exceed builders_cap 1/);
  const u = spawnSync(process.execPath, [CLI, 'set-cap', 'builders', '--project', p.root], { encoding: 'utf8' });
  assert.equal(u.status, 2);
  assert.match(u.stderr, /usage:/);
  assert.equal(text(), before);
  assert.equal(p.git('rev-parse', 'HEAD'), head);
});

// what verifies is not always the owner's word: a revoked record, one resting on an agent's message and
// a captured input are each refused (the command line cannot build these, so the verifier is given)
test('team-role set-cap builders: a revoked record, an agent\'s words and a bare input are not the owner\'s decision', () => {
  const p = project();
  const before = fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8');
  const human = { kind: 'input', source: 'human', text: 'yes, two builders' };
  const v = (over) => () => ({ ok: true, notes: [], chain: [{ kind: 'decision', quote: 'yes' }, human], ...over });
  const ok = setCap(p.root, 'builders', '4', { record: 'dec-x-1', verifyRecord: v({}) });
  assert.equal(ok.code, 0, ok.out);
  assert.equal(p.team().budget.builders_cap, 4);
  p.git('reset', '-q', '--hard', 'HEAD~1');
  const cases = [
    [v({ notes: ['revoked by dec-x-2'] }), /dec-x-1 was revoked or superseded/],
    [v({ chain: [{ kind: 'decision', quote: 'yes' }, { kind: 'input', source: 'agent', text: 'raise it' }] }), /rests on a agent message, not the owner's words/],
    [v({ chain: [{ kind: 'decision', quote: 'yes' }] }), /rests on no captured input from the owner/],
    [v({ chain: [{ kind: 'question', quote: 'yes' }, human] }), /dec-x-1 is not an owner decision/],
    [() => ({ ok: false, code: 'not_found' }), /dec-x-1 does not verify \(not_found\)/],
    [() => { throw new Error('store unreadable'); }, /dec-x-1 does not verify \(no result\)/],
  ];
  for (const [verifyRecord, re] of cases) {
    const r = setCap(p.root, 'builders', '4', { record: 'dec-x-1', verifyRecord });
    assert.equal(r.code, 1, String(re));
    assert.match(r.out, re);
  }
  assert.equal(fs.readFileSync(path.join(p.root, '.delivery', 'team', 'team.json'), 'utf8'), before);
});

test('team-role set-cap builders: a decision scoped budget:builders_cap counts though its words do not name builders', () => {
  const { p, labelled } = capProject();
  const r = cli(p.root, 'set-cap', 'builders', '4', '--record', labelled);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.team().budget.builders_cap, 4);
});

// a role session writes team.json in its own clone, which has no operator store: the record is verified in
// the shared project its role marker names (PR 129 re-review: dec-chief-of-staff-000215 came back not_found)
test('team-role set-cap builders: in a role session, verifies the record in the marker project and commits in the clone', () => {
  const { p, dec } = capProject();
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-staffing-'));
  const clone = path.join(roleDir, 'project');
  execFileSync('git', ['clone', '-q', p.root, clone], { stdio: 'pipe' });
  const cgit = (...a) => execFileSync('git', a, { cwd: clone, stdio: 'pipe' }).toString();
  cgit('config', 'user.email', 't@t'); cgit('config', 'user.name', 't');
  assert.equal(fs.existsSync(path.join(clone, '.delivery', 'operator')), false, 'the clone holds no operator store');
  fs.writeFileSync(path.join(roleDir, '.delivery-role.json'), JSON.stringify({ instance: 'staffing', role: 'staffing', project_root: p.root }));
  const sharedHead = p.git('rev-parse', 'HEAD');
  const r = spawnSync(process.execPath, [CLI, 'set-cap', 'builders', '5', '--record', dec], { cwd: roleDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(clone, '.delivery', 'team', 'team.json'), 'utf8')).budget.builders_cap, 5);
  assert.match(cgit('log', '-1', '--format=%s'), new RegExp(`builders_cap 5 under ${dec}`));
  assert.equal(p.git('rev-parse', 'HEAD'), sharedHead, 'the shared checkout is not written');
  assert.equal(p.team().budget.builders_cap, 3);
});
