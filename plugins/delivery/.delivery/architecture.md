# Architecture: delivery plugin self-hardening (MVP)

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist.
> Status: draft · Last updated: 2026-08-05
> PRD: `.delivery/prd.md` · ADR: `.delivery/decisions/ADR-001-hook-based-invocation-provenance.md`

## Approach

This plugin ships zero executable code today — confirmed directly, only markdown exists.
The design adds a real, first-time packaging change: a hook (`hooks/hooks.json` + one
script) that watches for real tool calls resolving and logs them to a per-project ledger,
because that is the only signal inside Claude Code an agent cannot narrate around (ADR-001).
Two of the three MVP mechanisms build on that ledger; the third needs no code at all.

**A critique pass on the first draft found a real gap, not a preference, and this design
incorporates the fix rather than deferring it:** anchoring the screenshot-and-rubric check
only inside `sprint-review` protects against a repeat that never actually happened — the
real elba-dreaming incident was an ad hoc mid-session exchange, not a formal `sprint-review`
run, and `sprint-review` itself barely ran in that engagement (the Skill tool fired once in
four days). A check that only fires when one specific, rarely-invoked skill runs does not
protect against the incident it was built from. Fixed below by making the check apply to
any UI-facing "renders correctly" claim, cross-referenced against the ledger regardless of
which skill's turn it happens on — not scoped to one skill file.

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `.claude-plugin/plugin.json` | Manifest, no `hooks` field | untouched — default `hooks/hooks.json` location needs no manifest edit |
| `hooks/hooks.json` | does not exist | **new** |
| `hooks/scripts/record-invocation.js` | does not exist | **new** |
| `.delivery/invocations/<session_id>.ndjson` | does not exist | **new** convention, per target project, git-tracked |
| `skills/status/SKILL.md` | Reads artifact existence + exit criteria | modified — cross-references the ledger |
| `skills/prioritize/SKILL.md` | Scores requirements, cuts stages | modified — evidence-only-marker rule |
| `templates/prioritization.md` | Already has a `Confidence` column, unenforced | modified — adds a marker slot per stage |
| `agents/qa-strategist.md` | Owns acceptance-criteria verification, cross-skill | modified — the channel+rubric rule lives here, not in one skill file |
| `skills/sprint-review/SKILL.md` | Independent acceptance re-check | modified — invokes the now-shared channel+rubric rule, does not own it alone |
| `templates/sprint-review.md`, `templates/design-system.md` | Criteria/token tables | modified — add Channel, Rubric-rule-ID columns |
| `README.md` | States "everything is markdown" | modified — one line, now inaccurate otherwise |
| Everything else | — | untouched |

## Component structure

**Mechanism 1 — invocation ledger (`FR-1`–`FR-4`):** a real Skill/Agent tool call resolves →
`hooks/hooks.json` fires `record-invocation.js` on `PostToolUse`/`PostToolUseFailure` →
the script resolves the nearest `.delivery/` by walking upward (read-only; no-ops if none
exists) → appends one whitelisted-field JSON line to `.delivery/invocations/<session_id>.ndjson`
→ `/delivery:status` reads all ledger files for the project and reports each governed
artifact as invoked, not-invoked, or untraceable, preserving history rather than overwriting
a past gap.

**Mechanism 2 — evidence-only marker (`FR-5`–`FR-8`):** no code. `skills/prioritize/SKILL.md`
gains a check: if every persona backing a stage reads `assumed` in the existing `Confidence`
column, render the marker directly under the stage heading — a fixed template slot, not a
footnote, so it can't be buried. Re-evaluated on every read, not stamped once, so an
upgraded grade clears it automatically.

**Mechanism 3 — verification channel + design rubric (`FR-9`–`FR-12`), corrected scope:**
the rule — a UI-facing "met"/"renders correctly" claim must (a) cite its channel, checked
against the same ledger for a matching capture-tool call, and (b) cite a specific
`design-system.md` rule ID, or state no rubric exists — now lives in `agents/qa-strategist.md`
as a standing check that role applies whenever it verifies UI-facing criteria, in or out of
a formal `sprint-review` run. `sprint-review/SKILL.md` invokes that same check rather than
defining its own copy, so an ad hoc mid-session verification and a formal review apply the
identical rule.

**Honest limit:** the ledger proves a real capture *happened*. It cannot judge whether the
agent's visual read of that capture against the cited rule was *correct* — no tool found in
research does that automatically. This design makes the claim checkable and citation-anchored,
not fully automated.

## Interfaces and data contracts

```json
// hooks/hooks.json
{ "hooks": { "PostToolUse": [
    { "matcher": "Skill", "hooks": [{ "type": "command", "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/record-invocation.js"] }] } ],
  "PostToolUseFailure": [ /* same matcher and script */ ] } }
```

```json
// .delivery/invocations/<session_id>.ndjson — one line per event
{"ts":"...","session_id":"...","hook_event":"PostToolUse","tool_name":"Skill",
 "invoked_name":"delivery:prd","outcome":"success","cwd":"...","delivery_root":".delivery"}
```

Whitelisted fields only — never raw `tool_input`. Binding, not an implementation detail: a
`Bash`/`Write` call's raw input can carry file contents or secrets, and this ledger is
git-tracked. `record-invocation.js` exit code is always `0` — this hook only logs; it must
never block or degrade the call it observes, that is the deferred gate's job, not this one's.

