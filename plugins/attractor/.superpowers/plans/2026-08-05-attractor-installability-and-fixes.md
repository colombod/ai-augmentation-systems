# Attractor installability, retry-target fix, embedded-lint refusal, HAND-001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four PRD-unblocked requirement groups from `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/architecture.md`: plugin installability (FR-1–4), the D7 retry-target scoping bug (FR-10), the F10 embedded-`Engine` lint refusal (FR-11), and the HAND-001 lint rule for unregistered handler kinds (FR-17a).

**Architecture:** Four independent, sequential tasks. Task 1 creates the plugin manifest pair and skill (net-new files, zero engine changes). Task 2 fixes `resolveRetryTarget`'s scope with a required third argument. Task 3 relocates four exports to break a circular import, then adds a lint-refusal check to `Engine.run()`. Task 4 adds a new lint rule built on a hand-authored constant closed by an anchor test. Full design in `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/architecture.md` and ADR-001, ADR-003, ADR-004, ADR-005 (`plugins/attractor/.delivery/decisions/`).

**Tech Stack:** TypeScript (native type stripping, Node >= 24), `node:test`, esbuild.

**Explicitly out of scope:** FR-5, FR-6, FR-7, FR-8 (S2, human gate) and ADR-002. These are on hold pending reconciliation between two competing designs — see `plugins/attractor/.superpowers/carry-forward.md` under "Plan 4". Do not touch `handlers/human.ts`, `Handler.HUMAN` registration, or anything human-gate-related in this plan.

## Global Constraints

- Node >= 24, native TypeScript type stripping, no build step for tests. **No `enum`, `namespace`, `declare`, or constructor parameter properties** — use `const` objects with `as const` plus a derived union (`plugins/attractor/AGENTS.md`).
- Explicit `.ts` extensions on relative imports; `node:` prefix on builtins; ESM only.
- **Exactly two dependencies**: `@ts-graphviz/ast` (runtime), `esbuild` (dev). This plan adds **zero** new dependencies — verified in `architecture.md`'s NFR-6 row. If any task seems to need a new package, stop and ask; do not add one.
- `dist/attractor.js` is committed, not git-ignored. Rebuild it (`cd plugins/attractor/engine && npm run build`) as the last step of every task that touches `engine/src/`, and re-run the full suite (`node --test`) afterward — the bundle test (`bundle.test.ts`) fails loudly if the two drift.
- No emoji anywhere: source, tests, commit messages, docs, CLI output.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Mutation-check every new test**: break the behavior it claims to verify, confirm the test fails, restore. A test that passes with its feature deleted is worse than no test.
- **When a guard both permits and forbids, test both directions** — the refusal path AND its success path.
- **Verify a fix actually fixes**: reproduce the original bug against the new code before claiming victory.
- Baseline before this plan starts: 464 tests, 463 pass, 1 skipped (`live.test.ts`, needs real `claude -p`), 0 fail.

---

### Task 1: Plugin installability — `plugin.json`, `marketplace.json`, the `attractor` skill, FR-4's test gap

**Files:**
- Create: `plugins/attractor/.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json` (repo root — first one this repo has ever had)
- Create: `plugins/attractor/skills/attractor/SKILL.md`
- Create: `plugins/attractor/engine/test/manifest.test.ts`
- Modify: `plugins/attractor/engine/test/doctor.test.ts` (FR-4 coverage gap)
- Modify: `plugins/attractor/engine/src/doctor.ts:45` (one-line stale comment fix, found while reading this file for this task)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks consume. Fully independent; may be done in any order relative to Tasks 2-4.

- [ ] **Step 1: Create `plugin.json`**

```json
{
  "name": "attractor",
  "version": "0.1.0",
  "description": "DOT-graph convergence orchestration for Claude Code: nodes are computation, edges are dispatch, LLM nodes run as claude -p subprocesses.",
  "author": { "name": "Diego Colombo" },
  "license": "MIT",
  "keywords": ["orchestration", "pipeline", "dot", "graphviz"]
}
```

No `skills`/`commands`/`agents` path fields — the platform's default `skills/` directory scan finds `skills/attractor/SKILL.md` on its own (ADR-001). No `homepage`/`repository` — this repo has no git remote configured; do not invent one.

- [ ] **Step 2: Create `marketplace.json` at the repo root**

```json
{
  "name": "ai-augmentation-systems",
  "owner": { "name": "Diego Colombo" },
  "version": "0.1.0",
  "plugins": [
    {
      "name": "attractor",
      "source": "./plugins/attractor",
      "description": "DOT-graph convergence orchestration for Claude Code: nodes are computation, edges are dispatch, LLM nodes run as claude -p subprocesses."
    }
  ]
}
```

**No `version` field on the `attractor` entry inside `plugins[]`.** ADR-001: the platform always uses `plugin.json`'s version silently, so a duplicated version here can only go stale and mask the real one. This is the *first* entry in this array — per `AGENTS.md`'s cross-plugin rule, any later plugin appends after it and never reorders it.

- [ ] **Step 3: Create the `attractor` skill**

`plugins/attractor/skills/attractor/SKILL.md`:

```markdown
---
name: attractor
description: Run, lint, and check preflight for attractor DOT-graph pipelines -- nodes are computation, edges are dispatch, LLM nodes run as claude -p subprocesses. Use when the user wants to author, validate, or execute an attractor pipeline (.dot file).
---

# attractor

DOT-graph pipeline orchestration. A `.dot` file is a program: nodes are
computation, edges are dispatch. See `README.md` in this plugin for the full
node-shape reference and example pipelines.

Invoke the CLI via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/attractor.js" <command> [args]
```

## Commands

- `lint <file.dot>` — validate a pipeline without running it. Always do this
  before `run`.
- `run <file.dot> [--param key=value]... [--cwd dir] [--run-dir dir] [--stub]
  [--model name] [--max-budget-usd n] [--allow-tools tool,tool,...]
  [--worktree] [--in-place]` — execute a pipeline.
- `doctor` — check the local machine has what a run needs (`claude`, `git`,
  `sh`; optionally `bun`, `dot`).

