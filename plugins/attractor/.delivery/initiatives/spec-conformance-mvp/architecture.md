# Architecture: attractor MVP slice — installability, human-gate blocking, two bug fixes, one lint rule

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist. Reviewed by Feature Critic.
> Status: reviewed · Last updated: 2026-08-05
> PRD: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md` · Reviews: `plugins/attractor/.delivery/reviews/prd-01.md`
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
