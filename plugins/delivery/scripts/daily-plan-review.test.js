// scripts/daily-plan-review.test.js — the PR 58 review findings on the Chief of Staff's day, each replayed
// first as a failing case: through the real lane and route-check hooks where a session meets it, on
// main() and the library where a rule decides it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const DP = require('./lib/daily-plan.js');
const G = require('./lib/gates.js');
const Goal = require('./lib/goal.js');
const Wn = require('./lib/warnings.js');
const MC = require('../hooks/scripts/message-checks.js');
const T = require('./lib/transcript.js');
const { tupleOf } = require('./lib/surface.js');
const { STORY, SURFACES, makeProject, storyBead, memBd } = require('./testing/gate-fixture.js');
const { harness } = require('./testing/role-harness.js');
const plan = require('./plan.js');
const goal = require('./goal.js');

const COS = 'chief-of-staff';
const SHA = 'd478aa11';
const meta = (story, area = 'collection', extra = {}) => ({ roadmap_ref: 'vault/roadmap.md@abc1234 phase 1', surface: 'S1', area, story, story_file: `${story}.md`, ...extra });
const storyOf = (id, title, area = 'collection', extra = {}) => ({ id: `ex-${id}`, title, status: 'open', parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story', 'wave-1'], ...extra, metadata: meta(id, area, extra.metadata) });
const teamOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'team.json'), 'utf8'));
const who = (root, roleId = COS) => ({ root, team: teamOf(root), roleId, instance: roleId });
const deps = (root, beads, extra = {}) => ({ who: who(root), bd: memBd(beads), budget: { set: false }, ci: { red: false }, ...extra });

// the summary story (two criteria, both by reality check), deployed, with the Reality Checker's pass rows
// written the way reality-check.js run-record writes them; returns the bead (its recorded head included)
function verified(root, results = ['pass', 'pass']) {
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4').replace('Import a collection by dropping a CSV in the chat', 'Show the collection summary'));
  const bead = storyOf('vault-0n9-4', 'Show the collection summary', 'collection', { status: 'closed', metadata: { deployed_sha: SHA } });
  bead.labels.push(G.STATE.merged, G.STATE.deployed, G.STATE.verified);
  const story = G.parseStory(fs.readFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), 'utf8'));
  const crit = [...story.criteria.map((c) => c.n), ...results.slice(story.criteria.length).map(() => 1)];
  results.forEach((result, i) => {
    const c = story.criteria.find((x) => x.n === crit[i]);
    bead.metadata.evidence_head = G.appendEvidence(root, bead.id, { type: 'row', criterion: c.n, criterion_hash: G.criterionHash(c), result, surface: 'S1', tuple: tupleOf(SURFACES.surfaces[0]), sha: SHA, by: 'reality-checker', via: 'reality-check', actor: 'dev@pc/reality-checker', at: new Date().toISOString() }).head;
  });
  return bead;
}
const briefOf = async (root, beads, extra) => (await plan.main(['brief'], deps(root, beads, extra))).out;
const sheetOf = async (root, beads) => (await goal.main(['sheet'], deps(root, beads))).out;

