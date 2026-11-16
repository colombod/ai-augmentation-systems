// scripts/lib/service-directory.test.js — run through scripts/testing/run-tests.js
// The plugin's units in the owner's service directory (dec-chief-of-staff-000485): each is registered as
// the plugin's own, kept fresh by heartbeats, removed when gone, and read before any start, stop or restart.
// Every request goes to a fake directory: no test opens a socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SD = require('./service-directory.js');
const { fakeDirectory } = require('../testing/fake-service-directory.js');

const HM = 'delivery-host-manager.service';

test('registration: a plugin unit is posted as the plugin\'s own entry, with a url naming the unit and a ttl', () => {
  const d = fakeDirectory();
  assert.deepEqual(SD.register(HM, { fetch: d.fetch }), { ok: true });
  assert.deepEqual(d.calls, ['POST /api/services']);
  const e = d.entry(HM);
  assert.equal(e.owner, 'delivery plugin');
  assert.equal(e.url, `systemd-user://${HM}`);
  assert.equal(e.category, 'delivery');
  assert.deepEqual(e.tags, ['systemd-user', 'delivery']);
  assert.equal(e.ttl, 3600);
  assert.match(e.description, /host manager/);
  assert.ok(!('port' in e), 'never a network port');
  // a static name, or a directory that cannot be reached: not registered, said why, never thrown
  const s = fakeDirectory({ statics: [HM] });
  assert.match(SD.register(HM, { fetch: s.fetch }).why, /answered 409 .*static service name/);
  const down = fakeDirectory({ down: true });
  assert.match(SD.register(HM, { fetch: down.fetch }).why, /could not be reached \(connect ECONNREFUSED 127\.0\.0\.1:8085\)/);
  assert.match(SD.register(HM, { fetch: () => { throw new Error('boom'); } }).why, /could not be reached \(boom\)/);
});

test('removal: a plugin entry is deleted, and one already gone counts as removed', () => {
  const d = fakeDirectory({ entries: [SD.entryFor(HM)] });
  assert.deepEqual(SD.remove(HM, { fetch: d.fetch }), { ok: true });
  assert.equal(d.entry(HM), null);
  assert.deepEqual(SD.remove(HM, { fetch: d.fetch }), { ok: true }, '404 is removed');
  assert.match(SD.remove(HM, { fetch: fakeDirectory({ statics: [HM] }).fetch }).why, /answered 403/);
  assert.deepEqual(d.calls, [`DELETE /api/services/${HM}`, `DELETE /api/services/${HM}`]);
});

test('heartbeat: a registered entry is refreshed; an expired or missing one is registered again', () => {
  const d = fakeDirectory({ entries: [SD.entryFor(HM)] });
  assert.deepEqual(SD.heartbeat(HM, { fetch: d.fetch }), { ok: true });
  assert.equal(d.beats[HM], 1);
  const gone = fakeDirectory();
  assert.deepEqual(SD.heartbeat(HM, { fetch: gone.fetch }), { ok: true, registered: true });
  assert.deepEqual(gone.calls, [`POST /api/services/${HM}/heartbeat`, 'POST /api/services']);
  assert.ok(gone.entry(HM));
  assert.match(SD.heartbeat(HM, { fetch: fakeDirectory({ down: true }).fetch }).why, /could not be reached/);
});

