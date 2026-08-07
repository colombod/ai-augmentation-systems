# Challenge findings: CLI/TUI verification-channel generalization (`FR-17`–`FR-19`, Phase 5)

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: `product-owner`, `qa-strategist`, `solution-architect`, `delivery-lead`,
> `feature-critic` · Reviewed: 2026-08-06 · Branch: `delivery-channel-generalization-1`
> Target: `prd.md` (`S-5`), `architecture.md` (Mechanism 3 extension), `roadmap.md`
> (Phase 5), `prioritization.md` (MVP extension), `agents/qa-strategist.md`,
> `stories/harden-08/09/10`

> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 4 | 4 | 3 | 0 |

**Update, same day:** all 9 findings resolved — presented to the product owner (2 real
decisions: CLI ledger-cross-check approach, TUI scope), then implemented. See each
finding's own **Resolution** below. None rejected; none left open.

**Independent convergence:** R-1 (the FR-18 ledger gap) was raised, unprompted, by all
5 reviewers, each citing the actual code. R-9 (FR-17's undefined "other" surface) was
raised independently by 2. This is the strongest signal in this review.

**Reviewer quality note:** all 5 returned substantive, code-grounded findings — no
reviewer padded with praise or style notes alone.

## Findings

### R-phase5-1 — `FR-18`'s ledger cross-check cannot be built as specified

**Status:** fixed
**Severity:** blocking
**Raised by:** all 5 reviewers — independently: yes

**The claim or omission:** `harden-09`'s AC4 requires a claimed CLI invocation with no
matching ledger entry to be recorded not-met, "the same discipline `harden-07` already
applies to claimed screenshots."

**Concrete failure scenario:** `hooks/hooks.json`'s matcher is
`Skill|Agent|mcp__Claude_Browser__computer|mcp__Claude_Code_iOS_Simulator__control` — no
`Bash`. `record-invocation.js`'s `isGovernedToolCall()` only accepts those; a passing
unit test already asserts `isGovernedToolCall('Bash') === false` and that a Bash call
produces zero ledger entries. A real CLI invocation and a fabricated one are today
indistinguishable — both read "no matching entry," so every real CLI verdict fails the
check that's supposed to confirm it. Governing `Bash` isn't a free fix either: its
`tool_input` *is* the command string, colliding directly with the existing "never log
raw `tool_input`, it can carry secrets" constraint. No spike resolves this, unlike
`harden-03`'s equivalent work for capture tools before `harden-07` relied on it.

**What would resolve it:** either add a `harden-03`-equivalent spike that defines what's
safe to whitelist from a Bash call (resolving the secret-leakage tension), with `harden-09`
depending on it — or drop the ledger cross-check from `FR-18`/`harden-09` and scope it
honestly as "the reviewer personally re-runs the CLI," a smaller, different, ledger-free
claim.

**Resolution:** presented to the product owner as a real choice; picked "add a spike
first." `harden-11` (new story) attempted it for real — live payload confirmation blocked
by an expired subprocess auth session (real, not retried around); design analysis found no
safe closed-enum field exists. `harden-09` rescoped to two tiers: direct-observation
enforcement shipped for real (`qa-strategist.md`, `sprint-review/SKILL.md`); the ledger
cross-check stays explicitly open, named as debt in `roadmap.md`'s Phase 5 and risk table,
not silently dropped.

---

### R-phase5-2 — TUI capture tools confirmed in one session don't ship to other projects

**Status:** fixed
**Severity:** blocking
**Raised by:** `solution-architect`

**The claim or omission:** `harden-08` treats confirming VHS/`tui_mcp` in this session as
answering Spike 6.

**Concrete failure scenario:** this plugin's `.claude-plugin/plugin.json` has no
`.mcp.json`/`mcpServers` registration today. A tool confirmed working in the architect's
own session doesn't install itself for any other project that installs this plugin from
the marketplace — `harden-10`'s "capture confirmed" branch would ship a standing check
that silently fails or diverges for everyone else, with no signal this is a packaging gap
rather than a real defect.

**What would resolve it:** `harden-08` states explicitly whether this is per-project
opt-in (separate setup docs) or scoped only to projects that separately confirm the tool
— a product-owner/program-manager call, not something to leave implicit.

**Resolution:** presented to the product owner as this finding's real weight, alongside
R-3/R-5. Decision: hold `harden-08`/`harden-10` entirely rather than resolve the
ship-vs-install question for work with no confirmed downstream need yet. `harden-08`'s
Implementation notes and `architecture.md`'s new risk row both record this explicitly for
whenever the work resumes.

---

### R-phase5-3 — The named fallback capture tool cannot drive keystrokes at all

**Status:** fixed
**Severity:** blocking
**Raised by:** `solution-architect`

**The claim or omission:** `architecture.md` names `mcp__computer-use__screenshot` of a
terminal panel as a fallback capture channel if VHS/`tui_mcp` integration fails.

**Concrete failure scenario:** this very session's own tool instructions state Terminal
apps are granted at tier "click" for computer-use: typing and key presses are blocked,
by design. `harden-08`'s AC3 requires a capture reflecting a state reached by *simulated
typing*. The fallback can screenshot whatever's already on screen — it cannot reach a
new state through keystrokes. It cannot satisfy the acceptance criteria it's named as a
fallback for.

**What would resolve it:** `harden-10`'s two-way branch (capture confirmed /
not confirmed) becomes three: full driven capture, static-only fallback capture (with its
narrower guarantee spelled out), no capture at all.

