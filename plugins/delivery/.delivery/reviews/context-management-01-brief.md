# Challenge findings: context-management/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic · Reviewed: 2026-08-27 · Artifact version: `7fa20ae` (brief as of OQ-resolution commit)
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 3 | 5 | 3 | 3 (self-filtered by feature-critic) |

**Independent convergence:** R-1 (staleness/glossary drift incl. the third-vs-fourth factual error) by all three. R-2 (version unit undefined) by all three. R-5 (liveness unshipped, F-10 unowned) by all three. R-4 (cross-plugin ledger writes) by two. Reviewers could not see each other's output.

**Reviewer quality note:** all three substantive; none returned praise-only. Feature-critic self-filtered 3 preference items and named what it verified as sound.

## Findings

### R-cm-1 — The brief is stale against same-day shipped reality and uses a glossary-banned alias

**Status:** fixed
**Severity:** blocking
**Raised by:** product-owner, business-analyst, feature-critic — independently: yes (all three)

**The claim or omission:** F-2 and four success-signal Current cells assert an undiagnosed blackout (gy5.1 closed it, root cause evidenced); MVP-2 says status gains the "third" state (the shipped state is the **fourth**); "observer silence" is used as the operative term though the glossary bans it as an alias of `Ambiguously observed`; F-1/problem statement cite `record-invocation.js` line behavior the committed fix removed; the glossary curation row omits this brief from documents-written-under-the-old-term.

**Concrete failure scenario:** the next phase specs against a three-state status and re-opens closed hypotheses; a banned alias propagates — F-12's pattern, in the initiative that named it, within a day.

**What would resolve it:** dated revision pass: mark resolved findings resolved, third→fourth, adopt `Ambiguously observed`, restate the problem in past tense where fixed, remeasure the word count, add the brief to the curation row.

**Resolution:** Fixed. Brief r2: resolved findings dated, third→fourth state, `Ambiguously observed` adopted, problem restated past-tense where shipped, version-history header added; glossary curation row now names the brief.

---

### R-cm-2 — "Per-artifact-version" has no defined version unit; ADR-005 is `proposed` and no artifact carries a marker

**Status:** fixed
**Severity:** blocking
**Raised by:** business-analyst, feature-critic, product-owner (S-2 adjacent) — independently: yes

**The claim or omission:** gy5.3 binds provenance to "an ADR-005 version marker or content hash," but ADR-005 was never accepted, zero artifacts (including this brief) carry markers, and neither hashing time, hashing owner, nor edit-after-invocation semantics are defined. Legacy-artifact rule absent.

**Concrete failure scenario:** the implementer silently defaults a version identity; exemption makes the false-positive signal read 0 vacuously; a wrong hash rule bakes an unratified identity into a git-tracked schema.

**What would resolve it:** decide, not default: legacy rule (content hash at ledger-write time), edit-after-invocation semantics deferred to gy5.3 design ADR, ADR-005 cited as *proposed* input not mechanism of record.

**Resolution:** Fixed. Brief r2 MVP-3: version unit = content hash at ledger-write time for marker-less artifacts; ADR-005 cited as `proposed` input only; edit-after-invocation is OQ-6, owned by solution-architect at gy5.3 design; recorded on the gy5.3 bead.

---

### R-cm-3 — bd is the primary memory surface and a single unsynced, unobserved point of silent loss

**Status:** fixed
**Severity:** blocking
**Raised by:** feature-critic — independently: n/a (single reviewer; evidence verified: zero dolt refs on origin, no jsonl export in tree)

**The claim or omission:** OQ-2 makes bd primary; the Dolt DB exists on one machine, `refs/dolt/data` never pushed, conservative profile forbids sync unless asked, ledger cannot see bd operations. gy5.5's close reason — the only record of what was deliberately skipped — has one copy.

**Concrete failure scenario:** disk loss or a fresh clone loses the epic, close reasons and `bd remember` knowledge, silently — F-1's failure mode reproduced in the surface chosen to prevent it.

**What would resolve it:** sync obligation at session close (`bd dolt push`), or an explicit ephemeral-by-design acceptance in the brief.