Ledger location is per-session, inside `.delivery/`, not host-local cache — `NFR-5` requires
retention tied to the artifact's own lifetime, which only holds if the record travels with
the repo. Per-session files also make concurrent writes a non-issue by construction, for
free, without needing `NFR-3`'s (out-of-scope) concurrency guarantees.

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | One self-correction check per governed-artifact phase gate | Out of MVP scope — this ledger is the precondition the deferred gate needs | n/a this phase |
| NFR-2 | False-positive rate on "not-invoked" | Open, unmeasured per the PRD — reduced by whitelisted fail-loud recording and one source of truth for the phase map, but a real rate needs post-ship replay | low, honestly stated |
| NFR-3 | Concurrency | Out of scope; per-session files sidestep it structurally anyway | n/a |
| NFR-4 | Availability | Not applicable — runs inside one session, not a hosted service | n/a |
| NFR-5 | Retention ≥ artifact lifetime | Met by git-tracked, per-project storage; automatic pruning on artifact deletion is not implemented — accepted gap, not solved | high (location) / open (pruning) |

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-001 | Invocation provenance is hook-based (`PostToolUse`/`PostToolUseFailure`), not an invokable skill | An invokable verification skill (reproduces the failure it exists to catch); a `Stop`-hook that blocks session end (pulls the deferred gate's scope in without a real decision to do so) |

## Spikes — what must be proven before committing

Reworded per QA review where the original phrasing wasn't checkable.

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Across ≥20 real Skill invocations in a real session, what fraction produce a complete, correctly-timed ledger entry, with no lost writes racing a same-session `/delivery:status` read? (Reworded from "reliably fire" — that phrasing wasn't falsifiable.) | 1 day, empirical | Whether hook-based recording is trustworthy — ADR-001's load-bearing assumption |
| 2 | Exact `tool_name`/`tool_input` field names identifying which skill or subagent was invoked | 0.5 day, same probe | The `hooks.json` matcher list and the ledger→artifact name mapping |
| 3 | Do `TaskCreated`/`TaskCompleted` mean subagent completion, or the general task-tracking tool? (`SubagentStart`/`SubagentStop` look like the real subagent events per current docs, contradicting the PRD's own earlier assumption) | 0.5 day | Whether the deferred gate can reuse this ledger's event vocabulary unmodified |
| 4 | Enumerate the concrete capture-tool names used in the elba-dreaming session specifically (not a general taxonomy — matches the PRD's own non-goal against broadening evidence), and confirm a hook can tell a screenshot action apart from other actions on the same tool | 1 day | The matcher list for Mechanism 3; whether `FR-12`'s reproduction actually reproduces |
| 5 | Confirm a crashing/erroring `PostToolUse` hook cannot silently block the call it observes, verified for this specific event (not assumed from the general docs table) | 0.5 day | Whether the recorder is safe to ship as pure side-channel logging |

**Post-implementation update (2026-08-05):** Spikes 1, 2 and 5 were run for real against
this repository, not just estimated. 5 fresh headless sessions each genuinely invoked the
Skill tool; all 5 fired `PostToolUse` correctly and produced a valid ledger entry — real
session IDs, real `tool_use_id`s, correct field extraction (answers Spike 2 empirically,
confirming the docs-sourced field names). Spike 5 is answered both by documentation
(`PostToolUse`/`PostToolUseFailure` structurally cannot block, since both fire only after
the tool has already resolved) and consistent with the live runs, none of which showed any
sign of the observed tool call being degraded. Short of the ≥20-invocation target — 5 is a
real sample, not an exhausted one. The mid-run-error firing case (as opposed to a
rejected-before-dispatch case, which was tried and does not exercise this path) remains
unconfirmed. Spike 4 was not attempted (blocked on the same constraint Spike 1 hit before
its fix — see below — but not re-attempted after). Spike 3 remains out of this MVP's scope
per the roadmap.

**A real defect was found and fixed during this live testing, not anticipated by any spike
above:** the original `findDeliveryRoot` implementation only walked upward from the working
directory. In this actual repository, `.delivery/` lives at `plugins/delivery/.delivery/` —
below a session's real working directory (the repo root), not above it. The first live test
run completed successfully but produced zero ledger entries because of this. Fixed with a
bounded downward search (max depth 4, skips `node_modules`/build directories, declines
rather than guesses if more than one `.delivery/` is found) — see
`hooks/scripts/record-invocation.js` and its test file. This is now the more important
finding of this phase's live testing than any of the five spikes originally listed: unit
tests alone would never have caught it, because every fixture matched the implementation's
own wrong assumption rather than testing against this repository's real shape.

## Migration and rollback

**Not applicable to prior data or interfaces** — verified directly: no code, no prior hook
format, no prior ledger format exists to migrate.

**Forward:** ship `hooks/hooks.json` + the script; no manifest edit needed. Template field
additions are additive — an existing document written under the old template stays valid
and gains the new fields on its next run, matching the "refine, don't regenerate" pattern
already used for personas.

**Back:** remove `hooks/hooks.json` in a later version. Leftover `.delivery/invocations/*.ndjson`
files are harmless; `/delivery:status` already treats a missing or empty ledger as
untraceable ("could not check"), so rollback degrades gracefully.

## Test strategy

Risk-based, not uniform — testing at the wrong altitude (a unit test confirming the script
parses JSON correctly, mistaken for confirming it actually fires inside a real session) is
exactly this plugin's own recurring documented failure, so the two are kept explicitly separate.

| Area | Risk | Test level | Notes |
| :-- | :-- | :-- | :-- |
| Ledger write mechanics (field whitelist, NDJSON append) | Medium | Unit | Necessary, not sufficient — canned payloads only, no session realism |
| Hook firing reliability, timing, races (Spike 1) | High | Empirical spike, not a test | No unit/integration test substitutes for running inside a real session |
| Hook crash isolation (Spike 5) | High — a silent block defeats `FR-1`–`FR-4` entirely | Spike, then a permanent regression check once confirmed | Deliberately throw in the script; confirm the observed call still returns normally |
| `/delivery:status` classification (invoked/not-invoked/untraceable, retry, mid-run error) | High — this *is* the acceptance criteria | Integration, fixture-driven | Cover all edge-path rows in the PRD's S-1 table explicitly |
| Verification-channel cross-check (`FR-9`) | High | Integration + spike | Inherits ledger risk *and* depends on Spike 4 — do not test ahead of it |
| Rubric rule-ID citation, no-rubric statement (`FR-10`–`FR-12`) | Medium | Example-based | Rubric-present, rubric-absent, and elba-dreaming's real defect as fixtures |
| Evidence-only marker (`FR-5`–`FR-8`) | Low–medium | Example-based | Deterministic prose rule — mixed evidence, zero-persona, elba-dreaming replay, marker-clears-on-upgrade |

**Deliberately thin:** `NFR-2`'s false-positive rate is left unmeasured — no test invents a
number the product hasn't committed to. Multi-session concurrency is untested, matching the
out-of-scope `NFR-3`. Capture-tool discrimination is scoped to elba-dreaming's own toolset,
not a general taxonomy, matching the PRD's non-goal against broadening evidence.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| Hook bugs silently miss real invocations, producing false "not-invoked" on genuine work | Medium | High | Spikes 1, 5; fail loud, never silent; whitelisted extraction only | solution-architect |
| `tool_name`/`tool_input` shapes are undocumented and can drift across Claude Code versions | Medium | High | `/delivery:status` treats zero ledger entries in an active session as a distinct warning, not a clean report; re-run Spikes 1–2 after upgrades | solution-architect |
| Raw `tool_input` leaks file contents or secrets into a git-tracked ledger | Medium if unenforced | High | Whitelist-only extraction is a binding constraint, stated here as non-negotiable | solution-architect |
| The channel+rubric check, even shared, still depends on `qa-strategist` actually being consulted — an ad hoc check nobody routes through it is still uncovered | Medium | Medium | Named explicitly, not solved here — `/delivery:status` should flag UI-facing criteria with no verification-channel record at all, as a weaker but real backstop | product-owner |
| The ledger records that real actions happened; it does not prevent narration-without-invocation from occurring for phases other than this mechanism itself — visibility, not prevention | Known, already accepted | Medium | Named in the PRD's own non-goals; the deferred self-correction gate (Stage 2) is the actual prevention mechanism | — |

---

# Architecture: Chief of Staff epic (additive)

> New section, appended. Does not modify any section above — those cover only the shipped
> `harden` epic (S-1–S-4/`FR-1`–16) and are closed. This section covers `prd.md`'s Chief of
> Staff epic (S-5–S-11/`FR-17`–52) only.
> Status: draft · Last updated: 2026-08-07
> PRD: `.delivery/prd.md` (Chief of Staff epic) · ADRs: `ADR-002`, `ADR-003`
> **Word count: the whole document is now 3975 prose-only words** (was 1189 before this
> section; `grep -v '^|' .delivery/architecture.md | wc -w`). Exceeds the template's
> 1600-word single-epic cap — same reasoning `prd.md`'s own header states: two independent
> epics now coexist in one architecture document, each scoped and reviewed on its own terms.
> Two content passes drove the growth, both adding real requirement coverage rather than
> restatement: qa-strategist's completed Test strategy (per-FR/per-Case-table coverage across
> all five MVP-1 scenarios, closing gaps a first sketch had left silent), and feature-critic's
> adversarial pass (2 blocking findings folded in directly — CoS-1's spike design didn't
> control for the session-length/fatigue dimension `brief.md` shows the failure actually
> depends on, and two of the nine extended agent files had a pre-existing escalation
> convention this design hadn't reconciled with; plus 3 significant findings resolved:
> `FR-45`/46's missing return-contract and push-trigger, an overclaimed compliance inference
> from the ledger's detection accuracy, and `ADR-002`'s revisit clause pointing at an
> alternative already proven no stronger). Cutting any of this back to fit the budget would
> re-hide exactly the gaps this pass exists to surface, for no reader benefit.

## Approach

Consultation stays convention-only — the epic's own stated boundary, unchanged: no hook can
intercept or force it. The single load-bearing design choice is *how* that convention is
shaped so it inherits something real rather than staying pure prose. `hooks/hooks.json`'s
matcher already includes `Agent`, and `hooks/scripts/record-invocation.js` already extracts
`subagent_type` as the invoked name for any `Agent` tool call — live-verified 21/21 real
sessions by `harden-05`, untouched by anything in this section. Making every chief-of-staff
consultation a real Agent-tool call, not inline reasoning inside another agent's own turn,
means every consultation — or its absence — lands in that already-shipped ledger for free
(`ADR-002`). This makes the epic's central risk (a standing instruction narrated past the same
way `brief.md`'s Finding A describes) **detectable, not prevented** — Spike CoS-1 below is the
check on whether detectable is enough to matter in practice.

**Positioning, not a new mechanism** (full framing in `prd.md`'s epic intro, not repeated
here): chief of staff is the third of three senior lenses, alongside Business Analyst
(protects the business proposition) and Solution Architect (protects the delivered
solution's soundness, unchanged by this epic — S-7 defers to it rather than duplicating the
judgment). Chief of staff owns the previously-unowned third invariant: the human principal's
attention and stated mission. **Precisely what the 21/21 figure
proves, restated per feature-critic finding 3:** that the ledger *records* a real Agent-tool
call accurately when one happens — nothing about it, or about anything else shipped so far,
demonstrates that an agent's propensity to make that call rather than narrate one is any
higher than Finding A's own 5/13 and 1-in-4-days rates for the structurally identical
Skill-tool case. Detectability is proven; compliance uplift is not — CoS-1 is the first real
test of the latter, not a confirmation of something already partly shown.

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `agents/chief-of-staff.md` | does not exist | **new** — owns S-5–S-8 triage: citation-check, bounce, spike-route, briefing assembly |
| `skills/chief-of-staff/SKILL.md` | does not exist | **new** — operator-facing pull entry point (S-8), mirrors `/delivery:status`/`/delivery:challenge` |
| `templates/chief-of-staff-queue.md` | does not exist | **new** — modeled on `templates/findings.md`'s tracked-status pattern |
| `templates/mission.md` | does not exist | **new** — small, modeled on `brief.md`'s standalone-artifact pattern |
| `.delivery/chief-of-staff/decision-log/<session_id>.ndjson` | does not exist | **new** convention, per project, git-tracked — own store, mirrors `.delivery/invocations/`'s storage pattern only (`ADR-003`) |
| `.delivery/chief-of-staff/queue.md` | does not exist | **new** convention — mirrors `.delivery/reviews/*.md`'s status-tracked pattern |
| `.delivery/chief-of-staff/mission.md` | does not exist | **new** convention — current captured mission + revision history |
| `hooks/hooks.json`, `hooks/scripts/record-invocation.js` | `Agent`-tool matcher + `subagent_type` extraction already shipped (`harden-05`) | **untouched** — already covers chief-of-staff consultations, zero code change (`ADR-002`) |
| `agents/business-analyst.md`, `delivery-lead.md`, `design-lead.md`, `feature-critic.md`, `product-owner.md`, `program-manager.md`, `qa-strategist.md`, `solution-architect.md`, `user-researcher.md` | each carries an identical "## Language" standing-instruction section | **extended** — new short "## Chief of staff" section added in the same location and register |
| `agents/persona-simulator.md` | role-plays an end-user persona, read-only, in-character | **untouched, deliberately** — not a pipeline worker; see Component structure |
| `skills/status/SKILL.md` | reads governed-artifact, ledger, and review state | **extended** — Gather table gains a chief-of-staff row; Assess gains an open-briefing/open-decision-log check |
| Everything else (`prd`/`personas`/`architecture`/`roadmap`/etc. skills, other templates, `.delivery/invocations/`, `.delivery/decisions/`) | — | untouched |

## Component structure

**Mechanism — chief-of-staff consultation (S-5–S-8, `FR-17`–32, `FR-45`–51), resolving Open
Question 8:** a consulting agent forms a candidate question mid-task → it invokes the Agent
tool directly (`subagent_type: "delivery:chief-of-staff"`), no skill layer in between → the
chief-of-staff agent checks for a citable source (S-5), a traced requirement (S-6), or a
real-execution unknown (S-7), in that order, using the exact citation-or-nothing discipline
`FR-17`–19/`FR-21` require → an answer, a bounce, or a routed spike, each written to
`.delivery/chief-of-staff/queue.md` if it doesn't resolve on the spot → at check-in, the
operator (or the orchestrating agent on their behalf) pulls `skills/chief-of-staff/SKILL.md`,
which reads the queue and assembles S-8's ranked briefing. The one push exception (`FR-45`/46)
is the same skill delivering a single queue item outside a pull.

This resolves Open Question 8 as **neither of the two named options alone, but a combination**:
a real subagent (mechanically honest, ledger-visible) carries the triage logic once, in one
place; a thin skill wrapper serves the operator-facing pull; and a short standing-instruction
section — in the same location and register as the existing "## Language" section every agent
already carries — is added to each of the 9 consulting-agent files, stating only the trigger
condition, the exact call to make, and the `FR-48` fallback, never the triage logic itself.

**Two of the nine already have a pre-existing, working escalation habit that this addition
must reconcile with, not silently duplicate (feature-critic finding, folded in here):**
`business-analyst.md`'s "Track open questions as first-class items" and
`solution-architect.md`'s "Flag [unproven assumptions] as spikes with a specific question and
a time box" both predate this epic and already route their own findings to a written artifact
— never to a mid-work operator interruption. Neither is the failure mode S-5/S-6/S-7 exist to
intercept, so neither instruction is edited or superseded. The per-file pointer section states
this explicitly rather than leaving it to be inferred: **for `business-analyst.md`**, its
existing Open Questions convention stays exactly as-is — that mechanism is for a role's own
deliverable output (feeding `prd.md`'s Open Questions table via a reviewed phase, not an ad
hoc mid-task interrupt), a different case from S-5's "candidate question that would otherwise
surface directly to the operator." Chief-of-staff consultation applies only to the latter.
**For `solution-architect.md`**, its existing spike-flagging habit already *is* S-7's own
mechanism natively — the pointer section says so directly ("you already do this; consult
chief of staff only when a technical unknown surfaces outside your own spike-authoring
context, e.g. while reviewing another role's output") rather than instructing a second,
redundant routing step for the same event.

**Why not a pure shared-convention block (the option the task hypothesized as the leading
candidate):** it is exactly the pattern `brief.md`'s Finding A already diagnosed as this
plugin's core, proven weakness — reasoning through S-5/S-6/S-7 inline, inside another agent's
own context, produces no real tool call and is textually indistinguishable, after the fact,
from having skipped it. **Why not a real subagent alone, with no shared pointer:** every
consulting agent still needs to know *when* to invoke it — that trigger condition has to live
somewhere every agent reads, and the "## Language" section already proves a short, repeated,
per-file block survives across 10 files without drifting. Full alternatives and consequences:
`ADR-002`.

**Honest limit, restated for this epic specifically:** this design makes a skipped or
narrated-without-invocation consultation *checkable* the same way Finding A's own skipped
`/delivery:prd` calls became checkable. It does not make consultation *mandatory* — nothing in
this harness can. Spike CoS-1 is the check on whether checkable is enough.

## Interfaces and data contracts

**1 — Chief-of-staff consultation call.** Unlike the ledger's structured JSON, the Agent
tool's own contract is a natural-language prompt, not a schema — so the "interface" here is a
written protocol, not a payload shape. The calling agent's prompt must state: **its own
identity** (resolving a real gap `chief-of-staff-05`'s story-writer found: without this,
`FR-22`'s "names the originating agent" and S-6's "provenance unknown" case are both
unimplementable — closed here rather than left implicit), the candidate question verbatim,
what it already checked and why nothing settled it, and which of S-5/S-6/S-7 it believes
applies (chief of staff may reclassify). This is a convention to specify at story-time
(`delivery-lead`), not a contract to lock here.

**Return contract and the push trigger, resolving feature-critic finding 5 (`FR-45`/46 had no
described invocation path):** chief of staff's Agent-tool response always states one of four
outcomes — `answered` (S-5, with citable traceback), `bounced` (S-6, with originating agent
and missing requirement), `spiked` (S-7, with the spike story's path), or `queued` (S-8, with
the queue-entry ID and its Blocking flag). There is no daemon and nothing in this harness
proactively messages the operator outside a running session (`harden-02`'s own finding) — so
"push" cannot mean an out-of-band interrupt. It means: **when a `queued` outcome's Blocking
flag is `y` and no open counterpart already exists, the calling agent's own next reply to the
operator — whatever session is currently running — leads with that item before its own
content**, rather than deferring it to a future explicit pull. This makes the calling agent,
not chief of staff, the actual delivery mechanism for a push — consistent with the epic's own
architectural boundary that nothing here can act unless an agent already in a live exchange
with the operator chooses to. A `queued` outcome inside a session where the calling agent
never again addresses the operator (a fully unattended run) has no way to surface until an
explicit pull — named here as a real, accepted limit, not hidden.

**2 — Decision log entry**, resolving **Open Question 6** (own store — `ADR-003`):

```json
// .delivery/chief-of-staff/decision-log/<session_id>.ndjson — one line per event
{"ts":"2026-08-07T10:00:00Z","session_id":"...","category":"inference-not-citation",
 "fr":"FR-20","scenario":"S-5",
 "citable_traceback":"none — inferred from a general pattern, not a cited line",
 "summary":"answered a scope question by inference instead of falling through to S-6",
 "raised_by":"qa-strategist","resolution":"open"}
```

Minimum required fields, per the glossary's own definition: `category`, `citable_traceback`
(or the answer text it's absent from), `ts`. `fr`, `scenario`, `raised_by`, `resolution` are
the proposed remaining shape, revisable at story time. `resolution` starts `open`, moves to
`reviewed-accepted` or `corrected` — never deleted, matching S-2's marker precedent ("flagged,
reviewed, accepted," not erased). Written by whichever agent or skill identifies the outcome —
never hook-triggered, since no tool-call resolution corresponds to "this was noticed wrong
later." `FR-49`'s merge (S-6 and S-10 flagging the same output) is enforced structurally: before
inserting a queue item, chief of staff checks `.delivery/chief-of-staff/queue.md` for an
existing open item about the same output and merges into it rather than opening a second one.

**3 — Briefing queue entry**, modeled on `templates/findings.md`'s tracked-status pattern —
`templates/chief-of-staff-queue.md` defines columns: ID, Rank, Blocking (y/n), Source
(S-5/S-6/S-7/**S-10**/**S-6+S-10 merged**), Item, Suggested default or "no-default-available,"
Status (open/answered/parked/pushed), Originating agent. **Source's enum corrected here**
(`chief-of-staff-08`'s story-writer found the original S-5/S-6/S-7-only list conflicts
directly with S-10's own `FR-40` and this same Interface's `FR-49` merge text, both of which
require S-10-sourced and merged-S-6+S-10 queue items) — a textual completion of what this
document already committed to elsewhere, not a new design call. A single project-scoped
file, not per-session — a delegation period spans multiple sessions, unlike a ledger event.

**4 — Mission capture**, resolving **Open Question 10**: `.delivery/chief-of-staff/mission.md`,
a standalone file — new `templates/mission.md`. Not `brief.md`'s frontmatter (different
mutation lifecycle: `brief.md` is written once at Phase 1 and rarely revised; mission capture
is checked continuously and can be recaptured mid-effort on its own cadence — adding a
frequently-mutated field to a phase document already under its own word-budget discipline
conflates two lifecycles). Not the decision log (a current-value lookup needs one stable
location, not a per-session append log to scan). Contains the current captured mission
(verbatim excerpt or citable pointer, never chief of staff's paraphrase, per `FR-37`) and a
revision-history table (prior text, replaced-on timestamp, `requested_by`). Every recapture
also gets one decision-log entry (`category: mission-recaptured`), so the event trail S-10's
"the change itself recorded" case requires exists the same way every other chief-of-staff
outcome does.

**Open Question 9 is a product-owner call, not an architecture one** — the PRD's own Open
Questions table already names product-owner as its owner, and deciding who has standing to
revise the mission is scope, not mechanism. What this design commits to, so the answer has
somewhere to land either way: `mission.md`'s revision-history table always records who
proposed a recapture, regardless of policy. If product-owner's answer is "operator only," an
agent-proposed recapture is logged as a *pending* revision and does not update `mission.md`'s
current value until the operator confirms — the mechanism supports either answer without
hardcoding one. **Worked example for product-owner:** if an agent, mid-effort, believes the
original goal has shifted enough to justify recapturing it, should that proposal go straight
into effect, or sit as a flagged suggestion until you say yes — the same way a stage backed
only by `assumed` evidence gets flagged rather than silently accepted?

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-6 | Non-blocking-default threshold (`FR-32`) | Open number, owner qa-strategist. Mechanism: a single named constant read by `agents/chief-of-staff.md`/`skills/chief-of-staff/SKILL.md`, not scattered logic — replaceable without an architecture change once qa-strategist sets it | high (mechanism) / open (number) |
| NFR-7 | Minimum logged-instance count for S-9's shortcut (`FR-33`) | Stage-2, deferred. Mechanism ready now: every S-5–S-8 outcome this MVP writes to the decision log carries `category`, so a per-category count is a query over already-logged data once S-9 ships — no schema change needed later | high (mechanism) / n/a (feature deferred) |
| NFR-8 | Concurrent-arrival ordering (`FR-47`) | Resolved, not left open: Claude Code delivers a batch of parallel Agent-tool dispatches back to the orchestrator together, not asynchronously mid-conversation — there is no true race at the interaction layer, only a deterministic-merge rule chief of staff applies when it regains control with more than one pending blocking item (rank by priority, then arrival order). Spike CoS-2 confirms the batching assumption empirically | medium — reasoned from documented tool behavior, confirmed by spike before shipping |
| NFR-9 | Recency-weighting window, S-9 | Stage-2, deferred, owner qa-strategist/product-owner. Mechanism ready: decision-log entries are already timestamped; weighting is a pure function over logged data, no architecture change needed later | high (mechanism) / n/a (feature deferred) |
| NFR-10 | Briefing scannability at volume (`FR-51`) | Met by reusing the same grouping/summarization convention `skills/status/SKILL.md`'s "Keep this scannable at scale" rule already applies to governed artifacts (S-1's own precedent, itself unquantified), applied to `skills/chief-of-staff/SKILL.md`'s briefing output — no new mechanism, same qualitative, reviewer-judged standard | high |
| NFR-11 | Decision-log retention | Proposed by analogy to `NFR-5`, flagged for product-owner confirmation (per PRD). Mechanism: identical storage pattern to the ledger — git-tracked, per-project, tied to the artifact/flag it annotates, no independent expiry | high (mechanism) / open (policy) |
| NFR-12 | Permission/access control between agents and chief of staff | Proposed out of scope, extending `NFR-3`/`NFR-4`'s precedent (PRD). Confirmed: nothing in this design introduces a new cross-agent trust boundary — every agent in one session already shares the same repo/filesystem access; chief of staff reads the same artifacts every other role already reads | high |

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-002 | Chief of staff is a real subagent, invoked directly via the Agent tool, plus a thin skill wrapper for the pull-based briefing and a short standing-instruction pointer in each consulting agent's file | A pure shared-convention document, no subagent (reproduces Finding A's failure one level up); a subagent reachable only through a wrapping skill (adds structure, no added observability) |
| ADR-003 | The decision log is its own append-only NDJSON store, per session, distinct from the invocation ledger | Extending the ledger's schema (breaks `ADR-001`'s binding whitelist); a single project-wide file instead of per-session (reintroduces the write-contention risk per-session files were chosen to avoid) |

## Spikes — what must be proven before committing

The compliance question is the load-bearing one for this whole epic — everything else below
is an ordinary design call, confirmed by reasoning from already-shipped, already-verified
infrastructure, not left unproven by default.

| # | Question to answer | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| CoS-1 | With the standing-instruction-block + direct-subagent-call design in place, across ≥10 real trials spanning ≥2 different consulting-agent types, each trial a task engineered to surface a genuine candidate question (not a scripted "call chief of staff" instruction — the same trap `harden-02` avoided by testing real invocations, not stubs): what fraction produce a real, ledger-confirmed `chief-of-staff` Agent-tool call, versus a narrated claim of consultation with no matching ledger entry, versus no attempt at all? **At least 3 of the ≥10 trials must occur inside one continuous, long (multi-hour+, ideally spanning several unrelated tasks) real session, not as isolated fresh-context tasks** — `brief.md`'s own Findings A/D establish narration-over-invocation as session-length/fatigue-dependent (5/13 in a 38-hour session, 1-in-4-days elsewhere; "exercised least exactly when a session is long, tired and adversarial"), and a spike built only from short, fresh trials cannot detect that regime. **Proposed pass bar** (provisional, qa-strategist to confirm): real-consultation rate ≥70% of genuine-candidate-question trials, and not lower than the narrated-without-invocation rate — if narration exceeds real invocation, the standing-instruction-block is not changing behavior over a pure document, and `ADR-002` is void per its own revisit clause. **External-validity limit, stated plainly:** even meeting this bar across both short and long-session trials does not certify the rate under the specific multi-day, unattended, adversarial conditions Finding A documents — no spike this size can. A passing CoS-1 result de-risks the design; it does not prove parity with the harden epic's own long-session evidence standard. | 2 days (extended from 1.5 to fit the long-session trials), empirical, live sessions | Whether `ADR-002`'s chosen mechanism is worth its file-coordination cost — the epic's central risk, made checkable in this design |
| CoS-2 | Confirm empirically that when multiple subagents are dispatched in parallel in one message (as this environment's own tooling documents as supported), each independently invoking chief of staff, the orchestrator receives all results together, intact, not interleaved or dropped | 0.5 day | `NFR-8`'s deterministic-merge design — if dispatch isn't genuinely batched, a stronger serialization primitive is needed instead |

**What does *not* need a spike, and why:** `mission.md`/queue-file read-write mechanics — plain
markdown, no new mechanism. The decision log's storage pattern — identical to the ledger's,
already live-verified 21/21 by `harden-05`; reusing a proven mechanism for a second file is an
ordinary design call, not a new assumption. Registering `agents/chief-of-staff.md` as a valid
`subagent_type` — this plugin's other 10 agents already work exactly this way; nothing new is
being asked of the harness. Whether chief of staff classifies citations correctly (S-5's
"exact, nameable source" judgment) — the PRD's own `FR-20` already assumes this will sometimes
fail and names the decision log as the recovery path, not a preventable-by-design guarantee.

## Migration and rollback

**Not applicable to prior data or interfaces** — every artifact this section introduces is new;
nothing existing changes shape. `.delivery/invocations/`, `.delivery/decisions/`, and every
harden-epic file listed in the sections above stay byte-for-byte untouched by anything here.

**Forward:** ship `agents/chief-of-staff.md`, `skills/chief-of-staff/SKILL.md`, the two new
templates, and the 9 short per-agent additions. No manifest edit, no hook change.

**Back:** remove the new agent/skill files and revert the 9 per-agent additions. Leftover
`.delivery/chief-of-staff/*` files are inert — nothing reads them once the mechanism is
removed. `FR-48` is itself a built-in soft-rollback: chief-of-staff unavailability already
degrades to today's direct-ask behavior by functional requirement, not only by an ops-level
uninstall.

## Test strategy

Completed by qa-strategist; supersedes solution-architect's sketch, same division of labor as
the harden epic's own section above. Risk-based, not uniform. One constraint specific to this
epic: it ships zero executable code (`agents/chief-of-staff.md`, `skills/chief-of-staff/SKILL.md`,
two templates, nine short per-agent additions — all markdown, per the Codebase context table
above). Unlike the harden epic's `record-invocation.js`, there is no deterministic function
anywhere in this epic a canned-payload unit test could target — "Decision-log format/schema
check" below is relabeled from the sketch's "Unit" for exactly that reason. Every
"Example-based"/"Integration" row means invoking the real agent or skill file against
hand-authored fixture input and checking its actual output or file-write — never stubbing the
agent's judgment. Only Spikes CoS-1/CoS-2 need a genuinely live, multi-turn session where a real
consulting agent chooses whether to call chief of staff at all — a harder, different question
from whether chief of staff decides correctly once invoked (every example-based row below); the
two risks must not be conflated, which the sketch's single "Citation-or-nothing" row partly did
by folding S-5's and S-6's distinct classification judgments into one line.

**Spike CoS-1's framing is confirmed correct.** "Empirical spike, not a test" is the right call,
same reasoning as the harden epic's own Spike 1: no fixture reproduces whether an agent, mid-task,
actually chooses to make a real tool call rather than narrate one. Its pass bar (≥10 trials, ≥2
agent types, ≥70% real-consultation rate, not lower than the narrated-without-invocation rate) is
genuinely quantified — a numerator, a denominator, and a threshold all exist — but has one real
gap: "genuine-candidate-question trial" is the denominator, and nothing yet fixes *who* judges
whether a trial actually surfaced one, or *when*. Judged after seeing whether consultation
happened, that classification can be rationalized either way after the fact. Fix before the spike
runs, not after: pre-register the trial task list and the definition of a genuine candidate
question, blind to the consultation outcome each trial produces.

| Area | Risk | Test level | Notes |
| :-- | :-- | :-- | :-- |
| Consultation compliance (Spike CoS-1) | High — the epic's central risk | Empirical spike, not a test | See pass-bar caveat above; no unit/integration test substitutes for a real session, matching the harden epic's own precedent |
| Concurrent-arrival batching (Spike CoS-2) | Medium — blocks `NFR-8`'s design, not the epic's core premise | Empirical spike, not a test | `FR-47`'s pause/resume behavior (below) is fixture-testable independently of this; the batching guarantee itself is not |
| Epic-wide fallback on unavailability (`FR-48`) | High — an epic meant to reduce interruption must never itself add a new blocking dependency; this is the regression backstop | Example-based | Fixture: the chief-of-staff Agent-tool call fails/errors/is unconfigured — confirm the calling agent's standing-instruction section falls back to asking the operator directly, never blocks, never silently drops the candidate question. Also the mechanism "Migration and rollback" above leans on as its own soft-rollback path — a bug here undermines that claim too |
| S-5 citation classification + stale reflag (`FR-17`–19, Case table) | High — a wrong inferred answer is silent, worse than the interruption it replaced (PRD's own hard constraint) | Example-based | Fixtures: exact-citable-source (direct answer + traceback); interpretation-required; two-disagreeing-sources; no-source-at-all — last three share an expected outcome (fall through, never left unrouted) but are distinct inputs, kept separate per `FR-19`. Plus: cited-source-later-superseded → flagged stale (reuses S-2's already-tested marker — thin by proven reuse, not omission) |
| S-5 `FR-20` — inference discovered later → decision log | Medium-high — a missed write silently starves S-9's whole substrate | Integration | Distinct from the format-check row below: this tests the *trigger* fires, not that a hand-written line parses. Fixture: an `FR-17`/18 answer later reclassified as inference-based; confirm a decision-log line appears |
| S-6 bounce classification + messaging (`FR-21`, `FR-22`) | High — same silent-misclassification risk class as S-5, one hop later | Example-based | Fixtures: traces-to-a-stated-requirement (passes through, not bounced) vs. no-trace (bounced; message names the originating agent and the missing requirement explicitly, not just that a bounce occurred) |
| S-6 bounce escalation paths (`FR-24`, Case table) | Medium — self-limiting (S-8 catches it eventually) | Integration, fixture-driven | Fixtures: provenance-unidentifiable → escalates "provenance unknown"; two-prior-bounces-on-record → escalates rather than bouncing a third time; originating-agent-disputes → routed to S-8 as a dispute, not adjudicated. Overlapping-scope dedup: explicit MVP-1 non-goal, not tested for the same reason it's not built |
| S-7 technical-unknown classification + spike citation (`FR-25`–27) | High — misclassifying an operator-only decision as technical removes it from the operator's hands, the same substitution risk as S-5 | Example-based / integration | Fixtures: real-execution-answerable (routed to a spike) vs. operator-authority-required (must NOT be classified as technical — the actual risk, not the happy path); matching-spike-in-`architecture.md`'s table (cited, no duplicate) vs. no-match (new spike under `.delivery/stories/`) |
| S-7 split question + unclaimed-spike escalation (`FR-28`, `FR-50`) | Medium-high — a dropped half or an invisible unclaimed spike each defeat S-7's purpose | Integration | `FR-28`: one mixed input, confirm both outputs exist (spike AND an S-8 item marked blocked-on-spike) — a single-output check would miss a dropped half. `FR-50`: deliberately thin on the exact trigger point — the PRD's own S-7 prose inline-cites "Open Question 18," which doesn't exist; the Open Questions table carries this exact question as #13 instead (flagged as a PRD numbering defect, not fixed here). Test only the qualitative "marked, never silently dropped" behavior now |
| S-8 briefing accumulation + shape (`FR-29`–31, `FR-51`) | High — the scenario's core "never scattered, never silently absent" guarantee | Integration (`FR-29`) + Example-based (`FR-30`/31/51) | `FR-29`: ≥2 survivors from different scenarios must land in ONE report, not two interrupts. `FR-31`: zero-survivor fixture — report states "nothing survived triage," never omitted. `FR-30`/51 fixtures retained from the sketch, mirror S-1's own qualitative, reviewer-judged standard |
| S-8 non-blocking default vs. blocking never-defaults (`FR-32`) | High for the blocking half — a fabricated default there is exactly what `FR-32` forbids | Example-based, mechanism only | Testable now: a blocking item held indefinitely never silently converts to a default — no ceiling, by design (confirms the Case table's "operator never returns" row; guards a future regression). Deliberately thin: the non-blocking timeout point is `NFR-6`'s open number — boundary cases (one-before/at/one-past threshold) wait for it |
| S-8 push exception (`FR-45`, `FR-46`) | Medium-high — over-pushing defeats S-8's "one briefing, not scattered interruptions" premise | Example-based | Three fixtures: blocking, no delivered counterpart → pushed alone; blocking, counterpart already delivered → not re-pushed; non-blocking → never pushed under any circumstance |
| S-8 mid-exchange pause/resume (`FR-47`) | High — a silent queue or a second concurrent thread is the named failure | Integration + spike | Pause/marker/resume behavior is fixture-testable now (hand-authored "exchange in progress" state + a new blocking item arriving); the concurrent-arrival ordering guarantee inherits Spike CoS-2 — do not test that half ahead of it, same discipline the harden epic applied to its own Mechanism-3 row |
| S-10 mission capture fidelity + zero-state (`FR-37`, Case table) | High — a paraphrased mission silently corrupts every downstream drift check | Example-based | Fixtures: verbatim excerpt (accepted); citable pointer to `brief.md` (accepted); a paraphrase attempted (must be rejected — the actual risk, not the happy path); no mission captured yet (states drift-checking unavailable, never fabricates one retroactively) |
| S-10 drift detection + flag content (`FR-38`, `FR-39`) | High — S-10's differentiator from S-6, named explicitly in the PRD prose | Integration | Core fixture: output traces to a stated requirement (passes S-6) but independently diverges from the captured mission — confirm S-10 still flags it regardless. Flag-content fixture: names the mission line, the diverging output, the connecting reason — not a general "this seems off" |
| S-10 flag resolution / recapture (`FR-40`, Case table) | Medium — bugs here are visible (a flag or mismatch is noticed), not silent | Integration | Fixtures: legitimate-evolution → flag resolved, marked "flagged, reviewed, accepted," never deleted (same as S-2's precedent); deliberate mid-effort recapture → new mission recorded, prior text kept in the revision-history table, one decision-log entry (`category: mission-recaptured`) |
| S-10 `FR-52` — wrong drift flag → decision log | Medium — same class as the `FR-20` row above, one scenario over | Integration | Same trigger→log discipline; fixture is a drift flag later found wrong, confirm an entry using `FR-20`'s minimal content |
| Queue merge on `FR-49` (S-6 + S-10 same output) | Medium | Integration, fixture-driven | Confirm one merged item, not two — retained from the sketch |
| Decision-log format/schema check | Low–medium | Example-based (relabeled from the sketch's "Unit") | No shared writer script exists per `ADR-003` and the Codebase context table above, unlike the ledger's `record-invocation.js` — there is no code to feed a canned payload to. Checked against a real entry an agent/skill actually wrote in one of the fixtures above (the `FR-20`/`FR-52` rows), confirmed valid NDJSON with the minimum required fields |

**Deliberately thin, and why:**
- S-9, S-11 (Stage-2) — untested this round; deferred, not scoped, per the PRD's own Stage-2
  marker (same precedent as `FR-13`–16).
- `NFR-6` (`FR-32`'s threshold), `NFR-7`/`NFR-9` (S-9-scoped, moot until S-9 ships), `NFR-11`
  (decision-log retention policy) — numbers unmeasured, matching the harden epic's own
  precedent of not inventing a number the product hasn't committed to. The *mechanisms* these
  numbers plug into are tested now (see the `FR-32`/decision-log rows above); only the number
  waits.
- `NFR-12` (permission/access) — not thin, not applicable: the architecture reasons no new
  cross-agent trust boundary is introduced; nothing beyond what every existing agent's shared
  repo access already covers.
- S-6's overlapping-scope semantic dedup — explicit MVP-1 non-goal, not tested for the same
  reason it's not built.
- Everything else in S-5/6/7/8/10's FR and Case-table lists is tested in the table above. The
  sketch's silence on S-7 entirely, and on most of S-6/S-8/S-10's individual FRs, was an
  omission, not a declared thin-coverage decision — corrected above rather than retroactively
  relabeled "thin."

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| The standing-instruction-block gets narrated past, same as Finding A — a candidate question is claimed as "checked with chief of staff" with no real call | Medium–high, per precedent | High — undermines the epic's whole premise | Spike CoS-1 measures it directly; the ledger makes the gap visible after the fact even though nothing prevents it | solution-architect, product-owner (whether the measured rate is acceptable) |
| `.delivery/chief-of-staff/decision-log/` confused with `.delivery/decisions/` (ADRs) by an implementer skimming the tree | Low–medium | Medium — a misplaced write corrupts either store's meaning | Distinct nesting and naming, stated explicitly in `ADR-003` | solution-architect |
| 9 agent files carrying the new section drift out of sync over time (one edited, others not) | Low | Medium | Same risk category the "## Language" section already carries and has not shown drift on | delivery-lead |
| S-10's broad trigger ("whenever new output is produced anywhere") applied literally makes every artifact write pay a mission-drift check, at real cost | Medium | Medium | Named, not solved here — exact trigger granularity is a story-time (`delivery-lead`) scoping call | delivery-lead |
| Two subagents dispatched in parallel both resolve a blocking chief-of-staff item and both attempt to update `.delivery/chief-of-staff/queue.md` near-simultaneously | Low — single-session turn-taking mostly serializes this | Medium if it happens — a lost update | Spike CoS-2 confirms batching; the FR-49 merge check (read-before-insert) is the same read-modify-write this risk depends on | solution-architect |
| Chief of staff misclassifies a source as citable when it required interpretation (S-5's hard constraint) | Medium | High — a wrong inferred answer is silent | Not preventable by design; `FR-20` is the PRD's own named recovery path, not a guarantee this architecture makes | product-owner (accepted risk, per PRD) |
