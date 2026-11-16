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
  assert.deepEqual(d.calls, ['GET /api/services/local', 'POST /api/services'], 'read before register');
  assert.ok(d.names()[HM], 'kept on the local list of the names the plugin registered');
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
  assert.match(SD.register(HM, { fetch: s.fetch, entries: [] }).why, /answered 409 .*static service name/);
  assert.deepEqual(s.names(), {}, 'a refused registration is not on the list');
  const down = fakeDirectory({ down: true });
  assert.match(SD.register(HM, { fetch: down.fetch }).why, /could not be reached \(connect ECONNREFUSED 127\.0\.0\.1:8085\)/);
  assert.match(SD.register(HM, { fetch: () => { throw new Error('boom'); } }).why, /could not be reached \(boom\)/);
});

// POST upserts by name: a registration that did not read first would make another owner's entry the plugin's
test('registration reads first: a free name is posted; a name another owner holds is never posted, is left as it is and is said', () => {
  const free = fakeDirectory({ entries: [{ name: 'muxplex', url: 'http://x', owner: 'colombod' }] });
  assert.deepEqual(SD.register(HM, { fetch: free.fetch }), { ok: true });
  assert.equal(free.entry(HM).owner, 'delivery plugin');
  const held = fakeDirectory({ entries: [{ ...SD.entryFor(HM), owner: 'colombod', url: 'systemd-user://mine' }] });
  const g = SD.register(HM, { fetch: held.fetch });
  assert.equal(g.ok, false);
  assert.equal(g.held, 'colombod');
  assert.match(g.why, /lists delivery-host-manager\.service as owned by "colombod", not by the delivery plugin, so the plugin leaves that entry as it is/);
  assert.deepEqual(held.calls, ['GET /api/services/local'], 'no POST for it');
  assert.deepEqual([held.entry(HM).owner, held.entry(HM).url], ['colombod', 'systemd-user://mine'], 'the entry is unchanged');
  assert.deepEqual(held.names(), {}, 'not on the plugin\'s list');
  // a read the caller made just now is used, not read again; a directory that cannot be read posts nothing
  const pre = fakeDirectory();
  assert.equal(SD.register(HM, { fetch: pre.fetch, entries: [{ name: HM, owner: 'someone' }] }).held, 'someone');
  assert.deepEqual(pre.calls, []);
  const down = fakeDirectory({ down: true });
  assert.match(SD.register(HM, { fetch: down.fetch }).why, /could not be reached/);
  assert.deepEqual(down.calls, ['GET /api/services/local']);
});

