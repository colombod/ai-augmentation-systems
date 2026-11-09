// scripts/watchdog.test.js — the stall alarm and the wake (R-04, R-43; tight gh polling, R-25), replayed
// on Vault moments through the real lane and bd-guard hooks (testing/role-harness.js), through the host
// job's command line, and through main().
// owner-facing times are the host's local time: the tests read them in UTC
process.env.TZ = 'UTC';
// a role session's own variables are cleared first, as run-tests.js clears them, so a direct run from a
// role session (a reality check) sees what CI sees (hjx.1.1.2)
require('./testing/role-env.js').clearRoleEnv();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const WD = require('./lib/watchdog.js');
const Wn = require('./lib/warnings.js');
const MC = require('../hooks/scripts/message-checks.js');
const { registerInstance } = require('./lib/roster.js');
const { harness } = require('./testing/role-harness.js');
const watchdog = require('./watchdog.js');

const FAKE_CLAUDE = path.join(__dirname, 'testing', 'fake-claude.js');
const COS = 'chief-of-staff';
const DM = 'delivery-lead';
const H = 3600e3;
const iso = (t) => new Date(t).toISOString();

// a usage-limit row as Claude Code writes it in the transcript (undocumented; read from real transcripts)
const limitRow = (at, reset, window = 'seven_day') => ({ type: 'assistant', timestamp: at, isApiErrorMessage: true, error: 'rate_limit', apiError: 'usage_limit_reached',
  quotaLimits: { status: 'rejected', resetsAt: Date.parse(reset) / 1000, rateLimitType: window }, message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Oct 17 at 4pm (Europe/London)" }] } });
const reply = (at, content = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', timestamp: at, message: { model: 'claude-sonnet', role: 'assistant', content } });

function transcript(rows, mtime) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tx-')), 'session.jsonl');
  fs.writeFileSync(f, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}
// a role session on the roster: its role directory from the harness, its transcript, last seen at `seen`
function session(h, instance, { seen, rows, model = 'sonnet' } = {}) {
  const t = rows ? transcript(rows, Date.parse(seen)) : undefined;
  registerInstance(h.root, { instance, session_id: `sess-${instance}`, host: 'pc', model, role_dir: h.roleDir(instance), now: seen, transcript_path: t });
}
const claudeEnv = (log, agents = '[]') => ({ DELIVERY_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_AGENTS: agents });
function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
// the host job as launchd runs it: no role, the project on the command line, the fakes on PATH
function hostJob(h, args, vars) {
  return spawnSync('node', [path.join(__dirname, 'watchdog.js'), ...args, '--project', h.root], { cwd: h.root, encoding: 'utf8',
    env: { ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9', ...vars } });
}
function calls(log, n = 1) {
  const until = Date.now() + 5000;
  for (;;) {
    const rows = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    if (rows.length >= n || Date.now() > until) return rows;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}
// the host job as `watchdog.js install --apply` records it, so a restart can be promised
function markInstalled(h) {
  const job = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-')), 'job.plist');
  fs.writeFileSync(job, '');
  WD.ensureDir(h.root);
  fs.writeFileSync(WD.installedFile(h.root), JSON.stringify({ kind: 'launchd', file: job }));
  return job;
}
const scratchLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-log-')), 'calls.ndjson');

// 10-13 12:06: the weekly limit stops builder-1 on vault-wxy.12 and builder-2 on vault-0n9; it resets 10-17 15:01
const LIMIT = '2026-10-13T12:06:00Z';
const RESET = '2026-10-17T15:01:00Z';
function vaultLimit() {
  const h = harness({ beads: {
    'ex-wxy-12': { id: 'ex-wxy-12', status: 'in_progress', assignee: 'dev@pc/builder-1', priority: 0, updated_at: '2026-10-13T11:40:00Z' },
    'ex-0n9': { id: 'ex-0n9', status: 'in_progress', assignee: 'dev@pc/builder-2', updated_at: '2026-10-13T11:50:00Z' },
    'ex-next': { id: 'ex-next', status: 'open', updated_at: '2026-10-13T09:00:00Z' },
  } });
  session(h, 'builder-1', { seen: LIMIT, rows: [reply('2026-10-13T12:05:00Z'), limitRow(LIMIT, RESET)] });
  session(h, 'builder-2', { seen: LIMIT, rows: [reply('2026-10-13T12:04:00Z'), limitRow(LIMIT, RESET)] });
  session(h, DM, { seen: '2026-10-13T12:00:00Z' });
  markInstalled(h);
  return h;
}
const fakeEnv = (h, more = {}) => ({ ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, GH_FAKE_STORE: path.join(h.root, 'gh-store.json'), PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, ...more });
const at = (h, now, argv, deps = {}) => watchdog.main(argv, { cwd: h.root, env: fakeEnv(h), now, live: [], bd: require('./lib/bd.js').makeBd({ cwd: h.root, env: fakeEnv(h) }), ...deps });

test('R-04 (10-13 12:06 to 10-17 15:01): the weekly limit schedules each holder\'s wake at the reset, and the plan says when the team resumes', () => {
  const h = vaultLimit();
  const spawned = [];
  const spawn = (bin, args, o) => { spawned.push({ args, cwd: o.cwd, role: o.env.DELIVERY_ROLE }); return 1; };
  const c = at(h, '2026-10-13T12:30:00Z', ['check']);
  assert.match(c.out, /^The team resumes at 2026-10-17 15:06 UTC: builder-1 stopped on the seven-day usage limit at 2026-10-13 12:06 UTC, which resets at 2026-10-17 15:01 UTC \(restart scheduled\)\.$/m);
  assert.doesNotMatch(c.out, /Stalled: ex-wxy-12/, 'a holder stopped on the limit is the limit stall, not a second one');
  assert.ok(Wn.list(h.root).some((w) => w.kind === 'usage-limit' && /builder-1 stopped/.test(w.detail)), 'a warning in the ledger');
  // during the 4 days: scheduled, nobody is woken (the owner typed "Try again" twice)
  for (const now of ['2026-10-13T12:30:00Z', '2026-10-15T09:00:00Z', '2026-10-17T15:05:00Z']) {
    assert.match(at(h, now, ['wake'], { spawn }).out, /^Scheduled: builder-1 at 2026-10-17 15:06 UTC\./m);
  }
  assert.equal(spawned.length, 0);
  // the reset: each holder gets its restart note within one 15-minute run, without an owner prompt
  const w = at(h, '2026-10-17T15:15:00Z', ['wake'], { spawn });
  assert.match(w.out, /^Woke builder-1 \(resume of sess-builder-1\)/m);
  assert.deepEqual(spawned.map((s) => s.role).sort(), ['builder-1', 'builder-2']);
  const b1 = spawned.find((s) => s.role === 'builder-1');
  assert.deepEqual(b1.args.slice(0, 5), ['--permission-mode', 'auto', '--resume', 'sess-builder-1', '-p']);
  assert.match(b1.args[5], /The usage limit has reset\. Continue where you stopped: ex-wxy-12 \(bd show ex-wxy-12\)/);
  assert.equal(b1.cwd, h.roleDir('builder-1'), 'in its role directory, with its settings and hooks');
  // at most once an hour per stall
  assert.doesNotMatch(at(h, '2026-10-17T15:30:00Z', ['wake'], { spawn }).out, /Woke/);
  assert.equal(spawned.length, 2);
  assert.deepEqual(WD.logRows(h.root).filter((r) => r.type === 'wake').map((r) => r.mode), ['resume', 'resume']);
});

test('R-04 through the lane: the Chief of Staff\'s plan and the owner\'s brief lead their open problems with the resume time; a role cannot wake anyone', () => {
  const now = Date.now();
  const h = harness({ beads: { 'ex-wxy-12': { id: 'ex-wxy-12', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 2 * H) } } });
  session(h, 'builder-1', { seen: iso(now - H), rows: [limitRow(iso(now - H), iso(now + 3 * H))] });
  markInstalled(h);
  const today = h.bash(COS, `${h.script('plan.js')} today`);
  assert.equal(today.code, 0, today.deny || today.out);
  const resumes = WD.clock(now + 3 * H + WD.RESET_GRACE_MIN * 60e3);
  assert.equal(today.out.split('\n')[1], `The team resumes at ${resumes}, when the usage limit resets (restart scheduled: the watchdog wakes each stopped session then).`);
  const brief = h.bash(COS, `${h.script('plan.js')} brief`);
  // what shipped leads the brief (dec-chief-of-staff-000221); the resume time is the first open problem
  assert.deepEqual(brief.out.split('\n').slice(0, 2), ["So far: nothing new merged, live or checked on the customer's app.", `The team resumes at ${resumes}, when the usage limit resets (restart scheduled).`]);
  assert.deepEqual(MC.idTokens(brief.out, { prefix: 'ex' }), []);
  const check = h.bash(DM, `${h.script('watchdog.js')} check`);
  assert.equal(check.code, 0, check.deny || check.out);
  assert.match(check.out, new RegExp(`^The team resumes at ${resumes}`, 'm'));
  // the wake and the host job are the owner's install, never a session's own move (R-42)
  for (const role of [COS, DM]) for (const cmd of ['wake', 'run', 'install --apply', 'uninstall']) assert.ok(h.bash(role, `${h.script('watchdog.js')} ${cmd}`, { run: false }).deny, `${role} ${cmd}`);
  assert.match(withEnv({ DELIVERY_ROLE: DM }, () => watchdog.main(['wake'], { cwd: h.roleDir(DM), env: process.env })).out, /the host job's/);
});

test('R-04 (wxy.12 unclaimed 15.5 h overnight): a stall line within the hour and a wake of the Delivery Manager', () => {
  const now = Date.now();
  const raised = now - 15.5 * H;
  const h = harness({ beads: {
    'ex-wxy-12': { id: 'ex-wxy-12', status: 'open', priority: 0, created_at: iso(raised), updated_at: iso(raised) },
    'ex-other': { id: 'ex-other', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 10 * 60e3) },
  } });
  session(h, DM, { seen: iso(now - 9 * H) });
  // within the hour: nothing at 59 minutes, the line at 61
  assert.doesNotMatch(at(h, iso(raised + 59 * 60e3), ['check']).out, /Unclaimed/);
  assert.match(at(h, iso(raised + 61 * 60e3), ['check']).out, /^Unclaimed: top-priority ex-wxy-12 has waited 61 min for a claim\.$/m);
  const check = h.bash(DM, `${h.script('watchdog.js')} check`);
  assert.match(check.out, /^Unclaimed: top-priority ex-wxy-12 has waited 15\.5 h for a claim\.$/m);
  assert.ok(Wn.list(h.root).some((w) => w.kind === 'p0-unclaimed' && w.bead === 'ex-wxy-12'));
  // the Chief of Staff's plan: stalls first, routed to the Delivery Manager
  const today = h.bash(COS, `${h.script('plan.js')} today`).out.split('\n');
  const first = today.findIndex((l) => l === '0. Stalls first:');
  assert.ok(first > 0 && first < today.findIndex((l) => /^1\. Owner steps due/.test(l)), today.join('\n'));
  assert.match(today[first + 1], /^ {3}- Delivery Manager \(delivery-lead\): Unclaimed: top-priority ex-wxy-12 .*\[ex-wxy-12\]$/);
  assert.match(h.bash(COS, `${h.script('plan.js')} brief`).out.split('\n')[1], /^A top-priority item has waited 15\.5 h for someone to take it; the Delivery Manager assigns it first\.$/);
  // the host job: the Delivery Manager's session is open and idle, so it is forked, never resumed in place
  const log = scratchLog();
  // 8wz.1: each run puts the project's script launcher back (briefs and reality-check steps name it)
  const launcher = require('./lib/launcher.js').launcherPath(h.root);
  fs.rmSync(path.dirname(launcher), { recursive: true, force: true });
  const run = hostJob(h, ['run'], claudeEnv(log, JSON.stringify([{ sessionId: `sess-${DM}`, kind: 'interactive', status: 'idle' }])));
  assert.equal(run.status, 0, run.stderr);
  assert.ok(fs.existsSync(launcher));
  assert.match(run.stdout, /^Woke delivery-lead \(fork of sess-delivery-lead\)/m);
  const [c] = calls(log);
  assert.deepEqual(c.argv.slice(0, 6), ['--permission-mode', 'auto', '--resume', `sess-${DM}`, '--fork-session', '-p']);
  assert.match(c.argv[6], /^Watchdog \(a host job, not the owner\): Top-priority ex-wxy-12 has waited 15\.5 h unclaimed\. Assign it to a builder now/);
  assert.equal(fs.realpathSync(c.cwd), fs.realpathSync(h.roleDir(DM)));
  assert.equal(c.role, DM);
  // the next run within the hour wakes nobody again
  assert.doesNotMatch(hostJob(h, ['run'], claudeEnv(log)).stdout, /Woke/);
});

test('R-43 and R-42: idle with ready work wakes the Delivery Manager; a busy session is left alone; an owner pause silences the alarm', () => {
  const now = Date.parse('2026-10-12T10:20:00Z');
  const beads = [{ id: 'ex-wxy-2', status: 'open', updated_at: '2026-10-12T09:49:00Z' }];
  const sessions = [{ instance: DM, role: DM, session: 's-dm', roleDir: os.tmpdir(), lastActive: now - H }];
  const r = WD.stalls({ beads, ready: beads, now: iso(now), sessions });
  assert.deepEqual(r.stalls.map((s) => [s.kind, s.target]), [['idle', DM]]);
  assert.match(r.stalls[0].line, /^Idle: 1 ready item and nothing in progress for 31 min, with no owner pause\.$/);
  // "IDLE NOW" sent by the Chief of Staff is no pause: only a verified owner pause holds
  assert.deepEqual(WD.stalls({ beads, ready: beads, now: iso(now), sessions, pause: { paused: true, by: 'dec-chief-of-staff-31' } }), { paused: 'dec-chief-of-staff-31', stalls: [] });
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', [{ sessionId: 's-dm', status: 'busy' }]), { skip: 'it is working (busy)' });
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', []).args, ['--permission-mode', 'auto', '--resume', 's-dm', '-p', 'go']);
  // a resumed session does not keep its mode (it came back in default and stopped at approval prompts
  // no one could answer, on a real team), so every wake names the team's
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', [], 'acceptEdits').args, ['--permission-mode', 'acceptEdits', '--resume', 's-dm', '-p', 'go']);
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', [], 'default').args, ['--resume', 's-dm', '-p', 'go']);
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', [{ sessionId: 's-dm', status: 'idle' }], 'auto').args, ['--permission-mode', 'auto', '--resume', 's-dm', '--fork-session', '-p', 'go']);
  assert.match(WD.wakeCommand(sessions[0], 'go', null).skip, /could not be listed.*alarm only/, 'open sessions unknown: never a fork, never a resume');
  assert.equal(WD.wakeCommand(sessions[0], 'go', [{ sessionId: 's-dm', status: 'idle' }]).mode, 'fork');
  assert.deepEqual(WD.wakeCommand({ ...sessions[0], session: null }, 'go', []).args, ['--permission-mode', 'auto', '-c', '-p', 'go']);
  assert.match(WD.wakeCommand({ ...sessions[0], roleDir: '/nowhere/role' }, 'go', []).skip, /not on this host/);
  // a fresh wake is named <instance>@<team>; the same instance of another team gets another name
  const fresh = (prefix) => WD.wakeCommand({ ...sessions[0], context: WD.FRESH_ABOVE + 1 }, 'go', [], 'auto', { prefix }).args.slice(2, 4);
  assert.deepEqual(fresh('alpha'), ['--name', `${sessions[0].instance}@alpha`]);
  assert.deepEqual(fresh('beta-'), ['--name', `${sessions[0].instance}@beta`]);
});

test('R-04: a bead in progress is stalled only when neither the bead nor its holder\'s session moved for stall_hours', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const beads = [{ id: 'ex-1', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 3 * H) }];
  const s = (lastActive) => [{ instance: 'builder-1', role: 'builder', session: 'b1', roleDir: os.tmpdir(), lastActive }];
  const quiet = WD.stalls({ beads, now: iso(now), sessions: s(now - 2.5 * H) }).stalls;
  assert.equal(quiet[0].line, 'Stalled: ex-1 is in progress with builder-1, and nothing has moved for 2.5 h (the limit is 2 h).');
  assert.equal(quiet[0].target, 'builder-1');
  assert.deepEqual(WD.stalls({ beads, now: iso(now), sessions: s(now - 10 * 60e3) }).stalls, [], 'its session is working');
  // the owner-set limit governs the stall alarm; continuing assigned work is a handover, not an alarm (hjx.1)
  assert.deepEqual(WD.stalls({ beads, now: iso(now), sessions: s(now - 2.5 * H), stallHours: 4 }).stalls.map((x) => x.kind), ['assigned'], 'the owner-set limit applies to the alarm');
  // a holder not on this host's roster: the Delivery Manager releases or reassigns it
  assert.equal(WD.stalls({ beads, now: iso(now), sessions: [] }).stalls[0].target, DM);
});

test('the transcript reader: the last usage limit and its reset; a reply after it means the session went on', () => {
  const rows = [reply('2026-10-13T12:00:00Z'), limitRow(LIMIT, RESET)];
  assert.deepEqual(WD.limitOf(rows), { at: LIMIT, resetsAt: '2026-10-17T15:01:00.000Z', window: 'seven_day', text: "You've hit your weekly limit · resets Oct 17 at 4pm (Europe/London)" });
  assert.equal(WD.limitOf([...rows, reply('2026-10-17T15:10:00Z')]), null);
  assert.equal(WD.limitOf([reply('2026-10-13T12:00:00Z')]), null);
  const unknown = WD.limitOf([{ ...limitRow(LIMIT, RESET), quotaLimits: undefined }]);
  assert.equal(unknown.resetsAt, null);
  const st = WD.stalls({ now: '2026-10-13T13:00:00Z', sessions: [{ instance: 'builder-1', role: 'builder', lastActive: Date.parse(LIMIT), limit: unknown }] }).stalls;
  assert.equal(st[0].due, true, 'no reset time: tried each hour');
  assert.equal(WD.limitOf(WD.tailRows('/nowhere/x.jsonl')), null, 'fails open');
});

test('R-25: a role whose transcript polls gh every 90 s gets a polling warning', () => {
  const now = Date.now();
  const h = harness({});
  const loop = { type: 'tool_use', name: 'Bash', input: { command: 'while true; do gh pr view 471 --json state; sleep 90; done' } };
  session(h, 'progress-observer', { seen: iso(now - 60e3), rows: [reply(iso(now - 120e3), [loop])] });
  const out = h.bash(DM, `${h.script('watchdog.js')} check`).out;
  assert.match(out, /^Polling: progress-observer ran 1 gh polling loop every 90 s; use watch\.js/m);
  assert.ok(Wn.list(h.root).some((w) => w.kind === 'tight-poll' && w.rule === 'R-25'));
  assert.deepEqual(WD.tightPolls([reply(iso(now), [{ type: 'tool_use', input: { command: 'while true; do gh run list; sleep 300; done' } }])]), [], 'every 5 minutes is within the budget');
});


// ---- PR 59 review: role sessions never wake anyone (B1) ----
test('B1: no role, `any` lanes included, can run the wake, the job or a resume in any form; only check passes', () => {
  const h = harness({});
  session(h, DM, { seen: iso(Date.now() - 9 * H) });
  const wd = h.script('watchdog.js');
  const forms = [`${wd} run --project ${h.root}`, `DELIVERY_ROLE= ${wd} wake`, `env -u DELIVERY_ROLE_DIR ${wd} install --apply`, `${wd} uninstall`,
    `true && ${wd} run`, `${wd} check; ${wd} wake`, `bash -c "${wd} run"`, `cd ${path.join(__dirname)} && node -e "require('./watchdog').main(['run'])"`,
    `cd ${__dirname} && node watchdog run`, `node ${h.root}/.delivery/watchdog/job.js`, `${h.root}/.delivery/watchdog/job.js`,
    // quote-split, glob and variable command words, wrappers, substitutions and shells (re-check)
    `cla""ude --resume s -p go`, `node ${__dirname}/watchd?g.js run`, `node ${__dirname}/wat*.js wake`, 'c=claude; $c --resume s', `echo $(${wd} run)`, `timeout 5 ${wd} run`, `nohup ${wd} wake`, 'claude -cp go', 'sh -lc "claude --continue"', `eval "${wd} run"`,
    'claude --resume sess-delivery-lead -p "go"', 'claude -c -p go', '/usr/local/bin/claude --resume s --fork-session -p x', 'claude respawn all'];
  for (const role of ['builder-1', 'spike-researcher', DM, COS, 'progress-observer']) {
    for (const f of forms) assert.ok(h.bash(role, f, { run: false }).deny, `${role}: ${f}`);
    assert.equal(h.bash(role, `${wd} check`, { run: false }).deny, null, `${role} may check`);
    assert.equal(h.bash(role, `${wd} check --json`, { run: false }).deny, null);
    assert.equal(h.bash(role, `${wd} check && bd ready`, { run: false }).deny, null, 'a check chained to a read');
  }
  // naming the file or the flag is not running it (Copilot 039 and the re-check's false refusals)
  for (const ok of ['claude -p "summarise the diff"', 'claude -p "fix the -c flag and the --resume text"', 'git commit -m "use claude -c to continue"',
    'bd update ex-1 --append-notes "watchdog.js check reports a stall"', `git diff -- ${wd.split(' ')[1]}`, `grep -n wake ${wd.split(' ')[1]}`]) assert.equal(h.bash('builder-1', ok, { run: false }).deny, null, ok);
  // the script refuses too: a role directory in or above the working directory, or a role environment
  const log = scratchLog();
  const fromRole = spawnSync('node', [path.join(__dirname, 'watchdog.js'), 'run', '--project', h.root], { cwd: h.roleDir('builder-1'), encoding: 'utf8', env: { ...fakeEnv(h, claudeEnv(log)), DELIVERY_ROLE: '' } });
  assert.equal(fromRole.status, 1);
  assert.match(fromRole.stderr, /is a role directory/);
  const sub = path.join(h.roleDir('builder-1'), 'product');
  assert.equal(watchdog.main(['install', '--apply'], { cwd: sub, env: { ...process.env, DELIVERY_ROLE: '' } }).code, 1);
  assert.match(watchdog.main(['wake'], { cwd: h.root, env: { ...process.env, DELIVERY_ROLE: '', DELIVERY_ROLE_DIR: h.roleDir('builder-1') } }).out, /DELIVERY_ROLE_DIR is set/);
  assert.equal(calls(log, 0).length, 0, 'nobody was woken');
});

// ---- the wake is bounded (B2) ----
// the beads the harness wrote, read without a bd process per run (the long replays run every 15 min for days)
const memStore = (h) => { const b = Object.values(h.db().issues).map((x) => ({ ...x, type: x.type })); return { list: () => b, ready: () => b.filter((x) => x.status === 'open'), show: (id) => b.find((x) => x.id === id) || null }; };
const spawner = () => { const list = []; const fn = (bin, args, o) => { list.push({ args, role: o.env.DELIVERY_ROLE, wake: o.env.DELIVERY_WAKE, bgWait: o.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS }); return 999999999; }; fn.list = list; return fn; };
const every15 = (from, hours) => Array.from({ length: hours * 4 + 1 }, (_, i) => iso(Date.parse(from) + i * 15 * 60e3));

test('B2: staggered P0s wake the Delivery Manager once an hour at most, whatever the number of stalls', () => {
  const t0 = '2026-10-12T22:00:00Z';
  const beads = {};
  for (let i = 0; i < 4; i++) beads[`ex-p${i}`] = { id: `ex-p${i}`, status: 'open', priority: 0, created_at: iso(Date.parse(t0) - H + i * 15 * 60e3) };
  beads['ex-busy'] = { id: 'ex-busy', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(Date.parse(t0) + 10 * H) };
  const h = harness({ beads });
  session(h, DM, { seen: t0 });
  const spawn = spawner();
  const bd = memStore(h);
  for (const now of every15(t0, 3)) at(h, now, ['run'], { spawn, bd });
  assert.ok(spawn.list.length <= 4 && spawn.list.length >= 3, `woken ${spawn.list.length} times in 3 h`);
  const first = spawn.list[0].args[5];
  assert.match(first, /ex-p0/);
});

test('B2: an idle stall nobody resolves is retried with a doubling wait and a daily cap, then only alarmed', () => {
  const t0 = '2026-10-13T12:00:00Z';
  const h = harness({ beads: { 'ex-next': { id: 'ex-next', status: 'open', updated_at: iso(Date.parse(t0) - H) } } });
  session(h, DM, { seen: t0 });
  const spawn = spawner();
  let held = '';
  const bd = memStore(h);
  for (const now of every15(t0, 48)) { const r = at(h, now, ['run'], { spawn, bd }); if (/Alarm only/.test(r.out)) held = r.out; }
  const times = WD.logRows(h.root).filter((r) => r.type === 'wake').map((r) => (Date.parse(r.at) - Date.parse(t0)) / H);
  assert.deepEqual(times, [0, 1, 3, 7, 15, 31], 'waits of 1, 2, 4, 8, 16 h');
  assert.match(held, /^Alarm only: delivery-lead: (?:woken at .*; one wake an hour|woken for these already; waiting longer before the next try)\./m);
  // the daily cap: six wakes in a day for a worker, whatever the keys; the Delivery Manager's day holds
  // 24 (7ax), still one an hour
  const many = harness({});
  session(many, DM, { seen: t0 });
  for (let i = 0; i < WD.DAILY_CAP; i++) WD.log(many.root, { type: 'wake', at: iso(Date.parse(t0) - (23 - i * 3) * H), keys: [`k${i}`], instance: 'builder-1', pid: null });
  const res = { stalls: [{ kind: 'p0', key: 'p0:new', target: 'builder-1', due: true, line: 'Unclaimed: new', prompt: 'go' }], sessions: [] };
  assert.match(WD.plan(res, { root: many.root, now: t0 }).held[0].reason, /woken 6 times in a day; alarm only/);
});

test('B2: a usage limit with no known reset keeps one key and one warning however often the wake is rejected again', () => {
  const t0 = '2026-10-13T12:10:00Z';
  const h = harness({ beads: { 'ex-wxy-12': { id: 'ex-wxy-12', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: '2026-10-13T11:00:00Z' } } });
  markInstalled(h);
  const unknown = (when) => ({ ...limitRow(when, RESET), quotaLimits: { status: 'rejected' } });
  const rows = [reply('2026-10-13T12:00:00Z'), unknown('2026-10-13T12:06:00Z')];
  session(h, 'builder-1', { seen: '2026-10-13T12:06:00Z', rows });
  const tx = require('./lib/roster.js').readRoster(h.root).instances['builder-1'].transcript_path;
  const spawn = spawner();
  for (const now of every15(t0, 24)) {
    const before = spawn.list.length;
    at(h, now, ['run'], { spawn, bd: memStore(h) });
    // each wake is rejected by the limit again: a new limit row in the transcript
    if (spawn.list.length > before) { fs.appendFileSync(tx, `${JSON.stringify(unknown(now))}\n`); fs.utimesSync(tx, Date.parse(now) / 1000, Date.parse(now) / 1000); }
  }
  assert.ok(spawn.list.length <= 5, `woken ${spawn.list.length} times in 24 h`);
  assert.equal(Wn.list(h.root).filter((w) => w.kind === 'usage-limit').length, 1);
  assert.deepEqual([...new Set(WD.logRows(h.root).filter((r) => r.type === 'wake').flatMap((r) => r.keys))], ['limit:builder-1:unknown']);
});

test('B2 and Copilot 416: a session on its own usage limit is woken for nothing before its reset, then once for all of it', () => {
  const t0 = '2026-10-13T12:00:00Z';
  const reset = '2026-10-13T16:00:00Z';
  const h = harness({ beads: { 'ex-next': { id: 'ex-next', status: 'open', updated_at: '2026-10-13T10:00:00Z' } } });
  markInstalled(h);
  session(h, DM, { seen: '2026-10-13T11:50:00Z', rows: [reply('2026-10-13T11:49:00Z'), limitRow('2026-10-13T11:50:00Z', reset, 'five_hour')] });
  const spawn = spawner();
  const bd = memStore(h);
  for (const now of every15(t0, 4)) at(h, now, ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 0, 'not before 16:05');
  assert.match(at(h, '2026-10-13T16:00:00Z', ['wake'], { spawn }).out, /^Scheduled: delivery-lead at 2026-10-13 16:05 UTC\. Idle:/m);
  at(h, '2026-10-13T16:10:00Z', ['run'], { spawn });
  assert.equal(spawn.list.length, 1);
  assert.match(spawn.list[0].args[5], /The usage limit has reset\..*Nothing is in progress although 1 item is ready/);
});

test('B2: a wake whose process still runs is not started again; concurrent host-job runs wake once', () => {
  const now = Date.now();
  const h = harness({ beads: { 'ex-p': { id: 'ex-p', status: 'open', priority: 0, created_at: iso(now - 3 * H) }, 'ex-b': { id: 'ex-b', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now) } } });
  session(h, DM, { seen: iso(now - 2 * H) });
  WD.log(h.root, { type: 'wake', at: iso(now - 2 * H), keys: ['p0:other'], instance: DM, pid: process.pid });
  assert.match(WD.plan(WD.read(h.root, { bd: require('./lib/bd.js').makeBd({ cwd: h.root, env: fakeEnv(h) }), now: iso(now) }), { root: h.root, now: iso(now), alive: (p) => p === process.pid }).held[0].reason, /still running/);
  // the default check: alive and still a wake supervisor (a reused pid is not ours)
  assert.equal(WD.pidAlive(process.pid), false, 'this test process is no wake-run.js');
  const sup = require('child_process').spawn(process.execPath, [path.join(__dirname, 'lib', 'wake-run.js'), '60000', process.execPath, '-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore', detached: true });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  assert.equal(WD.pidAlive(sup.pid), true);
  process.kill(-sup.pid, 'SIGKILL');
  fs.writeFileSync(path.join(h.root, WD.REL, 'wakes.ndjson'), '');
  const log = scratchLog();
  const env = { ...fakeEnv(h, claudeEnv(log)), TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9' };
  const { spawn } = require('child_process');
  const runs = Array.from({ length: 4 }, () => spawn('node', [path.join(__dirname, 'watchdog.js'), 'run', '--project', h.root], { cwd: h.root, env, stdio: 'ignore' }));
  return Promise.all(runs.map((c) => new Promise((r) => c.on('exit', r)))).then(() => {
    calls(log, 2);
    assert.equal(calls(log, 1).length, 1, 'four concurrent runs, one wake');
  });
});

// ---- false alarms (Important 3) and the two surviving mutants ----
test('no false alarm: a blocked P0, a P0 epic, a claimed P0, beads in a stopped area, a holder inside its watch.js wait', () => {
  const now = Date.parse('2026-10-13T08:00:00Z');
  const old = iso(now - 16 * H);
  const p0 = (id, extra = {}) => ({ id, status: 'open', priority: 0, created_at: old, ...extra });
  const stopArea = { paused: false, stops: [{ trigger: 'andon:ev-x-1', area: 'import' }] };
  const busy = { id: 'ex-busy', status: 'in_progress', assignee: 'dev@pc/builder-2', updated_at: iso(now - 60e3) };
  const st = (beads, ready, more = {}) => WD.stalls({ beads: [...beads, busy], ready, now: iso(now), ...more }).stalls.map((s) => s.kind);
  assert.deepEqual(st([p0('ex-a')], [p0('ex-a')]), ['p0'], 'the ready P0 counts');
  assert.deepEqual(st([p0('ex-b')], []), [], 'blocked: not in bd ready');
  assert.deepEqual(st([p0('ex-e', { type: 'epic' })], [p0('ex-e', { type: 'epic' })]), [], 'an epic is not claimed');
  assert.deepEqual(st([p0('ex-c', { assignee: 'dev@pc/builder-1' })], [p0('ex-c', { assignee: 'dev@pc/builder-1' })]), [], 'assigned is claimed');
  const inImport = p0('ex-i', { metadata: { area: 'import' } });
  assert.deepEqual(st([inImport], [inImport], { pause: stopArea }), [], 'a P0 in a stopped area waits for its fix');
  const quiet = { id: 'ex-q', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 5 * H), metadata: { area: 'import' } };
  const b1 = (rows) => ({ instance: 'builder-1', role: 'builder', session: 'b1', roleDir: os.tmpdir(), lastActive: now - 3 * H, limit: WD.limitOf(rows), waitUntil: WD.waitingUntil(rows) });
  assert.deepEqual(st([quiet], [], { sessions: [b1([])] }), ['quiet']);
  assert.deepEqual(st([quiet], [], { sessions: [b1([])], pause: stopArea }), [], 'quiet in a stopped area is the stop, not a stall');
  const waitCmd = (maxH) => [reply(iso(now - 3 * H), [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: `node /p/scripts/watch.js until MERGED --every 5m --max ${maxH}h -- gh pr view 9` } }])];
  assert.deepEqual(st([quiet], [], { sessions: [b1(waitCmd(6))] }), [], 'inside its declared 6 h wait');
  assert.deepEqual(st([quiet], [], { sessions: [b1(waitCmd(2))] }), ['quiet'], 'past its declared limit');
  const ended = [...waitCmd(6), { type: 'user', timestamp: iso(now - 2.9 * H), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Done' }] } }];
  assert.deepEqual(st([quiet], [], { sessions: [b1(ended)] }), ['quiet'], 'the wait ended');
  // a session that went on after its limit row (activity later than the row) is not on the limit
  const lim = [reply(iso(now - 5 * H)), limitRow(iso(now - 4 * H), iso(now + H))];
  const on = { instance: 'builder-1', role: 'builder', session: 'b1', roleDir: os.tmpdir(), lastActive: now - 4 * H, limit: WD.limitOf(lim), waitUntil: -Infinity };
  assert.deepEqual(WD.stalls({ now: iso(now), sessions: [on] }).stalls.map((s) => s.kind), ['limit']);
  assert.deepEqual(WD.stalls({ now: iso(now), sessions: [{ ...on, lastActive: now - 10 * 60e3 }] }).stalls, [], 'active after the limit row');
});

test('one bad transcript line never silences the watchdog; a reset in milliseconds is read as seconds', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tx-')), 's.jsonl');
  fs.writeFileSync(f, ['{"type":"assistant","timestamp":"2026-10-13T12:00:00Z","message":{"content":[]}}', JSON.stringify(limitRow(LIMIT, RESET)), 'null', '42', '{torn'].join('\n'));
  assert.equal(WD.tailRows(f).length, 2, 'null, a number and a torn line are skipped');
  assert.equal(WD.limitOf(WD.tailRows(f)).resetsAt, '2026-10-17T15:01:00.000Z');
  const msRow = { ...limitRow(LIMIT, RESET), quotaLimits: { resetsAt: Date.parse(RESET) } };
  assert.equal(WD.limitOf([msRow]).resetsAt, '2026-10-17T15:01:00.000Z');
  assert.equal(WD.limitOf([{ ...msRow, quotaLimits: { resetsAt: 1e16 } }]).resetsAt, null, 'out of range: unknown, not a crash');
  assert.equal(WD.clock(NaN), 'an unknown time');
  const london = withEnv({ TZ: 'Europe/London' }, () => WD.clock(Date.parse(RESET)));
  assert.equal(london, '2026-10-17 16:01 BST', 'the owner reads the host\'s local time');
});

test('the brief promises a restart only when the job is installed', () => {
  const now = Date.now();
  const h = harness({ beads: { 'ex-w': { id: 'ex-w', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 2 * H) } } });
  session(h, 'builder-1', { seen: iso(now - H), rows: [limitRow(iso(now - H), iso(now + 3 * H))] });
  const brief = h.bash(COS, `${h.script('plan.js')} brief`).out.split('\n')[1];
  assert.equal(brief, `The team is stalled; the watchdog is not installed: the usage limit resets at ${WD.clock(now + 3 * H)}.`);
  assert.doesNotMatch(h.bash(COS, `${h.script('plan.js')} today`).out, /resumes at/);
  assert.match(h.bash(DM, `${h.script('watchdog.js')} check`).out, /^Stalled: builder-1 stopped on the seven-day usage limit .*; the watchdog is not installed, so nothing restarts it \(watchdog\.js install\)\.$/m);
  const job = markInstalled(h);
  assert.match(h.bash(COS, `${h.script('plan.js')} brief`).out, /^The team resumes at .* \(restart scheduled\)\.$/m);
  fs.unlinkSync(job);
  assert.match(h.bash(COS, `${h.script('plan.js')} brief`).out, /^The team is stalled; the watchdog is not installed/m, 'a job file removed by hand is no promise');
});

test('a watchdog fork is recorded beside the owner\'s open session, which stays primary; old forks drop off', () => {
  const h = harness({});
  session(h, DM, { seen: iso(Date.now() - H) });
  const hook = (env) => spawnSync('node', [path.join(__dirname, '..', 'hooks', 'scripts', 'role-session-start.js')], { cwd: h.roleDir(DM), encoding: 'utf8',
    input: JSON.stringify({ session_id: 'fork-1', transcript_path: '/tmp/fork-1.jsonl', cwd: h.roleDir(DM), source: 'resume', hook_event_name: 'SessionStart' }),
    env: { ...fakeEnv(h), DELIVERY_ROLE: DM, DELIVERY_ROLE_DIR: h.roleDir(DM), CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..'), ...env } });
  hook({ DELIVERY_WAKE: 'fork' });
  const R = require('./lib/roster.js');
  let e = R.readRoster(h.root).instances[DM];
  assert.equal(e.session_id, `sess-${DM}`);
  assert.deepEqual(e.forks.map((f) => f.session_id), ['fork-1']);
  R.recordFork(h.root, { instance: DM, session_id: 'fork-2', now: iso(Date.now() + 25 * H) });
  e = R.readRoster(h.root).instances[DM];
  assert.deepEqual(e.forks.map((f) => f.session_id), ['fork-2'], 'a fork older than a day drops off the roster');
});

test('Copilot 395: a verified pause silences the polling warnings as well', () => {
  const now = Date.now();
  const h = harness({});
  const loop = { type: 'tool_use', name: 'Bash', input: { command: 'while true; do gh pr view 471; sleep 90; done' } };
  session(h, 'progress-observer', { seen: iso(now - 60e3), rows: [reply(iso(now - 120e3), [loop])] });
  const bd = require('./lib/bd.js').makeBd({ cwd: h.root, env: fakeEnv(h) });
  assert.equal(WD.read(h.root, { bd, now: iso(now) }).polls.length, 1);
  assert.deepEqual(WD.read(h.root, { bd, now: iso(now), pause: { paused: true, by: 'dec-chief-of-staff-9' } }).polls, []);
});

test('polling warnings flag only gh called and slept on inside a loop', () => {
  const cmds = (list) => WD.tightPolls([reply(iso(Date.now()), list.map((command) => ({ type: 'tool_use', input: { command } })))]).map((p) => p.every);
  assert.deepEqual(cmds(['git commit -m "wait for gh cache" && sleep 2', 'for f in a b; do echo $f; done; gh pr create; sleep 5; gh pr view', 'grep -n watch README.md -n 3; gh pr view 1',
    'while read l; do echo $l; done < x; gh issue list; sleep 10', 'echo "waiting for CI"; gh pr checks 12; sleep 60', 'for i in 1 2; do gh pr view $i; done']), []);
  assert.deepEqual(cmds(['while true; do gh pr view 471; sleep 90; done', 'until gh pr checks 9 | grep -q pass; do sleep 30; done', 'watch -n 20 gh pr list', 'gh run watch 123 --interval 5', 'gh pr checks 12 --watch']), [90, 30, 20, 5, 10]);
});

test('install: dry run by default; --apply writes a job with no versioned path, the shim finds the plugin each run, uninstall removes it all', () => {
  const h = harness({});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const ran = [];
  let tab = 'MAILTO=x\n';
  const exec = (cmd, args, input) => { ran.push([cmd, ...args].join(' ')); if (cmd === 'crontab' && args[0] === '-l') return tab; if (cmd === 'crontab' && args[0] === '-') tab = input; return ''; };
  const env = { ...process.env, DELIVERY_ROLE: '', PATH: '/opt/bin:/usr/bin' };
  const main = (argv, more) => watchdog.main(argv, { cwd: h.root, env, home, exec, ...more });
  const dry = main(['install'], { platform: 'darwin' });
  assert.equal(dry.code, 0);
  assert.match(dry.out, /^Dry run\. The launchd job runs `watchdog\.js run --project .*` every 15 min/);
  assert.match(dry.out, /^To remove it: node .*watchdog\.js uninstall --project /m);
  assert.equal(fs.existsSync(path.join(home, 'Library')), false, 'nothing written');
  assert.equal(fs.existsSync(path.join(h.root, WD.REL, 'job.js')), false);
  assert.deepEqual(ran, []);
  const mac = main(['install', '--apply', '--every', '10m'], { platform: 'darwin' });
  assert.equal(mac.code, 0, mac.out);
  assert.match(mac.out, /^To remove it: /m);
  const plist = path.join(home, 'Library', 'LaunchAgents', fs.readdirSync(path.join(home, 'Library', 'LaunchAgents'))[0]);
  const body = fs.readFileSync(plist, 'utf8');
  const shim = path.join(h.root, WD.REL, 'job.js');
  assert.match(body, new RegExp(`<array><string>/usr/bin/env</string><string>node</string><string>${shim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string></array>`));
  assert.doesNotMatch(body, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no pinned node');
  assert.match(body, /<key>PATH<\/key><string>\/opt\/bin:\/usr\/bin:\/opt\/homebrew\/bin:\/usr\/local\/bin:\/bin:/);
  assert.ok(WD.installedJob(h.root), 'the install is recorded, so the brief may promise a restart');
  assert.ok(ran.some((c) => /^launchctl bootstrap gui\/\d+ /.test(c)));
  // the shim: from a checkout, the checkout; from Claude Code's plugin cache, installed_plugins.json each run
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const job = spawnSync('node', [shim], { cwd: h.root, encoding: 'utf8', env: { ...fakeEnv(h, claudeEnv(scratchLog())), CLAUDE_CONFIG_DIR: cfg, TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9' } });
  assert.equal(job.status, 0, job.stderr);
  assert.match(job.stdout, / watchdog\n/);
  const shimText = fs.readFileSync(shim, 'utf8');
  assert.match(shimText, /installed_plugins\.json/);
  // uninstall, twice
  ran.length = 0;
  const un = main(['uninstall'], { platform: 'darwin' });
  assert.match(un.out, /^Ran: launchctl bootout gui\/\d+ /m);
  for (const f of [plist, shim, WD.installedFile(h.root)]) assert.equal(fs.existsSync(f), false, f);
  assert.match(main(['uninstall'], { platform: 'darwin' }).out, /^Nothing to remove: no watchdog job for /);
  // systemd: KillMode=process so the wake outlives the oneshot run (Copilot 440); PATH quoted
  const linux = main(['install', '--apply'], { platform: 'linux', has: () => true });
  assert.equal(linux.code, 0, linux.out);
  assert.match(linux.out, /loginctl enable-linger/);
  const unit = path.join(home, '.config', 'systemd', 'user');
  const service = fs.readFileSync(path.join(unit, fs.readdirSync(unit).find((f) => f.endsWith('.service'))), 'utf8');
  // TasksMax fits the team: the wakes the run starts stay in this service's cgroup (hjx.1.6.14)
  assert.match(service, /^TasksMax=\d+$/m);
  assert.ok(Number(/^TasksMax=(\d+)$/m.exec(service)[1]) >= 4096);
  for (const re of [/^KillMode=process$/m, /^Environment="PATH=\/opt\/bin:/m, /^ExecStart=\/usr\/bin\/env "node" ".*job\.js"$/m]) assert.match(service, re);
  assert.equal(main(['uninstall'], { platform: 'linux', has: () => true }).code, 0);
  assert.deepEqual(fs.readdirSync(unit), []);
  // cron: only an interval that divides the hour keeps its cadence (Copilot 471)
  const cronOnly = (c) => c === 'crontab';
  assert.equal(main(['install', '--apply', '--every', '45m'], { platform: 'linux', has: cronOnly }).code, 2);
  assert.match(main(['install', '--every', '7m'], { platform: 'linux', has: cronOnly }).out, /must divide the hour/);
  assert.equal(main(['install', '--apply', '--every', '1h'], { platform: 'linux', has: cronOnly }).code, 0);
  assert.match(tab, /^MAILTO=x\n0 \* \* \* \* cd .* '\/usr\/bin\/env' 'node' '.*job\.js' >> .* # delivery-watchdog [0-9a-f]{8}\n$/);
  assert.equal(main(['install', '--apply', '--every', '20m'], { platform: 'linux', has: cronOnly }).code, 0);
  assert.equal(tab.split('\n').filter((l) => l.includes('# delivery-watchdog')).length, 1, 'a second install replaces the line');
  main(['uninstall'], { platform: 'linux', has: cronOnly });
  assert.equal(tab, 'MAILTO=x\n');
  // dlv-4oj: a host with neither systemd nor crontab (Claude Code's cloud container) is told so, with the way out, and nothing is written
  ran.length = 0;
  const none = main(['install', '--apply'], { platform: 'linux', has: () => false });
  assert.equal(none.code, 1);
  assert.match(none.out, /^watchdog\.js: this host has no scheduler \(no systemctl, no crontab\), so the watchdog cannot run on its own here: .*Run the team on an always-on host/);
  assert.deepEqual(ran, []);
  assert.equal(fs.existsSync(path.join(h.root, WD.REL, 'job.js')), false);
  assert.equal(main(['install'], { platform: 'linux', has: () => false }).code, 1, 'the dry run says so too');
  assert.equal(main(['install', '--every', '1m'], { platform: 'darwin' }).code, 2, 'under 5 minutes is refused');
});

test('the job runs the install local to its project, else the user\'s, else the newest; never an older one local to a role directory', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  const cache = path.join(cfg, 'plugins', 'cache', 'm', 'delivery');
  const plugin = (v) => {
    const d = path.join(cache, v);
    fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(d, 'scripts', 'watchdog.js'), `console.log('ran ${v}');`);
    return d;
  };
  const entry = (v, more) => ({ installPath: plugin(v), version: v, ...more });
  const list = (entries) => fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'delivery@m': entries } }));
  const shim = path.join(project, 'job.js');
  fs.writeFileSync(shim, watchdog.shimBody(project, path.join(cache, '0.40.0'), cfg));
  plugin('0.40.0');
  const ran = () => spawnSync('node', [shim], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } }).stdout.trim();
  // the host's real case: the user's 0.43.3 listed first, role directories' older local installs after it
  list([entry('0.43.3', { scope: 'user' }), entry('0.41.2', { scope: 'local', projectPath: '/team/delivery-lead' }), entry('0.43.0', { scope: 'local', projectPath: '/team/spike-researcher' })]);
  assert.equal(ran(), 'ran 0.43.3');
  // an install local to the job's own project comes first, whatever its version
  list([entry('0.43.3', { scope: 'user' }), entry('0.42.0', { scope: 'local', projectPath: project })]);
  assert.equal(ran(), 'ran 0.42.0');
  // no user install: the newest of the rest, by version, not by order
  list([entry('0.43.10', { scope: 'local', projectPath: '/a' }), entry('0.43.9', { scope: 'local', projectPath: '/b' })]);
  assert.equal(ran(), 'ran 0.43.10');
});

test('the wake log, the job log and the wake logs stay bounded', () => {
  const h = harness({});
  WD.ensureDir(h.root);
  fs.writeFileSync(path.join(h.root, WD.REL, 'wakes.ndjson'), 'x'.repeat(WD.LOG_MAX_BYTES + 1));
  WD.log(h.root, { type: 'skip', at: iso(Date.now()) });
  assert.ok(fs.existsSync(path.join(h.root, WD.REL, 'wakes.ndjson.1')));
  assert.equal(WD.logRows(h.root).length, 1);
});

// ---- Copilot on 7f0af37 ----
test('Copilot 984 and 169: a project path with spaces runs from every scheduler, with the installer\'s CLAUDE_CONFIG_DIR', () => {
  const now = Date.now();
  const spaced = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-')), 'My Project');
  fs.cpSync(require('./testing/gate-fixture.js').makeProject(), spaced, { recursive: true });
  const h = harness({ root: spaced, beads: { 'ex-p': { id: 'ex-p', status: 'open', priority: 0, created_at: iso(now - 3 * H) }, 'ex-b': { id: 'ex-b', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now) } } });
  session(h, DM, { seen: iso(now - 2 * H) });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'claude config');
  let tab = '';
  const exec = (cmd, args, input) => { if (cmd === 'crontab' && args[0] === '-l') return tab; if (cmd === 'crontab') tab = input; return ''; };
  const env = { ...fakeEnv(h), CLAUDE_CONFIG_DIR: cfg };
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, home, exec, platform: 'linux', has: () => true }).code, 0);
  const unit = path.join(home, '.config', 'systemd', 'user');
  const service = fs.readFileSync(path.join(unit, fs.readdirSync(unit).find((f) => f.endsWith('.service'))), 'utf8');
  assert.match(service, new RegExp(`^ExecStart=/usr/bin/env "node" "${spaced.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.delivery/watchdog/job\\.js"$`, 'm'));
  assert.match(service, /^Environment="CLAUDE_CONFIG_DIR=.*\/claude config"$/m);
  assert.equal(watchdog.main(['install', '--apply', '--every', '15m'], { cwd: h.root, env, home, exec, platform: 'darwin' }).code, 0);
  const plist = fs.readFileSync(path.join(home, 'Library', 'LaunchAgents', fs.readdirSync(path.join(home, 'Library', 'LaunchAgents'))[0]), 'utf8');
  assert.match(plist, /<key>CLAUDE_CONFIG_DIR<\/key><string>[^<]*\/claude config<\/string>/);
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, home, exec, platform: 'linux', has: (c) => c === 'crontab' }).code, 0);
  // run the cron line as cron would, with no CLAUDE_CONFIG_DIR in its environment: the job still uses the installer's
  const log = scratchLog();
  const line = tab.trim().replace(/^\S+ \S+ \S+ \S+ \S+ /, '').replace(/ # delivery-watchdog \w+$/, '');
  const cronEnv = { ...fakeEnv(h, claudeEnv(log)), TYPESAFE_API_KEY: 'fake', DELIVERY_JUDGE_ENDPOINT: 'http://127.0.0.1:9', HOME: home };
  delete cronEnv.CLAUDE_CONFIG_DIR;
  const ran = spawnSync('bash', ['-c', line.replace(/PATH='[^']*'/, `PATH='${cronEnv.PATH}'`)], { env: cronEnv, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  const [c] = calls(log);
  assert.equal(c.role, DM);
  assert.equal(c.config, cfg, 'the wake uses the installer\'s Claude configuration');
  assert.match(fs.readFileSync(path.join(h.root, WD.REL, 'job.log'), 'utf8'), /Woke delivery-lead/);
  // the shim alone, from an environment with no CLAUDE_CONFIG_DIR, restores the installer's
  fs.writeFileSync(path.join(h.root, WD.REL, 'wakes.ndjson'), '');
  const shim = spawnSync('node', [path.join(h.root, WD.REL, 'job.js')], { cwd: h.root, env: cronEnv, encoding: 'utf8' });
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(calls(log, 2)[1].config, cfg);
});

test('Copilot 092: a watchdog fork on the usage limit holds the next wake until its reset; a later reply clears it', () => {
  const now = Date.parse('2026-10-13T14:00:00Z');
  const h = harness({ beads: { 'ex-next': { id: 'ex-next', status: 'open', updated_at: '2026-10-13T10:00:00Z' } } });
  markInstalled(h);
  session(h, DM, { seen: '2026-10-13T11:00:00Z', rows: [reply('2026-10-13T11:00:00Z')] });
  const forkTx = transcript([reply('2026-10-13T12:00:00Z'), limitRow('2026-10-13T12:10:00Z', '2026-10-13T17:00:00Z', 'five_hour')], Date.parse('2026-10-13T12:10:00Z'));
  require('./lib/roster.js').recordFork(h.root, { instance: DM, session_id: 'fork-1', transcript_path: forkTx, now: '2026-10-13T12:00:00Z' });
  const spawn = spawner();
  const out = at(h, iso(now), ['run'], { spawn, bd: memStore(h) }).out;
  assert.equal(spawn.list.length, 0, out);
  assert.match(out, /^Scheduled: delivery-lead at 2026-10-13 17:05 UTC\. Idle:/m);
  // the owner's primary session went on after the fork's limit row: no limit any more
  const primary = require('./lib/roster.js').readRoster(h.root).instances[DM].transcript_path;
  fs.appendFileSync(primary, `${JSON.stringify(reply('2026-10-13T13:00:00Z'))}\n`);
  fs.utimesSync(primary, Date.parse('2026-10-13T13:00:00Z') / 1000, Date.parse('2026-10-13T13:00:00Z') / 1000);
  at(h, iso(now), ['run'], { spawn, bd: memStore(h) });
  assert.equal(spawn.list.length, 1);
});

test('Copilot 118: an operator\'s own watchdog.js wake resumes a session after its reset without the installed job', () => {
  const h = vaultLimit();
  fs.unlinkSync(WD.installedFile(h.root));
  const spawn = spawner();
  const c = at(h, '2026-10-13T12:30:00Z', ['check']).out;
  assert.match(c, /^Stalled: builder-1 stopped .*; the watchdog is not installed, so nothing restarts it/m);
  const w = at(h, '2026-10-17T15:15:00Z', ['wake'], { spawn });
  assert.match(w.out, /^Woke builder-1 \(resume of sess-builder-1\)/m);
  assert.equal(spawn.list.length, 2);
});

test('Copilot 144: a wake is stopped after its limit, and the guard covers it while it runs', () => {
  const t0 = Date.now();
  const r = spawnSync('node', [path.join(__dirname, 'lib', 'wake-run.js'), '300', process.execPath, '-e', 'setTimeout(() => {}, 20000)'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ran past its limit/);
  assert.ok(Date.now() - t0 < 10000);
  assert.equal(spawnSync('node', [path.join(__dirname, 'lib', 'wake-run.js'), '5000', process.execPath, '-e', 'process.exit(3)']).status, 3, 'the wake\'s own exit');
  const h = harness({});
  const now = Date.parse('2026-10-13T12:00:00Z');
  const res = { stalls: [{ kind: 'p0', key: 'p0:x', target: DM, due: true, line: 'Unclaimed: x', prompt: 'go' }], sessions: [] };
  WD.log(h.root, { type: 'wake', at: iso(now - 2.5 * H), keys: ['p0:y'], instance: DM, pid: 12345 });
  assert.match(WD.plan(res, { root: h.root, now: iso(now), alive: () => true }).held[0].reason, /still running/);
  assert.equal(WD.plan(res, { root: h.root, now: iso(now + 1.5 * H), alive: () => false }).wakes.length, 1, 'a supervisor gone frees the session');
  assert.equal(WD.WAKE_TIMEOUT_H, 2);
});

// ---- Copilot on 1336e29 ----
test('Copilot 716 and 749: compound commands and the job shim are judged too; the CLI check still passes', () => {
  const h = harness({});
  const wd = h.script('watchdog.js');
  const shim = `${h.root}/.delivery/watchdog/job.js`;
  for (const f of ['if true; then claude --resume s -p go; fi', `while true; do ${wd} run; done`, '{ claude -c -p x; }', '(claude --resume s)', `f() { ${wd} wake; }; f`,
    '! claude --resume s', 'for i in 1; do claude --continue; done', 'if claude --resume s; then true; fi', 'case x in x) claude -c ;; esac',
    'function f { claude --resume s; }', `function g { node ${shim}; }`,
    `node ${shim} check`, `cd ${h.root} && env -u DELIVERY_ROLE -u DELIVERY_ROLE_ID -u DELIVERY_ROLE_DIR node ${shim} check`, `${shim} check --json`]) {
    assert.ok(h.bash('builder-1', f, { run: false }).deny, f);
  }
  assert.equal(h.bash('builder-1', `${wd} check`, { run: false }).deny, null);
  assert.equal(h.bash('builder-1', `if true; then ${wd} check; fi`, { run: false }).deny, null, 'the CLI check inside a compound command');
});

test('Copilot 144 again: no replacement wake while the last wake\'s process group lives, however long ago it started', () => {
  const h = harness({});
  const now = Date.parse('2026-10-13T12:00:00Z');
  const res = { stalls: [{ kind: 'p0', key: 'p0:x', target: DM, due: true, line: 'Unclaimed: x', prompt: 'go' }], sessions: [] };
  WD.log(h.root, { type: 'wake', at: iso(now - 10 * H), keys: ['p0:y'], instance: DM, pid: 4242 });
  assert.match(WD.plan(res, { root: h.root, now: iso(now), alive: () => true }).held[0].reason, /still running/);
  assert.equal(WD.plan(res, { root: h.root, now: iso(now), alive: () => false }).wakes.length, 1);
});

test('Copilot 857: a timed-out wake is stopped with its whole process group, its tool subprocesses included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-'));
  const pidFile = path.join(dir, 'grandchild');
  const code = `const c = require('child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
  const t0 = Date.now();
  const r = spawnSync('node', [path.join(__dirname, 'lib', 'wake-run.js'), '500', process.execPath, '-e', code], { encoding: 'utf8', env: { ...process.env, DELIVERY_WAKE_KILL_GRACE_MS: '300' }, detached: true });
  assert.notEqual(r.status, 0);
  assert.ok(Date.now() - t0 < 15000);
  const gc = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return false; } };
  const until = Date.now() + 3000;
  while (alive(gc) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  assert.equal(alive(gc), false, 'the subprocess that ignored SIGTERM was killed');
  // SIGTERM goes to the whole group first: a subprocess that honours it is gone well before the SIGKILL
  const pid3 = path.join(dir, 'gc3');
  const polite = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pid3)}, String(c.pid)); setInterval(() => {}, 1000);`;
  const t1 = Date.now();
  spawnSync('node', [path.join(__dirname, 'lib', 'wake-run.js'), '500', process.execPath, '-e', polite], { env: { ...process.env, DELIVERY_WAKE_KILL_GRACE_MS: '20000' }, detached: true });
  assert.ok(Date.now() - t1 < 8000, 'the group took SIGTERM; no wait for the SIGKILL');
  assert.equal(alive(Number(fs.readFileSync(pid3, 'utf8'))), false);
  // a wake that exits at once leaves no subprocess behind either
  const pid2 = path.join(dir, 'gc2');
  const left = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pid2)}, String(c.pid)); c.unref();`;
  assert.equal(spawnSync('node', [path.join(__dirname, 'lib', 'wake-run.js'), '60000', process.execPath, '-e', left], { env: { ...process.env, DELIVERY_WAKE_KILL_GRACE_MS: '300' }, detached: true }).status, 0);
  const g2 = Number(fs.readFileSync(pid2, 'utf8'));
  const until2 = Date.now() + 3000;
  while (alive(g2) && Date.now() < until2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  assert.equal(alive(g2), false);
});

test('Copilot 829: a crontab that cannot be read is never replaced; only "no crontab" counts as empty', () => {
  const h = harness({});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const writes = [];
  const fail = (stderr) => (cmd, args, input) => { if (cmd === 'crontab' && args[0] === '-l') { const e = new Error('crontab failed'); e.stderr = stderr; e.status = 1; throw e; } if (cmd === 'crontab') writes.push(input); return ''; };
  const env = { ...process.env, DELIVERY_ROLE: '' };
  const r = watchdog.main(['install', '--apply'], { cwd: h.root, env, home, platform: 'linux', has: (c) => c === 'crontab', exec: fail('crontab: cannot open your crontab: Permission denied') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /crontab could not be read/);
  assert.deepEqual(writes, []);
  assert.equal(watchdog.main(['uninstall'], { cwd: h.root, env, home, platform: 'linux', has: (c) => c === 'crontab', exec: fail('crontab: cannot open your crontab: Permission denied') }).code, 1);
  assert.deepEqual(writes, []);
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, home, platform: 'linux', has: (c) => c === 'crontab', exec: fail('no crontab for dev') }).code, 0);
  assert.equal(writes.length, 1);
});

test('review: `gh run watch` with no interval polls every 3 s; the documented resume bound is the grace plus one job interval', () => {
  const p = (command) => WD.tightPolls([reply(iso(Date.now()), [{ type: 'tool_use', input: { command } }])]).map((x) => x.every);
  assert.deepEqual(p('gh run watch 123'), [3]);
  assert.deepEqual(p('gh run watch 123 --interval 300'), []);
  const ref = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference.md'), 'utf8');
  assert.match(ref, /within\s+the\s+5-minute\s+grace\s+plus\s+one\s+job\s+interval\s+of\s+the\s+reset\s+\(at\s+most\s+20\s+minutes\s+at\s+the\s+default\s+`--every 15m`/);
});

// ---- Copilot on aaea37c ----
test('Copilot 068 and review 1: only execution positions and real substitutions are judged; literals and passive arguments pass', () => {
  const h = harness({});
  const wd = h.script('watchdog.js');
  for (const ok of ['rg claude -c src', "printf '%s\\n' watchdog.js run", "bd update ex-1 --append-notes 'Use `claude --resume sess` after the reset'",
    "git commit -m 'docs: `claude -c` continues a session'", 'echo "\\`claude -c\\` is escaped"', 'echo \\`claude --resume s\\`', 'bash -x build.sh watchdog.js run', 'grep -rn "claude --resume" docs']) {
    assert.equal(h.bash('builder-1', ok, { run: false }).deny, null, ok);
  }
  for (const no of ['git commit -m "docs: `claude -c`"', 'echo "$(claude --resume s)"', `bash ${wd.split(' ')[1]} run`, 'case x in y) true ;; x) claude -c ;; esac',
    `function g { ${wd} wake; }`, 'echo x | xargs claude --resume']) {
    assert.ok(h.bash('builder-1', no, { run: false }).deny, no);
  }
});

test('review 2: a stall item sent to another builder is a misroute and stays unrouted', () => {
  const DP = require('./lib/daily-plan.js');
  const h = harness({});
  const team = JSON.parse(fs.readFileSync(path.join(h.root, '.delivery', 'team', 'team.json'), 'utf8'));
  const at0 = new Date().toISOString();
  fs.mkdirSync(path.join(h.root, DP.REL), { recursive: true });
  const it = { section: 0, kind: 'stall', fn: 'stall', ref: 'ex-q', key: 'stall:ex-q', role: 'builder', instance: 'builder-1', action: 'Stalled: ex-q', plain: 'x', match: ['ex-q'] };
  fs.writeFileSync(path.join(h.root, DP.REL, `${DP.today(at0)}.ndjson`), `${JSON.stringify({ seq: 1, type: 'plan', at: at0, items: [it], states: {} })}\n`);
  const wrong = DP.noteSent(h.root, { team, to: 'builder-2', message: 'please [ex-q]', now: at0 });
  assert.equal(wrong.misroutes.length, 1);
  assert.deepEqual(DP.unrouted(h.root, { now: at0 }).open.map((x) => x.key), ['stall:ex-q']);
  assert.equal(DP.noteSent(h.root, { team, to: 'builder-1', message: 'please [ex-q]', now: at0 }).misroutes.length, 0);
  assert.deepEqual(DP.unrouted(h.root, { now: at0 }).open, []);
});

test('reviews 3 to 5: a quoted watcher path, sleep suffixes, quoted loop text, and host-sharded ledger files', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const use = (command, at = iso(now)) => [reply(at, [{ type: 'tool_use', id: 'w1', input: { command } }])];
  assert.equal(WD.waitingUntil(use("node '/opt/My Plugins/scripts/watch.js' until MERGED --every 5m --max 6h -- gh pr view 9")), now + 6 * H);
  const p = (command) => WD.tightPolls(use(command)).map((x) => x.every);
  assert.deepEqual(p('while true; do gh pr view 1; sleep 5m; done'), [], '5 minutes');
  assert.deepEqual(p('while true; do gh pr view 1; sleep 0.5m; done'), [30]);
  assert.deepEqual(p('while true; do gh pr view 1; sleep 1h; done'), []);
  assert.deepEqual(p('echo "while true; do gh pr view; sleep 5; done"'), [], 'loop text in a quoted argument is not a loop');
  assert.deepEqual(p("bash -c 'while true; do gh pr view 1; sleep 5; done'"), [5], 'a loop a shell runs is');
  const h = harness({});
  WD.recordAll(h.root, { stalls: [{ kind: 'p0', bead: 'ex-1', detail: 'P0 open and unclaimed since x' }] }, [], { now: iso(now) });
  const files = fs.readdirSync(Wn.dirOf(h.root)).filter((f) => f.endsWith('.ndjson'));
  assert.deepEqual(files.map((f) => /^local-[0-9a-f]{8}\.ndjson$/.test(f)), [true], files.join(','));
});

// ---- Copilot on e3a7b28 ----
test('Copilot 512: a leading redirection is not the command word', () => {
  const h = harness({});
  const wd = h.script('watchdog.js');
  for (const no of ['2>/dev/null claude --resume s -p go', '>f claude -c', '<f claude --resume s', '2>&1 claude --continue', '&>f claude --resume s', '> /tmp/x claude -c', `2> /dev/null ${wd} run`, '>>log 2>&1 claude --resume s']) {
    assert.ok(h.bash('builder-1', no, { run: false }).deny, no);
  }
  assert.equal(h.bash('builder-1', 'claude -p "hi" 2>/dev/null', { run: false }).deny, null);
  assert.equal(h.bash('builder-1', `2>/dev/null ${wd} check`, { run: false }).deny, null);
});

test('Copilot 583: a watchdog fork records and reads its own session, never the owner\'s primary one', () => {
  const h = harness({});
  const dir = h.roleDir('builder-1');
  fs.writeFileSync(path.join(dir, '.delivery-session'), 'primary-1');
  fs.writeFileSync(path.join(dir, '.delivery-transcript'), '/tmp/primary-1.jsonl');
  const tx = transcript([reply(iso(Date.now()))], Date.now());
  const cap = require('../hooks/scripts/operator-capture.js');
  withEnv({ DELIVERY_WAKE: 'fork', DELIVERY_WAKE_ID: 'w1', DELIVERY_ROLE: 'builder-1', DELIVERY_ROLE_DIR: dir, BD_FAKE_STORE: h.store }, () => cap.captureFromHookInput({ session_id: 'fork-1', transcript_path: tx, cwd: dir, hook_event_name: 'Stop' }, path.join(__dirname, '..')));
  assert.equal(fs.readFileSync(path.join(dir, '.delivery-session'), 'utf8').trim(), 'primary-1', 'the primary locator is unchanged');
  const R = require('./lib/roster.js');
  const loc = R.sessionLocator(dir, { DELIVERY_WAKE: 'fork', DELIVERY_WAKE_ID: 'w1' });
  assert.equal(fs.readFileSync(loc.session, 'utf8').trim(), 'fork-1');
  assert.equal(fs.readFileSync(loc.transcript, 'utf8').trim(), tx);
  assert.equal(R.sessionLocator(dir, {}).session, path.join(dir, '.delivery-session'));
  // operator.js inside the fork knows the fork's id: --session primary-1 is not its own
  const op = h.script('operator.js');
  const mine = h.bash('builder-1', `DELIVERY_WAKE=fork DELIVERY_WAKE_ID=w1 ${op} sync --session primary-1`);
  assert.match(mine.out, /--session primary-1 is not this session's own id/);
  const own = h.bash('builder-1', `DELIVERY_WAKE=fork DELIVERY_WAKE_ID=w1 ${op} sync --session fork-1`);
  assert.doesNotMatch(own.out, /is not this session's own id/);
  // a fork with no locator yet never takes the owner's transcript on the roster as its own
  const ptx = transcript([reply(iso(Date.now()))], Date.now());
  registerInstance(h.root, { instance: 'builder-1', session_id: 'primary-1', host: 'pc', model: 'sonnet', role_dir: dir, now: iso(Date.now()), transcript_path: ptx });
  fs.unlinkSync(path.join(dir, '.delivery-transcript'));
  const theirs = h.bash('builder-1', `DELIVERY_WAKE=fork DELIVERY_WAKE_ID=w2 ${op} sync --transcript ${ptx}`);
  assert.match(theirs.out, /is not this session's own transcript \(none is registered yet\)/);
  // the wake hands each fork its own id
  const spawn = spawner();
  const hw = harness({ beads: { 'ex-p': { id: 'ex-p', status: 'open', priority: 0, created_at: iso(Date.now() - 3 * H) }, 'ex-b': { id: 'ex-b', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(Date.now()) } } });
  session(hw, DM, { seen: iso(Date.now() - 2 * H) });
  const ids = [];
  at(hw, iso(Date.now()), ['wake'], { spawn: (bin, args, o) => { ids.push(o.env.DELIVERY_WAKE_ID); return 1; }, live: [{ sessionId: `sess-${DM}`, status: 'idle' }] });
  assert.match(ids[0] || '', /^[a-z0-9-]{8,}$/);
});

test('review 3 on e3a7b28: a % in the project path, PATH or CLAUDE_CONFIG_DIR is escaped for cron', () => {
  const j = watchdog.jobFiles('/srv/100%/proj', { platform: 'linux', home: '/srv/h', sec: 900, env: { PATH: '/opt/50%/bin', CLAUDE_CONFIG_DIR: '/srv/c%fg' }, has: () => false });
  assert.doesNotMatch(j.cron.line.replace(/\\%/g, ''), /%/, 'every % escaped');
  const asCronRuns = j.cron.line.replace(/\\%/g, '%');
  for (const want of ["'/srv/100%/proj'", "/opt/50%/bin", "'/srv/c%fg'"]) assert.ok(asCronRuns.includes(want), want);
});

// A launched team runs one turn at a time, so a message to a role between its turns fails with
// "No agent named '<x>' is reachable" and was lost (measured 2026-10-25). The SendMessage hook keeps it;
// the watchdog wakes the target with it.
test('a send to a role that is not running is kept for it; a delivered send is not', () => {
  const h = harness({});
  const RC = require('../hooks/scripts/route-check.js');
  const IB = require('./lib/inbox.js');
  const failed = [{ type: 'text', text: JSON.stringify({ success: false, message: "No agent named 'chief-of-staff' is reachable.\nUse ListAgents to see everyone you can message." }) }];
  const as = (fn) => withEnv({ DELIVERY_ROLE: 'builder-1' }, fn);
  session(h, COS, { seen: new Date().toISOString() });
  const r = as(() => RC.check({ tool_name: 'SendMessage', cwd: h.roleDir('builder-1'), tool_input: { to: 'chief-of-staff', summary: 'dlv-1 blocked', message: 'the story is not on master' }, tool_response: failed }));
  assert.match(r.context, /^chief-of-staff is not running, so the message is kept for it: the watchdog wakes chief-of-staff with it/);
  const p = IB.pending(h.root);
  assert.equal(p.length, 1);
  assert.equal(p[0].to, 'chief-of-staff');
  assert.equal(p[0].entries[0].from, 'builder-1');
  assert.equal(p[0].entries[0].message, 'the story is not on master');
  const sent = as(() => RC.check({ tool_name: 'SendMessage', cwd: h.roleDir('builder-1'), tool_input: { to: 'delivery-lead', message: 'x' }, tool_response: [{ type: 'text', text: JSON.stringify({ success: true }) }] }));
  assert.equal(sent, null);
  assert.equal(IB.pending(h.root).length, 1, 'a delivered send is not kept');
});

// dlv-efp: the Delivery Manager and the builder sent "open the PR" to "steward", a duty in team.json and
// no session's name; it was kept under that name and the watchdog reported it unwoken at every run for
// over an hour. A name no role answers to is now refused at send, "steward" goes to the host's steward,
// and a role never started is kept with the sender told nobody can wake it.
test('dlv-2ex: a send to no role is refused with the roles there are; "steward" reaches the host\'s steward', () => {
  const h = harness({});
  const RC = require('../hooks/scripts/route-check.js');
  const IB = require('./lib/inbox.js');
  const failed = (to) => [{ type: 'text', text: JSON.stringify({ success: false, message: `No agent named '${to}' is reachable.` }) }];
  const send = (to) => withEnv({ DELIVERY_ROLE: DM }, () => RC.check({ tool_name: 'SendMessage', cwd: h.roleDir(DM), tool_input: { to, message: 'open the PR' }, tool_response: failed(to) }));
  const nobody = send('stewart');
  assert.match(nobody.context, /^stewart is not a role on this team, so the message was not kept/);
  assert.match(nobody.context, /Send it to one of: chief-of-staff, .*builder-1, builder-2/);
  assert.equal(IB.pending(h.root).length, 0, 'nothing kept for a name no session has');
  const never = send('steward');
  assert.match(never.context, /^builder-1 \(this host's steward\) has never been started on this team/);
  assert.deepEqual(IB.pending(h.root).map((p) => p.to), ['builder-1']);
  session(h, 'builder-1', { seen: new Date().toISOString() });
  assert.match(send('steward').context, /^builder-1 \(this host's steward\) is not running, so the message is kept/);
  session(h, DM, { seen: new Date().toISOString() });
  assert.match(send('delivery-manager').context, /^delivery-lead is not running/, 'the role alias still resolves');
  // sessions are named <instance>@<team>: this team's qualified name is kept for its instance, another
  // team's (same role, other prefix) is no session of this team and is not kept
  const before = IB.pending(h.root).find((p) => p.to === 'builder-1').entries.length;
  assert.match(send('builder-1@ex').context, /^builder-1 is not running, so the message is kept/);
  assert.match(send('delivery-manager@ex- [ex-1]').context, /^delivery-lead is not running/);
  assert.equal(IB.pending(h.root).find((p) => p.to === 'builder-1').entries.length, before + 1, 'kept under the instance, not the session name');
  assert.match(send('builder-1@other').context, /^builder-1@other is not a role on this team, so the message was not kept/);
  assert.deepEqual(IB.resolveTarget(require('./lib/manifest.js').loadManifest(h.root).team, 'chief-of-staff@ex'), { to: 'chief-of-staff', via: null });
});

test('dlv-2ex: the watchdog wakes the steward for a message kept under "steward", and nobody for a name no role has', () => {
  const t0 = '2026-10-26T18:00:00Z';
  const h = harness({});
  const IB = require('./lib/inbox.js');
  session(h, 'builder-1', { seen: iso(Date.parse(t0) - 2 * H) });
  IB.queue(h.root, { to: 'steward', from: DM, message: 'open the PR', at: t0 });
  IB.queue(h.root, { to: 'stewart', from: DM, message: 'lost', at: t0 });
  const spawn = spawner();
  const res = at(h, t0, ['run'], { spawn, bd: memStore(h) });
  assert.deepEqual(spawn.list.map((x) => x.role), ['builder-1'], res.out);
  assert.match(spawn.list[0].args.join(' '), /open the PR/);
  assert.doesNotMatch(res.out, /stewart/, 'a name no role has is not reported at every run');
  assert.deepEqual(IB.pending(h.root).map((p) => p.to), ['stewart'], 'the steward\'s message is marked delivered under the name it was kept by');
});

test('a waiting message wakes its target once, with the message; a new one goes at once once that wake has ended (hjx.1.3)', () => {
  const t0 = '2026-10-25T18:00:00Z';
  const h = harness({});
  const IB = require('./lib/inbox.js');
  session(h, COS, { seen: iso(Date.parse(t0) - 2 * H) });
  IB.queue(h.root, { to: COS, from: DM, summary: 'dlv-1 blocked', message: 'merge the story branch', at: t0 });
  const spawn = spawner();
  const bd = memStore(h);
  at(h, t0, ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 1);
  assert.equal(spawn.list[0].role, COS);
  assert.match(spawn.list[0].args[5], /\[from delivery-lead: dlv-1 blocked\] merge the story branch/);
  at(h, iso(Date.parse(t0) + 60e3), ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 1, 'a delivered message does not wake again');
  IB.queue(h.root, { to: COS, from: DM, message: 'second', at: iso(Date.parse(t0) + 2 * 60e3) });
  const r = at(h, iso(Date.parse(t0) + 2 * 60e3 + 5e3), ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 2, `woken at once, not five minutes after the last wake: ${r.out}`);
  assert.match(r.out, /^Kicked: 1 \(a message\)$/m, 'the run says the kick started it');
  assert.match(spawn.list[1].args[5], /second/);
  assert.doesNotMatch(spawn.list[1].args[5], /merge the story branch/);
});

// A resumed session came back in default mode on a real team and stopped at approval prompts no one
// could answer; the watchdog wakes each session in the mode team.json records.
test('a wake runs in the team\'s permission mode (team.json permission_mode; auto when unset)', () => {
  const t0 = '2026-10-25T18:00:00Z';
  for (const [mode, want] of [[undefined, ['--permission-mode', 'auto']], ['acceptEdits', ['--permission-mode', 'acceptEdits']], ['default', []]]) {
    const h = harness({});
    if (mode) {
      const f = path.join(h.root, '.delivery', 'team', 'team.json');
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), permission_mode: mode }, null, 2));
    }
    const IB = require('./lib/inbox.js');
    session(h, COS, { seen: iso(Date.parse(t0) - 2 * H) });
    IB.queue(h.root, { to: COS, from: DM, summary: 'x', message: 'y', at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, String(mode));
    assert.deepEqual(spawn.list[0].args.slice(0, want.length + 1), [...want, '--resume'], String(mode));
  }
});

// the review of the fix: an invalid mode made claude exit while the wake was logged and its messages
// marked delivered; a team recorded before the field would have been woken in auto, more than it chose
test('a wake never runs in a mode the team did not choose: invalid or unreadable is no wake; an older team keeps its session\'s own mode', () => {
  const t0 = '2026-10-25T18:00:00Z';
  const IB = require('./lib/inbox.js');
  const teamFile = (h) => path.join(h.root, '.delivery', 'team', 'team.json');
  const prep = (edit, rows) => {
    const h = harness({});
    if (edit) fs.writeFileSync(teamFile(h), edit(fs.readFileSync(teamFile(h), 'utf8')));
    session(h, COS, { seen: iso(Date.parse(t0) - 2 * H), rows });
    IB.queue(h.root, { to: COS, from: DM, summary: 'x', message: 'y', at: t0 });
    return h;
  };
  for (const [edit, why] of [[(t) => JSON.stringify({ ...JSON.parse(t), permission_mode: 'Auto' }), /permission_mode "Auto" is not a Claude Code mode/], [() => '{ not json', /team\.json cannot be read/]]) {
    const h = prep(edit);
    const spawn = spawner();
    const out = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 0, 'no wake');
    assert.match(String(out && (out.out || out.stdout || out)), why);
    assert.equal(IB.pending(h.root).length, 1, 'the message is kept for the next run');
  }
  // no permission_mode recorded: the mode the session started in, read from its transcript
  const h = prep(null, [{ type: 'user', permissionMode: 'acceptEdits', message: { role: 'user', content: 'hi' } }]);
  const spawn = spawner();
  at(h, t0, ['run'], { spawn, bd: memStore(h) });
  assert.deepEqual(spawn.list[0].args.slice(0, 3), ['--permission-mode', 'acceptEdits', '--resume']);
});

// dlv-2et: a merged story waiting on evidence counted as its builder's stall and the builder was woken
// every two hours until its daily wake budget ran out; and a wake's background reviewer was stopped
// ten minutes after the turn ended, so no verdict was recorded
test('a merged or deployed story wakes the Delivery Manager, not its builder; verified or cut wakes the holder to close; a wake waits for its background tasks', () => {
  const t0 = '2026-10-26T10:00:00Z';
  for (const [labels, who, prompt] of [
    [['state-merged'], DM, /is merged .*deploy it/],
    [['state-merged', 'state-deployed'], DM, /is deployed .*reality check/],
    [['state-merged', 'state-verified'], 'builder-1', /is verified .*Close it now/],
    [['state-merged', 'state-cut'], 'builder-1', /is cut .*Close it now/],
    [[], 'builder-1', /Continue it now/],
  ]) {
    const h = harness({ beads: { 'ex-s': { id: 'ex-s', status: 'in_progress', assignee: 'dev@pc/builder-1', labels, updated_at: iso(Date.parse(t0) - 9 * H) } } });
    session(h, 'builder-1', { seen: iso(Date.parse(t0) - 9 * H) });
    session(h, DM, { seen: iso(Date.parse(t0) - 9 * H) });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    const woken = spawn.list.map((x) => x.role);
    assert.deepEqual(woken, [who], labels.join(',') || 'unmerged');
    assert.match(spawn.list[0].args.join(' '), prompt, labels.join(','));
    assert.equal(spawn.list[0].bgWait, '0');
    // the same quiet spell backs off like every stall (its key holds still): woken at 0 and 1 h, held at 2 h
    if (who === DM) {
      at(h, iso(Date.parse(t0) + 30 * 60e3), ['run'], { spawn, bd: memStore(h) });
      assert.equal(spawn.list.length, 1, `${labels} within the hour`);
      at(h, iso(Date.parse(t0) + H), ['run'], { spawn, bd: memStore(h) });
      assert.equal(spawn.list.length, 2, `${labels} after an hour`);
      at(h, iso(Date.parse(t0) + 2 * H), ['run'], { spawn, bd: memStore(h) });
      assert.equal(spawn.list.length, 2, `${labels} backs off`);
    }
  }
});

// On a real team the Delivery Manager had spent its six stall wakes for the day, and a message for it
// waited for hours behind that cap; and a wake carrying a stall and a message never marked the
// message delivered, so the next run sent it again.
test('a message reaches a role that spent its stall wakes, once; a wake that carries a stall and a message hands the message over', () => {
  const t0 = '2026-10-26T15:00:00Z';
  const IB = require('./lib/inbox.js');
  const stale = { 'ex-s': { id: 'ex-s', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(Date.parse(t0) - 9 * H) } };
  // at the daily cap: six wakes in the last day
  {
    const h = harness({ beads: stale });
    session(h, 'builder-1', { seen: iso(Date.parse(t0) - 9 * H) });
    for (let i = 1; i <= 6; i++) WD.log(h.root, { type: 'wake', at: iso(Date.parse(t0) - i * 2 * H), keys: [`k${i}`], instance: 'builder-1', pid: 999999998 });
    IB.queue(h.root, { to: 'builder-1', from: DM, summary: 'PR 75', message: 'merge main into your branch', at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, 'the message goes through');
    assert.match(spawn.list[0].args.join(' '), /merge main into your branch/);
    assert.doesNotMatch(spawn.list[0].args.join(' '), /ex-s has not moved/, 'the held stall does not ride along');
    assert.equal(IB.pending(h.root).length, 0, 'delivered');
    at(h, iso(Date.parse(t0) + 10 * 60e3), ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, 'not sent again; the stall stays held by the cap');
  }
  // no cap: one wake carries both, and the message is handed over
  {
    const h = harness({ beads: stale });
    session(h, 'builder-1', { seen: iso(Date.parse(t0) - 9 * H) });
    IB.queue(h.root, { to: 'builder-1', from: DM, summary: 'PR 75', message: 'merge main into your branch', at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1);
    assert.match(spawn.list[0].args.join(' '), /ex-s has not moved.*merge main into your branch/, 'one wake carries both');
    assert.equal(IB.pending(h.root).length, 0, 'the message a stall wake carried is delivered');
  }
});

// Every resume reloads the whole conversation: on a real team the Delivery Manager's turns carried
// 236k tokens after a day of wakes. Above the limit a wake starts a fresh session in the role directory.
test('a wake starts a fresh session when the last turn carried more than the limit; light, disabled or open sessions resume or fork', () => {
  const t0 = '2026-10-26T18:00:00Z';
  const used = (n) => [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 2, cache_read_input_tokens: n - 1002, cache_creation_input_tokens: 1000 } } }];
  assert.equal(WD.contextOf(used(236000)), 236000);
  assert.equal(WD.contextOf([{ type: 'user', message: { content: 'x' } }]), null);
  const IB = require('./lib/inbox.js');
  const run = ({ tokens, limit, agents = [] }) => {
    const h = harness({});
    if (limit !== undefined) {
      const f = path.join(h.root, '.delivery', 'team', 'team.json');
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), wake_fresh_above_tokens: limit }, null, 2));
    }
    session(h, COS, { seen: iso(Date.parse(t0) - 2 * H), rows: used(tokens) });
    IB.queue(h.root, { to: COS, from: DM, summary: 'x', message: 'merge the story branch', at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h), live: agents });
    return spawn.list[0];
  };
  const heavy = run({ tokens: 236000 });
  assert.equal(heavy.wake, 'fresh');
  // named like every role session, <instance>@<team> from the manifest's prefix (two teams on one host
  // never share a name), so peers reach it by name; its own beads, by its actor
  assert.deepEqual(heavy.args.slice(0, 5), ['--permission-mode', 'auto', '--name', `${COS}@ex`, '-p']);
  assert.ok(!heavy.args.includes('--resume'), 'a fresh session, not a resume');
  assert.match(heavy.args[5], /starting a fresh session: your earlier conversation \(236k tokens\) is not loaded.*bd list --assignee "\$BEADS_ACTOR" --status in_progress.*merge the story branch/);
  // the run's fresh wake opens with the watchdog's words, so the capture hook never takes it for the operator
  assert.ok(heavy.args[5].startsWith(`${WD.WAKE_OPENING}: You are ${COS}, starting a fresh session`), heavy.args[5].slice(0, 80));
  assert.equal(require('./lib/transcript.js').classifyRecord({ type: 'user', promptSource: 'sdk', message: { role: 'user', content: heavy.args[5] } }).source, 'system');
  // the Chief of Staff is told to look for operator input left unrecorded in the old session
  assert.match(heavy.args[5], /operator input still unrecorded \(operator\.js pending\)/);
  assert.equal(run({ tokens: 50000 }).wake, 'resume');
  assert.equal(run({ tokens: 236000, limit: 0 }).wake, 'resume', '0 turns it off');
  assert.equal(run({ tokens: 236000, limit: 300000 }).wake, 'resume', 'the owner\'s limit');
  // a limit the watchdog cannot use is said, not silently replaced: "0" as text is not 0
  {
    const h = harness({});
    const f = path.join(h.root, '.delivery', 'team', 'team.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), wake_fresh_above_tokens: '0' }, null, 2));
    session(h, COS, { seen: iso(Date.parse(t0) - 2 * H), rows: used(236000) });
    IB.queue(h.root, { to: COS, from: DM, summary: 'x', message: 'y', at: t0 });
    const spawn = spawner();
    const out = at(h, t0, ['run'], { spawn, bd: memStore(h), live: [] });
    assert.match(String(out.out || out), /Warning: team\.json wake_fresh_above_tokens "0" is not a whole number of tokens; using 120000/);
    assert.equal(spawn.list[0].wake, 'fresh');
  }
  // an open, idle session is forked as before: a fresh session would replace it on the roster
  assert.equal(run({ tokens: 236000, agents: [{ sessionId: `sess-${COS}`, status: 'idle' }] }).wake, 'fork');
});

// delivery-plugin-planning-8wz: after an install, the run wakes a session that last ran an older plugin
// fresh, since its conversation names the old version's script paths; one on the running version resumes
test('8wz: a watchdog run wakes a session that ran an older plugin fresh, and one on the running plugin by resume', () => {
  const t0 = '2026-11-02T18:00:00Z';
  const IB = require('./lib/inbox.js');
  const now = require('./lib/plugin-version.js').runningVersion();
  const ran = (v) => [{ type: 'assistant', timestamp: t0, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'u1', input: { command: `node /h/cache/m/delivery/${v}/scripts/team-status.js` } }], usage: { input_tokens: 2, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0 } } }];
  const run = (v) => {
    const h = harness({});
    session(h, COS, { seen: iso(Date.parse(t0) - 2 * H), rows: ran(v) });
    IB.queue(h.root, { to: COS, from: DM, summary: 'x', message: 'merge the story branch', at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h), live: [] });
    return spawn.list[0];
  };
  const old = run('0.1.0');
  assert.equal(old.wake, 'fresh');
  assert.match(old.args[5], new RegExp(`ran the delivery plugin 0\\.1\\.0, and ${now.replace(/\./g, '\\.')} is installed now`));
  assert.equal(run(now).wake, 'resume');
});

// The review of the change above: each rule on the message path under a held stall, and message wakes
// must not starve the stall (they used to count toward its hourly gate and daily cap).
test('plan: messages beside a held stall keep their own rules; message wakes do not starve the stall', () => {
  const t0 = Date.parse('2026-10-26T15:00:00Z');
  const stall = { kind: 'quiet', key: 'quiet:ex-s:1', target: 'b1', due: true, line: 'Stalled: ex-s', prompt: 'ex-s has not moved.' };
  const msg = { kind: 'message', key: 'message:b1:1', target: 'b1', due: true, line: 'Waiting: 1 message', prompt: 'merge main into your branch.', upTo: 1 };
  const plan = (rows, { alive = () => false } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
    for (const r of rows) WD.log(root, { type: 'wake', instance: 'b1', pid: 7, ...r });
    return WD.plan({ stalls: [stall, msg] }, { root, now: new Date(t0).toISOString(), alive });
  };
  const ago = (m) => new Date(t0 - m * 60e3).toISOString();
  const sixStalls = Array.from({ length: 6 }, (_, i) => ({ at: ago(120 * (i + 1)), keys: [`quiet:old-${i}`] }));
  // the stall cap spent: the message alone goes, by its rules; the stall stays held, listed once
  let p = plan(sixStalls);
  assert.equal(p.wakes.length, 1);
  assert.deepEqual(p.wakes[0].keys, ['message:b1:1'], 'only the message key is logged, so the stall backoff is untouched');
  assert.deepEqual(p.wakes[0].delivers, [{ to: 'b1', upTo: 1 }]);
  assert.doesNotMatch(p.wakes[0].prompt, /ex-s has not moved/);
  assert.deepEqual(p.held.map((h) => h.lines.join()), ['Stalled: ex-s']);
  assert.match(p.held[0].reason, /woken 6 times in a day/);
  // a wake still running holds both
  p = plan(sixStalls, { alive: () => true });
  assert.equal(p.wakes.length, 0);
  assert.ok(p.held.every((h) => /still running/.test(h.reason)), JSON.stringify(p.held));
  // hjx.1.3: a new message two minutes after a wake that has ended goes at once; the stall says its own cause
  p = plan([...sixStalls, { at: ago(2), keys: ['message:b1:0'] }]);
  assert.deepEqual(p.wakes.map((w) => w.keys), [['message:b1:1']]);
  assert.deepEqual(p.held.map((h) => h.lines.join()), ['Stalled: ex-s']);
  assert.match(p.held[0].reason, /woken 6 times in a day/);
  // 48 wakes in a day: the message is held too
  p = plan(Array.from({ length: 48 }, (_, i) => ({ at: ago(20 * (i + 1)), keys: [`message:b1:x${i}`] })).concat(sixStalls));
  assert.equal(p.wakes.length, 0);
  assert.match(p.held.find((h) => h.lines.includes('Waiting: 1 message')).reason, /woken 48 times in a day/);
  // the review's storm: an hour past the last stall wake, the stall still waits out its backoff (its
  // second try is due at 2 h); the new message goes alone, and never carries the stall with it
  p = plan([{ at: ago(130), keys: ['quiet:ex-s:1'] }, { at: ago(61), keys: ['quiet:ex-s:1'] }, { at: ago(1), keys: ['message:b1:0'] }]);
  assert.deepEqual(p.wakes.map((w) => w.keys), [['message:b1:1']], JSON.stringify(p.wakes));
  assert.doesNotMatch(p.wakes[0].prompt, /ex-s has not moved/);
  // assigned work alone keeps the five-minute gap after a wake, even beside a held stall
  const assigned = { kind: 'assigned', key: 'assigned:ex-a', target: 'b1', due: true, line: 'Assigned and waiting: ex-a', prompt: 'work ex-a.' };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  for (const r of [...sixStalls, { at: ago(2), keys: ['message:b1:0'] }]) WD.log(root, { type: 'wake', instance: 'b1', pid: 7, ...r });
  p = WD.plan({ stalls: [stall, assigned] }, { root, now: new Date(t0).toISOString(), alive: () => false });
  assert.equal(p.wakes.length, 0);
  assert.match(p.held.find((h) => h.lines.includes(assigned.line)).reason, /assigned work waits 5 min/);
  // message wakes in the last hour do not hold the stall: one wake carries both, and hands the message over
  p = plan([{ at: ago(10), keys: ['message:b1:a'] }, { at: ago(40), keys: ['message:b1:b'] }]);
  assert.equal(p.wakes.length, 1);
  assert.match(p.wakes[0].prompt, /ex-s has not moved\..*merge main into your branch\./);
  assert.deepEqual(p.wakes[0].keys.sort(), ['message:b1:1', 'quiet:ex-s:1']);
  assert.deepEqual(p.wakes[0].delivers, [{ to: 'b1', upTo: 1 }]);
  assert.equal(p.held.length, 0);
});

// dlv-4oj: on a host with no scheduler a merged story waited hours: the Delivery Manager's turn ended
// right after the merge, and the deploy, then the reality check, waited for the two-hour evidence stall.
// The merge gate and the deploy record hand the next step to the watchdog, which wakes the Delivery
// Manager for it at its next pass, once, and closes it without a wake when the record shows it done.
test('dlv-4oj: a merged story\'s deploy and a deployed story\'s check wake the Delivery Manager at the next pass, once each, and never when the record shows them done', () => {
  const t0 = '2026-10-29T10:00:00Z';
  const HO = require('./lib/handoff.js');
  const SHA = 'abc1234def5678901234567890123456789abcde';
  const fresh = (labels, metadata = {}, extra = {}) => {
    const h = harness({ beads: { 'ex-s': { id: 'ex-s', status: 'in_progress', assignee: 'dev@pc/builder-1', labels, metadata, updated_at: iso(Date.parse(t0) - 60e3) }, ...extra } });
    session(h, 'builder-1', { seen: iso(Date.parse(t0) - 60e3) });
    session(h, DM, { seen: iso(Date.parse(t0) - 60e3) });
    return h;
  };
  // the deploy: merged a minute ago, nothing is stalled, and the Delivery Manager is still woken for it
  {
    const h = fresh(['state-merged'], { merged_pr: '478' });
    const row = HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, from: DM, pr: '478', sha: SHA, at: t0 });
    assert.ok(row && row.id.startsWith('h-ex-s-deploy-'));
    assert.equal(HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at: t0 }), null, 'queued once while open');
    const spawn = spawner();
    const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.match(r.out, /Handed over: ex-s waits for its deploy \(PR 478 merged at 2026-10-29 10:00 UTC\)/);
    assert.equal(spawn.list.length, 1);
    assert.equal(spawn.list[0].role, DM);
    assert.match(spawn.list[0].args.join(' '), /PR 478 is merged \(ex-s\)\. Deploy it now and record it: evidence\.js state ex-s deployed --sha <the live sha>; then dispatch its reality check \(reality-check\.js plan ex-s/);
    assert.equal(HO.pending(h.root).length, 0, 'handed over with the wake');
    assert.ok(HO.rows(h.root)[0].delivered_at);
    at(h, iso(Date.parse(t0) + 60e3), ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, 'a handed-over step does not wake again');
    assert.deepEqual(Wn.list(h.root), [], 'a handoff is not a warning: the ledger stays empty');
    // a handoff wake leaves the stall gates alone: a stall due in the same hour still wakes, and the day's six are untouched
    h.setBead('ex-s', (b) => { b.labels = ['state-merged', 'state-deployed']; b.metadata = { deployed_sha: SHA }; });
    const p0 = iso(Date.parse(t0) + 10 * 60e3);
    fs.writeFileSync(h.store, JSON.stringify({ ...h.db(), issues: { ...h.db().issues, 'ex-p0': { id: 'ex-p0', status: 'open', priority: 0, created_at: iso(Date.parse(t0) - 2 * H) } } }, null, 2));
    at(h, p0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 2, 'the P0 stall wakes within the hour of the handoff wake');
    assert.match(spawn.list[1].args.join(' '), /Top-priority ex-p0/);
    assert.equal(WD.logRows(h.root).filter((r) => r.type === 'wake' && (r.keys || []).some((k) => /^handoff:/.test(k))).length, 1);
  }
  // the step taken before the pass: the record closes the handoff, nobody is woken
  {
    const h = fresh(['state-merged', 'state-deployed'], { merged_pr: '478', deployed_sha: SHA });
    HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at: t0 });
    const spawn = spawner();
    const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.doesNotMatch(r.out, /Handed over/);
    assert.equal(spawn.list.length, 0);
    assert.ok(HO.rows(h.root)[0].done_at, 'closed from the record');
    assert.equal(HO.pending(h.root).length, 0);
  }
  // the check: deployed, no reality check yet -> woken with the dispatch; the child bead for that sha -> done
  {
    const h = fresh(['state-merged', 'state-deployed'], { deployed_sha: SHA });
    HO.queue(h.root, { bead: 'ex-s', step: 'check', to: DM, sha: SHA, at: t0 });
    const spawn = spawner();
    const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.match(r.out, /Handed over: ex-s waits for its reality check \(deployed at/);
    assert.equal(spawn.list.length, 1);
    assert.match(spawn.list[0].args.join(' '), /ex-s is deployed at abc1234\. Dispatch its reality check now \(reality-check\.js plan ex-s/);
  }
  {
    const h = fresh(['state-merged', 'state-deployed'], { deployed_sha: SHA }, { 'ex-s-rc-abc1234': { id: 'ex-s-rc-abc1234', parent: 'ex-s', status: 'open', labels: ['reality-check'] } });
    HO.queue(h.root, { bead: 'ex-s', step: 'check', to: DM, sha: SHA, at: t0 });
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 0, 'the reality check exists: nothing to hand over');
    assert.ok(HO.rows(h.root)[0].done_at);
  }
  // the deploy record hands the check over itself, through the Delivery Manager's lane; a builder cannot record a deploy
  {
    const h = fresh(['state-merged'], { merged_pr: '478' });
    const r = h.bash(DM, `${h.script('evidence.js')} state ex-s deployed --sha ${SHA}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ex-s: deployed at abc1234def5678901234567890123456789abcde, not verified; its reality check is handed to the watchdog/);
    const p = HO.pending(h.root);
    assert.equal(p.length, 1);
    assert.equal(p[0].step, 'check');
    assert.equal(p[0].to, DM);
    assert.equal(p[0].sha, SHA);
    // the same sha again is no new handoff
    assert.doesNotMatch(h.bash(DM, `${h.script('evidence.js')} state ex-s deployed --sha ${SHA}`).out, /handed/);
    assert.equal(HO.pending(h.root).length, 1);
  }
  // a stale open row (another pull request for the same story) is superseded, so the wake names the current one; the same one again is not
  {
    const h = fresh(['state-merged'], { merged_pr: '479' });
    HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at: iso(Date.parse(t0) - H) });
    const r = HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '479', at: t0 });
    assert.ok(r, 'a new pull request is a new handoff');
    assert.equal(HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '479', at: t0 }), null);
    assert.deepEqual(HO.pending(h.root).map((x) => x.pr), ['479']);
    assert.equal(HO.rows(h.root)[0].superseded_by, r.id);
    const spawn = spawner();
    at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1);
    assert.match(spawn.list[0].args.join(' '), /PR 479 is merged/);
    assert.doesNotMatch(spawn.list[0].args.join(' '), /PR 478/);
  }
  // a handoff that cannot be written is said by the deploy record, so the step is taken in that turn
  {
    const h = fresh(['state-merged'], { merged_pr: '478' });
    fs.mkdirSync(path.join(h.root, HO.REL, HO.FILE), { recursive: true });
    const r = h.bash(DM, `${h.script('evidence.js')} state ex-s deployed --sha ${SHA}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not verified; its reality check was not handed to the watchdog \(.*\): dispatch it in this turn/);
    assert.ok(h.db().issues['ex-s'].labels.includes('state-deployed'), 'the deploy is recorded all the same');
  }
  // a handoffs file another writer holds (its lock taken) fails open: the wake runs and says the row stays open; a pass closing a done row says so and still wakes
  {
    const h = fresh(['state-merged'], { merged_pr: '478' });
    HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at: t0 });
    fs.writeFileSync(path.join(h.root, HO.REL, `${HO.FILE}.lock`), '1');
    const spawn = spawner();
    const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, 'the wake stands');
    assert.match(r.out, /Woke delivery-lead .*\(its handoff stays open until the next pass: handoffs\.ndjson\.lock is held by another writer; retry in a moment\)/);
    assert.equal(HO.pending(h.root).length, 1, 'not handed over yet');
    fs.unlinkSync(path.join(h.root, HO.REL, `${HO.FILE}.lock`));
    h.setBead('ex-s', (b) => { b.labels = ['state-merged', 'state-deployed']; b.metadata = { deployed_sha: SHA }; });
    HO.queue(h.root, { bead: 'ex-s', step: 'check', to: DM, sha: SHA, at: iso(Date.parse(t0) + 6 * 60e3) });
    fs.writeFileSync(path.join(h.root, HO.REL, `${HO.FILE}.lock`), '1');
    const r2 = at(h, iso(Date.parse(t0) + 6 * 60e3), ['run'], { spawn, bd: memStore(h) });
    assert.match(r2.out, /Note: the handoffs the record closed stay open until the next pass \(handoffs\.ndjson\.lock is held by another writer/);
    assert.equal(spawn.list.length, 2, 'the check wake still runs in the same pass');
    assert.match(spawn.list[1].args.join(' '), /Dispatch its reality check now/);
    fs.unlinkSync(path.join(h.root, HO.REL, `${HO.FILE}.lock`));
  }
  // hjx.1.3: a handoff two minutes after a message wake that has ended goes at once, past the day's
  // stall cap (the check at a65637c saw "woken 6 times in a day" beside the Delivery Manager's handoffs)
  {
    const h = fresh(['state-merged'], { merged_pr: '478' });
    for (let i = 0; i < WD.DAILY_CAP; i++) WD.log(h.root, { type: 'wake', at: iso(Date.parse(t0) - (i + 1) * 2 * H), keys: ['p0:ex-old'], instance: DM, pid: 1 });
    require('./lib/inbox.js').queue(h.root, { to: DM, from: 'builder-1', message: 'first', at: iso(Date.parse(t0) - 3 * 60e3) });
    const spawn = spawner();
    at(h, iso(Date.parse(t0) - 2 * 60e3), ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 1, 'the message wake');
    HO.queue(h.root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at: t0 });
    const r = at(h, t0, ['run'], { spawn, bd: memStore(h) });
    assert.equal(spawn.list.length, 2, r.out);
    assert.match(spawn.list[1].args.join(' '), /Deploy it now/);
    assert.match(r.out, /Alarm only: delivery-lead: woken 6 times in a day; alarm only until the count falls\. Unclaimed|^Woke delivery-lead/m);
    assert.doesNotMatch(r.out, /Alarm only: delivery-lead: [^\n]*Handed over: ex-s/, 'the handoff is not held');
  }
});

// hjx.1.3: no daily cap holds a handoff (a merge's deploy, a deploy's check): merges and deploys bound
// it. At 48 wakes in a day the handoff still goes and the message beside it is held, with its cause.
test('plan: a handoff is never held by a daily cap; a message beside it at 48 a day is (hjx.1.3)', () => {
  const t0 = Date.parse('2026-10-26T15:00:00Z');
  const ho = { kind: 'handoff', key: 'handoff:ho-1', bead: 'ex-s', target: 'b1', handoff: 'ho-1', due: true, line: 'Handed over: ex-s waits for its deploy', prompt: 'deploy ex-s.' };
  const msg = { kind: 'message', key: 'message:b1:1', target: 'b1', due: true, line: 'Waiting: 1 message', prompt: 'read it.', upTo: 1 };
  const ago = (m) => new Date(t0 - m * 60e3).toISOString();
  const plan = (n, stalls = [ho]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ho-'));
    for (let i = 0; i < n; i++) WD.log(root, { type: 'wake', instance: 'b1', pid: 7, at: ago(20 * (i + 1)), keys: [`handoff:old-${i}`] });
    return WD.plan({ stalls }, { root, now: new Date(t0).toISOString(), alive: () => false });
  };
  for (const n of [47, 48, 60]) {
    const p = plan(n);
    assert.equal(p.wakes.length, 1, `${n} wakes in a day`);
    assert.deepEqual(p.wakes[0].keys, ['handoff:ho-1']);
    assert.deepEqual(p.wakes[0].handoffs, ['ho-1'], 'the wake carries its handoff, so it is marked handed over');
  }
  const both = plan(48, [ho, msg]);
  assert.deepEqual(both.wakes.map((w) => w.keys), [['handoff:ho-1']]);
  assert.deepEqual(both.wakes[0].delivers, [], 'the held message is not marked delivered');
  assert.deepEqual(both.held.map((h) => [h.lines.join(), /woken 48 times in a day/.test(h.reason)]), [['Waiting: 1 message', true]]);
  // a wake still running holds it, until that wake ends (whose end kicks the next run)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ho-'));
  WD.log(root, { type: 'wake', instance: 'b1', pid: 7, at: ago(1), keys: ['message:b1:0'] });
  const running = WD.plan({ stalls: [ho] }, { root, now: new Date(t0).toISOString(), alive: () => true });
  assert.equal(running.wakes.length, 0);
  assert.match(running.held[0].reason, /still running; it is woken again when that wake ends/);
});

// GitHub Copilot's review of #86: handoff ids, retries after a wake, and recovery in a stopped area.
test('Copilot #86: two handoffs in one second have their own ids; a retry after the wake adds nothing', () => {
  const HO = require('./lib/handoff.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-id-'));
  const at = '2026-10-30T12:00:00.000Z';
  const a = HO.queue(root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '478', at });
  const b = HO.queue(root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '479', at });
  assert.notEqual(a.id, b.id, 'same bead, step and second, another PR');
  // an acknowledgement of the superseded row never consumes its replacement
  HO.markDone(root, [a.id], at);
  assert.deepEqual(HO.pending(root).map((r) => r.id), [b.id]);
  // the wake starts (delivered); a retry of merge-gate.js merged for the same PR adds nothing
  HO.markDelivered(root, [b.id], at);
  assert.equal(HO.queue(root, { bead: 'ex-s', step: 'deploy', to: DM, pr: '479', at }), null);
  assert.equal(HO.pending(root).length, 0);
});

test('Copilot #86: in a stopped area the recovery work\'s handoff still wakes; unrelated work is held', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const sessions = [{ instance: DM, role: DM, session: 's-dm', roleDir: os.tmpdir(), lastActive: now - 10 * 60e3 }];
  const area = (id, meta = {}) => ({ id, status: 'in_progress', labels: ['story', 'state-merged'], metadata: { area: 'import', ...meta } });
  const beads = [area('ex-fail', { story: 'vault-0n9-3' }), area('ex-fix', { fixes: 'ex-fail' }), area('ex-a3work', { a3: 'a3-1' }), area('ex-other'), area('ex-other-a3', { a3: 'a3-9' }), area('ex-fix-by-story', { fixes: 'vault-0n9-3 # the import story' })];
  const handoffs = beads.map((b, i) => ({ id: `h-${i}`, at: new Date(now - 60e3).toISOString(), bead: b.id, step: 'deploy', to: DM, pr: String(500 + i) }));
  const pause = { paused: false, stops: [{ trigger: 'andon:ev-ex-fail-1', area: require('./lib/gates.js').areaOf(beads[0]), a3: 'a3-1' }] };
  const r = WD.stalls({ beads, now: iso(now), sessions, handoffs, pause });
  // the stop's own A3 work goes on; work tagged with another A3 is held like any other (Copilot round 2)
  assert.deepEqual(r.stalls.filter((s) => s.kind === 'handoff').map((s) => s.bead).sort(), ['ex-a3work', 'ex-fail', 'ex-fix', 'ex-fix-by-story'], 'a fix naming the failed story by its story id is recovery too');
  const noA3 = WD.stalls({ beads, now: iso(now), sessions, handoffs, pause: { paused: false, stops: [{ ...pause.stops[0], a3: null }] } });
  assert.deepEqual(noA3.stalls.filter((s) => s.kind === 'handoff').map((s) => s.bead).sort(), ['ex-fail', 'ex-fix', 'ex-fix-by-story'], 'a stop with no open A3 lets no A3 work through');
});

test('Copilot #86: the watchdog reads each stop\'s open A3 from the andon record; none open, none', () => {
  const A = require('./lib/andon.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-a3-'));
  const trigger = 'andon:ev-ex-fail-1';
  const pause = { paused: false, stops: [{ trigger, area: 'import' }, { trigger: 'andon:ev-ex-other-2', area: 'import' }] };
  assert.deepEqual(WD.withA3s(root, pause).stops.map((s) => s.a3), [null, null], 'no A3 opened yet');
  A.append(root, { type: 'a3-open', trigger, area: 'import', by: 'delivery-lead', at: '2026-10-30T12:00:00Z' }, 'delivery-lead');
  const id = A.openA3For(root, trigger, A.read(root).rows).id;
  assert.deepEqual(WD.withA3s(root, pause).stops.map((s) => s.a3), [id, null], 'the open A3 of that trigger only');
  // through read, the stopped area's A3 work wakes for its handoff and unrelated A3 work is held
  const HO = require('./lib/handoff.js');
  const bead = (bid, a3) => ({ id: bid, status: 'in_progress', labels: ['story', 'state-merged'], metadata: { area: 'import', a3 } });
  const beads = [bead('ex-mine', id), bead('ex-theirs', 'a3-elsewhere')];
  for (const b of beads) HO.queue(root, { bead: b.id, step: 'deploy', to: DM, pr: b.id === 'ex-mine' ? '1' : '2', at: '2026-10-30T12:00:00Z' });
  const bd = { list: () => beads, ready: () => [], show: (x) => beads.find((b) => b.id === x) || null };
  const res = WD.read(root, { bd, now: '2026-10-30T12:10:00Z', pause: { paused: false, stops: [{ trigger, area: 'import' }] } });
  assert.equal(res.unreadable, undefined, res.unreadable);
  assert.deepEqual(res.stalls.filter((s) => s.kind === 'handoff').map((s) => s.bead), ['ex-mine']);
});

// hjx.1: a role holding assigned or claimed work it can start is woken for it, without a message
test('hjx.1: assigned work wakes its holder after 10 quiet minutes, under the message rules; never a busy, limited or epic case', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const sess = (inst, quietMin, extra = {}) => ({ instance: inst, role: inst.replace(/-\d+$/, ''), session: `s-${inst}`, roleDir: os.tmpdir(), lastActive: now - quietMin * 60e3, ...extra });
  const open = { id: 'ex-o', status: 'open', assignee: 'dev@pc/builder-1', updated_at: iso(now - 30 * 60e3) };
  const prog = { id: 'ex-p', status: 'in_progress', assignee: 'dev@pc/builder-2', updated_at: iso(now - 20 * 60e3) };
  const kinds = (o) => WD.stalls({ now: iso(now), ...o }).stalls.filter((x) => x.kind === 'assigned').map((x) => [x.bead, x.target]);
  // an open bead assigned and ready, its holder quiet 30 min: woken; in progress, quiet 20 min: woken
  assert.deepEqual(kinds({ beads: [open, prog], ready: [open], sessions: [sess('builder-1', 30), sess('builder-2', 20)] }), [['ex-o', 'builder-1'], ['ex-p', 'builder-2']]);
  // not ready (blocked), not woken; holder active 5 min ago, not woken; exactly 10 min, not woken
  assert.deepEqual(kinds({ beads: [open], ready: [], sessions: [sess('builder-1', 30)] }), []);
  assert.deepEqual(kinds({ beads: [prog], sessions: [sess('builder-2', 5)] }), []);
  assert.deepEqual(kinds({ beads: [prog], sessions: [sess('builder-2', WD.ASSIGNED_IDLE_MIN)] }), []);
  // an epic, an unassigned bead, a holder not on the roster: none
  assert.deepEqual(kinds({ beads: [{ ...prog, issue_type: 'epic' }, { ...prog, id: 'ex-u', assignee: '' }], sessions: [sess('builder-2', 30)] }), []);
  assert.deepEqual(kinds({ beads: [prog], sessions: [] }), []);
  // it plans like a message: five minutes after the holder's last wake, not one an hour
  const st = WD.stalls({ now: iso(now), beads: [prog], sessions: [sess('builder-2', 20)] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hjx1-'));
  WD.log(root, { type: 'wake', at: iso(now - 7 * 60e3), keys: ['assigned:ex-p'], instance: 'builder-2', pid: 7 });
  assert.equal(WD.plan(st, { root, now: iso(now), alive: () => false }).wakes.length, 1, 'seven minutes after the last wake: woken again');
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hjx1-'));
  WD.log(root2, { type: 'wake', at: iso(now - 2 * 60e3), keys: ['assigned:ex-p'], instance: 'builder-2', pid: 7 });
  assert.match(WD.plan(st, { root: root2, now: iso(now), alive: () => false }).held[0].reason, /assigned work waits 5 min/);
});

// Copilot on PR 113: bd ready does not know owner-queue steps; work waiting for the owner is not woken
test('hjx.1 (Copilot 4436744668): assigned work an open owner-queue step names waits for the owner, no wake', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const sess = (inst) => ({ instance: inst, role: 'builder', session: `s-${inst}`, roleDir: os.tmpdir(), lastActive: now - 30 * 60e3 });
  const open = { id: 'ex-o', status: 'open', assignee: 'builder-1', updated_at: iso(now - 30 * 60e3) };
  const prog = { id: 'ex-p', status: 'in_progress', assignee: 'builder-2', updated_at: iso(now - 30 * 60e3) };
  const assigned = (openSteps) => WD.stalls({ now: iso(now), beads: [open, prog], ready: [open], sessions: [sess('builder-1'), sess('builder-2')], openSteps })
    .stalls.filter((x) => x.kind === 'assigned').map((x) => x.bead);
  assert.deepEqual(assigned([]), ['ex-o', 'ex-p'], 'no owner step: both woken');
  assert.deepEqual(assigned([{ id: 'oq-1', bead: 'ex-o' }, { id: 'oq-2', bead: 'ex-p' }]), [], 'each waits for its owner step');
  assert.deepEqual(assigned([{ id: 'oq-3', bead: 'ex-other' }]), ['ex-o', 'ex-p'], 'a step naming other work holds nothing');
});

// Copilot on PR 113: in a stopped area the stop's recovery work still runs, even past stall_hours
test('hjx.1 (Copilot 4436744684): in a stopped area recovery work is woken, past stall_hours too; unrelated work is held', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const sess = (inst, quietMin) => ({ instance: inst, role: 'builder', session: `s-${inst}`, roleDir: os.tmpdir(), lastActive: now - quietMin * 60e3 });
  const area = (id, assignee, status, meta = {}, upd = 30) => ({ id, status, assignee, labels: ['story'], updated_at: iso(now - upd * 60e3), metadata: { area: 'import', ...meta } });
  const fail = area('ex-fail', 'builder-1', 'in_progress');
  const fix = area('ex-fix', 'builder-2', 'open', { fixes: 'ex-fail' });
  const a3 = area('ex-a3', 'builder-3', 'in_progress', { a3: 'a3-1' }, 180);
  const other = area('ex-other', 'builder-4', 'in_progress');
  const pause = { paused: false, stops: [{ trigger: 'andon:ev-ex-fail-1', area: 'import', a3: 'a3-1' }] };
  const sessions = [sess('builder-1', 30), sess('builder-2', 30), sess('builder-3', 180), sess('builder-4', 30)];
  const r = WD.stalls({ now: iso(now), beads: [fail, fix, a3, other], ready: [fix], sessions, pause, stallHours: 2 });
  assert.deepEqual(r.stalls.filter((x) => x.kind === 'assigned').map((x) => x.bead).sort(), ['ex-a3', 'ex-fail', 'ex-fix'], 'the failed bead, its fix and the A3 work run; ex-other waits');
  // ex-a3 is past stall_hours, and the quiet stall skips a stopped area: the assigned wake is its only one
  assert.deepEqual(r.stalls.filter((x) => x.bead === 'ex-a3').map((x) => x.kind), ['assigned']);
  // outside a stop the in-progress stall takes over past stall_hours: one wake, not two
  const free = WD.stalls({ now: iso(now), beads: [a3], sessions, stallHours: 2 });
  assert.deepEqual(free.stalls.map((x) => x.kind), ['quiet']);
});

// Copilot on PR 113: assigned wakes are handovers; they never spend the stall wakes' hourly gate or daily cap
test('hjx.1 (Copilot 4436744698): logged assigned wakes do not hold a due stall wake', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const b = { id: 'ex-p', status: 'in_progress', assignee: 'builder-2', updated_at: iso(now - 3 * H) };
  const st = WD.stalls({ now: iso(now), beads: [b], sessions: [{ instance: 'builder-2', role: 'builder', session: 's-b2', roleDir: os.tmpdir(), lastActive: now - 3 * H }], stallHours: 2 });
  assert.deepEqual(st.stalls.map((x) => x.kind), ['quiet'], 'past stall_hours the stall is due');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hjx1-cap-'));
  try {
    // six assigned wakes today, the last six minutes ago
    for (let i = 0; i < 6; i++) WD.log(root, { type: 'wake', at: iso(now - (6 + i * 20) * 60e3), keys: ['assigned:ex-p'], instance: 'builder-2', pid: 7 });
    const p = WD.plan(st, { root, now: iso(now), alive: () => false });
    assert.equal(p.held.length, 0, JSON.stringify(p.held));
    assert.deepEqual(p.wakes.map((w) => w.keys).flat(), [st.stalls[0].key]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Copilot on PR 113 (023505b): a stall wake carries the holder's assigned work, not drops it on the stall backoff
test('hjx.1 (Copilot 4436815462), 6z5: assigned work rides the newly due stall wake; an open bead queued behind the stalled one waits for it', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const stuck = { id: 'ex-q', status: 'in_progress', assignee: 'builder-2', updated_at: iso(now - 3 * H) };
  const next = { id: 'ex-a', status: 'open', assignee: 'builder-2', updated_at: iso(now - 30 * 60e3) };
  const st = WD.stalls({ now: iso(now), beads: [stuck, next], ready: [next], sessions: [{ instance: 'builder-2', role: 'builder', session: 's-b2', roleDir: os.tmpdir(), lastActive: now - 3 * H }], stallHours: 2 });
  // 6z5: the open bead waits behind its holder's own work in progress; the stall wakes it for that work
  assert.deepEqual(st.stalls.map((x) => x.key).sort(), [`quiet:ex-q:${iso(now - 3 * H)}`]);
  // assigned work that is due (an in-progress bead of its own) rides the stall wake
  st.stalls.push({ kind: 'assigned', key: 'assigned:ex-a', bead: 'ex-a', target: 'builder-2', due: true, line: 'Assigned and waiting: ex-a', prompt: 'ex-a is assigned to you and waiting (in_progress).' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hjx1-mix-'));
  try {
    WD.log(root, { type: 'wake', at: iso(now - 7 * 60e3), keys: ['assigned:ex-a'], instance: 'builder-2', pid: 7 });
    const p = WD.plan(st, { root, now: iso(now), alive: () => false });
    assert.equal(p.held.length, 0, JSON.stringify(p.held));
    assert.equal(p.wakes.length, 1);
    assert.deepEqual(p.wakes[0].keys.slice().sort(), ['assigned:ex-a', `quiet:ex-q:${iso(now - 3 * H)}`], 'one wake carries both');
    assert.match(p.wakes[0].prompt, /ex-a is assigned to you/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Copilot on PR 113 (df6b5c9): bd ready knows nothing of a red main; the claim check does (andon.js ciRedBlock)
test('hjx.1 (Copilot 4437000590): on a red main only claimable open work wakes its holder: a fix, the ci:main A3 work, or work already started', () => {
  const A = require('./lib/andon.js');
  const now = Date.parse('2026-11-01T12:00:00Z');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hjx1-ci-'));
  try {
    const beads = [
      { id: 'ex-story', status: 'open', assignee: 'builder-1', labels: ['story'], updated_at: iso(now - H) },
      { id: 'ex-fix', status: 'open', assignee: 'builder-2', labels: ['bug'], metadata: { fixes: 'ex-shipped' }, updated_at: iso(now - H) },
      { id: 'ex-a3w', status: 'open', assignee: 'builder-3', labels: ['story'], metadata: {}, updated_at: iso(now - H) },
      { id: 'ex-ip', status: 'in_progress', assignee: 'builder-4', labels: ['story'], updated_at: iso(now - H) },
      { id: 'ex-shipped', status: 'closed', labels: ['story', 'state-merged'], updated_at: iso(now - 9 * H) },
    ];
    for (const i of [1, 2, 3, 4]) registerInstance(root, { instance: `builder-${i}`, session_id: `s-${i}`, host: 'pc', model: 'opus', role_dir: root, now: iso(now - 30 * 60e3) });
    const bd = { list: () => beads, ready: () => beads.filter((b) => b.status === 'open'), show: (x) => beads.find((b) => b.id === x) || null };
    const woken = () => {
      const res = WD.read(root, { bd, now: iso(now), installed: true, pause: { paused: false } });
      assert.equal(res.unreadable, undefined, res.unreadable);
      return res.stalls.filter((s) => s.kind === 'assigned').map((s) => s.bead).sort();
    };
    assert.deepEqual(woken(), ['ex-a3w', 'ex-fix', 'ex-ip', 'ex-story'], 'main not known red: all woken');
    A.append(root, { type: 'ci', result: 'red', sha: 'c195aa00', run: '195', at: iso(now - 2 * H) }, 'delivery-lead');
    assert.deepEqual(woken(), ['ex-fix', 'ex-ip'], 'red main: the fix and started work only');
    A.append(root, { type: 'a3-open', trigger: 'ci:main', by: 'delivery-lead', at: iso(now - H) }, 'delivery-lead');
    beads[2].metadata.a3 = A.openA3For(root, 'ci:main', A.read(root).rows).id;
    assert.deepEqual(woken(), ['ex-a3w', 'ex-fix', 'ex-ip'], 'the ci:main A3 work starts too');
    A.append(root, { type: 'ci', result: 'green', sha: 'c196bb00', run: '196', at: iso(now - 10 * 60e3) }, 'delivery-lead');
    assert.deepEqual(woken(), ['ex-a3w', 'ex-fix', 'ex-ip', 'ex-story'], 'green again: all woken');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// fbk (rv-163-delivery-lead-5): under a red main the same check of shipped work wakes the Reality Checker
// it is assigned to, never a builder, as the claim check holds it (andon.js checksShipped)
test('fbk: on a red main a check of a deployed story wakes its holder only when the Reality Checker holds it', () => {
  const A = require('./lib/andon.js');
  const now = Date.parse('2026-11-04T12:00:00Z');
  const prefix = path.join(os.tmpdir(), 'fbk-ci-');
  const root = fs.mkdtempSync(prefix);
  try {
    const shipped = { id: 'ex-shipped', status: 'in_progress', labels: ['story', 'state-merged', 'state-deployed'], metadata: { deployed_sha: '235e4a04b3' }, updated_at: iso(now - 9 * H) };
    const rc = { id: 'ex-shipped-rc-235e4a0', status: 'open', parent: shipped.id, labels: ['reality-check'], metadata: { reality_check_for: shipped.id, deployed_sha: '235e4a04b3' }, updated_at: iso(now - H) };
    const beads = [shipped, rc];
    for (const i of ['builder-1', 'reality-checker']) registerInstance(root, { instance: i, session_id: `s-${i}`, host: 'pc', model: 'opus', role_dir: root, now: iso(now - 30 * 60e3) });
    const bd = { list: () => beads, ready: () => beads.filter((b) => b.status === 'open'), show: (x) => beads.find((b) => b.id === x) || null };
    const woken = () => {
      const res = WD.read(root, { bd, now: iso(now), installed: true, pause: { paused: false } });
      assert.equal(res.unreadable, undefined, res.unreadable);
      return res.stalls.filter((s) => s.kind === 'assigned').map((s) => s.bead).sort();
    };
    A.append(root, { type: 'ci', result: 'red', sha: 'c195aa00', run: '195', at: iso(now - 2 * H) }, 'delivery-lead');
    rc.assignee = 'dev@pc/reality-checker';
    assert.deepEqual(woken(), [rc.id], 'the Reality Checker takes the check under a red main');
    rc.assignee = 'dev@pc/builder-1';
    assert.deepEqual(woken(), [], 'a builder holding the same check is held by the red main');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// dec-chief-of-staff-000211: every host-job run sweeps the test runs' leftovers from the temp directory
// and says what it removed in the job log; a failing sweep never stops the run
test('run sweeps test leftovers every cycle and logs them; check and a dry run do not sweep', () => {
  const h = harness({ beads: {} });
  let calls = 0;
  const sweep = () => { calls += 1; return { removed: ['/tmp/stop-nobd-AbC123', '/tmp/gates-6O4vP0'], failed: [] }; };
  const r = at(h, '2026-10-13T12:00:00Z', ['run'], { sweep });
  assert.equal(r.code, 0);
  assert.match(r.out, /sweep: removed 2 test leftover\(s\) from \/tmp: stop-nobd-AbC123 gates-6O4vP0/);
  assert.equal(calls, 1);
  at(h, '2026-10-13T12:15:00Z', ['check'], { sweep });
  at(h, '2026-10-13T12:15:00Z', ['wake', '--dry-run'], { sweep });
  assert.equal(calls, 1, 'only run sweeps');
  const quiet = at(h, '2026-10-13T12:30:00Z', ['run'], { sweep: () => ({ removed: [], failed: [] }) });
  assert.doesNotMatch(quiet.out, /sweep:/, 'nothing to say when nothing was left');
  const broken = at(h, '2026-10-13T12:45:00Z', ['run'], { sweep: () => { throw new Error('EACCES'); } });
  assert.equal(broken.code, 0);
  assert.match(broken.out, /sweep: failed \(EACCES\)/);
  assert.match(broken.out, /watchdog/);
});

// review of #126: `run --dry-run` removes nothing; it says what the sweep would remove
test('run --dry-run sweeps as a dry run: it names the leftovers and removes none', () => {
  const h = harness({ beads: {} });
  const asked = [];
  const sweep = (opts) => { asked.push(opts); return { removed: ['/tmp/delivery-tests-AbC123'], failed: [] }; };
  const dry = at(h, '2026-10-13T12:00:00Z', ['run', '--dry-run'], { sweep });
  assert.deepEqual(asked, [{ dryRun: true }]);
  assert.match(dry.out, /sweep: would remove 1 test leftover\(s\) from \/tmp: delivery-tests-AbC123/);
  at(h, '2026-10-13T12:15:00Z', ['run'], { sweep });
  assert.deepEqual(asked[1], { dryRun: false });

  // the real sweep, through the real registry: the directory is still there after the dry run
  const S = require('./testing/sweep.js');
  const work = fs.mkdtempSync(path.join(__dirname, '.wd-sweep-'));
  const saved = process.env.DELIVERY_TMP_REGISTRY;
  const dir = fs.mkdtempSync(path.join(S.TMP, 'delivery-tests-'));
  try {
    process.env.DELIVERY_TMP_REGISTRY = path.join(work, 'reg.ndjson');
    const old = (Date.now() - 2 * 3600e3) / 1000;
    fs.utimesSync(dir, old, old);
    S.record(dir, { pid: 2147483646 });
    const r = at(h, '2026-10-13T12:30:00Z', ['run', '--dry-run']);
    assert.match(r.out, new RegExp(`sweep: would remove 1 test leftover\\(s\\) from /tmp: ${path.basename(dir)}`));
    assert.ok(fs.existsSync(dir), 'a dry run removes nothing');
    assert.equal(S.entries(process.env.DELIVERY_TMP_REGISTRY).length, 1, 'a dry run forgets nothing');
  } finally {
    if (saved === undefined) delete process.env.DELIVERY_TMP_REGISTRY; else process.env.DELIVERY_TMP_REGISTRY = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});


// 7ax: the Delivery Manager unblocks every other role, so six stall wakes a day left ready top-priority
// work waiting hours behind "alarm only"; its day holds 24 stall wakes (one an hour still) and 96 handovers
test('7ax: the Delivery Manager is woken past a worker\'s daily caps, still one stall wake an hour', () => {
  const t0 = Date.parse('2026-11-03T12:00:00Z');
  const ago = (m) => new Date(t0 - m * 60e3).toISOString();
  const stall = (target) => ({ kind: 'p0', key: 'p0:new', target, due: true, line: 'Unclaimed: new', prompt: 'go' });
  const msg = (target) => ({ kind: 'message', key: `message:${target}:1`, target, due: true, line: 'Waiting: 1 message', prompt: 'read it', upTo: 1 });
  const plan = (instance, rows, stalls) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-7ax-'));
    for (const r of rows) WD.log(root, { type: 'wake', instance, pid: 7, ...r });
    return WD.plan({ stalls }, { root, now: new Date(t0).toISOString(), alive: () => false });
  };
  // seven stall wakes needed in a day: the seventh goes for the Delivery Manager, not for a builder
  const six = Array.from({ length: 6 }, (_, i) => ({ at: ago(70 * (i + 1)), keys: [`p0:old-${i}`] }));
  assert.equal(plan(DM, six, [stall(DM)]).wakes.length, 1, 'the Delivery Manager\'s seventh stall wake goes');
  assert.match(plan('builder-1', six, [stall('builder-1')]).held[0].reason, /woken 6 times in a day/);
  assert.equal(plan('delivery-lead-2', six, [stall('delivery-lead-2')]).wakes.length, 1, 'a counted Delivery Manager too');
  // the hour still holds, and the Delivery Manager's own cap is 24
  assert.match(plan(DM, [{ at: ago(20), keys: ['p0:old'] }], [stall(DM)]).held[0].reason, /one wake an hour/);
  const day = Array.from({ length: 24 }, (_, i) => ({ at: ago(62 + 55 * i), keys: [`p0:old-${i}`] }));
  assert.match(plan(DM, day, [stall(DM)]).held[0].reason, /woken 24 times in a day/);
  // handovers: 48 a day for a worker, 96 for the Delivery Manager
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ at: ago(14 * (i + 1)), keys: [`message:x:${i}`] }));
  assert.equal(plan(DM, msgs(48), [msg(DM)]).wakes.length, 1, 'the 49th handover wake goes for the Delivery Manager');
  assert.match(plan('builder-1', msgs(48), [msg('builder-1')]).held[0].reason, /woken 48 times in a day/);
  assert.match(plan(DM, msgs(96), [msg(DM)]).held[0].reason, /woken 96 times in a day/);
});

// bqj (dec-chief-of-staff-000266): work waiting on the Delivery Manager itself is a stall the plugin
// recovers: its stopped session is restarted within the cycle, and the owner's briefing says so
const R = require('./lib/reviews.js');
const HEAD = 'a'.repeat(40);
function reviewRows(root, pr, kinds, at) {
  const rows = { request: { type: 'request', head: HEAD, beads: [`ex-pr-${pr}`], reviewer: `pr-reviewer-${pr}`, title: 'A change' },
    pass: { type: 'review', head: HEAD, result: 'pass', reviewer: `pr-reviewer-${pr}`, kind: 'independent', summary: 'ok' },
    changes: { type: 'review', head: HEAD, result: 'changes', reviewer: `pr-reviewer-${pr}`, kind: 'independent', summary: 'a finding' },
    ci_fail: { type: 'ci', head: HEAD, result: 'fail', run: '1' },
    sent: { type: 'sent-back', head: HEAD, reason: 'changes' },
    merged: { type: 'merged', head: HEAD, beads: [`ex-pr-${pr}`] } };
  for (const k of kinds) R.append(root, String(pr), { ...rows[k], at }, DM);
}

test('bqj: a merge, a review or a send-back waiting on a quiet Delivery Manager is a stall; never when it is working, limited or off the roster', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bqj-'));
  reviewRows(root, 1, ['request', 'pass'], iso(now - H));
  reviewRows(root, 2, ['request'], iso(now - H));
  reviewRows(root, 3, ['request', 'changes'], iso(now - H));
  reviewRows(root, 4, ['request', 'pass', 'ci_fail'], iso(now - H));
  reviewRows(root, 5, ['request', 'changes', 'sent'], iso(now - H));
  reviewRows(root, 6, ['request', 'pass', 'merged'], iso(now - H));
  const parts = [];
  const prs = WD.managerPrs(root, parts);
  assert.deepEqual(parts, []);
  assert.deepEqual(prs.map((p) => [p.pr, p.state]), [[1, 'passed'], [2, 'waiting'], [3, 'changes'], [4, 'failing']], 'sent back and merged are not the Delivery Manager\'s');
  const dm = (quietMin, extra = {}) => ({ instance: DM, role: DM, session: 's-dm', roleDir: os.tmpdir(), lastActive: now - quietMin * 60e3, ...extra });
  const manager = (sessions) => WD.stalls({ now: iso(now), prs, sessions }).stalls.filter((s) => s.kind === 'manager');
  const found = manager([dm(40)]);
  assert.deepEqual(found.map((s) => [s.pr, s.target, s.bead]), [[1, DM, 'ex-pr-1'], [2, DM, 'ex-pr-2'], [3, DM, 'ex-pr-3'], [4, DM, 'ex-pr-4']]);
  assert.match(found[0].line, /^Waiting on the Delivery Manager: PR 1 has a passing review and waits for its merge, and its session has been quiet for 40 min\.$/);
  assert.match(found[0].prompt, /^PR 1 \(ex-pr-1\) has a passing review and waits for its merge\. Take it now, before anything else: merge-gate\.js check 1/);
  assert.match(found[2].prompt, /review\.js send-back 3 --reason changes/);
  assert.match(found[3].prompt, /review\.js send-back 4 --reason ci/);
  // the key is the record's last row: the same row is the same stall, a new row is new work
  assert.equal(found[0].key, `manager:1:${R.read(root, '1').rows.slice(-1)[0].id}`);
  assert.deepEqual(manager([dm(5)]), [], 'active five minutes ago: it is working');
  assert.deepEqual(manager([dm(40, { waitUntil: now + H })]), [], 'inside its own watch.js wait');
  assert.deepEqual(manager([dm(40, { limit: { at: iso(now - 40 * 60e3), resetsAt: iso(now + H) } })]), [], 'on its usage limit: the limit stall reports its resume time');
  assert.deepEqual(manager([]), [], 'no Delivery Manager session on this host to restart');
  // a chain that cannot be read is said, never read as nothing waiting
  reviewRows(root, 7, ['request'], iso(now - H));
  fs.appendFileSync(R.fileOf(root, '7', DM), '{torn\n');
  const bad = [];
  WD.managerPrs(root, bad);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^the review record of PR 7/);
  assert.match(watchdog.checkLines({ stalls: [], polls: [], unreadableParts: bad }).join('\n'), /^Unreadable: the review record of PR 7 .*; a stall waiting on it is not known\.$/m);
  assert.doesNotMatch(watchdog.checkLines({ stalls: [], polls: [], unreadableParts: bad }).join('\n'), /No stall/);
});

test('bqj: a review record raises no manager stall once every bead it names is closed; an old record with an open bead still does; a stopped area waits unless the PR is its recovery', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const dm = { instance: DM, role: DM, session: 's-dm', roleDir: os.tmpdir(), lastActive: now - 40 * 60e3 };
  const pr = (beads, at = iso(now - H)) => ({ pr: 1, state: 'passed', beads, last: 'rv-1-delivery-lead-2', at });
  const manager = (prs, beads = [], pause) => WD.stalls({ now: iso(now), prs, beads, sessions: [dm], ...(pause ? { pause } : {}) }).stalls.filter((s) => s.kind === 'manager').map((s) => s.pr);
  assert.deepEqual(manager([pr(['ex-a'])]), [1], 'a fresh record waits on the Delivery Manager');
  // a week-old record whose bead is still open is still stuck: never dropped silently
  assert.deepEqual(manager([pr(['ex-a'], iso(now - 7 * 24 * H))], [{ id: 'ex-a', status: 'in_progress' }]), [1], 'old record, open bead: still a stall');
  const closed = { id: 'ex-a', status: 'closed' };
  const open = { id: 'ex-b', status: 'in_progress' };
  assert.deepEqual(manager([pr(['ex-a'])], [closed]), [], 'every bead it names is closed');
  // PR 102: merged on GitHub with no merged row; its bead closed, so it is no longer waiting
  assert.deepEqual(manager([pr(['ex-a'], iso(now - 3 * 24 * H))], [closed]), [], 'old record, bead closed: no stall');
  assert.deepEqual(manager([pr(['ex-a', 'ex-b'])], [closed, open]), [1], 'one named bead still open');
  // the andon stop: a bead in a stopped area waits, unless it is the stop's recovery work
  const area = require('./lib/gates.js').areaOf({ id: 'ex-fail', metadata: { area: 'import' } });
  const stop = { paused: false, stops: [{ trigger: 'andon:ev-ex-fail-1', area }] };
  assert.deepEqual(manager([pr(['ex-other'])], [{ id: 'ex-other', status: 'in_progress', metadata: { area: 'import' } }], stop), [], 'a stopped area: no wake');
  assert.deepEqual(manager([pr(['ex-fail'])], [{ id: 'ex-fail', status: 'in_progress', metadata: { area: 'import' } }], stop), [1], 'the failed bead itself is the recovery: wake');
});

test('bqj: the first wake for the Delivery Manager\'s waiting merge goes at once, past its stall hour and its daily caps; the same one again backs off', () => {
  const t0 = Date.parse('2026-11-03T12:00:00Z');
  const ago = (m) => iso(t0 - m * 60e3);
  const merge = (row = 'rv-1-delivery-lead-2') => ({ kind: 'manager', key: `manager:1:${row}`, bead: 'ex-pr-1', target: DM, due: true, line: 'Waiting on the Delivery Manager: PR 1', prompt: 'merge it' });
  const plan = (rows, stalls) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bqj-'));
    for (const r of rows) WD.log(root, { type: 'wake', instance: DM, pid: 7, ...r });
    return WD.plan({ stalls }, { root, now: iso(t0), alive: () => false });
  };
  // woken for a P0 20 minutes ago: a stall would wait the hour; the waiting merge does not
  assert.equal(plan([{ at: ago(20), keys: ['p0:x'] }], [merge()]).wakes.length, 1);
  // its 24 stall wakes and 96 handovers spent today: the merge still goes
  const spent = [...Array.from({ length: 24 }, (_, i) => ({ at: ago(30 + 50 * i), keys: [`p0:old-${i}`] })), ...Array.from({ length: 96 }, (_, i) => ({ at: ago(5 + 14 * i), keys: [`message:x:${i}`] }))];
  assert.equal(plan(spent, [merge()]).wakes.length, 1, 'never held by a cap the first time');
  // a wake that carried it 20 minutes ago and found the Delivery Manager still stopped: a stall now, an hour apart, then 2 h
  assert.match(plan([{ at: ago(20), keys: [merge().key] }], [merge()]).held[0].reason, /one wake an hour/);
  assert.equal(plan([{ at: ago(70), keys: [merge().key] }], [merge()]).wakes.length, 1);
  assert.match(plan([{ at: ago(190), keys: [merge().key] }, { at: ago(70), keys: [merge().key] }], [merge()]).held[0].reason, /woken for these already/);
  // a new row on the record (a verdict, a re-request) is new work: at once again
  assert.equal(plan([{ at: ago(20), keys: [merge().key] }], [merge('rv-1-delivery-lead-3')]).wakes.length, 1);
  // it is a stall in the ledger, not a silent handover
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-bqj-'));
  WD.recordAll(root, { stalls: [merge()] }, [], { now: iso(t0) });
  assert.ok(Wn.list(root).some((w) => w.kind === 'stall' && w.bead === 'ex-pr-1'));
});

test('bqj TR-5: the Delivery Manager stopped while a merge waits on it is restarted by the next host-job run, and the owner\'s briefing reports the restart', () => {
  const now = Date.now();
  const h = harness({ beads: { 'ex-pr-1': { id: 'ex-pr-1', status: 'in_progress', assignee: 'dev@pc/builder-1', labels: ['state-in-review'], updated_at: iso(now - 30 * 60e3) } } });
  session(h, DM, { seen: iso(now - 45 * 60e3) });
  session(h, 'builder-1', { seen: iso(now - 60e3) });
  reviewRows(h.root, 1, ['request', 'pass'], iso(now - 40 * 60e3));
  // nothing is said to it: no message, no handoff; the record alone
  assert.match(h.bash(DM, `${h.script('watchdog.js')} check`).out, /^Waiting on the Delivery Manager: PR 1 has a passing review and waits for its merge/m);
  const log = scratchLog();
  const run = hostJob(h, ['run'], claudeEnv(log));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Woke delivery-lead \(resume of sess-delivery-lead\): Waiting on the Delivery Manager: PR 1/m);
  const [c] = calls(log);
  assert.deepEqual(c.argv.slice(2, 4), ['--resume', `sess-${DM}`]);
  assert.match(c.argv[c.argv.length - 1], /^Watchdog \(a host job, not the owner\): PR 1 \(ex-pr-1\) has a passing review and waits for its merge\. Take it now/);
  // the owner hears it in the briefing, in plain words
  const brief = h.bash(COS, `${h.script('plan.js')} brief`).out;
  assert.match(brief, /^The plugin restarted stopped sessions on its own: the Delivery Manager once when a merge or review waited on it\.$/m, brief);
  assert.doesNotMatch(brief, /PR 1|ex-pr-1|delivery-lead/, 'no internal ids in the owner\'s briefing');
  // the next run, with the session still quiet, does not wake it again within the hour
  assert.doesNotMatch(hostJob(h, ['run'], claudeEnv(log)).stdout, /^Woke delivery-lead/m);
});

test('bqj: the briefing never shows a team healthy when the watchdog could not read the record', () => {
  const DP = require('./lib/daily-plan.js');
  const f = { now: '2026-11-03T12:00:00Z', team: { roles: [] }, stalls: [], stalls_unreadable: 'the review record of PR 7', restarts: [], queue: [], questions: [], checks: [], andon: { stops: [], ci: {}, flaky: [], chains: [] }, unknowns: [], spikes: [], next: [], known: new Map(), titles: new Map(), stories: [], fixes: [], prs: {} };
  assert.match(DP.brief(f).join('\n'), /^The plugin could not read part of the team's record, so a stall there is not known yet\.$/m);
  assert.doesNotMatch(DP.brief({ ...f, stalls_unreadable: null }).join('\n'), /could not read/);
  // restarts older than the last plan are not reported again; routine handovers are not restarts
  const rows = [{ type: 'wake', at: '2026-11-03T08:00:00Z', instance: 'builder-1', keys: ['quiet:ex-a:x'] }, { type: 'wake', at: '2026-11-03T09:00:00Z', instance: 'builder-2', keys: ['quiet:ex-b:x'] }];
  assert.equal(DP.restartLine({ ...f, restarts: rows }, { at: '2026-11-03T08:30:00Z' }), 'The plugin restarted stopped sessions on its own: 1 other team member.');
  assert.equal(DP.restartLine({ ...f, restarts: rows }, { at: '2026-11-03T10:00:00Z' }), null);
  assert.equal(DP.isRecovery('message:delivery-lead:3'), false);
  assert.equal(DP.isRecovery('assigned:ex-a'), false);
  assert.equal(DP.isRecovery('manager:1:rv-1'), true);
});

// bqj.2: the job's self-update refused every stale per-role install for a day (0ba.4.1, job.log) and
// nothing but the job's own log said so: the watchdog read the team as healthy
const refusedRow = (at, target, version = '0.43.44', extra = {}) => ({ type: 'self-update', from: '0.43.30', version, sha: 'a'.repeat(40), pr: 140, scope: target === 'user' ? 'user' : 'local', target, at, result: 'refused', why: 'PR 140 was merged without passing the team\'s gate', ...extra });
const installedRow = (at, version, extra = {}) => ({ type: 'self-update', from: '0.43.30', version, sha: 'b'.repeat(40), pr: 141, scope: 'user', at, result: 'installed', detail: 'gated through PR 141; 1 install(s)', ...extra });

test('bqj.2: a refused self-update stands as an install stall for the Delivery Manager until a later install of it or a newer one covers that install', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const ROLE = 'local /team/builder';
  // refused for the user install and a role's local install; the same install refused again later keeps its latest refusal only
  const rows = [refusedRow(iso(now - 3 * H), 'user', '0.43.43'), refusedRow(iso(now - 2 * H), 'user'), refusedRow(iso(now - 2 * H), ROLE)];
  assert.deepEqual(WD.refusedInstalls(rows).map((r) => [r.target, r.version]), [['user', '0.43.44'], [ROLE, '0.43.44']]);
  const res = WD.stalls({ now: iso(now), refusedInstalls: WD.refusedInstalls(rows), sessions: [{ instance: DM, role: DM, session: 's-dm', roleDir: os.tmpdir(), lastActive: now - 60e3 }] });
  const found = res.stalls.filter((s) => s.kind === 'install');
  assert.deepEqual(found.map((s) => [s.key, s.target, s.due]), [['install:0.43.44:user', DM, true], [`install:0.43.44:${ROLE}`, DM, true]]);
  assert.match(found[0].line, /^Install refused: plugin 0\.43\.44 for the user install \(still on 0\.43\.30\) since 2026-11-04 10:00 UTC: PR 140 was merged without passing the team's gate\.$/);
  assert.match(found[1].line, /for the install \/team\/builder /);
  assert.match(found[0].prompt, /Settle it now/);
  assert.doesNotMatch(found[0].plain, /0\.43|PR 140|delivery-lead/, 'the owner\'s words carry no internal ids');
  // recovery: a later install that names the install ends its stall; one that names another install, an older version, or comes before the refusal does not
  const cover = (r) => WD.refusedInstalls([...rows, r]).map((x) => x.target);
  assert.deepEqual(cover(installedRow(iso(now - H), '0.43.44', { targets: ['user'] })), [ROLE]);
  assert.deepEqual(cover(installedRow(iso(now - H), '0.43.45', { targets: ['user', ROLE] })), []);
  assert.deepEqual(cover(installedRow(iso(now - H), '0.43.43', { targets: ['user', ROLE] })), ['user', ROLE], 'an older version does not cover the refusal');
  assert.deepEqual(cover(installedRow(iso(now - 3 * H), '0.43.44', { targets: ['user', ROLE] })), ['user', ROLE], 'an install before the refusal does not end it');
  // a row from before installs were named covers the user install only: it never hides a role's refusal
  assert.deepEqual(cover(installedRow(iso(now - H), '0.43.44')), [ROLE]);
  // a verified pause silences it like every stall
  assert.deepEqual(WD.stalls({ now: iso(now), refusedInstalls: WD.refusedInstalls(rows), pause: { paused: true } }).stalls, []);
});

test('bqj.2: a refused install in the job log is a stall on watchdog.js check, a warning in the ledger, and a line in the owner\'s briefing, never a healthy team', () => {
  const now = Date.now();
  const h = harness({ beads: {} });
  session(h, DM, { seen: iso(now - 60e3) });
  session(h, 'builder-1', { seen: iso(now - 60e3) });
  WD.log(h.root, refusedRow(iso(now - 2 * H), 'local /team/builder'));
  // the role install is recorded (rv-167), so its refusal stands whatever this machine has installed
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'bqj2-'));
  fs.mkdirSync(path.join(cfg, 'plugins'));
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'delivery@ai-augmentation-systems': [{ scope: 'local', projectPath: '/team/builder', version: '0.43.30' }] } }));
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const check = h.bash(DM, `${h.script('watchdog.js')} check`).out;
    assert.match(check, /^Install refused: plugin 0\.43\.44 for the install \/team\/builder \(still on 0\.43\.30\)/m, check);
    assert.ok(Wn.list(h.root).some((w) => w.kind === 'install-refused' && /0\.43\.44 refused for local \/team\/builder/.test(w.detail)), 'recorded in the ledger');
    const brief = h.bash(COS, `${h.script('plan.js')} brief`).out;
    assert.match(brief, /^An update of the team's plugin was refused, so part of the team still runs an older version; the Delivery Manager is asked to settle it\.$/m, brief);
    // settled: the next install covers it, and the briefing and check say nothing of it
    WD.log(h.root, installedRow(iso(now - H), '0.43.44', { targets: ['user', 'local /team/builder'] }));
    assert.doesNotMatch(h.bash(DM, `${h.script('watchdog.js')} check`).out, /Install refused/);
    assert.doesNotMatch(h.bash(COS, `${h.script('plan.js')} brief`).out, /plugin was refused/);
  } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
});

// rv-167: removing the stale install is one way the Delivery Manager settles a refusal, and no install
// row names a removed install again: its refusal must end then, or the stall and the briefing line stay forever
test('rv-167: a refusal for an install no longer recorded ends; one still recorded, or with the record unreadable, stays', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const ROLE = 'local /team/builder';
  const rows = [refusedRow(iso(now - 2 * H), 'user'), refusedRow(iso(now - 2 * H), ROLE)];
  const left = (installs) => WD.refusedInstalls(rows, { installs }).map((r) => r.target);
  assert.deepEqual(left(['user']), ['user'], 'the role install was removed: its refusal ends');
  assert.deepEqual(left(['user', ROLE]), ['user', ROLE], 'both still installed: both stand');
  assert.deepEqual(left(null), ['user', ROLE], 'an unreadable record keeps every refusal');
  // the record as self-update reads it: the delivery plugin's entries only, named as selfUpdate names them
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rv167-'));
  const SU = require('./lib/self-update.js');
  assert.equal(SU.installTargets('delivery', cfg), null);
  fs.mkdirSync(path.join(cfg, 'plugins'));
  const write = (plugins) => fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  const both = { 'delivery@ai-augmentation-systems': [{ scope: 'user', version: '0.43.30' }, { scope: 'local', projectPath: '/team/builder', version: '0.43.30' }], 'attractor@ai-augmentation-systems': [{ scope: 'local', projectPath: '/team/other' }] };
  const userOnly = { 'delivery@ai-augmentation-systems': [{ scope: 'user', version: '0.43.30' }] };
  write(both);
  assert.deepEqual(SU.installTargets('delivery', cfg), [{ key: 'delivery@ai-augmentation-systems', target: 'user', version: '0.43.30' }, { key: 'delivery@ai-augmentation-systems', target: ROLE, version: '0.43.30' }]);
  write(userOnly);
  assert.deepEqual(SU.installTargets('delivery', cfg), [{ key: 'delivery@ai-augmentation-systems', target: 'user', version: '0.43.30' }]);
  // through watchdog.js check: still installed, the stall is reported; removed, it is not
  const h = harness({ beads: {} });
  session(h, DM, { seen: iso(Date.now() - 60e3) });
  WD.log(h.root, refusedRow(iso(Date.now() - 2 * H), ROLE));
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const check = () => h.bash(DM, `${h.script('watchdog.js')} check`).out;
    write(both);
    assert.match(check(), /^Install refused: plugin 0\.43\.44 for the install \/team\/builder /m);
    write(userOnly);
    assert.doesNotMatch(check(), /Install refused/);
  } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
});

// rv-167 (second review): an operator or a role can bring an install up with `claude plugin update`,
// outside the job, which then writes no installed row for it: the record's own version must end the
// refusal, or the stall and the briefing line stay for good
test('rv-167: a refusal ends when its install is recorded at the refused version or newer; an older or unknown version keeps it', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const ROLE = 'local /team/builder';
  const rows = [refusedRow(iso(now - 2 * H), 'user'), refusedRow(iso(now - 2 * H), ROLE)];
  const left = (installs) => WD.refusedInstalls(rows, { installs }).map((r) => r.target);
  const at = (v) => [{ target: 'user', version: '0.43.30' }, { target: ROLE, version: v }];
  assert.deepEqual(left(at('0.43.44')), ['user'], 'updated outside the job to the refused version: its refusal ends');
  assert.deepEqual(left(at('0.43.50')), ['user'], 'updated past it: ends too');
  assert.deepEqual(left(at('0.43.43')), ['user', ROLE], 'still below the refused version: stands');
  assert.deepEqual(left(at(null)), ['user', ROLE], 'no recorded version: stands');
  assert.deepEqual(left(at('not-a-version')), ['user', ROLE], 'an unreadable version: stands');
  // end to end: the record as installTargets reads it, through watchdog.js check
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rv167b-'));
  fs.mkdirSync(path.join(cfg, 'plugins'));
  const write = (v) => fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'delivery@ai-augmentation-systems': [{ scope: 'user', version: '0.43.44' }, { scope: 'local', projectPath: '/team/builder', version: v }] } }));
  const h = harness({ beads: {} });
  session(h, DM, { seen: iso(Date.now() - 60e3) });
  WD.log(h.root, refusedRow(iso(Date.now() - 2 * H), ROLE));
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const check = () => h.bash(DM, `${h.script('watchdog.js')} check`).out;
    write('0.43.30');
    assert.match(check(), /^Install refused: plugin 0\.43\.44 for the install \/team\/builder /m);
    write('0.43.44');
    assert.doesNotMatch(check(), /Install refused/);
  } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
});

// rv-167 (third review): a same-named plugin from another marketplace must not settle a refusal, and an
// installed row whose version cannot be read must not cover one (compare returns null for it)
test('rv-167: only the refused key\'s own install settles a refusal; another marketplace\'s or an unreadable installed version never does', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const ROLE = 'local /team/builder';
  const OWN = 'delivery@ai-augmentation-systems';
  const FORK = 'delivery@someone-else';
  const rows = [refusedRow(iso(now - 2 * H), ROLE, '0.43.44', { key: OWN })];
  const left = (installs, rs = rows) => WD.refusedInstalls(rs, { installs }).map((r) => r.target);
  assert.deepEqual(left([{ key: OWN, target: ROLE, version: '0.43.30' }, { key: FORK, target: ROLE, version: '9.0.0' }]), [ROLE], 'another marketplace at a higher version: stands');
  assert.deepEqual(left([{ key: FORK, target: ROLE, version: '9.0.0' }]), [], 'its own install gone (only the other marketplace left): ends');
  assert.deepEqual(left([{ key: OWN, target: ROLE, version: '0.43.44' }, { key: FORK, target: ROLE, version: '0.1.0' }]), [], 'its own install caught up: ends');
  // a refusal recorded before keys were: matched while one key holds the name, kept when two do
  const legacy = [refusedRow(iso(now - 2 * H), ROLE)];
  assert.deepEqual(left([{ key: OWN, target: ROLE, version: '0.43.44' }], legacy), [], 'one key, caught up: ends');
  assert.deepEqual(left([{ key: OWN, target: ROLE, version: '0.43.30' }, { key: FORK, target: ROLE, version: '9.0.0' }], legacy), [ROLE], 'two keys: cannot tell, stands');
  // an installed row with an unreadable version never covers the refusal; a readable newer one does
  const user = (v) => [refusedRow(iso(now - 2 * H), 'user'), installedRow(iso(now - H), v)];
  assert.deepEqual(WD.refusedInstalls(user('not-a-version')).map((r) => r.target), ['user'], 'unreadable installed version: stands');
  assert.deepEqual(WD.refusedInstalls(user('0.43.45')).map((r) => r.target), [], 'installed at a newer version: ends');
  // through the record as installTargets reads it: two marketplaces, the other one ahead
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rv167c-'));
  fs.mkdirSync(path.join(cfg, 'plugins'));
  fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [OWN]: [{ scope: 'local', projectPath: '/team/builder', version: '0.43.30' }], [FORK]: [{ scope: 'local', projectPath: '/team/builder', version: '9.0.0' }] } }));
  const SU = require('./lib/self-update.js');
  assert.deepEqual(left(SU.installTargets('delivery', cfg)), [ROLE]);
});

test('bqj.2: the briefing names a refused install even when other stalls fill its stall lines', () => {
  const DP = require('./lib/daily-plan.js');
  const f = { now: '2026-11-04T12:00:00Z', team: { roles: [] }, stalls_unreadable: null, restarts: [], queue: [], questions: [], checks: [], andon: { stops: [], ci: {}, flaky: [], chains: [] }, unknowns: [], spikes: [], next: [], known: new Map(), titles: new Map(), stories: [], fixes: [], prs: {} };
  const stall = (kind, plain, i) => ({ kind, key: `${kind}:${i}`, bead: kind === 'install' ? undefined : `ex-${i}`, target: DM, line: plain, plain });
  const stalls = [stall('quiet', 'A started item has not moved.', 1), stall('p0', 'A top-priority item waits.', 2), stall('install', 'An update of the team\'s plugin was refused, so part of the team still runs an older version; the Delivery Manager is asked to settle it.', 3)];
  const out = DP.brief({ ...f, stalls }).join('\n');
  assert.match(out, /^An update of the team's plugin was refused/m, out);
  assert.match(out, /^A started item has not moved\.$/m);
  assert.doesNotMatch(DP.brief({ ...f, stalls: stalls.slice(0, 2) }).join('\n'), /plugin was refused/);
});

// 6z5: a builder was woken every pass overnight for beads it could not move, spent its 48 handover wakes
// by midday, and the review that sent its pull request back was held behind "alarm only"
const B2 = 'builder-2';
const sess6 = (inst, lastActive) => ({ instance: inst, role: inst.replace(/-\d+$/, ''), session: `s-${inst}`, roleDir: os.tmpdir(), lastActive });
const assigned6 = (r) => r.stalls.filter((s) => s.kind === 'assigned').map((s) => s.bead);
const dir6 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-6z5-'));
const plan6 = (rows, stalls, now) => {
  const where = dir6();
  for (const r of rows) WD.log(where, { type: 'wake', instance: B2, pid: 7, ...r });
  return WD.plan({ stalls }, { root: where, now, alive: () => false });
};

test('6z5: assigned work waiting on its review, or queued behind its holder\'s own work in progress, does not wake the holder', () => {
  const now = Date.parse('2026-11-03T02:00:00Z');
  const mine = (id, status, extra = {}) => ({ id, status, assignee: `dev@pc/${B2}`, updated_at: iso(now - 30 * 60e3), ...extra });
  const prog = mine('ex-review', 'in_progress');
  const queued = mine('ex-next', 'open');
  const sessions = [sess6(B2, now - 30 * 60e3), sess6(DM, now - 30 * 60e3)];
  const st = (reviews, beads = [prog, queued]) => WD.stalls({ now: iso(now), beads, ready: [queued], sessions, reviews });
  // its PR waits for review (any state but changes or sent back): neither bead wakes it
  for (const state of ['waiting', 'passed', 'ready', 'stale', 'failing']) assert.deepEqual(assigned6(st([{ pr: '151', state, beads: ['ex-review'], owners: [B2] }])), [], state);
  // the other direction: changes asked, or sent back, it is the builder's again; the queued bead still waits behind it
  for (const state of ['changes', 'sent-back']) assert.deepEqual(assigned6(st([{ pr: '151', state, beads: ['ex-review'], owners: [B2] }])), ['ex-review'], state);
  // no review record: the in-progress bead wakes it, the queued one waits behind it
  assert.deepEqual(assigned6(st([])), ['ex-review']);
  // the queued bead alone (its holder's other work is merged and waits on evidence, not its work): woken
  assert.deepEqual(assigned6(st([], [{ ...prog, labels: ['state-merged'] }, queued])), ['ex-next']);
  assert.deepEqual(assigned6(st([], [queued])), ['ex-next']);
  // another holder's work in progress does not hold it
  assert.deepEqual(assigned6(st([], [{ ...prog, assignee: 'dev@pc/builder' }, queued])), ['ex-next']);
});

test('6z5: a bead whose PR has waited past stall_hours for its review is the Delivery Manager\'s, not its builder\'s', () => {
  const now = Date.parse('2026-11-03T08:00:00Z');
  const prog = { id: 'ex-review', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 3 * H) };
  const sessions = [sess6(B2, now - 3 * H), sess6(DM, now - 10 * 60e3)];
  const quiet = (reviews) => WD.stalls({ now: iso(now), beads: [prog], sessions, reviews, stallHours: 2 }).stalls.filter((s) => s.kind === 'quiet').map((s) => [s.key, s.target]);
  assert.deepEqual(quiet([{ pr: '151', state: 'waiting', beads: ['ex-review'], owners: [B2] }]), [['reviewing:ex-review', DM]]);
  // the other direction: sent back, the stall is its holder's
  const back = quiet([{ pr: '151', state: 'sent-back', beads: ['ex-review'], owners: [B2] }]);
  assert.equal(back.length, 1);
  assert.equal(back[0][1], B2);
});

test('6z5: a pull request sent back to its author wakes it once, past any daily cap; a new request ends it', () => {
  const t0 = Date.parse('2026-11-03T12:30:00Z');
  const ago = (m) => new Date(t0 - m * 60e3).toISOString();
  const sb = { id: 'rv-151-delivery-lead-9', at: ago(5), reason: 'changes', note: 'two pin bypasses' };
  const review = { pr: '151', state: 'sent-back', beads: ['ex-review'], owners: [B2], sentBack: sb };
  const sessions = [sess6(B2, t0 - 60 * 60e3)];
  const st = (o = {}) => WD.stalls({ now: iso(t0), beads: [], sessions, reviews: [review], ...o }).stalls.filter((s) => s.kind === 'review');
  const one = st();
  assert.deepEqual(one.map((s) => [s.key, s.target]), [['review:151:rv-151-delivery-lead-9', B2]]);
  assert.match(one[0].prompt, /PR 151 was sent back to you .*two pin bypasses.*ex-review/);
  // once a wake carried it, it is handed over; a new request (state no longer sent-back) ends it; an owner off the roster wakes nobody
  assert.deepEqual(st({ woken: ['review:151:rv-151-delivery-lead-9'] }), []);
  assert.deepEqual(st({ reviews: [{ ...review, state: 'waiting' }] }), []);
  assert.deepEqual(st({ sessions: [] }), []);
  // planned past the message day: 60 handover wakes logged, it still goes
  const sixty = Array.from({ length: 60 }, (_, i) => ({ at: ago(10 * (i + 1)), keys: [`message:${B2}:${i}`] }));
  const p = plan6(sixty, one, iso(t0));
  assert.deepEqual(p.wakes.map((w) => w.keys), [['review:151:rv-151-delivery-lead-9']]);
  assert.deepEqual(p.held, []);
});

test('6z5: wakes for assigned work alone have their own day, so they never hold a message; their own cap and backoff hold them', () => {
  const t0 = Date.parse('2026-11-03T12:00:00Z');
  const ago = (m) => new Date(t0 - m * 60e3).toISOString();
  const asg = (id) => ({ kind: 'assigned', key: `assigned:${id}`, bead: id, target: B2, due: true, line: `Assigned and waiting: ${id}`, prompt: `work ${id}` });
  const msg = { kind: 'message', key: `message:${B2}:1`, target: B2, due: true, line: 'Waiting: 1 message', prompt: 'read it.', upTo: 1 };
  const plan = (rows, stalls) => plan6(rows, stalls, iso(t0));
  const assignedRows = (n) => Array.from({ length: n }, (_, i) => ({ at: ago(16 * (i + 1)), keys: [`assigned:old-${i}`] }));
  // 48 wakes for assigned work alone: a message still goes, and the assigned work rides it
  const m = plan(assignedRows(48), [msg, asg('ex-a')]);
  assert.deepEqual(m.wakes.map((w) => w.keys), [[`message:${B2}:1`, 'assigned:ex-a']]);
  // assigned work alone stops at its own cap, with its own reason
  const capped = plan(assignedRows(WD.ASSIGNED_DAILY_CAP), [asg('ex-a')]);
  assert.equal(capped.wakes.length, 0);
  assert.match(capped.held[0].reason, new RegExp(`woken ${WD.ASSIGNED_DAILY_CAP} times in a day for assigned work alone`));
  assert.equal(plan(assignedRows(WD.ASSIGNED_DAILY_CAP - 1), [asg('ex-a')]).wakes.length, 1, 'one under the cap: woken');
  // the message day counts messages, not assigned work: 48 message wakes hold the message, not the assigned work
  const msgRows = Array.from({ length: 48 }, (_, i) => ({ at: ago(16 * (i + 1)), keys: [`message:${B2}:old-${i}`] }));
  const full = plan(msgRows, [msg, asg('ex-a')]);
  assert.deepEqual(full.wakes.map((w) => w.keys), [['assigned:ex-a']]);
  assert.match(full.held[0].reason, /woken 48 times in a day; alarm only/);
  // each assigned bead backs off: woken 3 times for it, the next waits 20 min after the last
  const wait = plan([ago(60), ago(40), ago(15)].map((at) => ({ at, keys: ['assigned:ex-a'] })), [asg('ex-a')]);
  assert.equal(wait.wakes.length, 0);
  assert.match(wait.held[0].reason, /waiting longer before the next try/);
  assert.equal(plan([ago(60), ago(40), ago(21)].map((at) => ({ at, keys: ['assigned:ex-a'] })), [asg('ex-a')]).wakes.length, 1, '21 min after: woken');
});

test('6z5: the review facts come from the review records: a request waits, a send-back names its owners and row, a new request clears it', () => {
  const R = require('./lib/reviews.js');
  const where = dir6();
  const head = 'a'.repeat(40);
  R.append(where, '151', { type: 'request', head, owner: B2, reviewer: 'pr-reviewer', beads: ['ex-review'], at: '2026-11-03T10:00:00Z' }, DM);
  assert.deepEqual(WD.reviewFacts(where).map((r) => [r.pr, r.state, r.beads, r.owners, r.sentBack]), [['151', 'waiting', ['ex-review'], [B2], null]]);
  const sb = R.append(where, '151', { type: 'sent-back', head, reason: 'changes', note: 'fix it', owners: [B2], at: '2026-11-03T11:00:00Z' }, DM);
  const back = WD.reviewFacts(where)[0];
  assert.deepEqual([back.state, back.owners, back.sentBack.id, back.sentBack.note], ['sent-back', [B2], sb.id, 'fix it']);
  R.append(where, '151', { type: 'request', head: 'b'.repeat(40), owner: B2, reviewer: 'pr-reviewer', beads: ['ex-review'], at: '2026-11-03T12:00:00Z' }, DM);
  assert.equal(WD.reviewFacts(where)[0].state, 'waiting');
  // no records: nothing, never a throw
  assert.deepEqual(WD.reviewFacts(dir6()), []);
});

test('6z5: a night of watchdog passes over blocked work wakes the builder for none of it, and the morning\'s send-back and message go at once', () => {
  const start = Date.parse('2026-11-02T20:33:00Z');
  const end = Date.parse('2026-11-03T07:49:00Z');
  const where = dir6();
  const mine = (id, status, labels = []) => ({ id, status, assignee: `dev@pc/${B2}`, labels, updated_at: iso(start - 5 * 60e3), created_at: iso(start - 5 * H) });
  // as on the night: two beads waiting on their review, two merged waiting on evidence, one queued behind them
  const beads = [mine('ex-4', 'in_progress'), mine('ex-8-2', 'in_progress'), mine('ex-2ys', 'in_progress', ['state-merged']), mine('ex-0ba', 'in_progress', ['state-deployed']), mine('ex-5', 'open')];
  const reviews = [{ pr: '150', state: 'waiting', beads: ['ex-4'], owners: [B2] }, { pr: '151', state: 'waiting', beads: ['ex-8-2'], owners: [B2] }];
  let active = start - 60 * 60e3;
  let builderWakes = 0;
  const pass = (t, extra = {}) => {
    const sessions = [sess6(B2, active), sess6(DM, t - 5 * 60e3)];
    const st = WD.stalls({ now: iso(t), beads, ready: [beads[4]], sessions, reviews, stallHours: 2, ...extra });
    const p = WD.plan(st, { root: where, now: iso(t), alive: () => false });
    for (const w of p.wakes) {
      WD.log(where, { type: 'wake', instance: w.target, pid: 7, at: iso(t), keys: w.keys });
      // a wake that finds nothing to do still notes it on the bead, as on the night, so the beads stay fresh
      if (w.target === B2) { builderWakes++; active = t + 2 * 60e3; for (const x of beads) x.updated_at = iso(t + 60e3); }
    }
    return p;
  };
  for (let t = start; t <= end; t += 16 * 60e3) pass(t);
  assert.ok(builderWakes <= 2, `at most a few assigned wakes overnight (${builderWakes})`);
  // the morning: PR 151 is sent back and a message waits; both reach the builder in the next pass, even
  // after the 48 wakes for assigned work alone that spent the day before this change
  for (let i = 0; i < 48; i++) WD.log(where, { type: 'wake', instance: B2, pid: 7, at: iso(end - (i + 1) * 13 * 60e3), keys: ['assigned:ex-old'] });
  reviews[1] = { ...reviews[1], state: 'sent-back', sentBack: { id: 'rv-151-delivery-lead-9', at: iso(end), reason: 'changes' } };
  const messages = [{ to: B2, upTo: 4, entries: [{ from: DM, message: 'PR 151 sent back' }] }];
  const p = pass(end + 60e3, { messages });
  const w = p.wakes.find((x) => x.target === B2);
  assert.ok(w, JSON.stringify(p.held));
  assert.ok(w.keys.includes('review:151:rv-151-delivery-lead-9'));
  assert.ok(w.keys.includes(`message:${B2}:4`));
});

// hjx.1.1: in-progress work its holder has said it cannot move was woken every pass anyway, and each
// wake's own turn reset the stall clock (lastMove took the holder's lastActive), so a blocked bead
// never reached stall_hours and its holder was woken up to the daily cap with nothing to do
const blockedNote = (now) => `${iso(now - 5 * H).slice(0, 10)} builder-2: claimed.\n${iso(now - 40 * 60e3).slice(0, 10)} builder-2: Blocked: the story is a draft. Unblock: delivery-lead records it ready.`;
test('hjx.1.1: in-progress work whose last note names a blocker does not wake its holder; past stall_hours the Delivery Manager is asked', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const prog = (notes, ago = 40 * 60e3) => ({ id: 'ex-blocked', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - ago), notes });
  const sessions = [sess6(B2, now - 40 * 60e3), sess6(DM, now - 5 * 60e3)];
  const st = (b, o = {}) => WD.stalls({ now: iso(now), beads: [b], sessions, stallHours: 2, ...o }).stalls;
  assert.deepEqual(assigned6({ stalls: st(prog(blockedNote(now))) }), []);
  // the other direction: a later note that is not a blocker (work moved on) makes it the holder's again
  assert.deepEqual(assigned6({ stalls: st(prog(`${blockedNote(now)}\n2026-11-07 builder-2: delivery-lead recorded it ready; building.`)) }), ['ex-blocked']);
  assert.deepEqual(assigned6({ stalls: st(prog('2026-11-07 builder-2: claimed; writing the tests.')) }), ['ex-blocked']);
  // past stall_hours: the stall goes to the Delivery Manager, once per blocker note, never to the holder
  const longQuiet = { sessions: [sess6(B2, now - 3 * H), sess6(DM, now - 5 * 60e3)] };
  const old = st(prog(blockedNote(now), 3 * H), longQuiet).filter((s) => s.kind === 'quiet');
  assert.deepEqual(old.map((s) => [s.key, s.target]), [[`blocked:ex-blocked:${iso(now - 3 * H)}`, DM]]);
  assert.match(old[0].prompt, /ex-blocked.*blocker.*Unblock: delivery-lead/);
  // not blocked, past stall_hours: its holder, as before
  assert.deepEqual(st(prog('2026-11-07 builder-2: building.', 3 * H), longQuiet).filter((s) => s.kind === 'quiet').map((s) => s.target), [B2]);
});

test('hjx.1.1: a wake\'s own turn is not a move: the holder\'s activity after the bead\'s last wake does not reset its stall clock', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const prog = { id: 'ex-w', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 3 * H) };
  const sessions = [sess6(B2, now - 20 * 60e3)];
  const quiet = (wakes) => WD.stalls({ now: iso(now), beads: [prog], sessions, stallHours: 2, wakes }).stalls.filter((s) => s.kind === 'quiet').map((s) => [s.key, s.target]);
  // woken for this bead 25 minutes ago, active only since: the bead last moved 3 h ago, so it has stalled
  assert.deepEqual(quiet([{ at: iso(now - 25 * 60e3), keys: ['assigned:ex-w'] }]), [[`quiet:ex-w:${iso(now - 3 * H)}`, B2]]);
  assert.deepEqual(quiet([{ at: iso(now - 25 * 60e3), keys: [`quiet:ex-w:${iso(now - 5 * H)}`] }]), [[`quiet:ex-w:${iso(now - 3 * H)}`, B2]]);
  // the other direction: activity with no wake of this bead before it is the holder's own move
  assert.deepEqual(quiet([]), []);
  assert.deepEqual(quiet([{ at: iso(now - 25 * 60e3), keys: ['assigned:ex-other'] }]), []);
  assert.deepEqual(quiet([{ at: iso(now - 10 * 60e3), keys: ['assigned:ex-w'] }]), []);
  // so the assigned rule hands it to the stall rule (one wake, not two) instead of waking it every pass
  const all = WD.stalls({ now: iso(now), beads: [prog], sessions, stallHours: 2, wakes: [{ at: iso(now - 25 * 60e3), keys: ['assigned:ex-w'] }] }).stalls;
  assert.deepEqual(all.map((s) => s.kind), ['quiet']);
});

test('hjx.1.1: read() hands the wake log to the stall rules', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const root = dir6();
  try {
    const beads = [{ id: 'ex-w', status: 'in_progress', assignee: `dev@pc/${B2}`, labels: [], updated_at: iso(now - 3 * H) }];
    registerInstance(root, { instance: B2, session_id: 's-b2', host: 'pc', model: 'opus', role_dir: root, now: iso(now - 20 * 60e3) });
    const store = { list: () => beads, ready: () => [], show: (x) => beads.find((b) => b.id === x) || null };
    const quiet = () => {
      const res = WD.read(root, { bd: store, now: iso(now), installed: true, pause: { paused: false } });
      assert.equal(res.unreadable, undefined, res.unreadable);
      return res.stalls.filter((s) => s.kind === 'quiet').map((s) => s.bead);
    };
    // no wake logged: the holder's activity 20 minutes ago is its own move
    assert.deepEqual(quiet(), []);
    // woken for the bead 25 minutes ago: that activity is the wake's own turn, so the bead has stalled
    WD.log(root, { type: 'wake', at: iso(now - 25 * 60e3), target: B2, keys: ['assigned:ex-w'] });
    assert.deepEqual(quiet(), ['ex-w']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// rv-179-delivery-lead-3: only a deliberate "Blocked:" note is a blocker. The Delivery Manager's pass
// notes (role-watch.js record: "<date> <dm> pass: ... action unblock ...") and prose that names a
// blocker ("no longer blocked", "the blocker half was open") are not
test('hjx.1.1: only a note that starts with Blocked: after its date and author is a blocker; pass notes and prose are not', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const prog = (notes) => ({ id: 'ex-b', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 40 * 60e3), notes });
  const sessions = [sess6(B2, now - 40 * 60e3), sess6(DM, now - 5 * 60e3)];
  const woken = (notes) => assigned6(WD.stalls({ now: iso(now), beads: [prog(notes)], sessions, stallHours: 2 }));
  const claimed = '2026-11-07 builder-2: claimed.';
  assert.deepEqual(woken(`${claimed}\n2026-11-07 builder-2: no longer blocked; building.`), ['ex-b']);
  assert.deepEqual(woken(`${claimed}\n2026-11-07 builder-2: checked. Blocker half was open; built it.`), ['ex-b']);
  assert.deepEqual(woken(`${claimed}\n2026-11-07 delivery-lead pass: builder-2 fails (sent back); action unblock: PR 179 was sent back and builder-2 has not taken it`), ['ex-b']);
  // the deliberate marker blocks, with or without an author
  assert.deepEqual(woken(`${claimed}\n2026-11-07 builder-2: Blocked: the story is a draft.`), []);
  assert.deepEqual(woken(`${claimed}\n2026-11-07: Blocked: waits on the owner's sign-in.`), []);
  // a pass note after a blocker note is skipped: the blocker still stands
  assert.deepEqual(woken(`${claimed}\n2026-11-07 builder-2: Blocked: the story is a draft.\n2026-11-07 delivery-lead pass: builder-2 fails (quiet); action note-block: waits on delivery-lead`), []);
});