Run `doctor` first if unsure whether the environment is ready. Always `lint`
a graph before `run`ning it — a lint ERROR means the run will refuse to start.
```

The frontmatter `name: attractor` is set explicitly. Per the platform's own docs: without it, Claude Code falls back to the install directory name, which for a marketplace install is a version string that changes on every update.

- [ ] **Step 4: Write the manifest self-consistency test**

`plugins/attractor/engine/test/manifest.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '../..')
const repoRoot = resolve(here, '../../../..')

test('plugin.json is valid JSON with a name and a semver version', () => {
  const raw = readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')
  const manifest = JSON.parse(raw)
  assert.equal(manifest.name, 'attractor')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

test('marketplace.json carries exactly one attractor entry, sourced at plugins/attractor, no per-entry version', () => {
  const raw = readFileSync(resolve(repoRoot, '.claude-plugin/marketplace.json'), 'utf8')
  const marketplace = JSON.parse(raw)
  const entries = marketplace.plugins.filter((p: { name: string }) => p.name === 'attractor')
  assert.equal(entries.length, 1, 'exactly one attractor entry')
  assert.equal(entries[0].source, './plugins/attractor')
  assert.equal(
    entries[0].version,
    undefined,
    'no per-entry version -- ADR-001: the platform always uses plugin.json\'s value, so a duplicate here can only go stale',
  )
})

test('the attractor skill sets its name explicitly in frontmatter', () => {
  const raw = readFileSync(resolve(pluginRoot, 'skills/attractor/SKILL.md'), 'utf8')
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(frontmatter, 'SKILL.md must have YAML frontmatter')
  assert.match(frontmatter![1], /^name:\s*attractor\s*$/m)
})
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd plugins/attractor/engine && node --test test/manifest.test.ts`
Expected: 3 pass, 0 fail. (There is no "write it failing first" step here — steps 1-3 already created the files these tests check; this is verification, not TDD, because FR-1/FR-2/FR-3's actual behavior is validated by Claude Code's own manifest loader, not by code this repo owns. See ADR-001 and architecture.md §"FR-3 — the one requirement with no code to write".)

- [ ] **Step 6: FR-4's coverage gap — a test exercising `claude` specifically absent from PATH**

`doctor.test.ts`'s existing tests use a fake binary name or hand-built `Check[]`; neither calls `probeTool('claude', ...)` against a genuinely `claude`-absent `PATH`. Add, near the existing `probeTool` tests in `plugins/attractor/engine/test/doctor.test.ts`:

```ts
test('claude specifically is reported MISSING when absent from PATH', () => {
  const originalPath = process.env.PATH
  try {
    process.env.PATH = ''
    const check = probeTool('claude', ['--version'], true)
    assert.equal(check.ok, false)
    assert.equal(check.detail, 'not found')
  } finally {
    process.env.PATH = originalPath
  }
})
```

Confirm `probeTool` is already imported in this test file (it is — `doctor.ts` exports it for tests). If not, add `import { probeTool } from '../src/doctor.ts'` to the existing import block.

- [ ] **Step 7: Run it to verify it passes against the existing, already-correct code**

Run: `cd plugins/attractor/engine && node --test test/doctor.test.ts`
Expected: all pass, including the new one. `runChecks()` already calls `probe('claude', ['--version'], true)` as its first check (confirmed by reading `doctor.ts`) — this test is a coverage assertion, not a bug fix.

- [ ] **Step 8: Mutation-check the new doctor test**

Temporarily change `probe('claude', ...)`'s `required` argument from `true` to `false` in `runChecks()` (`doctor.ts:42`), confirm `checksPass()`-adjacent behavior in the new test still correctly distinguishes `ok: false` — actually, simpler and sufficient: temporarily hardcode `probeTool` to always return `{ok: true, ...}` regardless of `PATH`, confirm the new test fails, then revert. This proves the test isn't vacuously true.

- [ ] **Step 9: Fix the stale "Plan 3" comment found while reading this file**

`doctor.ts:45-46` currently reads:

```ts
    // Optional: the Discord channel plugin is a Bun script (Plan 3), and
    // Graphviz renders images (Plan 5). Neither blocks running a pipeline.
```

`plugins/attractor/.superpowers/carry-forward.md` records that the roster was renumbered and the human-gates/Discord-bridge plan is now **Plan 4**, not Plan 3 (Plan 3 landed as the spec-correction plan). Change to:

```ts
    // Optional: the Discord channel plugin is a Bun script (Plan 4), and
    // Graphviz renders images (Plan 6). Neither blocks running a pipeline.
```

(Plan 5 in the current roster is parallel execution, not visualization — visualization is Plan 6. Verify against `carry-forward.md`'s "Current sequence" line before committing this, in case the roster shifts again before this task runs.)

- [ ] **Step 10: Rebuild the bundle and run the full suite**

Run:
```bash
cd plugins/attractor/engine && npm run build && node --test
```
Expected: 468 tests (464 baseline + 3 from `manifest.test.ts` + 1 new `doctor.test.ts` case), all pass except the 1 pre-existing skip, 0 fail.

- [ ] **Step 11: Commit**

```bash
git add plugins/attractor/.claude-plugin/plugin.json .claude-plugin/marketplace.json \
  plugins/attractor/skills/attractor/SKILL.md plugins/attractor/engine/test/manifest.test.ts \
  plugins/attractor/engine/test/doctor.test.ts plugins/attractor/engine/src/doctor.ts \
  plugins/attractor/dist/attractor.js
git commit -m "feat(attractor): first plugin.json/marketplace.json pair, attractor skill (FR-1-4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: FR-10 — `resolveRetryTarget` no longer leaks the graph-level fallback into plain-node failures (D7)

**Files:**
- Modify: `plugins/attractor/engine/src/core/retry.ts` (the function signature)
- Modify: `plugins/attractor/engine/src/core/engine.ts:423`, `:1021`, `:1165` (three call sites)
- Modify: `plugins/attractor/engine/src/dot/lint.ts:842` (GATE-001's own call site) — plus prune now-dead code at lines 844-860
- Modify: `plugins/attractor/engine/test/retry.test.ts` (existing call sites need the new argument)
- Modify: `plugins/attractor/engine/test/lint.test.ts:910-927` (GATE-001's graph-level-fallback test must be rewritten, not just recompiled)
- Test: `plugins/attractor/engine/test/engine.test.ts` (two new fixtures)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `resolveRetryTarget(node: Node, graph: Graph, opts: { includeGraphLevel: boolean }): string | null` — the new required third parameter. Not consumed by Tasks 3 or 4.

- [ ] **Step 1: Write the failing unit test for the new option**

In `plugins/attractor/engine/test/retry.test.ts`, find the existing `resolveRetryTarget` tests (there are three call sites at lines 86, 90, 105 per the codebase today — locate them exactly, they will need a third argument added in Step 5). Add a new test near them:

```ts
test('graph-level retry_target is suppressed when the caller says includeGraphLevel: false', () => {
  const G = parseDot(`
    digraph G {
      retry_target="fallback"
      start [shape=Mdiamond] fallback [shape=box, prompt="x"] strict [shape=box, prompt="y"]
      start -> strict
    }
  `)
  const node = G.nodes.get('strict')!
  assert.equal(resolveRetryTarget(node, G, { includeGraphLevel: false }), null)
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd plugins/attractor/engine && node --test test/retry.test.ts`
Expected: FAIL — `resolveRetryTarget` currently takes two arguments; TypeScript's native type stripping will run it anyway (no type checking at runtime) but the call will pass an unused third argument, and the function will still consult the graph-level `retry_target`, so the assertion `=== null` fails (actual: `'fallback'`).

- [ ] **Step 3: Change `resolveRetryTarget`'s signature**

In `plugins/attractor/engine/src/core/retry.ts`, replace:

```ts
export function resolveRetryTarget(node: Node, graph: Graph): string | null {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    graph.attrs.retry_target,
    graph.attrs.fallback_retry_target,
  ]
  for (const c of candidates) {
    if (c && graph.nodes.has(c)) return c
  }
  return null
}
```

with:

```ts
export interface ResolveRetryTargetOptions {
  /**
   * True only for section 3.4's goal-gate-exit ladder (Engine.gateRetryTarget).
   * Section 3.7's ordinary node-failure ladder (retry-exhaustion and plain-FAIL)
   * names only the node's own two attributes -- consulting the graph-level
   * fallback there was D7. No default: every call site must say which ladder
   * it is climbing.
   */
  includeGraphLevel: boolean
}

/**
 * Resolve where a node should route. Node-level declarations always win over
 * graph-level ones; a target naming a node that does not exist is treated as
 * absent rather than crashing the run. `includeGraphLevel` gates whether the
 * graph-level rungs are consulted at all -- see `ResolveRetryTargetOptions`.
 */
export function resolveRetryTarget(
  node: Node,
  graph: Graph,
  opts: ResolveRetryTargetOptions,
): string | null {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    ...(opts.includeGraphLevel ? [graph.attrs.retry_target, graph.attrs.fallback_retry_target] : []),
  ]
  for (const c of candidates) {
    if (c && graph.nodes.has(c)) return c
  }
  return null
}
```

- [ ] **Step 4: Run the new test, confirm it passes**

Run: `cd plugins/attractor/engine && node --test test/retry.test.ts`
Expected: the new test passes. Every other test in this file now fails to compile/run correctly because they call `resolveRetryTarget` with two arguments — proceed to Step 5 immediately, this is expected.

- [ ] **Step 5: Update the three pre-existing `retry.test.ts` call sites**

Find every existing call to `resolveRetryTarget(...)` in `plugins/attractor/engine/test/retry.test.ts` (grep the file — there are three). Each tests a scenario where the graph-level fallback SHOULD apply (they predate this fix and exercise the gate-ladder-equivalent shape), so add `{ includeGraphLevel: true }` as the third argument to each.

- [ ] **Step 6: Run `retry.test.ts` again, confirm all pass**

Run: `cd plugins/attractor/engine && node --test test/retry.test.ts`
Expected: all pass.

- [ ] **Step 7: Update the three production call sites in `engine.ts`**

`engine.ts:423`, inside `gateRetryTarget` — this is the ONE call site that keeps `includeGraphLevel: true`:

```ts
    return resolveRetryTarget(gate, this.opts.graph, { includeGraphLevel: true })
```

`engine.ts:1021`, inside the RETRY-exhaustion branch — change to `includeGraphLevel: false`:

```ts
        const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
```

`engine.ts:1165`, inside the plain-FAIL branch — change to `includeGraphLevel: false`:

```ts
        const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
```

- [ ] **Step 8: Update GATE-001's own call site in `lint.ts`, and prune the now-dead branch**

`lint.ts:833-860` currently reads (abbreviated to the load-bearing lines):

```ts
    const graphLevel = new Set<string>()
    for (const node of graph.nodes.values()) {
      if (NEVER_FAILS.includes(node.handler) || gates.has(node.id)) continue
      const target = resolveRetryTarget(node, graph)
      if (target === null) continue
      const own =
        node.attrs.retry_target !== undefined || node.attrs.fallback_retry_target !== undefined
      if (own) {
        routes.push({
          origin: node.id,
          target,
          what: `node ${node.id}'s retry_target="${target}"`,
        })
      } else {
        graphLevel.add(target)
      }
    }
    for (const target of graphLevel) {
      const attr =
        graph.attrs.retry_target === target ? 'retry_target' : 'fallback_retry_target'
      routes.push({ target, what: `the graph-level ${attr}="${target}"` })
    }
