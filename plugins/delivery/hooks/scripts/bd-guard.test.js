// hooks/scripts/bd-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBd, decideBd } = require('./bd-guard.js');

const NOW = '2026-10-12T12:00:00Z';
const fakeBd = (beads) => ({ show: (id) => beads[id] || null });

test('parseBd reads subcommand, id and flags', () => {
  const p = parseBd('bd update ex-1 --claim');
  assert.equal(p.sub, 'update'); assert.equal(p.id, 'ex-1'); assert.equal(p.flags.get('--claim'), true);
  const c = parseBd('bd close ex-2 --reason "EVIDENCE: shipped"');
  assert.equal(c.sub, 'close'); assert.equal(c.flags.get('--reason'), 'EVIDENCE: shipped');
  assert.equal(parseBd('bd dep add ex-1 --blocked-by ex-2').sub, 'dep add');
  assert.equal(parseBd('git status'), null);
});

test('parseBd handles two-word subcommands, equals form, short flags and leading --claim', () => {
  const d = parseBd('bd dep add ex-1 --blocked-by ex-2');
  assert.equal(d.id, 'ex-1'); assert.equal(d.flags.get('--blocked-by'), 'ex-2');
  assert.equal(parseBd('bd label add ex-1 urgent').sub, 'label add');
  assert.equal(parseBd('bd comments add ex-1 "hi"').sub, 'comments add');
  assert.equal(parseBd('bd close ex-1 --reason="EVIDENCE: x"').flags.get('--reason'), 'EVIDENCE: x');
  assert.equal(parseBd('bd close ex-1 -r "EVIDENCE: x"').flags.get('-r'), 'EVIDENCE: x');
  const c = parseBd('bd update --claim ex-1');
  assert.equal(c.id, 'ex-1'); assert.equal(c.flags.get('--claim'), true);
  assert.equal(parseBd('FOO=1 bd close ex-1'), null);
  assert.equal(parseBd('env bd close ex-1'), null);
});

test('close requires an EVIDENCE reason', () => {
  const bd = fakeBd({});
  assert.match(decideBd({ command: 'bd close ex-1 --reason "done"', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.match(decideBd({ command: 'bd close ex-1', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.equal(decideBd({ command: 'bd close ex-1 --reason "EVIDENCE: shipped in PR 3"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd close ex-1 --reason="EVIDENCE: shipped"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd close ex-1 -r "EVIDENCE: shipped"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.match(decideBd({ command: 'echo hi && bd close ex-1 --reason "evidence: x"', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
});

test('claim on a live holder is refused, stale or own claims pass', () => {
  const beads = {
    'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T11:30:00Z' },
    'ex-2': { id: 'ex-2', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T08:00:00Z' },
    'ex-3': { id: 'ex-3', status: 'open', assignee: '', updated_at: '2026-10-12T11:59:00Z' },
  };
  const bd = fakeBd(beads);
  const me = 'me@pc/builder-1';
  assert.match(decideBd({ command: 'bd update ex-1 --claim', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by bob@pc\/builder-2/);
  assert.equal(decideBd({ command: 'bd update ex-2 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-3 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'bob@pc/builder-2', staleHours: 2, bd, now: NOW }), null);
  assert.match(decideBd({ command: 'bd update ex-1 --status open --assignee ""', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by/);
});

test('a lookup that throws, or an unknown bead, allows', () => {
  const boom = { show: () => { throw new Error('bd down'); } };
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'a', staleHours: 2, bd: boom, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-9 --claim', actor: 'a', staleHours: 2, bd: fakeBd({}), now: NOW }), null);
});
