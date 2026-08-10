# Challenge findings: attractor-handoff/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic, persona-simulator (The Spec-Literal Operator) · Reviewed: 2026-08-10 · Artifact version: `201aa78`
> Version targeted: n/a — no Version-history table
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 3 (1 open, 2 fixed) | 4 (3 open, 1 fixed) | 5 (4 open, 1 fixed) | 0 |

**Update, 2026-08-10:** the product owner directly clarified the "reality check" precedent as a *workflow* — acceptance criteria compiled into a checkable validation, run as a gate, a failure looping back to a fix step, the gate re-running — and confirmed this as the MVP mechanism. That single clarification resolves R-brief-1 and, as a direct consequence, R-brief-5 and R-brief-8. R-brief-3 was fixed mechanically (coverage-table arithmetic and the three orphaned single-lens findings). R-brief-2 remains open, put to the product owner directly; awaiting their answer.

**Independent convergence:** R-brief-1 was found by all four reviewers independently — the strongest signal this panel produced. R-brief-2, R-brief-4 by three. R-brief-3 (product-owner half), R-brief-5, R-brief-6, R-brief-7 by two.

**Reviewer quality note:** all four were substantive; none returned only praise or style notes. feature-critic self-filtered two borderline items before reporting (noted, not re-added here) and explicitly named what it checked and found sound — a positive discipline signal, not a gap.

## Findings

### R-brief-1 — The amplifier precedent implies commitments the MVP boundary never adopts

**Status:** fixed
**Severity:** blocking
**Raised by:** product-owner, business-analyst, feature-critic, persona-simulator — independently: yes (all four)

**The claim or omission:** "What changes if we solve it" spends ~180 words establishing `amplifier-bundle-reality-check`'s discipline as precedent — specifically, execution isolated from the builder's own session, and mandatory evidence per verdict. Neither property appears in MVP boundary, Open Questions, or Out-of-scope.

**Concrete failure scenario:** A PRD or architecture reader anchors on the vivid, well-cited precedent paragraph and assumes isolation/evidence-capture are adopted requirements, inflating v1 scope past what MVP boundary actually committed to — or the opposite: the precedent is read as background color and the discipline's most load-bearing idea (evidence over bare pass/fail, the thing `harden`'s Finding C already flagged as this plugin's live weakness) quietly never makes it into scope.

**What would resolve it:** State explicitly, in MVP boundary or a dedicated line, whether isolation and mandatory evidence are Phase-1 commitments or deferred — don't leave the reader to infer scope from tone.

**Resolution:** Fixed. Product owner stated directly what to adopt: the loop shape (criteria → structured check → gate → fail routes to fix → re-check), not amplifier's session-isolation. `brief.md`'s MVP boundary now states this as the mechanism; the amplifier paragraph is scoped to say only the loop shape is adopted, isolation is left to architecture.

---

### R-brief-2 — MVP boundary assumes a consumer that Open Question 4 says may not exist

**Status:** open
**Severity:** blocking
**Raised by:** product-owner, business-analyst, feature-critic — independently: yes

**The claim or omission:** MVP boundary states the artifact is packaged "for attractor's own agents to consume" — present tense, treating them as an existing, addressable target. Open Question 4 asks whether "the attractor agents" that create pipelines already exist as an addressable component, or whether this feature must define that contract for something not yet built — and leaves it open.

**Concrete failure scenario:** PRD is written against MVP boundary's confident framing; architecture then discovers no addressable consumer exists, and defining one is barred by "Explicitly out of scope"'s "authoring or fixing anything inside the attractor plugin" — forcing a scope renegotiation after sign-off instead of before it.

**What would resolve it:** Answer Open Question 4 before MVP boundary's wording is treated as settled, or make MVP boundary's language conditional on the answer. OQ4's "Blocks" column should read "MVP boundary," not only "PRD scope boundary."

---

### R-brief-3 — Coverage table names findings never written up in the document, and its convergence count is wrong

**Status:** fixed
**Severity:** blocking
**Raised by:** business-analyst, product-owner (smaller-MVP-alternative half) — independently: yes

**The claim or omission:** Coverage table names 7 single-lens items (2 value + 3 precision + 2 absence) but the convergence line says "6 found by one lens only" — verified by direct count, off by one. More seriously: three of those named items — "a smaller-MVP alternative" (value), "multiple unstated senses of 'deterministic'" and "a 'feature' vocabulary collision" (both precision) — never appear anywhere else in the document. Neither do the specific findings behind "1 found by all three lenses" or "2 found by two."

