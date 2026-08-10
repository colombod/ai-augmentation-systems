# Challenge findings: plugins/attractor/.delivery/initiatives/spec-conformance-mvp/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic · Reviewed: 2026-08-05 · Artifact version: `a9acf77`
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 4 fixed | 6 fixed | 5 fixed | 0 |

**Independent convergence:** R-brief-1 (all three reviewers), R-brief-2, R-brief-4, R-brief-5 (two reviewers each). These four are the strongest signal this review produced — nothing in the panel agreed on style; everything it agreed on was a factual grounding failure.

**Reviewer quality note:** all three did their job — every finding below carries a concrete failure scenario, none is style-only or praise-only.

All 15 findings resolved by direct edit to `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/brief.md`, applied without a separate user approval round given a standing directive to act autonomously on clear-cut factual/citation corrections. One fix (R-brief-3) surfaced a live, previously-unknown discrepancy — corrected in `spec-conformance.md`'s "Four amplifier example pipelines, actually executed" section with real execution evidence, not just a citation patch.

## Findings

### R-brief-1 — the "~60% pass" Definition-of-Done figure has no source anywhere in this repository

**Status:** fixed · **Severity:** blocking · **Raised by:** all three reviewers, independently

**The claim:** Success signals row 6 cites `spec-conformance.md` for "~60% pass" against §11's checklist.

**Concrete failure scenario:** `spec-conformance.md` never tallies §11 item by item and contains no percentage at all (grepped, zero hits for `60%`). A reader told to verify the one specific number in the table finds nothing.

**Resolution:** replaced with "not yet tallied — no item-by-item accounting exists anywhere in this repository," and named the false citation explicitly so it can't recur silently.

---

### R-brief-2 — MVP boundary silently omits load-bearing items and understates "human gate working" by an order of magnitude

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner, feature-critic, independently

**The claim:** MVP boundary named "human gate, parallel fan-out... working or loudly marked unsupported" as roughly the cost of "installable."

**Concrete failure scenario:** a team scoping from the MVP paragraph alone would size a full park/resume/notify subsystem as one handler registration.

**Resolution:** rewrote MVP boundary as a decided list, per item — installable, parallel fan-out, and the `outputs=` gap in scope outright; human-gate given two explicit interpretations with the estimation-error risk named directly; resume conditional on which interpretation is chosen, not silently absent; D7 and F10 added as cheap in-scope bug fixes.

---

### R-brief-3 — the amplifier example-pipeline results have no corroborating record, despite the brief claiming they were filed

**Status:** fixed · **Severity:** blocking · **Raised by:** business-analyst

**The claim:** the brief stated, with specific detail, that `08-human-gate.dot` and `pr-review.dot` "lint clean... hard-abort three nodes in," attributed to a filed record that didn't contain it.

**Concrete failure scenario:** none of the four pipeline names or results appeared anywhere in the repository outside `brief.md` itself.

**Resolution:** went further than re-citing — the source claim turned out to be a "mental" trace, not an execution (found while investigating this finding). Fetched all four example files verbatim and actually ran them. Result: `08` and `pr-review` matched the trace exactly; **`01-simple-linear` runs clean; `03-conditional-routing` does not** — it loops to the 500-step cap because its `gate` node depends on a real `pytest` fixture file not included in the fetch, and `--stub` codergen nodes don't perform real file writes to satisfy it. Not an engine defect — the run terminates `FAIL` honestly rather than falsely reporting success, which is the doctrine working as intended. The brief's "2 of 4 run clean" claim was itself wrong; corrected to "1 of 4," with the real table, in both `spec-conformance.md` and the brief.

---

### R-brief-4 — "D7, D3 verified a third time" misreports the source's own accounting

**Status:** fixed · **Severity:** blocking · **Raised by:** business-analyst, feature-critic, independently

**The claim:** "Two of the highest-severity new findings (D7, D3) were verified a third time... before being trusted."

**Concrete failure scenario:** the cited source says three unnamed findings were each verified twice — not two named findings verified three times.

**Resolution:** corrected to match the source exactly ("three of the highest-severity new findings were each independently reproduced twice... this brief does not claim to know which three"), and noted this finding itself as an instance of the pattern the brief is about.

---

### R-brief-5 — F10 is dropped from the cost table with no stated reason, despite matching severity and arguably showing a worse failure shape than what made the cut

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner, feature-critic, independently

