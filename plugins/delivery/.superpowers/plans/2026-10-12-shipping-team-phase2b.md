# Shipping Team Phase 2b Implementation Plan: enforcement hooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every role session is held in its lane by hooks: managers cannot edit product files or build, workers cannot touch plans, nobody can leak strategy into the public product repo, and the bead record stays honest (evidence on close, no claim-jumping, a note before a turn ends).

**Architecture:** Three PreToolUse guards and one Stop guard, all thin entry points over tested libraries. `lane.js` reads a policy from the role file's frontmatter (`lane_writes`, `lane_bash`) and a shared command-group table, classifies Bash commands by segment, and decides. `leak.js` scans commit, PR and issue text against `.delivery/team/denylist.txt` and blocks plan paths inside a product worktree. `bd-guard.js` enforces evidence-on-close and live-claim protection. `turn.js` records turn start on UserPromptSubmit and the Stop guard blocks a turn that holds a claim with no fresh note. Every guard is inert without a valid role marker (same `validMarker` as phase 1) and never throws.

**Tech Stack:** Node built-ins, `node --test`, Claude Code hooks (PreToolUse with `permissionDecision`, PostToolUse, Stop with `decision: block`, UserPromptSubmit). Fake `bd` from `scripts/testing/` for tests.

Spec: `plugins/delivery/.superpowers/specs/2026-10-12-shipping-team-design.md` sections 8.1, 8.2, 8.3 (as amended 2026-10-12), 11, 12 phase 2, 13.

## Global Constraints