**Resolution:** this finding was itself one of the three reasons given to the product owner
for holding TUI work (with R-2/R-5) — the fallback's real inability to drive keystrokes was
decisive, not incidental. `harden-08`'s AC3 (keystroke-driven capture) stays written as-is
for whenever this resumes; the three-way branch this finding recommends is deferred with it,
not built prematurely against work that isn't happening yet.

---

### R-phase5-4 — `harden-10`'s "capture confirmed" branch silently assumes an MCP-shaped tool

**Status:** fixed
**Severity:** blocking
**Raised by:** `delivery-lead`, `solution-architect` — independently: yes

**The claim or omission:** `harden-10`'s AC3 assumes the tool `harden-08` confirms maps
cleanly onto `harden-07`'s existing ledger-matcher pattern (a JSON-schema `action` enum
on an MCP tool).

**Concrete failure scenario:** that holds for `tui_mcp` (an MCP server). It does not hold
for VHS — a standalone binary invoked via `Bash` (`vhs demo.tape`), which inherits
R-phase5-1's exact discrimination problem. `harden-08`'s own acceptance criteria only
require confirming a candidate works end to end; nothing requires recording which shape
it has. `harden-08` can succeed (VHS confirmed) while leaving `harden-10` exactly as
unbuildable as `harden-09`.

**What would resolve it:** add an AC to `harden-08` requiring it to record whether the
confirmed candidate is MCP-shaped or CLI-binary-shaped, so `harden-10` inherits a real
answer, not an assumed one.

**Resolution:** moot for now — `harden-08`/`harden-10` are held, so this branch isn't being
built. Recorded in `architecture.md`'s new risk row so the AC fix this finding recommends
isn't forgotten if the work resumes; not applied to the story text itself while held, to
avoid speculatively hardening a plan that isn't being executed.

---

### R-phase5-5 — TUI work is sized against the wrong precedent and has no downstream consumer yet

**Status:** fixed
**Severity:** significant
**Raised by:** `product-owner`, `feature-critic`, `solution-architect` — independently: yes

**The claim or omission:** `harden-08` is sized S, 0.5–1 day, "same shape as Spike 4."

**Concrete failure scenario:** `harden-03` (the actual precedent) confirmed a tool
*already present* in the interactive host — no install step — and still took real,
multi-pass effort. `harden-08` requires installing and registering new third-party
software, driving a real PTY, and producing a genuine side-by-side comparison — a bigger
task than its own precedent. Separately: no story in this project or either studied
transcript ships a TUI a real acceptance criterion could ever check against — real
integration effort is being committed to a channel with, per the roadmap's own words,
"low (unconfirmed either way)" odds of ever mattering.

**What would resolve it:** re-size `harden-08` to M, or split "register + confirm one
candidate connects" from the fuller keystroke/capture/comparison work — a program-manager
sizing call informed by this comparison. Separately, a product-owner call on whether to
proceed with TUI work now versus holding it for a real downstream need.

**Resolution:** the product-owner call this finding asked for was made directly: hold.
Resizing `harden-08` is moot while held — its size only matters once it's picked up again,
at which point this finding's comparison to `harden-03` should be re-read before re-sizing.

---

### R-phase5-6 — Evidence grade isn't disclosed where the requirement is actually read

**Status:** fixed
**Severity:** significant
**Raised by:** `feature-critic`

**The claim or omission:** `FR-17`–`FR-19` are graded `reported`, not `observed`, correctly
in `prioritization.md` and the PRD's Goals-section amendment.

**Concrete failure scenario:** `prd.md`'s own Functional Requirements table — the table a
reader scans for scope — lists them as `must` with no grade column, identical in
appearance to `FR-9`–`FR-12`'s `observed`-grade `must` rows. `S-5`'s scenario body is
written in the same directly-observed voice as `S-3`. This is the same failure `FR-5`/`FR-6`
exist to catch in *other* documents: the marker isn't in the primary-scanned document.

