// hooks/scripts/bd-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBd, decideBd, gateChecks } = require('./bd-guard.js');

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

test('close: the reason text alone neither passes nor fails a close (the prefix check is gone; the done gate reads evidence rows)', () => {
  const bd = fakeBd({});
  for (const command of ['bd close ex-1 --reason "done"', 'bd close ex-1', 'bd close ex-1 --reason "EVIDENCE: shipped in PR 3"', 'echo hi && bd close ex-1 -r "evidence: x"']) {
    assert.equal(decideBd({ command, actor: 'a', staleHours: 2, bd, now: NOW }), null, command);
  }
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
    const out = runHook('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: tool, tool_input: { command: 'bd dep add x y' } }, env);
    const json = JSON.parse(out);
    assert.equal(json.hookSpecificOutput.permissionDecision, 'deny', tool);
    assert.match(json.hookSpecificOutput.permissionDecisionReason, /structure belongs to the Delivery Manager/);
  }
  assert.equal(runHook('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: 'Monitor', tool_input: { command: 'bd dep add x y' } }, { DELIVERY_ROLE: 'other' }), '');
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
  assert.equal(run('bd duplicate old --of ex-2'), null);
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
    const live = fakeBd({ 'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: NOW } });
    assert.match(decideBd({ command, actor: 'a', roleId: 'builder', staleHours: 2, bd: live, now: NOW }).reason, /live claim/, command);
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
  assert.match(run('bd close ex-1 --reason "done"').reason, /live claim/);
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

test('final I1: the builder brief\'s spike close command passes the bd guard and its gate; a spike closed with no reason is a warning, not a block', async () => {
  const brief = fs.readFileSync(path.join(__dirname, '..', '..', 'roles', 'builder.md'), 'utf8');
  const shape = /`(bd close <id> --reason "[^"`]*")`/.exec(brief);
  assert.ok(shape, 'the builder brief documents the spike close command');
  const command = shape[1].replace('<id>', 'ex-demo-spike-cache').replace(/<[^>]*>/g, 'Redis is not needed: Postgres LISTEN covers it');
  const bd = fakeBd({ 'ex-demo-spike-cache': { id: 'ex-demo-spike-cache', status: 'in_progress', assignee: 'a', labels: ['spike'], metadata: {} } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-i1-'));
  assert.equal(decideBd({ command, actor: 'a', roleId: 'builder', staleHours: 2, bd, now: NOW }), null, command);
  assert.deepEqual(await gateChecks({ command, roleId: 'builder', bd, root }), { deny: null, warnings: [] });
  const g = await gateChecks({ command: 'bd close ex-demo-spike-cache', roleId: 'builder', bd, root });
  assert.equal(g.deny, null);
  assert.deepEqual(g.warnings.map((w) => w.kind), ['close-no-reason']);
});

// ---- phase 1a: the ready gate on claim and the done gate on close, replayed on Vault moments ----
const http = require('http');
const G = require('../../scripts/lib/gates.js');
const J = require('../../scripts/lib/judge.js');
const { STORY, makeProject, storyBead, memBd } = require('../../scripts/testing/gate-fixture.js');

const HASH = G.criteriaHash(G.parseStory(STORY).criteria);
const deployed = { ready_hash: HASH, deployed_sha: 'd478', deployed_at: '2026-10-13T07:56:00Z' };
const passRow = (root, n, over = {}) => G.appendEvidence(root, 'ex-vault-0n9-3', { type: 'row', criterion: n, result: 'pass', surface: 'S1', tuple: { host: 'chatgpt.com', app: 'ChatGPT web', mode: 'plain chat', install_artifact: 'connector from the shipped plugin' }, sha: 'd478', by: 'delivery-lead', actor: 'lead@pc/delivery-lead', arm: 'main', at: NOW, ...over });

test('1a close, #478 merged 10-13 07:56 with no pass row on S1: refused naming the criteria; author rows do not count; DM rows on the deployed sha pass', async () => {
  const root = makeProject();
  const bd = memBd([storyBead({ metadata: deployed })]);
  const close = () => gateChecks({ command: 'bd close ex-vault-0n9-3 --reason "EVIDENCE: import works"', roleId: 'builder', bd, root });
  let g = await close();
  assert.match(g.deny, /Close of ex-vault-0n9-3 refused \(D3\)/);
  assert.match(g.deny, /criterion 1: no pass row; criterion 2: no pass row/);
  passRow(root, 1, { by: 'builder', actor: 'dev@pc/builder-1' });
  passRow(root, 2);
  assert.match((await close()).deny, /criterion 1: .* recorded by the author/);
  passRow(root, 1);
  g = await close();
  assert.deepEqual(g, { deny: null, warnings: [] });
});

test('1a close: a story without criteria closes with a recorded warning (the migration path)', async () => {
  const root = makeProject({ story: '---\nid: vault-0n9-3\n---\n# old story\n' });
  const g = await gateChecks({ command: 'bd close ex-vault-0n9-3 --reason "EVIDENCE: done"', roleId: 'builder', bd: memBd([storyBead()]), root });
  assert.equal(g.deny, null);
  assert.deepEqual(g.warnings.map((w) => w.kind), ['close-no-criteria']);
});

test('1a claim: missing measurement plan is a warning; changed criteria (D1) and an area over the unverified cap (D5) are refused', async () => {
  const root = makeProject({ story: STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, '') });
  let g = await gateChecks({ command: 'bd update ex-vault-0n9-3 --claim', roleId: 'builder', bd: memBd([storyBead({ metadata: { ready_hash: HASH } })]), root });
  assert.equal(g.deny, null);
  assert.deepEqual(g.warnings.map((w) => [w.kind, w.rule]), [['measurement-plan', 'R-19']]);
  g = await gateChecks({ command: 'bd update ex-vault-0n9-3 --claim', roleId: 'builder', bd: memBd([storyBead({ metadata: { ready_hash: 'stale0000000' } })]), root });
  assert.match(g.deny, /D1: the story's criteria changed/);
  const merged = ['469', '470', '471'].map((n) => storyBead({ id: `ex-${n}`, labels: ['story', G.STATE.merged] }));
  g = await gateChecks({ command: 'bd update ex-vault-0n9-3 --claim', roleId: 'builder', bd: memBd([...merged, storyBead({ metadata: { ready_hash: HASH } })]), root });
  assert.match(g.deny, /D5: area collection has 3 merged-but-unverified stories \(cap 2/);
});

test('1a: states and gate fields are set only through the gate scripts; a builder writing them is refused', () => {
  const me = 'me@pc/builder-1';
  const bd = fakeBd({ mine: { id: 'mine', status: 'in_progress', assignee: me, updated_at: NOW } });
  const run = (command, roleId = 'builder') => decideBd({ command, actor: me, roleId, staleHours: 2, bd, now: NOW });
  for (const command of ['bd update mine --add-label state-verified', `bd update mine --metadata '{"deployed_sha":"d478"}'`, `bd update mine --metadata '{"ready_hash":"x"}'`]) {
    assert.match(run(command).reason, /set by ready.js and evidence.js/, command);
    assert.equal(run(command, 'delivery-lead'), null, command);
  }
  assert.equal(run('bd update mine --add-label blocked'), null);
});

test('1a judge (fake provider): shippable_unit "partial" at claim and divergence "serious" at close only warn', async () => {
  process.env.TYPESAFE_API_KEY = 'fake';
  const answers = { shippable_unit: { type: 'choice', choice: 'partial', confidence: 0.9 }, divergence: { type: 'choice', choice: 'serious', confidence: 0.95 } };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { const q = Object.keys(JSON.parse(body).questions)[0]; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: 'fake', answers: { [q]: answers[q] } })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const config = J.judgeConfig({ judge: { provider: 'typesafe' } }, { TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/systemone` });
    const root = makeProject();
    const ask = (q, state) => J.ask(q, state, { config, env: { TYPESAFE_API_KEY: 'fake' }, projectRoot: root, gate: 'bd-guard' });
    const bd = memBd([storyBead({ metadata: deployed })]);
    let g = await gateChecks({ command: 'bd update ex-vault-0n9-3 --claim', roleId: 'builder', bd, root, ask });
    assert.equal(g.deny, null);
    assert.deepEqual(g.warnings.map((w) => w.kind), ['shippable-judge']);
    passRow(root, 1); passRow(root, 2);
    g = await gateChecks({ command: 'bd close ex-vault-0n9-3 --reason "Tested the import in Codex mode"', roleId: 'builder', bd, root, ask });
    assert.equal(g.deny, null, 'divergence is warn-only until re-measured');
    assert.deepEqual(g.warnings.map((w) => w.kind), ['divergence-judge']);
  } finally { server.closeAllConnections(); server.close(); }
});

test('1a hook: a close without rows is denied; a claim with a gap is allowed with a warning written to the ledger', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'initiatives', 'vault'), { recursive: true });
  const fixture = makeProject({ story: STORY.replace(/## Measurement plan[\s\S]*?(?=## Shippable)/, '') });
  fs.cpSync(path.join(fixture, '.delivery', 'initiatives'), path.join(projectRoot, '.delivery', 'initiatives'), { recursive: true });
  fs.cpSync(path.join(fixture, '.delivery', 'stories'), path.join(projectRoot, '.delivery', 'stories'), { recursive: true });
  // the probe bd answers every show with this bead, so it has no parent here
  const bead = storyBead({ assignee: 'tester@pc/builder-1', parent: null, updated_at: NOW, metadata: { ready_hash: G.criteriaHash(G.parseStory(STORY).criteria), deployed_sha: 'd478' } });
  const { bin } = probeBd(JSON.stringify([bead]).replace(/'/g, ''), '[]');
  const env = { DELIVERY_ROLE: 'builder-1', BEADS_ACTOR: 'tester@pc/builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const hook = (command) => runHookClean('bd-guard-hook.js', { cwd: roleDir, session_id: 's', tool_name: 'Bash', tool_input: { command } }, env, ['TYPESAFE_API_KEY']);
  const closed = JSON.parse(hook('bd close ex-vault-0n9-3 --reason "EVIDENCE: works"'));
  assert.equal(closed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(closed.hookSpecificOutput.permissionDecisionReason, /criterion 1: no pass row/);
  const claimed = JSON.parse(hook('bd update ex-vault-0n9-3 --claim'));
  assert.equal(claimed.hookSpecificOutput.permissionDecision, undefined);
  assert.match(claimed.systemMessage, /w-builder-1-1 R-19 ex-vault-0n9-3: no Measurement plan/);
  assert.deepEqual(require('../../scripts/lib/warnings.js').list(projectRoot).map((w) => w.kind), ['measurement-plan']);
});
