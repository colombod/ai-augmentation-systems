// scripts/lib/transcript.js — read the harness-written transcript JSONL and classify user input
// by the harness's own `origin` stamp, never by message wording. All format knowledge lives here.
const fs = require('fs');

const SYSTEM_PREFIXES = ['<system-reminder>', '<command-name>', '<local-command', '<task-notification'];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    if (!parts.length) return null;
    // harness reminders can ride along as extra leading blocks: classify by the real words
    const real = parts.filter((p) => !p.trim().startsWith('<system-reminder>'));
    return (real.length ? real : parts).join('\n');
  }
  return null;
}

function classifyRecord(record) {
  if (!record || typeof record !== 'object') return null;

  if (record.type === 'attachment') {
    const a = record.attachment;
    if (!a || a.type !== 'queued_command') return null;
    const text = textOf(a.prompt);
    if (text === null || text.trim() === '') return null;
    const origin = a.origin && typeof a.origin === 'object' ? a.origin : null;
    const kind = origin && origin.kind;
    let source;
    if (kind === 'human') {
      const head = text.trim();
      const injected = SYSTEM_PREFIXES.some((p) => head.startsWith(p));
      source = a.commandMode === 'prompt' && !injected ? 'human' : 'system';
    } else if (kind === 'peer') source = 'peer';
    else if (kind) source = 'system';
    else source = 'unknown';
    return {
      source, text,
      ext_id: a.delivery_id || record.uuid || null,
      timestamp: a.timestamp || record.timestamp || null,
      origin,
    };
  }

  if (record.type !== 'user') return null;
  const text = textOf(record.message && record.message.content);
  if (text === null || text.trim() === '') return null; // tool results and empty records
  const origin = record.origin && typeof record.origin === 'object' ? record.origin : null;
  const kind = origin && origin.kind;
  let source;
  if (record.isMeta === true) source = kind === 'peer' ? 'peer' : 'system';
  else if (kind === 'peer') source = 'peer';
  else if (kind && kind !== 'human') source = 'system';
  else if (kind === 'human') {
    const head = text.trim();
    source = SYSTEM_PREFIXES.some((p) => head.startsWith(p)) ? 'system' : 'human';
  } else {
    const head = text.trim();
    // harness-injected UI notes that carry no origin at all are not operator input either
    source = head.startsWith('<command-name>') || head.startsWith('<local-command') ? 'system' : 'unknown';
  }
  return {
    source, text,
    ext_id: record.promptId || record.uuid || null,
    timestamp: record.timestamp || null,
    origin,
  };
}

