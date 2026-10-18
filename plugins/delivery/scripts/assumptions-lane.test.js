// scripts/assumptions-lane.test.js — the assumption gate as role sessions meet it: every command runs
// through the real lane and bd-guard hook processes with real role markers (testing/role-harness.js).
// Replays the Vault's file hand-off from refutation to recovery: R1 shows a local path, A-8 is refuted,
// the Product Manager changes the design through commands only (add, retire, relink, reopen), the
// Delivery Manager re-records ready, and the story and its area start again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('./lib/assumptions.js');
const { planGraph } = require('./lib/plan-graph.js');
const { parseSpikes } = require('./lib/plan-docs.js');
const { reasonProblems } = require('./lib/short-reason.js');
const { STORY, makeProject } = require('./testing/gate-fixture.js');
const { harness, evIdOf } = require('./testing/role-harness.js');

const FILE_HANDOFF = 'The ChatGPT app passes an attached file to the tool as an https download link';
const row = (id, s, k, c, st = 'assumed', ev = '', o = 'PM') => `| ${id} | ${s} | ${k} | ${c} | ${st} | ${ev} | ${o} |`;
const register = (...rows) => `# Assumptions: vault\n\n## Register\n\n${A.HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n${rows.join('\n')}\n`;
const ARCH = '## Spikes\n\n| # | Question to answer | Decision it informs | Decision rule | Decision owner | Time box | Blocks | Assumption |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n| 1 | What does the tool receive? | how the intake reads the file | https: build; local path: change the design; none: stop | PM | 1 hour | | A-8 |\n';

