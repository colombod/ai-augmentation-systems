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

# Roadmap: Chief of Staff epic (additive)

> New section, appended. Does not modify any phase above — those cover only the shipped
> `harden` epic (S-1–S-4/`FR-1`–16) and are complete. This section covers `prd.md`'s Chief of
> Staff epic (S-6–S-12/`FR-20`–55) only.
> Owned by Program Manager, with QA Strategist and Solution Architect.
> Status: draft — no phase started.
> PRD: `.delivery/prd.md` (Chief of Staff epic) · Architecture: `.delivery/architecture.md`
> (Chief of Staff section) · ADRs: `ADR-002`, `ADR-003`
> **Word count: the whole document is now 3877 prose-only words** (was 1422 before this
> section; `grep -v '^|' .delivery/roadmap.md | wc -w`). Exceeds the template's 1100-word hard
> cap, same reasoning `architecture.md`'s own second section states: two independent epics
> now coexist in one roadmap, each sequenced and reviewed on its own terms — halving the
> budget would cut real dependency reasoning, sizing rationale, or a cut-list decision this
> document exists to make now rather than under pressure.

## Constraints — reused, not re-asked

Same project, same operator, same mode of working as the harden epic above: **one Claude
Code agent implementing, one human operator reviewing** — no team to parallelize across.
**Fixed dates:** none. **Fixed variable:** scope, not date. Nothing about this epic changes
any of that; it is not re-derived here.

## Resolving the sequencing question: does Spike CoS-1 need the full build first?

**No — a thin walking skeleton, and it can run as this epic's own Phase 0-equivalent.**
`architecture.md`'s Spike CoS-1 needs "the standing-instruction-block + direct-subagent-call
design in place" — not the finished epic. What CoS-1 actually measures is whether the
*calling* agent makes a real tool call instead of narrating one; the Test strategy section
states this explicitly as "a harder, different question from whether chief of staff decides
correctly once invoked." Full S-7/S-8 classification logic, the complete briefing assembler,
all nine pointer sections — none of that changes what CoS-1 counts. Building it first would
sit real schedule cost in front of the epic's one plan-invalidating risk for no measurement
benefit.

This is exactly `harden-02`'s own precedent: a temporary hook registration and a probe script
that "dumps raw hook stdin to a scratch file," explicitly "a throwaway probe, not the real
implementation" — proving the mechanism before building the thing the mechanism protects.
The same move here: `agents/chief-of-staff.md` built thin enough to do S-6's citation check
for real (the simplest of the three, and the one scenario with `observed`-grade evidence
already) and stub a plausible answer for the bounce/spike/queue outcomes, wired to a real
`subagent_type` so every call is ledger-visible — plus the pointer section added to exactly
the 2 consulting-agent files CoS-1's own "≥2 different consulting-agent types" bar requires,
not all 9. This is Phase 5 below.

## Sequencing rationale — risk-first

`ADR-002` states plainly that a bad CoS-1 result means the epic's core premise — a
convention-only mechanism can raise consultation rates enough to matter — "is unworkable as
scoped," and routes back to product-owner as a scope call, not to solution-architect as an
engineering problem to solve harder. That is exactly the plan-invalidating risk this
doctrine says to front-load, so Phase 5 is CoS-1 (with CoS-2 alongside — smaller, and needs
only the same real subagent to dispatch against).

