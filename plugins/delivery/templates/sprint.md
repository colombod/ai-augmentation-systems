---
sprint: <n>
slug: <kebab-case>
scope: <roadmap phase or MVP stage>
branch: <branch name>
status: planned | running | complete | blocked
---

# Sprint <n>: <name>

> Implementation wave log. This file survives interruption — an interrupted sprint
> must be resumable, and this is what makes that possible.

## Plan

**Scope:** which roadmap phase or MVP stage
**Stage promise:** what `prioritization.md` said this stage delivers, and which
personas it serves. `/delivery:sprint-review` checks the result against this.

| Order | Story | Depends on | Status |
| :-- | :-- | :-- | :-- |
| 1 | | | ready |

**Pre-flight checks**

- [ ] All stories in scope are `ready`
- [ ] No open **blocking** findings against the specs this scope depends on
- [ ] No story depends on an unfinished story outside the scope
- [ ] Working tree clean
- [ ] Working on a branch, not the default branch

## Log

### <story-id> — <title>

**Started:** <timestamp>
**Files changed:**
**Tests written:**
**Test result:** actual output, not a claim

| Acceptance criterion | Met | Evidence |
| :-- | :-- | :-- |
| FR-n | yes / no | |

**Commit:** <sha>
**Outcome:** done | blocked
**If blocked:** what stopped it, and whose decision it needs

**Notes:** surprises, deviations and why, follow-up work

---

## Stop conditions hit

Record any of these rather than pressing on — continuing past them produces work
that gets thrown away.

| Condition | Story | Detail |
| :-- | :-- | :-- |
| spec conflicts with reality | | |
| tests failed after bounded retries | | |
| acceptance criterion wrong or unachievable | | |
| change would exceed story scope | | |
| two consecutive stories blocked | | |

## Summary

**Completed:** n of m stories
**Criteria met:** n of m
**Tests:** actual state
**Blocked:**
**Needs a human decision:**
