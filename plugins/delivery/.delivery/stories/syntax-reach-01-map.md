---
id: syntax-reach-01
title: The feature map counts a JavaScript change only for the features that use it
status: ready
epic: feature-trail-record
supersedes: []
superseded_by: []
superseded_reason:
phase: Release 1
requirements: []
depends_on: []
size: M
---

# The feature map counts a JavaScript change only for the features that use it

## Goal

The owner's words (2026-11-27): "counting code should be walking code", with "a ast analyzer, or lsp
query of code graph rag", and "tehre are tools like tree sitter that do this better".

## Acceptance criteria

1. With a commit range, a changed function counts only for the features that use it; a comment-only
   change counts for none.
2. With files only, a feature counts when it uses any of the file, not merely because files link to it.
3. A use that cannot be followed counts the whole file; if the parser cannot run, file links stand and
   the answer says so.
4. No function run by the test suite is missing from the syntax reach of what ran it
   (`scripts/testing/check-reach.js`).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/scripts/lib/syntax.js` | create: the syntax analyser |
| `plugins/delivery/scripts/lib/features.js` | modify: keep the features that use the change |
| `plugins/delivery/scripts/lib/codemap.js` | modify: the map names its repository |
| `plugins/delivery/scripts/map.js` | modify: pass the commit range; say when syntax was not read |
| `plugins/delivery/scripts/ready.js` | modify: the same |
| `plugins/delivery/scripts/merge-gate.js` | modify: the same |
| `plugins/delivery/skills/map/SKILL.md` | modify: say what is counted |
| `plugins/delivery/scripts/syntax.test.js` | create |
| `plugins/delivery/scripts/merge-gate.test.js` | modify |
| `plugins/delivery/scripts/role-scope.test.js` | modify |
| `plugins/delivery/scripts/testing/check-reach.js` | create: the soundness check |

## Owner decision on the large impact

Asked on 2026-11-27, before the change, with "this changes the counting code, which affects 5/8 live
features", the owner answered, verbatim:

"ship it"

## Impact decisions

| Feature | Decision | Relation | Evidence |
| :-- | :-- | :-- | :-- |
| feature-map | guard | extends | plugins/delivery/scripts/syntax.test.js |
| delivery:map | guard | extends | plugins/delivery/scripts/syntax.test.js |
| plan-an-intent | guard | extends | plugins/delivery/scripts/syntax.test.js |
| delivery:stories | guard | extends | plugins/delivery/scripts/syntax.test.js |
| run-a-sprint | guard | extends | plugins/delivery/scripts/syntax.test.js |
| verified-shipping | guard | extends | plugins/delivery/scripts/syntax.test.js |
| delivery:status | guard | extends | plugins/delivery/scripts/syntax.test.js |
| delivery:sprint-review | guard | extends | plugins/delivery/scripts/syntax.test.js |
| standing-team-runtime | guard | extends | plugins/delivery/scripts/merge-gate.test.js |
| delivery:role:delivery-lead | guard | extends | plugins/delivery/scripts/merge-gate.test.js |
