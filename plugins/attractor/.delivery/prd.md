# PRD: attractor — correct spec implementation and pipeline-authoring layer, MVP slice

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Last updated: 2026-08-05
> Brief: `plugins/attractor/.delivery/brief.md`
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
- Parallel fan-out is fully blocked this slice pending Open questions 3-5 (branch-declaration syntax, worktree isolation, fan-in-on-all-fail semantics) — neither running nor a clean lint-time refusal of it is buildable until those land. What is buildable now is a lint refusal of the *other*, already-known-unregistered handler kinds (S3, FR-17a).
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
| S3 | Parallel fan-out, targets A/B | P-2 | Entirely blocked on Open questions 3-5 — no attribute syntax and no concurrency default exist to test against. FR-17a (lint refusal of the other already-known-unregistered handler kinds) is buildable now and does not wait on these |
| S4 | Graph missing `outputs=` must not silently report success | P-2, P-1 | Criteria conflict with an existing, deliberately-reasoned regression test — flagged, not resolved |
| S5 | D7 bug: plain-node FAIL must not consult graph-level `retry_target` | P-2 | Coverage gap found and closed — original fixture proves only one of two code paths; second fixture added |
| S6 | F10 bug: embedded `Engine` must refuse a lint-dirty graph like the CLI | P-2 | Confirmed live by direct execution; one scope boundary flagged (embedder cannot see WARNING-severity diagnostics even after the fix — separate decision) |
| S7 | Authoring layer generates a runnable pipeline from plain language | P-1, P-4 | STRETCH — all criteria usable once built, none blocked on an engineering unknown |

**S4's conflict, stated plainly because it is a product decision, not an engineering one:** the fix as scoped requires either overturning a currently-passing test (`engine/test/engine.test.ts:1309`, `'I1 is opt-in...'`) whose own comment records that an earlier, near-identical fix was tried and **withdrawn** as a specification contradiction (`engine.ts:1113-1121`) — or scoping S4 down to a lint-time-only refusal that never touches the runtime verdict. The brief wants the runtime behavior (`brief.md`: *"cannot silently report success"*), but nobody has yet reconciled that want against the specific, recorded reason the previous attempt was reverted. See FR-9a/FR-9b and Open question 9.

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
| FR-9a | *(blocked — see Open question 9)* If the resolution is a runtime-verdict change: a graph reaching exit with an unrecovered node failure and no `outputs=` declared on the failing node returns a run-level `status` other than `success`. This reverses the specific, recorded decision at `engine.ts:1113-1121` and is not a Product-Owner-alone call — `AGENTS.md`'s "if a change appears to require deleting one of these, stop and ask" rule applies before implementation starts | S4 | must, pending decision |
| FR-9b | *(blocked — see Open question 9)* If the resolution is lint-time-only: a lint rule flags this shape as an ERROR before the graph runs; the runtime verdict is explicitly left unchanged, consistent with the currently-passing `engine.test.ts:1309` | S4 | must, pending decision |
| FR-10 | `resolveRetryTarget`'s graph-level fallback is scoped out of both §3.7 call sites (`engine.ts:1021` **and** `:1165`), not only the one the original repro fixture exercises; both a plain-FAIL fixture and a retry-exhaustion fixture (`max_retries` set) must terminate without consulting the graph-level `retry_target` | S5 | must |
| FR-11 | A direct `new Engine(...)` embed refuses to run a graph carrying an ERROR-severity lint diagnostic, matching the CLI's existing refusal | S6 | must |
| FR-12 | *(blocked — see Open question 7)* Whether an embedder can observe a WARNING-severity diagnostic post-FR-11 is a separate, undecided scope question; FR-11 alone does not answer it | S6 | should, pending decision |
| FR-13 | Every graph the authoring skill hands back as "ready" is accompanied by a real execution transcript (`events.jsonl`, terminal `status`/`path`) produced by a delegated, independent verification step — not the same session that authored the graph, per `AGENTS.md`'s rule ("verification inside the context that produced the evidence is not verification") and the ported `attractorify` skill's own independent-verifier convention | S7 | could |
| FR-14 | The skill never generates a graph using a handler not registered in the build it's running against | S7 | could |
| FR-15 | The skill's reference material states routing verdicts are `goal_gate=true`-only, matching `argv.ts:42-43` exactly | S7 | could |
| FR-16 | No worked example in the skill's reference material is described as working without having been executed on this engine — the "1 of 4, not 2 of 4" precedent (`spec-conformance.md`) is the standard to match | S7 | could |
| FR-17a | Lint refuses, before a run starts, any node whose resolved handler kind is `Handler.PARALLEL`, `Handler.FAN_IN`, or `Handler.MANAGER_LOOP` — the set `graph.ts` already marks, in its own inline comments, as known but not registered in `defaultHandlers()` — citing the handler and the missing-implementation reason. (`Handler.HUMAN` is excluded from this set: S2/FR-5-8 registers it separately, in this same slice.) Needs none of Open questions 3-5 | S3 | must |
| FR-17b | *(blocked — see Open question 3, 4, 5)* Parallel fan-out, either target A or B, actually executes — cannot be specified until a branch-declaration attribute syntax and a concurrency default are decided | S3 | must, fully blocked |

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
| NFR-7 | Parallel fan-out concurrency ceiling | **unknown — no default exists anywhere in code or design docs** | See Open question 3; do not invent a number |
| NFR-8 | Test suite size (context, not a target) | 462 tests as of the brief's writing — itself subject to the citation-decay risk the brief documents; re-verify with `node --test` before trusting it past this document's date | `plugins/attractor/engine`, `node --test` |
| NFR-9 | Unattended crash exposure during an unanswered human gate | A process death while blocked at S2's gate loses the entire run to that point. Resolved 2026-08-06 in favor of the 2026-08-05 channels design, which narrows this to the `human` hop only (the `agent`/`CommandChannel` hops don't hold process-resident state the same way, but neither checkpoints mid-wait either). The 2026-08-03 park/checkpoint spec's cross-restart survival is not adopted — see Open question 1 | Accepted, undetected risk this slice, by design choice — see Open question 1 and Non-goals. `checkpoint.ts`/`loadCheckpoint` (already implemented, currently unwired) are the intended future basis for closing this, additively on top of `Channel`, not a reason to revisit this decision now |

