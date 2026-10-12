// hooks/scripts/lane.js — the role lane policy: what a role may write and run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRoleBrief } = require('../../scripts/lib/compose-brief.js');
const { listValue } = require('../../scripts/lib/plan-docs.js');

const SANCTIONED = {
  'chief-of-staff': 'route it: create a child bead for the right role (`bd create --parent <id> ...`) and message that session',
  staffing: 'only team.json and briefs are yours; anything else goes to the Delivery Lead',
  'product-manager': 'product documents are yours; building goes to a builder bead, plan structure to the Delivery Lead',
  'delivery-lead': 'stories, sprints and bead structure are yours; building goes to a builder bead',
  'progress-observer': 'record evidence in reviews and beads; fixes go to a builder bead',
  builder: 'product code in your worktree is yours; plans belong to the Delivery Lead',
  'spike-researcher': 'answers go in the bead and the ADR or roadmap; product code is never yours',
};
const REACH_PREFIXES = ['mcp__Claude_Browser__', 'mcp__claude-in-chrome__', 'mcp__computer-use__', 'mcp__Claude_Code_iOS_Simulator__'];
// Commands that change files or privilege: classified [] unless a group names them explicitly.
const GUARDED_FIRST = ['rm', 'mv', 'cp', 'sudo', 'chmod', 'chown', 'curl', 'wget'];

function sanctioned(roleId) { return SANCTIONED[roleId] || 'stay in your lane; ask the Delivery Lead'; }

function loadPolicy({ pluginRoot, projectRoot, briefRef }) {
  const { meta } = loadRoleBrief(pluginRoot, projectRoot, briefRef);
  return { roleId: String(meta.id || ''), writes: listValue(meta.lane_writes), bash: listValue(meta.lane_bash) };
}

// Walk a command with shell quoting rules: backslash escapes outside single quotes,
// no escapes inside single quotes. visit(c, i, quote) returns a number of chars to skip, or undefined.
function scan(s, visit) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else visit(c, i, q); continue; }
    if (c === '\\') { i++; continue; }
    if (q === '"') { if (c === '"') q = null; else { const k = visit(c, i, q); if (k) i += k; } continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    const k = visit(c, i, null);
    if (k) i += k;
  }
}

function splitCommand(command) {
  const s = String(command == null ? '' : command);
  const cuts = []; // [start, end) of separators
  scan(s, (c, i, q) => {
    if (q) return 0;
    const next = s[i + 1];
    const prev = s[i - 1];
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { cuts.push([i, i + 2]); return 1; }
    if (c === '&' && (prev === '>' || next === '>')) return 0; // 2>&1, &> file: a redirection, not a separator
    if (c === ';' || c === '|' || c === '&' || c === '\n') { cuts.push([i, i + 1]); return 0; }
    return 0;
  });
  const out = [];
  let start = 0;
  for (const [a, b] of cuts) { out.push(s.slice(start, a)); start = b; }
  out.push(s.slice(start));
  return out.map((seg) => seg.trim()).filter(Boolean).map(stripEnv).filter(Boolean);
}

function stripEnv(seg) {
  let s = seg;
  if (/^env\s+/.test(s)) s = s.replace(/^env\s+/, '');
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  return s;
}

