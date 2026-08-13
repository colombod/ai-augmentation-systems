# Delivery roadmap: Attractor handoff runner mode

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-08-13
> PRD: `.delivery/initiatives/attractor-handoff/prd.md` · Architecture: `.delivery/initiatives/attractor-handoff/architecture.md`
> **Word count: ~1430 against an 1100-word cap.** Declared, not silent: this roadmap carries corrections from two independent reviewers (QA-strategist, feature-critic) who each found real, differently-grounded gaps in the first draft — a weak Phase 2 exit criterion, missing fixtures, a mislocated "compile rate" measurement, unowned risks. Each correction includes its own reasoning so it can be revisited later; compressing further would cut findings and citations this project's own writing standard protects from trimming.

## Constraints

**Team:** solo operator + AI agent sessions, no separate roles.
**Fixed dates:** none.
**Fixed variable:** scope, not date — confirmed directly with the operator. Later phases and their cut-list items slip first; quality never compresses.

**No `prioritization.md` exists** — this initiative is a single, tightly-scoped feature (a third `delivery:handoff` runner mode), not a multi-stage product needing MVP staging. The usual pre-architecture-vs-post-architecture inversion check has no baseline; the PRD's own `must`/`should` column is the staging signal instead. One inversion-shaped check ran anyway: `FR-20` (added late, via a direct operator question rather than the five-reviewer panel) turned out to ride on tables `FR-5`/`FR-12`/`FR-15` already require — low marginal cost, kept in scope, not a cut candidate.

## Sequencing rationale

Prove the riskiest, most novel mechanism (`ADR-011`'s gate/fix loop) cheaply, on a hand-built fixture, before committing to the `L`-sized compiler that generates it at scale. Spike 5 goes first for a second reason: it gates whether Spike 1's sizing-formula arithmetic is even trustworthy, since that formula assumes the node structure Spike 5 is the first thing to build.

`attractor lint` alone verifies syntactic legality, not correct behavior — it cannot see whether the compiler's *generated* `outputs=` wiring actually blocks a downstream story when an upstream one goes `non-convergent`, the same bug class `research.md` found live in Argo Workflows (a retry's real outcome silently failing to propagate into the overall verdict). Phase 2's exit below adds a compiler-generated multi-story fixture for exactly this, so it can't hide until Phase 4.

## Phases

### Phase 1: Prove the mechanism, ship the deterministic scripts, template prerequisite

