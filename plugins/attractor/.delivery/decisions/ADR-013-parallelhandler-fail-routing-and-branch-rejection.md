# ADR-013: `ParallelHandler` component-node FAIL routing and branch-rejection handling

**Status:** accepted
**Date:** 2026-08-08
**Deciders:** Solution Architect

## Context

`architecture.md`'s FR-17b addition (`Handler.PARALLEL`) shipped its lint rules, its static
convergence-node discovery (`findConvergenceNode`, `dot/graph.ts`), its branch-execution seam
(`ctx.runBranch`, ADR-009), its shared per-node step primitive (`executeNodeStep`, ADR-012),
and its context merge-back (`mergeBranchContext`, ADR-010) — but not `ParallelHandler` itself
(`handlers/parallel.ts` does not exist yet; `p5-08` is the story that will write it). Two
questions the design's own text left inconsistent block that story and are recorded here,
per `roadmap.md`'s work item A and the two "blocking" rows in `architecture.md`'s Risks table.

Both questions were researched, not guessed, per `AGENTS.md`'s standing rule ("when in doubt,
read the spec first" — this project's worst defect class has twice been settling a spec
question by reasoning instead of reading). The spec (`strongdm/attractor@attractor-spec.md`,
fetched live for this ADR) was read directly for §3.3, §3.7, §3.8, §4.8, §4.9 — not taken
on a prior summary's word. Two reference implementations were also read: `microsoft/
amplifier-bundle-attractor` (`handlers/parallel.py`, `engine.py`) and `brynary/attractor`
(`src/handlers/parallel.ts`, `src/engine/runner.ts`), the only other TypeScript
implementation of this spec found.

## Decision A(a): component-node FAIL routing

**On SUCCESS or PARTIAL, the engine jumps unconditionally to the statically-computed
convergence node. On FAIL, no jump occurs — the ordinary §3.7 failure ladder
(`retry_target`/`fallback_retry_target`, then dead end) runs instead, exactly as for any
other node.**

The design's own text was not actually offering two live alternatives for the *same* case —
it was giving two correct-but-incompletely-scoped answers to two *different* cases, and their
apparent contradiction dissolves once that's named. This is forced by this project's own
already-committed graph model, not a preference:

- A "branch" **is** an outgoing edge of the component node (glossary; `dot/lint.ts`'s
  PAR-001/PAR-002, both keyed on `node.handler === Handler.PARALLEL` and outgoing-edge count).
  Every outgoing edge of a component node is a branch root, unconditionally — there is no
  attribute- or condition-based way, in this project's model, to draw a distinct "fail edge"
  off a component node the way `select_edge`'s §3.3/§3.7 step 1 does for an ordinary node.
  `select_edge(graph, componentNodeId, ...)` (`core/edge-select.ts:75`), called on the
  component node's own outgoing edges, can therefore only ever re-select a branch root — never
  the convergence node, which is generally several hops downstream through the branches, not a
  direct outgoing edge of the component node at all (confirmed against the `findConvergenceNode`
  test matrix, `architecture.md:671`, which treats "convergence node == one of the branch
  roots itself" as a distinct, degenerate fixture, not the general case).
- So on the common path (join outcome SUCCESS or PARTIAL), continuing the pipeline through the
  *ordinary* `selectEdge` ladder is not an available second option to weigh against the jump —
  it cannot reach the convergence node structurally, and picking a branch-root edge again would
  re-dispatch that branch's root node for real, a second time, outside any branch context. The
  jump is the only mechanism that works, and the design already commits to it independently of
  this ADR: the Test-strategy row for `findConvergenceNode` (`architecture.md:671`) states
  "Reused by PAR-001 and the runtime; one test suite proves both agree" — the runtime calling
  `findConvergenceNode` for this jump is already named as a design element, not introduced here.
- What was genuinely open is narrower than "does a jump happen at all": specifically, **does
  the jump also fire when the join outcome is FAIL**, ignoring status (the "Component
  structure" diagram's wording, "no status check written into that sentence" —
  `architecture.md:773`), or does FAIL divert to the existing retry/dead-end ladder instead
  (Answer 5's wording, `architecture.md:553-558`: "if an author sets `retry_target` on the
  component node and the join policy returns FAIL, the existing §3.7 ladder ... routes there")?
  Answer 5's sentence is only meaningful if FAIL does **not** auto-jump — if it did, a
  component node's `retry_target` would be unreachable dead code, which Answer 5 does not say.

Verified against source, independently:

- **Spec.** §3.7 Failure Routing (`attractor-spec.md:564-571`) is the *general* ladder for any
  stage returning FAIL: fail edge (`condition="outcome=fail"`) → `retry_target` →
  `fallback_retry_target` → pipeline termination. §4.8's own `ParallelHandler` pseudocode
  (`attractor-spec.md:808-844`) returns only SUCCESS or PARTIAL_SUCCESS under `wait_all` (FAIL
  is structurally unreachable there — matches this project's own
  `applyDefaultJoinPolicy`); it can only reach FAIL under `first_success`, which this slice does
  not ship. §3.3's `select_edge` (`attractor-spec.md:406-459`) takes a generic `node`/`outcome`
  and calls `graph.outgoing_edges(node.id)` with no shape check anywhere — but read literally,
  this is genuinely ambiguous for the spec's *own* component-node case too, for the identical
  structural reason above (a component node's own outgoing edges are its branch roots there as
  well, §4.8 line 811: `branches = graph.outgoing_edges(node.id)`); the spec never defines
  `execute_subgraph` and is silent on how its own generic loop continues past a component node
  in practice. The spec is not a clean precedent for "no special case," despite reading as
  one on a first pass — it has the same latent gap this project is resolving explicitly, one
  level up. **What the spec does settle**, and what actually grounds this decision, is that
  §3.7's ladder is `retry_target`/`fallback_retry_target`-based, not edge-condition-based, for
  a node with no distinguishable fail edge — which a component node, by this project's own
  branches-are-edges model, always is.
- **amplifier** *does* special-case (`engine.py:818-845`, BFS-jump to the fan-in node,
  unconditional on status), but its reason doesn't transfer: it has a **mandatory**, separate
  `FanInHandler` node (§4.9) that reads `context["parallel.results"]` and does its own
  candidate selection — a real downstream consumer the jump exists to reach regardless of
  status, because fan-in's whole job is to look at a mix of successes and failures
  (`heuristic_select`, `attractor-spec.md:886-889`: "Fan-in runs even when some candidates
  failed... only when all candidates fail does fan-in return FAIL"). This project's Open
  Question 5 deliberately removed that mandatory node; `mergeBranchContext` (ADR-010) already
  merges branch context back **before** the convergence node dispatches, so the convergence
  node runs as an ordinary node in the run's own real context, not as a triage step that must
  see FAIL runs to do its job. amplifier's reason for ignoring status does not apply here.
- **brynary/attractor**, the only other TypeScript implementation, calls `selectEdge`
  uniformly with no shape check (`runner.ts`, per direct grep). Its own default `wait_all`
  path also has no branch-throw try/catch around `Promise.all` (see Decision A(b) below) —
  a sibling gap in the same codebase — so its silence here is weaker evidence than it first
  appears; it is corroborating, not load-bearing, for this decision.
- **This project's own non-tradeable doctrine.** `AGENTS.md`'s "Fail-fast on FAIL" entry:
  "When a node returns FAIL and no condition explicitly matches the failure, no unconditional
  edge carries it forward... We implement §3.7." An unconditional jump-on-FAIL for a component
  node is exactly the shape that doctrine entry exists to forbid — a FAIL outcome silently
  carried forward as if it were a success, with no operator-visible break. Applying the
  doctrine uniformly (no carve-out for `PARALLEL`) is the only reading consistent with why the
  doctrine entry is in the non-tradeable list at all, and it is what Answer 5 already assumed.

**Implementation-cost note, corrected from `roadmap.md`'s framing.** Work item A's own row
(`roadmap.md:178`) and item C's row (`roadmap.md:180`) both state the cost of "mutating
`core/engine.ts`'s own loop-local `currentId` directly" as conditional on A(a) resolving
toward the unconditional-jump reading — implying the ordinary-ladder reading might leave item
C's "closed, refactor-only" status untouched. The structural analysis above shows that
framing is not available: **the convergence-jump for SUCCESS/PARTIAL was never in question**
(no alternative reaches the convergence node), so `executeNodeStep`'s dispatch (`engine.ts:
760-853`, the natural, ADR-012-consistent seam — shared by `run()`'s loop and `runBranch()`
alike, so a component node nested inside a branch gets identical treatment) needs this
additive branch regardless of how A(a)'s FAIL question resolved. **Item C's exit criteria
must be revised to include the convergence-jump as additive scope, independent of this ADR's
outcome** — this is not new cost this ADR introduces, it is cost the roadmap had
mis-attributed as conditional. See the roadmap update accompanying this ADR.

### Alternatives considered

#### Ordinary `selectEdge` ladder for both SUCCESS/PARTIAL and FAIL, no special case anywhere

**Why it was attractive:** the reading nearest to "no special case," matching a plain-text
gloss of the spec's §3.3 and brynary's uniform `selectEdge` call; simplest to state.
**Why rejected:** structurally impossible in this project's own graph model. A component
node's outgoing edges are its branch roots by construction (PAR-001/PAR-002); `selectEdge`
can only select among those, never the convergence node, which is not generally a direct
outgoing edge. Adopting this literally would either re-dispatch a branch root a second time
outside its branch context, or (more likely, since `ParallelHandler`'s own outcome carries no
`suggestedNextIds` pointing at a branch root) find no match and dead-end the *entire pipeline*
immediately after a fully successful fan-out — silently discarding every downstream node,
including the convergence node the design's merge-back step exists to feed.

#### Unconditional jump to convergence regardless of status (ignore FAIL entirely)

**Why it was attractive:** genuinely simpler to implement — one code path, no status branch,
matches amplifier's own mechanism precisely, and reads as the more literal interpretation of
the "Component structure" diagram's own prose.
**Why rejected:** amplifier's reason for this (a mandatory downstream `FanInHandler` that must
see FAIL results to do its job) does not exist in this project's design, which deliberately
dropped that node (Open Question 5). Without that reason, an unconditional jump means a FAIL
join outcome — the exact "zero branches succeeded" case the default join policy exists to
detect — gets silently carried forward as if the fan-out had succeeded, contradicting
`AGENTS.md`'s non-tradeable "Fail-fast on FAIL" doctrine and orphaning the component node's
own `retry_target`/`fallback_retry_target` attributes as unreachable dead code, which Answer
5's own prior text already assumed were live.

## Decision B: branch-rejection handling

**Each branch's own dispatch — worktree creation (if isolated), the `ctx.runBranch(...)`
call, and worktree removal — is wrapped in one try/catch/finally per branch, converting any
thrown exception into that branch's own FAIL `Outcome` (`failureReason` from the caught
error) before it can reach the aggregation boundary. `Promise.all` stays the aggregation
primitive; nothing switches to `Promise.allSettled`.**

Once every branch's own dispatch function is guaranteed never to reject, `Promise.all` and
`Promise.allSettled` become behaviorally identical at that call site — `allSettled`'s
distinguishing behavior (not short-circuiting on the first rejection, returning per-item
status) only matters when a rejection can still reach the aggregator, which the catch already
forecloses. Switching to `allSettled` on top of the catch would add a second, parallel error
path (discriminating `status: 'rejected'` results) that nothing can ever exercise once the
catch is in place — untestable-by-construction complexity, the kind this role pushes back on
elsewhere in this project (see `AGENTS.md`'s own "two mechanisms were arguing about the same
key and this one won" framing for the stale-label rule — the same shape of redundancy).

The catch must wrap the **whole** per-branch sequence, not just `ctx.runBranch`. The task's
own named example — a worktree name collision — throws inside `createWorktree`
(`run/worktree.ts`), which `ParallelHandler` calls itself, *before* `ctx.runBranch` (per
`architecture.md`'s Component-structure entry for `handlers/parallel.ts`: "creates one branch
worktree per branch via `run/worktree.ts` ... unless edge attr `isolate=\"false\"`"). A catch
scoped only around `ctx.runBranch` would still let that specific, explicitly-named failure
mode reject `Promise.all` uncaught.