// Shell-like words: adjacent quoted and unquoted parts join into one word; quotes are removed.
function tokens(seg) {
  const s = String(seg == null ? '' : seg);
  const out = [];
  let cur = null;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null; continue; }
    if (cur === null) cur = '';
    if (c === '\\') { if (i + 1 < s.length) cur += s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    cur += c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

function hasRedirect(seg) {
  let found = false;
  scan(seg, (c, i, q) => { if (!q && c === '>') found = true; });
  return found;
}

// $(...), backticks and <(...) run another command inside this one; treat as unclassifiable.
function hasSubstitution(seg) {
  let found = false;
  scan(seg, (c, i, q) => {
    if (q === "'") return;
    if (c === '`' || (c === '$' && seg[i + 1] === '(') || (!q && c === '<' && seg[i + 1] === '(')) found = true;
  });
  return found;
}

function writesFiles(t) {
  if (t[0] === 'sed') return t.slice(1).some((x) => /^-[a-zA-Z]*i/.test(x) || x.startsWith('--in-place'));
  if (t[0] === 'find') return t.slice(1).some((x) => ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'].includes(x));
  if (t[0] === 'git') return t.some((x, k) => k > 0 && x === '-c'); // -c alias.x=!cmd runs arbitrary commands
  return false;
}

// argv after the command name, without git's global `-C <dir>` / `-c <k=v>` options.
function argvAfterFirst(t) {
  const rest = t.slice(1);
  if (t[0] !== 'git') return rest;
  const out = [];
  for (let k = 0; k < rest.length; k++) {
    if ((rest[k] === '-C' || rest[k] === '-c') && out.length === 0) { k++; continue; }
    out.push(rest[k]);
  }
  return out;
}

function hasFlag(t, f) { return t.some((x) => x === f || x.startsWith(`${f}=`)); }

function effectiveDir(t, ctx) {
  const base = path.resolve(ctx.cwd || process.cwd());
  if (t[0] === 'git') {
    let dir = base;
    for (let k = 1; k < t.length - 1; k++) {
      if (t[k] === '-C') { dir = path.resolve(dir, t[k + 1]); k++; } else if (t[k] === '-c') k++; else break;
    }
    return dir;
  }
  return base;
}

function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

function pluginRootOf(ctx) { return process.env.CLAUDE_PLUGIN_ROOT || ctx.pluginRoot || ''; }

function ruleMatches(rule, t, ctx) {
  if (!rule || typeof rule !== 'object' || !t.length) return false;
  if (rule.first === '*') return true;
  if (t[0] !== rule.first) return false;
  const argv = argvAfterFirst(t);
  if (rule.sub) {
    const ok = rule.sub.some((s) => String(s).split(' ').every((p, k) => argv[k] === p));
    if (!ok) return false;
  }
  if (rule.arg_prefix) {
    const root = pluginRootOf(ctx);
    if (!root || !argv[0]) return false;
    const prefix = String(rule.arg_prefix).replace('${CLAUDE_PLUGIN_ROOT}', root);
    const target = path.resolve(ctx.cwd || process.cwd(), argv[0]);
    const dirPrefix = prefix.endsWith('/') || prefix.endsWith(path.sep);
    if (dirPrefix ? !(under(target, path.resolve(prefix)) && target !== path.resolve(prefix)) : target !== path.resolve(prefix)) return false;
  }
  if (rule.flags_any && !rule.flags_any.some((f) => hasFlag(t, f))) return false;
  if (rule.flags_none && rule.flags_none.some((f) => hasFlag(t, f))) return false;
  if (rule.scope) {
    if (!ctx.roleDir) return false;
    if (!under(effectiveDir(t, ctx), path.join(path.resolve(ctx.roleDir), String(rule.scope)))) return false;
  }
  return true;
}

function classifySegment(seg, groups, ctx) {
  try {
    const c = ctx || {};
    const text = String(seg == null ? '' : seg);
    const t = tokens(text);
    if (!t.length) return [];
    const entries = Object.entries(groups && typeof groups === 'object' ? groups : {});
    const guarded = hasRedirect(text) || hasSubstitution(text) || writesFiles(t);
    const names = [];
    for (const [name, rules] of entries) {
      if (!Array.isArray(rules)) continue;
      // A guarded segment matches only a rule that names its command explicitly; never the `*` wildcard.
      const usable = guarded || GUARDED_FIRST.includes(t[0])
        ? rules.filter((r) => r && r.first === t[0] && (GUARDED_FIRST.includes(t[0]) || !guarded))
        : rules;
      if (usable.some((r) => { try { return ruleMatches(r, t, c); } catch (e) { return false; } })) names.push(name);
    }
    return names;
  } catch (e) {
    return [];
  }
}

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; } else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

function pathAllowed(filePath, { roleDir, writes }) {
  const abs = path.resolve(filePath);
  // Inside the role directory the lane patterns decide, even when the role directory itself sits under tmp.
  if (roleDir && under(abs, path.resolve(roleDir))) {
    const posix = path.relative(path.resolve(roleDir), abs).split(path.sep).join('/');
    return (writes || []).some((w) => globToRegExp(String(w)).test(posix));
  }
  const tmp = [os.tmpdir(), process.env.TMPDIR].filter(Boolean).map((p) => path.resolve(p));
  return tmp.some((t) => under(abs, t));
}

function decideLane({ toolName, toolInput, roleDir, policy, groups, pluginRoot, cwd, hostHeadless, hostName, desktopHosts }) {
  const name = String(toolName || '');
  const pol = policy || { roleId: '', writes: [], bash: [] };
  const bash = pol.bash || [];
  const tail = ` Sanctioned path for ${pol.roleId}: ${sanctioned(pol.roleId)}.`;
  if (REACH_PREFIXES.some((p) => name.startsWith(p))) {
    if (hostHeadless) {
      const where = (desktopHosts || []).length ? `a session on ${desktopHosts.join(' or ')}` : 'a session on a host with a desktop';
      return { allow: false, reason: `Host ${hostName || 'this host'} is headless: browser, desktop-app and computer-use checks cannot run here. Hand the check to ${where} and record it as owner-side in the bead.` };
    }
    return { allow: true };
  }
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') {
    const fp = toolInput && (toolInput.file_path || toolInput.notebook_path);
    if (!fp) return { allow: true };
    const abs = path.resolve(cwd || process.cwd(), fp);
    if (pathAllowed(abs, { roleDir, writes: pol.writes })) return { allow: true };
    const shown = roleDir && under(abs, path.resolve(roleDir)) ? path.relative(path.resolve(roleDir), abs) : abs;
    return { allow: false, reason: `Role ${pol.roleId} does not edit ${shown}.${tail}` };
  }
  if (name === 'Bash') {
    if (bash.includes('any')) return { allow: true };
    let dir = cwd;
    for (const seg of splitCommand(toolInput && toolInput.command)) {
      const names = classifySegment(seg, groups, { roleDir, pluginRoot, cwd: dir });
      if (!names.some((n) => bash.includes(n))) {
        return { allow: false, reason: `Role ${pol.roleId} may not run \`${seg.slice(0, 80)}\` (allowed groups: ${bash.join(', ') || 'none'}).${tail}` };
      }
      // A `cd <dir>` sets the effective directory for the segments that follow it.
      const t = tokens(seg);
      if (t[0] === 'cd' && t[1] && !t[1].startsWith('-')) dir = path.resolve(dir || process.cwd(), t[1]);
    }
    return { allow: true };
  }
  return { allow: true };
}

module.exports = { loadPolicy, splitCommand, classifySegment, pathAllowed, decideLane, sanctioned, tokens };
