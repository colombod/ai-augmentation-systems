# Story index — plugins/attractor

> Produced by `/delivery:stories`, decomposing `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/roadmap.md`.
> Roadmap: `../initiatives/spec-conformance-mvp/roadmap.md` · PRD: `../initiatives/spec-conformance-mvp/prd.md` ·
> Architecture: `../initiatives/spec-conformance-mvp/architecture.md` · Glossary: `../glossary.md`.
> Phase 1 stories below reuse the two terms the roadmap proposed
> (**self-report gap**, **direct predecessor**); Phase 5 stories use `../glossary.md`'s five
> terms (**branch**, **branch worktree**, **convergence node**, **join policy**, **context
> merge-back**) exactly, coining nothing new.

## Phase 1 — FR-18 (HITL-003 self-report guard)

| ID | Title | Status | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [p1-01](p1-01-hitl-003-self-report-guard.md) | Add HITL-003 — warn on an agent-inclusive human gate self-reporting from its direct predecessor | **done** | FR-18 | none | S |

**Decomposition note:** the roadmap's Phase 1 work-item table lists five items (ADR-006, a
`graph.ts` predecessor helper, the `lint.ts` rule, fixtures/tests, a README caveat) bound by a
hard sequencing chain — ADR-006 must resolve the CODERGEN-vs-TOOL scope reading before any
fixture can be written, and each later item has no independent, observable behavior of its own
(an ADR alone ships no behavior; a helper alone has no caller; a rule alone has no tests). All
five are sized `S` with no PM/PO estimate inversion found. Decomposed as **one story**, not five,
because splitting inseparable steps of one sitting into separate files would misrepresent a single
unit of work as independently pickable units it is not. This mirrors the ADR-005/HAND-001
precedent already shipped in Phase 0 (also one PR for helper + rule + tests).

**Coverage check:** FR-18 is Phase 1's only requirement (per the roadmap's Requirement coverage
table) and is fully covered by p1-01. No acceptance criterion in Phase 1 is left uncovered.

## Readiness

**p1-01 — done.** Shipped: `directPredecessor` (`graph.ts`), the `HITL-003` lint rule
(`lint.ts`), ADR-006, and 24 test references in `lint.test.ts` — confirmed directly against the
current code, not merely the story's own checked acceptance criteria. This status field was
stale (`ready`) for a time after implementation actually shipped; corrected 2026-08-09.

No draft stories this phase.

## Phase 2 — FR-5-8 (human-gate core, S2)

> Architecture: `../initiatives/spec-conformance-mvp/architecture.md`'s "FR-5–8: human-gate
> channels (S2)" section (appended, not a rewrite of the sections above it). Decisions:
> [ADR-020](../decisions/ADR-020-channel-module-placement.md) through
> [ADR-026](../decisions/ADR-026-command-channel-shell-quoting.md). Not blocked by an open
> product question — Open Questions 1/2 were resolved 2026-08-06; what blocked this phase was
> an unstarted architecture pass, now done. Glossary terms used exactly as defined
> (`../glossary.md`): **human gate** (never interchangeable with **goal gate**), **channel**,
> **channel chain**, **hop**, **viable**.

| ID | Title | Status | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [p2-01](p2-01-shell-helper-relocation.md) | Relocate `runShell`/`lastNonEmptyLine` to `core/shell.ts` (ADR-020) | **done** | FR-8 (enabling) | none | S |
| [p2-02](p2-02-channel-core-contracts.md) | `Channel`, `HumanGateContext`, `ChannelAnswer`, `ChannelRunContext`, `isChannelViable`/`whyNotViable` | **done** | FR-8 | none | S |
| [p2-03](p2-03-human-channel.md) | `HumanChannel` — realizes ADR-002 (ADR-023: no real-answer path this slice) | **done** | FR-5, FR-6 | p2-02 | S |
| [p2-04](p2-04-agent-channel.md) | `AgentChannel` — self-enforcing two-key `claude -p` proxy (ADR-022) | **done** | FR-8 | p2-02 | M |
| [p2-05](p2-05-command-channel.md) | `CommandChannel` — shell-quoted substitution (ADR-026) | **done** | FR-8 | p2-01, p2-02 | M |
| [p2-06](p2-06-channel-registry-preflight.md) | `defaultChannels()` + `preflightHumanGates()` (ADR-021) | **done** | FR-5, FR-6, FR-8 | p2-03, p2-04 | M |
| [p2-07](p2-07-human-gate-handler.md) | `HumanGateHandler` chain-walk logic (ADR-025) | **done** | FR-5, FR-6, FR-8 | p2-02 | L |
| [p2-08](p2-08-handler-human-registration.md) | Register `Handler.HUMAN` — `dot/graph.ts` + `core/engine.ts`, migration repoints (ADR-024) | **done** | FR-5, FR-6, FR-7, FR-8 | p2-06, p2-07 | M |
| [p2-09](p2-09-cli-wiring-exports.md) | CLI wiring (`--allow-agent-gates`, `--channel`) + `index.ts` exports | **done** | FR-8 | p2-08 | M |
| [p2-10](p2-10-fr5-real-subprocess-verification.md) | Real-subprocess non-TTY fail-fast test (FR-5); full HITL-001 regression re-run (FR-7) | **done** | FR-5, FR-7 | p2-09 | S |