test('removal: a plugin entry is deleted, and one already gone counts as removed', () => {
  const d = fakeDirectory({ entries: [SD.entryFor(HM)] });
  SD.remember(HM, { fetch: d.fetch });
  assert.deepEqual(SD.remove(HM, { fetch: d.fetch }), { ok: true });
  assert.equal(d.entry(HM), null);
  assert.deepEqual(d.names(), {}, 'the plugin forgets a name whose entry it removed');
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
  assert.deepEqual(gone.calls, [`POST /api/services/${HM}/heartbeat`, 'GET /api/services/local', 'POST /api/services']);
  assert.ok(gone.entry(HM));
  // an entry the plugin registered an hour and more ago with no heartbeat since expired: registered again
  const expired = fakeDirectory({ registered: [HM], registeredAt: '2026-11-16T08:00:00Z' });
  assert.deepEqual(SD.heartbeat(HM, { fetch: expired.fetch, now: '2026-11-16T09:30:00Z' }), { ok: true, registered: true });
  // one it registered within the ttl that is gone was removed by someone: not registered again
  const removed = fakeDirectory({ registered: [HM], registeredAt: '2026-11-16T09:00:00Z' });
  const h = SD.heartbeat(HM, { fetch: removed.fetch, now: '2026-11-16T09:30:00Z' });
  assert.equal(h.ok, false);
  assert.equal(h.removed, true);
  assert.match(h.why, /the entry the delivery plugin registered for delivery-host-manager\.service was removed from the service directory, so the owner may have taken the unit out of the plugin's hands; it is not registered again/);
  assert.ok(!removed.calls.includes('POST /api/services'));
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
  assert.ok(m.names()[HM], 'and put on the local list');
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
  for (const u of ['claude-rc-cos.service', 'delivery-role-x.socket', 'service-directory.service']) assert.ok(!SD.isPluginUnit(u), u);
});

// The watchdog's host job units are the plugin's too (watchdog.js jobFiles); a lookalike name is not.
test('the watchdog job\'s service, timer and path units are plugin units; a lookalike is not', () => {
  for (const u of ['delivery-watchdog-0a1b2c3d.service', 'delivery-watchdog-0a1b2c3d.timer', 'delivery-watchdog-f9e11c68.path']) {
    assert.ok(SD.isPluginUnit(u), u);
    assert.match(SD.describe(u), /the watchdog's host job/, u);
  }
  for (const u of ['delivery-watchdogfoo.service', 'delivery-watchdog-.service', 'delivery-watchdog-0A1B.service', 'delivery-watchdog-0a1b2c3d.socket', 'delivery-watchdog-0a1b2c3d.scope', 'some-other.service', 'x-delivery-watchdog-0a1b2c3d.service']) assert.ok(!SD.isPluginUnit(u), u);
  const d = fakeDirectory();
  assert.deepEqual(SD.beforeChange('delivery-watchdog-0a1b2c3d.timer', { action: 'restart', fetch: d.fetch }), { ok: true });
  assert.equal(d.entry('delivery-watchdog-0a1b2c3d.timer').owner, 'delivery plugin');
});

// Decision (a): the plugin keeps the names it registered. A missing entry it never registered is
// registered; one it registered that someone removed within its ttl is not: the owner may have taken the
// unit out of the plugin's hands.
test('read before change: a missing entry the plugin registered and someone removed is refused and not registered again; one it never registered, or that expired, is registered', () => {
  const removed = fakeDirectory({ registered: [HM], registeredAt: '2026-11-16T09:00:00Z' });
  for (const action of ['start', 'stop', 'restart', 'replace']) {
    const r = SD.beforeChange(HM, { action, running: action !== 'start', fetch: removed.fetch, now: '2026-11-16T09:20:00Z' });
    assert.equal(r.ok, false, action);
    assert.equal(r.removed, true, action);
    assert.match(r.why, new RegExp(`the entry the delivery plugin registered for delivery-host-manager\\.service was removed from the service directory, so the owner may have taken the unit out of the plugin's hands; it is not registered again, and the plugin does not ${action} it`));
  }
  assert.ok(!removed.calls.includes('POST /api/services'), 'never posted');
  assert.equal(removed.entry(HM), null);
  // never registered by the plugin: registered, read again, allowed
  const never = fakeDirectory({ registered: ['delivery-host-manager-tick.timer'], registeredAt: '2026-11-16T09:00:00Z' });
  assert.deepEqual(SD.beforeChange(HM, { action: 'restart', fetch: never.fetch, now: '2026-11-16T09:20:00Z' }), { ok: true });
  assert.ok(never.calls.includes('POST /api/services'));
  // registered over an hour before with no heartbeat since: it expired with its ttl, so it is registered again
  const expired = fakeDirectory({ registered: [HM], registeredAt: '2026-11-16T08:00:00Z' });
  assert.deepEqual(SD.beforeChange(HM, { action: 'restart', fetch: expired.fetch, now: '2026-11-16T09:20:00Z' }), { ok: true });
  assert.equal(expired.entry(HM).owner, 'delivery plugin');
  assert.equal(expired.names()[HM].at, '2026-11-16T09:20:00.000Z', 'its time on the list is the new registration');
});

test('the local list lives under the home it is given, and in the sealed run never under the real home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-home-'));
  assert.equal(SD.namesFile({ env: {}, home }), path.join(home, '.local', 'state', 'delivery', 'host-manager', 'directory-names.json'));
  assert.equal(SD.namesFile({ env: { XDG_STATE_HOME: path.join(home, 's') }, home }), path.join(home, 's', 'delivery', 'host-manager', 'directory-names.json'));
  assert.ok(SD.namesFile({ env: { DELIVERY_SEAL_ACTIVE: '1' } }).startsWith(os.tmpdir()), 'sealed with no home: the private /tmp');
  const d = fakeDirectory();
  assert.equal(SD.namesFile({ fetch: d.fetch, home }), d.fetch.namesFile, 'a fake directory carries its own');
  SD.remember(HM, { env: {}, home, now: '2026-11-16T09:00:00Z' });
  assert.deepEqual(SD.registeredNames({ env: {}, home }), { [HM]: { at: '2026-11-16T09:00:00.000Z', ttl: 3600 } });
});

// a directory that hangs costs one wait per pass, not one per request
test('one pass\'s requests: after the first that cannot reach the directory, the rest answer the same without asking it', () => {
  const d = fakeDirectory({ down: true });
  const f = SD.passFetch(d.fetch);
  assert.equal(f.namesFile, d.fetch.namesFile);
  assert.match(SD.local({ fetch: f }).unreadable, /could not be reached/);
  assert.match(SD.register(HM, { fetch: f, entries: [] }).why, /could not be reached \(connect ECONNREFUSED/);
  assert.match(SD.beforeChange(HM, { action: 'restart', fetch: f }).why, /could not be reached/);
  assert.deepEqual(d.calls, ['GET /api/services/local'], 'asked once');
  const up = fakeDirectory();
  const g = SD.passFetch(up.fetch);
  SD.local({ fetch: g }); SD.local({ fetch: g });
  assert.equal(up.calls.length, 2, 'a directory that answers is asked each time');
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