```

Once `resolveRetryTarget(node, graph)` is called with `{ includeGraphLevel: false }`, `target` can only be non-null when the node has its own attribute — so `own` is always true whenever `target !== null`, and the `graphLevel` Set/second loop become unreachable dead code. Replace the whole block with:

```ts
    for (const node of graph.nodes.values()) {
      if (NEVER_FAILS.includes(node.handler) || gates.has(node.id)) continue
      // includeGraphLevel: false -- section 3.7's ladder (which GATE-001
      // mirrors) does not consult the graph-level retry_target/
      // fallback_retry_target for a plain node's failure route; only
      // section 3.4's goal-gate-exit ladder does (see engine.ts:423). A
      // purely graph-level fallback is therefore no longer a live bypass
      // route for a non-gate node and is not reported here.
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false })
      if (target === null) continue
      routes.push({
        origin: node.id,
        target,
        what: `node ${node.id}'s retry_target="${target}"`,
      })
    }
```

- [ ] **Step 9: Rewrite the GATE-001 test that will now assert the wrong thing**

`lint.test.ts:910-927`, `'GATE-001 fires for a graph-level fallback_retry_target that bypasses the gate'`, builds a graph where `build` has no own retry attribute, only a graph-level `fallback_retry_target="bail"`. After Step 8's fix, this is no longer a reportable route (verified by tracing the fix above). Replace the test body:

```ts
test('GATE-001 does not fire for a purely graph-level fallback_retry_target on a non-gate node', () => {
  // Before the D7 fix, a purely graph-level fallback_retry_target with no
  // node-level attribute was treated as a live bypass route for ANY node.
  // Section 3.7's ladder (which this rule mirrors) never consults the
  // graph-level rungs for a plain node's failure -- only section 3.4's
  // goal-gate ladder does -- so this is no longer a route GATE-001 should
  // report.
  const src = `digraph G {
    fallback_retry_target="bail"
    start [shape=Mdiamond]  done [shape=Msquare]
    build [shape=box, prompt="build"]
    gate  [shape=box, goal_gate=true, prompt="judge"]
    bail  [shape=box, prompt="report"]
    start -> build
    build -> gate [condition="outcome=success"]
    build -> bail [condition="preferred_label=abort"]
    gate -> done
    bail -> done
  }`
  assert.deepEqual(gate001(src), [])
})
```

Leave the companion test `'GATE-001 fires for a node-level retry_target that bypasses the gate'` (lines 892-908) completely unmodified — `build` declares its own `retry_target` there, so `own` stays true regardless of this fix, and it is the differential control proving the fix didn't over-correct.

- [ ] **Step 10: Write the two FR-10 integration fixtures in `engine.test.ts`**

Add near the other retry-related tests in `plugins/attractor/engine/test/engine.test.ts`:

```ts
test('D7 fix: a plain FAIL does not consult the graph-level retry_target (engine.ts:1165)', async () => {
  const src = `
    digraph D7Plain {
      retry_target="graphFallback"
      start [shape=Mdiamond]  done [shape=Msquare]
      strict [shape=box, prompt="strict"]
      graphFallback [shape=box, prompt="never reached"]
      start -> strict
      strict -> done
      graphFallback -> done
    }
  `
  const { result } = await execute(src, { strict: { status: Status.FAIL, notes: 'boom' } })
  assert.equal(result.status, Status.FAIL)
  assert.ok(!result.path.includes('graphFallback'), 'must not have jumped to the graph-level target')
})

