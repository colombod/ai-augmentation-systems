// scripts/watchdog.test.js — the stall alarm and the wake (R-04, R-43; tight gh polling, R-25), replayed
// on Vault moments through the real lane and bd-guard hooks (testing/role-harness.js), through the host
// job's command line, and through main().
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
  return h;
}
const fakeEnv = (h, more = {}) => ({ ...process.env, DELIVERY_ROLE: '', BD_FAKE_STORE: h.store, GH_FAKE_STORE: path.join(h.root, 'gh-store.json'), PATH: `${path.join(__dirname, 'testing')}${path.delimiter}${process.env.PATH}`, ...more });
const at = (h, now, argv, deps = {}) => watchdog.main(argv, { cwd: h.root, env: fakeEnv(h), now, live: [], bd: require('./lib/bd.js').makeBd({ cwd: h.root, env: fakeEnv(h) }), ...deps });

test('R-04 (10-13 12:06 to 10-17 15:01): the weekly limit schedules each holder\'s wake at the reset, and the plan says when the team resumes', () => {
  const h = vaultLimit();
  const spawned = [];
  const spawn = (bin, args, o) => { spawned.push({ args, cwd: o.cwd, role: o.env.DELIVERY_ROLE }); return 1; };
  const c = at(h, '2026-10-13T12:30:00Z', ['check']);
  assert.match(c.out, /^The team resumes at 2026-10-17 15:06 UTC: builder-1 stopped on the seven-day usage limit at 2026-10-13 12:06 UTC, which resets at 2026-10-17 15:01 UTC\.$/m);
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
  assert.deepEqual(b1.args.slice(0, 3), ['--resume', 'sess-builder-1', '-p']);
  assert.match(b1.args[3], /The usage limit has reset\. Continue where you stopped: ex-wxy-12 \(bd show ex-wxy-12\)/);
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
  const today = h.bash(COS, `${h.script('plan.js')} today`);
  assert.equal(today.code, 0, today.deny || today.out);
  const resumes = WD.clock(now + 3 * H + WD.RESET_GRACE_MIN * 60e3);
  assert.equal(today.out.split('\n')[1], `The team resumes at ${resumes}, when the usage limit resets (the watchdog wakes each stopped session then).`);
  const brief = h.bash(COS, `${h.script('plan.js')} brief`);
  assert.equal(brief.out.split('\n')[0], `The team resumes at ${resumes}, when the usage limit resets.`);
  assert.deepEqual(MC.idTokens(brief.out, { prefix: 'ex' }), []);
  const check = h.bash(DM, `${h.script('watchdog.js')} check`);
  assert.equal(check.code, 0, check.deny || check.out);
  assert.match(check.out, new RegExp(`^The team resumes at ${resumes}`, 'm'));
  // the wake and the host job are the owner's install, never a session's own move (R-42)
  for (const role of [COS, DM]) for (const cmd of ['wake', 'run', 'install --apply']) assert.ok(h.bash(role, `${h.script('watchdog.js')} ${cmd}`, { run: false }).deny, `${role} ${cmd}`);
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
  assert.deepEqual(c.argv.slice(0, 4), ['--resume', `sess-${DM}`, '--fork-session', '-p']);
  assert.match(c.argv[4], /^Watchdog \(a host job, not the owner\): Top-priority ex-wxy-12 has waited 15\.5 h unclaimed\. Assign it to a builder now/);
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
  assert.deepEqual(WD.wakeCommand(sessions[0], 'go', []).args, ['--resume', 's-dm', '-p', 'go']);
  assert.equal(WD.wakeCommand(sessions[0], 'go', null).mode, 'fork', 'open sessions unknown: a copy never collides');
  assert.deepEqual(WD.wakeCommand({ ...sessions[0], session: null }, 'go', []).args, ['-c', '-p', 'go']);
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

test('install: dry run by default; --apply writes the launchd job, the systemd timer or the cron line, and nothing else', () => {
  const h = harness({});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const ran = [];
  const exec = (cmd, args, input) => { ran.push([cmd, ...args].join(' ')); if (cmd === 'crontab' && args[0] === '-l') return 'MAILTO=x\n'; if (input !== undefined) ran.push(input); return ''; };
  const env = { ...process.env, DELIVERY_ROLE: '', PATH: '/opt/bin:/usr/bin' };
  const dry = watchdog.main(['install'], { cwd: h.root, env, platform: 'darwin', home, exec });
  assert.equal(dry.code, 0);
  assert.match(dry.out, /^Dry run\. The launchd job runs `watchdog\.js run --project .*` every 15 min/);
  assert.match(dry.out, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.equal(fs.existsSync(path.join(home, 'Library')), false, 'nothing written');
  assert.deepEqual(ran, []);
  const mac = watchdog.main(['install', '--apply', '--every', '10m'], { cwd: h.root, env, platform: 'darwin', home, exec });
  assert.equal(mac.code, 0, mac.out);
  const plist = fs.readdirSync(path.join(home, 'Library', 'LaunchAgents'));
  assert.equal(plist.length, 1);
  const body = fs.readFileSync(path.join(home, 'Library', 'LaunchAgents', plist[0]), 'utf8');
  for (const re of [/<integer>600<\/integer>/, /<string>run<\/string><string>--project<\/string>/, /<key>PATH<\/key><string>\/opt\/bin:\/usr\/bin<\/string>/]) assert.match(body, re);
  assert.ok(ran.some((c) => /^launchctl bootstrap gui\/\d+ /.test(c)));
  const linux = watchdog.main(['install', '--apply'], { cwd: h.root, env, platform: 'linux', home, exec, has: () => true });
  assert.equal(linux.code, 0, linux.out);
  assert.match(fs.readFileSync(path.join(home, '.config', 'systemd', 'user', fs.readdirSync(path.join(home, '.config', 'systemd', 'user')).find((f) => f.endsWith('.timer'))), 'utf8'), /OnUnitActiveSec=900s/);
  ran.length = 0;
  assert.equal(watchdog.main(['install', '--apply'], { cwd: h.root, env, platform: 'linux', home, exec, has: () => false }).code, 0);
  const tab = ran[ran.length - 1];
  assert.match(tab, /^MAILTO=x\n\*\/15 \* \* \* \* cd .* 'run' '--project' .* # delivery-watchdog [0-9a-f]{8}\n$/);
  assert.equal(watchdog.main(['install', '--every', '1m'], { cwd: h.root, env, platform: 'darwin', home }).code, 2, 'under 5 minutes is refused');
});
