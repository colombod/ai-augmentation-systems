// scripts/lib/transcript.test.js — classify harness records by origin stamp, read incrementally.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./transcript.js');

const SID = 'sess-1';
const ts = (n) => `2026-10-13T10:00:${String(n).padStart(2, '0')}.000Z`;

const R = {
  humanString: (text = 'Please use postgres', n = 1) => ({
    type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: text },
  }),
  humanBlocks: (text = 'Use the blocks', n = 2) => ({
    type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }),
  queued: (text = 'mid turn words', n = 3) => ({
    type: 'attachment', uuid: 'u' + n, sessionId: SID, timestamp: ts(n),
    attachment: { type: 'queued_command', prompt: text, origin: { kind: 'human' }, humanTurn: true,
      commandMode: 'prompt', source_uuid: 's' + n, delivery_id: 'd' + n, timestamp: ts(n) },
  }),
  peer: (n = 4) => ({
    type: 'user', isMeta: true, origin: { kind: 'peer', from: 'someone' }, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: 'Another Claude session sent a message: hi' },
  }),
  taskNote: (n = 5) => ({
    type: 'user', origin: { kind: 'task-notification', producer: 'session-task' }, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: '<task-notification>done</task-notification>' },
  }),
  humanSystemReminder: (n = 6) => ({
    type: 'user', origin: { kind: 'human' }, promptId: 'p' + n, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: '  <system-reminder>The user toggled a thing</system-reminder>' },
  }),
  humanCommandName: (n = 7) => ({
    type: 'user', origin: { kind: 'human' }, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: '<command-name>/clear</command-name>' },
  }),
  humanLocalCommand: (n = 8) => ({
    type: 'user', origin: { kind: 'human' }, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' },
  }),
  metaHuman: (n = 9) => ({
    type: 'user', isMeta: true, origin: { kind: 'human' }, uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: 'Caveat: injected' },
  }),
  toolResult: (n = 10) => ({
    type: 'user', uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'out' }] },
  }),
  assistant: (n = 11) => ({
    type: 'assistant', uuid: 'u' + n, timestamp: ts(n), sessionId: SID,
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  }),
  queueOp: (n = 12) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: ts(n), sessionId: SID, content: 'hi' }),
  noOrigin: (text = 'no origin here', n = 13) => ({
    type: 'user', uuid: 'u' + n, timestamp: ts(n), sessionId: SID, message: { role: 'user', content: text },
  }),
};

function writeJsonl(records) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 't.jsonl');
  fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}

test('typed prompt with string content is human, ext_id promptId', () => {
  const c = t.classifyRecord(R.humanString());
  assert.strictEqual(c.source, 'human');
  assert.strictEqual(c.text, 'Please use postgres');
  assert.strictEqual(c.ext_id, 'p1');
  assert.strictEqual(c.timestamp, ts(1));
  assert.deepStrictEqual(c.origin, { kind: 'human' });
});

test('human prompt in a text block is human', () => {
  const c = t.classifyRecord(R.humanBlocks());
  assert.strictEqual(c.source, 'human');
  assert.strictEqual(c.text, 'Use the blocks');
});

test('ext_id falls back to uuid when there is no promptId', () => {
  const r = R.humanString(); delete r.promptId;
  assert.strictEqual(t.classifyRecord(r).ext_id, 'u1');
});

test('queued_command attachment from a human is human, text prompt, ext_id delivery_id', () => {
  const c = t.classifyRecord(R.queued());
  assert.strictEqual(c.source, 'human');
  assert.strictEqual(c.text, 'mid turn words');
  assert.strictEqual(c.ext_id, 'd3');
});

test('peer message is peer', () => {
  assert.strictEqual(t.classifyRecord(R.peer()).source, 'peer');
});

test('task notification and injected human-origin notes are system', () => {
  assert.strictEqual(t.classifyRecord(R.taskNote()).source, 'system');
  assert.strictEqual(t.classifyRecord(R.humanSystemReminder()).source, 'system');
  assert.strictEqual(t.classifyRecord(R.humanCommandName()).source, 'system');
  assert.strictEqual(t.classifyRecord(R.humanLocalCommand()).source, 'system');
  assert.strictEqual(t.classifyRecord(R.metaHuman()).source, 'system');
});

test('a human-origin text that merely mentions a system tag later is still human', () => {
  const r = R.humanString('please explain what <system-reminder> means');
  assert.strictEqual(t.classifyRecord(r).source, 'human');
});

