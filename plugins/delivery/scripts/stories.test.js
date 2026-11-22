// scripts/stories.test.js — the story command (stories.js, lib/stories.js): every change is checked
// with the gates' parser and refused naming the field, the file's bytes unchanged. Runs in the sealed
// suite (scripts/testing/run-tests.js).
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('./lib/stories.js');
const G = require('./lib/gates.js');
const stories = require('./stories.js');
const { makeProject, storyBead } = require('./testing/gate-fixture.js');
const { harness } = require('./testing/role-harness.js');

const FILE = 'vault-0n9-3.md';
// the fixture's story, written as a whole draft with a status
const DRAFT = (() => {
  const root = makeProject({ checkScript: false });
  return fs.readFileSync(path.join(S.dirOf(root), FILE), 'utf8').replace('size: M\n', 'size: M\nstatus: draft\n');
})();
function world() {
  const root = makeProject({ checkScript: false });
  fs.unlinkSync(path.join(S.dirOf(root), FILE));
  const run = (...argv) => stories.main(argv, { cwd: root, who: { root } });
  const draft = (text) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-')), 'd.md'); fs.writeFileSync(f, text); return f; };
  const abs = path.join(S.dirOf(root), FILE);
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  return { root, run, draft, abs, sha, text: () => fs.readFileSync(abs, 'utf8') };
}
const created = () => { const w = world(); const r = w.run('new', '--from', w.draft(DRAFT), '--file', FILE); assert.equal(r.code, 0, r.out); return w; };

test('team-runtime-11 c1: set changes size and wave; an XL size, a status outside the list or a field not in the contract names the field and keeps the sha256', () => {
  const w = created();
  assert.equal(w.run('set', 'vault-0n9-3', 'size', 'L').code, 0);
  assert.equal(w.run('set', FILE, 'wave', '2').code, 0);
  assert.match(w.text(), /^size: L$/m);
  assert.match(w.text(), /^wave: 2$/m);
  const before = w.sha();
  for (const [key, value] of [['size', 'XL'], ['status', 'bogus'], ['colour', 'red'], ['wave', 'two'], ['depends_on', 'a-01'], ['surface', '<surface id>'], ['id', 'a b']]) {
    const r = w.run('set', FILE, key, value);
    assert.equal(r.code, 1, `${key} ${value}`);
    assert.match(r.out, new RegExp(`^stories\\.js: ${key}: `), r.out);
    assert.equal(w.sha(), before, `${key} kept the bytes`);
  }
  // each contract field, model too, takes a good value
  for (const [key, value] of [['title', 'Import a CSV'], ['status', 'ready'], ['epic', 'collection'], ['supersedes', '[]'], ['superseded_by', '[a-01]'], ['superseded_reason', 'the flow changed'],
    ['phase', '2'], ['requirements', '[FR-1]'], ['depends_on', '[]'], ['size', 'S'], ['surface', 'S1'], ['area', 'collection'], ['reuses', '[x.js]'], ['fixes', 'ex-1'], ['finding', 'R-1'], ['model', 'opus']]) {
    assert.equal(w.run('set', FILE, key, value).code, 0, key);
    assert.equal(String(G.parseStory(w.text()).meta[key]), value, key);
  }
});

