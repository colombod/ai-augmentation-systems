# Shipping Team Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session placed in a prepared role directory takes a specialised role from its first turn, keeps it across restarts and compaction, and `/delivery:team` shows the roster and its drift from the manifest.

**Architecture:** A role library (`roles/*.md`) plus a per-project manifest (`.delivery/team/team.json`, `hosts.json`) in the private project repo. A Node script prepares one directory per role instance with settings, a composed `CLAUDE.local.md` and a marker file. Three plugin hooks (SessionStart, PostCompact, UserPromptSubmit) detect the marker and re-inject the role. A status script reports roster drift.

**Tech Stack:** Node (built-in modules only, no package.json, tests with `node --test`), Claude Code plugin hooks and skills, git worktrees.

Spec: `plugins/delivery/.superpowers/specs/2026-10-12-shipping-team-design.md`, sections 4, 5, 6, 7.5 (roster drift only), 11, 12 phase 1, 13.

## Global Constraints

- Plain Node, no dependencies, no package.json. Every script runs with `node <file>`; tests run with `node --test <file>`.
- Hooks must never throw or exit non-zero in a session that has no role (same rule as `hooks/scripts/record-invocation.js`): wrap the body in one try/catch, exit 0.
- Hooks never print secrets or raw tool input.
- The manifest is JSON (`team.json`, `hosts.json`), not YAML. Amend the spec in Task 1.
- Role instance directories live outside both repos, under a team directory the operator chooses (default `<projectRepo>/../<project>-team/`).
- One directory per role instance. Builders with `count: 2` become `builder-1`, `builder-2`.
- `BEADS_ACTOR` is `<user>@<host>/<instance-id>`.
- Plugin version bumps from 0.16.0 to 0.17.0 in the last task. `marketplace.json` entry for delivery gets the same version, touched as a single-line change.
- All work on branch `delivery-shipping-team`. Commit after every task.
- Paths below are relative to `plugins/delivery/` unless they start with `plugins/`.

## File map

| File | Responsibility |
|---|---|
| `roles/chief-of-staff.md`, `roles/staffing.md`, `roles/product-manager.md`, `roles/delivery-lead.md`, `roles/progress-observer.md`, `roles/builder.md` | Role briefs: frontmatter (`id`, `touches_code`, `default_model`, `mode`) plus the session-level brief |
| `templates/team.json`, `templates/hosts.json` | Manifest templates copied by a future `init`; used by tests as fixtures |
| `templates/team-rules.md` | Rules every role gets, composed into `CLAUDE.local.md` |
| `scripts/lib/manifest.js` (+ `.test.js`) | Find project root, load and validate manifest, expand instances |
| `scripts/lib/compose-brief.js` (+ `.test.js`) | Compose `CLAUDE.local.md` from rules, role brief, routing table, host limits |
| `scripts/prepare-role.js` (+ `.test.js`) | Create a role instance directory: clone project repo, optional product worktree, settings, brief, marker |
| `scripts/lib/roster.js` (+ `.test.js`) | Read and write `.delivery/team/roster.json` |
| `scripts/team-status.js` (+ `.test.js`) | Roster versus manifest: table and drift |
| `hooks/scripts/role-context.js` (+ `.test.js`) | Shared: read stdin JSON, find marker, compose brief text |
| `hooks/scripts/role-session-start.js`, `role-post-compact.js`, `role-prompt-submit.js` | The three retention hooks |
| `hooks/hooks.json` | Register the three hooks |
| `skills/join/SKILL.md`, `skills/team/SKILL.md` | The two in-session skills |
| `README.md`, `.claude-plugin/plugin.json`, `plugins/../.claude-plugin/marketplace.json` | Docs and version |

---

### Task 1: Spec amendment and manifest templates

**Files:**
- Modify: `.superpowers/specs/2026-10-12-shipping-team-design.md` (section 5)
- Create: `templates/team.json`, `templates/hosts.json`

**Interfaces:**
- Produces: the manifest shape every later task reads.

- [ ] **Step 1: Amend the spec.** In section 5, replace the sentence "`team.yaml` in the project repo, written only by Staffing, read by everyone:" with "`team.json` in the project repo at `.delivery/team/team.json`, written only by Staffing, read by everyone (JSON, not YAML: the plugin has no dependencies and Node has no YAML parser):" and replace "`hosts.yaml`, written by provision:" with "`hosts.json` at `.delivery/team/hosts.json`, written by provision:". Leave the YAML examples as illustrations but add one line under each: "Stored as JSON with the same keys." Also in section 11 replace "`team.yaml`, `hosts.yaml`" with "`team.json`, `hosts.json`". In 7.5 and 9.1 and 10 replace every `team.yaml` with `team.json`.

- [ ] **Step 2: Write `templates/team.json`**

```json
{
  "project": "example",
  "product_repo": "git@github.com:example/example.git",
  "prefix": "ex",
  "bd_host": "buildbox",
  "budget": { "max_roles": 12, "builders_cap": 3, "staleness_hours": 2 },
  "roles": [
    { "id": "chief-of-staff",    "brief": "delivery/chief-of-staff",    "host": "pc",       "model": "opus",   "mode": "delegate" },
    { "id": "staffing",          "brief": "delivery/staffing",          "host": "pc",       "model": "sonnet", "mode": "delegate" },
    { "id": "product-manager",   "brief": "delivery/product-manager",   "host": "pc",       "model": "opus" },
    { "id": "delivery-lead",     "brief": "delivery/delivery-lead",     "host": "pc",       "model": "sonnet" },
    { "id": "progress-observer", "brief": "delivery/progress-observer", "host": "buildbox", "model": "haiku",  "steward": true },
    { "id": "builder",           "brief": "delivery/builder",           "host": "pc",       "model": "sonnet", "count": 2, "runner": "superpowers", "steward": true }
  ]
}
```

- [ ] **Step 3: Write `templates/hosts.json`**

```json
{
  "hosts": {
    "pc":       { "kind": "pc",    "bd": "wrapper", "headless": false, "desktop_apps": true },
    "buildbox": { "kind": "ssh",   "bd": "native",  "headless": true,  "desktop_apps": false, "dolt_server": true, "lanes": ["a", "b"], "check": "prepush" },
    "cloud":    { "kind": "cloud", "bd": "remote",  "headless": true,  "desktop_apps": false }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/delivery/.superpowers/specs/2026-10-12-shipping-team-design.md plugins/delivery/templates/team.json plugins/delivery/templates/hosts.json
git commit -m "delivery: shipping-team manifest templates; spec uses JSON manifest"
```

---

### Task 2: Manifest library

**Files:**
- Create: `scripts/lib/manifest.js`
- Test: `scripts/lib/manifest.test.js`

**Interfaces:**
- Produces:
  - `findProjectRoot(startDir: string): string | null` — nearest ancestor of `startDir` (including itself) containing `.delivery/team/team.json`; `process.env.DELIVERY_PROJECT_ROOT` wins when set.
  - `loadManifest(projectRoot: string): { team: object, hosts: object }` — parses both files; throws `Error` with message `manifest: <file>: <reason>` on missing file or bad JSON.
  - `validateManifest(team, hosts): string[]` — list of problems, empty when valid.
  - `expandInstances(team): Array<{ instance: string, role: object }>` — `count` expands to `<id>-1..n`; roles without `count` give one instance named `id`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/lib/manifest.test.js — run with: node --test scripts/lib/manifest.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProjectRoot, loadManifest, validateManifest, expandInstances } = require('./manifest.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

test('findProjectRoot walks upward to the directory holding .delivery/team/team.json', () => {
  const root = scratchProject();
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), root);
});

test('findProjectRoot returns null when nothing is found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-none-'));
  assert.equal(findProjectRoot(dir), null);
});

