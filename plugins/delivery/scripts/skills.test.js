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
// An alias is a skill kept for one version after a rename or cut: its description starts with
// "Renamed" or "Removed" and its body is one line pointing at where the work went.
const isAlias = (text) => /^description: (?:Renamed|Removed)\b/m.test(text);
const ALIASES = { interview: 'simulate', handoff: 'sprint', prioritize: 'prd', join: 'team', glossary: null };

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
  for (const { name, text } of skills.filter((s) => !isAlias(s.text))) {
    assert.match(text, /> \*\*Context integrity\.\*\* This skill's full text must be in context while you execute/, name);
    assert.match(text, /re-invoke (?:it|the skill) with the Skill tool before acting/, name);
  }
});

test('skills: every conventions pointer resolves to a section that exists', () => {
  const headings = new Set([...CONVENTIONS.matchAll(/^## (.+)$/gm)].map((m) => m[1]));
  let pointers = 0;
  for (const { name, text } of skills.filter((s) => !isAlias(s.text))) {
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

test('aliases: each renamed or cut skill is a short pointer to where the work went', () => {
  for (const [alias, target] of Object.entries(ALIASES)) {
    const s = skills.find((k) => k.name === alias);
    assert.ok(s, `alias ${alias} kept for one version`);
    assert.ok(isAlias(s.text), `${alias} is marked Renamed or Removed`);
    assert.ok(s.text.trim().split('\n').length <= 7, `${alias} is at most 7 lines`);
    // an alias is for a person typing the old name: its description is kept out of every session's listing
    assert.match(s.text, /^disable-model-invocation: true$/m, `${alias} is not listed for the model`);
    if (target) {
      assert.ok(s.text.includes(`/delivery:${target}`), `${alias} points to /delivery:${target}`);
      assert.ok(!isAlias(skills.find((k) => k.name === target).text), `${target} is a real skill`);
    } else {
      assert.ok(s.text.includes('**Language**') && s.text.includes('references/conventions.md'), 'glossary points to the conventions Language section');
      assert.ok(CONVENTIONS.includes('### Keeping the glossary'), 'the glossary rules live in the conventions');
    }
  }
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'templates', 'glossary.md')), 'the glossary template remains');
});

test('skills: real skills name only real, non-alias skills', () => {
  const names = new Set(skills.filter((s) => !isAlias(s.text)).map((s) => s.name));
  for (const { name, text } of skills.filter((s) => !isAlias(s.text))) {
    for (const m of text.matchAll(/\/delivery:([a-z][a-z-]*)/g)) assert.ok(names.has(m[1]), `skills/${name} names /delivery:${m[1]}, which is not a real skill`);
  }
  const runners = fs.readFileSync(path.join(SKILLS, 'sprint', 'references', 'runners.md'), 'utf8');
  for (const need of ['## Runner: `superpowers`', '### Mode A', '### Mode B', '## Runner: `generic`', '#### The sufficiency gate']) assert.ok(runners.includes(need), `sprint runners reference keeps ${need}`);
  const simulate = skills.find((s) => s.name === 'simulate').text;
  for (const need of ['.delivery/interviews/', '.delivery/simulations/', '--interview', '--journey', 'SIMULATED PERSONA OUTPUT', 'SIMULATED OUTPUT']) assert.ok(simulate.includes(need), `simulate keeps ${need}`);
  const prd = skills.find((s) => s.name === 'prd').text;
  for (const need of ['prioritization.md', '--stage', 'Evidence-only']) assert.ok(prd.includes(need), `prd keeps ${need}`);
});
