// hooks/scripts/bd-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBd, decideBd } = require('./bd-guard.js');

const NOW = '2026-10-12T12:00:00Z';
const fakeBd = (beads) => ({ show: (id) => beads[id] || null });

test('parseBd reads subcommand, id and flags', () => {
  const p = parseBd('bd update ex-1 --claim');
  assert.equal(p.sub, 'update'); assert.equal(p.id, 'ex-1'); assert.equal(p.flags.get('--claim'), true);
  const c = parseBd('bd close ex-2 --reason "EVIDENCE: shipped"');
  assert.equal(c.sub, 'close'); assert.equal(c.flags.get('--reason'), 'EVIDENCE: shipped');
  assert.equal(parseBd('bd dep add ex-1 --blocked-by ex-2').sub, 'dep add');
  assert.equal(parseBd('git status'), null);
});

test('parseBd handles two-word subcommands, equals form, short flags and leading --claim', () => {
  const d = parseBd('bd dep add ex-1 --blocked-by ex-2');
  assert.equal(d.id, 'ex-1'); assert.equal(d.flags.get('--blocked-by'), 'ex-2');
  assert.equal(parseBd('bd label add ex-1 urgent').sub, 'label add');
  assert.equal(parseBd('bd comments add ex-1 "hi"').sub, 'comments add');
  assert.equal(parseBd('bd close ex-1 --reason="EVIDENCE: x"').flags.get('--reason'), 'EVIDENCE: x');
  assert.equal(parseBd('bd close ex-1 -r "EVIDENCE: x"').flags.get('-r'), 'EVIDENCE: x');
  const c = parseBd('bd update --claim ex-1');
  assert.equal(c.id, 'ex-1'); assert.equal(c.flags.get('--claim'), true);
  assert.equal(parseBd('FOO=1 bd close ex-1'), null);
  assert.equal(parseBd('env bd close ex-1'), null);
});

test('close requires an EVIDENCE reason', () => {
  const bd = fakeBd({});
  assert.match(decideBd({ command: 'bd close ex-1 --reason "done"', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.match(decideBd({ command: 'bd close ex-1', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.equal(decideBd({ command: 'bd close ex-1 --reason "EVIDENCE: shipped in PR 3"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd close ex-1 --reason="EVIDENCE: shipped"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd close ex-1 -r "EVIDENCE: shipped"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
  assert.match(decideBd({ command: 'echo hi && bd close ex-1 --reason "evidence: x"', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
});

test('claim on a live holder is refused, stale or own claims pass', () => {
  const beads = {
    'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T11:30:00Z' },
    'ex-2': { id: 'ex-2', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T08:00:00Z' },
    'ex-3': { id: 'ex-3', status: 'open', assignee: '', updated_at: '2026-10-12T11:59:00Z' },
  };
  const bd = fakeBd(beads);
  const me = 'me@pc/builder-1';
  assert.match(decideBd({ command: 'bd update ex-1 --claim', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by bob@pc\/builder-2/);
  assert.equal(decideBd({ command: 'bd update ex-2 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-3 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'bob@pc/builder-2', staleHours: 2, bd, now: NOW }), null);
  assert.match(decideBd({ command: 'bd update ex-1 --status open --assignee ""', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by/);
});

test('a lookup that throws, or an unknown bead, allows', () => {
  const boom = { show: () => { throw new Error('bd down'); } };
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'a', staleHours: 2, bd: boom, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-9 --claim', actor: 'a', staleHours: 2, bd: fakeBd({}), now: NOW }), null);
});

// ---- hook entry (subprocess) ----
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');
const PLUGIN_ROOT = path.join(__dirname, '..', '..');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

function runHook(script, input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('A: bd-guard hook judges Monitor and PowerShell commands like Bash, and is inert without a role', () => {
  const { roleDir } = preparedRole('builder-1');
  const env = { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  for (const tool of ['Bash', 'Monitor', 'PowerShell']) {
    const out = runHook('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: tool, tool_input: { command: 'bd close x --reason done' } }, env);
    const json = JSON.parse(out);
    assert.equal(json.hookSpecificOutput.permissionDecision, 'deny', tool);
    assert.match(json.hookSpecificOutput.permissionDecisionReason, /EVIDENCE:/);
  }
  assert.equal(runHook('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: 'Monitor', tool_input: { command: 'bd close x --reason done' } }, { DELIVERY_ROLE: 'other' }), '');
});

// Final wave C: hooks run bd from the project root with BEADS_DIR defaulted, so bd is reachable
// from a role directory. A probe `bd` records where it ran and what BEADS_DIR it saw.
function probeBd(showJson, listJson) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-bin-'));
  const out = path.join(bin, 'probe.txt');
  fs.writeFileSync(path.join(bin, 'bd'), `#!/bin/sh\n{ pwd -P; printf '%s\\n' "$BEADS_DIR"; } > "${out}"\ncase "$1" in\n  show) echo '${showJson}';;\n  list) echo '${listJson}';;\nesac\n`, { mode: 0o755 });
  return { bin, out };
}

function runHookClean(script, input, env, unset) {
  const full = { ...process.env, ...env };
  for (const k of unset || []) delete full[k];
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: full, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('C: bd-guard hook and Stop guard run bd at the project root with BEADS_DIR defaulted', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  fs.mkdirSync(path.join(projectRoot, '.beads'));
  const live = new Date().toISOString();
  const { bin, out } = probeBd(
    JSON.stringify([{ id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: live }]),
    JSON.stringify([{ id: 'ex-1', status: 'in_progress', assignee: 'tester@pc/builder-1', updated_at: '2000-01-01T00:00:00Z' }]),
  );
  const env = { DELIVERY_ROLE: 'builder-1', BEADS_ACTOR: 'tester@pc/builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const real = (p) => fs.realpathSync(p);
  const d = runHookClean('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'bd update ex-1 --claim' } }, env, ['BEADS_DIR']);
  assert.match(JSON.parse(d).hookSpecificOutput.permissionDecisionReason, /claimed by bob@pc\/builder-2/);
  let [cwd, beadsDir] = fs.readFileSync(out, 'utf8').split('\n');
  assert.equal(cwd, real(projectRoot));
  assert.equal(beadsDir, path.join(projectRoot, '.beads'));
  require('./turn.js').markTurnStart(roleDir, new Date().toISOString());
  const s = runHookClean('claim-stop.js', { cwd: roleDir, session_id: 's', stop_hook_active: false }, env, ['BEADS_DIR']);
  assert.equal(JSON.parse(s).decision, 'block');
  [cwd, beadsDir] = fs.readFileSync(out, 'utf8').split('\n');
  assert.equal(cwd, real(projectRoot));
  assert.equal(beadsDir, path.join(projectRoot, '.beads'));
  // A BEADS_DIR the user set is kept.
  runHookClean('claim-stop.js', { cwd: roleDir, session_id: 's', stop_hook_active: false }, { ...env, BEADS_DIR: '/custom/beads' });
  assert.equal(fs.readFileSync(out, 'utf8').split('\n')[1], '/custom/beads');
});
