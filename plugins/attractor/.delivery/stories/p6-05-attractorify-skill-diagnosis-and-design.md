---
id: p6-05
title: attractorify skill — diagnosis gate, ask-before-designing, conversational design (ported near-verbatim, FR-14-constrained)
status: done
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-14, FR-15]
depends_on: [p6-02, p6-03, p6-04]
size: L
---

# attractorify skill — diagnosis gate, ask-before-designing, conversational design

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. Root `AGENTS.md`'s porting table: `skills/attractorify/SKILL.md`
— "**Port near-verbatim.** The three-question test, the evidence-quoting diagnosis
artifact, the fail-closed bash gate, the independent-verifier delegation and the
anti-self-dealing rule are engine-independent and excellent."

## Goal

`plugins/attractor/skills/attractorify/SKILL.md` — a Claude Code plugin skill,
Steps 1–3 of amplifier's own flow (diagnosis, ask-before-designing, conversational
design), ported near-verbatim per the porting table, adapted to Claude Code's plugin
skill frontmatter format (this project has no `delegate`/`allowed-tools:
[read_file, write_file, bash, delegate]` bundle-tool model — Claude Code's own tool
names apply: `Read`, `Write`, `Bash`, `Task`). **This story does not include Step 4's
new execution-verification gate** (that's p6-06, ADR-017) — it covers Steps 1–3 plus
Step 4's *existing, ported* diagnosis-verification gate only. p6-06 adds the second gate
on top of this story's Step 4 skeleton.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/skills/attractorify/SKILL.md` | new |

## Content requirements

Port near-verbatim from `microsoft/amplifier-bundle-attractor@main`'s
`skills/attractorify/SKILL.md` (fetch fresh):

- **Step 1 — Diagnose first, in writing.** The three-question test (cycle? evidence-gated
  exit? bad-day survival?), the `.attractorify/diagnosis.md` artifact shape, the
  quote-integrity rules (user-originated only, no self-dealt assent to a proposed menu),
  the deferral rule, the `counter:`/`budget:`/`override:` lines, the fail-closed bash
  gate (the `grep -Ec` verbatim check) — port the mechanism unchanged, since it is
  engine-independent (it's about the *user's* work, not the engine's runtime).
- **The executed gate and independent verification (diagnosis half only, this story).**
  Port the diagnosis-verifier delegation instruction verbatim (re-derive the
  three-question answers independently, apply the counter-test rules, judge quote
  integrity). Replace amplifier's `delegate` tool reference with Claude Code's `Task`
  tool (a fresh subagent with no conversation history — `general-purpose` or an
  unspecified default is fine, the point is isolation, not a specific agent type).
- **Step 2 — Ask before designing when context is thin.** The three-gap checklist
  (target / DoD / budget caps), the re-diagnosis-is-mechanical rule. Port unchanged —
  engine-independent.
- **Step 3 — Design conversationally.** Extract goal/DoD/budgets/gates from session
  context; **consult `attractor:attractor-expert` (p6-04) by delegation** at design
  start and final review; follow design order from `pipeline-design-principles.md`
  (p6-03) §0; fit the declared budget; **write the `.dot` and lint it**
  (`bash -c "node dist/attractor.js lint <path>"` — this project's actual CLI invocation,
  not amplifier's `attractor lint`); hand back the path, invocation, and a one-line
  rationale per structural choice.
- **Holding the line / pushback handling.** Port unchanged.
- **Reference surfaces section.** Repoint every link to this project's own files:
  `pipeline-design-principles.md`, `dot-reference.md`, `routing-reference.md` (p6-02/03),
  `attractor:attractor-expert` (p6-04), and the confirmed-portable examples
  ([ADR-019](../decisions/ADR-019-example-portability-policy.md)'s table — `00-convergence-loop.dot`
  as the canonical skeleton, `practical/bug-fix.dot` if p6-07 ships it, as the
  `existing-attractor` exemplar; **not** `task-runner.dot`, which is excluded).
- **`$ARGUMENTS` passthrough, "What this skill does NOT do."** Port unchanged.

**One substantive addition beyond a straight port, required by FR-14**: Step 3's design
guidance must state explicitly, inline (not only by reference to `dot-reference.md`),
that the graph may only use the six registered handlers, and that `attractor lint`
(`HAND-001`) is the enforcement backstop if this guidance is ever violated — belt and
suspenders, not reliance on the reference doc alone.

## Relevant design decisions

- **[ADR-017](../decisions/ADR-017-delegated-execution-verification.md)** — states this
  story covers the diagnosis-verification gate only; the execution-verification gate
  (p6-06) is a second, later gate in the same Step 4, added on top of what this story
  ships. Read this ADR before wiring Step 4 so the two gates aren't merged into one
  delegation by mistake (the ADR's own named risk).
- **[ADR-019](../decisions/ADR-019-example-portability-policy.md)** — which example
  filenames the "Reference surfaces" section may cite.

## Acceptance criteria

- [x] `SKILL.md` exists with valid Claude Code plugin skill frontmatter (`name`,
      `description` naming the trigger phrases, matching the pattern the existing
      `skills/attractor/SKILL.md` uses).
- [x] Steps 1–3, the diagnosis artifact shape, the fail-closed bash gate, and the
      diagnosis-verifier delegation instruction are present and match amplifier's own
      mechanism in substance (three questions, quote-integrity rules, counter-test
      rules, one-round cap) — a side-by-side read against the fetched upstream source
      confirms no accidental mechanism drift.
- [x] The bash gate's verbatim check block uses Claude Code tool names (`Task`, `Bash`,
      `Read`, `Write`), not amplifier's `delegate`/`allowed-tools` bundle-tool
      vocabulary.
- [x] `FR-14` — Step 3 states inline that only the six registered handlers may be used,
      and names `HAND-001`/`attractor lint` as the backstop.
- [x] `FR-15` — nowhere in the file does design guidance suggest a non-`goal_gate=true`
      node can carry a structured routing verdict.
- [x] Every reference-surface link resolves to a real path in this repo (p6-02/03/04's
      files; example-file links are forward references to p6-07, tracked as NOTEs by
      `check-consistency.mjs`, matching ADR-019's table).
- [x] The lint invocation shown (`node "${CLAUDE_PLUGIN_ROOT}/dist/attractor.js" lint
      <path>`) is this project's actual CLI syntax, matching
      `skills/attractor/SKILL.md`'s own documented invocation pattern exactly (not
      amplifier's `attractor lint` shorthand, which assumes a global binary this project
      doesn't install).

## Implementation notes

Restructured the verification story slightly from the ADR-017/story's original "Step 4"
framing once the actual amplifier source was ported: amplifier's own diagnosis-verifier
lives inside **Step 1** (before design starts), not a separate numbered step. The new
execution-verification gate (p6-06's job — this story only writes the insertion point
and the Step 3 numbering for it, item 6/7) is placed at the natural point instead: after
the `.dot` is drafted and lint-clean (item 6), before handback (now item 8, renumbered).
Both gates are explicitly cross-referenced to each other ("a different gate from the
execution-verification step later in this skill... Neither substitutes for the other")
so an implementer skimming the file can't conflate them — the exact risk ADR-017 names.

`check-consistency.mjs` needed one fix: its example-link exemption only matched
`../examples/...` (correct for files under `reference/`), but `SKILL.md` lives directly
in `skills/attractorify/` and links to examples as `examples/...` (no `../`) — extended
the exemption to match both forms rather than special-case this one file.

## Test approach

**Level:** doc-consistency, extending the same script p6-02/03/04 use. Additional
checks specific to this file: (1) no `allowed-tools:`/`delegate` frontmatter fields
(Claude Code's own frontmatter shape only), (2) the six-registered-handlers statement is
present verbatim-enough to grep for (e.g. contains both "six" and a list matching
`Handler.START|EXIT|CONDITIONAL|TOOL|CODERGEN|PARALLEL`), (3) no reference-surface link
points at an amplifier-only path or an ADR-019-excluded example filename.

There is no way to "run" a skill file directly the way engine code runs — this story's
verification is necessarily doc-consistency plus a manual side-by-side comparison
against the fetched amplifier source (record which upstream commit/date was fetched, in
the file's own header comment, so a future re-port has a diff base).

**Run with:** `node plugins/attractor/skills/attractorify/reference/check-consistency.mjs`
from the repo root.

## Out of scope

- Step 4's NEW execution-verification gate — p6-06 adds it on top of this story.
- The `attractor-expert` agent itself — p6-04 (dependency, not scope).
- Worked examples — p6-07.

## Dependencies

Depends on p6-02 (reference file links), p6-03 (reference file links, design-order
citation), and p6-04 (the `attractor-expert` delegation target must exist for the
"consult by delegation" instruction to resolve to something real).
