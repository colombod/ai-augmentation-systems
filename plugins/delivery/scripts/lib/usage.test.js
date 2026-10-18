// scripts/lib/usage.test.js — what the budget can measure (R-31 probe, R-34): transcript tokens and the
// status line's weekly reading.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('./usage.js');
const { statusline } = require('../usage.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
const reply = (id, at, usage, model = 'claude-sonnet-4-5') => JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model, usage } });

function team(root, files) {
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  const instances = Object.fromEntries(files.map((f, i) => [`builder-${i + 1}`, { session_id: `s${i}`, transcript_path: f, last_seen: '2026-10-12T00:00:00Z' }]));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'roster.json'), JSON.stringify({ instances }));
}

test('R-34 measurable: a streamed reply counts once, cost-weighted by kind and model, only since the period start', () => {
  const root = tmp();
  const dir = tmp();
  const a = path.join(dir, 'a.jsonl');
  const u = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 10000, output_tokens: 100 };
  fs.writeFileSync(a, [
    reply('m1', '2026-10-12T10:00:00Z', u), reply('m1', '2026-10-12T10:00:01Z', u), // one message streamed on two lines
    reply('m2', '2026-10-12T11:00:00Z', u, 'claude-opus-4-5'),
    reply('m0', '2026-10-01T09:00:00Z', u), // before the period
    '{"type":"user","message":{"content":"not usage"}}', '{torn',
  ].join('\n'));
  // an earlier session of the same role directory and a subagent transcript are the team's too
  fs.writeFileSync(path.join(dir, 'b.jsonl'), reply('m3', '2026-10-12T12:00:00Z', { output_tokens: 10 }));
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-1.jsonl'), reply('m4', '2026-10-12T12:30:00Z', { input_tokens: 7 }));
  team(root, [a]);
  const one = 1000 + 0.1 * 10000 + 5 * 100; // 2500 sonnet input equivalents
  const r = U.tokensSince(root, '2026-10-05T00:00:00Z');
  assert.equal(r.files, 3);
  assert.equal(Math.round(r.tokens * 100) / 100, one + one * 1.7 + 50 + 7);
  // cached per file: an unchanged file is not rescanned; an appended reply is counted
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'usage', 'transcripts.json')));
  fs.appendFileSync(a, `\n${reply('m5', '2026-10-12T13:00:00Z', { output_tokens: 2 })}`);
  assert.equal(Math.round(U.tokensSince(root, '2026-10-05T00:00:00Z').tokens * 100) / 100, one + one * 1.7 + 50 + 7 + 10);
  // no roster, no transcripts: zero, said plainly
  assert.match(U.tokensSince(tmp(), '2026-10-05T00:00:00Z').note, /no role transcripts/);
});

test('R-31 probe: the status line weekly reading is kept, and read only while fresh and before its reset', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), '{}');
  const resets = Date.parse('2026-10-13T12:00:00Z') / 1000;
  const input = { workspace: { current_dir: root }, rate_limits: { seven_day: { used_percentage: 85, resets_at: resets }, five_hour: { used_percentage: 97, resets_at: resets } } };
  assert.equal(statusline(input, { now: '2026-10-12T23:00:00Z' }), 'week 85% used');
  const s = U.readSnapshot(root, '2026-10-12T23:30:00Z');
  assert.equal(s.usedPct, 85);
  assert.equal(s.periodStart, '2026-10-06T12:00:00.000Z');
  assert.equal(U.readSnapshot(root, '2026-10-13T06:00:00Z'), null, 'older than six hours');
  assert.equal(statusline({ workspace: { current_dir: root } }), 'week usage not reported', 'an API-key session has no rate_limits');
  U.writeSnapshot(root, U.snapshotOf(input, '2026-10-13T11:00:00Z'));
  assert.equal(U.readSnapshot(root, '2026-10-13T12:30:00Z'), null, 'the window reset');
});

