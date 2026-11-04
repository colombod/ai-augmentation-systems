// hooks/scripts/setup-net.test.js — the after-check: what a tool changed in a guarded file that the
// guard before it could not see (a cp, a script file) is put back, exactly those keys or lines, and the
// result is blocked with the reason. Run with: scripts/testing/run-tests.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const N = require('./setup-net.js');

const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const GUARD_ENTRY = { matcher: 'x', hooks: [{ type: 'command', command: 'node "/c/delivery/bin/setup-guard.js"' }] };

// A host: a home with a config dir and a .bashrc, a project with a team manifest, and two role dirs
// (one in the roster, one only in the default team dir).
function host() {
  const base = mk('net-');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', enabledPlugins: { 'delivery@m': true }, hooks: { PreToolUse: [GUARD_ENTRY], Stop: [{ hooks: [] }] } }, null, 2));
  fs.writeFileSync(path.join(home, '.bashrc'), 'export PATH=/usr/bin\n');
  const root = path.join(base, 'proj');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'proj' }));
  const builder = path.join(base, 'proj-team', 'builder');
  const other = path.join(base, 'elsewhere', 'reviewer');
  for (const d of [builder, other]) {
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ env: { DELIVERY_ROLE: path.basename(d) }, permissions: { allow: [] } }, null, 2));
  }
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'roster.json'), JSON.stringify({ instances: { reviewer: { role_dir: other } } }));
  const data = path.join(base, 'data');
  const env = { CLAUDE_PLUGIN_DATA: data };
  return { base, home, root, builder, other, data, env, input: { session_id: 'sess', tool_use_id: 'tu-1', tool_name: 'Bash', cwd: base } };
}
const roleFile = (d) => path.join(d, '.claude', 'settings.local.json');
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('the guarded set: the config dir, rc files, and every role dir of the projects served', () => {
  const h = host();
  const files = N.guardedFiles({ home: h.home, env: h.env, cwd: h.base, roots: [h.root] }).map((x) => x.file);
  for (const f of [path.join(h.home, '.claude', 'settings.json'), path.join(h.home, '.bashrc'), path.join(h.home, '.bash_aliases'), roleFile(h.builder), roleFile(h.other)]) assert.ok(files.includes(f), f);
});

test('a script that adds TMPDIR to every role settings file is reverted after it runs, the rest kept', () => {
  const h = host();
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [h.root] });
  assert.equal(fs.readdirSync(path.join(h.data, 'setup-net')).length, 1, 'the snapshot is in the plugin data dir');
  for (const d of [h.builder, h.other]) {
    const j = readJ(roleFile(d));
    j.env.TMPDIR = '/hm/u/.cache/delivery-team-tmp';
    j.env.FOO = 'kept';
    fs.writeFileSync(roleFile(d), JSON.stringify(j));
  }
  let reads = 0;
  const r = N.afterTool(h.input, { home: h.home, env: h.env, records: () => { reads++; return [{ id: 'dec-1', kind: 'decision', statement: 'No relocating temp files elsewhere.' }]; } });
  assert.ok(r);
  assert.match(r.reason, /^Refused: this changes where temp files go \(TMPDIR in .*settings\.local\.json\)\. The operator ruled on it: dec-1/);
  assert.match(r.reason, /It was reverted: /);
  for (const d of [h.builder, h.other]) assert.ok(r.reason.includes(`${roleFile(d)} (TMPDIR)`), d);
  assert.doesNotMatch(r.reason.replace(/do not ask the operator/g, ''), /ask the operator|approv/i);
  assert.equal(reads, 1);
  for (const d of [h.builder, h.other]) {
    const j = readJ(roleFile(d));
    assert.equal(j.env.TMPDIR, undefined);
    assert.equal(j.env.FOO, 'kept', 'only the temp key is put back');
    assert.deepEqual(j.permissions, { allow: [] });
  }
  assert.equal(fs.readdirSync(path.join(h.data, 'setup-net')).length, 0, 'the snapshot is deleted after the check');
});

test('a changed temp value is put back to its old value; a removed one stays removed', () => {
  const h = host();
  fs.writeFileSync(roleFile(h.builder), JSON.stringify({ env: { TMPDIR: '/old', TMP: '/t' } }));
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [h.root] });
  fs.writeFileSync(roleFile(h.builder), JSON.stringify({ env: { TMPDIR: '/new' } }));
  const r = N.afterTool(h.input, { home: h.home, env: h.env });
  assert.ok(r);
  assert.deepEqual(readJ(roleFile(h.builder)).env, { TMPDIR: '/old' });
});