**Concrete failure scenario:** This directly contradicts `delivery:brief`'s own rule ("never quietly drop a question because it is inconvenient") and its exit criterion that convergence be recorded per finding. A reader trusts the Coverage table as evidence of rigor while three real findings and all convergence detail are actually unrecoverable from the document.

**What would resolve it:** Either state each orphaned finding (even one sentence) or remove it from Coverage. Name which specific findings back the "1 of three" / "2 of two" tallies.

**Resolution:** Fixed. Recount corrected (1 found by all three · 0 by two · 7 by one — the prior "2 by two" was itself part of the arithmetic error). All three orphaned items now stated in a Coverage revision note: the smaller-MVP alternative is superseded (not dropped) by R-brief-1's resolution; the "deterministic" senses are disambiguated (see R-brief-8); the "feature" collision is flagged for Business Analyst curation rather than silently left.

---

### R-brief-4 — Success signal 2 has no instrumentation path and risks reproducing the failure it's meant to catch

**Status:** open
**Severity:** significant
**Raised by:** feature-critic, product-owner, persona-simulator — independently: yes

**The claim or omission:** "'Accepted with debt' verdicts traced to unverified self-report" (Current: "Not measured") requires `/delivery:sprint-review` to classify its own verdicts by self-report vs. traced evidence — a classifier that doesn't exist and isn't scoped as work anywhere in this brief or named as someone else's.

**Concrete failure scenario:** The signal is carried into the PRD as a stated metric; nobody scopes the classifier; at review time it's reported "still not measured" indefinitely regardless of whether the feature works. Worse, per persona-simulator: if a future document resolves this by having an agent self-report the classification, it reproduces the exact failure (`harden` Finding C) this feature exists to prevent.

**What would resolve it:** Either scope the sprint-review classification work explicitly (this initiative or a named other one) or replace the signal with something measurable from data already collected.

---

### R-brief-5 — The MVP's own gating rule would have caught almost none of the incidents cited to justify it

**Status:** fixed
**Severity:** significant
**Raised by:** product-owner, persona-simulator — independently: yes (different angles, same underlying number)

**The claim or omission:** Cost-of-status-quo cites `harden` Findings A/C/D for urgency. MVP boundary gates only stories whose Test approach already names a real command — on the brief's own number, ~1 of 21 (~5%). Open Question 1's likely fallback for the other ~95% is "a marked agent judgment," which is honesty about the mechanism, not the mechanism becoming deterministic.

**Concrete failure scenario:** On this plugin's own history, the shipped feature would gate almost none of the stories that produced Findings A/C/D — the urgency argument borrows gravity the scope doesn't back up, and if OQ1 resolves toward "marked judgment," real coverage for the common case is "same as today, plus a label."

**What would resolve it:** Either narrow the urgency claim to the ~5% case it actually addresses, or treat OQ1's resolution as itself the measure of whether this feature does anything beyond that slice.

**Resolution:** Fixed by R-brief-1's resolution. The gate no longer requires a pre-existing command — it's criteria-derived. Cost-of-status-quo and Success signal 1 now frame the 1-of-21 baseline as exactly the gap this workflow targets (the other 20), not a ceiling on what the feature can reach.

---

### R-brief-6 — Open Question 6 cites a gate-check precedent that does not exist

**Status:** open
**Severity:** significant
**Raised by:** business-analyst, feature-critic — independently: yes

**The claim or omission:** OQ6 asks what happens if attractor isn't installed, "same shape as the existing gate check for `superpowers`/`generic`." `skills/handoff/SKILL.md`'s only Gate check section verifies the sprint scope package's own readiness — it never checks whether either runner's tooling is installed.

**Concrete failure scenario:** Whoever answers OQ6 at architecture time looks for a pattern to extend and finds none, either inventing a new gate-check category while believing it's precedented (and getting the shape wrong) or skipping the check because "the existing pattern will just work."

**What would resolve it:** Rephrase OQ6 to state this is new gate-check design, not reuse of an existing pattern.

---

### R-brief-7 — "Who has it" is the one substantive claim in the document with no citation

**Status:** open
**Severity:** significant
**Raised by:** product-owner, persona-simulator — independently: yes (feature-critic explicitly checked this section and found no issue — a genuine split, noted rather than resolved by majority)

**The claim or omission:** "Same population as the existing two runner modes... not a new user segment" reads as confidently as the document's cited claims (harden Findings A/C/D, the 1-of-21 count, ADR-008) but traces to nothing — no usage data on who picks `superpowers` vs. `generic` today, no interview, no story reference.