// rv-179-delivery-lead-3: the Delivery Manager's ask for a blocker is keyed and measured on the bead's
// own updated_at, so the holder's session activity neither renews the key nor holds the ask back
test('hjx.1.1: the blocked ask to the Delivery Manager is keyed and timed on the bead update alone', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const b = { id: 'ex-bk', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 3 * H), notes: '2026-11-07 builder-2: Blocked: the story is a draft.' };
  const ask = (active) => WD.stalls({ now: iso(now), beads: [b], sessions: [sess6(B2, active), sess6(DM, now - 5 * 60e3)], stallHours: 2 }).stalls.filter((s) => s.kind === 'quiet').map((s) => [s.key, s.target]);
  // the holder active since (no wake logged, so it is its own activity): the ask still goes, keyed on the bead
  assert.deepEqual(ask(now - 30 * 60e3), [[`blocked:ex-bk:${iso(now - 3 * H)}`, DM]]);
  assert.deepEqual(ask(now - 10 * 60e3), [[`blocked:ex-bk:${iso(now - 3 * H)}`, DM]]);
  // the other direction: the bead itself moved recently, so no ask yet
  const fresh = { ...b, updated_at: iso(now - 30 * 60e3) };
  assert.deepEqual(WD.stalls({ now: iso(now), beads: [fresh], sessions: [sess6(B2, now - 3 * H)], stallHours: 2 }).stalls.filter((s) => s.kind === 'quiet'), []);
});