**The claim:** the cost table imported D7 and D3 at "Important" severity but omitted their peer F10.

**Concrete failure scenario:** F10 (`Engine.run()` never checks lint) shows a worse failure shape — silent success on a lint-*dirty* graph — than the "lint-clean-then-loud-abort" pattern the Problem section otherwise treats as the worst case.

**Resolution:** added to the cost table with the CLI-vs-direct-embed framing; also added the related, previously-uncited §4.12 custom-handler-registry absence as its own row.

---

### R-brief-6 — the missing custom-handler registry (§4.12) is a fourth structural absence, understated as a coverage-table aside

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic

**The claim:** the Problem section named exactly three structural absences; §4.12 appeared only in the coverage table.

**Concrete failure scenario:** without §4.12, "marked unsupported" is a permanent wall for anyone outside this project, not a documented workaround — materially different from how the MVP boundary framed it.

**Resolution:** added as absence #4 in the Problem section, with the "permanent wall" framing stated directly.

---

### R-brief-7 — the brief's own highest-severity cost-table line has no corresponding success signal

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner

**The claim:** the `outputs=` opt-in gap, rated the table's strongest severity language, had no row in Success signals.

**Resolution:** added a signal: a graph with a failing, undeclared-`outputs=` producer and a consumer must not report overall success; current state (reports success) stated plainly as the target not yet met.

---

### R-brief-8 — "100–700 lines" compresses two separately-measured, differently-bounded ranges into one

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**Resolution:** split into "300–700 lines" (`engine.ts`) and "100–200+ lines, open-ended" (`lint.ts`) everywhere the figure appears.

---

### R-brief-9 — "checkpoint `current_node` null" narrowed to successful runs without support, relevant because resume is in MVP scope

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**Resolution:** re-scoped to "every terminal save, success or failure alike," matching the source; the FAIL case remains unverified and is now stated as such rather than implied fine.

---

### R-brief-10 — the success-signals table has no commit pin, ironic given the brief's own thesis is citation decay

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst

**Resolution:** stamped with `a9acf77` and an explicit re-verify-past-this-point note.

---

### R-brief-11 — "who has it" conflates two real users with different needs

**Status:** fixed · **Severity:** minor · **Raised by:** product-owner

**Resolution:** split into "the operator" and "the author," each with what they actually need, grounded in the brief's own evidence that some examples already run without authoring help. A fuller evidence-graded treatment is the next pipeline phase (`plugins/attractor/.delivery/personas/`), grounded directly in input from the project owner.

---

### R-brief-12 — "no example to copy" is overstated against the brief's own evidence

**Status:** fixed · **Severity:** minor · **Raised by:** product-owner

**Resolution:** narrowed to "no example committed in this repository, none surfaced inside the plugin," with the copy-and-adapt path named as existing in principle.

---

### R-brief-13 — the authoring-layer success signal has no verification procedure and is gameable

**Status:** fixed · **Severity:** minor · **Raised by:** product-owner

**Resolution:** restated to the same bar as every other row — runs to its intended terminal state by direct execution, not "buildable" or lint-clean.

---

### R-brief-14 — open question 5 misquotes `AGENTS.md`'s actual header

**Status:** fixed · **Severity:** minor · **Raised by:** business-analyst

**Resolution:** quoted verbatim ("Current and planned plugins"); question re-scoped to which of the two is which.

---

### R-brief-15 — the coverage table's honest incompleteness doesn't propagate as a caveat downstream

**Status:** fixed · **Severity:** minor · **Raised by:** feature-critic (self-labeled closer to preference than defect)

**Resolution:** added a provisional-scope caveat directly above the MVP boundary section, and a cross-reference from the coverage section.

## Assumptions worth watching

- That `main` at `a9acf77` (now superseded by whatever commit these fixes land at) stays the reference point until re-verified — any further commit reopens the staleness risk the whole document is about.
- That "installable" in MVP boundary means a working `.claude-plugin/plugin.json` and marketplace entry only, not also a documented, tested install *flow* — not tested by any reviewer here.
- That amplifier's `03-conditional-routing.dot`, once re-fetched with its real fixture files, actually passes — this pass established only that it cannot be fairly judged without them, not that it will succeed once they're present.