Verified against source:

- **Spec** is silent on this entirely (`attractor-spec.md:821`, `execute_subgraph` is called
  and never defined, no error handling shown around it anywhere in §4.8) — confirmed by direct
  reading, not assumed from the task's own framing.
- **amplifier** wraps every branch dispatch uniformly: `try/except Exception as e: outcome =
  Outcome(status=FAIL, failure_reason=str(e))`, across every join/error policy — nothing ever
  reaches `asyncio.gather` as a rejection.
- **brynary/attractor** is internally inconsistent: its `first_success`/`k_of_n` policies
  (hand-rolled `Promise` state machines) wrap each branch dispatch in try/catch-to-FAIL, but
  its **default** `wait_all` path — the one this project ships this slice — has no try/catch
  around the `Promise.all`-mapped branch call, so a throw there rejects the whole `Promise.all`
  uncaught, orphaning still-pending siblings. Read as a real, unfixed inconsistency in that
  sibling project rather than a considered second position: its own more-careful paths already
  converged on catch-and-convert, and the one place it didn't is exactly the shape
  `architecture.md`'s own Risks table (`architecture.md:774`) already names as the hazard to
  avoid.
- **This project's own doctrine.** "Loud aborts over silent degradation" (`AGENTS.md`) is
  about a different failure class (unimplemented shapes should fail loudly, not run as
  something else) but the underlying value — a failure should become a recorded, visible
  outcome, not vanish or crash the host — argues the same direction here: a caught,
  FAIL-converted branch is *visible* (a `BranchRunResult` the join policy sees and, on the
  default `wait_all` policy, correctly folds into an overall FAIL if it's the only branch, or
  an overall PARTIAL/SUCCESS with a named failed branch otherwise); an uncaught rejection that
  escapes `Engine.run()` as a thrown exception is not visible in any `RunResult` at all — it
  is exactly the "silent degradation" class, just via a crash instead of a quiet no-op.

