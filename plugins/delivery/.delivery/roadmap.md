# Delivery roadmap: delivery plugin self-hardening (MVP)

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-08-05
> PRD: `.delivery/prd.md` · Architecture: `.delivery/architecture.md`

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
| A clean "Accepted" verdict can no longer exist with zero self-correction checks behind it | **No — out of scope for this roadmap** | This is Stage 2 (the self-correction gate), deferred in `prioritization.md` because its actor has zero real evidence. This roadmap covers the MVP only. Anyone reading only this document should know the third goal is not yet addressed here, not discover that by absence. |

This roadmap delivers two of the PRD's three goals completely. The third is a deliberate,
recorded deferral, not a silent gap.

## Sequencing rationale

Foundational risk goes first: architecture's own precondition for trusting the
invocation-provenance decision (ADR-001) is that its hook mechanism actually fires reliably.
If that fails, the rejected, costlier alternative must be reconsidered *before* any code
exists — cheap to learn now, expensive after. The evidence-only marker has no dependency and
is scheduled freely — its placement doesn't hide risk, since nothing else waits on it.

**A prioritisation inversion, decided here, not silently re-staged:** the verification-channel
work was originally sized the same tier as the invocation-ledger work, but architecture
revealed a real, external dependency — an actual design rubric document has to be authored
by a design lead, on no committed schedule, before a quality claim can cite a real rule.
Product Owner's ruling: **do not gate shipping on that authorship.** Ship the channel check
(a claim must point to a real, logged screenshot) and the honesty rule (a quality claim must
cite a real rule, or say plainly that no rubric exists yet) as soon as the ledger exists.
The rubric, whenever it arrives, gives that already-shipped check real teeth automatically —
it does not need to exist for the check itself to ship. This removes what would otherwise
be the plan's least controllable dependency from the critical path entirely.

## Phases

### Phase 0: prepare the rubric's citation slot

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

### Phase 1: foundational spikes

**Entry criteria:** Phase 0 complete (no real dependency, just convenient to do first).
**Delivers:** a checkable answer to whether the chosen mechanism (ADR-001) is trustworthy.
**Demonstrable exit:** across at least 20 real Skill invocations in one live session, the
fraction that produce a complete, correctly-timed ledger entry — plus a confirmed answer on
crash isolation and the real tool-call field names.

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

**Decision fork, named explicitly:** if Spike 1 comes back unfavorable, ADR-001 is void.
The next step is not "proceed anyway" — it is returning to architecture to reconsider the
rejected, costlier alternative (a blocking session-end check) before writing any
invocation-ledger code.

### Phase 1b: evidence-only marker (parallel, anytime)

**Entry criteria:** none.
**Delivers:** the requirements protecting the operator who checks in periodically from
trusting a stage backed entirely by unconfirmed evidence.
**Demonstrable exit:** replaying the real elba-dreaming persona set (four of five
unconfirmed) produces the marker on exactly the right stage, and no other.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Evidence-only marker rule + template slot | S | high | nothing |

**Verification in this phase:** example-based fixtures — mixed evidence, zero-persona,
elba-dreaming replay, marker-clears-on-upgrade.
**Cut list:** nothing to cut — already minimum viable; the discrimination check (no
over-flagging) is what stops it becoming noise nobody trusts.

### Phase 2: invocation ledger

**Entry criteria:** Phase 1's spikes confirm the mechanism is trustworthy.
**Delivers:** the requirements protecting the operator who insists on spec-traceable proof.
**Demonstrable exit:** a real session containing a retry and a mid-run error; the status
report correctly shows invoked, not-invoked, and untraceable for each, matching the real
attractor-orchestration incident when replayed.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Hook + script + ledger | M | medium | Phase 1 |
| Status reporting cross-reference, all edge cases | M | medium | ledger existing |

**Verification in this phase:** integration tests, fixture-driven, covering every edge-path
row in the PRD's own table for this scenario.
**Cut list:** display polish drops before correctness — a working, plain report ships before
a well-formatted one.

### Phase 3: verification channel + rubric

**Entry criteria:** Phase 2's ledger exists. Does **not** wait on rubric authorship (see
Sequencing rationale) — ships honest either way.
**Delivers:** the requirements protecting the operator who checks in periodically from a
"renders correctly" claim with nothing real behind it.
**Demonstrable exit:** the real elba-dreaming screenshot, run through this check today
(no rubric yet), produces "criteria could not be checked" — honestly, not silently passed.
Once a rubric exists, the same screenshot produces a not-met verdict citing the real
alignment rule that caused the defect.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Shared channel+rubric check, in `qa-strategist`, reused by `sprint-review` | M | medium | Phase 2, Spike 4 |
| No-rubric honesty path | S | high | above |

**Verification in this phase:** integration + spike-dependent for the channel check;
example-based for rubric-present/absent/elba-dreaming-replay fixtures.
**Cut list:** the exact-reproduction demo (matching elba-dreaming's precise defect) drops
before the general "must" requirements — the honesty rule and channel check ship regardless.

## Critical path

```
Phase 0 → Phase 1 (spikes) → Phase 2 (ledger) → Phase 3 (channel + rubric)
```

Phase 1b runs alongside without affecting this chain. Rubric *authorship* (unscheduled,
design-lead work) is explicitly **not** on this path, per the inversion decision above — it
was the plan's least controllable dependency until removed from the critical path entirely.

**To shorten it:** run Spike 4 inside Phase 1 rather than deferring it to Phase 3 —
everything else is already sequenced at its minimum.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Design rubric content (not the citation slot — that's Phase 0) | design-lead | Whenever it arrives | Not started, no schedule | No impact on shipping — Phase 3 ships honest either way, per the inversion decision |
| Claude Code's hook payload shape staying stable | Anthropic | Ongoing | Verified current as of this session | Spikes 1–2 must re-run after any Claude Code upgrade |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1–FR-4 | Phase 2 | |
| FR-5–FR-8 | Phase 1b | |
| FR-9–FR-12 | Phase 3 | Ships honest without a rubric; gains real citations once one exists |

**Deferred:** FR-13–FR-16 (the self-correction gate) — Stage 2 per `prioritization.md`,
defends a persona with zero real transcript evidence. Not silently dropped: named in the
"Does executing this deliver the goal?" section above as the one PRD goal this roadmap does
not cover.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Spike 1 fails — hooks unreliable | Medium | High | Named decision fork in Phase 1 — reconsider ADR-001's rejected alternative before writing ledger code | solution-architect | Spike 1's measured fire-rate is materially below 100% |
| Hook crash silently blocks the call it observes | Low | High | Deliberate throw-and-observe test, Phase 1 | agent | Spike 5 fails |
| `tool_name`/`tool_input` shapes drift on a Claude Code upgrade | Medium, ongoing | High | Re-run Spikes 1–2 after any upgrade | solution-architect | Any Claude Code version change |
| Phase 3's "honest, no rubric yet" state becomes permanent, never actually gaining real citations | Medium | Medium | Named explicitly rather than hidden by the "ships regardless" framing — track as an open item, not a closed one | product-owner | No rubric authored after Phase 3 ships |

## Buffer

None allocated — no fixed date to buffer against. If this changes, buffer belongs on Phase 2
and Phase 3 specifically, since both carry medium (not high) sizing confidence.