**Concrete failure scenario:** PRD inherits this as settled and skips validating who actually chooses a runner mode; the eventual feature is scoped for an audience that turns out to differ from `superpowers`/`generic` users in some material way, discovered only after build.

**What would resolve it:** Add one concrete pointer (even a proxy, like counts of prior runner-mode choices if logged anywhere) or mark the claim explicitly as an assumption rather than a stated fact.

---

### R-brief-8 — "Deterministic" carries at least three non-equivalent senses, and Open Question 1 conflates two of them

**Status:** fixed
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** The document uses "deterministic" for attractor's routing determinism (Problem), for a real automated test command (Cost-of-status-quo, MVP boundary, OQ1), and for amplifier's narrower schema-plus-evidence determinism (precedent paragraph) — three different properties, none distinguished.

**Concrete failure scenario:** A PRD author can't tell whether attractor's baseline routing determinism already qualifies a story for "gating," or only the real-command sense counts.

**What would resolve it:** Pick one definition for "deterministic" wherever it gates something, and name the other senses explicitly where they appear.

**Resolution:** Fixed. Coverage revision note now distinguishes attractor's routing determinism (unconditional engine property, out of this brief's scope per its own out-of-scope line) from this feature's gate determinism (a criteria-derived check, looped) — MVP boundary and Open Question 1 use only the latter sense.

---

### R-brief-9 — "Gate" denotes two different concepts with no glossary distinction

**Status:** open
**Severity:** minor
**Raised by:** feature-critic

**The claim or omission:** `skills/handoff/SKILL.md`'s existing "Gate check" (pre-flight, sprint-package readiness) and this brief's "deterministic gate" (per-story, execution-time acceptance check) are different mechanisms sharing one word, and OQ6 uses the former sense while the rest of the brief uses the latter.

**Concrete failure scenario:** A reader assumes "the gate" always means the existing pre-flight check and under-scopes the new per-story mechanism, or conflates the two into one design.

**What would resolve it:** Propose two distinct glossary terms before this reaches PRD.

---

### R-brief-10 — Open Question 7 calls a proposed, unadopted ADR "existing doctrine"

**Status:** open
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** ADR-008's own Status field reads "proposed — spec complete, pending" the template/skill edits and glossary curation it specifies; OQ7 calls it "the existing... doctrine."

**Concrete failure scenario:** Whoever answers OQ7 treats ADR-008 as settled and doesn't notice this brief has an implicit, unstated dependency on ADR-008's own adoption completing first.

**What would resolve it:** State the dependency explicitly, or soften "existing" to "proposed."

---

### R-brief-11 — Open Question 3's quoted phrase has no citation in the document

**Status:** open
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** "Select or create the right pipeline machinery" (OQ3) is quoted with no source. It is in fact the product owner's own verbatim scenario language from this session's brief-elicitation kickoff — real, but untraced in the artifact itself, unlike every other quoted or cited claim in the document.

**Concrete failure scenario:** OQ3's answer also depends on which side of the scope boundary "which agent" means (a delivery-side authoring agent, in scope, vs. an attractor-side construction agent, out of scope) — a distinction the question doesn't make, risking a misrouted or out-of-scope answer.

**What would resolve it:** Cite the source and specify which "agent" the question means.

---

### R-brief-12 — "Unverified self-report" duplicates an existing governed term without using it

**Status:** open
**Severity:** minor
**Raised by:** business-analyst

**The claim or omission:** Success signal 2 measures "verdicts traced to unverified self-report." `.delivery/glossary.md` already defines **Traceable / Untraceable** for exactly this concept, curated by the same Business Analyst role that owns this brief.

**Concrete failure scenario:** PRD inherits an ungoverned synonym alongside the governed pair, and the glossary's own homonym-prevention purpose is defeated in the one document positioned to reuse it correctly.

**What would resolve it:** Reuse `Traceable/Untraceable` here, or propose a deliberately distinct term if the concepts genuinely differ.

## Assumptions worth watching

- The brief's self-audit (Coverage table, revision note admitting the earlier attractor-internals scope error) is honest about its own limits rather than papering over them — worth preserving as a habit in later phases, not just noting as a strength here.
- Every harden-epic citation (Findings A/C/D, the 1-of-21 story count, ADR-008's existence) was independently re-verified by two reviewers against the actual repo and held up — the document's citation discipline is real where it exists; R-brief-1/3/7 flag specifically where it stops.
