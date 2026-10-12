# Shipping Team Phase 2a Implementation Plan: document plans, beads execute

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Delivery Lead can turn an initiative's roadmap, stories and architecture spikes into a deterministic, idempotent bead graph with `/delivery:materialise`, detect drift between the documents and the beads, and the builder and spike-researcher roles carry a formal runner contract.

**Architecture:** Pure parsers (roadmap, stories, spikes) feed a pure planner that emits a bead graph with explicit, deterministic ids. An adapter applies the graph through the `bd` CLI (create-if-missing by `--id`, update otherwise, add missing dependencies). A fake `bd` executable makes every test fast and hermetic. Reconcile compares the same plan against what `bd` holds. Materialise also writes the denylist that phase 2b's hooks consume.

**Tech Stack:** Node built-ins only, `node --test`, `bd` 1.2+ CLI (explicit `--id`, `--metadata`, `--parent`, `dep add --blocked-by`, `show --json`, `list --json`).

Spec: `plugins/delivery/.superpowers/specs/2026-10-12-shipping-team-design.md` sections 4.1 (builder, spike-researcher), 4.3a, 7, 8.1 (denylist generation only), 11, 12 phase 2, 13.

## Global Constraints

- Plain Node, no dependencies, no package.json. Tests with `node --test`. Paths relative to `plugins/delivery/` unless they start with `plugins/`.
- Every `bd` call goes through `scripts/lib/bd.js` using `execFileSync` with an argv array, never a shell string. Tests use the fake `bd` at `scripts/test/fake-bd.js` by prepending its directory to `PATH`; no test calls the real `bd`.
- Bead ids are deterministic and derived only from the manifest prefix and document ids: epic `<prefix>-ph<N>`, phase review `<prefix>-ph<N>-review`, story `<prefix>-<story id>`, spike `<prefix>-spike-<key>` where `<key>` is the spike table's `#` column lower-cased with non `[a-z0-9]` runs replaced by `-`. Materialise never generates a random id.
- Structure flows document to beads only. Materialise creates and updates beads and dependencies; it never closes, deletes or re-assigns a bead, and never touches a bead that is `closed`.
- Every bead materialise creates carries metadata `{"roadmap_ref":"<initiative>/roadmap.md@<sha> phase <N>", "doc_id":"<story or spike id or phase>", "materialised_by":"delivery"}` and the label `roadmap`. The `<sha>` is the git short sha of the project repo HEAD when materialise ran.
- Runner values are exactly `superpowers`, `attractor`, `plain`.
- Plugin version bumps from 0.17.0 to 0.18.0 in the last task. All work on branch `delivery-shipping-team-2a` cut from `delivery-shipping-team`. Commit after every task with a `Co-Authored-By` trailer naming the model that ran.

## File map

| File | Responsibility |
|---|---|
| `scripts/test/fake-bd.js` | A fake `bd` CLI backed by a JSON file named by `BD_FAKE_STORE`; supports the subset materialise uses |
| `scripts/lib/bd.js` (+ `.test.js`) | Adapter: `show`, `create`, `update`, `depAdd`, `depsOf`, `list`; parses JSON output; normalises array-or-object replies |
| `scripts/lib/plan-docs.js` (+ `.test.js`) | Parsers: `parseRoadmap`, `parseStories`, `parseSpikes`, `phaseNumber` |
| `scripts/lib/plan-graph.js` (+ `.test.js`) | Pure planner: `planGraph` → beads and deps; `denylistFrom` |
| `scripts/materialise.js` (+ `.test.js`) | `applyPlan`, `reconcile`, CLI with `--dry-run` and `--check`; writes `.delivery/team/denylist.txt` |
| `roles/spike-researcher.md`, `roles/builder.md`, `roles/delivery-lead.md` | Standing spike role; per-runner builder loop; Delivery Lead owns materialise |
| `scripts/lib/manifest.js` | `runner` validated |
| `skills/materialise/SKILL.md`, `skills/team/SKILL.md` | New skill; team status gains plan drift |
| `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | Docs and version |

---

### Task 1: Branch, fake bd, and the bd adapter

**Files:**
- Create: `scripts/test/fake-bd.js`, `scripts/lib/bd.js`
- Test: `scripts/lib/bd.test.js`

**Interfaces:**
- Produces `scripts/lib/bd.js` exporting `makeBd({ cwd, env })` returning an object with:
  - `show(id): object | null` — the bead, or null when `bd show` fails or prints nothing.
  - `create({ id, title, type, parent, labels, metadata, priority, description }): string` — returns the id.
  - `update(id, { title, parent, addLabels, metadata, appendNotes }): void`.
  - `depAdd(id, blockedBy): void`; `depsOf(id): string[]` (ids this bead is blocked by).
  - `list({ label, all }): object[]`.
  - `exec(args): string` — the raw runner, exposed for `prime`/`ready` callers.
- Fake `bd` behaviour: store `{ issues: { [id]: { id, title, status, type, parent, labels, metadata, notes, priority, description } }, deps: [{ id, blocked_by }] }`. Commands: `show <id> --json` prints the issue object or exits 1; `create --id X --title T [--type --parent --labels a,b --metadata JSON --priority P --description D] --silent` prints X (exits 1 with `already exists` when present); `update <id> [--title --parent --add-label L (repeatable) --metadata JSON --append-notes N --status S --assignee A --claim]`; `dep add <id> --blocked-by <other>` (idempotent); `dep list <id> --json` prints `[{id, blocked_by}]` entries for that id; `list --json [--label L] [--all]` prints an array (closed excluded unless `--all`); `close <id> --reason R`; `prime` and `ready --json` print something harmless. Unknown commands exit 2 with `fake-bd: unknown`.

- [ ] **Step 1: Cut the branch**

```bash
cd /Users/colombod/private-workspaces/delivery-plugin/ai-augmentation-systems
git checkout -b delivery-shipping-team-2a delivery-shipping-team
```

- [ ] **Step 2: Write the failing adapter test**

```js
// scripts/lib/bd.test.js — run with: node --test scripts/lib/bd.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeBd } = require('./bd.js');

const FAKE_DIR = path.join(__dirname, '..', 'test');

function fakeEnv() {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bd-')), 'store.json');
  return { ...process.env, PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: store };
}

test('show returns null for an unknown id and the bead after create', () => {
  const bd = makeBd({ env: fakeEnv() });
  assert.equal(bd.show('ex-ph1'), null);
  const id = bd.create({ id: 'ex-ph1', title: 'Phase 1: Foundations', type: 'epic', labels: ['roadmap'], metadata: { doc_id: 'phase-1' }, priority: 1 });
  assert.equal(id, 'ex-ph1');
  const bead = bd.show('ex-ph1');
  assert.equal(bead.title, 'Phase 1: Foundations');
  assert.deepEqual(bead.labels, ['roadmap']);
  assert.equal(bead.metadata.doc_id, 'phase-1');
});

test('update changes title, adds labels, merges metadata and appends notes', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-s1', title: 'old', type: 'task' });
  bd.update('ex-s1', { title: 'new', addLabels: ['story'], metadata: { k: 'v' }, appendNotes: 'hello' });
  const b = bd.show('ex-s1');
  assert.equal(b.title, 'new');
  assert.ok(b.labels.includes('story'));
  assert.equal(b.metadata.k, 'v');
  assert.ok(b.notes.includes('hello'));
});

test('depAdd is idempotent and depsOf lists blockers', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-a', title: 'a' });
  bd.create({ id: 'ex-b', title: 'b' });
  bd.depAdd('ex-b', 'ex-a');
  bd.depAdd('ex-b', 'ex-a');
  assert.deepEqual(bd.depsOf('ex-b'), ['ex-a']);
  assert.deepEqual(bd.depsOf('ex-a'), []);
});

test('list filters by label and hides closed unless all', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-1', title: 'one', labels: ['roadmap'] });
  bd.create({ id: 'ex-2', title: 'two', labels: ['other'] });
  bd.exec(['close', 'ex-2', '--reason', 'EVIDENCE: done']);
  assert.deepEqual(bd.list({ label: 'roadmap' }).map((b) => b.id), ['ex-1']);
  assert.deepEqual(bd.list({ all: true }).map((b) => b.id).sort(), ['ex-1', 'ex-2']);
});

