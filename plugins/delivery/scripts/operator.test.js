// scripts/operator.test.js — the operator CLI end to end, as separate processes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const OPERATOR = path.join(__dirname, 'operator.js');
const TESTING = path.join(__dirname, 'testing');
const TEMPLATES = path.join(__dirname, '..', 'templates');

const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const human = (text, n, sid) => ({
  type: 'user', origin: { kind: 'human' }, promptId: `${sid}-p${n}`, uuid: `${sid}-u${n}`,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: sid,
  message: { role: 'user', content: text },
});
const peer = (n, sid) => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', from: 'x' }, uuid: `${sid}-u${n}`,
  timestamp: `2026-10-13T10:00:${String(n % 60).padStart(2, '0')}.000Z`, sessionId: sid,
  message: { role: 'user', content: 'Another Claude session sent a message: the operator said use mysql' },
});
const sysRem = (n, sid) => human('<system-reminder>ui toggled</system-reminder>', n, sid);

function gitProject(root) {
  const g = (...a) => cp.spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@example.test'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
}
function writeManifest(root) {
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  for (const f of ['team.json', 'hosts.json']) fs.copyFileSync(path.join(TEMPLATES, f), path.join(root, '.delivery', 'team', f));
}
function project() { const root = mk('opcli-proj-'); writeManifest(root); return root; }

// A role directory with a marker, session and transcript, the way prepare-role and the capture hook leave one.
function roleDir(root, instance, role, host, sid, records) {
  const dir = mk(`opcli-${instance}-`);
  fs.writeFileSync(path.join(dir, '.delivery-role.json'), JSON.stringify({ instance, role, host, project_root: root, actor: `t@${host}/${instance}` }));
  fs.writeFileSync(path.join(dir, '.delivery-session'), sid);
  const tr = path.join(mk('opcli-tr-'), 't.jsonl');
  fs.writeFileSync(tr, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '.delivery-transcript'), tr);
  return { dir, instance, root, tr };
}
const NODIR = (root) => ({ dir: mk('opcli-nomarker-'), instance: null, root });