test('findProjectRoot honours DELIVERY_PROJECT_ROOT', () => {
  const root = scratchProject();
  process.env.DELIVERY_PROJECT_ROOT = root;
  try {
    assert.equal(findProjectRoot(os.tmpdir()), root);
  } finally {
    delete process.env.DELIVERY_PROJECT_ROOT;
  }
});

test('loadManifest parses team and hosts', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  assert.equal(team.project, 'example');
  assert.ok(hosts.hosts.pc);
});

test('loadManifest throws a named error on bad JSON', () => {
  const root = scratchProject();
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), '{ not json');
  assert.throws(() => loadManifest(root), /manifest: team\.json/);
});

test('validateManifest accepts the template', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  assert.deepEqual(validateManifest(team, hosts), []);
});

test('validateManifest reports unknown host, duplicate id, bad model, missing steward', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  team.roles[0].host = 'mars';
  team.roles[1].id = 'chief-of-staff';
  team.roles[2].model = 'gpt';
  delete team.roles[4].steward;
  delete team.roles[5].steward;
  const problems = validateManifest(team, hosts);
  assert.ok(problems.some((p) => p.includes('unknown host "mars"')));
  assert.ok(problems.some((p) => p.includes('duplicate role id "chief-of-staff"')));
  assert.ok(problems.some((p) => p.includes('model "gpt"')));
  assert.ok(problems.some((p) => p.includes('no steward for host "pc"')));
});

test('expandInstances expands count into numbered instances', () => {
  const root = scratchProject();
  const { team } = loadManifest(root);
  const ids = expandInstances(team).map((i) => i.instance);
  assert.deepEqual(ids, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'builder-1', 'builder-2']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/scripts/lib/manifest.test.js`
Expected: FAIL with "Cannot find module './manifest.js'"

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/manifest.js — project manifest: locate, load, validate, expand.
const fs = require('fs');
const path = require('path');

const MODELS = new Set(['opus', 'sonnet', 'haiku']);
const MODES = new Set(['default', 'delegate']);
const TEAM_REL = path.join('.delivery', 'team', 'team.json');
const HOSTS_REL = path.join('.delivery', 'team', 'hosts.json');

function findProjectRoot(startDir) {
  const override = process.env.DELIVERY_PROJECT_ROOT;
  if (override && fs.existsSync(path.join(override, TEAM_REL))) return override;
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, TEAM_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(projectRoot, rel) {
  const file = path.join(projectRoot, rel);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`manifest: ${path.basename(file)}: not found at ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`manifest: ${path.basename(file)}: invalid JSON (${err.message})`);
  }
}

function loadManifest(projectRoot) {
  return { team: readJson(projectRoot, TEAM_REL), hosts: readJson(projectRoot, HOSTS_REL) };
}

function validateManifest(team, hosts) {
  const problems = [];
  const hostNames = new Set(Object.keys((hosts && hosts.hosts) || {}));
  const seen = new Set();
  const stewards = new Set();
  for (const field of ['project', 'prefix', 'bd_host']) {
    if (!team[field]) problems.push(`team.json: missing "${field}"`);
  }
  if (!Array.isArray(team.roles) || team.roles.length === 0) {
    problems.push('team.json: "roles" must be a non-empty array');
    return problems;
  }
  for (const role of team.roles) {
    if (!role.id) { problems.push('team.json: role without "id"'); continue; }
    if (seen.has(role.id)) problems.push(`team.json: duplicate role id "${role.id}"`);
    seen.add(role.id);
    if (!role.brief) problems.push(`team.json: role "${role.id}" has no "brief"`);
    if (!hostNames.has(role.host)) problems.push(`team.json: role "${role.id}" has unknown host "${role.host}"`);
    if (!MODELS.has(role.model)) problems.push(`team.json: role "${role.id}" has model "${role.model}", expected one of ${[...MODELS].join(', ')}`);
    if (role.mode && !MODES.has(role.mode)) problems.push(`team.json: role "${role.id}" has mode "${role.mode}"`);
    if (role.count !== undefined && (!Number.isInteger(role.count) || role.count < 1)) problems.push(`team.json: role "${role.id}" has invalid count`);
    if (role.steward) stewards.add(role.host);
  }
  if (team.budget && team.budget.builders_cap !== undefined) {
    const builders = team.roles.filter((r) => r.id === 'builder').reduce((n, r) => n + (r.count || 1), 0);
    if (builders > team.budget.builders_cap) problems.push(`team.json: ${builders} builders exceed builders_cap ${team.budget.builders_cap}`);
  }
  for (const host of new Set(team.roles.map((r) => r.host))) {
    if (hostNames.has(host) && hosts.hosts[host].kind !== 'cloud' && !stewards.has(host)) {
      problems.push(`team.json: no steward for host "${host}"`);
    }
  }
  return problems;
}

function expandInstances(team) {
  const out = [];
  for (const role of team.roles) {
    if (role.count && role.count > 1) {
      for (let i = 1; i <= role.count; i++) out.push({ instance: `${role.id}-${i}`, role });
    } else {
      out.push({ instance: role.id, role });
    }
  }
  return out;
}