- Plain Node, no dependencies, tests with `node --test 'plugins/delivery/scripts/**/*.test.js' plugins/delivery/hooks/scripts/*.test.js`. Paths relative to `plugins/delivery/` unless they start with `plugins/`.
- Hook entry points wrap everything in one try/catch and exit 0. A guard that cannot decide (no marker, manifest unreadable, bd unreachable) allows the call and prints nothing. Denials are the only output.
- Claude Code hook contracts (documented): PreToolUse stdin JSON has `session_id`, `cwd`, `tool_name`, `tool_input` (Write/Edit/NotebookEdit: `file_path`; Bash: `command`); a denial is stdout JSON `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}` with exit 0. Stop stdin has `session_id`, `cwd`, `stop_hook_active`; a block is stdout JSON `{"decision":"block","reason":"<reason>"}` with exit 0, and the guard must allow when `stop_hook_active` is true (to avoid a loop). PostToolUse stdin adds `tool_response`. Hooks never print raw `tool_input` or secrets.
- A valid role marker is required for any guard to act: `process.env.DELIVERY_ROLE === marker.instance`, absolute `project_root`, manifest loads, instance in manifest (reuse phase 1's `validMarker`; export it from `role-context.js`).
- Role directory layout from phase 1: `<roleDir>/project/` (project clone), `<roleDir>/product/` (product worktree, builders only), `<roleDir>/scratch/` (created on demand). Paths in `lane_writes` are relative to `roleDir`; `$TMPDIR` and `os.tmpdir()` are always writable.
- Every refusal reason ends with the sanctioned path for that role (the table in Task 1).
- Plugin version bumps 0.18.0 to 0.19.0 in the last task. Branch `delivery-shipping-team-2b` (already cut from 2a). Commit after every task with a `Co-Authored-By` trailer naming the model that ran.

## File map

| File | Responsibility |
|---|---|
| `hooks/lane-groups.json` | Named Bash command groups → matcher rules |
| `hooks/scripts/lane.js` (+ `.test.js`) | `loadPolicy`, `splitCommand`, `classifySegment`, `pathAllowed`, `decideLane` |
| `hooks/scripts/role-lane.js` | PreToolUse entry: Write/Edit/NotebookEdit/Bash and browser/computer tools |
| `hooks/scripts/leak.js` (+ `.test.js`) | `loadDenylist`, `extractMessages`, `scanText`, `decideLeak`, `scanPushed` |
| `hooks/scripts/leak-guard.js`, `hooks/scripts/leak-post-push.js` | PreToolUse and PostToolUse entries |
| `hooks/scripts/bd-guard.js` (+ `.test.js`) | `parseBd`, `decideBd` (evidence on close, live claim) |
| `hooks/scripts/bd-guard-hook.js` | PreToolUse entry for Bash `bd ...` |
| `hooks/scripts/turn.js` (+ `.test.js`) | `markTurnStart`, `decideStop` |
| `hooks/scripts/claim-stop.js` | Stop entry |
| `hooks/scripts/role-prompt-submit.js` | gains `markTurnStart` |
| `hooks/scripts/role-context.js` | exports `validMarker` |
| `roles/*.md` | `lane_writes` / `lane_bash` frontmatter and one lane sentence each |
| `hooks/hooks.json`, `README.md`, `.claude-plugin/plugin.json`, root `.claude-plugin/marketplace.json` | wiring, docs, version |

---

### Task 1: Lane policy library

**Files:**
- Create: `hooks/lane-groups.json`, `hooks/scripts/lane.js`
- Modify: `hooks/scripts/role-context.js` (export `validMarker`), `roles/chief-of-staff.md`, `roles/staffing.md`, `roles/product-manager.md`, `roles/delivery-lead.md`, `roles/progress-observer.md`, `roles/builder.md`, `roles/spike-researcher.md`
- Test: `hooks/scripts/lane.test.js`

**Interfaces:**
- `loadPolicy({ pluginRoot, projectRoot, briefRef }): { writes: string[], bash: string[], roleId }` — reads the role file via `loadRoleBrief` and the frontmatter keys `lane_writes` and `lane_bash` (comma lists via `listValue` from `scripts/lib/plan-docs.js`); missing keys give `[]`.
- `splitCommand(command: string): string[]` — splits on `&&`, `||`, `;`, `|` outside single and double quotes; trims; drops empty segments; strips a leading `env VAR=... ` and leading `VAR=value ` assignments.
- `classifySegment(segment: string, groups): string[]` — the names of every group whose rules match; a rule is `{ "first": "<argv0>", "sub": ["<argv1> alternatives"] , "flags_any": [...], "flags_none": [...] }`; `first` may be `"node"` with `"arg_prefix": "${CLAUDE_PLUGIN_ROOT}/scripts/"` meaning the first argument after `node` must start with the plugin root path (resolved from `process.env.CLAUDE_PLUGIN_ROOT` or the pluginRoot passed in). Shell builtins `cd`, `export`, `true`, `pwd`, `echo` (without redirection) are in `read`. A segment containing an output redirection (`>` or `>>` outside quotes) or `sudo`, `rm`, `mv`, `cp` that is not inside a group that lists them is classified `[]`.
- `pathAllowed(filePath: string, { roleDir, writes }): boolean` — resolve `filePath` (relative to `cwd` is the hook's job; this gets an absolute path); true when under `os.tmpdir()` or `process.env.TMPDIR`, or when it matches any pattern in `writes` joined under `roleDir`; patterns support `**` (any depth) and `*` (one segment); a pattern without a glob matches exactly that file.
- `decideLane({ toolName, toolInput, roleDir, policy, groups, pluginRoot, hostHeadless }): { allow: true } | { allow: false, reason: string }` — Write/Edit/NotebookEdit: `pathAllowed`; Bash: every segment must classify into at least one group in `policy.bash`, or `policy.bash` includes `any`; tools whose name starts with `mcp__Claude_Browser__`, `mcp__claude-in-chrome__`, `mcp__computer-use__`, or `mcp__Claude_Code_iOS_Simulator__`: denied when `hostHeadless`. Reasons use the sanctioned-path table below.

Sanctioned paths (appended to every reason):

| Role | Sanctioned path |
|---|---|
| chief-of-staff | "route it: create a child bead for the right role (`bd create --parent <id> ...`) and message that session" |
| staffing | "only team.json and briefs are yours; anything else goes to the Delivery Lead" |
| product-manager | "product documents are yours; building goes to a builder bead, plan structure to the Delivery Lead" |
| delivery-lead | "stories, sprints and bead structure are yours; building goes to a builder bead" |
| progress-observer | "record evidence in reviews and beads; fixes go to a builder bead" |
| builder | "product code in your worktree is yours; plans belong to the Delivery Lead" |
| spike-researcher | "answers go in the bead and the ADR or roadmap; product code is never yours" |
| other | "stay in your lane; ask the Delivery Lead" |

- [ ] **Step 1: Write `hooks/lane-groups.json`**

```json
{
  "read": [
    { "first": "ls" }, { "first": "cat" }, { "first": "head" }, { "first": "tail" }, { "first": "grep" }, { "first": "rg" },
    { "first": "find" }, { "first": "wc" }, { "first": "diff" }, { "first": "jq" }, { "first": "sort" }, { "first": "uniq" },
    { "first": "cut" }, { "first": "tr" }, { "first": "pwd" }, { "first": "echo" }, { "first": "date" }, { "first": "which" },
    { "first": "test" }, { "first": "true" }, { "first": "cd" }, { "first": "export" }, { "first": "printf" }, { "first": "basename" },
    { "first": "dirname" }, { "first": "realpath" }, { "first": "stat" }, { "first": "file" }, { "first": "tree" }, { "first": "sed", "flags_none": ["-i"] },
    { "first": "awk" }, { "first": "node", "arg_prefix": "${CLAUDE_PLUGIN_ROOT}/scripts/" }, { "first": "node", "flags_any": ["--test"] }
  ],
  "git-read": [
    { "first": "git", "sub": ["status", "log", "diff", "show", "branch", "rev-parse", "fetch", "remote", "ls-files", "blame", "describe", "tag", "stash list", "worktree list", "merge-base", "shortlog", "cat-file", "rev-list"] }
  ],
  "git-write-project": [
    { "first": "git", "sub": ["add", "commit", "push", "pull", "checkout", "switch", "restore", "stash", "merge", "rebase", "cherry-pick", "reset", "worktree"], "scope": "project" }
  ],
  "git-write-product": [
    { "first": "git", "sub": ["add", "commit", "push", "pull", "checkout", "switch", "restore", "stash", "merge", "rebase", "cherry-pick", "reset", "worktree"], "scope": "product" }
  ],
  "gh-read": [
    { "first": "gh", "sub": ["pr view", "pr list", "pr checks", "pr diff", "pr status", "issue view", "issue list", "run view", "run list", "run watch", "repo view", "release list", "release view"] }
  ],
  "gh-write": [
    { "first": "gh", "sub": ["pr create", "pr edit", "pr comment", "pr merge", "pr ready", "pr review", "issue comment", "release create", "workflow run"] }
  ],
  "bd-read": [
    { "first": "bd", "sub": ["list", "show", "ready", "prime", "where", "dep list", "dep tree", "dep cycles", "label list", "label list-all", "stats", "help", "comments list"] }
  ],
  "bd-notes": [
    { "first": "bd", "sub": ["update"], "flags_any": ["--append-notes", "--notes"], "flags_none": ["--parent", "--claim", "--status", "--assignee", "--title", "--type", "--priority", "--add-label", "--remove-label", "--metadata", "--description", "--design", "--acceptance"] },
    { "first": "bd", "sub": ["comments add", "comment add"] }
  ],
  "bd-claim": [
    { "first": "bd", "sub": ["update"], "flags_any": ["--claim"] },
    { "first": "bd", "sub": ["update"], "flags_any": ["--status", "--assignee"], "flags_none": ["--parent", "--title", "--type"] },
    { "first": "bd", "sub": ["close"] }
  ],
  "bd-create-child": [
    { "first": "bd", "sub": ["create"], "flags_any": ["--parent"], "flags_none": ["--id"] }
  ],
  "bd-structure": [
    { "first": "bd", "sub": ["create", "dep add", "dep remove", "dep relate", "dep unrelate", "label add", "label remove", "label propagate", "delete", "update"] },
    { "first": "node", "arg_prefix": "${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js" }
  ],
  "any": [ { "first": "*" } ]
}
```

Scope semantics: a rule with `"scope": "project"` matches only when the segment's effective directory (an explicit `-C <dir>` or a leading `cd <dir> &&` in the same command, else the hook's `cwd`) is under `<roleDir>/project`; `"scope": "product"` likewise under `<roleDir>/product`. `sub` entries with two words match argv1 and argv2 (`dep add`); flags are matched as whole tokens anywhere in the segment.

- [ ] **Step 2: Add the frontmatter to every role file.** Insert these two lines into each role's frontmatter block (before the closing `---`), exactly:

| Role file | `lane_writes` | `lane_bash` |
|---|---|---|
| chief-of-staff.md | (omit the key) | `read, git-read, gh-read, bd-read, bd-notes, bd-create-child` |
| staffing.md | `project/.delivery/team/team.json, project/.delivery/team/briefs/**` | `read, git-read, git-write-project, bd-read, bd-notes` |
| product-manager.md | `project/.delivery/initiatives/**, project/.delivery/personas/**, project/.delivery/interviews/**, project/.delivery/simulations/**, project/.delivery/decisions/**, project/.delivery/glossary.md` | `read, git-read, git-write-project, bd-read, bd-notes, bd-create-child` |
| delivery-lead.md | `project/.delivery/stories/**, project/.delivery/sprints/**, project/.delivery/team/denylist.txt` | `read, git-read, git-write-project, gh-read, bd-read, bd-notes, bd-create-child, bd-structure` |
| progress-observer.md | `project/.delivery/reviews/**` | `read, git-read, gh-read, bd-read, bd-notes, bd-claim` |
| builder.md | `product/**, scratch/**` | `any` |
| spike-researcher.md | `project/.delivery/initiatives/**, project/.delivery/decisions/**, scratch/**` | `any` |

Also append one sentence to each role's `## As a session` section: `Your lane is enforced by a hook: writes outside your lane and commands outside your groups are refused with the sanctioned path; a refusal is a signal to delegate, not to find another way.`

- [ ] **Step 3: Export `validMarker`** from `hooks/scripts/role-context.js` (add it to `module.exports`).

- [ ] **Step 4: Write the failing tests**

```js
// hooks/scripts/lane.test.js — run with: node --test hooks/scripts/lane.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPolicy, splitCommand, classifySegment, pathAllowed, decideLane } = require('./lane.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const GROUPS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lane-groups.json'), 'utf8'));
const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-'));
const ctx = (over) => ({ roleDir, groups: GROUPS, pluginRoot: PLUGIN_ROOT, hostHeadless: false, ...over });

test('loadPolicy reads lane keys from a delivery role file', () => {
  const p = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/chief-of-staff' });
  assert.deepEqual(p.writes, []);
  assert.ok(p.bash.includes('bd-notes'));
  assert.ok(!p.bash.includes('any'));
  const b = loadPolicy({ pluginRoot: PLUGIN_ROOT, projectRoot: '/nonexistent', briefRef: 'delivery/builder' });
  assert.deepEqual(b.writes, ['product/**', 'scratch/**']);
  assert.deepEqual(b.bash, ['any']);
});

test('splitCommand splits on operators outside quotes and strips env assignments', () => {
  assert.deepEqual(splitCommand('git status && bd list --json | jq ".[0]"'), ['git status', 'bd list --json', 'jq ".[0]"']);
  assert.deepEqual(splitCommand('echo "a && b"; ls'), ['echo "a && b"', 'ls']);
  assert.deepEqual(splitCommand('FOO=1 bd prime'), ['bd prime']);
  assert.deepEqual(splitCommand('env FOO=1 bd prime'), ['bd prime']);
});

test('classifySegment matches groups by first token, subcommand and flags', () => {
  assert.ok(classifySegment('git log --oneline -3', GROUPS, ctx()).includes('git-read'));
  assert.ok(classifySegment('bd update ex-1 --append-notes "x"', GROUPS, ctx()).includes('bd-notes'));
  assert.ok(!classifySegment('bd update ex-1 --append-notes "x" --parent ex-2', GROUPS, ctx()).includes('bd-notes'));
  assert.ok(classifySegment('bd update ex-1 --parent ex-2', GROUPS, ctx()).includes('bd-structure'));
  assert.ok(classifySegment('bd create "t" --parent ex-1', GROUPS, ctx()).includes('bd-create-child'));
  assert.ok(!classifySegment('bd create "t" --parent ex-1 --id ex-9', GROUPS, ctx()).includes('bd-create-child'));
  assert.ok(classifySegment('bd dep add ex-1 --blocked-by ex-2', GROUPS, ctx()).includes('bd-structure'));
  assert.deepEqual(classifySegment('rm -rf /tmp/x', GROUPS, ctx()), []);
  assert.deepEqual(classifySegment('cat a > b', GROUPS, ctx()), []);
  assert.deepEqual(classifySegment('sed -i s/a/b/ f', GROUPS, ctx()), []);
  assert.ok(classifySegment(`node ${PLUGIN_ROOT}/scripts/team-status.js`, GROUPS, ctx()).includes('read'));
  assert.ok(classifySegment('node --test x.test.js', GROUPS, ctx()).includes('read'));
  assert.ok(classifySegment('anything at all', GROUPS, ctx()).includes('any'));
});

test('classifySegment scopes git writes by directory', () => {
  const cwdProject = path.join(roleDir, 'project');
  const cwdProduct = path.join(roleDir, 'product');
  assert.ok(classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProject })).includes('git-write-project'));
  assert.ok(!classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProject })).includes('git-write-product'));
  assert.ok(classifySegment('git commit -m x', GROUPS, ctx({ cwd: cwdProduct })).includes('git-write-product'));
  assert.ok(classifySegment(`git -C ${cwdProduct} push`, GROUPS, ctx({ cwd: cwdProject })).includes('git-write-product'));
});

test('pathAllowed honours globs, exact files and tmp', () => {
  const writes = ['project/.delivery/stories/**', 'project/.delivery/team/denylist.txt', 'scratch/**'];
  assert.ok(pathAllowed(path.join(roleDir, 'project', '.delivery', 'stories', 'a', 'b.md'), { roleDir, writes }));
  assert.ok(pathAllowed(path.join(roleDir, 'project', '.delivery', 'team', 'denylist.txt'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'project', '.delivery', 'team', 'team.json'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'product', 'src', 'x.js'), { roleDir, writes }));
  assert.ok(pathAllowed(path.join(os.tmpdir(), 'x'), { roleDir, writes }));
  assert.ok(!pathAllowed(path.join(roleDir, 'project', '.delivery', 'stories'), { roleDir, writes: ['project/.delivery/stories/*.md'] }));
});

test('decideLane refuses with the sanctioned path and allows within lane', () => {
  const policy = { roleId: 'chief-of-staff', writes: [], bash: ['read', 'git-read', 'gh-read', 'bd-read', 'bd-notes', 'bd-create-child'] };
  const d1 = decideLane({ toolName: 'Edit', toolInput: { file_path: path.join(roleDir, 'product', 'a.js') }, policy, ...ctx() });
  assert.equal(d1.allow, false);
  assert.match(d1.reason, /chief-of-staff/);
  assert.match(d1.reason, /create a child bead/);
  const d2 = decideLane({ toolName: 'Bash', toolInput: { command: 'git status && bd list --json' }, policy, ...ctx() });
  assert.equal(d2.allow, true);
  const d3 = decideLane({ toolName: 'Bash', toolInput: { command: 'bd list && npm test' }, policy, ...ctx() });
  assert.equal(d3.allow, false);
  assert.match(d3.reason, /npm test/);
  const builder = { roleId: 'builder', writes: ['product/**', 'scratch/**'], bash: ['any'] };
  assert.equal(decideLane({ toolName: 'Bash', toolInput: { command: 'npm test' }, policy: builder, ...ctx() }).allow, true);
  assert.equal(decideLane({ toolName: 'Write', toolInput: { file_path: path.join(roleDir, 'project', '.delivery', 'stories', 'x.md') }, policy: builder, ...ctx() }).allow, false);
});

test('decideLane denies browser and computer tools on a headless host', () => {
  const policy = { roleId: 'progress-observer', writes: [], bash: ['read'] };
  const d = decideLane({ toolName: 'mcp__Claude_Browser__navigate', toolInput: {}, policy, ...ctx({ hostHeadless: true, hostName: 'wintermute', desktopHosts: ['alien51'] }) });
  assert.equal(d.allow, false);
  assert.match(d.reason, /alien51/);
  assert.equal(decideLane({ toolName: 'mcp__Claude_Browser__navigate', toolInput: {}, policy, ...ctx() }).allow, true);
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `node --test plugins/delivery/hooks/scripts/lane.test.js`
Expected: FAIL with "Cannot find module './lane.js'"

- [ ] **Step 6: Write `hooks/scripts/lane.js`**

```js
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

function sanctioned(roleId) { return SANCTIONED[roleId] || 'stay in your lane; ask the Delivery Lead'; }

function loadPolicy({ pluginRoot, projectRoot, briefRef }) {
  const { meta } = loadRoleBrief(pluginRoot, projectRoot, briefRef);
  return { roleId: String(meta.id || ''), writes: listValue(meta.lane_writes), bash: listValue(meta.lane_bash) };
}

function splitCommand(command) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { out.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '\n') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((seg) => seg.trim()).filter(Boolean).map(stripEnv);
}