// hjx.1.1.1 (rv-179 low notes 2-4): the blocked ask is timed and keyed on the Blocked: note itself, so a
// later pass note that touches updated_at does not re-arm it; it reaches the Delivery Manager while the
// holder sits on a usage limit or in a watch wait; and a note stamped with a full time is a blocker too
test('hjx.1.1.1: a Blocked: note stamped with a full time is a blocker, with or without an author', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const prog = (notes) => ({ id: 'ex-ft', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 40 * 60e3), notes });
  const sessions = [sess6(B2, now - 40 * 60e3), sess6(DM, now - 5 * 60e3)];
  const woken = (notes) => assigned6(WD.stalls({ now: iso(now), beads: [prog(notes)], sessions, stallHours: 2 }));
  assert.deepEqual(woken('2026-11-07T11:20:00Z builder-2: Blocked: the story is a draft.'), []);
  assert.deepEqual(woken('2026-11-07T11:20:00.123Z: Blocked: waits on a sign-in.'), []);
  assert.deepEqual(woken('2026-11-07T11:20:00+01:00 builder-2: Blocked: waits on a sign-in.'), []);
  // the other direction: a full-time note that is not a blocker leaves it the holder's
  assert.deepEqual(woken('2026-11-07T11:20:00Z builder-2: no longer blocked; building.'), ['ex-ft']);
});

