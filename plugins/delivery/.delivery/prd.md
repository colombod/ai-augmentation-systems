# PRD: delivery plugin — enforcement of its own doctrine, plus the Chief of Staff epic

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Last updated: 2026-08-07
> Brief: `.delivery/brief.md` · Glossary: `.delivery/glossary.md`
> **Word count: 4275 prose-only** (`grep -v '^|' | wc -w`) — declared overrun past the
> 1600-word single-epic cap. Reason: two independent, separately-reviewed epics now share
> one PRD (`harden`, shipped, S-1–S-4/FR-1–16; `chief-of-staff`, new, S-5–S-11/FR-17–52).
> Halving the budget across them would cut real requirement content for no reader benefit.
> The Chief of Staff epic's later growth (3713 → 4275) is the three-senior-lenses framing
> and two grounding upgrades from real session-transcript evidence (2026-08-07) — not
> restatement.

## Summary

A self-assessment: hardening the delivery plugin's own enforcement of its doctrine, plus a
second, additive epic. The brief found four ways the doctrine is sound on paper but gets
narrated past under real, long-session pressure. Four scenarios follow, one per finding,
each walking a named operator through the failure as it happened — except the operator who
reads only the verdict, which is hypothesized, not observed
(`.delivery/personas/the-trusting-delegator.md`). A fifth, later problem — the same
operator carrying the pipeline's entire question-traffic as an attention sink — is answered
by the **Chief of Staff** epic (S-5–S-11), specified after S-1–S-4 below.

## Goals and non-goals

**Goals**

- The operator who checks in periodically stops having to personally notice that a stage
  rests on unconfirmed evidence, or that "renders correctly" came from a text read.
- The operator who insists on spec-traceable proof gets a record of whether a claimed step
  actually ran, without personally auditing raw tool-call logs.
- A clean "Accepted" verdict can no longer exist with zero self-correction checks behind it —
  most needed by the operator who reads only the verdict, who can least tell it's missing.

**Decision on the brief's Open Question 2** (verification-channel scope): this iteration
covers UI-facing acceptance criteria only. The UI case has the most direct evidence;
generalizing further before that works multiplies cost against unvalidated need.

**Non-goals** — things a reader might assume are included, but are not:

- Redesigning the phase sequence — the planning half works when run; only enforcement is
  broken.
- A manual approval checkbox standing in for real verification — rejected directly in the
  evidence. A lighter checkpoint is the brief's Open Question 3, not decided here.
- Broadening the evidence base beyond the one operator studied, before scoping further.
- Extending the channel-and-rubric requirement past UI-facing criteria this iteration.
- Why narration substitutes for invocation (Open Question 4) — this PRD scopes catching it,
  not removing the incentive.
- A general-purpose scheduling primitive — only enough for S-4 is in scope.
- Team-based or multi-operator usage — not observed in either engagement studied.
- Per-project artifact scoping — already served by a fix shipped earlier this session.

## User scenarios

### S-1: A claimed step turns out to have never run

**Actor:** the operator who insists on spec-traceable proof
**Trigger:** tells the agent to continue to the next phase during a long, partly-unattended
session.
**Preconditions:** a prior phase's artifact exists; the session has run long enough that
narration-standing-in-for-a-real-step risk is elevated — a long-session failure, per the
evidence, not a fresh-session one.

**Main path**

1. The operator asks the agent to proceed to the next phase; the agent's text says it ran.
2. A check runs on whether it actually did, rather than trusting the sentence.
3. The artifact is reported invoked or not — never unstated, never assumed from the file
   alone.
4. The operator sees this from one report, without reading raw session logs (`FR-1`–`FR-4`).

**Observable outcome:** from a single report, the operator can tell which artifacts trace
to a real, invoked step and which don't.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| An artifact is later re-produced by a real step, after first being flagged as not-invoked | The earlier gap stays visible in the record; the fixed state does not silently erase it |
| The agent's tool-call history for the session is unavailable | The report says the check could not be made — never defaults to "invoked" |
| Many governed artifacts in one multi-day session | The report stays scannable (grouped/summarized), not a wall of rows nobody reads |
| The same skill is invoked twice for one artifact (retry after an error) | The most recent real invocation is the one of record; the earlier attempt does not count against it |
| A tool call for the phase appears in history but errored mid-run | Recorded not-invoked — a call that started but failed is not the same as one that completed |

**Acceptance criteria**

- `FR-1` — every governed artifact gets a stated invoked/not-invoked status; never blank,
  never a silent default.
- `FR-2` — an artifact is marked not-invoked whenever no matching step appears in the
  session's tool-call history, regardless of whether the file itself looks complete.