test('read before change: allowed for the plugin\'s own entry; a missing one is registered and read again; another owner or a unit the plugin did not write is refused', () => {
  const d = fakeDirectory({ entries: [SD.entryFor(HM)] });
  assert.deepEqual(SD.beforeChange(HM, { action: 'restart', fetch: d.fetch }), { ok: true });
  assert.deepEqual(d.calls, ['GET /api/services/local']);
  // missing: registered, then read again
  const m = fakeDirectory();
  assert.deepEqual(SD.beforeChange(HM, { action: 'restart', fetch: m.fetch }), { ok: true });
  assert.deepEqual(m.calls, ['GET /api/services/local', 'POST /api/services', 'GET /api/services/local']);
  // missing, and its registration refused: refused
  const refusing = (method) => (method === 'POST' ? { status: 409, body: { detail: 'static' } } : { status: 200, body: [] });
  assert.match(SD.beforeChange(HM, { fetch: refusing }).why, /has no entry in the service directory, and registering it failed: the service directory answered 409/);
  // another owner
  const o = fakeDirectory({ entries: [{ ...SD.entryFor(HM), owner: 'colombod' }] });
  assert.match(SD.beforeChange(HM, { action: 'restart', fetch: o.fetch }).why, /lists delivery-host-manager\.service as owned by "colombod", not by the delivery plugin, so the plugin does not restart it/);
  assert.ok(!o.calls.includes('POST /api/services'), 'another owner\'s entry is never overwritten');
  // a unit the plugin did not write: refused before any request
  const h = fakeDirectory();
  assert.match(SD.beforeChange('claude-rc-cos.service', { action: 'restart', fetch: h.fetch }).why, /is not a unit the delivery plugin writes/);
  assert.deepEqual(h.calls, []);
  for (const u of [HM, 'delivery-host-manager-tick.service', 'delivery-host-manager-tick.timer', 'delivery-role-chief-of-staff-0a1b2c3d.service', 'delivery-role-builder-2-123.scope']) assert.ok(SD.isPluginUnit(u), u);
  for (const u of ['claude-rc-cos.service', 'delivery-watchdog-0a1b.service', 'delivery-role-x.socket', 'service-directory.service']) assert.ok(!SD.isPluginUnit(u), u);
});

test('read before change with the directory unreachable: a stop, restart or replace of a running unit is refused; a start of a plugin unit that is down goes ahead with a row and a warning; a hand-written unit is refused', () => {
  const down = fakeDirectory({ down: true });
  const seen = [];
  const onUnreachable = (x) => seen.push(x);
  for (const action of ['restart', 'stop', 'replace']) {
    const r = SD.beforeChange(HM, { action, running: true, fetch: down.fetch, onUnreachable });
    assert.equal(r.ok, false, action);
    assert.match(r.why, new RegExp(`could not be reached .*a ${action} of a running unit is not made without reading its entry there first`));
  }
  assert.equal(SD.beforeChange(HM, { action: 'start', running: true, fetch: down.fetch, onUnreachable }).ok, false, 'a start of a running unit is a change to it');
  assert.equal(SD.beforeChange('claude-rc-cos.service', { action: 'start', running: false, fetch: down.fetch, onUnreachable }).ok, false, 'a hand-written unit');
  assert.deepEqual(seen, []);
  const r = SD.beforeChange(HM, { action: 'start', running: false, fetch: down.fetch, onUnreachable });
  assert.equal(r.ok, true);
  assert.match(r.unreachable, /could not be reached/);
  assert.deepEqual(seen.map((x) => [x.unit, x.action]), [[HM, 'start']]);
  // the real recorder: a ledger row and a warning in the project
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-proj-'));
  SD.unreachableRecorder(proj, { now: '2026-11-16T10:00:00Z' })({ unit: HM, action: 'start', why: 'down' });
  assert.deepEqual(require('./team-revive.js').ledger(proj).map((x) => [x.type, x.unit, x.action]), [['directory-unreachable', HM, 'start']]);
  const w = require('./warnings.js').list(proj);
  assert.deepEqual(w.map((x) => [x.kind, x.rule]), [['service-directory-unreachable', 'dec-chief-of-staff-000485']]);
  assert.match(w[0].detail, /delivery-host-manager\.service was started while the service directory could not be read/);
});

test('the default request goes only to 127.0.0.1:8085, and in the sealed test run reaches nothing', () => {
  assert.equal(SD.BASE, 'http://127.0.0.1:8085');
  const r = SD.defaultFetch({ DELIVERY_SEAL_ACTIVE: '1' })('GET', '/api/services/local');
  assert.match(r.error, /sealed test run reaches no service directory/);
  const src = fs.readFileSync(path.join(__dirname, 'service-directory.js'), 'utf8');
  assert.deepEqual([...src.matchAll(/https?:\/\/[^\s'"`]+/g)].map((m) => m[0]), ['http://127.0.0.1:8085'], 'no other address is named');
  assert.match(src, /await fetch\(`\$\{BASE\}\$\{p\}`/, 'the child asks BASE only');
});
