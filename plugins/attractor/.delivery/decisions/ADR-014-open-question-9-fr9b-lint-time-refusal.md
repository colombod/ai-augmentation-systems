# ADR-014: Open Question 9 — FR-9b lint-time refusal, and the `GATE-002` rule that implements it

**Status:** accepted
**Date:** 2026-08-09
**Deciders:** Product Owner (FR-9a-vs-FR-9b resolution), Solution Architect (this ADR's own `GATE-002` design)

## Context

`.delivery/initiatives/spec-conformance-mvp/prd.md`'s Open question 9 (`prd.md:120`) asks whether closing "the `outputs=`-opt-in
gap" (S4 — a graph missing `outputs=` must not silently report success) requires overturning
`engine.test.ts`'s currently-passing `'I1 is opt-in...'` test, and if so, whether the mechanism is
a runtime-verdict change (FR-9a, `prd.md:69`) or a lint-time-only refusal (FR-9b, `prd.md:70`).
`roadmap.md` gives this its own phase (Phase 3, `roadmap.md:101`) and calls it, twice, "the single
highest-leverage open decision on this whole board — this project's own founding-incident class"
(`roadmap.md:94-96`, `roadmap.md:473`).

### Decision 1: FR-9a vs FR-9b — resolved, not re-derived here

**The Product Owner has resolved Open Question 9 as FR-9b: lint-time-only refusal. The runtime
verdict is unchanged.** This ADR does not re-litigate that call; it is recorded here only because
an ADR is where a resolved decision needs a durable home, and because Decision 2 below is built on
top of it. The reasoning, already settled:

- `attractor-spec.md` §11.3, read literally: *"Pipeline outcome is 'success' if all `goal_gate`
  nodes reached `SUCCESS` or `PARTIAL_SUCCESS`, 'fail' otherwise."* A graph with zero `goal_gate`
  nodes vacuously satisfies "all ... reached SUCCESS", and `status: success` is the spec-conformant
  answer regardless of what failed internally. This is the **currently shipped** runtime behavior,
  proven by the currently-passing `'I1 is opt-in: an undeclared key gives no protection, and
  DATA-001 says so'` test (`engine/test/engine.test.ts:1474`).
- FR-9a (a runtime-verdict change) would not match that literal text, and it would reopen a
  previously reverted fix: `AGENTS.md`'s "An unresolved failure is recorded and said out loud —
  but it does not change the verdict" doctrine entry (`AGENTS.md:114-140`) records, by name, that
  an earlier round of this exact branch made a run report FAIL by a run-level rule instead of by
  §11.3's own goal-gate mechanism, that this **contradicted §11.3** and was **withdrawn**, and
  that "I1 is CLOSED by declared `outputs=` plus an eager reference scan" while "I1's protection
  is fully opt-in" is the boundary that was kept, deliberately, as the correct scope of the fix.
  `AGENTS.md`'s own "stop and ask" rule (`AGENTS.md:157`: *"If a change appears to require
  deleting one of these, stop and ask. That is a signal, not a licence."*) applies to FR-9a
  specifically for exactly this reason — it is not a call the Solution Architect or an
  implementer makes alone.
- The founding incident itself (a goal-gate judge's own fail-open default on an *ambiguous
  verdict*) is a different failure shape from "a graph with no gate at all" — a gate that
  existed and judged wrong, not an absent gate. It motivates fail-closed *gates* (already shipped,
  `AGENTS.md`'s first doctrine entry); it does not clearly generalize to overriding §11.3's own
  quantifier for graphs that declare none.
- FR-9b matches the spec as written, touches no runtime verdict, and closes the gap by refusing
  the **hazardous graph shape** before a run starts — the same posture `HAND-001` already takes
  for an unregistered handler kind (`lint.ts:552-567`): "Today's abort ... happens mid-run, after
  any earlier nodes have already spent tokens or made changes. Refused here instead, before
  anything runs."

**What was not yet decided, and is this ADR's own job:** FR-9b's PRD row (`prd.md:70`) says only
"a lint rule flags this shape as an ERROR before the graph runs" — it does not say which shape.
That is Decision 2.

## Decision 2: the exact lint rule — `GATE-002`

**Trigger condition.** `GATE-002` (ERROR) fires on a graph where `wantsVerdict` (`backend/argv.ts:
42`, `node.attrs.goal_gate === 'true'`) is false for every node — the same "zero declared goal
gates" predicate `lint.ts` already computes twice (`reachableFrom`'s `hasGoalGate`, `lint.ts:62`;
`GATE-001`'s own `gates.size > 0` guard, `lint.ts:1046`) — **and**, within that graph, there
exists an edge `e = (n -> m)` such that:

1. `n.handler` is not in `PASSTHROUGH_KINDS` (`graph.ts:248`, `= [START, EXIT, CONDITIONAL]`) —
   `n` can produce a `FAIL` outcome. This is the exact `NEVER_FAILS` set `GATE-001` already
   uses (`lint.ts:240`) for the identical reason: "a failure route leaving a node that cannot
   fail is dead, and flagging it would be a false positive."
2. `e.attrs.condition` is defined and non-empty after trimming — `e` is a **conditional** edge,
   matching `edge-select.ts`'s own `isConditional` predicate exactly (`edge-select.ts:53`, today
   private to that file; this rule needs it exported, see Consequences). An **unconditional**
   edge is structurally excluded from concern: `selectEdge`'s own code (`edge-select.ts:84-94`)
   only evaluates conditional edges in its Step-1 match, and on a `FAIL` outcome with no
   conditional match it returns `null` — "fail-fast: with no condition explicitly matching the
   failure, no unconditional edge may carry it forward." An unconditional edge can never be the
   vehicle for this hazard; that is the runtime's own already-correct behavior, not a gap.
3. At least one `&&`-joined clause of `e.attrs.condition` references a key `k` (after the
   `context.`-prefix stripping `resolveKey` itself performs, `core/condition.ts:47-49` — note
   `resolveKey` lives in `condition.ts`, not `edge-select.ts`, though `evaluateCondition` calls
   through to it) such that
   `k` is not `outcome`, not `preferred_label` (the two live, outcome-derived keys — see below),
   is not `isEngineManagedKey(k)`, and is **not a member of `supplied`** — the exact
   `Set<string>` `DATA-001` already builds (`lint.ts:1001-1004`: graph attrs ∪ every node's
   `effectiveOutputs`). In other words: `k` is a key **nothing in the graph declares, infers, or
   seeds** — the identical "nothing owes this" test `DATA-001` already asks, reused rather than
   restated.
4. `evaluateCondition(e.attrs.condition, EMPTY_CONTEXT, {status: FAIL})` is `true` **and**
   `evaluateCondition(e.attrs.condition, EMPTY_CONTEXT, {status: SUCCESS})` is also `true` — the
   condition is **outcome-blind**: it does not discriminate `n` succeeding from `n` failing, and
   it is satisfiable purely because the referenced key resolves to `''` (spec §10.3) against the
   worst-case empty context. This is deliberately the mirror image of `isFailureRoute`
   (`lint.ts:214-224`), which requires true-on-FAIL **and false-on-SUCCESS** — a genuine,
   author-declared failure route. `GATE-002` requires the opposite: true on **both**, which is
   exactly what `isFailureRoute`'s own doc comment names and defers: *"a vacuously-true guard ...
   is true on success and failure alike: an ordinary edge, and finding I1's shape rather than
   I2's. That is the eager input check's business, not this rule's."* `GATE-002` is that
   business, at design time, for the one case (§11.3's own quantifier) where nothing at runtime
   ever catches it either.
5. `m` can reach some node in `exits` (`findByHandler(graph, Handler.EXIT)`) via ordinary edge
   reachability — a plain BFS, structurally identical to the traversal `bypassesGates` already
   performs (`lint.ts:249-263`) when its `gates` argument is empty (its `gates.has` checks are
   then always false, so it degenerates exactly to "can `entry` reach an exit"). The
   implementation should factor that shared traversal out rather than re-derive it, but this ADR
   does not mandate the refactor's shape — that is implementation, not design.

When all five hold, `GATE-002` reports: *node `n`'s outgoing edge to `m` (condition
`"${e.attrs.condition}"`) is satisfied whether `n` succeeds or fails, because it depends on
`${k}`, which nothing in this graph declares, infers, or seeds — and `m` can reach the exit node
with no goal gate anywhere to catch the resulting unearned success. Declare `${k}` from a real
producer, rewrite the condition to discriminate on `outcome`, or add a `goal_gate=true` node on
this path.*

**Why the broad reading ("any zero-`goal_gate`-node graph, unconditionally") is wrong, not just
simpler.** The task's own starting candidate treats *every* graph with no `goal_gate` node as the
hazard, reasoning that such a graph's verdict can never reflect any internal failure "by
construction." That reasoning is correct about §11.3's quantifier in isolation but wrong about
what the *engine* actually does with a plain, ungated pipeline: `selectEdge`'s fail-fast rule
(point 2 above) means an **ordinary linear pipeline with no conditional edges at all** — `start ->
build -> test -> deploy -> exit`, every edge unconditional, no `goal_gate` anywhere — already
cannot silently succeed on an internal failure. If `build` fails, no unconditional edge carries it
forward, the run halts, and `status` is `FAIL`. That is the single most common shape a pipeline
author writes, it is provably safe by construction, and the broad reading would refuse it anyway,
purely because it has no gate — the exact false-positive cost the task named as real. The
narrower, condition-4-gated reading is not a weaker version of the same rule; it is the version
that is actually *true* about which graphs are hazardous, verified against `selectEdge`'s real
code rather than assumed from §11.3's prose alone.

**Severity: ERROR.** Matches `HAND-001`'s posture (refuse the shape before a run starts), and the
justification is the same shape `DATA-002` and `RUNS-001` already use in this file: **there is no
legitimate way to write this exact shape on purpose.** An author who genuinely wants "continue
past `n` regardless of whether it succeeded or failed" has two idiomatic, non-vacuous ways to say
so in this dialect — two edges, `condition="outcome=success"` and `condition="outcome=fail"`
(each properly discriminating, `isFailureRoute`-true for the second), or one edge conditioned on
a key the graph actually supplies (a `goal="..."` attribute, a declared `outputs=`) — and neither
trips `GATE-002`, because point 3 or point 4 fails for both. The *only* way to trigger this rule
is to condition on a key nobody produces, which is either a typo (the literal I1 shape) or an
accidental reliance on spec §10.3's empty-string default standing in for real routing logic —
never a pattern worth protecting. `DATA-001`'s own reason for staying WARNING (`--param` supplies
keys at runtime that lint cannot see, `lint.ts:968-977`) does not transfer: `GATE-002`'s condition
3 already excludes any key a `--param` could plausibly supply through the same `supplied` set
`DATA-001` uses for that exact purpose — a `--param`-suppliable key is definitionally something
an author *could* declare as a graph attribute default or reference through `effectiveOutputs`,
and either path removes it from `supplied`'s complement. What remains after that exclusion is
narrower than what CMD-001's lesson (an ERROR that made a real pipeline unrunnable) warns against.

