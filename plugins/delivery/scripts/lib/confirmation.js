// scripts/lib/confirmation.js — the operator confirmation contract: the versioned, provider-neutral
// `asked` object on an operator input, and the one reader every check goes through.
//
// Captures stored before the contract carry no `contract` key and name the question box in `via`; they
// read as delivery.confirmation/0, their fields as stored, checked as they always were. A /1 record goes
// to the adapter of its provider, which checks it against the provider's own transcript and returns
// exactly one of verified, refused (the evidence contradicts itself) or unresolved (this session cannot
// check it: an unknown contract major, an unknown provider, a transcript not readable here). Only
// verified may set a goal field. The operator log is a hash chain, so a stored record is never upgraded.
const fs = require('fs');
const path = require('path');

const CONTRACT = 'delivery.confirmation/1';
const CONTRACT_RE = /^delivery\.confirmation\/(0|[1-9]\d*)$/;

// The Claude Code form of a /1 record, built by the transcript reader from the harness's AskUserQuestion
// tool_use and its tool_result. question_id and scope stay null: the capture cannot know them.
function claudeCode({ question, choices, multiSelect, answer, toolUseId, assistantUuid, resultUuid, index, askedAt, answeredAt, file, line }) {
  return {
    contract: CONTRACT,
    question, choices, multi_select: multiSelect === true, answer,
    question_id: null, scope: null,
    event_id: `claude:${resultUuid}#q${index}`,
    asked_at: askedAt || null, answered_at: answeredAt || null,
    provenance: {
      provider: 'claude-code', mechanism: 'AskUserQuestion',
      native_ref: { tool_use_id: toolUseId, assistant_uuid: assistantUuid, result_uuid: resultUuid },
      transcript_ref: { file, line },
    },
  };
}

// The major of a stored `asked`: 0 for a capture from before the contract, the number for a /<n> from 1,
// or null when it is neither (no question box at all, or a malformed contract). /0 is a reading of a
// record with no contract key, never a contract anyone writes: a record that names /0 itself would pass
// as stored without any transcript being opened, so it is malformed.
function majorOf(asked) {
  if (!asked || typeof asked !== 'object') return null;
  if (asked.contract === undefined) return asked.via === 'AskUserQuestion' ? 0 : null;
  const m = CONTRACT_RE.exec(String(asked.contract));
  return m && Number(m[1]) >= 1 ? Number(m[1]) : null;
}

// What the operator was shown and chose, in one shape whatever the major: { question, choices,
// multiSelect, answer }. answer is null on /0 (the input's text is the answer there).
function fieldsOf(asked) {
  if (majorOf(asked) === 0) return { question: asked.question, choices: asked.options, multiSelect: asked.multiSelect, answer: null };
  return { question: asked.question, choices: asked.choices, multiSelect: asked.multi_select, answer: asked.answer };
}

// { verdict: 'verified'|'refused'|'unresolved', reason? } for the confirmation on an operator input.
// /0 passes here as stored: the checks on its fields are the caller's, unchanged.
function check(root, input, { adapters = ADAPTERS } = {}) {
  const asked = input && input.asked;
  const major = majorOf(asked);
  if (major === 0) return { verdict: 'verified', major };
  if (!asked || asked.contract === undefined) return { verdict: 'refused', reason: 'it has no question box record' };
  if (major === null && CONTRACT_RE.test(String(asked.contract))) return { verdict: 'refused', reason: `its contract ${JSON.stringify(asked.contract)} is never written: /0 is only the reading of a capture with no contract key` };
  if (major === null) return { verdict: 'refused', reason: `its contract ${JSON.stringify(asked.contract)} is malformed` };
  if (major !== 1) return { verdict: 'unresolved', major, reason: `its contract major ${major} (${asked.contract}) is unknown to this plugin, which reads delivery.confirmation/0 and /1` };
  const provider = asked.provenance && asked.provenance.provider;
  const adapter = Object.prototype.hasOwnProperty.call(adapters, provider) ? adapters[provider] : null;
  if (!adapter) return { verdict: 'unresolved', major, reason: `its provider ${JSON.stringify(provider === undefined ? null : provider)} has no adapter in this plugin` };
  let r;
  try { r = adapter(root, input, asked); } catch (err) { r = { verdict: 'unresolved', reason: `the ${provider} adapter failed: ${err.message}` }; }
  return { ...r, major };
}

// ---- the Claude Code adapter ----

// The session transcript named by transcript_ref, found through this project's capture cursors, which
// record each captured transcript's full path. null when no cursor here names it or it is not readable.
function findTranscript(root, file) {
  if (typeof file !== 'string' || !file || path.basename(file) !== file) return null;
  const cursors = path.join(root, '.delivery', 'operator', 'cursors');
  let names = [];
  try { names = fs.readdirSync(cursors); } catch (err) { names = []; }
  for (const n of names) {
    let c = null;
    try { c = JSON.parse(fs.readFileSync(path.join(cursors, n), 'utf8')); } catch (err) { continue; }
    if (!c || typeof c.transcript !== 'string' || path.basename(c.transcript) !== file) continue;
    try { if (fs.statSync(c.transcript).isFile()) return c.transcript; } catch (err) { /* next */ }
  }
  return null;
}