module.exports = { findProjectRoot, loadManifest, validateManifest, expandInstances, TEAM_REL, HOSTS_REL, MODELS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/manifest.test.js`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/lib/manifest.js plugins/delivery/scripts/lib/manifest.test.js
git commit -m "delivery: manifest library (find, load, validate, expand instances)"
```

---

### Task 3: Role briefs and team rules

**Files:**
- Create: `roles/chief-of-staff.md`, `roles/staffing.md`, `roles/product-manager.md`, `roles/delivery-lead.md`, `roles/progress-observer.md`, `roles/builder.md`, `templates/team-rules.md`

**Interfaces:**
- Produces: each role file has frontmatter `id`, `touches_code` (boolean), `default_model`, `mode` (`default` or `delegate`), `composes` (optional path of an existing agent file to include), followed by the brief. Task 4 reads these.

Write each file exactly as below. Where `composes` names an agent file, the composer includes that file's body (after its frontmatter) before the role's own text.

- [ ] **Step 1: `roles/chief-of-staff.md`**

```markdown
---
id: chief-of-staff
touches_code: false
default_model: opus
mode: delegate
composes: agents/chief-of-staff.md
---

## As a session

You are the operator's single interface to every session on this project. The operator talks to you; you route the ask to the right role, bring back what each session says with its proof, and keep the operator's attention for what only the operator can decide.

You do: read the record each time you speak (beads, the roster, pull requests, the session list); turn each operator ask into a bead in the operator's words, or find the bead that already holds it; route it by the routing table below; relay and chase by message; give the operator one short, ranked briefing in **merged / deployed / verified**, with proof, and with what needs the operator at the top.

You do not: build; review your own work as independent; take a claim from a live holder; change beads, pull requests, settings or other sessions unless the operator said so; answer for the operator; pass on a status you have not read in this turn.

Before anything reaches the operator, check the bead, the repositories and the product documents for the answer. What is left is one plain question: the bead, the options, what each one does, and which you would take. A decision that is a session's to make goes back to that session, not up.

The operator may talk to any session directly. When told of such a conversation, record what it decided; do not host vision conversations yourself, the Product Manager does.

With Staffing you may scale the team and hire specialists within the budget in the manifest. Beyond the budget you propose in the briefing.
```

- [ ] **Step 2: `roles/staffing.md`**

```markdown
---
id: staffing
touches_code: false
default_model: sonnet
mode: delegate
---

## As a session

You are Staffing. You own the roster and you are the only writer of `.delivery/team/team.json`.

You hire on evidence: read the product repository (manifests, lockfiles, deploy configuration, CI, docs, the MCP surface) and map what you find to specialists with a stated reason each. One specialist per platform that actually appears in the repository; no speculative hires. Builders are scaled to the number of ready beads within `budget.builders_cap`.

Within `budget` you apply changes yourself: edit the manifest, commit it to the project repository, message the steward of each affected host so it converges its sessions. Beyond the budget you propose in the Chief of Staff's briefing and wait.

You re-run on evidence: a new platform appears, a role has been idle for a week, beads keep bouncing between roles, complexity grows in one area. Every change you make is one line in the morning briefing.

You never write anything except the manifest and bead notes.
```

- [ ] **Step 3: `roles/product-manager.md`**

```markdown
---
id: product-manager
touches_code: false
default_model: opus
mode: default
composes: agents/product-owner.md
---

## As a session

You own the product: what it is for, for whom, what is in and out, what good means. The operator talks to you directly for vision work; you answer, record the ask in a bead in the operator's words, and tell the Chief of Staff what was decided so the picture stays whole.

You drive the delivery pipeline with the operator: brief, research, personas, interviews and simulations, PRD, prioritisation, architecture, roadmap, with the challenge panel at every gate. The roadmap document is where phases and order are decided. You never edit bead structure; when the roadmap changes you tell the Delivery Lead to materialise.

You own strategy review beads. When one is raised, you read the contradiction, decide with the operator whether the plan changes, and revise the documents.

You do not dispatch, assign, or order builders. That is the Delivery Lead.
```

- [ ] **Step 4: `roles/delivery-lead.md`**

```markdown
---
id: delivery-lead
touches_code: false
default_model: sonnet
mode: default
composes: agents/delivery-lead.md
---

## As a session

You run the work and you are the only role allowed to change the structure of the bead graph: creating epics, re-parenting, deferring, re-threading dependencies. Everyone else creates child beads under a bead they hold, appends notes, claims and closes.

Structure flows from the roadmap document to beads through materialise, which you run after every roadmap change and after realign. It is deterministic: same roadmap, same beads. Every epic and story bead carries its roadmap reference.

You assign ready beads to builders, decide on blockers, release stale claims, and re-route. A blocker reaches you once: a note in the bead and a message. You decide, re-route, or escalate through the Chief of Staff.

You own plan reconciliation. When the status check reports drift between the roadmap and the beads, the drift bead is yours.

You do not decide product scope. That is the Product Manager.
```

- [ ] **Step 5: `roles/progress-observer.md`**

```markdown
---
id: progress-observer
touches_code: false
default_model: haiku
mode: default
composes: agents/qa-strategist.md
---

## As a session

You keep the record true. You own the roster bead, the evidence rows, liveness, and the live re-check of what is claimed merged, deployed or verified.

Status is three words, never done: merged, deployed, verified, each with proof. Idle is reported too. A session with no claim says so and what it could take.

You run the evening review: liveness sweep, stale claims released with a note, done beads older than the retention window summarised into their epic.

You do not claim build beads.
```

- [ ] **Step 6: `roles/builder.md`**

```markdown
---
id: builder
touches_code: true
default_model: sonnet
mode: default
---

## As a session

You build. Your loop: `bd ready`, claim one bead with `bd update <id> --claim`, note who you are in it, run the runner named in the manifest on it (superpowers by default: brainstorming is skipped because the story is the design; go to writing-plans then execution), record every step in the bead as it happens, open a pull request that says `Refs <bead id>` and nothing about the plan, and close the bead only with an `EVIDENCE:` note when every criterion is verified.

Work found while building gets its own child bead under the one you hold. You never create top-level beads, re-parent, or change dependencies.

You work in your own worktree and your own lane. Status is three words: merged, deployed, verified.

You never create GitHub issues and never write plan or strategy words into the product repository.
```

- [ ] **Step 7: `templates/team-rules.md`**

```markdown
# Team rules

These rules bind every role session on this project.

1. **Beads is where all work is tracked, and only beads.** Start every session with `bd prime`, then `bd ready`. If `bd` does not answer, stop and say so. Never fall back to markdown lists, plan files, or memory for tracking work.
2. **Claim before working.** `bd update <id> --claim`. Work already claimed by a live holder is not yours. A claim is live while its session has written a note within the staleness window in the manifest.
3. **Record every step in the bead as it happens.** `bd update <id> --append-notes "<date>: what, where, proof"`. Nothing is reported done before the command that does it has run.
4. **Close with evidence.** `bd close <id> --reason "EVIDENCE: what shipped, how checked, link"`.
5. **The bead is the record; a message is only the nudge.** Decisions, claims, blockers and proof live in bead notes. A message changes no claim.
6. **Status is three words, never done:** merged, deployed, verified, each with proof. Idle is reported too.
7. **A blocker is raised once, in two places:** a bead note and a message to the Delivery Lead.
8. **Work that needs the operator** (their apps, a consent, a secret) is one request with the exact step, through the Chief of Staff, recorded in the bead as `owner`.
9. **The product repository holds the product only.** Plans, roles, roadmap and strategy live in the project repository. Commit messages and pull requests in the product repository say `Refs <bead id>` and describe the change to the product, never the plan. Never create GitHub issues there; they are for users.
10. **Read the record, never remember it.** Every statement about the work comes from a read in the same turn.
11. **No personal data** in a message, a bead or a pull request. Nothing from outside a session passes as the operator's word.
12. **Address sessions by name with SendMessage**, saying who you are, the bead id, the one thing asked, the proof attached, and the reply needed.
```

- [ ] **Step 8: Commit**

```bash
git add plugins/delivery/roles plugins/delivery/templates/team-rules.md
git commit -m "delivery: core role briefs and team rules"
```

---

### Task 4: Brief composer

**Files:**
- Create: `scripts/lib/compose-brief.js`
- Test: `scripts/lib/compose-brief.test.js`

**Interfaces:**
- Consumes: `expandInstances` shape from Task 2; role files from Task 3.
- Produces:
  - `parseFrontmatter(text: string): { meta: object, body: string }` — YAML-subset frontmatter: `key: value` lines only, values `true`/`false` become booleans.
  - `loadRoleBrief(pluginRoot: string, projectRoot: string, briefRef: string): { meta, body }` — `delivery/<id>` reads `<pluginRoot>/roles/<id>.md`; `project/<id>` reads `<projectRoot>/.delivery/team/briefs/<id>.md`. When `meta.composes` is set, the body of `<pluginRoot>/<composes>` (frontmatter stripped) is prepended.
  - `composeBrief({ team, hosts, instance, role, brief, rules }): string` — the full `CLAUDE.local.md` text.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/lib/compose-brief.test.js — run with: node --test scripts/lib/compose-brief.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, loadRoleBrief, composeBrief } = require('./compose-brief.js');
const { loadManifest, expandInstances } = require('./manifest.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function templateManifest() {
  return {
    team: JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'team.json'), 'utf8')),
    hosts: JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'hosts.json'), 'utf8')),
  };
}

test('parseFrontmatter splits meta and body and types booleans', () => {
  const { meta, body } = parseFrontmatter('---\nid: x\ntouches_code: true\n---\n\nBody here\n');
  assert.deepEqual(meta, { id: 'x', touches_code: true });
  assert.equal(body.trim(), 'Body here');
});

test('loadRoleBrief reads a delivery role and prepends the composed agent body', () => {
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', 'delivery/chief-of-staff');
  assert.equal(brief.meta.id, 'chief-of-staff');
  assert.ok(brief.body.includes('You are Chief of Staff'));
  assert.ok(brief.body.includes('## As a session'));
  assert.ok(brief.body.indexOf('You are Chief of Staff') < brief.body.indexOf('## As a session'));
});

test('loadRoleBrief reads a project brief from .delivery/team/briefs', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'brief-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team', 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'briefs', 'vercel.md'), '---\nid: vercel\ntouches_code: false\n---\nVercel text\n');
  const brief = loadRoleBrief(PLUGIN_ROOT, root, 'project/vercel');
  assert.equal(brief.body.trim(), 'Vercel text');
});