### Alternatives considered

#### Switch dispatch to `Promise.allSettled`, map rejections to FAIL afterward, no per-branch catch

**Why it was attractive:** a smaller, single-point change — swap the aggregation primitive
and add one post-processing step, rather than touching every branch's own dispatch code; also
the option that most directly targets the literal hazard `architecture.md`'s Risks table
names ("`Promise.all` rejects on the first rejection and does not cancel or continue awaiting
the still-pending sibling branches").
**Why rejected:** `allSettled` alone fixes only half the hazard. It guarantees the aggregator
waits for every branch to settle rather than abandoning pending siblings on the first
rejection — but it does **not**, by itself, guarantee branch-local cleanup (worktree removal)
runs for the branch that threw; that still requires a try/finally inside that branch's own
dispatch function, which is most of the mechanism the per-branch catch already provides. Once
that try/finally exists to guarantee cleanup, converting the caught exception to a FAIL
`Outcome` right there is strictly simpler than letting it become a rejection for `allSettled`
to discriminate afterward — the `allSettled`-specific handling becomes a second code path
answering a question the first path already answered, with no scenario left to exercise it.

#### Catch only around `ctx.runBranch`, leave worktree create/remove unguarded

**Why it was attractive:** narrower diff, and `ctx.runBranch` is the seam this ADR's own A(a)
decision and ADR-009 are both centered on, making it the more obvious place to add error
handling.
**Why rejected:** demonstrated false negative above — the task's own named failure mode (a
worktree name collision) throws inside `createWorktree`, called by `ParallelHandler` directly,
outside `ctx.runBranch`. A catch that doesn't cover it leaves exactly the scenario this
decision exists to close still able to reject `Promise.all` uncaught.

