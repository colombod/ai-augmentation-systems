# PRD: attractor — correct spec implementation and pipeline-authoring layer, MVP slice

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Last updated: 2026-08-05
> Brief: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/brief.md`
>
> **Path note:** the `delivery` skill's own template defaults to `docs/product/...`
> throughout, including its glossary reference. This project's actual paths are
> `plugins/attractor/.delivery/` and `plugins/attractor/.superpowers/` — moved there
> after the brief phase because the plugin marketplace convention (root `AGENTS.md`)
> requires every plugin to own everything under its own `plugins/<name>/` directory.
> No `glossary.md` exists yet at either the old or the new path; terms below use the
> engine's and brief's own established vocabulary.

## Summary

Closes the gap between what `plugins/attractor` claims to do and what running it actually
does, for the four personas in `plugins/attractor/.delivery/personas/`: installability, a
working human gate, parallel fan-out (or an honest refusal of it), and three engine bugs
found by direct execution during this project's own reconciliation work. Authoring
assistance (S7) is a stretch scenario, explicitly not required for this slice to ship.

## Goals and non-goals

**Goals**

- The plugin installs via the marketplace and is usable without cloning the source repo (S1).
- A human-gate pipeline blocks and resumes correctly while waiting. How an answer arrives has two competing, unreconciled designs — see Open questions 1-2 — and is not yet settled or implemented (S2).
- Open questions 3-5 (branch-declaration syntax, worktree isolation, fan-in-on-all-fail semantics) were resolved 2026-08-07 — FR-17b (parallel fan-out actually executing) is unblocked and specified. FR-17a (lint refusal of the other, still-unregistered handler kinds — `Handler.FAN_IN`, `Handler.MANAGER_LOOP` remain unregistered until their own implementation lands) already shipped separately and needs no rework.
- A graph with no `outputs=` declared cannot silently report `status: success` on a real, unrecovered failure (S4) — this project's own founding incident, without the goal-gate judge. The resolution mechanism (runtime verdict change vs. lint-time refusal) is undecided; see FR-9a/FR-9b and Open question 9.
- Two confirmed, reproduced engine bugs are fixed: a plain node's FAIL wrongly consulting a graph-level `retry_target` (S5/D7), and an embedded `Engine` not enforcing the same lint gate the CLI already does (S6/F10).

**Non-goals**

- Durable park/resume across a process restart for human gates (interpretation (b)) — a reader of S2 might assume this ships; it explicitly does not.
- General checkpoint-based crash recovery for any interrupted run, independent of human gates. The brief's cost-of-status-quo and success-signal language cover resumability generically, but no read-back mechanism exists and none is scoped into this slice. Distinct from interpretation (b) above, which is specific to human gates — this is the broader, still-unaddressed case.
- Any authoring-layer capability (S7) being required for this slice — it is valuable and may ship in parallel, but nothing else here depends on it.
- Composition/reuse (Persona P-3's need) — no implemented mechanism exists at all; not scoped into this slice, needs its own research pass first.
- Multi-provider model routing (`model_stylesheet`) — architecturally out of scope, not merely deferred.

## User scenarios

The scenarios below were produced by three sequential agent passes — Product Owner draft, Business Analyst stress-test (unhappy-path checklist + NFRs-as-numbers), QA Strategist verifiability pass (every criterion checked by actually constructing the test, several rewritten, some confirmed blocked on an open question rather than fixable by wording). No separate working-record file capturing that intermediate work was committed; the table below, together with the FR/NFR tables it feeds, is the only durable record of it — treat it as complete, not as a summary of something fuller that exists elsewhere.

| ID | Scenario | Actor(s) | Status |
| :-- | :-- | :-- | :-- |
| S1 | Install without cloning the monorepo | P-2 | Consolidated into FR-1–FR-4; only P-2's install/discover/doctor journey is covered this slice, not P-1/P-3/P-4's |
| S2 | Human gate blocks; how it's answered is unsettled | P-2 | 2 criteria confirmed build-agnostic, 1 reframed as a non-goal check, 1 (FR-8) resolved 2026-08-06 — see Open question 1. Answer-delivery architecture is now the channels design; NFR-9's crash-during-wait risk stays narrowed to the `human` hop, not eliminated, this slice |
| S3 | Parallel fan-out, targets A/B | P-2 | Unblocked 2026-08-07 — Open questions 3-5 resolved, FR-17b now specified. FR-17a (lint refusal of the other already-known-unregistered handler kinds) already shipped separately |
| S4 | Graph missing `outputs=` must not silently report success | P-2, P-1 | Criteria conflict with an existing, deliberately-reasoned regression test — flagged, not resolved |
| S5 | D7 bug: plain-node FAIL must not consult graph-level `retry_target` | P-2 | Coverage gap found and closed — original fixture proves only one of two code paths; second fixture added |
| S6 | F10 bug: embedded `Engine` must refuse a lint-dirty graph like the CLI | P-2 | Confirmed live by direct execution; one scope boundary flagged (embedder cannot see WARNING-severity diagnostics even after the fix — separate decision) |
| S7 | Authoring layer generates a runnable pipeline from plain language | P-1, P-4 | **Shipped 2026-08-10** — deprioritization overridden by explicit project-owner direction, checked and confirmed still technically valid before overriding, not assumed stale; see [ADR-015](../../decisions/ADR-015-s7-deprioritization-override.md) |

**S4's conflict, resolved 2026-08-09 — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md).** The fix as originally scoped would have required overturning a currently-passing test (`engine/test/engine.test.ts:1474`, `'I1 is opt-in...'`) whose own comment records that an earlier, near-identical fix was tried and **withdrawn** as a specification contradiction (`engine.ts:140-160`) — the Product Owner chose instead to scope S4 down to a lint-time-only refusal (`GATE-002`, FR-9b) that never touches the runtime verdict. See FR-9a (rejected)/FR-9b (accepted) and Open question 9.

## Functional requirements

| ID | Requirement | Scenario | Priority |
| :-- | :-- | :-- | :-- |
| FR-1 | `plugins/attractor/.claude-plugin/plugin.json` exists with a valid semver `version`; a corresponding `.claude-plugin/marketplace.json` entry at repo root resolves to it | S1 | must |
| FR-2 | Installing via `/plugin install attractor@ai-augmentation-systems` in a fresh session surfaces at least one discoverable `attractor` command/skill | S1 | must |
| FR-3 | An invalid `plugin.json` (unparseable JSON) fails install with a message naming the file and the parse problem, not a generic error | S1 | must |
| FR-4 | `attractor doctor` correctly reports `claude` as `MISSING` when absent from `PATH` (already true today — this is a coverage assertion, not new code) | S1 | must |
| FR-5 | A pipeline reaching a human-gate node blocks the process; no `status:` line is printed and the process remains alive until answered | S2 | must |
| FR-6 | No implicit edge is taken while a human gate is unanswered, for any wait duration | S2 | must |
| FR-7 | `HITL-001`'s existing test cases (`engine/test/lint.test.ts`) pass unmodified | S2 | must |
| FR-8 | *(resolved 2026-08-06 — see Open question 1)* An answer reaches the gate and takes the matching edge, per the channel-abstraction architecture (`.superpowers/specs/2026-08-05-human-gate-channels-design.md`): `Channel` → `GateContext` → `preferredLabel` → `selectEdge`. `.superpowers/specs/2026-08-03-attractor-claude-code-plugin-design.md` §7-8 (park/checkpoint/`attractor resume`) is superseded, not authoritative. Not yet implemented — `Handler.HUMAN` is still unregistered | S2 | must |
| FR-9a | **RESOLVED 2026-08-09, NOT the chosen path — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md).** A runtime-verdict change (a graph reaching exit with an unrecovered node failure and no `outputs=` declared returns a run-level `status` other than `success`) would reverse the specific, recorded decision at `engine.ts:140-160` and reopen a previously withdrawn fix — the Product Owner decided against it, per the spec's own literal §11.3 reading | S4 | rejected |
| FR-9b | **RESOLVED 2026-08-09 — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md).** The chosen path: a new lint rule, `GATE-002` (ERROR), refuses a graph with no `goal_gate` node containing an edge whose condition is satisfiable regardless of its source node's outcome because it depends on a key nothing in the graph produces — before the run starts; the runtime verdict is unchanged, consistent with the currently-passing `'I1 is opt-in'` test (`engine/test/engine.test.ts:1474`) | S4 | must |
| FR-10 | `resolveRetryTarget`'s graph-level fallback is scoped out of both §3.7 call sites (`engine.ts:1021` **and** `:1165`), not only the one the original repro fixture exercises; both a plain-FAIL fixture and a retry-exhaustion fixture (`max_retries` set) must terminate without consulting the graph-level `retry_target` | S5 | must |
| FR-11 | A direct `new Engine(...)` embed refuses to run a graph carrying an ERROR-severity lint diagnostic, matching the CLI's existing refusal | S6 | must |
| FR-12 | *(resolved 2026-08-10 — see Open question 7)* `RunResult.lintWarnings` surfaces the WARNING-severity subset of `run()`'s own internal `lint(graph)` call, present only when non-empty. Implemented — `colombod/ai-augmentation-systems#16` | S6 | should |
| FR-13 | **Shipped 2026-08-10** — `verify-run.ts` (story `p6-06`), a new delegated execution-verification gate invoked via the Task tool. Every graph the authoring skill hands back as "ready" is accompanied by a real execution transcript (`events.jsonl`, terminal `status`/`path`) produced by a delegated, independent verification step — not the same session that authored the graph, per `AGENTS.md`'s rule ("verification inside the context that produced the evidence is not verification") and the ported `attractorify` skill's own independent-verifier convention | S7 | could |
| FR-14 | **Shipped 2026-08-10** — the six-registered-handlers constraint, stated in `dot-reference.md`, the `attractor-expert` agent, and `attractorify/SKILL.md` (stories `p6-02`/`p6-04`/`p6-05`), backstopped by the existing `HAND-001` lint rule. The skill never generates a graph using a handler not registered in the build it's running against | S7 | could |
| FR-15 | **Shipped 2026-08-10** — `routing-reference.md` (story `p6-02`). The skill's reference material states routing verdicts are `goal_gate=true`-only, matching `argv.ts:42-43` exactly | S7 | could |
| FR-16 | **Shipped 2026-08-10** — six worked examples under `skills/attractorify/examples/`, each actually executed with a committed transcript and a falsifiability test that re-runs them fresh (story `p6-07`). No worked example in the skill's reference material is described as working without having been executed on this engine — the "1 of 4, not 2 of 4" precedent (`spec-conformance.md`) is the standard to match | S7 | could |
| FR-17a | Lint refuses, before a run starts, any node whose resolved handler kind is `Handler.PARALLEL`, `Handler.FAN_IN`, or `Handler.MANAGER_LOOP` — the set `graph.ts` already marks, in its own inline comments, as known but not registered in `defaultHandlers()` — citing the handler and the missing-implementation reason. (`Handler.HUMAN` is excluded from this set: S2/FR-5-8 registers it separately, in this same slice.) Needs none of Open questions 3-5 | S3 | must |
| FR-17b | *(resolved 2026-08-07 — see Open questions 3, 4, 5)* A `Handler.PARALLEL` (`component`) node fans out to every one of its outgoing edges as a branch, capped at `max_parallel=` (default 4), each branch isolated in its own git worktree by default (opt-out attribute, name set at architecture time), joining via a default policy that returns FAIL when every branch fails and SUCCESS/PARTIAL_SUCCESS otherwise — no separate fan-in node required for the fail-closed guarantee. **Shipped 2026-08-08** (sprint 3, story `p5-08`) — `Handler.PARALLEL` is registered and running; `Handler.FAN_IN` remains unregistered, unaffected by this requirement (no separate fan-in node was ever required) | S3 | must |
| FR-18 | A new lint rule (`HITL-003`, WARNING) flags an agent-inclusive human-gate chain (`human.channel` containing `"agent"`) whose `human.context=` can be traced to a single, structurally-provable direct predecessor node — closing the single-hop, `Handler.CODERGEN`-shaped instance of the self-report hazard the Plan 4 reconciliation review surfaced (`.superpowers/carry-forward.md`, Plan 4). Advisory only: does not block a run, and does not close multi-hop or `Handler.TOOL`-without-declared-`outputs=` self-report shapes — see ADR-006's `## Residual risk` section (`.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`) | S2 | must, before `agent` channel ships |

