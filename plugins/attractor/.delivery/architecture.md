# Architecture: attractor MVP slice — installability, human-gate blocking, two bug fixes, one lint rule

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist. Reviewed by Feature Critic.
> Status: reviewed · Last updated: 2026-08-08
> PRD: `plugins/attractor/.delivery/prd.md` · Reviews: `plugins/attractor/.delivery/reviews/prd-01.md`
>
> **Path note** (same convention as the PRD): this repo's actual paths are
> `plugins/attractor/.delivery/` and `plugins/attractor/.superpowers/`, not the
> `docs/product/...` the architecture skill's own template defaults to.
>
> **Scope:** designs the FRs unblocked by the PRD's own review — FR-1–4, FR-5–7
> (blocking behavior only, not FR-8), FR-10, FR-11, FR-17a. **2026-08-07: FR-17b is now
> designed too** (Open Questions 3-5 resolved that day — see "FR-17b: parallel fan-out"
> below, appended rather than rewriting the sections above). FR-8, FR-9a/b, FR-12 remain
> undesigned. **2026-08-07, same day: QA Strategist expanded FR-17b's Test strategy and
> Risks** with a concurrency-specific plan (races between branches, worktree cleanup on an
> erroring branch, checkpoint writes racing a still-running branch, retry escaping a branch's
> reachable set) and NFR-7's three measurement layers — appended to those two sections in
> place, nothing else rewritten. **2026-08-08: the self-contradiction this note originally
> flagged (component-node FAIL routing) is resolved, along with the separate branch-rejection
> question — see [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md)
> and the two updated Risks-table rows and the Test-strategy row below.** `p5-08`
> (`ParallelHandler`'s own implementation) is unblocked by this document; it remains separate,
> later work.
>
> **Word budget note:** the template caps this document at 1600 words of prose (tables and
> code exempt). The FR-17b addition below is a genuinely new execution model — this engine's
> first concurrent-traversal feature — grounded in reading amplifier's actual source, one
> empirically-verified branch-worktree fact, and three new interface seams. Total prose is over
> the cap. Recorded here per the template's own instruction, not silently exceeded.
>
> **2026-08-07, fourth pass: adversarial feature-critic review of FR-17b (7 findings)
> resolved.** F1 (no context merge-back — ADR-010, new), F2 (undefined branch-reaches-EXIT
> case — ADR-007 amendment, new PAR-005), F3 (partial reconvergence between branches invisible
> to lint and racy at runtime — ADR-007 amendment, new PAR-004), F4 (`worktree.ts`'s
> synchronous git calls block the event loop under real concurrency — ADR-011, new), F5 (no
> real shared step-cap counter) and F6 (no binding decision on shared-vs-reimplemented
> per-node logic) resolved together as one refactor (ADR-012, new), F7 (terminology pass:
> "branch" now means only the DOT-graph sub-path; the git-isolation sense is "branch worktree"
> throughout — see the new `.delivery/glossary.md`). Every table below (Component structure,
> Interfaces, NFRs, Decisions, Spikes, Migration, Test strategy, Risks) is updated in place to
> stay consistent with these six resolutions; nothing is left as a description-only fix.
>
> **2026-08-07, fifth pass: independent re-verification found 3 residual gaps in the fourth
> pass's own fixes; all three closed here, in place.** F3 residual (serious — a *tied* full
> common descendant, reachable from every branch root at the same shallowest depth as the node
> `findConvergenceNode`'s tie-break actually picked, was invisible to PAR-001 and to the
> original PAR-004's "reachable from 2+ but not all roots" wording): closed by a **lint
> extension**, not a proof of impossibility — `findPartialReconvergence`/PAR-004's own
> definition is broadened to catch a node fully reachable from every root but not selected as
> convergence, on the same footing as the original subset case; see ADR-007's second
> amendment. F2 residual (ADR-007's own stated rationale for PAR-005 being WARNING, not ERROR,
> cited an "early-exit branch... stop the whole pipeline here" pattern that the Decision right
> above it makes structurally impossible — a genuine self-contradiction, not a severity
> mistake): the rationale is corrected to the real reason WARNING is right (ending one branch's
> own traversal early, without affecting siblings, is legitimate; stopping the whole pipeline
> from inside a branch is simply not built this slice, and PAR-005 does not claim otherwise) —
> see ADR-007's corrected F2 amendment and the new Risks row below. F5 residual (the shared
> `this.stepCount` budget from ADR-012 — the right fix for the original F5 finding — has a real,
> previously unnamed consequence: a busy, legitimately-terminating fan-out now competes for one
> 500-step ceiling instead of each branch getting its own): named explicitly in a new Risks row,
> with the existing `EngineOptions.maxSteps` override as the documented relief valve. Two minor
> nits fixed alongside these: a stale "three call sites" count against `worktree.ts`'s five
> actually-cited `cli.ts` line numbers (now five, everywhere this document counts them), and the
> glossary's own worked example for the branch-worktree git-branch name (corrected to match
> `run/worktree.ts`'s real `createWorktree(repoDir, runId)` template string exactly).

## Approach

Five independent changes, each grounded in real file/line citations against the actual
codebase (462 tests, 461 pass, 1 intentionally skipped), not invented: a first-ever plugin
manifest pair (ADR-001), a human-gate handler that blocks only when a real person is plausibly
present to answer and fails loudly everywhere else (ADR-002 — the single most consequential
decision here, reversing the original design after adversarial review found it would turn
every non-interactive invocation, including this plugin's own sanctioned Bash-tool path, into
a silent, permanent hang), a required-argument fix to `resolveRetryTarget`'s scope (ADR-003),
a circular-import-safe lint refusal for embedded `Engine` use (ADR-004), and a hand-authored,
anchor-tested lint rule for handler kinds this build doesn't implement (ADR-005). Every
decision was independently re-verified by a feature-critic pass with WebFetch access to the
live Claude Code plugin docs and read access to every cited source file — findings are folded
in below, not left as a separate unread report.

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `plugins/attractor/.claude-plugin/plugin.json` | does not exist anywhere in this repo | new |
| `.claude-plugin/marketplace.json` (repo root) | does not exist anywhere in this repo | new |
| `plugins/attractor/skills/attractor/SKILL.md` | does not exist | new |
| `engine/src/handlers/human.ts` | does not exist; `Handler.HUMAN` unregistered, aborts mid-run | new |
| `engine/src/core/engine.ts` | owns `PASSTHROUGH_KINDS`/`RunsOn`/`RUNS_ON_MODES`/`runsOn`; `run()` has no lint gate; two `resolveRetryTarget` call sites (~1021, ~1165) leak graph-level fallback | modified |
| `engine/src/dot/graph.ts` | resolves `type`/`shape` to handler kinds; `INFERRED_OUTPUTS_BY_HANDLER` already comments the unregistered set | modified |
| `engine/src/dot/lint.ts` | imports 4 symbols from `core/engine.ts` (the cycle root); GATE-001 (~829) mirrors the same buggy retry ladder | modified |
| `engine/src/core/retry.ts` | `resolveRetryTarget(node, graph)`, two-argument, no ladder distinction | modified |
| `engine/src/core/context.ts` | `isEngineManagedKey` namespace guard | **untouched** — the human-gate handler writes no context this slice (see ADR-002) |
| `engine/src/cli.ts` | pre-constructs and lints before `new Engine()` | **untouched** — becomes a fast-path, not the sole guard |
| `engine/test/{engine,lint,retry,doctor,graph,cli,bundle}.test.ts` | existing suite, cited throughout | modified — see Test strategy |

## Component structure

```
dot/graph.ts     -- gains: PASSTHROUGH_KINDS, RunsOn, RUNS_ON_MODES, runsOn(), UNREGISTERED_HANDLER_KINDS
                    (attribute-resolution layer; no dependency on engine.ts or lint.ts)
      |
      | imported by
      v
dot/lint.ts      -- imports the 4 relocated symbols from graph.ts (not engine.ts); gains HAND-001
      ^
      | imported by (NEW -- this is the edge that was cyclic before the relocation)
      |
core/engine.ts   -- imports {lint, hasErrors} from dot/lint.ts; run() refuses lint-dirty graphs
                    first action; re-exports the 4 relocated symbols for compatibility
      |
      | registers
      v
handlers/human.ts -- HumanGateWait / StdinHumanGateWait / HumanGateHandler (new)
core/retry.ts     -- resolveRetryTarget(node, graph, {includeGraphLevel}) (new required arg)
```

## Interfaces and data contracts

```ts
// handlers/human.ts
export interface HumanGateWait { block(): Promise<void> }
export class StdinHumanGateWait implements HumanGateWait { block(): Promise<void> }
export class HumanGateHandler implements Handler {
  constructor(
    wait?: HumanGateWait,
    isInteractive?: () => boolean,   // default: () => Boolean(process.stdin.isTTY)
  )
  execute(ctx: HandlerCtx): Promise<Outcome>
  // Non-TTY: immediate Status.FAIL, node.human.refused event. TTY: node.human.blocked
  // event, then blocks via `wait` -- never resolves in production (FR-8 unbuilt).
}

// core/retry.ts
export interface ResolveRetryTargetOptions { includeGraphLevel: boolean }  // required, no default
export function resolveRetryTarget(node: Node, graph: Graph, opts: ResolveRetryTargetOptions): string | null

// dot/graph.ts
export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[]  // [HUMAN, PARALLEL, FAN_IN, MANAGER_LOOP]
// HUMAN is included because FR-5/6/7 (S2, human gates) did not land in this slice and
// `defaultHandlers()` still does not register `Handler.HUMAN` -- see ADR-005's Correction
// for the full reasoning.

// dot/lint.ts -- new diagnostic code
// HAND-001, severity ERROR: node resolves to a handler kind this build does not register
```

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | 500 node-visit cap | Unaffected — a blocked/refused human gate never completes a step either way | high |
| NFR-2 | Retry defaults unchanged | FR-10 touches only `resolveRetryTarget`'s scope, not the policy/backoff functions | high |
| NFR-3 | `parseDuration` rules | Unaffected — `HumanGateHandler` deliberately doesn't call it this slice (ADR-002) | high |
| NFR-4 | Checkpoint write safety | Unaffected — neither the block nor the fail-fast path reaches `this.checkpoint()` before a handler returns | high |
| NFR-5 / NFR-6 | Doctor checks / exactly 2 deps | Unaffected; zero new dependencies added anywhere in this design | high |
| NFR-7 | Concurrency ceiling, unknown | Preserved as unknown — FR-17a refuses rather than invents a number | high |
| NFR-8 | 462 tests (context) | Will grow; see Test strategy | n/a |
| NFR-9 | Crash during unanswered gate, accepted risk | **Narrowed by ADR-002**: only the genuinely-interactive-TTY path has a long wait to crash during now; the non-interactive path fails fast instead, so this risk's practical surface shrinks materially versus the PRD's original framing — worth a light PRD note, not a blocker | medium — Spike 6 confirms the invocation-channel assumption this rests on |

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| [ADR-001](decisions/ADR-001-plugin-packaging.md) | First plugin.json/marketplace.json; one skill; per-entry version (corrected 2026-08-06 to match the real sibling `delivery` entry) | A slash command; a bare `bin/` executable |
| [ADR-002](decisions/ADR-002-human-gate-blocking.md) | Block only on a real TTY; fail fast everywhere else | Unconditional block (reversed after critic review); resolve Open Q2 now; auto-route via timeout |
| [ADR-003](decisions/ADR-003-retry-target-scoping.md) | `includeGraphLevel` required, no default | Default `true` with opt-out; default `false` with opt-in |
| [ADR-004](decisions/ADR-004-embedded-engine-lint-refusal.md) | Relocate 4 exports to `graph.ts`; refuse in `run()` | Constructor throws; leave `Engine` unguarded |
| [ADR-005](decisions/ADR-005-hand-001-lint-rule.md) | Hand-authored constant + anchor test, ERROR severity | Derive from `defaultHandlers()` directly; WARNING severity |