test('B1 (Copilot 500, I1): checked on the customer\'s app only by the done gate\'s rule, in the brief and on the goal sheet', async () => {
  const good = makeProject();
  const b = verified(good);
  assert.match(await briefOf(good, [b]), /1 checked on the customer's app \(Show the collection summary\)/);
  assert.match(await sheetOf(good, [b]), /1 story is checked so far/);
  // the newest row cut off the file by hand: the file no longer ends at the recorded head
  const cut = makeProject();
  const c = verified(cut);
  const f = G.evidenceFile(cut, c.id);
  fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(0, 1).join('\n')}\n`);
  assert.match(await briefOf(cut, [c]), / 0 checked on the customer's app\./);
  assert.match(await sheetOf(cut, [c]), /0 stories are checked so far/);
  // rows evidence.js did not write: no recorded head
  const foreign = makeProject();
  const d = verified(foreign);
  delete d.metadata.evidence_head;
  assert.match(await briefOf(foreign, [d]), / 0 checked/);
  // a pass, then a newer fail on the same criterion: the latest run decides
  const failed = makeProject();
  const e = verified(failed, ['pass', 'pass', 'fail']);
  assert.match(await briefOf(failed, [e]), / 0 checked/);
  assert.match(await sheetOf(failed, [e]), /0 stories are checked so far/);
});

test('B2 (Copilot 424): an unreadable bd refuses the plan, the brief and the sheet, and records no snapshot', async () => {
  const root = makeProject();
  const down = { list: () => { throw new Error('dolt: connection refused'); }, show: () => { throw new Error('dolt: connection refused'); }, ready: () => { throw new Error('dolt: connection refused'); } };
  const d = { who: who(root), bd: down, budget: { set: false }, ci: { red: false } };
  for (const [main, args] of [[plan.main, ['today']], [plan.main, ['brief']], [goal.main, ['sheet']]]) {
    const r = await main(args, d);
    assert.equal(r.code, 1, `${args}: ${r.out}`);
    assert.match(r.out, /bd could not be read \(dolt: connection refused\)\.\nCheck: `bd where`$/, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(root, DP.REL)), false, 'no plan row from a failed read');
});

test('M1: the brief says since <date> when the last plan is older than a day', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-4', 'Show the collection summary')];
  const d = deps(root, beads);
  await plan.main(['today'], { ...d, now: '2026-10-16T08:00:00Z' });
  d.bd.beads.get('ex-vault-0n9-4').labels.push(G.STATE.merged);
  assert.match((await plan.main(['brief'], { ...d, now: '2026-10-19T08:00:00Z' })).out, /^Since 2026-10-16: 1 change merged, 0 live, 0 checked on the customer's app\.$/m);
  await plan.main(['today'], { ...d, now: '2026-10-18T08:00:00Z' });
  assert.match((await plan.main(['brief'], { ...d, now: '2026-10-19T08:00:00Z' })).out, /^Since yesterday: nothing new merged/m);
});

// a team with one ready story, for the routing and lane cases through the hooks
function team() {
  const root = makeProject();
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'vault-0n9-4.md'), STORY.replace('id: vault-0n9-3', 'id: vault-0n9-4'));
  const h = harness({ root, beads: { 'ex-vault-0n9-4': storyOf('vault-0n9-4', 'Show the collection summary') } });
  assert.equal(h.bash(COS, `${h.script('plan.js')} today`).code, 0);
  return h;
}

test('I2: only a [reference] carries a plan item; a plain mention for context is no send and no misroute', () => {
  const h = team();
  assert.equal(h.send(COS, 'SendMessage', { to: 'product-manager', message: 'FYI: the summary story ex-vault-0n9-4 is in review; no action for you.' }).ctx, '');
  assert.equal(Wn.list(h.root).filter((w) => w.kind === 'misroute').length, 0);
  assert.equal(DP.rowsOf(h.root, DP.today()).filter((r) => r.type === 'sent').length, 0);
  assert.match(h.send(COS, 'SendMessage', { to: 'product-manager', message: 'Assign [ex-vault-0n9-4]' }).ctx, /^Misrouted/);
  // the short role names the register uses are recipients too
  assert.equal(h.send(COS, 'SendMessage', { to: 'DM', message: 'Assign [ex-vault-0n9-4]' }).ctx, '');
  assert.match(h.bash(COS, `${h.script('plan.js')} routed`).out, /^All 1 items sent to their roles\./);
});

test('I3: the temporary-directory exemption never covers the project or a role directory', () => {
  const h = team();
  const proj = (inst, ...p) => path.join(h.roleDir(inst), 'project', ...p);
  assert.match(h.tool(COS, 'Write', { file_path: proj(COS, '.delivery', 'stories', 'x.md'), content: 'x' }).deny, /^Role chief-of-staff does not edit /);
  assert.match(h.tool(COS, 'Edit', { file_path: path.join(h.root, 'AGENTS.md'), old_string: 'a', new_string: 'b' }).deny, /^Role chief-of-staff does not edit /);
  assert.match(h.tool('builder-1', 'Write', { file_path: path.join(h.root, '.delivery', 'team', 'team.json'), content: '{}' }).deny, /^Role builder does not edit /);
  assert.match(h.tool(COS, 'Write', { file_path: path.join(h.roleDir('builder-1'), 'product', 'src', 'x.js'), content: 'x' }).deny, /^Role chief-of-staff does not edit /);
  // the lane's own patterns still decide inside the project: the Delivery Manager writes stories
  assert.equal(h.tool('delivery-lead', 'Write', { file_path: proj('delivery-lead', '.delivery', 'stories', 'y.md'), content: 'y' }).deny, null);
  assert.equal(h.tool('delivery-lead', 'Write', { file_path: path.join(require('os').tmpdir(), 'scratch-note.txt'), content: 'y' }).deny, null);
});

test('I4: reading plan.js brief backs only the claims that appear in its output this turn', () => {
  const brief = "So far: 1 change merged, 1 live, 1 checked on the customer's app (Show the collection summary).\nAsk for details on any item";
  const cmd = 'node /x/scripts/plan.js brief';
  const ok = MC.messageFindings({ message: brief, role: COS, commands: [cmd], outputs: [{ command: cmd, text: brief }], prefix: 'ex' });
  assert.deepEqual(ok.warnings, []);
  const own = MC.messageFindings({ message: 'The CSV import is live and checked on the customer\'s app.', role: COS, commands: [cmd], outputs: [{ command: cmd, text: brief }], prefix: 'ex' });
  assert.equal(own.warnings[0].kind, 'claim-unchecked');
  // the turn keeps each shell command's output for this check
  const f = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'turn-')), 't.jsonl');
  const line = (r) => fs.appendFileSync(f, `${JSON.stringify(r)}\n`);
  line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'morning' } });
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: cmd } }] } });
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: brief }] }] } });
  assert.deepEqual(T.currentTurn(f).outputs, [{ command: cmd, text: brief }]);
});

test('I5: an any-lane role cannot write the plan record by shell either', () => {
  const h = team();
  for (const cmd of [`echo x > ${path.join(h.root, '.delivery', 'plans', 'x.ndjson')}`, `rm -rf ${path.join(h.root, '.delivery', 'plans')}`, 'cp /dev/null project/.delivery/plans/2026-10-19.ndjson']) {
    assert.match(h.bash('builder-1', cmd, { run: false }).deny || '', /written only by `plan\.js today`/, cmd);
  }
});

// a failed counting row on a story in the import area, and the trigger pause it raises
function stopImport(root, beads, { inBd = true } = {}) {
  const id = 'ex-vault-imp-1';
  const bead = storyBead({ id, title: 'Import by file drop', status: 'closed', assignee: '', metadata: { area: 'import', story: 'imp-1', deployed_sha: SHA } });
  bead.metadata.evidence_head = G.appendEvidence(root, id, { type: 'row', criterion: 1, result: 'fail', by: 'reality-checker', surface: 'S1', sha: SHA, actor: 'x', at: '2026-10-17T21:04:00Z' }).head;
  if (inBd) beads.push(bead);
  assert.equal(Goal.pauseOnTrigger({ root, who: { roleId: 'delivery-lead', instance: 'delivery-lead' }, trigger: `andon:ev-${id}-1`, bead }).ok, true);
  return `ev-${id}-1`;
}
const storiesOf = async (root, beads, extra) => {
  const r = await plan.main(['today', '--json'], deps(root, beads, extra));
  assert.equal(r.code, 0, r.out);
  return JSON.parse(r.out).items.filter((x) => x.section === 4).map((x) => x.ref);
};

test('I6 (Copilot 459): next stories follow the claim check: none in a stopped area but its linked fix, and fixes only on a red main', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-imp-2', 'Import progress', 'import'), storyOf('vault-0n9-4', 'Show the collection summary')];
  const row = stopImport(root, beads);
  beads.push({ id: 'ex-fix-drop', title: 'Files dropped in plain chat do not arrive', status: 'open', labels: ['bug'], metadata: { fixes: row, area: 'import' } });
  assert.deepEqual((await storiesOf(root, beads)).sort(), ['ex-fix-drop', 'ex-vault-0n9-4']);
  const red = { red: true, since: '2026-10-19T07:00:00Z', branch: 'main', repo: 'example/example', workflows: ['ci'] };
  assert.deepEqual(await storiesOf(root, beads, { ci: red }), ['ex-fix-drop']);
});

test('Copilot 481: two initiatives with the same assumption id are two items; each reference carries only its own', async () => {
  const root = makeProject();
  const reg = (s) => `# Assumptions\n\n## Register\n\n${require('./lib/assumptions.js').HEADER}\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n| A-1 | ${s} | external-host | vault-0n9-3#1 | assumed |  | PM |\n`;
  for (const slug of ['vault', 'shop']) fs.mkdirSync(path.join(root, '.delivery', 'initiatives', slug), { recursive: true });
  fs.writeFileSync(require('./lib/assumptions.js').fileOf(root, 'vault'), reg('The ChatGPT app passes a file link'));
  fs.writeFileSync(require('./lib/assumptions.js').fileOf(root, 'shop'), reg('The store accepts the manifest'));
  const d = deps(root, []);
  const row = JSON.parse((await plan.main(['today', '--json'], d)).out);
  const keys = row.items.filter((x) => x.section === 3).map((x) => x.key).sort();
  assert.deepEqual(keys, ['unknown:shop/A-1', 'unknown:vault/A-1']);
  DP.noteSent(root, { team: d.who.team, to: 'delivery-lead', message: 'Probe [ex-shop-spike-a-1]' });
  assert.deepEqual(DP.unrouted(root).open.map((x) => x.key), ['unknown:vault/A-1']);
  assert.equal(DP.carries('[A-1]', row.items[0]), false, 'a bare id is ambiguous');
});

