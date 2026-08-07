# Architecture: delivery plugin self-hardening (MVP)

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist.
> Status: Mechanisms 1–3 (GUI case) built and proven live · Mechanism 3's CLI/TUI
> extension (`FR-17`–`FR-19`) added 2026-08-06, planning only, not yet built
> PRD: `.delivery/prd.md` · ADR: `.delivery/decisions/ADR-001-hook-based-invocation-provenance.md`

## Version history

| Version | Date | Status | Scope |
| :-- | :-- | :-- | :-- |
| 1 | 2026-08-05 | shipped · debt open | Invocation ledger, evidence-only marker, verification-channel + rubric; CLI/TUI extension scoped, not built |
| 2 | 2026-08-07 | in progress | Document-lifecycle versioning mechanics for the plugin's own seven singular governed artifacts |

## Version 1

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

**Mechanism 3, extended scope (`FR-17`–`FR-19`, 2026-08-06) — not yet built, planning only.**
The rule above proved out for GUIs; the same principle now generalizes to any delivery
surface, per artifact type:

| Surface | Real channel required | Status |
| :-- | :-- | :-- |
| GUI / rendered webpage | A real screenshot from a browser/simulator tool, cross-checked against the ledger's capture-tool matcher | **Built, proven live** (Mechanism 3, above) |
| CLI | A real process invocation with observed `stdout`/`stderr`/exit code — an internal function call to the same logic, bypassing the actual command boundary, does not satisfy this | **Not yet built.** No new tool needed — this is a test-discipline rule (real invocation vs. internal call), not a new capture mechanism |
| TUI | A real visual capture of the rendered terminal (color, alignment, layout, animation) | **Not yet built — a real spike is needed first**, same shape as Spike 4 |

**A real, checked finding, not an assumption:** the one terminal-reading tool confirmed
available in this environment, `mcp__terminal__read_terminal`, returns terminal content
"with ANSI codes stripped" per its own description — a text-level read, exactly the DOM-vs-
screenshot trap `S-3` already exists to catch, just for a terminal instead of a webpage. It
does **not** satisfy `FR-19` alone.

**Update, 2026-08-06 — real candidates found, none yet confirmed integrated here.** A web
search (not memory — this space moves fast) turned up purpose-built tools that do exactly
what `FR-19` needs: drive a real terminal with real keystrokes and capture its real rendered
state, not a text dump.

