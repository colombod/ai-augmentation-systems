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
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'scripts', 'testing', 'manifest', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
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
  assert.equal(s, '', 'a missing claim note is a reminder, not a block');
  assert.match(fs.readFileSync(path.join(roleDir, '.delivery-claim-reminder'), 'utf8'), /left no note/);
  [cwd, beadsDir] = fs.readFileSync(out, 'utf8').split('\n');
  assert.equal(cwd, real(projectRoot));
  assert.equal(beadsDir, path.join(projectRoot, '.beads'));
  // A BEADS_DIR the user set is kept.
  runHookClean('claim-stop.js', { cwd: roleDir, session_id: 's', stop_hook_active: false }, { ...env, BEADS_DIR: '/custom/beads' });
  assert.equal(fs.readFileSync(out, 'utf8').split('\n')[1], '/custom/beads');
});

// Final wave D: structural bead changes belong to the Delivery Manager.
test('D: structure is refused for every role but delivery-lead, with the sanctioned path', () => {
  const me = 'me@pc/builder-1';
  const beads = {
    mine: { id: 'mine', status: 'in_progress', assignee: me, updated_at: NOW },
    theirs: { id: 'theirs', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW },
  };
  const bd = fakeBd(beads);
  const run = (command, roleId = 'builder') => decideBd({ command, actor: me, roleId, staleHours: 2, bd, now: NOW });
  const refused = [
    'bd create "found work"',
    'bd new "found work"',
    'bd q "found work"',
    'bd create --title x --type task',
    'bd update mine --parent ex-9',
    'bd update mine --parent=ex-9',
    'bd dep add ex-1 ex-2',
    'bd dep remove ex-1 ex-2',
    'bd dep relate ex-1 ex-2',
    'bd dep unrelate ex-1 ex-2',
    'bd dep ex-1 --blocks ex-2',
    'bd delete ex-1',
    'bd label add ex-1 urgent',
    'bd label remove mine urgent',
    'bd label propagate ex-1 urgent',
    'bd update theirs --add-label urgent',
    'bd update theirs --remove-label urgent',
    'bd update theirs --set-labels urgent',
    'bd --json create "x"',
    'bd --actor me@pc/builder-1 dep add ex-1 ex-2',
    'git status && bd delete ex-1',
  ];
  for (const command of refused) {
    const d = run(command);
    assert.ok(d, command);
    assert.match(d.reason, /structure belongs to the Delivery Manager; create a child bead under the bead you hold \(`bd create --parent <id>`\) or message the Delivery Manager/, command);
  }
  for (const roleId of ['chief-of-staff', 'product-manager', 'progress-observer', 'staffing', 'spike-researcher', undefined]) {
    assert.ok(run('bd dep add ex-1 ex-2', roleId), String(roleId));
  }
  const allowed = [
    'bd create "found work" --parent mine',
    'bd create --parent=mine --title x',
    'bd update mine --add-label urgent',
    'bd update mine --remove-label urgent',
    'bd label list mine',
    'bd dep list ex-1',
    'bd dep tree ex-1',
    'bd update mine --append-notes "x"',
  ];
  for (const command of allowed) assert.equal(run(command), null, command);
  for (const command of refused) assert.equal(run(command, 'delivery-lead'), null, `delivery-lead: ${command}`);
  // A label lookup that fails stays fail-open, like every other lookup in this guard.
  const boom = { show: () => { throw new Error('bd down'); } };
  assert.equal(decideBd({ command: 'bd update ex-1 --add-label x', actor: me, roleId: 'builder', staleHours: 2, bd: boom, now: NOW }), null);
});

// Follow-up: verbs that mutate structure, identity or lifecycle in ways create/dep/label did not cover.
test('F1: link, rename, set-state, mol and the write forms of epic and swarm are structure', () => {
  const me = 'me@pc/builder-1';
  const bd = fakeBd({ mine: { id: 'mine', status: 'in_progress', assignee: me, updated_at: NOW }, theirs: { id: 'theirs', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW } });
  const run = (command, roleId = 'builder') => decideBd({ command, actor: me, roleId, staleHours: 2, bd, now: NOW });
  const refused = [
    'bd link ex-1 ex-2',
    'bd link ex-1 ex-2 --type blocks',
    'bd duplicate ex-1 --of ex-2',
    'bd supersede ex-1 --with ex-2',
    'bd rename ex-1 ex-9',
    'bd rename-prefix ex- new-',
    'bd set-state mine phase=review',
    'bd mol pour proto',
    'bd mol bond a b',
    'bd epic close-eligible',
    'bd swarm create ex-1',
    'bd --json link ex-1 ex-2',
  ];
  for (const command of refused) {
    const d = run(command);
    assert.ok(d, command);
    assert.match(d.reason, /structure belongs to the Delivery Manager/, command);
    assert.equal(run(command, undefined) !== null, true, `unknown role: ${command}`);
  }
  const allowed = ['bd epic status', 'bd epic', 'bd epic --help', 'bd swarm status ex-1', 'bd swarm validate ex-1', 'bd swarm list', 'bd mol', 'bd show mine'];
  for (const command of allowed) assert.equal(run(command), null, command);
  for (const command of refused.filter((c) => !/duplicate|supersede/.test(c))) assert.equal(run(command, 'delivery-lead'), null, `delivery-lead: ${command}`);
});

