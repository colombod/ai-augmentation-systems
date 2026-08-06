# Delivery roadmap: delivery plugin self-hardening (MVP)

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: Phases 0–3 complete (Accepted with debt) · **Re-aligned 2026-08-05**
> PRD: `.delivery/prd.md` · Architecture: `.delivery/architecture.md`
> Sprint review: `.delivery/sprints/1-harden-mvp-review.md`
> **Word count: 1403 (cap 1100).** Declared, not silent: this document now carries the
> real, executed outcome of every phase plus a new Phase 4 added by this realign — cutting
> further would mean trimming actual results, carried debt, or findings, which the
> writing standard protects. The original planning content was already trimmed once to
> fit; what's left is what happened, not restatement of the plan.

## Constraints

**Team:** one Claude Code agent implementing, one human operator reviewing — no team to
parallelize across.
**Fixed dates:** none.
**Fixed variable:** scope, not date — get the mechanism right; no artificial urgency.

## Does executing this actually deliver the goal?

Checked directly against the PRD's three stated goals before sequencing anything, because a
well-ordered plan that doesn't deliver the original problem is still a failure:

| PRD goal | Delivered by this roadmap? | How |
| :-- | :-- | :-- |
| The operator who checks in periodically stops having to personally notice unconfirmed evidence or a wrong verification channel | **Yes, in full** | Phase 1b (evidence-only marker) + Phase 3 (verification channel + rubric-when-it-exists) |
| The operator who insists on spec-traceable proof gets a record of whether a claimed step really ran | **Yes, in full** | Phase 2 (invocation ledger) |
| A clean "Accepted" verdict can no longer exist with zero self-correction checks behind it | **No — out of scope** | Stage 2, deferred in `prioritization.md` (its actor has zero real evidence). Named here, not discovered by absence. |

Two of three PRD goals delivered completely; the third is a recorded deferral, not a gap.

## Sequencing rationale (historical — Phases 0–3 already executed this way)

Foundational risk went first: architecture's precondition for trusting ADR-001 was that
its hook mechanism actually fires reliably, cheap to learn before code exists. The
evidence-only marker had no dependency and shipped freely.

**A prioritisation inversion, decided here, not silently re-staged:** verification-channel
work was sized like the ledger work, but architecture found a real external dependency — a
design rubric authored by a design lead, on no schedule. Ruling: don't gate shipping on
that authorship. Ship the channel check and the honesty rule as soon as the ledger exists;
the rubric gives it real teeth whenever it arrives. Removed the plan's least controllable
dependency from the critical path entirely.

## Phases

### Phase 0: prepare the rubric's citation slot — **complete**

**Entry criteria:** none.
**Delivers:** the structural precondition for future rubric citations to be traceable at all.
**Demonstrable exit:** `design-system.md`'s template has a stable rule-ID column, so whenever
a rubric is authored — on whatever schedule — its rules are citable from day one, rather
than the citation slot being retrofitted after the fact.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Add a rule-ID column to `templates/design-system.md` | S | high | nothing |

**Verification in this phase:** none needed — a template edit, not logic.
**Cut list:** not cuttable — it is the fix for a real sequencing bug an adversarial pass
found (authoring a rubric against the *old* template first would leave it with nothing
citable).

### Phase 1: foundational spikes — **complete for Spikes 1/2/5; Spike 4 partial**