| Candidate | What it actually does |
| :-- | :-- |
| [VHS](https://github.com/charmbracelet/vhs) (Charmbracelet) | Scripts a real terminal session from a `.tape` file (types commands, presses keys, waits) and captures real PNG screenshots or GIF/video of the actual rendered terminal — mature, widely used, not experimental |
| [tui_mcp](https://github.com/Fabian2000/tui_mcp) | An MCP server: drives a TUI through a real PTY + embedded `vt100` terminal emulator, full keyboard/mouse input, screen readout as text **or PNG** |
| `mcp-tui-test`, `tui-test-ghost`, `agent-tui`, `specter` | Same category — MCP-era tools explicitly built to let an agent drive and screenshot a TUI, "like Playwright for TUI applications" (one project's own description) |

None of these are confirmed installed or wired into this Claude Code session today — that
distinction still matters, and `mcp__computer-use__screenshot` of a visible terminal panel
remains a fallback candidate if none of the above get integrated. What changes is the shape
of Spike 6: it is no longer "does anything like this exist" (open, possibly negative) but
"integrate one of these named, real candidates and confirm it actually works end to end" —
a bounded, much more likely-to-succeed spike, the same way `harden-03` turned an unconfirmed
capability into a confirmed one for the browser tool. `harden-08`'s story is updated to
reflect this.

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
| 6 (added 2026-08-06, held) | Integrate and confirm one of the real named TUI-driving/capture candidates (VHS, `tui_mcp`, or similar — see Mechanism 3 extension above) end to end in this environment, or confirm none can be integrated and the fallback (`mcp__computer-use__screenshot` of a terminal panel) is what ships instead | 0.5–1 day, but `/delivery:challenge` found this likely underestimated against `harden-03`'s own harder-won precedent | `FR-19`'s Mechanism 3 extension; whether TUI verification can ever be more than "unable to be checked" — **not run**, held by product-owner decision (see `roadmap.md` Phase 5) |
| 7 (added 2026-08-06) | Can a real `Bash`-launched CLI invocation be safely and precisely tracked in the ledger without risking secret leakage? | S, real attempt made | `FR-18`'s durable ledger cross-check — **run, real partial result:** live confirmation blocked by an expired subprocess auth session (real environment constraint, not retried around); design analysis found no safe closed-enum field exists on `Bash` the way capture tools have `action` — the two honest options (hash-and-govern-everything, or presence-only) both cost either ledger noise or discrimination precision. See `harden-11`'s story for the full attempt. `FR-18` ships on direct in-turn observation instead (tier 1); the ledger cross-check (tier 2) stays open |

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

**The `FR-17`–`FR-19` extension (2026-08-06), named explicitly per `/delivery:challenge`'s
review:** no ledger schema changed and no new tool was integrated this pass, so there is
nothing new to migrate or roll back — `qa-strategist.md`'s prose changes take effect on
their next read, the same as any other rule update. If CLI tier 2 (the ledger cross-check)
is ever built, it will add a new field to the ledger's whitelist; that story must state its
own forward/back plan when it lands, not inherit this one silently. TUI stays held — no
tool integrated, nothing to roll back.

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
| CLI verification (tier 1) depends entirely on the reviewer personally being present to observe the invocation — a `/delivery:sprint-review` checking a claim from a session it wasn't part of has no independent way to confirm it, unlike GUI | Medium | Medium | Named explicitly in `qa-strategist.md`'s own prose ("cannot independently confirm, no cross-check available yet") rather than silently trusted | product-owner |
| A future fix for CLI tier 2 governs `Bash` calls broadly to solve the discrimination problem, without addressing the noise cost `harden-11` named (hundreds of routine calls per session flooding a git-tracked ledger) | Medium | Medium | Named here so it can't be built as a "quick fix" solving only half the problem `harden-11` actually found | solution-architect |
| A TUI capture tool, if `harden-08` is ever un-held, gets confirmed in one session but never gets a ship-vs-install answer for other projects installing this plugin (`R-phase5-2`) | Medium, if resumed | Medium | Named now, before it's forgotten by the time this is picked back up | solution-architect |

## Version 2

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist.
> Status: draft · Started: 2026-08-07
> PRD: `.delivery/prd.md` (Version 2) · ADRs:
> `.delivery/decisions/ADR-002-version-lifecycle-is-prose-not-code.md`,
> `.delivery/decisions/ADR-003-shared-version-history-reference-file.md`

**Word count:** 1468 (target 1000, cap 1600, excludes tables — `grep -v '^|' | wc -w`,
counted for this section only, matching `prd.md`'s and `brief.md`'s own per-version
practice). Over target: the design resolves three open questions the PRD routed here
(`OQ1`–`OQ3`) and one real defect found while grounding it — `prd.md`'s own
Version-history table already violates the vocabulary this design defines — both cheaper
to fix now than to leave for a later reader to rediscover.

### Approach

Seven Markdown skill files gain identical gate-check wording; one new shared reference
file holds the mechanics all seven, plus `status` and `challenge`, need to interpret
consistently; nothing else in the plugin's shape changes. Two decisions carry the design.
First: the mechanics live in one file, referenced by pointer, not duplicated seven times —
this plugin already solves "one rule, many skills" this way for `glossary.md` and
`writing-standard.md`, and reusing that seam is cheaper than inventing a new one
(`ADR-003`). Second: nothing here is code. Every check — the same-problem test, the
table/heading match, staleness-by-version-date — is a judgment an agent makes by reading
Markdown, the same 100%-prose pattern every `.delivery/` convention already uses except
Version 1's own unrelated invocation ledger (`ADR-002`).

### Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `skills/brief/SKILL.md:35-36` | Gate check: "ask whether to revise or start fresh" | modified — three-choice wording |
| `skills/research/SKILL.md:24` | Gate check: "ask whether to extend or replace" | modified — three-choice wording |
| `skills/prd/SKILL.md:26` | Gate check: "ask whether to revise or replace" | modified — three-choice wording |
| `skills/architecture/SKILL.md:27` | Gate check: "ask whether to revise or replace" | modified — three-choice wording (this file's own producing skill) |
| `skills/prioritize/SKILL.md:20-35` | Gate check has no re-entry check at all | modified — new gate paragraph added after line 35 |
| `skills/design/SKILL.md:20-26` | Gate check covers brief/personas/codebase design system only, no re-entry check for `.delivery/design-system.md` itself | modified — new gate paragraph added after line 26 |
| `skills/roadmap/SKILL.md:20-25` | Gate check covers PRD/architecture only, no re-entry check for `.delivery/roadmap.md` itself | modified — new gate paragraph added after line 25 |
| `skills/status/SKILL.md:41-113` (Assess) | Reports gate status, invocation status, findings, consistency; no version-boundary reporting | modified — new "Version boundaries" report + one `Consistency` bullet |
| `skills/challenge/SKILL.md:24-26` (Gate check), `:68-72` (Write) | Resolves target artifact; writes `.delivery/reviews/<artifact>-<nn>.md` | modified — records target version; filename gains a version segment for versioned targets |
| `templates/findings.md:9-15` (header) | `Artifact version: <git sha or date>` field only | modified — add a `Version targeted:` field alongside it |
| `templates/version-history.md` | does not exist | **new** — table schema, same-problem test, gate-check wording, Corrections log |
| `templates/{brief,research,prd,prioritization,design-system,architecture,roadmap}.md` | fill-in-the-blank templates, no Version-history placeholder | **untouched** — `FR-22` adds the table only at second-version time, never baked into a first-version template |
| `.delivery/glossary.md` | Curated terms; PRD Version 2 already proposed 5 (`Version`, `Revise`, `Replace`, `Start new version`, `Same-problem test`), pending Business Analyst curation | untouched here — one more term proposed below, added to that same pending set, not curated by this document |
| `.delivery/decisions/` | `ADR-001` only | modified — `ADR-002`, `ADR-003` added |
| `plugins/attractor/.delivery/*` | Independent artifact tree, consumes the same shared skill files | untouched now; covered automatically going forward — see Migration |

### Component structure

No new component in the software sense — this plugin ships zero runtime code for
`.delivery/` document conventions, unchanged from Version 1's own finding (the invocation
ledger is the one exception, and it solves an unrelated problem: detecting whether a tool
call happened, not comparing two pieces of prose). Three prose-guided procedures:

1. **Gate-check three-choice (`FR-32`).** Each of the seven producing skills' gate check,
   on finding its own artifact exists, states the three literal choices and points at the
   shared mechanics file. A text change to seven files, nothing else.
2. **Same-problem test (`FR-20`/`FR-21`/`FR-24`/`FR-26`).** A checklist in
   `templates/version-history.md`, invoked by reference. Not code: like `prioritize/SKILL.md`'s
   existing evidence-only-marker check, it is a judgment an agent makes by reading two
   pieces of prose and comparing them — no parser, because neither side is structured data.
3. **Structural read (`FR-28`/`FR-29`/`FR-30`/`FR-31`/`FR-33`).** `/delivery:status` reads
   each governed artifact's Version-history table (≤6 rows per `NFR-8`) and counts
   `## Version N` headings in the body — the same scale of read `status/SKILL.md` already
   does for `FR-n` cross-referencing and dangling `superseded_by` links.
   `challenge/SKILL.md` performs the equivalent single-document read before naming a
   review file.

No script, hook or MCP tool is proposed anywhere in this design, answering the question
the PRD itself asked (`architecture` OQ2b): this stays consistent with the zero-code
posture of every `.delivery/` mechanism except the unrelated Version 1 ledger.

### Interfaces and data contracts

**Version-history table** (unchanged from the real schema already in `brief.md` and
`prd.md`; now formalized):

```
| Version | Date | Status | Scope |
| :-- | :-- | :-- | :-- |
| 1 | YYYY-MM-DD | in progress \| shipped \| shipped · debt open \| shipped · debt closed YYYY-MM-DD | ≤20 words / ≤140 chars, never blank |
```

**Corrections log** (`NFR-6`, `FR-20`, resolving `OQ3`) — a second, append-only table
directly below Version-history, created on first use, modeled on `glossary.md`'s own
Curation log (`glossary.md:79-84`) rather than inventing a new pattern for the same shape
of problem:

```
### Corrections log

| Date noted | Corrects version | What was wrong | Correct value |
| :-- | :-- | :-- | :-- |
```

**Gate-check wording**, identical across all seven skills (`FR-32`):

```
If `.delivery/<doc>.md` already exists, read it and ask whether to **revise**,
**replace**, or **start new version**. See `${CLAUDE_PLUGIN_ROOT}/templates/version-history.md`
for what each means, the same-problem test that chooses between revise and start new
version, and the Version-history table and Corrections log it writes. Never silently
overwrite.
```

**Same-problem test's anchor, generalized across all seven templates** — only `brief.md`
and `prd.md` have a literal `## Problem`/`## Summary` section; the other five don't, so
the test needs a uniform fallback. The Scope cell (always present, one sentence, capped by
`NFR-7`) is that fallback for every document; where a richer section exists, it is the
primary source and the Scope cell is checked for consistency with it, not read alone:

| Document | Primary anchor | Universal anchor |
| :-- | :-- | :-- |
| `brief.md` | `## Problem` | Scope cell |
| `prd.md` | `## Summary` + `## Goals and non-goals` | Scope cell |
| `research.md` | `## Implications for the brief` | Scope cell |
| `prioritization.md` | `## Staging rule` | Scope cell |
| `design-system.md` | `## Intent` | Scope cell |
| `architecture.md` | `## Approach` | Scope cell |
| `roadmap.md` | `## Sequencing rationale` | Scope cell |

**`FR-34`'s diff check has two legitimate shapes, not one.** *Bootstrap* (`FR-22`, a
document's first table): inserts the Version-history table and a bare `## Version 1`
heading **before** the existing first section — 0 deletions, 0 modified lines, but not
literally "after the last heading," because prior content has no version label yet to
insert after (this document's own Version 1 section, above, is that bootstrap, performed
by this edit). *Steady-state* (every version after the first): the new `## Version N`
section appends strictly after the file's last existing heading, satisfying `FR-34`
literally. Both satisfy `FR-20`'s real promise — stated explicitly so a future reader
does not read `FR-34` narrowly and conclude the bootstrap case is disallowed.

**`/delivery:status`'s per-artifact report** (`FR-28`, resolving `OQ2b` — no cross-document
join, one row per artifact):

```
| Artifact | Current version | Status | Scope | Table/heading check |
| :-- | :-- | :-- | :-- | :-- |
| brief.md | 2 | in progress | Document-lifecycle versioning... | OK (2/2) |
| prd.md | 2 | draft *(non-conforming — see Migration)* | ... | OK (2/2) |
| architecture.md | 2 | in progress | Document-lifecycle versioning mechanics... | OK (2/2) |
| roadmap.md | 1 (implicit, no table) | — | — | n/a |
```

**`challenge` review target versioning (`FR-30`).** `templates/findings.md`'s header gains
a field alongside the existing `Artifact version` (a git sha/date stamp, a narrower,
already-compatible sense — not a collision): `Version targeted: <N> (<Status-cell value at
review time>) | n/a — no Version-history table`. Review filenames gain a version segment
for a target that carries a table at review time: `.delivery/reviews/<artifact>-v<N>-<nn>.md`
(e.g. `prd-v2-01.md`); unversioned targets (`stories/`, tableless documents) keep the
existing `<artifact>-<nn>.md` form. Pre-existing files (`brief-01.md`,
`phase-5-cli-tui-01.md`) are not renamed.

**Term proposed for glossary curation:** *Corrections log* — the append-only table
recording an error found in a closed version's row, added to Business Analyst's pending
queue alongside PRD Version 2's own five proposed terms.

### Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-6 | Version-history rows never edited/deleted; a correction adds a new row/note | The Corrections log above — a second table, modeled on `glossary.md:79-84`'s working precedent | high |
| NFR-7 | Scope cell ≤20 words / ≤140 chars | Stated as a hard rule in `templates/version-history.md`; a one-line length check any agent performs before writing the row | high |
| NFR-8 | Reconsider the lightweight table past ~6 versions | `/delivery:status`'s per-artifact report counts rows every run; 6+ triggers a flagged reconsideration, not a block | medium — unexercised until a real document reaches that count |
| NFR-9 | Closed Status-cell vocabulary | Enumerated once in the shared file; `FR-27`'s fallback fires outside it. `prd.md`'s own table already violates this — see Migration | high (mechanism) / open (existing data) |
| NFR-10 | ISO 8601 date, opening date only | Stated as a hard rule in the same file; matches `brief.md`'s real existing usage | high |

### Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-002 | Version-lifecycle mechanics (same-problem test, table/heading match, staleness date) are agent-judged prose, no code | A validation script (rejected: NFR-8's volume is trivially small; a second definition of "well-formed" to keep synced); a blocking hook (rejected: Claude Code hooks fire on tool calls, not reply content — no attachable event exists) |
| ADR-003 | Mechanics live once in `templates/version-history.md`, referenced by all seven skills | Duplicating full prose in each `SKILL.md` (rejected: reproduces the exact fragmentation the PRD's own Problem section documents for today's two-choice gates); a machine-readable config (rejected: nothing here is parsed by anything but an agent reading prose) |

**Resolving PRD Version 2's three open questions routed here:**

- *`OQ1`* — exactly one open version per document at a time. `NFR-9`'s vocabulary and the
  same-problem test's own wording ("the current version's own Problem section," singular)
  only make sense with one unambiguous open version. Starting version N+1 requires first
  closing version N — an in-place edit of the *not-yet-closed* row's own Status cell,
  already permitted freely by `FR-25`; the row freezes only once that edit lands.
- *`OQ2a`* (write atomicity) — no new mechanism needed. An interrupted edit leaves a
  visibly incomplete, git-tracked file that reverts cleanly, the same exposure every other
  `.delivery/` write already has; `FR-34`'s diff check is the correctness safeguard, not
  atomicity.
- *`OQ2b`* (status aggregation) — answered above: one row per artifact, no join.
- *`OQ3`* (correction syntax) — the Corrections log, above.

### Spikes — what must be proven before committing

None. Every mechanism here is a Markdown convention an agent reads and follows — the same
kind of thing `prioritize/SKILL.md`'s evidence-only marker and `status/SKILL.md`'s `FR-n`
cross-referencing already do today, with no spike behind either. The one real empirical
unknown — whether the same-problem test's generalization to the five non-Problem-section
templates (Interfaces, above) produces sane judgments — is small enough to settle with the
worked examples in Test strategy below, not a time-boxed spike: nothing here depends on an
external tool, an undocumented platform behavior, or a library, the three things Version
1's six real spikes existed to de-risk.

### Migration and rollback

**Forward:** additive only. The new shared file and the seven gate-check lines change no
existing persisted format — the Version-history schema is the first write of itself, not a
migration. Documents that never start a second version stay untouched indefinitely
(`FR-22`), matching the PRD's own non-goal against backfilling.

**`plugins/attractor/.delivery/` is out of scope to retrofit, and cannot be retrofitted
separately even if it were in scope.** The mechanism lives entirely in the shared skill
files and `templates/version-history.md`, both of which `plugins/attractor/.delivery/`
already consumes via the same plugin. The next time any of attractor's seven documents
starts a genuine second version, it gets the identical table with zero extra action —
there is no per-project copy of the mechanics to install separately. Attractor's existing
documents are not touched now, matching the same non-goal.

**A live non-conformance, found by this design, not fixed by it:** `prd.md`'s own
Version-history table (written this session) has Status-cell values outside `NFR-9`'s
vocabulary — row 1 ("`S-1`–`S-4` shipped and accepted; `S-5` added 2026-08-06, not yet
built") and row 2 ("draft," the document-header `Status:` vocabulary bleeding into the
table cell, the exact ambiguity `FR-31` exists to prevent). Row 2 is still open and freely
editable (`FR-25`) — fixable in place on `prd.md`'s own next pass. Row 1 closed the moment
row 2 opened (2026-08-07) and is now frozen; its fix is a Corrections log entry, not an
in-place edit, next time `prd.md`'s own producing skill runs. Not fixed here — `prd.md` is
not this file.

**Back:** delete `templates/version-history.md` and revert the seven gate-check lines to
their prior wording. Any Version-history tables already written are inert Markdown;
`status.md` degrades to its pre-existing file-exists/exit-criteria reporting — the same
graceful degradation Version 1's own rollback already established for the invocation
ledger.

### Test strategy

| Area | Risk | Test level | Notes |
| :-- | :-- | :-- | :-- |
| Well-formed table, real case | Low | Example-based, real fixture | `brief.md`'s and `prd.md`'s own existing tables are the golden fixtures — no invented data |
| `FR-33` table/heading mismatch | Medium | Example-based, synthetic fixture | Hand-build a doc with 2 table rows but 3 `## Version N` headings; confirm `/delivery:status` reports an explicit inconsistency |
| `FR-23` duplicate start-new-version request | Medium | Example-based, session replay | Ask twice in one reply, then once more in a fresh session against the same doc; confirm one row each time, by re-reading the file |
| `FR-28` tableless artifact | Low | Example-based | Point `/delivery:status` at a governed artifact with no table; confirm "Version 1 (implicit, no table)" |
| `FR-29` staleness by version start date | Low | Example-based | A doc with an old file mtime but a recent current-version Date cell, and the reverse; confirm the Date cell wins |
| Same-problem test on the 5 non-Problem-section templates | Medium | Example-based, one per template | One worked case per row of the anchor table above — the one genuinely new judgment this design asks an agent to make |
| Corrections log (`NFR-6`/`FR-20` error case) | Low | Example-based | Deliberately wrong closed-version row; confirm a Corrections log entry is added and the original row is byte-for-byte unchanged |
| `FR-34` diff-only-additions check | Medium | Manual verification step, every version-adding edit | `git diff <file>` after the edit; 0 deletions, additions positioned per the bootstrap/steady-state distinction above |

**Deliberately thin:** cross-session concurrent edits to the same table are untested,
matching the PRD's own out-of-scope; `NFR-8`'s ~6-version reconsideration trigger is
unexercised until a real document reaches that count.

### Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| An agent picks "replace" from two-choice habit instead of "start new version" for a closed document | Medium | High — defeats the mechanism silently | Identical three-choice wording across all seven skills (`ADR-003`); `/delivery:status`'s version report is the after-the-fact backstop, via a discontinuous table | product-owner |
| The same-problem test's generalization to non-Problem-section documents is this design's own extension, not confirmed by the PRD's own worked scenarios (`brief.md`/`prd.md` only) | Medium | Medium | Named here; Test strategy requires one worked example per document type before this is trusted | solution-architect |
| `prd.md`'s existing table already violates `NFR-9`, discovered here, not fixed by it | Low today | Low–medium — an odd first impression of a brand-new rule | Named in Migration; a Corrections log entry is the correct fix, not a silent edit | product-owner |
| `templates/version-history.md` itself drifts from the seven skills' actual behavior if a future skill edit skips updating it | Low | Medium | The shared-file decision (`ADR-003`) exists to prevent seven-way drift; this residual risk is the same class already accepted for `writing-standard.md` | solution-architect |
