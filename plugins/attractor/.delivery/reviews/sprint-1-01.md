<!--
BUDGET — target 120 words, hard cap 200 words. Excludes code, YAML and data tables.
Per finding; the summary table is data.
-->

# Sprint-review findings: sprint 1 (story p1-01, HITL-003)

> Independent acceptance review. Panel: delivery:qa-strategist, delivery:feature-critic ·
> Reviewed: 2026-08-07 · Branch: worktree-attractor-hitl-003-selfreport
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 0 | 0 | 2 | 0 |

**Independent convergence:** the qa-strategist and feature-critic each independently
flagged the vacuous-assertion pattern in the (now-fixed) B1 test — raised twice,
already resolved before this document was written; not carried below.

Four other findings from this review round (missing Handler.HUMAN regression test,
ADR-006's tracking overclaim, the stale `directPredecessor` contract note in `p1-01`,
the vacuous B1 assertion) were fixed immediately rather than carried — see commit
`f2303df`. Only the two genuinely-minor, low-value items below remain open.

## Findings

### R-sprint-1-01-1 — AC #3's message-content assertion doesn't independently pin the gate's own name

**Status:** open
**Severity:** minor
**Raised by:** delivery:qa-strategist

**The claim or omission:** `p1-01`'s acceptance criterion for fixture P1 requires the
`HITL-003` message to name "the gate, the predecessor, and `agent`." The shipped test
(`lint.test.ts`, P1) asserts `node === 'gate'` structurally and checks the message
against `/review/` and `/agent/`, but never independently asserts the gate's own id
appears in the message text.

**Concrete failure scenario:** a future edit to the message template that dropped the
`${node.id}` interpolation (while leaving the rest of the wording intact) would not be
caught by any current test, even though the acceptance criterion would then be false.

**What would resolve it:** add `assert.match(found[0].message, /gate/)` to the P1 test.

---

### R-sprint-1-01-2 — AC #7's literal "FR-12" string is absent from README.md

**Status:** rejected
**Severity:** minor
**Raised by:** delivery:qa-strategist

**The claim or omission:** the acceptance criterion says README should document "the
FR-12 gap." The embedded-`Engine`/`hasErrors()`-only visibility gap is fully described
in prose, but the literal string "FR-12" never appears.

**Resolution — rejected.** `README.md` never cites `FR-n` numbers anywhere, for any
lint rule, by established convention throughout the file — adding one here would be
inconsistent with the document's own style, not a fix. The substance the criterion
actually cares about (the gap is documented) is met.

## Assumptions worth watching

- **`directPredecessor`'s corrected semantics (dedupe-by-source, exclude self-edges)
  have no test that imports `graph.ts` directly** — coverage rides entirely on
  `HITL-003` fixtures in `lint.test.ts`. Matches this file's existing convention (no
  other `graph.ts` helper is tested directly either), but worth knowing if that
  convention ever changes.
