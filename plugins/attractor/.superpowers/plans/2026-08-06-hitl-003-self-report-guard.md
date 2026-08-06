# HITL-003 Self-Report Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new WARNING-severity lint rule, `HITL-003`, that flags an agent-inclusive human-gate node (`human.channel` containing `"agent"`) whose `human.context=` traces to a single, structurally-provable direct predecessor resolving to `Handler.CODERGEN` — closing the single-hop, box/LLM-shaped instance of the self-report evidentiary gap this project's Plan 4 reconciliation review surfaced.

**Architecture:** One new pure-graph-shape helper (`directPredecessor`) in `dot/graph.ts`, one new rule block in `dot/lint.ts`'s existing per-node loop (same file, same idiom as `HAND-001`/`HITL-001`), 16 new unit tests in `test/lint.test.ts`, one new ADR recording the CODERGEN-only scope decision, and a two-line README update. No new module, no new CLI verb, no new dependency, no persisted-format change, no runtime/handler change.

**Tech Stack:** TypeScript, Node ≥ 24 native type stripping, `node:test`/`node:assert/strict`. No build step for tests.

## Global Constraints

- Runtime: Node ≥ 24, native TypeScript type stripping, no build step (`AGENTS.md`).
- Dependency count stays at 2 (`@ts-graphviz/ast`, `esbuild`) — this plan adds zero.
- Test command: `cd plugins/attractor/engine && node --test` (full suite) / `cd plugins/attractor/engine && node --test test/lint.test.ts` (targeted).
- One commit for this task (small, tightly sequenced — see spec's "why one story, not five").
- Do not weaken a test to make it pass — if a test seems wrong, stop and say why instead.
- `HITL-003` is WARNING severity and must never cause `hasErrors()` to return `true`.
- Do not touch `HAND-001`, `HITL-001`, `HITL-002`, `GATE-001`, `DATA-001`, `DATA-002`, or any other existing lint rule's logic.
- Do not register `Handler.HUMAN`, touch `UNREGISTERED_HANDLER_KINDS`, or add any runtime channel/handler code — out of scope for this slice (roadmap Phase 2).

---

### Task 1: `HITL-003` self-report guard

**Files:**
- Create: `plugins/attractor/.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`
- Modify: `plugins/attractor/engine/src/dot/graph.ts` (add `directPredecessor`, near `outgoingEdges` at line 131)
- Modify: `plugins/attractor/engine/src/dot/lint.ts` (import `directPredecessor`; add the `HITL-003` block in the per-node loop, immediately after the existing `HAND-001` block, which ends around line 528)
- Modify: `plugins/attractor/engine/test/lint.test.ts` (add a `hitl003()` helper and 16 tests, placed immediately after the existing `HAND-001` test block, which ends around line 1446)
- Modify: `plugins/attractor/README.md` (two additions: the `## Lint rules` catalog line, and a caveat in `### What the linter can and cannot see`)

**Interfaces:**
- Consumes: `Graph`, `Node`, `Handler`, `HandlerKind` (`dot/graph.ts`, unchanged); `Diagnostic`, `Severity`, `lint(graph: Graph): Diagnostic[]`, `hasErrors(diags: Diagnostic[]): boolean` (`dot/lint.ts`, unchanged); `parseDot` (`dot/parse.ts`, unchanged).
- Produces: `directPredecessor(graph: Graph, nodeId: string): Node | null` — exported from `dot/graph.ts`, for any later story that needs single-predecessor tracing. The `HITL-003` diagnostic code itself, appended to `lint()`'s existing return array — no other module needs to call anything new.

- [ ] **Step 1: Confirm the baseline is green before touching anything**

Run: `cd plugins/attractor/engine && node --test`
Expected: all tests pass. As of this plan's writing: 487 tests, 486 passing, 1 intentionally skipped, 0 failing. Record the actual count you see — it's the regression baseline Step 8 checks against.

- [ ] **Step 2: Write ADR-006, recording the scope decision before any fixture is written**

Create `plugins/attractor/.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`:

```markdown
# ADR-006: HITL-003 traces self-report only through a direct Handler.CODERGEN predecessor

**Status:** accepted
**Date:** 2026-08-06
**Deciders:** Solution Architect

## Context

Plan 4's reconciliation review (`.superpowers/carry-forward.md`) found a gap in the planned
`agent` human-gate channel: nothing stops a graph author from setting `human.context=` to a
key written by the very node the gate exists to check, so a fresh, session-isolated `agent`
channel can still end up rubber-stamping a self-report. `AGENTS.md`'s doctrine names this
directly: "verification inside the context that produced the evidence is not verification."

FR-18 (`.delivery/prd.md`) asks for a lint-time guard. The open question this ADR resolves:
does "traced to a single, structurally-provable direct predecessor" mean *any* predecessor
whose declared or effective output could match, or specifically a `Handler.CODERGEN`
(box/LLM) predecessor?

## Decision

`Handler.CODERGEN` only. A new rule, `HITL-003` (WARNING), fires when a human-gate node's
`human.channel` contains the token `"agent"`, its `human.context=` is non-empty, and its
sole direct predecessor (in-degree exactly 1) resolves to `Handler.CODERGEN`.

`handlers/box.ts`'s `BoxHandler.execute` merges `outcome.contextUpdates` into context
unconditionally, before any success/failure branch — a `CODERGEN` predecessor can be proven,
statically, to have written *something* to context. `handlers/tool.ts`'s `ToolHandler.execute`
(lines 139-151) writes `tool.last_line`/`tool.output` only when `result.code === 0` — a
`TOOL` predecessor's write is conditional on a runtime exit code lint cannot see, so it
cannot be proven the same way. Including `Handler.TOOL` as a provable kind would produce a
false positive on the most natural topology this feature exists to catch ("tool fails →
escalate to a human/agent gate", where the tool node by construction did *not* write its
output).

The rule does not check *which* key `human.context=` names against what the predecessor
wrote — `INFERRED_OUTPUTS_BY_HANDLER[Handler.CODERGEN]` is deliberately `[]` (`dot/graph.ts`)
because box/LLM output keys are arbitrary strings decided by the model at runtime; there is
nothing honest to cross-reference at lint time. It fires on any non-empty `human.context=`
once the two structural facts (in-degree 1, predecessor is `CODERGEN`) hold.

## Alternatives considered

### Fire for any direct predecessor whose declared or effective output matches the named key

**Why it was attractive:** narrower, fewer false positives — only fires when the specific
key is provably written.
**Why rejected:** `declaredOutputs`/`effectiveOutputs` rely on an author-written `outputs=`
attribute, which is optional. A `CODERGEN` node with no `outputs=` declared would silently
escape the check even though its `contextUpdates` are exactly the self-report risk this rule
exists to catch. Checking predecessor *kind* rather than declared *key* catches the
undeclared case, which is the more common and more dangerous one.

### Include `Handler.TOOL` as a second provable predecessor kind

**Why it was attractive:** tool-command output is also visible in `human.context=` in
principle, and excluding it looks like reduced coverage.
**Why rejected:** demonstrated false positive above — a failed tool node writes nothing, so
a rule that fired on any `TOOL` predecessor would warn on graphs where no self-report risk
exists at all. Not a coverage tradeoff; a correctness one.

## Residual risk

Named explicitly, not left as a parenthetical, so it survives this rule shipping rather than
being treated as closed:

- **Multi-hop chains.** A `CODERGEN` node two or more hops upstream of the gate, through an
  intermediate node of any other kind, is invisible to this rule — it inspects only the
  direct predecessor. Pinned by test N6.
- **`Handler.TOOL` predecessors, declared or not.** Excluded by the decision above, with or
  without an `outputs=` declaration. Pinned by test N5.
- **Embedded-`Engine` visibility.** Per ADR-004, `Engine.run()` only checks `hasErrors()`
  (ERROR-only) — a direct `new Engine(...)` embed does not see this WARNING at all today.
  This is a pre-existing gap affecting every WARNING-severity rule, not new to `HITL-003`,
  tracked under Open Question 7 / FR-12. This rule states the gap; it does not close it.

Both structural gaps and the visibility gap are tracked as Open Questions in
`.delivery/prd.md` (owner: Product Owner / Solution Architect), not left to be rediscovered.

## Consequences

**We gain:** an author who wires `human.channel="agent"` at a gate fed directly by an LLM
node's own output now sees a WARNING before the `agent` channel exists to misuse it — the
guardrail lands before the road opens.

**We accept:** this closes one instance of the self-report hazard, not all of them (see
Residual risk). It is advisory only — `HITL-003` never sets `hasErrors()`, so no run is
blocked by it, and nothing today enforces that an author reads lint output before shipping a
graph.
```

- [ ] **Step 3: Add `directPredecessor` to `dot/graph.ts`**

In `plugins/attractor/engine/src/dot/graph.ts`, immediately after the existing `outgoingEdges` function (currently lines 131-133):

```ts
export function outgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.from === nodeId)
}

export function directPredecessor(graph: Graph, nodeId: string): Node | null {
  const incoming = graph.edges.filter((e) => e.to === nodeId)
  if (incoming.length !== 1) return null
  return graph.nodes.get(incoming[0].from) ?? null
}
```

This is condition-agnostic by design: it counts every edge into `nodeId` regardless of that
edge's own `condition` attribute. Do not filter by failure-route status the way `GATE-001`'s
inline predecessor logic does elsewhere in `lint.ts` — that is a different check for a
different purpose.

- [ ] **Step 4: Write the 16 failing tests in `test/lint.test.ts`**

Immediately after the existing `HAND-001` test block (ends around line 1446, the last test
being `'HAND-001 reports one diagnostic per offending node, not one per graph'`), add:

```ts
// ---------------------------------------------------------------------------
// HITL-003: an agent-inclusive human gate whose context traces to a single,
// structurally-provable Handler.CODERGEN predecessor. See ADR-006 for why
// CODERGEN-only (not Handler.TOOL, whose output is written conditionally on
// exit code and so cannot be proven at lint time).
// ---------------------------------------------------------------------------

function hitl003(src: string) {
  return lint(parseDot(src)).filter((d) => d.code === 'HITL-003')
}

test('HITL-003 fires when an agent-inclusive gate is fed directly by a CODERGEN node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize the work"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const found = hitl003(src)
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, Severity.WARNING)
  assert.equal(found[0].node, 'gate')
  assert.match(found[0].message, /review/)
  assert.match(found[0].message, /agent/)
})

test('HITL-003 fires when "agent" is not the first hop in human.channel', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="human,agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 respects type= overriding shape= on the gate node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=box, type="wait.human", human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 respects type= overriding shape= on the predecessor node', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=parallelogram, type="codergen", prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 1)
})

test('HITL-003 reports one diagnostic per offending node, not one per graph', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    reviewA [shape=box, prompt="summarize A"]
    gateA [shape=hexagon, human.channel="agent", human.context="reviewA.summary"]
    reviewB [shape=box, prompt="summarize B"]
    gateB [shape=hexagon, human.channel="agent", human.context="reviewB.summary"]
    start -> reviewA -> gateA -> reviewB -> gateB -> done
  }`
  assert.equal(hitl003(src).length, 2)
})