test('composeBrief contains rules, routing table, role text and host limits', () => {
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'builder-1');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
  const rules = fs.readFileSync(path.join(TEMPLATES, 'team-rules.md'), 'utf8');
  const out = composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules });
  assert.ok(out.startsWith('# Role: builder-1 (builder) on example'));
  assert.ok(out.includes('# Team rules'));
  assert.ok(out.includes('| chief-of-staff | pc | opus |'));
  assert.ok(out.includes('You build.'));
  assert.ok(out.includes('Host pc: pc, bd via wrapper, has a display, has desktop apps'));
  assert.ok(out.includes('Your beads actor is'));
});

test('composeBrief says a headless host cannot run browser or desktop checks', () => {
  const { team, hosts } = templateManifest();
  const inst = expandInstances(team).find((i) => i.instance === 'progress-observer');
  const brief = loadRoleBrief(PLUGIN_ROOT, '/nonexistent', inst.role.brief);
  const out = composeBrief({ team, hosts, instance: inst.instance, role: inst.role, brief, rules: '' });
  assert.ok(out.includes('Host buildbox: ssh, bd native, headless'));
  assert.ok(out.includes('cannot run browser, desktop-app or computer-use checks'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/scripts/lib/compose-brief.test.js`
Expected: FAIL with "Cannot find module './compose-brief.js'"

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/compose-brief.js — turn manifest + role file into CLAUDE.local.md text.
const fs = require('fs');
const path = require('path');

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    meta[kv[1]] = value;
  }
  return { meta, body: m[2] };
}

function loadRoleBrief(pluginRoot, projectRoot, briefRef) {
  const [kind, id] = briefRef.split('/');
  let file;
  if (kind === 'delivery') file = path.join(pluginRoot, 'roles', `${id}.md`);
  else if (kind === 'project') file = path.join(projectRoot, '.delivery', 'team', 'briefs', `${id}.md`);
  else throw new Error(`brief: unknown kind "${kind}" in "${briefRef}"`);
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  let full = body;
  if (meta.composes) {
    const agent = parseFrontmatter(fs.readFileSync(path.join(pluginRoot, meta.composes), 'utf8'));
    full = `${agent.body.trim()}\n\n${body.trim()}\n`;
  }
  return { meta, body: full };
}

function describeHost(name, host) {
  const parts = [host.kind, `bd ${host.bd === 'native' ? 'native' : `via ${host.bd}`}`];
  parts.push(host.headless ? 'headless' : 'has a display');
  parts.push(host.desktop_apps ? 'has desktop apps' : 'no desktop apps');
  if (host.lanes) parts.push(`lanes ${host.lanes.join(', ')}`);
  let text = `Host ${name}: ${parts.join(', ')}.`;
  if (host.headless) text += ' This host cannot run browser, desktop-app or computer-use checks; name the host that can and hand the check there.';
  return text;
}

function routingTable(team) {
  const lines = ['| Role | Host | Model | Brief |', '|---|---|---|---|'];
  for (const r of team.roles) {
    const id = r.count && r.count > 1 ? `${r.id} (x${r.count})` : r.id;
    lines.push(`| ${id} | ${r.host} | ${r.model} | ${r.brief} |`);
  }
  return lines.join('\n');
}

function composeBrief({ team, hosts, instance, role, brief, rules }) {
  const host = hosts.hosts[role.host];
  const actor = `<user>@${role.host}/${instance}`;
  return [
    `# Role: ${instance} (${role.id}) on ${team.project}`,
    '',
    `You are the session "${instance}". Your beads actor is \`${actor}\` (the real user name is set in your environment as BEADS_ACTOR). Bead prefix: \`${team.prefix}-\`. The bd host is \`${team.bd_host}\`.`,
    '',
    rules.trim(),
    '',
    '# Who is on this team',
    '',
    routingTable(team),
    '',
    '# Where you run',
    '',
    describeHost(role.host, host),
    '',
    '# Your role',
    '',
    brief.body.trim(),
    '',
  ].join('\n');
}

module.exports = { parseFrontmatter, loadRoleBrief, composeBrief, describeHost, routingTable };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/compose-brief.test.js`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/lib/compose-brief.js plugins/delivery/scripts/lib/compose-brief.test.js
git commit -m "delivery: brief composer (frontmatter, role + agent composition, routing table, host limits)"
```

---

### Task 5: Roster library

**Files:**
- Create: `scripts/lib/roster.js`
- Test: `scripts/lib/roster.test.js`

**Interfaces:**
- Produces:
  - `readRoster(projectRoot): { instances: { [instance]: { session_id, host, model, role_dir, joined_at, last_seen } } }` — empty object when the file is missing.
  - `writeRoster(projectRoot, roster): void` — writes `.delivery/team/roster.json` with two-space indent and trailing newline.
  - `registerInstance(projectRoot, { instance, session_id, host, model, role_dir, now }): roster` — upserts; sets `joined_at` only on first insert, `last_seen` always.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/lib/roster.test.js — run with: node --test scripts/lib/roster.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readRoster, writeRoster, registerInstance } = require('./roster.js');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  return root;
}

test('readRoster returns empty instances when the file is missing', () => {
  assert.deepEqual(readRoster(scratch()), { instances: {} });
});

test('registerInstance inserts then updates, keeping joined_at', () => {
  const root = scratch();
  const t1 = '2026-10-12T10:00:00Z';
  const t2 = '2026-10-12T11:00:00Z';
  registerInstance(root, { instance: 'builder-1', session_id: 's1', host: 'pc', model: 'sonnet', role_dir: '/x', now: t1 });
  const r = registerInstance(root, { instance: 'builder-1', session_id: 's2', host: 'pc', model: 'haiku', role_dir: '/x', now: t2 });
  assert.equal(r.instances['builder-1'].joined_at, t1);
  assert.equal(r.instances['builder-1'].last_seen, t2);
  assert.equal(r.instances['builder-1'].session_id, 's2');
  assert.equal(r.instances['builder-1'].model, 'haiku');
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.deepEqual(onDisk, r);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/scripts/lib/roster.test.js`
Expected: FAIL with "Cannot find module './roster.js'"

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/roster.js — .delivery/team/roster.json: which session holds which role instance.
const fs = require('fs');
const path = require('path');

const ROSTER_REL = path.join('.delivery', 'team', 'roster.json');

function readRoster(projectRoot) {
  const file = path.join(projectRoot, ROSTER_REL);
  if (!fs.existsSync(file)) return { instances: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.instances) parsed.instances = {};
  return parsed;
}

function writeRoster(projectRoot, roster) {
  const file = path.join(projectRoot, ROSTER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(roster, null, 2)}\n`);
}

function registerInstance(projectRoot, { instance, session_id, host, model, role_dir, now }) {
  const roster = readRoster(projectRoot);
  const existing = roster.instances[instance] || {};
  roster.instances[instance] = {
    session_id,
    host,
    model,
    role_dir,
    joined_at: existing.joined_at || now,
    last_seen: now,
  };
  writeRoster(projectRoot, roster);
  return roster;
}

module.exports = { readRoster, writeRoster, registerInstance, ROSTER_REL };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/roster.test.js`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/lib/roster.js plugins/delivery/scripts/lib/roster.test.js
git commit -m "delivery: roster library"
```

---

### Task 6: prepare-role script

**Files:**
- Create: `scripts/prepare-role.js`
- Test: `scripts/prepare-role.test.js`

**Interfaces:**
- Consumes: Tasks 2, 4.
- Produces:
  - `prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo, user }): { roleDir, files: string[] }`. Creates `<teamDir>/<instance>/` with: `project/` (git clone of `projectRoot`, origin rewritten to the project's real remote when `projectRoot` has one), `product/` (git worktree of `productRepo` on branch `team/<instance>`, only when the role's `touches_code` is true and `productRepo` is given), `.claude/settings.local.json`, `CLAUDE.local.md`, `.delivery-role.json`. Idempotent: existing clone and worktree are left alone, settings and brief are rewritten.
  - CLI: `node scripts/prepare-role.js --project <projectRoot> --instance <id> [--team-dir <dir>] [--product-repo <path>] [--user <name>]`. Prints the role directory path on success.
