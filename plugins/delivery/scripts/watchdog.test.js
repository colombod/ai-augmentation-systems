// scripts/watchdog.test.js — the stall alarm and the wake (R-04, R-43; tight gh polling, R-25), replayed
// on Vault moments through the real lane and bd-guard hooks (testing/role-harness.js), through the host
// job's command line, and through main().
// owner-facing times are the host's local time: the tests read them in UTC
process.env.TZ = 'UTC';
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

test('R-04 through the lane: the Chief of Staff\'s plan and the owner\'s brief lead with the resume time; a role cannot wake anyone', () => {
  const now = Date.now();
  const h = harness({ beads: { 'ex-wxy-12': { id: 'ex-wxy-12', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 2 * H) } } });
  session(h, 'builder-1', { seen: iso(now - H), rows: [limitRow(iso(now - H), iso(now + 3 * H))] });
  markInstalled(h);
  const today = h.bash(COS, `${h.script('plan.js')} today`);
  assert.equal(today.code, 0, today.deny || today.out);
  const resumes = WD.clock(now + 3 * H + WD.RESET_GRACE_MIN * 60e3);
  assert.equal(today.out.split('\n')[1], `The team resumes at ${resumes}, when the usage limit resets (restart scheduled: the watchdog wakes each stopped session then).`);
  const brief = h.bash(COS, `${h.script('plan.js')} brief`);
  assert.equal(brief.out.split('\n')[0], `The team resumes at ${resumes}, when the usage limit resets (restart scheduled).`);
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
  assert.match(h.bash(COS, `${h.script('plan.js')} brief`).out.split('\n')[0], /^A top-priority item has waited 15\.5 h for someone to take it; the Delivery Manager assigns it first\.$/);
  // the host job: the Delivery Manager's session is open and idle, so it is forked, never resumed in place
  const log = scratchLog();
  const run = hostJob(h, ['run'], claudeEnv(log, JSON.stringify([{ sessionId: `sess-${DM}`, kind: 'interactive', status: 'idle' }])));
  assert.equal(run.status, 0, run.stderr);
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
});

test('R-04: a bead in progress is stalled only when neither the bead nor its holder\'s session moved for stall_hours', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const beads = [{ id: 'ex-1', status: 'in_progress', assignee: 'dev@pc/builder-1', updated_at: iso(now - 3 * H) }];
  const s = (lastActive) => [{ instance: 'builder-1', role: 'builder', session: 'b1', roleDir: os.tmpdir(), lastActive }];
  const quiet = WD.stalls({ beads, now: iso(now), sessions: s(now - 2.5 * H) }).stalls;
  assert.equal(quiet[0].line, 'Stalled: ex-1 is in progress with builder-1, and nothing has moved for 2.5 h (the limit is 2 h).');
  assert.equal(quiet[0].target, 'builder-1');
  assert.deepEqual(WD.stalls({ beads, now: iso(now), sessions: s(now - 10 * 60e3) }).stalls, [], 'its session is working');
  assert.deepEqual(WD.stalls({ beads, now: iso(now), sessions: s(now - 2.5 * H), stallHours: 4 }).stalls, [], 'the owner-set limit applies');
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
  // the daily cap: six wakes in a day, whatever the keys
  const many = harness({});
  session(many, DM, { seen: t0 });
  for (let i = 0; i < WD.DAILY_CAP; i++) WD.log(many.root, { type: 'wake', at: iso(Date.parse(t0) - (23 - i * 3) * H), keys: [`k${i}`], instance: DM, pid: null });
  const res = { stalls: [{ kind: 'p0', key: 'p0:new', target: DM, due: true, line: 'Unclaimed: new', prompt: 'go' }], sessions: [] };
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
  const brief = h.bash(COS, `${h.script('plan.js')} brief`).out.split('\n')[0];
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
  for (const re of [/^KillMode=process$/m, /^Environment="PATH=\/opt\/bin:/m, /^ExecStart=\/usr\/bin\/env "node" ".*job\.js"$/m]) assert.match(service, re);
  assert.equal(main(['uninstall'], { platform: 'linux', has: () => true }).code, 0);
  assert.deepEqual(fs.readdirSync(unit), []);
  // cron: only an interval that divides the hour keeps its cadence (Copilot 471)
  assert.equal(main(['install', '--apply', '--every', '45m'], { platform: 'linux', has: () => false }).code, 2);
  assert.match(main(['install', '--every', '7m'], { platform: 'linux', has: () => false }).out, /must divide the hour/);
  assert.equal(main(['install', '--apply', '--every', '1h'], { platform: 'linux', has: () => false }).code, 0);
  assert.match(tab, /^MAILTO=x\n0 \* \* \* \* cd .* '\/usr\/bin\/env' 'node' '.*job\.js' >> .* # delivery-watchdog [0-9a-f]{8}\n$/);
  assert.equal(main(['install', '--apply', '--every', '20m'], { platform: 'linux', has: () => false }).code, 0);
  assert.equal(tab.split('\n').filter((l) => l.includes('# delivery-watchdog')).length, 1, 'a second install replaces the line');
  main(['uninstall'], { platform: 'linux', has: () => false });
  assert.equal(tab, 'MAILTO=x\n');
  assert.equal(main(['install', '--every', '1m'], { platform: 'darwin' }).code, 2, 'under 5 minutes is refused');
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
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, home, exec, platform: 'linux', has: () => false }).code, 0);
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
  const r = watchdog.main(['install', '--apply'], { cwd: h.root, env, home, platform: 'linux', has: () => false, exec: fail('crontab: cannot open your crontab: Permission denied') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /crontab could not be read/);
  assert.deepEqual(writes, []);
  assert.equal(watchdog.main(['uninstall'], { cwd: h.root, env, home, platform: 'linux', has: () => false, exec: fail('crontab: cannot open your crontab: Permission denied') }).code, 1);
  assert.deepEqual(writes, []);
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, home, platform: 'linux', has: () => false, exec: fail('no crontab for dev') }).code, 0);
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

test('a waiting message wakes its target once, with the message; a new one waits five minutes between wakes', () => {
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
  const held = at(h, iso(Date.parse(t0) + 3 * 60e3), ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 1);
  assert.match(held.out, /messages wait 5 min between wakes/);
  at(h, iso(Date.parse(t0) + 6 * 60e3), ['run'], { spawn, bd });
  assert.equal(spawn.list.length, 2, 'woken again after five minutes, not an hour');
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
    assert.match(spawn.list[0].args.join(' '), /merge main into your branch.*|ex-s has not moved/);
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
  // named like every role session, so peers reach it by name; its own beads, by its actor
  assert.deepEqual(heavy.args.slice(0, 5), ['--permission-mode', 'auto', '--name', COS, '-p']);
  assert.ok(!heavy.args.includes('--resume'), 'a fresh session, not a resume');
  assert.match(heavy.args[5], /starting a fresh session: your earlier conversation \(236k tokens\) is not loaded.*bd list --assignee "\$BEADS_ACTOR" --status in_progress.*merge the story branch/);
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