function stripEnv(seg) {
  let s = seg;
  if (/^env\s+/.test(s)) s = s.replace(/^env\s+/, '');
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  return s;
}

function tokens(seg) {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function hasRedirect(seg) {
  let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>' ) return true;
  }
  return false;
}

function effectiveDir(seg, ctx) {
  const t = tokens(seg);
  const i = t.indexOf('-C');
  if (t[0] === 'git' && i > 0 && t[i + 1]) return path.resolve(ctx.cwd || process.cwd(), t[i + 1]);
  return path.resolve(ctx.cwd || process.cwd());
}

function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }

function pluginRootOf(ctx) { return process.env.CLAUDE_PLUGIN_ROOT || ctx.pluginRoot || ''; }

function ruleMatches(rule, seg, ctx) {
  const t = tokens(seg);
  if (!t.length) return false;
  if (rule.first === '*') return true;
  if (t[0] !== rule.first) return false;
  if (rule.sub) {
    const ok = rule.sub.some((s) => { const parts = s.split(' '); return parts.every((p, k) => t[k + 1] === p); });
    if (!ok) return false;
  }
  if (rule.arg_prefix) {
    const prefix = rule.arg_prefix.replace('${CLAUDE_PLUGIN_ROOT}', pluginRootOf(ctx));
    if (!t[1] || !path.resolve(t[1]).startsWith(path.resolve(prefix))) return false;
  }
  if (rule.flags_any && !rule.flags_any.some((f) => t.includes(f))) return false;
  if (rule.flags_none && rule.flags_none.some((f) => t.includes(f))) return false;
  if (rule.scope) {
    const dir = effectiveDir(seg, ctx);
    const base = path.join(ctx.roleDir, rule.scope);
    if (!under(dir, base)) return false;
  }
  return true;
}