**Decomposition note.** Ten dependency-ordered stories, following this phase's own natural
shape: build three independent channel implementations against one shared contract, then
integrate — directly analogous to Phase 5's "two independent prerequisite refactors, three
independent additive pieces, then one integration point." p2-01 and p2-02 are the two roots and
are mutually independent (disjoint files: `core/shell.ts` vs. new `channels/`) — both start
immediately, in parallel. p2-02 fans out to three genuinely parallel consumers: p2-03, p2-04,
and p2-07 all depend only on p2-02, not on each other. p2-05 depends on both p2-01 (needs
`core/shell.ts`'s spawn primitive) and p2-02. p2-06 depends on p2-03 and p2-04 (it composes real
`HumanChannel`+`AgentChannel` instances) but **not** p2-05 — `CommandChannel` is never
constructed inside `defaultChannels()`; it is layered on by `cli.ts` (p2-09) directly, so p2-05
and p2-06 proceed in full parallel once p2-01/p2-02 land. p2-08 is the true integration point —
the only story that makes the phase's behavior live and reachable — and is deliberately last
among the implementation stories, gated on both p2-06 (needs `defaultChannels`/
`preflightHumanGates` as `core/engine.ts`'s new default values) and p2-07 (needs the handler
class itself); it also carries the two migration test repoints, landing in the same commit as
the registration edit that necessitates them, so the suite never sits red between stories. p2-09
depends on p2-08 (`EngineOptions.channels`/`channelRunContext` must exist). p2-10 depends on
p2-09 specifically (needs the built CLI to reflect the real flag wiring, not just the earlier
registration).

