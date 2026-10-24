# Challenge findings: feature-map/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic, persona-simulator (skeptic, P-2, synthetic) · Reviewed: 2026-10-24 · Artifact version: 8f1ba3c-era draft (first commit on `delivery-feature-map`)
> Version targeted: n/a — no Version-history table
>
> A finding leaves this list by being **fixed** or **rejected with a stated reason**.
> Never by being ignored. `/delivery:status` reports anything still `open`.

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 4 | 7 | 5 | 0 |

**Independent convergence:** feature key undefined against the existing `area` (product-owner,
business-analyst, feature-critic); headline break not catchable by the MVP (feature-critic,
skeptic); rotted baseline and seeding (product-owner, business-analyst, feature-critic, skeptic);
no gate acts on `impact` (product-owner, feature-critic, skeptic).

**Reviewer quality note:** all four returned concrete scenarios; none padded. Two reviewers
could not reach `6883fee`/`604d508` (shallow clone); the clone has since been unshallowed and
both resolve (287 commits).

## Findings

### R-brief-1 — "Feature" is undefined and collides with `area`

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner, business-analyst, feature-critic — independently: yes

**Claim:** MVP item 1 fixes the key `<initiative>/<feature-id>` while open question 1 asks what a feature is; `area` already drives waves, the unverified cap, andon stops and `goal.js ask area_add` (`scripts/lib/gates.js:219`, `docs/reference.md:448`).
**Failure:** "the invocation ledger" spans harden and chief-of-staff; an initiative-scoped key splits it and undercounts the cross-boundary case behind F3.
**Resolve:** define feature against area in the glossary, project-wide key, put the choice to the owner with this example.

### R-brief-2 — The headline break is runtime reach the MVP cannot see

**Status:** fixed · **Severity:** blocking · **Raised by:** feature-critic, skeptic — independently: yes

**Claim:** `604d508` puts the cause in the filesystem: a second `.delivery/` made `record-invocation.js`'s downward search ambiguous. No declared, merged or call-graph edge links them.
**Failure:** file-level `impact` shows a clean radius for `6883fee`: false confidence on the brief's own example.
**Resolve:** replay `6883fee` and `29b0129` against the proposed map before the PRD; add a runtime-reach relation (code that discovers paths by pattern) or drop it as evidence.

### R-brief-3 — Signals measure after the break, not before the code

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner; business-analyst (unfalsifiable signals) — independently: yes

**Claim:** "caught at plan or merge gate" and same-day latency both fire after code exists; "first one done" and "reported on every merge" are outputs, not outcomes.
**Failure:** every signal turns green while nobody saw reach before writing code.
**Resolve:** a before-code signal (impact recorded at story approval; predicted reach vs merged files), numbers and windows.

### R-brief-4 — "When to delete" is neither delivered nor measured

**Status:** fixed · **Severity:** blocking · **Raised by:** product-owner — independently: n/a (single)

**Claim:** MVP item 4 covers how to retire; the "when" lives only in `notes.md`.
**Failure:** the owner retires one feature by hand, the target is met, and nothing ever surfaces a candidate.
**Resolve:** candidate surfacing with evidence in scope, or a recorded deferral.

### R-brief-5 — Baselines are contaminated

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner, business-analyst, feature-critic, skeptic — independently: yes

**Claim:** of 22 unresolved paths, about 3 are prose rows and about 11 planned creates; real rot is about 8. F8's 68 counts lines; occurrences are 100. 13 days depends on the start date (08-10 or 08-14).
**Resolve:** split the counts; seed the map from merged history, use story tables as declared intent only.

### R-brief-6 — No gate acts on `impact`

**Status:** fixed · **Severity:** significant · **Raised by:** product-owner, feature-critic, skeptic — independently: yes

**Failure:** a report nobody reads; hub files in every radius make it ignored after three reads.
**Resolve:** name the gate and what it warns or refuses; put the hub (fan-in) rule in the MVP.

### R-brief-7 — Exclusive anchors are unsafe

**Status:** fixed · **Severity:** significant · **Raised by:** business-analyst, skeptic — independently: yes

**Failure:** a file the retired feature changes and a kept feature reads, or an unregistered feature uses, is listed as deletable.
**Resolve:** exclusive per relation type, and only after a negative reference check at HEAD stating the commit.

### R-brief-8 — Retire is not routed to the owner by the cited mechanism

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic

**Claim:** `DEFAULT_HIGH_STAKES` matches decision-record scope, not story labels (`scripts/lib/operator-records.js:535-540`); custom `high_stakes_labels` replace the default (`:181`).
**Resolve:** a retire must cite an operator record scoped irreversible, enforced by script.

### R-brief-9 — The register has no owner or write path

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic
**Resolve:** one owning script and role; lanes refuse hand edits, as for assumptions.

### R-brief-10 — The steelman is not answered

**Status:** fixed · **Severity:** significant · **Raised by:** feature-critic
**Claim:** F2 is a `norm` fix in `waves.js:72`; F4 is about 10 lines in `reviews.js`.
**Resolve:** a smallest-fix column; justify the map only by what those leave open.

### R-brief-11 — Retire evidence depends on the ledger that broke

**Status:** fixed · **Severity:** significant · **Raised by:** skeptic (synthetic)
**Resolve:** a candidate carries its log query, window and proof the ledger was live.

### R-brief-12 — Minor precision

**Status:** fixed · **Severity:** minor · **Raised by:** business-analyst, product-owner, feature-critic
F9 hub claim has no data (gates.js is in 0 story tables); F10 cites the wrong line (`docs/reference.md:697` is A3/andon); "PM"/"DM" ambiguous with Program Manager; open question 3 is in engineering terms; the checklist must stay in the project repo (leak guard); `area` may live on beads, not frontmatter.

## Resolution (2026-10-24, brief revision 2)

| Finding | How it was fixed | Where |
| :-- | :-- | :-- |
| R-brief-1 | feature defined as a named capability inside one `area`, project-wide id; put to the owner as open question 1 with that default | brief MVP 2, OQ 1 |
| R-brief-2 | replayed: with a runtime-reach relation `6883fee` is caught (2 features, both the ledger hooks); without it, 0; over 255 commits the rule fires once | `research.md` spike results; `spikes/` |
| R-brief-3 | signals rewritten: reach recorded at the ready gate, prediction vs merged files, replayed breaks, noise, shipped truth | brief Success signals |
| R-brief-4 | retirement candidates per realign with usage evidence, or "instrument first" | brief signals, MVP 5, OQ 5 |
| R-brief-5 | baseline split (prose ~3, planned ~11, rot ~8); 100 occurrences on 68 lines; 13 to 17 days with dates; seeding from the graph and history | brief F3, F5, F8 |
| R-brief-6 | ready-gate warning named; hubs reported separately, measured (20 files reach 20+ entry points) | brief MVP 3-4, F9 |
| R-brief-7 | exclusive anchors only after a reference check at HEAD | brief MVP 5 |
| R-brief-8 | retire cites an operator record scoped irreversible | brief MVP 5 |
| R-brief-9 | register written by one script | brief MVP 2 |
| R-brief-10 | smallest-fix column; F2 and F4 named as worth shipping alone | brief Problem |
| R-brief-11 | candidates carry evidence and window; no evidence means instrument first | brief signals, OQ 5 |
| R-brief-12 | F9 grounded in the spike; F10 restated as an absence; full role names; questions in the owner's words; map stays in the project repo (research codebase table). Not checked: `area` on bead metadata (`bd` is not installed in this session) | brief, `research.md` |