test('F1: duplicate and supersede follow the close rules for the Delivery Manager', () => {
  const bd = fakeBd({ theirs: { id: 'theirs', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW }, old: { id: 'old', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T05:00:00Z' } });
  const run = (command) => decideBd({ command, actor: 'lead@pc/delivery-lead', roleId: 'delivery-lead', staleHours: 2, bd, now: NOW });
  assert.match(run('bd duplicate theirs --of ex-2').reason, /Close with evidence/);
  assert.match(run('bd supersede theirs --with ex-2').reason, /Close with evidence/);
  assert.match(run('bd duplicate theirs --of ex-2 --reason "EVIDENCE: same scope"').reason, /claimed by bob@pc\/builder-2 and live/);
  assert.match(run('bd supersede theirs --with ex-2 --reason "EVIDENCE: replaced"').reason, /live/);
  assert.equal(run('bd duplicate old --of ex-2 --reason "EVIDENCE: same scope as ex-2"'), null);
  assert.equal(run('bd supersede old --with ex-2 --reason "EVIDENCE: replaced by ex-2"'), null);
});

test('F1: label flags on update check every id given, not only the first', () => {
  const me = 'me@pc/builder-1';
  const bd = fakeBd({ mine: { id: 'mine', status: 'in_progress', assignee: me, updated_at: NOW }, theirs: { id: 'theirs', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW } });
  const run = (command) => decideBd({ command, actor: me, roleId: 'builder', staleHours: 2, bd, now: NOW });
  assert.ok(run('bd update mine theirs --add-label x'));
  assert.ok(run('bd update mine theirs --set-labels x'));
  assert.ok(run('bd update theirs mine --remove-label x'));
  assert.equal(run('bd update mine mine --add-label x'), null);
  // A lookup that throws for one id stays fail-open for that id; the others are still checked.
  const flaky = { show: (id) => { if (id === 'gone') throw new Error('x'); return bd.show(id); } };
  assert.ok(decideBd({ command: 'bd update gone theirs --add-label x', actor: me, roleId: 'builder', staleHours: 2, bd: flaky, now: NOW }));
});

// Operator follow-up: verbs found passing when probed against bd 1.2.2.
test('F2: assign follows the claim rules; tag follows label add', () => {
  const me = 'me@pc/builder-1';
  const bd = fakeBd({
    mine: { id: 'mine', status: 'in_progress', assignee: me, updated_at: NOW },
    theirs: { id: 'theirs', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW },
    old: { id: 'old', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T05:00:00Z' },
    open: { id: 'open', status: 'open', updated_at: NOW },
  });
  const run = (command, roleId = 'builder') => decideBd({ command, actor: me, roleId, staleHours: 2, bd, now: NOW });
  assert.match(run('bd assign theirs me@pc/builder-1').reason, /claimed by bob@pc\/builder-2 and live/);
  assert.match(run('bd --json assign theirs someone').reason, /live/);
  assert.equal(run('bd assign open me@pc/builder-1'), null);
  assert.equal(run('bd assign mine me@pc/builder-1'), null);
  assert.equal(run('bd assign old me@pc/builder-1'), null);
  // The second positional is a person, never looked up as a bead.
  assert.equal(run('bd assign open theirs'), null);
  assert.match(run('bd tag theirs urgent').reason, /structure belongs to the Delivery Manager/);
  assert.match(run('bd tag open urgent').reason, /structure belongs to the Delivery Manager/);
  assert.equal(run('bd tag mine urgent'), null);
  assert.equal(run('bd tag theirs urgent', 'delivery-lead'), null);
  const boom = { show: () => { throw new Error('bd down'); } };
  assert.equal(decideBd({ command: 'bd tag ex-1 x', actor: me, roleId: 'builder', staleHours: 2, bd: boom, now: NOW }), null);
});

test('F2: todo, import and duplicates --merge are structure; plain duplicates lists', () => {
  const run = (command, roleId = 'builder') => decideBd({ command, actor: 'me@pc/builder-1', roleId, staleHours: 2, bd: fakeBd({}), now: NOW });
  const refused = ['bd todo add "x"', 'bd todo done ex-1', 'bd todo', 'bd import issues.jsonl', 'bd import -i issues.jsonl', 'bd duplicates --merge', 'bd duplicates --auto-merge', 'bd duplicates merge ex-1 ex-2', 'bd --json import f.jsonl'];
  for (const command of refused) {
    assert.match(run(command).reason, /structure belongs to the Delivery Manager; create a child bead under the bead you hold/, command);
    assert.equal(run(command, 'delivery-lead'), null, `delivery-lead: ${command}`);
  }
  for (const command of ['bd duplicates', 'bd duplicates --json', 'bd duplicates --dry-run', 'bd note ex-1 "hello"']) assert.equal(run(command), null, command);
});

test('F2: reopen is refused except for the delivery-lead and the progress-observer', () => {
  const run = (roleId) => decideBd({ command: 'bd reopen ex-1', actor: 'a', roleId, staleHours: 2, bd: fakeBd({}), now: NOW });
  for (const roleId of ['builder', 'chief-of-staff', 'product-manager', 'staffing', 'spike-researcher', undefined]) assert.match(run(roleId).reason, /reopening a closed bead is the Delivery Manager's or Progress Observer's call; message them with the evidence that it is not done/, String(roleId));
  for (const roleId of ['delivery-lead', 'progress-observer']) assert.equal(run(roleId), null, roleId);
});

// Final wave H.2: global flags, short claim flags, and closing someone else's live claim.
test('H.2: bd global flags before the subcommand are skipped', () => {
  for (const command of ['bd --json close ex-1', 'bd -q close ex-1', 'bd --quiet close ex-1', 'bd --no-color close ex-1', 'bd --actor x close ex-1', 'bd --db /tmp/x.db close ex-1', 'bd --actor=x --json close ex-1']) {
    const p = parseBd(command);
    assert.equal(p.sub, 'close', command);
    assert.equal(p.id, 'ex-1', command);
    assert.match(decideBd({ command, actor: 'a', roleId: 'builder', staleHours: 2, bd: fakeBd({}), now: NOW }).reason, /EVIDENCE:/, command);
  }
  assert.equal(parseBd('bd --json dep add ex-1 ex-2').sub, 'dep add');
});

test('H.2: -a and -s count as claim changes; a live claim cannot be closed by someone else', () => {
  const beads = {
    'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T11:30:00Z' },
    'ex-2': { id: 'ex-2', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T08:00:00Z' },
  };
  const bd = fakeBd(beads);
  const me = 'me@pc/builder-1';
  const run = (command, actor = me) => decideBd({ command, actor, roleId: 'builder', staleHours: 2, bd, now: NOW });
  assert.match(run('bd update ex-1 -a me').reason, /claimed by bob@pc\/builder-2/);
  assert.match(run('bd update ex-1 -s open').reason, /claimed by bob@pc\/builder-2/);
  const c = run('bd close ex-1 --reason "EVIDENCE: done"');
  assert.match(c.reason, /a live claim cannot be released by someone else/);
  assert.match(c.reason, /bob@pc\/builder-2/);
  assert.match(run('bd close ex-9 ex-1 --reason "EVIDENCE: done"').reason, /a live claim cannot be released by someone else/);
  assert.equal(run('bd close ex-1 --reason "EVIDENCE: done"', 'bob@pc/builder-2'), null);
  assert.equal(run('bd close ex-2 --reason "EVIDENCE: done"'), null);
  assert.match(run('bd close ex-1 --reason "done"').reason, /EVIDENCE:/);
});

test('D: the bd-guard hook passes the role, so a builder cannot add a dependency and the Delivery Manager can', () => {
  const env = (instance) => ({ DELIVERY_ROLE: instance, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const b = preparedRole('builder-1');
  const out = runHook('bd-guard-hook.js', { cwd: b.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'bd dep add ex-1 ex-2' } }, env('builder-1'));
  assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /structure belongs to the Delivery Manager/);
  const dl = preparedRole('delivery-lead');
  assert.equal(runHook('bd-guard-hook.js', { cwd: dl.roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command: 'bd dep add ex-1 ex-2' } }, env('delivery-lead')), '');
});

// Final wave H.4: a configured staleness of 0 stays 0; missing means 2.
test('H.4: staleHoursOf keeps a configured 0 and defaults to 2', () => {
  const { staleHoursOf } = require('./bd-guard.js');
  assert.equal(staleHoursOf({ budget: { staleness_hours: 0 } }), 0);
  assert.equal(staleHoursOf({ budget: { staleness_hours: 5 } }), 5);
  assert.equal(staleHoursOf({ budget: {} }), 2);
  assert.equal(staleHoursOf({}), 2);
  assert.equal(staleHoursOf(null), 2);
  // With 0, no claim is live: taking it over is not refused.
  const bead = { 'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob', updated_at: NOW } };
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'me', roleId: 'builder', staleHours: staleHoursOf({ budget: { staleness_hours: 0 } }), bd: fakeBd(bead), now: NOW }), null);
});
