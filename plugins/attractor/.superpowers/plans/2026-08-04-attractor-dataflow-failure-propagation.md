# Dataflow Failure Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give nodes a contract for what they produce, so a node whose declared inputs came from a failed predecessor fails loudly instead of running on missing data.

**Architecture:** A node declares `outputs=`. The engine keeps a `failedOutputs` ledger mapping each key to the node that owed it. Before invoking a handler, the engine intersects the node's `${key}` references with that ledger; a non-empty intersection returns `FAIL` with a precise reason, without invoking the handler. Two lint rules catch the same hazards at design time.

**Tech Stack:** TypeScript on Node >= 24 native type stripping. Dependencies stay exactly `@ts-graphviz/ast` and `esbuild`.

## Global Constraints

- **Read the specification before changing behaviour.** `gh api repos/strongdm/attractor/contents/attractor-spec.md --jq '.content' | base64 -d > /tmp/attractor-spec.md`. Quote the section when recording a decision.
- **This plugin extends the spec and never contradicts it.** `SKIPPED` is not used by this plan: §5.2 defines it as "Proceed without recording an outcome", which is incompatible with halting. Use `FAIL`.
- No `enum`, `namespace`, `declare`, or constructor parameter properties (Node native type stripping).
- Explicit `.ts` extensions on relative imports; `node:` prefix on builtins.
- Never run `npm install`. The registry here is a corporate proxy and `registry.npmjs.org` is unreachable.
- No emoji anywhere.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do NOT run `npm run build` except in the final task.
- Baseline: 294 tests, 293 pass, 1 skipped (`live.test.ts`, must stay skipped; nothing may invoke the real `claude` binary).

## Decisions taken (open questions from the design, resolved)

1. **`outputs=` is not verified against what a handler actually wrote.** A node declaring an output it never produces is a real contract violation, but catching it is a second mechanism with its own failure modes. Out of scope; recorded as a follow-up.
2. **The box (codergen) handler's inferred output set is empty.** A model's `contextUpdates` keys are arbitrary and filtered by the engine-managed guard, so there is nothing honest to infer. `outputs=` is therefore effectively mandatory on any LLM node whose output something depends on. This must be stated in the node's diagnostic text and in the plugin README, not left for authors to discover.

## File structure

| File | Responsibility |
|---|---|
| `src/dot/graph.ts` | `declaredOutputs(node)`, `inferredOutputs(node)`, `effectiveOutputs(node)` |
| `src/core/substitute.ts` | `referencedKeys(text)` — extract `${key}` / `$key` tokens |
| `src/core/engine.ts` | `failedOutputs` ledger, eager input check, `runs_on` handling |
| `src/dot/lint.ts` | `DATA-001`, `GATE-001` |
| `test/*` | engine-level tests through a real `Engine.run()` |

---

### Task 1: Declared and inferred outputs

**Files:**
- Modify: `plugins/attractor/engine/src/dot/graph.ts`
- Test: `plugins/attractor/engine/test/graph.test.ts`

**Interfaces:**
- Produces: `declaredOutputs(node: Node): string[]`, `inferredOutputs(node: Node): string[]`, `effectiveOutputs(node: Node): string[]`. Later tasks consume `effectiveOutputs` only.

- [ ] **Step 1: Write failing tests**

```typescript
test('outputs= is split, trimmed, and empty entries dropped', () => {
  const n = node({ outputs: 'a.b , c ,, d ' })
  assert.deepEqual(declaredOutputs(n), ['a.b', 'c', 'd'])
})

test('a tool node infers the keys its handler always writes', () => {
  const n = node({ shape: 'parallelogram', tool_command: 'make' })
  assert.deepEqual(inferredOutputs(n).sort(), ['tool.exit_code', 'tool.last_line', 'tool.output'])
})

test('a box node infers nothing, because a model authors arbitrary keys', () => {
  assert.deepEqual(inferredOutputs(node({ shape: 'box' })), [])
})

test('effective outputs are the union, deduplicated', () => {
  const n = node({ shape: 'parallelogram', outputs: 'artifact.path,tool.output' })
  assert.deepEqual(effectiveOutputs(n).sort(),
    ['artifact.path', 'tool.exit_code', 'tool.last_line', 'tool.output'])
})
```

- [ ] **Step 2: Run and confirm they fail** — `node --test test/graph.test.ts`, expected FAIL with "not a function".

- [ ] **Step 3: Implement**

Derive the inferred set from `handlerForNode`, not from the shape string, so it cannot drift from what actually runs. The tool handler's keys must be read from `handlers/tool.ts` rather than retyped.

- [ ] **Step 4: Run tests** — expect PASS.
- [ ] **Step 5: Mutation check** — make `inferredOutputs` return `[]` for a tool node; the union test must fail. Restore.
- [ ] **Step 6: Commit** — `feat(graph): declared and inferred node outputs`

---

### Task 2: Reference extraction

**Files:**
- Modify: `plugins/attractor/engine/src/core/substitute.ts`
- Test: `plugins/attractor/engine/test/substitute.test.ts`