**Resolution:** Fixed. bd sync obligation adopted (brief r2, current-state workflow): `bd dolt push` at session close, failures reported never silent; first push executed this session.

---

### R-cm-4 — Ambiguous records write into attractor's git-tracked tree with no recorded consent; F-13 has no disposition

**Status:** fixed
**Severity:** significant
**Raised by:** business-analyst, feature-critic — independently: yes

**The claim or omission:** the gy5.2 fix appends delivery-session records into `plugins/attractor/.delivery/invocations/` — AGENTS.md doctrine says a plugin owns nothing outside its tree; the brief declares attractor out of scope; no ADR records the exception. `candidates` embeds machine-absolute paths; same session file now appended in two trees while F-13 (multi-clone merge semantics) sits undispositioned.

**Concrete failure scenario:** attractor sessions see phantom delivery ledger churn in their PRs; a cross-clone merge duplicates or orphans lines in a directory whose owner never adopted the mechanism.

**What would resolve it:** an ADR recording the cross-candidate-write decision and trade-offs; union merge driver for `invocations/*.ndjson`; F-13 named as a gy5.3 design constraint.

**Resolution:** Fixed. ADR-014 records the narrow cross-candidate-write exception and its bounds; `.gitattributes` ships `merge=union` for `invocations/*.ndjson`; F-13 named a gy5.3 design constraint; brief r2 out-of-scope line updated.

---

### R-cm-5 — gy5.2's "liveness" half is unshipped; dead-hook silence remains invisible and F-10 has no owner

**Status:** fixed
**Severity:** significant
**Raised by:** product-owner (as watch item), business-analyst, feature-critic — independently: yes

