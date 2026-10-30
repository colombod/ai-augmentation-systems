# Challenge findings: brownfield-onboarding/brief.md

> Adversarial review. Read-only — findings are recorded here, not applied.
> Panel: product-owner, business-analyst, feature-critic, persona-simulator (skeptic, P-3 The Monorepo Maintainer, reported, synthetic) · Reviewed: 2026-10-24 · Artifact version: `228347d`
> Version targeted: n/a — no Version-history table

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 7 | 9 | 4 | 0 |

**Independent convergence:** the beads "adoption" is really pointing at a remote endpoint (product-owner, feature-critic); the MVP is larger than the ask and should release the inventory and verdict first (product-owner, feature-critic); the umbrella rule's inputs are not observable before onboarding and its worked examples contradict it (business-analyst, feature-critic, skeptic); the signals measure hygiene or the calendar, not delivery (product-owner, business-analyst, skeptic).

## Findings

| ID | Severity | Raised by | Claim and failure | Resolution | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| R-bf-1 | blocking | product-owner | B4 blames process; ai-augmentation-systems is silent on the same days (10-14..17, 10-20..23): the owner's time, not the Vault's process, may explain it | B4 restated "slowed; cause unknown", both repos' days shown | fixed |
| R-bf-2 | blocking | business-analyst | umbrella rule contradicts its own example (`marketplace.json` partially satisfies (d)); (a) cannot be observed before onboarding | registry manifests excluded from (d); every criterion given a pre-onboarding proxy; "unknown" when no evidence | fixed |
| R-bf-3 | blocking | feature-critic | the Vault's beads are reached through a wrapper on the owner's server (the-vault `AGENTS.md:188-189`), not a `.beads` directory; `--adopt` would fall into `bd init` | B1 restated: point at a beads endpoint, check its prefix, never `bd init` over it | fixed |
| R-bf-4 | blocking | skeptic | moving `AGENTS.md` sections breaks the Vault's scripts and CI that cite them by number | plan-content migration moved to its own initiative; any move lists inbound references first | fixed (scope) |
| R-bf-5 | blocking | skeptic | no cutover: old-rules and plugin sessions claim the same bead | adopt is read-only against live claims; a drain list signed by the owner | fixed |
| R-bf-6 | blocking | skeptic | no do-not-write list: deploy, Vercel, the pin, the Dolt server's schema, public issues | do-not-write list in the MVP | fixed |
| R-bf-7 | blocking | business-analyst | the falsification test covers one direction only and leaves N unset | both directions, N set to 3 sprints as a default | fixed |
| R-bf-8 | significant | feature-critic | N repos in one team touches every gate; N teams under one umbrella briefing leaves gates unchanged | shape is open question 2 with the evidence for each | fixed (question) |
| R-bf-9 | significant | feature-critic | adopted beads collide with materialise's own roadmap | a classify step (adopt, leave, close) signed off by the owner | fixed |
| R-bf-10 | significant | feature-critic | manifests miss the riskiest coupling: the MCP tool contract to installed assistant plugins, 39 toolkit import lines | the verdict lists cross-surface contracts; without evidence it says "unknown" | fixed |
| R-bf-11 | significant | product-owner, business-analyst | "17 of 263" counts PRs before beads-only (10-11); since 10-12 it is 16 of 22 | baseline and bead-id pattern restated | fixed |
| R-bf-12 | significant | product-owner | no signal measures delivery | beads closed with evidence per week | fixed |
| R-bf-13 | significant | business-analyst | seven workflows read the pin, not three | corrected | fixed |
| R-bf-14 | significant | business-analyst | the monorepo case (one repo, several components) can never trigger (a) | rule counts components, not repos | fixed |
| R-bf-15 | significant | business-analyst | "surface" collides with the glossary's Delivery surface; mapping areas to components changes what an andon stops | glossary terms proposed; areas map to components only by declaration | fixed |
| R-bf-16 | significant | skeptic | no day-one invariants; rollback deferred | invariants and a tested rollback snapshot in the MVP | fixed |
| R-bf-17 | minor | business-analyst | time zone unstated; citations off (spec `:40`, Dolt `:188-189`) | commit dates in UTC stated; citations fixed | fixed |
| R-bf-18 | minor | feature-critic | plan text stays readable in public git history | stated: move stops publishing, does not hide history; topology changed, not hidden | fixed (noted) |
| R-bf-19 | minor | feature-critic | owner decisions already made live as prose, not records | ratify them once during onboarding (MVP 5) | fixed |
| R-bf-20 | minor | business-analyst | manifest count unreproducible (6 files plus registry entries) | counting rule given | fixed |