**Interfaces:**
- Produces: `referencedKeys(text: string): string[]`

Must agree exactly with what `substitute` itself would replace. Extract the token pattern into one shared definition both use — the same anti-drift move Task 7 of the correction plan made for `splitClauses`, and for the same reason.

- [ ] **Step 1: Write failing tests**

```typescript
test('both reference forms are extracted', () => {
  assert.deepEqual(referencedKeys('cd $dir && cat ${artifact.path}').sort(),
    ['artifact.path', 'dir'])
})

test('$$ is not a reference', () => {
  assert.deepEqual(referencedKeys('echo $$HOME'), [])
})

test('extraction and substitution agree on every token', () => {
  const text = 'a $x ${y.z} $$lit ${} $'
  const ctx = new Context()
  for (const k of referencedKeys(text)) ctx.set(k, 'V')
  assert.ok(!substitute(text, ctx).includes('V') === false)
  assert.equal(substitute(text, ctx), 'a V V $$lit ${} $')
})
```

**Correction (post-implementation, fix round 1):** the assertion above originally read
`'a V V $lit ${} $'`, treating `$$` as an escape that collapses to a literal `$`. That is
wrong: `substitute` feeds `tool_command`, and in a shell `$$` is the process-id idiom
(`mktemp /tmp/build.$$`). Collapsing it to `$` silently rewrites an author's shell text
into something that means something else — exactly the silent-degradation failure the
plugin's doctrine forbids, and a violation of this same file's own single-pass principle
("the engine never invents an expansion the author never wrote"). The corrected rule:
**`$$` is consumed by the tokenizer (so the character after it is never reinterpreted as
the start of a key) but emitted verbatim as `$$`.** `$$HOME` stays `$$HOME` with `HOME`
never expanded; `mktemp /tmp/build.$$` is untouched. This was caught after Task 2 first
landed with the wrong semantics as specified above; the code was corrected to match this
ruling rather than the ruling bent to match the already-passing test.

The third test is the one that matters: it fails if extraction and substitution ever disagree.

- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement**, sharing one token definition.
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Mutation check** — make `referencedKeys` miss the `$key` form; the agreement test must fail. Restore.
- [ ] **Step 6: Commit** — `feat(substitute): extract referenced keys from a template`

---

### Task 3: The failed-output ledger

**Files:**
- Modify: `plugins/attractor/engine/src/core/engine.ts`
- Test: `plugins/attractor/engine/test/engine.test.ts`

**Interfaces:**
- Produces: a private `failedOutputs: Map<string, string>` (key -> owing node id), maintained beside the existing `nodeFailures`.