**Entry criteria:** `attractor` plugin installed, `attractor doctor` passes (Setup, per `ADR-008`).
**Delivers:** `NFR-1`, `NFR-2` (mechanisms only — real numbers are `OQ-2`/`OQ-3`).
**Demonstrable exit:** the `ADR-011` fixture (fix→gate, two-node loop) passes `attractor lint` clean; **three** `--stub` runs — pass-first-attempt (catches a first-touch counter-file off-by-one), fail-then-pass, fail-through-bound — produce the declared outcome with the predicted node-visit count. A fourth, deliberately-hanging fixture confirms `timeout=` fires and counts as one consumed attempt (`NFR-2`'s own PRD-stated method). Both new scripts pass `node --test` against their fixture matrices. A diff shows `templates/sprint.md` and `skills/sprint/SKILL.md`'s enum both carrying the fourth value.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 5 — `ADR-011` fixture, lint clean, 3 `--stub` runs | S (0.5d) | Medium | Entry criteria |
| Spike 1 — `OQ-2` attempt-bound number | S (1d) | Medium — trustworthy only once Spike 5 confirms the structure | **Spike 5** (real dependency, not parallel — see Critical path) |
| Spike 2 — `OQ-3` timeout duration + hang fixture | S (0.5d) | High — attribute merged upstream for this purpose (`#42`) | Entry criteria; can run alongside Spike 5 |
| Spike 3 — `OQ-9` doctor + `--stub` dry run, fresh worktree, no prior grants | S (1d) | Low — untested path | Entry criteria; can run alongside Spike 5 |
| Spike 4 — `OQ-10` is a drift precheck worth adding | S (0.5d) | Low — a judgment spike | Entry criteria; can run alongside Spike 5 |
| `validate-attractor-pipeline.js` (`NFR-1` sizing) | M | Medium — must measure runtime step-visits, not static node count | Spike 5 |
| `compute-sprint-verdict.js` (`FR-18` transitive debt-taint walk) | M | Medium — highest-consequence output in the whole feature | None — pure fixture-testable |
| `templates/sprint.md` + `skills/sprint/SKILL.md` enum edits | S | High | None |

**Verification in this phase:** the spikes *are* the verification — real `attractor lint`/`--stub`, no synthetic substitute. Scripts verified via `node --test`, fixture matrix including **both** `non-convergent`- and `irreducible`-sourced debt-taint cases (a walk correct on one taint source but not the other would pass a matrix testing only one).
**Cut list:**
1. Spike 4 (`OQ-10` drift precheck) — document the residual risk instead of building a precheck.
2. Nothing else here is cuttable — these are this roadmap's own precondition.

### Phase 2: Compile — dependency graph, acceptance gates, irreducible flags

**Entry criteria:** Phase 1 complete.
**Delivers:** `FR-1`, `FR-2`, `FR-3`, `FR-5`, `FR-6`, `FR-8`, `FR-9`, `FR-10`, `FR-11`, `FR-12`, `FR-13`, `FR-14`, `FR-19`. `FR-7` (`should`) where cheap.
**Demonstrable exit — four bars, not one (lint alone is insufficient, per Sequencing rationale):** (a) a real sprint scope package compiles to a `.dot` + manifest passing `attractor lint` clean, criteria mapped 1:1 to gates or reasoned `irreducible` flags, `depends_on` matching exactly; (b) at least one `--stub` run per distinct criterion-shape the compiler handles (`parallelogram`-eligible, `box`-fallback), not deferred to Phase 4; (c) at least one compiler-generated, multi-story `outputs=`-blocking fixture — an upstream `non-convergent` story correctly blocks a downstream consumer, checked against `events.jsonl`; (d) selecting `attractor` with the plugin absent produces the refusal + install step before any file is written, and a zero-criteria story is refused at the readiness check — both invoked live and human-read, since no mechanical check exists for refusal prose.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Runner choice point, frontmatter edit (`FR-1`) | S | High | Phase 1 |
| Dependency-graph compilation, topological sort (`FR-2`) | S | High | — |
| Acceptance-gate compilation (`FR-3`, `FR-5`, `FR-8`, `FR-9`, `FR-10`) | **L** — largest item on the roadmap | Medium — shape proven, compiler's own reproduction of it is not | Spike 5's fixture; `validate-attractor-pipeline.js` wired in |
| Cross-check: run Phase 1's two scripts against the compiler's first real output before building further | S | — | First minimal real `.dot` |
| Substitution list, inline (`FR-6`, `ADR-012`) | S | Medium — ongoing curation cost | — |
| Irreducible flagging + summary table (`FR-11`, `FR-12`) | S | High | — |
| Runner availability check (`FR-13`, `FR-14`) | S | Medium — no existing precedent in the repo | — |
| Handoff readiness-check extension: zero-criteria refusal (`FR-19`) | S | High | — |
| Handoff readiness-check extension: zero-story case (`OQ-11`, no `FR-n` yet) | S | Low — architecture names intent, no ADR designs it | — |

**Verification in this phase:** real `attractor lint` as the oracle, fuzzed across criterion combinations; the four-bar exit above; `FR-10`'s dataflow-ledger blocking gets its own two-story `--stub` fixture here, not left unassigned. **Deliberately thin, stated plainly:** whether a compiled check tests what its criterion actually *means* is not mechanically verifiable in general — closed only where `FR-7`'s optional fixture exists. No later phase closes this gap either.
**Cut list:**
1. `FR-7` — already `should`, PRD-declared, test strategy already scopes it "manual spot-check, not gated."
2. `OQ-11`'s zero-story extension — no `FR-n`, no ADR yet; document the gap if cut.
3. Substitution-list breadth — scope to what Phase 4's pilot needs, extend on demand.

### Phase 3: Report-back and verdict mapping

**Entry criteria:** Phase 2's compiled artifact format exists; Phase 1's script and template edit are in place.
**Delivers:** `FR-4`'s prerequisite (no bypass added here), `FR-15`, `FR-17`, `FR-18`, `FR-20`, `FR-16`'s population half.
**Demonstrable exit:** a synthetic run result (some gates met, one `non-convergent`, one `irreducible`, one 2-hop debt-taint chain) produces the correct three-way verdict via `compute-sprint-verdict.js`; `sprint.md`'s report-back is fully populated, no blank cells. One live `/delivery:sprint-review` run against a real, pre-existing `superpowers`/`generic` sprint log converts `FR-16`'s non-regression claim from read-verified (architecture-phase grep and inspection) to actually invoked.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Report-back populates every `sprint.md` column (`FR-15`) | M | Medium | Phase 2 output format |
| Story `Outcome` rollup — `irreducible` counted in `m`, never in `n` (`FR-17`) | S | High — fully specified in the PRD | — |
| Verdict mapping wired to `compute-sprint-verdict.js` (`FR-18`, `ADR-013`) | M | Medium — first real integration of a Phase-1-tested script | `compute-sprint-verdict.js` |
| Per-criterion result surfaced, not just rolled up (`FR-20`) | S | Medium — incremental column on already-required tables | `FR-15` |

**Verification in this phase:** integration tests against real `attractor run --stub` fixtures — pass-first-attempt, fail-then-pass, fail-through-bound-with-blocked-dependent.
**Cut list:** nothing here is a first candidate — `FR-18`'s script is already proven, making this mostly integration glue. If forced: `FR-20`'s surfacing degrades to a plain per-gate log line before being dropped outright, since Goal 3 depends on it.

### Phase 4: End-to-end verification

**Entry criteria:** Phases 2 and 3 complete.
**Delivers:** `FR-4`, `FR-16` — both provable only by a real composed run.
**Demonstrable exit:** one real sprint scope package runs the whole chain — compile, `attractor run --stub`, report-back, `/delivery:sprint-review` reaching a verdict — watched happen once. All three sprint-review verdicts exercised, including `Accepted with debt` via an actual multi-hop debt-tainted chain, not just a clean run — otherwise `FR-18`'s output stays integration-tested only in isolation (Phase 3), never at real pipeline scale.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| `--stub` pilot sprint, full chain, all three verdicts exercised | M | Low-Medium — first time every component runs composed | Phases 2 + 3 |
| Confirm `sprint-review` reaches a verdict with zero code changes | S | High | above |
| **Stretch, not MVP:** real (non-`--stub`) pilot, validating the compiled pipeline actually executes and fixes real criteria end to end | L | Low | `--stub` pilot passing |

**`OQ-18`'s compile-rate number is not what the stretch item measures.** The `parallelogram`:`box` gate-shape ratio ("compile rate," a governed glossary term) is a free byproduct of Phase 2's own exit criterion — every criterion gets a shape the moment it's compiled, whether the pipeline ever runs. Reporting that ratio is a required Phase 2 deliverable, not contingent on this stretch item. What the stretch pilot actually validates is narrower: whether a *real*, non-stub execution converges the way `--stub` fixtures predict. Cutting it does not leave `OQ-18` unmeasured — it leaves real-execution behavior unvalidated. State both facts plainly if cut, not conflated into one.
**Cut list:**
1. The real (non-stub) pilot — explicitly a stretch; `--stub` is already this project's accepted integration oracle (test strategy, architecture phase). If cut, say plainly: the compile-rate ratio is still reported (Phase 2), but real-execution behavior beyond `--stub`'s deterministic model ships unvalidated.
2. Nothing else in this phase is cuttable without leaving the feature undemonstrated.

## Critical path

```
Spike 5 (Phase 1) → Acceptance-gate compilation (Phase 2, L) → Report-back wiring (Phase 3) → E2E (Phase 4)
```

Spike 1 is not parallel with Spike 5 — it depends on Spike 5's structure being confirmed first. The honest grouping is **Spike 5, then {Spike 1, Spike 2, Spike 3, Spike 4} concurrently** — and even that concurrency is nominal, not free: this is a solo-operator plan, so "parallel" spikes share the operator's own review and decision bandwidth, not a second person. Elapsed time is closer to serialized (≈3.5 days of review/decision time across Phase 1) than to the best-case unattended-session reading (≈1.5-2 days); the plan does not assume the optimistic one.

**To shorten the path:** the only structural lever is Phase 2's acceptance-gate compilation — the roadmap's single largest, least-proven item. Scoping the substitution list narrower or accepting more `box`-shaped fallback gates trades completeness for speed there; nothing shortens Spike 5 (it has to actually run) or Phase 4 (it has to actually be watched).

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Attractor's documented interface behaving as documented | the operator (also attractor's maintainer) | Phase 1 spikes | One real gap already found and fixed same-day (`#40`→`#42`) | Route upstream exactly as `#40` was; downstream phases wait or the mechanism gets redesigned |
| `OQ-1`: evidence-artifact content (visual vs. textual) | Product Owner | Phase 2 completion | Open | Phase 2 ships a placeholder shape, revised once decided |
| `OQ-18`: real non-stub compile-rate/execution validation | Product Owner | Whether Phase 4's stretch counts as done | Open, explicitly load-bearing | See Phase 4's corrected note — the ratio itself isn't blocked on this |