test('HITL-003 does not fire when human.channel has no agent hop', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="human", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when human.context is absent', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when human.context is whitespace-only', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="   "]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the gate has two direct predecessors', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    other [shape=box, prompt="do other work"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate
    start -> other -> gate
    gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire for a Handler.TOOL predecessor without outputs=', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    check [shape=parallelogram, tool_command="printf ok"]
    gate [shape=hexagon, human.channel="agent", human.context="check.output"]
    start -> check -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire for a Handler.TOOL predecessor with outputs= declared', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    check [shape=parallelogram, tool_command="printf ok", outputs="check.output"]
    gate [shape=hexagon, human.channel="agent", human.context="check.output"]
    start -> check -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the CODERGEN node is two hops back, not the direct predecessor', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    notify [shape=parallelogram, tool_command="printf notified"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> notify -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire when the sole direct predecessor is Handler.START', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    gate [shape=hexagon, human.channel="agent", human.context="start.anything"]
    start -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 does not fire on a channel name merely containing the substring "agent"', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agentic_reviewer", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hitl003(src).length, 0)
})

test('HITL-003 never sets hasErrors() -- advisory only', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  assert.equal(hasErrors(lint(parseDot(src))), false)
})

test('HITL-003 co-fires with HAND-001 without interference, since Handler.HUMAN is still unregistered', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const found = codes(src)
  assert.ok(found.includes('HITL-003'))
  assert.ok(found.includes('HAND-001'))
})

