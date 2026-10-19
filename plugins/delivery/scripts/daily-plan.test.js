// scripts/daily-plan.test.js — the Chief of Staff drives the team (R-01, R-02, R-06, R-45): the goal
// sheet, the day's plan, the owner's briefing and the routing check, replayed on Vault moments through
// the real lane, bd-guard and route-check hooks (testing/role-harness.js) and through main().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('./lib/assumptions.js');
const DP = require('./lib/daily-plan.js');
const G = require('./lib/gates.js');
const Goal = require('./lib/goal.js');
const Wn = require('./lib/warnings.js');
const MC = require('../hooks/scripts/message-checks.js');
const { planGraph } = require('./lib/plan-graph.js');
const { parseSpikes } = require('./lib/plan-docs.js');
const { STORY, makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { harness, evIdOf } = require('./testing/role-harness.js');
const plan = require('./plan.js');

const FILE_HANDOFF = 'The ChatGPT app passes an attached file to the tool as an https download link';
const REGISTER = `# Assumptions: vault\n\n## Register\n\n${A.HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n| A-8 | ${FILE_HANDOFF} | external-host | vault-0n9-3#1 vault-0n9-3#2 | assumed |  | PM |\n`;
const ARCH = '## Spikes\n\n| # | Question to answer | Decision it informs | Decision rule | Decision owner | Time box | Blocks | Assumption |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n| 1 | What does the tool receive? | how the intake reads the file | https: build; local path: change the design; none: stop | PM | 1 hour | | A-8 |\n';
const meta = (story, area = 'collection') => ({ roadmap_ref: 'vault/roadmap.md@abc1234 phase 1', surface: 'S1', area, story, story_file: `${story}.md` });
const storyOf = (id, title, area, extra = {}) => ({ id: `ex-${id}`, title, parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story', 'wave-1'], metadata: meta(id, area), ...extra });
const COS = 'chief-of-staff';

// 10-12: the intake (0n9-3) rests on the file hand-off (A-8); the summary story (0n9-4) does not
function vault() {
  const root = makeProject();
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4').replace('Import a collection by dropping a CSV in the chat', 'Show the collection summary'));
  fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'vault', 'brief.md'), '# Product brief: Vault\n\n## What changes if we solve it\n\nA player brings their whole collection into the chat and asks about it. More text.\n');
  fs.writeFileSync(A.fileOf(root, 'vault'), REGISTER);
  const g = planGraph({ prefix: 'ex', initiative: 'vault', sha: 'abc1234', roadmap: { phases: [{ number: '1', name: 'Collections', items: [] }] }, stories: [], spikes: parseSpikes(ARCH), assumptions: A.loadRegister(root, 'vault').rows });
  const beads = { 'ex-vault-0n9-3': storyOf('vault-0n9-3', 'Import a collection by dropping a CSV in the chat'), 'ex-vault-0n9-4': storyOf('vault-0n9-4', 'Show the collection summary') };
  for (const b of g.beads.filter((x) => x.labels.includes('spike'))) beads[b.id] = { id: b.id, title: 'What does the tool receive?', labels: b.labels, metadata: b.metadata };
  const h = harness({ root, beads, deps: [{ id: 'ex-vault-0n9-3', blockedBy: 'ex-vault-spike-a-8' }] });
  h.plan = (inst, args) => h.bash(inst, `${h.script('plan.js')} ${args}`);
  h.probe = (observed) => {
    const f = path.join(root, '.delivery', 'evidence', 'artifacts', 'ex-vault-spike-a-8', 'r1.txt');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, observed);
    return evIdOf(h.bash('reality-checker', `${h.script('assumptions.js')} probe ex-vault-spike-a-8 --host 'chatgpt.com plain chat' --observed '${observed}' --artifact ${f}`).out);
  };
  return h;
}

