# PRD: delivery plugin — enforcement of its own doctrine

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: `S-1`–`S-4` shipped and accepted · `S-5` added 2026-08-06, not yet built
> Brief: `.delivery/brief.md` · Glossary: `.delivery/glossary.md`

## Version history

| Version | Date | Status | Scope |
| :-- | :-- | :-- | :-- |
| 1 | 2026-08-05–08-06 | `S-1`–`S-4` shipped and accepted; `S-5` added 2026-08-06, not yet built | Self-hardening initiative — invocation provenance, evidence grading, verification channels, self-correction |
| 2 | 2026-08-07 | draft | Document-lifecycle versioning for the plugin's own singular artifacts |

## Version 1

## Summary

A self-assessment: hardening the delivery plugin's own enforcement of its doctrine. The
brief found four ways the doctrine is sound on paper but gets narrated past under real,
long-session pressure. Four scenarios follow, one per finding,
each walking a named operator through the failure as it happened — except the operator who
reads only the verdict, which is hypothesized, not observed (`.delivery/personas/the-trusting-delegator.md`).

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

## Non-functional requirements

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-1 | Self-correction check cadence (`FR-13`) | One check per governed-artifact-producing phase gate — reasoned from both real sessions, where a wall-clock target (days/hours) was already shown to be too loose | Replay both real sessions' tool-call histories against the rule; compare demanded checks to the observed 1 and ~0 |
| NFR-2 | False-positive rate for "not-invoked" on genuinely-invoked steps | Open question — no measurement exists yet | — |
| NFR-3 | Concurrency (multiple sessions in a shared repo) | Out of scope per non-goals (no team-based usage observed) | — |
| NFR-4 | Availability | Not applicable — this runs inside a single Claude Code session, not a hosted service | — |
| NFR-5 | Retention of invocation/check records | At least as long as the artifact they annotate exists in the repo — no independent expiry | A record for a deleted artifact may be pruned; one for an existing artifact may not |

## Assumptions

- That Claude Code's `Stop`/`SubagentStop`/`TaskCompleted` hooks (confirmed real in
  `research.md`) are the right foundation for `FR-1`–`FR-4` and `FR-13`–`FR-16` — an
  architecture decision, not confirmed as final here.
- That a minimal rubric beats none for `FR-11`'s fallback — not tested against blocking UI
  work entirely without one.
- That the operator who reads only the verdict is real enough to design for, despite no
  observed instance — a hypothesis worth building for, not a confirmed need.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | What's the actual mechanism for FR-1–FR-4 — a tool-call ledger, a frontmatter stamp, something built on the confirmed-real Claude Code hooks? | solution-architect | Architecture |