## Non-functional requirements

Every value below is cited against the running code, not invented; see the brief and `spec-conformance.md` for full derivations.

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Total step cap per run | 500 node-visits (`engine.ts:199`) | `events.jsonl` step count at termination |
| NFR-2 | Default retry policy | `maxRetries=0`, `initialDelay=200ms`, `factor=2`, `maxDelay=60000ms`, `jitter` on (`retry.ts:19-30`) | `retry.test.ts`'s existing suite |
| NFR-3 | Per-node timeout parsing | bare int = seconds; `ms`/`s`/`m`/`h` suffix supported; unparseable = no timeout (`duration.ts:12-20`) | No dedicated test exists — confirmed, no `duration.test.ts` in `engine/test/`. `box.test.ts` covers end-to-end timeout-abort behavior at one value, not these parsing rules directly. Gap, not a citation to trust |
| NFR-4 | Checkpoint write safety | atomic **per single writer** (PID-suffixed temp file, fsync, rename, directory fsync) — **not safe against two concurrent writers sharing one `--run-dir`; no lock exists** (`checkpoint.ts:62-104`, confirmed by reading the write path directly). Worked example: two `attractor run` invocations pointed at the same `--run-dir`, started close together, each compute a distinct PID-suffixed temp file, and each `rename()` onto the same target path — whichever renames last wins silently; the other's progress is discarded with no error surfaced. Not yet reproduced by execution, code-read only | See Open question 8 — currently an accepted, undetected risk |
| NFR-5 | Preflight checks (`attractor doctor`) | 3 required (`claude`, `git`, `sh`) + 2 optional (`bun`, `dot`) | `doctor.test.ts` |
| NFR-6 | Runtime/dev dependency count | 2 (`@ts-graphviz/ast`, `esbuild`) | `package.json` |
| NFR-7 | Parallel fan-out concurrency ceiling | **4** (`max_parallel=` node attribute, optional, resolved 2026-08-07 per Open question 3 — amplifier's own default, adopted not merely cited) | Config default in the eventual `handlers/parallel.ts`; overridable per node |
| NFR-8 | Test suite size (context, not a target) | 462 tests as of the brief's writing — itself subject to the citation-decay risk the brief documents; re-verify with `node --test` before trusting it past this document's date | `plugins/attractor/engine`, `node --test` |
| NFR-9 | Unattended crash exposure during an unanswered human gate | A process death while blocked at S2's gate loses the entire run to that point. Resolved 2026-08-06 in favor of the 2026-08-05 channels design, which narrows this to the `human` hop only (the `agent`/`CommandChannel` hops don't hold process-resident state the same way, but neither checkpoints mid-wait either). The 2026-08-03 park/checkpoint spec's cross-restart survival is not adopted — see Open question 1 | Accepted, undetected risk this slice, by design choice — see Open question 1 and Non-goals. `checkpoint.ts`/`loadCheckpoint` (already implemented, currently unwired) are the intended future basis for closing this, additively on top of `Channel`, not a reason to revisit this decision now |