**Code and placement.** `GATE-002` — the next number in the `GATE-` family (`GATE-001` is the
only existing member; grepped, confirmed). It belongs immediately alongside `GATE-001`, in
`lint.ts`'s final graph-level block (after the per-node loop, after `DATA-001`'s `supplied` set is
built), as the natural `else` to `GATE-001`'s own `if (gates.size > 0 && exitIds.size > 0)`
guard (`lint.ts:1046`): `GATE-001` examines graphs that declare at least one gate and checks
whether a *declared, intentional* failure route bypasses it; `GATE-002` examines the complementary
set — graphs that declare **no** gate at all — and checks whether an *accidental, vacuous*
condition lets a failure through anyway. Sharing the block means both reuse the same `gates`,
`exitIds`, and `NEVER_FAILS` values already in scope, and the file gains one new symmetrical rule
rather than a disconnected third mechanism.

### False-positive / hazard-shape analysis

**Legitimate shape 1 — the plain linear pipeline, no conditions, no gate.**
`start -> build -> test -> deploy -> exit`, every edge unconditional, `build`/`test`/`deploy` are
`Handler.TOOL` nodes. No edge is conditional at all, so point 2 never holds for any edge —
`GATE-002` never examines it. Correctly silent: fail-fast already guarantees this graph reports
`FAIL`, not `SUCCESS`, on any internal failure; there is no escape route to refuse.

