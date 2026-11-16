// scripts/lib/service-directory.js — the owner's service directory on this machine, for the units the plugin
// writes (owner record dec-chief-of-staff-000485: services on the host are registered with the directory,
// and a service change is reasoned about against it before it is made).
//
// The directory (service-directory, on 127.0.0.1:8085) keeps one entry per service. The plugin registers
// each unit it writes (the host manager's units, a role's own unit, the role scopes its starts create) as a
// dynamic entry with a ttl, owner "delivery plugin" and a url that names the unit, never a network address:
// POST /api/services upserts it, POST /api/services/<name>/heartbeat keeps it fresh while the unit is active
// (the directory's health then reads the heartbeat, not a TCP probe), a scope that ended simply expires, and
// DELETE /api/services/<name> removes an entry whose unit the plugin no longer has. Writes from 127.0.0.1
// pass the directory's localhost bypass, so no token is held or read.
//
// Every request goes through fetch(method, path, body) -> { status, body } | { error }: a test passes its
// own; the default runs one request against 127.0.0.1:8085 in a node child (the plugin's code is
// synchronous), and in the sealed test run it opens no socket at all.

const BASE = 'http://127.0.0.1:8085';
const OWNER = 'delivery plugin';
const CATEGORY = 'delivery';
const TAGS = ['systemd-user', 'delivery'];
// one hour: a heartbeat each watchdog pass (every 15 minutes) keeps an active unit fresh with room to spare
const TTL = 3600;
const TIMEOUT_MS = 4000;
const HM_UNITS = ['delivery-host-manager.service', 'delivery-host-manager-tick.service', 'delivery-host-manager-tick.timer'];
const ROLE_UNIT = /^delivery-role-[a-z0-9][a-z0-9-]*\.(service|scope)$/;

// A unit the plugin writes: the host manager's three, a role's own unit (install-role) and the role scopes
// (lib/team-revive.js scopedCommand). Anything else is not the plugin's to register, start or stop.
const isPluginUnit = (name) => HM_UNITS.includes(String(name)) || ROLE_UNIT.test(String(name));

function describe(unit) {
  if (unit === HM_UNITS[0]) return 'delivery plugin: the host manager\'s Remote Control session (systemd user unit)';
  if (unit === HM_UNITS[1]) return 'delivery plugin: the host manager\'s unattended pass (systemd user unit)';
  if (unit === HM_UNITS[2]) return 'delivery plugin: the timer of the host manager\'s pass, every 5 minutes (systemd user unit)';
  if (/\.scope$/.test(unit)) return 'delivery plugin: a role session started in a scope of its own (systemd user scope)';
  return 'delivery plugin: a role\'s own Remote Control session (systemd user unit)';
}
function entryFor(unit, description) {
  return { name: unit, url: `systemd-user://${unit}`, owner: OWNER, description: description || describe(unit), category: CATEGORY, tags: TAGS, ttl: TTL };
}

// The default request: one node child, bounded, so the synchronous plugin code can wait for it. In the
// sealed test run it does nothing: no test may reach a service on the machine it runs on.
function defaultFetch(env = process.env) {
  return (method, p, body) => {
    if (env.DELIVERY_SEAL_ACTIVE || env.DELIVERY_SEALED_RUN) return { error: 'the sealed test run reaches no service directory' };
    const r = require('child_process').spawnSync(process.execPath, [__filename, method, p], { input: body === undefined ? '' : JSON.stringify(body), encoding: 'utf8', timeout: TIMEOUT_MS + 2000, stdio: ['pipe', 'pipe', 'pipe'] });
    if (r.error || r.status !== 0) return { error: String((r.error && r.error.message) || r.stderr || `exit ${r.status}`).trim().split('\n')[0].slice(0, 200) };
    try { return JSON.parse(r.stdout); } catch (err) { return { error: 'no answer from the request' }; }
  };
}
const first = (x) => String((x && (x.message || x)) || '').trim().split('\n')[0].slice(0, 200);
function call(fetch, method, p, body) {
  let r;
  try { r = (fetch || defaultFetch())(method, p, body); } catch (err) { return { error: first(err) }; }
  if (!r || r.error || !Number.isInteger(r.status)) return { error: (r && r.error) || 'no answer' };
  return r;
}
const why = (r) => (r.error ? `the service directory at ${BASE} could not be reached (${r.error})` : `the service directory answered ${r.status}${r.body && r.body.detail ? ` (${String(r.body.detail).slice(0, 160)})` : ''}`);