test('team-runtime-11 c2: an added criterion and probe count for the gate; a bracketed placeholder or no probe is turned away, and a draft that fails creates nothing', () => {
  const w = created();
  assert.equal(G.parseStory(w.text()).criteria.length, 2);
  const ok = w.run('criterion', FILE, '3', '--text', 'A player who drops an empty CSV sees that nothing was imported.', '--probe', 'the chat says nothing was imported; where: S1; by: reality-check');
  assert.equal(ok.code, 0, ok.out);
  const s = G.parseStory(w.text());
  assert.equal(s.criteria.length, 3);
  assert.equal(s.criteria[2].probe.by, 'reality-check');
  assert.deepEqual(G.readyFindings({ story: s, surfaces: [{ id: 'S1', app: 'ChatGPT web', scriptable: false }] }).map((f) => f.code), []);
  const before = w.sha();
  const probe = 'it shows; where: S1; by: reality-check';
  for (const [text, p, field, why] of [['A player sees the <bead> link.', probe, 'criterion 4', /angle brackets \(<bead>\)/], ['A player sees the summary.', undefined, 'criterion 4 probe', /is missing/],
    ['A player sees the summary.', 'it shows; where: S1', 'criterion 4 probe', /by: test/], ['A player sees the summary.', 'it shows; by: test', 'criterion 4 probe', /where:/]]) {
    const r = w.run('criterion', FILE, '4', '--text', text, ...(p ? ['--probe', p] : []));
    assert.equal(r.code, 1, text);
    assert.match(r.out, new RegExp(`^stories\\.js: ${field}: `));
    assert.match(r.out, why);
    assert.equal(w.sha(), before);
  }
  // inside backticks, angle brackets are a command argument
  assert.equal(w.run('criterion', FILE, '4', '--text', 'The DM runs `bd show <id>` and sees the story.', '--probe', probe).code, 0);
  // drafts with a bad field: the earliest one is named, and neither the story nor the index appears
  for (const [bad, field] of [[DRAFT.replace('status: draft', 'status: someday'), 'status'], [DRAFT.replace('drops a collection CSV', 'drops a <file>'), 'criterion 1'],
    [DRAFT.replace(/\n {3}- Probe: the chat names the skipped column[^\n]*/, ''), 'criterion 2 probe'], [DRAFT.replace('size: M', 'size: XL').replace('drops a collection CSV', 'drops a <file>'), 'size']]) {
    const v = world();
    const r = v.run('new', '--from', v.draft(bad), '--file', FILE);
    assert.equal(r.code, 1, field);
    assert.match(r.out, new RegExp(`^stories\\.js: ${field}: [^\\n]*\\nNo story file was written`), r.out);
    assert.equal(fs.existsSync(v.abs), false);
    assert.equal(fs.existsSync(path.join(v.root, '.delivery', 'stories', 'README.md')), false);
  }
});

test('rewriting the middle one of three criteria keeps the lines of the first and third, and the story hash moves', () => {
  const w = created();
  w.run('criterion', FILE, '3', '--text', 'A player sees the third thing.', '--probe', 'seen; where: S1; by: reality-check');
  const before = G.parseStory(w.text());
  const lines = w.text().split('\n');
  const r = w.run('criterion', FILE, '2', '--text', 'A player who drops a CSV with two unknown columns sees both named.', '--probe', 'the chat names both; where: S1; by: reality-check');
  assert.equal(r.code, 0, r.out);
  const after = G.parseStory(w.text());
  assert.equal(after.criteria.length, 3);
  assert.notEqual(G.storyHash(after), G.storyHash(before));
  for (const n of [0, 2]) assert.equal(G.criterionHash(after.criteria[n]), G.criterionHash(before.criteria[n]));
  const now = w.text().split('\n');
  const at = lines.findIndex((l) => l.startsWith('2. '));
  assert.deepEqual([now.slice(0, at), now.slice(at + 2)], [lines.slice(0, at), lines.slice(at + 2)]);
});

