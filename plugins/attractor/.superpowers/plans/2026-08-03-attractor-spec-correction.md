# Attractor Spec Correction Plan (Plan 3 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every place the engine contradicts the attractor specification, so the
implementation is a clean superset — conformant where it implements, extended where it
adds, contradicting nowhere.

**Architecture:** Surgical corrections to existing modules. No new subsystems. Each task
takes a numbered finding from `plugins/attractor/.superpowers/spec-conformance.md`, which carries the
normative spec quote for every item; this plan does not repeat those quotes, it
implements them.

**Tech Stack:** Unchanged. See `AGENTS.md` for the constraints that bind every task.

## Read first

- `AGENTS.md` (repo root) — conventions binding every plugin in this marketplace.
- `plugins/attractor/AGENTS.md` — **the doctrine**, spec adherence, and what is ported
  from the amplifier bundle.
- `plugins/attractor/.superpowers/spec-conformance.md` — the audit, with spec quotes, C1 through C14.

## This plan corrects contradictions. It does not retreat from the doctrine.

Every extension listed in `plugins/attractor/AGENTS.md` **stays**. Fail-closed goal gates, no-implicit-
timeout human gates, CMD-001/002, the `tool.` namespace guard, the stale-label rule,
worktree cleanup that refuses to destroy uncommitted work, loud aborts over silent
degradation — none of these contradict the spec, and none are in scope for removal.

Two corrections touch code near an extension. Both keep the extension:

- **C4 (goal gates over visited nodes)** changes *which* gates are checked. The
  fail-closed downgrade in `BoxHandler` is untouched.
- **C5 (default retries 0)** changes the default only. Explicit `max_retries` and
  `retry_target` behaviour is untouched.

If a correction appears to require deleting an extension, that is a signal to stop and
ask, not to delete it.

## Global Constraints

All of the root and plugin `AGENTS.md` conventions. The binding short form:

- Node >= 24, native type stripping: **no `enum`, `namespace`, `declare`, or constructor
  parameter properties**.
- Explicit `.ts` extensions on relative imports; `node:` prefix on builtins. ESM only.
- Dependencies stay exactly `@ts-graphviz/ast` and `esbuild`.
- **Never run `npm install`** — the public registry is unreachable from this machine.
- Rebuild `dist/attractor.js` whenever source changes.
- No emoji. Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

**Expect existing tests to change.** This plan alters documented behaviour. A test that
encodes our old, contradicting semantics is itself part of the defect and must be
updated to the spec's semantics — that is the one situation in this project where
changing a test to match new behaviour is correct. Say so explicitly in each report, and
never change a test that encodes an *extension*.

## Parallelism: partially, and the boundary is not arbitrary

**Two tracks can run concurrently. The third cannot be parallelised internally.**

The constraint is not file overlap alone — it is that routing semantics compound. Each
correction in Track C changes behaviour that the next correction's tests observe, and all
four land in `test/engine.test.ts`.

| Track | Findings | Source files | Parallel-safe? |
|---|---|---|---|
| **A. DOT layer** | C13, C14 | `dot/graph.ts`, `dot/parse.ts` | Yes — independent of routing |
| **B. Artifact contract** | C7, C10 | `handlers/box.ts`, `core/checkpoint.ts` | Yes — independent of routing |
| **C. Routing semantics** | C5, C2, C3, C8, C1, C9, C12, C4, C6, C11 | `core/retry.ts`, `core/condition.ts`, `core/edge-select.ts`, `core/engine.ts` | **No** — strictly sequential |

Why Track C is sequential, concretely:

- **C5 first.** Changing the retry default from 2 to 0 changes how many times every node
  in every engine fixture executes. Doing it after the routing changes means debugging
  two variables at once.
- **C2/C3/C8 next.** Making a missing key compare as empty string changes which edges are
  *eligible*, which is the input to edge selection. Correcting edge selection first would
  mean correcting it against the wrong condition semantics.
- **C1/C9/C12 next.** Edge selection's early-return shape must be right before the engine's
  failure routing is corrected, because C6 depends on what `selectEdge` returns on FAIL.
- **C4/C6/C11 last.** These are engine-level and read the corrected behaviour of all three
  layers below them.