**What would resolve it:** add a Grade column to the FR table (or an inline marker on
`FR-17`–`19`'s row), and one sentence inside `S-5`'s own Preconditions stating this
trigger hasn't been observed for this persona in either transcript.

**Resolution:** both done. `prd.md`'s Functional Requirements table now has a Grade column
for every FR, not just `FR-17`–`19` (consistency required grading the whole table, not just
the new rows). `S-5`'s Preconditions now states the `reported`-grade caveat directly, where
the requirement is actually read.

---

### R-phase5-7 — "MVP extension" reopens a stage already reported closed

**Status:** fixed
**Severity:** significant
**Raised by:** `feature-critic`

**The claim or omission:** `FR-17`–`19` are folded into the MVP via an "extension" section
rather than staged independently.

**Concrete failure scenario:** the sprint-review verdict already reported "MVP: Accepted
with debt, since closed" to the reader who reads only the verdict — exactly the persona
this epic protects. Three more `must` FRs then join that same "MVP" label after the fact,
unlike `FR-13`–`16` (Stage 2), which got real staging and explicit gating despite tracing
to a stronger evidence base (real brief findings, not one directive).

**What would resolve it:** give `FR-17`–`19` its own stage number, independent of the
closed MVP, with its own persona-journey justification.

**Resolution:** `prioritization.md`'s "MVP extension" section is now "Stage 1.5:
verification channel generalization" — its own number, its own persona-journey note, its
own status section, separate from the MVP's already-reported verdict.

---

### R-phase5-8 — `qa-strategist.md`'s enforcement prose wasn't actually generalized, and `harden-09`'s file pointer is wrong

**Status:** fixed
**Severity:** significant
**Raised by:** `qa-strategist`, `delivery-lead` — independently: yes

**The claim or omission:** `harden-09` states `qa-strategist.md` is "already modified this
wave" and points to `skills/status/SKILL.md` "or wherever the channel cross-check is
exercised" as the remaining file to change.

**Concrete failure scenario:** `qa-strategist.md`'s actual cross-check paragraph
("a stated screenshot with no matching capture-tool entry...") is still screenshot-specific
prose — only the channel *table* above it was generalized. `status/SKILL.md` has no
channel-cross-check logic at all; the real precedent (`harden-07`) wired into
`sprint-review/SKILL.md` plus `qa-strategist.md`, neither of which `harden-09`/`harden-10`
lists. An implementer following the story as written edits the wrong file.

**What would resolve it:** rewrite the cross-check paragraph itself for CLI/TUI, and
correct the file pointer to `sprint-review/SKILL.md`, matching `harden-07`'s precedent.

**Resolution:** both done. `qa-strategist.md`'s cross-check paragraph is now split
per-surface (GUI/CLI/TUI), each with its own real confirmation mechanism stated.
`sprint-review/SKILL.md`'s trigger wording now covers CLI real-output and TUI rendered-state
criteria, not just "rendered, visible behavior." `harden-09`'s Files-and-modules table
points at the two real files this rule actually lives in.

---

### R-phase5-9 — `FR-17`'s "or other" surface category is undefined

**Status:** fixed
**Severity:** significant
**Raised by:** `feature-critic`, `solution-architect` — independently: yes

**The claim or omission:** `FR-17` requires stating the surface "(GUI, CLI, TUI, or other)."

**Concrete failure scenario:** no channel, row, or fallback exists anywhere for "other."
A downstream project with an API-only or other surface gets no defined behavior —
reproducing the exact ad hoc-channel failure `S-5` exists to prevent, on the one branch it
names as in scope.

**What would resolve it:** drop "or other" until defined, or add a fourth row applying the
existing honest-fallback pattern ("no channel exists yet" → unable-to-be-checked) by
default.

**Resolution:** took the second option. `FR-17`'s wording, `S-5`'s edge-path table, and
`qa-strategist.md`'s channel table all now state that any surface outside GUI/CLI/TUI
defaults to unable-to-be-checked, matching `FR-11`'s existing honesty pattern rather than
leaving it undefined.

## Minor

- **No migration/rollback note, no Risks-register update** for the `FR-17`–`19` extension
  — `architecture.md`'s existing sections cover only the original ledger mechanism.
  **Fixed:** both sections now have a dedicated note/rows for this extension.
- **Bash-governance noise, if pursued for R-phase5-1's fix:** ungoverned, `Bash` runs
  hundreds of times per normal session; a blanket matcher widening would flood the
  git-tracked ledger. Needs its own filtering design, not a blanket fix. **Fixed:** named
  explicitly as its own risk row in `architecture.md`, and as the reason tier 2 wasn't built
  blanket — tier 1 (no ledger involvement) shipped instead.
- **Glossary gap:** "delivery surface"/"surface" (two forms, same new concept) were never
  added to `glossary.md`, unlike `Verification channel`, logged correctly the same session.
  **Fixed:** `Delivery surface` added, with a curation-log entry.

## Assumptions worth watching

- The already-shipped GUI mechanism's "cross-check" is itself enforced only by
  `qa-strategist.md`'s prose — no code parses a verdict and blocks a fabricated channel
  claim. Real and load-bearing, but worth naming in `architecture.md`'s "Honest limit"
  section rather than assumed solid because the GUI case has real ledger data behind it.
- Phase 4 (real external project usage) remains unstaffed and undated across multiple
  realigns. It would settle Phase 5's own evidence gap (reported → observed) more cheaply
  than the work planned here. Not resolved in this review — a real trade-off for the
  product owner and program manager to weigh explicitly, not implicitly.