After spikes resolve favorably, the rest sequences by real dependency, not by comfort:
foundational infrastructure first (Phase 6 — decision log, mission capture, queue scaffolding,
the `FR-51` fallback), because S-6's `FR-23`, S-11 entirely, and S-9's queue-reading all read
or write it. S-6/S-7/S-8's complete triage logic (Phase 7) builds directly on that. S-11
(Phase 7b) needs only `mission.md` from Phase 6, not Phase 7's output, so it runs alongside
Phase 7 with no forced order — same convention Phase 1b established for the harden epic:
"parallel" means no dependency forces an order, not simultaneous execution, since one agent
executes everything serially regardless. S-9 (Phase 8) needs both: real S-6/S-7/S-8 survivors
to assemble, and S-11 to exist at all before `FR-52`'s merge case is even testable. Last, the
full 9-agent pointer-section rollout (Phase 9) — distinct from the 2-agent thin rollout CoS-1
itself needed — is what actually exposes the mechanism epic-wide, deliberately sequenced after
the whole S-6–S-9+S-11 mechanism is real rather than after Phase 5's own thin proof.

## Second prioritisation pass

`prioritization.md` predates this epic — it covers only `FR-1`–16. There is no prior estimate
to reconcile against, so this is a fresh check, not a re-check, per the roadmap skill's own
step 2: does architecture reveal a real inversion — something assumed cheap that turned out
expensive, or the reverse?

**One real inversion, both directions, from the same finding.** `architecture.md`'s two
content passes (qa-strategist's Test strategy, feature-critic's adversarial pass) found:
**assumed cheap, actually carries real judgment cost** — Phase 9's "add a short section to 9
files" reads, from the PRD's terse FR list alone, like uniform, mechanical work. Architecture
found otherwise for 2 of the 9: `business-analyst.md` and `solution-architect.md` each already
carry a pre-existing, working escalation habit that the new section must explicitly reconcile
with, not silently duplicate or override — a per-file judgment call, not copy-paste, reflected
below as Phase 9's own two-tier sizing (S for 5 files, M for 2). **Assumed expensive, turned
out free** — at brief/PRD time, a new subagent, a new persistent store, and cross-agent queue
coordination would ordinarily read as exactly the kind of technical unknown worth a spike.
Architecture's own "What does not need a spike" section found all three ride entirely on
infrastructure the harden epic already live-verified 21/21 — reflected below as high-confidence
S-sizing across most of Phase 6.

**Recommendation to product-owner:** no re-staging needed — both inversions net out inside
this roadmap's own sizing, not against a committed date or a cut scenario. Flagged so the next
planning cycle doesn't walk in assuming Phase 9 is trivial, or that Phase 6 carries spike-level
risk it does not.

## Phases

### Phase 5: foundational spikes — CoS-1 (walking skeleton) + CoS-2

**Entry criteria:** the harden epic's Phase 4 is complete (already true) — its live-verified
ledger (`hooks/hooks.json`'s `Agent` matcher, `record-invocation.js`'s `subagent_type`
extraction, 21/21) is what makes a real chief-of-staff call detectable at all.
**Delivers:** a checkable answer to whether `ADR-002`'s mechanism is worth its coordination
cost — the epic's central risk, made checkable rather than assumed.
**Demonstrable exit:** a spike-results table — per trial, whether a real ledger-confirmed
`chief-of-staff` Agent-tool call happened, a narrated claim with no matching entry, or no
attempt at all — across ≥10 trials, ≥2 agent types, ≥3 inside one continuous long session; plus
CoS-2's confirmation that parallel subagent dispatches return batched, not interleaved.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Walking skeleton: `agents/chief-of-staff.md` (real S-6 citation check, stubbed rest), pointer section on exactly 2 consulting-agent files | S | high | Phase 4 |
| Pre-register CoS-1's trial task list + "genuine candidate question" definition, blind to outcome (feature-critic's own fix, folded into the spike design) | S | high | walking skeleton |
| Run CoS-1 — ≥10 trials, ≥2 agent types, ≥3 inside one continuous long session | M | high (question is falsifiable; 2-day timebox) | pre-registration |
| Run CoS-2 — confirm parallel-dispatch batching | S | high (0.5-day timebox) | walking skeleton |

