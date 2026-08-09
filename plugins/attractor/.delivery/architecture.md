# Architecture: attractor MVP slice — installability, human-gate blocking, two bug fixes, one lint rule

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist. Reviewed by Feature Critic.
> Status: reviewed · Last updated: 2026-08-05
> PRD: `plugins/attractor/.delivery/prd.md` · Reviews: `plugins/attractor/.delivery/reviews/prd-01.md`
>
> **Path note** (same convention as the PRD): this repo's actual paths are
> `plugins/attractor/.delivery/` and `plugins/attractor/.superpowers/`, not the
> `docs/product/...` the architecture skill's own template defaults to.
>
> **Scope:** designs only the FRs unblocked by the PRD's own review — FR-1–4, FR-5–7
> (blocking behavior only, not FR-8), FR-10, FR-11, FR-17a. FR-8, FR-9a/b, FR-12, FR-17b stay
> undesigned, pending product decisions a parallel amplifier-bundle-attractor comparison is
> informing separately.

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

# Architecture addendum, 2026-08-09: FR-17b — `ParallelHandler` and `FanInHandler`

> Phase 8 artifact. Owned by Solution Architect.
> Status: draft · Last updated: 2026-08-09
> PRD: `plugins/attractor/.delivery/prd.md`, FR-17b and Open questions 3–5 (all resolved
> 2026-08-09). Supersedes nothing above — that section's own scope note already excluded
> FR-17b as "undesigned." This addendum is that design.
>
> **Glossary note.** `plugins/attractor/.delivery/glossary.md` does not exist (confirmed
> absent, same as the PRD's own path note records). This addendum uses the engine's and
> PRD's own established vocabulary throughout — `Handler.PARALLEL`/`Handler.FAN_IN`,
> "branch," "fan-out," "join" — and coins no new term without saying so. One term is
> introduced here and flagged as such: **"branch walk"**, meaning the sequential dispatch of
> one fan-out branch's chain of nodes, from its edge-target through to (but not including)
> the shared `Handler.FAN_IN` node.

## Approach

The PRD resolved *what* ships (OQ3–5): structural branch edges off a `component` node,
`max_parallel` default 4, shared-worktree-by-default with `branch_worktree=true` opt-in
isolation, and FAN_IN's FAIL/PARTIAL/SUCCESS formula. What it explicitly left open — quoted
directly from FR-17b's own text — is "reconciling N branches converging on one join node with
the engine's single-Outcome-per-node `Handler.execute()`/`selectEdge()` dispatch model." That
reconciliation is this addendum's entire content, and it rests on one architectural move:

**`Engine.run()`'s per-node loop body is extracted into a reusable private method,
`visitNode()`, and a bounded capability to call it is threaded through `HandlerCtx` — so
`ParallelHandler` walks each branch using the exact same eager-input-check, retry-ladder,
ledger-update and checkpoint machinery the main path already uses, instead of a second,
parallel (no pun intended) copy of it.** This is the seam the PRD's own text asks a Solution
Architect for, and it is the single decision everything else in this addendum composes with.

Four supporting decisions, each grounded in files actually read:

1. **Per-branch context isolation** is a `Context.clone()` per branch (zero changes to
   `BoxHandler`/`ToolHandler` — they already just call whatever `Context` object
   `HandlerCtx.context` happens to be). Merge-back after all branches finish is scoped to each
   visited node's `effectiveOutputs()` — the SAME dataflow-contract mechanism the eager input
   check already trusts — with a deterministic, declared-edge-order conflict rule and a loud
   event on collision. See ADR-007.
2. **The join node is reached by a targeted routing bypass**, not by `selectEdge`: a
   `component` node's outgoing edges structurally mean "branch," not "route," so
   `Handler.PARALLEL`'s own `Outcome.suggestedNextIds[0]` is honored as a direct jump —
   the same category of bypass `resolveRetryTarget`'s jumps already are. See ADR-007.
3. **`FanInHandler` needs no handoff channel from `ParallelHandler` at all.** It derives
   success/fail/partial purely from graph structure (a new `directPredecessors()` — the
   plural sibling of the existing `directPredecessor()`) and a new per-node outcome ledger on
   `Engine` (`nodeStatus`), populated by the same `recordOutcome`/`recordAbandoned` calls that
   already run for every node. See ADR-007.
4. **The branch-worktree race GitHub issue #15 documents is not fixed inside
   `createWorktree`** (its own suggested-fix text scopes that fix out of this work
   deliberately). It is avoided by construction: `ParallelHandler` serializes only its own
   calls into that function, per resolved repository path, so the concurrent-`git worktree
   add`-against-one-repo shape issue #15 reproduces never occurs on this new code path. See
   ADR-008.

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `engine/src/handlers/parallel.ts` | does not exist | **new** — `ParallelHandler` |
| `engine/src/handlers/fan-in.ts` | does not exist | **new** — `FanInHandler`, `FAN_IN_OUTPUT_KEYS` |
| `engine/src/handlers/types.ts` | `HandlerCtx`/`Handler`/`Backend`, 34 lines | modified — 3 new optional `HandlerCtx` fields, 1 new exported type (`StepResult`) |
| `engine/src/core/engine.ts` | `run()`'s per-node loop body is inline, 1095 lines total | modified — loop body extracted to `private visitNode()`; step-cap counter promoted to an instance field; `defaultHandlers()` registers 2 more kinds; new `lastOutcomeByNode` ledger; `EngineOptions.repoDir?` |
| `engine/src/dot/graph.ts` | `UNREGISTERED_HANDLER_KINDS = [HUMAN, PARALLEL, FAN_IN, MANAGER_LOOP]` (graph.ts:224–229); `INFERRED_OUTPUTS_BY_HANDLER`/`SUBSTITUTABLE_ATTRS` carry `[]` placeholders for both (graph.ts:207–208, 401–402); only `directPredecessor` (singular) exists (graph.ts:151–156) | modified — `UNREGISTERED_HANDLER_KINDS` drops `PARALLEL`/`FAN_IN`; those two tables' entries updated; 2 new exports: `directPredecessors`, `resolveMaxParallel` |
| `engine/src/dot/lint.ts` | HAND-001 refuses all 4 unregistered kinds (lint.ts:514–529); no `PAR-*` codes exist | modified — HAND-001 now fires only for `HUMAN`/`MANAGER_LOOP`; 2 new rules, `PAR-001`/`PAR-002` |
| `engine/src/run/worktree.ts` | `createWorktree`/`removeWorktree`, single-writer only (issue #15 open) | **untouched** — see ADR-008 for why |
| `engine/src/cli.ts` | `createWorktree(args.cwd, runId)` for the run's own top-level worktree (cli.ts:243, 261); `new Engine({ ..., cwd, ... })` (cli.ts:288–295) | modified — one line, `repoDir: args.cwd` added to the `Engine` constructor call |
| `engine/test/lint.test.ts` | 4 tests assert HAND-001 fires on `component`/`tripleoctagon` (lint.test.ts:1379–1396, part of 1437–1446); anchor test at 1373–1377 | modified — see Test strategy |
| `engine/test/engine.test.ts` | `NO_HANDLER` fixture uses `shape=hexagon` (engine.test.ts:1191–1198) | **unaffected** — confirmed by reading the fixture; `HUMAN` stays unregistered |
| `engine/test/graph.test.ts`, `test/parse.test.ts` | assert `handlerForShape`/`handlerForNode` resolution for `component`/`tripleoctagon` (graph.test.ts:33–34, parse.test.ts:547) | **unaffected** — these test shape/type resolution, a `graph.ts` pure function untouched by registration |
| `engine/src/handlers/box.ts`, `handlers/tool.ts` | `BoxHandler`, `ToolHandler` | **untouched** — the whole point of per-branch `Context.clone()` is that neither handler needs to know it is running inside a branch |

## Component structure

```
handlers/types.ts    -- gains: StepResult, HandlerCtx.repoDir?/.runBranchNode?/.nodeStatus?
      ^
      | consumed by (all 3 are optional; every existing Handler ignores them)
      |
handlers/parallel.ts -- ParallelHandler: branch discovery off outgoing edges, max_parallel
      |                 worker pool, per-branch Context.clone() + branch_worktree opt-in,
      |                 convergence validation, effectiveOutputs-scoped merge-back
      |
      | dispatches branch nodes via ctx.runBranchNode (bound to Engine.visitNode)
      v
core/engine.ts        -- run()'s loop body extracted to private visitNode(nodeId, context,
      |                  cwd, opts); new lastOutcomeByNode ledger feeds ctx.nodeStatus;
      |                  step-cap counter is now a shared instance field so a fan-out cannot
      |                  exceed NFR-1's run-wide 500-node-visit cap
      |
      | registers
      v
handlers/fan-in.ts    -- FanInHandler: directPredecessors(graph, node.id) + ctx.nodeStatus()
                         per predecessor -> success/fail/total -> FAIL/PARTIAL/SUCCESS (OQ5)

dot/graph.ts          -- gains: directPredecessors(), resolveMaxParallel(); loses PARALLEL/
                         FAN_IN from UNREGISTERED_HANDLER_KINDS; INFERRED_OUTPUTS_BY_HANDLER
                         and SUBSTITUTABLE_ATTRS entries for both updated (still correct
                         shape, comments now say why rather than "not registered")
      ^
      | imported by
      |
dot/lint.ts           -- HAND-001 narrows automatically (reads UNREGISTERED_HANDLER_KINDS);
                         gains PAR-001 (no branches), PAR-002 (malformed branch_worktree)
```

## Interfaces and data contracts

```ts
// handlers/types.ts
export interface StepResult {
  node: Node
  outcome: Outcome
  /**
   * Where the run would go next: an edge-selected or retry-target node id,
   * or null on a dead end / unrouted FAIL. Reaching Handler.EXIT is reported
   * like any other node -- EXIT's own goal-gate handling stays in
   * Engine.run(), not here; a branch walk that reaches EXIT (a graph-
   * authoring error -- see ADR-007) is caught by the caller, not this type.
   */
  nextId: string | null
}

export interface HandlerCtx {
  node: Node
  graph: Graph
  context: Context
  runDir: string
  cwd: string
  events: EventLog
  signal?: AbortSignal
  /**
   * The git repository directory worktree operations should target.
   * Optional so every existing hand-built HandlerCtx test fixture
   * (box.test.ts, tool.test.ts, ...) keeps compiling and passing unchanged.
   * Engine.run() always populates it (opts.repoDir ?? opts.cwd) for a real
   * dispatch; only ParallelHandler reads it.
   */
  repoDir?: string
  /**
   * Run one node through Engine's OWN per-node machinery -- eager-input-
   * check, runs_on handling, dispatch, retry ladder, ledger updates -- using
   * the given `context` and `cwd` instead of the run's shared ones.
   * Populated only by Engine.run(); consumed only by ParallelHandler, which
   * calls it once per node in each branch's walk. Every other handler
   * ignores it. `checkpoint` is never called for these dispatches --
   * see ADR-007's "Checkpointing branches" section.
   */
  runBranchNode?: (nodeId: string, context: Context, cwd: string) => Promise<StepResult>
  /**
   * The most recently recorded TERMINAL Outcome status for a given node id,
   * across the whole run so far (main path or any branch). Populated by the
   * same two call sites that already maintain nodeFailures/failedOutputs
   * (recordOutcome, recordAbandoned), so it can never disagree with them.
   * Populated only by Engine.run(); consumed only by FanInHandler.
   */
  nodeStatus?: (nodeId: string) => Status | undefined
}

// handlers/parallel.ts
export class ParallelHandler implements Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}
// Outcome.status is SUCCESS whenever every branch was dispatched and all
// converged on one Handler.FAN_IN node -- individual branch failures are
// FanInHandler's business (OQ5), not this node's. FAIL is reserved for
// orchestration-level defects: no outgoing edges, or branches converging on
// more than one node, or on a node that isn't Handler.FAN_IN.
// Outcome.suggestedNextIds = [fanInNodeId] on SUCCESS -- see ADR-007's
// "Reaching the join node" section for why this bypasses selectEdge.

// handlers/fan-in.ts
export const FAN_IN_OUTPUT_KEYS: readonly string[] =
  ['fan_in.success_count', 'fan_in.fail_count', 'fan_in.total']
export class FanInHandler implements Handler {
  execute(ctx: HandlerCtx): Promise<Outcome>
}
// status = successCount === 0 ? FAIL : failCount === 0 ? SUCCESS : PARTIAL   -- OQ5, verbatim.

// dot/graph.ts
export function directPredecessors(graph: Graph, nodeId: string): Node[]
// Plural sibling of the existing directPredecessor (graph.ts:151-156): every
// DISTINCT source node with an edge into nodeId, self-loops excluded, no
// cardinality restriction (directPredecessor returns null past one; this
// returns however many there are -- FAN_IN's normal case is more than one).

export function resolveMaxParallel(node: Node): number
// node.attrs.max_parallel, parsed as a positive integer; missing, unparseable
// or <= 0 falls back to 4 (OQ3's resolved default) -- same fallback-not-
// ERROR shape as parseDuration (core/duration.ts), not runsOn/type (an open
// numeric range, not a closed value set -- see runsOn's own "fallback
// direction is the decision" comment, graph.ts:318-326, for the precedent
// this follows).

export const UNREGISTERED_HANDLER_KINDS: readonly HandlerKind[] = [Handler.HUMAN, Handler.MANAGER_LOOP]
// PARALLEL and FAN_IN removed. HUMAN and MANAGER_LOOP untouched -- neither
// is part of this change; both remain refused by HAND-001 exactly as today.

// core/engine.ts
export interface EngineOptions {
  graph: Graph
  context: Context
  runDir: string
  cwd: string
  handlers: Map<HandlerKind, Handler>
  maxSteps?: number
  runId?: string
  /**
   * The git repository directory ParallelHandler targets for
   * branch_worktree=true isolation. Defaults to `cwd` when omitted, which
   * is correct whenever `cwd` IS the actual repository (no prior worktree
   * substitution happened). The CLI sets this explicitly to args.cwd -- the
   * PRE-worktree-substitution path -- because its own `cwd` may already be
   * a worktree by the time Engine is constructed (cli.ts:288-295).
   */
  repoDir?: string
}

// dot/lint.ts -- new diagnostic codes
// PAR-001, ERROR: a Handler.PARALLEL node with zero outgoing edges (nothing to fan out to).
// PAR-002, ERROR: branch_worktree set to a value other than exactly "true" or "false" --
//   same shape and severity as HITL-002's goal_gate check (lint.ts:582-604), same reasoning:
//   a near-miss ("TRUE", "1") silently disables isolation the author believed was armed, and
//   getting this wrong means two concurrent writers corrupt each other's uncommitted work in
//   the shared worktree -- a safety-relevant boolean, not a cosmetic one.
```

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | 500 node-visit cap | The step counter moves from a `run()`-local loop variable to a private `Engine` instance field, incremented once per `visitNode()` call (main path OR any branch, including in-place retries — matching today's exact per-attempt accounting). A fan-out consuming the shared budget across all its branches cannot exceed the run-wide cap; a branch that would exceed it fails that branch, not the run | high |
| NFR-2 | Retry defaults unchanged | `visitNode()`'s retry ladder is `resolveRetryPolicy`/`backoffMs` verbatim, relocated not rewritten | high |
| NFR-3 | `parseDuration` rules | `resolveMaxParallel` follows the same "unparseable = safe fallback, no ERROR lint" shape as `parseDuration`, not a new pattern | high |
| NFR-4 | Checkpoint write safety, no lock, single-writer only | **Deliberately not exercised by branches.** `visitNode()` takes a `checkpoint: boolean` flag; branch walks pass `false`. A crash mid-fan-out loses all in-flight branch progress — but so does today's engine on a crash before any node's own checkpoint, so this is consistent with, not a regression from, the existing granularity. Named explicitly as a limitation in ADR-007, not silently accepted | high |
| NFR-5 / NFR-6 | Doctor checks / exactly 2 runtime deps | Unaffected. The `max_parallel` worker pool and the per-repo worktree-creation mutex (ADR-008) are both hand-rolled, no new dependency | high |
| NFR-7 | `max_parallel` concurrency ceiling, default 4 | Enforced by a bounded worker pool inside `ParallelHandler` — at most `resolveMaxParallel(node)` branches have an in-flight `runBranchNode` call at any instant. See Test strategy for the concurrency-observing test this requires | high |
| NFR-8 | Test suite size (context) | Will grow; see Test strategy | n/a |
| NFR-9 | Crash exposure, accepted risk | Unaffected by this addendum — parallel fan-out introduces no new human-gate interaction | high |

**New, addendum-specific NFR reasoning, not in the PRD's own table:**

- **Concurrent-writer safety of shared, in-process state.** `EventLog.append()` is a
  synchronous `appendFileSync` (run/events.ts:22–25) — concurrent branches sharing one
  `EventLog` instance produce a safely interleaved `events.jsonl`, no new lock needed.
  `checkpoint.ts`'s atomic-rename write is **not** safe against concurrent writers (this is
  exactly NFR-4's existing, documented gap) — which is why branch walks never call it (above).
  `Context.clone()` per branch means no two branches ever touch the same `Map` concurrently
  during their own walk; the one point where writes from different branches meet (merge-back)
  runs single-threaded, after every branch has already finished, inside `ParallelHandler`.
- **The GitHub issue #15 worktree race.** Confirmed open (`gh issue view 15`), confirmed
  reproducible (~1-in-15 to 1-in-25 flake, `worktree.test.ts`'s own stress test), confirmed
  scoped away from this work by its own text ("deserves its own focused design ... not
  attempted as part of the parallel-fanin sprint"). Addressed at the call site, not the
  function — see ADR-008.

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| [ADR-007](decisions/ADR-007-parallel-branch-execution-model.md) | Extract `Engine.run()`'s per-node loop into `visitNode()`, thread a bounded callback through `HandlerCtx`; per-branch `Context.clone()` with `effectiveOutputs()`-scoped merge-back; join reached via `suggestedNextIds` bypass; `FanInHandler` derives its verdict from graph structure + a new per-node status ledger, no handler-to-handler channel | A second, parallel copy of the dispatch loop inside `ParallelHandler`; unscoped context merge-back (every written key, not just declared/inferred ones); `ParallelHandler` dispatching `FanInHandler` internally instead of letting the engine do it |
| [ADR-008](decisions/ADR-008-branch-worktree-isolation.md) | Serialize `createWorktree` calls per resolved repo path, inside `ParallelHandler` only; `worktree.ts` untouched; branch worktree isolation evaluated lazily, "switch on first sight" of `branch_worktree=true` within a branch's walk | Fix the race inside `createWorktree` itself (issue #15's own text scopes this out); isolate every branch unconditionally (OQ4 explicitly rejected this); require `branch_worktree=true` only on a branch's first node |

## Spikes — what must be proven before committing

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Does `git worktree add` succeed when invoked with `cwd` set to an *existing secondary* worktree of the same repository (not the main one)? This addendum's design does **not** depend on the answer — `repoDir` is threaded through explicitly to sidestep it — but a `yes` would let a future simplification drop the `repoDir` field entirely. Low priority, not blocking | 15 min | A possible future simplification only, not this design |
| 2 | Does `execFileSync('git', ['worktree', 'add', ...])` under Node's child_process reliably surface the exact stderr text issue #15 quotes (`fatal: failed to read .git/worktrees/.../commondir`), so ADR-008's per-repo mutex can be verified to actually eliminate the flake (run the existing `worktree.test.ts` concurrent-calls test, unmodified, 80+ times, serialized through the new mutex, expect zero failures where today it's ~1-in-15–25)? | 30 min | ADR-008's own confidence claim |
| 3 | Does `Promise.all` over a small hand-rolled worker pool (no library) actually cap concurrent `handler.execute()` in-flight calls at exactly `max_parallel`, verifiable by a `StubBackend`-style instrumented handler that records a running high-water mark? Needed before NFR-7's own required test can be written with confidence in what it's asserting | 20 min | NFR-7's test, ParallelHandler implementation |
| 4 | Confirm empirically (not just by reading) that `lint.test.ts`'s anchor test (`UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually registers`, lint.test.ts:1373–1377) fails loudly if the `graph.ts` and `engine.ts` edits are applied out of step with each other (e.g. register the handlers but forget to shrink the constant) — this is the safety net the whole registration change leans on | 5 min | Confidence in the "no silent drift" claim made throughout this addendum |

## Migration and rollback

No persisted-data-format changes. `Checkpoint`'s wire shape (`core/checkpoint.ts`) is
untouched — branch walks never call `checkpoint()` (see NFR-4 above), so no new field is
added to it this slice. `RunEvent` (`run/events.ts`) gains new `type` strings
(`node.parallel.*`, `node.fan_in.*`) but its shape is already open (`[key: string]: unknown`,
run/events.ts:4–9) — an existing `events.jsonl` reader that doesn't recognise a new `type`
already has to tolerate that, by the log's own append-only, forward-compatible design.

**Every new `HandlerCtx` field is optional.** `repoDir?`, `runBranchNode?`, `nodeStatus?` —
zero existing hand-built `HandlerCtx` test fixture (`box.test.ts`, `tool.test.ts`, and any
other handler test that constructs one directly) needs to change to keep compiling and
passing. `EngineOptions.repoDir?` is optional the same way, defaulting to `cwd`.

**Rollback:** revert `defaultHandlers()`'s two new map entries and restore
`UNREGISTERED_HANDLER_KINDS` to include `PARALLEL`/`FAN_IN` — HAND-001 resumes refusing both
kinds at lint time, exactly as today, and any graph authored against the new behavior simply
fails to lint (loud, not silent). The `visitNode()` extraction is a pure refactor of the main
path's own existing behavior; if it needs to be reverted independently of the handler
registration, the extracted method's contract (this document's `StepResult`) is precise enough
to verify behavioral equivalence against `engine.test.ts`'s existing suite before removing it.

**One behavioral note, not a breaking change:** a `component`- or `tripleoctagon`-shaped node
in an EXISTING graph today lints ERROR (HAND-001) and cannot run at all. After this change it
lints clean and runs. No existing committed `.dot` file uses either shape outside
`engine/test/` fixtures (confirmed by the same `git ls-files "*.dot"` sweep ADR-005 already
recorded returning zero results), so there is no silently-changing existing pipeline.

## Test strategy

Matching `box.test.ts`/`tool.test.ts`'s own convention: a small `parseDot`-built fixture graph
at module scope, a `run(nodeId, ...)` helper building fresh `runDir`/`cwd` temp directories,
`StubBackend` for any branch containing an LLM (`box`) node.

| Area | Risk (likelihood × impact) | Test level | Notes |
| :-- | :-- | :-- | :-- |
| Branch discovery (every outgoing edge is a branch) | low × high | unit, `ParallelHandler.execute()` directly, 1/2/many-branch fixtures | Assert branch count == outgoing edge count, no separate attribute consulted |
| `max_parallel` concurrency cap | medium × high | unit, instrumented stub handler tracking a running high-water mark of concurrent `execute()` calls, asserted `<= max_parallel` across 2×`max_parallel` branches | This is NFR-7's own required test, previously blocked ("no test possible yet") — now buildable |
| Per-branch context isolation | high × high | unit, two branches each writing a DIFFERENT `outputs=`-declared key with the SAME name to DIFFERENT values concurrently (via a stub backend with an artificial delay on one branch) — assert both land, in declared-edge order, with a `node.parallel.context_conflict` event when they collide on the SAME key | Highest-value new test in this addendum — this is the race the whole `Context.clone()` design exists to prevent; a test that doesn't force real concurrent writes (e.g. two branches that both finish instantly) would not catch a regression to "one shared Context" |
| Declared/inferred-only merge-back | medium × medium | unit, a branch's box node writes an UNDECLARED, uninferred context key — assert it does NOT survive past the branch boundary; a tool node's `tool.last_line` (inferred) DOES | Pins the `effectiveOutputs()`-scoped design decision against silent widening |
| `branch_worktree=true` isolation | medium × high | integration, real git repo in a temp dir (matching `worktree.test.ts`'s own `repo()` helper), one isolated branch + one shared branch, assert the isolated branch's writes are on its own branch and invisible to the shared worktree, and vice versa | Reuses `worktree.test.ts`'s own fixture-building convention, not a fresh one |
| Issue #15 race is closed on this new path | high × critical | integration, `max_parallel`-many branches ALL setting `branch_worktree=true` against ONE real repo, repeated 80+ times (matching issue #15's own repro count) via the concurrency-mutex, expect ZERO `fatal: failed to read .git/worktrees/.../commondir` failures | This is the test Spike 2 above previews; it must run enough iterations to have statistical confidence against a ~1-in-15–25 flake, not a single pass |
| `FanInHandler`'s FAIL/PARTIAL/SUCCESS formula | low × critical | unit, `FanInHandler.execute()` directly with a hand-built `nodeStatus` stub returning 0/some/all FAIL among N predecessors | Directly pins OQ5's formula; independent of `ParallelHandler` entirely, per the no-handoff-channel design |
| Join-node routing bypass | medium × high | integration, `Engine.run()` end to end on a `component`→branches→`tripleoctagon`→exit graph, assert `path` reaches the fan-in node exactly once regardless of branch count, and `edge.taken` events show the bypass | Also the test that proves branches never each independently try to "continue past" the join |
| Convergence-mismatch is a loud FAIL | low × medium | unit, a malformed fixture where two branches route to different next nodes | Pins the orchestration-level-FAIL behavior described in the Interfaces section |
| `visitNode()` refactor is behavior-preserving on the main path | high × critical | **the entire existing `engine.test.ts` suite must still pass unmodified**, run before anything else in this addendum is considered done | This is the regression gate for the extraction — a refactor of 1095 lines of load-bearing, heavily-commented control flow with no behavioral intent to change the main path at all |

**Existing tests that will break and must be updated, not just re-run:**

- `lint.test.ts:1379–1387` (`HAND-001 fires for a node resolving to Handler.PARALLEL`) and
  `lint.test.ts:1389–1396` (`... Handler.FAN_IN`) — both assert a diagnostic that will no
  longer fire. **Delete both.**
- `lint.test.ts:1425–1435` (`HAND-001 does not fire for any registered handler kind`) — the
  natural home for their replacement: add `component`/`tripleoctagon` nodes to this fixture's
  graph, proving HAND-001 stays silent on them now that they're registered.
- `lint.test.ts:1437–1446` (`HAND-001 reports one diagnostic per offending node, not one per
  graph`) — currently uses `a [shape=component]` / `b [shape=tripleoctagon]` as its two
  offending nodes. **Repoint to two nodes from the remaining unregistered set**, e.g.
  `a [shape=hexagon]` / `b [shape=house]`.
- `lint.test.ts:1373–1377` (the anchor test) needs **no edit** — it re-derives its expectation
  from `defaultHandlers()` and `UNREGISTERED_HANDLER_KINDS` at test time. This is the
  loud-drift-trap ADR-005 built and Spike 4 above exists to re-confirm still works.
- `dot/graph.ts`'s `INFERRED_OUTPUTS_BY_HANDLER`/`SUBSTITUTABLE_ATTRS` exhaustiveness test
  (referenced in graph.ts:196–198, actual file not yet located by name in this pass — **the
  implementer must locate and re-run it**, since it iterates `Object.values(Handler)` and
  would need no structural change, only re-execution, given both tables stay total)

**Confirmed unaffected, checked by reading rather than assumed:** `engine.test.ts`'s
`NO_HANDLER` fixture (engine.test.ts:1191–1198, uses `shape=hexagon` — `Handler.HUMAN`, which
stays unregistered); `graph.test.ts:33–34` and `parse.test.ts:547` (pure shape/type resolution,
untouched by handler registration).

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| `visitNode()` extraction subtly changes main-path behavior (checkpoint timing, retry accounting, event ordering) despite no intended change | medium | critical — silent regression across the whole engine, not just the new feature | Full existing `engine.test.ts` suite as the regression gate, run before any new test; extraction reviewed line-by-line against today's loop, not rewritten from a description | implementer |
| A future author writes `condition=`/`label=`/`weight=` on a `component` node's outgoing (branch) edge, expecting ordinary routing semantics; `ParallelHandler` ignores all three since branch edges mean membership, not routing | medium | medium — silently ignored attribute, not a crash | Named here and in ADR-007; a `PAR-003` WARNING lint rule (not built this slice) is the natural follow-up — flagged for Product Owner prioritization, not assumed into this scope | Product Owner (prioritization) |
| Static verification that every `component`'s branches structurally converge on exactly one `Handler.FAN_IN` node (a lint-time version of `ParallelHandler`'s own runtime check) is not built this slice | low | medium — the runtime check (this design) already fails loudly and safely; lint would only move the discovery earlier | Named as follow-up work, not built — runtime safety property is not dependent on it | Product Owner (prioritization) |
| Branch-worktree naming can collide across two separate invocations reusing the same `--run-dir` | low | medium | Inherits, does not add to, NFR-4's already-documented `--run-dir` reuse risk (Open question 8) — no new mitigation invented here | Product Owner (already tracked under NFR-4/OQ8) |
| The per-repo worktree-creation mutex (ADR-008) is `ParallelHandler`-instance-scoped; it does not serialize across two separate `Engine`/process instances hitting the same repo | low (not reachable by any pipeline running through the CLI, which runs one `Engine` per process) | medium if an embedder runs multiple `Engine`s concurrently against one repo | Named explicitly, matches issue #15's own "not urgent, not reachable today" framing; issue #15 itself remains the tracked fix for the broader, cross-process case | implementer / issue #15 |
| `checkpoint.ts`'s existing single-writer assumption is not strengthened, and a crash mid-fan-out loses all in-flight branch work | accepted, pre-existing shape at a new size | medium | Named explicitly in NFR-4 above rather than silently inherited; matches this slice's own PRD non-goal ("general checkpoint-based crash recovery... no read-back mechanism exists and none is scoped into this slice") | Product Owner (already a stated non-goal) |

