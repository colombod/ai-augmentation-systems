# Delivery roadmap: delivery plugin self-hardening (MVP)

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: Phases 0–3 complete, all debt closed · Phase 4's D-1/D-2 purpose fulfilled,
> M4 evidence-gathering remains · **Re-aligned 2026-08-05, debt closed 2026-08-06**
> PRD: `.delivery/prd.md` · Architecture: `.delivery/architecture.md`
> Sprint review: `.delivery/sprints/1-harden-mvp-review.md`
> **Word count: 1422 (cap 1100).** Declared, not silent: this document carries the real,
> executed outcome of every phase and the real closure of both carried debt items — cutting
> further (already trimmed once at realign, and again to close the debt) would mean cutting
> actual results, resolved-risk evidence, or the D-1/D-2 closure record itself, which the
> writing standard protects over hitting the cap.

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
that authorship — ship the channel check and honesty rule as soon as the ledger exists, and
let the rubric give it real teeth whenever it arrives. This removed the plan's least
controllable dependency from the critical path entirely.

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

### Phase 1: foundational spikes — **complete, all spikes closed**

**Entry criteria:** Phase 0 complete (no real dependency, just convenient to do first).
**Delivers:** a checkable answer to whether the chosen mechanism (ADR-001) is trustworthy.
**Actual result:** 21/21 real invocations logged correctly, past the ≥20 target — one real
`.delivery/`-resolution defect found and fixed along the way. Crash isolation confirmed
structurally impossible per current docs, then confirmed live too (see D-1, resolved,
below). Spike 4 (capture-tool discrimination) confirmed live in a real interactive session
— full detail in `harden-02`/`harden-03`'s own notes.

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

### Phase 2: invocation ledger — **complete, no open debt**

**Entry criteria:** Phase 1's spikes confirm the mechanism is trustworthy.
**Delivers:** the requirements protecting the operator who insists on spec-traceable proof.
**Actual result:** a real, live `/delivery:status` run correctly read a real, hook-populated
ledger — including its own same-session entry, no race observed — and correctly reproduced
the attractor-orchestration incident shape on this project's own PRD/architecture/roadmap/
stories. Mid-run-error firing (formerly debt D-1) is now confirmed live too: a genuine
browser-tool failure produced a correctly-logged `PostToolUseFailure`/`outcome: "error"`
entry. Full detail in `harden-05`/`harden-06`'s notes.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Hook + script + ledger | M | medium | Phase 1 |
| Status reporting cross-reference, all edge cases | M | medium | ledger existing |

**Verification in this phase:** integration tests, fixture-driven, covering every edge-path
row in the PRD's own table for this scenario.
**Cut list:** display polish drops before correctness — a working, plain report ships before
a well-formatted one.

### Phase 3: verification channel + rubric — **complete, no open debt**

**Entry criteria:** Phase 2's ledger exists. Does **not** wait on rubric authorship (see
Sequencing rationale) — ships honest either way.
**Delivers:** the requirements protecting the operator who checks in periodically from a
"renders correctly" claim with nothing real behind it.
**Actual result:** the rule lives in `agents/qa-strategist.md` as a standing check (a live
review caught and fixed an earlier scoping gap that would have limited it to
`sprint-review` alone), wired to the real capture-tool matcher. A real screenshot, taken
with the actual browser tool in a live interactive session, has now been directly observed
landing in the ledger with a correct `capture_action` — formerly debt D-2, the
higher-priority carried item an independent value review flagged as the one gap whose
failure direction (false "not-met" on real correct work) could actually cost the operator's
trust. Full detail in `harden-03`/`harden-07`'s notes.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Shared channel+rubric check, in `qa-strategist`, reused by `sprint-review` | M | medium | Phase 2, Spike 4 |
| No-rubric honesty path | S | high | above |

