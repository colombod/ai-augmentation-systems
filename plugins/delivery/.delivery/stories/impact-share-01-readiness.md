---
id: impact-share-01
title: Readiness says how many live features a story affects
status: ready
epic: feature-trail-record
supersedes: []
superseded_by: []
superseded_reason:
phase: Release 1
requirements: []
depends_on: []
size: S
---

# Readiness says how many live features a story affects

## Goal

The owner's words (2026-11-27): "large is a ration of imapcted feature VS live fefatures", "yes 50% is
a gerat solid number", and "8/8 is more precise and readable".

## Acceptance criteria

1. `ready.js` prints `Impact: N/M live features affected` with their names, for a story file and a bead.
2. At 50% or more it warns `impact-large`; below that it does not. It never blocks.
3. A new file counts for the features whose anchors claim it. A file that cannot be placed is named and the
   share reads `at least`; with none placed, or the reach unknown, no share. With no live feature it says so.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/scripts/lib/impact-decisions.js` | modify: the share and its warning |
| `plugins/delivery/scripts/lib/warnings.js` | modify: a long warning stays open |
| `plugins/delivery/scripts/ready.js` | modify: count live features and print the share |
| `plugins/delivery/skills/stories/SKILL.md` | modify: say what it means |
| `plugins/delivery/scripts/impact-decisions.test.js` | modify |
| `plugins/delivery/scripts/gates-cli.test.js` | modify |

## Impact decisions

| Feature | Decision | Relation | Evidence |
| :-- | :-- | :-- | :-- |
| plan-an-intent | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| delivery:stories | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| standing-team-runtime | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| delivery:role:delivery-lead | accept | extends | plugins/delivery/roles/delivery-lead.md:48 reports what ready.js prints, unchanged |
| verified-shipping, beads-work-queue, decision-record, delivery:architecture, delivery:realign, delivery:roadmap, delivery:role:builder, delivery:role:chief-of-staff, delivery:role:product-manager, delivery:role:reality-checker, delivery:role:spike-researcher, delivery:sprint, delivery:status, delivery:team, run-a-sprint, delivery:decision, delivery:materialise, delivery:role:host-manager, delivery:role:progress-observer, delivery:sprint-review, delivery:start, ci:delivery-tests, delivery:agent:pr-reviewer, feature-map, independent-review, delivery:role:staffing | accept | none | plugins/delivery/scripts/lib/warnings.js:90 is the only function changed in that file, and its only caller is plugins/delivery/scripts/ready.js:169; read 2026-11-27, after the merge |

## Owner decision on the large impact

Recorded after the merge of #256, which should have waited for it. With the review fix in
`scripts/lib/warnings.js` this story reads 8/8 live features. Asked on 2026-11-27 to "keep" the change
or "revert" the warning log fix, the owner answered, verbatim:

"keep"