test('hjx.1.1.1: the blocked ask is timed and keyed on the Blocked: note, so a later pass note does not re-arm it', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const note = `${iso(now - 3 * H)} builder-2: Blocked: the story is a draft.`;
  const pass = `${iso(now - 20 * 60e3)} delivery-lead pass: builder-2 fails (quiet); action note-block: waits on delivery-lead`;
  const sessions = [sess6(B2, now - 3 * H), sess6(DM, now - 5 * 60e3)];
  const ask = (b) => WD.stalls({ now: iso(now), beads: [b], sessions, stallHours: 2 }).stalls.filter((s) => s.kind === 'quiet').map((s) => [s.key, s.target]);
  // the pass note moved updated_at 20 minutes ago; the blocker is 3 h old, so the ask goes, keyed on the note
  assert.deepEqual(ask({ id: 'ex-pn', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 20 * 60e3), notes: `${note}\n${pass}` }),
    [[`blocked:ex-pn:${iso(now - 3 * H)}`, DM]]);
  // the other direction: a fresh blocker note is not asked about yet, whatever updated_at says
  const fresh = `${iso(now - 30 * 60e3)} builder-2: Blocked: the story is a draft.`;
  assert.deepEqual(ask({ id: 'ex-pn', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 3 * H), created_at: iso(now - 5 * H), notes: fresh }), []);
  // a date-only note is bounded by its own day: a pass note on a later day does not re-arm it
  const day = { id: 'ex-pd', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 20 * 60e3), notes: `2026-11-06 builder-2: Blocked: the story is a draft.\n2026-11-07 delivery-lead pass: builder-2 fails (quiet); action note-block` };
  assert.deepEqual(ask(day), [[`blocked:ex-pd:${iso(Date.parse('2026-11-07T00:00:00Z') - 1)}`, DM]]);
});