test('HITL-003 message names the predecessor, states advisory-only, and disclaims multi-hop/TOOL detection', () => {
  const src = `digraph G {
    start [shape=Mdiamond]  done [shape=Msquare]
    review [shape=box, prompt="summarize"]
    gate [shape=hexagon, human.channel="agent", human.context="review.summary"]
    start -> review -> gate -> done
  }`
  const message = hitl003(src)[0].message
  assert.match(message, /review/)
  assert.match(message, /[Aa]dvisory/)
  assert.match(message, /does not (block|detect)/)
})
```

- [ ] **Step 5: Run the new tests to see the positive cases fail**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: the tests asserting `hitl003(src).length` equals 1 or 2 (the `P1`-`P5`-shaped ones)
FAIL, since no code emits `HITL-003` yet. The tests asserting `.length === 0` (the `N1`-`N8`
ones) trivially PASS at this point — nothing fires yet, so "does not fire" is vacuously true.
That's expected; Step 7 re-verifies them meaningfully once the rule exists.

- [ ] **Step 6: Implement the `HITL-003` rule in `dot/lint.ts`**

First, add `directPredecessor` to the existing import from `./graph.ts` at the top of
`plugins/attractor/engine/src/dot/lint.ts`:

```ts
import {
  type Graph,
  Handler,
  INFERRED_OUTPUTS_BY_HANDLER,
  TYPE_TO_HANDLER,
  PASSTHROUGH_KINDS,
  RUNS_ON_MODES,
  RunsOn,
  runsOn,
  declaredOutputs,
  directPredecessor,
  effectiveOutputs,
  findByHandler,
  outgoingEdges,
  substitutableText,
  UNREGISTERED_HANDLER_KINDS,
} from './graph.ts'
```

Then, in the per-node loop (`for (const node of graph.nodes.values()) { ... }` starting at
line 410), immediately after the existing `HAND-001` block (the one that pushes a
`code: 'HAND-001'` diagnostic and closes around line 528), add:

```ts
    // HITL-003: an agent-inclusive human gate whose exposed context traces to
    // a single, structurally-provable direct predecessor -- a self-report
    // risk for the (not yet built) `agent` channel. WARNING, not ERROR: this
    // is advisory, catching one authoring shape of the hazard AGENTS.md names
    // ("verification inside the context that produced the evidence is not
    // verification"), not a runtime guarantee. See ADR-006 for why the check
    // is scoped to Handler.CODERGEN predecessors only, and for the residual
    // risk (multi-hop chains, Handler.TOOL predecessors) this does not close.
    if (node.handler === Handler.HUMAN) {
      const channelTokens = (node.attrs['human.channel'] ?? '').split(',').map((t) => t.trim())
      const context = (node.attrs['human.context'] ?? '').trim()
      if (channelTokens.includes('agent') && context !== '') {
        const predecessor = directPredecessor(graph, node.id)
        if (predecessor?.handler === Handler.CODERGEN) {
          diags.push({
            code: 'HITL-003',
            severity: Severity.WARNING,
            node: node.id,
            message:
              `human gate ${node.id} exposes context ("${node.attrs['human.context']}") to its ` +
              `"agent" channel, but that context traces to its sole direct predecessor, ` +
              `${predecessor.id}, which resolves to Handler.CODERGEN -- an LLM node whose own ` +
              `output may be the "evidence" the agent then judges (self-report). Advisory only: ` +
              `does not block the run, and does not detect multi-hop chains or Handler.TOOL ` +
              `predecessors (see ADR-006).`,
          })
        }
      }
    }
