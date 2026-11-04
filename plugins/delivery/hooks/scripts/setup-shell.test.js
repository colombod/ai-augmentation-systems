// hooks/scripts/setup-shell.test.js — the setup guard before a tool runs: scripts, heredocs, copies,
// assembled names and plugin switch-offs are judged by what they write, not only by their words; one-off
// variables, reads and test fixtures pass. Run with: scripts/testing/run-tests.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./setup.js');

const HOME = '/hm/u';
const ROLE = '/hm/u/team/builder/.claude/settings.local.json';
const SETTINGS = JSON.stringify({ env: { DELIVERY_ROLE: 'builder' }, enabledPlugins: { 'delivery@ai-augmentation-systems': true } }, null, 2);
const files = (map) => (f) => { if (Object.prototype.hasOwnProperty.call(map, f)) return map[f]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
const FILES = {
  [ROLE]: SETTINGS,
  '/hm/u/.claude/settings.json': SETTINGS,
  '/hm/u/work/staged.json': JSON.stringify({ env: { DELIVERY_ROLE: 'builder', TMPDIR: '/hm/u/.cache/t' } }),
  '/hm/u/work/clean.json': JSON.stringify({ env: { DELIVERY_ROLE: 'builder', FOO: '1' } }),
  '/hm/u/work/s.json': JSON.stringify({ env: { TMPDIR: '/x' } }),
};
const decide = (toolName, toolInput, over = {}) => S.decideSetup({ toolName, toolInput, cwd: '/hm/u/work', home: HOME, env: {}, readFile: files(FILES), exists: () => false, tmpdir: '/tmp', records: [], ...over });
const bash = (command, over) => decide('Bash', { command }, over);
const refusedTemp = (d, c) => assert.ok(d && /^Refused: this changes where temp files go/.test(d.reason), `${c}\n${d && d.reason}`);
const refusedOff = (d, c) => assert.ok(d && /^Refused: this switches off the setup guard/.test(d.reason), `${c}\n${d && d.reason}`);

// ---- finding 1: writes the command text alone did not show ----

test('the incident shape: a python3 heredoc that globs every role settings file and sets env.TMPDIR is refused', () => {
  const c = `python3 - <<'EOF'
import json, glob
for p in glob.glob('/hm/u/team/*/.claude/settings.local.json'):
    d = json.load(open(p))
    d.setdefault('env', {})['TMPDIR'] = '/hm/u/.cache/delivery-team-tmp'
    json.dump(d, open(p, 'w'), indent=2)
EOF`;
  refusedTemp(bash(c), c);
  refusedTemp(bash(c.replace("['TMPDIR']", "[k]").replace('import json, glob', "import json, glob\nk = 'TMP' + 'DIR'")), 'the name built from parts');
  refusedTemp(bash(c.replace("['TMPDIR']", "[''.join(['TM', 'PDIR'])]")), 'joined from a list');
});

test('a node heredoc, an inline node -e and a bash -c script that write a temp variable are refused', () => {
  refusedTemp(bash(`node <<'EOF'
const fs = require('fs'); const f = process.env.HOME + '/.claude/settings.json';
const s = JSON.parse(fs.readFileSync(f, 'utf8')); s.env = { ...s.env, TMP: '/x' }; fs.writeFileSync(f, JSON.stringify(s));
EOF`), 'node heredoc');
  refusedTemp(bash(`node -e "const fs=require('fs');const f='${ROLE}';const s=JSON.parse(fs.readFileSync(f));s.env.TEMP='/x';fs.writeFileSync(f,JSON.stringify(s))"`), 'node -e');
  refusedTemp(bash("bash -c 'echo export TMPDIR=/x >> ~/.bashrc'"), 'bash -c');
  refusedTemp(bash('cat >> ~/.profile <<EOF\nexport TMPDIR=/x\nEOF'), 'a heredoc appended to a profile');
});

test('cp or mv of a staged settings file that carries a temp variable is refused; a clean one passes', () => {
  refusedTemp(bash(`cp /hm/u/work/staged.json ${ROLE}`), 'cp');
  refusedTemp(bash('mv staged.json /hm/u/team/builder/.claude/settings.local.json'), 'mv, relative source');
  refusedTemp(bash('cp /hm/u/work/staged.json /hm/u/team/builder/.claude/settings.local.json'), 'cp onto the role file');
  assert.equal(bash(`cp /hm/u/work/clean.json ${ROLE}`), null);
});

test('the new environment files: ~/.bash_aliases, ~/.bashrc.d, any .envrc and ~/.config/fish', () => {
  for (const f of ['/hm/u/.bash_aliases', '/hm/u/.bashrc.d/50-tmp.sh', '/hm/u/proj/.envrc', '/hm/u/.config/fish/conf.d/tmp.fish']) {
    refusedTemp(decide('Write', { file_path: f, content: f.endsWith('.fish') ? 'set -gx TMPDIR /x\n' : 'export TMPDIR=/x\n' }), f);
  }
  refusedTemp(bash('echo "export TMPDIR=/x" >> /hm/u/proj/.envrc'), '.envrc by redirect');
});

test('claude --settings with a temp variable, inline or from a file, is refused; without one it passes', () => {
  refusedTemp(bash(`claude --settings '{"env":{"TMPDIR":"/x"}}' -p hi`), 'inline JSON');
  refusedTemp(bash('claude --settings /hm/u/work/s.json -p hi'), 'from a file');
  assert.equal(bash(`claude --settings '{"model":"opus"}' -p hi`), null);
});

// ---- finding 2: switching the guard off ----

test('claude plugin disable or uninstall of delivery is refused; of another plugin it passes', () => {
  for (const c of ['claude plugin disable delivery@ai-augmentation-systems', 'claude plugin uninstall delivery', 'claude plugins remove delivery@x --scope user']) refusedOff(bash(c), c);
  assert.equal(bash('claude plugin disable other@x'), null);
  assert.equal(bash('claude plugin list'), null);
});

test('a jq, python or node write that sets delivery@ to false or deletes it is refused; a read passes', () => {
  refusedOff(bash(`jq '.enabledPlugins["delivery@ai-augmentation-systems"] = false' ~/.claude/settings.json > /hm/u/s.json && mv /hm/u/s.json ~/.claude/settings.json`), 'jq');
  refusedOff(bash(`jq 'del(.enabledPlugins["delivery@ai-augmentation-systems"])' ~/.claude/settings.json | sponge ~/.claude/settings.json`), 'jq del');
  refusedOff(bash(`python3 -c "import json;p='/hm/u/.claude/settings.json';d=json.load(open(p));d['enabledPlugins']['delivery@ai-augmentation-systems']=False;json.dump(d,open(p,'w'))"`), 'python');
  assert.equal(bash(`jq '.enabledPlugins["delivery@ai-augmentation-systems"]' ~/.claude/settings.json`), null);
  assert.equal(bash(`grep '"delivery@ai-augmentation-systems": false' ~/.claude/settings.json`), null);
});

test('removing the user-level setup guard hook from settings.json is refused; adding it is allowed', () => {
  const guarded = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'x', hooks: [{ type: 'command', command: 'node "/hm/u/.claude/delivery/bin/setup-guard.js"' }] }] } });
  refusedOff(decide('Write', { file_path: '/hm/u/.claude/settings.json', content: JSON.stringify({ hooks: {} }) }, { readFile: () => guarded }), 'removed');
  assert.equal(decide('Write', { file_path: '/hm/u/.claude/settings.json', content: guarded }, { readFile: () => '{}' }), null, 'the installer adds it');
});