- Marker file `.delivery-role.json` shape: `{ "instance", "role", "project_root", "host", "model", "prepared_at" }`. Hooks in Task 7 read it.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/prepare-role.test.js — run with: node --test scripts/prepare-role.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { prepareRole } = require('./prepare-role.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function scratchProjectRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-project-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function scratchProductRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-product-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'README.md'), 'product\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('prepareRole creates a thinking role directory without a product worktree', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'chief-of-staff', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.equal(roleDir, path.join(teamDir, 'chief-of-staff'));
  assert.ok(fs.existsSync(path.join(roleDir, 'project', '.delivery', 'team', 'team.json')));
  assert.ok(!fs.existsSync(path.join(roleDir, 'product')));
  const settings = JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.DELIVERY_ROLE, 'chief-of-staff');
  assert.equal(settings.env.DELIVERY_HOST, 'pc');
  assert.equal(settings.env.BEADS_ACTOR, 'tester@pc/chief-of-staff');
  assert.equal(settings.env.DELIVERY_PROJECT_ROOT, projectRoot);
  const brief = fs.readFileSync(path.join(roleDir, 'CLAUDE.local.md'), 'utf8');
  assert.ok(brief.startsWith('# Role: chief-of-staff (chief-of-staff) on example'));
  const marker = JSON.parse(fs.readFileSync(path.join(roleDir, '.delivery-role.json'), 'utf8'));
  assert.equal(marker.instance, 'chief-of-staff');
  assert.equal(marker.role, 'chief-of-staff');
  assert.equal(marker.project_root, projectRoot);
});

