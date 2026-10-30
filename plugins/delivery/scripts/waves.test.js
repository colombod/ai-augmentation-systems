// scripts/waves.test.js — phase 2 acceptance: compounding waves (R-36), budget-aware start (R-34),
// compounding-first selection with fixes and security first (R-41), replayed on Vault moments through
// the real claim check (bd-guard gateChecks), plan.js and wave.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gateChecks, decideBd } = require('../hooks/scripts/bd-guard.js');
const { memBd } = require('./testing/gate-fixture.js');
const { goalProject, ownerSets } = require('./testing/goal-fixture.js');
const { reasonProblems } = require('./lib/short-reason.js');
const B = require('./lib/budget.js');
const W = require('./lib/waves.js');
const plan = require('./plan.js');
const wave = require('./wave.js');
const { teamStatus, renderStatus } = require('./team-status.js');

// builders here dispatch size-L on sonnet too, so the figures below stay on one model
const TEAM = { project: 'vault', prefix: 'ex', roles: [{ id: 'delivery-lead', model: 'sonnet' }, { id: 'builder', model: 'sonnet', large_model: 'sonnet', count: 2 }] };
const NOW = '2026-10-12T23:00:00Z';

// A Vault project: story files with their area, wave and files; beads as materialise stamps them.
function vault() {
  const t = goalProject();
  fs.mkdirSync(path.join(t.root, '.delivery', 'stories'), { recursive: true });
  t.story = (id, { area, wave: w, files = [], dependsOn = [], fixes, extra = '' } = {}) => {
    const fm = [`id: ${id}`, `title: ${id}`, 'phase: 1', `area: ${area}`, ...(w ? [`wave: ${w}`] : []), `depends_on: [${dependsOn.join(', ')}]`, ...(fixes ? [`fixes: ${fixes}`] : []), extra].filter(Boolean).join('\n');
    const table = files.length ? `\n## Files and modules\n\n| Path | What to do |\n| :-- | :-- |\n${files.map(([p, a]) => `| \`${p}\` | ${a} — |`).join('\n')}\n` : '';
    fs.writeFileSync(path.join(t.root, '.delivery', 'stories', `${id}.md`), `---\n${fm}\n---\n\n# ${id}\n${table}`);
  };
  return t;
}
function bead(id, area, { wave: w, status = 'open', state, size = 'M', labels = [], metadata = {}, assignee } = {}) {
  return { id: `ex-${id}`, title: id, status, assignee: assignee || (status === 'in_progress' ? 'dev@pc/builder-1' : ''), parent: 'ex-vault-ph1',
    labels: ['story', `size-${size}`, ...(w ? [`wave-${w}`] : []), ...(state ? [`state-${state}`] : []), ...labels],
    metadata: { story_file: `${id}.md`, story: id, area, ...(w ? { wave: w } : {}), ...metadata } };
}
// one owner-set budget of 100 weekly units, lean at 70% (set once, through the question box)
let owner = null;
function budgetAt(usedPct, beads) {
  if (!owner) { owner = goalProject(); ownerSets(owner, 'budget.weekly_units', 100); ownerSets(owner, 'budget.lean_at', 70); }
  return B.state(owner.root, { beads, usedTokens: usedPct * B.table(null).unitTokens, snapshot: null, team: TEAM });
}
const NO_BUDGET = { set: false, table: B.table(null) };
const claim = (t, bd, id, budget, over = {}) => gateChecks({ command: `bd update ${id} --claim`, roleId: 'builder', actor: 'dev@pc/builder-1', instance: 'builder-1', bd, root: t.root, team: TEAM, budget, ...over });
const kinds = (g) => g.warnings.map((w) => w.kind);
const take = (bd, id) => { const b = bd.beads.get(id); b.status = 'in_progress'; b.assignee = 'dev@pc/builder-1'; };