**Entry criteria:** Phase 0 complete (no real dependency, just convenient to do first).
**Delivers:** a checkable answer to whether the chosen mechanism (ADR-001) is trustworthy.
**Actual result:** 21/21 real invocations logged correctly, past the ≥20 target — one real
`.delivery/`-resolution defect found and fixed along the way. Crash isolation confirmed
structurally impossible per current docs. Spike 4 unit-tested but never live-fire-confirmed
(headless has no browser tool) — full detail in `harden-02`/`harden-03`'s own notes; carried
to Phase 4 as debt D-2.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 1 — hook firing reliability, ≥20 real invocations | M | high (question is falsifiable) | Phase 0 |
| Spike 2 — tool-call field names | S | high | same probe session as Spike 1 |
| Spike 5 — crash isolation | S | high | same probe session |
| Spike 4 — capture-tool discrimination (elba-dreaming's own toolset) | S | high | can run here or deferred to just before Phase 3 — bundled for efficiency |

Spike 3 (subagent-event semantics) is **excluded from this roadmap** — an adversarial pass
confirmed it only blocks the deferred self-correction gate (Stage 2), not this MVP.

**Verification in this phase:** the spikes are the verification — no separate test layer.
**Cut list:** none of Spikes 1/2/5 are cuttable; they are this roadmap's own precondition.
Spike 4 can slip to just before Phase 3 if time-pressured, since nothing in Phase 2 needs it.

**Decision fork (moot — Spike 1 passed):** had it failed, ADR-001 would have been void,
requiring a return to architecture's rejected alternative before writing ledger code.

### Phase 1b: evidence-only marker (parallel, anytime) — **complete**

**Entry criteria:** none.
**Delivers:** the requirements protecting the operator who checks in periodically from
trusting a stage backed entirely by unconfirmed evidence.
**Demonstrable exit, actual result:** replayed against the real elba-dreaming persona set
(four of five unconfirmed) — the marker landed on exactly the right stage, and no other.
No caveats.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Evidence-only marker rule + template slot | S | high | nothing |

**Verification in this phase:** example-based fixtures — mixed evidence, zero-persona,
elba-dreaming replay, marker-clears-on-upgrade.
**Cut list:** nothing to cut — already minimum viable; the discrimination check (no
over-flagging) is what stops it becoming noise nobody trusts.

### Phase 2: invocation ledger — **complete, with debt D-1**

**Entry criteria:** Phase 1's spikes confirm the mechanism is trustworthy.
**Delivers:** the requirements protecting the operator who insists on spec-traceable proof.
**Actual result:** a real, live `/delivery:status` run correctly read a real, hook-populated
ledger — including its own same-session entry, no race observed — and correctly reproduced
the attractor-orchestration incident shape on this project's own PRD/architecture/roadmap/
stories. **Debt D-1:** mid-run-error firing never confirmed live; already fails toward the
safe "not-invoked" state in every observed case, so low-risk. Full detail in `harden-05`/
`harden-06`'s notes.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Hook + script + ledger | M | medium | Phase 1 |
| Status reporting cross-reference, all edge cases | M | medium | ledger existing |

**Verification in this phase:** integration tests, fixture-driven, covering every edge-path
row in the PRD's own table for this scenario.
**Cut list:** display polish drops before correctness — a working, plain report ships before
a well-formatted one.

### Phase 3: verification channel + rubric — **built and unit-tested, live-fire is debt D-2**

**Entry criteria:** Phase 2's ledger exists. Does **not** wait on rubric authorship (see
Sequencing rationale) — ships honest either way.
**Delivers:** the requirements protecting the operator who checks in periodically from a
"renders correctly" claim with nothing real behind it.
**Actual result:** the rule lives in `agents/qa-strategist.md` as a standing check (a live
review caught and fixed an earlier scoping gap that would have limited it to
`sprint-review` alone), wired to the real capture-tool matcher. **Debt D-2, the
higher-priority carried item:** a real screenshot in a real interactive session has never
been directly observed landing in the ledger. Unlike D-1, an independent value review
flagged this as the one gap whose failure direction (false "not-met" on real correct work)
could actually cost the operator's trust. Full detail in `harden-03`/`harden-07`'s notes.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Shared channel+rubric check, in `qa-strategist`, reused by `sprint-review` | M | medium | Phase 2, Spike 4 |
| No-rubric honesty path | S | high | above |