## Assumptions

- That `plugin.json`/`marketplace.json` packaging happens in *this* repository, not solely in `ai-augmentation-systems` — genuinely unresolved (Open question 6); FR-1/FR-2 assume it happens here.
- That FR-5's live-blocking `human` hop, as ADR-002 decided it, is the channels design's `human` channel implementation — resolved 2026-08-06 (Open question 1); the 2026-08-03 park/checkpoint design does not apply and is superseded for S2.
- That `--allow-agent-gates` defaulting to off, requiring both the graph's and the operator's opt-in, is the right trust boundary for the `agent` channel — a deliberate, conservative choice, not yet tested against a real operator's workflow. FR-18 (`HITL-003`) partially mitigates the self-report risk the reconciliation review surfaced; it is a WARNING-only, single-hop check, not a closed risk — see FR-18 and ADR-006's `## Residual risk` section (`.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`).
- That amplifier's `pr-review.dot` (referenced only externally today, not committed) is representative enough of a real parallel workload to justify its structure once S3 is unblocked.

## Open questions

Questions 1, 3, 4, 5, 7, 9 now have prior art to read alongside them — see
`plugins/attractor/.delivery/initiatives/spec-conformance-mvp/amplifier-precedent.md` (§1-4), not a decision on its own.

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **RESOLVED 2026-08-06.** A multi-lens comparison (persona fit, engineering cost, doctrine alignment, requirement coverage, extensibility risk; two independent judges; one final synthesis) converged 5/5 on the channel-abstraction design (`.superpowers/specs/2026-08-05-human-gate-channels-design.md`) over the 2026-08-03 park/checkpoint design (`.superpowers/specs/2026-08-03-attractor-claude-code-plugin-design.md` §7-8, now marked superseded): only the channels design has an architectural slot for the two hard, user-stated requirements (arbitrary bespoke/pluggable channels, an opt-in `agent`-proxy channel) that the park/checkpoint design predates. Full record in `.superpowers/carry-forward.md` under "Plan 4." | Product Owner | FR-8 — unblocked |
| 2 | **RESOLVED 2026-08-06, same decision as Q1.** The channels design's §6 preflight (reachability + per-hop viability check, refusing the run before any node executes if no channel is viable) supersedes the 2026-08-03 design's narrower `--unattended`/`on_timeout`-only check from §7.4. | Product Owner | S2 scope — unblocked |
| 3 | **RESOLVED 2026-08-07.** Every outgoing DOT edge from a `component` node is a branch — no separate branch-listing attribute, matching amplifier precedent exactly. Concurrency cap is an optional `max_parallel=` node attribute, **default 4** if absent (amplifier's own default, adopted as this engine's default too, not merely cited as evidence). | Product Owner | FR-17b, NFR-7 — unblocked |
| 4 | **RESOLVED 2026-08-07, diverging from amplifier by design.** Branches are **isolated by default**, each getting its own git worktree via an extension of the already-existing `run/worktree.ts` machinery (today used for per-run isolation only). Amplifier shares one filesystem with no isolation option at all; this engine already has the real asset to do better, and this project's own PRD already names the identical race (NFR-4, two writers on one `--run-dir`, no lock, silent data loss) as an accepted-but-undetected risk elsewhere — parallel fan-out must not reintroduce that same class of defect by default. An opt-out attribute (name TBD at architecture time) covers read-only/coordination-only branches that don't need isolation. | Product Owner | FR-17b |
| 5 | **RESOLVED 2026-08-07, correcting an inconsistency in amplifier itself.** Amplifier's own component-level join policy returns `PARTIAL_SUCCESS` even when every branch failed (never checks for zero successes) — fail-open unless the author separately wires an optional `tripleoctagon` fan-in node with ranking logic, which the canonical example does but nothing requires. This engine's **default join policy itself checks for zero successes and returns FAIL** in that case, no separate fan-in node required — matching `AGENTS.md`'s "loud aborts over silent degradation" doctrine directly, the same reasoning `HAND-001`/`HITL-001` already apply elsewhere in this project. | Product Owner | FR-17b |
| 6 | Does plugin packaging (FR-1/FR-2) happen in this repository, or does it belong solely in `ai-augmentation-systems`? Root `AGENTS.md` lists `attractor` under "Current and planned" without saying which. FR-1/FR-2 are already written assuming this repository (see Assumptions) — this question confirms or corrects that assumption; it does not block starting them. | Project owner | Confirms the target repo for FR-1/FR-2; does not block them |
| 7 | **RESOLVED 2026-08-10.** Yes, via `RunResult.lintWarnings` (`colombod/ai-augmentation-systems#16`): `Engine.run()` already computes `lint(graph)` internally to check `hasErrors()` — the WARNING-severity subset of that same, already-computed result is now surfaced on the returned `RunResult`, present only when non-empty. No new I/O (`Engine` still writes nothing to stdout/stderr — that property is unchanged), no new public method, ERROR-severity diagnostics deliberately excluded (already have a channel via `hasErrors()`/`failureReason`). Amplifier precedent §4's "return the full list by default" was considered and not followed as-is: their `lint()` is the ONLY channel embedders have, ours already has a standalone, directly-importable `lint()` function independent of `Engine` (which `cli.ts` itself uses) — this closes the narrower gap of an embedder who constructs `Engine` without separately calling `lint()` and would otherwise get silent parity with an unattended run instead of the CLI's attended one. | Solution Architect | FR-12 — unblocked |
| 8 | S1: is a two-run collision on one `--run-dir` (no lock exists, confirmed by reading the write path) an accepted operator-error risk, or does the engine need to detect and refuse it? | Product Owner | NFR-4 |
| 9 | **RESOLVED 2026-08-09 — see [ADR-014](decisions/ADR-014-open-question-9-fr9b-lint-time-refusal.md).** FR-9b (lint-time refusal, `GATE-002`), not FR-9a — closing the `outputs=`-opt-in gap does not override the specific, recorded reason a near-identical runtime-verdict fix was withdrawn once already (`engine.ts:140-160`, a §11.3 contradiction); the spec's own literal text supports the current runtime behavior, and the founding incident's own failure shape (a gate that judged wrong) doesn't clearly generalize to a graph with no gate at all. | Product Owner + Solution Architect | FR-9a (rejected), FR-9b (accepted) |
| 10 | Carried forward from the brief (open question 4, `brief.md:112`, unresolved there): is content-differentiated fidelity (§5.4's five modes, currently all behaving identically) an accepted permanent divergence, or a real gap to build? No FR in this PRD scopes it either way. | Project owner | This PRD's own scope — currently neither in nor explicitly out |
| 11 | `HITL-003` (FR-18) does not detect multi-hop self-report chains — a `Handler.CODERGEN` node two or more hops upstream of an agent-inclusive human gate, through an intermediate node of any other kind, is invisible to the rule, which inspects only the direct predecessor. Is a multi-hop-tracing extension worth building, and if so, how far back does it trace? See ADR-006's `## Residual risk` section (`.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`). | Product Owner | Future `HITL-003` extension work |
| 12 | `HITL-003` (FR-18) does not detect `Handler.TOOL` predecessors, declared or undeclared `outputs=`, since a tool node's context write is conditional on its exit code and so cannot be proven at lint time. Is a `Handler.TOOL`-aware extension worth building, and if so, on what basis (declared `outputs=` only, or a broader heuristic)? See ADR-006's `## Residual risk` section (`.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`). | Solution Architect | Future `HITL-003` extension work |
| 13 | `HITL-003` (FR-18) does not detect a gate fed by two or more genuinely different direct-predecessor nodes, even when every one of them resolves to `Handler.CODERGEN` — a rework/retry loop (an initial review node and a later revision node both feeding the same gate) is a common, realistic instance of this, not an exotic one. Lint cannot know which predecessor's output actually reached the gate at runtime, so the rule stays silent by design. Is this worth closing (e.g. firing when *all* distinct direct predecessors are `Handler.CODERGEN`, not just when there is exactly one), and if so, is a broader-but-still-sound firing condition available? See ADR-006's `## Residual risk` section (`.delivery/decisions/ADR-006-hitl-003-self-report-guard.md`). | Product Owner | Future `HITL-003` extension work |

## Out of scope

- Durable park/resume for human gates (interpretation (b)) — S2 is synchronous-only in this slice.
- General checkpoint-based crash recovery for any interrupted run, independent of human gates — no read-back mechanism exists; see NFR-9.
- Any numeric parallel-fan-out concurrency default — blocked on Open question 3, not invented here.
- Ranking-based fan-in (a `Handler.FAN_IN`/`tripleoctagon` node with heuristic candidate selection, amplifier's second, optional join mechanism) — FR-17b's default join policy (pass/fail on branch outcomes) does not require it; a ranking fan-in node is a future extension, not this slice.
- Composition/reuse (P-3) — no mechanism exists; needs its own research pass.
- Multi-provider `model_stylesheet` routing.
- Publishing to any marketplace beyond `ai-augmentation-systems`; auto-update; multi-version coexistence.