test('D7 fix: retry-exhaustion does not consult the graph-level retry_target (engine.ts:1021)', async () => {
  const src = `
    digraph D7Exhaust {
      retry_target="graphFallback"
      start [shape=Mdiamond]  done [shape=Msquare]
      strict [shape=box, prompt="strict", max_retries="1"]
      graphFallback [shape=box, prompt="never reached"]
      start -> strict
      strict -> done
      graphFallback -> done
    }
  `
  const { result } = await execute(src, {
    strict: [
      { status: Status.RETRY, notes: 'try again' },
      { status: Status.RETRY, notes: 'still failing' },
    ],
  })
  assert.equal(result.status, Status.FAIL)
  assert.ok(!result.path.includes('graphFallback'), 'must not have jumped to the graph-level target')
})
```

Confirm `execute`'s `StubBackend` script format accepts an array of `Outcome` for sequential calls (it does — see `execute`'s signature: `script: Record<string, Outcome | Outcome[]>`) and that `max_retries="1"` permits exactly one retry, so two RETRY outcomes exhaust it (per `resolveRetryPolicy`: "`max_retries=N` permits N+1 total attempts").

- [ ] **Step 11: Run the new fixtures, confirm both pass**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts`
Expected: both new tests pass, plus the existing `gateRetryTarget`-covering test near line 3805 (`'the graph-level target still applies when the gate declares none (section 3.4 steps 3-4)'`) still passes unmodified — it is the regression guard for the ONE call site that must keep `includeGraphLevel: true`.

- [ ] **Step 12: Mutation-check the cross-revert matrix**

This is the check that proves the two new fixtures are independent, not decorative. Do this by hand, temporarily, then revert each change before moving on:

