// scripts/lib/first-turn.test.js — the first turn every started or woken role session is given
// (hjx.1.6.12 criteria 1 and 2): it reads its in-progress beads, bd ready and its messages, continues,
// and with nothing held takes the next ready item or says Blocked: with the reason.
require('../testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const FT = require('./first-turn.js');
const WD = require('./watchdog.js');

test('the first turn reads in-progress beads, then bd ready, then messages, in that order', () => {
  const t = FT.FIRST_TURN;
  const inProgress = t.indexOf('--status in_progress');
  const ready = t.indexOf('bd ready');
  const messages = t.indexOf('messages');
  assert.ok(inProgress >= 0 && ready > inProgress && messages > ready, t);
});

test('the first turn says continue what you hold, and with nothing held take the next ready item or note Blocked:', () => {
  assert.match(FT.FIRST_TURN, /Continue what you hold/);
  assert.match(FT.FIRST_TURN, /Holding nothing, take the next ready item/);
  assert.match(FT.FIRST_TURN, /bd update <id> --claim/);
  assert.match(FT.FIRST_TURN, /starts "Blocked:"/);
  // the old idle wording only asked the role to look and report, which left it idle (dec-chief-of-staff-000383)
  assert.doesNotMatch(FT.FIRST_TURN, /say what you could take/);
});

test('every watchdog wake prompt carries the first turn, after the opening and before the reply line', () => {
  const p = WD.wakePrompt(['ex-a is assigned to you and waiting (open).'], 'did');
  assert.ok(p.startsWith(`${WD.WAKE_OPENING}: `), 'the opening stays first: transcript.js tells a wake from a typed prompt by it');
  const at = p.indexOf(FT.FIRST_TURN);
  assert.ok(at > p.indexOf('ex-a is assigned'), p);
  assert.ok(p.endsWith('Reply in one line with what you did.'), p);
});