**Verification in this phase:** the spikes are the verification — architecture's own "empirical
spike, not a test" framing; no fixture substitutes for a real session choosing to call or not.
**Cut list:** CoS-1 is not cuttable — it is this epic's own precondition, and a result below
its pass bar routes to product-owner as a scope call, not a rebuild (`ADR-002`'s revisit
clause). CoS-2 can slip to just before Phase 8, since only `FR-50`'s concurrent-ordering half
needs it — same "smaller spike can slip" precedent the harden epic set for its own Spike 4.

### Phase 6: foundational infrastructure

**Entry criteria:** Phase 5's CoS-1 result clears its pass bar (≥70% real-consultation rate,
not lower than the narrated-without-invocation rate). A result below bar does not enter this
phase — it goes to product-owner instead, per `ADR-002`.
**Delivers:** the shared substrate every later scenario reads or writes: the decision log
(`FR-23`, `FR-55`), mission capture's storage half (Interface 4), queue scaffolding
(Interface 3), and the epic-wide fallback (`FR-51`).
**Demonstrable exit:** a hand-fired fixture produces a real decision-log NDJSON entry with the
minimum required fields; a fixture captures a verbatim mission excerpt into `mission.md`; a
fixture appends a real entry to `queue.md`; a fixture where the chief-of-staff call
errors/is unconfigured shows the calling agent falling back to asking the operator directly,
never blocking.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Upgrade the walking skeleton to a registered subagent with the full four-outcome return contract (answered/bounced/spiked/queued) | M | medium | Phase 5 |
| Decision-log write mechanism, NDJSON, minimum fields (`category`, `citable_traceback`, `ts`) | S | high (identical, already-proven pattern to the invocation ledger) | subagent above |
| `templates/mission.md` + capture mechanism (capture half only — S-11's drift-check logic is Phase 7b) | S | high (plain markdown; architecture names this as needing no spike) | — |
| `templates/chief-of-staff-queue.md` + queue read/write scaffolding | S | high (plain markdown, no new mechanism) | — |
| `FR-51` fallback path, built and example-based-tested | S | high | subagent above |

**Verification in this phase:** example-based fixtures, per architecture's Test strategy
table's `FR-51` row and decision-log format/schema row.
**Cut list:** the decision log's optional fields (`fr`, `scenario`, `raised_by`, `resolution`
beyond `open`) drop first — architecture names these "revisable at story time"; the three
minimum-required fields (`category`, `citable_traceback`, `ts`) are not cuttable, they are the
glossary's own definition of a decision-log entry.

### Phase 7: S-6/S-7/S-8 complete triage logic

