#!/usr/bin/env node
// hooks/scripts/label-strip.js — the state labels bd copied onto a new child come off (m7y).
// PostToolUse, matcher Bash. bd 1.1.2 copies a parent's labels onto every child it creates, so a bead made
// with `bd create --parent <a merged or deployed bead>` was born state-merged and state-deployed with no
// pull request, and the watchdog and the plan sent the Delivery Manager to check work that never shipped.
// After such a create in a role session, every state label the command did not ask for is removed from
// the new bead, and the session is told in one line. Observe and repair only: never a block. Exit 0 always.

const CREATE = /(?:^|[\s;&|(])bd\s+create\b([^;&|\n]*)/;
const PARENT = /--parent(?:=|\s+)(['"]?)([^\s'";&|)]+)\1/;
const LABELS = /(?:--labels?|-l)(?:=|\s+)(['"]?)([^\s'";&|)]+)\1/g;

// the new bead's id, from what bd printed: its JSON, "Created issue: <id>", or the bare id (--silent)
function createdId(response) {
  const out = String((response && (response.stdout !== undefined ? response.stdout : response)) || '').trim();
  if (!out) return null;
  try { const j = JSON.parse(out); const x = Array.isArray(j) ? j[0] : j; if (x && typeof x.id === 'string') return x.id; } catch (err) { /* not JSON */ }
  const m = /Created issue:\s*([A-Za-z0-9._-]+)/.exec(out);
  if (m) return m[1];
  return /^[A-Za-z0-9._-]+$/.test(out) ? out : null;
}

// { id, parent, asked } for a bd create with a parent, or null
function parseCreate(command) {
  const m = CREATE.exec(String(command || ''));
  if (!m) return null;
  const p = PARENT.exec(m[1]);
  if (!p) return null;
  const asked = [];
  let l;
  LABELS.lastIndex = 0;
  while ((l = LABELS.exec(m[1]))) asked.push(...l[2].split(',').filter(Boolean));
  return { parent: p[2], asked };
}

// { context } or null. Never throws.
function check(input, { bd } = {}) {
  try {
    if (!input || input.tool_name !== 'Bash') return null;
    const c = parseCreate((input.tool_input || {}).command);
    if (!c) return null;
    const id = createdId(input.tool_response);
    if (!id) return null;
    let store = bd;
    if (!store) {
      const { findRoleMarker, validMarker } = require('./role-context.js');
      const valid = validMarker(findRoleMarker(input.cwd));
      if (!valid || !valid.marker) return null;
      store = require('../../scripts/lib/bd.js').makeBd({ cwd: valid.marker.project_root, timeoutMs: 4000 });
    }
    const removed = require('../../scripts/lib/bd.js').stripCopiedState(store, id, c.asked);
    if (!removed.length) return null;
    return { context: `Removed ${removed.join(', ')} from ${id}: bd copied them from its parent ${c.parent}. A bead is merged or deployed only by its own record (evidence.js state ${id} merged --pr <n>, or deployed --sha <sha>).` };
  } catch (err) { return null; }
}

module.exports = { check, parseCreate, createdId };

if (require.main === module) {
  try {
    const d = check(require('./role-context.js').readHookInput());
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: d.context } }));
  } catch (err) { /* observe only */ }
  process.exit(0);
}