test('Copilot 509 and 522: the brief names an open technical spike; the sheet names the document its outcome came from', async () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'vault', 'prd.md'), '# PRD: Vault\n\n## Summary\n\nPlayers ask about their collection in the chat.\n');
  const beads = [{ id: 'ex-vault-spike-cache', title: 'Can the card cache hold 50,000 cards', status: 'open', labels: ['spike'], metadata: {} }];
  assert.match(await briefOf(root, beads), /^Can the card cache hold 50,000 cards: being checked\.$/m);
  const json = JSON.parse((await goal.main(['sheet', '--json'], deps(root, beads))).out);
  assert.deepEqual(json.find((x) => x.section === 'Outcome').sources, ['vault/prd.md']);
});

test('minors: a one-line brief, the CoS plans only its own project, every open pull request bucket reaches the Delivery Manager, plain refuted wording', async () => {
  const root = makeProject();
  const one = (await plan.main(['brief', '--limit', '1'], deps(root, []))).out.split('\n');
  assert.deepEqual(one, ["So far: nothing new merged, live or checked on the customer's app. Ask for details on any item"]);
  const other = await plan.main(['today', '--project', makeProject()], deps(root, []));
  assert.equal(other.code, 1);
  assert.match(other.out, /^plan\.js: the plan is for your own project\.\nRun it there: `plan\.js today`$/);
  const f = { team: teamOf(root), queue: [], questions: [], andon: { stops: [], ci: {} }, unknowns: [], spikes: [], next: [], checks: [], known: new Map(), titles: new Map(),
    prs: { 'changes requested': [5], 'build failing': [6], 'review record damaged': [7] } };
  const prs = DP.items(f).filter((x) => x.kind === 'pr');
  assert.deepEqual(prs.map((x) => [x.ref, x.role]), [['#5', 'delivery-lead'], ['#6', 'delivery-lead'], ['#7', 'delivery-lead']]);
  assert.match(prs[2].action, /damaged/);
  const A = require('./lib/assumptions.js');
  assert.equal(A.plainLine('Import a collection', { status: 'refuted', statement: 'The ChatGPT app passes a file link.' }), 'Import a collection: on hold until the design changes: we checked, and it is not true that the ChatGPT app passes a file link');
});

test('M5: a stop whose bead cannot be read stays on the plan and leads the brief (fail closed)', async () => {
  const root = makeProject();
  const beads = [storyOf('vault-0n9-4', 'Show the collection summary')];
  stopImport(root, beads, { inBd: false });
  const r = JSON.parse((await plan.main(['today', '--json'], deps(root, beads))).out);
  const stop = r.items.find((x) => x.section === 2);
  assert.equal(stop.role, 'delivery-lead');
  assert.match(stop.action, /could not be read: check it \(bd show ex-vault-imp-1\)/);
  assert.equal((await briefOf(root, beads)).split('\n')[0], 'A stop could not be read; the Delivery Manager checks it.');
});