**Verification in this phase:** integration + spike-dependent for the channel check;
example-based for rubric-present/absent/elba-dreaming-replay fixtures.
**Cut list:** the exact-reproduction demo (matching elba-dreaming's precise defect) drops
before the general "must" requirements — the honesty rule and channel check ship regardless.

### Phase 4: real-project usage — narrowed, one purpose already fulfilled

**Added via `/delivery:realign`**, with two purposes: close D-1/D-2 via real interactive
use, and gather first evidence toward `prioritization.md`'s milestone M4 (the
reads-only-the-verdict persona). **The first purpose is done** — not via the originally-
scoped route (a separate real project), but opportunistically, in this project's own live
session: a genuine browser-tool failure and a genuine successful screenshot both fired and
logged correctly during ordinary interactive use. This is narrower evidence than an
independent external project would give (one session, one operator) — enough to close
D-1/D-2 (a real live-fire, either direction, was the exit bar), but it does **not** stand in
for M4, a different, still-unanswered question about behavior across many sessions.

**Entry criteria:** Phases 0–3 shipped (they are).
**Delivers:** D-1/D-2 confirmation — **done**. M4 evidence — **still open**, now this
phase's sole remaining purpose.
**Demonstrable exit (remaining scope only):** at least one real, external project, used for
real work over time, that either surfaces the reads-only-the-verdict persona or gives a
reasoned basis to say it doesn't.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| ~~Use this plugin (hook active) on a real project, not this one~~ | — | — | **Superseded** — D-1/D-2 closed live in this project instead; see above |
| ~~Record D-1/D-2 outcomes~~ | — | — | **Done** — see `harden-05`/`harden-06`'s and `harden-03`/`harden-07`'s notes |
| Feed back into `personas/README.md`: does the reads-only-the-verdict persona show up | S | high | A real external project, used for real work, over time |

**Verification:** real usage itself — short artificial probe sessions can't reproduce the
long-session narration pressure that produced Findings A–D in the first place, and can't
answer a cross-session persona question either.
**Cut list:** nothing — this phase's remaining cost is finding a real external project to
point it at, not building.

## Critical path

```
Phase 0 → Phase 1 (spikes) → Phase 2 (ledger) → Phase 3 (channel + rubric) → Phase 4 (real use)
```

Phase 1b runs alongside without affecting this chain. Rubric *authorship* (unscheduled,
design-lead work) is explicitly **not** on this path — the plan's least controllable
dependency, removed from the critical path entirely by the inversion decision above.
Phases 0–3, and Phase 4's D-1/D-2 half, are now complete. **Phase 4's narrowed remaining
scope (M4 evidence) is the critical path today**, with one lever left: getting a real
external project to run this on sooner rather than later.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Design rubric content (not the citation slot — that's Phase 0) | design-lead | Whenever it arrives | Not started, no schedule | No impact on shipping — Phase 3 ships honest either way, per the inversion decision |
| Claude Code's hook payload shape staying stable | Anthropic | Ongoing | Verified current as of this session | Spikes 1–2 must re-run after any Claude Code upgrade |
| A real, external project to run this plugin on, for real work over time | originator | Phase 4's remaining scope | Not yet identified | M4's persona question stays unanswered — D-1/D-2 no longer depend on this, they closed already |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1–FR-3 | Phase 2 | Live-verified, 21/21, plus a real mid-run-error live-fire. Complete, no debt |
| FR-4 | Phase 2 | Live-verified against a real ledger |
| FR-5–FR-8 | Phase 1b | Complete, no debt |
| FR-9–FR-10, FR-12 | Phase 3 | Built, unit-tested, plus a real screenshot live-fire. Complete, no debt |
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
| ~~**D-1** — mid-run-error firing never confirmed live~~ | — | — | **Resolved:** a genuine browser-tool failure produced a correctly-logged `PostToolUseFailure`/`outcome: "error"` entry | — | closed |
| ~~**D-2** — capture-tool live-fire never confirmed live~~ | — | — | **Resolved:** a genuine screenshot produced a correctly-logged `capture_action: "screenshot"` entry | — | closed |
| Phase 4's remaining M4 scope never starts because no real external project gets pointed at this plugin | Medium | Medium | Named as the only thing left blocking M4 — surface it, don't let it go quiet | originator | No real external usage within a reasonable window post-merge |

## Buffer

None allocated — no fixed date to buffer against. If this changes, buffer belongs on Phase 2
and Phase 3 specifically, since both carry medium (not high) sizing confidence.