(a) Temporarily change `engine.ts:1165` back to `resolveRetryTarget(node, graph, { includeGraphLevel: true })`. Run `node --test test/engine.test.ts --test-name-pattern="D7 fix"`. Expected: the plain-FAIL fixture (Step 10's first test) now FAILS (it jumps to `graphFallback`), the retry-exhaustion fixture still PASSES. Revert.

(b) Temporarily change `engine.ts:1021` back to `includeGraphLevel: true`. Run the same command. Expected: the retry-exhaustion fixture now FAILS, the plain-FAIL fixture still PASSES. Revert.

(c) Temporarily change `engine.ts:423` (`gateRetryTarget`) to `includeGraphLevel: false`. Run `node --test test/engine.test.ts --test-name-pattern="section 3.4"`. Expected: the existing regression test near line 3805 now FAILS. Revert.

If any of (a)/(b)/(c) does not produce the expected failure, the fix is wrong — stop and re-diagnose before proceeding.

- [ ] **Step 13: Full suite, rebuild bundle**

Run: `cd plugins/attractor/engine && npm run build && node --test`
Expected: all pass except the 1 pre-existing skip, 0 fail.

- [ ] **Step 14: Commit**

```bash
git add plugins/attractor/engine/src/core/retry.ts plugins/attractor/engine/src/core/engine.ts \
  plugins/attractor/engine/src/dot/lint.ts plugins/attractor/engine/test/retry.test.ts \
  plugins/attractor/engine/test/lint.test.ts plugins/attractor/engine/test/engine.test.ts \
  plugins/attractor/dist/attractor.js
git commit -m "fix(engine): resolveRetryTarget no longer leaks the graph-level fallback into plain-node failures (FR-10, D7)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: FR-11 — embedded `Engine` refuses a lint-dirty graph, matching the CLI (F10)

**Files:**
- Modify: `plugins/attractor/engine/src/dot/graph.ts` (gains `PASSTHROUGH_KINDS`, `RunsOn`, `RUNS_ON_MODES`, `runsOn()`, relocated from `engine.ts`)
- Modify: `plugins/attractor/engine/src/core/engine.ts` (imports the four relocated symbols back and re-exports them; `run()` gains the refusal check)
- Modify: `plugins/attractor/engine/src/dot/lint.ts:13` (import source for the four symbols changes from `../core/engine.ts` to `./graph.ts`)
- Create: `plugins/attractor/engine/test/fixtures.ts` (shared, non-test module — see Step 7 for why this can't just be an export from `cli.test.ts`)
- Modify: `plugins/attractor/engine/test/cli.test.ts` (its `LINT_FAILS_BUT_WOULD_RUN` const moves to the new shared file; its own usage becomes an import)
- Test: `plugins/attractor/engine/test/engine.test.ts` (two new tests, importing the shared fixture)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `PASSTHROUGH_KINDS`, `RunsOn`, `RUNS_ON_MODES`, `runsOn()` now live in `dot/graph.ts` (still re-exported from `core/engine.ts`, so no other file's imports need to change). Task 4 depends on this task landing first or being done independently — `UNREGISTERED_HANDLER_KINDS` (Task 4) is a new, unrelated export in the same file and does not conflict, but do Task 3 before Task 4 to keep `graph.ts` changes sequential rather than interleaved.

**Read this whole task before starting Step 1.** The relocation in Steps 1-3 exists to prevent a real, traced circular-import crash — do not skip it and import `lint.ts` into `engine.ts` directly.

- [ ] **Step 1: Verify the circular-import hazard is real before fixing it (Spike 2)**

`dot/lint.ts:13` currently reads `import { PASSTHROUGH_KINDS, RUNS_ON_MODES, RunsOn, runsOn } from '../core/engine.ts'`. If `engine.ts` were to add `import { lint, hasErrors } from '../dot/lint.ts'` without first moving these four symbols out, ES module import hoisting means `lint.ts`'s top-level `const NEVER_FAILS: readonly string[] = PASSTHROUGH_KINDS` would execute before `engine.ts`'s own `export const PASSTHROUGH_KINDS = [...]` has run, throwing `ReferenceError: Cannot access 'PASSTHROUGH_KINDS' before initialization` at module load — crashing the whole test suite and CLI. Confirm by temporarily adding `import { lint } from '../dot/lint.ts'` to the top of `engine.ts` (do not use it yet) and running `node --test test/engine.test.ts`. Expected: every test in the file fails at module load with exactly that `ReferenceError`. Remove the import once confirmed — this step is diagnostic only.

- [ ] **Step 2: Move the four symbols from `engine.ts` to `graph.ts`**

Cut `PASSTHROUGH_KINDS` (`engine.ts:85`), `RunsOn`/`RunsOnMode` (`engine.ts:141-147`), `RUNS_ON_MODES` (`engine.ts:157-161`), and `runsOn()` (`engine.ts:191-197`) — including their doc comments — from `engine.ts`, and paste them into `dot/graph.ts`, placed near `INFERRED_OUTPUTS_BY_HANDLER` (both resolve node-level concepts from attributes, which is the layer `graph.ts` already owns). `runsOn()` reads `node.attrs.runs_on`, which is exactly the kind of attribute resolution this file already does elsewhere — no changes to the moved code's logic, only its location.

Two of the moved doc comments reference `Kind` (the local alias `engine.ts` uses for `Handler`) — in the pasted code, since `graph.ts` is where `Handler` is actually defined, use `Handler` directly instead of the `Kind` alias (e.g. `PASSTHROUGH_KINDS: readonly HandlerKind[] = [Handler.START, Handler.EXIT, Handler.CONDITIONAL]`).

- [ ] **Step 3: `engine.ts` imports the four symbols back and re-exports them**

At the top of `engine.ts`, add to the existing `import { ... } from '../dot/graph.ts'` block: `PASSTHROUGH_KINDS`, `RunsOn`, `type RunsOnMode`, `RUNS_ON_MODES`, `runsOn`. Immediately after the import block, add:

```ts
export { PASSTHROUGH_KINDS, RunsOn, RUNS_ON_MODES, runsOn }
export type { RunsOnMode }
```

This keeps every existing importer of these symbols from `core/engine.ts` (there is at least one in the test suite) working unchanged — only `lint.ts`'s own import source needs to move.

- [ ] **Step 4: Run the full suite to confirm the relocation alone changes nothing observable**

Run: `cd plugins/attractor/engine && node --test`
Expected: same pass/fail counts as the Task 2 baseline (all green except the 1 skip). If anything fails, the relocation broke something — stop and diagnose before proceeding; do not add the lint import yet.

- [ ] **Step 5: Change `lint.ts`'s import source**

`dot/lint.ts:13`, change:
```ts
import { PASSTHROUGH_KINDS, RUNS_ON_MODES, RunsOn, runsOn } from '../core/engine.ts'
```
to:
```ts
import { PASSTHROUGH_KINDS, RUNS_ON_MODES, RunsOn, runsOn } from './graph.ts'
```
(same directory now, since both files live in `dot/`).

- [ ] **Step 6: Run the full suite again**

Run: `cd plugins/attractor/engine && node --test`
Expected: unchanged. Confirms `graph.ts` has zero dependency on `engine.ts` or `lint.ts`, so this is genuinely acyclic now.

- [ ] **Step 7: Move the CLI's `LINT_FAILS_BUT_WOULD_RUN` fixture to a shared, non-test module**

**Do not export it directly from `cli.test.ts` and import that into `engine.test.ts`.** `node --test`'s default file discovery runs every matching `*.test.ts` file; if `engine.test.ts` also `import`s `cli.test.ts` as a module, `cli.test.ts`'s own top-level `test(...)` registrations execute a second time inside `engine.test.ts`'s run, double-registering (and double-running) every test in that file. Move the fixture to a plain, non-`.test.ts` module instead — no `test()` calls in it, so it can be safely imported from anywhere with zero side effects.

Create `plugins/attractor/engine/test/fixtures.ts`:

```ts
// Shared fixtures used by more than one test file. Deliberately not named
// *.test.ts -- node --test's default discovery would otherwise treat it as
// its own test file (harmless, since it registers no tests, but avoid the
// ambiguity) -- and more importantly, this lets it be imported without
// re-executing another file's top-level test() registrations.

// Lints as an ERROR (TOPO-004: `orphan` is unreachable) but would otherwise
// execute cleanly: start -> a -> done, exit 0. That gap is what makes a test
// using this fixture discriminate: a fresh graph that fails for an unrelated
// structural reason (e.g. missing start node) would pass even with the lint
// gate deleted.
export const LINT_FAILS_BUT_WOULD_RUN = `
digraph LR {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  orphan [shape=box, prompt="never reached"]
  start -> a -> done
}
`
```

In `cli.test.ts`, delete the existing module-private `const LINT_FAILS_BUT_WOULD_RUN = ...` declaration and its comment (lines 58-70), and add `import { LINT_FAILS_BUT_WOULD_RUN } from './fixtures.ts'` to its import block. Confirm `cli.test.ts`'s existing test (`'run refuses to execute a graph that fails lint'`) still passes unchanged — it only needed the value, not the declaration site.

- [ ] **Step 8: Write the failing test for `Engine.run()`'s refusal**

In `plugins/attractor/engine/test/engine.test.ts`, add the import `import { LINT_FAILS_BUT_WOULD_RUN } from './fixtures.ts'` and:

```ts
test('a direct Engine embed refuses to run a graph that fails lint (FR-11, F10)', async () => {
  const { runDir, cwd } = tempDirs()
  const graph = parseDot(LINT_FAILS_BUT_WOULD_RUN)
  const backend = new StubBackend({})
  const engine = new Engine({
    graph,
    context: Context.from({}),
    runDir,
    cwd,
    handlers: defaultHandlers(backend),
  })
  const result = await engine.run()
  assert.equal(result.status, Status.FAIL)
  assert.match(result.notes ?? '', /TOPO-004/)
  assert.ok(!result.path.includes('a'), 'the node that would otherwise run first must never dispatch')
  // Accepted, documented divergence from the CLI path (ADR-004): the
  // constructor's EventLog already created runDir before run() gets a
  // chance to refuse, so it exists with a FAIL pipeline.end event in it,
  // unlike the CLI's pre-construction check which leaves nothing.
  assert.ok(existsSync(runDir), 'run dir exists -- constructor already ran before the refusal')
  cleanup(runDir, cwd)
})

test('a direct Engine embed still runs a clean graph normally (both-directions guard)', async () => {
  const { result } = await execute(LINEAR)
  assert.equal(result.status, Status.SUCCESS)
})
```

Confirm `LINEAR` (a clean, existing fixture in this file) and `existsSync` (already imported at the top of `engine.test.ts`) are available; if `LINEAR` isn't the right name, use whichever existing clean linear fixture this file already defines near the top.

- [ ] **Step 9: Run `cli.test.ts` to confirm the fixture move didn't break it, then run the new (failing) test**

Run: `cd plugins/attractor/engine && node --test test/cli.test.ts`
Expected: all pass, same as before the move.

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts --test-name-pattern="FR-11"`
Expected: FAIL — `result.status` is `Status.SUCCESS` today (or the run proceeds and dispatches node `a`), because `Engine.run()` does not yet check lint.

- [ ] **Step 10: Add the refusal check to `Engine.run()`**

At the very top of `engine.ts`'s import block, add:
```ts
import { lint, hasErrors, Severity } from '../dot/lint.ts'
```

In `run()` (`engine.ts:718`), as the literal first lines of the method body, before the existing `const { graph, context } = ...` line:

```ts
  async run(): Promise<RunResult> {
    const { graph, context } = this.opts
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS

    const diagnostics = lint(graph)
    if (hasErrors(diagnostics)) {
      const detail = diagnostics
        .filter((d) => d.severity === Severity.ERROR)
        .map((d) => `${d.code}${d.node ? ` (${d.node})` : ''}: ${d.message}`)
        .join('; ')
      const msg = `graph carries error-severity lint diagnostics and will not run: ${detail}`
      this.events.append({ type: 'pipeline.end', status: Status.FAIL })
      return this.result(Status.FAIL, msg, msg)
    }

    const startNode = [...graph.nodes.values()].find((n) => n.handler === Kind.START)
    // ... rest of the existing method body, unchanged
```

(The existing `const startNode = ...` line and everything after it in `run()` stays exactly as it is today — only the new `diagnostics`/`hasErrors` block is inserted before it, and `maxSteps` moves above the new block since it doesn't depend on anything the lint check touches — check placement doesn't break any later reference to `maxSteps`.)

- [ ] **Step 11: Run the new tests, confirm both pass**

Run: `cd plugins/attractor/engine && node --test test/engine.test.ts --test-name-pattern="FR-11|both-directions"`
Expected: both pass.

- [ ] **Step 12: Mutation-check the refusal**

Temporarily comment out the `if (hasErrors(diagnostics))` block's body (or change the condition to `if (false)`). Run the FR-11 test. Expected: FAIL (dispatch proceeds, node `a` appears in `result.path`). Revert. Then temporarily change the condition to `if (true)` (refuses everything). Run the both-directions guard test. Expected: FAIL (the clean `LINEAR` graph is now refused too). Revert.

- [ ] **Step 13: Full suite, rebuild bundle**

Run: `cd plugins/attractor/engine && npm run build && node --test`
Expected: all pass except the 1 pre-existing skip, 0 fail. Pay particular attention here — this task touches the most import-sensitive code in the codebase; a bundle that fails to build or a suite that hangs at load time means Step 1-6's relocation has a problem.

- [ ] **Step 14: Commit**

```bash
git add plugins/attractor/engine/src/dot/graph.ts plugins/attractor/engine/src/core/engine.ts \
  plugins/attractor/engine/src/dot/lint.ts plugins/attractor/engine/test/cli.test.ts \
  plugins/attractor/engine/test/fixtures.ts plugins/attractor/engine/test/engine.test.ts \
  plugins/attractor/dist/attractor.js
git commit -m "feat(engine): embedded Engine refuses lint-dirty graphs like the CLI (FR-11, F10)

Relocates PASSTHROUGH_KINDS/RunsOn/RUNS_ON_MODES/runsOn from core/engine.ts
to dot/graph.ts to break the circular import that a naive fix would have
created (lint.ts already imports these four from engine.ts; engine.ts
importing lint.ts back would crash at module load under ES module import
hoisting). Re-exported from engine.ts so no other importer's path changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: FR-17a — HAND-001 lint rule refuses nodes resolving to still-unregistered handler kinds

**Files:**
- Modify: `plugins/attractor/engine/src/dot/graph.ts` (new exported `UNREGISTERED_HANDLER_KINDS` constant)
- Modify: `plugins/attractor/engine/src/dot/lint.ts` (new `HAND-001` rule, inside the existing per-node loop at line 372)
- Test: `plugins/attractor/engine/test/lint.test.ts` (anchor test + per-shape fixtures)

**Interfaces:**
- Consumes: nothing from Tasks 1-3 directly, but do this task after Task 3 — both touch `graph.ts`, and Task 3's relocation should land first to keep changes to that file sequential rather than interleaved.
- Produces: `UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[]`, exported from `graph.ts`. Not consumed elsewhere in this plan.

**Important, verified deviation from ADR-005's original text:** ADR-005 assumed `Handler.HUMAN` would already be registered by this point (originally scoped as landing in the same slice as S2). S2 (FR-5-8, `Handler.HUMAN` registration) is now on hold pending Plan 4 reconciliation and is **not** part of this plan. Verified directly (`defaultHandlers()` in `engine.ts`, read in full): `Handler.HUMAN` is **not** registered today. The anchor test in Step 2 below derives the constant's correct membership from `defaultHandlers()`'s actual, current registration — not from a hardcoded list — so this deviation resolves itself correctly and automatically: `HUMAN` **is** included in `UNREGISTERED_HANDLER_KINDS` for this plan, because it genuinely is unregistered right now. When Plan 4 eventually registers it, the anchor test will fail loudly if the constant isn't updated to remove it — that is the anchor test doing its job, not a bug.

- [ ] **Step 1: Write the failing anchor test first**

In `plugins/attractor/engine/test/lint.test.ts`, this file already imports `defaultHandlers` from `../src/core/engine.ts` and `StubBackend` from `../src/handlers/stub.ts` (confirmed at the top of the file). Add:

```ts
test('UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually registers', () => {
  const registered = new Set(defaultHandlers(new StubBackend({})).keys())
  const expected = Object.values(Handler).filter((k) => !registered.has(k))
  assert.deepEqual(new Set(UNREGISTERED_HANDLER_KINDS), new Set(expected))
})
```

This is modeled on this file's own existing independent-anchor pattern (the test that recomputes the passthrough set from `defaultHandlers` itself, referenced in `engine.ts`'s `PASSTHROUGH_KINDS` doc comment) — it derives correctness from the actual registration, not from a copy of the list, so it cannot silently drift.

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts --test-name-pattern="UNREGISTERED_HANDLER_KINDS"`
Expected: FAIL — `UNREGISTERED_HANDLER_KINDS` does not exist yet (`ReferenceError` or import failure).

- [ ] **Step 3: Add the constant to `graph.ts`**

Near `INFERRED_OUTPUTS_BY_HANDLER` (which already documents, per-entry, which handler kinds are unregistered — this promotes that existing prose into a value):

```ts
/**
 * Handler kinds `defaultHandlers()` (core/engine.ts) does not register today.
 * A node resolving to one of these aborts the run with "no handler
 * registered" the moment it's reached -- HAND-001 refuses it at design time
 * instead. Hand-listed, not derived from defaultHandlers() here, because
 * that function needs a Backend to construct and importing it back into this
 * pure static-analysis module would recreate the exact circular-import
 * hazard FR-11 removed. The anchor test in lint.test.ts cross-checks this
 * against defaultHandlers()'s actual keys, so drift fails loudly instead of
 * silently -- including when a future plan registers one of these kinds and
 * this list is not updated to match.
 */
export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[] = [
  Handler.HUMAN,
  Handler.PARALLEL,
  Handler.FAN_IN,
  Handler.MANAGER_LOOP,
]
```

- [ ] **Step 4: Run the anchor test again, confirm it passes**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts --test-name-pattern="UNREGISTERED_HANDLER_KINDS"`
Expected: pass.

- [ ] **Step 5: Mutation-check the anchor test, both directions**

(a) Temporarily remove `Handler.HUMAN` from the constant. Run the anchor test. Expected: FAIL (confirms it correctly flags a missing member — this is also literally what will happen when Plan 4 registers HUMAN and someone forgets to update this list). Revert.
(b) Temporarily add a handler kind that IS registered (e.g. `Handler.TOOL`) to the constant. Run the anchor test. Expected: FAIL (confirms it catches an over-broad list, not just an under-broad one). Revert.

- [ ] **Step 6: Write the failing HAND-001 fixtures**

Add to `lint.test.ts`:

```ts
test('HAND-001 fires for a node resolving to Handler.PARALLEL', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    fanout [shape=component]
    start -> fanout -> done
  }`
  const found = codes(src)
  assert.ok(found.includes('HAND-001'))
})

test('HAND-001 fires for a node resolving to Handler.FAN_IN', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    join [shape=tripleoctagon]
    start -> join -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 fires for a node resolving to Handler.MANAGER_LOOP', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    loop [shape=house]
    start -> loop -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 fires for Handler.HUMAN too, since it is unregistered in this build', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=hexagon, prompt="approve?"]
    start -> gate -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 respects type= overriding shape=', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    node1 [shape=box, type="parallel"]
    start -> node1 -> done
  }`
  assert.ok(codes(src).includes('HAND-001'))
})