No dependency on Phases 1, 5, or 6 — `HITL-003` (Phase 1) and `Handler.PARALLEL` (Phase 5) are
both already shipped, and ADR-021's own analysis confirms `reachableFrom` needs no
`Handler.PARALLEL`-specific logic to already be reachability-correct across a parallel branch (a
`component` node's branches are ordinary outgoing edges). Phase 2's `agent`-channel sub-slice has
no dependency on Phase 1 either, despite `HITL-003`'s own self-report-guard rationale
referencing the `agent` channel — `HITL-003` is a lint-time WARNING already shipped and
unaffected by whether `Handler.HUMAN` is registered.

**Coverage check.** FR-5, FR-6, FR-7, FR-8 (Phase 2's full requirement set per the PRD) are each
covered by at least one story: FR-5/FR-6 primarily by p2-03, p2-06, p2-07, p2-08, p2-10; FR-7 by
p2-08 (repoints) and p2-10 (final confirmation); FR-8 by every story — it is this phase's
overarching requirement, satisfiable only via `agent` (p2-04) or `CommandChannel` (p2-05), never
`human` alone (ADR-023, stated explicitly in p2-03/p2-10's own text so no story or reader
mistakes the default `human.channel="human"` for a complete answer-delivery path). Every
Test-strategy row in the architecture's FR-5–8 section is owned by exactly one story — see the
architecture's own section for the full mapping. `FR-18`/`HITL-003` (self-report guard) is out
of scope for Phase 2 — already shipped in Phase 1.

## Readiness — Phase 2

**p2-01 through p2-10 — all `done`. Phase 2 (FR-5-8, human-gate core) is complete,** implemented
with TDD (red test first, watched fail, then implemented) in dependency order, one commit per
story. 731 tests, 729 pass, 2 skipped, 0 fail as of the final commit. `Handler.HUMAN` registration
(p2-08) was the load-bearing piece the roadmap named — it's live: `dot/graph.ts`'s
`UNREGISTERED_HANDLER_KINDS` no longer includes it, `core/engine.ts`'s `defaultHandlers()` returns
a working `HumanGateHandler`. Real findings surfaced during implementation, not just planning: a
third pre-existing test (beyond the two the architecture named) turned out to share the same
"Handler.HUMAN is unregistered" stale premise (p2-08); p2-07's `HumanGateHandler` didn't actually
call `substitute()` on its resolved label until p2-08's own `SUBSTITUTABLE_ATTRS` wiring exposed
the gap; p2-10's nested `node --test` needed `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` stripped
from its child env to avoid Node's own recursion guard. See each story's own Implementation notes
for the full account.

**Pre-implementation readiness (unchanged from when stories were written):** every story's
acceptance criteria were falsifiable, file paths verified against the repo (existing files and
line citations spot-checked directly, not trusted from the architecture alone), dependencies
stated, test approach present with the real `node --test` command for this repo. None held back
to `draft`.

## Phase 5 — FR-17b (parallel fan-out, `Handler.PARALLEL`)

Roadmap's Phase 5 decomposes into ten dependency-ordered work items, A–J. Item A is not
represented by a story below (a decision, not implementation work); item J is split across p5-08
(the rows that fit its own vertical slice) and p5-09 (the two verification-only rows that don't)
— see **Not decomposed** at the end of this section.

| ID | Title | Status | Work item | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| [p5-01](p5-01-worktree-async-conversion.md) | Convert `run/worktree.ts` to async and prove branches no longer block each other | **done** | B | FR-17b, NFR-7 | none | M |
| [p5-02](p5-02-execute-node-step-extraction.md) | Extract `Engine#executeNodeStep` as the one shared per-node step implementation | **done** | C | FR-17b, NFR-1 | none | L |
| [p5-03](p5-03-backend-cwd-plumbing.md) | Plumb a per-call `cwd` through `Backend.run()` | **done** | D | FR-17b, NFR-4 | none | S |
| [p5-04](p5-04-convergence-lint-rules.md) | `findConvergenceNode`/`findPartialReconvergence` + PAR-001/PAR-002/PAR-004 | **done** | E | FR-17b | none | M |
| [p5-05](p5-05-runbranch-seam.md) | `HandlerCtx.runBranch` seam + `Engine#runBranch` | **done** | F | FR-17b, NFR-1, NFR-4 | p5-02, p5-01 | M |
| [p5-06](p5-06-par-005-branch-exit-warning.md) | PAR-005 — branch reaches EXIT before its convergence node | **done** | G | FR-17b | p5-04, p5-05 | S |
| [p5-07](p5-07-context-merge-back.md) | `mergeBranchContext` + PAR-003 | **done** | H | FR-17b | p5-05, p5-01 | M |
| [p5-08](p5-08-parallel-handler-integration.md) | `ParallelHandler` registration — the integration point | **done** | I | FR-17b, NFR-7 | p5-01, p5-03, p5-04, p5-05, p5-07 | L |
| [p5-09](p5-09-concurrency-verification-real-parallelhandler.md) | Checkpoint isolation + opt-in live-subprocess ceiling, proven against the real `ParallelHandler` | **done** | J (remainder) | NFR-7 | p5-08 | S |

**Decomposition note.** The roadmap's own dependency analysis (Critical path, Second
prioritization pass) already establishes that seven of the ten work items (B–H) do not depend
on either of item A's open Solution Architect decisions — each maps to real, independently
testable code, so each got its own story rather than being bundled the way Phase 1's five
sub-items were (those had no independent, observable behavior of their own; B–H each do). Two
corrections from the roadmap's own review pass are load-bearing and reflected above, not just
noted: `GatedBackend` (needed by p5-01, p5-05, p5-07 for non-decorative "forced overlap" tests)
is built inside p5-01, the earliest point any story needs it, rather than deferred to an
item-J-only story; and the worktree-name-collision test ships inside p5-01 rather than waiting
behind item I.

**Not decomposed:**

- **Item A** (two Solution Architect decisions: component-node FAIL routing; `Promise.all` vs.
  `allSettled` for branch rejection) was not implementation work — it was a design ruling this
  role does not have standing to make. **Resolved 2026-08-08**, [ADR-013](../decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md); p5-08 consumed the answer and moved to
  `ready` (see Readiness below). Still not its own story — a decision was never story-shaped.
- **Item J** is now split. Three of its five originally-listed rows are covered elsewhere:
  `GatedBackend` and the worktree-name-collision test shipped inside p5-01; the shared-ledger
  race property is substantively demonstrated by p5-05's own "goal-gate inside a branch blocks
  the real exit" test; ceiling enforcement and branch-throws mid-flight (unblocked by ADR-013)
  are p5-08's own acceptance criteria. The remaining two rows — checkpoint isolation under a
  real `ParallelHandler` dispatch, and the opt-in `ATTRACTOR_LIVE=1` real-subprocess ceiling —
  need the real handler p5-08 ships and don't fit p5-08's own vertical slice
  (register/fan-out/join/merge-back is capability; these two are verification), so they got
  their own story, **p5-09**, `depends_on: [p5-08]`.

**Coverage check.** FR-17b is Phase 5's only requirement (roadmap's Requirement coverage table).
Every Test-strategy row the roadmap's own verification mapping assigns to items B–H is covered
by the corresponding story's acceptance criteria, including the five mutation-checked rows, the
exact-F1-reproduction row, and the two "newly mapped" gap rows (retry-target-outside-branch →
p5-05; retry/partial-completion-at-convergence → p5-08). The two rows the architecture once
marked "cannot be written yet" (component-node FAIL routing; branch-throws mid-flight) are now
real, falsifiable acceptance criteria inside p5-08, unblocked by ADR-013 — not silently dropped,
and no longer `BLOCKED`.

## Readiness — Phase 5

**p5-01 through p5-09 — all done. Phase 5 is complete.** p5-01 through p5-07 shipped in sprint 2
(`.delivery/sprints/2-parallel-fanin.md`); p5-08 and p5-09 shipped in sprint 3
(`.delivery/sprints/3-parallel-handler.md`). Every status field below was re-verified directly
against the current code (not trusted from any story's own checked-off acceptance criteria) on
2026-08-09: `createWorktree`, `executeNodeStep`, per-call `cwd`, `findConvergenceNode`, `runBranch`,
`PAR-005`, `mergeBranchContext`, `ParallelHandler` (registered), and the checkpoint-isolation and
opt-in live-ceiling tests are all present and passing. Several of these files' own `status:`
frontmatter had drifted to stale `ready` labels after implementation actually shipped — a real
bug in this project's own tracking, not just a formality, since a reader trusting the label alone
would wrongly conclude work remained. Corrected across all seven files this same pass.

**p5-08 — done**, shipped in sprint 3. All 8 acceptance criteria verified met by direct code
reading and test execution, not merely the implementer's own report — including two independent
adversarial review passes, one of which found and led to fixing two real bugs (a
`max_parallel="0"` deadlock; an `EventLog.append` failure escaping `ParallelHandler.execute()`
and rejecting the whole dispatch). See the story's own "Implementation notes" for the full
account.

**p5-09 — done**, shipped in sprint 3. Checkpoint isolation proven against the real
`ParallelHandler`; the opt-in live-subprocess ceiling test is written and correctly gated but not
yet actually run (costs real API calls) — see the story's own "Implementation notes."

## Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)

> **Deprioritization override, recorded not silently acted on.** `prioritization.md`
> deferred this phase behind Stage 3 (human-gate core) — confirmed still unbuilt
> (`Handler.HUMAN` unregistered) at the time this phase was picked up anyway, by
> explicit project-owner direction. See
> [ADR-015](../decisions/ADR-015-s7-deprioritization-override.md) for the full record.
> Architecture: `../initiatives/spec-conformance-mvp/architecture.md`'s
> "FR-13–16: S7 authoring skill / TS-library packaging" section (appended, not a
> rewrite of the sections above it).

| ID | Title | Status | Requirements | Depends on | Size |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [p6-01](p6-01-ts-library-packaging.md) | TS-library packaging — `index.ts` entry point and `package.json` exports | **done** | FR-13 (enabling) | none | S |
| [p6-02](p6-02-dot-and-routing-reference-plus-engine-semantics.md) | Reference material — `dot-reference.md`, `routing-reference.md` (ported+corrected), `engine-semantics.md` (from scratch) | **done** | FR-14, FR-15 | none | M |
| [p6-03](p6-03-pipeline-design-principles-and-patterns.md) | Reference material — `pipeline-design-principles.md`, `pipeline-patterns.md` (ported near-verbatim) | **done** | none (supports FR-13/16) | none | S |
| [p6-04](p6-04-attractor-expert-agent.md) | `attractor-expert` agent — rewritten, engine-specific integration guidance only | **done** | FR-14, FR-15 | p6-02 | M |
| [p6-05](p6-05-attractorify-skill-diagnosis-and-design.md) | `attractorify` skill — diagnosis gate, ask-before-designing, conversational design | **done** | FR-14, FR-15 | p6-02, p6-03, p6-04 | L |
| [p6-06](p6-06-delegated-execution-verification.md) | Delegated execution-verification gate (FR-13) — `verify-run.ts` + Step 4 wiring | **done** | FR-13 | p6-01, p6-05 | M |
| [p6-07](p6-07-worked-examples-executed.md) | Worked examples — ported/adapted, each actually executed on this engine | **done** | FR-16 | p6-01, p6-02, p6-03 | M |

**Decomposition note.** Seven stories, not one: unlike Phase 1's five inseparable
sub-items, each of these maps to independently testable, independently shippable
output — a library entry point, three groups of reference docs with different porting
treatments (ADR-018), an agent definition, a skill definition, a new verification
mechanism, and a set of executed examples. p6-02/p6-03 have no story-level dependency on
each other and can proceed in parallel; p6-04/p6-05/p6-06/p6-07 have a real dependency
chain (an agent/skill can't cite reference material that doesn't exist yet; the
execution-verification gate extends the skill's own Step 4).

**Coverage check.** FR-13 is covered by p6-01 (enabling) and p6-06 (the actual
delegated-verification mechanism). FR-14 is covered by p6-02 (reference material scope),
p6-04 (agent), and p6-05 (skill design guidance) — three places by design, since FR-14
is a constraint on every surface that could recommend a handler, not one piece of code.
FR-15 is covered by p6-02 (routing-reference.md, the FR's primary home), p6-04, and
p6-05, for the same reason. FR-16 is covered by p6-07. No FR in this phase is left
uncovered by any story.

## Readiness — Phase 6

**p6-01 through p6-07 — all done. Phase 6 is complete.** Shipped in implementation
order (p6-01, p6-02, p6-03, p6-04, p6-05, p6-06, p6-07), each with its own commit,
TDD red-then-green where code was involved, and a mutation check for every new
test/doc-consistency script (per `AGENTS.md`'s "mutation-check every new test"
convention, applied to `check-consistency.mjs` and the FR-16 examples test the same way
it applies to engine tests). 663 tests, 661 pass, 2 skipped, 0 fail as of the final
commit. One real gap was found and fixed by actually running the worked examples (not
by inspection): `verify-run.ts`'s CLI wrapper had no `--cwd` flag, unreachable by the
one caller (a delegated subagent) that only sees the CLI — see p6-06 and p6-07's own
Implementation notes for the cross-referenced account.

## Next

Phases 1, 2, 3, 5, and 6 are all done. **Phase 2 (human-gate core, FR-5-8) shipped 2026-08-11** —
architecture, ten stories, sprint 4, and full TDD implementation all landed the same session;
`Handler.HUMAN` is registered and live. Per this phase's own load-bearing consequence: S7's
example-portability exclusions (`08-human-gate.dot`, `10-full-attractor.dot`, `task-runner.dot` —
see `architecture.md`'s Example-portability policy and `skills/attractorify/examples/README.md`)
and FR-14's "six registered handlers" constraint (now seven — `dot-reference.md`, the
`attractor-expert` agent, `attractorify/SKILL.md`) both need a follow-up revisit; neither is
fixed by this phase itself. Phase 4 still needs a scope call before it's story-able (Open
Question 7 — should an embedder observe WARNING-severity diagnostics at all).