**Entry criteria:** Phase 6 complete.
**Delivers:** `FR-20`–25, `FR-27`–31, `FR-53`.
**Demonstrable exit:** architecture's own Test-strategy fixtures replayed against the real
agent, not stubbed — exact-citable-source / interpretation-required / two-disagreeing-sources
/ no-source-at-all (S-6); traces-to-requirement vs no-trace (S-7); real-execution-answerable
vs operator-authority-required (S-8) — each producing the documented behavior.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Complete S-6 (upgrade Phase 5's stub: stale-reflag case, `FR-23` decision-log wiring) | S | high (core logic already proved live in Phase 5) | Phase 6 |
| Build S-7 (bounce classification, messaging, twice-bounced escalation, full Case table) | M | medium | Phase 6 |
| Build S-8 (technical-unknown classification, spike citation, split-question handling, unclaimed-spike surfacing) | L | medium (qa-strategist's own table rates most of this "High" risk; more Case-table branches than S-6/S-7) | Phase 6 |

**Verification in this phase:** example-based + integration, per architecture's Test-strategy
table rows for S-6/S-7/S-8.
**Cut list:** `FR-30` (matching-spike citation) and `FR-53` (unclaimed-spike surfacing) drop
first — both "should," not "must," in the PRD's own FR table. `NFR-6`'s exact non-blocking
threshold stays open regardless of time pressure — the mechanism (one named constant) ships
either way; only the number waits on qa-strategist.

### Phase 7b: S-11 mission capture + drift-check — parallel with Phase 7

**Entry criteria:** Phase 6 complete (`mission.md` exists). No dependency on Phase 7 — single
agent executes both serially in whatever order is convenient; nothing forces one before the
other.
**Delivers:** `FR-40`–43, `FR-55`.
**Demonstrable exit:** a fixture where output passes S-7 (traces to a stated requirement) but
independently diverges from the captured mission still gets flagged, naming the mission line,
the diverging output, and the connecting reason; a paraphrase-attempt fixture is rejected in
favor of verbatim text or a citable pointer.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| S-11 drift-check logic + full Case table (legitimate-evolution resolution, recapture, zero-state) | M | medium | Phase 6 |
| `FR-55` — wrong drift flag recorded in the decision log | S | high (reuses Phase 6's decision-log mechanism; same trigger-then-log pattern as `FR-23`) | above, Phase 6 |

**Verification in this phase:** example-based + integration, per architecture's Test-strategy
table.
**Cut list:** `FR-55` drops first — "should," not "must." The recapture Case-table row
(revision-history table, one decision-log entry) is not cuttable: it is this epic's own
evidence trail for whichever way product-owner eventually answers Open Question 10.

### Phase 8: S-9 briefing assembly + FR-52 merge

**Entry criteria:** Phase 7 **and** Phase 7b both complete — S-9 needs real S-6/S-7/S-8
survivors to assemble, and `FR-52`'s merge case is not even testable until S-11 exists.
**Delivers:** `FR-32`–35, `FR-48`–50, `FR-52`, `FR-54`.
**Demonstrable exit:** a fixture with ≥2 survivors from different scenarios lands in one
report, ranked, blocking first; a zero-survivor fixture states "nothing survived triage,"
never silently absent; a blocking item with no open counterpart is pushed alone outside a
pull; an output flagged by both S-7 and S-11 routes as one merged item, not two.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Briefing accumulation, ranking, default/no-default marking (`FR-32`–35) | L | medium (9 FRs under one scenario; architecture calls this "the scenario's core... guarantee") | Phase 7, Phase 7b |
| Push exception (`FR-48`/49) + mid-exchange pause/resume (`FR-50`'s pause/marker half) | M | medium | above |
| `FR-50`'s concurrent-arrival ordering half | S | medium — inherits Spike CoS-2's confirmed batching assumption; not tested ahead of it | Phase 5 (CoS-2) |
| `FR-52` merge integration test | S | high (structural read-before-insert check, already specified in architecture's Interface 2) | Phase 7, Phase 7b |
| `FR-54` grouped/summarized briefing at scale | S | high (reuses S-1's already-shipped grouping convention) | above |

**Verification in this phase:** integration (`FR-32`, `FR-50`'s pause/resume) + example-based
(`FR-33`/34/48/49/52/54), per architecture's table.
**Cut list:** `FR-54` (grouped/summarized display) drops first — "should," same precedent the
harden epic set for its own Phase 2 ("a working, plain report ships before a well-formatted
one"). `FR-50`'s concurrent-ordering half stays gated on CoS-2 regardless of pressure — testing
it ahead of a confirmed batching assumption tests the wrong thing.

### Phase 9: full 9-agent pointer-section rollout

**Entry criteria:** Phase 8 complete — the whole S-6–S-9+S-11 mechanism is real, not just
Phase 5's own 2-agent thin rollout.
**Delivers:** extending `ADR-002`'s pointer section from the 2 agents CoS-1 needed to the
remaining 7 — what actually exposes the mechanism epic-wide.
**Demonstrable exit:** all 9 consulting-agent files (every agent but `persona-simulator.md`,
deliberately excluded — it role-plays an end user, not a pipeline worker) carry the "##
Chief of staff" section, same location and register as their existing "## Language" section;
`business-analyst.md` and `solution-architect.md`'s sections explicitly reconcile with, rather
than duplicate, their pre-existing escalation habits.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Pointer section on the 5 files with no pre-existing escalation habit to reconcile | S | high (mechanical; the "## Language" pattern already proven to survive 10 files with no drift) | Phase 8 |
| Pointer section on `business-analyst.md` and `solution-architect.md`, with the explicit reconciliation text architecture.md already specifies | M | medium (a judgment call per file, not copy-paste — this phase's own inversion finding above) | Phase 8 |

**Verification in this phase:** a read-through diff against the "## Language" section's own
precedent — markdown only, not logic, same reasoning the harden epic gave Phase 0's template
edit.
**Cut list:** roll out first to the epic's own named "three senior lenses" (business-analyst,
solution-architect, product-owner — architecture's Positioning section centers the mechanism
on them), deferring the remaining agents. Partial rollout still delivers more real coverage
than Phase 5's 2-agent thin rollout, even though it does not yet expose the mechanism
epic-wide.

### Phase 10: Stage-2 — S-10, S-12 — named future phase, not built now

Per `prd.md`'s own staging (S-10, S-12 explicitly deferred) and the same precedent the harden
epic set for its own Stage 2 (`FR-13`–16): not entered until product-owner opens it. S-10's own
**Grounding: assumed** — zero data exists until Phases 5–9 ship and produce real, logged
S-6–S-9 outcomes to learn from, the same ledger-before-consumer sequencing the harden epic
already used once. No entry criteria are defined beyond that; scoping this phase for real is
future work, not a placeholder to fill in now.

**Delivers if opened:** `FR-36`–39 (S-10 learned shortcuts), `FR-44`–47 (S-12 repo-doc gap
checks).
**Cut list:** the entire phase is the cut — same pattern the harden epic used for its own
`FR-13`–16 deferral.

## Dependency map

```
Phase 5 (CoS-1, CoS-2)
   └─ Phase 6 (subagent + decision log + mission.md + queue.md + FR-51)
        ├─ Phase 7  (S-6/S-7/S-8 triage)   ─┐
        └─ Phase 7b (S-11, parallel)        ├─ Phase 8 (S-9 + FR-52 merge) ─ Phase 9 (9-agent rollout) ─ Phase 10 (Stage-2, not built)
```

## Critical path

```
Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9
```

Phase 7b runs alongside Phase 7 without lengthening this chain, same convention Phase 1b
established above. Given one Claude Code agent implementing, this chain is nearly the entire
roadmap — the same shape the harden epic's own critical path had. **To shorten it, one of
these would have to change:**
1. A clean CoS-1 pass on its first 2-day timebox, with no pivot back to product-owner — a
   CoS-1 failure does not lengthen this chain, it invalidates everything after it (`ADR-002`'s
   revisit clause), so the single biggest schedule variable is whether the walking skeleton
   clears the bar on the first attempt, not how much staff time is thrown at it.
2. Reusing architecture.md's own Test-strategy table directly as Phase 7 and Phase 8's
   acceptance criteria — already fixture-by-fixture specified per FR — rather than re-deriving
   fixtures at story time. This is the one real, avoidable rework cost on the two largest
   phases.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Product-owner's answer to Open Question 10 (who has standing to recapture the mission) | product-owner | Before Phase 7b's recapture Case-table row ships in full | Not yet asked; a worked example is already given in `architecture.md`'s Interface 4 | The mechanism ships supporting either answer — an agent-proposed recapture stays "pending" until confirmed; no phase blocks |
| qa-strategist's confirmation of CoS-1's provisional pass bar (≥70%, not below the narrated rate) | qa-strategist | Before Phase 5 exits | Provisional, stated in `architecture.md`, not yet confirmed | Phase 5 exits against an unconfirmed bar — low risk, confirmable same-day as the spike runs |
| qa-strategist's numbers for `NFR-6`/7/9/11 (thresholds shipping as mechanism-only) | qa-strategist, product-owner | Whenever set — no phase blocks on it | Open, no schedule | Mechanisms ship regardless — same inversion-decided pattern the harden epic used for its own rubric-authorship dependency |

## Requirement coverage (Chief of Staff epic)

`FR-26` does not appear in `prd.md`'s FR table at all — retired before this pass, not a gap
introduced here.

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-20–22 | Phase 7 | Core citation-or-nothing logic; exercised in thin form by Phase 5's own walking skeleton first |
| FR-23 | Phase 7 | Needs Phase 6's decision log to exist |
| FR-24, FR-25 | Phase 7 | S-7 bounce classification + messaging |
| FR-27 | Phase 7 | Twice-bounced escalation |
| FR-28–31 | Phase 7 | S-8 classification, spike routing, split-question handling |
| FR-53 | Phase 7 | Unclaimed-spike surfacing — "should," see Phase 7's cut list |
| FR-32–35 | Phase 8 | S-9 briefing accumulation, ranking, default logic |
| FR-48–49 | Phase 8 | Push exception |
| FR-50 | Phase 8 | Pause/resume half in Phase 8; concurrent-ordering half inherits Spike CoS-2 (Phase 5) |
| FR-51 | Phase 6 | Built and tested here; re-exercised across all 9 agents at Phase 9's rollout |
| FR-52 | Phase 8 | Needs both Phase 7 (S-7) and Phase 7b (S-11) |
| FR-54 | Phase 8 | "Should," see Phase 8's cut list |
| FR-40–43 | Phase 7b | S-11 mission capture + drift-check |
| FR-55 | Phase 7b | "Should," see Phase 7b's cut list |

**Deferred, Stage-2, Phase 10 (not built this round):** `FR-36`–39 (S-10, learned shortcuts —
`prd.md`'s own staging, zero data exists until Phases 5–9 ship), `FR-44`–47 (S-12, repo-doc
gap checks — `prd.md`'s own staging, weakest-precedented scenario). Named here, not discovered
by absence.

## Risks (reusing architecture.md's own register — nothing invented here)

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| The standing-instruction-block gets narrated past, same as Finding A — a consultation is claimed with no real call behind it | Medium–high, per precedent | High — undermines the epic's whole premise | Spike CoS-1 measures it directly; a result below bar is a scope call, not a rebuild | solution-architect, product-owner | Phase 5's CoS-1 result lands |
| `.delivery/chief-of-staff/decision-log/` confused with `.delivery/decisions/` (ADRs) by an implementer skimming the tree | Low–medium | Medium — a misplaced write corrupts either store's meaning | Distinct nesting and naming, stated explicitly in `ADR-003` | solution-architect | Any story touching either path, starting Phase 6 |
| 9 agent files carrying the new section drift out of sync over time | Low | Medium | Same risk category the "## Language" section already carries and has shown no drift on | delivery-lead | Any future edit to one agent's Chief of staff section, post-Phase 9 |
| S-11's broad trigger ("whenever new output is produced anywhere") applied literally makes every artifact write pay a mission-drift check, at real cost | Medium | Medium | Named, not solved — exact trigger granularity is a story-time scoping call | delivery-lead | Phase 7b story-scoping, before build starts |
| Two subagents dispatched in parallel both resolve a blocking item and both attempt to update `queue.md` near-simultaneously | Low | Medium if it happens — a lost update | Spike CoS-2 confirms batching; the `FR-52` merge check (read-before-insert) shares the same read-modify-write discipline | solution-architect | Phase 5's CoS-2 result; re-check if Phase 8's merge check ever fires unexpectedly |

## Buffer

None allocated — same no-fixed-date reasoning as the harden epic's own Buffer section above.
If this changes, buffer belongs on Phase 7 and Phase 8 specifically: both carry L-sized,
medium-confidence work items, the same profile the harden epic flagged for its own Phase 2/3.