test('HAND-001 does not fire for any registered handler kind', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    work [shape=box, prompt="do it"]
    tool [shape=parallelogram, tool_command="printf ok"]
    cond [shape=diamond]
    start -> work -> tool -> cond -> done [condition="outcome=success"]
    cond -> done [condition="outcome=fail"]
  }`
  assert.ok(!codes(src).includes('HAND-001'))
})

test('HAND-001 reports one diagnostic per offending node, not one per graph', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=component]
    b [shape=tripleoctagon]
    start -> a -> b -> done
  }`
  const found = lint(parseDot(src)).filter((d) => d.code === 'HAND-001')
  assert.equal(found.length, 2)
})
```

Verify each shape string against `TYPE_TO_HANDLER`/the shape-resolution table in `graph.ts` before finalizing — `component` → PARALLEL, `tripleoctagon` → FAN_IN, `house` → MANAGER_LOOP, `hexagon` → HUMAN are the mappings used elsewhere in this codebase's own fixtures (confirmed against existing test files in this suite); if any shape string doesn't resolve as expected when Step 8 runs, correct it here rather than in the rule itself.

- [ ] **Step 7: Run them, confirm all fail (HAND-001 doesn't exist yet)**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts --test-name-pattern="HAND-001"`
Expected: the six "fires"/"multiplicity" tests FAIL (HAND-001 never appears); the "does not fire" test trivially passes already (nothing to not-fire).

