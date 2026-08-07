# PRD: delivery plugin — enforcement of its own doctrine

> Initiative: `harden` (`.delivery/initiatives/harden/`), per `ADR-004`.
> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: `S-1`–`S-4` shipped and accepted · `S-5` added 2026-08-06, not yet built ·
> Last updated: 2026-08-07
> Brief: `brief.md` (this directory) · Glossary: `../../glossary.md` (project-wide, per `ADR-004`)
> **Moved 2026-08-07 from the shared root `.delivery/prd.md` into this initiative's own
> directory (`ADR-004`)** — this file previously also carried the Chief of Staff epic's
> content (S-6–S-12/FR-20–55); that content now lives at
> `.delivery/initiatives/chief-of-staff/prd.md`, unchanged in substance, split at the exact
> section boundary both were already written along. No content was rewritten in the split;
> re-measure the word budget fresh rather than trusting the pre-split declared count above.

## Summary

A self-assessment: hardening the delivery plugin's own enforcement of its doctrine, plus a
second, additive epic. The brief found four ways the doctrine is sound on paper but gets
narrated past under real, long-session pressure. Four scenarios follow, one per finding,
each walking a named operator through the failure as it happened — except the operator who
reads only the verdict, which is hypothesized, not observed
(`.delivery/personas/the-trusting-delegator.md`). A fifth, later problem — the same
operator carrying the pipeline's entire question-traffic as an attention sink — is answered
by the **Chief of Staff** epic (S-6–S-12), specified after S-1–S-4 below.

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

**Amendment, 2026-08-06 — scope lifted, its own precondition now met.** The GUI case now
works: built, unit-tested, and confirmed live (`FR-9`–`FR-12`, closed debt D-2). The reason
generalizing was deferred — "before that works" — no longer holds. Direct product-owner
direction, this session: a CLI or a TUI is a real user-facing surface exactly like a
rendered page, and checking it by reading machine-level output (parsed text, an
accessibility tree, ANSI-stripped terminal text) is the same category of mistake `FR-9`
already exists to catch for GUIs, just in a different medium. `S-5` below extends the same
principle. Graded honestly: this is a direct requirement from this conversation, not a
transcript-observed incident like `S-3`'s — no CLI/TUI verification failure appears in
either real session studied. The GUI rule stays `observed`-grade; `S-5`'s rule is
`reported`-grade until a real incident or a real build confirms it the same way.

**Non-goals** — things a reader might assume are included, but are not:

- Redesigning the phase sequence — the planning half works when run; only enforcement is
  broken.
- A manual approval checkbox standing in for real verification — rejected directly in the
  evidence. A lighter checkpoint is the brief's Open Question 3, not decided here.
- Broadening the evidence base beyond the one operator studied, before scoping further.
- ~~Extending the channel-and-rubric requirement past UI-facing criteria this iteration.~~
  **Lifted 2026-08-06** — see the amendment above and `S-5`.
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

### S-5: A verdict checked the wrong layer because the surface wasn't a webpage

**Actor:** the operator who checks in periodically
**Trigger:** acceptance checking runs against a governed artifact that is a CLI or a TUI,
not a rendered GUI.
**Preconditions:** `S-3`'s rule already requires a real capture for rendered, visible
behavior — but its own wording and its non-goal both assumed "rendered" means a webpage.
This scenario is that same rule applied honestly to a different real surface. **Grade:
`reported`, not `observed`** — unlike `S-3`, no CLI/TUI verification failure appears in
either real transcript studied; this scenario traces to a direct product-owner instruction,
this session, not a mined incident. Real, but a different, weaker kind of real — see
`prioritization.md`'s Confidence section.

**Main path**

1. A story delivers a CLI command or a TUI screen; its acceptance criteria describe what a
   real user would see or get back when they actually run it.
2. The agent decides what channel proves that — and, left unguided, reaches for the layer it
   already has open: reading the tool's own internal handler function, or reading terminal
   text with formatting stripped, rather than what a real user actually experiences.
3. For a CLI: the criterion is only proven by a real process invocation with real observed
   `stdout`/`stderr`/exit code — calling the same logic as an internal function, bypassing
   the actual command boundary, is not the same claim.
4. For a TUI: the criterion needs a real visual capture of the rendered terminal — color,
   alignment, layout, box-drawing, animation. A text read with ANSI codes stripped (the one
   terminal-reading tool confirmed available in this environment does exactly this) sees
   none of that, the same blind spot `S-3` names for a DOM read of a webpage.
5. The verdict states which surface type applied and which channel was used — never a bare
   "works," and never a GUI-shaped check applied to a surface that isn't one.

**Observable outcome:** a CLI or TUI acceptance verdict is checked at the layer a real user
actually experiences, not the layer that happened to be open — matching `S-3`'s standard,
extended to the surfaces it didn't originally name.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| CLI criterion checked only by calling internal logic directly, no real process launched | Not-met — the process boundary itself is part of the claim |
| TUI criterion checked only by a text read of terminal output (ANSI stripped or not) | Not-met — text alone cannot confirm color, alignment, or layout |
| No tool in the current environment can produce a real visual capture of a terminal | Verdict states the criterion is unable to be checked, same honesty pattern as `FR-11` — never silently passed |
| A surface is ambiguous (e.g., a CLI that also renders a TUI mode) | The stricter of the two applicable channel requirements governs |
| A surface is none of GUI/CLI/TUI (e.g., a library API, a config file) | No channel is defined yet — states unable-to-be-checked by default, same honesty pattern as `FR-11`, rather than an invented ad hoc check |

**Acceptance criteria**

- `FR-17` — a verdict for a governed artifact states which delivery surface applies (GUI,
  CLI, or TUI) and requires the channel matching that surface — a GUI-shaped check is never
  applied by default to a non-GUI surface. A surface outside these three has no defined
  channel yet and defaults to unable-to-be-checked, per `FR-11`'s honesty pattern, rather
  than an agent inventing an ad hoc check for it.
- `FR-18` — a CLI-surfaced "met" verdict requires the reviewer to have directly observed a
  real process invocation, with `stdout`/`stderr`/exit code named; a call to the same logic
  through an internal function, bypassing the actual command entry point, does not satisfy
  this. A durable, ledger-based cross-check (the same guarantee `FR-9` gets from the
  invocation ledger) remains an open item — `harden-11`'s spike found no safe way to
  whitelist a `Bash` call's content without risking a leaked secret.
- `FR-19` — a TUI-surfaced "met" verdict requires a real visual capture of the rendered
  terminal; a text-only read (ANSI-stripped or otherwise) does not satisfy this and must be
  recorded not-met or unable-to-be-checked, per `FR-11`'s honesty pattern, if no visual
  capture channel is confirmed available.

