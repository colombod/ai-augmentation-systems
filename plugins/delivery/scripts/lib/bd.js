// scripts/lib/bd.js — the only place that runs the bd CLI. Argv arrays only.
const { execFileSync } = require('child_process');

function makeBd({ cwd, env } = {}) {
  const opts = { cwd: cwd || process.cwd(), env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 };

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

  function show(id) {
    try { return one(json(['show', id, '--json'])); } catch (err) { return null; }
  }

  function create({ id, title, type, parent, labels, metadata, priority, description }) {
    const args = ['create', '--id', id, '--title', title, '--silent'];
    if (type) args.push('--type', type);
    if (parent) args.push('--parent', parent);
    if (labels && labels.length) args.push('--labels', labels.join(','));
    if (metadata) args.push('--metadata', JSON.stringify(metadata));
    if (priority !== undefined) args.push('--priority', String(priority));
    if (description) args.push('--description', description);
    return exec(args).trim() || id;
  }

  function update(id, { title, parent, addLabels, metadata, appendNotes } = {}) {
    const args = ['update', id];
    if (title) args.push('--title', title);
    if (parent !== undefined) args.push('--parent', parent || '');
    for (const l of addLabels || []) args.push('--add-label', l);
    if (metadata) args.push('--metadata', JSON.stringify(metadata));
    if (appendNotes) args.push('--append-notes', appendNotes);
    if (args.length === 2) return;
    exec(args);
  }

  function depAdd(id, blockedBy) { exec(['dep', 'add', id, '--blocked-by', blockedBy]); }

  function depsOf(id) {
    const rows = json(['dep', 'list', id, '--json']) || [];
    return rows.filter((r) => r.id === id || r.issue_id === id).map((r) => r.blocked_by || r.depends_on_id).filter(Boolean);
  }

  function list({ label, all } = {}) {
    const args = ['list', '--json', '--limit', '0'];
    if (label) args.push('--label', label);
    if (all) args.push('--all');
    return json(args) || [];
  }

  return { exec, show, create, update, depAdd, depsOf, list };
}

module.exports = { makeBd };
