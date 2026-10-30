// scripts/shape-methods.test.js — the product-shape methods ported from michaeljabbour's Taste, Sizzle
// and Market Fit skills (NOTICE) stay where the pipeline reads them: the owner's lens and what must
// survive in the brief, the one-breath test and the leftover test in the PRD's staging, and the
// storyboard the owner approves, in their quoted words, before the roadmap starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('brief: the owner\'s lens in at most three questions, what must survive, one proposition, gates first; never filled in', () => {
  const s = read('skills/brief/SKILL.md');
  assert.match(s, /in at most three questions, put in step 5's batch/);
  assert.match(s, /write the lens \*\*assumed\*\*: the team's reading, never written as the owner's words/);
  assert.match(s, /Only an item in the owner's own\s+words binds; one the team assumed is labelled \*\*assumed\*\*, is a proposal/);
  assert.match(s, /\*What must survive\.\*[\s\S]*cannot drop one without the owner's record/);
  assert.match(s, /\*Proposition\.\* The one thing[\s\S]*in one\s+sentence/);
  assert.match(s, /\*Gates first\.\* Correctness, safety, accessibility, feasibility[\s\S]*A critical fail blocks the idea/);
  const t = read('templates/brief.md');
  assert.match(t, /## Owner lens and what must survive/);
  for (const g of ['correctness', 'safety', 'accessibility', 'feasibility']) assert.match(t, new RegExp(`^\\| ${g} \\|`, 'm'));
});

test('prd: the one-breath test turns each "and also" into a proposed non-goal the owner decides', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\*\*5b\. One breath, and what to cut\.\*\*/);
  assert.match(s, /\*\*proposed non-goal\*\*[\s\S]*narrowing scope is never the team's choice, so nothing is dropped\s+until they answer/);
});

test('prd staging: every FR answers "In the primary picture?"; a leftover defaults to not doing as a proposal, and what must survive never defaults out', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\| \*\*In the primary picture\?\*\* \|/);
  assert.match(s, /defaults to \*Explicitly not doing\* unless it is load-bearing for another\s+persona/);
  assert.match(s, /A default is a proposal: it goes to the owner[\s\S]*\*\*What must survive\*\* in the owner's words\s+never defaults out/);
  const t = read('templates/prioritization.md');
  assert.match(t, /^\| FR \| Personas served \|.*\| In the primary picture\? \|$/m);
  assert.match(t, /\| FR \| Reason \| Leftover default or owner's record \| Revisit if \|/);
});

test('storyboard: approved only by the owner\'s words quoted exactly, reopened by change; the roadmap stops without it', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\*\*6\.7 The product storyboard, approved before the roadmap\.\*\*/);
  assert.match(s, /\*\*quoted word for word\*\*[\s\S]*with no message to quote, it is not approved\. Approval is never\s+assumed/);
  assert.match(s, /reopens it: clear the approval/);
  const t = read('templates/storyboard.md');
  assert.match(t, /\*\*Their words, quoted exactly:\*\*/);
  assert.match(t, /with nothing to quote, the status is not approved/);
  assert.match(t, /reopens this/);
  const r = read('skills/roadmap/SKILL.md');
  assert.match(r, /- \*\*Storyboard not approved\*\* — stop\./);
  assert.match(r, /Only the owner may waive it, in words you quote[\s\S]*a role never does, and silence is not approval/);
});

test('NOTICE: every ported method names its source and the source is in NOTICE with its copyright line', () => {
  const n = read('NOTICE');
  for (const [repo, holder] of [['amplifier-skill-taste', 'Taste × Elegance contributors'], ['amplifier-skill-sizzle', 'Sizzle contributors'], ['amplifier-skill-market-fit', 'Market Fit contributors']]) {
    assert.match(n, new RegExp(`${repo} \\(https://github\\.com/michaeljabbour/${repo}\\)\\n  Copyright \\(c\\) 2026 ${holder}\\. MIT License\\.`));
  }
  for (const f of ['skills/brief/SKILL.md', 'skills/prd/SKILL.md', 'skills/roadmap/SKILL.md', 'templates/storyboard.md']) assert.match(read(f), /michaeljabbour/, f);
});

test('planned before the methods: an older initiative is flagged, never stopped, at the PRD and the roadmap', () => {
  const r = read('skills/roadmap/SKILL.md');
  assert.match(r, /\*\*Planned before this gate:\*\* an initiative with no `storyboard\.md` whose `prioritization\.md` is\s+missing, or has no \*In the primary picture\?\* column[\s\S]*Do not stop it/);
  assert.match(r, /Once that column is\s+there, the gate applies in full\./);
  const p = read('skills/prd/SKILL.md');
  assert.match(p, /\*\*Written before the owner's lens\*\*[\s\S]*not thin: proceed/);
});

test('from the trial run: precondition steps, a wrong breath, one proposal per cut, the brief\'s MVP boundary stands', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\(an \*\*assumed\*\* item does not bind; list it for the owner\)/);
  assert.match(s, /\(\*yes, precondition\*\)/);
  assert.match(s, /means the breath is wrong: fix the breath, do not\s+default the requirement out/);
  assert.match(s, /already proposed as a non-goal is not proposed\s+again here/);
  assert.match(s, /narrow the brief's \*\*MVP boundary\*\*, the brief stands until the\s+owner answers/);
  assert.match(read('templates/prioritization.md'), /yes, precondition .* proposed non-goal, step 5b \|/);
});