**The claim or omission:** the fix covers decline-mode silence only. A hook that never fires (unregistered, version-skewed, broken by a harness upgrade — F-10's "re-verify after any upgrade" is unowned) still produces byte-identical silence; "liveness" appears nowhere in the shipped code or skill.

**Concrete failure scenario:** a Claude Code upgrade breaks hook firing; every signal reads green; the blackout recurs with the closed bead now serving as evidence *against* the true hypothesis.

**What would resolve it:** a named bead shipping a liveness signal (status transcript-vs-ledger audit is the already-described form) owning F-10; gy5.2's close reason and the brief amended to say decline-class-only.

**Resolution:** Fixed. Liveness split to its own bead (MVP 2b) owning F-10; gy5.2's bead carries a scope-amendment comment; brief r2 states decline-class-only.

---

### R-cm-6 — The 100% recorded-calls signal is falsified by the known zero-candidate hole

**Status:** fixed
**Severity:** significant
**Raised by:** product-owner — independently: n/a

**The claim or omission:** the headline signal promises 100% unqualified while bead `vox` records that zero-candidate cwds (temp-dir orchestrated sessions) still no-op silently.

**Concrete failure scenario:** sprint-review certifies 100% falsely, or an orchestrated run reproduces the blackout from a temp dir after "silence was fixed."

**What would resolve it:** scope the signal honestly ("sessions with ≥1 reachable `.delivery/`") and reference the accepted residual.

**Resolution:** Fixed. Signal rescoped in brief r2: 100% for sessions with ≥1 reachable `.delivery/`; zero-candidate residual accepted and pointed at bead `vox`; dead-hook exclusion named until MVP 2b.

---

### R-cm-7 — One governed call now yields N ledger lines with no stated identity/dedup rule

**Status:** fixed
**Severity:** significant
**Raised by:** business-analyst — independently: n/a

**The claim or omission:** ambiguous records are duplicated per candidate; nothing names `tool_use_id` as the cross-ledger identity; a `delivery:prd` ambiguous line could upgrade both plugins' prd.md, and naive counting reads >100%.

**Concrete failure scenario:** double-crediting in two projects' status runs off one real call; the success-signal count has no defined denominator.

**What would resolve it:** name `tool_use_id` as call identity in brief + status skill; ambiguous lines upgrade only what gy5.3's binding ties them to.

**Resolution:** Fixed. `tool_use_id` named the cross-ledger call identity in brief r2 and `skills/status/SKILL.md`; single-upgrade rule recorded on gy5.3.

---

### R-cm-8 — "Untraceable" misused in Cost; the exonerated blackout artifacts' state is defined nowhere

**Status:** fixed
**Severity:** significant
**Raised by:** business-analyst — independently: n/a

**The claim or omission:** the Cost section says attractor-handoff "reports Untraceable" — by status's own vocabulary the state is **Not-invoked** (ledger dir exists), and the glossary's *Untraceable* is a third meaning. gy5.1 proved those artifacts Invoked-but-unledgered; no mechanism or decision covers post-hoc exoneration, so status keeps implying narration.

**Concrete failure scenario:** the initiative's flagship incident stays misreported by the mechanism the initiative fixed; the homonym propagates.

**What would resolve it:** correct the term; record the exoneration decision (backfill or status wording) as a gy5.3 design input.

**Resolution:** Fixed. Cost section says Not-invoked and records the gy5.1 exoneration; backfill/exoneration mechanism is a named gy5.3 design input.

---

### R-cm-9 — Spike-mode execution is real but unrecorded; gy5.3 defers to a phase nothing plans to run

**Status:** fixed
**Severity:** significant
**Raised by:** feature-critic — independently: n/a

**The claim or omission:** three of five MVP items shipped before any challenge gate ran; that may be legitimate park-over-polish, but the decision is unstated, and gy5.3's description says "design in architecture phase" — a phase not planned.

**Concrete failure scenario:** gy5.3's implementer blocks on a phantom phase or invents the design against a one-line bead with nothing for sprint-review to certify.

**What would resolve it:** record the mode in the brief: spike-mode initiative; design decisions land as ADRs; this review file is the challenge gate of record.

**Resolution:** Fixed. Brief r2 records spike-mode execution: design decisions land as ADRs; this review file is the challenge gate of record; gy5.3's phantom architecture-phase reference corrected on the bead.

---

### R-cm-10 — The baseline straddles two instruction eras untagged

**Status:** fixed
**Severity:** minor
**Raised by:** product-owner — independently: n/a

**The claim or omission:** gy5.5 rewrote all instructions before gy5.4 measured; historical transcripts ran under ≤0.13.0, forward ones under 0.14.0; baseline.md doesn't say so.

**Concrete failure scenario:** a later token-cost delta is attributed to gy5.5 (or not) with no way to separate eras.

**What would resolve it:** tag measured transcripts with the plugin version era in baseline.md.

**Resolution:** Fixed. baseline.md carries the instruction-era tag (all measured transcripts ran under ≤0.13.0, pre-gy5.5).

---

### R-cm-11 — Vocabulary and bookkeeping drift: unproposed glossary terms, dispositionless findings, stale numbers

**Status:** fixed
**Severity:** minor
**Raised by:** business-analyst, feature-critic, product-owner — independently: yes (different fragments)

**The claim or omission:** *Memory surface*, *Compaction* and the *Session* revisit are used but not in the glossary; F-11/F-15 (and F-13, covered by R-cm-4) have no disposition; OQ-2's resolution reads as mechanism though it is a convention; "gap-to-detection" conflates recording with detection; 82→86 files; declared word count 730 vs measured 748; dropped-skill detection (25k budget) has no owner.

**Concrete failure scenario:** each is small; together they are the drift habit the plugin exists to prevent, in its own record.

**What would resolve it:** glossary entries; disposition lines for F-11/F-15; convention wording for OQ-2; "detectable same-session via status"; refresh numbers; a bead or out-of-scope line for dropped-skill detection.

**Resolution:** Fixed. Glossary: `Memory surface` + `Compaction` added, Session revisit deferred with F-11 in the curation log; F-11/F-15 dispositions in brief r2; OQ-2 restated as convention; detection wording corrected; counts refreshed; dropped-skill detection given an out-of-scope line with its reopen condition.

## Assumptions worth watching

- Hook payload field shape holds across Claude Code upgrades (F-10 — becomes owned under R-cm-5's resolution).
- Compaction census sees only marker-emitting compaction; a harness that summarizes without markers is invisible (baseline.md caveat).
- Panel isolation remains a non-knob for any future context-sharing optimisation.
