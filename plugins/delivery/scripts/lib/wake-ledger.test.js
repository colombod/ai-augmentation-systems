// scripts/lib/wake-ledger.test.js — the sender's record a wake prompt is told from a typed one by (hb1.2).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./wake-ledger.js');
const { WAKE_OPENING, wakePrompt } = require('./watchdog.js');

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wake-ledger-'));
const AT = '2026-11-04T10:00:00.000Z';
const plus = (ms) => new Date(Date.parse(AT) + ms).toISOString();

test('a recorded wake prompt is a wake; the same opening words with no row are not', () => {
  const root = mk();
  const sent = wakePrompt(['Continue bead x.'], 'did');
  assert.strictEqual(L.record(root, { at: AT, instance: 'builder', session: 'S', wakeId: 'w1', prompts: [sent] }), 1);
  const isWake = L.matcher(root);
  assert.strictEqual(isWake(sent, plus(3000)), true, 'the prompt the watchdog sent');
  assert.strictEqual(isWake(`\n  ${sent}`, plus(3000)), true, 'leading whitespace is not a different prompt');
  assert.strictEqual(isWake(`${WAKE_OPENING}: Continue bead x. Reply in one line with what you did, then merge it.`, plus(3000)), false, 'typed by the operator');
  assert.strictEqual(isWake(`${WAKE_OPENING}: go`, plus(3000)), false);
  // the row holds a hash, never the words, and is git-ignored where it lives
  const body = fs.readFileSync(L.fileOf(root), 'utf8');
  assert.ok(!body.includes('Continue bead x'), body);
  assert.match(body, /"sha256":"[0-9a-f]{64}"/);
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(L.fileOf(root)), '.gitignore'), 'utf8'), '*\n');
});

test('a row stands only for its window: a word-for-word copy typed hours later is the operator\'s', () => {
  const root = mk();
  const sent = wakePrompt(['Continue bead x.'], 'did');
  L.record(root, { at: AT, instance: 'builder', session: 'S', wakeId: 'w1', prompts: [sent] });
  const isWake = L.matcher(root);
  assert.strictEqual(isWake(sent, plus(L.AFTER_MS - 1000)), true);
  assert.strictEqual(isWake(sent, plus(L.AFTER_MS + 60000)), false, 'after the window');
  assert.strictEqual(isWake(sent, plus(-L.BEFORE_MS - 60000)), false, 'long before the row');
  assert.strictEqual(isWake(sent, null), true, 'a record with no stamp: the hash decides');
});

test('no ledger, or another project\'s, holds nothing', () => {
  const root = mk();
  const sent = wakePrompt(['Continue bead x.'], 'did');
  assert.strictEqual(L.matcher(root)(sent, AT), false);
  assert.strictEqual(L.matcher(null)(sent, AT), false);
  const other = mk();
  L.record(other, { at: AT, prompts: [sent] });
  assert.strictEqual(L.matcher(root)(sent, AT), false);
});

test('the rotated ledger is read too', () => {
  const root = mk();
  const sent = wakePrompt(['old one.'], 'did');
  L.record(root, { at: AT, prompts: [sent] });
  fs.renameSync(L.fileOf(root), `${L.fileOf(root)}.1`);
  L.record(root, { at: AT, prompts: [wakePrompt(['new one.'], 'did')] });
  assert.strictEqual(L.matcher(root)(sent, plus(1000)), true);
});

test('a wake logged before the ledger existed (the prompt in its wake log row) is still a wake, also behind a fresh preamble', () => {
  const root = mk();
  const planned = wakePrompt(['Message sent to you while your session was not running: [from delivery-lead: merge] please merge the branch.'], 'did');
  const WD = require('./watchdog.js');
  WD.log(root, { type: 'wake', at: AT, keys: [], instance: 'builder', session: 'S', mode: 'resume', wake_id: 'w0', prompt: planned, pid: 1, log: 'x' });
  const isWake = L.matcher(root);
  assert.strictEqual(isWake(planned, plus(2000)), true);
  const fresh = `${WAKE_OPENING}: You are builder, starting a fresh session: the rest. ${planned.slice(planned.indexOf(':') + 1).trim()}`;
  assert.strictEqual(isWake(fresh, plus(2000)), true);
  assert.strictEqual(isWake(`${WAKE_OPENING}: please merge the branch.`, plus(2000)), false, 'a short tail proves nothing');
  assert.strictEqual(isWake(planned, plus(L.AFTER_MS + 60000)), false);
});