test('R1 (10-12 14:09): the local-path probe result puts the file hand-off in the plan before any intake story, in the brief and on the goal sheet', () => {
  const h = vault();
  const ev = h.probe('the tool got a local Windows path, not an https link');
  assert.equal(h.bash('product-manager', `${h.script('assumptions.js')} refute A-8 --evidence ${ev}`).code, 0);
  const today = h.plan(COS, 'today');
  assert.equal(today.code, 0, today.deny || today.out);
  const lines = today.out.split('\n');
  const unknown = lines.findIndex((l) => /Product Manager \(product-manager\): A-8 was refuted: change the design/.test(l));
  assert.ok(unknown > 0, today.out);
  assert.ok(lines.findIndex((l) => /^3\. Blocking unknowns/.test(l)) < unknown);
  assert.ok(!lines.some((l) => /ex-vault-0n9-3\]/.test(l)), 'the intake story is not offered while its unknown is open');
  assert.ok(lines.findIndex((l) => /\[ex-vault-0n9-4\]/.test(l)) > unknown, 'stories come after the unknown');
  // the record: a dated plan row the brief and status read back
  const row = DP.latest(h.root, DP.today());
  assert.deepEqual(row.items.find((x) => x.ref === 'A-8').match, ['A-8', 'ex-vault-spike-a-8']);
  const brief = h.plan(COS, 'brief');
  assert.match(brief.out, /Import a collection by dropping a CSV in the chat: on hold until the design changes, because it turned out that it is not so that the ChatGPT app passes an attached file/);
  assert.deepEqual(MC.idTokens(brief.out, { prefix: 'ex' }), []);
  const sheet = h.bash(COS, `${h.script('goal.js')} sheet`);
  assert.equal(sheet.code, 0, sheet.deny || sheet.out);
  for (const re of [/^Outcome: A player brings their whole collection into the chat and asks about it\.$/m, /^Customer surface: ChatGPT web in plain chat, on chatgpt\.com$/m,
    /^Done means: each of 4 criteria across 2 stories passes on the customer's app; 0 stories are checked so far$/m, /^Budget: not set by the owner, so budget checks only warn$/m,
    /^Blocking unknowns: Import a collection .*: on hold until the design changes/m, /^Waiting on the owner: nothing$/m]) assert.match(sheet.out, re);
  assert.deepEqual(MC.idTokens(sheet.out, { prefix: 'ex' }), []);
  // every line traces to its records internally
  const json = JSON.parse(h.bash(COS, `${h.script('goal.js')} sheet --json`).out);
  assert.deepEqual(json.find((x) => x.section === 'Blocking unknowns').sources, ['A-8', 'ex-vault-spike-a-8']);
  assert.deepEqual(json.find((x) => x.section === 'Customer surface').sources, ['dec-chief-of-staff-12', 'surface S1']);
  assert.deepEqual(json.find((x) => x.section === 'Done means').sources, ['ex-vault-0n9-3', 'ex-vault-0n9-4']);
});

test('R-05 (10-12 09:39, 10-13 11:35): the Chief of Staff still cannot build, commit, push, merge, run infra or drive the owner\'s apps; its plan commands pass the lane', () => {
  const h = vault();
  // the lane lets anyone write under the temporary directory, where test projects live: point the hook's
  // temporary directory elsewhere so the project is an ordinary one
  const tmp = process.env.TMPDIR;
  process.env.TMPDIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'elsewhere-'));
  try {
    assert.match(h.tool(COS, 'Edit', { file_path: path.join(h.roleDir(COS), 'project', 'AGENTS.md'), old_string: 'a', new_string: 'b' }).deny, /does not edit/);
    assert.match(h.tool(COS, 'Write', { file_path: path.join(h.roleDir(COS), 'product', 'src', 'x.js'), content: 'x' }).deny, /does not edit/);
  } finally { if (tmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = tmp; }
  for (const cmd of ['git push origin HEAD:team/gw2', 'git commit -m section-10', 'gh pr merge 465', 'npm test', 'tailscale funnel 443', `echo x > ${path.join(h.root, '.delivery', 'plans', 'x.ndjson')}`]) {
    assert.match(h.bash(COS, cmd, { run: false }).deny || '', /^lane: /, cmd);
  }
  assert.ok(h.tool(COS, 'mcp__Claude_Browser__computer', { action: 'screenshot' }).deny);
  for (const args of ['today', 'brief', 'routed']) assert.equal(h.plan(COS, args).deny, null, args);
  assert.equal(h.bash(COS, `${h.script('goal.js')} sheet`, { run: false }).deny, null);
  // the plan is the Chief of Staff's: other lanes refuse it, and no role writes the record by hand
  assert.match(h.plan('delivery-lead', 'today').deny, /^lane: /);
  assert.match(h.plan('product-manager', 'brief').deny, /^lane: /);
  assert.match(h.tool('delivery-lead', 'Write', { file_path: path.join(h.roleDir('delivery-lead'), 'project', '.delivery', 'plans', '2026-10-19.ndjson'), content: '{}' }).deny, /plan\.js today/);
});

