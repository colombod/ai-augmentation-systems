// scripts/lib/judge.test.js — run with: node --test scripts/lib/judge.test.js
// The judge against a local fake provider; the real API is never called here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const J = require('./judge.js');
const { validateManifest, manifestWarnings } = require('./manifest.js');

const KEY = 'test-key-not-real';
// the suite never sees a real key: ask() reads the variable from this process's environment
process.env.TYPESAFE_API_KEY = KEY;
// a fake provider: reply(body) -> { status, json, delayMs }; every request body and auth header is kept
function fakeServer(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      seen.push({ body: parsed, auth: req.headers.authorization });
      const r = reply(parsed);
      setTimeout(() => { res.writeHead(r.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.json || {})); }, r.delayMs || 0);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1/systemone`,
    close: () => { server.closeAllConnections(); server.close(); } })));
}
const noul = (p) => (body) => ({ json: { model: 'jev-1.13.0', answers: { [Object.keys(body.questions)[0]]: { type: 'noul', noul: p } }, usage: { input_tokens: 581, output_tokens: 21 } } });
const cfgFor = (url, extra = {}) => J.judgeConfig({ judge: { provider: 'typesafe', model: 'jev-latest', endpoint: url, ...extra } }, { TYPESAFE_API_KEY: KEY });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
const RELAY = { sender_role: 'Chief of Staff', recipient: 'owner', message: 'Open the builder session and approve the push.' };

test('judgeConfig: off without a block, with provider none, or without the key; on with both', () => {
  assert.equal(J.judgeConfig({}, { TYPESAFE_API_KEY: KEY }).reason, 'judge_not_configured');
  assert.equal(J.judgeConfig({ judge: { provider: 'none' } }, { TYPESAFE_API_KEY: KEY }).reason, 'provider_none');
  assert.equal(J.judgeConfig({ judge: { provider: 'typesafe' } }, {}).reason, 'no_key');
  assert.equal(J.judgeConfig({ judge: { provider: 'typesafe', key_env: 'OTHER' } }, { OTHER: 'k' }).enabled, true);
  assert.equal(J.judgeConfig({ judge: { provider: 'typesafe', block_threshold: 2 } }, { TYPESAFE_API_KEY: KEY }).reason, 'judge_config_invalid');
  assert.equal(JSON.stringify(J.judgeConfig({ judge: { provider: 'typesafe' } }, { TYPESAFE_API_KEY: KEY })).includes(KEY), false, 'the key is not in the config');
});

test('manifest: judge values are validated, unknown keys warn, a remote endpoint is refused', () => {
  const team = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testing', 'manifest', 'team.json'), 'utf8'));
  const hosts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testing', 'manifest', 'hosts.json'), 'utf8'));
  const base = validateManifest(JSON.parse(JSON.stringify(team)), hosts);
  const ok = { ...team, judge: { provider: 'typesafe', model: 'jev-latest', key_env: 'TYPESAFE_API_KEY', block_threshold: 0.8, warn_threshold: 0.5, colour: 'x' } };
  assert.deepEqual(validateManifest(ok, hosts), base);
  assert.ok(manifestWarnings(ok).some((w) => /judge key "colour" is not known/.test(w)));
  const bad = { ...team, judge: { provider: 'gpt', warn_threshold: 0.9, block_threshold: 0.8, key_env: 'lower', endpoint: 'https://example.org/x' } };
  const p = validateManifest(bad, hosts).filter((x) => /judge/.test(x));
  assert.equal(p.length, 4, p.join('\n'));
});

test('ask: a noul answer is typed, the key goes only in the header, and the log line has no state', async () => {
  const f = await fakeServer(noul(0.91));
  const logDir = tmp();
  try {
    const r = await J.ask('relay_request', { ...RELAY, extra: 'dropped' }, { config: cfgFor(f.url), logDir, gate: 'test' });
    assert.equal(r.answer, 'yes');
    assert.equal(r.p, 0.91);
    assert.equal(r.model, 'jev-1.13.0');
    assert.equal(r.version, '1');
    assert.equal(r.inputTokens, 581);
    assert.ok(r.latencyMs >= 0);
    assert.deepEqual(r.dropped, ['extra']);
    assert.ok(f.seen[0].auth === `Bearer ${KEY}`, 'the key is sent as a bearer header');
    assert.deepEqual(Object.keys(f.seen[0].body.state).sort(), ['message', 'recipient', 'sender_role']);
    assert.equal(f.seen[0].body.questions.relay_request.type, 'noul');
    const text = fs.readFileSync(path.join(logDir, fs.readdirSync(logDir).find((x) => x.endsWith('.ndjson'))), 'utf8');
    const line = JSON.parse(text);
    assert.equal(line.advisory, true);
    assert.equal(line.p, 0.91);
    assert.match(line.state_sha256, /^[0-9a-f]{64}$/);
    assert.ok(!text.includes('approve the push') && !text.includes(KEY), 'neither the state nor the key is logged');
    assert.equal(fs.readFileSync(path.join(logDir, '.gitignore'), 'utf8'), '*\n');
  } finally { f.close(); }
});

test('ask: a choice answer carries confidence and probabilities', async () => {
  const f = await fakeServer(() => ({ json: { model: 'jev-1.13.0', answers: { divergence: { type: 'choice', choice: 'minor', confidence: 0.6, probabilities: { none: 0.1, minor: 0.7, serious: 0.2 } } }, usage: { input_tokens: 575 } } }));
  try {
    const r = await J.ask('divergence', { agreed_criteria: ['a'], customer_surface: 'web', change_summary: 'did a' }, { config: cfgFor(f.url), logDir: tmp() });
    assert.equal(r.answer, 'minor');
    assert.equal(r.confidence, 0.6);
    assert.equal(r.probabilities.minor, 0.7);
    assert.deepEqual(Object.keys(f.seen[0].body.questions.divergence.criteria), ['none', 'minor', 'serious']);
  } finally { f.close(); }
});

test('ask fails open: timeout, 401, 429, a closed port and a bad body give a reason, never a throw', async () => {
  const f = await fakeServer((b) => (b.state.message === 'slow' ? { delayMs: 500 } : b.state.message === '401' ? { status: 401 } : b.state.message === '429' ? { status: 429 } : { json: { nope: 1 } }));
  const logDir = tmp();
  try {
    const at = (m, t) => J.ask('relay_request', { ...RELAY, message: m }, { config: cfgFor(f.url), logDir, timeoutMs: t });
    assert.equal((await at('slow', 100)).reason, 'timeout');
    assert.equal((await at('401')).reason, 'http_401');
    assert.equal((await at('429')).reason, 'http_429');
    assert.equal((await at('odd')).reason, 'bad_response');
    const closed = await J.ask('relay_request', RELAY, { config: cfgFor('http://127.0.0.1:1/x'), logDir });
    assert.equal(closed.error, true);
    assert.equal(closed.reason, 'network');
    const s = J.stats(J.readLog(logDir)).relay_request;
    assert.equal(s.errors, 5);
    assert.deepEqual(s.reasons, { timeout: 1, http_401: 1, http_429: 1, bad_response: 1, network: 1 });
  } finally { f.close(); }
});

test('ask refuses locally: off, unknown question, sensitive or missing fields; nothing is sent', async () => {
  const f = await fakeServer(noul(0.9));
  const logDir = tmp();
  try {
    assert.deepEqual(await J.ask('relay_request', RELAY, { config: J.judgeConfig({ judge: { provider: 'typesafe' } }, {}), logDir }), { question: 'relay_request', version: '1', skipped: true, reason: 'no_key' });
    assert.equal((await J.ask('nope', RELAY, { config: cfgFor(f.url) })).reason, 'unknown_question');
    const cases = {
      token: 'use ghp_abcdefghijklmnopqrstuvwxyz0123 now', email: 'mail someone@example.com', url: 'see https://example.com/a',
      path: 'the file /srv/app/config.json', credential: 'password = hunter22', id: 'session 3f2b1c4d-1a2b-4c3d-8e9f-0123456789ab',
      opaque: 'key Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg', denylist: 'the Secret Codename launch',
    };
    for (const [kind, message] of Object.entries(cases)) {
      const r = await J.ask('relay_request', { ...RELAY, message }, { config: cfgFor(f.url), logDir, denylist: ['secret codename'] });
      assert.equal(r.reason, 'state_filtered', kind);
      assert.deepEqual(r.filtered, [{ field: 'message', kind }], kind);
    }
    assert.deepEqual((await J.ask('relay_request', { message: 'hi' }, { config: cfgFor(f.url), logDir })).missing, ['sender_role', 'recipient']);
    assert.equal(f.seen.length, 0, 'nothing reached the provider');
    const text = fs.readFileSync(path.join(logDir, fs.readdirSync(logDir).find((x) => x.endsWith('.ndjson'))), 'utf8');
    assert.ok(!text.includes('ghp_') && !text.includes('example.com'), 'the filtered value is not logged');
    // ordinary briefing text passes
    assert.deepEqual(J.filterState(J.loadCatalogue().questions.relay_request, { ...RELAY, message: 'Run /delivery:status, then merge #477 and A/B the copy.' }).filtered, []);
  } finally { f.close(); }
});

test('stats: calls, latency percentiles, tokens and the share at the thresholds per question', () => {
  const e = (p, ms) => ({ question: 'relay_request', outcome: 'answer', p, latency_ms: ms, input_tokens: 500, output_tokens: 20 });
  const s = J.stats([e(0.9, 100), e(0.6, 200), e(0.1, 300), e(0.95, 400), { question: 'relay_request', outcome: 'skipped', reason: 'state_filtered' }]).relay_request;
  assert.equal(s.calls, 5);
  assert.equal(s.answered, 4);
  assert.equal(s.latency_p50_ms, 200);
  assert.equal(s.latency_p95_ms, 400);
  assert.equal(s.input_tokens, 2000);
  assert.equal(s.share_at_block, 0.5);
  assert.equal(s.share_at_warn, 0.75);
  assert.deepEqual(s.reasons, { state_filtered: 1 });
});

test('the catalogue: every question has a version, a type, declared state and instructions; divergence is warn-only', () => {
  const cat = J.loadCatalogue();
  assert.deepEqual(Object.keys(cat.questions).sort(), ['builds_on_verified', 'divergence', 'is_fix', 'relay_request', 'shippable_unit']);
  for (const [id, q] of Object.entries(cat.questions)) {
    assert.ok(q.version && ['noul', 'choice'].includes(q.type) && q.state.length && q.instructions, id);
    if (q.type === 'choice') assert.ok(Object.keys(q.criteria).length >= 2, id);
  }
  assert.equal(cat.questions.divergence.mode, 'warn-only');
  assert.equal(cat.questions.is_fix.type, 'noul');
});