test('an added temp line in .bashrc is removed, and only that line', () => {
  const h = host();
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [] });
  fs.appendFileSync(path.join(h.home, '.bashrc'), 'alias ll="ls -l"\nexport TMPDIR=/x\n');
  const r = N.afterTool(h.input, { home: h.home, env: h.env });
  assert.ok(r && /TMPDIR in .*\.bashrc/.test(r.reason));
  assert.equal(fs.readFileSync(path.join(h.home, '.bashrc'), 'utf8'), 'export PATH=/usr/bin\nalias ll="ls -l"\n');
});

test('disabling the plugin or dropping the guard hook is put back; other hooks and keys stay as changed', () => {
  const h = host();
  const f = path.join(h.home, '.claude', 'settings.json');
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [] });
  const j = readJ(f);
  j.enabledPlugins['delivery@m'] = false;
  j.hooks = { Stop: [] };
  j.model = 'sonnet';
  fs.writeFileSync(f, JSON.stringify(j));
  const r = N.afterTool(h.input, { home: h.home, env: h.env });
  assert.ok(r && /^Refused: this switches off the setup guard/.test(r.reason), r && r.reason);
  const after = readJ(f);
  assert.equal(after.enabledPlugins['delivery@m'], true);
  assert.deepEqual(after.hooks.PreToolUse, [GUARD_ENTRY]);
  assert.deepEqual(after.hooks.Stop, []);
  assert.equal(after.model, 'sonnet', 'a change that is not the guard\'s is left as the tool made it');
});

test('nothing changed: no reason, no write, no records read; a second after-check is harmless', () => {
  const h = host();
  const f = roleFile(h.builder);
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [h.root] });
  const before = fs.statSync(f).mtimeMs;
  assert.equal(N.afterTool(h.input, { home: h.home, env: h.env, records: () => { throw new Error('read'); } }), null);
  assert.equal(fs.statSync(f).mtimeMs, before);
  // two copies of the guard after the same tool: the second finds the snapshot gone, or (if it read it
  // first) the file already put back, and changes nothing either way
  N.beforeTool(h.input, { home: h.home, env: h.env, roots: [h.root] });
  const snap = path.join(h.data, 'setup-net', N.keyOf(h.input));
  const copy = fs.readFileSync(snap, 'utf8');
  fs.writeFileSync(f, JSON.stringify({ env: { TMPDIR: '/x' } }));
  assert.ok(N.afterTool(h.input, { home: h.home, env: h.env }));
  assert.equal(N.afterTool(h.input, { home: h.home, env: h.env }), null, 'snapshot gone');
  fs.writeFileSync(snap, copy);
  const text = fs.readFileSync(f, 'utf8');
  assert.equal(N.afterTool(h.input, { home: h.home, env: h.env }), null, 'already put back');
  assert.equal(fs.readFileSync(f, 'utf8'), text);
});

test('without CLAUDE_PLUGIN_DATA the snapshot goes under the config dir, never the temp dir', () => {
  assert.equal(N.stateDir({ home: '/h', env: {} }), path.join('/h', '.claude', 'delivery', 'state'));
  assert.equal(N.stateDir({ home: '/h', env: { CLAUDE_CONFIG_DIR: '/c' } }), path.join('/c', 'delivery', 'state'));
  assert.equal(N.stateDir({ home: '/h', env: { CLAUDE_PLUGIN_DATA: '/d' } }), path.join('/d', 'setup-net'));
});

test('end to end: the hook before and after a cp of a staged file blocks and reverts it', () => {
  const h = host();
  const staged = path.join(h.base, 'staged.json');
  fs.writeFileSync(staged, JSON.stringify({ env: { TMPDIR: '/x' } }));
  const env = { ...process.env, HOME: h.home, CLAUDE_PLUGIN_DATA: h.data, DELIVERY_PROJECTS: h.root };
  delete env.CLAUDE_CONFIG_DIR; delete env.DELIVERY_ROLE; delete env.DELIVERY_ROLE_DIR;
  const run = (event, input) => spawnSync(process.execPath, [path.join(__dirname, 'setup-guard.js')], { input: JSON.stringify({ ...input, hook_event_name: event }), env, encoding: 'utf8' });
  // the source is read at run time from a variable: the guard before the tool cannot see it
  const input = { ...h.input, tool_input: { command: `cp "$SRC" ${roleFile(h.builder)}` } };
  assert.equal(run('PreToolUse', input).stdout, '');
  fs.copyFileSync(staged, roleFile(h.builder));
  const out = JSON.parse(run('PostToolUse', input).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /It was reverted/);
  assert.equal((readJ(roleFile(h.builder)).env || {}).TMPDIR, undefined);
});