```

- [ ] **Step 7: Run the targeted tests again to verify all 16 pass**

Run: `cd plugins/attractor/engine && node --test test/lint.test.ts`
Expected: all tests in the file PASS, including every new `HITL-003` test — both the
previously-failing positive cases and the previously-vacuous negative cases, which now fire
the rule and correctly do not match.

- [ ] **Step 8: Run the full suite to confirm zero regressions**

Run: `cd plugins/attractor/engine && node --test`
Expected: the same pass/skip/fail shape recorded in Step 1 (486 passing, 1 intentionally
skipped, 0 failing), plus the 16 new tests now included in the total. If any other existing
test's assertion count or diagnostic list changed, stop — that means an existing fixture
incidentally matches `HITL-003`'s new shape, and needs investigating before continuing (this
is exactly the cross-file-regression check the spec's Testing section calls for).

- [ ] **Step 9: Update `README.md`**

In `plugins/attractor/README.md`'s `## Lint rules` section (currently ends with the
`HAND-001` sentence, around line 245), extend the rule catalog:

```
`DATA-001` a `${key}` no node declares; `DATA-002` an `outputs=` naming an
engine-managed or handler-owned key; `GATE-001` a failure route that reaches
the exit without passing a goal gate; `HAND-001` a node resolves to a handler
kind this build does not register (`hexagon`, `component`, `tripleoctagon`,
`house` -- see [Node shapes](#node-shapes)); `HITL-003` an agent-inclusive
human gate whose exposed context traces to a single Handler.CODERGEN direct
predecessor (self-report risk for the `agent` channel -- see ADR-006).

`RUNS-002`, `DATA-001`, `GATE-001`, `CMD-001` and `HITL-003` are warnings; the
rest are errors, and `attractor run` refuses a graph with any error.
```