**Mechanism for A and B:** dispatch each with `isolation: "worktree"` so the two agents
commit into separate worktrees and cannot race on the git index or on `dist/`. Merge
both before starting Track C. Do not run `npm run build` in a parallel agent — the
bundle is rebuilt once, at the end, in Task 8.

**Do not attempt to parallelise Track C by file.** `condition.ts` and `edge-select.ts`
look independent and are not: the eligible-set semantics span both.

---

## Task 1 (Track A, parallel): honour the `type` attribute and map `house`

**Findings:** C13, C14. Both are *silent* degradations — the worst class, because a
graph using them reports success while doing something else.

**Files:**
- Modify: `plugins/attractor/engine/src/dot/graph.ts`
- Modify: `plugins/attractor/engine/src/dot/parse.ts`
- Test: `plugins/attractor/engine/test/graph.test.ts`

**Interfaces:**
- Produces: `handlerForNode(attrs, id)` replacing `handlerForShape(shape, id)`; `Handler`
  gains `MANAGER_LOOP`.

- [ ] **Step 1: Write the failing tests**

Add to `test/graph.test.ts`:

```typescript
test('an explicit type attribute overrides the shape', () => {
  // Spec section 2.6: type "takes precedence over shape-based resolution".
  assert.equal(handlerForNode({ type: 'tool', shape: 'box' }, 'n'), Handler.TOOL)
  assert.equal(handlerForNode({ type: 'wait.human' }, 'n'), Handler.HUMAN)
  assert.equal(handlerForNode({ type: 'parallel.fan_in' }, 'n'), Handler.FAN_IN)
})

test('an unrecognised type falls back to shape rather than being ignored', () => {
  assert.equal(handlerForNode({ type: 'not-a-handler', shape: 'parallelogram' }, 'n'), Handler.TOOL)
})

test('house maps to the manager loop, not silently to an LLM node', () => {
  // Appendix B. Previously fell through to CODERGEN, so a supervisor node ran
  // its label through the model and the pipeline reported success.
  assert.equal(handlerForNode({ shape: 'house' }, 'n'), Handler.MANAGER_LOOP)
})

test('the shape mapping is otherwise unchanged', () => {
  assert.equal(handlerForNode({ shape: 'Mdiamond' }, 'n'), Handler.START)
  assert.equal(handlerForNode({ shape: 'Msquare' }, 'n'), Handler.EXIT)
  assert.equal(handlerForNode({ shape: 'box' }, 'n'), Handler.CODERGEN)
  assert.equal(handlerForNode({ shape: 'parallelogram' }, 'n'), Handler.TOOL)
  assert.equal(handlerForNode({ shape: 'diamond' }, 'n'), Handler.CONDITIONAL)
  assert.equal(handlerForNode({ shape: 'hexagon' }, 'n'), Handler.HUMAN)
  assert.equal(handlerForNode({}, 'start'), Handler.START)
  assert.equal(handlerForNode({}, 'n'), Handler.CODERGEN)
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd plugins/attractor/engine && node --test test/graph.test.ts
```
Expected: FAIL — `handlerForNode` is not exported.

- [ ] **Step 3: Implement**

In `src/dot/graph.ts`, add `MANAGER_LOOP: 'manager_loop'` to the `Handler` const object,
add `house: Handler.MANAGER_LOOP` to `SHAPE_TO_HANDLER`, and add the spec's external
type names alongside the existing shape map:

```typescript
/** Spec section 2.6 type strings, which differ from our internal handler keys. */
const TYPE_TO_HANDLER: Record<string, HandlerKind> = {
  start: Handler.START,
  exit: Handler.EXIT,
  codergen: Handler.CODERGEN,
  tool: Handler.TOOL,
  conditional: Handler.CONDITIONAL,
  'wait.human': Handler.HUMAN,
  parallel: Handler.PARALLEL,
  'parallel.fan_in': Handler.FAN_IN,
  'stack.manager_loop': Handler.MANAGER_LOOP,
}

/**
 * Resolve a node's handler from its attributes.
 *
 * An explicit `type` wins over shape (spec section 2.6). An unrecognised type
 * falls through to shape rather than being ignored, so a typo degrades to the
 * shape the author also wrote rather than silently becoming an LLM node.
 */
export function handlerForNode(attrs: Record<string, string>, id: string): HandlerKind {
  const declared = attrs.type
  if (declared !== undefined && TYPE_TO_HANDLER[declared] !== undefined) {
    return TYPE_TO_HANDLER[declared]
  }
  return handlerForShape(attrs.shape, id)
}
```

