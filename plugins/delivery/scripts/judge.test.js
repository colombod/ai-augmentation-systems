// scripts/judge.test.js — run with: node --test scripts/judge.test.js
// The judge CLI against a local fake provider; the real API is never called here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { main } = require('./judge.js');

const CLI = path.join(__dirname, 'judge.js');
const ENV = { TYPESAFE_API_KEY: 'test-key-not-real' };
const STATE = { sender_role: 'Chief of Staff', recipient: 'owner', message: 'Open the builder session and type yes.' };

function project(judge) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cli-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  const team = JSON.parse(fs.readFileSync(path.join(__dirname, 'testing', 'manifest', 'team.json'), 'utf8'));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify(judge ? { ...team, judge } : team));
  fs.copyFileSync(path.join(__dirname, 'testing', 'manifest', 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

test('judge.js questions lists the catalogue; a bad command is a usage error', () => {
  const r = spawnSync(process.execPath, [CLI, 'questions'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.questions.find((q) => q.id === 'divergence').options, ['none', 'minor', 'serious']);
  assert.equal(out.questions.find((q) => q.id === 'divergence').mode, 'warn-only');
  assert.equal(spawnSync(process.execPath, [CLI, 'ask'], { encoding: 'utf8' }).status, 2);
});

test('judge.js ask: off without a judge block (exit 3, skipped); answered from stdin when on; stats reads the log', async () => {
  const off = spawnSync(process.execPath, [CLI, 'ask', 'relay_request', '--state', '-', '--project', project(null)], { input: JSON.stringify(STATE), encoding: 'utf8', env: { ...process.env, ...ENV } });
  assert.equal(off.status, 3);
  assert.equal(JSON.parse(off.stdout).reason, 'judge_not_configured');

  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { relay_request: { type: 'noul', noul: 0.93 } }, usage: { input_tokens: 590, output_tokens: 21 } }))); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const root = project({ provider: 'typesafe', endpoint: `http://127.0.0.1:${server.address().port}/v1/systemone` });
    const r = await main(['ask', 'relay_request', '--state', '-'], { cwd: root, env: ENV, stdin: () => JSON.stringify(STATE) });
    assert.equal(r.code, 0);
    assert.equal(r.out.answer, 'yes');
    assert.equal(r.out.p, 0.93);
    const s = await main(['stats'], { cwd: root, env: ENV });
    assert.equal(s.out.questions.relay_request.answered, 1);
    assert.equal(s.out.questions.relay_request.share_at_block, 1);
    assert.equal(s.out.questions.relay_request.input_tokens, 590);
  } finally { server.closeAllConnections(); server.close(); }
});
