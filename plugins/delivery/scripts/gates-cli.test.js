// scripts/gates-cli.test.js — ready.js, evidence.js, warnings.js and surface.js on a Vault project with an
// in-memory bd, outside a role session (the owner at a terminal). No judge: the judge is off here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('./lib/gates.js');
const W = require('./lib/warnings.js');
const { STORY, makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const ready = require('./ready.js');
const evidence = require('./evidence.js');
const warnings = require('./warnings.js');
const surface = require('./surface.js');

const env = {};
const NOW = '2026-10-13T08:00:00Z';
const setup = (story, over) => {
  const root = makeProject(story ? { story } : {});
  const bd = memBd([storyBead(over)]);
  const ev = (...argv) => evidence.main([...argv, '--project', root], { cwd: root, env, bd, now: NOW, verifyRecord: (r, id) => ({ ok: id === 'dec-chief-of-staff-41' }) });
  return { root, bd, ev, bead: () => bd.show('ex-vault-0n9-3') };
};

test('ready.js, vault-0n9.3 without a measurement plan: a recorded warning, exit 0; --record stamps the criteria hash', async () => {
  const { root, bd, bead } = setup(STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, ''));
  const r = await ready.main(['ex-vault-0n9-3', '--record', '--project', root], { cwd: root, env, bd, now: NOW });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /warn R-19 measurement-plan/);
  assert.deepEqual(W.list(root).map((w) => [w.kind, w.bead]), [['measurement-plan', 'ex-vault-0n9-3']]);
  assert.equal(bead().metadata.ready_hash, G.criteriaHash(G.parseStory(STORY).criteria));
  // changed criteria re-record only with an owner record that verifies (D1)
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), STORY.replace('with the card count', 'with something'));
  const again = (extra) => ready.main(['ex-vault-0n9-3', '--record', ...extra, '--project', root], { cwd: root, env, bd, verifyRecord: (x, id) => ({ ok: id === 'dec-chief-of-staff-50', error: 'not found' }) });
  assert.match((await again([])).out, /criteria changed since they were made ready \(D1\)/);
  assert.match((await again(['--owner-record', 'dec-x-1'])).out, /dec-x-1: not found/);
  assert.equal((await again(['--owner-record', 'dec-chief-of-staff-50'])).code, 0);
  assert.equal(bead().metadata.ready_record, 'dec-chief-of-staff-50');
});

test('ready.js --story checks a story file before it has a bead; an undeclared surface is a block', async () => {
  const root = makeProject({ story: STORY.replace('surface: S1', 'surface: S7') });
  const r = await ready.main(['--story', path.join(root, '.delivery', 'stories', 'vault-0n9-3.md'), '--initiative', 'vault', '--project', root], { cwd: root, env });
  assert.equal(r.code, 1);
  assert.match(r.out, /block D2 surface-unknown/);
});

test('evidence.js, 10-11 05:40: a row by the author is refused and nothing is written', () => {
  const { root, ev } = setup();
  const r = ev('add', 'ex-vault-0n9-3', '--criterion', '1', '--result', 'pass', '--surface', 'S1', '--sha', 'd478', '--by', 'builder');
  assert.equal(r.code, 1);
  assert.match(r.out, /the builder is not its own inspector/);
  assert.deepEqual(G.readEvidence(root, 'ex-vault-0n9-3'), []);
});

test('evidence.js, 10-17: a pass from Codex mode when the surface is ChatGPT plain chat is refused and kept as a side arm', () => {
  const { root, ev } = setup();
  for (const argv of [['--surface', 'S1', '--mode', 'codex'], ['--surface', 'S2']]) {
    const r = ev('add', 'ex-vault-0n9-3', '--criterion', '1', '--result', 'pass', '--sha', 'd478', '--by', 'delivery-lead', ...argv);
    assert.equal(r.code, 1);
    assert.match(r.out, /refused as verification of S1 \(D2\): observed on ChatGPT web, codex/);
  }
  assert.deepEqual(G.readEvidence(root, 'ex-vault-0n9-3').map((x) => x.arm), ['side', 'side']);
});