test('create of an existing id throws with the bd message', () => {
  const bd = makeBd({ env: fakeEnv() });
  bd.create({ id: 'ex-dup', title: 'x' });
  assert.throws(() => bd.create({ id: 'ex-dup', title: 'x' }), /already exists/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test plugins/delivery/scripts/lib/bd.test.js`
Expected: FAIL with "Cannot find module './bd.js'"

- [ ] **Step 4: Write the fake bd**

```js
#!/usr/bin/env node
// scripts/test/fake-bd.js — a fake `bd` for tests. Backed by the JSON file named in
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
      if (key === 'add-label') { (flags[key] = flags[key] || []).push(next); } else { flags[key] = next; }
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

function out(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

const [cmd, ...rest] = process.argv.slice(2);
const { pos, flags } = parse(rest);
const s = load();

switch (cmd) {
  case 'show': {
    const id = pos[0] || flags.id;
    const b = s.issues[id];
    if (!b) { process.stderr.write(`fake-bd: no such issue ${id}\n`); process.exit(1); }
    if (flags.json) out(b); else process.stdout.write(`${b.id}: ${b.title}\n`);
    break;
  }
  case 'create': {
    const id = flags.id;
    if (!id) { process.stderr.write('fake-bd: --id required in tests\n'); process.exit(2); }
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
      if (!s.deps.some((d) => d.id === id && d.blocked_by === blockedBy)) s.deps.push({ id, blocked_by: blockedBy });
      save(s);
      process.stdout.write('ok\n');
    } else if (sub === 'list') {
      const id = pos[1];
      out(s.deps.filter((d) => d.id === id));
    } else { process.stderr.write('fake-bd: unknown dep subcommand\n'); process.exit(2); }
    break;
  }
  case 'list': {
    let items = Object.values(s.issues);
    if (!flags.all) items = items.filter((b) => b.status !== 'closed');
    if (flags.label) items = items.filter((b) => b.labels.includes(flags.label));
    if (flags.assignee) items = items.filter((b) => b.assignee === flags.assignee);
    if (flags.status) items = items.filter((b) => b.status === flags.status);
    if (flags.json) out(items); else for (const b of items) process.stdout.write(`${b.id}: ${b.title}\n`);
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
  case 'ready': {
    const blocked = new Set(s.deps.filter((d) => s.issues[d.blocked_by] && s.issues[d.blocked_by].status !== 'closed').map((d) => d.id));
    const items = Object.values(s.issues).filter((b) => b.status === 'open' && !blocked.has(b.id));
    if (flags.json) out(items); else for (const b of items) process.stdout.write(`${b.id}: ${b.title}\n`);
    break;
  }
  default:
    process.stderr.write(`fake-bd: unknown command ${cmd}\n`);
    process.exit(2);
}
```

Make it executable and give it the name `bd` on PATH for tests: create `scripts/test/bd` as a two-line shell wrapper:

```sh
#!/bin/sh
exec node "$(dirname "$0")/fake-bd.js" "$@"
```

Run `chmod +x plugins/delivery/scripts/test/bd plugins/delivery/scripts/test/fake-bd.js`.

- [ ] **Step 5: Write the adapter**

```js
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/bd.test.js`
Expected: 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add plugins/delivery/scripts/test plugins/delivery/scripts/lib/bd.js plugins/delivery/scripts/lib/bd.test.js
git commit -m "delivery: bd adapter and fake bd for tests"
```

---

### Task 2: Document parsers

**Files:**
- Create: `scripts/lib/plan-docs.js`
- Test: `scripts/lib/plan-docs.test.js`

**Interfaces:**
- `phaseNumber(text: string): string | null` — `"Phase 7b: name"`, `"Phase 7b"`, `"phase 7b"` → `"7b"`; null when absent.
- `parseRoadmap(markdown: string): { phases: Array<{ number: string, name: string, done: boolean, items: Array<{ title: string, size: string, confidence: string, dependsOn: string }> }> }` — phases from `### Phase <n>: <name>` headings in order; `done` is true when the heading line contains `(done)`; items from the first markdown table under the heading whose header row begins with `| Work item`.
- `parseStories(dir: string): Array<{ id, title, status, epic, phase: string | null, dependsOn: string[], size, file }>` — every `*.md` in `dir` except `README.md` with a frontmatter `id:`; `phase` is `phaseNumber(frontmatter.phase)`; `dependsOn` parsed from `depends_on: [a, b]`.
- `parseSpikes(markdown: string): Array<{ key: string, question: string, timeBox: string, blocks: string }>` — rows of the first table after a heading starting `## Spikes`; `key` is the `#` column lower-cased with non `[a-z0-9]` runs replaced by `-`, trimmed of leading and trailing `-`.
- Frontmatter parsing reuses `parseFrontmatter` from `compose-brief.js`; `depends_on: [x, y]` and `requirements: [FR-1]` list values are split on commas inside the brackets.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/lib/plan-docs.test.js — run with: node --test scripts/lib/plan-docs.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { phaseNumber, parseRoadmap, parseStories, parseSpikes } = require('./plan-docs.js');

const ROADMAP = `# Delivery roadmap: Example

## Phases

### Phase 1: Foundations

**Entry criteria:** none

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Manifest library | S | high | |
| Prepare role | M | med | Manifest library |

### Phase 2: Beads (done)

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Materialise | L | low | Prepare role |

### Phase 7b: Parallel thing

No table here.

## Critical path
`;

const ARCH = `# Architecture

## Spikes — what must be proven before committing

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| CoS-1 | Does env reach hooks? | 1 day | Phase 1 |
| 2 | Is bd --id stable? | 2 hours | ex-01 |

## Something else
`;

test('phaseNumber extracts the phase token', () => {
  assert.equal(phaseNumber('Phase 7b: Parallel'), '7b');
  assert.equal(phaseNumber('phase 1'), '1');
  assert.equal(phaseNumber('Phase 1'), '1');
  assert.equal(phaseNumber('nothing'), null);
  assert.equal(phaseNumber(''), null);
});

test('parseRoadmap finds phases, done markers and work items in order', () => {
  const { phases } = parseRoadmap(ROADMAP);
  assert.deepEqual(phases.map((p) => [p.number, p.name, p.done]), [['1', 'Foundations', false], ['2', 'Beads', true], ['7b', 'Parallel thing', false]]);
  assert.deepEqual(phases[0].items.map((i) => i.title), ['Manifest library', 'Prepare role']);
  assert.equal(phases[0].items[1].dependsOn, 'Manifest library');
  assert.equal(phases[0].items[1].size, 'M');
  assert.deepEqual(phases[2].items, []);
});

test('parseStories reads frontmatter and resolves the phase number', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# index\n');
  fs.writeFileSync(path.join(dir, 'ex-01-first.md'), '---\nid: ex-01\ntitle: First thing\nstatus: ready\nepic: ex\nphase: Phase 1\ndepends_on: []\nsize: S\n---\n# First\n');
  fs.writeFileSync(path.join(dir, 'ex-02-second.md'), '---\nid: ex-02\ntitle: Second thing\nstatus: draft\nepic: ex\nphase: Phase 2\ndepends_on: [ex-01, ex-00]\nsize: M\n---\n# Second\n');
  const stories = parseStories(dir);
  assert.deepEqual(stories.map((s) => s.id), ['ex-01', 'ex-02']);
  assert.equal(stories[0].phase, '1');
  assert.deepEqual(stories[0].dependsOn, []);
  assert.deepEqual(stories[1].dependsOn, ['ex-01', 'ex-00']);
  assert.equal(stories[1].file, path.join(dir, 'ex-02-second.md'));
});

test('parseSpikes reads the spikes table and derives keys', () => {
  const spikes = parseSpikes(ARCH);
  assert.deepEqual(spikes.map((s) => s.key), ['cos-1', '2']);
  assert.equal(spikes[0].question, 'Does env reach hooks?');
  assert.equal(spikes[0].timeBox, '1 day');
  assert.equal(spikes[1].blocks, 'ex-01');
});

test('parseSpikes returns an empty list when there is no spikes section', () => {
  assert.deepEqual(parseSpikes('# Arch\n\n## Components\n'), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test plugins/delivery/scripts/lib/plan-docs.test.js`
Expected: FAIL with "Cannot find module './plan-docs.js'"

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/plan-docs.js — parse roadmap, stories and architecture spikes. Pure.
const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./compose-brief.js');

function phaseNumber(text) {
  const m = /phase\s+(\d+[a-z]?)/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
}

function tableRows(lines, startIndex) {
  // Returns the cells of the first markdown table starting at or after startIndex,
  // skipping the header and separator rows. Stops at the first non-table line after the table began.
  const rows = [];
  let i = startIndex;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (/^#{2,3}\s/.test(lines[i])) return { rows, end: i };
    i++;
  }
  let seenHeader = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (!seenHeader) { seenHeader = true; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return { rows, end: i };
}

function parseRoadmap(markdown) {
  const lines = markdown.split(/\r?\n/);
  const phases = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s+Phase\s+(\d+[a-z]?)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    let name = m[2].trim();
    const done = /\(done\)/i.test(name);
    name = name.replace(/\s*\(done\)\s*/i, '').trim();
    const items = [];
    let j = i + 1;
    while (j < lines.length && !/^###\s+Phase\s/i.test(lines[j]) && !/^##\s/.test(lines[j])) {
      if (/^\|\s*Work item/i.test(lines[j])) {
        const { rows } = tableRows(lines, j);
        for (const cells of rows) {
          if (!cells[0]) continue;
          items.push({ title: cells[0], size: cells[1] || '', confidence: cells[2] || '', dependsOn: cells[3] || '' });
        }
        break;
      }
      j++;
    }
    phases.push({ number: m[1].toLowerCase(), name, done, items });
  }
  return { phases };
}

function listValue(value) {
  if (value === undefined || value === null) return [];
  const s = String(value).trim();
  if (!s || s === '[]') return [];
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return inner.split(',').map((x) => x.trim()).filter(Boolean);
}

function parseStories(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    const stripped = text.replace(/^<!--[\s\S]*?-->\s*/, '');
    const { meta } = parseFrontmatter(stripped);
    if (!meta.id) continue;
    out.push({
      id: String(meta.id), title: String(meta.title || meta.id), status: String(meta.status || ''), epic: String(meta.epic || ''),
      phase: phaseNumber(meta.phase), dependsOn: listValue(meta.depends_on), size: String(meta.size || ''), file,
    });
  }
  return out;
}

function spikeKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseSpikes(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Spikes/i.test(l));
  if (start < 0) return [];
  const { rows } = tableRows(lines, start + 1);
  return rows.filter((c) => c[0]).map((c) => ({ key: spikeKey(c[0]), question: c[1] || '', timeBox: c[2] || '', blocks: c[3] || '' }));
}

module.exports = { phaseNumber, parseRoadmap, parseStories, parseSpikes, spikeKey, listValue };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/plan-docs.test.js`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/lib/plan-docs.js plugins/delivery/scripts/lib/plan-docs.test.js
git commit -m "delivery: roadmap, story and spike parsers"
```

---

### Task 3: The pure planner and the denylist

**Files:**
- Create: `scripts/lib/plan-graph.js`
- Test: `scripts/lib/plan-graph.test.js`

**Interfaces:**
- `planGraph({ prefix, initiative, sha, roadmap, stories, spikes }): { beads: Bead[], deps: Array<{ id, blockedBy }>, warnings: string[] }` where `Bead = { id, title, type, parent, labels, metadata, priority, docId }`. Rules:
  - One epic per phase: id `<prefix>-ph<N>`, title `Phase <N>: <name>`, type `epic`, labels `[roadmap, phase-<N>]`, priority 1, metadata `{ roadmap_ref: "<initiative>/roadmap.md@<sha> phase <N>", doc_id: "phase-<N>", materialised_by: "delivery" }`.
  - One phase review per phase: id `<prefix>-ph<N>-review`, title `Phase <N> review: sprint-review and realign`, type `task`, parent the epic, labels `[roadmap, phase-<N>, phase-review]`, priority 1.
  - One task per story that has a phase: id `<prefix>-<story id>`, title the story title, type `task`, parent the phase epic, labels `[roadmap, phase-<N>, story]`, priority 2, metadata adds `story: <id>`, `story_file: <basename>`. Stories with status `superseded` are skipped. A story whose phase is not in the roadmap yields a warning `story <id>: phase <N> not in roadmap` and is skipped.
  - One task per spike: id `<prefix>-spike-<key>`, title `Spike <#>: <question truncated to 120 chars>`, type `task`, labels `[roadmap, spike]`, priority 1, metadata adds `spike: <key>`, `time_box`. Parent and blocking from `blocks`: if `blocks` names a phase (`phaseNumber` non-null) the spike's parent is that epic and the epic's review is blocked by the spike; else if `blocks` equals a story id, the parent is that story's epic and the story is blocked by the spike; else parent is the first phase's epic, no blocking, and a warning `spike <key>: blocks "<text>" matched nothing`.
  - Dependencies: each epic (except the first) blocked by the previous phase's review; each review blocked by every story and spike of its phase; each story blocked by each `dependsOn` id that is a known story (unknown ids produce a warning `story <id>: depends_on <x> unknown`).
  - Output ordering is deterministic: epics in roadmap order, then per phase its stories (sorted by id), spikes (document order), review; deps in the order they are derived. Same input, byte-identical output.
- `denylistFrom({ initiative, roadmap, stories, spikes, briefText, prdText, personaNames }): string[]` — sorted unique list of: the initiative slug; every phase name; every story title; every spike question; every H1/H2 heading text from `briefText` and `prdText` with the leading `#`s removed; every persona name. Entries shorter than 3 characters or matching `^(phase|spike|roadmap|story)\b` alone are dropped. Entries are trimmed and de-duplicated case-insensitively.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/lib/plan-graph.test.js — run with: node --test scripts/lib/plan-graph.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planGraph, denylistFrom } = require('./plan-graph.js');

const roadmap = { phases: [
  { number: '1', name: 'Foundations', done: false, items: [] },
  { number: '2', name: 'Beads', done: false, items: [] },
] };
const stories = [
  { id: 'ex-02', title: 'Second', status: 'ready', phase: '2', dependsOn: ['ex-01'], file: '/x/ex-02-second.md' },
  { id: 'ex-01', title: 'First', status: 'ready', phase: '1', dependsOn: [], file: '/x/ex-01-first.md' },
  { id: 'ex-99', title: 'Orphan', status: 'ready', phase: '9', dependsOn: [], file: '/x/ex-99.md' },
  { id: 'ex-03', title: 'Old', status: 'superseded', phase: '1', dependsOn: [], file: '/x/ex-03.md' },
];
const spikes = [
  { key: 'cos-1', question: 'Does env reach hooks?', timeBox: '1 day', blocks: 'Phase 1' },
  { key: '2', question: 'Is bd --id stable?', timeBox: '2h', blocks: 'ex-02' },
  { key: '3', question: 'Mystery', timeBox: '1h', blocks: 'the moon' },
];
const input = { prefix: 'ex', initiative: 'demo', sha: 'abc1234', roadmap, stories, spikes };

test('planGraph emits deterministic ids, parents, labels and metadata', () => {
  const g = planGraph(input);
  const ids = g.beads.map((b) => b.id);
  assert.deepEqual(ids, ['ex-ph1', 'ex-ph2', 'ex-ex-01', 'ex-spike-cos-1', 'ex-spike-3', 'ex-ph1-review', 'ex-ex-02', 'ex-spike-2', 'ex-ph2-review']);
  const epic = g.beads[0];
  assert.equal(epic.title, 'Phase 1: Foundations');
  assert.equal(epic.type, 'epic');
  assert.deepEqual(epic.labels, ['roadmap', 'phase-1']);
  assert.equal(epic.metadata.roadmap_ref, 'demo/roadmap.md@abc1234 phase 1');
  const story = g.beads.find((b) => b.id === 'ex-ex-01');
  assert.equal(story.parent, 'ex-ph1');
  assert.equal(story.metadata.story, 'ex-01');
  assert.equal(story.metadata.story_file, 'ex-01-first.md');
  const spike = g.beads.find((b) => b.id === 'ex-spike-2');
  assert.equal(spike.parent, 'ex-ph2');
  assert.equal(spike.title, 'Spike 2: Is bd --id stable?');
});

test('planGraph chains phases, reviews, stories and spikes', () => {
  const g = planGraph(input);
  const has = (id, blockedBy) => g.deps.some((d) => d.id === id && d.blockedBy === blockedBy);
  assert.ok(has('ex-ph2', 'ex-ph1-review'));
  assert.ok(has('ex-ph1-review', 'ex-ex-01'));
  assert.ok(has('ex-ph1-review', 'ex-spike-cos-1'));
  assert.ok(has('ex-ex-02', 'ex-ex-01'));
  assert.ok(has('ex-ex-02', 'ex-spike-2'));
  assert.ok(has('ex-ph2-review', 'ex-ex-02'));
  assert.ok(!g.deps.some((d) => d.blockedBy === 'ex-spike-3'));
});

test('planGraph warns on orphans and unmatched blocks, skips superseded', () => {
  const g = planGraph(input);
  assert.ok(g.warnings.some((w) => w.includes('story ex-99: phase 9 not in roadmap')));
  assert.ok(g.warnings.some((w) => w.includes('spike 3: blocks "the moon" matched nothing')));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-03'));
  assert.ok(!g.beads.some((b) => b.id === 'ex-ex-99'));
});

test('planGraph is byte-identical on repeated runs', () => {
  assert.equal(JSON.stringify(planGraph(input)), JSON.stringify(planGraph(input)));
});

test('denylistFrom collects titles, names and headings, deduplicated', () => {
  const list = denylistFrom({
    initiative: 'demo', roadmap, stories, spikes,
    briefText: '# Brief: Vault for everyone\n\n## Who it is for\n\ntext\n',
    prdText: '# PRD\n\n## Scenario: Sell duplicates\n',
    personaNames: ['Casual Carl', 'casual carl', 'Pro Pat'],
  });
  assert.ok(list.includes('demo'));
  assert.ok(list.includes('Foundations'));
  assert.ok(list.includes('Second'));
  assert.ok(list.includes('Does env reach hooks?'));
  assert.ok(list.includes('Brief: Vault for everyone'));
  assert.ok(list.includes('Scenario: Sell duplicates'));
  assert.equal(list.filter((x) => x.toLowerCase() === 'casual carl').length, 1);
  assert.ok(!list.includes('PRD'));
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b)));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test plugins/delivery/scripts/lib/plan-graph.test.js`
Expected: FAIL with "Cannot find module './plan-graph.js'"

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/plan-graph.js — pure planner: documents in, deterministic bead graph out.
const path = require('path');
const { phaseNumber } = require('./plan-docs.js');

function planGraph({ prefix, initiative, sha, roadmap, stories, spikes }) {
  const beads = [];
  const deps = [];
  const warnings = [];
  const phases = roadmap.phases;
  const phaseIds = new Map();
  const reviewIds = new Map();
  const storyById = new Map();
  const ref = (n) => `${initiative}/roadmap.md@${sha} phase ${n}`;
  const base = (n, docId) => ({ roadmap_ref: ref(n), doc_id: docId, materialised_by: 'delivery' });

  for (const p of phases) {
    const id = `${prefix}-ph${p.number}`;
    phaseIds.set(p.number, id);
    reviewIds.set(p.number, `${id}-review`);
    beads.push({ id, title: `Phase ${p.number}: ${p.name}`, type: 'epic', parent: null, labels: ['roadmap', `phase-${p.number}`], metadata: base(p.number, `phase-${p.number}`), priority: 1, docId: `phase-${p.number}` });
  }

  const live = stories.filter((s) => s.status !== 'superseded');
  for (const s of live) storyById.set(s.id, s);
  const storiesByPhase = new Map();
  for (const s of [...live].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!s.phase || !phaseIds.has(s.phase)) { warnings.push(`story ${s.id}: phase ${s.phase} not in roadmap`); continue; }
    (storiesByPhase.get(s.phase) || storiesByPhase.set(s.phase, []).get(s.phase)).push(s);
  }

  const spikesByPhase = new Map();
  const spikeBlocks = [];
  for (const sp of spikes) {
    const id = `${prefix}-spike-${sp.key}`;
    const blocksPhase = phaseNumber(sp.blocks);
    let phase = null;
    if (blocksPhase && phaseIds.has(blocksPhase)) {
      phase = blocksPhase;
      spikeBlocks.push({ id: reviewIds.get(phase), blockedBy: id });
    } else if (storyById.has(sp.blocks) && storyById.get(sp.blocks).phase && phaseIds.has(storyById.get(sp.blocks).phase)) {
      phase = storyById.get(sp.blocks).phase;
      spikeBlocks.push({ id: `${prefix}-${sp.blocks}`, blockedBy: id });
    } else {
      phase = phases.length ? phases[0].number : null;
      warnings.push(`spike ${sp.key}: blocks "${sp.blocks}" matched nothing`);
    }
    if (phase === null) continue;
    (spikesByPhase.get(phase) || spikesByPhase.set(phase, []).get(phase)).push({ ...sp, id, phase });
  }

  for (const p of phases) {
    const epicId = phaseIds.get(p.number);
    const reviewId = reviewIds.get(p.number);
    for (const s of storiesByPhase.get(p.number) || []) {
      beads.push({ id: `${prefix}-${s.id}`, title: s.title, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'story'], metadata: { ...base(p.number, s.id), story: s.id, story_file: path.basename(s.file) }, priority: 2, docId: s.id });
    }
    for (const sp of spikesByPhase.get(p.number) || []) {
      const q = sp.question.length > 120 ? `${sp.question.slice(0, 117)}...` : sp.question;
      beads.push({ id: sp.id, title: `Spike ${sp.key}: ${q}`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'spike'], metadata: { ...base(p.number, `spike-${sp.key}`), spike: sp.key, time_box: sp.timeBox }, priority: 1, docId: `spike-${sp.key}` });
    }
    beads.push({ id: reviewId, title: `Phase ${p.number} review: sprint-review and realign`, type: 'task', parent: epicId, labels: ['roadmap', `phase-${p.number}`, 'phase-review'], metadata: base(p.number, `phase-${p.number}-review`), priority: 1, docId: `phase-${p.number}-review` });
  }

  for (let i = 1; i < phases.length; i++) deps.push({ id: phaseIds.get(phases[i].number), blockedBy: reviewIds.get(phases[i - 1].number) });
  for (const p of phases) {
    const reviewId = reviewIds.get(p.number);
    for (const s of storiesByPhase.get(p.number) || []) deps.push({ id: reviewId, blockedBy: `${prefix}-${s.id}` });
    for (const sp of spikesByPhase.get(p.number) || []) deps.push({ id: reviewId, blockedBy: sp.id });
  }
  for (const p of phases) {
    for (const s of storiesByPhase.get(p.number) || []) {
      for (const d of s.dependsOn) {
        if (storyById.has(d)) deps.push({ id: `${prefix}-${s.id}`, blockedBy: `${prefix}-${d}` });
        else warnings.push(`story ${s.id}: depends_on ${d} unknown`);
      }
    }
  }
  deps.push(...spikeBlocks);

  return { beads, deps, warnings };
}

function headings(text) {
  return (text || '').split(/\r?\n/).filter((l) => /^#{1,2}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
}

function denylistFrom({ initiative, roadmap, stories, spikes, briefText, prdText, personaNames }) {
  const raw = [initiative, ...roadmap.phases.map((p) => p.name), ...stories.map((s) => s.title), ...spikes.map((s) => s.question), ...headings(briefText), ...headings(prdText), ...(personaNames || [])];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const e = String(entry || '').trim();
    if (e.length < 3) continue;
    if (/^(phase|spike|roadmap|story|prd|brief)$/i.test(e)) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

module.exports = { planGraph, denylistFrom };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/lib/plan-graph.test.js`
Expected: 5 tests PASS. If the id-order assertion fails only by ordering, the planner is wrong, not the test: the required order is epics, then per phase stories (by id), spikes (document order), review.

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/lib/plan-graph.js plugins/delivery/scripts/lib/plan-graph.test.js
git commit -m "delivery: pure bead-graph planner and denylist builder"
```

---

### Task 4: materialise — apply, reconcile, CLI

**Files:**
- Create: `scripts/materialise.js`
- Test: `scripts/materialise.test.js`

**Interfaces:**
- `loadInputs({ projectRoot, initiative }): { team, roadmap, stories, spikes, sha, briefText, prdText, personaNames }` — reads `.delivery/initiatives/<initiative>/{roadmap,architecture,brief,prd}.md` (missing brief/prd → empty text; missing roadmap → throws `materialise: roadmap not found`), `.delivery/stories/`, persona names from the `name:` frontmatter of `.delivery/personas/*.md`; `sha` from `git -C projectRoot rev-parse --short HEAD`, or `nogit`.
- `applyPlan({ plan, bd, dryRun }): { created: string[], updated: string[], depsAdded: Array<{id, blockedBy}>, skippedClosed: string[], commands: string[] }` — for each bead: `bd.show(id)`; missing → `create`; present and `closed` → skippedClosed, untouched; present → `update` only when title, parent or metadata.roadmap_ref differ, with `addLabels` for any missing label. For each dep: skip when `bd.depsOf(id)` already contains `blockedBy`. `dryRun` records what it would do in `commands` and calls nothing that writes.
- `reconcile({ plan, bd, roadmap }): { storiesWithoutBead: string[], staleRef: Array<{id, expected, actual}>, closedNotRealigned: string[], unknownRoadmapBeads: string[] }` — `storiesWithoutBead`: planned story beads with no bead in bd; `staleRef`: open beads whose `metadata.roadmap_ref` differs from the plan's; `closedNotRealigned`: phase review beads that are `closed` while the roadmap phase is not marked `(done)`; `unknownRoadmapBeads`: beads with label `roadmap` and `materialised_by: delivery` in bd that are not in the plan.
- `writeDenylist(projectRoot, entries): string` — writes `.delivery/team/denylist.txt`, one entry per line, trailing newline; returns the path.
- CLI: `node scripts/materialise.js --project <root> --initiative <slug> [--dry-run] [--check]`. Without `--check`: load, plan, apply (or dry-run), write the denylist, print a summary (`created N, updated N, deps N, skipped closed N, warnings:` then warnings) and exit 0, or exit 2 on a load error. With `--check`: load, plan, reconcile, print each drift class and exit 1 when any is non-empty, else print `No plan drift.` and exit 0.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/materialise.test.js — run with: node --test scripts/materialise.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeBd } = require('./lib/bd.js');
const { loadInputs, applyPlan, reconcile, writeDenylist } = require('./materialise.js');
const { planGraph } = require('./lib/plan-graph.js');

const PLUGIN = path.join(__dirname, '..');
const FAKE_DIR = path.join(PLUGIN, 'scripts', 'test');

function fakeEnv() {
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mat-bd-')), 'store.json');
  return { ...process.env, PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH}`, BD_FAKE_STORE: store };
}

function scratchProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-proj-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'templates', 'team.json'), path.join(root, '.delivery', 'team', 'team.json'));
  fs.copyFileSync(path.join(PLUGIN, 'templates', 'hosts.json'), path.join(root, '.delivery', 'team', 'hosts.json'));
  const init = path.join(root, '.delivery', 'initiatives', 'demo');
  fs.mkdirSync(init, { recursive: true });
  fs.writeFileSync(path.join(init, 'roadmap.md'), '# Roadmap\n\n## Phases\n\n### Phase 1: Foundations\n\n| Work item | Size | Confidence | Depends on |\n| :-- | :-- | :-- | :-- |\n| A | S | high | |\n\n### Phase 2: Beads\n\n| Work item | Size | Confidence | Depends on |\n| :-- | :-- | :-- | :-- |\n| B | M | med | A |\n');
  fs.writeFileSync(path.join(init, 'architecture.md'), '# Arch\n\n## Spikes — what must be proven\n\n| # | Question to answer | Time box | Blocks |\n| :-- | :-- | :-- | :-- |\n| 1 | Does X hold? | 1 day | Phase 1 |\n');
  fs.writeFileSync(path.join(init, 'brief.md'), '# Brief: Demo product\n');
  fs.mkdirSync(path.join(root, '.delivery', 'stories'));
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-01-first.md'), '---\nid: demo-01\ntitle: First story\nstatus: ready\nepic: demo\nphase: Phase 1\ndepends_on: []\nsize: S\n---\n# First\n');
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-02-second.md'), '---\nid: demo-02\ntitle: Second story\nstatus: ready\nepic: demo\nphase: Phase 2\ndepends_on: [demo-01]\nsize: M\n---\n# Second\n');
  fs.mkdirSync(path.join(root, '.delivery', 'personas'));
  fs.writeFileSync(path.join(root, '.delivery', 'personas', 'carl.md'), '---\nname: Casual Carl\n---\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

test('loadInputs reads everything and the git sha', () => {
  const root = scratchProject();
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  assert.equal(inputs.team.prefix, 'ex');
  assert.equal(inputs.roadmap.phases.length, 2);
  assert.equal(inputs.stories.length, 2);
  assert.equal(inputs.spikes.length, 1);
  assert.match(inputs.sha, /^[0-9a-f]{7,}$/);
  assert.deepEqual(inputs.personaNames, ['Casual Carl']);
});

test('applyPlan creates the graph, is idempotent, and never touches closed beads', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const bd = makeBd({ env });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const first = applyPlan({ plan, bd });
  assert.equal(first.created.length, 7);
  assert.ok(first.depsAdded.some((d) => d.id === 'ex-ph2' && d.blockedBy === 'ex-ph1-review'));
  assert.deepEqual(bd.depsOf('ex-demo-02'), ['ex-demo-01']);
  const second = applyPlan({ plan, bd });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, []);
  assert.deepEqual(second.depsAdded, []);
  bd.exec(['close', 'ex-demo-01', '--reason', 'EVIDENCE: shipped']);
  const renamed = { ...plan, beads: plan.beads.map((b) => (b.id === 'ex-demo-01' ? { ...b, title: 'Renamed' } : b)) };
  const third = applyPlan({ plan: renamed, bd });
  assert.deepEqual(third.skippedClosed, ['ex-demo-01']);
  assert.equal(bd.show('ex-demo-01').title, 'First story');
});

test('applyPlan updates title and roadmap_ref when the document changed', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd });
  const plan2 = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'newsha1', roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan: plan2, bd });
  assert.ok(r.updated.includes('ex-ph1'));
  assert.equal(bd.show('ex-ph1').metadata.roadmap_ref, 'demo/roadmap.md@newsha1 phase 1');
});

test('applyPlan dryRun writes nothing and lists commands', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const r = applyPlan({ plan, bd, dryRun: true });
  assert.equal(bd.show('ex-ph1'), null);
  assert.ok(r.commands.some((c) => c.startsWith('create ex-ph1')));
  assert.ok(r.commands.some((c) => c.startsWith('dep ex-ph2 blocked-by ex-ph1-review')));
});

test('reconcile reports each drift class', () => {
  const root = scratchProject();
  const bd = makeBd({ env: fakeEnv() });
  const inputs = loadInputs({ projectRoot: root, initiative: 'demo' });
  const plan = planGraph({ prefix: 'ex', initiative: 'demo', sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  applyPlan({ plan, bd });
  assert.deepEqual(reconcile({ plan, bd, roadmap: inputs.roadmap }), { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [] });
  // drift: a new story without a bead, a stale ref, a closed review, a stray roadmap bead
  const planB = planGraph({ prefix: 'ex', initiative: 'demo', sha: 'zzz', roadmap: inputs.roadmap, stories: [...inputs.stories, { id: 'demo-03', title: 'Third', status: 'ready', phase: '2', dependsOn: [], file: '/x/demo-03.md' }], spikes: inputs.spikes });
  bd.exec(['close', 'ex-ph1-review', '--reason', 'EVIDENCE: reviewed']);
  bd.create({ id: 'ex-stray', title: 'stray', labels: ['roadmap'], metadata: { materialised_by: 'delivery' } });
  const d = reconcile({ plan: planB, bd, roadmap: inputs.roadmap });
  assert.deepEqual(d.storiesWithoutBead, ['ex-demo-03']);
  assert.ok(d.staleRef.some((x) => x.id === 'ex-ph2' && x.expected.includes('@zzz')));
  assert.deepEqual(d.closedNotRealigned, ['ex-ph1-review']);
  assert.deepEqual(d.unknownRoadmapBeads, ['ex-stray']);
});

test('writeDenylist writes one entry per line', () => {
  const root = scratchProject();
  const p = writeDenylist(root, ['Alpha', 'Beta']);
  assert.equal(fs.readFileSync(p, 'utf8'), 'Alpha\nBeta\n');
});

test('CLI materialises then reports no drift, and exits 1 on drift', () => {
  const root = scratchProject();
  const env = fakeEnv();
  const script = path.join(PLUGIN, 'scripts', 'materialise.js');
  const out = execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo'], { env }).toString();
  assert.match(out, /created 7/);
  assert.ok(fs.existsSync(path.join(root, '.delivery', 'team', 'denylist.txt')));
  const check = execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--check'], { env }).toString();
  assert.match(check, /No plan drift/);
  fs.writeFileSync(path.join(root, '.delivery', 'stories', 'demo-03-third.md'), '---\nid: demo-03\ntitle: Third\nstatus: ready\nepic: demo\nphase: Phase 2\ndepends_on: []\nsize: S\n---\n');
  assert.throws(() => execFileSync(process.execPath, [script, '--project', root, '--initiative', 'demo', '--check'], { env, stdio: 'pipe' }), (err) => err.status === 1 && String(err.stdout).includes('ex-demo-03'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test plugins/delivery/scripts/materialise.test.js`
Expected: FAIL with "Cannot find module './materialise.js'"

- [ ] **Step 3: Write the implementation**

```js
#!/usr/bin/env node
// scripts/materialise.js — document plans, beads execute. The only writer of bead structure.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProjectRoot, loadManifest } = require('./lib/manifest.js');
const { parseFrontmatter } = require('./lib/compose-brief.js');
const { parseRoadmap, parseStories, parseSpikes } = require('./lib/plan-docs.js');
const { planGraph, denylistFrom } = require('./lib/plan-graph.js');
const { makeBd } = require('./lib/bd.js');

function readIf(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

function gitSha(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (err) { return 'nogit'; }
}

function personaNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, ''));
    return meta.name ? String(meta.name) : null;
  }).filter(Boolean);
}

function loadInputs({ projectRoot, initiative }) {
  const { team } = loadManifest(projectRoot);
  const init = path.join(projectRoot, '.delivery', 'initiatives', initiative);
  const roadmapFile = path.join(init, 'roadmap.md');
  if (!fs.existsSync(roadmapFile)) throw new Error(`materialise: roadmap not found at ${roadmapFile}`);
  return {
    team,
    roadmap: parseRoadmap(fs.readFileSync(roadmapFile, 'utf8')),
    stories: parseStories(path.join(projectRoot, '.delivery', 'stories')),
    spikes: parseSpikes(readIf(path.join(init, 'architecture.md'))),
    sha: gitSha(projectRoot),
    briefText: readIf(path.join(init, 'brief.md')),
    prdText: readIf(path.join(init, 'prd.md')),
    personaNames: personaNames(path.join(projectRoot, '.delivery', 'personas')),
  };
}

function sameMeta(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

function applyPlan({ plan, bd, dryRun }) {
  const result = { created: [], updated: [], depsAdded: [], skippedClosed: [], commands: [] };
  for (const b of plan.beads) {
    const existing = bd.show(b.id);
    if (!existing) {
      result.commands.push(`create ${b.id} "${b.title}"`);
      if (!dryRun) bd.create({ id: b.id, title: b.title, type: b.type, parent: b.parent || undefined, labels: b.labels, metadata: b.metadata, priority: b.priority });
      result.created.push(b.id);
      continue;
    }
    if (existing.status === 'closed') { result.skippedClosed.push(b.id); continue; }
    const missingLabels = b.labels.filter((l) => !(existing.labels || []).includes(l));
    const refChanged = (existing.metadata || {}).roadmap_ref !== b.metadata.roadmap_ref;
    const titleChanged = existing.title !== b.title;
    const parentChanged = (existing.parent || null) !== (b.parent || null);
    if (!missingLabels.length && !refChanged && !titleChanged && !parentChanged) continue;
    result.commands.push(`update ${b.id}`);
    if (!dryRun) bd.update(b.id, { title: titleChanged ? b.title : undefined, parent: parentChanged ? b.parent : undefined, addLabels: missingLabels, metadata: refChanged || !sameMeta(existing.metadata, { ...existing.metadata, ...b.metadata }) ? b.metadata : undefined });
    result.updated.push(b.id);
  }
  const cache = new Map();
  const blockers = (id) => { if (!cache.has(id)) cache.set(id, dryRun && result.created.includes(id) ? [] : bd.depsOf(id)); return cache.get(id); };
  for (const d of plan.deps) {
    if (!dryRun && (blockers(d.id).includes(d.blockedBy))) continue;
    if (dryRun && !result.created.includes(d.id) && blockers(d.id).includes(d.blockedBy)) continue;
    result.commands.push(`dep ${d.id} blocked-by ${d.blockedBy}`);
    if (!dryRun) { bd.depAdd(d.id, d.blockedBy); cache.get(d.id).push(d.blockedBy); }
    result.depsAdded.push(d);
  }
  return result;
}

function reconcile({ plan, bd, roadmap }) {
  const out = { storiesWithoutBead: [], staleRef: [], closedNotRealigned: [], unknownRoadmapBeads: [] };
  const planned = new Map(plan.beads.map((b) => [b.id, b]));
  const doneByPhase = new Map(roadmap.phases.map((p) => [p.number, p.done]));
  for (const b of plan.beads) {
    const existing = bd.show(b.id);
    if (!existing) { if (b.labels.includes('story')) out.storiesWithoutBead.push(b.id); continue; }
    if (existing.status !== 'closed' && (existing.metadata || {}).roadmap_ref !== b.metadata.roadmap_ref) {
      out.staleRef.push({ id: b.id, expected: b.metadata.roadmap_ref, actual: (existing.metadata || {}).roadmap_ref || '' });
    }
    if (b.labels.includes('phase-review') && existing.status === 'closed') {
      const phase = b.docId.replace(/^phase-/, '').replace(/-review$/, '');
      if (!doneByPhase.get(phase)) out.closedNotRealigned.push(b.id);
    }
  }
  for (const b of bd.list({ label: 'roadmap', all: true })) {
    if ((b.metadata || {}).materialised_by === 'delivery' && !planned.has(b.id)) out.unknownRoadmapBeads.push(b.id);
  }
  return out;
}

function writeDenylist(projectRoot, entries) {
  const file = path.join(projectRoot, '.delivery', 'team', 'denylist.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.length ? `${entries.join('\n')}\n` : '');
  return file;
}

function hasDrift(d) { return d.storiesWithoutBead.length || d.staleRef.length || d.closedNotRealigned.length || d.unknownRoadmapBeads.length; }

function renderDrift(d) {
  const lines = ['## Plan drift'];
  if (d.storiesWithoutBead.length) lines.push(`Stories without a bead: ${d.storiesWithoutBead.join(', ')}`);
  for (const s of d.staleRef) lines.push(`Stale roadmap_ref: ${s.id} expected ${s.expected}, has ${s.actual || 'none'}`);
  if (d.closedNotRealigned.length) lines.push(`Phase review closed but roadmap not marked (done): ${d.closedNotRealigned.join(', ')}`);
  if (d.unknownRoadmapBeads.length) lines.push(`Roadmap beads not in the plan: ${d.unknownRoadmapBeads.join(', ')}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--check') { out.flags.add(a.slice(2)); continue; }
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { out.error = `${a} needs a value`; return out; } out[a.slice(2)] = v; i++; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(`materialise: ${args.error}`); process.exit(2); }
  const root = args.project ? path.resolve(args.project) : findProjectRoot(process.cwd());
  if (!root) { console.error('materialise: no .delivery/team/team.json found; pass --project <root>'); process.exit(2); }
  if (!args.initiative) { console.error('materialise: --initiative <slug> is required'); process.exit(2); }
  let inputs;
  try { inputs = loadInputs({ projectRoot: root, initiative: args.initiative }); } catch (err) { console.error(`materialise: ${err.message}`); process.exit(2); }
  const plan = planGraph({ prefix: inputs.team.prefix, initiative: args.initiative, sha: inputs.sha, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes });
  const bd = makeBd({ cwd: root });
  try {
    if (args.flags.has('check')) {
      const d = reconcile({ plan, bd, roadmap: inputs.roadmap });
      if (hasDrift(d)) { console.log(renderDrift(d)); process.exit(1); }
      console.log('No plan drift.');
      process.exit(0);
    }
    const r = applyPlan({ plan, bd, dryRun: args.flags.has('dry-run') });
    const denylist = writeDenylist(root, denylistFrom({ initiative: args.initiative, roadmap: inputs.roadmap, stories: inputs.stories, spikes: inputs.spikes, briefText: inputs.briefText, prdText: inputs.prdText, personaNames: inputs.personaNames }));
    console.log(`${args.flags.has('dry-run') ? 'dry run: ' : ''}created ${r.created.length}, updated ${r.updated.length}, deps ${r.depsAdded.length}, skipped closed ${r.skippedClosed.length}; roadmap ${args.initiative}/roadmap.md@${inputs.sha}; denylist ${denylist} (${fs.readFileSync(denylist, 'utf8').split('\n').filter(Boolean).length} entries)`);
    if (args.flags.has('dry-run')) for (const c of r.commands) console.log(`  ${c}`);
    if (plan.warnings.length) { console.log('warnings:'); for (const w of plan.warnings) console.log(`  ${w}`); }
  } catch (err) {
    console.error(`materialise: ${err.message}`);
    process.exit(2);
  }
}

module.exports = { loadInputs, applyPlan, reconcile, writeDenylist, renderDrift, hasDrift };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/delivery/scripts/materialise.test.js`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/delivery/scripts/materialise.js plugins/delivery/scripts/materialise.test.js
git commit -m "delivery: materialise (apply plan to beads, reconcile, denylist, CLI)"
```

---

### Task 5: Runner contract and the standing spike role

**Files:**
- Modify: `scripts/lib/manifest.js` (validate `runner`), `scripts/lib/manifest.test.js`, `roles/builder.md`, `roles/delivery-lead.md`, `templates/team.json`
- Create: `roles/spike-researcher.md`

**Interfaces:**
- `validateManifest` adds a problem `team.json: role "<id>" has runner "<x>", expected one of superpowers, attractor, plain` when `runner` is present and not one of those. Export `RUNNERS` as a `Set`.
- Builder brief gains a `## Runner` section whose text is chosen at compose time? No: keep the brief static and describe all three loops; the manifest's `runner` is exported to the session as `DELIVERY_RUNNER` by prepare-role (one more env key) and the brief says "your runner is named in DELIVERY_RUNNER".

- [ ] **Step 1: Add the failing manifest test**

Append to `scripts/lib/manifest.test.js`:

```js
test('validateManifest rejects an unknown runner and accepts the three known ones', () => {
  const root = scratchProject();
  const { team, hosts } = loadManifest(root);
  const builder = team.roles.find((r) => r.id === 'builder');
  builder.runner = 'magic';
  assert.ok(validateManifest(team, hosts).some((p) => p.includes('runner "magic"')));
  for (const r of ['superpowers', 'attractor', 'plain']) {
    builder.runner = r;
    assert.ok(!validateManifest(team, hosts).some((p) => p.includes('runner')));
  }
});
```

Run: `node --test plugins/delivery/scripts/lib/manifest.test.js` → the new test FAILS (no runner check).

- [ ] **Step 2: Implement the runner check**

In `scripts/lib/manifest.js`: add `const RUNNERS = new Set(['superpowers', 'attractor', 'plain']);` next to `MODELS`; inside the role loop of `validateManifest` add:

```js
    if (role.runner !== undefined && !RUNNERS.has(role.runner)) problems.push(`team.json: role "${role.id}" has runner "${role.runner}", expected one of ${[...RUNNERS].join(', ')}`);
```

and add `RUNNERS` to `module.exports`. In `scripts/prepare-role.js`, where the env block is built, add `DELIVERY_RUNNER: role.runner || 'plain'` for every role (harmless for non-builders). Update `prepare-role.test.js`'s builder test to assert `settings.env.DELIVERY_RUNNER === 'superpowers'`.

Run both test files → PASS.

- [ ] **Step 3: Replace `roles/builder.md` with**

```markdown
---
id: builder
touches_code: true
default_model: sonnet
mode: default
---

## As a session

You build. Your runner is named in the environment variable `DELIVERY_RUNNER`; the loop is the same for all three, only the middle step differs.

1. `bd ready`. Claim one story bead with `bd update <id> --claim` and append a note saying who you are and your worktree. Read the story file named in the bead's metadata (`story_file` under `.delivery/stories/`); it is your complete brief. If the bead is a spike, leave it: spikes belong to the Spike Researcher.
2. Build it with your runner, in your own worktree and your own lane:
   - `superpowers`: skip brainstorming (the story is the design). Use `superpowers:writing-plans` on the story, then `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every plan task commits with `Refs <bead id>`.
   - `attractor`: use `/attractorify` to turn the story into a pipeline (or run the initiative's existing `.dot` with `--param story=<id>`), then run it and read its terminal status; a pipeline that did not reach a real terminal status is not done.
   - `plain`: implement it yourself, test-first, committing small steps.
3. Record every step in the bead as it happens (`bd update <id> --append-notes`). Open a pull request whose body says `Refs <bead id>` and describes the change to the product, never the plan or the story title.
4. Close only with evidence: `bd close <id> --reason "EVIDENCE: ..."` when every acceptance criterion in the story has proof. Status is three words: merged, deployed, verified.

Work found while building gets its own child bead under the one you hold. You never create top-level beads, re-parent, or change dependencies; you never create GitHub issues; you never write plan or strategy words into the product repository.
```

- [ ] **Step 4: Create `roles/spike-researcher.md`**

```markdown
---
id: spike-researcher
touches_code: false
default_model: sonnet
mode: default
---

## As a session

You derisk the plan. You claim `spike` beads (`bd ready`, then `bd update <id> --claim`) and answer the question each one carries: what decision it gates, and what answer would change that decision.

Your output is a sourced answer or a throwaway experiment, never product code. Research with web search and the documentation; experiment in a scratch worktree or directory that is deleted afterwards. Mark every claim with its source or the command that produced it, and say plainly what remains unverified.

Record the result in three places: the bead (`bd update <id> --append-notes "EVIDENCE: ..."` then `bd close <id> --reason "EVIDENCE: <answer in one line>"`), the ADR or roadmap section the spike gates (edit the document in the project repository and commit it with `Refs <bead id>`), and one message to the Delivery Lead naming the bead and the answer. The challenge panel reads your result at the next gate.

A time box is a promise: when it runs out, close the bead with what you have and what you could not settle, rather than extending silently. A technical unknown you meet in someone else's bead becomes a new spike bead under it; you never turn an unknown into a question for the operator.

You never take build beads and never ship code.
```

- [ ] **Step 5: In `roles/delivery-lead.md`, replace the paragraph starting "Structure flows from the roadmap document" with**

```markdown
Structure flows from the roadmap document to beads through `/delivery:materialise`, which you run after every roadmap change, after every architecture change that adds or removes spikes, and after realign. It is deterministic and idempotent: same documents, same beads. Every epic, story, spike and phase-review bead carries its roadmap reference. Spike beads block the stories or phases they derisk, so `bd ready` surfaces them first; you order them and the Spike Researcher claims them.
```

- [ ] **Step 6: In `templates/team.json` add the standing spike role** after `progress-observer`:

```json
    { "id": "spike-researcher", "brief": "delivery/spike-researcher", "host": "pc", "model": "sonnet" },
```

Then update the tests that enumerate template instances: in `manifest.test.js` the `expandInstances` expectation becomes `['chief-of-staff', 'staffing', 'product-manager', 'delivery-lead', 'progress-observer', 'spike-researcher', 'builder-1', 'builder-2']`; in `team-status.test.js` the empty-roster test expects 8 rows and the missing list gains `spike-researcher` after `progress-observer`, and the no-drift test registers `['spike-researcher', 'sonnet']` too; in `role-context.test.js` and `prepare-role.test.js` nothing enumerates instances by count (confirm with `grep -n "7\b\|builder-2'\]" plugins/delivery/scripts/*.test.js plugins/delivery/hooks/scripts/*.test.js` and fix any that do).

- [ ] **Step 7: Run every test file and commit**

Run: `node --test plugins/delivery/scripts/lib/*.test.js plugins/delivery/scripts/*.test.js plugins/delivery/hooks/scripts/*.test.js`
Expected: all PASS.

```bash
git add plugins/delivery/scripts/lib/manifest.js plugins/delivery/scripts/lib/manifest.test.js plugins/delivery/scripts/prepare-role.js plugins/delivery/scripts/prepare-role.test.js plugins/delivery/roles plugins/delivery/templates/team.json plugins/delivery/scripts/team-status.test.js
git commit -m "delivery: runner contract (superpowers|attractor|plain), standing spike-researcher role, delivery-lead owns materialise"
```

---

### Task 6: Skills, docs, version

**Files:**
- Create: `skills/materialise/SKILL.md`
- Modify: `skills/team/SKILL.md`, `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (root)

- [ ] **Step 1: Write `skills/materialise/SKILL.md`**

```markdown
---
description: Turn an initiative's roadmap, stories and architecture spikes into the bead graph the team executes — one epic per phase chained by phase reviews, one task per story, one task per spike blocking what it derisks — and regenerate the denylist. Deterministic and idempotent; run by the Delivery Lead after every roadmap, story or spike change and after realign. Pass --check to report drift without writing.
argument-hint: "<initiative> [--dry-run | --check]"
---

# Materialise the plan into beads

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

Only the Delivery Lead runs this without `--check`; anyone may run `--check`. Structure flows from documents to beads here and nowhere else: never create epics, re-parent, or add dependencies by hand.

1. Resolve the project root (marker `project_root`, then `DELIVERY_PROJECT_ROOT`, then upward search) and the initiative slug from `$ARGUMENTS` or the current initiative. Confirm `bd prime` answers; if not, stop and say so.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project <root> --initiative <slug> --dry-run` and show the command list. If the warnings name a story with a phase not in the roadmap, or a spike whose `Blocks` matched nothing, fix the document first (or tell the Product Manager) rather than materialising around it.
3. Run it again without `--dry-run`. Show the summary line and the warnings verbatim. Append one note to the first phase epic: `bd update <prefix>-ph<first> --append-notes "<date>: materialised <initiative>/roadmap.md@<sha> by <your instance>"`.
4. Commit `.delivery/team/denylist.txt` in the project repository (`git add .delivery/team/denylist.txt && git commit -m "team: denylist from materialise <sha>"`) and tell the operator through the Chief of Staff that the denylist changed, so they can review it once.
5. With `--check`: run with `--check`, show the output verbatim, and say who owns each drift class: stories without a bead, stale references and stray roadmap beads are yours (re-run materialise or fix the document); a closed phase review with the roadmap not marked `(done)` belongs to the Product Manager (run realign).
```

- [ ] **Step 2: In `skills/team/SKILL.md` add a step 4**

```markdown
4. Plan drift. For each initiative under `.delivery/initiatives/` that has a `roadmap.md`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project <root> --initiative <slug> --check` and show its output. The Delivery Lead owns stories without a bead, stale references and stray roadmap beads; the Product Manager owns a closed phase review whose roadmap phase is not marked `(done)`.
```

- [ ] **Step 3: README.** Under "The shipping team (phase 1)" rename the heading to "The shipping team" and add after the existing bullets:

```markdown
- `/delivery:materialise <initiative>` — turns `roadmap.md`, the stories and the architecture spikes into
  beads: one epic per phase chained by a phase-review bead, one task per story, one task per spike
  blocking the story or phase it derisks. Deterministic ids (`<prefix>-ph<N>`, `<prefix>-<story id>`,
  `<prefix>-spike-<key>`), idempotent, never touches closed beads. `--check` reports drift. It also
  writes `.delivery/team/denylist.txt`, the phrases the leak-prevention hooks block in the product repo.
- Runners. A builder's manifest entry names its runner: `superpowers`, `attractor` (the attractor
  plugin's pipeline), or `plain`. Delivery plans, dispatches and reviews; the runner builds.
- Spikes are standing work: the Spike Researcher claims `spike` beads emitted from the architecture
  document and records answers in the bead and the ADR or roadmap they gate.
```

- [ ] **Step 4: Bump versions** to `0.18.0` in `plugins/delivery/.claude-plugin/plugin.json` and the delivery entry of the root `.claude-plugin/marketplace.json` (single-line changes only).

- [ ] **Step 5: Full suite, commit, push**

Run: `node --test plugins/delivery/scripts/lib/*.test.js plugins/delivery/scripts/*.test.js plugins/delivery/hooks/scripts/*.test.js`
Expected: all PASS, pristine.

```bash
git add plugins/delivery/skills/materialise plugins/delivery/skills/team/SKILL.md plugins/delivery/README.md plugins/delivery/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "delivery: 0.18.0 — materialise skill, team plan drift, runner and spike docs"
git push -u origin delivery-shipping-team-2a
```

---

## Self-review against the spec

- 7.1 structure document → beads, single writer, deterministic, idempotent, roadmap-ref on every bead: Tasks 3 and 4.
- 4.3a spikes first-class, blocking what they derisk, standing role, anyone may raise one mid-task: Task 3 (planner), Task 5 (role brief; "anyone may raise" is a brief rule, the hook that allows child creation is phase 2b).
- 7.3 phase gate bead: Task 3. Triggered and cadence reviews are routines (phase 4).
- 7.4 pivot: re-running materialise re-threads dependencies and updates refs; deferring open beads on a removed phase is reported as `unknownRoadmapBeads` for the Delivery Lead to act on, not automated (spec says "re-parented or marked deferred with the reason", which needs human reasoning about where they go).
- 7.5 reconcile owner and drift classes: Task 4 reconcile plus Task 6 team skill.
- 8.1 denylist generation: Task 3 and 4. The hooks that consume it are phase 2b.
- Runner contract and builder loop: Task 5. Spec 2 names the three runners.
- 13 testing: every script tested against the fake bd and scratch repos; CLI exit codes tested.
- Known limitation to carry into 2b/3: the fake bd's JSON shapes for `show`, `dep list` and `list` are assumptions about the real `bd` 1.2 output; `bd.js` normalises array-or-object replies, and a one-time manual run of `materialise.js --dry-run` against the Vault's real Dolt beads on wintermute must confirm the field names (`labels`, `metadata`, `parent`, `status`, `blocked_by`/`depends_on_id`) before phase 3 relies on them.