test('PR 54 I-3: a streamed reply counts at its largest reading, as Claude Code writes them (output tokens grow line by line)', () => {
  const root = tmp();
  const f = path.join(tmp(), 's.jsonl');
  const at = '2026-10-12T10:00:00Z';
  // three content blocks of one message: thinking, text, tool_use; usage grows to the final count
  fs.writeFileSync(f, [
    reply('msg_1', at, { input_tokens: 3, cache_creation_input_tokens: 2000, cache_read_input_tokens: 40000, output_tokens: 7 }),
    reply('msg_1', at, { input_tokens: 3, cache_creation_input_tokens: 2000, cache_read_input_tokens: 40000, output_tokens: 312 }),
    reply('msg_1', at, { input_tokens: 3, cache_creation_input_tokens: 2000, cache_read_input_tokens: 40000, output_tokens: 24335 }),
  ].join('\n') + '\n');
  const r = U.tokensSince(root, '2026-10-01T00:00:00Z', { files: [f] });
  assert.equal(r.messages, 1);
  assert.equal(r.tokens, 3 + 1.25 * 2000 + 0.1 * 40000 + 5 * 24335);
});

test('PR 54 Copilot 637: the period start cuts at the message time, not the hour', () => {
  const f = path.join(tmp(), 'h.jsonl');
  fs.writeFileSync(f, `${reply('a', '2026-10-12T12:01:00Z', { output_tokens: 100 })}\n${reply('b', '2026-10-12T12:45:00Z', { output_tokens: 1 })}\n`);
  assert.equal(U.tokensSince(tmp(), '2026-10-12T12:30:00Z', { files: [f] }).tokens, 5);
});

test('PR 54 I-4: the scan keeps to its deadline, says the figure is partial, saves its progress and resumes; a message split across a resume counts once', () => {
  const root = tmp();
  const f = path.join(tmp(), 'big.jsonl');
  const lines = [];
  for (let i = 0; i < 400; i++) lines.push(reply(`m${i}`, '2026-10-12T10:00:00Z', { output_tokens: 1 }));
  fs.writeFileSync(f, `${lines.join('\n')}\n`);
  const cut = U.tokensSince(root, '2026-10-01T00:00:00Z', { files: [f], deadline: Date.now() - 1 });
  assert.equal(cut.partial, true);
  assert.match(cut.note, /partial/);
  // read in small chunks: every chunk boundary splits a line, and nothing is lost or counted twice
  const full = U.tokensSince(root, '2026-10-01T00:00:00Z', { files: [f], chunk: 97 });
  assert.deepEqual([full.partial, full.messages, full.tokens], [false, 400, 2000]);
  // the file grows: only the new bytes are read, and the open message keeps its largest reading
  fs.appendFileSync(f, `${reply('m399', '2026-10-12T10:00:00Z', { output_tokens: 9 })}\n${reply('m400', '2026-10-12T10:01:00Z', { output_tokens: 1 })}\n`);
  const more = U.tokensSince(root, '2026-10-01T00:00:00Z', { files: [f], chunk: 97 });
  assert.deepEqual([more.messages, more.tokens], [401, 2000 - 5 + 45 + 5]);
});

test('PR 54 m-5: the spend readings are not writable from any role lane, the builder\'s included', () => {
  const { decideLane, loadPolicy } = require('../../hooks/scripts/lane.js');
  const plugin = path.join(__dirname, '..', '..');
  const groups = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'lane-groups.json'), 'utf8'));
  const project = tmp();
  const roleDir = tmp();
  const d = (toolName, toolInput) => decideLane({ toolName, toolInput, policy: loadPolicy({ pluginRoot: plugin, projectRoot: project, briefRef: 'delivery/builder' }), roleDir, groups, pluginRoot: plugin, cwd: project, projectRoot: project, hostHeadless: false });
  const cache = path.join(project, '.delivery', 'usage', 'transcripts.json');
  assert.match(d('Write', { file_path: cache }).reason, /spend readings/);
  assert.match(d('Bash', { command: `echo '{}' > ${cache}` }).reason, /spend readings/);
  assert.match(d('Bash', { command: 'rm -rf .delivery/usage' }).reason, /spend readings/);
  assert.equal(d('Bash', { command: 'cat .delivery/usage/transcripts.json' }).allow, true);
});

test('PR 54 I-b: the deadline holds inside one file\'s scan, not only between files', () => {
  const f = path.join(tmp(), 'one.jsonl');
  fs.writeFileSync(f, `${reply('a', '2026-10-12T10:00:00Z', { output_tokens: 1 })}\n`);
  const r = U.scanFile(f, { deadline: Date.now() - 1 });
  assert.deepEqual([r.done, r.msgs.length, r.offset], [false, 0, 0]);
  assert.equal(U.scanFile(f).msgs.length, 1);
});