**Legitimate shape 2 — a declared, intentional failure-recovery route, no gate.**
`build [tool_command=...] ; build -> notify_failure [condition="outcome=fail"] -> exit ; build ->
deploy [condition="outcome=success"] -> exit`. No `goal_gate` anywhere — the author has decided
this pipeline reports success once the failure has been acknowledged, which is a legitimate,
self-documenting choice this decision's own reasoning (Decision 1) explicitly protects. Point 4
fails: `evaluateCondition("outcome=fail", EMPTY_CONTEXT, SUCCEEDED)` is `false` (`outcome`
resolves to `'success'` live from the `Outcome` object, not from context, so it is never
`''`-vacuous) — the condition properly discriminates, `isFailureRoute` would call it `true`, and
`GATE-002`'s complementary test correctly stays silent.

**Hazard shape 1 — the I1-is-opt-in fixture itself, verbatim.**
`build [tool_command="exit 1"]` (no `outputs=`) `-> publish [condition=
"context.build.error!=fatal"]` `-> exit`. No goal gate. `build.error` is in nobody's
`effectiveOutputs` and not a graph attribute — outside `supplied` (point 3 holds).
`evaluateCondition("context.build.error!=fatal", EMPTY_CONTEXT, FAILED)`: `resolveKey` returns
`''` (nothing set), `'' != 'fatal'` is `true` — and the identical evaluation against `SUCCEEDED`
is also `true`, since the clause never inspects `outcome` at all (point 4 holds, vacuous). `publish
-> exit` is reachable (point 5 holds). `GATE-002` fires — refusing the exact graph
`'I1 is opt-in...'` currently lets run to a green `SUCCESS` exit.