test('evidence.js: merged, deployed, then a pass per criterion by the Delivery Manager verifies the story; a new deploy unverifies it', () => {
  const { ev, bead } = setup();
  const add = (n, sha = 'd478') => ev('add', 'ex-vault-0n9-3', '--criterion', String(n), '--result', 'pass', '--surface', 'S1', '--sha', sha, '--by', 'delivery-lead', '--run', 'rc-1');
  assert.equal(ev('state', 'ex-vault-0n9-3', 'merged', '--pr', '478').code, 0);
  assert.equal(G.stateOf(bead()), 'merged');
  assert.equal(ev('state', 'ex-vault-0n9-3', 'deployed', '--sha', 'd478').code, 0);
  assert.equal(add(1, 'old').code, 1, 'a row on another sha is a side arm');
  assert.equal(add(1).code, 0);
  assert.equal(G.stateOf(bead()), 'deployed');
  assert.match(add(2).out, /all criteria verified/);
  assert.equal(G.stateOf(bead()), 'verified');
  assert.equal(ev('add', 'ex-vault-0n9-3', '--criterion', '3', '--result', 'pass', '--surface', 'S1', '--sha', 'd478', '--by', 'delivery-lead').code, 1, 'no criterion 3');
  ev('state', 'ex-vault-0n9-3', 'deployed', '--sha', 'd479');
  assert.equal(G.stateOf(bead()), 'deployed');
  assert.equal(ev('check', 'ex-vault-0n9-3').code, 1);
});

test('evidence.js waive, #41: before the gate with a verified record it counts; after deploy it is refused (D3b)', () => {
  const { ev } = setup();
  assert.equal(ev('waive', 'ex-vault-0n9-3', '--criterion', '2', '--record', 'dec-x-1', '--risk', 'r', '--by', 'delivery-lead').code, 1, 'an unverified record');
  assert.equal(ev('waive', 'ex-vault-0n9-3', '--criterion', '2', '--record', 'dec-chief-of-staff-41', '--risk', 'skipped columns stay silent', '--by', 'delivery-lead').code, 0);
  ev('state', 'ex-vault-0n9-3', 'deployed', '--sha', 'd478');
  const late = ev('waive', 'ex-vault-0n9-3', '--criterion', '1', '--record', 'dec-chief-of-staff-41', '--risk', 'r', '--by', 'delivery-lead');
  assert.equal(late.code, 1);
  assert.match(late.out, /past its gate/);
});

test('warnings.js: list shows counts; ack is refused to another role and recorded for the operator outside a role session', () => {
  const { root } = setup();
  const w = W.record(root, { kind: 'probe', bead: 'ex-1', detail: 'no probe', instance: 'builder-1', now: '2026-10-10T08:00:00Z' });
  const run = (argv, e = env) => warnings.main([...argv, '--project', root], { cwd: root, env: e, now: NOW });
  assert.match(run(['list']).out, /1 open, 0 acknowledged; 1 open over 24 h/);
  assert.match(run(['ack', w.id, '--reason', 'x'], { DELIVERY_ROLE: 'builder-1' }).out, /only the Delivery Manager/);
  assert.equal(run(['ack', w.id, '--reason', 'probe added']).code, 0);
  assert.equal(W.list(root)[0].acked_by, 'operator');
});

test('surface.js check: ok for the fixture, a problem exits 1', () => {
  const root = makeProject();
  assert.match(surface.main(['check', 'vault', '--project', root], { cwd: root, env }).out, /^ok: S1 \(ChatGPT web, plain chat/);
  fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'vault', 'surface.json'), '{"surfaces":[{"id":"S1"}]}');
  assert.equal(surface.main(['check', 'vault', '--project', root], { cwd: root, env }).code, 1);
});
