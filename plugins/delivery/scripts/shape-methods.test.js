// scripts/shape-methods.test.js — the product-shape methods ported from michaeljabbour's Taste, Sizzle
// and Market Fit skills (NOTICE) stay where the pipeline reads them: the owner's lens and what must
// survive in the brief, the one-breath test and the leftover test in the PRD's staging, and the
// storyboard the owner approves, in their quoted words, before the roadmap starts. These are text
// checks: they catch a pinned rule removed or reworded, not an agent misreading it; real runs do that.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHAPE = ['skills/brief/SKILL.md', 'skills/prd/SKILL.md', 'skills/roadmap/SKILL.md', 'skills/realign/SKILL.md', 'templates/brief.md', 'templates/prioritization.md', 'templates/storyboard.md'];

test('brief: the lens in at most three questions; only the owner\'s words bind; a critical fail goes to the owner', () => {
  const s = read('skills/brief/SKILL.md');
  assert.match(s, /in at most three questions, put in step 5's batch/);
  assert.match(s, /write the lens \*\*assumed\*\*: the team's reading, never written as the owner's words/);
  assert.match(s, /Only an item in the owner's own\s+words binds; one the team assumed is labelled \*\*assumed\*\*, is a proposal/);
  assert.match(s, /\*Proposition\.\* The one thing[\s\S]*in one\s+sentence/);
  assert.match(s, /\*Gates first\.\* Correctness, safety, accessibility, feasibility/);
  assert.match(s, /A critical fail is not the team's veto: it goes to\s+the owner as a decision/);
  const t = read('templates/brief.md');
  assert.match(t, /## Owner lens and what must survive/);
  assert.match(t, /An item quoted from elsewhere binds only once the owner\s+confirms it applies here/);
  for (const g of ['correctness', 'safety', 'accessibility', 'feasibility']) assert.match(t, new RegExp(`^\\| ${g} \\|`, 'm'));
});

test('prd 5b: a cut scenario stays written, is proposed, and stays in its stage until the owner answers', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\*\*5b\. One breath, and what to cut\.\*\*/);
  assert.match(s, /the scenario stays written in the PRD, marked\s+\*\*proposed non-goal\*\*/);
  assert.match(s, /narrowing scope is never the team's choice, so nothing\s+is dropped until they answer/);
  assert.match(s, /the brief stands\s+until the owner answers/);
  assert.match(s, /read \*proposed non-goal, step 5b\*\s+and stay in the stage they would be in otherwise/);
  assert.match(s, /`--stage`[\s\S]*steps 1–5 except 5b/);
});

test('prd staging: a leftover is proposed, never cut: it stays in its stage until the owner\'s record', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\| \*\*In the primary picture\?\*\* \|/);
  assert.match(s, /A proposal is not a cut: the requirement stays in the\s+stage it would be in otherwise/);
  assert.match(s, /It moves to Explicitly not doing only with the owner's\s+record, cited/);
  assert.match(s, /\(\*yes, precondition\*\)/);
  assert.match(s, /means the breath is wrong: fix the breath/);
  // 6.3 and the exit criteria carry the same rules (review M5, M7)
  assert.match(s, /- That every item under the brief's \*\*What must survive\*\* in the owner's words is in the MVP \(an \*\*assumed\*\* item is listed for the owner, not enforced\)/);
  assert.match(s, /each proposed for not doing stays in its stage until the owner's record/);
  const t = read('templates/prioritization.md');
  assert.match(t, /^\| FR \| Personas served \|.*\| In the primary picture\? \|$/m);
  assert.match(t, /no: proposed for not doing \/ proposed non-goal, step 5b \|/);
  assert.match(t, /\| FR \| Reason \| Owner's record \(required\) \| Revisit if \|/);
});

test('storyboard: approved only in the owner\'s quoted words; reopened by a change to the journey, the MVP or the proposition only', () => {
  const s = read('skills/prd/SKILL.md');
  assert.match(s, /\*\*quoted word for word\*\*[\s\S]*with no message to quote, it is not approved\. Approval is never\s+assumed/);
  assert.match(s, /A fix that changes none of these \(an edge path, a criterion's wording, a number\) does not\./);
  assert.match(s, /- `storyboard\.md` written, and its approval either quoted word for word or marked not approved/);
  const t = read('templates/storyboard.md');
  assert.match(t, /\*\*Their words, quoted exactly:\*\*/);
  assert.match(t, /or the owner waives it in words the roadmap quotes/);
  const r = read('skills/roadmap/SKILL.md');
  assert.match(r, /- \*\*Storyboard not approved\*\* — stop\./);
  assert.match(r, /Only the owner may waive it, in words you quote[\s\S]*a role never does, and silence is not approval/);
  assert.match(r, /never leave it out of the plan on the team's word/);
  assert.match(r, /\*\*Reopened on an initiative\s+already planned\*\*[\s\S]*— not a stop: revise the roadmap, mark each phase/);
  assert.match(r, /- \*\*Proposed for not doing, or a proposed non-goal \(step 5b\), unanswered\*\* — not a stop\./);
  assert.match(r, /whatever the PRD's out of\s+scope list says about it/);
  assert.match(s, /Put every open shape proposal in the same message, each with a\s+recommended answer, so one reply can settle them all: the lens questions still open, the assumed\s+what-must-survive items, the step 5b non-goals and the requirements proposed for not doing\./);
  assert.match(s, /`--stage` never edits `prd\.md`/);
  assert.match(s, /with "the PRD needs a\s+revise" in the hand-off/);
  assert.match(s, /\(the stage its scores give it as if it were in the picture\)/);
  const g = read('skills/realign/SKILL.md');
  assert.match(g, /If the journey the\s+storyboard's cards tell, the MVP's `FR-n` list or the proposition changes, the storyboard\s+\(`storyboard\.md`\) is reopened/);
  assert.match(g, /Re-staging keeps `\/delivery:prd`'s staging rules: what must survive in the owner's words stays in\s+the MVP unless the owner's record says otherwise[\s\S]*kept in its\s+stage until the owner's record/);
  assert.match(g, /put it to the owner with every open\s+proposal in the same message, as `\/delivery:prd` step 6\.7 says/);
  assert.match(g, /marks the phases it affects "storyboard reopened: awaiting the owner" and does\s+not stop/);
  assert.match(read('skills/status/SKILL.md'), /\| PRD: storyboard approved by the owner \|/);
});

test('planned before the methods: a brief with no lens section is flagged, never stopped', () => {
  const r = read('skills/roadmap/SKILL.md');
  assert.match(r, /\*\*Planned before this gate:\*\* an initiative whose brief has no \*Owner lens and what must survive\*\s+section[\s\S]*Do not stop it/);
  const p = read('skills/prd/SKILL.md');
  assert.match(p, /\*\*Written before the owner's lens\*\*[\s\S]*not thin: proceed\. What must survive is taken only from the owner's words the brief\s+quotes/);
});

test('no shape text lets the team drop, cut or default out scope on its own word (review M6)', () => {
  for (const f of SHAPE) {
    const s = read(f).replace(/\s+/g, ' ');
    assert.doesNotMatch(s, /\b(the team|a role|we) (drops?|cuts?|removes?|excludes?)\b/i, f);
    assert.doesNotMatch(s, /\bdefaults? (out|to \*?Explicitly not doing)/i, `${f}: a leftover is proposed, never defaulted out`);
    assert.doesNotMatch(s, /if the owner (has not answered|does not answer|is silent)[^.]*\b(drop|cut|exclude|not doing)/i, f);
  }
});

test('NOTICE: every ported method names its source; the source and its copyright line are in NOTICE', () => {
  const n = read('NOTICE');
  for (const [repo, holder] of [['amplifier-skill-taste', 'Taste × Elegance contributors'], ['amplifier-skill-sizzle', 'Sizzle contributors'], ['amplifier-skill-market-fit', 'Market Fit contributors']]) {
    assert.match(n, new RegExp(`${repo} \\(https://github\\.com/michaeljabbour/${repo}\\)\\n  Copyright \\(c\\) 2026 ${holder}\\. MIT License\\.`));
  }
  assert.match(n, /its "cut" adapted\s+here into proposed non-goals the owner decides/);
  for (const f of ['skills/brief/SKILL.md', 'skills/prd/SKILL.md', 'skills/roadmap/SKILL.md', 'templates/storyboard.md']) assert.match(read(f), /michaeljabbour/, f);
});
