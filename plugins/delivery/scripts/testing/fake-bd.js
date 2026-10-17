#!/usr/bin/env node
// scripts/testing/fake-bd.js — a fake `bd` for tests. Backed by the JSON file named in
// BD_FAKE_STORE. Implements only what materialise and the hooks use. Never used in production.
const fs = require('fs');

const storePath = process.env.BD_FAKE_STORE;
if (!storePath) { process.stderr.write('fake-bd: BD_FAKE_STORE not set\n'); process.exit(2); }

function load() {
  if (!fs.existsSync(storePath)) return { issues: {}, deps: [] };
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}
function save(s) { fs.writeFileSync(storePath, JSON.stringify(s, null, 2)); }

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { flags[key] = true; continue; }
      if (key === 'add-label' || key === 'remove-label') { (flags[key] = flags[key] || []).push(next); } else { flags[key] = next; }
      i++;
    } else if (a === '-p' || a === '-t' || a === '-l' || a === '-d' || a === '-a') {
      const map = { '-p': 'priority', '-t': 'type', '-l': 'labels', '-d': 'description', '-a': 'assignee' };
      flags[map[a]] = argv[i + 1]; i++;
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

// Mirror real bd's per-issue JSON shape: issue_type (not type), labels/metadata/parent/notes only when set.
function view(b) {
  const { type, labels, metadata, parent, notes, ...rest } = b;
  const v = { ...rest, issue_type: type };
  if (parent) v.parent = parent;
  if (labels && labels.length) v.labels = labels;
  if (metadata && Object.keys(metadata).length) v.metadata = metadata;
  if (notes) v.notes = notes;
  return v;
}

function out(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

const [cmd, ...rest] = process.argv.slice(2);
const { pos, flags } = parse(rest);
const s = load();

switch (cmd) {
  case 'show': {
    const id = pos[0] || flags.id;
    const b = s.issues[id];
    if (!b) { process.stderr.write(`fake-bd: no such issue ${id}\n`); process.exit(1); }
    if (flags.json) out([view(b)]); else process.stdout.write(`${b.id}: ${b.title}\n`);
    break;
  }
  case 'create': {
    const id = flags.id;
    if (!id) { process.stderr.write('fake-bd: --id required in tests\n'); process.exit(2); }
    if (flags.parent) { process.stderr.write('fake-bd: cannot specify both --id and --parent flags\n'); process.exit(1); }
    // Test-time guard only: real bd silently overwrites an existing id (title replaced, metadata wiped).
    if (s.issues[id]) { process.stderr.write(`fake-bd: issue ${id} already exists\n`); process.exit(1); }
    const title = flags.title || pos[0] || '';
    s.issues[id] = {
      id, title, status: 'open', type: flags.type || 'task', parent: flags.parent || null,
      labels: flags.labels ? String(flags.labels).split(',') : [],
      metadata: flags.metadata ? JSON.parse(flags.metadata) : {},
      notes: flags.notes || '', priority: flags.priority !== undefined ? Number(String(flags.priority).replace(/^P/, '')) : 2,
      description: flags.description || '', assignee: '', updated_at: new Date().toISOString(),
    };
    save(s);
    process.stdout.write(`${id}\n`);
    break;
  }
  case 'update': {
    const id = pos[0];
    const b = s.issues[id];
    if (!b) { process.stderr.write(`fake-bd: no such issue ${id}\n`); process.exit(1); }
    if (flags.title) b.title = flags.title;
    if (flags.parent !== undefined) b.parent = flags.parent || null;
    if (flags['add-label']) for (const l of flags['add-label']) if (!b.labels.includes(l)) b.labels.push(l);
    if (flags['remove-label']) b.labels = b.labels.filter((l) => !flags['remove-label'].includes(l));
    if (flags.metadata) Object.assign(b.metadata, JSON.parse(flags.metadata));
    if (flags['append-notes']) b.notes = b.notes ? `${b.notes}\n${flags['append-notes']}` : flags['append-notes'];
    if (flags.status) b.status = flags.status;
    if (flags.assignee !== undefined) b.assignee = flags.assignee;
    if (flags.claim) { b.assignee = process.env.BEADS_ACTOR || 'fake'; b.status = 'in_progress'; }
    b.updated_at = new Date().toISOString();
    save(s);
    process.stdout.write(`updated ${id}\n`);
    break;
  }
  case 'dep': {
    const sub = pos[0];
    if (sub === 'add') {
      const id = pos[1];
      const blockedBy = flags['blocked-by'] || flags['depends-on'] || pos[2];
      if (!s.issues[id] || !s.issues[blockedBy]) { process.stderr.write('fake-bd: unknown issue in dep\n'); process.exit(1); }
      // Mirror real bd: reject a dep whose blocker already (transitively) waits on id, whatever the status.
      const seen = new Set();
      const stack = [blockedBy];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === id) { process.stderr.write('Error: adding dependency would create a cycle\n'); process.exit(1); }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const d of s.deps) if (d.id === cur) stack.push(d.blocked_by);
      }
      if (!s.deps.some((d) => d.id === id && d.blocked_by === blockedBy)) s.deps.push({ id, blocked_by: blockedBy });
      save(s);
      process.stdout.write('ok\n');
    } else if (sub === 'remove' || sub === 'rm') {
      // real bd: `dep remove <id> <blocker>` (positional only); removing an absent dep exits 0.
      const id = pos[1];
      const blockedBy = pos[2];
      if (flags['blocked-by']) { process.stderr.write('Error: unknown flag: --blocked-by\n'); process.exit(1); }
      if (!id || !blockedBy) { process.stderr.write('fake-bd: dep remove <id> <blocker>\n'); process.exit(1); }
      s.deps = s.deps.filter((d) => !(d.id === id && d.blocked_by === blockedBy));
      save(s);
      process.stdout.write('ok\n');
    } else if (sub === 'list') {
      const id = pos[1];
      const rows = s.deps.filter((d) => d.id === id && s.issues[d.blocked_by])
        .map((d) => ({ ...view(s.issues[d.blocked_by]), dependency_type: 'blocks' }));
      const par = s.issues[id] && s.issues[id].parent;
      if (par && s.issues[par]) rows.push({ ...view(s.issues[par]), dependency_type: 'parent-child' });
      out(rows);
    } else { process.stderr.write('fake-bd: unknown dep subcommand\n'); process.exit(2); }
    break;
  }
  case 'list': {
    let items = Object.values(s.issues);
    if (!flags.all) items = items.filter((b) => b.status !== 'closed');
    if (flags.label) items = items.filter((b) => b.labels.includes(flags.label));
    if (flags.assignee) items = items.filter((b) => b.assignee === flags.assignee);
    if (flags.status) items = items.filter((b) => b.status === flags.status);
    if (flags.json) out(items.map(view)); else for (const b of items) process.stdout.write(`${b.id}: ${b.title}\n`);
    break;
  }
  case 'close': {
    const id = pos[0];
    const b = s.issues[id];
    if (!b) { process.stderr.write(`fake-bd: no such issue ${id}\n`); process.exit(1); }
    b.status = 'closed'; b.close_reason = flags.reason || ''; b.updated_at = new Date().toISOString();
    save(s);
    process.stdout.write(`closed ${id}\n`);
    break;
  }
  case 'prime': process.stdout.write('fake-bd prime\n'); break;
  case 'version': process.stdout.write('bd version 0.0.0-fake\n'); break;
  case 'init': {
    // what start.js relies on: a .beads directory in the working directory
    const dir = require('path').join(process.cwd(), '.beads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(require('path').join(dir, 'fake-config.json'), JSON.stringify({ prefix: flags.prefix || null }));
    process.stdout.write(`fake-bd init ${flags.prefix || ''}\n`);
    break;
  }
  case 'ready': {
    const blocked = new Set(s.deps.filter((d) => s.issues[d.blocked_by] && s.issues[d.blocked_by].status !== 'closed').map((d) => d.id));
    const items = Object.values(s.issues).filter((b) => b.status === 'open' && !blocked.has(b.id));
    if (flags.json) out(items.map(view)); else for (const b of items) process.stdout.write(`${b.id}: ${b.title}\n`);
    break;
  }
  default:
    process.stderr.write(`fake-bd: unknown command ${cmd}\n`);
    process.exit(2);
}
