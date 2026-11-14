// scripts/lib/bd.js — the only place that runs the bd CLI. Argv arrays only.
const { execFileSync } = require('child_process');

// bd's answer for an id no issue matches (bd show prints it on stderr and in its JSON, exit 1)
const NOT_FOUND = /no issues? found matching/i;

// A failed bd read in one line: a timeout named as one, else bd's own first error line.
function readError(err, timeoutMs) {
  const text = String((err && err.message) || err || 'unknown error');
  if ((err && err.code === 'ETIMEDOUT') || /ETIMEDOUT|timed out/i.test(text)) { const ms = timeoutMs || 30000; return `bd did not answer within ${ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`} (timed out)`; }
  // exec() prefixes the command ("bd show x --json: "); bd's stderr may lead with warnings and hints
  const lines = text.replace(/^bd [^:\n]*: /, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(warning:|Fix:|Or:|Hint:)/i.test(l));
  return (lines.find((l) => /error/i.test(l)) || lines[0] || 'bd failed').slice(0, 200);
}

// A bead from any store, as the scripts that report to a role need it: { bead }, { missing }, or
// { error } when the read failed. A test store with show() only is read through show().
function lookupBead(store, id) {
  if (store && typeof store.lookup === 'function') return store.lookup(id);
  let b = null;
  try { b = store.show(id); } catch (err) { return { error: readError(err) }; }
  return b ? { bead: b } : { missing: true };
}

// The refusal a script gives for a bead it could not read: the bd error by name, never "no bead".
const lookupProblem = (id, r) => (r.error ? `bead ${id} could not be read: ${r.error}; try again in a moment` : `no bead ${id}`);

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

  // One bead, read with a retry: { bead }, { missing } when bd says no issue matches, or { error } naming
  // what failed. A bd read that timed out or errored under load was taken as a missing bead, so the
  // scripts said "no bead <id>" for a bead bd show then found (8l1.4.1.2.1).
  function lookup(id) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const b = one(json(['show', id, '--json']));
        return b ? { bead: normalise(b) } : { missing: true };
      } catch (err) {
        if (NOT_FOUND.test(String((err && err.message) || ''))) return { missing: true };
        last = err;
      }
    }
    return { error: readError(last, opts.timeout) };
  }

  // null for a missing bead, and also for a read that failed twice: the callers that only need to know
  // whether a bead is there keep their contract; a script that reports to a role uses lookupBead
  function show(id) {
    const r = lookup(id);
    return r.bead || null;
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

  function update(id, { title, parent, addLabels, removeLabels, metadata, unsetMetadata, appendNotes, assignee } = {}) {
    const args = ['update', id];
    if (title) args.push('--title', title);
    if (assignee) args.push('--assignee', assignee);
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

  // open beads with no open blocker (bd's own readiness), for the idle alarm
  function ready() { return (json(['ready', '--json', '--limit', '0']) || []).map(normalise); }

  return { exec, show, lookup, create, update, depAdd, depRemove, depsOf, list, ready, setTimeout };
}

module.exports = { makeBd, lookupBead, lookupProblem, readError, NOT_FOUND };