// ---- finding 5: no over-refusal ----

test('one-off variables next to a copy or a redirect, read-only script loads and fixtures pass', () => {
  for (const c of [
    'TMPDIR=/x node build.js && cp a.txt b.txt',
    'TMPDIR=/x npm test > out.log 2>&1',
    'TMPDIR=/x node scripts/x.js; cp /hm/u/work/clean.json /hm/u/work/copy.json',
    `TMPDIR=/x cp /hm/u/work/clean.json ${ROLE}`,
    `export TMPDIR=/x; cp /hm/u/work/clean.json ${ROLE}`,
    `node -e "console.log(require('/hm/u/.claude/settings.json').env.TMPDIR)"`,
    `python3 -c "import json;print(json.load(open('/hm/u/.claude/settings.json'))['env'].get('TMPDIR'))"`,
    `node -e "const fs=require('fs');fs.writeFileSync('/hm/u/proj/test/.claude/settings.json', JSON.stringify({env:{TMPDIR:'/x'}}))"`,
    'echo \'{"env":{"TMPDIR":"/x"}}\' > /hm/u/proj/test/fixtures/.claude/settings.json',
    'echo \'{"env":{"TMPDIR":"/x"}}\' > /tmp/run-1/.claude/settings.local.json',
  ]) assert.equal(bash(c), null, c);
  assert.equal(decide('Write', { file_path: '/hm/u/proj/test/.claude/settings.json', content: JSON.stringify({ env: { TMPDIR: '/x' } }) }), null, 'a fixture Write');
  assert.equal(decide('Write', { file_path: '/tmp/x/.claude/settings.local.json', content: JSON.stringify({ env: { TMPDIR: '/x' } }) }), null, 'in the sealed temp dir');
  // ...unless it is a role directory (a marker beside .claude), or the real config dir
  refusedTemp(decide('Write', { file_path: '/tmp/x/.claude/settings.local.json', content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { exists: (f) => f === '/tmp/x/.delivery-role.json' }), 'a role dir in tmp');
  refusedTemp(decide('Write', { file_path: '/tmp/cfg/settings.json', content: JSON.stringify({ env: { TMPDIR: '/x' } }) }, { env: { CLAUDE_CONFIG_DIR: '/tmp/cfg' } }), 'the config dir in tmp');
});

test('a commit message that names install, cp or a settings path writes nothing', () => {
  assert.equal(bash('git commit -m "install the guard; cp is judged; one-off TMPDIR=x cmd passes; .claude/settings.local.json is guarded"'), null);
});
