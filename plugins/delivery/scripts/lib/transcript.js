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
  const out = { inputs: [], lastLine: fromLine, lastOffset: fromOffset, total_user_records: 0, with_origin: 0, rescanned: false };
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
    });
  }
  if (!opts.fromOffset && fromLine > lineNo) out.lastLine = lineNo;
  return out;
}

function formatStatus(read) {
  return read.total_user_records >= 3 && read.with_origin === 0 ? 'format_unrecognised' : 'ok';
}

module.exports = { classifyRecord, readHumanInputs, formatStatus };
