<!--
BUDGET — target 700 words, hard cap 1100 words. Excludes code, YAML and data tables.
Scoring and stage tables are data.
-->

# Prioritisation and MVP staging

> Phase 6 artifact. Owned by Product Owner, with Program Manager and User Researcher.
> Value pass — effort figures here are pre-architecture estimates, reconciled against real
> cost in `roadmap.md`.
> Evidence basis: no persona in this project is graded `observed`. P-1/P-2/P-3 are `reported`;
> P-4 is `assumed`. Last updated: 2026-08-06

**No `.delivery/simulations/` or `.delivery/interviews/` directory exists for this project.**
There is no friction map and no interview objection to cite. Every score below is team
opinion grounded in the PRD and personas, not observed or reported user behavior — a
legitimate choice, but the resulting stages rest on the team's beliefs about value, not a
model of user behavior. The Confidence column is the grounding grade of the *persona*, not
evidence the score itself is correct.

## Staging rule

A stage is not a batch of features. A stage is a set of features that lets at least one
persona complete a journey end to end and get value. A stage serving nobody completely is a
project milestone, not a release.

## Requirement scoring

No interviews exist, so Objection-answered is `—` for every row and omitted below.

| FR | Scenario | Production reality | Personas served | Load-bearing | Severity | Effort (pre-arch.) | Confidence |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| FR-1 | S1 | Shipped | P-2 | Yes | Critical | S (done) | reported |
| FR-2 | S1 | Shipped | P-2 | Yes | Critical | S (done) | reported |
| FR-3 | S1 | Shipped | P-2 | No — failure-path diagnostic | Minor | S (done) | reported |
| FR-4 | S1 | Shipped, coverage assertion only | P-2 | No — test coverage, no behavior change | Minor | S (done) | reported |
| FR-5 | S2 | Spec-complete, not coded — `Handler.HUMAN` unregistered | P-2 | Yes | Critical | S | reported |
| FR-6 | S2 | Spec-complete, not coded | P-2 | Yes | Critical | S | reported |
| FR-7 | S2 | Spec-complete, not coded (regression guard) | P-2 | No — protects an existing guarantee | Major | S | reported |
| FR-8 | S2 | Spec-complete (resolved 2026-08-06), not coded | P-2 | Yes — gate has no exit without it | Critical | L | reported |
| FR-9a | S4 | Blocked — Open Q9 | P-2, P-1 | Yes, if chosen | Critical | M (reverses a withdrawn fix) | reported |
| FR-9b | S4 | Blocked — Open Q9, alternate resolution | P-2, P-1 | Partial — design-time only | Major | S | reported |
| FR-10 | S5 | Shipped | P-2 | Yes | Critical | S (done) | reported |
| FR-11 | S6 | Shipped | P-2 (see finding below) | Yes | Critical | S (done) | reported |
| FR-12 | S6 | Blocked — Open Q7 | P-2 | No — FR-11 alone closes the safety gap | Minor | S | reported |
| FR-13 | S7 | **Shipped 2026-08-10** (overridden, ADR-015) | P-1, P-4 | Yes, within S7 | Major | M | P-1 reported / P-4 assumed |
| FR-14 | S7 | **Shipped 2026-08-10** (overridden, ADR-015) | P-1, P-4 | Yes, within S7 | Major | S | P-1 reported / P-4 assumed |
| FR-15 | S7 | **Shipped 2026-08-10** (overridden, ADR-015) — P-4's named abandonment trigger, now closed | P-1, P-4 | Yes for P-4, No for P-1 | Major (P-4) / Minor (P-1) | S | P-1 reported / P-4 assumed |
| FR-16 | S7 | **Shipped 2026-08-10** (overridden, ADR-015) | P-1, P-4 | Yes, within S7 | Major | M | P-1 reported / P-4 assumed |
| FR-17a | S3 | Shipped | P-2 | Yes — clean refusal replaces a mid-run crash | Major | S (done) | reported |
| FR-17b | S3 | Blocked — Open Q3/4/5 | P-2 | Yes, eventually — no live friction yet, S3 unattemptable today | Critical (potential) | L (floor, not ceiling) | reported |
| FR-18 | S2 | Not started — fully speced, adversarially reviewed | P-2 directly; gates the future `agent`-channel sub-slice of FR-8 | Conditional — precondition for `agent`, not for `human` | Critical for the hazard closed; advisory-only mechanism | S | reported |

**Two findings, not silently absorbed into the table:** FR-11/FR-12's PRD-stated actor is
P-2, but the mechanism — a programmatic `new Engine(...)` embed — maps more naturally to P-3
(Composer); the PRD currently credits P-3 with none of S6's value. And FR-18's cited
"adversarial review" is not independently traceable to a committed file outside the PRD row
and one `carry-forward.md` paragraph — flagged, not silently trusted.

## Stages

### MVP (shipped) — already true in production