| 2 | Should a minimal fallback rubric exist for FR-11's no-rubric case, or should visual criteria simply stay unable-to-be-checked until one is authored? | product-owner | Scoping S-3's fallback behavior |
| 3 | FR-13/NFR-1 sets the cadence at one check per governed-artifact phase gate. Does reaching that gate mid-task interrupt in-progress work, or only gate the next completion report? | solution-architect | Scoping S-4 |
| 4 | Is the operator who reads only the verdict (S-4's actor) real enough to justify FR-13–FR-16's cost, given zero observed instances? | product-owner | Confidence in S-4's priority |
| 5 | Is any tool in this environment confirmed able to produce a real visual capture of a rendered terminal (for `FR-19`), or does TUI verification stay honestly "unable to be checked" until one is confirmed? | solution-architect | Architecture's Mechanism 3 extension; a spike, the same shape as the original Spike 4 |

## Out of scope

- Redesigning the phase sequence itself.
- A manual approval checkbox in place of real verification.
- The underlying reason narration substitutes for invocation (detection only, this round).
- A general-purpose scheduling primitive beyond what FR-13 needs.
- Team-based or multi-operator usage.
- The operator whose need is per-project artifact scoping — already served.

## Version 2

> Phase 5 artifact. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Started: 2026-08-07
> Brief: `.delivery/brief.md` (Version 2) · Glossary: `.delivery/glossary.md`

**Word count:** 1497 (target 1000, cap 1600, excludes tables — `grep -v '^|' | wc -w`, counted
for this section only, matching `brief.md`'s own per-version practice). Over target: 17
requirements resolve three roles' worth of conflicts (Status-field identity, grading,
document structure) that a shorter pass would leave unresolved — see Assumptions.

### Summary

A document-lifecycle version marker for this plugin's seven singular governed artifacts,
so a closed document can gain genuinely new scope without editing content already marked
closed or discarding what cites it. Three scenarios: reopening a closed version, extending
an open one, and telling versions apart without reading full prose.

### Goals and non-goals

**Goals**

- The operator who catches a document being fudged mid-closure gets a structural third path
  — start a new version — instead of revise-or-replace being the only choices.
- The operator returning after time away can tell, from a table alone, whether new scope
  belongs to the version they left open or a new one, without re-reading it.

**Non-goals**

- Backfilling all seven documents with a version marker now — added per-document only when
  that document starts its own second version, matching `brief.md`'s own precedent.
- Cross-document atomic version-bumping — no lockstep requirement across the seven documents;
  each advances independently.
- An auto-inferred version boundary with no human declaration — the operator's stated
  judgment always governs the same-problem test's output.
- Restructuring the seven documents into directories-of-units — real, not this MVP.
- Multi-operator concurrent edits and OS-level permission failures — generic git-merge and
  filesystem conditions, not specific to this feature.

### User scenarios

### S-6: A closed version reopens for genuinely new scope

**Actor:** the Spec-Literal Operator
**Trigger:** new scope is requested for a governed artifact whose current version's
Version-history Status cell already reads a closed value (`NFR-9`).
**Preconditions:** the artifact has, or gains on this pass (`FR-22`), a Version-history
table. Its Status column — not the document's separate header `Status:` line — is the only
field this test reads. A Status cell outside `NFR-9`'s vocabulary routes to `FR-27` instead.

**Main path**

1. Operator asks for new scope on a document whose current version's Status cell is closed.
2. Agent applies the same-problem test: does the new scope's problem, in one sentence, match
   the problem already stated in that version's own Problem section?
3. It doesn't: agent appends a new row (number, ISO date, "in progress," scope) and opens a
   new `## Version N` heading below all prior content, with the test's result and reasoning
   written under it (`FR-21`).
4. Nothing under a prior heading is edited — checked by diff (`FR-34`).
5. Report cites the new row as the record.

**Observable outcome:** from the table alone, the operator confirms a genuinely new version
opened and prior content is untouched.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Document has no Version-history table yet | Table is created now; all prior content is retroactively labelled "Version 1"; new heading begins the current version |
| New scope actually matches the closed version's own problem | Agent states the match and asks before proceeding — never silently complies |
| Two "start new version" requests land for the same document, same session or across sessions | The second re-reads the document and reports the version the first already opened — resolved by re-reading, never session memory; one row, not two |
| Closed version still has unresolved questions from its own scope | Does not block a new version — closure and unresolved items are independent facts |
| A closed version's row is later found to have an error (wrong date, wrong scope text) | Fixed only by an append-only correction note; the original row is never edited or deleted, and keeps its version number |

**Acceptance criteria**

- `FR-20` — A closed-version scope mismatch appends a new row and heading; prior content,
  including a closed row later found to be in error, is never edited in place (`NFR-6`).
- `FR-21` — The same-problem test's result and reasoning are written into the document under
  the new heading, not only stated in chat.
- `FR-22` — A tableless document, pre-existing or new, gets a Version-history table only when
  it starts its own second version; prior content is then retroactively labelled "Version 1."
- `FR-23` — Duplicate "start new version" requests, same session or across sessions, resolve
  to one row, by re-reading the document rather than session memory.
- `FR-32` — Each of the seven producing skills' gate-check names the same three literal
  choices — revise, replace, start new version; the three currently ungated skills
  (`prioritize`, `design`, `roadmap`) gain the gate on first re-entry.
- `FR-34` — A version-adding edit is verified by diff to add only lines after the last
  existing heading — the mechanism's core "never rewritten" promise (`FR-20`), made checkable.
- `FR-35` — Version numbers are strictly increasing, no gaps or duplicates; a correction never
  renumbers an existing version, only annotates it.
- `FR-36` — The Scope cell is never blank.

### S-7: Extending the current open version versus starting a new one

**Actor:** the Unwitnessed Operator
**Trigger:** new scope surfaces — via `/delivery:realign`, direct instruction, or a
`challenge` finding — for a document whose current version's Status cell reads "in
progress."
**Preconditions:** current version open, per `NFR-9`. A Status cell outside that vocabulary
routes to `FR-27`.

**Main path**

1. New scope surfaces for an open-version document.
2. Agent applies the same-problem test against that version's own Problem section.
3. Same problem: Revise — new ID added, Status cell updated in place as routine progress,
   distinct from a correction (`FR-25`); no new row.
4. Different problem: `FR-20`'s new-row/new-heading mechanics apply, regardless of whether
   the current version is open or closed. Whether starting version N+1 requires first
   closing the still-open version N is unresolved (Open Questions).
5. The test's result and reasoning are written next to the addition every time. If the
   operator doesn't react, the agent proceeds on the test's own output (`FR-26`).

**Observable outcome:** reading `prd.md`'s real `S-5` case reproduces "Revise, not new
version," with the reasoning visible in the document, not only inferable from prose.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| New scope is a close call — related area, materially different problem | Agent states the test's actual output, never defaults to "current version" because it's cheaper |
| Operator's declared judgment disagrees with the test's result, either direction | The operator's declaration is recorded as the outcome |
| Operator doesn't react to the stated test result at all | Agent proceeds on the test's own output by default; correction stays available later, append-only |
| Current version's Status cell is missing, or outside `NFR-9`'s vocabulary | Test reported unable-to-be-applied — never guesses "same version" |
| New scope is a mix — partly same problem, partly not | The two parts may split; one outcome does not have to travel with the other |

**Acceptance criteria**

- `FR-24` — Every addition to an open-version document states the same-problem test's result
  and reasoning, written next to the addition.
- `FR-25` — A same-problem addition is recorded as a Revision (new ID, in-place Status-cell
  update), no new row; the open version's own Status cell stays freely editable, distinct
  from an append-only correction (`NFR-6`) to a version's number, date, or scope.
- `FR-26` — The operator's declared judgment overrides the test result whenever stated; no
  reaction defaults to the test's own output, correction available later via `NFR-6`.
- `FR-27` — A Status cell missing or outside `NFR-9`'s vocabulary reports the test as
  unable-to-be-applied, never a default "same version."

### S-8: A reader tells versions apart without full-prose reading

**Actor:** the Trusting Delegator
**Grade:** `assumed` — the persona itself is `assumed`-grade, no observed instance, matching
`S-4`'s precedent for the same actor.
**Trigger:** reads `/delivery:status` output, or opens a governed artifact's header
directly, needing to know which version currently applies.
**Preconditions:** at least one artifact carries a Version-history table (`brief.md`, and
now `prd.md`, today).

**Main path**

1. Reader runs `/delivery:status` or opens the document directly.
2. `/delivery:status` reports each table-bearing artifact's version, Status-cell value, and
   scope, read structurally; a tableless document reads "Version 1 (implicit, no table)"
   (`FR-28`).
3. Staleness compares modification time against the current version's own start date, not
   the document's original creation date (`FR-29`).
4. `challenge` review filenames state which version they targeted; a review whose target no
   longer resolves is flagged like an existing dangling `superseded_by` link (`FR-30`).
5. Reader states the current version and scope from this structural read alone.

**Observable outcome:** reader correctly states the current version and its scope without
reading full document prose.

**Error and edge paths**

| Case | Expected behavior |
| :-- | :-- |
| Version-history row count doesn't match the count of `## Version N` headings in the body | Reported as an explicit structural inconsistency, the same way other `status.md` defects already are |
| Multiple artifacts sit on different versions at once | Reported as a normal, expected mixed state, never a failed operation |
| A `challenge` review predates the version concept | Reported unable to attribute to a specific version — never assumed current |
| Document read directly, no `/delivery:status` call | The same version boundary is visible from the header alone |
| A review's target document path no longer resolves (renamed/deleted) | Flagged the same way a dangling `superseded_by` reference is flagged today |

**Acceptance criteria**

- `FR-28` — `/delivery:status` reports current version, Status-cell value, and scope per
  artifact with a table, read structurally; a tableless artifact is reported as "Version 1
  (implicit, no table)," a distinct stated state.
- `FR-29` — Staleness compares against the current version's own start date, not the
  document's original creation date.
- `FR-30` — `challenge` reviews state which version of the target they reviewed; a target
  path that no longer resolves is flagged the same way a dangling `superseded_by` reference
  is flagged.
- `FR-31` — A governed artifact's header alone is sufficient to state its current version and
  scope, read from the table's Status column — independent of, and never required to match,
  the document's separate header `Status:` line.
- `FR-33` — A table's row count always equals the count of `## Version N` headings, in
  matching order; a mismatch is reported as an explicit inconsistency.

## Functional requirements (Version 2)

| ID | Requirement | Scenario | Priority | Grade |
| :-- | :-- | :-- | :-- | :-- |
| FR-20 | Closed-version scope mismatch opens a new Version row/heading; closed content, including a later-found error in it, is never edited in place | S-6 | must | reported |
| FR-21 | Same-problem test result + reasoning written into the document, not only chat | S-6 | must | reported |
| FR-22 | First-time version table creation retroactively labels all prior content; applies identically to pre-existing and newly created documents | S-6 | must | reported |
| FR-23 | Duplicate/concurrent new-version requests, same or across sessions, resolve to one row | S-6 | should | reported |
| FR-24 | Test result + reasoning written next to every in-open-version addition | S-7 | must | reported |
| FR-25 | Same-problem addition recorded as Revision, no new Version row; open version's Status cell stays freely editable | S-7 | must | reported |
| FR-26 | Operator's declared judgment overrides the test output; no-reaction defaults to the test's own output | S-7 | must | reported |
| FR-27 | Missing or unrecognized Status-cell value reports the test as unable-to-be-applied | S-7 | should | reported |
| FR-28 | `/delivery:status` reports version/status/scope per artifact from its table; tableless artifacts get a distinct stated state | S-8 | must | assumed |
| FR-29 | Staleness check keys off the current version's own start date | S-8 | must | assumed |
| FR-30 | `challenge` reviews state which version they targeted; a dangling target path is flagged | S-8 | must | assumed |
| FR-31 | Document header alone is sufficient to state current version and scope | S-8 | must | assumed |
| FR-32 | The seven producing skills' gate-check text offers revise/replace/start-new-version, identically worded | S-6 | must | reported |
| FR-33 | Version-history row count matches heading count, in order; mismatch is flagged | S-8 | must | assumed |
| FR-34 | A version-adding edit is verified, by diff, to add lines only — the mechanism's core "never rewritten" promise made checkable | S-6 | must | reported |
| FR-35 | Version numbers strictly increasing, no gaps or duplicates; a correction never renumbers | S-6 | should | reported |
| FR-36 | Scope cell is never blank | S-6 | should | reported |

## Non-functional requirements (Version 2)

| ID | Requirement | Target | How verified |
| :-- | :-- | :-- | :-- |
| NFR-6 | Version-history retention | A row is never deleted or edited once written; a correction adds a new row/note, the original stays visible | Inspect any correction event — the original row must still be present alongside it |
| NFR-7 | One-line Scope field length | ≤ 20 words / ≤ 140 characters per cell | Measure the Scope cell text on write |
| NFR-8 | Version count per document before reconsidering the MVP's lightweight approach | No hard limit; flag for reconsideration once any one document exceeds ~6 versions | Count rows in the table |
| NFR-9 | Status-cell vocabulary | Closed set: `in progress` \| `shipped` \| `shipped · debt open` \| `shipped · debt closed <ISO date>`; anything else triggers `FR-27`'s fallback | Compare the cell text against the set |
| NFR-10 | Date-cell format and semantics | ISO 8601 `YYYY-MM-DD`; records the version's opening date only — a closing date, if different, goes in the Status cell text | Parse the cell; matches `brief.md`'s existing real precedent |

### Assumptions

- That the Version-history table's Status column and the document's separate header
  `Status:` line remaining independent, unsynchronized fields causes no real confusion —
  untested against an actual drift case.
- That `NFR-8`'s ~6-version threshold is the right point to reconsider the lightweight
  table in favor of directories-of-units — reasoned from one document's two rows today, not
  measured at scale.
- That the seven producing skills' own gate-check prose (`FR-32`) is the right place to
  surface the third path, rather than a shared, referenced snippet — an implementation
  choice, not confirmed here.

### Terms proposed for glossary curation

Not yet written into `glossary.md` — routed to Business Analyst curation.

| Term | Definition | Referent |
| :-- | :-- | :-- |
| Version | A numbered, dated, retroactively-labelled chapter of a governed artifact's life, recorded in its own Version-history table | `brief.md`'s Version history table |
| Revise | Edit the current open version because new scope matches its own problem statement | `prd.md`'s `S-5` |
| Replace | Discard and rewrite a version's content — costly, breaks downstream citations | `glossary.md`'s citation risk |
| Start new version | Open a new version because new scope traces to a different problem statement | This section |
| Same-problem test | The one-sentence check distinguishing Revise from Start new version; the operator's declaration overrides its output | `S-6`/`S-7` |

### Open questions (Version 2)

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Can a document have more than one simultaneously "in progress" version, or must the current open version close before a new one starts? | solution-architect | `S-7`'s different-problem path when the current version is still open |
| 2 | Does a single skill's write to one document (row + heading) need file-write atomicity if interrupted mid-write, and how does `/delivery:status` technically aggregate each document's independent table into one summary view? | solution-architect | `FR-33`'s mismatch-detection mechanism; `FR-28`'s aggregation |
| 3 | What is the exact field/row syntax an append-only correction uses (a new row referencing the corrected one, or an inline note on the original)? | solution-architect | `NFR-6`'s implementation |

### Out of scope (Version 2)

- Restructuring the seven singular documents into directories-of-units.
- A heuristic that auto-infers "new version" versus "still this version" — the operator's
  declaration always governs.
- Multi-operator concurrent edits and OS-level permission failures.
- Naming a new persona for the operator's version-boundary objection.