**Which remaining spike is most likely to surface a second `#40`-shaped gap, ranked:** Spike 5 (the composed mechanism hasn't been run yet, the exact shape that produced `#40`) > Spike 1 (runtime step-visit accounting could diverge from the documented model) > Spike 3 (fresh-worktree/no-prior-grants is an untried path).

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1, FR-2, FR-3, FR-5, FR-6, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-19 | Phase 2 | Core compilation |
| FR-7 | Phase 2 | `should` — first cut-list item |
| FR-15, FR-17, FR-18, FR-20 | Phase 3 | Report-back |
| FR-4, FR-16 | Phase 4 | Provable only by a real composed run |
| NFR-1, NFR-2 | Phase 1 (mechanism) → Phase 2 (enforcement) | |
| NFR-3, NFR-4 | Phase 2 | Documentation commitments in the manifest |

**Deferred:** `OQ-11` (zero-story refusal) — no `FR-n`, no ADR yet; named Phase 2 cut candidate, not a silent drop.

## Risks

Carried from `architecture.md`'s register (owners were blank there, assigned here) plus two additions.

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `ADR-011`'s mechanism, though grammar-legal and grounded, unrun until Spike 5 | Low-Medium | High | Spike 5, first thing built | Solution Architect | Spike 5 fails either `--stub` case |
| `compute-sprint-verdict.js`'s walk misses a case beyond 2-hop or beyond one taint source | Low | Medium | Fixture matrix now includes both `non-convergent`- and `irreducible`-sourced taint | Solution Architect | A real chain deeper than 2 hops is found |
| `box`-shaped gates reintroduce `HITL-003` self-report risk | Medium (tied to compile rate) | Medium | Manifest flags every `box` gate explicitly | Product Owner (compile-rate call) | Compile-rate report (Phase 2) shows high `box` share |
| `ADR-008`'s doctrine still `proposed`, not `accepted` | Low | Low | Track status; Setup section matches current text | Product Owner | `ADR-008` status changes |
| Real-execution behavior ships unvalidated if Phase 4's stretch is cut | Medium | High | State both facts plainly per Phase 4's corrected note; don't conflate with compile-rate reporting | Product Owner | Stretch item's cut decision |
| A second `#40`-shaped documented-interface gap surfaces in Spike 5, 1, or 3 | Low-Medium | Medium-High | Route upstream immediately, as `#40` was | the operator | Any spike hits undocumented/wrong behavior |

## Buffer

No calendar buffer — no fixed date to buffer against. The cut lists **are** the buffer, named per phase rather than hidden in estimates: later phases and their cut-list items slip first, quality never compresses, per the operator's own confirmed policy.