// Read complete lines. `fromOffset` (bytes already consumed, with `fromLine` the line count at that
// offset) lets a caller resume without rereading; without it, `fromLine` lines are skipped from the
// top. A final line without a newline is left for the next read (the harness may still be writing).
// If the file is smaller than `fromOffset` it was rewritten: read from the top.
function readHumanInputs(file, opts = {}) {
  let fromLine = opts.fromLine || 0;
  let fromOffset = opts.fromOffset || 0;
  // lastAssistant: the session's last assistant text before the next owner input ({ line, sha256, tail });
  // carried across reads by the caller's cursor, so a typed yes can be checked against what it answered
  const out = { inputs: [], lastLine: fromLine, lastOffset: fromOffset, total_user_records: 0, with_origin: 0, rescanned: false, lastAssistant: opts.lastAssistant || null };
  // pending AskUserQuestion invocations by tool_use id ({ uuid, questions }), carried across reads
  const asks = new Map(Object.entries(opts.pendingAsks || {}));
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return out; }
  if (fromOffset > buf.length) { // rewritten smaller
    fromOffset = 0; fromLine = 0; out.rescanned = true;
    out.lastLine = 0; out.lastOffset = 0;
  }
  let pos = fromOffset;
  let lineNo = opts.fromOffset ? fromLine : 0;
  const skip = opts.fromOffset && !out.rescanned ? 0 : fromLine;
  for (;;) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break; // partial or no further line
    const l = buf.toString('utf8', pos, nl);
    pos = nl + 1;
    lineNo++;
    out.lastLine = lineNo;
    out.lastOffset = pos;
    if (lineNo <= skip) continue;
    if (l.trim() === '') continue;
    let rec;
    try { rec = JSON.parse(l); } catch (e) { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type === 'assistant' && rec.message && Array.isArray(rec.message.content)) {
      const text = rec.message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
      if (text.trim()) out.lastAssistant = { line: lineNo, sha256: require('crypto').createHash('sha256').update(text).digest('hex'), tail: text.trim().slice(-400) };
      for (const b of rec.message.content) if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion' && b.id && b.input && Array.isArray(b.input.questions)) asks.set(b.id, { uuid: rec.uuid, questions: b.input.questions });
      continue;
    }
    // the harness's answer to AskUserQuestion: a tool_result it writes, with the owner's selection per
    // question (toolUseResult.answers). It is an owner input bound to that exact question text.
    const tur = rec.type === 'user' && rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : null;
    if (tur && Array.isArray(tur.questions) && tur.answers && typeof tur.answers === 'object' && rec.sourceToolAssistantUUID) {
      // only the answer to an AskUserQuestion this session asked: the same tool_use id and assistant uuid
      const block = (rec.message && Array.isArray(rec.message.content) ? rec.message.content : []).find((b) => b && b.type === 'tool_result');
      const inv = block && asks.get(block.tool_use_id);
      if (!inv || inv.uuid !== rec.sourceToolAssistantUUID) continue;
      asks.delete(block.tool_use_id);
      const put = inv.questions;
      // the answer consumes the message before it, like a typed input
      out.lastAssistant = null;
      tur.questions.forEach((q, i) => {
        if (!q || typeof q.question !== 'string' || typeof tur.answers[q.question] !== 'string') return;
        // when the tool_use is in this read, the result must answer what it asked
        const used = put.find((x) => x && x.question === q.question);
        if (!used) return;
        out.inputs.push({ line: lineNo, source: 'human', text: tur.answers[q.question], ext_id: `${rec.uuid || lineNo}#q${i}`, timestamp: rec.timestamp || null,
          session_id: rec.sessionId || null, uuid: rec.uuid ? `${rec.uuid}#q${i}` : null,
          // the options and choice mode as the tool_use put them (the result's copy when it is not in this read)
          asked: { question: q.question, options: (used.options || []).map((o) => o && o.label).filter((x) => typeof x === 'string'), multiSelect: used.multiSelect === true, via: 'AskUserQuestion' } });
      });
      continue;
    }
    const c = classifyRecord(rec);
    if (rec.type === 'user' && c) {
      out.total_user_records++;
      if (c.origin && c.origin.kind) out.with_origin++;
    }
    if (!c) continue;
    const att = rec.attachment;
    out.inputs.push({
      line: lineNo,
      source: c.source,
      text: c.text,
      ext_id: c.ext_id,
      timestamp: c.timestamp,
      session_id: rec.sessionId || (att && att.sessionId) || null,
      uuid: rec.uuid || null,
      ...(c.source === 'human' && out.lastAssistant ? { after_assistant: out.lastAssistant } : {}),
    });
    // each owner input answers the message before it, once
    if (c.source === 'human') out.lastAssistant = null;
  }
  if (!opts.fromOffset && fromLine > lineNo) out.lastLine = lineNo;
  // at most 20 pending invocations are kept for the next read
  out.pendingAsks = Object.fromEntries([...asks.entries()].slice(-20));
  return out;
}

function formatStatus(read) {
  return read.total_user_records >= 3 && read.with_origin === 0 ? 'format_unrecognised' : 'ok';
}

// The current turn, for the Stop checks: the last human input's text and the shell commands the
// session ran since (assistant tool_use blocks with a command). Reads at most the last maxBytes; a
// partial first line is skipped. { owner: text or null, commands: [] }; never throws.
// A turn longer than the window is read again from further back (doubling, up to capBytes), so the
// owner's words and an early evidence read are not lost.
function currentTurn(file, { maxBytes = 8 * 1024 * 1024, capBytes = 64 * 1024 * 1024 } = {}) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { return { owner: null, commands: [] }; }
  for (let n = maxBytes; ; n *= 2) {
    const r = turnIn(file, size, n);
    if (r.owner !== null || n >= size || n >= capBytes) return r;
  }
}

function turnIn(file, size, maxBytes) {
  const out = { owner: null, commands: [] };
  let text;
  try {
    const len = Math.min(size, maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    text = buf.toString('utf8');
  } catch (e) { return out; }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    let rec;
    try { rec = JSON.parse(l); } catch (e) { continue; }
    const c = classifyRecord(rec);
    // the owner's words, and every new prompt (a slash command too) starts this turn's commands
    if (c && c.source === 'human') { out.owner = c.text; out.commands = []; continue; }
    if (c && /^\s*<command-name>/.test(c.text)) { out.commands = []; continue; }
    const content = rec && rec.type === 'assistant' && rec.message && Array.isArray(rec.message.content) ? rec.message.content : [];
    for (const b of content) if (b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string') out.commands.push(b.input.command);
  }
  return out;
}

module.exports = { classifyRecord, readHumanInputs, formatStatus, currentTurn };