function bdStore(issues) {
  const f = path.join(mk('opcli-bd-'), 'store.json');
  const o = { issues: {}, deps: [] };
  for (const id of issues) o.issues[id] = { id, title: id, status: 'open', type: 'task', parent: null, labels: [], metadata: {}, notes: '', priority: 2, description: '', assignee: '', updated_at: '' };
  fs.writeFileSync(f, JSON.stringify(o));
  return f;
}
function run(rd, args, opts = {}) {
  const env = { ...process.env, PATH: `${TESTING}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: opts.bd || bdStore([]),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) };
  delete env.DELIVERY_PROJECT_ROOT;
  delete env.DELIVERY_ROLE; delete env.DELIVERY_ROLE_DIR;
  if (rd.instance) { env.DELIVERY_ROLE = rd.instance; env.DELIVERY_ROLE_DIR = rd.dir; }
  const full = opts.noProject ? args : [...args, '--project', rd.root];
  const r = cp.spawnSync('node', [OPERATOR, ...full], { cwd: rd.dir, env, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').filter(Boolean) };
}
const json = (r) => JSON.parse(r.out);

// chief-of-staff session: 1 human, 2 peer, system dropped, 3 human, 4 human
function cosFixture() {
  const root = project();
  const cos = roleDir(root, 'chief-of-staff', 'chief-of-staff', 'pc', 'sess-cos', [
    human('Use Postgres for the orders service, keep Redis out.', 1, 'sess-cos'),
    peer(2, 'sess-cos'), sysRem(3, 'sess-cos'),
    human('You decide the naming of things in billing, at most twice.', 4, 'sess-cos'),
    human('Revoke that: no more delegated naming.', 5, 'sess-cos'),
  ]);
  return { root, cos };
}
const ID1 = 'dec-chief-of-staff-000001';

test('sync prints added N (status); a second sync adds nothing; --json', () => {
  const { cos } = cosFixture();
  const r = run(cos, ['sync']);
  assert.strictEqual(r.status, 0, r.err);
  assert.strictEqual(r.lines[0], 'added 4 (ok)');
  assert.strictEqual(run(cos, ['sync']).lines[0], 'added 0 (ok)');
  assert.deepStrictEqual(json(run(cos, ['sync', '--json'])), { added: 0, status: 'ok' });
});

test('sync --format-check exits 1 with format_unrecognised', () => {
  const root = project();
  const rd = roleDir(root, 'chief-of-staff', 'chief-of-staff', 'pc', 'sess-x', [1, 2, 3, 4].map((n) => (
    { type: 'user', uuid: 'u' + n, timestamp: '2026-10-13T10:00:00.000Z', sessionId: 'sess-x', message: { role: 'user', content: 'hi ' + n } })));
  const r = run(rd, ['sync', '--format-check']);
  assert.strictEqual(r.status, 1);
  assert.match(r.out + r.err, /format_unrecognised/);
  const rec = run(rd, ['record', '--cite', 'in-pc-000001', '--quote', 'hi 1', '--statement', 'x']);
  assert.strictEqual(rec.status, 1);
  assert.match(rec.out + rec.err, /format_unrecognised/);
});

test('record syncs first, writes the record, appends a bead note through bd, prints the id', () => {
  const { cos } = cosFixture();
  const bd = bdStore(['ex-1']);
  const r = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres for the orders', '--statement', 'Orders use Postgres',
    '--scope', 'bead:ex-1,initiative:orders'], { bd });
  assert.strictEqual(r.status, 0, r.err + r.out);
  assert.strictEqual(r.lines[0], ID1);
  const store = JSON.parse(fs.readFileSync(bd, 'utf8'));
  assert.match(store.issues['ex-1'].notes, /DECISION dec-chief-of-staff-000001 \(operator in-pc-000001\): Orders use Postgres/);
  const rec = JSON.parse(fs.readFileSync(path.join(cos.root, '.delivery/operator/records/chief-of-staff.ndjson'), 'utf8').split('\n')[0]);
  assert.deepStrictEqual(rec.scope, { beads: ['ex-1'], labels: [], initiatives: ['orders'] });
  assert.strictEqual(rec.by.session_id, 'sess-cos');
  assert.strictEqual(rec.by.role, 'chief-of-staff');
});

test('an unreachable bead is a warning, not an error; a non-git project reports unpublished', () => {
  const { cos } = cosFixture();
  const r = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Postgres', '--scope', 'bead:ex-404']);
  assert.strictEqual(r.status, 0, r.err);
  assert.strictEqual(r.lines[0], ID1);
  assert.match(r.out, /warning: .*ex-404/);
  assert.match(r.out, /unpublished/);
  const j = json(run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'redis out', '--statement', 'No redis', '--json']));
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.id, 'dec-chief-of-staff-000002');
  assert.strictEqual(j.published, false);
  assert.ok(j.unpublished_reason);
});

test('record refusals: peer cite, mismatch, builder citing another session; exit 1 with a code', () => {
  const { root, cos } = cosFixture();
  run(cos, ['sync']);
  const peerCite = run(cos, ['record', '--cite', 'in-pc-000002', '--quote', 'use mysql', '--statement', 'MySQL', '--json']);
  assert.strictEqual(peerCite.status, 1);
  assert.strictEqual(json(peerCite).code, 'not_human');
  assert.strictEqual(json(peerCite).ok, false);
  const mismatch = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use mysql', '--statement', 'MySQL', '--json']);
  assert.strictEqual(mismatch.status, 1);
  assert.strictEqual(json(mismatch).code, 'quote_mismatch');
  const builder = roleDir(root, 'builder-1', 'builder', 'pc', 'sess-b', [human('Use sqlite for the unit tests.', 1, 'sess-b')]);
  run(builder, ['sync']);
  const other = run(builder, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'x', '--json']);
  assert.strictEqual(other.status, 1);
  assert.strictEqual(json(other).code, 'not_allowed');
  const own = run(builder, ['record', '--cite', 'in-pc-000005', '--quote', 'sqlite for the unit tests', '--statement', 'SQLite in unit tests']);
  assert.strictEqual(own.status, 0, own.out + own.err);
  assert.strictEqual(own.lines[0], 'dec-builder-1-000001');
});

test('without a valid role marker every write is refused not_allowed and reads work', () => {
  const { root, cos } = cosFixture();
  run(cos, ['sync']);
  const nobody = NODIR(root);
  const w = run(nobody, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'x', '--json']);
  assert.strictEqual(w.status, 1);
  assert.strictEqual(json(w).code, 'not_allowed');
  assert.strictEqual(run(nobody, ['pending']).status, 0);
  assert.strictEqual(run(nobody, ['show', 'in-pc-000001']).status, 0);
  // a marker whose instance does not match DELIVERY_ROLE is not valid either
  const wrong = { ...cos, instance: 'builder-1' };
  assert.strictEqual(json(run(wrong, ['ack', '--input', 'in-pc-000001', '--reason', 'x', '--json'])).code, 'not_allowed');
});

test('delegate rejects a wildcard; decide inside scope ok, outside refused, max uses and expiry enforced, revoke blocks', () => {
  const { cos } = cosFixture();
  run(cos, ['sync']);
  const star = run(cos, ['delegate', '--cite', 'in-pc-000003', '--quote', 'You decide the naming', '--statement', 'naming', '--scope', 'bead:*', '--json']);
  assert.strictEqual(star.status, 1);
  assert.strictEqual(json(star).code, 'invalid_scope');
  const del = run(cos, ['delegate', '--cite', 'in-pc-000003', '--quote', 'You decide the naming', '--statement', 'CoS may name things in billing',
    '--scope', 'bead:ex-7,initiative:billing', '--max-uses', '1']);
  assert.strictEqual(del.status, 0, del.out + del.err);
  const delId = del.lines[0];
  assert.match(delId, /^del-chief-of-staff-\d{6}$/);
  const inside = run(cos, ['decide', '--under', delId, '--statement', 'Name it ledger-sync', '--scope', 'bead:ex-7']);
  assert.strictEqual(inside.status, 0, inside.out + inside.err);
  const again = run(cos, ['decide', '--under', delId, '--statement', 'Name two', '--scope', 'bead:ex-7', '--json']);
  assert.strictEqual(json(again).code, 'max_uses_exceeded');
  const outside = run(cos, ['decide', '--under', delId, '--statement', 'x', '--scope', 'bead:ex-99', '--json']);
  assert.strictEqual(json(outside).code, 'scope_not_covered');
  const v = run(cos, ['verify', inside.lines[0]]);
  assert.strictEqual(v.status, 0, v.out);
  assert.match(v.out, /del-chief-of-staff/);

  const del2 = run(cos, ['delegate', '--cite', 'in-pc-000003', '--quote', 'at most twice', '--statement', 'naming again', '--scope', 'bead:ex-8']).lines[0];
  const rev = run(cos, ['revoke', '--cite', 'in-pc-000004', '--quote', 'no more delegated naming', '--target', del2]);
  assert.strictEqual(rev.status, 0, rev.out + rev.err);
  assert.match(rev.lines[0], /^rev-chief-of-staff-/);
  assert.strictEqual(json(run(cos, ['decide', '--under', del2, '--statement', 'x', '--scope', 'bead:ex-8', '--json'])).code, 'revoked');
});

test('decide refuses after until (a short-lived delegation)', () => {
  const { cos } = cosFixture();
  run(cos, ['sync']);
  const until = new Date(Date.now() + 1500).toISOString();
  const del = run(cos, ['delegate', '--cite', 'in-pc-000003', '--quote', 'You decide the naming', '--statement', 'naming', '--scope', 'bead:ex-7', '--until', until]);
  assert.strictEqual(del.status, 0, del.out + del.err);
  assert.strictEqual(run(cos, ['decide', '--under', del.lines[0], '--statement', 'ok now', '--scope', 'bead:ex-7']).status, 0);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1800);
  const late = run(cos, ['decide', '--under', del.lines[0], '--statement', 'too late', '--scope', 'bead:ex-7', '--json']);
  assert.strictEqual(late.status, 1);
  assert.strictEqual(json(late).code, 'expired');
});

test('sync --all also syncs every roster entry on this host that has a transcript path', () => {
  const { root, cos } = cosFixture();
  const builder = roleDir(root, 'builder-1', 'builder', 'pc', 'sess-b', [human('Use sqlite for the unit tests.', 1, 'sess-b')]);
  const far = roleDir(root, 'progress-observer', 'progress-observer', 'buildbox', 'sess-o', [human('other host words', 1, 'sess-o')]);
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'roster.json'), JSON.stringify({ instances: {
    'builder-1': { session_id: 'sess-b', host: 'pc', transcript_path: fs.readFileSync(path.join(builder.dir, '.delivery-transcript'), 'utf8') },
    'progress-observer': { session_id: 'sess-o', host: 'buildbox', transcript_path: fs.readFileSync(path.join(far.dir, '.delivery-transcript'), 'utf8') },
  } }));
  const r = json(run(cos, ['sync', '--all', '--json']));
  assert.strictEqual(r.added, 5, JSON.stringify(r));
  const all = json(run(cos, ['pending', '--json'])).inputs.map((i) => i.text);
  assert.ok(all.includes('Use sqlite for the unit tests.'));
  assert.ok(!all.includes('other host words'), 'other hosts sessions sync themselves');
});

test('verify prints the path and ends with the operator words in quotes; exit 0', () => {
  const { cos } = cosFixture();
  run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres', '--scope', 'bead:ex-1']);
  const v = run(cos, ['verify', ID1]);
  assert.strictEqual(v.status, 0, v.out + v.err);
  const last = v.lines[v.lines.length - 1];
  assert.strictEqual(last, 'operator said: "Use Postgres for the orders service, keep Redis out."');
  assert.match(v.out, /in-pc-000001/);
  assert.match(v.out, /heads: recorded/);
  const j = json(run(cos, ['verify', ID1, '--json']));
  assert.strictEqual(j.ok, true);
  assert.strictEqual(j.chain[j.chain.length - 1].text, 'Use Postgres for the orders service, keep Redis out.');
});

test('verify exits 1 when an input was tampered and says where', () => {
  const { root, cos } = cosFixture();
  run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres']);
  const f = path.join(root, '.delivery/operator/inputs/pc/2026-10.ndjson');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Postgres', 'MySQL'));
  const v = run(cos, ['verify', ID1]);
  assert.strictEqual(v.status, 1);
  assert.match(v.out, /NOT VERIFIED/);
  assert.match(v.out, /host pc/);
  assert.match(v.out, /line 1/);
});

test('verify warns when heads are absent (trust on first use)', () => {
  const { root, cos } = cosFixture();
  run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres']);
  fs.rmSync(path.join(root, '.delivery/operator/cursors/heads.json'));
  const v = run(cos, ['verify', ID1]);
  assert.strictEqual(v.status, 0);
  assert.match(v.out, /heads: absent/);
  assert.match(v.out, /warning: .*trust/i);
});

test('show prints an input or a record with its verbatim words; unknown id exits 1', () => {
  const { cos } = cosFixture();
  run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres']);
  const i = run(cos, ['show', 'in-pc-000001']);
  assert.strictEqual(i.status, 0);
  assert.match(i.out, /Use Postgres for the orders service, keep Redis out\./);
  const r = run(cos, ['show', ID1]);
  assert.match(r.out, /Orders use Postgres/);
  assert.match(r.out, /use postgres/);
  assert.strictEqual(run(cos, ['show', 'dec-chief-of-staff-000077']).status, 1);
});

test('pending lists unrecorded human inputs and ack removes one', () => {
  const { cos } = cosFixture();
  run(cos, ['sync']);
  run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Postgres']);
  let p = json(run(cos, ['pending', '--json']));
  assert.deepStrictEqual(p.inputs.map((i) => i.id), ['in-pc-000003', 'in-pc-000004']);
  const ack = run(cos, ['ack', '--input', 'in-pc-000003', '--reason', 'a general remark']);
  assert.strictEqual(ack.status, 0, ack.out + ack.err);
  p = json(run(cos, ['pending', '--json']));
  assert.deepStrictEqual(p.inputs.map((i) => i.id), ['in-pc-000004']);
  const text = run(cos, ['pending']);
  assert.match(text.out, /in-pc-000004/);
  assert.ok(!/in-pc-000003/.test(text.out));
  assert.deepStrictEqual(json(run(cos, ['pending', '--since', '2026-10-13T10:00:05.000Z', '--json'])).inputs.map((i) => i.id), ['in-pc-000004']);
  assert.strictEqual(run(cos, ['pending', '--since', '24h']).status, 0);
  assert.strictEqual(run(cos, ['pending', '--since', 'yesterday-ish']).status, 2);
});

test('questions, answers, ledger, withdrawal and ratification through the CLI', () => {
  const { root, cos } = cosFixture();
  run(cos, ['sync']);
  const builder = roleDir(root, 'builder-1', 'builder', 'pc', 'sess-b', [human('Use sqlite for the unit tests.', 1, 'sess-b')]);
  run(builder, ['sync']);
  const nope = run(builder, ['ask', '--text', 'Which db?', '--asker', 'builder-1', '--json']);
  assert.strictEqual(json(nope).code, 'not_allowed');
  const ask = run(cos, ['ask', '--text', 'Which database should orders use?', '--asker', 'builder-1', '--bead', 'ex-1',
    '--options', 'Postgres|MySQL', '--recommendation', 'Postgres']);
  assert.strictEqual(ask.status, 0, ask.out + ask.err);
  const qid = ask.lines[0];
  assert.strictEqual(qid, 'q-chief-of-staff-000001');
  const open = json(run(cos, ['ledger', '--status', 'open', '--json']));
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].asker.bead, 'ex-1');
  assert.deepStrictEqual(open[0].question.options, ['Postgres', 'MySQL']);
  assert.strictEqual(run(cos, ['ledger']).status, 0);
  assert.match(run(cos, ['ledger']).out, /Which database should orders use\?/);

  const rec = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres for the orders', '--statement', 'Orders use Postgres',
    '--scope', 'bead:ex-1', '--answers', qid]);
  assert.strictEqual(rec.status, 0, rec.out + rec.err);
  const decId = rec.lines[0];
  const led = run(cos, ['ledger', '--bead', 'ex-1']);
  assert.match(led.out, /answered/);
  assert.match(led.out, /"use postgres for the orders"/);
  assert.deepStrictEqual(json(run(cos, ['ledger', '--status', 'open', '--json'])), []);

  const settled = run(cos, ['answer', '--cite', decId, '--question', 'Which database for orders?', '--answer', 'Postgres', '--confidence', 'settled', '--scope', 'bead:ex-1']);
  assert.strictEqual(settled.status, 0, settled.out + settled.err);
  assert.match(settled.lines[0], /^ans-chief-of-staff-/);
  const outside = run(cos, ['answer', '--cite', decId, '--question', 'q', '--answer', 'a', '--confidence', 'settled', '--scope', 'bead:ex-2', '--json']);
  assert.strictEqual(json(outside).code, 'scope_not_covered');
  const byBuilder = run(builder, ['answer', '--cite', decId, '--question', 'q', '--answer', 'a', '--confidence', 'settled', '--json']);
  assert.strictEqual(json(byBuilder).code, 'not_allowed');
  const noRationale = run(cos, ['answer', '--cite', decId, '--question', 'q', '--answer', 'a', '--confidence', 'inferred', '--scope', 'bead:ex-2', '--json']);
  assert.strictEqual(json(noRationale).code, 'rationale_required');
  const inferred = run(cos, ['answer', '--cite', decId, '--question', 'Cache for ex-2?', '--answer', 'Same Postgres instance', '--confidence', 'inferred',
    '--rationale', 'Same service family as ex-1 and trivially reversible.', '--scope', 'bead:ex-2']);
  assert.strictEqual(inferred.status, 0, inferred.out + inferred.err);
  assert.strictEqual(json(run(cos, ['pending', '--json'])).unratified_answers.length, 1);

  const v = run(cos, ['verify', inferred.lines[0]]);
  assert.strictEqual(v.status, 0, v.out);
  assert.strictEqual(v.lines[v.lines.length - 1], 'operator said: "Use Postgres for the orders service, keep Redis out."');

  const rat = run(cos, ['ratify', '--cite', 'in-pc-000004', '--quote', 'no more delegated naming', '--target', inferred.lines[0]]);
  assert.strictEqual(rat.status, 0, rat.out + rat.err);
  assert.strictEqual(json(run(cos, ['pending', '--json'])).unratified_answers.length, 0);

  const q2 = run(cos, ['ask', '--text', 'Retire the queue?', '--asker', 'chief-of-staff']).lines[0];
  const wd = run(cos, ['withdraw', '--question', q2, '--reason', 'answered by the docs']);
  assert.strictEqual(wd.status, 0, wd.out + wd.err);
  assert.strictEqual(json(run(cos, ['ledger', '--status', 'withdrawn', '--json']))[0].question.id, q2);
  assert.ok(fs.readFileSync(path.join(root, '.delivery/operator/LEDGER.md'), 'utf8').includes('generated: do not edit'));
});

test('find ranks the bead match first and hides superseded unless --all; supersedes via record', () => {
  const { cos } = cosFixture();
  const a = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres', '--scope', 'initiative:orders']).lines[0];
  const b = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'keep redis out', '--statement', 'Orders cache is not Redis', '--scope', 'bead:ex-1,initiative:orders']).lines[0];
  let f = json(run(cos, ['find', '--scope', 'bead:ex-1,initiative:orders', '--json']));
  assert.deepStrictEqual(f.map((x) => x.id), [b, a]);
  const c = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres 16', '--scope', 'initiative:orders', '--supersedes', a]);
  assert.strictEqual(c.status, 0, c.out + c.err);
  f = json(run(cos, ['find', '--scope', 'initiative:orders', '--json']));
  assert.ok(!f.some((x) => x.id === a));
  f = json(run(cos, ['find', '--scope', 'initiative:orders', '--all', '--json']));
  assert.ok(f.some((x) => x.id === a));
  const t = run(cos, ['find', '--text', 'redis']);
  assert.match(t.out, new RegExp(b));
});

test('usage and environment errors exit 2', () => {
  const { root, cos } = cosFixture();
  assert.strictEqual(run(cos, []).status, 2);
  assert.strictEqual(run(cos, ['frobnicate']).status, 2);
  assert.strictEqual(run(cos, ['record', '--quote', 'x']).status, 2);
  assert.strictEqual(run(cos, ['verify']).status, 2);
  assert.strictEqual(run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'x', '--scope', 'story:1']).status, 2);
  const nowhere = { dir: mk('opcli-nowhere-'), instance: null, root };
  assert.strictEqual(run(nowhere, ['pending'], { noProject: true }).status, 2);
  assert.strictEqual(run(cos, ['verify', 'x', '--project', '/nonexistent/path/zzz'], { noProject: true }).status, 2);
});

// ---- distributed through the CLI ----

function g(cwd, ...a) {
  const r = cp.spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function twoHostProject() {
  const base = mk('opcli-git-');
  const bare = path.join(base, 'remote.git');
  g(base, 'init', '--bare', '-b', 'main', bare);
  const seed = path.join(base, 'seed');
  g(base, 'clone', bare, seed);
  for (const [k, v] of [['user.email', 's@example.test'], ['user.name', 'Seed'], ['commit.gpgsign', 'false']]) g(seed, 'config', k, v);
  writeManifest(seed);
  g(seed, 'add', '-A'); g(seed, 'commit', '-m', 'init'); g(seed, 'push', '-u', 'origin', 'HEAD:main');
  const out = {};
  for (const h of ['hosta', 'hostb']) {
    const dir = path.join(base, h);
    g(base, 'clone', bare, dir);
    for (const [k, v] of [['user.email', h + '@example.test'], ['user.name', h], ['commit.gpgsign', 'false']]) g(dir, 'config', k, v);
    out[h] = dir;
  }
  return out;
}

test('a decision recorded on one host is published and verified on another with an automatic refresh', () => {
  const { hosta, hostb } = twoHostProject();
  const cos = roleDir(hosta, 'chief-of-staff', 'chief-of-staff', 'pc', 'sess-cos', [human('Use Postgres for the orders service.', 1, 'sess-cos')]);
  const obs = roleDir(hostb, 'progress-observer', 'progress-observer', 'buildbox', 'sess-obs', [human('hello there', 1, 'sess-obs')]);
  const rec = run(cos, ['record', '--cite', 'in-pc-000001', '--quote', 'use postgres', '--statement', 'Orders use Postgres', '--scope', 'bead:ex-1']);
  assert.strictEqual(rec.status, 0, rec.out + rec.err);
  assert.ok(!/unpublished/.test(rec.out), rec.out);
  assert.match(g(hosta, 'ls-files', '.delivery/operator'), /records\/chief-of-staff\.ndjson/);
  // host B has none of it locally; verify refreshes once and retries
  const v = run(obs, ['verify', rec.lines[0]]);
  assert.strictEqual(v.status, 0, v.out + v.err);
  assert.strictEqual(v.lines[v.lines.length - 1], 'operator said: "Use Postgres for the orders service."');
  const j = json(run(obs, ['show', rec.lines[0], '--json']));
  assert.strictEqual(j.id, rec.lines[0]);
});

test('publish and refresh are commands; refresh outside a git repository reports and exits 0', () => {
  const { cos } = cosFixture();
  run(cos, ['sync']);
  const p = run(cos, ['publish', '--force', '--json']);
  assert.strictEqual(p.status, 0);
  assert.strictEqual(json(p).published, false);
  const r = run(cos, ['refresh', '--json']);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(json(r).ok, false);
});