- [ ] **Step 8: Add the HAND-001 rule**

Inside the existing per-node loop in `lint.ts` (opens at line 372, `for (const node of graph.nodes.values()) {`), immediately after the closing `}` of the HITL-001 `if` block (line 473) and before the goal-gate section's comment (line 475), insert:

```ts
    // HAND-001: a node resolves to a handler kind this build does not
    // register. Today's abort ("no handler registered") happens mid-run,
    // after any earlier nodes have already spent tokens or made changes.
    // Refused here instead, before anything runs.
    if (UNREGISTERED_HANDLER_KINDS.includes(node.handler)) {
      diags.push({
        code: 'HAND-001',
        severity: Severity.ERROR,
        node: node.id,
        message:
          `node ${node.id} resolves to handler "${node.handler}", which this build does not ` +
          `register (known unregistered: ${UNREGISTERED_HANDLER_KINDS.join(', ')}); the run ` +
          `would abort with "no handler registered" mid-pipeline. Refused here instead, ` +
          `before anything runs.`,
      })
    }
```

Add `UNREGISTERED_HANDLER_KINDS` to `lint.ts`'s existing import from `./graph.ts` at the top of the file.

- [ ] **Step 9: Run the HAND-001 tests again, confirm all pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts --test-name-pattern="HAND-001"`
Expected: all pass.

- [ ] **Step 10: Mutation-check "fires" and "does not fire" independently**

(a) Temporarily comment out the whole `if (UNREGISTERED_HANDLER_KINDS.includes(...))` block. Run the "fires" tests. Expected: all four fail together (confirms none was accidentally passing for an unrelated reason). Revert.
(b) Temporarily add `Handler.HUMAN` back is already covered by Step 5; instead here, temporarily add `Handler.TOOL` to `UNREGISTERED_HANDLER_KINDS` in `graph.ts`. Run the "does not fire" test (which uses a `parallelogram`/tool-command node). Expected: FAIL (confirms the "does not fire" test actually exercises the registered-kind path, not a vacuous check). Revert.

- [ ] **Step 11: Confirm no existing test regresses**

Run: `cd plugins/attractor/engine && node --test`. Check specifically that `lint.test.ts`'s existing `'TYPE-001 accepts every type string the engine resolves'` test (which asserts only the absence of `TYPE-001`, not the full diagnostic set) still passes — HAND-001 firing alongside it must not break that assertion.
Expected: all pass except the 1 pre-existing skip, 0 fail.

- [ ] **Step 12: Rebuild the bundle**

Run: `cd plugins/attractor/engine && npm run build && node --test`
Expected: unchanged pass count, bundle test passes.

- [ ] **Step 13: Commit**

```bash
git add plugins/attractor/engine/src/dot/graph.ts plugins/attractor/engine/src/dot/lint.ts \
  plugins/attractor/engine/test/lint.test.ts plugins/attractor/dist/attractor.js
