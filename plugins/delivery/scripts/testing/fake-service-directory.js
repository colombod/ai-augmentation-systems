// scripts/testing/fake-service-directory.js — a stand-in for the owner's service directory, for tests: the
// requests lib/service-directory.js makes (register, heartbeat, delete, the local list, health), kept in
// memory, with every call recorded. No socket is opened. down: true makes every request fail as an
// unreachable directory does; static names answer 409/403 as the real one does.
function fakeDirectory({ entries = [], statics = [], down = false } = {}) {
  const d = { entries: entries.map((e) => ({ source: 'dynamic', ...e })), statics, down, calls: [], beats: {} };
  d.fetch = (method, p, body) => {
    d.calls.push(`${method} ${p}`);
    if (d.down) return { error: 'connect ECONNREFUSED 127.0.0.1:8085' };
    const name = decodeURIComponent((/^\/api\/services\/([^/]+)/.exec(p) || [])[1] || '');
    if (method === 'GET' && p === '/api/services/local') return { status: 200, body: [...d.statics.map((n) => ({ name: n, source: 'static' })), ...d.entries] };
    if (method === 'GET' && p === '/api/health') return { status: 200, body: Object.fromEntries(d.entries.map((e) => [e.name, d.beats[e.name] ? 'up' : 'down'])) };
    if (method === 'POST' && p === '/api/services') {
      if (!body || !body.name || (!body.url && !body.port)) return { status: 400, body: { detail: 'name and url or port' } };
      if (d.statics.includes(body.name)) return { status: 409, body: { detail: `'${body.name}' is a static service name and cannot be shadowed by a dynamic registration` } };
      d.entries = d.entries.filter((e) => e.name !== body.name).concat([{ ...body, source: 'dynamic' }]);
      return { status: 200, body: { ...body, source: 'dynamic' } };
    }
    if (method === 'POST' && /\/heartbeat$/.test(p)) {
      if (d.statics.includes(name)) return { status: 403, body: { detail: 'static services are read-only' } };
      if (!d.entries.some((e) => e.name === name)) return { status: 404, body: { detail: 'not found' } };
      d.beats[name] = (d.beats[name] || 0) + 1;
      return { status: 200, body: d.entries.find((e) => e.name === name) };
    }
    if (method === 'DELETE') {
      if (d.statics.includes(name)) return { status: 403, body: { detail: 'static services are read-only' } };
      if (!d.entries.some((e) => e.name === name)) return { status: 404, body: { detail: 'not found' } };
      d.entries = d.entries.filter((e) => e.name !== name);
      return { status: 200, body: { removed: name } };
    }
    return { status: 404, body: { detail: 'not faked' } };
  };
  d.entry = (n) => d.entries.find((e) => e.name === n) || null;
  return d;
}

module.exports = { fakeDirectory };