- `FR-3` — the real attractor-orchestration case (text names a phase done; no matching step
  in that turn's history) reproduces as not-invoked.
- `FR-4` — "not-invoked" is a distinct, scannable marker — not a blank cell mistakable for
  "invoked."

### S-2: A decision reads as settled when its only support is unconfirmed

**Actor:** the operator who checks in periodically
**Trigger:** a staging decision depends on persona evidence, made while the operator is
between check-ins rather than watching live.
**Preconditions:** a persona set with mixed evidence quality exists — matching elba-dreaming,
where four of five personas were unconfirmed.

**Main path**

1. The agent labels a stage "ready," justified entirely by unconfirmed-evidence personas.
2. The existing evidence-quality field already records this (a field the plugin's templates
   already have — this is a rule change, not new schema).
3. The "ready" label gets a visible marker instead — it can't read as plain "ready" while
   every supporting fact is unconfirmed.
4. The operator sees the marker directly while scanning the document, without reopening the
   persona files (`FR-5`–`FR-8`).

**Observable outcome:** a reader cannot mistake a stage backed only by unconfirmed evidence
for one backed by confirmed evidence, without the document itself saying so.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| A stage mixes one confirmed and one unconfirmed persona | No marker — the rule flags only when *everything* behind a decision is unconfirmed, or it degrades into flagging everything |
| A segment has no way to be confirmed yet, by design | Marker still applies; whether that's an accepted, standing exception is an open question below, not decided here |
| A stage cites zero personas at all | Marker applies — "nothing" is a stricter case than "all unconfirmed," not an exemption from it |
| A cited persona's evidence grade is upgraded after the marker was applied | The next read of the stage re-checks and clears the marker if it no longer applies — the marker is not a one-time stamp |

**Acceptance criteria**

- `FR-5` — a stage backed entirely by unconfirmed evidence never renders as plain "ready";
  it always carries a visible marker.
- `FR-6` — the marker appears in the document actually scanned for the decision, not only
  recoverable by separately opening the persona files.
- `FR-7` — a mixed-evidence stage (at least one confirmed fact) triggers no marker — proving
  the rule discriminates rather than flags everything.
- `FR-8` — replaying elba-dreaming's real set (four of five unconfirmed), the marker appears
  on exactly the stage(s) backed 100% by unconfirmed personas, per `personas/README.md` —
  and on no other stage.

### S-3: A real screenshot still misses a defect a junior designer wouldn't make

**Actor:** the operator who checks in periodically
**Trigger:** a user-facing story reaches acceptance checking after a real, rendered change.
**Preconditions:** criteria describe rendered, visible behavior; a design rubric
(`design-system.md`) may or may not exist — confirmed absent in both real projects studied.

**Main path**

1. The agent finishes the story; acceptance checking requires a real, rendered capture — a
   text-only read of the page is not sufficient for criteria describing how it looks.
2. The capture is checked against the design rubric's actual rules, not the agent's own
   unaided judgment; if no rubric exists, the verdict says so rather than passing silently.
3. A real rule violation (the elba-dreaming defect: two form fields anchored to a shared
   bottom edge, thrown off by uneven caption text) fails the check and names the rule.
4. The operator reads a verdict stating which method was used and which rules passed or
   failed — not a bare "renders correctly" (`FR-9`–`FR-12`).

**Observable outcome:** a verdict for rendered behavior can't be reached from a text-only
read, and can't be reached without checking a named rubric; a missing rubric is stated, not
hidden.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| No design rubric exists and none is planned soon | Verdict states criteria could not be checked, every time, rather than silently passing — whether a minimal fallback rubric should exist instead is an open question below |
| A capture fails to load correctly (as happened in the real elba-dreaming session) | Verdict does not accept an unreliable capture as proof; a clean, confirmed capture is required |

**Acceptance criteria**

- `FR-9` — a verdict states its verification channel, checked against tool-call history the
  same way `FR-2` checks invocation — a stated screenshot with no matching capture call is
  recorded not-met, not taken on trust; a text-only read is also not-met.
- `FR-10` — a rendered-behavior verdict can't be marked met for visual criteria without
  naming the specific rubric rule checked.
- `FR-11` — with no rubric at verdict time, visual criteria are stated unable-to-be-checked
  — never silently met, never silently dropped.
- `FR-12` — the real elba-dreaming screenshot, checked against a rubric stating the
  relevant alignment rule, produces a not-met verdict citing that rule.

### S-4: A clean verdict with nothing behind it

**Actor:** the operator who reads only the verdict
**Trigger:** reads a pipeline-produced "Accepted" label and proceeds, without reading the
session or artifacts underneath it.
**Preconditions:** a self-correction check is normally due. This persona has no independent
way to catch a wrong verdict — a hypothesis (`assumed`-grade), not observed directly.

**Main path**

1. The agent works through a session without anyone asking for a self-correction check.
2. At the next phase gate, the system requires one before a "done"/"Accepted" verdict can
   issue — it doesn't wait for someone to remember to ask.
3. The verdict carries a record of which check backs it, visible alongside "Accepted," not
   just the label alone (`FR-13`–`FR-16`).

**Observable outcome:** the operator sees a verdict was preceded by a real, recent
self-correction check, not a label reflecting zero checks all session — matching both real
projects, where zero-to-one checks ran across sessions lasting days.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| A check ran and found nothing wrong | The verdict states the check ran and found nothing — indistinguishable from "never checked" otherwise |
| The threshold is reached mid-task, not at a natural stopping point | Open question below — whether it interrupts in-progress work or only gates the next reportable completion |
| The very first verdict of a session, before any check has ever run | Treated the same as a stale gap — a check is required before this verdict issues, not exempted for being first |
| A triggered self-correction check itself fails to run (errors, times out) | Treated as no check having run — blocking, not silently skipped |
| A check runs but finds real problems | "Accepted" cannot issue — the verdict's label changes to reflect what the check found, findings attached per `FR-16` |

**Acceptance criteria**

- `FR-13` — a session can't be reported complete unless a self-correction check has run
  since the last governed artifact was produced — one check per phase gate, a concrete rule
  (`NFR-1`), not a time window.
- `FR-14` — every "Accepted"/clean-status verdict cites which self-correction check backs
  it, referencing `FR-1`–`FR-4`'s own invocation record — not a free-text timestamp an
  agent could hand-write.
- `FR-15` — elba-dreaming's real pattern (zero-to-one checks across a multi-day session)
  blocks the completion report until one runs.
- `FR-16` — a verdict that passed a check shows that check's findings directly, not only in
  a separate artifact the reader would need to know exists.

## Epic: Chief of Staff (new — additive, does not touch S-1–S-4/FR-1–16 above)

> Word-budget note: this epic's addition alone runs well past the template's 1600-word cap.
> Declared overrun, not silent: two independent epics now coexist in one PRD, and each is
> scoped and reviewed on its own terms — halving the budget across them would cut real
> requirement content for no reader benefit. Went through product-owner (two rounds),
> business-analyst stress-test, and qa-strategist verifiability review.

Cross-cutting mechanism (like `/delivery:challenge`/`/delivery:status`), not a numbered
phase — triages an agent's candidate questions before they reach the operator. **MVP-1:
S-5, S-6, S-7, S-8, S-10. Stage-2 (deferred, same pattern as `FR-13`–`16`): S-9, S-11.**
Architectural boundary carried into every scenario: `harden-02` already proved
`PostToolUse`/`PostToolUseFailure` fire only after a tool call resolves — no hook can force
consultation or compliance here. Every "routes/bounces/redirects" verb below means *by

**Framing, per the operator's own words while scoping this epic:** the pipeline's three
senior roles each anchor a distinct invariant, pulling the system's actual trajectory toward
it the way three independent forces converge a system in a particle filter or swarm — not by
central control, each acting locally on what it alone is positioned to protect.
Business Analyst protects the business proposition (is this grounded in a real requirement).
Solution Architect protects the customer's delivered solution (is this technically sound and
deliverable) — unchanged by this epic, and deliberately not chief of staff's concern: S-7
routes a technical unknown to Solution Architect's own spike convention rather than
duplicating that judgment. Chief of Staff protects the third, previously-unowned invariant:
the human principal's attention and the mission they actually stated — S-6 checks
traceability (adjacent to Business Analyst's lens, at the level of one question), S-10 checks
mission alignment (the lens this epic adds). Named here as positioning, not a new
requirement — no scenario or FR above is added by this framing; it explains why S-7
deliberately defers to Solution Architect instead of re-deciding technical soundness itself,
and why S-6 and S-10 are two different checks rather than one. (A naming resonance worth
noting, not a technical dependency: this repo also ships a separate `attractor` plugin — a
deterministic DOT-graph execution engine, unrelated code and mechanism — whose own name
comes from the same convergence intuition.)

**Real evidence for the mechanisms above, found by direct session-transcript search
(2026-08-07), strengthening two scenarios' grounding from inferred to directly observed:**
- **S-5 (answer on the operator's behalf), upgraded to observed:** a real Claude Code session
  (`elba-dreaming website rebuild`) shows the assistant citing a prior operator instruction
  instead of re-asking — *"the locale-hostname tweak you already told me to keep local and
  never commit — that's it, no other pending work."* — the exact citable-traceback pattern
  `FR-17`/`FR-18` require, occurring unprompted in real practice before this epic existed.
- **S-8 (one ranked briefing) and park-over-polish, upgraded to observed:** a real, currently
  active session (`Attractor approach research for Claude`, `attractor-orchestration-claude`)
  shows the assistant collapsing two parallel, multi-hour workstreams into one consolidated
  checkpoint — *"Both threads have hit a natural checkpoint... here's where things actually
  stand before I keep going"* — ending with one ranked question, not scattered asks. The
  operator's own reply is a live instance of park-over-polish from the human side: *"we need
  specialyl ythe parallelism part in attractor landing, we can postpone the delivery plugin
  work btu document it as feature / list of thigns to achieve next"* — redirect priority,
  park the rest, but document it rather than drop it silently.
convention* only.

### S-5: An agent's question is already settled somewhere real

**Actor:** P-2, The Spec-Literal Operator. **Trigger:** an agent, working unattended, forms
a candidate question. **Grounding: observed** — the `elba-dreaming` session shows this exact
citable-traceback pattern occurring unprompted in real practice (quoted above); P-2's "why do
you need my sign off" objection is separate, corroborating evidence for the same need.

An agent forms a candidate question before surfacing it anywhere. Chief of staff answers it
directly only when it can name an exact, nameable source — a specific artifact line, or a
specific thing the operator said — that already settles it, stating that citable traceback
alongside the answer; the operator is never interrupted. A source requiring interpretation,
or two sources disagreeing, is not an answer — it falls through to S-6/S-7, then S-8.

**Hard constraint:** never an inferred or extrapolated judgment presented as the operator's
own — a wrong inferred answer is worse than the original interruption, because it's silent
and discoverable only after downstream work is already built on it.

| Case | Expected behavior |
| :-- | :-- |
| Cited source later changed/superseded | Not auto-corrected — flagged stale on next reference (same as S-2's marker) |
| Answer later found to rest on inference | Recorded as a chief-of-staff failure (`FR-20`) |

- `FR-17` — answers directly only when it can name the exact source that settles it — never
  on interpretation or extrapolation.
- `FR-18` — every such answer carries its citable traceback visibly alongside the answer.
- `FR-19` — no fully-settling source means no answer — falls through to S-6/S-7 or S-8,
  never left both unanswered and unrouted.
- `FR-20` — an answer later found to rest on inference is recorded in the decision log as a
  chief-of-staff failure. At minimum: (a) a category distinguishing it as such, (b) the
  specific answer/citable traceback involved, (c) a timestamp. Storage location/format is
  Open Question 6 (solution-architect, architecture time).

### S-6: A question traces to scope an agent invented, not the plan

**Actor:** P-1, The Unwitnessed Operator. **Trigger:** a candidate question would require
deciding scope no stated requirement asked for. **Grounding:** reported (P-1's damage
occurs in the gap between check-ins).

Chief of staff checks whether any stated requirement (FR, scenario, architecture decision,
story AC) traces to the question, citation-or-nothing, same as S-5. If nothing traces, it's
routed back to the originating agent, named explicitly, with the missing requirement as the
reason — the operator never sees it, unless S-10 also flags the same output (`FR-49`).

| Case | Expected behavior |
| :-- | :-- |
| Originating agent can't be identified | Escalates to S-8 marked "provenance unknown" |
| Bounced twice without resolution | Escalates to S-8 rather than bouncing a third time |
| Originating agent disputes the bounce | Chief of staff doesn't adjudicate — routes to S-8 as a scope dispute |
| Two agents independently invent overlapping scope | Out of scope for MVP-1 — semantic dedup is disproportionately hard; exact/near-exact matching only (S-7/S-11) |

- `FR-21` — classified as agent-introduced scope only when no stated requirement traces to
  it, checked by citable traceback.
- `FR-22` — names the originating agent explicitly and states the missing requirement —
  never forwarded to the operator instead.
- `FR-24` — a question bounced twice without resolution escalates to S-8 rather than
  bouncing a third time.

**Documented constraint, not an AC:** nothing prevents an agent from skipping chief-of-staff
consultation entirely; detecting that skip is out of scope (bypass ≠ unavailability/`FR-48`).

### S-7: A question is a technical unknown, not a decision

**Actor:** P-2, The Spec-Literal Operator. **Trigger:** a candidate question is answerable
only by running something and observing the result. **Grounding:** reported (P-2's
preference for execution-traced answers).

Chief of staff points to a matching open/answered spike if one exists in `architecture.md`'s
spike table, or creates a new one under `.delivery/stories/` in that same convention,
stating what it must answer and what it blocks — never sent to the operator as an interrupt.
Creating/pointing to a spike doesn't make it run; that still requires an agent to pick it up.

| Case | Expected behavior |
| :-- | :-- |
| Matching spike already exists | Cited; no duplicate created |
| Part technical-unknown, part operator-only decision | Splits: technical half to a spike, decision half to S-8 marked blocked-on-spike |
| A spike is created but never picked up | Escalates to S-8's briefing as unclaimed (`FR-50`) — exact trigger threshold is Open Question 13 |

- `FR-25` — classified as a technical unknown only when answerable by real execution, not
  operator authority.
- `FR-26` — routes to a spike story under `.delivery/stories/`, per `architecture.md`'s
  convention — not an ad hoc interrupt.
- `FR-27` — a matching existing spike is cited instead of a duplicate.
- `FR-28` — a mixed technical/decision question splits correctly; neither half dropped.
- `FR-50` — an unclaimed spike surfaces in S-8's briefing as unclaimed, never sitting
  indefinitely with no visibility. The trigger threshold is not yet decided (Open
  Question 18); what's fixed now is that it's marked, never silently dropped.

### S-8: One ranked briefing, not scattered interruptions

**Actor:** P-1, The Unwitnessed Operator. **Trigger:** the operator returns after a stretch
of delegation (pull) — or, narrowly, a blocking item with no open counterpart already in a
delivered briefing (push). **Grounding: observed** — the `attractor-orchestration-claude`
session shows exactly this pattern occurring unprompted (quoted above): two parallel
workstreams collapsed into one ranked checkpoint, and the operator's own reply
park-over-polishing the deprioritized thread rather than dropping it.

Across the delegation period, S-5/S-6/S-7 survivors accumulate rather than interrupting one
at a time. At check-in they combine into one report: ranked, blocking first, each with a
suggested default or explicitly marked no-default-available — never a fabricated one.
Large briefings stay grouped/summarized (`FR-51`), same principle as S-1's own governed-
artifact rule. Chief of staff never proactively surfaces a non-blocking item; only a
blocking item with no open counterpart may be pushed outside a pull, delivered alone
(`FR-45`/`FR-46`). A new blocking item arriving mid-exchange pauses the active exchange with
an explicit marker and resumes after — never a second concurrent thread, never a silent
queue (`FR-47`).

| Case | Expected behavior |
| :-- | :-- |
| Nothing survived triage | Stated plainly — never silently absent |
| Operator doesn't respond to a non-blocking item past a stated point | Proceeds on default (park-over-polish); a blocking item never does |
| Blocking item's operator never returns at all | No stated ceiling — intentional: proceeding on a fabricated default for a genuinely blocking decision is exactly what `FR-32` forbids |

- `FR-29` — everything surviving S-5–S-7 accumulates into one briefing per check-in, never
  separate interrupts.
- `FR-30` — ranked, blocking first; every item states a suggested default or is explicitly
  marked no-default-available — never a fabricated one.
- `FR-31` — an empty briefing is stated explicitly, never silently omitted.
- `FR-32` — a non-blocking item unconfirmed past a stated point proceeds on default; a
  blocking item never does. [`NFR-6` open: the actual threshold]
- `FR-45` — never proactively surfaces a non-blocking item; only a blocking item with no
  open counterpart already delivered may be pushed outside a pull.
- `FR-46` — a pushed blocking item is delivered alone, not bundled — the one exception to
  `FR-29`, reported as such.
- `FR-47` — a new blocking item mid-exchange pauses it with an explicit marker and resumes
  after; never a second concurrent exchange, never a silent queue. [`NFR-8` open: exact
  race mechanics]
- `FR-51` — a briefing with many survivors is grouped/summarized so it stays scannable — the
  same qualitative principle as S-1's rule, itself unquantified. Verified by human judgment,
  same standard as `FR-10`'s design-rubric check.

### S-9: Chief of staff learns where this operator concedes, pushes back, or parks — **Stage-2**

**Actor:** P-1, across many real sessions. **Grounding: assumed** — zero data until S-5–S-8
ship; deferred for exactly this reason, same precedent as `FR-13`–`16`.

A learned shortcut applies only for a category with a stated, pre-committed minimum count of
real, timestamped, logged S-5–S-8 outcomes of that exact category — never one instance, zero
instances, or general reasoning about persona. Below the minimum, today's unmodified S-5–S-8
behavior applies. Any applied shortcut names its specific backing instances on request.
**Anti-pattern this must not become:** inferring taste from persona documents or one vivid
incident and presenting that as a learned pattern — the same forbidden failure mode as S-5,
applied to preference-modeling.

| Case | Expected behavior |
| :-- | :-- |
| Operator's behavior changes over time | Recent instances outweigh older ones — re-checks, never a permanent stamp. [`NFR-9` open: recency-weighting window] |
| A log write itself fails partway | The failed write is itself logged as a gap, not silently absent |

- `FR-33` — a shortcut applies only for a category with a stated, pre-committed minimum
  count of real logged S-5–S-8 outcomes. [Open Question 5: the actual number]
- `FR-34` — the log contains only real, timestamped outcomes — never seeded/hypothetical.
- `FR-35` — a below-minimum category gets unmodified S-5–S-8 behavior, never a guessed
  shortcut.
- `FR-36` — any applied shortcut names its specific backing instances on request.

### S-10: Chief of staff captures and defends the original mission

**Actor:** P-2, The Spec-Literal Operator. **Trigger:** intent is first stated, and later,
whenever new output is produced anywhere in the pipeline. **Grounding:** reported — the
operator's own repeated act of restating intent this session.

**Why this differs from S-6:** S-6 is reactive and narrow — passes anything that traces to
a stated requirement, full stop. S-10 is proactive and broader — checks output against the
captured mission itself, one level above any individual requirement, and still fires even
when S-6 passed the same output, because a requirement can be scoped loosely enough to
permit an implementation that no longer serves why the effort exists.

Chief of staff captures a verbatim excerpt of the operator's stated intent, or a direct
pointer to `brief.md`'s problem framing — never its own paraphrase. New output is checked
against that text regardless of S-6's verdict. A flag names the specific mission line, the
specific diverging output, and the connecting reason, and surfaces through existing routing
(S-8, or a bounce-style note) — chief of staff never unilaterally decides, blocks, or
reverts.

| Case | Expected behavior |
| :-- | :-- |
| No captured mission exists yet | States plainly that drift-checking is unavailable — never fabricates one retroactively |
| Operator deliberately revises the mission mid-effort | Recaptured the same way (verbatim/citation), replacing the prior statement, with the change itself recorded |
| A flagged item turns out to be legitimate evolution | Flag resolved, not deleted — recorded "flagged, reviewed, accepted" |
| Output fails S-6 (untraceable) *and* is independently flagged by S-10 (drifted) | Merged into one routed item citing both reasons (`FR-49`) — never two uncoordinated verdicts |
| Chief of staff's own drift flag is wrong | Recorded in the decision log per `FR-52` |

- `FR-37` — captured mission is a verbatim excerpt or a direct citable traceback — never
  chief of staff's own paraphrase.
- `FR-38` — new output checked against the captured mission regardless of S-6's verdict.
- `FR-39` — a drift flag names the specific mission line, the diverging output, and the
  connecting reason.
- `FR-40` — drift surfaces through existing routing, never unilaterally blocked or reverted.
- `FR-49` — an output flagged by both S-6 and S-10 routes as one merged item citing both
  reasons — never two separate routings.
- `FR-52` — a wrong drift flag is recorded in the decision log using `FR-20`'s minimal
  record content, not silently corrected.

### S-11: Chief of staff keeps the product repo's own AGENTS.md/CLAUDE.md adequate — **Stage-2**

**Actor:** P-2 (reused from S-5 — this is the maintenance function underneath S-5's
reactive citation). **Grounding: reported** — direct operator statement, no tie to
`brief.md`'s Findings A–D, no corroborating transcript instance. Deferred: weakest-
precedented scenario not already flagged as such, and mechanically a distinct verification
capability (closer to S-3's screenshot-plus-rubric check) rather than a reuse of this
epic's citation-or-nothing plumbing.

Whenever an agent relies on `AGENTS.md`/`CLAUDE.md` — including every case S-5 would
otherwise cite it — chief of staff checks the specific claim used against the real repo
(file exists, command runs, navigational claim matches structure), flags the specific gap
(never a general "needs work" judgment), surfacing through S-8's briefing. It never edits
the file itself or decides the fix.

| Case | Expected behavior |
| :-- | :-- |
| File doesn't exist at all | Flagged as a gap in itself |
| Two agents hit the same gap in one session | Flagged once, not duplicated |
| Same gap, flagged in a past session, hit again in a new one | Unresolved — `FR-44`'s dedup is scoped to one session only (Open Question 14, non-blocking, Stage-2) |

- `FR-41` — a flagged gap names a concrete, checkable defect — never a general quality
  judgment.
- `FR-42` — checks run as a byproduct of an agent relying on the file, not only a scheduled
  audit.
- `FR-43` — a flagged gap surfaces through S-8's briefing; never edited/fixed by chief of
  staff itself.
- `FR-44` — the same gap hit by more than one agent in one session is flagged once.

### Epic-wide

- `FR-48` — when chief of staff cannot be consulted (unavailable, unconfigured, erroring),
  an agent falls back to asking the operator directly — today's behavior — rather than
  blocking indefinitely or silently dropping the question. Value-add layer, never a required
  dependency an agent blocks on.

## Functional requirements

| ID | Requirement | Scenario | Priority |
| :-- | :-- | :-- | :-- |
| FR-1 | Every governed artifact gets a stated invoked/not-invoked status | S-1 | must |
| FR-2 | Not-invoked applies regardless of file-level completeness | S-1 | must |
| FR-3 | Reconstructed narration-without-invocation case is caught | S-1 | must |
| FR-4 | Not-invoked is a distinct, scannable marker | S-1 | must |
| FR-5 | Entirely-unconfirmed-backed decisions never read as plain "ready" | S-2 | must |
| FR-6 | The marker appears in the primary scanned document | S-2 | must |
| FR-7 | Mixed evidence does not trigger the marker | S-2 | must |
| FR-8 | Real elba-dreaming case reproduces the marker | S-2 | should |
| FR-9 | Rendered-behavior verdicts state their method; text-only reads are not-met | S-3 | must |
| FR-10 | Visual "met" requires naming a specific rubric rule | S-3 | must |
| FR-11 | No rubric means criteria stated as unable to be checked, never silently met | S-3 | must |
| FR-12 | Real elba-dreaming defect reproduces a not-met verdict | S-3 | should |
| FR-13 | Completion is blocked past a documented check-staleness threshold | S-4 | must |
| FR-14 | Verdicts record the last self-correction check's timing | S-4 | must |
| FR-15 | Real elba-dreaming zero-check pattern is caught | S-4 | should |
| FR-16 | A passed check's findings surface directly in the verdict | S-4 | should |
| FR-17 | Answers directly only when it can name the exact source that settles it | S-5 | must |
| FR-18 | Every such answer carries its citable traceback visibly alongside it | S-5 | must |
| FR-19 | No fully-settling source means no answer — falls through, never left unrouted | S-5 | must |
| FR-20 | Inference-based answers recorded in the decision log as a chief-of-staff failure | S-5 | should |
| FR-21 | Agent-introduced scope classified only when no requirement traces to it | S-6 | must |
| FR-22 | Bounce names the originating agent and the missing requirement | S-6 | must |
| FR-24 | Twice-bounced question escalates to S-8 rather than bouncing a third time | S-6 | should |
| FR-25 | Technical unknown classified only when answerable by real execution | S-7 | must |
| FR-26 | Technical unknowns route to a spike story, not an ad hoc interrupt | S-7 | must |
| FR-27 | A matching existing spike is cited instead of a duplicate | S-7 | should |
| FR-28 | Mixed technical/decision question splits correctly; neither half dropped | S-7 | must |
| FR-29 | S-5–S-7 survivors accumulate into one briefing per check-in | S-8 | must |
| FR-30 | Briefing ranked, blocking first, default or explicit no-default-available | S-8 | must |
| FR-31 | An empty briefing is stated explicitly, never silently omitted | S-8 | must |
| FR-32 | Non-blocking item proceeds on default past a threshold; blocking never does | S-8 | must |
| FR-33 | Learned shortcut requires a pre-committed minimum logged-instance count | S-9 | must |
| FR-34 | Decision log contains only real, timestamped outcomes, never seeded | S-9 | must |
| FR-35 | Below-minimum category gets unmodified S-5–S-8 behavior | S-9 | must |
| FR-36 | Any applied shortcut names its specific backing instances on request | S-9 | should |
| FR-37 | Captured mission is a verbatim excerpt or citable traceback, never paraphrase | S-10 | must |
| FR-38 | New output checked against captured mission regardless of S-6's verdict | S-10 | must |
| FR-39 | Drift flag names the mission line, the diverging output, the reason | S-10 | must |
| FR-40 | Drift surfaces through existing routing, never unilaterally reverted | S-10 | must |
| FR-41 | Flagged repo-doc gap names a concrete, checkable defect | S-11 | must |
| FR-42 | Checks run as a byproduct of reliance, not only a scheduled audit | S-11 | must |
| FR-43 | Flagged gap surfaces through S-8's briefing; never fixed by chief of staff | S-11 | must |
| FR-44 | Same gap hit by multiple agents in one session flagged once | S-11 | must |
| FR-45 | Never proactively surfaces a non-blocking item; narrow blocking-item push only | S-8 | must |
| FR-46 | A pushed blocking item is delivered alone, not bundled | S-8 | must |
| FR-47 | Mid-exchange blocking item pauses/resumes; never concurrent, never silent-queued | S-8 | must |
| FR-48 | Chief-of-staff unavailability falls back to direct-ask, never blocks | epic-wide | must |
| FR-49 | Output flagged by both S-6 and S-10 routes as one merged item | S-6, S-10 | must |
| FR-50 | Unclaimed spike surfaces in S-8's briefing as unclaimed | S-7 | should |
| FR-51 | Large briefing stays grouped/summarized, reviewer-judged | S-8 | should |
| FR-52 | Wrong drift flag recorded in the decision log per FR-20's content | S-10 | should |

## Non-functional requirements

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Self-correction check cadence (`FR-13`) | One check per governed-artifact-producing phase gate — reasoned from both real sessions, where a wall-clock target (days/hours) was already shown to be too loose | Replay both real sessions' tool-call histories against the rule; compare demanded checks to the observed 1 and ~0 |
| NFR-2 | False-positive rate for "not-invoked" on genuinely-invoked steps | Open question — no measurement exists yet | — |
| NFR-3 | Concurrency (multiple sessions in a shared repo) | Out of scope per non-goals (no team-based usage observed) | — |
| NFR-4 | Availability | Not applicable — this runs inside a single Claude Code session, not a hosted service | — |
| NFR-5 | Retention of invocation/check records | At least as long as the artifact they annotate exists in the repo — no independent expiry | A record for a deleted artifact may be pruned; one for an existing artifact may not |
| NFR-6 | Non-blocking-default threshold (`FR-32`) | Open — no number set. Owner: qa-strategist. | Replay a real delegation stretch; confirm default fires exactly at threshold |
| NFR-7 | Minimum logged-instance count for a learned shortcut (`FR-33`) | Open — same as Open Question 5. Owner: qa-strategist/product-owner sign-off. | Replay a real multi-session decision log; confirm no shortcut below threshold |
| NFR-8 | Concurrent-arrival ordering/race mechanics (`FR-47`) | Open. Owner: solution-architect. | Fire two simultaneous blocking items in a synthetic harness; confirm behavior matches the chosen rule |
| NFR-9 | Recency-weighting/decay window for S-9's pattern re-check | Open, distinct from NFR-7. Owner: qa-strategist/product-owner. | Feed a synthetic history with an old and a newer contradicting pattern; confirm weighting matches |
| NFR-10 | Briefing scannability at volume (`FR-51`) | Open, same class as NFR-6–9 — S-1's own rule is unquantified too. Either a real threshold is set at implementation time, or this stays a qualitative reviewer-judged check (matching `FR-9`–`12`'s rubric pattern). Owner: product-owner to decide which. | Replay a long delegation stretch; a reviewer confirms the briefing reads as scannable |
| NFR-11 | Decision-log retention | Proposed by analogy to `NFR-5` — flagged for product-owner confirmation, not yet settled | A log entry for since-deleted content may be pruned; one for still-live content may not |
| NFR-12 | Permission/access control between agents and chief-of-staff | Proposed out of scope, extending `NFR-3`/`NFR-4`'s precedent — flagged for product-owner confirmation since this epic introduces multi-agent concurrency within a session, a different axis than `NFR-3` originally considered | — |

## Assumptions

- That Claude Code's `Stop`/`SubagentStop`/`TaskCompleted` hooks (confirmed real in
  `research.md`) are the right foundation for `FR-1`–`FR-4` and `FR-13`–`FR-16` — an
  architecture decision, not confirmed as final here.
- That a minimal rubric beats none for `FR-11`'s fallback — not tested against blocking UI
  work entirely without one.
- That the operator who reads only the verdict is real enough to design for, despite no
  observed instance — a hypothesis worth building for, not a confirmed need.
- **Chief of Staff epic:** that MVP-1's architecture scope can include a minimal
  append-only decision-log write (for `FR-20`/`FR-52`) without pulling S-9's own
  pattern-detection logic forward from Stage-2 — mirrors the `harden` epic's own
  ledger-before-consumer sequencing; not confirmed until solution-architect sizes it
  (Open Question 6).
- That chief of staff is realizable as a shared convention every agent is instructed to
  consult, rather than requiring a new enforcement primitive this harness doesn't have —
  Open Question 8, solution-architect's call at architecture time.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | What's the actual mechanism for FR-1–FR-4 — a tool-call ledger, a frontmatter stamp, something built on the confirmed-real Claude Code hooks? | solution-architect | Architecture |
| 2 | Should a minimal fallback rubric exist for FR-11's no-rubric case, or should visual criteria simply stay unable-to-be-checked until one is authored? | product-owner | Scoping S-3's fallback behavior |
| 3 | FR-13/NFR-1 sets the cadence at one check per governed-artifact phase gate. Does reaching that gate mid-task interrupt in-progress work, or only gate the next completion report? | solution-architect | Scoping S-4 |
| 4 | Is the operator who reads only the verdict (S-4's actor) real enough to justify FR-13–FR-16's cost, given zero observed instances? | product-owner | Confidence in S-4's priority |
| 5 | Minimum logged-instance threshold before S-9 may apply a learned shortcut (`FR-33`) | qa-strategist, product-owner sign-off | Scoping S-9 |
| 6 | Does the decision log reuse the harden epic's invocation ledger, or need its own store? | solution-architect | Architecture for `FR-20`/S-9 |
| 7 | If/when `FR-13` ships, does chief-of-staff's shipping-speed bias carve out an exception for it, or does it narrow `FR-13`? | product-owner | Resolving the flagged tension |
| 8 | Is chief of staff a subagent other agents call, a shared convention document, or something else? | solution-architect | Architecture for the whole epic |
| 9 | Who has standing to revise/recapture the mission mid-effort — operator only, or can an agent propose for confirmation? | product-owner | Scoping S-10's recapture path |
| 10 | Where does the captured mission text actually live — brief.md frontmatter, a standalone artifact, or the decision-log store? | solution-architect | Architecture for S-10 |
| 11 | NFR-6's actual threshold number | qa-strategist | Finalizing `FR-32` |
| 12 | NFR-8's exact concurrent-arrival mechanism | solution-architect | Implementing S-8's concurrency rule |
| 13 | Does a bounced question (S-6) or an unclaimed spike (S-7/`FR-50`) time out and escalate after a count, a duration, or never? | qa-strategist | S-6/S-7 error-path completeness |
| 14 | Does S-11's once-per-session gap dedup (`FR-44`) extend across sessions? | product-owner | S-11 scoping (Stage-2, non-blocking now) |
| 15 | Is briefing delivery itself guaranteed atomic (no truncated briefing presented as complete)? | qa-strategist | S-8 completeness |

## Out of scope

- Redesigning the phase sequence itself.
- A manual approval checkbox in place of real verification.
- Extending the channel-and-rubric requirement past UI-facing criteria this iteration.
- The underlying reason narration substitutes for invocation (detection only, this round).
- A general-purpose scheduling primitive beyond what FR-13 needs.
- Team-based or multi-operator usage.
- The operator whose need is per-project artifact scoping — already served.
- **Chief of Staff epic:** hard enforcement of any routing rule — convention only, per the
  stated architectural boundary (no hook can force consultation or compliance).
- Chief of staff overruling a scope decision itself (S-6) or unilaterally judging a flagged
  mission drift as wrong (S-10) — it routes and names; the operator/product-owner decides.
- Predictive/generative modeling of operator taste before real logged instances exist (the
  S-9 anti-pattern).
- Cross-project/cross-operator sharing of the S-9 decision log.
- Retroactively fabricating a captured mission for efforts that predate this capability.
- Live undo of an agent already acting on a chief-of-staff answer later found wrong — the
  error path is a post-hoc log entry (`FR-20`/`FR-52`), not a real-time interrupt of work
  already in motion.
- Semantic deduplication of candidate questions across agents — exact/near-exact matching
  only this iteration (S-7's `FR-27`, S-11's `FR-44`).
- Bypass detection for an agent that skips a fully-available chief of staff — not
  distinguishable from unavailability-fallback (`FR-48`) this iteration.
