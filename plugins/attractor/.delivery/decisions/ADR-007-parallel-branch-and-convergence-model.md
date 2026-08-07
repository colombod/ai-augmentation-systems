# ADR-007: A parallel branch is a sub-path; the main pipeline resumes at a statically-discovered convergence node

**Status:** accepted
**Date:** 2026-08-07
**Deciders:** Solution Architect

## Context

`Handler.PARALLEL` (`shape=component`) fans out to every outgoing edge as a branch (Open
Question 3, resolved: "every outgoing DOT edge from a `component` node is a branch — no
separate branch-listing attribute"). That resolution leaves a structural question unanswered,
and the PRD explicitly declined to guess it: if every outgoing edge is consumed as a branch,
no edge is left over to say how the main pipeline continues afterward.

`core/engine.ts`'s `run()` is a flat sequential `for` loop over one `currentId` (confirmed by
reading `engine.ts:643-1088` in full — nothing async-parallel exists anywhere in the file).
`amplifier-precedent.md` §2 describes amplifier's branch syntax and its (inconsistent)
join-policy math, but not the branch-termination/continuation mechanics; those had to be read
directly from amplifier's actual source, which the precedent document does not quote.

Fetched via `gh api` (raw.githubusercontent.com 404'd on the guessed path; real paths are
under `modules/loop-pipeline/amplifier_module_loop_pipeline/` in
`microsoft/amplifier-bundle-attractor@main`):

- `handlers/parallel.py:166-176` — each branch root runs via
  `engine.run_subgraph(target_node_id, context=branch_context, ...)`.
- `engine.py:957-1115` (`run_subgraph`) — an ordinary node-to-node traversal, the same
  edge-selection algorithm as the main loop, that stops when the current node `is_exit_node()`,
  has `shape == "tripleoctagon"`, or has no outgoing edge (`engine.py:1021`).
- `engine.py:818-845` — after `ParallelHandler` returns, the main loop does **not** run
  ordinary edge selection over the component node's own edges. It calls
  `_find_fan_in_node` (`engine.py:1417-1476`, a BFS over `graph.outgoing_edges`, no
  condition evaluation) to find the earliest node reachable from every branch root, and jumps
  `current_node` straight there — executed once, in the parent's own (non-cloned) context. No
  common descendant is a hard failure (`engine.py:824-835`).

## Decision

