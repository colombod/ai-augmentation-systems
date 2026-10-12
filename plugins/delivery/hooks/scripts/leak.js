// hooks/scripts/leak.js — keep plans and strategy out of the public product repo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { splitCommand, tokens } = require('./lane.js');

function loadDenylist(projectRoot) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Resolve symlinks on the deepest existing ancestor, so a not-yet-created path still compares correctly.
function real(p) {
  let cur = path.resolve(p || '');
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch (e) { /* walk up */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p || '');
    rest.push(path.basename(cur));
    cur = parent;
  }
}
function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
function inProductWorktree(cwd, roleDir) { return under(real(cwd), path.join(real(roleDir), 'product')); }

const MSG_FLAGS = { git: { '-m': true, '--message': true, '-F': 'file', '--file': 'file' }, gh: { '--title': true, '-t': true, '--body': true, '-b': true, '--body-file': 'file', '-F': 'file' } };

function extractMessages(command) {
  const out = [];
  for (const seg of splitCommand(command)) {
    const t = tokens(seg);
    if (!t.length) continue;
    const isCommit = t[0] === 'git' && t[1] === 'commit';
    const isGh = t[0] === 'gh' && ((t[1] === 'pr' && ['create', 'edit', 'comment'].includes(t[2])) || (t[1] === 'issue' && t[2] === 'comment'));
    if (!isCommit && !isGh) continue;
    const flags = MSG_FLAGS[t[0]];
    for (let i = 1; i < t.length; i++) {
      const eq = t[i].indexOf('=');
      const name = eq > 0 ? t[i].slice(0, eq) : t[i];
      if (!Object.prototype.hasOwnProperty.call(flags, name)) continue;
      const value = eq > 0 ? t[i].slice(eq + 1) : t[i + 1];
      if (value === undefined) continue;
      out.push(flags[name] === 'file' ? `<file: ${value}>` : value);
      if (eq < 0) i++;
    }
  }
  return out;
}

function scanText(text, denylist) {
  const hay = String(text || '').toLowerCase();
  if (hay.includes('.delivery/')) return { phrase: '.delivery/' };
  for (const p of denylist) if (p && hay.includes(p.toLowerCase())) return { phrase: p };
  return null;
}

const RULE = ' Only Refs <bead id> is allowed; describe the change to the product, never the plan.';

function decideLeak({ toolName, toolInput, cwd, roleDir, denylist }) {
  if (!inProductWorktree(cwd, roleDir)) return null;
  if (toolName === 'Bash') {
    const cmd = String((toolInput || {}).command || '');
    for (const seg of splitCommand(cmd)) {
      const t = tokens(seg);
      if (t[0] === 'gh' && t[1] === 'issue' && t[2] === 'create') return { reason: 'GitHub issues in the product repo are for users; record internal work in beads.' };
    }
    for (const m of extractMessages(cmd)) {
      if (m.startsWith('<file:')) return { reason: `Commit and PR text must be inline so it can be checked (${m}).${RULE}` };
      const hit = scanText(m, denylist);
      if (hit) return { reason: `Commit or PR text contains a plan phrase: "${hit.phrase}".${RULE}` };
    }
    return null;
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    const fp = (toolInput || {}).file_path || (toolInput || {}).notebook_path || '';
    const abs = path.resolve(cwd, fp);
    const parts = abs.split(path.sep);
    if (parts.includes('.delivery') || parts.includes('.beads') || abs.endsWith('team.json')) return { reason: `Plan files (${fp}) never live in the product repo; they belong in the project repo.` };
  }
  return null;
}

function scanPushed({ cwd, roleDir, denylist, git }) {
  if (!inProductWorktree(cwd, roleDir)) return [];
  const run = git || ((args) => { try { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (err) { return ''; } });
  let log = run(['log', '@{upstream}..HEAD', '--format=%B']);
  if (!log) log = run(['log', '-n', '20', '--format=%B']);
  const hits = [];
  for (const p of denylist) if (p && log.toLowerCase().includes(p.toLowerCase()) && !hits.includes(p)) hits.push(p);
  if (log.includes('.delivery/')) hits.push('.delivery/');
  return hits;
}

module.exports = { loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, scanPushed };
