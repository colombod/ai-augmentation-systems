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