Populate when a node ends FAIL **or** is abandoned to a `retry_target` after exhausting retries — the same two events `unresolvedFailures` already treats as giving up on a node, for the same reason (§3.5's `execute_with_retry` returns `Outcome(status=FAIL)` on exhaustion unconditionally). Clear a node's keys when that same node later re-executes to SUCCESS or PARTIAL.

**It must never be readable from a condition.** It is a record, like `nodeFailures`.

- [ ] **Step 1: Write failing tests** — a graph where `build` fails then a repair loop re-runs it to SUCCESS; assert the ledger is empty at exit. A second where it stays failed; assert the key is owed.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Mutation checks** — (a) drop the clear-on-recovery branch; the repair-loop test must fail. (b) drop the retry-exhaustion population; the abandonment test must fail. Restore each, one at a time.
- [ ] **Step 6: Commit** — `feat(engine): ledger of outputs owed by failed nodes`

---

### Task 4: The eager input check — this closes I1

**Files:**
- Modify: `plugins/attractor/engine/src/core/engine.ts`
- Test: `plugins/attractor/engine/test/engine.test.ts`

Before invoking a handler, intersect `referencedKeys` over the node's substitutable attributes (`prompt`, `tool_command`, `tool_env`, `description`) with `failedOutputs`. On a non-empty intersection, do **not** invoke the handler; return:

```typescript
{
  status: Status.FAIL,
  failureReason: `required input '${key}' unavailable: node '${owner}' failed`,
}
```

Then add this node's `effectiveOutputs` to the ledger keyed to itself, so propagation is transitive. Routing proceeds through §3.7 unchanged.

- [ ] **Step 1: Write the failing test — the I1 shape, end to end**

```typescript
// build fails; check guards on a key build was supposed to write.
// Under 10.3 the guard is vacuously true, so before this task the run
// walked past the failure into deploy.
const I1 = `digraph g {
  start [shape=Mdiamond]; done [shape=Msquare];
  build  [shape=parallelogram, tool_command="false", outputs="artifact.path"];
  deploy [shape=parallelogram, tool_command="ship \${artifact.path}"];
  start -> build;
  build -> deploy [condition="context.artifact.path!=bad"];
  deploy -> done;
}`
// Expect: run halts, deploy never executes, failureReason names the key AND the node.
```

- [ ] **Step 2: Run and confirm it fails** — before the fix the path reaches `deploy`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Mutation check** — skip the intersection; the I1 test must fail with `deploy` in the path. Restore.
- [ ] **Step 6: Commit** — `fix(engine): fail a node whose declared inputs are unavailable (I1)`

---

### Task 5: `runs_on`

**Files:**
- Modify: `plugins/attractor/engine/src/core/engine.ts`
- Test: `plugins/attractor/engine/test/engine.test.ts`

`runs_on={always|success|failure}`, default `success`.

- `success` — the Task 4 check applies.
- `failure` — runs only if one of its referenced producers failed; references resolve to empty string.
- `always` — runs regardless; references resolve to empty string.

Deliberately separate from any "ignore my own failure" knob: conflating them makes a cleanup node silence its own genuine failures.

- [ ] **Step 1: Write failing tests** — the cleanup shape from the design (`work [outputs="resource.handle"]`, `cleanup [runs_on=always]`) reached in all three of work-succeeds, work-fails, work-abandoned. Plus: a `runs_on=failure` node does NOT run when everything succeeded.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Mutation check** — treat `always` as `success`; the cleanup-after-failure test must fail. Restore.
- [ ] **Step 6: Commit** — `feat(engine): runs_on axis for cleanup nodes`

---

### Task 6: `DATA-001` and `GATE-001` lint

**Files:**
- Modify: `plugins/attractor/engine/src/dot/lint.ts`
- Test: `plugins/attractor/engine/test/lint.test.ts`

**`DATA-001` (WARNING).** A `${key}` reference that no node declares in its effective outputs, that is not an engine built-in (`goal`, `graph.*`, `outcome`, `preferred_label`, `current_node`, `tool.*`), and that is not a `--param` key.

**WARNING, not ERROR, and the reason is load-bearing:** `--param` values arrive at runtime and the linter cannot see them, so an ERROR would refuse legitimate graphs. This is the CMD-001 lesson — an ERROR rule that false-positives makes a real pipeline unrunnable. The runtime check in Task 4 is the guard; this is the design-time hint. Its message must mention that a box node infers no outputs and needs an explicit `outputs=`.

**`GATE-001` (WARNING) — this is I2's real fix.** A graph where a failure route (a `condition="outcome=fail"` edge, a `retry_target`, or a `fallback_retry_target`) can reach the terminal node without passing through a declared `goal_gate` node. Such a gate does not gate. §3.4 scopes gates to *visited* nodes, so the engine is behaving exactly as specified — the defect is authorial and belongs here.

- [ ] **Step 1: Write failing tests** for both rules, each with a positive and a negative case.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement**, deriving the built-in set from `ENGINE_MANAGED_KEYS`/`ENGINE_MANAGED_PREFIXES` rather than retyping it.
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: False-positive sweep** — lint every DOT graph in the repository, including inline test fixtures and graphs in plan documents. **Zero findings outside the deliberately-invalid fixtures.** Report exactly what was swept and how many graphs.
- [ ] **Step 6: Mutation checks** — one per rule, single-branch, restored.
- [ ] **Step 7: Commit** — `feat(lint): DATA-001 missing output declaration, GATE-001 bypassable goal gate`

---

### Task 7: Integration, fixtures, audit, bundle

**Files:**
- Modify: `plugins/attractor/engine/test/engine.test.ts`, `plugins/attractor/.superpowers/spec-conformance.md`, `plugins/attractor/.superpowers/carry-forward.md`, `plugins/attractor/README.md`
- Rebuild: `plugins/attractor/dist/attractor.js`

- [ ] **Step 1: Rewrite the I1 and I2 fixtures.** They currently assert known-open conformant SUCCESS. I1 becomes the halt from Task 4. I2 becomes a `GATE-001` lint assertion — **the engine behaviour does not change**, because §3.4 makes it correct.
- [ ] **Step 2: Update the audit.** I1 CLOSED. I2 **reclassified**, not closed: it was never an engine defect, and the entry must say so plainly and say why filing it as one was a category error.
- [ ] **Step 3: Document the authoring burden** in the plugin README: a box node infers no outputs, so any LLM node another node depends on needs an explicit `outputs=`.
- [ ] **Step 4: Record the follow-up** — verifying `outputs=` against what a handler actually wrote, deliberately out of scope.
- [ ] **Step 5: Full suite.** Every test, `ATTRACTOR_LIVE` unset.
- [ ] **Step 6: `npm run build`** and confirm `dist/attractor.js` is in sync.
- [ ] **Step 7: Commit** — `docs: close I1, reclassify I2, rebuild bundle`

---

## Parallelism

| Track | Tasks | Notes |
|---|---|---|
| Foundation | 1, 2 | Independent of each other; may run in parallel. Everything else waits. |
| A (engine) | 3 -> 4 -> 5 | Strictly sequential: 4 needs 3's ledger, 5 modifies 4's check. |
| B (lint) | 6 | Parallel with track A once Task 1 has landed. Different files. |
| Final | 7 | After both tracks. |

Track A and Track B touch disjoint files (`core/engine.ts` vs `dot/lint.ts`) and disjoint test files.
