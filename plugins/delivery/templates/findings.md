<!--
BUDGET — target 120 words, hard cap 200 words. Excludes code, YAML and data tables.
Per finding; the summary table is data.
Obey ${CLAUDE_PLUGIN_ROOT}/templates/writing-standard.md. Cut restatement, narration
and hedging first; never cut findings, citations, grounding labels, open questions, or
IDs a later phase reads. Over the cap? Say so in the document, and why.
-->

# Challenge findings: <artifact>

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: <reviewers> · Reviewed: <date> · Artifact version: <git sha or date>
> Version targeted: <N> (<Status-cell value at review time>) | n/a — no Version-history table
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |

**Independent convergence:** findings raised by more than one reviewer who could not
see each other's output. This is the strongest signal available here.

**Reviewer quality note:** any reviewer that returned only praise or only style notes
did not do its job — record that rather than padding its output into the list.

## Findings

### R-<artifact>-1 — <short claim>

**Status:** open | fixed | rejected
**Severity:** blocking | significant | minor
**Raised by:** <reviewer(s)> — independently: yes / no

**The claim or omission:**

**Concrete failure scenario:** specific inputs or circumstances → what goes wrong.
A finding without one is a preference, not a finding.

**What would resolve it:**

**Resolution:** *(filled in when status changes)*
- If **fixed**: what changed, and where.
- If **rejected**: the stated reason. This is the valuable part — it is the
  assumption you will want to revisit when something goes wrong.

---

### R-<artifact>-2 — <short claim>

...

## Assumptions worth watching

Where the artifact is sound but rests on something unverified. Not findings — but
the things to check first if it later goes wrong.

- 
