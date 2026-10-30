// scripts/usefulness.test.js — run with: node --test scripts/usefulness.test.js
// MJ's Worth Using, in sprint review (owner's ask, 2026-10-24: know when and how to delete a feature)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('sprint review fills a usefulness card per area and names the retirement rule', () => {
  const review = read('skills/sprint-review/SKILL.md');
  assert.match(review, /\$\{CLAUDE_PLUGIN_ROOT\}\/references\/usefulness\.md/);
  assert.match(review, /map\.js retire <feature>/);
  const ref = read('references/usefulness.md');
  for (const c of ['Job', 'First value', 'Fit', 'Outcome', 'Trust', 'Return']) assert.match(ref, new RegExp(`^\\| ${c} \\|`, 'm'), c);
  assert.match(ref, /Never add them into one score/);
  assert.match(ref, /No logs means instrument the feature\s+first, never retire it/);
  assert.match(ref, /Reality Checker pass on the team's own surface, are Claimed, never Seen/);
  assert.match(ref, /amplifier-skill-worth-using, MIT/, 'the upstream method is credited');
});