// The transcript records carrying any of the uuids, by uuid, with their line numbers. A line is parsed only
// when its text holds one of them, so a large transcript costs one read. Cached by path, size and mtime.
const cache = new Map();
function recordsOf(file, uuids) {
  const st = fs.statSync(file);
  const key = `${file}\0${st.size}\0${st.mtimeMs}\0${uuids.join('\0')}`;
  if (cache.has(key)) return cache.get(key);
  const found = new Map();
  fs.readFileSync(file, 'utf8').split('\n').forEach((l, i) => {
    if (!uuids.some((u) => l.includes(u))) return;
    let rec; try { rec = JSON.parse(l); } catch (err) { return; }
    if (rec && typeof rec.uuid === 'string' && uuids.includes(rec.uuid) && !found.has(rec.uuid)) found.set(rec.uuid, { rec, line: i + 1 });
  });
  if (cache.size > 32) cache.clear();
  cache.set(key, found);
  return found;
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
const isText = (s) => typeof s === 'string' && s.length > 0;

function claudeAdapter(root, input, asked) {
  const ref = asked.provenance.native_ref || {};
  const refused = (reason) => ({ verdict: 'refused', reason });
  if (asked.provenance.mechanism !== 'AskUserQuestion') return refused(`its mechanism ${JSON.stringify(asked.provenance.mechanism)} is not Claude Code's question box (AskUserQuestion)`);
  if (![ref.tool_use_id, ref.assistant_uuid, ref.result_uuid].every(isText)) return refused('its native_ref lacks tool_use_id, assistant_uuid or result_uuid');
  if (!isText(asked.question) || !Array.isArray(asked.choices) || typeof asked.multi_select !== 'boolean' || !isText(asked.answer)) return refused('it is malformed (question, choices, multi_select or answer missing)');
  const m = /^claude:(.+)#q(\d+)$/.exec(String(asked.event_id || ''));
  if (!m || m[1] !== ref.result_uuid) return refused(`its event_id ${JSON.stringify(asked.event_id)} is not claude:<result_uuid>#q<n> for its native_ref`);
  const tref = asked.provenance.transcript_ref || {};
  const file = findTranscript(root, tref.file);
  if (!file) return { verdict: 'unresolved', reason: `its transcript ${JSON.stringify(tref.file === undefined ? null : tref.file)} is not readable from this host` };
  let recs;
  try { recs = recordsOf(file, [ref.assistant_uuid, ref.result_uuid]); } catch (err) { return { verdict: 'unresolved', reason: `its transcript ${tref.file} could not be read (${err.code || err.message})` }; }
  const ask = recs.get(ref.assistant_uuid);
  const res = recs.get(ref.result_uuid);
  const blocks = (r) => (r && r.rec.message && Array.isArray(r.rec.message.content) ? r.rec.message.content : []);
  const use = ask && ask.rec.type === 'assistant' && blocks(ask).find((b) => b && b.type === 'tool_use' && b.id === ref.tool_use_id && b.name === 'AskUserQuestion');
  if (!use) return refused(`its native_ref does not resolve in ${tref.file}: no AskUserQuestion ${ref.tool_use_id} in assistant record ${ref.assistant_uuid}`);
  // the answer is the harness's tool_result to that same tool_use, written as the operator's turn
  const result = res && res.rec.type === 'user' && res.rec.sourceToolAssistantUUID === ref.assistant_uuid && blocks(res).find((b) => b && b.type === 'tool_result' && b.tool_use_id === ref.tool_use_id);
  const tur = res && res.rec.toolUseResult;
  if (!result || !tur || typeof tur !== 'object' || !tur.answers) return refused(`its native_ref does not resolve in ${tref.file}: no answer ${ref.result_uuid} to ${ref.tool_use_id}`);
  if (!(res.line > ask.line)) return refused(`in ${tref.file} the answer (line ${res.line}) does not follow the question (line ${ask.line})`);
  const shown = ((use.input && use.input.questions) || [])[Number(m[2])];
  if (!shown || shown.question !== asked.question) return refused(`its question differs from the transcript's (${JSON.stringify(shown ? shown.question : null)})`);
  const labels = (shown.options || []).map((o) => o && o.label);
  if (!sameList(labels, asked.choices)) return refused(`its choices differ from the transcript's (${JSON.stringify(labels)})`);
  if ((shown.multiSelect === true) !== asked.multi_select) return refused('its multi_select differs from the transcript\'s');
  if (tur.answers[asked.question] !== asked.answer) return refused(`its answer differs from the transcript's (${JSON.stringify(tur.answers[asked.question] === undefined ? null : tur.answers[asked.question])})`);
  if (asked.asked_at !== (ask.rec.timestamp || null) || asked.answered_at !== (res.rec.timestamp || null)) return refused('its asked_at or answered_at differs from the transcript\'s');
  if (input.session_id && res.rec.sessionId && input.session_id !== res.rec.sessionId) return refused(`its session ${input.session_id} is not the transcript's (${res.rec.sessionId})`);
  return { verdict: 'verified' };
}

const ADAPTERS = Object.freeze({ 'claude-code': claudeAdapter });

module.exports = { CONTRACT, CONTRACT_RE, claudeCode, majorOf, fieldsOf, check, findTranscript, ADAPTERS };