test('hjx.1.1.1: a blocker reaches the Delivery Manager while its holder is on a usage limit or in a watch wait', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const b = { id: 'ex-lw', status: 'in_progress', assignee: `dev@pc/${B2}`, updated_at: iso(now - 3 * H), notes: `${iso(now - 3 * H)} builder-2: Blocked: the story is a draft.` };
  const asks = (holder) => WD.stalls({ now: iso(now), beads: [b], sessions: [holder, sess6(DM, now - 5 * 60e3)], stallHours: 2 }).stalls.filter((s) => s.bead === 'ex-lw' && s.kind === 'quiet').map((s) => s.target);
  assert.deepEqual(asks({ ...sess6(B2, now - 3 * H), waitUntil: now + H }), [DM]);
  assert.deepEqual(asks({ ...sess6(B2, now - 3 * H), limit: { at: iso(now - 3 * H), resetsAt: iso(now + H), window: 'five_hour', text: 'limit' } }), [DM]);
  // the other direction: work that is not blocked stays held while its holder waits or is limited
  const free = { ...b, notes: `${iso(now - 3 * H)} builder-2: building.` };
  assert.deepEqual(WD.stalls({ now: iso(now), beads: [free], sessions: [{ ...sess6(B2, now - 3 * H), waitUntil: now + H }, sess6(DM, now - 5 * 60e3)], stallHours: 2 }).stalls.filter((s) => s.bead === 'ex-lw' && s.kind === 'quiet'), []);
});
