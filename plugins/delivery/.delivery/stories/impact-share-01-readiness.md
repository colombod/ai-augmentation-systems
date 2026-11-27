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
3. With the reach unknown it prints no share; with no declared feature it says so.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/scripts/lib/impact-decisions.js` | modify: the share and its warning |
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