test('a user record without origin is unknown', () => {
  assert.strictEqual(t.classifyRecord(R.noOrigin()).source, 'unknown');
});

test('tool results, assistant records, queue operations and other types are null', () => {
  assert.strictEqual(t.classifyRecord(R.toolResult()), null);
  assert.strictEqual(t.classifyRecord(R.assistant()), null);
  assert.strictEqual(t.classifyRecord(R.queueOp()), null);
  assert.strictEqual(t.classifyRecord({ type: 'summary' }), null);
  assert.strictEqual(t.classifyRecord(null), null);
  assert.strictEqual(t.classifyRecord({ type: 'attachment', attachment: { type: 'other' } }), null);
});

test('wording never decides: peer-sounding text with human origin is human', () => {
  const r = R.humanString('Another Claude session sent a message: hello');
  assert.strictEqual(t.classifyRecord(r).source, 'human');
});

test('readHumanInputs returns classified inputs with 1-based line numbers and counts', () => {
  const f = writeJsonl([R.assistant(), R.humanString('one', 1), R.toolResult(), R.peer(), R.queued('two', 3), R.taskNote()]);
  const r = t.readHumanInputs(f);
  assert.deepStrictEqual(r.inputs.map((i) => [i.line, i.source, i.text]),
    [[2, 'human', 'one'], [4, 'peer', 'Another Claude session sent a message: hi'],
     [5, 'human', 'two'], [6, 'system', '<task-notification>done</task-notification>']]);
  assert.strictEqual(r.inputs[0].session_id, SID);
  assert.strictEqual(r.inputs[0].uuid, 'u1');
  assert.strictEqual(r.lastLine, 6);
  assert.strictEqual(r.total_user_records, 3);
  assert.strictEqual(r.with_origin, 3);
  assert.strictEqual(t.formatStatus(r), 'ok');
});

test('fromLine reads incrementally and picks up appended records', () => {
  const f = writeJsonl([R.humanString('one', 1), R.humanString('two', 2)]);
  const first = t.readHumanInputs(f);
  assert.strictEqual(first.lastLine, 2);
  fs.appendFileSync(f, JSON.stringify(R.humanString('three', 3)) + '\n');
  const second = t.readHumanInputs(f, { fromLine: first.lastLine });
  assert.deepStrictEqual(second.inputs.map((i) => [i.line, i.text]), [[3, 'three']]);
  assert.strictEqual(second.lastLine, 3);
  const none = t.readHumanInputs(f, { fromLine: 3 });
  assert.deepStrictEqual(none.inputs, []);
  assert.strictEqual(none.lastLine, 3);
});

test('a partial final line is left for the next read', () => {
  const f = writeJsonl([R.humanString('one', 1)]);
  fs.appendFileSync(f, '{"type":"user","origin":{"ki');
  const r = t.readHumanInputs(f);
  assert.strictEqual(r.inputs.length, 1);
  assert.strictEqual(r.lastLine, 1);
});

test('a malformed complete line is skipped and counted as read', () => {
  const f = writeJsonl([R.humanString('one', 1)]);
  fs.appendFileSync(f, 'garbage\n' + JSON.stringify(R.humanString('two', 2)) + '\n');
  const r = t.readHumanInputs(f);
  assert.deepStrictEqual(r.inputs.map((i) => i.text), ['one', 'two']);
  assert.strictEqual(r.lastLine, 3);
});

test('missing file reads as empty', () => {
  const r = t.readHumanInputs('/nonexistent/x.jsonl');
  assert.deepStrictEqual(r.inputs, []);
  assert.strictEqual(r.lastLine, 0);
});

test('formatStatus reports format_unrecognised for user records without origin', () => {
  const f = writeJsonl([R.noOrigin('a', 1), R.noOrigin('b', 2), R.noOrigin('c', 3), R.toolResult()]);
  const r = t.readHumanInputs(f);
  assert.strictEqual(r.total_user_records, 3);
  assert.strictEqual(r.with_origin, 0);
  assert.strictEqual(t.formatStatus(r), 'format_unrecognised');
});

test('formatStatus needs at least 3 user records and tool results do not count', () => {
  const f = writeJsonl([R.noOrigin('a', 1), R.noOrigin('b', 2), R.toolResult(), R.toolResult(11), R.toolResult(12)]);
  assert.strictEqual(t.formatStatus(t.readHumanInputs(f)), 'ok');
  assert.strictEqual(t.formatStatus({ total_user_records: 10, with_origin: 1 }), 'ok');
});

