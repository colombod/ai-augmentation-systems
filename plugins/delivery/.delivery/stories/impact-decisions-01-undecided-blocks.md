---
id: impact-decisions-01
title: A story that reaches features without deciding them is not ready
status: ready
epic: request-evaluation
supersedes: []
superseded_by: []
superseded_reason:
phase: Release 1
requirements: []
depends_on: []
size: S
---

# A story that reaches features without deciding them is not ready

## Goal

The impact on shipped features is decided before building. The owner: "before building anything we need
to know the impact on other currently shipped features" (2026-11-27).

## Context

`impact-decisions.js` blocked a table with a reached feature missing, but only warned when the whole
table was absent, so leaving it out passed the gate (review finding R-trail-brief-17).

## Acceptance criteria

1. `node scripts/ready.js --story <file>` exits 1 with `block R-35 impact-undecided`, naming the reached
   features, for a story whose files reach a feature and that has no `## Impact decisions` table.
2. `ready.js <bead> --record` on that story exits 1 and records no ready hash; with every reached
   feature decided, it records one.
3. A story that reaches no feature needs no table. A story whose reach cannot be computed still gets a
   warning, not a block.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/scripts/lib/impact-decisions.js` | modify: block an absent table when features are reached |
| `plugins/delivery/scripts/ready.js` | modify: comments that said reach never blocks |
| `plugins/delivery/skills/stories/SKILL.md` | modify: state the new rule |
| `plugins/delivery/scripts/impact-decisions.test.js` | modify: both directions |
| `plugins/delivery/scripts/gates-cli.test.js` | modify: story file and record paths |

## Impact decisions

| Feature | Decision | Relation | Evidence |
| :-- | :-- | :-- | :-- |
| plan-an-intent | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| delivery:stories | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| standing-team-runtime | guard | extends | plugins/delivery/scripts/gates-cli.test.js |
| delivery:role:delivery-lead | accept | extends | plugins/delivery/roles/delivery-lead.md:48 already tells the role to fix what ready.js reports before --record |