**Includes:** FR-1, FR-2, FR-3, FR-4, FR-10, FR-11, FR-17a.
**Personas who can complete a journey end to end:** P-2 — install without cloning the
monorepo, run `doctor`, get two real bug fixes (D7, F10), and a clean pre-run refusal
instead of a raw crash. Confidence: reported.
**Not served:** P-1 (no authoring layer), P-3 (no composition mechanism — its own research
pass, out of this PRD entirely), P-4 (irrelevant until ported authoring docs exist). No date.
**What it taught:** the packaging approach works; both founding-incident-adjacent bugs were
real and fixable, not hypothetical.

### Stage 2 — HITL-003 self-report guard (FR-18)

**Includes:** FR-18 only.
**Honest caveat, not a persona claim:** this stage does not complete a new persona journey —
it hardens a channel (`agent`) that has no runtime yet (FR-8 is uncoded). It earns its own
stage on different grounds: fully speced, zero open questions, `S`-sized using the proven
`HAND-001` pattern, and a required precondition before the `agent` channel ships, per
`carry-forward.md`'s Plan 4 — the guardrail before the road opens, not after.
**What it teaches:** whether a lint-time, single-hop predecessor trace is sufficient in
practice, or whether real authored graphs immediately need the multi-hop /
`Handler.TOOL`-without-`outputs=` extension the design already flags as residual risk.

### Stage 3 — Human-gate core (FR-5, FR-6, FR-7, FR-8)

**Includes:** register `Handler.HUMAN`, wire `Channel → GateContext → preferredLabel →
selectEdge`, at minimum the blocking `human` channel per ADR-002.
**Personas who can complete a journey end to end:** P-2 — author or receive a pipeline with a
human gate, have it block correctly (FR-5/6), submit an answer, take the correct edge (FR-8),
with `HITL-001`'s guarantees intact (FR-7). First stage closing the brief's "a working human
gate" goal. Confidence: reported.
**Sequencing note:** the `human` channel has no dependency on Stage 2. Only FR-8's `agent`
sub-slice does — that sub-slice should not ship until Stage 2 lands.
**Not served:** P-1, P-3, P-4 — unchanged from MVP, no date.
**What it teaches:** whether the channels design — chosen 5/5 by a multi-lens comparison but
never built — actually delivers a working, resumable gate.

### Not yet stageable — blocked on an open decision

**FR-9a / FR-9b** (Open Q9, PO + Solution Architect): mutually exclusive; only one ships.
This is the project's own founding-incident class and currently sits in no stage — a gap
worth naming loudly, not leaving comfortable.
**FR-12** (Open Q7, Solution Architect): a scope call, not an engineering unknown.
**FR-17b** (Open Q3/4/5, PO): the largest remaining architecture lift; `L` is a floor until a
spike runs.

### Explicitly not doing this cycle — FR-13, FR-14, FR-15, FR-16 (S7)

**Why it can wait:** P-2 — the persona with the strongest grounding and the only one MVP
already serves completely — needs none of it. P-1 and P-3 stay unserved either way; S7 is a
`could`, and composition (P-3's actual blocker) has no mechanism today regardless. Committing
now would optimize for P-1/P-4 before Stage 3 proves the channels design for the persona
already in production.
**Not served, no date:** P-1, P-4. FR-15 rests entirely on P-4's `assumed`-grade belief —
worth remembering if S7 is ever prioritized.

**Overridden 2026-08-10 — this reasoning stands, the deferral does not.** Confirmed still
true (Stage 3/`Handler.HUMAN` still unbuilt) before acting, not assumed stale; the project
owner directed building S7 now anyway. See
[ADR-015](../../decisions/ADR-015-s7-deprioritization-override.md). This section's own
analysis is not retracted — P-2 genuinely needs none of S7, and it remains the honest
account of why this stage would otherwise wait. It is recorded here as the historical
reasoning an explicit override was made against, not corrected to read as if S7 had always
been in-cycle.

## Milestones

| # | Type | Demonstrable outcome | Shown to | Depends on |
| :-- | :-- | :-- | :-- | :-- |
| M1 | Release (already happened) | Install, doctor, D7/F10 fixes, HAND-001 refusal live | Project owner | Phase 0 |
| M2 | Learning | `HITL-003` fires/doesn't fire correctly across the fixture matrix | Project owner | Stage 2 |
| M3 | Release | A pipeline with a `human` gate blocks, is answered, takes the right edge | Project owner, P-2 | Stage 3 |

## Confidence

No persona here is `observed`. P-1/P-2/P-3 are `reported`; P-4 is `assumed`. No stage above
rests solely on `assumed`-grade evidence — the one place it carries real weight is FR-15
inside the deferred S7 bucket, named there rather than buried in the table.

## Open questions for the originator

Open Question 9 (FR-9a vs FR-9b) is this project's own founding-incident class and currently
owns no stage — recommend a PO+SA decision session scheduled now, independent of Stage 2's
sequencing. Open Questions 3/4/5 and 7 need the same owner attention before Stages past
Stage 3 can be sized at all.

**Recommendation:** ship Stage 2 (FR-18) next — cheapest, fully speced, zero open questions,
and it retires risk before Stage 3 opens the door it guards.