Keep `handlerForShape` exported — the tests for it still pass and it is the fallback.

In `src/dot/parse.ts`, replace both `handlerForShape(attrs.shape, id)` call sites with
`handlerForNode(attrs, id)` (the one in the `Node` case and the one in the defaults pass),
and update the import.

`defaultHandlers` in `core/engine.ts` does not register `MANAGER_LOOP`, so a `house` node
now aborts loudly with `no handler registered` — which is the intended behaviour for an
unimplemented shape and is what C14 asks for.

- [ ] **Step 4: Run to verify they pass**

```bash
cd plugins/attractor/engine && node --test
```
Expected: PASS, full suite green.

- [ ] **Step 5: Mutation-check and commit**

Delete the `TYPE_TO_HANDLER` lookup so `type` is ignored again; confirm the type tests
fail; restore. Then remove `house` from the shape map; confirm that test fails; restore.

```bash
git add plugins/attractor/engine
git commit -m "fix(dot): honour the type attribute and map house (C13, C14)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2 (Track B, parallel): the status file contract

**Findings:** C7, C10.

**Files:**
- Modify: `plugins/attractor/engine/src/handlers/box.ts`
- Modify: `plugins/attractor/engine/src/core/checkpoint.ts`
- Test: `plugins/attractor/engine/test/box.test.ts`, `test/checkpoint.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/box.test.ts`:

```typescript
test('the per-node artifact is status.json with the spec field names', async () => {
  // Appendix C. An external agent writes and reads status.json; outcome.json
  // with internal camelCase names is unreadable to a spec-conformant consumer.
  const dir = mkdtempSync(join(tmpdir(), 'attractor-status-'))
  try {
    const backend = new StubBackend({
      gate: { status: Status.SUCCESS, preferredLabel: 'ship', notes: 'all good' },
    })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('gate')!, graph: G, context: Context.from({ goal: 'g' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    const raw = JSON.parse(readFileSync(join(dir, 'gate', 'status.json'), 'utf8'))
    assert.equal(raw.outcome, 'success', 'field is `outcome`, not `status`')
    assert.equal(raw.preferred_label, 'ship', 'snake_case, not preferredLabel')
    assert.equal(raw.notes, 'all good')
    assert.equal(existsSync(join(dir, 'gate', 'outcome.json')), false, 'old name is gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the response is written to response.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-resp-'))
  try {
    const backend = new StubBackend({ plain: { status: Status.SUCCESS, notes: 'the answer' } })
    await new BoxHandler(backend).execute({
      node: G.nodes.get('plain')!, graph: G, context: Context.from({ goal: 'g' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(readFileSync(join(dir, 'plain', 'response.md'), 'utf8'), 'the answer')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a promptless node falls back to its own label, not the graph goal', async () => {
  // Spec section 4.5. Previously every promptless node got the same prompt.
  const g = parseDot(`
    digraph P {
      graph [goal="the shared goal"]
      start [shape=Mdiamond]  done [shape=Msquare]
      alpha [shape=box, label="do the alpha thing"]
      start -> alpha -> done
    }
  `)
  const backend = new StubBackend({})
  const dir = mkdtempSync(join(tmpdir(), 'attractor-label-'))
  try {
    await new BoxHandler(backend).execute({
      node: g.nodes.get('alpha')!, graph: g, context: Context.from({ goal: 'the shared goal' }),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(backend.calls()[0].prompt, 'do the alpha thing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an explicitly empty prompt also falls back to the label', async () => {
  // `??` treated prompt="" as set and dispatched a blank prompt.
  const g = parseDot(`
    digraph E {
      start [shape=Mdiamond]  done [shape=Msquare]
      beta [shape=box, prompt="", label="beta label"]
      start -> beta -> done
    }
  `)
  const backend = new StubBackend({})
  const dir = mkdtempSync(join(tmpdir(), 'attractor-empty-'))
  try {
    await new BoxHandler(backend).execute({
      node: g.nodes.get('beta')!, graph: g, context: Context.from({}),
      runDir: dir, cwd: dir, events: new EventLog(dir),
    })
    assert.equal(backend.calls()[0].prompt, 'beta label')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

Add to `test/checkpoint.test.ts`:

```typescript
test('the checkpoint uses the spec field names and carries a timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-cp-spec-'))
  try {
    saveCheckpoint(dir, {
      runId: 'r1', currentNode: 'verify', completed: ['start'],
      attempts: { verify: 1 }, context: { k: 'v' }, goalGatesSatisfied: [],
    })
    const raw = JSON.parse(readFileSync(join(dir, 'checkpoint.json'), 'utf8'))
    assert.equal(raw.current_node, 'verify')
    assert.deepEqual(raw.completed_nodes, ['start'])
    assert.deepEqual(raw.node_retries, { verify: 1 })
    assert.equal(typeof raw.timestamp, 'string')
    assert.ok(loadCheckpoint(dir), 'and it still round-trips')
    assert.equal(loadCheckpoint(dir)?.currentNode, 'verify')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd plugins/attractor/engine && node --test test/box.test.ts test/checkpoint.test.ts
```
Expected: FAIL — `status.json` and `response.md` do not exist; checkpoint keys are camelCase.

- [ ] **Step 3: Implement**

In `src/handlers/box.ts`, replace the prompt resolution and the artifact writes:

```typescript
    // Spec section 4.5: prompt, else the node's own label. `||` not `??`, so an
    // explicitly empty prompt falls back rather than dispatching a blank one.
    const rawPrompt = ctx.node.attrs.prompt || ctx.node.attrs.label || ''
    const prompt = substitute(rawPrompt, ctx.context)
```

and, where `outcome.json` was written:

```typescript
    // Appendix C wire shape. Named and keyed for an external consumer, not for
    // our internal Outcome type.
    const statusFile = {
      outcome: finalOutcome.status,
      preferred_label: finalOutcome.preferredLabel,
      suggested_next_ids: finalOutcome.suggestedNextIds,
      context_updates: finalOutcome.contextUpdates,
      notes: finalOutcome.notes,
    }
    writeFileSync(join(nodeDir, 'status.json'), JSON.stringify(statusFile, null, 2), 'utf8')
    writeFileSync(join(nodeDir, 'response.md'), finalOutcome.notes ?? '', 'utf8')
```

In `src/core/checkpoint.ts`, serialise to the spec's names while keeping the internal
type unchanged:

```typescript
interface CheckpointWire {
  timestamp: string
  run_id: string
  current_node: string | null
  completed_nodes: string[]
  node_retries: Record<string, number>
  context: Record<string, string>
  goal_gates_satisfied: string[]
}

function toWire(cp: Checkpoint): CheckpointWire {
  return {
    timestamp: new Date().toISOString(),
    run_id: cp.runId,
    current_node: cp.currentNode,
    completed_nodes: cp.completed,
    node_retries: cp.attempts,
    context: cp.context,
    goal_gates_satisfied: cp.goalGatesSatisfied,
  }
}

function fromWire(w: CheckpointWire): Checkpoint {
  return {
    runId: w.run_id,
    currentNode: w.current_node,
    completed: w.completed_nodes,
    attempts: w.node_retries,
    context: w.context,
    goalGatesSatisfied: w.goal_gates_satisfied,
  }
}
```

Use `toWire` in `saveCheckpoint` and `fromWire` in `loadCheckpoint`.

- [ ] **Step 4: Run to verify they pass**

```bash
cd plugins/attractor/engine && node --test
```
Expected: PASS. Existing tests asserting `outcome.json` must be updated to `status.json` —
they encode the contradicting behaviour and are part of the defect.

- [ ] **Step 5: Mutation-check and commit**

Revert the prompt fallback to `?? ctx.graph.attrs.goal`; confirm the label tests fail;
restore. Rename `status.json` back; confirm that test fails; restore.

```bash
git add plugins/attractor/engine
git commit -m "fix(handlers): spec status file contract and prompt fallback (C7, C10)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3 (Track C, sequential): retry default is 0

**Finding:** C5. Do this first — it changes how many times every node in every fixture
runs, and debugging it alongside routing changes means two variables at once.

**Files:**
- Modify: `plugins/attractor/engine/src/core/retry.ts`
- Test: `plugins/attractor/engine/test/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('a graph declaring no retry attributes gets no retries', () => {
  // Spec section 3.5: "If neither is set, the built-in default is 0."
  const g = parseDot(`
    digraph N {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]
      start -> a -> done
    }
  `)
  assert.equal(resolveRetryPolicy(g.nodes.get('a')!, g).maxRetries, 0)
})
```

- [ ] **Step 2: Run to verify it fails** — expected 0, got 2.

- [ ] **Step 3: Implement** — set `DEFAULT_POLICY.maxRetries` to `0` in `src/core/retry.ts`.

- [ ] **Step 4: Run the full suite**

Engine tests that relied on the implicit retries will now fail. Update each to declare
`max_retries` explicitly where the test's intent is to exercise retrying. Do NOT restore
the old default to make them pass — that is the defect.

- [ ] **Step 5: Mutation-check and commit**

Set the default back to 2; confirm the new test fails; restore.

```bash
git commit -m "fix(retry): default to 0 retries per spec section 3.5 (C5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4 (Track C): condition language

**Findings:** C2, C3, C8. This is the highest-value correction in the plan: C2 currently
inverts the spec's own documented loop-guard idiom.

**Files:**
- Modify: `plugins/attractor/engine/src/core/condition.ts`
- Test: `plugins/attractor/engine/test/condition.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test('a missing context key compares as an empty string', () => {
  // Spec section 10.3. This is the loop-guard idiom from the spec's own
  // section 10.6 example: true before loop_state is ever set.
  const c = Context.from({})
  assert.equal(evaluateCondition('context.loop_state!=exhausted', c, ok), true)
  assert.equal(evaluateCondition('context.loop_state=exhausted', c, ok), false)
  assert.equal(evaluateCondition('context.missing=', c, ok), true, 'equals empty')
})

test('an unqualified key resolves from context', () => {
  // Spec section 10.4: direct context lookup for unqualified keys.
  const c = Context.from({ tests_passed: 'true' })
  assert.equal(evaluateCondition('tests_passed=true', c, ok), true)
})

test('a context-prefixed key tries the literal key first', () => {
  // Spec section 10.4 tries `context.foo` before falling back to `foo`.
  const c = Context.from({ 'context.weird': 'yes', weird: 'no' })
  assert.equal(evaluateCondition('context.weird=yes', c, ok), true)
})

test('a bare key is a truthiness check', () => {
  // Spec section 10.5.
  assert.equal(evaluateCondition('context.ready', Context.from({ ready: 'x' }), ok), true)
  assert.equal(evaluateCondition('context.ready', Context.from({ ready: '' }), ok), false)
  assert.equal(evaluateCondition('context.ready', Context.from({}), ok), false)
})

test('a quoted literal is unquoted before comparison', () => {
  assert.equal(evaluateCondition('outcome="success"', Context.from({}), ok), true)
})

test('outcome and preferred_label still resolve', () => {
  assert.equal(evaluateCondition('outcome=success', Context.from({}), ok), true)
  assert.equal(evaluateCondition('preferred_label=green', Context.from({}), ok), true)
})

test('there is still no disjunction', () => {
  // Spec section 10.7 asks implementations not to add operators. A `||` is
  // literal text in the value, so the clause simply does not match.
  assert.equal(evaluateCondition('outcome=success || outcome=fail', Context.from({}), ok), false)
})
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Replace `leftValue` and the clause loop in `src/core/condition.ts`:

```typescript
/**
 * Resolve a clause's left-hand side.
 *
 * Spec section 10.4: a `context.`-prefixed key tries the literal key first, then
 * the key without the prefix; an unqualified key is a direct context lookup.
 * A key that resolves to nothing is the EMPTY STRING, not undefined — spec
 * section 10.3 requires missing keys to compare as empty, which is what makes
 * the loop-guard idiom `context.loop_state!=exhausted` true on first pass.
 */
function resolveKey(key: string, ctx: Context, outcome: Outcome): string {
  if (key === 'outcome') return outcome.status
  if (key === 'preferred_label') return outcome.preferredLabel ?? ''
  if (key.startsWith('context.')) {
    return ctx.get(key) ?? ctx.get(key.slice('context.'.length)) ?? ''
  }
  return ctx.get(key) ?? ''
}

/** Spec section 10.5: a double-quoted literal is unquoted before comparison. */
function parseLiteral(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  return v
}

export function evaluateCondition(expr: string, ctx: Context, outcome: Outcome): boolean {
  const trimmed = expr.trim()
  if (trimmed === '') return true

  for (const raw of trimmed.split('&&')) {
    const m = CLAUSE.exec(raw)
    if (m === null) {
      // Spec section 10.5: a clause with no operator is a truthiness check on
      // the bare key.
      const bare = raw.trim()
      if (bare === '') return false
      if (resolveKey(bare, ctx, outcome) === '') return false
      continue
    }
    const [, key, op, expected] = m
    const actual = resolveKey(key, ctx, outcome)
    const equal = actual === parseLiteral(expected)
    if (op === '=' ? !equal : equal) return false
  }
  return true
}
```

- [ ] **Step 4: Run the full suite**

The existing test `'an absent context key never matches'` encodes the contradicting
behaviour. Replace it with the new missing-key test; do not preserve it.

Edge-selection and engine tests may shift, because more edges are now eligible. Read each
failure before changing it: a test failing because a previously-dead edge is now correctly
eligible should be updated; a test failing because routing became wrong is a real defect.

- [ ] **Step 5: Mutation-check and commit**

Make `resolveKey` return `undefined` for a missing key and fail the clause; confirm the
loop-guard test fails; restore.

```bash
git commit -m "fix(condition): missing keys compare as empty, unqualified keys resolve (C2, C3, C8)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5 (Track C): edge selection

**Findings:** C1, C9, C12. C1 is the finding the controller introduced on a misreading;
see `spec-conformance.md` for that history.

**Files:**
- Modify: `plugins/attractor/engine/src/core/edge-select.ts`
- Test: `plugins/attractor/engine/test/edge-select.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test('a matching condition ends the cascade; a preferred label does not override it', () => {
  // Spec section 3.3 step 1 RETURNs. Steps 2 and 3 are scoped to unconditional
  // edges and only run "if no condition-matching edges were found".
  const g = parseDot(`
    digraph L {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  x [shape=box]  y [shape=box]
      start -> a
      a -> x [condition="outcome=success", label="left", weight=9]
      a -> y [condition="outcome=success", label="right", weight=1]
      x -> done  y -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'right' })
  assert.equal(e?.to, 'x', 'weight decides among matching conditions; the label does not')
})

test('suggested next ids are honoured in list order', () => {
  // Spec section 3.3 step 3 iterates the caller's list, so its ranking wins.
  const g = parseDot(`
    digraph S {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  p [shape=box]  q [shape=box]
      start -> a
      a -> p [weight=1]
      a -> q [weight=9]
      p -> done  q -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), {
    status: Status.SUCCESS, suggestedNextIds: ['p', 'q'],
  })
  assert.equal(e?.to, 'p', 'first suggestion wins over higher weight')
})

test('label normalization strips accelerators, not descriptions', () => {
  // Spec section 3.3: strip "[Y] ", "Y) ", "Y - " prefixes.
  const g = parseDot(`
    digraph A {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=hexagon]  x [shape=box]
      start -> gate
      gate -> x    [label="A - Approve"]
      gate -> done [label="R) Reject"]
      x -> done
    }
  `)
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Approve' })?.to, 'x')
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Reject' })?.to, 'done')
})

test('a description after a dash is part of the label', () => {
  const g = parseDot(`
    digraph D {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=hexagon]  x [shape=box]
      start -> gate
      gate -> x    [label="Abandon - keep the postmortem"]
      gate -> done [label="Continue"]
      x -> done
    }
  `)
  assert.equal(selectEdge(g, 'gate', Context.from({}),
    { status: Status.SUCCESS, preferredLabel: 'Abandon - keep the postmortem' })?.to, 'x')
})

test('an empty condition string counts as unconditional', () => {
  // Spec section 3.3 discriminates on emptiness, not presence.
  const g = parseDot(`
    digraph E {
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=box]  b [shape=box]
      start -> a
      a -> b    [condition="", label="plain"]
      a -> done [label="other"]
      b -> done
    }
  `)
  const e = selectEdge(g, 'a', Context.from({}), { status: Status.SUCCESS, preferredLabel: 'plain' })
  assert.equal(e?.to, 'b', 'an empty condition must not exclude the edge from step 2')
})
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

In `src/core/edge-select.ts`: treat an edge as conditional only when its condition is
non-empty; return immediately when any condition matches; scope steps 2 and 3 to
unconditional edges; take the first match in declaration order for labels; iterate
`suggestedNextIds` in the caller's order. Replace `normaliseLabel` with:

```typescript
/**
 * Spec section 3.3: lowercase, trim, and strip an accelerator prefix — the
 * `[Y] `, `Y) ` and `Y - ` forms. The rest of the label is significant; the
 * previous implementation truncated at the first dash, which collapsed
 * "red - retry" and "red - abort" into one label.
 */
function normaliseLabel(label: string): string {
  return label
    .replace(/^\s*(?:\[[A-Za-z0-9]\]|[A-Za-z0-9]\)|[A-Za-z0-9]\s+-)\s+/, '')
    .trim()
    .toLowerCase()
}
```

- [ ] **Step 4: Run the full suite**

The Plan 1 test `'a preferred label picks among several matching conditional edges'`
encodes the contradicting cascade. Replace it with the new test; do not preserve it.

- [ ] **Step 5: Mutation-check and commit**

Restore the filter-style eligible set; confirm the cascade test fails; restore.

```bash
git commit -m "fix(edge-select): spec cascade, label accelerators, empty conditions (C1, C9, C12)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6 (Track C): engine-level corrections

**Findings:** C4, C6, C11.

**Files:**
- Modify: `plugins/attractor/engine/src/core/engine.ts`
- Test: `plugins/attractor/engine/test/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test('a goal gate on an untaken branch does not block exit', async () => {
  // Spec section 3.4 checks VISITED nodes. A gate the run never reached is not
  // evidence the run failed to earn.
  const { result, dir } = await execute(`
    digraph U {
      start [shape=Mdiamond]  done [shape=Msquare]
      work [shape=box, prompt="x"]
      unreached [shape=parallelogram, goal_gate=true, tool_command="printf ok"]
      start -> work -> done
      work -> unreached [condition="context.never=1"]
      unreached -> done
    }
  `)
  try {
    assert.equal(result.status, Status.SUCCESS)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a gate that later fails blocks exit again', async () => {
  // Spec section 3.4 checks each gate's LATEST outcome, not a sticky set.
  const { result, dir } = await execute(`
    digraph R {
      start [shape=Mdiamond]  done [shape=Msquare]
      gate [shape=parallelogram, goal_gate=true, max_retries=0,
            tool_command="if [ -f .once ]; then printf red; exit 1; else touch .once; printf ok; fi"]
      loop [shape=box, prompt="again"]
      start -> gate
      gate -> loop [condition="outcome=success"]
      loop -> gate
      gate -> done [condition="outcome=fail"]
    }
  `)
  try {
    assert.equal(result.status, Status.FAIL, 'the latest gate outcome was a failure')
    assert.match(result.notes ?? '', /unsatisfied goal gates/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a FAIL outcome consults the node retry target', async () => {
  // Spec section 3.7 step 2, which was unreachable: retry targets were only
  // consulted on RETRY exhaustion.
  const { result, backend, dir } = await execute(`
    digraph F {
      start [shape=Mdiamond]  done [shape=Msquare]
      recover [shape=box, prompt="recover"]
      failing [shape=box, prompt="x", retry_target="recover", max_retries=0]
      start -> failing
      recover -> done
    }
  `, { failing: [{ status: Status.FAIL, notes: 'boom' }] })
  try {
    assert.ok(result.path.includes('recover'), 'the run routed to the retry target')
    assert.equal(backend.calls().filter((c) => c.nodeId === 'recover').length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('built-in context keys are set for conditions to read', async () => {
  // Spec sections 3.2 and 5.1: outcome, preferred_label, graph.goal.
  const { result, dir } = await execute(`
    digraph B {
      graph [goal="the goal"]
      start [shape=Mdiamond]  done [shape=Msquare]
      a [shape=parallelogram, tool_command="printf ok"]
      start -> a
      a -> done [condition="context.outcome=success && context.graph.goal=the goal"]
    }
  `)
  try {
    assert.equal(result.status, Status.SUCCESS, 'both built-in keys resolved')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Three changes in `src/core/engine.ts`:

1. Track gate outcomes per node rather than a sticky satisfied-set. Replace
   `goalGatesSatisfied: Set<string>` with `gateOutcomes: Map<string, Status>`, write the
   node's latest status on every completion, and compute unsatisfied gates as: visited
   gate nodes whose latest status is neither SUCCESS nor PARTIAL. A gate never visited is
   not considered.
2. On a FAIL outcome with no matching edge, consult `resolveRetryTarget(node, graph)`
   before terminating, per spec section 3.7's ladder.
3. Seed and maintain the built-in keys: mirror graph attributes under `graph.<name>` as
   well as their bare names, and after each node set `context.outcome`,
   `context.preferred_label` and `context.current_node`.

Keep `Checkpoint.goalGatesSatisfied` in the wire shape by deriving it from
`gateOutcomes` at save time, so Task 2's checkpoint contract is unaffected.

- [ ] **Step 4: Run the full suite** — update tests encoding the old semantics.

- [ ] **Step 5: Mutation-check and commit**

For each of the three: revert it, confirm the corresponding test fails, restore.

```bash
git commit -m "fix(engine): visited goal gates, FAIL retry targets, built-in keys (C4, C6, C11)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: conformance lint rules

**Finding:** the absent `condition_syntax` rule, which compounds with C2/C3/C8 — a typo
in a condition silently disables an edge instead of failing validation.

**Files:**
- Modify: `plugins/attractor/engine/src/dot/lint.ts`
- Test: `plugins/attractor/engine/test/lint.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test('COND-001 rejects a malformed condition', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]
    start -> a
    a -> done [condition="outcome success"]
  }`
  assert.ok(codes(src).includes('COND-001'))
})

test('COND-001 accepts every valid clause form', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [shape=box]  b [shape=box]  c [shape=box]
    start -> a
    a -> b    [condition="outcome=success && context.k!=v"]
    a -> c    [condition="context.ready"]
    b -> done [condition="preferred_label=\\"ship\\""]
    c -> done
  }`
  assert.ok(!codes(src).includes('COND-001'))
})

test('TYPE-001 rejects an unknown type attribute', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    a [type="not-a-handler"]
    start -> a -> done
  }`
  assert.ok(codes(src).includes('TYPE-001'))
})
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement** — add `COND-001` (ERROR) validating each `&&`-separated clause
against the grammar, and `TYPE-001` (ERROR) checking `type` against the known handler
names. Export the type-name table from `dot/graph.ts` so lint and resolution cannot drift.

- [ ] **Step 4: Run the full suite** — the canonical `task-runner.dot` commands must still
lint clean.

- [ ] **Step 5: Mutation-check and commit**

---

## Task 8: re-audit, rebuild, record

- [ ] **Step 1: Rebuild the bundle**

```bash
cd plugins/attractor/engine && npm run build
```

- [ ] **Step 2: Run a real pipeline end to end**

Repeat the Plan 2 acceptance run — a `claude` box node writing a file, a deterministic
gate verifying it, in a worktree — and confirm it still converges. Record the output.

- [ ] **Step 3: Update the conformance document**

Mark each of C1-C14 as corrected, deferred with a reason, or still open. Anything still
open must say which plan owns it.

- [ ] **Step 4: Update `plugins/attractor/AGENTS.md`** if any extension's rationale changed. It should not
have — but if a correction forced an extension to move, that is the record.

- [ ] **Step 5: Commit**

```bash
git add plugins/attractor docs AGENTS.md plugins/attractor/AGENTS.md
git commit -m "chore: rebuild bundle and record conformance status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification

- [ ] `node --test` green, live test skipped.
- [ ] Every C1-C14 item marked corrected, deferred with a reason, or open with an owner.
- [ ] The canonical `task-runner.dot` still lints clean.
- [ ] A real pipeline still converges end to end.
- [ ] Every extension listed in `plugins/attractor/AGENTS.md` still present and still tested.
- [ ] Bundle rebuilt and committed.

## Deliberately not in scope

C7's *bidirectional* half — reading a `status.json` written by an external agent — is
deferred to the plan that adds the manager loop, which is the feature that needs it.
Writing the correct file now is what unblocks that later.

Model stylesheets, transforms, the artifact store, subgraph scoping, `allow_partial`,
`auto_status`, `SKIPPED` handling and resume-from-checkpoint remain unimplemented. They
are absences, not contradictions — but after this plan they must be **loud** absences.
Any that still degrade silently should be filed against the plan that implements them.
