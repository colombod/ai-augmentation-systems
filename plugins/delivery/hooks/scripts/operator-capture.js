#!/usr/bin/env node
// hooks/scripts/operator-capture.js — capture the operator's words from this session's transcript.
//
// Called first by the SessionStart, UserPromptSubmit and Stop hooks (and runnable on its own:
// stdin JSON, silent, exit 0). It only captures: it remembers where the transcript is, appends new
// harness-stamped inputs to the operator log for this role instance, and reports how many of this
// instance's human inputs still have no record. It decides nothing, runs no git and no network, and
// never throws. The transcript may lag the hook; capture is idempotent, so every trigger catches up.
const fs = require('fs');
const path = require('path');
const { operatorCommand } = require('../../scripts/lib/plugin-root.js');

const OP_REL = path.join('.delivery', 'operator');

function writeIfChanged(file, value) {
  try {
    if (fs.readFileSync(file, 'utf8').trim() === value) return;
  } catch (e) { /* missing: write it */ }
  fs.writeFileSync(file, `${value}\n`);
}

// Returns null when this session holds no role (nothing to capture, say nothing), otherwise
// { added, status, pending: [{ id, text }], problem? }. status: ok | format_unrecognised |
// no_transcript | manifest_unavailable | error.
function captureFromHookInput(input, pluginRoot, deps = {}) {
  try {
    const { findRoleMarker, validMarker } = require('./role-context.js');
    const inp = input && typeof input === 'object' ? input : {};
    const found = findRoleMarker(inp.cwd);
    if (!found || !found.marker || process.env.DELIVERY_ROLE !== found.marker.instance) return null;
    let valid;
    try {
      valid = validMarker(found);
    } catch (err) {
      // the session is a role, but the manifest does not load or no longer lists it: nothing is
      // captured as trusted. Fail open, say so.
      return { added: 0, status: 'manifest_unavailable', pending: [],
        problem: `operator capture is off for ${found.marker.instance}: .delivery/team/team.json cannot be loaded or does not list this instance (${err.message}); the operator's words in this session are not captured. Restore .delivery/team/team.json and tell the Chief of Staff.` };
    }
    if (!valid) return null;
    const { marker, role, roleDir } = valid;
    const projectRoot = marker.project_root;
    const now = deps.now || new Date().toISOString();
    const transcriptPath = typeof inp.transcript_path === 'string' && path.isAbsolute(inp.transcript_path) ? inp.transcript_path : null;
    const sessionId = typeof inp.session_id === 'string' && inp.session_id ? inp.session_id : null;
    const problems = [];

    try {
      if (transcriptPath) writeIfChanged(path.join(roleDir, '.delivery-transcript'), transcriptPath);
      if (sessionId) writeIfChanged(path.join(roleDir, '.delivery-session'), sessionId);
    } catch (err) { problems.push(`cannot write the session files in ${roleDir} (${err.message})`); }

    if (transcriptPath) {
      try {
        const { setTranscriptPath } = require('../../scripts/lib/roster.js');
        setTranscriptPath(projectRoot, { instance: marker.instance, session_id: sessionId, transcript_path: transcriptPath, host: role.host, role_dir: roleDir, now });
      } catch (err) { problems.push(`cannot record the transcript in the roster (${err.message})`); }
    }

    let added = 0;
    let status = transcriptPath && fs.existsSync(transcriptPath) ? 'ok' : 'no_transcript';
    if (status === 'ok') {
      try {
        const sync = deps.syncTranscript || require('../../scripts/lib/operator-log.js').syncTranscript;
        const sid = sessionId || path.basename(transcriptPath).replace(/\.jsonl$/, '');
        const roleSince = require('../../scripts/lib/operator-log.js').roleSince(roleDir, sid, { now });
        const r = sync({ projectRoot, transcriptPath, sessionId: sid,
          instance: marker.instance, role: role.id, host: role.host, roleSince });
        added = (r && r.added) || 0;
        if (r && r.status) status = r.status;
      } catch (err) {
        status = 'error';
        problems.push(`operator capture failed (${err && err.message ? err.message : err}); run \`${operatorCommand(pluginRoot || path.join(__dirname, '..', '..'))} sync\` to retry`);
      }
    }
    if (status === 'format_unrecognised') problems.push('the transcript format was not recognised, so no operator input was captured as human; tell the Chief of Staff');

    let pending = [];
    if (fs.existsSync(path.join(projectRoot, OP_REL))) {
      try {
        const pend = deps.pending || require('../../scripts/lib/operator-records.js').pending;
        const res = pend(projectRoot, {});
        pending = ((res && res.inputs) || []).filter((e) => e && e.instance === marker.instance)
          .map((e) => ({ id: e.id, text: String(e.text || '') }));
      } catch (err) { /* a view failure is reported by operator.js pending; capture stays quiet */ }
    }
    const out = { added, status, pending };
    if (problems.length) out.problem = problems.join('; ');
    return out;
  } catch (err) {
    return { added: 0, status: 'error', pending: [], problem: `operator capture failed (${err && err.message ? err.message : err})` };
  }
}

// One short line for additionalContext, or ''. Informational only: it names the inputs, it decides nothing.
function captureNote(res, pluginRoot) {
  if (!res) return '';
  const parts = [];
  if (res.pending && res.pending.length) {
    const first = res.pending.slice(0, 3).map((p) => `${p.id} ("${p.text.replace(/\s+/g, ' ').slice(0, 60)}")`).join(', ');
    const more = res.pending.length > 3 ? ` and ${res.pending.length - 3} more` : '';
    const cmd = operatorCommand(pluginRoot || path.join(__dirname, '..', '..'));
    parts.push(`Operator inputs with no record yet: ${first}${more}. See \`${cmd} pending\`.`);
  }
  if (res.problem) parts.push(`Operator capture: ${String(res.problem).replace(/[.\s]+$/, '')}.`);
  return parts.join(' ');
}

module.exports = { captureFromHookInput, captureNote };

if (require.main === module) {
  try {
    const { readHookInput } = require('./role-context.js');
    const res = captureFromHookInput(readHookInput(), path.join(__dirname, '..', '..'));
    if (res && res.problem) process.stderr.write(`delivery: ${res.problem}\n`);
  } catch (err) { /* never into the session */ }
  process.exit(0);
}