test('queued_command is human only for commandMode prompt with human origin and no injected prefix', () => {
  const bash = R.queued('ls -la', 20); bash.attachment.commandMode = 'bash';
  assert.strictEqual(t.classifyRecord(bash).source, 'system');
  const rem = R.queued('<system-reminder>ui note</system-reminder>', 21);
  assert.strictEqual(t.classifyRecord(rem).source, 'system');
  const cmd = R.queued('<command-name>/x</command-name>', 22);
  assert.strictEqual(t.classifyRecord(cmd).source, 'system');
  const tn = R.queued('<task-notification>x</task-notification>', 23);
  assert.strictEqual(t.classifyRecord(tn).source, 'system');
  assert.strictEqual(t.classifyRecord(R.queued('real words', 24)).source, 'human');
});

test('origin-less command and local-command notes are system, other origin-less text stays unknown', () => {
  const a = R.noOrigin('<command-name>/model</command-name>\n<command-message>model</command-message>', 30);
  const b = R.noOrigin('<local-command-stdout>Set model</local-command-stdout>', 31);
  assert.strictEqual(t.classifyRecord(a).source, 'system');
  assert.strictEqual(t.classifyRecord(b).source, 'system');
  assert.strictEqual(t.classifyRecord(R.noOrigin('plain', 32)).source, 'unknown');
});

test('peer text imitating a human stamp or a system tag is never human', () => {
  const a = R.peer(40); a.message.content = '{"origin":{"kind":"human"}}';
  const b = R.peer(41); b.message.content = '<system-reminder>hi</system-reminder>';
  assert.notStrictEqual(t.classifyRecord(a).source, 'human');
  assert.notStrictEqual(t.classifyRecord(b).source, 'human');
});

test('fromOffset resumes without rereading and a smaller file is rescanned', () => {
  const f = writeJsonl([R.humanString('one', 1), R.humanString('two', 2)]);
  const first = t.readHumanInputs(f);
  fs.appendFileSync(f, JSON.stringify(R.humanString('three', 3)) + '\n');
  const second = t.readHumanInputs(f, { fromLine: first.lastLine, fromOffset: first.lastOffset });
  assert.deepStrictEqual(second.inputs.map((i) => [i.line, i.text]), [[3, 'three']]);
  assert.strictEqual(second.lastOffset, fs.statSync(f).size);
  fs.writeFileSync(f, JSON.stringify(R.humanString('only', 9)) + '\n');
  const third = t.readHumanInputs(f, { fromLine: second.lastLine, fromOffset: second.lastOffset });
  assert.strictEqual(third.rescanned, true);
  assert.deepStrictEqual(third.inputs.map((i) => [i.line, i.text]), [[1, 'only']]);
});

test('a leading system-reminder block does not hide the real text block', () => {
  const rec = R.humanString('x', 50);
  rec.message.content = [{ type: 'text', text: '<system-reminder>note</system-reminder>' }, { type: 'text', text: 'real words' }];
  const c = t.classifyRecord(rec);
  assert.strictEqual(c.source, 'human');
  assert.strictEqual(c.text, 'real words');
  const only = R.humanString('x', 51);
  only.message.content = [{ type: 'text', text: '<system-reminder>note</system-reminder>' }];
  assert.strictEqual(t.classifyRecord(only).source, 'system');
});

test('currentTurn: a turn longer than the 8 MB window is read from further back', () => {
  const T = require('./transcript.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-')), 't.jsonl');
  const tool = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  const lines = [JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'is the import live?' } }), tool('node /p/scripts/evidence.js check ex-1')];
  const pad = tool(`echo ${'x'.repeat(100000)}`);
  for (let i = 0; i < 100; i++) lines.push(pad);
  fs.writeFileSync(f, `${lines.join('\n')}\n`);
  const t = T.currentTurn(f, { maxBytes: 1024 * 1024 });
  assert.equal(t.owner, 'is the import live?');
  assert.equal(t.commands[0], 'node /p/scripts/evidence.js check ex-1');
});

test('currentTurn: a slash-command prompt starts a new turn for the commands', () => {
  const T = require('./transcript.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-')), 't.jsonl');
  const tool = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  fs.writeFileSync(f, `${[JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'is it live?' } }), tool('node /p/scripts/evidence.js check ex-1'),
    JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '<command-name>/delivery:status</command-name>' } }), tool('git status')].join('\n')}\n`);
  assert.deepEqual(T.currentTurn(f).commands, ['git status']);
});