## Assumptions

- That `plugin.json`/`marketplace.json` packaging happens in *this* repository, not solely in `ai-augmentation-systems` — genuinely unresolved (Open question 6); FR-1/FR-2 assume it happens here.
- That FR-5's live-blocking `human` hop, as ADR-002 decided it, is the channels design's `human` channel implementation — resolved 2026-08-06 (Open question 1); the 2026-08-03 park/checkpoint design does not apply and is superseded for S2.
- That `--allow-agent-gates` defaulting to off, requiring both the graph's and the operator's opt-in, is the right trust boundary for the `agent` channel — a deliberate, conservative choice, not yet tested against a real operator's workflow. Before the `agent` channel ships, `human.context=` needs a lint rule or documented authoring restriction preventing it from exposing evidence written by the very node the gate is meant to check (a self-report risk the reconciliation review surfaced, not yet closed).
- That amplifier's `pr-review.dot` (referenced only externally today, not committed) is representative enough of a real parallel workload to justify its structure once S3 is unblocked.

## Open questions

Questions 1, 3, 4, 5, 7, 9 now have prior art to read alongside them — see
`plugins/attractor/.delivery/amplifier-precedent.md` (§1-4), not a decision on its own.

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **RESOLVED 2026-08-06.** A multi-lens comparison (persona fit, engineering cost, doctrine alignment, requirement coverage, extensibility risk; two independent judges; one final synthesis) converged 5/5 on the channel-abstraction design (`.superpowers/specs/2026-08-05-human-gate-channels-design.md`) over the 2026-08-03 park/checkpoint design (`.superpowers/specs/2026-08-03-attractor-claude-code-plugin-design.md` §7-8, now marked superseded): only the channels design has an architectural slot for the two hard, user-stated requirements (arbitrary bespoke/pluggable channels, an opt-in `agent`-proxy channel) that the park/checkpoint design predates. Full record in `.superpowers/carry-forward.md` under "Plan 4." | Product Owner | FR-8 — unblocked |
| 2 | **RESOLVED 2026-08-06, same decision as Q1.** The channels design's §6 preflight (reachability + per-hop viability check, refusing the run before any node executes if no channel is viable) supersedes the 2026-08-03 design's narrower `--unattended`/`on_timeout`-only check from §7.4. | Product Owner | S2 scope — unblocked |
| 3 | S3: what attribute syntax declares a fan-out's branches, and does the engine cap concurrent branches by default (and at what number), or run all of them with the author solely responsible for cost? Amplifier precedent §2: every outgoing edge from a `component` node is a branch (no separate list attribute); its default cap is `max_parallel=4`, real running code, offered as evidence not a recommendation. | Product Owner | FR-17b, NFR-7 |
| 4 | S3: do parallel branches share one worktree by default (racing on shared file writes) or get isolated ones — and what attribute names the opt-in, if any? Amplifier precedent §2: branches share one filesystem by default; no worktree-per-branch mechanism exists there at all. | Product Owner | FR-17b |
| 5 | S3: when every branch of a fan-out fails, does the fan-in node report FAIL, or SUCCESS/PARTIAL because its own handler completed without crashing? Amplifier precedent §2: its own component-level join policy returns PARTIAL_SUCCESS on total failure (never checks for zero successes) — a fail-open shape only corrected if the author separately wires an optional ranking fan-in node. | Product Owner | FR-17b |
| 6 | Does plugin packaging (FR-1/FR-2) happen in this repository, or does it belong solely in `ai-augmentation-systems`? Root `AGENTS.md` lists `attractor` under "Current and planned" without saying which. FR-1/FR-2 are already written assuming this repository (see Assumptions) — this question confirms or corrects that assumption; it does not block starting them. | Project owner | Confirms the target repo for FR-1/FR-2; does not block them |
| 7 | S6: after FR-11, should an embedder be able to observe a WARNING-severity diagnostic at all — `Engine` currently writes nothing to stdout/stderr, confirmed by direct instrumentation, so this is a new capability, not a bug fix. Amplifier precedent §4: its `validate()`/`lint()` return the full severity-tagged list to any embedder by default — this was never a gap there, a different starting point than ours. | Solution Architect | FR-12 |
| 8 | S1: is a two-run collision on one `--run-dir` (no lock exists, confirmed by reading the write path) an accepted operator-error risk, or does the engine need to detect and refuse it? | Product Owner | NFR-4 |
| 9 | S4: does closing the `outputs=`-opt-in gap override the specific, recorded reason a near-identical fix was withdrawn once already (`engine.ts:1113-1121`, a §11.3 contradiction), and if so, is the mechanism a runtime verdict change (FR-9a) or a lint-time refusal (FR-9b)? Per `AGENTS.md`: "if a change appears to require deleting one of these, stop and ask" — FR-9a requires that check before implementation, not Product Owner sign-off alone. Amplifier precedent §3: its analogous mechanism (R12) is runtime-only and built on SKIPPED-propagation — a design our own doctrine explicitly rejected already; not a ready-made answer, a genuine divergence to weigh. | Product Owner + Solution Architect | FR-9a, FR-9b |
| 10 | Carried forward from the brief (open question 4, `brief.md:112`, unresolved there): is content-differentiated fidelity (§5.4's five modes, currently all behaving identically) an accepted permanent divergence, or a real gap to build? No FR in this PRD scopes it either way. | Project owner | This PRD's own scope — currently neither in nor explicitly out |

## Out of scope

- Durable park/resume for human gates (interpretation (b)) — S2 is synchronous-only in this slice.
- General checkpoint-based crash recovery for any interrupted run, independent of human gates — no read-back mechanism exists; see NFR-9.
- Any numeric parallel-fan-out concurrency default — blocked on Open question 3, not invented here.
- Parallel fan-out actually executing (FR-17b) — blocked on Open questions 3-5. Only the lint refusal of the other known-unregistered handler kinds (FR-17a) is in scope.
- Composition/reuse (P-3) — no mechanism exists; needs its own research pass.
- Multi-provider `model_stylesheet` routing.
- Publishing to any marketplace beyond `ai-augmentation-systems`; auto-update; multi-version coexistence.