test('R-06 (10-12 19:48): an acceptance item sent to the Product Manager warns; plan.js routed lists it until it reaches the Delivery Manager', () => {
  const h = vault();
  require('./lib/reviews.js').append(h.root, '478', { type: 'request', head: 'a'.repeat(40), beads: ['ex-vault-0n9-4'], reviewer: 'reviewer-1', title: 'Show the collection summary', at: new Date().toISOString() }, 'delivery-lead');
  h.plan(COS, 'today');
  const pr = DP.latest(h.root, DP.today()).items.find((x) => x.kind === 'pr');
  assert.equal(pr.role, 'delivery-lead', JSON.stringify(pr));
  const sent = (to, message) => h.send(COS, 'SendMessage', { to, message });
  const wrong = sent('product-manager', 'Please get the summary change reviewed [#478].');
  assert.equal(wrong.deny, null);
  assert.match(wrong.ctx, /^Misrouted \(recorded as a warning\): pr:#478 is acceptance work, routed to the Delivery Manager; it was sent to the Product Manager\.\nSend it to delivery-lead/);
  assert.equal(Wn.list(h.root).filter((w) => w.kind === 'misroute' && w.rule === 'R-06').length, 1);
  let routed = h.plan(COS, 'routed').out;
  assert.match(routed, /^\d+ of \d+ items not sent yet:/);
  assert.match(routed, /Delivery Manager \(delivery-lead\): dispatch an independent review of PR #478.*\[#478\]/);
  assert.match(routed, /Misrouted: pr:#478 went to product-manager/);
  // implementation sent to the Product Manager warns too; sent right, the item leaves the list
  assert.match(sent('product-manager', 'Start [ex-vault-0n9-4]').ctx, /ex-vault-0n9-4 is implementation work, routed to the Delivery Manager/);
  assert.equal(sent('delivery-lead', 'Review dispatch for [#478]; assign [ex-vault-0n9-4]; probe [A-8].').ctx, '');
  routed = h.plan(COS, 'routed').out;
  assert.doesNotMatch(routed, /not sent yet[\s\S]*(#478|0n9-4)/);
  // a message from another role is not the Chief of Staff's routing
  assert.equal(h.send('delivery-lead', 'SendMessage', { to: 'product-manager', message: '[#478]' }).ctx, '');
});

test('R-45 (10-17 23:07): a long briefing or one with ids still warns; plan.js brief stays within the limit, plain and backed', () => {
  const h = vault();
  const long = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}: vault-0n9.3 waits on dec-chief-of-staff-12.`).join('\n');
  const w = MC.messageFindings({ message: long, role: COS, commands: [], prefix: 'ex' }).warnings.map((x) => x.kind);
  assert.ok(w.includes('briefing-length') && w.includes('jargon'), w.join());
  // a verified story with its pass row: the brief says checked, and reading the brief backs the word
  h.setBead('ex-vault-0n9-4', (b) => { b.labels.push(G.STATE.merged, G.STATE.deployed, G.STATE.verified); b.metadata.evidence_head = G.appendEvidence(h.root, 'ex-vault-0n9-4', { type: 'row', criterion: 1, result: 'pass', by: 'reality-checker', surface: 'S1', sha: 'd478aa11', actor: 'x', at: new Date().toISOString() }).head; });
  for (let i = 0; i < 6; i++) require('./lib/owner-queue.js').add(h.root, { kind: 'signin', what: `Sign in to provider ${i}`, where: 'the browser', steps: 'open the page and sign in' }, { instance: COS });
  const b = h.plan(COS, 'brief');
  const lines = b.out.split('\n');
  assert.ok(lines.length <= 12, b.out);
  assert.equal(lines[lines.length - 1], 'Ask for details on any item');
  assert.match(b.out, /^So far: 1 change merged, 1 live, 1 checked on the customer's app \(Show the collection summary\)\.$/m);
  assert.match(b.out, /^Waiting on you: 6 steps only you can take, in one list\.$/m);
  const cmd = `node ${h.script('plan.js').split(' ')[1]} brief`;
  assert.deepEqual(MC.messageFindings({ message: b.out, role: COS, commands: [cmd], prefix: 'ex' }).warnings, []);
  assert.equal(MC.messageFindings({ message: b.out, role: COS, commands: [], prefix: 'ex' }).warnings[0].kind, 'claim-unchecked');
  // the owner's lower limit holds
  const few = DP.brief(DP.facts(h.root, { bd: memBd(Object.values(h.db().issues)), team: JSON.parse(fs.readFileSync(path.join(h.root, '.delivery', 'team', 'team.json'), 'utf8')), budget: { set: false } }), { limit: 3 });
  assert.equal(few.length, 3);
  assert.equal(few[2], 'Ask for details on any item');
});

// a failed counting row on a story in the import area, and the trigger pause it raises
function stopImport(root, beads) {
  const id = 'ex-vault-imp-1';
  const bead = storyBead({ id, title: 'Import by file drop', status: 'closed', assignee: '', metadata: { area: 'import', story: 'imp-1', deployed_sha: 'd478aa11' } });
  bead.labels.push(G.STATE.merged, G.STATE.deployed);
  bead.metadata.evidence_head = G.appendEvidence(root, id, { type: 'row', criterion: 1, result: 'fail', by: 'reality-checker', surface: 'S1', sha: 'd478aa11', actor: 'x', at: '2026-10-17T21:04:00Z' }).head;
  beads.push(bead);
  assert.equal(Goal.pauseOnTrigger({ root, who: { roleId: 'delivery-lead', instance: 'delivery-lead' }, trigger: `andon:ev-${id}-1`, bead }).ok, true);
  return id;
}
const who = (root) => ({ root, team: JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'team.json'), 'utf8')), roleId: COS, instance: COS });

test('R-22 (10-17 21:04): a day with the import stopped: the brief leads with it, and the plan routes the stop to the Delivery Manager', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-4', 'Show the collection summary')];
  stopImport(root, beads);
  const bd = memBd(beads);
  const deps = { who: who(root), bd, budget: { set: false }, ci: { red: false } };
  const t = await plan.main(['today'], deps);
  assert.equal(t.code, 0, t.out);
  assert.match(t.out, /^2\. Stops:\n {3}- Delivery Manager \(delivery-lead\): the import area is stopped on ev-ex-vault-imp-1-1: open the A3/m);
  const b = await plan.main(['brief'], deps);
  assert.match(b.out.split('\n')[0], /^The import area is stopped until we fix why "Import by file drop" failed on the customer's app; the cause is being looked into\.$/);
  // the goal sheet lists the stopped area as a blocking unknown
  const s = await require('./goal.js').main(['sheet'], deps);
  assert.match(s.out, /^Blocking unknowns: The import area is stopped until/m);
});

test('R-02: the brief says what changed since yesterday\'s plan; the plan is append-only and the Chief of Staff\'s alone', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-4', 'Show the collection summary', 'collection', { status: 'in_progress', assignee: 'dev@pc/builder-1' })];
  const deps = { who: who(root), bd: memBd(beads), budget: { set: false }, ci: { red: false } };
  assert.equal((await plan.main(['today'], { ...deps, now: '2026-10-18T08:00:00Z' })).code, 0);
  deps.bd.beads.get('ex-vault-0n9-4').labels.push(G.STATE.merged);
  const b = await plan.main(['brief'], { ...deps, now: '2026-10-19T08:00:00Z' });
  assert.match(b.out, /^Since yesterday: 1 change merged, 0 live, 0 checked on the customer's app\.$/m);
  await plan.main(['today'], { ...deps, now: '2026-10-19T08:00:00Z' });
  await plan.main(['today'], { ...deps, now: '2026-10-19T09:00:00Z' });
  assert.deepEqual(DP.rowsOf(root, '2026-10-19').map((r) => [r.seq, r.type]), [[1, 'plan'], [2, 'plan']]);
  assert.deepEqual(DP.latest(root, '2026-10-18').states, { 'ex-vault-0n9-4': 'open' });
  const dm = await plan.main(['today'], { ...deps, who: { ...deps.who, roleId: 'delivery-lead', instance: 'delivery-lead' } });
  assert.equal(dm.code, 1);
  assert.match(dm.out, /^plan\.js: the Chief of Staff writes the day's plan\.\nMessage the Chief of Staff/);
  assert.equal((await plan.main(['routed'], { ...deps, now: '2026-10-20T08:00:00Z' })).out, 'No plan for today yet: `plan.js today`');
});

test('routing table: each function has one owning role, with the fallback when it is not on the team', () => {
  const team = who(makeProject()).team;
  assert.deepEqual(DP.routeOf('merge', team), { role: 'delivery-lead', instance: 'delivery-lead' });
  assert.deepEqual(DP.routeOf('spike', team), { role: 'spike-researcher', instance: 'spike-researcher' });
  assert.deepEqual(DP.routeOf('reality_check', team), { role: 'delivery-lead', instance: 'delivery-lead' }, 'no Reality Checker on this team');
  assert.deepEqual(DP.recipient(makeProject(), team, 'builder-2 [3fa9c1]'), { instance: 'builder-2', role: 'builder' });
  assert.deepEqual(DP.recipient(makeProject(), team, 'Delivery Manager'), { instance: 'delivery-lead', role: 'delivery-lead' });
  assert.equal(DP.carries('see [#47]', { match: ['#478'] }), false);
  assert.equal(DP.carries('see ex-vault-0n9-4.', { match: ['ex-vault-0n9-4'] }), true);
});