function classifySegment(seg, groups, ctx) {
  const t = tokens(seg);
  if (!t.length) return [];
  const names = [];
  for (const [name, rules] of Object.entries(groups)) {
    if (name !== 'any' && hasRedirect(seg)) continue;
    if (name !== 'any' && ['rm', 'mv', 'cp', 'sudo', 'chmod', 'chown', 'curl', 'wget'].includes(t[0])) continue;
    if (rules.some((r) => ruleMatches(r, seg, ctx))) names.push(name);
  }
  return names;
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
  const tmp = [os.tmpdir(), process.env.TMPDIR].filter(Boolean).map((p) => path.resolve(p));
  if (tmp.some((t) => under(abs, t))) return true;
  const rel = path.relative(path.resolve(roleDir), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const posix = rel.split(path.sep).join('/');
  return (writes || []).some((w) => globToRegExp(w).test(posix));
}

function decideLane({ toolName, toolInput, roleDir, policy, groups, pluginRoot, cwd, hostHeadless, hostName, desktopHosts }) {
  const ctx = { roleDir, pluginRoot, cwd };
  const tail = ` Sanctioned path for ${policy.roleId}: ${sanctioned(policy.roleId)}.`;
  if (REACH_PREFIXES.some((p) => toolName.startsWith(p))) {
    if (hostHeadless) {
      const where = (desktopHosts || []).length ? `a session on ${desktopHosts.join(' or ')}` : 'a session on a host with a desktop';
      return { allow: false, reason: `Host ${hostName || 'this host'} is headless: browser, desktop-app and computer-use checks cannot run here. Hand the check to ${where} and record it as owner-side in the bead.` };
    }
    return { allow: true };
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    const fp = toolInput && (toolInput.file_path || toolInput.notebook_path);
    if (!fp) return { allow: true };
    const abs = path.resolve(cwd || process.cwd(), fp);
    if (pathAllowed(abs, { roleDir, writes: policy.writes })) return { allow: true };
    return { allow: false, reason: `Role ${policy.roleId} does not edit ${path.relative(roleDir, abs) || abs}.${tail}` };
  }
  if (toolName === 'Bash') {
    if ((policy.bash || []).includes('any')) return { allow: true };
    const segs = splitCommand(toolInput && toolInput.command);
    for (const seg of segs) {
      const names = classifySegment(seg, groups, ctx);
      if (!names.some((n) => policy.bash.includes(n))) {
        return { allow: false, reason: `Role ${policy.roleId} may not run \`${seg.slice(0, 80)}\` (allowed groups: ${policy.bash.join(', ') || 'none'}).${tail}` };
      }
    }
    return { allow: true };
  }
  return { allow: true };
}

module.exports = { loadPolicy, splitCommand, classifySegment, pathAllowed, decideLane, sanctioned, tokens };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test plugins/delivery/hooks/scripts/lane.test.js`
Expected: 7 tests PASS. Also run `node --test plugins/delivery/hooks/scripts/role-context.test.js` (role files changed) → PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/delivery/hooks/lane-groups.json plugins/delivery/hooks/scripts/lane.js plugins/delivery/hooks/scripts/lane.test.js plugins/delivery/hooks/scripts/role-context.js plugins/delivery/roles
git commit -m "delivery: lane policy library, command groups, per-role lane frontmatter"
```

---

### Task 2: The role-lane PreToolUse hook

**Files:**
- Create: `hooks/scripts/role-lane.js`
- Modify: `hooks/scripts/lane.js` (add `laneDecisionForHook`), `hooks/scripts/lane.test.js` (subprocess tests)

**Interfaces:**
- `laneDecisionForHook(input, pluginRoot): null | { reason }` — `findRoleMarker(input.cwd)` → `validMarker` → load manifest, role, policy (`briefRef` from the manifest role), host from `hosts.json` (`headless`), desktop hosts = hosts with `desktop_apps: true`; `decideLane(...)`; returns `null` when allowed or when anything cannot be resolved; on deny appends a line to `<roleDir>/.delivery-lane.log` (`<iso> <tool> <first 120 chars of path or command> DENIED`) and returns `{ reason }`.
- Entry `role-lane.js`: reads stdin, calls it, on a reason prints the PreToolUse deny JSON; always exit 0.

- [ ] **Step 1: Add subprocess tests** to `lane.test.js`:

```js
const { execFileSync } = require('child_process');
const { prepareRole } = require('../../scripts/prepare-role.js');

function preparedRole(instance) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: projectRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: projectRoot });
  fs.mkdirSync(path.join(projectRoot, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'team.json'), path.join(projectRoot, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'hosts.json'), path.join(projectRoot, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: projectRoot });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: projectRoot });
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

function runHook(script, input, env) {
  return execFileSync(process.execPath, [path.join(__dirname, script)], { input: JSON.stringify(input), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

test('role-lane hook denies an out-of-lane edit for chief-of-staff and allows for builder', () => {
  const { roleDir } = preparedRole('chief-of-staff');
  const out = runHook('role-lane.js', { cwd: roleDir, session_id: 's', tool_name: 'Edit', tool_input: { file_path: path.join(roleDir, 'product', 'a.js') } }, { DELIVERY_ROLE: 'chief-of-staff', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const json = JSON.parse(out);
  assert.equal(json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(json.hookSpecificOutput.permissionDecisionReason, /chief-of-staff/);
  assert.ok(fs.readFileSync(path.join(roleDir, '.delivery-lane.log'), 'utf8').includes('DENIED'));
  const b = preparedRole('builder-1');
  const out2 = runHook('role-lane.js', { cwd: b.roleDir, session_id: 's', tool_name: 'Edit', tool_input: { file_path: path.join(b.roleDir, 'product', 'a.js') } }, { DELIVERY_ROLE: 'builder-1', CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  assert.equal(out2, '');
});

test('role-lane hook is inert without a role, with a mismatched DELIVERY_ROLE, and on garbage stdin', () => {
  assert.equal(runHook('role-lane.js', { cwd: os.tmpdir(), tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, {}), '');
  const { roleDir } = preparedRole('staffing');
  assert.equal(runHook('role-lane.js', { cwd: roleDir, tool_name: 'Bash', tool_input: { command: 'npm test' } }, { DELIVERY_ROLE: 'other' }), '');
  const raw = execFileSync(process.execPath, [path.join(__dirname, 'role-lane.js')], { input: 'not json', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  assert.equal(raw, '');
});
```

- [ ] **Step 2: Implement `laneDecisionForHook` in `lane.js`**

```js
function laneDecisionForHook(input, pluginRoot) {
  const { findRoleMarker, validMarker } = require('./role-context.js');
  const { loadManifest, expandInstances } = require('../../scripts/lib/manifest.js');
  const found = findRoleMarker(input.cwd);
  if (!found || !validMarker(found)) return null;
  const { marker, markerFile } = found;
  const roleDir = path.dirname(markerFile);
  const { team, hosts } = loadManifest(marker.project_root);
  const inst = expandInstances(team).find((i) => i.instance === marker.instance);
  if (!inst) return null;
  const policy = loadPolicy({ pluginRoot, projectRoot: marker.project_root, briefRef: inst.role.brief });
  const host = (hosts.hosts || {})[inst.role.host] || {};
  const desktopHosts = Object.entries(hosts.hosts || {}).filter(([, h]) => h.desktop_apps).map(([n]) => n);
  const groups = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'lane-groups.json'), 'utf8'));
  const d = decideLane({ toolName: input.tool_name, toolInput: input.tool_input || {}, roleDir, policy, groups, pluginRoot, cwd: input.cwd, hostHeadless: !!host.headless, hostName: inst.role.host, desktopHosts });
  if (d.allow) return null;
  try {
    const what = input.tool_name === 'Bash' ? String((input.tool_input || {}).command || '') : String((input.tool_input || {}).file_path || '');
    fs.appendFileSync(path.join(roleDir, '.delivery-lane.log'), `${new Date().toISOString()} ${input.tool_name} ${what.slice(0, 120)} DENIED\n`);
  } catch (err) { /* logging must not block */ }
  return { reason: d.reason };
}
```

Add `laneDecisionForHook` to the exports.

- [ ] **Step 3: Write `hooks/scripts/role-lane.js`**

```js
#!/usr/bin/env node
// PreToolUse: keep the role in its lane. Prints a deny decision or nothing. Never exits non-zero.
const path = require('path');
try {
  const { readHookInput } = require('./role-context.js');
  const { laneDecisionForHook } = require('./lane.js');
  const input = readHookInput();
  const d = input && input.tool_name ? laneDecisionForHook(input, path.join(__dirname, '..', '..')) : null;
  if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
} catch (err) {
  // allow on any failure
}
process.exit(0);
```

- [ ] **Step 4: Run the tests** `node --test plugins/delivery/hooks/scripts/lane.test.js` → 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/hooks/scripts/lane.js plugins/delivery/hooks/scripts/lane.test.js plugins/delivery/hooks/scripts/role-lane.js
git commit -m "delivery: role-lane PreToolUse hook"
```

---

### Task 3: Leak guard for the product repo

**Files:**
- Create: `hooks/scripts/leak.js`, `hooks/scripts/leak-guard.js`, `hooks/scripts/leak-post-push.js`
- Test: `hooks/scripts/leak.test.js`

**Interfaces:**
- `loadDenylist(projectRoot): string[]` — lines of `.delivery/team/denylist.txt`, trimmed, non-empty; `[]` when missing.
- `inProductWorktree(cwd, roleDir): boolean` — `cwd` under `<roleDir>/product`.
- `extractMessages(command: string): string[]` — for each segment of `splitCommand`: `git commit` → values of `-m`/`--message` (repeatable) and `-F`/`--file` contents are NOT read (report the flag as a message `"<file: name>"`); `gh pr create|edit|comment` and `gh issue comment` → values of `--title`, `--body`, `-t`, `-b`, `--body-file` (as `<file: name>`); tokens via `tokens` from `lane.js`.
- `scanText(text, denylist): { phrase: string } | null` — case-insensitive literal (not regex) containment of any denylist phrase; also matches `.delivery/` anywhere in the text; returns the first hit.
- `decideLeak({ toolName, toolInput, cwd, roleDir, denylist }): null | { reason }` — only when `inProductWorktree`: Bash `gh issue create` → deny ("issues in the product repo are for users; record internal work in beads"); Bash with messages → scan each; a `<file: ...>` message is denied ("commit and PR text must be inline so it can be checked"); Write/Edit/NotebookEdit whose path (resolved from cwd) contains a segment `.delivery` or `.beads` or ends with `team.json` → deny. Reasons name the matched phrase and say `Only Refs <bead id> is allowed; describe the change to the product.`
- `scanPushed({ cwd, roleDir, denylist, git }): string[]` — when `inProductWorktree` and the command was a `git push`: run `git log @{upstream}..HEAD --format=%B` (if no upstream, `git log -n 20 --format=%B`); return matched phrases. `git` is injectable for tests (`(args) => string`).
- Entries: `leak-guard.js` (PreToolUse; deny JSON) and `leak-post-push.js` (PostToolUse on Bash; if the command was a `git push` and `scanPushed` finds hits, print a line `Strategy leak suspected in pushed commits: <phrase>. Create a strategy review bead: bd create "Strategy leak: <phrase>" --labels strategy-review` so the model acts; never calls bd itself).

- [ ] **Step 1: Write the failing tests**

```js
// hooks/scripts/leak.test.js — run with: node --test hooks/scripts/leak.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDenylist, inProductWorktree, extractMessages, scanText, decideLeak, scanPushed } = require('./leak.js');

const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
const product = path.join(roleDir, 'product');
fs.mkdirSync(product, { recursive: true });
const denylist = ['Sell duplicates faster', 'Casual Carl', 'Phase 2: Beads over Dolt'];

test('loadDenylist reads lines and tolerates a missing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  assert.deepEqual(loadDenylist(root), []);
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'denylist.txt'), 'A b c\n\n D e f \n');
  assert.deepEqual(loadDenylist(root), ['A b c', 'D e f']);
});