## Residual risk

- **A(a): condition-truth-independent convergence discovery.** `findConvergenceNode` is
  static reachability, ignoring condition truth (already named in `architecture.md:772`); the
  runtime jump this ADR specifies inherits that over-approximation unchanged — it dispatches
  the same precomputed convergence node regardless of which conditional sub-path a specific
  branch actually took at runtime. Not new here; restated because this ADR is what makes the
  runtime side of it real.
- **A(a): §3.7's "fail edge" step (a `condition="outcome=fail"` outgoing edge) is
  unreachable on a component node.** Named explicitly above, not left implicit: because every
  outgoing edge of a `PARALLEL` node is a branch root, an author cannot draw a distinguishable
  fail edge the way they could on any other node kind. Of §3.7's four-step ladder, only steps
  2 and 3 (`retry_target`/`fallback_retry_target`) are reachable for a component node; step 1
  is structurally inert and step 4 (pipeline termination) is what happens when neither
  attribute is set. Worth a line in whatever skill/authoring guidance documents `PARALLEL`
  nodes, so an author does not draw a `condition="outcome=fail"` edge off a component node
  expecting it to behave as a distinct fail route — it will be silently treated as an
  additional branch instead (PAR-002 does not warn on this, since it only checks outgoing-edge
  count, not condition content).
