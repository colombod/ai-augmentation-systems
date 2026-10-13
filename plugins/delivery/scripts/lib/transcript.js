// scripts/lib/transcript.js — read the harness-written transcript JSONL and classify user input
// by the harness's own `origin` stamp, never by message wording. All format knowledge lives here.
const fs = require('fs');

const SYSTEM_PREFIXES = ['<system-reminder>', '<command-name>', '<local-command', '<task-notification'];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    return parts.length ? parts.join('\n') : null;
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
    if (kind === 'human') source = 'human';
    else if (kind === 'peer') source = 'peer';
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
  } else source = 'unknown';
  return {
    source, text,
    ext_id: record.promptId || record.uuid || null,
    timestamp: record.timestamp || null,
    origin,
  };
}

// Read complete lines after `fromLine` (count of lines already consumed). A final line without a
// newline is left for the next read (the harness may still be writing it).
function readHumanInputs(file, opts = {}) {
  const fromLine = opts.fromLine || 0;
  const out = { inputs: [], lastLine: fromLine, total_user_records: 0, with_origin: 0 };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return out; }
  const lines = raw.split('\n');
  const complete = lines.length - 1; // last element is '' or a partial line
  for (let i = fromLine; i < complete; i++) {
    out.lastLine = i + 1;
    const l = lines[i];
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
      line: i + 1,
      source: c.source,
      text: c.text,
      ext_id: c.ext_id,
      timestamp: c.timestamp,
      session_id: rec.sessionId || (att && att.sessionId) || null,
      uuid: rec.uuid || null,
    });
  }
  if (fromLine > complete) out.lastLine = Math.max(complete, 0);
  return out;
}

function formatStatus(read) {
  return read.total_user_records >= 3 && read.with_origin === 0 ? 'format_unrecognised' : 'ok';
}

module.exports = { classifyRecord, readHumanInputs, formatStatus };
