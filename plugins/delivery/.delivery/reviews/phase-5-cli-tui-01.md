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

**Independent convergence:** R-1 (the FR-18 ledger gap) was raised, unprompted, by all
5 reviewers, each citing the actual code. R-9 (FR-17's undefined "other" surface) was
raised independently by 2. This is the strongest signal in this review.

**Reviewer quality note:** all 5 returned substantive, code-grounded findings — no
reviewer padded with praise or style notes alone.

## Findings

### R-phase5-1 — `FR-18`'s ledger cross-check cannot be built as specified

**Status:** open
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

---

### R-phase5-2 — TUI capture tools confirmed in one session don't ship to other projects

**Status:** open
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

---

### R-phase5-3 — The named fallback capture tool cannot drive keystrokes at all

**Status:** open
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

---

### R-phase5-4 — `harden-10`'s "capture confirmed" branch silently assumes an MCP-shaped tool

**Status:** open
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

---

### R-phase5-5 — TUI work is sized against the wrong precedent and has no downstream consumer yet

**Status:** open
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

---

### R-phase5-6 — Evidence grade isn't disclosed where the requirement is actually read

**Status:** open
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

---

### R-phase5-7 — "MVP extension" reopens a stage already reported closed

**Status:** open
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

---

### R-phase5-8 — `qa-strategist.md`'s enforcement prose wasn't actually generalized, and `harden-09`'s file pointer is wrong

**Status:** open
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

---

### R-phase5-9 — `FR-17`'s "or other" surface category is undefined

**Status:** open
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

## Minor

- **No migration/rollback note, no Risks-register update** for the `FR-17`–`19` extension
  — `architecture.md`'s existing sections cover only the original ledger mechanism.
- **Bash-governance noise, if pursued for R-phase5-1's fix:** ungoverned, `Bash` runs
  hundreds of times per normal session; a blanket matcher widening would flood the
  git-tracked ledger. Needs its own filtering design, not a blanket fix.
- **Glossary gap:** "delivery surface"/"surface" (two forms, same new concept) were never
  added to `glossary.md`, unlike `Verification channel`, logged correctly the same session.

## Assumptions worth watching

- The already-shipped GUI mechanism's "cross-check" is itself enforced only by
  `qa-strategist.md`'s prose — no code parses a verdict and blocks a fabricated channel
  claim. Real and load-bearing, but worth naming in `architecture.md`'s "Honest limit"
  section rather than assumed solid because the GUI case has real ledger data behind it.
- Phase 4 (real external project usage) remains unstaffed and undated across multiple
  realigns. It would settle Phase 5's own evidence gap (reported → observed) more cheaply
  than the work planned here. Not resolved in this review — a real trade-off for the
  product owner and program manager to weigh explicitly, not implicitly.