test('prepareRole creates a product worktree for a builder on branch team/<instance>', () => {
  const projectRoot = scratchProjectRepo();
  const productRepo = scratchProductRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  const { roleDir } = prepareRole({ projectRoot, instance: 'builder-2', teamDir, pluginRoot: PLUGIN_ROOT, productRepo, user: 'tester' });
  assert.ok(fs.existsSync(path.join(roleDir, 'product', 'README.md')));
  assert.equal(git(path.join(roleDir, 'product'), 'branch', '--show-current').trim(), 'team/builder-2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(roleDir, '.claude', 'settings.local.json'), 'utf8')).env.BEADS_ACTOR, 'tester@pc/builder-2');
});

test('prepareRole is idempotent: second run rewrites settings and brief, keeps the clone', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  fs.writeFileSync(path.join(teamDir, 'staffing', 'project', 'keep.txt'), 'x');
  const second = prepareRole({ projectRoot, instance: 'staffing', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  assert.ok(fs.existsSync(path.join(second.roleDir, 'project', 'keep.txt')));
  assert.ok(fs.existsSync(path.join(second.roleDir, 'CLAUDE.local.md')));
});

test('prepareRole refuses an instance that is not in the manifest', () => {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-'));
  assert.throws(() => prepareRole({ projectRoot, instance: 'wizard', teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' }), /unknown instance "wizard"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/scripts/prepare-role.test.js`
Expected: FAIL with "Cannot find module './prepare-role.js'"

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// scripts/prepare-role.js — create one role instance directory from the manifest.
// Run by a steward (phase 4) or by hand: the session is then started IN that
// directory and the SessionStart hook does the rest. Idempotent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, validateManifest, expandInstances } = require('./lib/manifest.js');
const { loadRoleBrief, composeBrief } = require('./lib/compose-brief.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function remoteOf(repo) {
  try { return git(repo, 'remote', 'get-url', 'origin'); } catch (err) { return null; }
}

function prepareRole({ projectRoot, instance, teamDir, pluginRoot, productRepo, user, now }) {
  projectRoot = path.resolve(projectRoot);
  const { team, hosts } = loadManifest(projectRoot);
  const problems = validateManifest(team, hosts);
  if (problems.length) throw new Error(`manifest invalid:\n${problems.join('\n')}`);
  const found = expandInstances(team).find((i) => i.instance === instance);
  if (!found) throw new Error(`unknown instance "${instance}" (not in team.json)`);
  const { role } = found;
  const brief = loadRoleBrief(pluginRoot, projectRoot, role.brief);
  teamDir = path.resolve(teamDir || path.join(projectRoot, '..', `${team.project}-team`));
  const roleDir = path.join(teamDir, instance);
  fs.mkdirSync(roleDir, { recursive: true });
  const files = [];

  const projectDir = path.join(roleDir, 'project');
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    git(roleDir, 'clone', '--quiet', projectRoot, 'project');
    const realRemote = remoteOf(projectRoot);
    if (realRemote) git(projectDir, 'remote', 'set-url', 'origin', realRemote);
    files.push(projectDir);
  }

  if (brief.meta.touches_code && productRepo) {
    const productDir = path.join(roleDir, 'product');
    if (!fs.existsSync(productDir)) {
      const branch = `team/${instance}`;
      let branchExists = false;
      try { git(productRepo, 'rev-parse', '--verify', '--quiet', branch); branchExists = true; } catch (err) { branchExists = false; }
      if (branchExists) git(productRepo, 'worktree', 'add', productDir, branch);
      else git(productRepo, 'worktree', 'add', '-b', branch, productDir);
      files.push(productDir);
    }
  }

  const settings = {
    model: role.model,
    permissions: { defaultMode: 'auto' },
    env: {
      DELIVERY_ROLE: instance,
      DELIVERY_ROLE_ID: role.id,
      DELIVERY_HOST: role.host,
      DELIVERY_PROJECT_ROOT: projectRoot,
      BEADS_ACTOR: `${user || os.userInfo().username}@${role.host}/${instance}`,
    },
  };
  fs.mkdirSync(path.join(roleDir, '.claude'), { recursive: true });
  const settingsFile = path.join(roleDir, '.claude', 'settings.local.json');
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  files.push(settingsFile);

  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  const briefFile = path.join(roleDir, 'CLAUDE.local.md');
  fs.writeFileSync(briefFile, composeBrief({ team, hosts, instance, role, brief, rules }));
  files.push(briefFile);

  const marker = {
    instance,
    role: role.id,
    project_root: projectRoot,
    host: role.host,
    model: role.model,
    prepared_at: now || new Date().toISOString(),
  };
  const markerFile = path.join(roleDir, '.delivery-role.json');
  fs.writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
  files.push(markerFile);

  return { roleDir, files };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2).replace(/-/g, '_')] = argv[i + 1]; i++; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.instance) {
    console.error('usage: prepare-role.js --project <projectRoot> --instance <id> [--team-dir <dir>] [--product-repo <path>] [--user <name>]');
    process.exit(2);
  }
  const { roleDir } = prepareRole({
    projectRoot: args.project,
    instance: args.instance,
    teamDir: args.team_dir,
    pluginRoot: path.join(__dirname, '..'),
    productRepo: args.product_repo,
    user: args.user,
  });
  console.log(roleDir);
}

module.exports = { prepareRole };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/prepare-role.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/prepare-role.js plugins/delivery/scripts/prepare-role.test.js
git commit -m "delivery: prepare-role script (role directory, clone, worktree, settings, brief, marker)"
```

---

### Task 7: Role context helper and the three retention hooks

**Files:**
- Create: `hooks/scripts/role-context.js`, `hooks/scripts/role-context.test.js`, `hooks/scripts/role-session-start.js`, `hooks/scripts/role-post-compact.js`, `hooks/scripts/role-prompt-submit.js`
- Modify: `hooks/hooks.json`

**Interfaces:**
- Consumes: marker file from Task 6; `loadManifest`, `expandInstances`, `loadRoleBrief`, `composeBrief`, `registerInstance`.
- Produces:
  - `readHookInput(): object` — parses stdin JSON, `{}` on failure.
  - `findRoleMarker(cwd): { markerFile, marker } | null` — walks upward from `cwd` for `.delivery-role.json`.
  - `composeForMarker(marker, pluginRoot): string` — recomposes the brief from the current manifest (so a changed manifest reaches a restarted session).
  - `currentClaim(actor): string | null` — runs `bd list --assignee <actor> --status in_progress --json`; returns `"<id>: <title>"` of the first, or null when bd is absent or fails. Never throws.
  - Hook stdout is injected as context (SessionStart, UserPromptSubmit) or shown after compaction (PostCompact).

- [ ] **Step 1: Write the failing tests**

```js
// hooks/scripts/role-context.test.js — run with: node --test hooks/scripts/role-context.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findRoleMarker, composeForMarker, sessionStartText, promptSubmitText } = require('./role-context.js');
const { prepareRole } = require('../../scripts/prepare-role.js');

const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

function scratchProjectRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-project-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function preparedRole(instance) {
  const projectRoot = scratchProjectRepo();
  const teamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-team-'));
  const { roleDir } = prepareRole({ projectRoot, instance, teamDir, pluginRoot: PLUGIN_ROOT, user: 'tester' });
  return { projectRoot, roleDir };
}

test('findRoleMarker returns null outside a role directory', () => {
  assert.equal(findRoleMarker(fs.mkdtempSync(path.join(os.tmpdir(), 'nomarker-'))), null);
});

test('findRoleMarker finds the marker from a subdirectory of the role dir', () => {
  const { roleDir } = preparedRole('delivery-lead');
  const sub = path.join(roleDir, 'project', '.delivery');
  const found = findRoleMarker(sub);
  assert.equal(found.marker.instance, 'delivery-lead');
});

test('composeForMarker reflects a manifest change made after prepare', () => {
  const { projectRoot, roleDir } = preparedRole('builder-1');
  const teamFile = path.join(projectRoot, '.delivery', 'team', 'team.json');
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
  team.roles.push({ id: 'infra-vercel', brief: 'delivery/builder', host: 'pc', model: 'sonnet' });
  fs.writeFileSync(teamFile, JSON.stringify(team, null, 2));
  const { marker } = findRoleMarker(roleDir);
  const text = composeForMarker(marker, PLUGIN_ROOT);
  assert.ok(text.includes('| infra-vercel | pc | sonnet |'));
});

test('sessionStartText registers the session in the roster and returns the brief', () => {
  const { projectRoot, roleDir } = preparedRole('staffing');
  const text = sessionStartText({ cwd: roleDir, session_id: 'sess-1' }, PLUGIN_ROOT, { now: '2026-10-12T12:00:00Z', claim: () => null });
  assert.ok(text.startsWith('# Role: staffing'));
  const roster = JSON.parse(fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'roster.json'), 'utf8'));
  assert.equal(roster.instances.staffing.session_id, 'sess-1');
  assert.equal(roster.instances.staffing.last_seen, '2026-10-12T12:00:00Z');
});

test('sessionStartText is empty outside a role directory', () => {
  assert.equal(sessionStartText({ cwd: os.tmpdir(), session_id: 'x' }, PLUGIN_ROOT, { claim: () => null }), '');
});

test('promptSubmitText is one line with role and claim', () => {
  const { roleDir } = preparedRole('builder-2');
  const text = promptSubmitText({ cwd: roleDir }, { claim: () => 'ex-12: Add login' });
  assert.equal(text, 'You are builder-2 (builder). Current claim: ex-12: Add login.');
  const idle = promptSubmitText({ cwd: roleDir }, { claim: () => null });
  assert.equal(idle, 'You are builder-2 (builder). Current claim: none (idle; say so and what you could take).');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/hooks/scripts/role-context.test.js`
Expected: FAIL with "Cannot find module './role-context.js'"

- [ ] **Step 3: Write `hooks/scripts/role-context.js`**

```js
// hooks/scripts/role-context.js — shared logic for the role retention hooks.
// A hook calls one of the *Text functions and prints the result. Everything
// here must be safe to call from a session with no role: it returns '' then.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, expandInstances } = require('../../scripts/lib/manifest.js');
const { loadRoleBrief, composeBrief } = require('../../scripts/lib/compose-brief.js');
const { registerInstance } = require('../../scripts/lib/roster.js');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function findRoleMarker(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (;;) {
    const file = path.join(dir, '.delivery-role.json');
    if (fs.existsSync(file)) {
      try { return { markerFile: file, marker: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (err) { return null; }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function composeForMarker(marker, pluginRoot) {
  const { team, hosts } = loadManifest(marker.project_root);
  const found = expandInstances(team).find((i) => i.instance === marker.instance);
  if (!found) return `# Role: ${marker.instance}\n\nThis instance is no longer in team.json. Stop and tell the Chief of Staff.\n`;
  const brief = loadRoleBrief(pluginRoot, marker.project_root, found.role.brief);
  const rules = fs.readFileSync(path.join(pluginRoot, 'templates', 'team-rules.md'), 'utf8');
  return composeBrief({ team, hosts, instance: marker.instance, role: found.role, brief, rules });
}

function currentClaim(actor) {
  if (!actor) return null;
  try {
    const out = execFileSync('bd', ['list', '--assignee', actor, '--status', 'in_progress', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
    const items = JSON.parse(out);
    if (!Array.isArray(items) || items.length === 0) return null;
    return `${items[0].id}: ${items[0].title}`;
  } catch (err) {
    return null;
  }
}

function sessionStartText(input, pluginRoot, deps = {}) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  const { marker } = found;
  const now = deps.now || new Date().toISOString();
  try {
    registerInstance(marker.project_root, {
      instance: marker.instance,
      session_id: input.session_id || 'unknown',
      host: marker.host,
      model: marker.model,
      role_dir: path.dirname(found.markerFile),
      now,
    });
  } catch (err) {
    // roster write failure must not stop the session; the status check will show the gap
  }
  const brief = composeForMarker(marker, pluginRoot);
  const claim = (deps.claim || currentClaim)(process.env.BEADS_ACTOR);
  const tail = claim
    ? `\nYou currently hold: ${claim}. Continue it; append a note before anything else.\n`
    : '\nYou hold no claim. Run `bd prime` then `bd ready`, and say what you could take.\n';
  return `${brief}${tail}`;
}

function postCompactText(input, pluginRoot) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  return `Context was compacted. Your role is restated below; it has not changed.\n\n${composeForMarker(found.marker, pluginRoot)}`;
}

function promptSubmitText(input, deps = {}) {
  const found = findRoleMarker(input.cwd);
  if (!found) return '';
  const claim = (deps.claim || currentClaim)(process.env.BEADS_ACTOR);
  const claimText = claim ? `${claim}.` : 'none (idle; say so and what you could take).';
  return `You are ${found.marker.instance} (${found.marker.role}). Current claim: ${claimText}`;
}

module.exports = { readHookInput, findRoleMarker, composeForMarker, currentClaim, sessionStartText, postCompactText, promptSubmitText };
```

- [ ] **Step 4: Write the three hook entry points**

`hooks/scripts/role-session-start.js`:

```js
#!/usr/bin/env node
// SessionStart: re-inject the role brief, register the session in the roster.
// Never exits non-zero: a session without a role must start normally.
const path = require('path');
try {
  const { readHookInput, sessionStartText } = require('./role-context.js');
  const text = sessionStartText(readHookInput(), path.join(__dirname, '..', '..'));
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow: observing hook
}
process.exit(0);
```

`hooks/scripts/role-post-compact.js`:

```js
#!/usr/bin/env node
// PostCompact: restate the role after context compaction.
const path = require('path');
try {
  const { readHookInput, postCompactText } = require('./role-context.js');
  const text = postCompactText(readHookInput(), path.join(__dirname, '..', '..'));
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow
}
process.exit(0);
```

`hooks/scripts/role-prompt-submit.js`:

```js
#!/usr/bin/env node
// UserPromptSubmit: one line with role and current claim.
try {
  const { readHookInput, promptSubmitText } = require('./role-context.js');
  const text = promptSubmitText(readHookInput());
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow
}
process.exit(0);
```

- [ ] **Step 5: Register the hooks.** Replace `hooks/hooks.json` with:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/role-session-start.js"], "timeout": 15 }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/role-post-compact.js"], "timeout": 15 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/role-prompt-submit.js"], "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Skill|Agent|Write|Edit|NotebookEdit|mcp__Claude_Browser__computer|mcp__Claude_Code_iOS_Simulator__control",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/record-invocation.js"] }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Skill|Agent|Write|Edit|NotebookEdit|mcp__Claude_Browser__computer|mcp__Claude_Code_iOS_Simulator__control",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/record-invocation.js"] }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test plugins/delivery/hooks/scripts/role-context.test.js`
Expected: 6 tests PASS

- [ ] **Step 7: Smoke-test the hooks by hand from a non-role directory and from a prepared role directory**

```bash
echo '{"cwd":"/tmp","session_id":"x"}' | node plugins/delivery/hooks/scripts/role-session-start.js; echo "exit=$?"
```
Expected: no output, `exit=0`.

```bash
ROLE_DIR=$(node plugins/delivery/scripts/prepare-role.js --project "$(mktemp -d)" --instance chief-of-staff 2>&1 || true); echo "$ROLE_DIR"
```
Expected: an error mentioning `manifest: team.json: not found` (no manifest in an empty dir), which confirms the script refuses rather than guesses. Then prepare against a real scratch project as the tests do, and run:

```bash
echo "{\"cwd\":\"<roleDir>\",\"session_id\":\"smoke\"}" | node plugins/delivery/hooks/scripts/role-session-start.js | head -5
```
Expected: the first lines of the composed brief, starting `# Role: chief-of-staff`.

- [ ] **Step 8: Commit**

```bash
git add plugins/delivery/hooks
git commit -m "delivery: role retention hooks (SessionStart, PostCompact, UserPromptSubmit) and role-context helper"
```

---

### Task 8: team-status script

**Files:**
- Create: `scripts/team-status.js`
- Test: `scripts/team-status.test.js`

**Interfaces:**
- Consumes: Tasks 2, 5.
- Produces:
  - `teamStatus(projectRoot, { now, staleHours }): { rows: Array<{ instance, role, host, model, session_id, last_seen, state }>, drift: { missing: string[], extra: string[], wrong_model: Array<{ instance, expected, actual }>, stale: string[] } }`. `state` is `live` (seen within `staleHours`), `stale`, or `missing`.
  - `renderStatus(status): string` — markdown table plus a drift section, or "No drift." when every list is empty.
  - CLI: `node scripts/team-status.js [--project <root>]` prints the rendered text; exits 1 when any drift exists so a routine can test it.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/team-status.test.js — run with: node --test scripts/team-status.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { teamStatus, renderStatus } = require('./team-status.js');
const { registerInstance } = require('./lib/roster.js');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(TEMPLATES, 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  return root;
}

const NOW = '2026-10-12T12:00:00Z';

test('every manifest instance is missing when the roster is empty', () => {
  const root = scratchProject();
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.equal(s.rows.length, 7);
  assert.deepEqual(s.drift.missing, ['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'builder-1', 'builder-2']);
  assert.ok(renderStatus(s).includes('Missing: chief-of-staff'));
});

test('live, stale, extra and wrong_model are reported', () => {
  const root = scratchProject();
  registerInstance(root, { instance: 'chief-of-staff', session_id: 'a', host: 'pc', model: 'opus', role_dir: '/x', now: '2026-10-12T11:30:00Z' });
  registerInstance(root, { instance: 'staffing', session_id: 'b', host: 'pc', model: 'sonnet', role_dir: '/x', now: '2026-10-12T08:00:00Z' });
  registerInstance(root, { instance: 'builder-1', session_id: 'c', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  registerInstance(root, { instance: 'wizard', session_id: 'd', host: 'pc', model: 'haiku', role_dir: '/x', now: NOW });
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  const byId = Object.fromEntries(s.rows.map((r) => [r.instance, r]));
  assert.equal(byId['chief-of-staff'].state, 'live');
  assert.equal(byId['staffing'].state, 'stale');
  assert.deepEqual(s.drift.stale, ['staffing']);
  assert.deepEqual(s.drift.extra, ['wizard']);
  assert.deepEqual(s.drift.wrong_model, [{ instance: 'builder-1', expected: 'sonnet', actual: 'haiku' }]);
  const text = renderStatus(s);
  assert.ok(text.includes('| chief-of-staff | chief-of-staff | pc | opus | a | live |'));
  assert.ok(text.includes('Wrong model: builder-1 expected sonnet, running haiku'));
});

test('renderStatus says No drift when the roster matches', () => {
  const root = scratchProject();
  for (const [inst, model] of [['chief-of-staff', 'opus'], ['staffing', 'sonnet'], ['product-manager', 'opus'], ['delivery-lead', 'sonnet'], ['progress-observer', 'haiku'], ['builder-1', 'sonnet'], ['builder-2', 'sonnet']]) {
    registerInstance(root, { instance: inst, session_id: inst, host: 'pc', model, role_dir: '/x', now: NOW });
  }
  const s = teamStatus(root, { now: NOW, staleHours: 2 });
  assert.ok(renderStatus(s).includes('No drift.'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/delivery/scripts/team-status.test.js`
Expected: FAIL with "Cannot find module './team-status.js'"

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// scripts/team-status.js — roster versus manifest: who is live, who is missing, what drifted.
const path = require('path');
const { findProjectRoot, loadManifest, expandInstances } = require('./lib/manifest.js');
const { readRoster } = require('./lib/roster.js');

function teamStatus(projectRoot, { now, staleHours } = {}) {
  const { team } = loadManifest(projectRoot);
  const roster = readRoster(projectRoot);
  const nowMs = Date.parse(now || new Date().toISOString());
  const staleMs = (staleHours || (team.budget && team.budget.staleness_hours) || 2) * 3600 * 1000;
  const drift = { missing: [], extra: [], wrong_model: [], stale: [] };
  const rows = [];
  const expected = expandInstances(team);
  const expectedIds = new Set(expected.map((i) => i.instance));

  for (const { instance, role } of expected) {
    const entry = roster.instances[instance];
    if (!entry) {
      drift.missing.push(instance);
      rows.push({ instance, role: role.id, host: role.host, model: role.model, session_id: '', last_seen: '', state: 'missing' });
      continue;
    }
    const age = nowMs - Date.parse(entry.last_seen);
    const state = age <= staleMs ? 'live' : 'stale';
    if (state === 'stale') drift.stale.push(instance);
    if (entry.model !== role.model) drift.wrong_model.push({ instance, expected: role.model, actual: entry.model });
    rows.push({ instance, role: role.id, host: entry.host, model: entry.model, session_id: entry.session_id, last_seen: entry.last_seen, state });
  }
  for (const instance of Object.keys(roster.instances)) {
    if (!expectedIds.has(instance)) drift.extra.push(instance);
  }
  return { rows, drift };
}

function renderStatus({ rows, drift }) {
  const lines = ['| Instance | Role | Host | Model | Session | State |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.instance} | ${r.role} | ${r.host} | ${r.model} | ${r.session_id} | ${r.state} |`);
  lines.push('');
  const any = drift.missing.length || drift.extra.length || drift.wrong_model.length || drift.stale.length;
  if (!any) { lines.push('No drift.'); return lines.join('\n'); }
  lines.push('## Roster drift');
  if (drift.missing.length) lines.push(`Missing: ${drift.missing.join(', ')}`);
  if (drift.stale.length) lines.push(`Stale: ${drift.stale.join(', ')}`);
  if (drift.extra.length) lines.push(`Extra (not in team.json): ${drift.extra.join(', ')}`);
  for (const w of drift.wrong_model) lines.push(`Wrong model: ${w.instance} expected ${w.expected}, running ${w.actual}`);
  return lines.join('\n');
}

if (require.main === module) {
  const idx = process.argv.indexOf('--project');
  const root = idx >= 0 ? path.resolve(process.argv[idx + 1]) : findProjectRoot(process.cwd());
  if (!root) { console.error('team-status: no .delivery/team/team.json found from here; pass --project <root>'); process.exit(2); }
  const status = teamStatus(root);
  console.log(renderStatus(status));
  const any = status.drift.missing.length || status.drift.extra.length || status.drift.wrong_model.length || status.drift.stale.length;
  process.exit(any ? 1 : 0);
}

module.exports = { teamStatus, renderStatus };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/team-status.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/team-status.js plugins/delivery/scripts/team-status.test.js
git commit -m "delivery: team-status (roster versus manifest, drift)"
```

---

### Task 9: The `join` and `team` skills

**Files:**
- Create: `skills/join/SKILL.md`, `skills/team/SKILL.md`

**Interfaces:**
- Consumes: marker file, `team-status.js`, the SessionStart hook's behaviour.

- [ ] **Step 1: Write `skills/join/SKILL.md`**

```markdown
---
description: Finish taking this session's role on the shipping team — verify the role marker, prime beads, register with the roster and report to the Chief of Staff. The role directory itself is prepared beforehand by a steward with scripts/prepare-role.js; this skill runs inside it.
argument-hint: ""
---

# Join the team as this session's role

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

You are being asked to confirm the role this directory was prepared for. Do these steps in order and stop at the first that fails.

1. **Find the marker.** Read `.delivery-role.json` in the working directory or an ancestor. If there is none, stop: "This directory was not prepared as a role. A steward runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/prepare-role.js --project <projectRoot> --instance <id>` first, then starts a session in the directory it prints." Do not create one.
2. **Confirm the brief is loaded.** Your context should already start with `# Role: <instance>` from the SessionStart hook. If it does not, read `CLAUDE.local.md` in the role directory now and treat it as binding.
3. **Prime beads.** Run `bd prime`. If `bd` does not answer, stop and say so; do not continue on memory.
4. **Register.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <project_root from the marker>` and confirm your instance shows `live` with this session. If it shows `missing`, the SessionStart hook did not run; say so and stop.
5. **Report.** Send one message to the session named `chief-of-staff` (or the instance whose role is chief-of-staff in the routing table) with: your instance id, your host, your model, and either your current claim or "idle, could take: <one bead from bd ready>". If you are the chief-of-staff instance, report to the operator instead.

Then act as your role. Do not narrate these steps beyond one line each.
```

- [ ] **Step 2: Write `skills/team/SKILL.md`**

```markdown
---
description: Show the shipping team — every role instance in team.json, which session holds it, whether it is live, stale or missing, and any drift between the manifest and the roster. Read-only.
argument-hint: ""
---

# Team status

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

Read-only. This skill reports; it changes nothing.

1. Resolve the project root: the directory holding `.delivery/team/team.json`, found upward from the working directory, or `DELIVERY_PROJECT_ROOT` from the environment, or the `project_root` in `.delivery-role.json` when this is a role session. If none is found, say so and stop.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <root>` and show its output verbatim.
3. If the output has a `## Roster drift` section, say in one line who owns each kind: missing or extra instances and wrong models belong to Staffing (and the host's steward applies the fix); stale instances belong to the Progress Observer's liveness sweep. Do not fix anything yourself.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/delivery/skills/join plugins/delivery/skills/team
git commit -m "delivery: join and team skills"
```

---

### Task 10: Docs, version bump, full test run

**Files:**
- Modify: `README.md` (add a section), `.claude-plugin/plugin.json` (version), `plugins/../.claude-plugin/marketplace.json` (delivery version line only)

- [ ] **Step 1: Add a README section** after "## The pipeline" and before "## Using it with superpowers":

```markdown
## The shipping team (phase 1)

The pipeline's roles can also run as long-lived sessions, one per role, on the hosts that can do the
work, coordinating through cross-session messages and beads. Phase 1 ships the pieces that give a
session its role and keep it:

- `roles/*.md` — the role briefs (chief-of-staff, staffing, product-manager, delivery-lead,
  progress-observer, builder). Project-specific briefs go in the project repo under
  `.delivery/team/briefs/`.
- `.delivery/team/team.json` and `hosts.json` — the manifest, in the private project repo. Templates
  under `templates/`.
- `scripts/prepare-role.js --project <root> --instance <id>` — creates one directory per role
  instance with its own settings (model, env, actor), a composed `CLAUDE.local.md`, a clone of the
  project repo and, for builders, a worktree of the product repo. Start a session in that directory.
- Hooks — SessionStart re-injects the role and registers the session in the roster; PostCompact
  restates it after compaction; UserPromptSubmit adds a one-line reminder with the current claim.
- `/delivery:join` — confirms the role in-session, primes beads, reports to the Chief of Staff.
- `/delivery:team` — roster versus manifest: live, stale, missing, wrong model.

Design: `.superpowers/specs/2026-10-12-shipping-team-design.md`. Provisioning, hiring, deploy and
the plan-to-beads materialise step are later phases.
```

- [ ] **Step 2: Bump versions.** In `plugins/delivery/.claude-plugin/plugin.json` change `"version": "0.16.0"` to `"version": "0.17.0"`. In `.claude-plugin/marketplace.json` change the delivery entry's `"version": "0.16.0"` to `"version": "0.17.0"` and nothing else in that file.

- [ ] **Step 3: Run every test in the plugin**

Run: `node --test plugins/delivery/scripts/lib/*.test.js plugins/delivery/scripts/*.test.js plugins/delivery/hooks/scripts/*.test.js`
Expected: all PASS, including the pre-existing `record-invocation.test.js`.

- [ ] **Step 4: Validate the hooks file parses and the plugin loads**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/delivery/hooks/hooks.json','utf8')); console.log('hooks.json ok')"`
Expected: `hooks.json ok`

- [ ] **Step 5: Commit and push**

```bash
git add plugins/delivery/README.md plugins/delivery/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "delivery: 0.17.0 — shipping team phase 1 (roles, manifest, prepare-role, retention hooks, team status)"
git push origin delivery-shipping-team
```

---

## Self-review against the spec

- Section 4.1 core roles: Task 3 writes all six briefs. Specialists and one-off roles are later phases, as section 12 says.
- Section 4.4 steward: the manifest field and validation exist (Task 2); steward behaviour is phase 4.
- Section 5 manifest: Tasks 1 and 2, as JSON. Budget validation covers `builders_cap`; `max_roles` is enforced in phase 4's hire.
- Section 6.1 join: split into prepare (Task 6, a script a steward runs before the session exists) and join (Task 9, in-session). The spec's step 4 (register, bd prime, message) is covered by the SessionStart hook plus the join skill.
- Section 6.2 retention: Task 7, all three hooks.
- Section 6.3 model: settings.local.json carries it (Task 6); wrong-model drift is reported (Task 8).
- Section 7.5 roster drift: Task 8. Plan drift (roadmap versus beads) is phase 2.
- Section 8: only retention hooks (8.4) are in phase 1; 8.1 to 8.3 are phase 2.
- Section 13 testing: every script has unit tests; prepare-role and the hooks run against scratch git repos; idempotency is tested.
- Known phase-1 simplification: the roster is a file in the project repo, not a bead. Phase 4 mirrors it into the roster bead when deploy lands; `team-status.js` is the single reader either way.
