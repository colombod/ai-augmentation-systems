// hooks/scripts/hooks-none.test.js -- the plugin registers only the ledger observer (sprints 0a, 0c).
// Why: a plugin's hooks run in the customer's own sessions, and the customer who installs this plugin
// expects those sessions to be left alone. Sprint 0a removed every hook; Sprint 0c restored only the
// recorder, which observes and writes nothing unless DELIVERY_LEDGER=1. No script may put a hook into a
// user's settings. Run with: scripts/testing/run-tests.js.
require('../../scripts/testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');

test('hooks.json registers exactly the ledger recorder: three entries, observer events only', () => {
  // Sprint 0c restored the observer so a status report can tell a real skill or agent call from a
  // narrated one. It may register only record-invocation.js, only on the two events that fire after a
  // tool has already resolved (so cannot gate), and nothing else may ride along.
  const j = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(j), ['hooks']);
  assert.deepEqual(Object.keys(j.hooks).sort(), ['PostToolUse', 'PostToolUseFailure']);
  const rec = (matcher, extra) => ({
    matcher,
    hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/record-invocation.js'], ...extra, timeout: 5 }],
  });
  assert.deepEqual(j.hooks.PostToolUse, [
    rec('^(Write|Edit|NotebookEdit)$', {}),
    rec('^(Skill|Agent|mcp__Claude_Browser__computer|mcp__Claude_Code_iOS_Simulator__control)$', { async: true }),
  ]);
  assert.deepEqual(j.hooks.PostToolUseFailure, [
    rec('^(Skill|Agent|Write|Edit|NotebookEdit|mcp__Claude_Browser__computer|mcp__Claude_Code_iOS_Simulator__control)$', { async: true }),
  ]);
  // the script the args name exists, so a rename cannot leave a dangling registration
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'record-invocation.js')));
});

test('no shipped script names the deleted user-level guard installer, and its files are gone', () => {
  // the installer is gone and nothing names it: a require of it would fail at run time, so check the text
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const offenders = walk(PLUGIN_ROOT).filter((f) => /ensureUserGuard|lib\/user-guard/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(PLUGIN_ROOT, f)), []);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'user-guard.js')), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', 'setup-guard.js')), false);
});

// ---- the recorder is an observer: it cannot gate, and it writes nothing unless the ledger is on ----
// Why these run the real script as a subprocess: the promise to the customer is about what the process
// does (prints nothing, exits 0, touches nothing), not about what its functions return.
const { spawnSync } = require('child_process');
const os = require('os');
const RECORDER = path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'record-invocation.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-proj-'));
  fs.mkdirSync(path.join(dir, '.delivery'));
  return dir;
}
function runRecorder(input, { ledger, cwd }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-home-'));
  const env = { PATH: process.env.PATH, HOME: home };
  if (ledger) env.DELIVERY_LEDGER = '1';
  return spawnSync(process.execPath, [RECORDER], { input, cwd, env, encoding: 'utf8' });
}
const event = (name, extra = {}) => JSON.stringify({
  hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 't1', tool_name: 'Skill', tool_input: { skill: name }, ...extra,
});

test('the recorder never prints and always exits 0, whatever it is fed, ledger on or off', () => {
  // A hook that prints a decision or exits non-zero could block a session. This one must do neither.
  const inputs = [
    '',
    'not json at all',
    '{"tool_name":',
    event('delivery:brief'),
    event('delivery:brief', { hook_event_name: 'PostToolUseFailure' }),
    JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/nonexistent/x.md', content: 'x' } }),
  ];
  for (const ledger of [false, true]) {
    for (const input of inputs) {
      const cwd = project();
      const r = runRecorder(input, { ledger, cwd });
      assert.equal(r.status, 0, `exit ${r.status} for ledger=${ledger} input=${input.slice(0, 40)}`);
      assert.equal(r.stdout, '', `printed for ledger=${ledger} input=${input.slice(0, 40)}`);
      assert.equal(/decision|permissionDecision|block/i.test(r.stdout + r.stderr), false);
    }
  }
});

test('with the ledger off the recorder writes nothing, even inside a project', () => {
  const cwd = project();
  const r = runRecorder(event('delivery:brief', { cwd }), { ledger: false, cwd });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(cwd, '.delivery', 'invocations')), false);
});

test('with the ledger on the recorder writes one line for a skill call, and still prints nothing', () => {
  const cwd = project();
  const r = runRecorder(event('delivery:brief', { cwd }), { ledger: true, cwd });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const file = path.join(cwd, '.delivery', 'invocations', 's1.ndjson');
  assert.ok(fs.existsSync(file), 'the ledger line was not written');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.tool_name, 'Skill');
  assert.equal(rec.invoked_name, 'delivery:brief');
});

test('an unwritable ledger location does not make the recorder fail or print', () => {
  // a plain file where the ledger directory should be: the write cannot succeed, the hook must stay silent
  const cwd = project();
  fs.writeFileSync(path.join(cwd, '.delivery', 'invocations'), 'in the way');
  const r = runRecorder(event('delivery:brief', { cwd }), { ledger: true, cwd });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});
