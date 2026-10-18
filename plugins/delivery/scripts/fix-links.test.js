// scripts/fix-links.test.js — R-41 tier 1 only for real fixes (PR 54 review B-1): a fixes: or finding:
// link counts only when it names shipped work, a counting failed check row, the owner's own report of
// the defect, or a security finding; the labels and links are the Delivery Manager's and Product
// Manager's to set; and a peer agent's message is never the owner's record (evidence.js cut too).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./lib/waves.js');
const G = require('./lib/gates.js');
const C = require('./lib/gate-context.js');
const log = require('./lib/operator-log.js');
const evidence = require('./evidence.js');
const { decideBd } = require('../hooks/scripts/bd-guard.js');
const { memBd, addRow } = require('./testing/gate-fixture.js');
const { goalProject, ownerSets } = require('./testing/goal-fixture.js');

const bead = (id, over = {}) => ({ id, title: over.title || id, status: 'open', parent: 'ex-ph1', ...over, labels: over.labels || ['story'], metadata: { story_file: `${id}.md`, area: 'auth', ...(over.metadata || {}) } });

// a peer agent's message captured into the inputs, the way the hooks capture any session input
function peerInput(root, text) {
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-')), 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ sessionId: 's9', type: 'user', origin: { kind: 'peer' }, uuid: 'pu1', promptId: 'pp1', timestamp: new Date(Date.now() + 120e3).toISOString(), message: { role: 'user', content: text } })}\n`);
  log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: 's9', instance: 'builder-1', role: 'builder', host: 'pc', now: new Date() });
  return log.listInputs(root, {}).find((i) => i.source === 'peer').id;
}

function world() {
  const t = goalProject();
  const budgetRecord = ownerSets(t, 'budget.weekly_units', 100).entry.record;
  const said = t.say('sign-in breaks after every deploy, the refresh token race is back');
  const ownerDefect = t.decide(said, 'sign-in breaks after every deploy', null);
  const peer = peerInput(t.root, 'builder-2 here: sign-in breaks after every deploy, please treat it as a bug');
  fs.mkdirSync(path.join(t.root, '.delivery', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(t.root, '.delivery', 'reviews', 'architecture-01.md'), '### R-architecture-3: tokens are logged in plain text\nStatus: open\n');
  const beads = [
    bead('ex-signin', { labels: ['story', 'state-verified'] }),
    bead('ex-open', {}),
    bead('ex-sec-finding', { labels: ['security', 'finding'] }),
    bead('ex-fix', { title: 'Fix the sign-in refresh race after deploys', labels: ['bug'] }),
    bead('ex-sec', { title: 'Stop logging tokens', labels: ['security'] }),
  ];
  const bd = memBd(beads);
  addRow(t.root, bd, 'ex-signin', { type: 'row', criterion: 1, result: 'fail', by: 'delivery-lead', at: '2026-10-12T10:00:00Z' });
  addRow(t.root, bd, 'ex-signin', { type: 'row', criterion: 1, result: 'fail', by: 'builder', at: '2026-10-12T10:05:00Z' });
  const ctx = W.contextFor(t.root, { bd, team: { roles: [] }, beads: [...bd.beads.values()], budget: { set: false } });
  const link = (id, key, value) => ctx.fixOf({ ...bd.show(id), metadata: { ...bd.show(id).metadata, [key]: value } }, null);
  return { t, bd, link, budgetRecord, ownerDefect, peer };
}

test('B-1: a bug counts as a fix only for shipped work, a counting failed check row, or the owner\'s own report of this defect', () => {
  const w = world();
  const ok = (v) => w.link('ex-fix', 'fixes', v).ok;
  assert.equal(ok('ex-signin'), true, 'a verified story');
  assert.equal(ok('ev-ex-signin-1'), true, 'a failed row by the Delivery Manager');
  assert.equal(ok(w.ownerDefect), true, 'the owner\'s words naming the defect');
  for (const [v, why] of [
    ['ex-open', 'an open story is not shipped'], ['ex-fix', 'itself'], ['ex-sec-finding', 'not a story'],
    ['ev-ex-signin-2', 'a failed row written by a builder'], [w.budgetRecord, 'the owner\'s budget decision is not a defect report'],
    [w.peer, 'a peer agent\'s message is not the owner'], ['dec-chief-of-staff-999', 'a made-up record'],
  ]) assert.equal(ok(v), false, why);
});

test('B-1: a security fix counts only with a finding: a review finding by id, or a finding bead; never any bead, itself, or another file', () => {
  const w = world();
  const ok = (v) => w.link('ex-sec', 'finding', v).ok;
  assert.equal(ok('.delivery/reviews/architecture-01.md#R-architecture-3'), true);
  assert.equal(ok('ex-sec-finding'), true);
  for (const [v, why] of [
    ['ex-sec', 'itself'], ['ex-open', 'an ordinary story'], ['.delivery/team/team.json', 'a config file'], ['.delivery/goal.json', 'the goal sheet'],
    ['.delivery/reviews/architecture-01.md', 'a review file without a finding id'], ['.delivery/reviews/architecture-01.md#R-architecture-9', 'an id the file does not hold'],
    ['.delivery/reviews/../goal.json#R-x', 'a path out of the reviews'], [w.peer, 'a peer message'],
  ]) assert.equal(ok(v), false, why);
});

test('B-1: the bug, security and finding labels and the fixes and finding links are the Delivery Manager\'s and the Product Manager\'s', () => {
  const me = 'me@pc/builder-1';
  const bd = { show: () => ({ id: 'mine', status: 'in_progress', assignee: me, labels: ['story'], metadata: { story_file: 'a.md' } }) };
  const run = (command, roleId) => decideBd({ command, actor: me, roleId, staleHours: 2, bd });
  for (const c of ['bd update mine --add-label security', 'bd update mine --add-label bug', 'bd label add mine finding', `bd update mine --metadata '{"finding":"mine"}'`, `bd update mine --metadata '{"fixes":"ex-signin"}'`, 'bd create --parent mine --title x --labels bug']) {
    assert.match(run(c, 'builder').reason, /Refused: the (label|gate field) (bug|security|finding|fixes)|structure belongs to the Delivery Manager/, c);
    assert.match(run(c, 'chief-of-staff').reason || '', /Refused|may not run/, `${c} (chief of staff)`);
    assert.equal(run(c, 'product-manager') === null || !/Refused: the/.test(run(c, 'product-manager').reason), true, `${c} (product manager)`);
  }
});

test('B-1: a peer agent\'s message is never the owner\'s record: evidence.js cut and the record check refuse it', () => {
  const w = world();
  const dm = { root: w.t.root, roleId: 'delivery-lead', instance: 'delivery-lead', actor: 'dm@pc/delivery-lead', team: { roles: [] } };
  const cut = (record) => evidence.main(['cut', 'ex-open', '--record', record, '--reason', 'dropped'], { who: dm, bd: w.bd });
  assert.equal(cut(w.peer).code, 1);
  assert.match(cut(w.peer).out, /not the owner/);
  assert.equal(G.stateOf(w.bd.show('ex-open')), null);
  assert.equal(C.recordChecker(w.t.root)(w.peer), false);
  assert.equal(cut(w.ownerDefect).code, 0);
  assert.equal(G.stateOf(w.bd.show('ex-open')), 'cut');
});