And in the `### What the linter can and cannot see` section (currently ends with the
"Nothing verifies `outputs=`..." paragraph, around line 222), add a new paragraph:

```
`HITL-003` traces self-report risk through exactly one hop, to a node's direct
predecessor, and only recognises `Handler.CODERGEN` as a provable source --
not `Handler.TOOL`, whose output is written conditionally on exit code and so
cannot be proven at lint time (ADR-006). A multi-hop chain, or a `Handler.TOOL`
node feeding the gate, is invisible to it. It is also invisible on a direct
`new Engine(...)` embed today: `Engine.run()` only checks `hasErrors()`
(ERROR-only, per ADR-004), so a WARNING-severity rule reaches an embedder's
own output only if that embedder reads `lint()`'s return value directly.
```

- [ ] **Step 10: Commit**

```bash
git add plugins/attractor/.delivery/decisions/ADR-006-hitl-003-self-report-guard.md \
        plugins/attractor/engine/src/dot/graph.ts \
        plugins/attractor/engine/src/dot/lint.ts \
        plugins/attractor/engine/test/lint.test.ts \
        plugins/attractor/README.md
git commit -m "feat(attractor): add HITL-003 self-report guard for the agent channel

Warns when an agent-inclusive human gate's exposed context traces to
a single, structurally-provable Handler.CODERGEN direct predecessor
-- closing the single-hop instance of the self-report evidentiary
gap Plan 4's reconciliation review surfaced. Advisory only (WARNING);
does not block a run, and does not detect multi-hop chains or
Handler.TOOL predecessors (ADR-006, Residual risk).

Implements FR-18."
```

---

## Self-review notes

**Spec coverage:** every section of `2026-08-06-hitl-003-self-report-guard-design.md` maps
to a step above — Architecture/Components → Steps 2-4, 6, 9; Data flow/Error handling →
Step 6's WARNING-only design and Step 7's B1/B2 tests; Testing → Steps 4, 5, 7, 8; Scope
boundary → the Global Constraints section and every "does not fire"/"out of scope" note
above. No gap found.

**Placeholder scan:** no `TBD`/`TODO`; every step contains complete, real code or an exact
shell command with expected output; no "similar to Task N" (there is only one task); no
reference to a type or function not defined either in existing code (cited with file:line)
or in an earlier step of this same task.

**Type consistency:** `directPredecessor(graph: Graph, nodeId: string): Node | null` (Step 3)
is the exact signature consumed in Step 6. `Diagnostic`'s `code`/`severity`/`node`/`message`
shape (existing, `dot/lint.ts`) matches every `diags.push(...)` call in Step 6 and every
assertion in Step 4's tests. `hitl003(src)` (Step 4) and the rule's firing conditions (Step 6)
were cross-checked against all 16 fixtures by hand before this plan was written — see the
per-fixture reasoning in the handoff spec's Architecture section.
