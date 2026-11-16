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
//
// POST upserts by name, so a registration reads this node's entries first: a name the directory lists
// under another owner is never posted (that would make the owner's entry the plugin's), and the caller
// says so. Each name the plugin registers is kept in a local list (names file, under the user's state
// beside the host manager's); the plugin forgets a name when it removes its entry. An entry missing from
// the directory while its name is on that list, and not merely expired with its ttl, was removed by
// someone else: the owner may have taken the unit out of the plugin's hands, so the plugin neither
// registers it again nor changes the unit.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'http://127.0.0.1:8085';
const OWNER = 'delivery plugin';
const CATEGORY = 'delivery';
const TAGS = ['systemd-user', 'delivery'];
// one hour: a heartbeat each watchdog pass (every 15 minutes) keeps an active unit fresh with room to spare
const TTL = 3600;
const TIMEOUT_MS = 4000;
const HM_UNITS = ['delivery-host-manager.service', 'delivery-host-manager-tick.service', 'delivery-host-manager-tick.timer'];
const ROLE_UNIT = /^delivery-role-[a-z0-9][a-z0-9-]*\.(service|scope)$/;
// the watchdog's host job (watchdog.js jobFiles): delivery-watchdog-<tag of the project>.service|.timer|.path
const WATCHDOG_UNIT = /^delivery-watchdog-[0-9a-f]+\.(service|timer|path)$/;

// A unit the plugin writes: the host manager's three, a role's own unit (install-role), the role scopes
// (lib/team-revive.js scopedCommand) and the watchdog's job units. Anything else is not the plugin's to
// register, start or stop.
const isPluginUnit = (name) => HM_UNITS.includes(String(name)) || ROLE_UNIT.test(String(name)) || WATCHDOG_UNIT.test(String(name));
// systemd-run --scope --unit <name> names the unit without its suffix; systemctl lists it as <name>.scope
const scopeName = (unit) => (/\.(scope|service|timer)$/.test(String(unit)) ? String(unit) : `${unit}.scope`);