function setup() {
  const root = makeProject();
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4').replace('Import a collection by dropping a CSV in the chat', 'Show the collection summary'));
  fs.writeFileSync(A.fileOf(root, 'vault'), register(row('A-8', FILE_HANDOFF, 'external-host', 'vault-0n9-3#1 vault-0n9-3#2')));
  const plan = planGraph({ prefix: 'ex', initiative: 'vault', sha: 'abc1234', roadmap: { phases: [{ number: '1', name: 'Collections', items: [] }] },
    stories: [], spikes: parseSpikes(ARCH), assumptions: A.loadRegister(root, 'vault').rows });
  const meta = { roadmap_ref: 'vault/roadmap.md@abc1234 phase 1', surface: 'S1', area: 'collection' };
  const beads = {
    'ex-vault-0n9-3': { id: 'ex-vault-0n9-3', parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'], metadata: { ...meta, story: 'vault-0n9-3', story_file: 'vault-0n9-3.md' } },
    'ex-vault-0n9-4': { id: 'ex-vault-0n9-4', parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'], metadata: { ...meta, story: 'vault-0n9-4', story_file: 'vault-0n9-4.md' } },
  };
  for (const b of plan.beads.filter((x) => x.labels.includes('spike'))) beads[b.id] = { id: b.id, labels: b.labels, metadata: b.metadata };
  const h = harness({ root, beads, deps: [{ id: 'ex-vault-0n9-3', blockedBy: 'ex-vault-spike-a-8' }] });
  h.S = (inst, args) => h.bash(inst, `${h.script('assumptions.js')} ${args}`);
  h.claim = (inst, id) => h.bash(inst, `bd update ${id} --claim`);
  h.ready = (id) => h.bash('delivery-lead', `${h.script('ready.js')} ${id} --record`);
  h.probe = (observed) => {
    const f = path.join(root, '.delivery', 'evidence', 'artifacts', 'ex-vault-spike-a-8', `${Date.now()}-${Math.random()}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, observed);
    const r = h.S('reality-checker', `probe ex-vault-spike-a-8 --host 'chatgpt.com plain chat' --observed '${observed}' --artifact ${f}`);
    assert.equal(r.code, 0, r.deny || r.out);
    return evIdOf(r.out);
  };
  return h;
}

test('R1 replay through the lane: refuted A-8, then the design changes by command only, and the story and area recover', () => {
  const h = setup();
  const ev = h.probe('the tool got a local Windows path, not an https link');
  assert.equal(h.S('product-manager', `refute A-8 --evidence ${ev}`).code, 0);
  assert.match(h.claim('builder-1', 'ex-vault-0n9-3').deny, /bd guard: Claim of ex-vault-0n9-3 refused \(D4: criterion 1, 2 rests on A-8, refuted/);
  assert.match(h.claim('builder-1', 'ex-vault-0n9-4').deny, /area collection is paused/);
  // the new design: the player pastes the CSV, an internal choice, on the intake's first criterion
  const add = h.S('product-manager', "add --statement 'Players paste up to 5,000 lines in one message' --kind internal --criteria vault-0n9-3#1 --owner DM");
  assert.equal(add.code, 0, add.deny || add.out);
  const r0 = h.ready('ex-vault-0n9-3');
  assert.equal(r0.code, 1, JSON.stringify(r0));
  // only the Product Manager retires a refuted row; its history stays in the register
  assert.match(h.S('reality-checker', "retire A-8 --reason 'x'").deny, /^lane: /);
  const dm = h.S('delivery-lead', "retire A-8 --reason 'x'");
  assert.equal(dm.code, 1);
  assert.deepEqual(reasonProblems(dm.out.replace(/^assumptions\.js: /, '')), []);
  const ret = h.S('product-manager', "retire A-8 --reason 'paste-in replaces the file hand-off'");
  assert.equal(ret.code, 0, ret.deny || ret.out);
  assert.match(fs.readFileSync(A.fileOf(h.root, 'vault'), 'utf8'), /\| A-8 \| .* \| external-host \| retired: vault-0n9-3#1 vault-0n9-3#2 \| refuted \| ev-ex-vault-spike-a-8-1 \|/);
  assert.match(h.S('chief-of-staff', 'list').out, /A-8 external-host refuted: .*\(on nothing; retired from vault-0n9-3#1 vault-0n9-3#2/);
  assert.equal(h.claim('builder-2', 'ex-vault-0n9-4').deny, null, 'the area resumes');
  const r = h.ready('ex-vault-0n9-3');
  assert.equal(r.code, 0, r.deny || r.out);
  const c = h.claim('builder-1', 'ex-vault-0n9-3');
  assert.equal(c.deny, null);
  assert.match(c.ctx, /A-9 \(internal\), still assumed/);
});

test('R2: reopen, retire and relink pass the lane for the Product Manager; a retired row is not reopened', () => {
  const h = setup();
  const ev = h.probe('a local path');
  h.S('product-manager', `refute A-8 --evidence ${ev}`);
  const ro = h.S('product-manager', 'reopen A-8');
  assert.equal(ro.code, 0, ro.deny || ro.out);
  assert.match(h.claim('builder-1', 'ex-vault-0n9-3').deny, /not yet observed in the real host/);
  const ev2 = h.probe('a local path again');
  h.S('product-manager', `refute A-8 --evidence ${ev2}`);
  assert.equal(h.S('product-manager', "retire A-8 --reason 'paste-in'").code, 0);
  assert.match(h.S('product-manager', 'reopen A-8').out, /A-8 was retired/);
  // relink: the new design's assumption moves to the criteria it now sits on
  h.S('product-manager', "add --statement 'Players paste up to 5,000 lines' --kind internal --criteria vault-0n9-3#1 --owner DM");
  const rl = h.S('product-manager', 'relink A-9 --criteria vault-0n9-4#1');
  assert.equal(rl.code, 0, rl.deny || rl.out);
  assert.deepEqual(A.loadRegister(h.root, 'vault').rows.find((x) => x.id === 'A-9').criteria, [{ story: 'vault-0n9-4', ns: [1] }]);
  assert.match(h.S('product-manager', 'relink A-8 --criteria vault-0n9-3').out, /A-8 is refuted: it is retired, not relinked/);
  assert.match(h.S('builder-1', 'relink A-9 --criteria vault-0n9-3').out, /for the Product Manager/);
});

test('retire is re-verified: a retired cell written outside the script leaves the links live', () => {
  const h = setup();
  const ev = h.probe('a local path');
  h.S('product-manager', `refute A-8 --evidence ${ev}`);
  // an out-of-lane write (a program the lane cannot see) marks the links retired without a retire row
  fs.writeFileSync(A.fileOf(h.root, 'vault'), register(row('A-8', FILE_HANDOFF, 'external-host', 'retired: vault-0n9-3#1 vault-0n9-3#2', 'refuted', ev)));
  const c = h.claim('builder-1', 'ex-vault-0n9-3');
  assert.match(c.deny, /rests on A-8, refuted/);
});