## Spikes — what must be proven before committing

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Does `process.stdin.resume()` + heartbeat keep a Node process alive across TTY/piped/`/dev/null`/closed-fd-0? | 30 min | ADR-002's blocking branch |
| 2 | Does the `graph.ts`↔`lint.ts`↔`engine.ts` relocation load cleanly under `node --test` with no init-order crash? | 5 min | ADR-004 |
| 3 | Does `/plugin marketplace add` then `/plugin install attractor@ai-augmentation-systems` in a fresh session actually surface the skill? | 30–45 min | FR-2's literal acceptance test |
| 4 | Does `claude plugin validate` on a corrupted `plugin.json` name the file and the parse problem, confirming FR-3 needs no code? | 15 min | FR-3 |
| 5 | Does plugin packaging respect any file-exclusion convention, or copy `plugins/attractor/` whole (incl. `.delivery/`, `.superpowers/`, `engine/test/`) into every installer's cache? | 15 min | AGENTS.md's packaging assumption |
| 6 **(new, from critic review)** | Does a Claude Code Bash-tool-spawned child present a TTY on stdin? What is the tool's own timeout/backgrounding behavior for a long-running child? | 20 min | Whether ADR-002's TTY branch fires for FR-2's own sanctioned invocation path, and whether the tool's own timeout could still kill the interactive-blocking case |

## Migration and rollback