function describe(unit) {
  if (unit === HM_UNITS[0]) return 'delivery plugin: the host manager\'s Remote Control session (systemd user unit)';
  if (unit === HM_UNITS[1]) return 'delivery plugin: the host manager\'s unattended pass (systemd user unit)';
  if (unit === HM_UNITS[2]) return 'delivery plugin: the timer of the host manager\'s pass, every 5 minutes (systemd user unit)';
  if (WATCHDOG_UNIT.test(unit)) return `delivery plugin: the watchdog's host job, its ${unit.split('.').pop()} unit (systemd user unit)`;
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

// The local list of the names the plugin registered: { <name>: { at, ttl } }, at the last registration
// or heartbeat that succeeded. o.names: the file; a fake directory's fetch carries its own (fetch.namesFile),
// so a test's list lives with its directory; otherwise beside the host manager's state under env/home,
// and in the sealed test run, with no home given, under the run's private /tmp, never the real home.
function namesFile({ names, fetch, env = process.env, home } = {}) {
  if (names) return names;
  if (fetch && fetch.namesFile) return fetch.namesFile;
  if (!home && (env.DELIVERY_SEAL_ACTIVE || env.DELIVERY_SEALED_RUN)) return path.join(os.tmpdir(), `delivery-directory-names-${process.pid}.json`);
  return path.join(require('./host-manager.js').stateDir(env, home || os.homedir()), 'directory-names.json');
}
// the file as written: the names, and LOST_KEY, the time a read found the directory had lost every entry
const LOST_KEY = '@lost_at';
function readList(o) {
  try { const x = JSON.parse(fs.readFileSync(namesFile(o), 'utf8')); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch (err) { return {}; }
}
function registeredNames(o = {}) {
  return Object.fromEntries(Object.entries(readList(o)).filter(([k]) => k !== LOST_KEY));
}
function writeNames(o, names) {
  const f = namesFile(o);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(names, null, 2)}\n`);
  fs.renameSync(tmp, f);
}
const nowMs = (o) => (o.now === undefined ? Date.now() : typeof o.now === 'number' ? o.now : Date.parse(o.now));
// fresh: registered or refreshed within its ttl, so a miss now is not its expiry
function fresh(r, o) {
  if (!r) return false;
  if (r.ttl === null || r.ttl === undefined) return true;
  const at = Date.parse(r.at);
  return !Number.isFinite(at) || nowMs(o) - at <= Number(r.ttl) * 1000;
}
// a scope name whose ttl ran out is dropped as the list is written: a scope's name is never used again
function remember(unit, o = {}) {
  const n = readList(o);
  for (const k of Object.keys(n)) if (k !== LOST_KEY && /\.scope$/.test(k) && !fresh(n[k], o)) delete n[k];
  n[unit] = { at: new Date(nowMs(o)).toISOString(), ttl: TTL };
  writeNames(o, n);
}
function forget(unit, o = {}) { const n = readList(o); if (!(unit in n)) return; delete n[unit]; writeNames(o, n); }
// A directory that lost every entry (its registry reset, or a host restart that left it empty): it reports
// no start time or uptime (GET /api/health and /api/instance-info carry none), so it is read from what it
// lists: every name on the plugin's list that is still fresh is missing, and it lists no entry of the
// plugin's at all. The time of that read is kept on the list (LOST_KEY): a name last seen before it was
// lost, not removed, and is registered again; one registered or refreshed after it is judged as before.
// o.entries: a read of /api/services/local made just now.
function directoryReset(entries, o) {
  if (!Array.isArray(entries)) return false;
  const n = registeredNames(o);
  const live = Object.keys(n).filter((k) => fresh(n[k], o));
  if (!live.length || entries.some((e) => e && e.owner === OWNER)) return false;
  return live.every((k) => !entries.some((e) => e && e.name === k));
}
function lostAt(o) { const t = Date.parse(readList(o)[LOST_KEY]); return Number.isFinite(t) ? t : null; }
function markLost(o) { try { const n = readList(o); n[LOST_KEY] = new Date(nowMs(o)).toISOString(); writeNames(o, n); } catch (err) { /* read again next time */ } }
// An entry missing although the plugin registered it, and too recent to have expired with its ttl: removed
// by someone else, unless it was last seen before the directory lost every entry. One whose ttl ran out
// since its last registration or heartbeat merely expired.
function removedByOther(unit, o = {}) {
  const r = registeredNames(o)[unit];
  if (!fresh(r, o)) return false;
  if (directoryReset(o.entries, o)) { markLost(o); return false; }
  const lost = lostAt(o);
  return !(lost !== null && Date.parse(r.at) < lost);
}
const removedWhy = (unit) => `the entry the delivery plugin registered for ${unit} was removed from the service directory, so the owner may have taken the unit out of the plugin's hands; it is not registered again`;
const heldWhy = (unit, e) => `the service directory lists ${unit} as ${e.owner ? `owned by "${String(e.owner).slice(0, 80)}"` : 'with no owner'}, not by the ${OWNER}`;
const remembered = (unit, o) => { try { remember(unit, o); return null; } catch (err) { return first(err); } };

// Read before register: o.entries is a read of /api/services/local the caller made just now; without it
// this reads one. A name listed under another owner is not posted.
// A name the plugin registered whose entry someone removed is not posted either.
// -> { ok: true } | { ok: false, why, held?: owner, removed?: true }
function register(unit, o = {}) {
  let entries = o.entries;
  if (!entries) { const l = local(o); if (l.unreadable) return { ok: false, why: l.unreadable }; entries = l.entries; }
  const e = entries.find((x) => x && x.name === unit);
  if (e && e.owner !== OWNER) return { ok: false, held: e.owner || null, why: `${heldWhy(unit, e)}, so the plugin leaves that entry as it is` };
  // one the plugin registered that someone removed is not posted again either (an install, a pass)
  if (!e && removedByOther(unit, { ...o, entries })) return { ok: false, removed: true, why: removedWhy(unit) };
  const r = call(o.fetch, 'POST', '/api/services', entryFor(unit, o.description));
  if (r.status !== 200) return { ok: false, why: why(r) };
  const w = remembered(unit, o);
  return w ? { ok: true, unremembered: w } : { ok: true };
}
// an entry already gone is removed too; either way the plugin forgets the name
function remove(unit, o = {}) {
  const r = call(o.fetch, 'DELETE', `/api/services/${encodeURIComponent(unit)}`);
  if (r.status !== 200 && r.status !== 404) return { ok: false, why: why(r) };
  try { forget(unit, o); } catch (err) { /* the name stays on the list: a later miss reads as removed */ }
  return { ok: true };
}
// a heartbeat for an entry that expired or was never registered registers it; one the plugin registered
// that someone removed is not registered again
function heartbeat(unit, o = {}) {
  const r = call(o.fetch, 'POST', `/api/services/${encodeURIComponent(unit)}/heartbeat`);
  if (r.status === 200) { remembered(unit, o); return { ok: true }; }
  if (r.status === 404) {
    // register reads the directory and refuses a removed name itself
    const g = register(unit, o);
    return g.ok ? { ok: true, registered: true } : g;
  }
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
function beforeChange(unit, o = {}) {
  const { action = 'restart', running = true, fetch, onUnreachable } = o;
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
    if (removedByOther(unit, { ...o, entries: l.entries })) return { ok: false, removed: true, why: `${removedWhy(unit)}, and the plugin does not ${action} it` };
    const g = register(unit, { ...o, entries: l.entries });
    if (!g.ok) return { ok: false, why: `${unit} has no entry in the service directory, and registering it failed: ${g.why}` };
    l = local({ fetch });
    e = l.entries ? l.entries.find((x) => x && x.name === unit) : null;
    if (!e) return { ok: false, why: `${unit} has no entry in the service directory, even after registering it${l.unreadable ? ` (${l.unreadable})` : ''}` };
  }
  if (e.owner !== OWNER) return { ok: false, why: `${heldWhy(unit, e)}, so the plugin does not ${action} it` };
  return { ok: true };
}

// One pass's requests (a watchdog run): after the first that cannot reach the directory, the rest of the
// pass answers the same at once, so a directory that hangs costs one timeout per pass, not one per call.
function passFetch(fetch) {
  let down = null;
  const f = (method, p, body) => {
    if (down) return { error: down };
    let r;
    try { r = (fetch || defaultFetch())(method, p, body); } catch (err) { down = first(err) || 'no answer'; throw err; }
    if (!r || r.error) down = (r && r.error) || 'no answer';
    return r;
  };
  if (fetch && fetch.namesFile) f.namesFile = fetch.namesFile;
  return f;
}

// The ledger row and the warning for a start made while the directory could not be read.
function unreachableRecorder(root, { now, raisedBy = 'host job' } = {}) {
  return ({ unit, action, why: w }) => {
    require('./team-revive.js').record(root, { type: 'directory-unreachable', at: now || new Date().toISOString(), unit, action, why: w });
    require('./warnings.js').record(root, { kind: 'service-directory-unreachable', rule: 'dec-chief-of-staff-000485', detail: `${unit} was started while the service directory could not be read; the next pass that reaches it registers the unit`, raisedBy });
  };
}

module.exports = { BASE, OWNER, CATEGORY, TAGS, TTL, HM_UNITS, WATCHDOG_UNIT, isPluginUnit, scopeName, entryFor, describe, defaultFetch, passFetch, namesFile, registeredNames, remember, forget, removedByOther, directoryReset, register, remove, heartbeat, local, health, beforeChange, unreachableRecorder };

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