git commit -m "feat(lint): HAND-001 refuses nodes resolving to unregistered handler kinds (FR-17a)

Includes Handler.HUMAN in UNREGISTERED_HANDLER_KINDS, deviating from
ADR-005's original text -- that ADR assumed HUMAN would already be
registered by this point (S2 landing in the same slice). S2 is on hold
pending Plan 4 reconciliation (see carry-forward.md), so HUMAN is
genuinely still unregistered today; the anchor test derives this from
defaultHandlers()'s actual keys, so it will fail loudly and correctly
the moment a future plan registers HUMAN without updating this list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final whole-branch review

After all four tasks are complete, per `superpowers:subagent-driven-development`: dispatch the final whole-branch code reviewer on the most capable available model, covering the full diff since this plan's BASE commit. Pay particular attention to:

- The circular-import relocation (Task 3, Steps 1-6) — confirm the reviewer independently re-derives the import graph rather than trusting this plan's claim.
- The GATE-001 dead-code prune (Task 2, Step 8) — confirm no other code path depended on the removed `graphLevel` Set.
- That `UNREGISTERED_HANDLER_KINDS` including `Handler.HUMAN` is flagged as a deliberate, documented deviation from ADR-005 (it is, in this plan and in the Task 4 commit message) rather than an oversight.

On a clean final review, use `superpowers:finishing-a-development-branch` to integrate. Then update `plugins/attractor/.superpowers/carry-forward.md`: strike or update any of its "Known-and-accepted" entries this plan touched (none currently identified, but re-check), and confirm the Plan 4 entry's unreconciled-divergence note is still accurate and untouched by this plan (it should be — this plan does not touch anything human-gate-related).