**Verification in this phase:** integration + spike-dependent for the channel check;
example-based for rubric-present/absent/elba-dreaming-replay fixtures.
**Cut list:** the exact-reproduction demo (matching elba-dreaming's precise defect) drops
before the general "must" requirements — the honesty rule and channel check ship regardless.

### Phase 4: real-project usage — the actual next wave

**Added via `/delivery:realign`** on the sprint review. Not a spike — a value review found
D-1/D-2 can only be genuinely closed by real interactive use, which *is* this phase. Also
`prioritization.md`'s milestone M4: real evidence on the reads-only-the-verdict persona
before Stage 2 gets built on a hypothesis.

**Entry criteria:** Phases 0–3 shipped (they are).
**Delivers:** confirmation or correction of D-1/D-2, plus first evidence toward M4.
**Demonstrable exit:** at least one real project, used for real work, where — naturally,
not manufactured — a mid-run failure and/or a real screenshot occurs and is correctly
logged; or an explicit note if a bounded period of use produces neither.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Use this plugin (hook active) on a real project, not this one | — | — | A real project to point it at |
| Record D-1/D-2 outcomes in that project's own `.delivery/` | S | high | Above |
| Feed back into `personas/README.md`: does the reads-only-the-verdict persona show up | S | high | Real usage happening at all |

**Verification:** real usage itself — short artificial probe sessions can't reproduce the
long-session narration pressure that produced Findings A–D in the first place.
**Cut list:** nothing — this phase's cost is using the plugin, not building.

## Critical path

```
Phase 0 → Phase 1 (spikes) → Phase 2 (ledger) → Phase 3 (channel + rubric) → Phase 4 (real use)
```

Phase 1b runs alongside without affecting this chain. Rubric *authorship* (unscheduled,
design-lead work) is explicitly **not** on this path, per the inversion decision above — it
was the plan's least controllable dependency until removed from the critical path entirely.
Phases 0–3 are now complete; **Phase 4 is the critical path today**, and its only real
dependency is a real project to run this plugin on — not more engineering.

**To shorten it (historical — Phases 0–3 are complete):** the original lever, running
Spike 4 inside Phase 1 rather than deferring it, was not taken (headless mode blocked it
entirely, not a scheduling choice). Phase 4's own critical path has one lever: getting a
real project to run this on sooner rather than later.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Design rubric content (not the citation slot — that's Phase 0) | design-lead | Whenever it arrives | Not started, no schedule | No impact on shipping — Phase 3 ships honest either way, per the inversion decision |
| Claude Code's hook payload shape staying stable | Anthropic | Ongoing | Verified current as of this session | Spikes 1–2 must re-run after any Claude Code upgrade |
| A real project to run this plugin on, for real work | originator | Phase 4 start | Not yet identified | Phase 4 stalls; D-1/D-2 stay open indefinitely, and M4's persona question stays unanswered |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1–FR-3 | Phase 2 | Live-verified, 21/21. D-1 (mid-run-error) carried to Phase 4 |
| FR-4 | Phase 2 | Live-verified against a real ledger |
| FR-5–FR-8 | Phase 1b | Complete, no debt |
| FR-9–FR-10, FR-12 | Phase 3 | Built, unit-tested. D-2 (live-fire) carried to Phase 4 |
| FR-11 | Phase 3 | Complete, no debt |

**Deferred:** FR-13–FR-16 (the self-correction gate) — Stage 2 per `prioritization.md`,
defends a persona with zero real transcript evidence. Not silently dropped: named in the
"Does executing this deliver the goal?" section above as the one PRD goal this roadmap does
not cover.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| ~~Spike 1 fails — hooks unreliable~~ | — | — | **Resolved:** 21/21 real invocations logged correctly | — | closed |
| ~~Hook crash silently blocks the call it observes~~ | — | — | **Resolved:** confirmed structurally impossible per current docs (both events fire post-resolution) | — | closed |
| `tool_name`/`tool_input` shapes drift on a Claude Code upgrade | Medium, ongoing | High | Re-run Spikes 1–2 after any upgrade | solution-architect | Any Claude Code version change |
| Phase 3's "honest, no rubric yet" state becomes permanent, never actually gaining real citations | Medium | Medium | Named explicitly rather than hidden by the "ships regardless" framing — track as an open item, not a closed one | product-owner | No rubric authored after Phase 3 ships |
| **D-1** — mid-run-error firing never confirmed live | Low | Low | Fails safe by design (degrades to "not-invoked"); close opportunistically, not manufactured | agent | Next real mid-run failure |
| **D-2** — capture-tool live-fire never confirmed live | Medium | Medium-High | The one item that could produce a false "not-met" on real correct work; close via Phase 4's real usage | agent | First real screenshot taken under Phase 4 |
| Phase 4 never starts because no real project gets pointed at this plugin | Medium | High | Named as Phase 4's sole real dependency — surface it, don't let it go quiet | originator | No real usage within a reasonable window post-merge |

## Buffer

None allocated — no fixed date to buffer against. If this changes, buffer belongs on Phase 2
and Phase 3 specifically, since both carry medium (not high) sizing confidence.
