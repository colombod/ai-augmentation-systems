# PRD: Attractor handoff runner mode

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Last updated: 2026-08-11
> Brief: `.delivery/initiatives/attractor-handoff/brief.md`

## Summary

A third `delivery:handoff` runner mode: hands a scoped sprint to `attractor` instead of a hand-worked plan. Each story's acceptance criteria compile into a checkable acceptance gate; a failing acceptance gate routes to a fix step and re-runs, bounded and honestly reported, rather than relying on self-report. For the operator who already chooses a runner mode today.

## Goals and non-goals

**Goals**

- Every acceptance criterion in scope becomes a real, checkable acceptance gate or an explicitly flagged `irreducible` criterion — never silently dropped, never silently backed by an unmarked judgment.
- A failed acceptance gate's fix-and-retry loop is bounded and reports an honest `non-convergent` outcome, never an unattended infinite loop and never a silent pass.
- The compiled check is independently traceable to its source criterion, closing the "who's grading the gate" objection three personas raised independently. (Retained as a direct quote of the interview finding — see `R-prd-5`, which qualifies how completely this is actually closed.)
- Results reach `/delivery:sprint-review`'s existing, unmodified verification procedure.

**Non-goals**

- Attractor's own engine implementation, capability, or roadmap — this PRD specifies a delivery-side contract only.
- A reusable pipeline template catalog.
- Parallel/concurrent execution of independent stories within one compiled pipeline (attractor's own `component`/`tripleoctagon` shapes are refused by its lint today — confirmed, not assumed).
- A pre-execution operator-approval step before the pipeline runs. The simulation rated this an enhancement, not load-bearing (both engaged personas gave a "provisional continue," not a hard stop) — deferred, not designed here.
- A classifier that distinguishes a `/delivery:sprint-review` verdict as self-reported vs. independently traced (the still-open, unscoped `R-brief-4`).

## User scenarios

### S-1: Happy path handoff

**Actor:** the operator, at the existing `/delivery:handoff` choice point.
**Trigger:** a sprint scope package has passed the existing Handoff readiness check; the operator selects `attractor`.
**Preconditions:** `attractor` plugin installed (S-5).

**Main path**
1. Handoff compiles the story dependency graph from each story's `depends_on`.
2. Every acceptance criterion compiles into an acceptance gate, or is flagged `irreducible` (S-4) — none dropped.
3. The artifact states the literal next command.
4. Attractor runs the pipeline; acceptance gates pass or loop (S-3).
5. Report-back reaches `/delivery:sprint-review` (S-6), which re-verifies unmodified.

**Observable outcome:** every story's acceptance criteria were checked by a real acceptance gate, not a self-report; sprint-review's existing rubric decides the verdict.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Empty input (a story with zero acceptance criteria) | Refused at the Handoff readiness check (`FR-19`) — not compiled with zero acceptance gates |
| Empty input (a sprint with zero stories) | **Real gap, not confirmed covered** (`R-prd-15`): `skills/sprint/SKILL.md`'s "No stories are `ready`" check is phrased for stories that exist but aren't ready yet, not for a scope table with zero stories at all — verified by direct reading, no bullet there fires on an empty scope. See `OQ-11`. |
| Very large input (many stories) | Constrained by `NFR-1`'s shared step ceiling — see NFR table, open question |
| Duplicate (two stories, identical criterion text) | Disambiguated by story ID + criterion identifier, both required in the citation (`FR-5`) — confirmed to already work |
| Concurrent modification (two runs against the same `--run-dir`) | Attractor's checkpoint writes are unsafe against concurrent writers (no lock, silent last-write-wins) — `NFR-4` |
| Permission denied (attractor installed but the environment can't grant it the tools/worktree rights it needs) | Not covered by `FR-13`'s install check; open question, `OQ-9` |
| Resource missing (a cited file doesn't exist) | Refused by the existing readiness check bullet ("every cited file path exists"), inherited unmodified |
| Resource missing mid-run (drift during a long unattended run) | Not addressed; open question, `OQ-10` |
| Partial failure (some stories converge, some don't, same run) | Resolved by `FR-17`/`FR-18`'s Outcome rollup and verdict mapping |
| Timeout (a single attempt hangs) | Distinct from the attempt-count bound — `NFR-2` |
| Undo (fix a non-convergent story, re-run just that one) | No resume path exists today — `NFR-3` states this plainly rather than assuming it |

**Acceptance criteria:** `FR-1`, `FR-2`, `FR-3`, `FR-4`, `FR-19`.

### S-2: Compilation is traceable

**Actor:** the operator, especially the persona that demands source-traceable verification.
**Trigger:** reviewing the compiled artifact, before or after a run.
**Preconditions:** S-1 in progress or complete.

**Main path**
1. Compilation processes one story's criteria into acceptance gates.
2. Each acceptance gate co-locates its source criterion text, `FR-n` reference, and derived check.
3. Each acceptance gate ships a deliberately-failing fixture proving it can actually fail.

**Observable outcome:** a reviewer with only the sprint package and the compiled artifact — no session memory — can match every acceptance gate to its source criterion by reading the two side by side.

**Error and edge paths:** see S-1's table; this scenario adds no new error paths of its own.

**Acceptance criteria:** `FR-5`, `FR-6`, `FR-7`. **Open:** the evidence artifact's actual content (visual vs. textual) is a real, still-undecided Product Owner call — see `OQ-1`.

### S-3: Acceptance gate fails, bounded retry, honest non-convergence

**Actor:** the operator.
**Trigger:** an acceptance gate fails.

**Main path**
1. Fails → routes to a fix step → re-runs, up to a declared bound.
2. Exhausting the bound produces `Outcome = non-convergent`, never silent, never retried past the bound.
3. A non-convergent story blocks a dependent **only** via attractor's own `outputs=` dataflow ledger — not a document-level heuristic.

**Observable outcome:** "clean finish or honest stop" now has a concrete, evidenced third case.

**Acceptance criteria:** `FR-8`, `FR-9`, `FR-10`.

### S-4: Irreducible criterion, surfaced loudly

**Actor:** the operator who reads only the report headline.
**Trigger:** a criterion can't be reduced to any checkable form.

**Main path**
1. Marked `irreducible` with a reason — not dropped, not silently judged.
2. Surfaced in a dedicated summary table, positioned ahead of per-story detail.

**Observable outcome:** a reader who reads only the top of the report cannot miss that part of the sprint rested on a marked judgment call, not an acceptance gate.

**Acceptance criteria:** `FR-11`, `FR-12`.

### S-5: Attractor not installed (the Runner availability check)

**Actor:** the operator.
**Trigger:** selects `attractor` when the plugin isn't present.

**Main path**
1. Refuses before writing any artifact.
2. Names attractor specifically; states the real alternatives; never silently substitutes another runner.
3. **No existing precedent for this check exists anywhere in this repo** — confirmed by direct reading, not reuse of a pattern that doesn't exist (resolves `R-brief-6`).

**Observable outcome:** a clear stop with a real next step, never a partially-compiled artifact against a target that was never there.

**Acceptance criteria:** `FR-13`, `FR-14`.

### S-6: Report-back reaches sprint-review

**Actor:** the operator; closes the gap all three engaged personas rated High severity independently.
**Trigger:** a run completes — cleanly or with non-convergent/irreducible stories.

**Main path**
1. The artifact commits at compile time to populating every `sprint.md` report-back column for every story.
2. Story-level `Outcome` rolls up per-criterion states (`FR-17`).
3. Sprint-level verdict maps mixed outcomes onto the existing three-way rubric via the `outputs=` ledger (`FR-18`).
4. `/delivery:sprint-review` runs its existing procedure unmodified.

**Observable outcome:** Open Question 2 is answered — the re-entry point is the existing report-back contract every runner already targets.

**Acceptance criteria:** `FR-15`, `FR-16`, `FR-17`, `FR-18`, `FR-20`.

## Functional requirements

| ID | Requirement | Scenario | Priority |
| :-- | :-- | :-- | :-- |
| FR-1 | Operator can select `attractor` as a runner from `/delivery:handoff` | S-1 | must |
| FR-2 | Every `depends_on` edge appears in the artifact 1:1; no invented edges | S-1 | must |
| FR-3 | Every acceptance criterion has exactly one compiled-check entry; none missing, none invented | S-1 | must |
| FR-4 | A sprint where every acceptance gate converges still requires the existing sprint-review rubric (test suite, persona journeys) for Accepted — convergence is necessary, not sufficient | S-1 | must |
| FR-5 | Every acceptance gate co-locates its story ID, source criterion text, `FR-n` reference, and derived check — no external lookup needed; story ID + criterion identifier together disambiguate two stories sharing identical criterion text | S-2 | must |
| FR-6 | A compiled check references only terms from the criterion text or a documented engine substitution list — no unaccounted key | S-2 | must |
| FR-7 | Every compiled check ships a deliberately-failing fixture proving it can fail | S-2 | should (decided 2026-08-13: downgraded from `must` — real, uncosted per-criterion authoring tax with no cited grounding in the brief/research/interview record; preserves the intent without blocking MVP shipping on 100% fixture coverage) |
| FR-8 | Every acceptance gate has a declared, artifact-visible attempt bound; halts exactly there, not before or past | S-3 | must |
| FR-9 | Exhausting the bound produces `Outcome = non-convergent`, distinct from `blocked`/`not attempted`/`done` | S-3 | must |
| FR-10 | A non-convergent story blocks a dependent only if the dependent consumes its declared `outputs=` key (attractor's dataflow ledger) | S-3 | must |
| FR-11 | A criterion that can't compile is marked `irreducible` with a stated reason, not dropped | S-4 | must |
| FR-12 | Every `irreducible` criterion appears in a dedicated summary table positioned before per-story detail | S-4 | must |
| FR-13 | The Runner availability check: if `attractor` isn't installed, handoff refuses before writing any artifact; no silent fallback | S-5 | must |
| FR-14 | The refusal message states the literal install step; this is new behavior, not a copy of an existing check | S-5 | must |
| FR-15 | Report-back populates every `sprint.md` column for every attempted story; no blank cells | S-6 | must |
| FR-16 | `/delivery:sprint-review`'s existing procedure runs against an attractor-sourced report-back with exactly one shared-template change: `templates/sprint.md`'s Outcome column gains a fourth value (`FR-17`) — otherwise unmodified | S-6 | must |
| FR-17 | Story `Outcome` ∈ {`done`, `non-convergent`, `blocked`, `not attempted`}; any `non-convergent` criterion flips the whole story's Outcome; `m` includes `irreducible` criteria; `n` counts only `met` criteria — an `irreducible` criterion never counts toward `n`, and a story carrying one never reaches `done` (decided 2026-08-13: removes the undefined "signed-off" exception rather than designing a sign-off mechanism at PRD stage; matches the interview record's own uncertainty about whether sign-off should exist at all, and the feature's own purpose — don't let anything uncertain quietly read as done) | S-6 | must |
| FR-18 | Sprint verdict maps to the existing three-way rubric — no fourth verdict. **Not accepted** if any `done` story's correctness depends, via the `outputs=` ledger, on a `non-convergent` or `irreducible` story's declared output. **Accepted with debt** if a `non-convergent`/`irreducible` story exists but nothing consumes its output (including the case where it declared no `outputs=` at all — by construction nothing can be silently relying on it) (decided 2026-08-13: the ledger-consumed case means a "done" story's own claim is unproven, which the existing rubric's "Not accepted" definition — criteria unmet — already covers; the unconsumed case is isolated debt, matching the existing "Accepted with debt" definition) | S-6 | must |
| FR-19 | A story with zero declared acceptance criteria is refused at the Handoff readiness check before any artifact is written, when `attractor` is the selected runner | S-1 | must |
| FR-20 | Each acceptance gate's own result (`met` / `non-convergent` / `irreducible`) is recorded against its citation (`FR-n`, criterion text, `FR-5`) and surfaced in the report-back, not only rolled up into the story's `n of m` count — a reader can see which specific criterion produced which result, not just that some did | S-6 | must |

## Non-functional requirements

Per direct product-owner ruling: retry/resume are sized to the problem at design time, not fixed to an arbitrary large ceiling here — real engine constraints are cited as grounding, not adopted as the answer.

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Attempt bound, summed across **every acceptance gate in a sprint** — not just per story — must respect attractor's shared, pipeline-wide step ceiling. `FR-8` bounds each acceptance gate individually; a story with multiple criteria has multiple acceptance gates, so the sizing formula must multiply by criteria-per-story, not treat each story as one acceptance gate. | Open — sized to assumed max stories/sprint × max criteria/story × max attempts/gate; must stay safely under the engine's 500-node-visit ceiling (`plugins/attractor/.delivery/prd.md`, verified) | Run a test sprint at the assumed max scale (stories × criteria × attempts) to completion without truncation; confirm one dimension pushed past its assumed max does truncate, proving the bound was sized, not accidentally safe |
| NFR-2 | Wall-clock timeout per attempt, independent of attempt count | Open — sized to realistic check turnaround, not an arbitrary large number | A fixture attempt engineered to hang terminates at the declared timeout and counts as one consumed attempt |
| NFR-3 | Remediation cost for a non-convergent story | Documented today: no resume path exists (confirmed by direct kill/resume test in attractor's own PRD); remediation means a full pipeline re-run, stated to the operator plainly | Re-run test confirms every prior story is re-visited, not just the remediated one; artifact text states this cost explicitly |
| NFR-4 | Concurrent runs against a shared `--run-dir` | Not safe today (no lock, silent last-write-wins, verified against attractor's own PRD) — the handoff artifact must never default to or suggest a shared run-dir between concurrent runs | Two concurrent runs against distinct declared run-dirs complete without data loss; against a shared one, the risk is documented, not silently accepted |

## Assumptions

- The operator population choosing this runner mode is the same as the existing `superpowers`/`generic` population — **unverified**, still `R-brief-7`, open.
- Most in-scope acceptance criteria can be mechanically compiled once the bar is "derivable from criteria text," not "already has a hand-written command" — assumed from the interview/simulation findings, not measured against a real sprint yet. **Load-bearing, not background:** nearly every Goal and S-1/S-2 requirement depends on this holding; no threshold is set for what "most" means or what happens if it doesn't (`R-prd-8`, `OQ-18`).
- A sprint's story count and attempt-bound needs stay within attractor's 500-step shared ceiling for realistic use — assumed, not sized (`NFR-1`).

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| OQ-1 | What does the compiled-check evidence artifact actually contain — visual/rendered proof, textual criterion-to-check traceability, or something else? Interview record is explicit this is a real, undecided product call, not resolvable by splitting the difference. | Product Owner | S-2 acceptance criteria completion |
| OQ-2 | NFR-1's actual attempt-bound number, sized to real assumed sprint scale | Product Owner + QA Strategist | Architecture |
| OQ-3 | NFR-2's actual timeout duration | Solution Architect | Architecture |
| OQ-4 | Whether cheaper per-story remediation (vs. full pipeline re-run) gets designed, given no resume path exists | Solution Architect | Architecture; affects whether the artifact is structured one-graph-per-sprint or per-story |
| OQ-5 | Max stories per sprint this mode is expected to handle (brief's Open Question 8) — now grounded by NFR-1's ceiling, not answered by it | Product Owner | PRD NFRs, `NFR-1` |
| OQ-6 | What "reused" means for a pipeline (brief's Open Question 5) | Product Owner | Future scope |
| OQ-7 | Whether the bootstrap/setup subgraph binds explicitly to `plugins/delivery/.delivery/decisions/ADR-008-setup-is-a-prerequisite-not-a-feature.md` — full path stated deliberately; attractor's own decision log has an unrelated `ADR-008` (branch-worktree isolation, unmerged) that a bare-ID citation could collide with (brief's Open Question 7, low severity) | Solution Architect | Architecture |
| OQ-8 | `R-brief-4`: instrumentation for "verdicts traced to `Untraceable` self-report" — still unscoped; this PRD deliberately does not build it (`FR-12`'s guardrail) | Unowned | Future initiative |
| OQ-9 | Permission/tooling precondition beyond install presence (attractor installed but the environment can't grant the tools/worktree rights an unattended run needs) | Solution Architect | S-5 completeness |
| OQ-10 | Mid-run resource drift (a cited file/branch changing during a long unattended run) | Solution Architect | S-1 completeness |
| OQ-11 | Does a genuinely empty sprint scope package (zero stories, not zero-`ready` stories) get refused anywhere upstream of handoff? Verified gap, not confirmed covered (`R-prd-15`) — `skills/sprint/SKILL.md`'s existing check is phrased for the wrong case. | Solution Architect | S-1 completeness |
| OQ-12 | Where does `FR-6`'s "documented engine substitution list" live, and who owns it? Checked directly — no existing artifact settles this (`R-prd-3`; `delivery:chief-of-staff` consulted, declined to answer, routed here as a spike — attractor's `DATA-002` rule governs a different mechanism, not a citable equivalent) | Solution Architect | S-2 completeness, `FR-6` |
| OQ-13 | Where does the compiled handoff artifact get written? Checked directly — neither existing runner's path convention is asserted as the pattern to follow (`R-prd-9`; `delivery:chief-of-staff` consulted, declined to answer, routed here as a spike — the two existing modes have two different, non-obviously-transferable conventions) | Solution Architect | S-1/S-2 completeness |
| OQ-18 | Carrying forward `brief.md`'s two Success signals, both explicitly "TBD at PRD stage" and never resolved here (`R-prd-8`) — at minimum, a compile-rate threshold for "most criteria are mechanically compilable" (the load-bearing assumption underneath S-1/S-2) | Product Owner | Whether the pilot sprint counts as success |

**Resolved 2026-08-13** (were OQ-14–OQ-17; decisions recorded directly in `FR-16`/`FR-17`/`FR-18`/`FR-7` above, not restated here): the `sprint.md` schema-extension question, the irreducible sign-off mechanism, FR-18's verdict direction and empty-ledger case, and FR-7's must-vs-should call.

## Out of scope

- Attractor's own engine implementation, capability, or roadmap.
- A reusable pipeline template catalog.
- Parallel/concurrent execution of independent stories in one compiled pipeline.
- A pre-execution operator-approval step (simulation-identified enhancement, not load-bearing; deferred).
- A self-report-vs-traced classifier for `/delivery:sprint-review`'s own verdicts (`R-brief-4`).
- Retrofitting an install-precondition check onto the existing `superpowers`/`generic` runner modes (same risk exists there; recommended as a follow-up, not mandated here).
- Retrofitting `FR-19`'s zero-criteria refusal onto `superpowers`/`generic` (same real gap; same reasoning as above — a follow-up, not mandated by this initiative). *(Corrected 2026-08-11, `R-prd-10`: FR-19 originally read "for any runner mode," inconsistent with this exact precedent already stated here.)*