// { ok: true } or { ok: false, why }
function register(unit, { fetch, description } = {}) {
  const r = call(fetch, 'POST', '/api/services', entryFor(unit, description));
  return r.status === 200 ? { ok: true } : { ok: false, why: why(r) };
}
// an entry already gone is removed too
function remove(unit, { fetch } = {}) {
  const r = call(fetch, 'DELETE', `/api/services/${encodeURIComponent(unit)}`);
  return r.status === 200 || r.status === 404 ? { ok: true } : { ok: false, why: why(r) };
}
// a heartbeat for an entry that expired or was never registered registers it
function heartbeat(unit, { fetch, description } = {}) {
  const r = call(fetch, 'POST', `/api/services/${encodeURIComponent(unit)}/heartbeat`);
  if (r.status === 200) return { ok: true };
  if (r.status === 404) { const g = register(unit, { fetch, description }); return g.ok ? { ok: true, registered: true } : g; }
  return { ok: false, why: why(r) };
}
// this node's own entries: { entries } or { unreadable }
function local({ fetch } = {}) {
  const r = call(fetch, 'GET', '/api/services/local');
  if (r.status !== 200 || !Array.isArray(r.body)) return { unreadable: why(r.status === 200 ? { status: 200, body: { detail: 'not a list' } } : r) };
  return { entries: r.body };
}
function health({ fetch } = {}) {
  const r = call(fetch, 'GET', '/api/health');
  return r.status === 200 && r.body && typeof r.body === 'object' ? { health: r.body } : { unreadable: why(r) };
}

// Read before change. A start, stop or restart of a unit reads its entry first:
// - not a unit the plugin writes: refused (the plugin never touches a unit it did not write);
// - its entry missing: registered, then read again (a unit installed before the directory rule is not
//   refused for ever); still missing, or owned by anyone but the plugin: refused;
// - the directory cannot be read: a stop, restart or replace of a running unit is refused; a start of a
//   plugin unit that is down goes ahead (after a host restart the directory may come up later than the
//   host manager, and recovery needs no owner step), with a ledger row and a warning, and the next pass
//   that reaches the directory registers it.
// action: 'start' | 'stop' | 'restart' | 'replace'; running: whether the unit runs now (a start of a
// running unit is a change to it). onUnreachable({ unit, action, why }) records the row and the warning.
// -> { ok: true } | { ok: true, unreachable: why } | { ok: false, why }
function beforeChange(unit, { action = 'restart', running = true, fetch, onUnreachable } = {}) {
  if (!isPluginUnit(unit)) return { ok: false, why: `${unit} is not a unit the delivery plugin writes, so the plugin does not ${action} it` };
  let l = local({ fetch });
  if (l.unreadable) {
    if (action === 'start' && !running) {
      try { if (onUnreachable) onUnreachable({ unit, action, why: l.unreadable }); } catch (err) { /* the start still goes ahead */ }
      return { ok: true, unreachable: l.unreadable };
    }
    return { ok: false, why: `${l.unreadable}, and a ${action} of a running unit is not made without reading its entry there first` };
  }
  let e = l.entries.find((x) => x && x.name === unit);
  if (!e) {
    const g = register(unit, { fetch });
    if (!g.ok) return { ok: false, why: `${unit} has no entry in the service directory, and registering it failed: ${g.why}` };
    l = local({ fetch });
    e = l.entries ? l.entries.find((x) => x && x.name === unit) : null;
    if (!e) return { ok: false, why: `${unit} has no entry in the service directory, even after registering it${l.unreadable ? ` (${l.unreadable})` : ''}` };
  }
  if (e.owner !== OWNER) return { ok: false, why: `the service directory lists ${unit} as ${e.owner ? `owned by "${String(e.owner).slice(0, 80)}"` : 'with no owner'}, not by the ${OWNER}, so the plugin does not ${action} it` };
  return { ok: true };
}

// The ledger row and the warning for a start made while the directory could not be read.
function unreachableRecorder(root, { now, raisedBy = 'host job' } = {}) {
  return ({ unit, action, why: w }) => {
    require('./team-revive.js').record(root, { type: 'directory-unreachable', at: now || new Date().toISOString(), unit, action, why: w });
    require('./warnings.js').record(root, { kind: 'service-directory-unreachable', rule: 'dec-chief-of-staff-000485', detail: `${unit} was started while the service directory could not be read; the next pass that reaches it registers the unit`, raisedBy });
  };
}

module.exports = { BASE, OWNER, CATEGORY, TAGS, TTL, HM_UNITS, isPluginUnit, entryFor, describe, defaultFetch, register, remove, heartbeat, local, health, beforeChange, unreachableRecorder };

// The child the default fetch runs: one request, its status and JSON body on stdout.
if (require.main === module) {
  const [method, p] = process.argv.slice(2);
  let input = '';
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', async () => {
    try {
      const res = await fetch(`${BASE}${p}`, { method, headers: input ? { 'Content-Type': 'application/json' } : {}, body: input || undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch (err) { body = null; }
      process.stdout.write(JSON.stringify({ status: res.status, body }));
    } catch (err) { process.stdout.write(JSON.stringify({ error: first(err && err.cause ? err.cause : err) })); }
  });
}