test('extractMessages pulls commit and PR text', () => {
  assert.deepEqual(extractMessages('git commit -m "fix login" -m "Refs ex-1"'), ['fix login', 'Refs ex-1']);
  assert.deepEqual(extractMessages('gh pr create --title "Login fix" --body "Refs ex-1"'), ['Login fix', 'Refs ex-1']);
  assert.deepEqual(extractMessages('git commit -F msg.txt'), ['<file: msg.txt>']);
  assert.deepEqual(extractMessages('git status'), []);
});

test('scanText is a case-insensitive literal match and catches .delivery paths', () => {
  assert.deepEqual(scanText('we sell DUPLICATES faster now', denylist), { phrase: 'Sell duplicates faster' });
  assert.equal(scanText('fix login (Refs ex-1)', denylist), null);
  assert.deepEqual(scanText('see .delivery/stories/x.md', denylist), { phrase: '.delivery/' });
  assert.equal(scanText('phase 2: beads over dolt', ['Phase 2: Beads over Dolt']).phrase, 'Phase 2: Beads over Dolt');
});

test('decideLeak acts only in the product worktree', () => {
  const bad = { toolName: 'Bash', toolInput: { command: 'git commit -m "Sell duplicates faster"' }, roleDir, denylist };
  assert.equal(decideLeak({ ...bad, cwd: path.join(roleDir, 'project') }), null);
  const d = decideLeak({ ...bad, cwd: product });
  assert.match(d.reason, /Sell duplicates faster/);
  assert.match(d.reason, /Refs <bead id>/);
  assert.equal(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -m "fix login" -m "Refs ex-1"' }, cwd: product, roleDir, denylist }), null);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'gh issue create --title x' }, cwd: product, roleDir, denylist }).reason, /for users/);
  assert.match(decideLeak({ toolName: 'Bash', toolInput: { command: 'git commit -F m.txt' }, cwd: product, roleDir, denylist }).reason, /inline/);
  assert.match(decideLeak({ toolName: 'Write', toolInput: { file_path: '.delivery/team/team.json' }, cwd: product, roleDir, denylist }).reason, /\.delivery/);
  assert.equal(decideLeak({ toolName: 'Write', toolInput: { file_path: 'src/a.js' }, cwd: product, roleDir, denylist }), null);
});

test('scanPushed scans the pushed range', () => {
  const git = (args) => (args.includes('@{upstream}..HEAD') ? 'fix login\n\nRefs ex-1\n\nCasual Carl wants this\n' : '');
  assert.deepEqual(scanPushed({ cwd: product, roleDir, denylist, git }), ['Casual Carl']);
  assert.deepEqual(scanPushed({ cwd: path.join(roleDir, 'project'), roleDir, denylist, git }), []);
});
```

- [ ] **Step 2: Run them to verify they fail** → "Cannot find module './leak.js'"

- [ ] **Step 3: Write `hooks/scripts/leak.js`**

```js
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

function under(dir, parent) { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
function inProductWorktree(cwd, roleDir) { return under(path.resolve(cwd || ''), path.join(path.resolve(roleDir), 'product')); }

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
      if (!flags[name]) continue;
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
```

- [ ] **Step 4: Write the two entry points**

`hooks/scripts/leak-guard.js`:

```js
#!/usr/bin/env node
// PreToolUse: no plan text or files reach the product repo. Deny JSON or nothing; exit 0 always.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, decideLeak } = require('./leak.js');
  const input = readHookInput();
  const found = input && input.tool_name ? findRoleMarker(input.cwd) : null;
  if (found && validMarker(found)) {
    const roleDir = path.dirname(found.markerFile);
    const d = decideLeak({ toolName: input.tool_name, toolInput: input.tool_input || {}, cwd: input.cwd, roleDir, denylist: loadDenylist(found.marker.project_root) });
    if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
  }
} catch (err) { /* allow */ }
process.exit(0);
```

`hooks/scripts/leak-post-push.js`:

```js
#!/usr/bin/env node
// PostToolUse on Bash: after a git push from a product worktree, re-scan the pushed messages.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker } = require('./role-context.js');
  const { loadDenylist, scanPushed } = require('./leak.js');
  const { splitCommand, tokens } = require('./lane.js');
  const input = readHookInput();
  const cmd = input && input.tool_name === 'Bash' ? String((input.tool_input || {}).command || '') : '';
  const pushed = splitCommand(cmd).some((s) => { const t = tokens(s); return t[0] === 'git' && t.includes('push'); });
  const found = pushed ? findRoleMarker(input.cwd) : null;
  if (found && validMarker(found)) {
    const hits = scanPushed({ cwd: input.cwd, roleDir: path.dirname(found.markerFile), denylist: loadDenylist(found.marker.project_root) });
    if (hits.length) process.stdout.write(`Strategy leak suspected in pushed commits: "${hits[0]}". Create a strategy review bead now: bd create "Strategy leak: ${hits[0]}" --labels strategy-review, and tell the Delivery Lead.\n`);
  }
} catch (err) { /* observe only */ }
process.exit(0);
```

- [ ] **Step 5: Run the tests** → 5 PASS. Add one subprocess test to `leak.test.js` using the `preparedRole` and `runHook` helpers from `lane.test.js` (copy them; keep each test file standalone): a builder role dir with a denylist in its project root; `git commit -m "<phrase>"` from `<roleDir>/product` is denied; the same from `<roleDir>/project` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add plugins/delivery/hooks/scripts/leak.js plugins/delivery/hooks/scripts/leak.test.js plugins/delivery/hooks/scripts/leak-guard.js plugins/delivery/hooks/scripts/leak-post-push.js
git commit -m "delivery: leak guard for the product repo (denylist scan, plan paths, push re-scan)"
```

