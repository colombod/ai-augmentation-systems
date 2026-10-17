// scripts/skills.test.js — the skills share one conventions file instead of repeating it, every
// skill keeps its own context-integrity line, and every plugin path a skill names exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..');
const SKILLS = path.join(PLUGIN_ROOT, 'skills');
const CONVENTIONS = fs.readFileSync(path.join(PLUGIN_ROOT, 'references', 'conventions.md'), 'utf8');
const skills = fs.readdirSync(SKILLS)
  .filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md')))
  .map((d) => ({ name: d, text: fs.readFileSync(path.join(SKILLS, d, 'SKILL.md'), 'utf8') }));

// One sentence from each block that lives only in references/conventions.md.
const EXTRACTED = [
  'An existing `.delivery/` anywhere reachable from the working directory wins',
  'If `.delivery/initiatives/` has exactly one subdirectory, use it',
  'A blocking finding is one a reviewer said must be resolved before this point',
  'Questions go out in the vocabulary of whoever must answer them',
  'Rows in a data table can never help you meet the budget',
  'Compose first. Do not try to hit the budget while writing.',
];

test('conventions: every extracted block is in references/conventions.md', () => {
  for (const s of EXTRACTED) assert.ok(CONVENTIONS.includes(s), s);
});

test('skills: no skill repeats a block that lives in the conventions file', () => {
  for (const { name, text } of skills) {
    for (const s of EXTRACTED) assert.ok(!text.includes(s), `skills/${name} repeats "${s}"; point to references/conventions.md instead`);
  }
});

test('skills: every skill keeps its context-integrity line', () => {
  for (const { name, text } of skills) {
    assert.match(text, /> \*\*Context integrity\.\*\* This skill's full text must be in context while you execute/, name);
    assert.match(text, /re-invoke (?:it|the skill) with the Skill tool before acting/, name);
  }
});

test('skills: every conventions pointer resolves to a section that exists', () => {
  const headings = new Set([...CONVENTIONS.matchAll(/^## (.+)$/gm)].map((m) => m[1]));
  let pointers = 0;
  for (const { name, text } of skills) {
    if (!text.includes('references/conventions.md')) continue;
    pointers++;
    assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/references/conventions.md'), `${name} names the conventions through the plugin root`);
    assert.ok(text.includes('installed_plugins.json'), `${name} says what to do when the plugin root is empty`);
    const line = text.split('\n').find((l) => l.startsWith('Its sections '));
    assert.ok(line, `${name} names the conventions sections it uses`);
    for (const m of line.matchAll(/\*\*([^*]+)\*\*/g)) assert.ok(headings.has(m[1]), `${name} points to "${m[1]}", which conventions.md does not have`);
  }
  assert.ok(pointers >= 12, `only ${pointers} skills point to the conventions`);
});

test('skills: every ${CLAUDE_PLUGIN_ROOT} path a skill names exists in the plugin', () => {
  for (const { name, text } of skills) {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      const rel = m[1].replace(/[.,;:]+$/, '');
      assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, rel)), `skills/${name} names \${CLAUDE_PLUGIN_ROOT}/${rel}, which does not exist`);
    }
  }
});