test('team-runtime-11 c5: prose sections are free text; a template or existing heading is edited, a foreign one needs --new, a code fence is respected, and a same-text rewrite is byte-identical', () => {
  const w = created();
  for (const [heading, body] of [['Goal', 'Whatever words, even <these> and FR-9.'], ['Context: where the importer stands', '| Fact | Where |\n| :-- | :-- |\n| x | y |'], ['Out of scope', '- exports'],
    ['Open questions (for the Product Manager)', '- which encodings?'], ['Split rationale', 'One sitting.'], ['Blast radius', 'No hub.']]) {
    const r = w.run('section', FILE, '--heading', heading, '--body', body);
    assert.equal(r.code, 0, `${heading}: ${r.out}`);
    assert.ok(w.text().includes(`## ${heading}`) && w.text().includes(body), heading);
  }
  // writing Goal again swaps it where it stands, once, and the criteria hash holds
  const hash = G.storyHash(G.parseStory(w.text()));
  assert.equal(w.run('section', FILE, '--heading', 'Goal', '--body', 'A shorter goal.').code, 0);
  assert.equal(w.text().match(/^## Goal$/gm).length, 1);
  assert.ok(w.text().includes('A shorter goal.'));
  assert.equal(G.storyHash(G.parseStory(w.text())), hash);
  // a foreign heading needs --new; without it, refused; Acceptance criteria is never a section
  const before = w.sha();
  for (const heading of ['Banana', 'Zzz top']) {
    const r = w.run('section', FILE, '--heading', heading, '--body', 'x');
    assert.equal(r.code, 1, heading);
    assert.match(r.out, /^stories\.js: heading: .*--new/);
  }
  assert.match(w.run('section', FILE, '--heading', 'Acceptance criteria', '--body', 'x').out, /^stories\.js: heading: /);
  assert.equal(w.sha(), before);
  // --new adds a deliberate free-text section, and then it edits without --new (it now exists)
  assert.equal(w.run('section', FILE, '--heading', 'Design answers', '--body', 'A1.', '--new').code, 0);
  assert.ok(w.text().includes('## Design answers') && w.text().includes('A1.'));
  assert.equal(w.run('section', FILE, '--heading', 'Design answers', '--body', 'A2.').code, 0, 'an existing non-template heading edits without --new');
  assert.ok(w.text().includes('A2.') && !w.text().includes('A1.'));
  // a ## inside the body outside a fence is refused; inside a fence it is body text (finding 3)
  assert.match(w.run('section', FILE, '--heading', 'Goal', '--body', 'x\n## Sneaky').out, /^stories\.js: body: /);
  const fenced = w.run('section', FILE, '--heading', 'Goal', '--body', 'see\n```\n## not a heading\n```\n');
  assert.equal(fenced.code, 0, fenced.out);
  // a rewrite with the section's own current inter-heading text changes nothing (rv-225), checked on a
  // fresh story so earlier edits here do not confound it
  const w2 = created();
  const t0 = w2.text();
  const lines = t0.split('\n');
  const gi = lines.findIndex((l) => /^## Goal$/.test(l));
  const gnext = lines.findIndex((l, i) => i > gi && /^## /.test(l));
  const ownBody = lines.slice(gi + 1, gnext < 0 ? lines.length : gnext).join('\n');
  assert.equal(w2.run('section', FILE, '--heading', 'Goal', '--body', ownBody).code, 0);
  assert.equal(w2.text(), t0, 'rewriting Goal with its own body is byte-identical');
});

// rv-225 finding 3: headingLines skips a `## x` inside a code fence, so replacing the section above such a
// block replaces the whole section (the fenced ## is body text), not splitting it at the fence. A story
// whose Goal body holds a fenced ## is rewritten; if the fence were ignored, next() would stop at the
// fenced ## and leave the block orphaned.
test('rv-225 finding 3: a fenced ## in the story is body text, so the section above it is replaced whole, not split at the fence', () => {
  const w = created();
  assert.equal(w.run('section', FILE, '--heading', 'Goal', '--body', 'intro\n```\n## not a heading\n```\ntail').code, 0);
  assert.ok(w.text().includes('## not a heading'), 'the fenced ## is now in the story');
  assert.equal(w.text().match(/^## Goal$/gm).length, 1);
  assert.equal(w.run('section', FILE, '--heading', 'Goal', '--body', 'clean goal').code, 0);
  assert.ok(w.text().includes('clean goal'), 'the new body is written');
  assert.ok(!w.text().includes('## not a heading'), 'the old fenced block is replaced whole, not left orphaned at the fence');
  assert.ok(!w.text().includes('intro') && !w.text().includes('tail'), 'no remnant of the old Goal body');
  assert.equal(w.text().match(/^## Goal$/gm).length, 1, 'still exactly one Goal heading');
});

// rv-225 finding 8: change() writes through a temp file and an atomic rename, so a crash between the write
// and the rename never leaves a half-written story. A rename that throws must leave the original bytes
// untouched (a direct write would have changed them) and clean up the temp file.
test('rv-225 finding 8: a failed rename leaves the story byte-identical and no temp behind', () => {
  const w = created();
  const before = w.text();
  const dir = path.join(w.root, '.delivery', 'stories');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('rename boom'); };
  try {
    assert.throws(() => S.change(w.root, FILE, (text) => ({ text: `${text}\nappended line\n` })), /rename boom/);
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(w.text(), before, 'a failed rename leaves the story byte-identical (a direct write would have changed it)');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => /\.tmp$/.test(n)), [], 'the temp file is cleaned up');
});

test('ADR-004: no story index is generated on a new story or a status change', () => {
  const w = created();
  assert.equal(fs.existsSync(path.join(w.root, '.delivery', 'stories', 'README.md')), false, 'new writes no index');
  assert.deepEqual(S.setStatus(w.root, FILE, 'in-progress').written, [path.join('.delivery', 'stories', FILE)], 'a status move writes only the story');
  assert.equal(fs.existsSync(path.join(w.root, '.delivery', 'stories', 'README.md')), false, 'status move writes no index');
  const before = w.sha();
  assert.equal(S.setStatus(w.root, FILE, 'shipped').field, 'status', 'a bad status is still refused, file unchanged');
  assert.equal(w.sha(), before);
  // a status change through the command, and the role refusal, are unchanged
  assert.equal(w.run('set', FILE, 'status', 'ready').code, 0);
  assert.match(G.parseStory(w.text()).meta.status, /ready/);
  assert.match(stories.main(['set', FILE, 'size', 'S'], { cwd: w.root, who: { root: w.root, roleId: 'builder' } }).out, /^stories\.js: role: /);
});

// The stories skill as a Delivery Manager session runs it: a draft in a temporary file, then
// `new --from`, then ready.js clean, then a merge that still advances the status.
test('end to end: the command-made story passes ready.js clean and merge-gate.js merged advances it to in-progress', () => {
  const H1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const GREEN = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
  const BEAD = 'ex-vault-0n9-3';
  const root = makeProject();
  fs.unlinkSync(path.join(S.dirOf(root), FILE));
  const pr = { headRefOid: H1, headRefName: 'team/builder-1', mergeable: 'MERGEABLE', statusCheckRollup: GREEN, files: [{ path: 'src/a.js', additions: 10, deletions: 0 }], body: `x\n\nRefs ${BEAD}`, title: 'change' };
  const h = harness({ root, beads: { [BEAD]: storyBead({ status: 'open', metadata: { authors: [{ actor: 'dev@pc/builder-1', role: 'builder' }] } }) }, prs: { 478: pr } });
  const draft = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'story-draft-')), 'draft.md');
  assert.equal(h.tool('delivery-lead', 'Write', { file_path: draft, content: DRAFT }).deny, null);
  fs.writeFileSync(draft, DRAFT);
  const made = h.bash('delivery-lead', `${h.script('stories.js')} new --from ${draft} --file ${FILE}`);
  assert.equal(made.code, 0, made.deny || made.out);
  const ready = h.bash('delivery-lead', `${h.script('ready.js')} --story ${path.join(S.dirOf(root), FILE)} --initiative vault`);
  assert.match(ready.out, /^vault-0n9-3\.md: ready\n/, ready.out);
  assert.equal(h.bash('delivery-lead', `${h.script('stories.js')} set ${FILE} status ready`).code, 0);
  h.setBead(BEAD, (b) => { b.status = 'in_progress'; });
  h.bash('delivery-lead', `${h.script('review.js')} request 478 --reviewer agent-1`);
  h.bash('delivery-lead', `${h.script('review.js')} record 478 --head ${H1} --result pass --by agent-1 --summary 'criteria hold'`);
  h.setPr(478, (p) => { p.state = 'MERGED'; });
  const m = h.bash('delivery-lead', `${h.script('merge-gate.js')} merged 478`);
  assert.match(m.out, /vault-0n9-3\.md: ready -> in-progress/, m.out);
  assert.match(fs.readFileSync(path.join(S.dirOf(root), FILE), 'utf8'), /^status: in-progress$/m);
  // ADR-004: no index is generated by the merge-driven status move
  assert.equal(fs.existsSync(path.join(root, '.delivery', 'stories', 'README.md')), false);
});

// rv-225 finding 1: a story that opens with a leading HTML comment is read as the gates read it (they
// strip it), so set/criterion/section/plan-sync work on it. Before the fix, 16 real stories were refused
// and plan-sync recorded a problem on every apply, which would have blocked every later merge.
test('rv-225: a story opening with a leading HTML comment is edited, not refused as missing frontmatter', () => {
  const w = created();
  const commented = `<!-- generated; edit the source -->\n${w.text()}`;
  fs.writeFileSync(w.abs, commented);
  assert.equal(w.run('set', FILE, 'status', 'ready').code, 0, 'set works past a leading comment');
  assert.match(w.text(), /^status: ready$/m);
  assert.ok(w.text().startsWith('<!-- generated; edit the source -->\n'), 'the comment is kept');
  assert.equal(S.setStatus(w.root, FILE, 'in-progress').field, undefined, 'plan-sync setStatus works past a leading comment');
  assert.equal(S.frontmatterProblem(commented), null, 'the whole-draft check reads it too');
});

// rv-225 finding 4: the value is validated exactly as it is written. A trailing "# ..." is part of the
// value (there is no comment convention on a real value), and an old tail is never carried past a new value.
test('rv-225: set validates and writes the exact value, keeping no stale trailing text', () => {
  const w = created();
  assert.match(w.run('set', FILE, 'status', 'done # later').out, /^stories\.js: status: /, 'a status with a trailing # is refused, not silently stripped');
  assert.match(w.run('set', FILE, 'size', 'M # big').out, /^stories\.js: size: /);
  // an old value with a tail is fully replaced, not kept
  assert.equal(w.run('set', FILE, 'status', 'in-progress').code, 0);
  assert.match(w.text(), /^status: in-progress$/m);
  assert.equal(w.run('set', FILE, 'status', 'done').code, 0);
  assert.match(w.text(), /^status: done$/m);
  assert.doesNotMatch(w.text(), /^status:.*in-progress/m);
});