test('R-36/R-23 replay, 13 parallel builders across areas (AI 10-09): warnings only with no owner-set budget; near the limit, new-area starts are refused (D5)', async () => {
  const t = vault();
  const areas = ['collections', 'gemini', 'store', 'parity-codex', 'parity-perplexity', 'copilot', 'landing'];
  const list = [bead('col-1', 'collections', { wave: 1, state: 'verified', status: 'closed' })];
  t.story('col-1', { area: 'collections', wave: 1 });
  for (let i = 0; i < 13; i++) {
    const area = areas[i % areas.length];
    const id = `w${i}`;
    t.story(id, { area, wave: area === 'collections' ? 2 : 1, files: [[`src/${area}/index.ts`, 'modify']] });
    list.push(bead(id, area, { wave: area === 'collections' ? 2 : 1 }));
  }
  const free = memBd(list);
  for (let i = 0; i < 13; i++) {
    const g = await claim(t, free, `ex-w${i}`, NO_BUDGET);
    assert.equal(g.deny, null, `claim ${i}: no budget never blocks`);
    if (i >= 2) assert.ok(kinds(g).includes('wip'), `claim ${i} is over the two builders`);
    if (i >= 7) assert.ok(kinds(g).includes('file-overlap'), `claim ${i} shares files with ex-w${i - 7}`);
    take(free, `ex-w${i}`);
  }
  // the new-area warning names the reason it lacks
  const g = await claim(t, memBd(list.slice(0, 1).concat([{ ...list[1], status: 'in_progress', assignee: 'x' }, list[2]])), 'ex-w1', NO_BUDGET);
  assert.ok(g.warnings.some((w) => w.kind === 'new-area' && /no recorded reason/.test(w.detail)));
  // the same moment under an owner-set budget near the limit: every new area is refused, the
  // collections wave already under way only warns (finish in-flight work)
  const near = memBd(list.map((b, i) => (i >= 1 && i <= 3 ? { ...b, status: 'in_progress', assignee: 'x' } : b)));
  const st = budgetAt(97, [...near.beads.values()]);
  assert.equal(st.nearLimit, true);
  const refused = await claim(t, near, 'ex-w3', st);
  assert.match(refused.deny, /^Claim of ex-w3 refused \(D5: parity-codex is a new area and the budget is near the limit/);
  assert.deepEqual(reasonProblems(refused.deny), []);
  const inWave = await claim(t, near, 'ex-w7', st);
  assert.equal(inWave.deny, null);
  assert.ok(kinds(inWave).includes('budget-short'));
});

test('R-41 replay, store submissions and landing page while the upload chain was half done (AI P8, 10-10): below half the budget a new area with no recorded reason is refused (D1); the owner\'s reason lets it start', async () => {
  const t = vault();
  t.story('wxy-12', { area: 'upload', wave: 1 });
  t.story('wxy-2', { area: 'upload', wave: 1 });
  t.story('store-1', { area: 'publication', wave: 1 });
  const beads = [bead('wxy-12', 'upload', { wave: 1, status: 'in_progress' }), bead('wxy-2', 'upload', { wave: 1, state: 'merged', status: 'closed' }), bead('store-1', 'publication', { wave: 1, size: 'S' })];
  const bd = memBd(beads);
  const plenty = await claim(t, bd, 'ex-store-1', budgetAt(30, beads));
  assert.equal(plenty.deny, null, 'more than half left: a warning');
  assert.ok(kinds(plenty).includes('new-area'));
  const half = await claim(t, bd, 'ex-store-1', budgetAt(60, beads));
  assert.match(half.deny, /\(D1: publication is a new area with no recorded reason and half or less of the budget is left/);
  assert.match((await claim(t, bd, 'ex-store-1', budgetAt(60, beads), { roleId: 'delivery-lead' })).deny, /\nRun: .*plan\.js select .*goal\.js ask area_add publication/);
  assert.deepEqual(reasonProblems(half.deny), []);
  // the owner's Yes to "Open publication as a new product area?" is the recorded reason
  assert.equal(ownerSets(t, 'area_add', 'publication').ok, true);
  const agreed = await claim(t, bd, 'ex-store-1', budgetAt(60, beads));
  assert.equal(agreed.deny, null);
  assert.ok(!kinds(agreed).includes('new-area'));
  // in lean mode the start still warns, reason or not (R-31)
  assert.ok(kinds(await claim(t, bd, 'ex-store-1', budgetAt(75, beads))).includes('new-area-lean'));
  // a roadmap Areas row citing an owner record that verifies is a reason too
  fs.mkdirSync(path.join(t.root, '.delivery', 'initiatives', 'vault'), { recursive: true });
  fs.writeFileSync(path.join(t.root, '.delivery', 'initiatives', 'vault', 'roadmap.md'), '## Areas\n\n| Area | Reason | Record |\n|---|---|---|\n| landing | the owner wants a page for the beta | dec-chief-of-staff-41 |\n');
  const rec = (text) => (id) => (id === 'dec-chief-of-staff-41' ? { ok: true, text } : { ok: false });
  assert.deepEqual(W.areaReason(t.root, 'landing', { ownerRecord: rec('build a landing page for the beta'), ownerAreas: [] }), { by: 'the vault roadmap, citing dec-chief-of-staff-41' });
  assert.equal(W.areaReason(t.root, 'landing', { ownerRecord: () => ({ ok: false }), ownerAreas: [] }), null, 'a record that does not verify is no reason');
  assert.equal(W.areaReason(t.root, 'landing', { ownerRecord: rec('set the weekly budget to 100 units'), ownerAreas: [] }), null, 'a record about something else is no reason for this area');
});

test('R-41 replay, 10-12 evening at 85%: the sign-in refresh fix with its fixes link ranks first and lean mode does not hold it; an unlinked bug ranks as ordinary work with a warning', async () => {
  const t = vault();
  t.story('wxy-1', { area: 'auth', wave: 1 });
  t.story('wxy-12', { area: 'auth', fixes: 'ex-wxy-1' });
  t.story('0n9-4', { area: 'import', wave: 2, dependsOn: ['0n9-3'], files: [['src/import/csv.ts', 'modify']] });
  t.story('0n9-3', { area: 'import', wave: 2 });
  t.story('feedback-1', { area: 'feedback', wave: 1 });
  t.story('prerelease-1', { area: 'prerelease', wave: 1 });
  t.story('0n9-9', { area: 'import' });
  const beads = [
    bead('wxy-1', 'auth', { wave: 1, state: 'verified', status: 'closed' }),
    bead('wxy-12', 'auth', { size: 'S', labels: ['bug'], metadata: { fixes: 'ex-wxy-1' } }),
    bead('0n9-3', 'import', { wave: 2, state: 'verified', status: 'closed' }),
    bead('0n9-4', 'import', { wave: 2 }),
    bead('feedback-1', 'feedback', { wave: 1 }),
    bead('prerelease-1', 'prerelease', { wave: 1 }),
    bead('0n9-9', 'import', { labels: ['bug'] }),
    bead('wxy-2', 'upload', { status: 'in_progress', size: 'S' }),
  ];
  const st = budgetAt(85, beads);
  assert.deepEqual([st.lean, st.half, st.nearLimit], [true, true, false]);
  const bd = memBd(beads);
  const who = { root: t.root, roleId: 'delivery-lead', instance: 'delivery-lead', team: TEAM };
  const r = JSON.parse((await plan.main(['select', '--json'], { who, bd, budget: st })).out);
  assert.equal(r.ranked[0].id, 'ex-wxy-12');
  assert.equal(r.ranked[0].tier, 1);
  assert.match(r.ranked[0].reasons.join(), /bug with fixes ex-wxy-1/);
  assert.equal(r.ranked[1].id, 'ex-0n9-4', 'then compounding work on verified 0n9-3');
  assert.match(r.ranked[1].reasons.join(), /builds on verified 0n9-3/);
  const byId = Object.fromEntries(r.ranked.map((x) => [x.id, x]));
  assert.match(byId['ex-feedback-1'].refused, /new area with no recorded reason and half or less of the budget is left .*\(D1\)/);
  assert.equal(byId['ex-0n9-9'].tier, 2, 'an unlinked bug is ordinary work');
  assert.match(byId['ex-0n9-9'].warnings.join(), /labelled bug with no fixes link/);
  // the claim: lean mode does not hold the linked fix; the unlinked bug is warned and checked as ordinary work
  const fix = await claim(t, bd, 'ex-wxy-12', st);
  assert.equal(fix.deny, null);
  assert.ok(!kinds(fix).some((k) => ['lean-wip', 'wip', 'budget-short'].includes(k)), kinds(fix).join());
  const plain = await claim(t, bd, 'ex-0n9-9', st);
  assert.ok(kinds(plain).includes('fix-unlinked'));
  assert.ok(kinds(plain).includes('lean-wip'));
  // --record writes the score and reasons on the chosen bead, and only the Delivery Manager may
  const rec = await plan.main(['select', '--record'], { who, bd, budget: st, now: NOW });
  assert.match(rec.out, /Recorded the selection on ex-wxy-12/);
  assert.deepEqual(bd.show('ex-wxy-12').metadata.selection.tier, 1);
  const no = await plan.main(['select', '--record'], { who: { ...who, roleId: 'builder' }, bd, budget: st });
  assert.equal(no.code, 1);
  // with the judge on, its answers are advisory input on the record
  const asked = [];
  const ask = async (q) => { asked.push(q); return q === 'is_fix' ? { p: 0.2 } : { answer: 'strongly', confidence: 0.9 }; };
  const j = JSON.parse((await plan.main(['select', '--json'], { who, bd, budget: st, ask })).out);
  assert.equal(j.ranked[0].judge.builds_on_verified, 'strongly');
  assert.match(j.ranked.find((x) => x.id === 'ex-0n9-9').warnings.join(), /typed judge reads this as not a fix/);
  assert.ok(asked.includes('is_fix') && asked.includes('builds_on_verified'));
});

test('R-34/R-42 replay: with no owner-set budget nothing ever blocks on budget, even at 97% of the week', async () => {
  const t = vault();
  t.story('a', { area: 'upload', wave: 1 });
  t.story('b', { area: 'gemini', wave: 1 });
  t.story('c', { area: 'upload', wave: 2 });
  const beads = [bead('a', 'upload', { wave: 1, status: 'in_progress' }), bead('b', 'gemini', { wave: 1, size: 'L' }), bead('c', 'upload', { wave: 2, size: 'L' })];
  const bd = memBd(beads);
  // what the transcripts say is spent does not matter: the owner set no figure
  const st = B.state(t.root, { beads, usedTokens: 97 * B.table(null).unitTokens, snapshot: { usedPct: 97, periodStart: NOW } });
  assert.equal(st.set, false);
  for (const id of ['ex-b', 'ex-c']) assert.equal((await claim(t, bd, id, st)).deny, null, id);
  const sel = JSON.parse((await plan.main(['select', '--json'], { who: { root: t.root, roleId: 'delivery-lead', team: TEAM }, bd, budget: st })).out);
  assert.ok(sel.ranked.every((x) => !x.refused));
  assert.match((await plan.main(['budget'], { who: { root: t.root, team: TEAM }, bd, budget: st })).out, /not set by the owner, so budget checks only warn/);
});

test('R-36 replay, collections W3 claimed while #478 (W2) is merged but not verified: a warning; refused (D5) only when the budget left cannot finish W2 as well', async () => {
  const t = vault();
  for (const id of ['478', '479', 'w3-1']) t.story(id, { area: 'collections', wave: id === 'w3-1' ? 3 : 2 });
  const beads = [bead('478', 'collections', { wave: 2, state: 'merged', status: 'closed', size: 'L' }), bead('479', 'collections', { wave: 2, status: 'in_progress', size: 'L' }), bead('w3-1', 'collections', { wave: 3, size: 'M' })];
  const bd = memBd(beads);
  const warned = await claim(t, bd, 'ex-w3-1', budgetAt(20, beads));
  assert.equal(warned.deny, null);
  assert.ok(warned.warnings.some((w) => w.kind === 'outside-wave' && /wave 3, while wave 2 of collections is not verified \(ex-478, ex-479\)/.test(w.detail)));
  // 80 used: 20 left; W2 still needs 8 x 1.3 + 8 x 0.3 = 12.8, W3-1 needs 3.9: it fits, so it warns
  assert.equal((await claim(t, bd, 'ex-w3-1', budgetAt(80, beads))).deny, null);
  // 85 used: 15 left, 15 - 3.9 < 12.8: starting it would leave W2 half-built
  const half = await claim(t, bd, 'ex-w3-1', budgetAt(85, beads));
  assert.match(half.deny, /\(D5: wave 3 while wave 2 of collections is unfinished: 15 units available, wave 2 needs 12\.8, wave 3 needs 3\.9; it would leave wave 2 half-built/);
  assert.deepEqual(reasonProblems(half.deny), []);
  // W2 verified or cut on the owner's record: W3 is the current wave
  bd.beads.get('ex-478').labels.push('state-verified');
  bd.beads.get('ex-479').labels.push('state-cut');
  assert.ok(!kinds(await claim(t, bd, 'ex-w3-1', budgetAt(20, beads))).includes('outside-wave'));
});

test('R-34 start check: under an owner-set budget a story that does not fit is refused when it would start its wave, and only warned inside a wave under way', async () => {
  const t = vault();
  for (const id of ['u1', 'u2', 'n1']) t.story(id, { area: 'upload', wave: id === 'n1' ? 2 : 1 });
  const beads = [bead('u1', 'upload', { wave: 1, status: 'in_progress', size: 'S' }), bead('u2', 'upload', { wave: 1, size: 'L' }), bead('n1', 'upload', { wave: 2, size: 'L' })];
  const bd = memBd(beads);
  // 90 used: 10 left, 1.3 in flight, an L needs 10.4
  const st = budgetAt(90, beads);
  const inWave = await claim(t, bd, 'ex-u2', st);
  assert.equal(inWave.deny, null);
  assert.match(inWave.warnings.find((w) => w.kind === 'budget-short').detail, /wave 1 is under way, so finish it and start nothing new/);
  bd.beads.get('ex-u1').labels.push('state-verified');
  bd.beads.get('ex-u2').labels.push('state-verified');
  const fresh = await claim(t, bd, 'ex-n1', budgetAt(90, [...bd.beads.values()]));
  assert.match(fresh.deny, /\(D5: wave 2 of upload needs 10\.4 units with the 30% reserve to finish; .* starting it risks half-built work\)/);
  assert.deepEqual(reasonProblems(fresh.deny), []);
});

test('R-36 waves: materialise stamps wave-<n> from the story file and protects it; wave.js shows, plans and closes per area', async () => {
  const { planGraph } = require('./lib/plan-graph.js');
  const p = planGraph({ prefix: 'ex', initiative: 'vault', sha: 'abc', roadmap: { phases: [{ number: '1', name: 'one', items: [] }] },
    stories: [{ id: 'a', title: 'A', phase: '1', dependsOn: [], size: 'S', wave: '2', file: 'a.md', area: 'import' }, { id: 'b', title: 'B', phase: '1', dependsOn: [], wave: 'two', file: 'b.md' }], spikes: [], surfaces: [] });
  const a = p.beads.find((x) => x.id === 'ex-a');
  assert.ok(a.labels.includes('wave-2'));
  assert.equal(a.metadata.wave, 2);
  assert.ok(p.warnings.some((w) => /wave "two"/.test(w)));
  // a builder cannot move a story out of its wave
  const bdr = { show: () => ({ id: 'mine', assignee: 'me@pc/builder-1', labels: ['story', 'wave-2'], metadata: { story_file: 'a.md' } }) };
  assert.match(decideBd({ command: 'bd update mine --remove-label wave-2', actor: 'me@pc/builder-1', roleId: 'builder', staleHours: 2, bd: bdr }).reason, /the label wave-2/);
  assert.match(decideBd({ command: `bd update mine --metadata '{"wave":3}'`, actor: 'me@pc/builder-1', roleId: 'builder', staleHours: 2, bd: bdr }).reason, /the gate field wave/);

  const t = vault();
  for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) t.story(id, { area: 'import', wave: 2, files: id < 'i3' ? [['src/import/', 'modify']] : [] });
  const bd = memBd([bead('i1', 'import', { wave: 2, state: 'verified', status: 'closed' }), bead('i2', 'import', { wave: 2, state: 'verified', status: 'closed' }), bead('i3', 'import', { wave: 2, state: 'verified', status: 'closed' }), bead('i4', 'import', { wave: 2, status: 'in_progress' }), bead('i5', 'import', { wave: 2 }), bead('i0', 'import', { wave: 1, state: 'verified', status: 'closed' })]);
  const dm = { root: t.root, roleId: 'delivery-lead', instance: 'delivery-lead', team: TEAM };
  const show = wave.main(['show'], { who: dm, bd });
  assert.match(show.out, /^wave 2 of import: 3 of 5 stories checked on the customer's app/);
  const planned = wave.main(['plan'], { who: dm, bd, budget: NO_BUDGET });
  assert.match(planned.out, /wave 1 \(done, not closed: wave\.js close\)/);
  assert.match(planned.out, /wave 2 \(current\): 5 stories/);
  assert.match(planned.out, /warning: ex-i1 and ex-i2 touch src\/import\//);
  assert.equal(wave.main(['plan'], { who: { ...dm, roleId: 'builder' }, bd }).code, 1);
  const early = wave.main(['close', 'import', '2'], { who: dm, bd });
  assert.equal(early.code, 1);
  assert.deepEqual(reasonProblems(early.out), []);
  assert.match(wave.main(['close', 'import', '1'], { who: dm, bd, now: NOW }).out, /wave 1 of import closed: 1 verified/);
  assert.deepEqual(wave.readLedger(t.root).map((r) => r.type), ['plan', 'close']);
  // the status the Chief of Staff reads: the current wave per area, and the budget when set
  const s = teamStatus(t.root, { bdCheck: () => true, storyBeads: () => [...bd.beads.values()], checkBeads: () => [], idleBd: { list: () => [], ready: () => [] }, budget: budgetAt(40, []), now: NOW });
  const text = renderStatus(s);
  assert.match(text, /Wave: wave 2 of import: 3 of 5 stories checked on the customer's app/);
  assert.match(text, /Budget: 60 units of 100\.0 left/);
});

test('R-36/R-41 lanes: every role reads waves, the budget and the selection; only the Delivery Manager plans and closes waves and records a selection', () => {
  const { decideLane, loadPolicy } = require('../hooks/scripts/lane.js');
  const root = path.join(__dirname, '..');
  const groups = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'lane-groups.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lane-'));
  const allowed = (role, cmd) => decideLane({ toolName: 'Bash', toolInput: { command: `node ${root}/scripts/${cmd}` }, policy: loadPolicy({ pluginRoot: root, projectRoot: '/nonexistent', briefRef: `delivery/${role}` }), roleDir: dir, groups, pluginRoot: root, cwd: dir, projectRoot: dir, hostHeadless: false }).allow;
  for (const role of ['chief-of-staff', 'product-manager', 'delivery-lead']) for (const cmd of ['wave.js show', 'plan.js budget', 'plan.js select']) assert.equal(allowed(role, cmd), true, `${role} ${cmd}`);
  for (const cmd of ['wave.js plan', 'wave.js close import 2', 'plan.js select --record']) {
    assert.equal(allowed('delivery-lead', cmd), true, cmd);
    for (const role of ['chief-of-staff', 'product-manager']) assert.equal(allowed(role, cmd), false, `${role} ${cmd}`);
  }
});

// ---- PR 54 review, round 1 ----
const dmClaim = (t, bd, id, budget) => claim(t, bd, id, budget, { roleId: 'delivery-lead', actor: 'dm@pc/delivery-lead', instance: 'delivery-lead' });

test('PR 54 I-1: starting a wave needs the whole wave to fit, with its reserve, not only the first story', async () => {
  const t = vault();
  for (const id of ['l1', 'l2', 'l3']) t.story(id, { area: 'upload', wave: 1 });
  const beads = ['l1', 'l2', 'l3'].map((id) => bead(id, 'upload', { wave: 1, size: 'L' }));
  const bd = memBd(beads);
  // 80% used: 20 left; one L needs 10.4, the wave of three 31.2
  const g = await claim(t, bd, 'ex-l1', budgetAt(80, beads));
  assert.match(g.deny, /D5: wave 1 of upload needs 31\.2 units with the 30% reserve to finish; 20 units are free/);
  assert.deepEqual(reasonProblems(g.deny), []);
  assert.ok(!/[a-z]+-[a-z]+-[a-z]+\.$/.test(g.deny.split('\n')[1]), 'the builder is told in plain words, not a code name');
  assert.equal((await claim(t, bd, 'ex-l1', budgetAt(60, beads))).deny, null, '40 free: the wave fits');
});

test('PR 54 I-2, Copilot 581 and 726: a linked fix must fit what is left with its reserve, and a fix in progress holds its share', async () => {
  const t = vault();
  t.story('wxy-1', { area: 'auth', wave: 1 });
  t.story('a1', { area: 'auth', wave: 2 });
  const shipped = bead('wxy-1', 'auth', { wave: 1, state: 'verified', status: 'closed' });
  const big = { id: 'ex-fix-l', title: 'sign-in refresh race', status: 'open', parent: 'ex-vault-ph1', labels: ['bug', 'size-L'], metadata: { area: 'auth', fixes: 'ex-wxy-1' } };
  const small = { ...big, id: 'ex-fix-s', labels: ['bug', 'size-S'] };
  const bd = memBd([shipped, big, small]);
  // 95% used, nothing in flight: 5 left; an L fix needs 10.4, an S fix 1.3
  const st = budgetAt(95, [shipped]);
  assert.equal(st.nearLimit, false);
  const over = await dmClaim(t, bd, 'ex-fix-l', st);
  assert.match(over.deny, /D5: the linked fix needs 10\.4 units with the 30% reserve; 5 units are left/);
  assert.deepEqual(reasonProblems(over.deny), []);
  assert.equal((await claim(t, bd, 'ex-fix-s', st)).deny, null);
  // a claimed fix that is not a story still holds its estimate and reserve
  const busy = memBd([shipped, { ...big, status: 'in_progress', assignee: 'dev@pc/builder-2' }, bead('a1', 'auth', { wave: 2, size: 'S' })]);
  const withFix = budgetAt(85, [...busy.beads.values()]);
  assert.equal(Math.round(withFix.inflightNeed * 10) / 10, 10.4);
  // the claim check lists stories; it must still find the fix in progress
  ownerSets(t, 'budget.weekly_units', 100);
  const viaHook = W.contextFor(t.root, { bd: busy, team: TEAM, beads: [shipped, bead('a1', 'auth', { wave: 2, size: 'S' })], budgetOpts: { usedTokens: 85 * B.table(null).unitTokens, snapshot: null } });
  assert.equal(Math.round(viaHook.budget.inflightNeed * 10) / 10, 10.4, 'the claim check counts the fix bead it did not list as a story');
});

test('PR 54 I-5, Copilot 599: select offers exactly what the claim check lets start', async () => {
  const t = vault();
  for (const id of ['478', '479', 'w3-1']) t.story(id, { area: 'collections', wave: id === 'w3-1' ? 3 : 2 });
  const beads = [bead('478', 'collections', { wave: 2, state: 'merged', status: 'closed', size: 'L' }), bead('479', 'collections', { wave: 2, status: 'in_progress', size: 'L' }), bead('w3-1', 'collections', { wave: 3, size: 'M' }), bead('480', 'collections', { wave: 2, size: 'S' })];
  t.story('480', { area: 'collections', wave: 2 });
  const bd = memBd(beads);
  const who = { root: t.root, roleId: 'delivery-lead', instance: 'delivery-lead', team: TEAM };
  for (const used of [20, 85, 97]) {
    const st = budgetAt(used, beads);
    const sel = JSON.parse((await plan.main(['select', '--json'], { who, bd, budget: st })).out);
    for (const r of sel.ranked) {
      const g = await claim(t, bd, r.id, st);
      assert.equal(Boolean(r.refused), Boolean(g.deny), `${used}%: ${r.id} select ${r.refused} / claim ${g.deny}`);
    }
  }
});

test('PR 54 Copilot 608 and 620: a size-L story is estimated on the large model; lean mode reads the weekly allowance, not the envelope', () => {
  const team = { roles: [{ id: 'builder', model: 'sonnet' }] };
  const L = { id: 'x', labels: ['story', 'size-L'], metadata: {} };
  assert.equal(B.estimate(L, { team }).model, 'opus', 'the builder dispatches size-L on its large model (DELIVERY_LARGE_MODEL), opus by default');
  assert.equal(B.estimate(L, { team: { roles: [{ id: 'builder', model: 'sonnet', large_model: 'haiku' }] } }).model, 'haiku');
  assert.equal(B.estimate({ ...L, labels: ['story', 'size-M'] }, { team }).model, 'sonnet');
  assert.equal(B.estimate({ ...L, metadata: { model: 'sonnet' } }, { team }).model, 'sonnet', 'a story model override wins');
  const g = goalProject();
  ownerSets(g, 'budget.weekly_units', 100);
  ownerSets(g, 'budget.usage_envelope', 50);
  ownerSets(g, 'budget.lean_at', 70);
  const st = B.state(g.root, { usedTokens: 40 * B.table(null).unitTokens, snapshot: null });
  assert.deepEqual([st.total, st.lean, st.weeklyPct], [50, false, 40]);
  assert.equal(B.state(g.root, { usedTokens: 72 * B.table(null).unitTokens, snapshot: null }).lean, true);
});

test('PR 54 I-7: without the status line, spend counts from the owner-set week start, and the budget says which basis it uses', () => {
  const g = goalProject();
  ownerSets(g, 'budget.weekly_units', 100);
  const now = '2026-10-15T12:00:00.000Z';
  const unknown = B.state(g.root, { usedTokens: 0, snapshot: null, now });
  assert.match(unknown.source, /over the last 7 days \(reset time unknown/);
  assert.equal(ownerSets(g, 'budget.period_start', '2026-10-01T09:00:00Z').ok, true);
  const owned = B.state(g.root, { usedTokens: 0, snapshot: null, now });
  assert.equal(owned.periodStart, '2026-10-15T09:00:00.000Z', 'the most recent weekly reset from the owner\'s start');
  assert.match(owned.source, /since the weekly reset the owner set/);
});

test('PR 54 Copilot 644, 660, 670 and m-2: commented lists, wave fit after other areas\' commitments, unwaved areas in the plan, no negative figures', async () => {
  const { listValue } = require('./lib/plan-docs.js');
  assert.deepEqual(listValue('[]   # existing code, evals'), []);
  assert.deepEqual(listValue('[evals/import, dec-x-1] # why'), ['evals/import', 'dec-x-1']);
  const t = vault();
  t.story('o1', { area: 'other', wave: 1 });
  t.story('i1', { area: 'import', wave: 1 });
  t.story('u1', { area: 'loose' });
  const beads = [bead('o1', 'other', { wave: 1, status: 'in_progress', size: 'L' }), bead('i1', 'import', { wave: 1, size: 'M' }), bead('u1', 'loose', {})];
  const bd = memBd(beads);
  const who = { root: t.root, roleId: 'delivery-lead', instance: 'delivery-lead', team: TEAM };
  // 85 used: 15 left, 10.4 held by other; import's wave needs 3.9: 4.6 available, it fits; at 90 it does not
  assert.match((await plan.main(['budget'], { who, bd, budget: budgetAt(85, beads) })).out, /wave 1 of import: .*still needs 3\.9 units with the reserve: fits/);
  const tight = (await plan.main(['budget'], { who, bd, budget: budgetAt(92, beads) })).out;
  assert.match(tight, /wave 1 of import: .*does not fit/);
  assert.match(tight, /no units free/);
  assert.ok(!/-\d/.test(tight), tight);
  assert.match(wave.main(['plan'], { who, bd, budget: NO_BUDGET }).out, /loose:\n {2}warning: no wave: ex-u1/);
});

test('PR 54 m-1: every refusal the Delivery Manager gets fits the reason rule', async () => {
  const t = vault();
  for (const id of ['478', '479', 'w3-1']) t.story(id, { area: 'collections', wave: id === 'w3-1' ? 3 : 2 });
  t.story('pub', { area: 'publication', wave: 1 });
  const beads = [bead('478', 'collections', { wave: 2, state: 'merged', status: 'closed', size: 'L' }), bead('479', 'collections', { wave: 2, status: 'in_progress', size: 'L' }), bead('w3-1', 'collections', { wave: 3 }), bead('pub', 'publication', { wave: 1 })];
  const bd = memBd(beads);
  for (const [id, used] of [['ex-w3-1', 85], ['ex-pub', 60], ['ex-pub', 97]]) {
    const g = await dmClaim(t, bd, id, budgetAt(used, beads));
    assert.ok(g.deny, `${id} at ${used}%`);
    assert.deepEqual(reasonProblems(g.deny), [], g.deny);
  }
});

// ---- PR 54 re-review ----
test('Copilot 435: the status line\'s weekly reading is taken from the owner\'s envelope, not the whole week', () => {
  const g = goalProject();
  ownerSets(g, 'budget.weekly_units', 100);
  ownerSets(g, 'budget.usage_envelope', 80);
  const st = B.state(g.root, { usedTokens: 0, snapshot: { usedPct: 70, periodStart: NOW } });
  assert.equal(Math.round(st.remaining), 10);
});

test('Copilot 449: the Delivery Manager handing a started story to a new builder is not a new start', async () => {
  const t = vault();
  t.story('m1', { area: 'upload', wave: 1 });
  t.story('x1', { area: 'other', wave: 1 });
  const beads = [bead('m1', 'upload', { wave: 1, status: 'in_progress', size: 'M' }), bead('x1', 'other', { wave: 1, state: 'verified', status: 'closed' })];
  const bd = memBd(beads);
  // 95 used: 5 left, the story's own 3.9 already held: 1.1 free
  const g = await gateChecks({ command: 'bd update ex-m1 --assignee dev@pc/builder-2', roleId: 'delivery-lead', actor: 'dm@pc/delivery-lead', instance: 'delivery-lead', bd, root: t.root, team: TEAM, budget: budgetAt(95, beads) });
  assert.equal(g.deny, null);
  assert.ok(!kinds(g).includes('new-area'));
});

test('Copilot 827: two starts in one command are budgeted together', async () => {
  const t = vault();
  for (const id of ['a1', 'b1', 'v1', 'v2']) t.story(id, { area: id[0] === 'a' || id === 'v1' ? 'alpha' : 'beta', wave: id.startsWith('v') ? 1 : 2 });
  const beads = [bead('v1', 'alpha', { wave: 1, state: 'verified', status: 'closed' }), bead('v2', 'beta', { wave: 1, state: 'verified', status: 'closed' }), bead('a1', 'alpha', { wave: 2 }), bead('b1', 'beta', { wave: 2 })];
  const bd = memBd(beads);
  // 94 used: 6 free; each M wave needs 3.9, both 7.8
  const st = budgetAt(94, beads);
  assert.equal((await claim(t, bd, 'ex-a1', st)).deny, null);
  const both = await gateChecks({ command: 'bd update ex-a1 --claim && bd update ex-b1 --claim', roleId: 'builder', actor: 'dev@pc/builder-1', instance: 'builder-1', bd, root: t.root, team: TEAM, budget: st });
  assert.match(both.deny, /^Claim of ex-b1 refused \(D5: wave 2 of beta needs 3\.9 units/);
});

test('Copilot 896: starting a later wave while the current one is under way needs both to fit', async () => {
  const t = vault();
  for (const id of ['478', '479', 'w3-1', 'w3-2']) t.story(id, { area: 'collections', wave: id.startsWith('w3') ? 3 : 2 });
  const beads = [bead('478', 'collections', { wave: 2, state: 'merged', status: 'closed', size: 'L' }), bead('479', 'collections', { wave: 2, status: 'in_progress', size: 'L' }), bead('w3-1', 'collections', { wave: 3 }), bead('w3-2', 'collections', { wave: 3 })];
  const bd = memBd(beads);
  // 80 used: 20 left; wave 2 still needs 12.8, wave 3 needs 7.8: 20.6 in all
  const g = await claim(t, bd, 'ex-w3-1', budgetAt(80, beads));
  assert.match(g.deny, /D5: wave 3 while wave 2 of collections is unfinished: .*wave 2 needs 12\.8, wave 3 needs 7\.8/);
  assert.deepEqual(reasonProblems(g.deny), []);
  assert.equal((await claim(t, bd, 'ex-w3-1', budgetAt(75, beads))).deny, null, '25 left: both fit');
});

test('Copilot 929: select lists under Not now a story the claim refuses for changed criteria (D1)', async () => {
  const t = vault();
  t.story('c1', { area: 'upload', wave: 1 });
  const bd = memBd([bead('c1', 'upload', { wave: 1, metadata: { ready_hash: 'stale0000000' } })]);
  const sel = JSON.parse((await plan.main(['select', '--json'], { who: { root: t.root, roleId: 'delivery-lead', team: TEAM }, bd, budget: NO_BUDGET })).out);
  assert.match(sel.ranked[0].refused, /criteria changed since ready.*\(D1\)/);
  assert.match((await claim(t, bd, 'ex-c1', NO_BUDGET)).deny, /D1: the agreed criteria changed/);
});

test('Copilot 947 and m-a: a fix merged but not verified keeps its reserve, in plan.js, wave.js and team-status alike', async () => {
  const t = vault();
  ownerSets(t, 'budget.weekly_units', 100);
  t.story('i1', { area: 'import', wave: 1 });
  const fix = { id: 'ex-fx', title: 'fix', status: 'closed', labels: ['bug', 'size-L', 'state-merged'], metadata: { area: 'import' } };
  const beads = [bead('i1', 'import', { wave: 1 })];
  const bd = memBd([...beads, fix]);
  const used = { usedTokens: 50 * B.table(null).unitTokens, snapshot: null };
  const ctx = W.contextFor(t.root, { bd, team: TEAM, beads, budgetOpts: used });
  assert.equal(Math.round(ctx.budget.inflightNeed * 10) / 10, 2.4, 'merged L fix: its 30% reserve on sonnet');
  const who = { root: t.root, roleId: 'delivery-lead', instance: 'delivery-lead', team: TEAM };
  assert.match((await plan.main(['budget'], { who, bd, budgetOpts: used })).out, /so 47\.6 units free/);
  assert.match(wave.main(['plan'], { who, bd, budgetOpts: used }).out, /47\.6 units free/);
  const s = renderStatus(teamStatus(t.root, { bdCheck: () => true, bd, storyBeads: () => beads, checkBeads: () => [], idleBd: { list: () => [], ready: () => [] }, budgetOpts: used, now: NOW }));
  // team-status reads the project's own team.json, which has no builder: size-L costs on opus there
  assert.match(s, /45\.9 units free/);
});

test('m-b: a partial spend reading is flagged in the claim warnings and in team-status', async () => {
  const t = vault();
  t.story('p1', { area: 'upload', wave: 1 });
  const beads = [bead('p1', 'upload', { wave: 1, size: 'S' })];
  const st = { ...budgetAt(10, beads), partial: true };
  const g = await claim(t, memBd(beads), 'ex-p1', st);
  assert.ok(g.warnings.some((w) => w.kind === 'spend-partial' && /partial/.test(w.detail)));
  const s = renderStatus(teamStatus(t.root, { bdCheck: () => true, storyBeads: () => beads, checkBeads: () => [], idleBd: { list: () => [], ready: () => [] }, budget: st, now: NOW }));
  assert.match(s, /spend reading is partial/);
});

// FR-27 (S-9): one file's spellings are one path at claim; a short spelling naming a file in two plugins
// is compared as each and reported "ambiguous", never resolved silently.
function twoPlugins(t) {
  const files = ['kit/alpha/.claude-plugin/plugin.json', 'kit/alpha/agents/chief-of-staff.md', 'kit/alpha/agents/x.md',
    'kit/beta/.claude-plugin/plugin.json', 'kit/beta/agents/x.md'];
  for (const f of files) { fs.mkdirSync(path.join(t.root, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(t.root, f), '{}\n'); }
  require('child_process').execFileSync('git', ['init', '-q'], { cwd: t.root });
  require('child_process').execFileSync('git', ['add', '-A'], { cwd: t.root });
}
test('FR-27 [rule:waves-spelling]: two stories naming one file two ways raise one file-overlap at claim; agents/x.md in two plugins reads ambiguous', async () => {
  const t = vault();
  twoPlugins(t);
  t.story('a', { area: 'team', wave: 1, files: [['agents/chief-of-staff.md', 'modify']] });
  t.story('b', { area: 'team', wave: 1, files: [['kit/alpha/agents/chief-of-staff.md', 'modify']] });
  t.story('c', { area: 'team', wave: 1, files: [['agents/x.md', 'modify']] });
  t.story('d', { area: 'team', wave: 1, files: [['kit/beta/agents/x.md', 'modify']] });
  const bd = memBd([bead('a', 'team', { wave: 1, status: 'in_progress' }), bead('b', 'team', { wave: 1 }), bead('c', 'team', { wave: 1 }), bead('d', 'team', { wave: 1, status: 'in_progress' })]);
  const g = await claim(t, bd, 'ex-b', NO_BUDGET);
  const over = g.warnings.filter((w) => w.kind === 'file-overlap');
  assert.equal(over.length, 1, JSON.stringify(g.warnings));
  assert.match(over[0].detail, /^touches kit\/alpha\/agents\/chief-of-staff\.md, as ex-a in progress does/);
  const amb = (await claim(t, bd, 'ex-c', NO_BUDGET)).warnings.filter((w) => w.kind === 'file-overlap');
  assert.equal(amb.length, 1, JSON.stringify(amb));
  assert.match(amb[0].detail, /touches kit\/beta\/agents\/x\.md \(ambiguous: agents\/x\.md names kit\/alpha\/agents\/x\.md and kit\/beta\/agents\/x\.md\), as ex-d/);
});

test('FR-27 [rule:waves-norm]: ./x, x, x/** match as before; case, a trailing slash and .. are folded; no files, no overlap', () => {
  const o = (a, b, index) => W.overlap(a.map((p) => ({ path: p })), b.map((p) => ({ path: p })), { index });
  assert.deepEqual(o(['./src/a.js'], ['src/a.js']), ['src/a.js']);
  assert.deepEqual(o(['src/**'], ['src/a.js']), ['src/']);
  assert.deepEqual(o(['Src/A.js'], ['src/a.js']), ['src/a.js']);
  assert.deepEqual(o(['src/lib/../a.js'], ['src//a.js']), ['src/a.js']);
  assert.deepEqual(o(['src/'], ['src/a.js']), ['src/']);
  assert.deepEqual(o([], ['src/a.js']), []);
  assert.deepEqual(o(['src/a.js'], ['src/b.js']), []);
  // without an index (not a git checkout) a short spelling stays as written
  assert.deepEqual(o(['agents/x.md'], ['kit/alpha/agents/x.md']), []);
  const index = { roots: ['kit/alpha/'], has: (p) => p === 'kit/alpha/agents/x.md' };
  assert.deepEqual(o(['agents/x.md'], ['kit/alpha/agents/x.md'], index), ['kit/alpha/agents/x.md']);
  // a short spelling that names no file in any plugin is a repo path
  assert.deepEqual(o(['docs/a.md'], ['kit/alpha/docs/a.md'], index), []);
  assert.equal(W.fileIndex(fs.mkdtempSync(path.join(require('os').tmpdir(), 'nogit-'))), null);
});
