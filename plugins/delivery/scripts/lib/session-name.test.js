// scripts/lib/session-name.test.js — run with: node scripts/testing/run-tests.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SN = require('./session-name.js');

test('a session is named <instance>@<team>; the team is the prefix without a trailing "-"', () => {
  assert.equal(SN.sessionName('builder', 'delivery-plugin-planning'), 'builder@delivery-plugin-planning');
  assert.equal(SN.sessionName('builder', 'delivery-plugin-planning-'), 'builder@delivery-plugin-planning');
  assert.equal(SN.sessionName('chief-of-staff', 'alpha'), 'chief-of-staff@alpha');
  assert.notEqual(SN.sessionName('chief-of-staff', 'alpha'), SN.sessionName('chief-of-staff', 'beta'));
  assert.equal(SN.sessionName('builder', null), 'builder');
});

test('a name reads back to its instance and prefix; a trailing [ref] is ignored', () => {
  assert.deepEqual(SN.parseSessionName('builder-2@alpha'), { instance: 'builder-2', prefix: 'alpha' });
  assert.deepEqual(SN.parseSessionName('builder-2@alpha [ex-1]'), { instance: 'builder-2', prefix: 'alpha' });
  assert.deepEqual(SN.parseSessionName(' chief-of-staff '), { instance: 'chief-of-staff', prefix: null });
  assert.deepEqual(SN.parseSessionName('@alpha'), { instance: '@alpha', prefix: null });
  assert.deepEqual(SN.parseSessionName('builder@'), { instance: 'builder@', prefix: null });
  assert.equal(SN.samePrefix('alpha-', 'alpha'), true);
  assert.equal(SN.samePrefix('alpha', 'beta'), false);
  assert.equal(SN.samePrefix('', ''), false);
});