No persisted-data-format changes anywhere in this slice. Every change is additive (new files,
new handler registration, new lint rule) or a pure-function correctness fix with no persisted
footprint — see each ADR's own Consequences section for the specific rollback per decision.
The one behavioral break is deliberate: FR-11 stops tolerating lint-dirty graphs through direct
`Engine` embeds (F10's entire point), and FR-10 stops honoring a graph-level retry fallback a
plain node was never supposed to see (D7's entire point) — neither has any existing consumer
in this repo (zero committed `.dot` files, `Engine` consumed only by `cli.ts` and tests).

## Test strategy

Full detail (per-area levels, exact fixtures, and the mutation-check matrix) lives in
`decisions/` cross-references and the design's own working notes; summarized by risk here.

| Area | Risk (likelihood × impact) | Test level | Notes |
| :-- | :-- | :-- | :-- |
| S1 manifests | low × medium | unit (schema smoke test) + subprocess (bundle install of `LINT_FAILS_BUT_WOULD_RUN`) + manual (Spike 3) | FR-3/FR-4 need no production code, only verification |
| S2 human-gate block (TTY path) | medium × high | unit (fake-wait race, proves `await` isn't decorative) + integration (`Engine.run()`, edge-not-taken) | Highest tautology risk in this design — see mutation-check note below |
| S2 fail-fast (non-TTY path) | low × high | unit (`isInteractive` injected false, asserts immediate FAIL + event) | **New**, added after critic review; was previously untested because it didn't exist |
| S5 retry-target fix | medium × high | unit + integration, **cross-revert matrix** (revert call site A must fail A's fixture, not B's) | Two fixtures that don't cross-discriminate are decorative, not coverage |
| S6 lint refusal | low × high | integration, reusing `cli.test.ts`'s `LINT_FAILS_BUT_WOULD_RUN` (proven not to false-pass) rather than a fresh fixture | A hand-rolled fixture risks failing for an unrelated structural reason |
| S3 HAND-001 | low × medium | unit, per-shape fixtures + independent anchor test (not self-referential) | Anchor mutated both directions: add `HUMAN` back in, remove `FAN_IN` |

**Deliberately thin:** the real `/plugin install` flow (Spike 3) and JSON-parse-error shape
(Spike 4) — no scriptable entry point exists for either; both become a repeatable runbook, not
a `node --test` case. Scope creep on FR-3/FR-4 (building unneeded validation code) is a code-
review-only check — not expressible as a pass/fail predicate.

**Mutation-check flag, highest priority:** the `HumanGateHandler` blocking tests must assert
via a controlled race (fake wait + timer), not a final-return-value check alone — the latter
passes even against a mutant that resolves immediately, deleting the `await` entirely.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| Circular import crash if the relocation is skipped | low (documented precisely) | critical — whole suite fails at load | Spike 2, ADR-004 | implementer |
| Unconditional block silently hangs non-interactive runs | **was high** | **was critical** | **Resolved by ADR-002** (TTY branch) — residual risk is Spike 6 confirming the Bash-tool channel is genuinely non-TTY | implementer |
| `engine.test.ts`'s `NO_HANDLER` fixture hangs the runner once HUMAN registers | medium | high (hangs `node --test`, not just fails) | Repoint to `Handler.PARALLEL`, mutation-checked with an external wall-clock kill | implementer |
| `lint.test.ts:872` goes red, uncredited, once FR-10 lands | high | medium | Named explicitly here and in ADR-003; rewrite to assert zero diagnostics, not a mechanical fix | implementer |
| HITL-001's message reads as if a declared timeout is enforced, but it isn't in either ADR-002 branch this slice | medium | medium — misleads an author into false confidence | Add a README/SKILL.md caveat (not a code change); tracked here, not yet assigned a file | Solution Architect / whoever authors the skill copy |
| `lint.ts:829`'s `own`/`graphLevel` split becomes dead code after FR-10 | high (certain) | low (correctness unaffected, maintainability cost) | Prune during implementation, not just parameter-patch; code-review-only, not testable | implementer |
| `plugin.json` cannot exclude `.delivery/`/`.superpowers/`/`engine/test/` from the packaged plugin, per the fetched schema | confirmed | low — no secrets, ~740KB | Spike 5; AGENTS.md's assumption may need correcting, not the code | Solution Architect |

---

# FR-17b: parallel fan-out (`Handler.PARALLEL`)

> Added 2026-08-07. Extends the document above; nothing above this line changed. Grounded in
> reading `engine/src/core/engine.ts`, `dot/graph.ts`, `dot/lint.ts`, `core/context.ts`,
> `core/retry.ts`, `core/checkpoint.ts`, `core/edge-select.ts`, `run/worktree.ts`,
> `handlers/{box,tool,stub,types}.ts`, `backend/claude.ts` in full, and amplifier's actual
> source (`microsoft/amplifier-bundle-attractor@main`, fetched via `gh api` after
> `raw.githubusercontent.com` 404'd on the guessed path — real paths are under
> `modules/loop-pipeline/amplifier_module_loop_pipeline/`): `handlers/parallel.py`,
> `handlers/fan_in.py`, `engine.py` (`run()`, `run_subgraph()`, `_find_fan_in_node()`,
> `clone_for_branch()`), `docs/ROUTING-REFERENCE.md`, `examples/pipelines/05-parallel-fan-out.dot`.

## What a "branch" is, resolved from amplifier's real mechanics

Amplifier's own model, read directly (not inferred): a branch is **not** one node. `ParallelHandler.execute` (`parallel.py:84`) takes every outgoing edge as a branch root, then runs each root through `engine.run_subgraph(target_node_id, context=branch_context, ...)` (`parallel.py:166-176`) — an ordinary node-to-node traversal, same edge-selection algorithm as the main loop, in a **cloned** context. `run_subgraph` (`engine.py:957-1115`) walks forward until it hits an exit node, a `shape=tripleoctagon` node, or a dead end (`engine.py:1021`). The **main** loop, after `ParallelHandler` returns, does not run ordinary edge selection over the component node's own edges at all — `engine.py:818-845` special-cases `shape=="component"`: it BFS-discovers the earliest node reachable from *every* branch root (`_find_fan_in_node`, `engine.py:1417-1476`) and jumps `current_node` straight there, executing it exactly once, in the parent's own (non-cloned) context. If no common descendant exists, the run fails loudly (`engine.py:824-835`, "has no convergence (fan-in) node").

This resolves the orchestrator's structural question: a branch is a **sub-path**, and the edge that continues the main pipeline is not one of the component node's own edges at all — it is a **statically-discovered convergence node**, found by graph reachability, not declared by any attribute.

**Divergence from amplifier, deliberate:** amplifier's convergence-finder is shape-agnostic (any common descendant qualifies) but `run_subgraph`'s own stop condition checks `shape=="tripleoctagon"` specifically (`engine.py:1021`) — so a convergence node that is *not* shaped `tripleoctagon` is not recognized by the branch runner, which would run straight through it inside each branch's own cloned context, then have the main loop execute it *again* for real. Every worked example in the repo uses a `tripleoctagon` node at the convergence point, so this never fires — but it is a latent double-execution defect in amplifier's own code, not a documented safety property. Since `Handler.FAN_IN` stays lint-refused this slice (FR-17a) and Open Question 5 explicitly resolved "no separate fan-in node required," this design cannot rely on a `tripleoctagon` shape to mark the stop point anyway. **Fix, not port:** the branch runner's stop condition is not a shape check — it stops at whichever node id was pre-computed as the convergence node (any kind), so the class of bug above cannot occur here. Branch execution and the convergence discovery share one precomputed value, not two independent tests that must agree by convention.

## Component structure (extends the diagram above)

```
dot/graph.ts     -- gains: findConvergenceNode(graph, branchRootIds): string | null
                    (pure static reachability; PAR-001 and Engine.run() both call THIS,
                    not independent copies); findPartialReconvergence(graph, branchRootIds,
                    convergenceId): string[] (NEW, resolves F3 -- ADR-007 amendment, BROADENED
                    2026-08-07 fifth pass to also resolve F3's residual: catches a node
                    reachable from 2+ branch roots by the same truncated-BFS mechanism,
                    INCLUDING one reachable from every root that lost findConvergenceNode's own
                    tie-break -- not just the "2+ but not all" subset case the original wording
                    covered; PAR-004 and nothing at runtime both call THIS -- runBranch's own
                    stopAt frontier makes the graph structurally unable to reach a node this
                    function flags, so no separate runtime check is needed once PAR-004 refuses
                    the graph); UNREGISTERED_HANDLER_KINDS loses Handler.PARALLEL
      |
      v
dot/lint.ts      -- gains PAR-001 (ERROR: branches never reconverge), PAR-002 (WARNING:
                    exactly one outgoing edge -- fan-out is a no-op, not refused, just noted),
                    PAR-003 (WARNING, resolves F1 design-time half -- ADR-010: two or more
                    branches' own declaredOutputs() sets intersect -- a static complement to
                    the runtime merge-back's own collision log, catching author-declared
                    collisions before a run, not inferred ones like tool.last_line),
                    PAR-004 (ERROR, resolves F3 -- ADR-007 amendment, BROADENED 2026-08-07
                    fifth pass to also resolve F3's residual: a node is reachable from 2+ of a
                    component node's branch roots by the same truncated-BFS mechanism -- 2+ of
                    ANY count, including all of them, not just a proper subset -- and is not
                    itself the selected convergence node -- the double-dispatch hazard finding
                    F3 named, now including a full common descendant that merely lost
                    findConvergenceNode's own tie-break), PAR-005 (WARNING, resolves F2 --
                    ADR-007 amendment, rationale corrected 2026-08-07 fifth pass: a branch can
                    reach the graph's real EXIT node without first passing through the
                    branches' own convergence node -- WARNING because ending one branch's own
                    traversal early without affecting siblings is legitimate on its own, NOT
                    because this shape can stop the whole pipeline; it cannot, by the Decision
                    itself)
      |
      v
core/engine.ts   -- defaultHandlers() gains [Kind.PARALLEL, new ParallelHandler()] (no new
                    constructor arg -- see ADR-009); run()'s per-node step logic and a NEW
                    private runBranch() are both thin callers of ONE new shared private
                    method, executeNodeStep() (resolves F5+F6 -- ADR-012, binding: shared
                    method, not a parity-tested reimplementation). executeNodeStep() owns
                    dispatch, the eager-input-check, the retry ladder, BOTH recordOutcome
                    calls, and a checkpoint write via the EXPORTED saveCheckpoint(runDir, cp)
                    parameterized by a caller-given runDir (never the hardwired
                    this.opts.runDir a second copy could accidentally reuse -- this is what
                    closes the checkpoint-collision risk named in the Risks table below).
                    It also owns a NEW shared instance field, this.stepCount (resolves F5:
                    replaces run()'s local `step` loop variable; incremented once per
                    dispatch, by EITHER caller, so a branch cannot multiply the run-wide
                    500-step ceiling). It returns a small descriptor -- continue to a next
                    node id, or stop for one of four reasons (the graph's real EXIT node
                    dispatched; the caller's own stopAt frontier reached; a dead end; the
                    shared step cap reached) -- and each of the two callers interprets a
                    stop differently: run()'s loop is the ONLY place that still runs the
                    goal-gate check / this.checkpoint(null) / RunResult-return for an
                    'exit' stop (resolves F2 -- ADR-007 amendment: runBranch NEVER runs that
                    block, for any stop reason, including 'exit' -- a branch reaching the
                    graph's real EXIT node is treated exactly like an ordinary dead end,
                    since Handler.EXIT is a side-effect-free PassthroughHandler kind).
                    runBranch() is scoped to a caller-given runDir/cwd/stopAt frontier and
                    the run's OWN shared gateOutcomes/nodeFailures/failedOutputs maps
                    (ADR-009, unchanged by this refactor)
      |
      v
handlers/parallel.ts (NEW) -- ParallelHandler: reads ctx.runBranch (new HandlerCtx field),
                    fans out to branch roots bounded by max_parallel (default 4), creates
                    one branch worktree per branch via run/worktree.ts (ASYNC now -- ADR-011,
                    resolves F4) unless edge attr isolate="false", applies the default join
                    policy (FAIL iff zero success), THEN merges each SUCCESS/PARTIAL branch's
                    own context back into the run's real Context in branch-declaration order,
                    logging any collision (mergeBranchContext, NEW -- resolves F1, ADR-010),
                    and returns the aggregate Outcome like any Handler
      |
      v
handlers/types.ts -- Backend.run() gains a cwd param (ADR-008); HandlerCtx gains
                    runBranch?: (opts) => Promise<BranchRunResult> (ADR-009)
backend/claude.ts -- ClaudeCodeBackend.run() prefers the per-call cwd over its
                    constructor-bound this.opts.cwd
handlers/box.ts   -- BoxHandler.execute passes ctx.cwd through to backend.run() (today it
                    does not -- confirmed by reading box.ts:96-102, no cwd argument at all)
run/worktree.ts   -- MODIFIED, not untouched (resolves F4 -- ADR-011): git() and every
                    function that calls it (isGitRepo, createWorktree, hasUncommittedWork,
                    isRegisteredWorktree, removeWorktree) become async, built on execFile
                    (promisified via node:util, zero new dependency) instead of the
                    blocking execFileSync a Promise.all-based, semaphore-bounded fan-out
                    cannot afford to call synchronously. Real, mechanical blast radius:
                    cli.ts's five calling sites (cli.ts:237,243,260,261,338 -- two isGitRepo
                    guards, two createWorktree calls, one removeWorktree call) and ~25 call
                    sites in worktree.test.ts all gain await -- named explicitly, not glossed
                    as free
```

## Codebase context (additions)

| Path | Role today | Change |
| :-- | :-- | :-- |
| `engine/src/dot/graph.ts` | `UNREGISTERED_HANDLER_KINDS` includes `Handler.PARALLEL` (line 226); no reachability helper | modified — remove PARALLEL from the array; add `findConvergenceNode` |
| `engine/src/dot/lint.ts` | HAND-001 refuses PARALLEL unconditionally (lines 514-529) | modified — HAND-001's set narrows by construction (reads the same array); add PAR-001, PAR-002 |
| `engine/src/core/engine.ts` | `run()` is one flat sequential `for` loop over a single `currentId` (confirmed: lines 643-1088, no concurrency, no recursion, nothing async-parallel anywhere in the file); `defaultHandlers()` builds a `Map` with no PARALLEL entry (lines 77-84) | modified — new dispatch case, new private `runBranch`, one new `Map` entry |
| `engine/src/handlers/parallel.ts` | does not exist | **new** |
| `engine/src/handlers/types.ts` | `Backend.run(node, prompt, context, graph, signal?)` — no `cwd` (confirmed, line 32); `HandlerCtx` has no branch-execution seam | modified — additive param, additive optional field |
| `engine/src/backend/claude.ts` | `ClaudeCodeBackend.run()` uses only `this.opts.cwd`, bound once at construction (line 115); ignores any per-call cwd (there is none today) | modified — prefer per-call `cwd` |
| `engine/src/handlers/box.ts` | `backend.run(ctx.node, prompt, ctx.context, ctx.graph, signal)` — **does not pass `ctx.cwd`** (confirmed, lines 96-102) | modified — pass it through |
| `engine/src/handlers/stub.ts` | `StubBackend.run()` ignores cwd entirely (no subprocess) | untouched — remains a valid implementer of the widened interface |
| `engine/src/handlers/tool.ts` | `runShell(command, ctx.cwd, timeoutMs)` (line 125) — **already** honors per-call cwd | **untouched** — a branch's TOOL node is correctly isolated today, with zero code change |
| `engine/src/core/context.ts` | `Context.clone()` already exists (lines 125-127) | **untouched** — exactly the primitive per-branch isolation needs |
| `engine/src/core/retry.ts` | `resolveRetryPolicy`/`resolveRetryTarget`, node-scoped, no notion of "inside a branch" | **untouched** — reused as-is inside `runBranch`; retry is per-node regardless of branch membership (see below) |
| `engine/src/core/checkpoint.ts` | `saveCheckpoint(runDir, cp)` writes one `runDir/checkpoint.json`; `CheckpointWire` is the §5.3 wire shape | **untouched** — reused unchanged, called with a branch-scoped `runDir` per branch (new call sites, same function, same shape); as of ADR-012 it is called *directly*, not through the private `this.checkpoint()` wrapper, from both `run()` and `runBranch()` |
| `engine/src/run/worktree.ts` | `createWorktree(repoDir, runId)` / `removeWorktree` — `isGitRepo` accepts a branch worktree as `repoDir` (confirmed empirically below); all synchronous (`execFileSync`) | **modified — corrected 2026-08-07 (F4, ADR-011)**: `git()` and every function built on it become `async`/`Promise`-returning (`execFile`, not `execFileSync`) so a blocking git call cannot freeze sibling branches' subprocess I/O or abort timers. Real callers, not just this file, are affected — see `cli.ts` and `worktree.test.ts` rows below |
| `engine/src/cli.ts` | constructs one `ClaudeCodeBackend`/`Engine` per run; calls `createWorktree`/`removeWorktree`/`isGitRepo` synchronously (`cli.ts:243,261,338,237,260`) | **modified — corrected 2026-08-07 (F4, ADR-011)**: those five call sites gain `await` (the enclosing function is already `async`, so no new async boundary). `defaultHandlers(backend)`'s own signature still does not change |
| `engine/test/worktree.test.ts` | ~25 synchronous `createWorktree`/`removeWorktree`/`isGitRepo` call sites | **modified — new row 2026-08-07 (F4, ADR-011)**: every call site gains `await`; the `test()` callbacks they sit in become `async`. Mechanical — no assertion changes except where Spike 12 finds the error-message shape actually drifted |

## Interfaces and data contracts

```ts
// dot/graph.ts
export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[] =
  [Handler.HUMAN, Handler.FAN_IN, Handler.MANAGER_LOOP]  // PARALLEL removed

/** Earliest node reachable from EVERY branch root (excluding the roots), by static
 * reachability over ALL outgoing edges regardless of condition truth -- lint-time and
 * runtime cannot know which conditional edge fires, so both must over-approximate the
 * same way. Shallowest common descendant wins ties -- which tied node wins is deliberately
 * unspecified beyond that (see findPartialReconvergence below): once PAR-004 is broadened
 * (2026-08-07 fifth pass, resolves F3's residual) to refuse every OTHER full common
 * descendant a tie could produce, no graph that reaches a run can depend on which one this
 * function picks, so the tie-break itself does not need to be made deterministic here.
 * null if branches never reconverge. */
export function findConvergenceNode(graph: Graph, branchRootIds: readonly string[]): string | null

/** NEW -- resolves F3 (ADR-007 amendment). BROADENED 2026-08-07, fifth pass, to also resolve
 * F3's own residual gap (see ADR-007's second amendment for the full worked example and
 * reasoning). Node ids reachable from two or more of the given branch roots -- two or more OF
 * ANY COUNT, including every root -- where reachability from each root is truncated at (does
 * not expand past) convergenceId -- exactly the frontier runBranch's own stopAt stops at, so
 * this is not an approximation of a different boundary than the runtime uses. The ORIGINAL
 * wording here said "two or more, but not all" -- that qualifier is gone: a node reachable
 * from every branch root that findConvergenceNode's tie-break did NOT select is exactly as
 * much a double-dispatch hazard as one reachable from a proper subset, and this function must
 * not distinguish the two cases. A node is still safely excluded when every path to it from
 * every root passes through convergenceId first -- the existing truncated-BFS mechanism
 * already establishes that; no separate "is this a tie" check is needed. Excludes the roots
 * and convergenceId itself. Empty when every branch's own truncated reachable set is disjoint
 * from every other's and no full common descendant besides convergenceId exists, or when
 * convergenceId is null (PAR-001 already refuses that graph). */
export function findPartialReconvergence(
  graph: Graph, branchRootIds: readonly string[], convergenceId: string | null,
): string[]

// dot/lint.ts -- new diagnostic codes
// PAR-001, ERROR: node.handler === PARALLEL, >=2 outgoing edges, findConvergenceNode() === null
// PAR-002, WARNING: node.handler === PARALLEL, exactly 1 outgoing edge (fan-out is a no-op)
// PAR-003, WARNING -- NEW, resolves F1 design-time half (ADR-010): two or more of a component
//   node's branches declare (declaredOutputs()) the SAME context key -- a static complement to
//   the runtime merge-back's collision log; cannot see inferred keys (tool.last_line), only
//   declared ones
// PAR-004, ERROR -- NEW, resolves F3 (ADR-007 amendment); BROADENED 2026-08-07 fifth pass to
//   also resolve F3's residual: findPartialReconvergence() is non-empty -- a node reachable
//   from 2+ of a component node's branch roots (a proper subset, OR every root when it lost
//   findConvergenceNode's tie-break) would be dispatched independently (and possibly
//   concurrently) by more than one runBranch call
// PAR-005, WARNING -- NEW, resolves F2 (ADR-007 amendment); rationale corrected 2026-08-07
//   fifth pass: a branch root can reach the graph's real EXIT node without first passing
//   through the branches' own convergence node (findConvergenceNode() result) -- usually an
//   authoring mistake, not refused because a branch legitimately ending its OWN traversal
//   early, without affecting siblings or the overall run, is a shape this design does not
//   want to outlaw structurally. NOT because a branch reaching EXIT can stop the whole
//   pipeline -- per the Decision in ADR-007, it never does; see the corrected rationale there

// handlers/types.ts
export interface Backend {
  run(node: Node, prompt: string, context: Context, graph: Graph, signal?: AbortSignal,
      cwd?: string): Promise<Outcome>   // NEW optional trailing param, additive
}
export interface BranchRunOptions {
  startNodeId: string
  stopAt: ReadonlySet<string>   // convergence node id; branch halts before dispatching it
  context: Context               // caller-supplied, already Context.clone()'d
  runDir: string                 // branch-scoped subdir -- OWN checkpoint.json/events.jsonl
  cwd: string                    // branch worktree path, or the component node's own cwd
}
export interface BranchRunResult {
  outcome: Outcome
  path: string[]
  /** NEW -- resolves F1 (ADR-010). The branch's own Context, snapshotted (Context.snapshot(),
   * already exists) at the moment its traversal stopped. Full snapshot, not a diff -- the
   * diff against the pre-fork snapshot is computed by ParallelHandler, which already holds
   * both snapshots, via mergeBranchContext below. */
  context: Record<string, string>
}
export interface HandlerCtx {
  // ...unchanged fields...
  runBranch?: (opts: BranchRunOptions) => Promise<BranchRunResult>   // NEW, Engine-populated
}

// core/engine.ts -- resolves F5+F6 (ADR-012), private, no public surface change
// private stepCount = 0   -- replaces run()'s local `step` loop variable; incremented once
//   per dispatch by EITHER run()'s loop or runBranch()'s loop, so a branch cannot multiply
//   the run-wide 500-step ceiling (NFR-1)
// private async executeNodeStep(currentId, { runDir, cwd, maxSteps, stopAt? }): Promise<StepResult>
//   -- the ONE shared per-node step implementation; see ADR-012 for the full StepResult shape
//   and the exact division of labor between run()'s loop and the new private runBranch()

// handlers/parallel.ts
export class ParallelHandler implements Handler {
  // No constructor args -- everything comes from HandlerCtx (ctx.cwd, ctx.runBranch,
  // ctx.graph, ctx.node, ctx.events). defaultHandlers(backend)'s own signature is unchanged.
  async execute(ctx: HandlerCtx): Promise<Outcome>
}
export function applyDefaultJoinPolicy(results: readonly BranchRunResult[]): Outcome
// FAIL iff zero results have status SUCCESS or PARTIAL; else SUCCESS iff zero FAIL;
// else PARTIAL. Matches FR-17b's literal wording; no new Status value (core/outcome.ts:1-7).

/** NEW -- resolves F1 (ADR-010). Called once per PARALLEL dispatch, after every branch has
 * settled, before ParallelHandler.execute returns. For each branch IN BRANCH-ROOT
 * DECLARATION ORDER (not completion order -- deterministic, matches how branches were
 * dispatched) whose own outcome.status is SUCCESS or PARTIAL: merge every key in its
 * `context` snapshot that differs from preforkSnapshot, EXCEPT the three bare
 * ENGINE_MANAGED_KEYS (context.ts:31 -- outcome/preferred_label/current_node; NOT the
 * isEngineManagedKey() prefix check -- tool.*-prefixed keys ARE eligible, they are branch
 * evidence, not control-plane bookkeeping), into parentContext. A later branch's value for a
 * key an earlier branch already merged wins and is logged via node.parallel.context_collision
 * -- never silent. */
export function mergeBranchContext(
  parentContext: Context,
  preforkSnapshot: Record<string, string>,
  branchRootIds: readonly string[],
  results: readonly BranchRunResult[],
  events: EventLog,
): void

// New node attribute: max_parallel (int, default 4, per Open Question 3)
// New EDGE attribute: isolate ("true" default | "false") -- opts ONE branch out of its own
//   branch worktree; lives on the edge because Q3 makes the edge the branch's own identity,
//   and it lets one component node mix isolated and coordination-only branches.

// run/worktree.ts -- resolves F4 (ADR-011); signatures gain Promise<...>, bodies swap
// execFileSync for execFile (promisified via node:util, zero new dependency)
export function isGitRepo(dir: string): Promise<boolean>
export function createWorktree(repoDir: string, runId: string): Promise<Worktree>
export function removeWorktree(repoDir: string, wt: Worktree): Promise<RemovalResult>
```

## `Handler.PARALLEL`'s execution loop (answers to the six numbered design questions)

1. **Integration into `run()`.** Not a nested `new Engine(...)` (rejected — see ADR-009).
   **Revised 2026-08-07 (F5, F6 — ADR-012, binding):** the main loop and a new private
   `runBranch()` are both thin callers of one shared private method, `executeNodeStep()` —
   not two hand-kept copies of "retry, eager-input-check, `recordOutcome`," and not a
   reimplementation checked by a parity test (ADR-012 names and rejects that alternative
   explicitly). `executeNodeStep()` returns a small descriptor (`continue` to a next node id,
   or `stop` for one of four reasons: the graph's real EXIT node dispatched, the caller's own
   `stopAt` frontier reached, a dead end, or the shared step cap reached — see ADR-012 for the
   exact `StepResult` shape). The main loop's own interpretation of a `PARALLEL` node's
   dispatch is otherwise unchanged from before this revision: `ParallelHandler.execute()` is
   an ordinary `Handler` call from the loop's point of view, and `recordOutcome(node.id,
   outcome)` already runs unconditionally for every dispatched node, so the join policy's
   aggregate `Outcome` becomes the component node's own outcome for free — goal-gate
   bookkeeping needs no special case. **Resolved 2026-08-08, [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md)** (was: "the existing 'QA
   finding, blocking' Risks-table row ... is not one of F1–F7 and is left exactly as open as
   it was"): `executeNodeStep()`'s dispatch of a `Handler.PARALLEL` node needs one further,
   additive branch this revision correctly stopped short of — on SUCCESS/PARTIAL, bypass
   `selectEdge` and continue at the precomputed convergence node (`findConvergenceNode`'s own
   result; structurally the only reachable continuation, since a component node's own outgoing
   edges are its branch roots, never the convergence node); on FAIL, no jump — the existing
   `selectEdge`/`retry_target` ladder this method already runs (lines 816-824) is unchanged and
   sufficient. This is scope item C did not originally carry (see `roadmap.md`'s item C row,
   corrected alongside this ADR), not a reason to revisit the shared-method decision itself.
2. **Context per branch.** `Context.clone()` already exists and is reused unchanged
   (`context.ts:125-127`). `ParallelHandler` snapshots the run's own `Context`
   (`preforkSnapshot`) *before* cloning, then clones once per branch before calling
   `ctx.runBranch`. **Revised 2026-08-07 (F1 — ADR-010):** a branch's clone is no longer
   discarded when it resolves. After every branch settles, `ParallelHandler` calls
   `mergeBranchContext(ctx.context, preforkSnapshot, branchRootIds, results, ctx.events)` —
   see Interfaces above — which is what actually gets a branch's `outputs=`/`contextUpdates`
   evidence to the convergence node. This runs regardless of the overall join-policy verdict;
   it is not gated on the component node's own outcome being SUCCESS.
3. **Branch worktree lifecycle.** One `createWorktree(ctx.cwd, branchRunId)` per isolated
   branch (`isolate` edge attr absent or `"true"`), bounded by `max_parallel` via a small
   hand-rolled semaphore (no new dependency — the plugin holds exactly two, non-tradeable per
   `AGENTS.md`). **Revised 2026-08-07 (F4 — ADR-011):** `createWorktree`/`removeWorktree`/
   `isGitRepo` are now `async` (`execFile`, not `execFileSync` — see the `run/worktree.ts` row
   above), so this call is `await`ed rather than executed synchronously inline; a blocking
   git call no longer freezes sibling branches' subprocess I/O or their `timeout=` abort
   timers while it runs. **Empirically verified, not assumed:** a branch worktree created
   from another worktree's path works (`git worktree add` from a worktree succeeds; confirmed
   by direct test). **Also verified, and load-bearing:** a branch worktree sees only the
   parent worktree's last *commit* — an uncommitted file an earlier pipeline stage wrote is
   invisible to it (tested directly: appended text and a new file left uncommitted in a parent
   worktree were both absent from a sibling worktree created immediately after). This is
   consistent with, not a regression from, `worktree.ts`'s own doctrine ("committing is the
   pipeline's job") — but it means a node preceding a `PARALLEL` node whose deliverable is a
   *file* rather than a context key is invisible to isolated branches unless something commits
   it first. Named in Risks, not silently absorbed. `removeWorktree` runs per-branch,
   immediately after that branch's own `runBranch` resolves — not deferred to the top-level
   run's `finally` — and inherits its existing "never delete uncommitted work" guarantee
   unchanged.
4. **Default join policy.** `applyDefaultJoinPolicy` above — direct implementation of FR-17b's
   text and Open Question 5's correction of amplifier's own fail-open `wait_all` (`fail_count
   == 0` check only, confirmed by reading `parallel.py:444-455` — never checks
   `success_count`). No other join policy (`first_success`/`k_of_n`/`quorum`) or `error_policy`
   ships this slice — amplifier has all four; FR-17b specifies exactly one, and adding the
   others now is exactly the "abstraction for a use case that doesn't exist yet" this role
   pushes back on. The seam (`join_policy=` attribute) is left open, not built. Context
   merge-back (item 2 above) is a *separate* step from computing this policy's verdict, not
   folded into it — a branch can contribute merged context while the overall join is FAIL, and
   vice versa.
5. **Retry inside a branch.** No special case, by construction: a node inside a branch runs
   through the identical per-node step logic (`executeNodeStep`, as of ADR-012) the main loop
   uses, so its own `max_retries`/`retry_target` attributes apply exactly as on the main path —
   in place, then to a target still inside the branch's own reachable set. The `PARALLEL` node
   itself has no retry semantics of its own beyond what any node already gets: if an author
   sets `retry_target` on the component node and the join policy returns FAIL, the existing
   §3.7 ladder (unchanged) routes there.
6. **Checkpoint.** `checkpoint.ts`'s wire shape and atomic-write function are **unchanged**.
   **Revised 2026-08-07 (F6 — ADR-012):** `executeNodeStep()` calls the *exported*
   `saveCheckpoint(runDir, cp)` directly, with a `runDir` the caller supplies (`this.opts.runDir`
   from the main loop, a branch-scoped directory from `runBranch`) — **not** the private
   `this.checkpoint()` wrapper, which stays hardwired to `this.opts.runDir` and is now used
   only by the main loop's own top-level calls (`this.checkpoint(null)` at EXIT/step-cap/
   dead-end). This is what closes, by construction rather than by a hoped-for unit test, the
   checkpoint-collision risk the original design named (a branch accidentally reusing
   `this.checkpoint()` and silently writing to the outer run's own file). The outer run's own
   final checkpoint still fires exactly once, *after* `ParallelHandler.execute()` returns —
   never mid-branch — so NFR-4's existing single-writer-per-file guarantee holds. `runBranch`
   writes its *own* `checkpoint.json` under a branch-scoped `runDir` (a new file path, not a
   new field), used for nothing this slice (resume stays unwired per NFR-9) — purely so a
   future resume feature has branch-level state to read, and so no two writers ever share one
   path.

**Deliberate, load-bearing consequence, stated explicitly:** `runBranch` mutates the *outer*
engine's own `gateOutcomes`/`nodeFailures`/`failedOutputs` maps (not branch-private copies).
A `goal_gate=true` node inside a branch correctly blocks the pipeline's real exit; a failure
in branch A correctly makes `holdsUnresolvedFailure()` true for a `runs_on=failure` node in
branch B or on the main path. This is what keeps the fail-closed doctrine (`AGENTS.md`)
correct once execution stops being single-threaded — a naive "spin up N independent `Engine`
instances" alternative would silently lose this, which is the main reason ADR-009 rejects it.
**This is a narrower guarantee than "all branch state is shared," and finding F1 was exactly
that conflation** — the four ledgers above are shared; a branch's *ordinary* `Context` writes
are not, and reach the outer run only through the explicit `mergeBranchContext` step (item 2
above, ADR-010). ADR-009 is now annotated with this scope note directly, so a future reader of
that ADR alone does not draw the same over-broad conclusion. The step budget (NFR-1) is
likewise shared, not per-branch — **as of ADR-012 (F5), this is a real instance field,
`this.stepCount`, not prose**: a node executed inside any branch increments the same field the
main path does, so `max_parallel` cannot multiply the run-wide ceiling, and a branch stuck in
a routing cycle is guaranteed to be stopped (with a FAIL outcome, handled exactly like a dead
end) within the shared 500-step budget rather than hanging the run indefinitely.

## Meeting the non-functional requirements (FR-17b additions)

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-7 | Concurrency ceiling, default 4 | `max_parallel` attribute, hand-rolled bounded-concurrency runner (no new dependency), default 4 per Open Question 3's resolution, itself citing amplifier's `parallel.py:10,94` as evidence, not authority | high |
| NFR-1 | 500-step cap, run-wide | **Corrected 2026-08-07 (F5 — ADR-012):** `this.stepCount`, a real shared instance field `executeNodeStep()` increments once per dispatch regardless of caller (main loop or `runBranch`), replaces run()'s previous local `step` loop variable. Not Spike 7 (that spike is about branch-worktree uncommitted-changes visibility, unrelated — the original citation here was wrong) — this needed a code-level fix, not an empirical spike, since it was an internal-logic gap, not an external unknown. Verified by the "Step budget shared across branches" row in Test strategy below | high — pure internal mechanism, directly unit-testable, no external unknown to spike |
| NFR-4 | Checkpoint single-writer safety | Branch-scoped `checkpoint.json`/`events.jsonl` paths, one per branch, never the outer run's own file — no new concurrent-writer surface | high |
| NFR-9 | Crash exposure, accepted risk | Unaffected: a crash mid-parallel-section loses exactly what it would lose today (everything since the last completed node before the component node) — resume stays unwired | high |

## Decisions (FR-17b additions)

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| [ADR-007](decisions/ADR-007-parallel-branch-and-convergence-model.md) | Branch = sub-path via a shared-ledger `runBranch`; convergence = statically-discovered common descendant of any kind, precomputed once and reused by both lint and runtime | Branch = single node (dead-ends the "which edge continues?" question); port amplifier's shape-gated (`tripleoctagon`-only) stop condition |
| [ADR-008](decisions/ADR-008-backend-cwd-parameter.md) | `Backend.run()` gains an optional trailing `cwd`; `ClaudeCodeBackend` prefers it over its constructor-bound cwd | Leave `Backend` unchanged (isolates TOOL nodes only, silently not CODERGEN — the dominant node kind in the canonical example); have the CLI construct N per-branch `Backend`s |
| [ADR-009](decisions/ADR-009-handlerctx-runbranch-seam.md) | `HandlerCtx` gains an optional `runBranch` callback, Engine-populated per dispatch | Hand `ParallelHandler` a direct `Engine` reference (circular construction, needs a two-step `Map` mutation at every call site); nested independent `new Engine()` per branch (loses shared goal-gate/failure ledgers, see above) |
| [ADR-010](decisions/ADR-010-branch-context-merge-back.md) **(new, resolves F1)** | `BranchRunResult` gains a full `context` snapshot; `mergeBranchContext` merges SUCCESS/PARTIAL branches' writes back in branch-declaration order, logging collisions | Merge every branch regardless of outcome status (trusts unproven partial work); merge in completion order (nondeterministic collision winner); diff computed inside `runBranch` instead of by `ParallelHandler` (splits the merge policy across two files) |
| [ADR-011](decisions/ADR-011-worktree-async-git.md) **(new, resolves F4)** | `run/worktree.ts`'s `git()` and its public API become `async` (`execFile`, not `execFileSync`) | Accept the serialized worktree lifecycle and restate NFR-7 (rejected: the gap is correctness — abort timers not firing on schedule — not only performance); wrap the sync calls in a worker-thread pool (new runtime machinery `execFile` already makes unnecessary) |
| [ADR-012](decisions/ADR-012-shared-execute-node-step.md) **(new, resolves F5+F6)** | One shared private `executeNodeStep()` method and one shared `stepCount` field, used by both `run()`'s loop and the new `runBranch()` | Reimplementation with a parity test (rejected: proves agreement today, not after a future one-sided edit — strictly weaker than shared code); a step counter local to each loop (rejected: multiplies the run-wide ceiling by `max_parallel`) |

## Spikes (FR-17b additions)

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 7 **(resolved during this design, not deferred)** | Does a branch worktree see a parent worktree's uncommitted changes? | done | Confirmed NO by direct `git worktree add`/`git worktree list` test against a scratch repo (append to a tracked file + a new untracked file, both invisible in the sibling worktree). Feeds the Risks row below, not a further spike. |
| 8 | Does concurrent `Map`/array mutation from `Promise.all`-awaited branch callbacks against the outer engine's `gateOutcomes`/`nodeFailures`/`failedOutputs`/`attempts`/`completed`/`path` produce any ordering surprise beyond "interleaved but not corrupted" (true by JS's single-threaded semantics, but `nodeFailures`'s own doc comment at `engine.ts:184` promises FIRST-FAILURE order, which concurrent branches can visibly scramble)? | 30 min | Whether `nodeFailures`'s ordering contract needs restating for the parallel case, or a small serialization point (e.g. apply each branch's ledger deltas after it resolves, not while it runs) |
| 9 | Bounded-concurrency semaphore under real `max_parallel` values with real subprocess spawns (`claude -p` per CODERGEN branch) — does Node's process/fd ceiling get reached before `max_parallel` does, at the default of 4? | 20 min | NFR-7's practical ceiling vs. its declared one |
| 10 | Does `createWorktree`'s branch-name scheme (`attractor/${runId}`) collide across concurrently-created branch worktrees under a plausible `runId` construction, and does `git worktree add -b` fail loudly (desired) or race silently? | 15 min | Worktree lifecycle correctness under real concurrency, not just sequential unit tests |
| 11 **(new, resolves F1, ADR-010)** | Does `mergeBranchContext` correctly propagate a branch's `outputs=`/`contextUpdates` key to the convergence node end to end (clone → branch write → merge → substitution reads the merged value), and does the deterministic branch-declaration-order collision rule actually produce a *reproducible* result when branches complete in varying real-world order (completion order must not leak into which value wins)? | 25 min | `ParallelHandler`'s merge-back implementation and the "context merge-back" Test-strategy rows below |
| 12 **(new, resolves F4, ADR-011)** | Does `execFile`'s promisified rejection shape (`Error` with `.stdout`/`.stderr`/`.code`) match `execFileSync`'s thrown-`Error` shape closely enough that `worktree.test.ts`'s existing message-matching assertions (e.g. the "not a git repository" / "could not remove the worktree cleanly" strings) keep passing unmodified after the async conversion? | 20 min | ADR-011's migration; a silent format drift here would fail a test for a reason unrelated to the feature under test |

## Migration and rollback (FR-17b)

**Forward:** additive only to persisted formats — `CheckpointWire`'s wire shape is unchanged;
branch-scoped checkpoint files are new *paths*, not a new field. `UNREGISTERED_HANDLER_KINDS`
losing `Handler.PARALLEL` is the one behavioral change with an existing consumer: any graph
today that (incorrectly) expected HAND-001 to refuse a `shape=component` node will stop being
refused and start running — no such graph exists in this repo (zero committed `.dot` files
outside `engine/test/`, same fact ADR-004/ADR-005 already established). `Backend.run()`'s new
trailing `cwd` param is additive at the *type* level (existing implementers remain valid, per
TS structural typing) but **silently functional-incomplete** for any embedder-supplied
`Backend` that does not read it — that Backend keeps working, but a CODERGEN node in an
isolated branch quietly runs in the wrong directory. Recorded here as the honest shape of the
migration, not glossed as purely additive.
**Back:** revert the `UNREGISTERED_HANDLER_KINDS` entry (HAND-001 refuses PARALLEL again,
immediately, at lint time, for every graph); the `Backend.run()` param and `HandlerCtx.runBranch`
field can both stay dead code with zero runtime effect if `ParallelHandler` is unregistered.
**Not applicable to:** the top-level `checkpoint.json` wire shape, `Context`, `retry.ts` — none
of them change.

**Corrected 2026-08-07 (F4, ADR-011): `run/worktree.ts` is NOT in the "none of them change"
list above.** `git()` and its public API (`isGitRepo`/`createWorktree`/`removeWorktree`) become
`async`. This is a real, breaking signature change to an already-shipped internal API, not a
purely additive one — the original text's blanket "worktree.ts... none of them change" was
wrong once F4 was investigated. **Forward:** every existing caller (`cli.ts`'s five call
sites, `worktree.test.ts`'s ~25) gains `await`; no persisted data or wire format is touched, so
this is a pure code-level migration, mechanical but real. **Back:** reverting ADR-011 means
reverting `git()` and its callers to `execFileSync`/synchronous signatures across all three
files in lockstep — this is **not** independently revertible file-by-file the way the
`Handler.PARALLEL` registration is, because a caller awaiting a function that stops returning a
`Promise` is a compile error, not a silent behavior change. Recorded here so a rollback plan
that assumes "revert one file" does not discover this the hard way.

## Test strategy (FR-17b additions)

> QA Strategist addition, 2026-08-07. Extends the table below; nothing above this line
> changed. This project already distinguishes two evidence layers (S1/Spike 3 in the
> original Test strategy, `live.test.ts`'s `ATTRACTOR_LIVE=1` gate): a `node --test` case
> against `StubBackend`/real `git` proves the **mechanism** — the code parses, the logic
> holds. A live run proves the mechanism **survives real subprocess concurrency** — nothing
> below the `StubBackend`/fake-backend line proves that, because every fake resolves on the
> next microtask regardless of what a real `claude -p` child does. Every row below states
> which layer it needs, and two rows cannot be written at all yet — the design disagrees with
> itself on the behavior they would assert (see Risks).

| Area | Risk (likelihood × impact) | Test level | Notes |
| :-- | :-- | :-- | :-- |
| `findConvergenceNode` | medium × high | unit — multi-hop convergence, no-convergence, single-branch degenerate, convergence-at-EXIT, convergence node == one of the branch roots itself | Reused by PAR-001 and the runtime; one test suite proves both agree, per this codebase's own anti-drift pattern |
| PAR-001 / PAR-002 | low × high | unit, per-shape fixtures | Mirrors HAND-001's own test structure (ADR-005) |
| `findPartialReconvergence` / PAR-004 **(new, resolves F3)** | high × high | unit — the exact "normalize" shared-by-two-of-three-branches fixture from the finding, plus disjoint-branches (no false positive), convergence-node-itself-excluded, no-convergence-degenerate (empty result, PAR-001 already refuses) | Highest-value new row this pass adds: a test that doesn't fail red on the "normalize" shape is decorative, since that shape is the literal finding |
| `findPartialReconvergence` / PAR-004, tied full common descendant **(new, 2026-08-07 fifth pass, resolves F3's residual)** | high × high | unit — the exact `root1/root2 -> {X, Y} -> combine` fixture from ADR-007's second amendment (X, Y both depth-1 from every root; whichever `findConvergenceNode` does NOT select as convergence must appear in `findPartialReconvergence`'s result and PAR-004 must ERROR); a companion case with a genuine 3-way tie; a negative control where a deeper full common descendant IS properly downstream of the selected convergence node on every path (must NOT fire — that is safe, dead code by construction) | The row the fifth-pass re-verification exists to demand — a test that doesn't fail red against the ORIGINAL (pre-broadening, "2+ but not all") `findPartialReconvergence` is decorative, since that shape is exactly the case the original wording explicitly carved out, not an accident it missed |
| PAR-005 **(new, resolves F2)** | medium × medium | unit — a branch root that reaches EXIT directly (no other branch shares it); a branch that reaches EXIT only after the convergence node (must NOT fire — that is fine, ordinary post-convergence routing) | Confirms WARNING fires only for the pre-convergence shortcut case, not every graph where EXIT happens to be reachable from a branch |
| PAR-005's WARNING does not, and must not be asserted to, halt the run **(new, 2026-08-07 fifth pass, resolves F2's residual)** | medium × medium | integration — a branch root routes directly to EXIT (PAR-005 fires WARNING, not ERROR, lint still passes); assert the run's own `RunResult` is unaffected by the branch's early EXIT (main path and sibling branches proceed to the real convergence node exactly as the "branch reaching EXIT is treated as a dead end" row above already proves) | Exists specifically to keep the corrected ADR-007 rationale honest — a future reader must not be able to write a test asserting "PAR-005 lets an early-exit branch stop the pipeline" and have it pass, because that behavior does not exist |
| Branch reaching EXIT is treated as a dead end, not a `RunResult` return **(new, resolves F2, ADR-007 amendment)** | high × high | unit/integration — a branch root routes straight to EXIT while siblings are still gated open (`GatedBackend`); assert the branch's own `BranchRunResult` reflects a trivial SUCCESS, `unsatisfiedGoalGates()`/`this.checkpoint(null)` are NOT called mid-run, and the run's real `RunResult` is produced later by the main loop reaching its own EXIT dispatch, not by this branch | Mutation-checked: a mutant that lets `runBranch` fall through to the main loop's EXIT block must turn this red |
| Context merge-back, happy path **(new, resolves F1, ADR-010)** | high × high | unit — three branches each declare a **distinct** `outputs=` key; assert the convergence node's `${key}` substitution reads each branch's real value, not empty/stale | Proves the core merge-back mechanism exists at all — a test that doesn't fail red on the ORIGINAL (pre-fix, no `mergeBranchContext` call anywhere) code is decorative. **Not** the literal ADR-010 finding scenario, which uses the SAME key across all three branches — that is a distinct property (collision resolution, not "does merge-back happen"); see the new row directly below |
| Context merge-back, exact F1 finding reproduction (three branches, one shared key) **(new, resolves F1, ADR-010)** | high × high | unit — three branches each run a node declaring the SAME `outputs=` key (ADR-010's own Context-section example: all three declare `outputs="implementation.path"`), all three SUCCEED; assert (1) pre-fix this fails red — the convergence node reads empty/stale per F1's own demonstrated defect, not merely "some" value; (2) post-fix `${implementation.path}` at the convergence node reads the THIRD (last-declared, not last-completed — drive completion out of declaration order via `GatedBackend`) branch's value; (3) exactly two `node.parallel.context_collision` events are logged (branch 2 overwriting branch 1's merge, branch 3 overwriting branch 2's) — not zero, not one | The row a check of F1 coverage exists to demand. The two-branch collision row below proves pairwise overwrite-order is correct, but an implementation that special-cases the pairwise case (e.g. an N-way reduce with an off-by-one, or logic that only ever compares the two MOST RECENT writers) would pass a 2-branch test and still fail this one — N-way collision resolving one-collision-at-a-time is a separate claim from "a single collision resolves correctly," and it is the exact shape of ADR-010's own illustrative example, not an approximation of it |
| Context merge-back, collision **(new, resolves F1, ADR-010)** | high × high | unit — two branches both write the same key with different values; assert the later-by-declaration-order branch's value wins (not completion order — drive both branches' completion out of declaration order via `GatedBackend` to prove it), and a `node.parallel.context_collision` event is logged | Mutation-checked: a mutant that merges in completion order instead of declaration order must turn this red |
| Context merge-back excludes only the three bare `ENGINE_MANAGED_KEYS`, not `tool.`-prefixed ones **(new, resolves F1, ADR-010)** | medium × high | unit — a branch runs a `TOOL` node writing `tool.last_line`; assert it IS merged and readable at the convergence node; a branch whose last node sets `current_node`/`outcome`/`preferred_label` via the ordinary per-node step logic; assert those three specifically are NOT merged (the outer run's own post-return writes are asserted to still be the ones in effect) | The distinction ADR-010 draws between this filter and `isEngineManagedKey()` is subtle enough to regress silently without a test naming it directly |
| Context merge-back skips FAILED branches **(new, resolves F1, ADR-010)** | medium × high | unit — a branch fails after partially writing a key; assert the convergence node does NOT see that partial value (contrast with the happy-path row, which uses SUCCESS branches only) | Closes the alternative ADR-010 rejected ("merge everything regardless of outcome") — a test that passes on an implementation which merges FAILED branches too is not testing the decision, only the happy path |
| PAR-003 (declared-output collision warning) **(new, resolves F1 design-time half, ADR-010)** | low × medium | unit, per-shape fixtures | Mirrors PAR-002's own WARNING test structure; static complement to the two runtime merge-back rows above, cannot see `tool.last_line`-class inferred collisions |
| Default join policy | high × high | unit — all-fail, all-success, mixed, zero-branch, one-branch | The single correction Open Question 5 exists for; a test that doesn't assert FAIL-on-zero-success is decorative |
| **Component-node FAIL routing** | **resolved 2026-08-08, [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md)** | integration — a `PARALLEL` node whose join outcome is FAIL, with and without a `retry_target` set on the component node itself; assert FAIL-with-`retry_target` jumps there and FAIL-without-one dead-ends the run, in both cases WITHOUT dispatching the convergence node; a companion SUCCESS/PARTIAL case asserts the convergence node IS dispatched unconditionally | ADR-013: the convergence-node jump fires only on SUCCESS/PARTIAL (the only structurally reachable continuation); FAIL defers to the existing §3.7 `retry_target`/`fallback_retry_target`/dead-end ladder unchanged, per `AGENTS.md`'s Fail-fast-on-FAIL doctrine |
| Concurrency ceiling **enforcement** (NFR-7, the mechanism) | high × high | unit — forced-overlap fake backend, see below | `StubBackend` resolves same-tick; it cannot force real overlap, so a test built on it would pass even against a semaphore that admits everything at once |
| Concurrency ceiling **under real subprocess load** (NFR-7, the practical ceiling) | medium × medium | **live run**, `ATTRACTOR_LIVE=1` | Spike 9 — see "Deliberately thin" below |
| Shared ledger under concurrency (goal gate inside a branch; `runs_on=failure` reacting to a sibling branch) | medium × high | integration, forced-overlap fake backend, mutation-checked | Highest tautology risk in this addition — deleting the ledger-sharing must turn the test red. **Spike 8 is reclassified**: its own question ("Promise.all-awaited branch callbacks... produce any ordering surprise") is fully answerable by this automated test today; it does not need to stay a 30-minute manual spike |
| Branch throws mid-flight (a rejected Promise, not a FAIL `Outcome`) | **medium × high — newly identified, not in the design's own text** | integration, forced-overlap fake backend that rejects for one branch while siblings are still pending | See Risks: `Promise.all` (Spike 8's own words for the dispatch mechanism) rejects as soon as one input rejects and does **not** cancel or await the others — their eventual settlement, worktree cleanup, and branch checkpoint are all orphaned unless something catches per-branch first |
| Per-branch worktree isolation | medium × high | integration, real `git` (not mocked) | Reuses `worktree.test.ts`'s existing real-git pattern rather than a fresh mock |
| `worktree.ts`'s async conversion does not change observable behavior **(new, resolves F4, ADR-011)** | medium × high | integration, real `git` — every existing `worktree.test.ts` assertion re-run against the `async` API (same fixtures, `await`ed) | Regression net for the ADR-011 migration itself, distinct from the concurrency-benefit row below; must pass BEFORE the concurrency row is trusted |
| Worktree operations no longer block sibling branches **(new, resolves F4, ADR-011)** | medium × high | integration — `GatedBackend`-held branch A stays mid-flight while branch B's `createWorktree`/`removeWorktree` runs (a real, if small, repo); assert branch A's gate can still be released and observed to resolve WHILE branch B's git call is in flight, not only after | This is the row that actually tests F4's fix, not just its API surface — a mutant that reverts `git()` to `execFileSync` should turn this red by making branch A's release observably delayed |
| Worktree cleanup when a branch errors | **medium × high — newly identified** | integration, real `git`, uncommitted work present in the erroring branch's worktree at the moment of failure | Must prove `worktree.test.ts`'s existing "never delete uncommitted work" guard still fires **per branch**, not just for the single top-level worktree it was written against |
| Checkpoint isolation under concurrency | **medium × high — newly identified** | integration — two branches' checkpoint writes interleaved via the forced-overlap backend, targeting distinct branch-scoped `runDir`s; one unit test racing two `saveCheckpoint` calls on the SAME `runDir` as a negative control | See Risks: the temp-file uniqueness key is `process.pid` alone (`checkpoint.ts:94`), and concurrent branches share one process |
| Retry inside a branch, target resolves outside the branch's own reachable set | **medium × medium — newly identified** | integration — a branch node's `retry_target` (or the graph-level fallback, `resolveRetryTarget`'s `includeGraphLevel` rung) points at a sibling branch's node, or at the convergence node itself | Answer 5 assumes the target stays "inside the branch's own reachable set" without anything in the design enforcing that; `ADR-003`'s graph-level rung in particular has no notion of "branch membership" to respect |
| Retry/partial-completion interacting with convergence | medium × high | integration — 3 branches, one exhausts retries and fails a node with a declared `outputs=` key the convergence node consumes | Exercises the existing `failedOutputs` eager-input-check mechanism under branch partiality for the first time; must assert the convergence node is correctly blocked, not silently given a stale value |
| Worktree branch-name collision under real concurrency | low × high | **now automatable as integration** (real `git`, `Promise.all` over concurrent `createWorktree` calls sharing a plausible `runId` scheme) | Reclassified from Spike 10 — no live LLM backend is needed to exercise real concurrent `git worktree add`, only real concurrent git calls |
| Backend `cwd` plumbing | low × high | unit — `BoxHandler` passes `ctx.cwd`; `ClaudeCodeBackend` prefers the per-call value over its constructor-bound one | Closes the exact silent-incompleteness named in Migration above |
| Step budget shared across branches | low × medium | unit — construct a graph where main-path + branch steps together exceed 500 but neither alone does | **Now buildable, not just specifiable — corrected 2026-08-07 (F5, ADR-012):** `this.stepCount` is a real field this test can assert against directly; the original text described this row before the field existed |
| A branch that hits the shared step cap ends with FAIL, not a hang **(new, resolves F5, ADR-012)** | medium × high | unit — a branch containing a `retry_target` routing cycle that never reaches `stopAt`/EXIT/a dead end, with `maxSteps` set low enough to reach in-test; assert `Engine.run()` still returns a well-formed `RunResult` (via the join policy consuming the branch's FAIL) rather than the test itself timing out | This is the row that directly falsifies F5's own failure scenario; a mutant that reverts `stepCount` to a loop-local variable per caller must hang this test, not just fail an assertion |
| `executeNodeStep()` is genuinely one implementation, not two **(new, resolves F6, ADR-012)** | high × high | unit — the SAME fixture graph and starting context run once through `run()`'s own loop and once through `runBranch` with `stopAt` set to a node past the graph's natural end; assert identical `path`, `attempts`, checkpoint content shape, and ledger state (modulo the branch-scoped `runDir`) | Not a parity test in the sense ADR-012 rejects (two independent implementations checked for agreement) — this asserts the ONE shared method behaves identically under its two calling conventions, which is a statement about the seam's parameterization, not about keeping two bodies in sync |

### Concurrency-specific test design

This engine's first concurrent-traversal feature needs one new test double the existing
suite has no equivalent of. `StubBackend` (`handlers/stub.ts`) is production code shared with
`--dry-run` and resolves every call on the next microtask — it cannot force two branches to
genuinely overlap, so any test built only on it is decorative for every row above marked
"forced-overlap." A **test-only** gated backend is needed, in the same spirit as the
fake-wait-plus-timer double the original Test strategy already requires for `HumanGateHandler`
(S2, "proves `await` isn't decorative") — same house pattern, reapplied to a new problem:

```ts
// test-only (engine/test/fixtures.ts or a new parallel.test.ts) -- NOT a StubBackend
// extension, because StubBackend is shipped --dry-run code and must stay same-tick.
class GatedBackend implements Backend {
  inFlight = 0
  maxObserved = 0
  private gates = new Map<string, () => void>()
  async run(node: Node): Promise<Outcome> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    await new Promise<void>((resolve) => this.gates.set(node.id, resolve))
    this.inFlight--
    return { status: Status.SUCCESS }
  }
  release(nodeId: string): void { this.gates.get(nodeId)?.() } // test drives interleaving
  reject(nodeId: string, err: Error): void { /* rejects instead of resolving, for the throw test */ }
}
```

- **NFR-7 enforcement:** 6 branches, `max_parallel=4`, release gates in a controlled order,
  assert `maxObserved <= 4` throughout and `=== 4` at least once (a semaphore that never
  actually fills to the cap would pass a `<=` -only assertion against a mutant that ignores
  `max_parallel` entirely). Repeat at the boundaries: `max_parallel=1` (must serialize),
  `max_parallel=` branch count exactly (no queueing), branch count `= max_parallel + 1`
  (exactly one branch must queue and pick up the freed slot).
- **Shared ledger:** release branch B's failing node before branch A's gate node, assert A's
  in-flight node observes `holdsUnresolvedFailure()` as true mid-run — this is the only way to
  prove the maps are read *while* still mutating, not just correct at the final snapshot.
- **Branch-throws:** `reject()` one branch while two siblings are still gated open; assert
  (a) `Engine.run()` returns a well-formed `RunResult` (FAIL), never an uncaught rejection
  escaping the public API — `cli.ts` has no handler for that today; (b) the sibling branches'
  worktrees are still cleaned up, not orphaned by `Promise.all`'s reject-and-abandon semantics.
- **Checkpoint race:** release two branches' step completions back-to-back with no `await`
  between the two `saveCheckpoint` calls in the test's own driving code, then read both the
  outer run's `runDir/checkpoint.json` and each branch's own file; assert the outer file's
  `current_node` never names a node that belongs to a still-in-flight branch.

**NFR-7 is measured in three layers, not one:**

| Layer | What it proves | Test level | Runs |
| :-- | :-- | :-- | :-- |
| 1. Ceiling enforcement | The semaphore never admits more than `max_parallel` `runBranch` calls at once | unit, `GatedBackend` | every CI run |
| 2. Worktree-creation concurrency | Real concurrent `git worktree add` calls under the run's naming scheme don't collide or race silently, **and** (corrected 2026-08-07, F4/ADR-011) don't block a sibling branch's already-in-flight work while they run — the two properties are distinct and both need coverage now that `git()` is `async` | integration, real `git` | every CI run |
| 3. Real subprocess ceiling | Node's own fd/process limits vs. `max_parallel` under real `claude -p` children (Spike 9) | **live run**, `ATTRACTOR_LIVE=1` | opt-in, not CI |

**Deliberately thin, and why — narrower than the SA's draft:** only Layer 3 above (the
OS-specific tail of NFR-7) stays a runbook; no CI environment here reliably reproduces
process/fd-limit behavior. Layers 1 and 2 are **not** thin — they are the actual mechanical
claim NFR-7 makes ("a ceiling exists and holds"), and both are fully automatable today. Filing
the whole of NFR-7 under "deliberately thin" would leave the one thing it promises unverified
while the document reads as if it were covered — exactly the gap this role exists to name.

## Risks (FR-17b additions)

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| A pipeline stage before `PARALLEL` produces a *file* (not a context key) that isolated branches then can't see, because it was never committed | medium — the engine's own convention favors `outputs=`/context, but nothing stops a file-producing TOOL node upstream | medium — silent wrong-input, not a crash; the branch's own work is simply based on stale/absent state | Document loudly in the skill/authoring guidance (a graph author must commit before fanning out, or set `isolate="false"`); a future WARNING-severity lint rule is a natural extension, not required this slice | Solution Architect / skill author |
| A custom embedder-supplied `Backend` ignores the new `cwd` param and silently keeps using its own bound cwd for every branch | medium | medium — isolated branches share a filesystem after all, quietly reopening the exact race NFR-4/Q4 exists to prevent | `ClaudeCodeBackend` (the only shipped implementation) is fixed; document the contract change for third-party backends explicitly, not only in a type signature | implementer |
| Concurrent branches racing on the outer engine's shared bookkeeping maps produce a scrambled `nodeFailures` first-failure order | low | low — cosmetic (ordering, not correctness) unless a consumer depends on exact order | Spike 8; if it matters, apply each branch's ledger delta atomically once that branch resolves rather than while it runs | implementer |
| `findConvergenceNode`'s static reachability over-approximates (ignores condition truth), so a graph could lint-pass PAR-001 with a convergence node that a *specific* runtime path never actually reaches | low | low — same class of imprecision `directPredecessor`/DATA-001 already accept at lint time; the runtime still executes correctly, it just runs the convergence node once regardless of which conditional sub-path each branch actually took | Named here rather than discovered later; matches this codebase's existing lint-is-conservative posture | Solution Architect |
| **RESOLVED 2026-08-08, [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md).** The design's own text gave two different answers for what happens when a `PARALLEL` node's join outcome is FAIL: answer 5 ("Retry inside a branch") said the existing §3.7 fail-edge/`retry_target` ladder routes it, the "Component structure" diagram's wording (echoing amplifier's own `engine.py`, not a settled decision of this document) suggested a jump unconditional on status. These could not both be true for the same run | was confirmed present in the design as written | was high — whichever is right, the FIRST author whose fan-out actually fails hits the untested one, and a fan-out failing is not a rare event (it is the entire reason a default join policy that checks for zero successes exists, per Open Question 5) | **Resolved:** the jump to the convergence node fires only on SUCCESS/PARTIAL (structurally the only reachable continuation — a component node's own outgoing edges are its branch roots, never the convergence node); FAIL defers to the unchanged §3.7 `retry_target`/`fallback_retry_target`/dead-end ladder, matching `AGENTS.md`'s non-tradeable Fail-fast-on-FAIL doctrine and answer 5's own prior wording. The "Component-node FAIL routing" row in Test strategy above is written | Solution Architect (resolved) |
| **RESOLVED 2026-08-08, [ADR-013](decisions/ADR-013-parallelhandler-fail-routing-and-branch-rejection.md).** `ParallelHandler.execute()`'s branch dispatch is named explicitly as `Promise.all`-awaited (Spike 8's own wording, not a QA inference). If any branch's `runBranch` call *rejects* — as opposed to resolving with a FAIL `Outcome` — `Promise.all` rejects on the first rejection and does not cancel or continue awaiting the still-pending sibling branches. Their eventual settlement, worktree removal, and branch checkpoint all become orphaned inside that one `ParallelHandler.execute()` call, and the rejection propagates out of `Engine.run()`, a public API surface `cli.ts` does not currently handle as anything but a FAIL `RunResult` | was medium — worktree creation failing on a name collision (Spike 10's own concern) is exactly this kind of throw, not a FAIL Outcome, and a backend crash is another plausible source | was high — orphaned worktrees and an engine that can throw instead of returning a `RunResult` are exactly the "silent degradation" class `AGENTS.md`'s doctrine forbids elsewhere in this design | **Resolved:** each branch's *entire* dispatch (worktree creation, the `runBranch` call, and worktree removal — not `runBranch` alone, since the named name-collision failure mode is in `createWorktree`, called by `ParallelHandler` itself before `runBranch`) is wrapped in one try/catch/finally converting any thrown exception to that branch's own FAIL `Outcome`. `Promise.all` stays the aggregation primitive — nothing switches to `Promise.allSettled`, since nothing can reject once the catch is in place and the `allSettled`-specific reject-discrimination path would be unreachable, untestable complexity on top of it. The "Branch throws mid-flight" test row above is written | implementer (item I/J) |
| `runBranch`'s own branch-scoped checkpoint write is safe from colliding with the outer run's `checkpoint.json` only if it calls the *exported* `saveCheckpoint(runDir, cp)` directly with a branch-scoped path. The private `Engine.checkpoint()` method (`engine.ts:247-262`) the rest of the reused per-node step logic naturally calls is hardwired to `this.opts.runDir` with no override — one easy copy-paste away from every branch silently checkpointing to the SAME file the main run does. `saveCheckpoint`'s own atomicity comment reasons about "two writers" but keys its temp-file uniqueness on `process.pid` alone (`checkpoint.ts:94`) — sufficient when the only conceivable second writer was a second OS process; concurrent branches are the same process, same pid | **was medium** | **was high if it happened** | **Resolved by construction, 2026-08-07 (F6, ADR-012):** `executeNodeStep()` — the ONE shared method both callers use — takes `runDir` as an explicit parameter and calls `saveCheckpoint(runDir, cp)` directly; `this.checkpoint()`'s hardwired-`this.opts.runDir` wrapper is no longer in the call path either caller goes through, so there is no copy-paste-shaped mistake left to make. The "`executeNodeStep()` is genuinely one implementation" Test-strategy row is the residual verification, not a fresh risk | implementer |
| **New 2026-08-07 (F1 residual, ADR-010).** PAR-003's static collision check can only see *declared* (`outputs=`) key collisions between branches. `mergeBranchContext`'s runtime collision log (`node.parallel.context_collision`) is the only thing that catches a collision on an *inferred* key — `tool.last_line`, written by any `TOOL` node inside a branch — since no lint-time attribute names that key at all | medium — two branches both running `TOOL` nodes under one `PARALLEL` is not an unusual shape | low — the runtime log makes it visible and the deterministic branch-order rule makes it reproducible; not silent, just not design-time-visible | Named explicitly here and in ADR-010's own Consequences rather than implied to be fully covered by PAR-003; a future PAR-006 extending the static check to inferred keys is a natural follow-on, not required this slice | Solution Architect |
| **New 2026-08-07 (F3 residual, ADR-007 amendment).** PAR-004 inherits `findConvergenceNode`'s condition-independent over-approximation: a graph where two branches' conditional sub-paths would, in real execution, never both actually reach a shared node can still be lint-refused, because lint cannot evaluate condition truth | low | low — a false-positive refusal, not a false-negative miss; the author must restructure a graph that was arguably fine, but no double-dispatch can slip through undetected | Matches the SAME accepted tradeoff already named for `findConvergenceNode` itself, several rows above (`directPredecessor`/DATA-001's own conservative-lint posture) — not a new kind of imprecision this amendment introduces | Solution Architect |
| **New 2026-08-07 (F4 residual, ADR-011).** `execFile`'s promisified rejection shape is *expected* to match `execFileSync`'s thrown-`Error` shape closely enough that `worktree.test.ts`'s existing message-matching assertions keep passing, but this is not yet empirically confirmed | medium — Node generally keeps these shapes close, but "generally" is not "confirmed" | medium — if it doesn't match, a batch of existing tests goes red for a reason unrelated to the feature under test, costing implementation time to triage | Spike 12 above closes this before the migration lands, not after | implementer |
| **New 2026-08-07, fifth pass (F3 residual, second gap — distinct from the row directly above).** A *tied* full common descendant — two or more nodes each independently reachable from every branch root at the same shallowest depth `findConvergenceNode` searches — was invisible to PAR-001 (existence-only check) and to the original PAR-004 wording ("reachable from 2+ but not all roots" explicitly excluded a node reachable from *all* of them). The node that lost the tie-break was a legal, unrefused double-dispatch hazard identical in kind to the original F3 finding, on a shape ("diamond of diamonds": two nodes each hanging off every branch root) that is ordinary, not exotic | **was medium** (any fan-out that reconverges more than once at the same depth) | **was high** — identical failure mode to the original F3 (a real subprocess run twice, a real ledger entry racily overwritten), just on a node the original PAR-004 wording did not cover | **Resolved by construction**, ADR-007's second amendment: `findPartialReconvergence`'s definition drops the "but not all" qualifier — a node fully reachable from every root but not selected as convergence now satisfies "reachable from 2+ roots" by construction, so PAR-004 (unchanged ERROR severity) refuses it exactly as it already refused the subset case. Closed by a **lint extension**, not a proof that ties are impossible — the worked example in ADR-007 shows they are not | Solution Architect |
| **New 2026-08-07, fifth pass (F2 residual).** `runBranch` treats a branch reaching the graph's real EXIT node as an ordinary dead end for that branch alone (ADR-007's Decision) — the main run is never stopped and sibling branches are unaffected. An author who draws `component -> exit` on one branch specifically *intending* "if this branch alone satisfies the goal, stop the whole pipeline here" gets none of that: PAR-005 fires only a WARNING (the graph lints clean if the author reads past it or ignores it), and at runtime the branch simply stops; the join policy folds it in as an ordinary leaf outcome, and the run proceeds to the convergence node exactly as if the branch had dead-ended on a node with no outgoing edge. No crash, no error, no visible sign the author's actual intent (stop everything) was not honored | medium — "stop the whole pipeline from inside a branch" is a plausible, even obvious, thing an author reaching for a shared EXIT node would expect to work, and nothing in the graph text distinguishes that intent from an ordinary early dead end | high — this is the silent-degradation class `AGENTS.md`'s own doctrine exists to catch: a WARNING an author can ignore, followed by quiet non-effect at runtime, not a loud failure | This design does not implement "stop the whole pipeline from inside a branch" at all this slice — PAR-005's WARNING severity is correct because *ending one branch's own traversal early without affecting siblings* is an independently legitimate, unrelated pattern (see ADR-007's corrected rationale), not because the stop-everything reading is supported. Whether "stop the whole pipeline from inside a branch" should become a real, separate feature — new cancellation plumbing through `ParallelHandler`'s `Promise.all`-based dispatch, not free — is a scope question for Product Owner, not decided here; until/unless it is prioritized, the skill/authoring guidance must say explicitly that a branch reaching EXIT never stops the run | Product Owner (scope call) / Solution Architect (skill copy) |
| **New 2026-08-07, fifth pass (F5 residual).** `this.stepCount` (ADR-012) is one counter shared across the main path and every concurrently-running branch, by design — this is what closes F5's original "a branch can multiply the ceiling" gap. The flip side, not previously named: a legitimately large, correctly-terminating fan-out (e.g. `max_parallel=4`, each branch doing real multi-step work) now competes for the SAME 500-step budget an equivalent sequential pipeline would have had entirely to itself. NFR-1's "500 node-visit cap" framing, read by an operator as a per-run ceiling, behaves in practice closer to "500 divided by however many branches are concurrently active," for any graph that uses `PARALLEL` at all | high — this is the ordinary, intended shape of a busy fan-out, not an edge case | medium — not a correctness bug (the FAIL-on-stepcap path is well-formed, per ADR-012, and every branch that hits it is handled exactly like a dead end), but a real, user-facing behavior change with no corresponding operator-facing warning; a graph that ran to completion sequentially can start hitting the step cap purely because it now fans out | `EngineOptions.maxSteps` (`engine.ts:36`, default `DEFAULT_MAX_STEPS = 500` at `engine.ts:86`) is already a caller-supplied override, not new code needed — document in the skill/authoring guidance that a graph using `PARALLEL` should size `maxSteps` to its actual total node-visit volume summed across every branch, not assume 500 means "500 per branch" or "500 for the main path alone" | Solution Architect / skill author |
