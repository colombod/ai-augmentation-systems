// scripts/lib/bd.js — the only place that runs the bd CLI. Argv arrays only.
const { execFileSync } = require('child_process');

function makeBd({ cwd, env, timeoutMs } = {}) {
  // `list --all` returns about 1 KB per bead; the 1 MB default buffer would fail near a thousand beads.
  // A hook passes a shorter timeout so its own deadline holds.
  const opts = { cwd: cwd || process.cwd(), env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs || 30000, maxBuffer: 256 * 1024 * 1024 };
  // a hook sets the next call's timeout from what is left of its own budget
  function setTimeout(ms) { opts.timeout = Math.max(1, Math.floor(ms)); }

  function exec(args) {
    try {
      return execFileSync('bd', args, opts).toString();
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      throw new Error(`bd ${args.join(' ')}: ${stderr || err.message}`);
    }
  }

  function json(args) {
    const raw = exec(args).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  }

  function one(value) {
    if (Array.isArray(value)) return value[0] || null;
    return value;
  }

  function normalise(b) {
    return { ...b, type: b.issue_type !== undefined ? b.issue_type : b.type, labels: b.labels || [], metadata: b.metadata || {}, parent: b.parent || null };
  }

  function show(id) {
    let b;
    try { b = one(json(['show', id, '--json'])); } catch (err) { return null; }
    if (!b) return null;
    return normalise(b);
  }

  function create({ id, title, type, parent, labels, metadata, priority, description }) {
    const args = ['create', '--id', id, '--title', title, '--silent'];
    if (type) args.push('--type', type);
    if (labels && labels.length) args.push('--labels', labels.join(','));
    if (metadata) args.push('--metadata', JSON.stringify(metadata));
    if (priority !== undefined) args.push('--priority', String(priority));
    if (description) args.push('--description', description);
    const made = exec(args).trim() || id;
    // real bd rejects --id together with --parent, so parent is set afterwards
    if (parent) update(made, { parent });
    return made;
  }

  function update(id, { title, parent, addLabels, removeLabels, metadata, unsetMetadata, appendNotes } = {}) {
    const args = ['update', id];
    if (title) args.push('--title', title);
    if (parent !== undefined) args.push('--parent', parent || '');
    for (const l of addLabels || []) args.push('--add-label', l);
    for (const l of removeLabels || []) args.push('--remove-label', l);
    if (metadata) args.push('--metadata', JSON.stringify(metadata));
    for (const k of unsetMetadata || []) args.push('--unset-metadata', k);
    if (appendNotes) args.push('--append-notes', appendNotes);
    if (args.length === 2) return;
    exec(args);
  }

  function depAdd(id, blockedBy) { exec(['dep', 'add', id, '--blocked-by', blockedBy]); }

  // real bd 1.2.2: `dep remove` takes the blocker positionally; it has no --blocked-by flag.
  function depRemove(id, blockedBy) { exec(['dep', 'remove', id, blockedBy]); }

  function depsOf(id) {
    const rows = json(['dep', 'list', id, '--json']) || [];
    return rows.filter((r) => r.dependency_type === undefined || r.dependency_type === 'blocks').map((r) => r.id).filter(Boolean);
  }

  function list({ label, all, assignee, status } = {}) {
    const args = ['list', '--json', '--limit', '0'];
    if (label) args.push('--label', label);
    if (all) args.push('--all');
    if (assignee) args.push('--assignee', assignee);
    if (status) args.push('--status', status);
    return (json(args) || []).map(normalise);
  }

  return { exec, show, create, update, depAdd, depRemove, depsOf, list, setTimeout };
}

module.exports = { makeBd };
