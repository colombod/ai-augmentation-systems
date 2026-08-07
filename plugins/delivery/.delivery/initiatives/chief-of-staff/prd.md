# PRD: Chief of Staff

> Initiative: `chief-of-staff` (`.delivery/initiatives/chief-of-staff/`), per `ADR-004`.
> **Extends** the `harden` initiative's brief and problem framing rather than running its own
> `/delivery:brief` — see `../harden/brief.md`, Finding C. Status: draft.
> Owned by Product Owner, with Business Analyst and QA Strategist.
> **Moved 2026-08-07** from `.delivery/prd.md`'s shared "Epic: Chief of Staff" section into
> this initiative's own directory (`ADR-004`) — the real incident that motivated the move: this
> content collided, at merge time, with `harden`'s own independently-numbered `S-5`/`FR-17`–19
> (see `../../decisions/ADR-004-per-initiative-delivery-directories.md`'s Context). Content
> unchanged in substance from the pre-split version, IDs already renumbered
> (`S-6`–`S-12`/`FR-20`–`55`) during that reconciliation, not by this move.
> Went through product-owner (two rounds), business-analyst stress-test, and qa-strategist
> verifiability review.

Cross-cutting mechanism (like `/delivery:challenge`/`/delivery:status`), not a numbered
phase — triages an agent's candidate questions before they reach the operator. **MVP-1:
S-6, S-7, S-8, S-9, S-11. Stage-2 (deferred, same pattern as `FR-13`–`16`): S-10, S-12.**
Architectural boundary carried into every scenario: `harden-02` already proved
`PostToolUse`/`PostToolUseFailure` fire only after a tool call resolves — no hook can force
consultation or compliance here. Every "routes/bounces/redirects" verb below means *by

**Framing, per the operator's own words while scoping this epic:** the pipeline's three
senior roles each anchor a distinct invariant, pulling the system's actual trajectory toward
it the way three independent forces converge a system in a particle filter or swarm — not by
central control, each acting locally on what it alone is positioned to protect.
Business Analyst protects the business proposition (is this grounded in a real requirement).
Solution Architect protects the customer's delivered solution (is this technically sound and
deliverable) — unchanged by this epic, and deliberately not chief of staff's concern: S-8
routes a technical unknown to Solution Architect's own spike convention rather than
duplicating that judgment. Chief of Staff protects the third, previously-unowned invariant:
the human principal's attention and the mission they actually stated — S-7 checks
traceability (adjacent to Business Analyst's lens, at the level of one question), S-11 checks
mission alignment (the lens this epic adds). Named here as positioning, not a new
requirement — no scenario or FR above is added by this framing; it explains why S-8
deliberately defers to Solution Architect instead of re-deciding technical soundness itself,
and why S-7 and S-11 are two different checks rather than one. (A naming resonance worth
noting, not a technical dependency: this repo also ships a separate `attractor` plugin — a
deterministic DOT-graph execution engine, unrelated code and mechanism — whose own name
comes from the same convergence intuition.)

**Real evidence for the mechanisms above, found by direct session-transcript search
(2026-08-07), strengthening two scenarios' grounding from inferred to directly observed:**
- **S-6 (answer on the operator's behalf), upgraded to observed:** a real Claude Code session
  (`elba-dreaming website rebuild`) shows the assistant citing a prior operator instruction
  instead of re-asking — *"the locale-hostname tweak you already told me to keep local and
  never commit — that's it, no other pending work."* — the exact citable-traceback pattern
  `FR-20`/`FR-21` require, occurring unprompted in real practice before this epic existed.
- **S-9 (one ranked briefing) and park-over-polish, upgraded to observed:** a real, currently
  active session (`Attractor approach research for Claude`, `attractor-orchestration-claude`)
  shows the assistant collapsing two parallel, multi-hour workstreams into one consolidated
  checkpoint — *"Both threads have hit a natural checkpoint... here's where things actually
  stand before I keep going"* — ending with one ranked question, not scattered asks. The
  operator's own reply is a live instance of park-over-polish from the human side: *"we need
  specialyl ythe parallelism part in attractor landing, we can postpone the delivery plugin
  work btu document it as feature / list of thigns to achieve next"* — redirect priority,
  park the rest, but document it rather than drop it silently.
convention* only.

### S-6: An agent's question is already settled somewhere real

**Actor:** P-2, The Spec-Literal Operator. **Trigger:** an agent, working unattended, forms
a candidate question. **Grounding: observed** — the `elba-dreaming` session shows this exact
citable-traceback pattern occurring unprompted in real practice (quoted above); P-2's "why do
you need my sign off" objection is separate, corroborating evidence for the same need.

An agent forms a candidate question before surfacing it anywhere. Chief of staff answers it
directly only when it can name an exact, nameable source — a specific artifact line, or a
specific thing the operator said — that already settles it, stating that citable traceback
alongside the answer; the operator is never interrupted. A source requiring interpretation,
or two sources disagreeing, is not an answer — it falls through to S-7/S-8, then S-9.

**Hard constraint:** never an inferred or extrapolated judgment presented as the operator's
own — a wrong inferred answer is worse than the original interruption, because it's silent
and discoverable only after downstream work is already built on it.

| Case | Expected behavior |
| :-- | :-- |
| Cited source later changed/superseded | Not auto-corrected — flagged stale on next reference (same as S-2's marker) |
| Answer later found to rest on inference | Recorded as a chief-of-staff failure (`FR-23`) |

- `FR-20` — answers directly only when it can name the exact source that settles it — never
  on interpretation or extrapolation.
- `FR-21` — every such answer carries its citable traceback visibly alongside the answer.
- `FR-22` — no fully-settling source means no answer — falls through to S-7/S-8 or S-9,
  never left both unanswered and unrouted.
- `FR-23` — an answer later found to rest on inference is recorded in the decision log as a
  chief-of-staff failure. At minimum: (a) a category distinguishing it as such, (b) the
  specific answer/citable traceback involved, (c) a timestamp. Storage location/format is
  Open Question 7 (solution-architect, architecture time).

### S-7: A question traces to scope an agent invented, not the plan

**Actor:** P-1, The Unwitnessed Operator. **Trigger:** a candidate question would require
deciding scope no stated requirement asked for. **Grounding:** reported (P-1's damage
occurs in the gap between check-ins).

Chief of staff checks whether any stated requirement (FR, scenario, architecture decision,
story AC) traces to the question, citation-or-nothing, same as S-6. If nothing traces, it's
routed back to the originating agent, named explicitly, with the missing requirement as the
reason — the operator never sees it, unless S-11 also flags the same output (`FR-52`).

| Case | Expected behavior |
| :-- | :-- |
| Originating agent can't be identified | Escalates to S-9 marked "provenance unknown" |
| Bounced twice without resolution | Escalates to S-9 rather than bouncing a third time |
| Originating agent disputes the bounce | Chief of staff doesn't adjudicate — routes to S-9 as a scope dispute |
| Two agents independently invent overlapping scope | Out of scope for MVP-1 — semantic dedup is disproportionately hard; exact/near-exact matching only (S-8/S-12) |

- `FR-24` — classified as agent-introduced scope only when no stated requirement traces to
  it, checked by citable traceback.
- `FR-25` — names the originating agent explicitly and states the missing requirement —
  never forwarded to the operator instead.
- `FR-27` — a question bounced twice without resolution escalates to S-9 rather than
  bouncing a third time.

**Documented constraint, not an AC:** nothing prevents an agent from skipping chief-of-staff
consultation entirely; detecting that skip is out of scope (bypass ≠ unavailability/`FR-51`).

### S-8: A question is a technical unknown, not a decision

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
| Part technical-unknown, part operator-only decision | Splits: technical half to a spike, decision half to S-9 marked blocked-on-spike |
| A spike is created but never picked up | Escalates to S-9's briefing as unclaimed (`FR-53`) — exact trigger threshold is Open Question 14 |

- `FR-28` — classified as a technical unknown only when answerable by real execution, not
  operator authority.
- `FR-29` — routes to a spike story under `.delivery/stories/`, per `architecture.md`'s
  convention — not an ad hoc interrupt.
- `FR-30` — a matching existing spike is cited instead of a duplicate.
- `FR-31` — a mixed technical/decision question splits correctly; neither half dropped.
- `FR-53` — an unclaimed spike surfaces in S-9's briefing as unclaimed, never sitting
  indefinitely with no visibility. The trigger threshold is not yet decided (Open
  Question 18); what's fixed now is that it's marked, never silently dropped.

### S-9: One ranked briefing, not scattered interruptions

**Actor:** P-1, The Unwitnessed Operator. **Trigger:** the operator returns after a stretch
of delegation (pull) — or, narrowly, a blocking item with no open counterpart already in a
delivered briefing (push). **Grounding: observed** — the `attractor-orchestration-claude`
session shows exactly this pattern occurring unprompted (quoted above): two parallel
workstreams collapsed into one ranked checkpoint, and the operator's own reply
park-over-polishing the deprioritized thread rather than dropping it.

Across the delegation period, S-6/S-7/S-8 survivors accumulate rather than interrupting one
at a time. At check-in they combine into one report: ranked, blocking first, each with a
suggested default or explicitly marked no-default-available — never a fabricated one.
Large briefings stay grouped/summarized (`FR-54`), same principle as S-1's own governed-
artifact rule. Chief of staff never proactively surfaces a non-blocking item; only a
blocking item with no open counterpart may be pushed outside a pull, delivered alone
(`FR-48`/`FR-49`). A new blocking item arriving mid-exchange pauses the active exchange with
an explicit marker and resumes after — never a second concurrent thread, never a silent
queue (`FR-50`).

| Case | Expected behavior |
| :-- | :-- |
| Nothing survived triage | Stated plainly — never silently absent |
| Operator doesn't respond to a non-blocking item past a stated point | Proceeds on default (park-over-polish); a blocking item never does |
| Blocking item's operator never returns at all | No stated ceiling — intentional: proceeding on a fabricated default for a genuinely blocking decision is exactly what `FR-35` forbids |

- `FR-32` — everything surviving S-6–S-8 accumulates into one briefing per check-in, never
  separate interrupts.
- `FR-33` — ranked, blocking first; every item states a suggested default or is explicitly
  marked no-default-available — never a fabricated one.
- `FR-34` — an empty briefing is stated explicitly, never silently omitted.
- `FR-35` — a non-blocking item unconfirmed past a stated point proceeds on default; a
  blocking item never does. [`NFR-6` open: the actual threshold]
- `FR-48` — never proactively surfaces a non-blocking item; only a blocking item with no
  open counterpart already delivered may be pushed outside a pull.
- `FR-49` — a pushed blocking item is delivered alone, not bundled — the one exception to
  `FR-32`, reported as such.
- `FR-50` — a new blocking item mid-exchange pauses it with an explicit marker and resumes
  after; never a second concurrent exchange, never a silent queue. [`NFR-8` open: exact
  race mechanics]
- `FR-54` — a briefing with many survivors is grouped/summarized so it stays scannable — the
  same qualitative principle as S-1's rule, itself unquantified. Verified by human judgment,
  same standard as `FR-10`'s design-rubric check.

### S-10: Chief of staff learns where this operator concedes, pushes back, or parks — **Stage-2**

**Actor:** P-1, across many real sessions. **Grounding: assumed** — zero data until S-6–S-9
ship; deferred for exactly this reason, same precedent as `FR-13`–`16`.

A learned shortcut applies only for a category with a stated, pre-committed minimum count of
real, timestamped, logged S-6–S-9 outcomes of that exact category — never one instance, zero
instances, or general reasoning about persona. Below the minimum, today's unmodified S-6–S-9
behavior applies. Any applied shortcut names its specific backing instances on request.
**Anti-pattern this must not become:** inferring taste from persona documents or one vivid
incident and presenting that as a learned pattern — the same forbidden failure mode as S-6,
applied to preference-modeling.

| Case | Expected behavior |
| :-- | :-- |
| Operator's behavior changes over time | Recent instances outweigh older ones — re-checks, never a permanent stamp. [`NFR-9` open: recency-weighting window] |
| A log write itself fails partway | The failed write is itself logged as a gap, not silently absent |

- `FR-36` — a shortcut applies only for a category with a stated, pre-committed minimum
  count of real logged S-6–S-9 outcomes. [Open Question 6: the actual number]
- `FR-37` — the log contains only real, timestamped outcomes — never seeded/hypothetical.
- `FR-38` — a below-minimum category gets unmodified S-6–S-9 behavior, never a guessed
  shortcut.
- `FR-39` — any applied shortcut names its specific backing instances on request.

### S-11: Chief of staff captures and defends the original mission

**Actor:** P-2, The Spec-Literal Operator. **Trigger:** intent is first stated, and later,
whenever new output is produced anywhere in the pipeline. **Grounding:** reported — the
operator's own repeated act of restating intent this session.

**Why this differs from S-7:** S-7 is reactive and narrow — passes anything that traces to
a stated requirement, full stop. S-11 is proactive and broader — checks output against the
captured mission itself, one level above any individual requirement, and still fires even
when S-7 passed the same output, because a requirement can be scoped loosely enough to
permit an implementation that no longer serves why the effort exists.

Chief of staff captures a verbatim excerpt of the operator's stated intent, or a direct
pointer to `brief.md`'s problem framing — never its own paraphrase. New output is checked
against that text regardless of S-7's verdict. A flag names the specific mission line, the
specific diverging output, and the connecting reason, and surfaces through existing routing
(S-9, or a bounce-style note) — chief of staff never unilaterally decides, blocks, or
reverts.

| Case | Expected behavior |
| :-- | :-- |
| No captured mission exists yet | States plainly that drift-checking is unavailable — never fabricates one retroactively |
| Operator deliberately revises the mission mid-effort | Recaptured the same way (verbatim/citation), replacing the prior statement, with the change itself recorded |
| A flagged item turns out to be legitimate evolution | Flag resolved, not deleted — recorded "flagged, reviewed, accepted" |
| Output fails S-7 (untraceable) *and* is independently flagged by S-11 (drifted) | Merged into one routed item citing both reasons (`FR-52`) — never two uncoordinated verdicts |
| Chief of staff's own drift flag is wrong | Recorded in the decision log per `FR-55` |

- `FR-40` — captured mission is a verbatim excerpt or a direct citable traceback — never
  chief of staff's own paraphrase.
- `FR-41` — new output checked against the captured mission regardless of S-7's verdict.
- `FR-42` — a drift flag names the specific mission line, the diverging output, and the
  connecting reason.
- `FR-43` — drift surfaces through existing routing, never unilaterally blocked or reverted.
- `FR-52` — an output flagged by both S-7 and S-11 routes as one merged item citing both
  reasons — never two separate routings.
- `FR-55` — a wrong drift flag is recorded in the decision log using `FR-23`'s minimal
  record content, not silently corrected.

### S-12: Chief of staff keeps the product repo's own AGENTS.md/CLAUDE.md adequate — **Stage-2**

**Actor:** P-2 (reused from S-6 — this is the maintenance function underneath S-6's
reactive citation). **Grounding: reported** — direct operator statement, no tie to
`brief.md`'s Findings A–D, no corroborating transcript instance. Deferred: weakest-
precedented scenario not already flagged as such, and mechanically a distinct verification
capability (closer to S-3's screenshot-plus-rubric check) rather than a reuse of this
epic's citation-or-nothing plumbing.

Whenever an agent relies on `AGENTS.md`/`CLAUDE.md` — including every case S-6 would
otherwise cite it — chief of staff checks the specific claim used against the real repo
(file exists, command runs, navigational claim matches structure), flags the specific gap
(never a general "needs work" judgment), surfacing through S-9's briefing. It never edits
the file itself or decides the fix.

| Case | Expected behavior |
| :-- | :-- |
| File doesn't exist at all | Flagged as a gap in itself |
| Two agents hit the same gap in one session | Flagged once, not duplicated |
| Same gap, flagged in a past session, hit again in a new one | Unresolved — `FR-47`'s dedup is scoped to one session only (Open Question 15, non-blocking, Stage-2) |

- `FR-44` — a flagged gap names a concrete, checkable defect — never a general quality
  judgment.
- `FR-45` — checks run as a byproduct of an agent relying on the file, not only a scheduled
  audit.
- `FR-46` — a flagged gap surfaces through S-9's briefing; never edited/fixed by chief of
  staff itself.
- `FR-47` — the same gap hit by more than one agent in one session is flagged once.

### Epic-wide

- `FR-51` — when chief of staff cannot be consulted (unavailable, unconfigured, erroring),
  an agent falls back to asking the operator directly — today's behavior — rather than
  blocking indefinitely or silently dropping the question. Value-add layer, never a required
  dependency an agent blocks on.

## Functional requirements

| ID | Requirement | Scenario | Priority | Grade |
| :-- | :-- | :-- | :-- | :-- |
| FR-1 | Every governed artifact gets a stated invoked/not-invoked status | S-1 | must | observed |
| FR-2 | Not-invoked applies regardless of file-level completeness | S-1 | must | observed |
| FR-3 | Reconstructed narration-without-invocation case is caught | S-1 | must | observed |
| FR-4 | Not-invoked is a distinct, scannable marker | S-1 | must | observed |
| FR-5 | Entirely-unconfirmed-backed decisions never read as plain "ready" | S-2 | must | observed |
| FR-6 | The marker appears in the primary scanned document | S-2 | must | observed |
| FR-7 | Mixed evidence does not trigger the marker | S-2 | must | observed |
| FR-8 | Real elba-dreaming case reproduces the marker | S-2 | should | observed |
| FR-9 | Rendered-behavior verdicts state their method; text-only reads are not-met | S-3 | must | observed |
| FR-10 | Visual "met" requires naming a specific rubric rule | S-3 | must | observed |
| FR-11 | No rubric means criteria stated as unable to be checked, never silently met | S-3 | must | observed |
| FR-12 | Real elba-dreaming defect reproduces a not-met verdict | S-3 | should | observed |
| FR-13 | Completion is blocked past a documented check-staleness threshold | S-4 | must | assumed |
| FR-14 | Verdicts record the last self-correction check's timing | S-4 | must | assumed |
| FR-15 | Real elba-dreaming zero-check pattern is caught | S-4 | should | assumed |
| FR-16 | A passed check's findings surface directly in the verdict | S-4 | should | assumed |
| FR-17 | A verdict states which delivery surface applies (GUI/CLI/TUI — anything else defaults to unable-to-be-checked) and requires the matching channel | S-5 | must | reported |
| FR-18 | CLI "met" requires a real process invocation observed directly by the reviewer; a durable ledger cross-check remains open (`harden-11`) | S-5 | must | reported |
| FR-19 | TUI "met" requires a real visual capture; text-only reads (ANSI-stripped or not) don't satisfy it | S-5 | must | reported |
| FR-20 | Answers directly only when it can name the exact source that settles it | S-6 | must | observed |
| FR-21 | Every such answer carries its citable traceback visibly alongside it | S-6 | must | observed |
| FR-22 | No fully-settling source means no answer — falls through, never left unrouted | S-6 | must | observed |
| FR-23 | Inference-based answers recorded in the decision log as a chief-of-staff failure | S-6 | should | observed |
| FR-24 | Agent-introduced scope classified only when no requirement traces to it | S-7 | must | reported |
| FR-25 | Bounce names the originating agent and the missing requirement | S-7 | must | reported |
| FR-27 | Twice-bounced question escalates to S-9 rather than bouncing a third time | S-7 | should | reported |
| FR-28 | Technical unknown classified only when answerable by real execution | S-8 | must | reported |
| FR-29 | Technical unknowns route to a spike story, not an ad hoc interrupt | S-8 | must | reported |
| FR-30 | A matching existing spike is cited instead of a duplicate | S-8 | should | reported |
| FR-31 | Mixed technical/decision question splits correctly; neither half dropped | S-8 | must | reported |
| FR-32 | S-6–S-8 survivors accumulate into one briefing per check-in | S-9 | must | observed |
| FR-33 | Briefing ranked, blocking first, default or explicit no-default-available | S-9 | must | observed |
| FR-34 | An empty briefing is stated explicitly, never silently omitted | S-9 | must | observed |
| FR-35 | Non-blocking item proceeds on default past a threshold; blocking never does | S-9 | must | observed |
| FR-36 | Learned shortcut requires a pre-committed minimum logged-instance count | S-10 | must | assumed |
| FR-37 | Decision log contains only real, timestamped outcomes, never seeded | S-10 | must | assumed |
| FR-38 | Below-minimum category gets unmodified S-6–S-9 behavior | S-10 | must | assumed |
| FR-39 | Any applied shortcut names its specific backing instances on request | S-10 | should | assumed |
| FR-40 | Captured mission is a verbatim excerpt or citable traceback, never paraphrase | S-11 | must | reported |
| FR-41 | New output checked against captured mission regardless of S-7's verdict | S-11 | must | reported |
| FR-42 | Drift flag names the mission line, the diverging output, the reason | S-11 | must | reported |
| FR-43 | Drift surfaces through existing routing, never unilaterally reverted | S-11 | must | reported |
| FR-44 | Flagged repo-doc gap names a concrete, checkable defect | S-12 | must | reported |
| FR-45 | Checks run as a byproduct of reliance, not only a scheduled audit | S-12 | must | reported |
| FR-46 | Flagged gap surfaces through S-9's briefing; never fixed by chief of staff | S-12 | must | reported |
| FR-47 | Same gap hit by multiple agents in one session flagged once | S-12 | must | reported |
| FR-48 | Never proactively surfaces a non-blocking item; narrow blocking-item push only | S-9 | must | observed |
| FR-49 | A pushed blocking item is delivered alone, not bundled | S-9 | must | observed |
| FR-50 | Mid-exchange blocking item pauses/resumes; never concurrent, never silent-queued | S-9 | must | observed |
| FR-51 | Chief-of-staff unavailability falls back to direct-ask, never blocks | epic-wide | must | assumed |
| FR-52 | Output flagged by both S-7 and S-11 routes as one merged item | S-7, S-11 | must | reported |
| FR-53 | Unclaimed spike surfaces in S-9's briefing as unclaimed | S-8 | should | reported |
| FR-54 | Large briefing stays grouped/summarized, reviewer-judged | S-9 | should | observed |
| FR-55 | Wrong drift flag recorded in the decision log per FR-23's content | S-11 | should | reported |

## Non-functional requirements

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Self-correction check cadence (`FR-13`) | One check per governed-artifact-producing phase gate — reasoned from both real sessions, where a wall-clock target (days/hours) was already shown to be too loose | Replay both real sessions' tool-call histories against the rule; compare demanded checks to the observed 1 and ~0 |
| NFR-2 | False-positive rate for "not-invoked" on genuinely-invoked steps | Open question — no measurement exists yet | — |
| NFR-3 | Concurrency (multiple sessions in a shared repo) | Out of scope per non-goals (no team-based usage observed) | — |
| NFR-4 | Availability | Not applicable — this runs inside a single Claude Code session, not a hosted service | — |
| NFR-5 | Retention of invocation/check records | At least as long as the artifact they annotate exists in the repo — no independent expiry | A record for a deleted artifact may be pruned; one for an existing artifact may not |
| NFR-6 | Non-blocking-default threshold (`FR-35`) | Open — no number set. Owner: qa-strategist. | Replay a real delegation stretch; confirm default fires exactly at threshold |
| NFR-7 | Minimum logged-instance count for a learned shortcut (`FR-36`) | Open — same as Open Question 6. Owner: qa-strategist/product-owner sign-off. | Replay a real multi-session decision log; confirm no shortcut below threshold |
| NFR-8 | Concurrent-arrival ordering/race mechanics (`FR-50`) | Open. Owner: solution-architect. | Fire two simultaneous blocking items in a synthetic harness; confirm behavior matches the chosen rule |
| NFR-9 | Recency-weighting/decay window for S-10's pattern re-check | Open, distinct from NFR-7. Owner: qa-strategist/product-owner. | Feed a synthetic history with an old and a newer contradicting pattern; confirm weighting matches |
| NFR-10 | Briefing scannability at volume (`FR-54`) | Open, same class as NFR-6–9 — S-1's own rule is unquantified too. Either a real threshold is set at implementation time, or this stays a qualitative reviewer-judged check (matching `FR-9`–`12`'s rubric pattern). Owner: product-owner to decide which. | Replay a long delegation stretch; a reviewer confirms the briefing reads as scannable |
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
  append-only decision-log write (for `FR-23`/`FR-55`) without pulling S-10's own
  pattern-detection logic forward from Stage-2 — mirrors the `harden` epic's own
  ledger-before-consumer sequencing; not confirmed until solution-architect sizes it
  (Open Question 7).
- That chief of staff is realizable as a shared convention every agent is instructed to
  consult, rather than requiring a new enforcement primitive this harness doesn't have —
  Open Question 9, solution-architect's call at architecture time.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | What's the actual mechanism for FR-1–FR-4 — a tool-call ledger, a frontmatter stamp, something built on the confirmed-real Claude Code hooks? | solution-architect | Architecture |
| 2 | Should a minimal fallback rubric exist for FR-11's no-rubric case, or should visual criteria simply stay unable-to-be-checked until one is authored? | product-owner | Scoping S-3's fallback behavior |
| 3 | FR-13/NFR-1 sets the cadence at one check per governed-artifact phase gate. Does reaching that gate mid-task interrupt in-progress work, or only gate the next completion report? | solution-architect | Scoping S-4 |
| 4 | Is the operator who reads only the verdict (S-4's actor) real enough to justify FR-13–FR-16's cost, given zero observed instances? | product-owner | Confidence in S-4's priority |
| 5 | Is any tool in this environment confirmed able to produce a real visual capture of a rendered terminal (for `FR-19`), or does TUI verification stay honestly "unable to be checked" until one is confirmed? | solution-architect | Architecture's Mechanism 3 extension; a spike, the same shape as the original Spike 4 |
| 6 | Minimum logged-instance threshold before S-10 may apply a learned shortcut (`FR-36`) | qa-strategist, product-owner sign-off | Scoping S-10 |
| 7 | Does the decision log reuse the harden epic's invocation ledger, or need its own store? | solution-architect | Architecture for `FR-23`/S-10 |
| 8 | If/when `FR-13` ships, does chief-of-staff's shipping-speed bias carve out an exception for it, or does it narrow `FR-13`? | product-owner | Resolving the flagged tension |
| 9 | Is chief of staff a subagent other agents call, a shared convention document, or something else? | solution-architect | Architecture for the whole epic |
| 10 | Who has standing to revise/recapture the mission mid-effort — operator only, or can an agent propose for confirmation? | product-owner | Scoping S-11's recapture path |
| 11 | Where does the captured mission text actually live — brief.md frontmatter, a standalone artifact, or the decision-log store? | solution-architect | Architecture for S-11 |
| 12 | NFR-6's actual threshold number | qa-strategist | Finalizing `FR-35` |
| 13 | NFR-8's exact concurrent-arrival mechanism | solution-architect | Implementing S-9's concurrency rule |
| 14 | Does a bounced question (S-7) or an unclaimed spike (S-8/`FR-53`) time out and escalate after a count, a duration, or never? | qa-strategist | S-7/S-8 error-path completeness |
| 15 | Does S-12's once-per-session gap dedup (`FR-47`) extend across sessions? | product-owner | S-12 scoping (Stage-2, non-blocking now) |
| 16 | Is briefing delivery itself guaranteed atomic (no truncated briefing presented as complete)? | qa-strategist | S-9 completeness |

## Out of scope

- Redesigning the phase sequence itself.
- A manual approval checkbox in place of real verification.
- The underlying reason narration substitutes for invocation (detection only, this round).
- A general-purpose scheduling primitive beyond what FR-13 needs.
- Team-based or multi-operator usage.
- The operator whose need is per-project artifact scoping — already served.
- **Chief of Staff epic:** hard enforcement of any routing rule — convention only, per the
  stated architectural boundary (no hook can force consultation or compliance).
- Chief of staff overruling a scope decision itself (S-7) or unilaterally judging a flagged
  mission drift as wrong (S-11) — it routes and names; the operator/product-owner decides.
- Predictive/generative modeling of operator taste before real logged instances exist (the
  S-10 anti-pattern).
- Cross-project/cross-operator sharing of the S-10 decision log.
- Retroactively fabricating a captured mission for efforts that predate this capability.
- Live undo of an agent already acting on a chief-of-staff answer later found wrong — the
  error path is a post-hoc log entry (`FR-23`/`FR-55`), not a real-time interrupt of work
  already in motion.
- Semantic deduplication of candidate questions across agents — exact/near-exact matching
  only this iteration (S-8's `FR-30`, S-12's `FR-47`).
- Bypass detection for an agent that skips a fully-available chief of staff — not
  distinguishable from unavailability-fallback (`FR-51`) this iteration.