**Hazard shape 2 — the condition-only variant `DATA-001` itself cannot see.**
`build [tool_command="exit 1"]`, **no `outputs=` declared** (same as hazard shape 1 — this
matters, see below) `-> publish [condition="context.build.error!=fatal"]`, but this time
`publish`'s prompt is `"publish the artifact"`, carrying **no** `${}` reference anywhere. No
goal gate. `engine.test.ts:1540`'s `'I1 does not reach a reference that appears only in an edge
condition'` test proves this graph still walks to a green `SUCCESS` exit, and its own comment
records that `DATA-001` is silent on it too ("Residual R6 ... `DATA-001`'s own blind spot"),
because `DATA-001` scans only `substitutableText(node)` (prompt/`tool_command`), never
`condition` attributes — with no substitution reference anywhere in this graph, `DATA-001` has
nothing to scan. `GATE-002` examines `e.attrs.condition` directly, using the same evaluator
`selectEdge` uses at runtime, so points 3-5 evaluate exactly as in hazard shape 1: `build.error`
is absent from `supplied` (still undeclared) and the condition is outcome-blind — `GATE-002`
fires, closing a gap neither `DATA-001` nor the runtime's eager check can see.

**The declared-`outputs=` case is a different, narrower gap `GATE-002` does not close.** If
`build` *does* declare `outputs="build.error"` while `publish`'s prompt still references
nothing, the graph still walks to `SUCCESS` (I1's eager check only inspects substituted text,
so a declared-but-unsubstituted key earns no protection either), but `GATE-002` correctly stays
silent: `build.error` is now in `supplied` (`effectiveOutputs` includes declared `outputs=`
unconditionally, `graph.ts:459-461`), so condition 3 fails — `build.error` has a real, declared
producer, and the fact that nothing happens to *substitute* it is a genuinely different question
(a producer that goes unread, not a reference to a nonexistent producer). This is residual R6's
declared-producer variant, and it stays open; see Residual risk.

### Interaction with existing rules

- **`DATA-001` (WARNING).** Co-fires with `GATE-002` whenever the same undeclared key is *also*
  referenced in a node's substitutable text (hazard shape 1: `build.error` appears in both
  `publish`'s condition and its prompt) — expected, not a conflict. `DATA-001` is a general
  "nothing declares this" hint over *substitution* references; `GATE-002` is a narrower, stronger
  claim that a *specific* occurrence, in an *edge condition*, in a *zero-gate* graph, provably
  lets a failure reach an unearned `SUCCESS`. `GATE-002` fires alone on hazard shape 2
  (condition-only reference, undeclared producer) — `DATA-001` stays silent there by its own
  documented design (R6), and `GATE-002` does not need `DATA-001` to have fired first; it reads
  `e.attrs.condition` directly rather than through `DATA-001`'s output.
