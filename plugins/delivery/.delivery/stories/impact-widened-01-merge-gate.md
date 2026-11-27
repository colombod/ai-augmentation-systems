---
id: impact-widened-01
title: The merge check says when a pull request reaches features its story did not list
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

# The merge check says when a pull request reaches features its story did not list

## Goal

The owner's words: the impacted features must be tested "and notify if fixing those expands the feature
blast radius". On 2026-11-27 a review fix took a story from 2/8 to 8/8 live features and nothing said so
before the merge.

## Acceptance criteria

1. `merge-gate.js check <pr>` warns, naming the features, when the pull request's changed files reach a
   feature that no story on the pull request lists in its Impact decisions, with the new N/M share.
2. At 50% or more the warning says the owner decides before the merge. It never refuses a merge.
3. A deleted or renamed file counts for the features that reached it before.
4. Where it cannot compare (no story, commit not available), it says the impact was not checked.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/scripts/merge-gate.js` | modify: compare the pull request's reach with its stories |
| `plugins/delivery/scripts/lib/impact-decisions.js` | modify: the comparison and its wording |
| `plugins/delivery/scripts/ready.js` | modify: share the product checkout lookup |
| `plugins/delivery/roles/delivery-lead.md` | modify: what to do with the warning |
| `plugins/delivery/scripts/merge-gate.test.js` | modify |
| `plugins/delivery/scripts/impact-decisions.test.js` | modify |
| `plugins/delivery/scripts/role-scope.test.js` | modify: list why the merge gate now runs git |

## Impact decisions

| Feature | Decision | Relation | Evidence |
| :-- | :-- | :-- | :-- |
| standing-team-runtime | guard | extends | plugins/delivery/scripts/merge-gate.test.js |
| delivery:role:delivery-lead | guard | extends | plugins/delivery/scripts/merge-gate.test.js |
| plan-an-intent, delivery:stories, delivery:role:staffing, delivery:team, delivery:role:progress-observer, delivery:start, delivery:role:chief-of-staff, delivery:role:host-manager | accept | none | plugins/delivery/scripts/lib/impact-decisions.js:1 and plugins/delivery/scripts/ready.js:1: a function added and the reach lookup split in two; what ready.js prints and blocks is unchanged, covered by its tests |
