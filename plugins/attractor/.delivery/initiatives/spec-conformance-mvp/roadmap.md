# Delivery roadmap: attractor — human-gate self-report guard (FR-18/HITL-003) and beyond

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-08-07
> PRD: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md` · Architecture: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/architecture.md`
> `.delivery/initiatives/spec-conformance-mvp/prioritization.md` predates this roadmap and does not
> itself carry FR-17b/FR-18/FR-9b staging; the Product Owner's scoring/staging and this
> Program Manager's feasibility check for those, both supplied inline, stand in for it.
> `.delivery/glossary.md` now exists (seeded 2026-08-07, resolving the FR-17b adversarial-critic
> findings) and Phase 5 below uses its terms — *branch*, *branch worktree*, *convergence node*,
> *join policy*, *context merge-back* — exactly as defined there. Two terms this document still
> needs (*self-report gap*, *direct predecessor*) remain genuinely absent from it; proposed at
> the end, not coined silently.

## Constraints

**Team:** not stated upstream. Every ADR here (ADR-001–012) names one Solution Architect
deciding and one implementer building. Assumed: **one implementer, single-threaded**, until
told otherwise — confirm before Phase 2 needs a real calendar, and before Phase 5's ten
work items are staffed: several are independently startable (see Phase 5's own Critical path),
which only shortens the calendar if more than one implementer is actually available.
**Fixed dates:** none found in the PRD, architecture, or `carry-forward.md`.
**Fixed variable: scope.** No external date is fixed; the plan optimizes for landing FR-18
correctly and surfacing the open decisions blocking everything after it, not a stated date.

## Sequencing rationale

Phase 0 is not sequenced — already in production (PRs #1–#4), recorded only for a complete
requirement-coverage table. Everything real starts at Phase 1: FR-18 (HITL-003) is the only
unbuilt requirement with **zero open product or architecture questions**, confirmed by tracing
it against the blocked question clusters directly against source, not the PRD's prose
grouping. It is staged first less because it proves the riskiest assumption and more because
it is the *only* buildable unit — everything else is blocked on a decision this document
cannot make. Risk-first here therefore means pointing at the open questions, not at code
sequencing — see Dependencies outside our control and Phase 2's correction below.

## Phases

### Phase 0: Already shipped (MVP) — retrospective, not planned

**Entry criteria:** none — complete, merged (PRs #1–#4).
**Delivers:** FR-1, FR-2, FR-3, FR-4, FR-10, FR-11, FR-17a.
**Demonstrable exit (already shown):** install `attractor` via the marketplace without
cloning the monorepo; `attractor doctor` correctly reports a missing `claude` on `PATH`; an
invalid `plugin.json` fails with a message naming the file and the parse problem; a plain
node's FAIL no longer wrongly consults the graph-level `retry_target` (D7); a direct
`new Engine(...)` embed refuses a lint-dirty graph exactly like the CLI (F10); lint refuses,
before a run starts, any node resolving to `Handler.PARALLEL`/`FAN_IN`/`MANAGER_LOOP`.
**What it taught:** the packaging approach works end-to-end, and both founding-incident-
adjacent bugs (D7, F10) were real and fixable, not hypothetical.

### Phase 1: FR-18 — HITL-003, the self-report guard

**Entry criteria:** none beyond Phase 0 — `declaredOutputs`/`effectiveOutputs`, the `Handler`
enum, and the `HAND-001` pattern in `lint.ts` all exist unconditionally. No dependency on
`Handler.HUMAN` being registered (HITL-001's own fixtures already lint human-gate nodes with
`HUMAN` unregistered — direct precedent). **Delivers:** FR-18 only.
**Demonstrable exit:** run `attractor lint` (or the equivalent test) against two side-by-side
fixtures — one where a `Handler.CODERGEN` node feeds `human.context=` into a direct-successor
gate whose `human.channel` includes `"agent"` (WARNING fires, message names the node and the
key), one safe variant that lints clean (channel is `"human"`-only, or the context key traces
to a non-adjacent node). Same demo shape ADR-005 already used for HAND-001.

**Not "done" at the lint rule passing.** The feasibility check and Feature Critic review each
independently surfaced gaps that don't block starting but change what "done" means. All
resolve inside one document, **ADR-006, written first**, before any fixture — detail in the
work-item table.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| **ADR-006** — (a) fixes the PRD's dead "design doc's Residual Risk section" citation (`prd.md:80,102`; confirmed absent from every candidate file — channels-design headings, `architecture.md`'s differently-named `## Risks`, every existing ADR's Context/Decision/Alternatives shape) by writing the section or repointing to `carry-forward.md`'s Plan 4 paragraph; (b) resolves the FR text's own reading ambiguity as its opening decision — does the rule fire only when the direct predecessor resolves to `Handler.CODERGEN`, or for any direct predecessor whose declared/effective output matches — before fixtures are written, not after a reviewer picks the other reading; (c) adds an Open Questions row (owner: PO or SA) tracking the multi-hop and `Handler.TOOL`-without-`outputs=` shapes FR-18's own prose admits are out of scope, so they survive this phase shipping instead of living only in a parenthetical; (d) states explicitly that the WARNING is visible on the CLI's pre-run lint path today but **not** on a direct-embed `Engine` path until Open Question 7/FR-12 resolves — the `agent` channel's likeliest unattended usage is exactly the path this doesn't reach | S | high | none |
| Direct-predecessor-edge helper in `graph.ts` (mirrors GATE-001's inline pattern, ~5 lines) | S | high | ADR-006 (b) |
| `HITL-003` lint rule block in `lint.ts` (~50–80 lines, HAND-001-sized) | S | high | predecessor helper |
| Fixtures + tests in `lint.test.ts` — positive/negative pair, plus a third pinning ADR-006(b)'s reading (e.g. a `Handler.TOOL` node with declared `outputs=` in the same shape), anchor-style | S | high | lint rule block |
| SKILL.md/README caveat: WARNING not visible on embedded-`Engine` path pending FR-12 | S | high | ADR-006 |

**Verification in this phase:** unit-level only, same file/idiom as HITL-001/HAND-001 — no new
test infrastructure, no integration or subprocess test (no runtime handler consumes these
attributes yet).

**Cut list — dropped first if late, in this order:**
1. SKILL.md/README caveat about FR-12's embedded-path gap — fast-follow, not a blocker to ship.
2. Narrow ADR-006's Residual Risk section to HITL-003's own scope; the Open Questions row
   becomes a one-line addition, not a fuller write-up.
3. If the CODERGEN-scope reading proves contentious, ship the narrower literal reading and
   file the broader one as a Residual Risk bullet rather than resolving it in this phase.

Deciding this now beats deciding it under pressure.

### Phases 2–4: named, not planned in detail

Two corrections worth stating in prose because missing either mis-routes an owner: **Phase 2
is not blocked by an open product question** — Open Questions 1/2 (which blocked FR-8) were
**resolved 2026-08-06**; what actually blocks it is an unstarted architecture pass, nobody's
been asked to schedule. Real design work for the `agent`/`CommandChannel` wiring already exists
(`.superpowers/specs/2026-08-05-human-gate-channels-design.md`) — what's missing is carrying it
into `architecture.md`/an ADR and implementing it, not designing from nothing. **Phase 3 (Open
Question 9) is RESOLVED 2026-08-09** — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md)
— no longer this board's highest-leverage open decision; now a story ready to be scoped.
Everything else below is table detail, not further narrative.

| Phase | FRs | Blocked by | Owner | Depends on | Effort |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 2 — Human-gate core | FR-5, FR-6, FR-7, FR-8 | **Not** Q1/Q2 (resolved 2026-08-06, channels design, 5/5 convergence) — an unstarted architecture pass: no ADR covers the `agent`/`CommandChannel` hops or `GateContext`/`selectEdge` wiring; `architecture.md` predates the resolution and says so in its own Scope line; `Handler.HUMAN` still unregistered | Solution Architect — schedule the pass | `agent` sub-slice depends on Phase 1; the `human`-channel path does not and could be architected in parallel | Unscoped — no estimate until the architecture pass exists |
| 3 — Founding-incident verdict | FR-9a (rejected) / FR-9b (accepted) | **RESOLVED 2026-08-09** — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md): lint-time-only refusal (`GATE-002`, ERROR), runtime verdict unchanged | Product Owner + Solution Architect jointly — decided | None | S (one new lint rule, two small exports, per ADR-014's own Consequences) |
| 4 — Embedder diagnostic visibility | FR-12 | Open Question 7 — should an embedder observe WARNING-severity diagnostics at all; a scope call, not an engineering unknown | Solution Architect | Also closes Phase 1's own FR-12 caveat (embedded-`Engine` WARNING visibility) — scope with that in view, not purely as S6 ergonomics | Unscoped |

### Phase 5: FR-17b — parallel fan-out (`Handler.PARALLEL`)

**2026-08-08: Phase 5 is done.** Every work item (A through J) is either shipped or explicitly
tracked in a follow-on story. In plain terms: a pipeline author can now write a step that fans
out to several branches running at once, each optionally isolated in its own git worktree, with
the results joined back together correctly whether all branches succeed, some fail, or all fail
— and this was proven by actually running one through the real command-line tool, not just by
tests. Item I (`ParallelHandler`, the piece that makes this real) shipped in sprint 3, story
`p5-08`. Its review found and fixed one significant bug (a git-worktree race made
production-reachable by this story's own defaults) and four documentation gaps, all fixed before
this note was written — see `sprints/3-parallel-handler-review.md` and `reviews/sprint-3-01.md`
for what was found and how each was closed; nothing from that review is still open. Item J's two remaining rows
(checkpoint isolation and an opt-in real-subprocess ceiling test) live in story `p5-09`, now
unblocked and ready for its own readiness pass.

**Entry criteria:** none beyond Phase 0 for FR-17a (already shipped separately). For FR-17b:
Open Questions 3, 4, 5 (branch-declaration syntax, worktree isolation default, fan-in-on-all-fail
semantics) — all **resolved 2026-08-07**, Product Owner, no dissent recorded. The architecture
pass itself is done and has survived two rounds of adversarial review: a feature-critic pass
found 7 findings (F1–F7), all resolved across six new ADRs (ADR-007–ADR-012); an independent
re-verification pass then found 3 residual gaps inside those fixes and closed all three in
place. No dependency on Phases 1–4 or 6 — `Handler.PARALLEL`'s registration touches none of
`Handler.HUMAN`'s code path, and nothing in this phase reads or writes the channels design.
**2026-08-08: the two narrow Solution Architect decisions the architecture's own Risks table
named (component-node FAIL routing; branch-rejection handling) are now resolved** — see
[ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md) and work item
A below. Resolving A(a) surfaced a correction to item C's own scope (see item C's row): the
convergence-node jump for a SUCCESS/PARTIAL join outcome was never actually in question — it is
structurally the only way the main run can continue past a component node, independent of how
the FAIL question resolved — so item C's "closed, refactor-only" framing needs that additive
scope regardless, not only under the reading the roadmap previously flagged as the one that
would reopen it. Work item A itself is now a "write it down" step only (already done, via the
ADR) — seven of this phase's other nine work items (B through H) never depended on either
answer; the final two (I, the integration point, and J, which depends on I) can now proceed
without a standing dependency on this decision.

**Demonstrable exit:** two demos, mirroring the lint-first, StubBackend-first posture the rest
of this codebase already uses (a live-subprocess demo is explicitly Layer 3's job, opt-in only —
see Verification approach).
1. **Lint-only, same demo shape ADR-005/HITL-003 already used:** run `attractor lint` against
   four fixtures side by side — a `component` node whose branches never reconverge (PAR-001
   ERROR, refused before any run starts); a `component` node where two branches both pass
   through one shared non-convergence node before reaching the real one — the exact "normalize"
   shape the F3 finding named, plus the fifth-pass `root1/root2→{X,Y}→combine` tied-descendant
   variant (PAR-004 ERROR, both shapes); a `component` node with exactly one outgoing edge
   (PAR-002 WARNING, lints clean otherwise); a branch root wired straight to the graph's real
   EXIT node without passing through the shared convergence node first (PAR-005 WARNING, lints
   clean otherwise).
2. **Execution, `GatedBackend`-driven (not live):** an amplifier-`05-parallel-fan-out.dot`-shaped
   fixture — 3 branches, one node each declaring a distinct `outputs=` key, converging on one
   node. Observe: (a) one branch worktree per branch (isolate defaults `true`), each blind to
   the others' uncommitted state; (b) `max_parallel` bounding concurrent dispatch, proven via
   `GatedBackend.maxObserved`; (c) the default join policy returning FAIL only when every branch
   fails; (d) `mergeBranchContext` delivering all three branches' distinct keys to the
   convergence node's substitution, and — the ADR-010 finding's own exact reproduction, three
   branches sharing one key, all SUCCEED — the last-declared branch's value winning with exactly
   two `node.parallel.context_collision` events logged, not zero or one.

This phase decomposes into ten dependency-ordered chunks, not one work item — the six ADRs
resolve six previously-open engineering questions, and each maps to a real, separately-testable
piece of code, not a subsection of one PR. Two chunks are load-bearing prerequisites everything
else builds on, and — this is the sequencing point worth stating explicitly — they are
prerequisites *of each other's siblings*, not of each other: the worktree async conversion
(item B, ADR-011) and the `executeNodeStep` extraction (item C, ADR-012) touch disjoint files
(`run/worktree.ts`+`cli.ts`+`worktree.test.ts` vs. `core/engine.ts` alone) and can proceed in
parallel, but the branch-execution seam (item F, ADR-009) cannot exist until item C lands —
`runBranch` is a thin caller of `executeNodeStep`, not an independent loop — and the branch
worktree lifecycle inside `ParallelHandler` (item I) cannot exist until item B lands. The
cwd-plumbing fix (item D, ADR-008) and the convergence-model static analysis with its three lint
rules (item E, ADR-007's core decision plus both amendments — PAR-001/002/004) are both
independent of the two prerequisite refactors *and* of each other — pure additive changes to
disjoint files (`handlers/{types,box}.ts`+`backend/claude.ts` vs. `dot/graph.ts`+`dot/lint.ts`)
— and can run alongside items B and C. **Footnote, unlike the B/C and D/E pairs above: D and F
are not actually disjoint.** Item D (ADR-008, `Backend.run()`'s new `cwd` param) and item F
(ADR-009, `HandlerCtx.runBranch`) both add to `handlers/types.ts`. Costs nothing under this
roadmap's single-implementer assumption — the two additions are semantically unrelated fields on
unrelated interfaces — but the "touches disjoint files" parallel-safety reasoning used above
doesn't actually hold for this pair; relevant only if a second implementer is ever staffed, a
possibility this roadmap's own Constraints section already floats. PAR-005 (item G) and context merge-back plus PAR-003
(item H) both wait on item F specifically, because both need `BranchRunResult` to exist first —
PAR-005 needs the runtime EXIT-as-branch-dead-end decision that ships with `runBranch`; merge-
back needs `BranchRunResult.context` before it can be populated. `ParallelHandler` itself
(item I) is the true integration point — the only chunk that composes nearly every other one —
and is deliberately last among the implementation chunks; it is also where the two still-open
Solution Architect decisions (item A) actually bite, since both the join-policy's FAIL routing
and the `Promise.all`-vs-`allSettled` choice are decisions about what `ParallelHandler.execute()`
itself does, not about any of the seven chunks that build the pieces it composes. The
concurrency-specific test infrastructure (item J) comes last because most of its assertions need
a real `ParallelHandler` to exercise, though the `GatedBackend` test double has no such
dependency and could be started early as idle capacity allows.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| **A** — **RESOLVED 2026-08-08, see [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md).** Two narrow Solution Architect decisions, both already named blocking in `architecture.md`'s own Risks table, neither new research: (a) a `PARALLEL` node's join outcome routes to the statically-computed convergence node unconditionally on SUCCESS/PARTIAL (the only structurally possible continuation — a component node's own outgoing edges are its branch roots, never the convergence node, so `selectEdge` can never reach it); on FAIL, no jump occurs and the ordinary §3.7 `retry_target`/`fallback_retry_target`/dead-end ladder runs instead, per `AGENTS.md`'s non-tradeable Fail-fast-on-FAIL doctrine and Answer 5's own prior wording; (b) `ParallelHandler.execute()` wraps each branch's *entire* dispatch — worktree creation, the `runBranch` call, and worktree removal, not `runBranch` alone — in one try/catch/finally converting any thrown exception to that branch's own FAIL `Outcome`; `Promise.all` stays the aggregation primitive, since nothing can reject once the catch is in place and switching to `Promise.allSettled` on top of it would add a discrimination path nothing can ever exercise. **A(a) is not purely a documentation decision — see item C below, corrected:** the convergence-node jump requires mutating the loop-local `currentId`/the shared `executeNodeStep`'s own dispatch inside `core/engine.ts` directly, something only that file can do, not `handlers/parallel.ts` — and this is required regardless of how A(a) resolved, not conditional on the reading originally suspected, because the jump was never optional for the SUCCESS/PARTIAL case | S | high | none |
| **B** — `run/worktree.ts` async conversion (ADR-011, resolves F4): `git()` and its five dependents (`isGitRepo`, `createWorktree`, `hasUncommittedWork`, `isRegisteredWorktree`, `removeWorktree`) become `async`/`execFile`-based, zero new dependency; `cli.ts`'s five call sites (`cli.ts:237,243,260,261,338`) and `worktree.test.ts`'s ~25 gain `await`; Spike 12 (does `execFile`'s promisified rejection shape match `execFileSync`'s thrown-`Error` shape closely enough that the existing message-matching assertions keep passing) is verified as part of this item, not assumed before it | M | high | none |
| **C** — `Engine#executeNodeStep` extraction (ADR-012, resolves F5+F6): `run()`'s existing loop (`engine.ts:643-1088`) is refactored onto one shared private method plus a new `stepCount` instance field, replacing the loop-local `step` variable. `runBranch` does not exist yet after this item — that is item F's job; this item's own exit condition is the *existing* test suite passing unchanged against the refactored `run()`, since it is a refactor of already-shipped, tested code, not an additive change. **"Closed, refactor-only" status is corrected by [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md), not merely conditional on A(a) as originally framed here:** the convergence-node jump for a SUCCESS/PARTIAL join outcome is required unconditionally — a component node's own outgoing edges are its branch roots, never the convergence node, so no reading of A(a) was ever going to avoid it. Item C's exit criteria therefore **do** need the additive `Handler.PARALLEL`-conditioned branch inside the shared `executeNodeStep` (the natural seam — shared by `run()`'s loop and `runBranch()` alike, so a component node nested inside a branch is handled identically), regardless of how A(a)'s FAIL question resolved. Start C now regardless (it is not blocked on A), but do not mark it permanently closed until this additive scope is built, not merely until the *existing* suite passes unchanged | L | medium | none |
| **D** — `Backend.run()` cwd parameter (ADR-008): additive trailing param on `Backend.run()`; `ClaudeCodeBackend` prefers the per-call value over its constructor-bound one; `BoxHandler.execute` passes `ctx.cwd` through. **Done** — `box.ts:96-102` confirmed passing `ctx.cwd` as of story `p5-03` | S | high | none |
| **E** — Convergence-model static analysis (ADR-007's core decision plus both amendments): `findConvergenceNode`/`findPartialReconvergence` in `dot/graph.ts`; PAR-001 (ERROR, no convergence node), PAR-002 (WARNING, single-edge no-op fan-out), PAR-004 (ERROR, partial reconvergence — the broadened fifth-pass wording, including the tied-full-common-descendant case) in `dot/lint.ts`. Fixtures must include the exact "normalize" shared-step shape the F3 finding named and the `root1/root2→{X,Y}→combine` tied-descendant shape the fifth-pass amendment named — not only the easy no-convergence/single-branch cases | M | medium-high | none |
| **F** — `HandlerCtx.runBranch` seam + `Engine#runBranch` (ADR-009, folding in ADR-007's EXIT amendment): `BranchRunOptions`/`BranchRunResult{outcome, path}` interfaces; `Engine.run()` populates `ctx.runBranch` per dispatch; the new private `runBranch()` loops on `executeNodeStep`, interpreting every `'stop'` reason — including `'exit'`, treated as an ordinary dead end for that branch alone, never the goal-gate check, never `this.checkpoint(null)`, never a `RunResult` — the same way | M | medium | C |
| **G** — PAR-005 (ADR-007's EXIT amendment, WARNING, resolves F2): a branch root can reach the graph's real EXIT node without first passing through the branches' own convergence node. Ships with the corrected rationale (ending one branch's own traversal early is legitimate on its own; a branch does not stop the whole pipeline **this slice** — the fifth-pass fix, not the original self-contradicting text) as the rule's documented reasoning, not just its firing condition. **This is this slice's shipped behavior, not a closed question:** architecture.md's F2-residual amendment leaves open, as a Product Owner scope call, whether "stop the whole pipeline from inside a branch" should become a real feature later (new cancellation plumbing, not free); see the Risks table and Dependencies outside our control below. Until/unless that is prioritized, architecture.md states as a **must** that skill/authoring guidance say explicitly that a branch reaching EXIT never stops the run — not eligible for this phase's cut list (see below) | S | high | E, F |
| **H** — Branch context merge-back (ADR-010, resolves F1) + PAR-003: `BranchRunResult` gains a `context` snapshot field; `mergeBranchContext` (declaration-order merge, `ENGINE_MANAGED_KEYS`-bare-list-only exclusion — `tool.`-prefixed keys ARE merged — `node.parallel.context_collision` logging on overwrite); PAR-003 (WARNING, declared-`outputs=` collision, design-time complement, blind to inferred keys like `tool.last_line`). Fixtures must include the ADR-010 finding's own exact reproduction (three branches, one shared key, all SUCCEED) proving the pre-fix code fails red before asserting the post-fix behavior — a test that only passes against the fix is decorative | M | medium | F |
| **I** — `ParallelHandler` (ADR-007's dispatch integration; consumes ADR-008/009/010/011; resolves item A's two decisions in code): semaphore-bounded fan-out over `max_parallel` (default 4, per Open Question 3); one `createWorktree` per branch unless the edge's `isolate` attribute is `"false"` (per Open Question 4); `applyDefaultJoinPolicy` (FAIL iff zero branches SUCCEED/PARTIAL, per Open Question 5's correction of amplifier); calls `mergeBranchContext` after every branch settles regardless of the join verdict; `defaultHandlers()` gains the `[Kind.PARALLEL, new ParallelHandler()]` entry. `UNREGISTERED_HANDLER_KINDS` loses `Handler.PARALLEL` as this item's own **last** line, not an earlier one — lint must keep refusing `PARALLEL` nodes until a real handler exists to run them, matching HAND-001's own "refuse before run starts, never abort mid-run" posture | L | medium-low | A, B, D, E, F, H |
| **J** — Concurrency test infrastructure: `GatedBackend` test double (forced-overlap — `StubBackend` resolves same-tick and is decorative for every overlap assertion); the three-layer NFR-7 suite (ceiling enforcement; real-`git`-concurrency, including that git calls no longer block a sibling's in-flight work; the opt-in `ATTRACTOR_LIVE=1` live-subprocess layer that stays a runbook, not CI); shared-ledger race test (a goal gate inside a branch observed mid-run by a sibling); branch-throws test (a rejected `runBranch` call with siblings still pending — asserts a well-formed FAIL `RunResult`, no uncaught rejection, no orphaned worktrees); checkpoint-isolation test (two branches' `saveCheckpoint` calls interleaved, asserting the outer run's own file never names an in-flight branch's node); worktree-name-collision test (real concurrent `git worktree add`, reclassified from Spike 10 — no live LLM backend needed) | L | medium | I |

**Verification mapping — work item to architecture's Test-strategy rows.** The architecture's
own Test strategy (FR-17b additions) lists roughly thirty rows by *area*, not by work item.
Decomposing the phase into A–J makes it possible, and necessary, to say which item each row
actually lands on — an item's "done" cannot mean "code compiles" when its highest-risk row is
silently owned by a different item, or by none. Doing that mapping surfaces two corrections and
two flat gaps below; the table states which rows this document already named correctly.

| Work item | Test-strategy rows it owns | Already named in this table before this pass? |
| :-- | :-- | :-- |
| A | none directly — unblocks "Component-node FAIL routing" and "Branch throws mid-flight" once resolved | yes (Dependencies outside our control) |
| B | `worktree.ts` async conversion regression (real `git`); "Worktree operations no longer block sibling branches" (**mutation-checked**, needs `GatedBackend`) | regression only — the mutation-checked row was not named |
| C | none directly — exit condition is the unchanged existing suite; its real parity test cannot be written until F exists | yes, correctly |
| D | Backend `cwd` plumbing (unit) | yes |
| E | `findConvergenceNode`'s own fixture set (multi-hop/no-convergence/single-branch/convergence-at-EXIT/convergence==branch-root); PAR-001/PAR-002; PAR-004 "normalize" shape; PAR-004 tied-descendant fifth-pass shape | PAR-004's two shapes yes; `findConvergenceNode`'s broader EXIT/self-root fixture set was not named |
| F | "Branch reaching EXIT is a dead end" (**mutation-checked**, needs `GatedBackend`); retry-target-outside-branch (**gap — see below**) | dead-end row implied only by dependency, not named; retry row missing entirely |
| G | PAR-005 firing condition (unit); PAR-005's WARNING-must-not-halt-the-run row (fifth-pass residual, **gap — see below**) | firing condition implied; the "must not halt" row was not named anywhere in this document |
| H | Merge-back happy path; exact F1 reproduction (three branches, one key — a distinct property from the two-branch case, needs `GatedBackend`); collision (**mutation-checked**, needs `GatedBackend`); `ENGINE_MANAGED_KEYS` filter (`tool.`-prefixed keys ARE merged); FAIL-branch exclusion; PAR-003 | happy-path/collision/FAIL-exclusion named in "Not eligible for cut list"; exact-F1-reproduction and the `ENGINE_MANAGED_KEYS` filter row were described in item H's own prose but not separately protected |
| I | Concurrency ceiling enforcement; branch-throws mid-flight; Component-node FAIL routing (once A resolves); retry/partial-completion interacting with convergence (**gap — see below**) | ceiling and branch-throws named (bundled under item J); retry/convergence row missing entirely |
| J | Concurrency ceiling; real-subprocess ceiling (Layer 3); shared-ledger race; checkpoint isolation; worktree-name collision (**dependency correction below — needs only B, not I**) | yes, all five named |

**Correction — `GatedBackend` is a shared prerequisite across B, F, and H, not an item-J-only
concern.** The decomposition prose above already notes the test double "has no such dependency
and could be started early as idle capacity allows"; the mapping above shows this understates
it. Three rows outside item J's own dedicated suite name `GatedBackend` (or "forced-overlap") as
the only thing keeping them non-decorative: item B's "no longer blocks sibling branches" row,
item F's "branch reaching EXIT is a dead end" row, and item H's completion-order-independence
rows (both the two-branch collision and the exact-F1-reproduction cases — "drive completion out
of declaration order via `GatedBackend`" is the architecture's own phrase for both). None of B,
F, or H is gated on item I in the dependency graph, but `GatedBackend` is currently described
only as part of item J, which *is* gated on I. Read literally, an implementer could finish B, F,
and H's production code without `GatedBackend` ever existing to prove those three rows are real
rather than `StubBackend`-decorative (`StubBackend` resolves same-tick; per the architecture's
own Concurrency-specific test design section, "any test built only on it is decorative for every
row... marked 'forced-overlap'"). **Fix: build the `GatedBackend` class itself — the ~15-line
double the architecture's own code block specifies, not item J's dedicated ceiling/ledger/
throws/checkpoint rows — alongside items B–E, before B, F, or H is called done.** It is a test
double with no dependency of its own, so nothing in the "no predecessor, start immediately"
group in Critical path is disturbed by building it there.

**Correction — worktree branch-name collision needs only item B, not item I.** The architecture
names this row as needing "no live LLM backend... only real concurrent `git` calls": the test
drives `Promise.all` over several `createWorktree` calls directly, with no `ParallelHandler`, no
`GatedBackend`, no `runBranch` anywhere in it. Bundling it under item J's description leaves it
inheriting J's "depends on I" in Critical path, which delays a fully-automatable,
no-new-infrastructure test behind six other items for no reason the architecture supports.
**Fix: write this test immediately after item B lands**, independent of J's other four rows;
its cut-list position (2, low × high) is unaffected — only its earliest *availability* changes.

**Gap — two architecture Test-strategy rows have no home in this work-item table.** Both are
named as real risk rows (not hedged as speculative) in the architecture's own table, and neither
maps to any of items A–J as written:
- *"Retry inside a branch, target resolves outside the branch's own reachable set"* (medium ×
  medium, integration) — a branch node's `retry_target`, or the graph-level fallback rung,
  pointing at a sibling branch's node or the convergence node itself; Answer 5's own text assumes
  the target "stays inside the branch's own reachable set" without anything enforcing it.
  Belongs to **item F**: `retry_target` resolution runs inside `executeNodeStep`, which
  `runBranch` calls identically to the main loop, so this is F's own seam, not a downstream one.
- *"Retry/partial-completion interacting with convergence"* (medium × high, integration) — 3
  branches, one exhausts retries and fails a node with a declared `outputs=` key the convergence
  node consumes; exercises the existing `failedOutputs` eager-input-check under branch
  partiality for the first time, asserting the convergence node is blocked, not silently fed a
  stale value. Belongs to **item I**: it needs a real join-policy verdict composed with
  merge-back's FAIL-branch exclusion (item H), which only exists once `ParallelHandler` does.

Both are added to item F's and item I's own exit criteria by this pass; as written before this
pass, "done" for F and I would not have required either test to exist.

**Verification approach:** three levels, matching the architecture's own layering. Unit tests
for every pure function (`findConvergenceNode`, `findPartialReconvergence`,
`applyDefaultJoinPolicy`, `mergeBranchContext`) and every additive interface change. Integration
tests using `GatedBackend` (new this phase — `StubBackend` is shipped `--dry-run` code that
resolves same-tick and cannot force real overlap, so it is decorative for every "forced-overlap"
row above) and real `git` (not mocked, reusing `worktree.test.ts`'s existing pattern) for
worktree lifecycle and shared-ledger races. One deliberately thin live-run layer
(`ATTRACTOR_LIVE=1`, opt-in, not CI) for the real subprocess fd/process ceiling only — the one
piece of NFR-7's three-layer claim no CI environment here reliably reproduces; Layers 1 and 2
are **not** thin and are not eligible to be treated as such.

**Mutation-check flag, highest priority, same posture as Phase 1's — five rows, not one.** An
earlier draft of this paragraph named a single row and folded two distinct mutants into it. The
architecture's own Test strategy actually flags five separately mutation-checked rows across
four work items:

1. *(item F)* "Branch reaching EXIT is treated as a dead end, not a `RunResult` return" — a
   mutant that lets `runBranch` fall through to the main loop's own EXIT-handling block must
   turn this test red.
2. *(item C/F)* "A branch that hits the shared step cap ends with FAIL, not a hang" — a mutant
   that reverts the shared `stepCount` to a per-loop-local counter must **hang** this test, not
   merely fail an assertion (the earlier draft attributed this mutant to row 3 below; the
   architecture ties it to this row instead).
3. *(item C/F)* "`executeNodeStep()` is genuinely one implementation, not two" — the same
   fixture graph run once through `run()`'s loop and once through `runBranch` (`stopAt` set past
   the graph's natural end) must produce an identical `path`/`attempts`/checkpoint-content shape.
4. *(item H)* "Context merge-back, collision" — a mutant that merges in completion order instead
   of branch-declaration order must turn this red; unwritable without `GatedBackend` driving
   completion out of declaration order (see the `GatedBackend` correction above) — a plain unit
   test against synchronously-resolving branches cannot distinguish the two orderings.
5. *(item B)* "Worktree operations no longer block sibling branches" — a mutant that reverts
   `git()` to `execFileSync` must turn this red by making a `GatedBackend`-held sibling branch's
   release observably delayed; this is the row that actually proves ADR-011's fix, not merely
   its type signature (three of these five rows are unwritable without `GatedBackend`).

Every ERROR-severity lint rule (PAR-001, PAR-004) additionally needs a test that fails red
against the *pre-fix* code — per this codebase's own established standard (ADR-005's anchor-test
convention).

**Cut list — dropped first if late, in this order:**
1. Live-run Layer 3 (`ATTRACTOR_LIVE=1`, item J) — already deliberately out of CI; slipping past
   this phase's ship date costs nothing, since Layers 1–2 (fully automated) already prove the
   mechanical ceiling claim.
2. Worktree-name-collision integration test (item J, reclassified from Spike 10) — ships as a
   manual runbook instead if time-constrained, backfilled as automated later; rated low
   likelihood in the architecture's own Risks table.
3. Skill/README authoring-guidance callouts — uncommitted-file-invisible-to-isolated-branches
   caveat; `maxSteps` sizing guidance once `PARALLEL` competes for the shared 500-step budget —
   doc-only, same fast-follow class as Phase 1's own SKILL.md cut. **Excludes** the
   "a branch reaching EXIT never stops the whole pipeline" caveat: architecture.md's F2-residual
   amendment calls that one a **must**, not a nice-to-have doc note, and it is moved to "Not
   eligible for this cut list" below.
4. PAR-003 (item H's declared-`outputs=` collision WARNING) — its runtime complement
   (`mergeBranchContext`'s `node.parallel.context_collision` log) already fires regardless;
   cutting PAR-003 moves a collision's discovery from lint-time to run-time, not from visible to
   silent.
5. The fifth-pass tied-full-common-descendant fixtures for PAR-004 (item E) — cut last, and only
   with the same explicit written acknowledgment Phase 1's cut #3 modeled: this reopens a real,
   previously-found gap (the F3 residual) rather than narrowing an already-safe rule, so cutting
   it means shipping PAR-004 in its fourth-pass (subset-only) form and filing the fifth-pass
   broadening as a tracked fast-follow, not a silent drop.

**Not eligible for this cut list at any position:** item A's two Solution Architect decisions,
the `executeNodeStep` extraction (item C), the worktree async conversion (item B), PAR-001's and
PAR-004's core (subset) case, the merge-back happy-path/collision/FAIL-branch-exclusion tests
(item H), the concurrency suite's ceiling-enforcement/shared-ledger/branch-throws/checkpoint-
isolation rows (item J, minus the name-collision row already cut above), and — moved here from
cut-list item 3 above — the "a branch reaching EXIT never stops the whole pipeline" skill/
authoring-guidance caveat (item G): architecture.md's F2-residual amendment names this the one
**must** among Phase 5's doc-only mitigations, its stated reason being that the alternative is
exactly the silent-degradation class `AGENTS.md`'s own doctrine exists to catch (a WARNING an
author can ignore, followed by quiet non-effect at runtime, no crash, no visible sign). Cutting
it would ship that named hazard with no documented warning at all, not merely defer a
nice-to-have. **Add, explicitly, three rows an earlier draft of this list did not separately
protect — each singled out in the
architecture's own Test-strategy Notes column in stronger language than an ordinary row gets:**
the exact-F1-finding reproduction (item H — three branches, one shared key, asserting the THIRD
declared branch wins and exactly two collision events log; architecture's own words: "the row a
check of F1 coverage exists to demand," warning an N-way-reduce off-by-one could pass the
two-branch collision test above while failing this one); PAR-005's WARNING-does-not-halt-the-run
row (item G — "the row the fifth-pass re-verification exists to demand," written specifically so
a future reader cannot assert the opposite behavior and have it pass); and the
`ENGINE_MANAGED_KEYS` bare-list-only filter row (item H — confirming `tool.`-prefixed keys ARE
merged while `current_node`/`outcome`/`preferred_label` are NOT, a distinction the architecture
calls "subtle enough to regress silently without a test naming it directly"). These, plus the
two newly-mapped retry rows (item F's retry-target-outside-branch, item I's
retry/partial-completion-at-convergence — see the Verification mapping above), are the
load-bearing correctness guarantees four rounds of adversarial review (feature-critic F1–F7,
then an independent fifth-pass re-verification) exist to close; cutting any of them ships a
known, already-named hazard, not an unproven one.

### Phase 6: FR-13-16 — S7 authoring skill / TS-library packaging

**2026-08-10: Phase 6 is planned and scoped, deprioritization explicitly overridden.**
The "Blocked by" reason in the table below (the Product Owner deprioritization,
contingent on Phase 2 proving the channels design) was **confirmed still true**, not
assumed stale, before this phase was picked up — `Handler.HUMAN` is still unregistered
(`grep -rn "Handler.HUMAN" engine/src/` returns zero hits in `defaultHandlers()`), so
Phase 2 has not, in fact, proven the channels design yet. The project owner directed
building Phase 6 anyway, in this session — see
[ADR-015](decisions/ADR-015-s7-deprioritization-override.md) for the full record. This
is an explicit, recorded override, not new evidence that the original deprioritization
reasoning was wrong: P-2 still needs none of this, and Phase 2 is still the
higher-value next slice for that persona. Architecture:
`architecture.md`'s "FR-13–16: S7 authoring skill / TS-library packaging" section.
Stories: `../../stories/README.md`'s Phase 6 section, `p6-01` through `p6-07`, all
`ready`.

| Phase | FRs | Blocked by | Owner | Depends on | Effort |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 6 — Authoring skill | FR-13, FR-14, FR-15, FR-16 | **Overridden 2026-08-10** — was an explicit Product Owner deprioritization (P-2, MVP's only fully-served persona, needs none of it); confirmed still technically true (Phase 2/`Handler.HUMAN` still not shipped) but no longer blocking, per [ADR-015](decisions/ADR-015-s7-deprioritization-override.md) | Solution Architect (planned), Product Owner (override) | No technical dependency on Phase 2 — S7 and the human-gate channel are independent surfaces; the prior "contingent on Phase 2" language described a value-sequencing choice, not a build-order requirement | 7 stories, S/M/M/M/L/M/M — see `stories/README.md` Phase 6 |

## Second prioritization pass — inversion check

FR-18's Product-Owner-scored effort (`S`) matches this Program Manager's independent
feasibility check (`S`, high confidence, same HAND-001/ADR-005 precedent). **No inversion
found.**

FR-17b (Phase 5) now also has a comparable check, for the first time since the PRD's own
pre-architecture estimate. That estimate was a single `L`, scored before any of the six ADRs
existed. Once decomposed against the actual architecture, it is not one `L` but ten items
spanning S through L (item-by-item sizing in Phase 5's own work-item table above) — a single
rolled-up letter for the whole phase would be false precision the per-item table doesn't
support, not a correction to a wrong estimate. Two items (B, "M"; C, "L") are the load-bearing
prerequisites; the true integration item (I) is sized `L` at `medium-low` confidence — the
lowest confidence rating on this board — because, at the time this section was written, it was
the one item still blocked on work item A's two open Solution Architect decisions. **Item A is
now resolved (ADR-013, 2026-08-08);** item I's own confidence should be revisited once its
implementation starts against the resolved decisions rather than carried forward at
`medium-low` by default. Every other item's size/confidence pair is a genuine independent
check against the architecture's own line-count and call-site citations, not a restatement of
the PRD's guess. No comparable check exists for Phases 2, 3, 4, or 6 — none has an architecture
pass yet.

## Critical path

Phase 1's own path is short and deliberately low-risk, not the program's real one:

```
ADR-006 (scope + citation fixes) → predecessor-edge helper → HITL-003 lint block → fixtures/tests
```

Phase 5's own path is long precisely because the architecture is real — ten items, only one
of which (item A) is a decision rather than code. As a dependency list, not a box diagram
(five items wide enough to make ASCII arrows misleading rather than clarifying):

- **No predecessor — start immediately, in parallel:** A (2 SA decisions), B (worktree async),
  C (`executeNodeStep`), D (cwd plumbing), E (convergence-model lint).
- **F** (`runBranch` seam) depends on C alone.
- **G** (PAR-005) depends on E and F.
- **H** (merge-back + PAR-003) depends on F alone.
- **I** (`ParallelHandler`, the integration point) depends on A, B, D, E, F, and H —
  everything except G and J.
- **J** (concurrency test infrastructure) depends on I alone — **with two exceptions, added by
  the Phase 5 Verification mapping above:** the `GatedBackend` test double itself has no
  predecessor and belongs in the "start immediately" group, because items B, F, and H each need
  it for their own non-decorative tests before I exists; and the worktree branch-name-collision
  test depends on B alone (real `git` + `Promise.all` in the test's own code, nothing from
  `ParallelHandler`). Only J's other four rows (ceiling enforcement, real-subprocess ceiling,
  shared-ledger race, checkpoint isolation) actually need I.

**The program's actual critical path ran through decision-making, not code — this was true within
Phase 5 as much as across the whole board.** Open Question 9 (FR-9a/FR-9b, Phase 3) is now
**RESOLVED 2026-08-09** (ADR-014), the same way item A's two decisions inside Phase 5 were
resolved (ADR-013) — both were the same shape of risk, and both are now closed.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Open Question 9 decision (FR-9a vs FR-9b) | Product Owner + Solution Architect | Before Phase 3 can be sized | **Resolved 2026-08-09** — [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md), FR-9b (`GATE-002`) | N/A |
| Open Question 7 decision (embedder WARNING visibility) | Solution Architect | Before Phase 4, and before Phase 1's FR-12 caveat can be closed | Open | Phase 1's WARNING stays invisible on the embedded-`Engine` path with no committed date |
| Two Solution Architect decisions inside the FR-17b architecture itself — component-node FAIL routing and branch-rejection handling | Solution Architect | Before Phase 5's item I (`ParallelHandler`) can be implemented, and before the "Component-node FAIL routing" and "Branch throws mid-flight" test rows can be written | **Resolved 2026-08-08 — [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md).** A(a): convergence-node jump unconditional on SUCCESS/PARTIAL (structurally forced), ordinary §3.7 retry-target/dead-end ladder on FAIL. A(b): per-branch try/catch/finally converting any thrown exception to that branch's own FAIL `Outcome`, covering worktree creation through removal, not just the `runBranch` call; `Promise.all` unchanged | Items B–H (7 of Phase 5's 10 work items) were unaffected either way; item I and its two dependent test rows ("Component-node FAIL routing", "Branch throws mid-flight") can now be implemented and written against a settled contract. Item C's exit criteria also need a small correction — see item C's own row |
| Architecture pass for the resolved channels design (`agent`/`CommandChannel`, `GateContext`/`selectEdge`) | Solution Architect | Before Phase 2 can be sized | Not scheduled | Phase 2 stays "named, not planned" indefinitely even though its product question is resolved |
| **Phase 5, F2-residual scope call** — should "stop the whole pipeline from inside a branch" become a real feature (new cancellation plumbing through `ParallelHandler`'s dispatch), or does a branch reaching EXIT stay an ordinary per-branch dead end permanently, as it ships this slice | Product Owner | Not a blocker to Phase 5 shipping — item G ships either way, with the must-ship skill caveat as its guardrail — but stays open indefinitely until scheduled | Open — architecture.md's own words: "a scope question for Product Owner, not decided here" | No functional slip; the risk is silent misunderstanding, not a missed date — an author keeps expecting EXIT-from-a-branch to halt the run until the caveat is written and read, or the feature is built |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1 | 0 | Shipped |
| FR-2 | 0 | Shipped |
| FR-3 | 0 | Shipped |
| FR-4 | 0 | Shipped |
| FR-5 | 2 | Named, not planned — architecture-pass gap, not an open question |
| FR-6 | 2 | Named, not planned — same gap |
| FR-7 | 2 | Named, not planned — same gap |
| FR-8 | 2 | Named, not planned — `agent` sub-slice also depends on Phase 1 |
| FR-9a | 3 | **Rejected 2026-08-09** — ADR-014, Open Question 9 |
| FR-9b | 3 | **Done 2026-08-09** — ADR-014 (`GATE-002`), story `p3-01` |
| FR-10 | 0 | Shipped |
| FR-11 | 0 | Shipped |
| FR-12 | 4 | Named, not planned — Open Question 7 |
| FR-13 | 6 | Named, deprioritized — no open question, PO scope call |
| FR-14 | 6 | Named, deprioritized |
| FR-15 | 6 | Named, deprioritized — rests on `assumed`-grade P-4 evidence |
| FR-16 | 6 | Named, deprioritized |
| FR-17a | 0 | Shipped |
| FR-17b | 5 | Fully planned this phase |
| FR-18 | 1 | Fully planned this phase |

No `FR-n` lands in no phase.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| PRD's "Residual Risk section" citation resolves to nothing | confirmed today | medium — breaks the audit trail for anyone tracing FR-18's known blind spots | ADR-006 writes the section or repoints the citation, inside Phase 1 | implementer |
| CODERGEN-scope reading picked implicitly, overturned mid-phase | medium | low-medium — rework of fixtures, not of the rule's core logic | Resolve as ADR-006's opening decision, before fixtures | implementer |
| Named residual gaps (multi-hop, `Handler.TOOL`-without-`outputs=`) never revisited | high if untracked | medium — the self-report gap is treated as closed on paper when it isn't | Open Questions row added in ADR-006, owner assigned | Product Owner / Solution Architect |
| HITL-003's WARNING invisible on embedded-`Engine` path, read as uniformly mitigating | medium | medium — false confidence for the `agent` channel's likeliest unattended usage | State the FR-12 dependency explicitly in the rule's doc and in this roadmap (done above); do not close Phase 1 as if it were resolved | implementer / Solution Architect |
| Open Question 9 stays unowned by any stage indefinitely | **Resolved 2026-08-09** — ADR-014, no longer a risk | N/A | N/A | Product Owner |
| Phase 2 mislabeled as "blocked on open questions" when it is really an unstarted architecture pass | medium | low-medium — the wrong owner gets pinged, or nobody schedules the actual missing step | Corrected explicitly in this document's Sequencing rationale and Phase 2 entry | Program Manager (this document) |
| Locked attribute names (`human.channel`, `human.context`, design doc §5) diverge once Phase 2's implementation actually lands | low — names are a resolved 5/5-converged decision, not open prose | medium — Phase 1's fixtures would need updating | ADR-006 cites design doc §5 explicitly with a note to revisit if Phase 2 diverges | implementer |
| **Phase 5, RESOLVED 2026-08-08.** Component-node FAIL routing: the architecture's own text gave two different answers for what happens when a `PARALLEL` node's join outcome is FAIL | was confirmed present in the design as written | was high — whichever is right, the first author whose fan-out actually fails hits the untested path, and a fan-out failing is the entire reason a zero-success-checking join policy exists | **Resolved by [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md):** the convergence-node jump is unconditional only on SUCCESS/PARTIAL — the only structurally reachable continuation; FAIL routes through the ordinary §3.7 `retry_target`/`fallback_retry_target`/dead-end ladder, matching `AGENTS.md`'s non-tradeable Fail-fast-on-FAIL doctrine. Item I and the "Component-node FAIL routing" test row can now be implemented against a settled contract; item C's exit criteria gained a small correction as a consequence (see item C's own row in the work-item table) | Solution Architect (resolved) — implementer for item I/C |
| **Phase 5, RESOLVED 2026-08-08.** `ParallelHandler`'s branch dispatch is `Promise.all`-based; if one branch's `runBranch` call rejected (not a FAIL `Outcome` — an actual throw, e.g. a worktree name collision) rather than resolving, `Promise.all` would abandon the still-pending siblings — their settlement, worktree removal, and branch checkpoint all orphaned, and the rejection escaping `Engine.run()`'s public API uncaught | was medium — worktree creation failing on a name collision, or a backend crash, are both plausible sources | was high — orphaned worktrees and an engine that can throw instead of returning a `RunResult` are the "silent degradation" class `AGENTS.md`'s doctrine forbids elsewhere in this design | **Resolved by [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md):** each branch's entire dispatch (worktree creation through removal, not just the `runBranch` call) is wrapped in one try/catch/finally converting any thrown exception to that branch's own FAIL `Outcome`, before it can reach `Promise.all`; the aggregation primitive itself stays `Promise.all` — nothing switches to `Promise.allSettled`, since nothing can reject once the catch is in place. Implemented in item I, verified by item J's branch-throws test | implementer (item I/J) |
| **Phase 5.** A pipeline stage before a `PARALLEL` node produces a *file* (not a context key) that isolated branches then can't see, because a branch worktree sees only the parent's last commit, not its uncommitted work (empirically verified during architecture, Spike 7) | medium — nothing stops a file-producing `TOOL` node upstream of a fan-out | medium — silent wrong-input, not a crash; a branch's own work is based on stale/absent state | Skill/authoring guidance (cut-list item 3): a graph author must commit before fanning out, or set `isolate="false"`; a future WARNING lint rule is a natural extension, not required this slice | Solution Architect / skill author |
| **Phase 5, F2 residual.** An author who wires a branch straight to the graph's real EXIT node, intending "if this branch alone satisfies the goal, stop the whole pipeline here," gets none of that: PAR-005 fires only a WARNING (ignorable), and at runtime the branch simply dead-ends — the join policy folds it in as an ordinary leaf outcome and the run proceeds. Whether this should become a real feature is an open Product Owner scope call, not decided this slice (see Dependencies outside our control) | medium — architecture.md's own words: "a plausible, even obvious, thing an author reaching for a shared EXIT node would expect to work" | high — architecture.md's own words: "this is the silent-degradation class `AGENTS.md`'s own doctrine exists to catch" | Architecture.md states as a **must** that skill/authoring guidance say explicitly a branch reaching EXIT never stops the run (item G; not eligible for Phase 5's cut list). The underlying scope question — should this become a real feature — stays open until Product Owner decides | Product Owner (scope call) / Solution Architect (skill copy) |
| **Phase 5.** `this.stepCount` (item C, ADR-012) is one counter shared across the main path and every concurrently-running branch, by design — a legitimately large, correctly-terminating fan-out now competes for the same 500-step budget a sequential pipeline would have had entirely to itself | high — this is the ordinary, intended shape of a busy fan-out, not an edge case | medium — not a correctness bug (the FAIL-on-stepcap path is well-formed), but a real behavior change with no corresponding operator-facing warning | `EngineOptions.maxSteps` is already a caller-supplied override, not new code; document in skill/authoring guidance that a `PARALLEL` graph should size `maxSteps` to its total node-visit volume summed across every branch | Solution Architect / skill author |
| **Phase 5.** A custom embedder-supplied `Backend` (item D, ADR-008) ignores the new `cwd` parameter and silently keeps using its own bound cwd for every branch | medium | medium — isolated branches share a filesystem after all, quietly reopening the exact race Open Question 4 exists to prevent | `ClaudeCodeBackend` (the only shipped implementation) is fixed; the contract change for third-party backends is documented explicitly, not only in a type signature | implementer |
| **Phase 5, RESOLVED (item B shipped).** `execFile`'s promisified rejection shape (item B, ADR-011) — confirmed to match `execFileSync`'s thrown-`Error` shape closely enough that `worktree.test.ts`'s message-matching assertions keep passing; `worktree.ts`'s own Spike 12 code comment states this as settled fact, and the full suite (613 tests) passes today | was medium | was medium | **Resolved:** Spike 12 closed this as part of item B; confirmed, not merely expected | implementer (done) |
| **Phase 5, sprint 3 review finding (R-sprint3-1), RESOLVED 2026-08-08.** When every branch of a fan-out fails, the combined result only reported a count ("all N failed"), not any branch's own reason why — found by a real persona walking the actual CLI, not a test | was medium | was medium — an operator had to go read internal logs to find out what actually went wrong | **Fixed:** the failed-branch join outcome now names each failed branch by its real node id and its own failure reason (`handlers/parallel.ts`, `applyDefaultJoinPolicy`) | Solution Architect (implemented directly, no design call needed — appending each branch's own reason was the obviously correct shape) |
| **Phase 5, sprint 3 review finding (R-sprint3-2), RESOLVED 2026-08-08.** The per-branch on/off isolation setting (`isolate="false"`) and its git-repository requirement were undocumented | was high | was medium | **Fixed:** documented in `README.md`'s new "Parallel fan-out" section | skill/doc author |
| **Phase 5, sprint 3 review finding (R-sprint3-3), RESOLVED 2026-08-08, pre-existing.** README's shape table paired the fan-out shape with a still-unusable fan-in shape (`tripleoctagon`) | was high | was low-medium | **Fixed:** table split into two rows with each shape's real, current status | skill/doc author |
| **Phase 5, sprint 3 review finding (R-sprint3-4), RESOLVED 2026-08-08.** An isolated branch's git branch (not its working files, which are cleaned up correctly) is kept forever, undocumented | was high | was low | **Fixed:** documented as intentional in `README.md`, with the prune command an operator needs | skill/doc author |

**Carried forward, not separately tracked (low × low) — three architecture.md risks.** Omitted
from the table above by deliberate roadmap-altitude judgment, not oversight; none changes any
work item's scope or exit criteria:
- Concurrent branches racing on the engine's shared `gateOutcomes`/`nodeFailures`/`failedOutputs`
  bookkeeping maps can scramble `nodeFailures`' documented first-failure order (cosmetic ordering
  only, not a correctness bug — Spike 8's own finding).
- `findConvergenceNode`'s condition-blind static reachability can cause a false-positive PAR-001
  refusal on a graph that would actually run fine (author must restructure; no double-dispatch
  slips through undetected).
- PAR-004 inherits that same over-approximation (F3-residual amendment) — same false-positive-
  only class, not a new failure mode.

Full entries: architecture.md's Risks (FR-17b additions) section.

## Buffer

No calendar exists to buffer against (see Constraints). The structural buffer here is that
**Phase 1 is deliberately over-scoped on process** (ADR-006, an Open Questions row, a doc
caveat) relative to its code (one lint rule, one helper): if any named gap runs long, the cut
list above absorbs it without touching the lint rule's own correctness or test coverage.

## Terms this roadmap needed and the glossary does not yet have

`.delivery/glossary.md` exists (seeded 2026-08-07) and Phase 5 above uses its five seeded terms
correctly, but it does not yet define these two, both needed by Phase 1. Proposed, not coined
new — reusing the Feature Critic's own proposal rather than adding a fifth synonym to the four
already in use (`self-report hazard`/`risk`/`evidentiary gap`/`shapes`):

- **self-report gap** — a human- or agent-facing approval gate whose displayed evidence
  traces back to the very node the gate exists to check, so approval verifies nothing
  independent of the work being approved. Referent: FR-18/HITL-003, `carry-forward.md` Plan 4.
- **direct predecessor** — a node with a single edge into the gate node being checked, as
  opposed to a multi-hop chain of intermediate nodes. Referent: FR-18's own text ("single-hop,
  structurally-provable direct predecessor"), needed because the term is coined once, in the
  FR itself, with no definition anywhere else.