- **`GATE-001` (WARNING).** Cannot co-fire on the same graph: `GATE-001`'s guard is `gates.size >
  0`, `GATE-002`'s is `gates.size === 0` — the two rules partition every graph into disjoint
  cases by construction. They are the same underlying question — "can a real, unrecovered failure
  reach the exit unjudged" — asked on the two complementary shapes of the graph (has a gate to
  bypass / has none to bypass at all), which is why they share a block, a severity family name,
  and most of their supporting machinery (`NEVER_FAILS`, `exitIds`, reachability), and why
  `GATE-001` stays WARNING while `GATE-002` is ERROR: `GATE-001`'s failure routes are
  `isFailureRoute`-true, author-declared, and only *maybe* unwise (bypassing a gate the author
  chose to add is a real but survivable authoring mistake); `GATE-002`'s are outcome-blind and,
  per the severity argument above, never intentional.

## Alternatives considered

#### Broad trigger: refuse every graph with zero `goal_gate` nodes, unconditionally

**Why it was attractive:** the task's own stated starting candidate; matches a direct, literal
reading of §11.3's quantifier with no further analysis required; one line of code
(`!hasGoalGate`).
**Why rejected:** demonstrated false positive above (Legitimate shape 1) — it refuses the single
most common, provably-safe pipeline shape in this dialect (a plain linear pipeline relying
entirely on fail-fast), for no safety gain, since fail-fast already makes that shape's `status`
track reality without any gate. This is exactly the false-positive cost the task asked to be
weighed, and it is not hypothetical: `roadmap.md`'s own Phase 0 retrospective and every existing
fixture in `engine/test/` that has no `goal_gate` node and no conditional edges would be refused
by this reading.

#### Key the new rule off `DATA-001`'s existing computation (substitution-text scan) instead of reading `condition` directly

**Why it was attractive:** zero new parsing surface — `DATA-001` already computes "referenced,
undeclared, dotted key"; promoting its findings to ERROR when `gates.size === 0` would need no
new condition-evaluation logic in `lint.ts` at all.
**Why rejected:** demonstrated false negative in hazard shape 2 and by the dedicated
`'I1 does not reach a reference that appears only in an edge condition'` test
(`engine.test.ts:1540`), whose own comment names this as `DATA-001`'s own blind spot (residual
R6): a condition-only reference is invisible to `substitutableText`. Keying `GATE-002` off
`DATA-001`'s output would inherit that blind spot for the exact case — condition-only vacuous
references — that is structurally closest to the I1 mechanism itself. Reading `e.attrs.condition`
directly, with the same evaluator `selectEdge` uses, has no such gap.

#### WARNING severity, matching `DATA-001`/`GATE-001`'s own family precedent

**Why it was attractive:** every other rule this new rule sits nearest to in the file
(`DATA-001`, `GATE-001`) is WARNING, and `AGENTS.md`'s CMD-001 lesson explicitly warns against an
ERROR rule that makes a legitimate pipeline unrunnable — the safer default in this file's own
established discipline.
**Why rejected:** the severity analysis above shows the CMD-001 lesson does not transfer here —
after condition 3's exclusion of every key a `--param` or a declared `outputs=`/graph attribute
could legitimately supply, what remains is a condition that can only be satisfied by a key
*nothing* in the graph or its runtime inputs could ever produce, in the one situation (`§11.3`'s
own quantifier over zero gates) where nothing else — no eager check, no gate — will ever catch it
either. `DATA-001` stays WARNING because its question ("does anything produce this key") is
genuinely unanswerable at design time; `GATE-002`'s question ("does this specific edge let a
failure through unjudged") is answerable, closed, and, per Decision 1's own resolved reasoning,
the exact founding-incident-class gap FR-9b exists to close. Leaving it WARNING would ship FR-9b
in name only — an ignorable hint an operator can run straight past, which is the S4 gap restated,
not closed.

#### Also flag `retry_target`/`fallback_retry_target`-based continuation, matching `GATE-001`'s own second route source

**Why it was attractive:** `GATE-001` treats a node's own `retry_target` reaching an unguarded
exit as a bypass route on the same footing as an edge condition (`lint.ts:1069-1084`); parity
would make `GATE-002` a strict structural mirror.
**Why rejected:** a `retry_target` dispatches a **real node** that runs and earns its own outcome
— it is an explicit, author-declared fallback mechanism (the same category as Legitimate shape 2
above), not a vacuous routing artifact with no work behind it. Reaching it and it succeeding is
not "a failure silently passed through," it is "a failure triggered a real, chosen recovery path
that then genuinely succeeded" — arguably exactly what an author wants from a `retry_target`.
Folding it into `GATE-002` would reintroduce the same false-positive class Legitimate shape 2
demonstrates, for a mechanism this rule's own severity argument (no legitimate use survives
condition 3+4) does not hold for. Left out of scope; named in Residual risk instead.

## Amendment 2026-08-09: condition 3 needs a `Handler.CODERGEN`-source exclusion

Implementation surfaced a real false positive this ADR's own analysis did not consider: spec
section 10.6's own canonical loop-guard idiom —

```
review  [shape=box, prompt="review"]
iterate [shape=parallelogram, tool_command="printf ok"]
finish  [shape=parallelogram, tool_command="printf ok"]
review -> iterate [condition="context.loop_state!=exhausted"]
review -> finish  [condition="context.loop_state=exhausted"]
```

— pinned by `engine.test.ts`'s own `'the spec loop-guard idiom routes before the key is set'` and
its unqualified-key sibling (`C3`). No `goal_gate`. `loop_state` is in nobody's `supplied` set.
`context.loop_state!=exhausted` is outcome-blind (does not reference `outcome`). By the letter of
Decision 2's five conditions, `GATE-002` fires — refusing a spec-canonical idiom this project's own
test suite already pins as correct, load-bearing behavior. This is exactly the false-positive cost
this ADR's own severity argument claimed did not exist ("there is no legitimate way to write this
exact shape on purpose") — that claim was wrong for this one case.

**Why this case is different from hazard shape 1/2, and how to tell them apart at lint time.**
`review` is `Handler.CODERGEN`. `INFERRED_OUTPUTS_BY_HANDLER[Handler.CODERGEN]` is deliberately `[]`
(`dot/graph.ts`) — a box node's real output keys are arbitrary strings the model decides at
runtime, and ADR-006 already names the consequence directly: *"there is nothing honest to
cross-reference at lint time."* `DATA-001` already accepts this exact blind spot and stays WARNING
because of it. `loop_state` is not undeclared by authoring mistake — it is a key a box node
plausibly writes dynamically via `contextUpdates`, which lint cannot rule out. Hazard shape 1's own
`build` node, by contrast, is `Handler.TOOL` — `INFERRED_OUTPUTS_BY_HANDLER[Handler.TOOL]` is the
small, fixed `TOOL_OUTPUT_KEYS` set, which does not and structurally cannot include an arbitrary
key like `build.error`. A tool node's failure cannot have produced that key by any mechanism this
engine has; a box node's success or failure might have produced any key at all. The distinction is
not ad hoc — it is the same one `DATA-001` already draws, applied here for the first time to an
edge condition instead of a substitution reference.

**Fix: condition 3 gains a second exclusion.** `GATE-002` does not fire when the edge's own SOURCE
node `n.handler === Handler.CODERGEN` — in addition to the existing `supplied`-set exclusion. This
is scoped to `n` specifically (the node whose outcome the condition is nominally gating), not "any
`CODERGEN` node anywhere in the graph": a box node's own unpredictable output is only a plausible
explanation for a key referenced on an edge leaving *that* node, not license to excuse an edge
leaving an unrelated `TOOL` node elsewhere in the same graph. Re-verified against hazard shape
1/2: `build` is `TOOL` in both, so this exclusion does not silence either — `GATE-002` still fires
on the graph it exists to catch.

**Cost accepted, not hidden.** This narrows `GATE-002`'s coverage: a `CODERGEN` node that fails
silently with a downstream outcome-blind condition on an undeclared key is no longer caught by this
rule, mirroring the exact gap `DATA-001` already carries for substitution references. Not new risk
this ADR introduces — the same, already-accepted risk, now stated for edge conditions too.

## Residual risk

- **Partial-context evaluation is imprecise on multi-clause conditions — CONFIRMED exploitable,
  not merely theoretical.** Adversarial review (2026-08-09) reproduced this directly against the
  real, shipped rule: `build [tool_command="exit 1"] -> publish [condition="context.goal=urgent
  && context.build.error!=fatal"]`, graph attribute `goal="urgent"`. `lint()` returns `[]` —
  zero diagnostics, not even `DATA-001`. A real run: `build` fails for real, the pipeline still
  reports `status: success`. The failure mode is exactly as originally described (`GATE-002`
  evaluates the *whole* condition against `EMPTY_CONTEXT`, so a supplied-key clause makes the
  whole conjunction read as "properly discriminating" even though the vacuous half still lets a
  real failure through once the supplied clause is legitimately satisfied) — but "a completely
  ordinary graph-attribute value in one clause, an undeclared key in the other" is a natural
  phrasing, not a contrived one. Still not fixed here: closing it precisely needs a
  partial-context evaluator (substitute only `supplied` keys, leave the rest symbolic), which is
  real added complexity. Raised in severity from "flag for a future pass if it matters" to
  **"confirmed live, worth scheduling."**
- **`retry_target`/`fallback_retry_target`-based continuation is out of scope, and the original
  reasoning for that was WRONG — corrected 2026-08-09.** The rejected-alternative text above
  claimed "every concrete `retry_target` use in this codebase's fixtures dispatches a real
  recovery node." Adversarial review disproved that with a direct counter-example: `A
  [tool_command="exit 1", retry_target="B"] -> (nothing)`, `B [tool_command="exit 0"] -> done`,
  no goal gate. `lint()` returns only a `TOPO-006` WARNING — `hasErrors()` is `false`. A real run:
  `A` fails, `resolveRetryTarget` dispatches `B`, `B` trivially "succeeds" via an unconditional
  edge to `done`. `status: success`, `A`'s real failure fully absorbed. `GATE-002`'s own edge loop
  never examines this path at all — it only inspects `isConditional` edges, and `A -> B`'s own
  dispatch isn't even a graph edge (it's `resolveRetryTarget`'s own routing, invisible to `lint()`
  entirely). Unlike the multi-clause case, this produces **zero diagnostic of any kind**, and the
  attack requires no cleverness — a trivial always-succeeds fallback node is exactly what an
  under-specified retry target looks like by accident, not only on purpose. **This is not
  resolved by this story and needs the same kind of Product Owner call Decision 1 itself was**:
  extending `GATE-002` to examine `retry_target` continuation the way `GATE-001` already does
  reopens the exact false-positive tension this ADR spent its own Decision 2 resolving (a
  `retry_target` pointing at a node that does real, meaningful recovery work is legitimate and
  common; nothing at lint time can statically distinguish that from `B`'s trivial `exit 0` above
  — the same "arbitrary runtime behavior, unknowable at design time" problem the `CODERGEN`
  exclusion already accepts, not a new one). Recorded here as a named, un-closed gap rather than
  silently shipped as if `retry_target` parity had been genuinely considered and found safe to
  skip — it was considered, and the specific reasoning used to skip it does not hold. **Closed by
  Amendment 3 below (Product Owner decision: extend, accepting the resulting narrower coverage
  the same way Decision 2 already accepts it for `CODERGEN`).**

## Amendment 3 (2026-08-09): `GATE-002` also examines `retry_target`/`fallback_retry_target`

**Product Owner decision, not an engineering default:** extend `GATE-002` to cover this route
too, resolving the residual risk above in the "close it" direction rather than leaving it as a
permanent gap. The reasoning that makes this safe to do, unlike the rejected "flag every
`retry_target`" alternative first considered in Decision 2 (before the false-positive analysis
existed): **this is not "does a `retry_target` exist," it is the identical question `GATE-002`
already asks for edge conditions — can a real failure reach the exit node with nothing anywhere
in the graph able to verify it was actually resolved.** A `retry_target` used for genuine,
meaningful recovery is not penalised by this rule any differently than a genuine
`condition="outcome=fail"` recovery route is — both are fine, *if the graph has a goal gate
somewhere on that path, or anywhere at all* (`gates.size === 0` is this rule's own entire
precondition). What is not fine, in a graph that declares no verification mechanism whatsoever,
is a failure reaching an unverified exit *at all* — by construction, in that graph, nothing ever
checks whether recovery genuinely happened, whichever mechanism reached the exit.

**Exact extension, mirroring `GATE-001`'s own existing retry-route detection
(`lint.ts:1069-1084`) for the zero-gate case instead of the has-gates-but-bypassed case:** for
every node `n` not in `NEVER_FAILS`, `resolveRetryTarget(n, graph, { includeGraphLevel: false })`
(`core/retry.ts:107`) — the same call, same `includeGraphLevel: false` scoping `GATE-001` already
uses, for the identical reason (section 3.7's ladder, which this mirrors, does not consult a
graph-level fallback for a plain node's own failure route). If it resolves to a real target, and
that target reaches `exits` via `bypassesGates(graph, target, gates, exitIds)` (the SAME shared
traversal `GATE-002`'s edge-condition check already reuses — with `gates` empty by construction in
this branch, it degenerates to a plain reachability check, exactly as before), `GATE-002` fires.

**No `Handler.CODERGEN` exclusion here, and none is needed.** The `CODERGEN` exclusion exists
because a referenced *context key*'s value is unpredictable at lint time when a box node might
write it dynamically. `retry_target`/`fallback_retry_target` are static node *attributes*,
declared verbatim in the DOT source — always fully visible to lint, regardless of what handler
kind the node resolves to. There is nothing here for a `CODERGEN` node to make unpredictable.

**Why this doesn't reopen "Legitimate shape 2" (an explicit `outcome=fail`/`outcome=success`
recovery-route pair).** That shape uses an ordinary conditional edge, not a `retry_target`
attribute — a structurally different mechanism this extension does not examine at all. The two
are deliberately treated differently, not by oversight: an edge condition is the engine's general
routing primitive, used for many purposes including deliberate, visible failure acknowledgment;
`retry_target` exists specifically for spec section 3.7's retry semantics — an attempt to actually
redo the failed work, not a general-purpose "catch and continue." An author who wants to
acknowledge a failure and move on without a goal gate still has Legitimate shape 2 available,
unaffected by this amendment. An author who wants retry-based recovery to be trusted needs a goal
gate to verify it, exactly as this whole rule already requires for every other route.

**Cost accepted:** any graph using `retry_target`/`fallback_retry_target` with zero goal gates
anywhere now requires either adding a goal gate or restructuring to an explicit recovery edge —
this is real, deliberate friction for what was previously silent, unverified behavior, and it is
the Product Owner's own considered choice to impose it rather than leave the gap named and open.

**Adversarially reviewed 2026-08-09, two minor findings, neither a soundness gap — both leave the
graph correctly refused, only affect message precision or an unasserted side effect:**

- **Multi-hop retry chains attribute the diagnostic to the wrong link.** `A.retry_target=B`,
  `B` itself a dead end whose only escape is `B.retry_target=C` reaching exit: the graph is still
  correctly refused (this loop independently re-checks every node's own one-hop target, so `B`'s
  own check fires), but the message names `B`, not `A`, as the node whose failure goes
  unverified — an author debugging `A`'s real problem is pointed one link down the chain. Not
  fixed here; `GATE-001`'s own equivalent check has the identical one-hop scope, so this matches
  existing rule-family behavior rather than introducing a new inconsistency.
- **The 8 decoy-gate fixture fixes (commit `45c235c`) are runtime-inert as documented, but each
  one flips its own graph from `GATE-002`'s branch to `GATE-001`'s** (`gates.size` goes from 0 to
  1), introducing a new `GATE-001` WARNING on all 8 that no test asserts against. Confirmed
  harmless — `WARNING` never blocks `hasErrors()`, no test checks these constants' own diagnostic
  set — but worth recording so a future reader investigating "why does this fixture now warn"
  finds an answer here rather than rediscovering it.
- **Residual R6 (condition-only reference invisible to `DATA-001`) is closed only within
  `GATE-002`'s own zero-goal-gate scope**, not generally. A graph that *does* declare a
  `goal_gate` node elsewhere, with an unrelated condition-only vacuous reference on a path that
  never reaches that gate, is covered by neither `DATA-001` (substitution-text only) nor
  `GATE-002` (zero-gate only) nor `GATE-001` (which only examines `isFailureRoute`-true routes,
  not vacuous ones). R6 stays open in that shape; this ADR does not close it, and should not be
  read as having done so.
- **New shared surface required, not new duplicated logic.** `GATE-002`'s condition 2 needs
  `edge-select.ts`'s private `isConditional` exported (or an equivalent re-derivation that is
  provably identical — exporting is the discipline this file already follows for `CLAUSE`/
  `splitClauses`/`evaluateCondition`, all shared rather than restated). Condition 3 needs a new
  small export from `condition.ts` — a `conditionKeys(expr): string[]` that extracts each
  clause's left-hand key with the same `context.`-stripping `resolveKey` performs — since no
  existing function returns condition keys rather than evaluating them. Both are small, additive,
  and in the direction this file's own doctrine already enforces (shared grammar, not duplicated);
  named here so the implementer does not silently hand-roll a second, driftable copy of either.
- **`GATE-002` closes one new shape, not two.** Precisely: condition-only vacuous references to
  an *undeclared* key, beyond the substitution-only, undeclared shape `DATA-001` already warns on.
  It is worth being exact about this because `engine.test.ts:1540`'s own fixture (`build`
  *declares* `outputs="build.error"`, to prove I1's runtime protection is armed and still
  insufficient) is **not** a `GATE-002`-firing graph — `build.error` is `supplied` there, so
  condition 3 excludes it. `GATE-002`'s own hazard shape 2, above, deliberately uses the
  undeclared pairing instead, because that is the graph shape `GATE-002` actually refuses. Stated
  explicitly so a reader checking this ADR against `engine.test.ts:1540` directly does not expect
  `GATE-002` to fire there and conclude the rule is broken when it correctly does not.

## Consequences

**We gain:** Open Question 9 is closed. FR-9b now has a precise, implementable trigger — a lint
rule, `GATE-002`, ERROR severity, that refuses a graph with no `goal_gate` node containing an
edge whose condition is satisfiable regardless of its source node's outcome, because the key it
depends on is one nothing in the graph produces — before the run starts, matching `HAND-001`'s
posture, changing no runtime verdict, and contradicting nothing `AGENTS.md`'s doctrine or
`engine.test.ts`'s currently-passing suite already commits to. It closes the I1-is-opt-in shape
completely (hazard shape 1) and the condition-only variant `DATA-001` alone cannot see (hazard
shape 2, corrected scope per Residual risk), without refusing either of the two common legitimate
shapes named above.

**We accept:** implementation is not free — one new exported helper in `condition.ts`
(`conditionKeys`), one export change in `edge-select.ts` (`isConditional`), and `GATE-002`'s own
block in `lint.ts`, sized similarly to `GATE-001`'s. The residual risks above (partial-context
false negatives, `retry_target` continuation, R6's narrower-than-hoped closure) are real and
named, not solved by this rule, and should be read alongside FR-9b's own PRD row rather than as a
reason to widen `GATE-002` further — every widening considered above (broad trigger,
`DATA-001`-keyed trigger, `retry_target` parity) was rejected on a demonstrated false-positive or
false-negative cost, and the rule as specified is the narrowest one that actually closes the
founding-incident-class gap `roadmap.md` names.