Adopt amplifier's structural model — branch = sub-path, continuation = a statically-discovered
convergence node — with two corrections (the second added 2026-08-07, resolving feature-critic
finding F2; see "Amendment: a branch reaching the graph's real exit node" below). A branch
executes forward from its root using the same per-node step logic as the main loop, until it
reaches (b) a precomputed convergence-node id, or (c) a dead end — which, per the amendment,
is also what happens when the node it dispatches is the graph's own EXIT node. The convergence
node is computed **once**,
before any branch runs, by `dot/graph.ts#findConvergenceNode(graph, branchRootIds)`: BFS
reachability from every branch root over all outgoing edges (condition-independent, matching
lint's own conservative posture elsewhere), intersected, excluding the roots, shallowest
survivor wins. The **same** precomputed value is what both the branch runner uses as its stop
frontier and what the main loop jumps `currentId` to after the component node's handler
returns. `findConvergenceNode` is a pure static function so a new `PAR-001` lint rule
(`dot/lint.ts`) can refuse — before any run starts — a `component` node with two or more
outgoing edges and no discoverable convergence node, matching HAND-001's own "refused here
instead of aborting mid-run" precedent (ADR-005).

**The correction:** amplifier's branch runner recognizes a stop point by `shape ==
"tripleoctagon"` specifically (`engine.py:1021`), not by "is this the node the main loop
computed as convergence." Every worked example in that repo happens to use a `tripleoctagon`
node at the convergence point, so the two independent tests (shape-based stop, BFS-based jump
target) never visibly disagree — but they are two tests, not one, and a convergence node of any
other shape would make the branch runner run straight through it inside a cloned context, then
have the main loop execute it *again*, for real. This project's own doctrine ("loud aborts over
silent degradation," `AGENTS.md`) and Open Question 5's resolution ("no separate fan-in node
required") both cut against importing a shape-gated stop condition anyway — `Handler.FAN_IN`
stays lint-refused this slice, so no graph here can legally carry a `tripleoctagon` node at all.
This design's branch runner and convergence discovery share **one** precomputed id; the class
of bug above cannot arise structurally, not by author discipline.

## Alternatives considered

### A branch is a single node (the direct edge target, executed once, no further traversal)

**Why it was attractive:** simpler — no reachability analysis, no shared stop-frontier
plumbing, closer to "every outgoing edge is a branch" read at face value.
**Why rejected:** it does not resolve the question it was proposed to answer. If a branch is
exactly one node, the component node's own outgoing edges are still entirely consumed as
branches (per Q3), and there is still no edge left to say where the main pipeline resumes.
The canonical amplifier example (`05-parallel-fan-out.dot`) also falsifies this reading
directly: `test_arithmetic`, `test_trig`, `test_stats` each have their own outgoing edge to
`collect_results` — a branch's own downstream routing is real graph structure, not a
degenerate no-op, even in the simple case where each branch happens to be one node deep.

### Port amplifier's `shape == "tripleoctagon"` branch-stop condition verbatim

**Why it was attractive:** literal fidelity to the read source; less design surface.
**Why rejected:** `Handler.FAN_IN` remains lint-refused this slice (FR-17a), so no legal graph
here could ever carry the shape this check depends on — porting it verbatim would make the
branch runner's stop condition permanently unreachable, silently degrading to "never stops
early," relying entirely on each branch's own dead end or the graph's real exit. Worse, it
imports a real latent double-execution defect (see Context) into a codebase whose own doctrine
explicitly names "loud aborts over silent degradation" as non-tradeable.

## Consequences

**We gain:** a coherent, single-source-of-truth answer to "what is a branch" that a lint rule
and the runtime both enforce identically, and a continuation mechanism that requires no new
attribute on the DOT author's side — the graph's own shape already says where branches
reconverge.

**We accept:** `findConvergenceNode`'s reachability is condition-independent, so it can permit
a shape that a *specific* runtime execution never actually walks through (see the architecture
document's Risks table) — the same conservative-lint-over-precise-runtime tradeoff this
codebase already makes elsewhere (`directPredecessor`, DATA-001). We also accept that a
`goal_gate=true` node inside a branch, and a `runs_on=failure` node reacting to a sibling
branch's failure, are both real, deliberate consequences of keeping the goal-gate and
unresolved-failure ledgers global rather than branch-private — see ADR-009 for why that
sharing is the design, not an oversight. What is **not** shared automatically is the ordinary
`Context` a branch's own clone accumulates (a node's `outputs=`/`contextUpdates` writes) — that
needs its own merge-back step, specified in ADR-010, because a shared ledger and a cloned
`Context` are two different isolation mechanisms answering two different questions.

## Amendment (2026-08-07): a branch reaching the graph's real exit node — resolves finding F2

**The gap.** The Decision above originally listed "the graph's real exit node" as a third,
independent branch stop condition, alongside the convergence node and an ordinary dead end,
without saying what happens when it fires. That is a real gap: `core/engine.ts`'s own EXIT
handling (`engine.ts:972-1043`) does substantial run-wide work — checks
`unsatisfiedGoalGates()`, writes the final checkpoint via `this.checkpoint(null)` (hardwired to
`this.opts.runDir`, the OUTER run's own directory), and returns a terminal `RunResult` from
`run()` itself. None of that is meaningful from inside a single branch's own traversal, and
nothing in the original text said whether `runBranch` was supposed to invoke it, skip it, or be
refused by lint instead.

**Why this can genuinely happen.** `findConvergenceNode`'s reachability is a static
over-approximation (see "We accept" above): a specific branch's *actual* runtime path can
diverge from what lint thought was common to every branch. A branch root with a direct or
short edge to the graph's real EXIT node — one none of the other branches share, so
`findConvergenceNode` correctly does not select EXIT as the common convergence node — is a
legal graph shape (nothing stops an author drawing `component -> exit` as one of several
outgoing edges), and that branch's own forward walk, using the ordinary per-node step logic,
will dispatch EXIT as an ordinary node before ever reaching the convergence node the *other*
branches share.

**Decision.** `runBranch` treats dispatching the graph's real EXIT node exactly like an
ordinary dead end for that branch's own traversal — and nothing more. `Handler.EXIT` is a
`PassthroughHandler`-registered kind (`PASSTHROUGH_KINDS`, `dot/graph.ts:248`), so dispatching
it is always side-effect-free and always resolves `SUCCESS`; the branch simply stops there,
its own `BranchRunResult.outcome` reflecting that trivial `SUCCESS`. `runBranch` never
consults `unsatisfiedGoalGates()`, never calls `this.checkpoint(null)`, and never returns a
`RunResult` — that logic remains exclusively the main loop's, gated on "is `currentId`,
the outer traversal's own cursor, at the EXIT node" rather than "did some node's handler
happen to be `Kind.EXIT`, wherever it was dispatched from." This is what F6's shared
`executeNodeStep` extraction makes structurally cheap: the shared method returns a `{kind:
'stop', reason: 'exit' | 'frontier' | 'deadend', ...}` descriptor and never touches
`unsatisfiedGoalGates`/checkpoint/`RunResult` itself; the main loop and `runBranch` are the
only two places that interpret a `reason: 'exit'` result, and they interpret it completely
differently — see the architecture document's engine.ts component-structure entry.

Because this shape is legal but almost always an authoring mistake — a branch quietly
dead-ending at the pipeline's one true terminal without ever reaching the convergence node its
siblings share is rarely what an author intended — it gets a WARNING-severity lint rule,
**PAR-005**, not an ERROR: a `component` node has a branch root from which the graph's real
EXIT node is reachable without first passing through the branches' own convergence node.

**Corrected 2026-08-07, fifth pass (resolves the F2 residual finding).** The paragraph
originally here justified WARNING, not ERROR, by citing "an early-exit branch — e.g., 'if this
branch alone already satisfies the goal, stop the whole pipeline here' — is a legitimate
pattern this design does not want to outlaw structurally." That example describes a capability
this design does not have, and the Decision stated immediately above makes it structurally
impossible: a branch reaching EXIT is treated exactly like an ordinary dead end *for that
branch alone* — the main run is never stopped, sibling branches are unaffected, and execution
proceeds to the convergence node precisely as if the branch had simply run out of graph. An
author who draws `component -> exit` intending "stop the whole pipeline" gets a WARNING they
can ignore, a clean lint pass, and a run that silently does not do what they intended — no
crash, just quiet non-effect. That was the wrong justification for the right severity, and it
is corrected here rather than left standing uncorrected.

**The real reason WARNING, not ERROR, is correct:** ending *one branch's own traversal* early,
without affecting its siblings or the overall run, is a legitimate pattern, genuinely distinct
from "stop the whole pipeline." A branch whose own work is finished once it reaches whatever
node the graph author drew as the pipeline's terminal is not an authoring mistake in the same
way a stray `component -> exit` edge would be — refusing it structurally would be exactly the
kind of over-restriction PAR-002 already declines for its own surprising-but-legal shape (a
fan-out with exactly one outgoing edge). WARNING correctly says "this is probably not what you
meant, but if a branch quietly ending here is fine, nothing downstream is broken." It does not,
and must not be read to, say "drawing a
branch to the shared EXIT node is how you stop the whole run" — it is not, and this design does
not implement that capability this slice.

Whether "stop the whole pipeline from inside a branch" should become a real, separate feature —
some new stop reason `executeNodeStep`/`runBranch` propagate up through `ParallelHandler` to
cancel sibling branches and terminate the outer run — is a genuine scope question, not decided
by this ADR, and not free to add later: `ParallelHandler`'s branch dispatch is
`Promise.all`-based (see the architecture document's own Risk row on `Promise.all` not
cancelling sibling branches when one rejects), so "stop everything" would need real
cancellation plumbing this design does not build. Named here for the Product Owner to
prioritize or decline, not silently built and not silently dropped — see the architecture
document's Risks table for the corresponding entry.

## Amendment (2026-08-07): partial reconvergence between branches — resolves finding F3

**The gap.** `findConvergenceNode` computes the earliest node reachable from **every** branch
root. A node reachable from a proper subset of branch roots — two of three, say — is not that
value, so PAR-001 (which only fires on "no discoverable convergence node among **all** roots")
says nothing about it, and neither did anything else in this ADR. At runtime, each branch's own
`runBranch` traversal is independent and dispatches every node on its own path using the shared
`gateOutcomes`/`nodeFailures`/`failedOutputs`/`attempts` maps (ADR-009). If two branches'
sub-paths happen to pass through the *same* shared, non-convergence node — a "normalize" step
both `review-A` and `review-B` route through before all branches reach the real convergence node
`combine` — that node is dispatched independently, and potentially concurrently (branches run
via `Promise.all`), from two different `runBranch` calls. For a `CODERGEN` node this means the
subprocess genuinely runs twice; for a goal gate it means whichever branch finishes last
silently overwrites the other's verdict in `gateOutcomes` (`Map.set` is last-write-wins). This
is the double-execution defect this ADR's own "Fix, not port" paragraph believed it had closed
— reopened here via nodes reachable from a *subset* of roots rather than nodes with the wrong
shape.

**Decision.** A **new pure static function**, alongside `findConvergenceNode` in
`dot/graph.ts`:

```ts
/** Node ids reachable from two or more of the given branch roots, where reachability from
 * each root is truncated at (does not expand past) the convergence node — exactly the
 * frontier runBranch itself stops at, so this is not an approximation of a different boundary
 * than the runtime uses. Excludes the roots themselves and the convergence node. Empty when
 * every branch's own truncated reachable set is disjoint from every other's and no full
 * common descendant besides the convergence node exists, or when convergenceId is null
 * (PAR-001 already refuses that graph).
 *
 * REVISED below ("Amendment: tied full common descendants"): the original wording here read
 * "two or more, but not all" — that qualifier is removed. See the amendment for why "reachable
 * from every root, but not the one findConvergenceNode's tie-break selected" is exactly as
 * hazardous as the proper-subset case this function was first written to catch. */
export function findPartialReconvergence(
  graph: Graph, branchRootIds: readonly string[], convergenceId: string | null,
): string[]
```

A new **ERROR**-severity lint rule, **PAR-004**, refuses a `component` node whenever
`findPartialReconvergence` returns a non-empty list — the same "refused here instead of aborting
mid-run" posture HAND-001/PAR-001 already establish (ADR-005). ERROR, not WARNING: unlike
PAR-002/PAR-005's surprising-but-legal shapes, this one is a genuine double-dispatch hazard
with real side effects (a real subprocess spawned twice, a real ledger entry racily
overwritten) — there is no legitimate graph shape this refusal wrongly forbids, only ones that
must be restructured (give each branch its own copy of the shared step, or make the shared step
itself the branches' true convergence node).

This inherits the same accepted imprecision `findConvergenceNode` already carries (see "We
accept" above): reachability is condition-independent, so PAR-004 can refuse a graph where two
conditional sub-paths would, in practice, never both be taken at once. That is the same
conservative-lint-over-precise-runtime tradeoff already named for `findConvergenceNode` itself,
not a new kind of imprecision this amendment introduces.

## Amendment (2026-08-07, fifth pass): tied full common descendants — resolves the F3 residual finding

**The gap, found by an independent re-verification of the amendment directly above.** That
amendment computes the convergence node as "shallowest common descendant wins ties" but never
says how a tie among two or more nodes *at that same shallowest depth* is broken — only that
one of them wins. Call the winner `X` and a loser `Y`. `Y` is, by construction, reachable from
*every* branch root — it satisfies exactly the same "common descendant" test `X` does, at the
same depth, and lost only to whichever tie-break rule `findConvergenceNode` happens to apply
(first-encountered in some traversal order, lexicographically smallest id, or anything else —
the interface comment never committed to one, and closing this gap does not require it to).

`Y` was invisible to both lint checks that exist. PAR-001 only asks whether *a* convergence node
exists (`findConvergenceNode() !== null`) — it does, `X`. The original PAR-004
(`findPartialReconvergence`, as first written above) only flagged a node reachable from "two or
more, but not all" branch roots — `Y` is reachable from *all* of them, so it was explicitly the
case that wording carved out, not an oversight in applying it correctly.

Concretely:

```
root1 -> X
root1 -> Y
root2 -> X
root2 -> Y
X -> combine
Y -> combine
```

Both `X` and `Y` are common descendants of `{root1, root2}` at depth 1 — a "diamond of
diamonds," an ordinary DOT shape, not an exotic one. Say the tie-break picks `X`:
`findConvergenceNode` returns `X`, `stopAt = {X}`, PAR-001 passes (a convergence node exists),
and the original PAR-004 passes (`Y` is reachable from *all* roots, not a proper subset, so
`findPartialReconvergence` as first written does not return it). But `findConvergenceNode` and
`findPartialReconvergence` are both condition-independent over-approximations — neither knows
which edge a real run will take (see "We accept," above). If branch 1's actual edge selection
at runtime takes `root1 -> Y`, `runBranch` dispatches `Y` — it is not in `stopAt` — and
continues forward from it toward `combine`. If branch 2 takes `root2 -> X`, it stops at `X` and
waits. Two independent `runBranch` calls have now taken genuinely different, uncoordinated paths
past what each treats as its own stopping point, and both eventually reach `combine` — one via
its own branch traversal, the other via the main loop's single dispatch after
`ParallelHandler` returns. That is the identical double-dispatch/race hazard the original F3
finding named, on a node (`Y`) neither PAR-001 nor the original PAR-004 was written to catch.

**Why a proof of impossibility is not available.** Ties of this kind cannot be ruled out
structurally. `findConvergenceNode` operates over arbitrary DOT graphs; any graph author can
draw two independent nodes each hanging directly off of every branch root, as the worked example
does. Nothing elsewhere in this design (branch-root count, edge count, DAG shape) forbids that
topology. Asserting ties cannot happen would be asserting something false about the class of
graphs this lint rule is required to accept or refuse — so this gap is closed by a **lint
extension**, not by a proof of impossibility.

**Decision.** Close this by broadening `findPartialReconvergence`'s own definition, not by
adding a new diagnostic code — the hazard is the same double-dispatch class PAR-004 already
exists to refuse, on a node the original wording happened not to cover. The code block earlier
in this amendment is updated in place to the broadened definition; the only substantive change
is dropping the "but not all" qualifier from the reachability test. The truncated-BFS mechanism
itself is unchanged — still condition-independent, still stops expanding at `convergenceId` —
and that alone is sufficient: a node genuinely downstream of `convergenceId` on every path is
still excluded (truncation never expands past `X`, so `combine` in the example above is
correctly not flagged — both branches stop at `X`, and `combine` is dispatched once by the main
loop, exactly as intended); a node reachable via *any* path that does not pass through
`convergenceId` first — whether from a subset of roots (the original F3 shape) or from all of
them (this amendment's shape) — is now always included. **PAR-004 itself is unchanged:** same
ERROR severity, same "refused here instead of aborting mid-run" posture, same call site
(`findPartialReconvergence(graph, branchRootIds, findConvergenceNode(graph, branchRootIds))`) —
only the function it calls now catches a strictly larger class of hazardous graphs.

**Consequence for the tie-break itself.** Once this lands, any graph that would have exercised
`findConvergenceNode`'s tie-break between two full common descendants is refused by PAR-004
before it can run, regardless of which of the tied nodes the tie-break happens to prefer — the
specific tie-break rule stops being safety-relevant. It only affects which node PAR-001's and
PAR-004's own diagnostics happen to name as "the" convergence node in a refused graph's lint
output. This amendment does not make the tie-break itself deterministic (it remains unspecified
beyond "shallowest wins," as `findConvergenceNode`'s own comment now notes), and does not need
to: no graph that reaches a run depends on it.

**Consequences (this amendment specifically).** **We gain:** PAR-004 now refuses every graph
where a full common descendant other than the selected convergence node could be reached
without passing through it first — the tied case this amendment names, and any other topology
with the same structural shape, not only the proper-subset case the original F3 finding
demonstrated. **We accept:** the same condition-independent over-approximation already accepted
for the original PAR-004 and for `findConvergenceNode` itself now applies to a strictly larger
set of graphs — a graph with a tied full common descendant that a *specific* runtime execution
would never actually double-dispatch (because the conditional edges that would create the race
never both fire) is still refused at lint time. This is not a new kind of imprecision; it is the
same "lint refuses a shape that might be fine at runtime, never lets a hazardous shape run"
tradeoff this codebase already makes everywhere else in this feature.

## Amendment (2026-08-07, sixth pass): two more escapes from the truncated-intersection check, plus EXIT is harmless

**The gap, found by an independent adversarial re-verification of `p5-04`'s implementation
(itself a faithful transcription of the fifth-pass amendment above).** Two distinct graph
shapes reach a real double-dispatch at runtime while `findPartialReconvergence` — exactly as
specified above — returns `[]` for them.

**Gap 1 — a branch root reachable from a sibling root.** The function has always excluded every
branch root id from its own output, on the theory that `findConvergenceNode`'s own root
exclusion ("a root is never a valid convergence candidate") extends to the hazard check too. It
does not: those are two different questions. `root1 -> root2` (root2 also a fan-out root in its
own right) means branch `root2`'s `runBranch` call dispatches `root2` as its own entry point,
*and* branch `root1`'s traversal can reach `root2` by an ordinary edge and dispatch it again — a
plain instance of the same double-dispatch class this rule exists to refuse, on a node that
happens to itself be a root. The `Amendment (2026-08-07)` fixture just above this one
(`root1 -> root2`, `root2 -> shared -> done`) was written to pin `findConvergenceNode`'s
behavior ("resolves past it, not to it") and never checked `findPartialReconvergence` against
the same graph — it would have returned `[]`, silently blessing a shape that doubly dispatches
`root2`.

**Gap 2 — asymmetric topology around a tie.** The fifth-pass amendment's own "Consequence for
the tie-break itself" claims: *"any graph that would have exercised `findConvergenceNode`'s
tie-break between two full common descendants is refused by PAR-004 ... regardless of which of
the tied nodes the tie-break happens to prefer."* That claim is false as implemented, and the
counter-example is symmetric in the fifth-pass amendment's own fixture only by coincidence —
`findPartialReconvergence` intersects each root's **truncated** reachable set (stopped at the
*chosen* convergence node), not the untruncated depth maps `findConvergenceNode` itself ranks
ties over. Those are the same set only when every root's path to the tie loser also happens to
pass through, or avoid, the winner symmetrically. When it does not:

```
root1 -> p -> x
root1 -> q -> y
root2 -> x
x -> y
y -> done
```

`x` and `y` are both full common descendants of `{root1, root2}` at worst-case depth 2 (`x`: 2
via `root1`, 1 via `root2`; `y`: 2 via `root1` through `q`, 2 via `root2` through `x`) — the
first-encountered candidate wins the tie, `x`. `root2`'s truncated set stops at `x` and never
reaches `y` — `root2`'s only path to `y` runs *through* `x`. `root1`'s truncated set reaches `y`
directly, via `q`, without ever touching `x`. `y` is present in exactly one truncated set, so
the intersection-based check (correctly) does not flag it — but it is not a false negative in
the *intersection* logic; it is the intersection logic answering a narrower question than the
hazard actually depends on. At runtime: branch `root2` stops at `x` (per `runBranch`'s own
contract, ADR-009); branch `root1`, if its real edge selection takes `q`, dispatches `y` and
continues past it to `done`; the main loop then resumes at `x` (the convergence node), takes
`x -> y`, and dispatches `y` again. `y` never needed to be reachable from *both* roots' truncated
sets to be double-dispatched — reachable from **one** root's truncated set, and *also* reachable
from the convergence node's own downstream (where the resumed main run will walk), is already
sufficient.

**Both gaps share one blind spot.** `findPartialReconvergence` has only ever asked "is this node
shared by two or more branches' own truncated views?" Gap 1 shows a root can be a hazard via a
*sibling's* view without being shared by two non-root views. Gap 2 shows a node can be a hazard
via *one* branch's view colliding with the *main run's post-convergence* view, not another
branch's view at all. Neither is the proper-subset-of-roots shape the original F3 finding named,
or the tied-full-common-descendant shape the fifth pass named — both prior amendments assumed
every hazard would show up as an overlap **between branches**. These do not.

**Decision.** `findPartialReconvergence` now flags the union of two independently-computed sets,
both still over the same truncated-BFS machinery (condition-independent, stopped at
`convergenceId` — unchanged):

1. **Cross-branch reachability**, as before, but no longer excluding branch-root ids from the
   count — a root reachable from a sibling root's truncated set now counts toward it, closing
   Gap 1. (Roots stay excluded from *convergence-node selection* in `findConvergenceNode` — that
   exclusion is untouched and is a different question, per the fifth-pass amendment's own
   framing.)
2. **Branch-into-downstream-of-convergence reachability**, new: any node present in a *single*
   branch's truncated set that is *also* reachable (ordinary, untruncated) from `convergenceId`
   itself. This is what the resumed main run will walk after every branch settles, so a branch
   that already shortcut its way into that territory is a hazard on its own — no second branch
   needs to corroborate it. Closes Gap 2.

**The graph's real EXIT node (`Handler.EXIT`) is excluded from both sets.** `EXIT` resolves to
`PassthroughHandler` — `graph.ts`'s own handler-effects table (`[Handler.EXIT]: []`) already
documents it as "genuinely writes nothing," the same passthrough treatment as `START`. Dispatch
it from two branches, or from a branch and the resumed main run, and the second dispatch has no
observable effect — no subprocess, no context write, no ledger entry to race. A branch reaching
EXIT early is a *different* hazard, one with an observable effect (that branch's own traversal
silently stopping short of what its author intended) — that is PAR-005's WARNING-level territory
(`p5-06`, not yet built), not this rule's ERROR-level one. Folding EXIT into PAR-004 would refuse
graphs where nothing can actually go wrong; excluding it applies uniformly to both new rules,
not only the second.

**PAR-004 itself is unchanged again:** same ERROR severity, same call site, same "refused here
instead of aborting mid-run" posture. Only `findPartialReconvergence`'s own definition is
broadened, for the third time — each time because an independent adversarial pass found a
graph shape the prior definition's own stated guarantee did not actually cover, not because the
severity or call site were ever wrong.

**Consequences (this amendment specifically).** **We gain:** PAR-004 now refuses a branch root
reachable from a sibling root (Gap 1), and a branch shortcut into convergence's own downstream
territory regardless of what any *other* branch's truncated set contains (Gap 2) — closing two
real double-dispatch shapes an intersection-only reading of "shared between branches" could not
express. Excluding EXIT also **removes** a class of refusals this amendment would otherwise add
for no safety benefit (EXIT reachable from two branches, or from a branch and convergence's
downstream, was never actually hazardous). **We accept:** `findPartialReconvergence` is no
longer expressible as "the intersection of N sets" in the reader's head — it is now a union of
two differently-shaped checks, one pairwise-across-branches and one single-branch-against-the-
convergence-node's-own-future. This is a real increase in the function's conceptual weight,
accepted because both checks are individually simple (still plain BFS, still condition-
independent, still stopped at `convergenceId`) and because splitting them into two named rules
in a future rewrite is possible later without changing what either one catches. **We still do
not have a proof this is the last gap** — the same "closed by adversarial re-verification, not
by a completeness proof" posture as every prior amendment to this ADR. A future independent pass
finding a fourth shape would not be a surprise; the practice this ADR has now established three
times running is to fix it via another amendment, not to treat any prior pass as final.

## Amendment (2026-08-07, seventh pass): the sixth pass's own fix introduced a false-positive class — an ordinary rework loop around a fan-out now refuses to lint

**The gap, found by an independent adversarial re-verification of the sixth amendment's
implementation, within hours of that amendment landing.** Rule (b) above computes
`downstreamOfConvergence = reachableWithDepth(graph, convergenceId)` — **unbounded**,
condition-independent reachability, following every outgoing edge including cycles. Nothing
about that computation stops at, or even acknowledges, the fan-out node or its own branch roots.
An ordinary rework/retry loop — `combine -> check; check -> fan [label="retry"]` — routes
`convergenceId`'s own downstream back into the fan-out, and from there into every branch root.
Once a branch root is in `downstreamOfConvergence`, it is also (trivially) in its own truncated
set — every root seeds `seen` with itself — so rule (b) flags it. The identical fixture with
`check -> a` (skipping the fan-out node, going straight back to a root) or `check -> start`
(looping the entire pipeline) produces the same result. In all three variants, `findPartialReconvergence`
now returns the branch roots themselves as "partial reconvergence," and PAR-004 refuses a graph
that has no double-dispatch hazard at all: a repair loop around a parallel stage is this
codebase's own established, accepted pattern (`NFR-1`'s shared step cap exists precisely to
bound routing cycles like this one; the README documents rework/retry loops as ordinary), not
the double-dispatch class this rule exists to refuse.

**Why this was not caught by the sixth amendment's own verification.** Every fixture checked
there — including the two new hazard shapes it introduced — was acyclic: a DAG from the branch
roots down through `convergenceId`. `downstreamOfConvergence`'s unboundedness is invisible on
any acyclic graph, because a node genuinely downstream of `convergenceId` in a DAG can never
also be upstream of it (a branch root or an ancestor of one). It only surfaces once a cycle
exists — and the sixth amendment's own worked examples, reasonably, never drew one.

**Why the fix is *excluding roots from rule (b)'s own candidacy*, not bounding
`downstreamOfConvergence`'s traversal.** The instinctive fix — truncate the convergence-side BFS
so it cannot walk back into branch territory — was tried first and rejected: truncating only at
the fan-out node does not close the `check -> a` variant (the cycle never passes through the
fan-out node at all), and truncating at every branch root *also* stops the BFS from reaching a
**non-root** node reachable by a second, independent path from post-convergence territory — which
is a **real** hazard, not a false positive: if a retry edge routes not back to a root but to some
node `m` a branch's own path already passes through (`a -> m -> combine` and, separately,
`check -> m`), `m` genuinely can be dispatched once via branch `a`'s own traversal and again via
the ordinary sequential resume after the loop — `m` is not the fan-out node and re-entering it is
not "a fresh iteration" the way re-entering the fan-out node is. Bounding the traversal to fix the
root case would have silently reopened this case. The three confirmed false-positive fixtures
(`check -> fan`, `check -> a`, `check -> start`) all resolve to hazards **on the branch roots
themselves** — nothing else. So the fix targets exactly that: **rule (b) never flags a branch
root as a hazard**, regardless of what `downstreamOfConvergence` (still unbounded, still
unchanged) contains. This is sound only because a branch root can be reachable from
`convergenceId` *at all* exclusively via a cycle (in an acyclic region, `convergenceId` is by
definition downstream of every root, so a root can never also be downstream of it) — root
membership in `downstreamOfConvergence` is a byproduct of a rework loop, never of a genuine
same-pass hazard, so excluding it costs nothing rule (b) was ever meant to catch. Rule (a) is
untouched and keeps catching a **sibling** root reachable from another root's own truncated
set (Gap 1) — a different, still-real, still-acyclic-compatible hazard this exclusion does not
touch.

**Decision.** `findPartialReconvergence` deduplicates `branchRootIds` internally (closing a
separate latent trap the sixth amendment's own review named: the function was silently sensitive
to a caller passing a duplicate root id, with the one dedup fix living only at the lint.ts call
site — a future caller, such as `runBranch`, deriving its own root list without repeating that
dedup would silently disagree with lint). Rule (b)'s per-set candidate loop gains one more
exclusion, alongside `convergenceId` and the graph's EXIT node: any id present in the (now
deduplicated) `branchRootIds` set. Rule (a) is unchanged. `downstreamOfConvergence` itself is
unchanged — still `reachableWithDepth(graph, convergenceId)`, still unbounded — the fix is
narrowly in what rule (b) is willing to flag from it.

**PAR-004's own diagnostic message is also corrected in this pass**, for an unrelated reason the
same review surfaced: the message text asserted the pre-sixth-amendment, intersection-only
explanation ("reachable from two or more of those branches") for every flagged node, which
became flatly false for a Gap-2-only hazard (reachable from exactly one branch, via rule (b)) —
an author reading the refusal could verify the stated reason against their own graph and find it
untrue, and the printed remedy did not address the actual hazard. The message now states the
disjunction accurately rather than asserting one specific mechanism.

**Consequences (this amendment specifically).** **We gain:** an ordinary rework/retry loop
around a parallel fan-out no longer trips a false PAR-004 refusal — restoring the acyclic-only
assumption every one of this rule's own fixtures, before this pass, happened to rely on without
stating it. Internal deduplication of `branchRootIds` also closes a call-site trap this function's
only current caller (lint.ts) already avoided by luck of having been written carefully, not by
the function's own contract. **We accept:** rule (b) is now stated as "a single branch's shortcut
into `convergenceId`'s downstream, **excluding the branch's own root and every sibling root**" —
one more qualifier than the sixth amendment's own wording, and one this ADR did not anticipate
needing. **We still do not have a proof this is the last gap**, now for the fourth time running —
this amendment closes the exact three variants an independent adversarial pass constructed and
verified against the real implementation, not every conceivable cyclic topology. A pipeline
author drawing a rework loop that reaches a **non-root** node two ways (the `m` case reasoned
about above) is, correctly, still refused — that was checked explicitly as part of this pass, not
assumed.