- **A(a): item C's exit criteria correction is a process risk, not a code risk.** If
  `roadmap.md`'s update accompanying this ADR is not read before item C is marked done, the
  convergence-jump could ship believed-optional when it is required. The roadmap edit made
  alongside this ADR is the mitigation; there is no code-level guard against the process gap.
- **B: an error caught and converted to FAIL loses its original stack/type at the
  `BranchRunResult` boundary**, same as every other FAIL path in this engine already does
  (`outcome.failureReason` is a string). Acceptable — consistent with how every other caught
  failure in this codebase is already surfaced, not a new loss this decision introduces.
- **B: partial worktree state on a mid-`createWorktree` throw.** Some `git worktree add`
  failures (the named name-collision case) may leave partial on-disk state despite throwing.
  The catch converts the exception to a FAIL outcome; it does not by itself guarantee the
  worktree layer is transactional. This is `run/worktree.ts`'s own concern (ADR-011,
  `AGENTS.md`'s "cleanup that refuses to destroy work" doctrine already governs its removal
  path) and is unchanged by this ADR — named so `p5-08`'s implementer knows the catch is not a
  substitute for `run/worktree.ts` correctness, only for making sure whatever it does or does
  not leave behind gets a chance to be reported and, where possible, cleaned up via `finally`.

## Consequences

**We gain:** both readings architecture.md left as simultaneously "live" are resolved with a
stated reason apiece, unblocking `roadmap.md`'s work item A and `p5-08`. A(a) means a
component node behaves exactly like every other node with respect to `AGENTS.md`'s
non-tradeable Fail-fast-on-FAIL doctrine — no silent continuation past an unhandled fan-out
failure — while still reaching the convergence node the one way that's structurally possible
on success. B means `ParallelHandler.execute()` can never itself leave `Engine.run()` by
throwing; every branch failure, however it originates, becomes a `BranchRunResult` the
existing join policy already knows how to fold in, and `Promise.all` remains the simplest
correct aggregation primitive rather than being replaced by one whose extra discrimination
logic nothing can ever reach.

**We accept:** `p5-08`'s implementation is not free — the convergence-jump requires an
additive, `Handler.PARALLEL`-conditioned branch inside `executeNodeStep` (reopening item C's
"refactor-only" framing regardless of this ADR, as corrected above), and the per-branch
try/catch/finally must wrap worktree lifecycle code that today lives inside
`ParallelHandler.execute()` itself, not merely around the `ctx.runBranch` seam. Neither is a
new decision this ADR invents scope for — both were already implied by the design as written
— but neither was written down as required scope before this ADR, and now is.