---

### Task 4: Record-honesty guard and the Stop guard

**Files:**
- Create: `hooks/scripts/bd-guard.js`, `hooks/scripts/bd-guard-hook.js`, `hooks/scripts/turn.js`, `hooks/scripts/claim-stop.js`
- Modify: `hooks/scripts/role-prompt-submit.js` (call `markTurnStart`)
- Test: `hooks/scripts/bd-guard.test.js`, `hooks/scripts/turn.test.js`

**Interfaces:**
- `parseBd(segment): null | { sub: string, id: string | null, flags: Map<string, string | true> }` — for a segment starting with `bd`: `sub` is `close`, `update`, `create`, `dep add`, etc.; `id` the first non-flag token after the subcommand; flags as a map (value when the next token is not a flag).
- `decideBd({ command, actor, staleHours, bd, now }): null | { reason }` — for each `bd` segment: `close` without `--reason` starting with `EVIDENCE:` (case-sensitive) → deny `Close with evidence: bd close <id> --reason "EVIDENCE: what shipped, how it was checked, link".`; `update --claim <id>` → `bd.show(id)`; if `status === 'in_progress'` and `assignee` is non-empty and not `actor` and `updated_at` within `staleHours` → deny `Bead <id> is claimed by <assignee> and live (last change <when>); a claim is the only authority, do not take it. Ask the Delivery Lead or wait for staleness (<staleHours>h).`; `update <id> --assignee ""`/`--status open` releasing someone else's live claim → same rule. `bd` is the adapter from `scripts/lib/bd.js` (injectable).
- `markTurnStart(roleDir, now)`: writes `<roleDir>/.delivery-turn` with the ISO time.
- `decideStop({ input, roleDir, actor, bd, now }): null | { reason }` — allow when `input.stop_hook_active`; find the current claim (`bd.list({ assignee: actor, status: 'in_progress' })`, add that filter to the adapter's `list`); if none, allow; read `.delivery-turn`; if the claim's `updated_at` is older than the turn start → block with `You hold <id> and this turn left no note in it. Append one now: bd update <id> --append-notes "<date>: what was done, where, proof" (or release the claim if you stopped working on it).`

- [ ] **Step 1: Write the failing tests** (`bd-guard.test.js` and `turn.test.js`; use a hand-rolled fake adapter object `{ show, list }` rather than the fake bd binary, since these are pure decisions):

```js
// hooks/scripts/bd-guard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBd, decideBd } = require('./bd-guard.js');

const NOW = '2026-10-12T12:00:00Z';
const fakeBd = (beads) => ({ show: (id) => beads[id] || null });

test('parseBd reads subcommand, id and flags', () => {
  const p = parseBd('bd update ex-1 --claim');
  assert.equal(p.sub, 'update'); assert.equal(p.id, 'ex-1'); assert.equal(p.flags.get('--claim'), true);
  const c = parseBd('bd close ex-2 --reason "EVIDENCE: shipped"');
  assert.equal(c.sub, 'close'); assert.equal(c.flags.get('--reason'), 'EVIDENCE: shipped');
  assert.equal(parseBd('bd dep add ex-1 --blocked-by ex-2').sub, 'dep add');
  assert.equal(parseBd('git status'), null);
});

test('close requires an EVIDENCE reason', () => {
  const bd = fakeBd({});
  assert.match(decideBd({ command: 'bd close ex-1 --reason "done"', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.match(decideBd({ command: 'bd close ex-1', actor: 'a', staleHours: 2, bd, now: NOW }).reason, /EVIDENCE:/);
  assert.equal(decideBd({ command: 'bd close ex-1 --reason "EVIDENCE: shipped in PR 3"', actor: 'a', staleHours: 2, bd, now: NOW }), null);
});

test('claim on a live holder is refused, stale or own claims pass', () => {
  const beads = {
    'ex-1': { id: 'ex-1', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T11:30:00Z' },
    'ex-2': { id: 'ex-2', status: 'in_progress', assignee: 'bob@pc/builder-2', updated_at: '2026-10-12T08:00:00Z' },
    'ex-3': { id: 'ex-3', status: 'open', assignee: '', updated_at: '2026-10-12T11:59:00Z' },
  };
  const bd = fakeBd(beads);
  const me = 'me@pc/builder-1';
  assert.match(decideBd({ command: 'bd update ex-1 --claim', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by bob@pc\/builder-2/);
  assert.equal(decideBd({ command: 'bd update ex-2 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-3 --claim', actor: me, staleHours: 2, bd, now: NOW }), null);
  assert.equal(decideBd({ command: 'bd update ex-1 --claim', actor: 'bob@pc/builder-2', staleHours: 2, bd, now: NOW }), null);
  assert.match(decideBd({ command: 'bd update ex-1 --status open --assignee ""', actor: me, staleHours: 2, bd, now: NOW }).reason, /claimed by/);
});
```

```js
// hooks/scripts/turn.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markTurnStart, decideStop } = require('./turn.js');

test('decideStop blocks when the held bead has no note since turn start, allows otherwise', () => {
  const roleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-'));
  markTurnStart(roleDir, '2026-10-12T12:00:00Z');
  const bd = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T11:00:00Z' }] };
  const d = decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd, now: '2026-10-12T12:10:00Z' });
  assert.match(d.reason, /ex-1/);
  const fresh = { list: () => [{ id: 'ex-1', updated_at: '2026-10-12T12:05:00Z' }] };
  assert.equal(decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd: fresh, now: '2026-10-12T12:10:00Z' }), null);
  assert.equal(decideStop({ input: { stop_hook_active: true }, roleDir, actor: 'me', bd, now: '2026-10-12T12:10:00Z' }), null);
  assert.equal(decideStop({ input: { stop_hook_active: false }, roleDir, actor: 'me', bd: { list: () => [] }, now: '2026-10-12T12:10:00Z' }), null);
});
```

- [ ] **Step 2: Run them to verify they fail** → module not found.

- [ ] **Step 3: Write `hooks/scripts/bd-guard.js`**

```js
// hooks/scripts/bd-guard.js — the record stays honest: evidence on close, no claim-jumping.
const { splitCommand, tokens } = require('./lane.js');

const TWO_WORD = new Set(['dep', 'label', 'comments', 'comment', 'dolt']);

function parseBd(segment) {
  const t = tokens(segment);
  if (t[0] !== 'bd' || !t[1]) return null;
  let sub = t[1];
  let i = 2;
  if (TWO_WORD.has(t[1]) && t[2]) { sub = `${t[1]} ${t[2]}`; i = 3; }
  let id = null;
  const flags = new Map();
  for (; i < t.length; i++) {
    if (t[i].startsWith('--')) {
      const eq = t[i].indexOf('=');
      if (eq > 0) { flags.set(t[i].slice(0, eq), t[i].slice(eq + 1)); continue; }
      const next = t[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags.set(t[i], next); i++; } else flags.set(t[i], true);
    } else if (id === null) id = t[i];
  }
  return { sub, id, flags };
}

function hoursBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / 3600000; }

function decideBd({ command, actor, staleHours, bd, now }) {
  for (const seg of splitCommand(command)) {
    const p = parseBd(seg);
    if (!p) continue;
    if (p.sub === 'close') {
      const reason = p.flags.get('--reason') || p.flags.get('-r');
      if (typeof reason !== 'string' || !reason.startsWith('EVIDENCE:')) {
        return { reason: `Close with evidence: bd close ${p.id || '<id>'} --reason "EVIDENCE: what shipped, how it was checked, link". A bead closes only when every criterion has proof.` };
      }
    }
    if (p.sub === 'update' && p.id && (p.flags.has('--claim') || p.flags.has('--assignee') || p.flags.has('--status'))) {
      const bead = bd.show(p.id);
      if (bead && bead.status === 'in_progress' && bead.assignee && bead.assignee !== actor) {
        const age = hoursBetween(bead.updated_at || '1970-01-01T00:00:00Z', now || new Date().toISOString());
        if (age < staleHours) {
          return { reason: `Bead ${p.id} is claimed by ${bead.assignee} and live (last change ${age.toFixed(1)}h ago). A claim is the only authority: do not take or release it. Ask the Delivery Lead, or wait for staleness (${staleHours}h).` };
        }
      }
    }
  }
  return null;
}

module.exports = { parseBd, decideBd };
```

- [ ] **Step 4: Write `hooks/scripts/turn.js`**

```js
// hooks/scripts/turn.js — a turn that holds a claim leaves a note.
const fs = require('fs');
const path = require('path');

function markTurnStart(roleDir, now) {
  try { fs.writeFileSync(path.join(roleDir, '.delivery-turn'), `${now || new Date().toISOString()}\n`); } catch (err) { /* ignore */ }
}

function readTurnStart(roleDir) {
  try { return fs.readFileSync(path.join(roleDir, '.delivery-turn'), 'utf8').trim(); } catch (err) { return null; }
}

function decideStop({ input, roleDir, actor, bd, now }) {
  if (input && input.stop_hook_active) return null;
  const start = readTurnStart(roleDir);
  if (!start || !actor) return null;
  let held;
  try { held = bd.list({ assignee: actor, status: 'in_progress' }) || []; } catch (err) { return null; }
  if (!held.length) return null;
  const stale = held.filter((b) => !b.updated_at || Date.parse(b.updated_at) < Date.parse(start));
  if (!stale.length) return null;
  const id = stale[0].id;
  return { reason: `You hold ${id} and this turn left no note in it. Append one now: bd update ${id} --append-notes "<date>: what was done, where, proof" (or release the claim if you stopped working on it). Then finish.` };
}

module.exports = { markTurnStart, readTurnStart, decideStop };
```

Also in `scripts/lib/bd.js` `list({ label, all, assignee, status })`: add `--assignee <a>` and `--status <s>` when given (the fake already filters on them).

- [ ] **Step 5: Entries and wiring into prompt-submit**

`hooks/scripts/bd-guard-hook.js`:

```js
#!/usr/bin/env node
// PreToolUse on Bash: evidence on close; no claim on a live holder. Deny JSON or nothing; exit 0.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf } = require('./role-context.js');
  const { decideBd } = require('./bd-guard.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const { loadManifest } = require('../../scripts/lib/manifest.js');
  const input = readHookInput();
  if (input && input.tool_name === 'Bash' && /\bbd\b/.test(String((input.tool_input || {}).command || ''))) {
    const found = findRoleMarker(input.cwd);
    if (found && validMarker(found)) {
      const { team } = loadManifest(found.marker.project_root);
      const staleHours = (team.budget && team.budget.staleness_hours) || 2;
      const d = decideBd({ command: input.tool_input.command, actor: actorOf(found.marker), staleHours, bd: makeBd({ cwd: input.cwd }) });
      if (d) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch (err) { /* allow */ }
process.exit(0);
```

Export `actorOf` from `role-context.js` (it exists there as a local function).

`hooks/scripts/claim-stop.js`:

```js
#!/usr/bin/env node
// Stop: a session holding a claim does not end a turn without a note. Block JSON or nothing; exit 0.
const path = require('path');
try {
  const { readHookInput, findRoleMarker, validMarker, actorOf } = require('./role-context.js');
  const { decideStop } = require('./turn.js');
  const { makeBd } = require('../../scripts/lib/bd.js');
  const input = readHookInput();
  const found = input ? findRoleMarker(input.cwd) : null;
  if (found && validMarker(found)) {
    const d = decideStop({ input, roleDir: path.dirname(found.markerFile), actor: actorOf(found.marker), bd: makeBd({ cwd: input.cwd }) });
    if (d) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (err) { /* allow */ }
process.exit(0);
```

In `hooks/scripts/role-prompt-submit.js`, after computing the text and only when a valid marker was found, call `markTurnStart(path.dirname(found.markerFile))`. Simplest: in `role-context.js` `promptSubmitText`, when the marker is valid, call `require('./turn.js').markTurnStart(roleDir, deps.now)`; add an assertion to the existing prompt-submit test that `.delivery-turn` exists afterwards.

- [ ] **Step 6: Run the tests** `node --test plugins/delivery/hooks/scripts/bd-guard.test.js plugins/delivery/hooks/scripts/turn.test.js plugins/delivery/hooks/scripts/role-context.test.js plugins/delivery/scripts/lib/bd.test.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/delivery/hooks/scripts plugins/delivery/scripts/lib/bd.js plugins/delivery/scripts/lib/bd.test.js
git commit -m "delivery: bd guard (evidence on close, live claims) and Stop guard (note before the turn ends)"
```

---

### Task 5: Wire the hooks, docs, version

**Files:**
- Modify: `hooks/hooks.json`, `README.md`, `.claude-plugin/plugin.json`, root `.claude-plugin/marketplace.json`

- [ ] **Step 1: `hooks/hooks.json`** — keep the existing SessionStart, UserPromptSubmit, PostToolUse and PostToolUseFailure entries and add:

```json
"PreToolUse": [
  { "matcher": "Write|Edit|NotebookEdit|Bash|mcp__Claude_Browser__.*|mcp__claude-in-chrome__.*|mcp__computer-use__.*|mcp__Claude_Code_iOS_Simulator__.*",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/role-lane.js"], "timeout": 10 } ] },
  { "matcher": "Write|Edit|NotebookEdit|Bash",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/leak-guard.js"], "timeout": 10 } ] },
  { "matcher": "Bash",
    "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/bd-guard-hook.js"], "timeout": 15 } ] }
],
"Stop": [
  { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/claim-stop.js"], "timeout": 15 } ] } ]
```

and append to the existing PostToolUse array a second entry `{ "matcher": "Bash", "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/leak-post-push.js"], "timeout": 15 } ] }`. Validate with `node -e "JSON.parse(require('fs').readFileSync('plugins/delivery/hooks/hooks.json','utf8'))"`.

- [ ] **Step 2: README.** In "The shipping team" section add:

```markdown
- Lanes are enforced. Each role file declares `lane_writes` (paths it may edit, relative to its role
  directory) and `lane_bash` (command groups from `hooks/lane-groups.json`). A PreToolUse hook refuses
  anything else and says what the sanctioned path is: managers route work to builder beads, builders
  never touch plans. Subagents go through the same hook. Refusals are logged to `.delivery-lane.log`
  in the role directory.
- The product repo is protected: in a product worktree, commit, PR and issue text is checked against
  `.delivery/team/denylist.txt` (written by materialise), plan files cannot be written, `gh issue create`
  is refused, and pushed commits are re-scanned.
- The record stays honest: `bd close` needs an `EVIDENCE:` reason, a live claim cannot be taken or
  released by someone else, and a turn that holds a claim cannot end without a note.
```

- [ ] **Step 3: Versions** `0.18.0` → `0.19.0` in both files (single lines).

- [ ] **Step 4: Full suite, commit, push**

Run: `node --test 'plugins/delivery/scripts/**/*.test.js' plugins/delivery/hooks/scripts/*.test.js` → all PASS, pristine. Also `cd plugins/delivery && node --test` → green.

```bash
git add plugins/delivery/hooks/hooks.json plugins/delivery/README.md plugins/delivery/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "delivery: 0.19.0 — enforcement hooks wired (lane, leak, bd guard, stop guard)"
git push -u origin delivery-shipping-team-2b
```

---

## Self-review against the spec

- 8.3 lanes: Task 1 (policy in role frontmatter, groups table, manager and worker lanes exactly as the amended spec), Task 2 (hook, refusals with sanctioned path, log), subagents covered because hooks apply to every tool call in the session.
- 8.1 product repo: Task 3 (commit/PR/issue scan, `gh issue create` refused, plan paths blocked, push re-scan, denylist from materialise).
- 8.2 record honesty: Task 4 (EVIDENCE on close, live-claim protection, Stop guard); "no structural change by anyone but delivery-lead" is enforced by the lane groups (`bd-structure` only in the Delivery Lead's `lane_bash`).
- 8.3 host reach: Task 1 `decideLane` headless rule, wired in Task 2.
- 13 testing: each library has unit tests; hooks have subprocess tests for deny, allow and inert paths.
- Known limits to state in the PR: Bash classification is by command prefix, so a worker with `any` is trusted; managers cannot write files through shell redirection because segments with `>` classify nowhere; `-F`/`--body-file` messages are refused rather than read; the Stop guard needs `bd` reachable, otherwise it allows.
