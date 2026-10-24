# Product brief: feature map, from shape to blast radius to retirement

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-10-24

**Mode:** frame · **Word count:** 581 (cap 900, tables excluded, measured with
`grep -v '^|' | wc -w`).

## Owner's ask

> "I want to actually have a feature to code map helping understanding blast radius from feature point of view before hitting the code"

> "[MJ's skills] help bringing the product taste decision early and help customers managing the product shape and knowing when and how to delete feature is a massive utility"

No operator record exists for either yet (this session ran outside a team).

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (product-owner) | yes, isolated subagent | yes: the invocation-ledger break caused by another plugin (F3) |
| precision (business-analyst) | yes, isolated subagent | yes: "feature" has no key; FR ids collide (F1); hub files (F9) |
| absence (feature-critic) | yes, isolated subagent | yes: planners cannot read code (F6); the leak guard (F7); call graphs miss markdown links (F8); verified waves never re-checked (F10) |

**Findings by convergence:** 3 found by all three lenses · 4 by two · 4 by one only. Each lens
found material the others missed: **the space is not exhausted.** F11 came from the owner
and five source reads (`notes.md`), not from a lens.

## Problem

The plugin plans and gates work per story and per file path. It has no persistent idea of a
*feature*: what the owner can name, where it lives in code, what else it reaches, and when it
should go. So reach is discovered after the change, by a break.

| # | Finding | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| F1 | No feature identity. The glossary has no "feature"; `FR-9` exists in 4 PRDs; 0 of 29 stories set `area:` | 3 | `.delivery/glossary.md`; `grep -l 'FR-9\b' initiatives/*/prd.md`; `grep -l '^area:' stories/*` |
| F4 | Declared files are never reconciled with what merged. `reviews.js` fetches `pr.files` only to count lines | 3 | `scripts/lib/reviews.js:133-145` |
| F5 | Declared paths rot: 22 of 54 distinct paths in story tables do not resolve today (some are planned creates) | 3 | `gates.js parseStory` over `.delivery/stories/` |
| F2 | Overlap is string matching. `agents/chief-of-staff.md` is spelled two ways (10 stories vs 5) and never matched; read-only rows count as touched | 2 | `scripts/lib/waves.js:72-78`; `gates.js:90-100` |
| F3 | Cross-plugin reach is undeclared. Adding attractor (`6883fee`) silently stopped the invocation ledger for 23 hours until `604d508`; it recurred (`29b0129`) | 2 | `git log` |
| F7 | Where a map may live is constrained: feature words next to paths are what the leak guard denies in the product repo | 2 | `scripts/lib/plan-graph.js:188-207`; `leak.js` |
| F12 | This repo is a weak test bed: one repo plays project and product, history squashes several stories per commit | 2 | `89b6597` (40 files, 4 features) |
| F6 | The roles that need reach before code (PM, DM) have no product checkout; only builders have `touches_code: true` | 1 | `roles/*.md:3`; `scripts/prepare-role.js:61-73` |
| F8 | A code-to-code graph misses 68 `${CLAUDE_PLUGIN_ROOT}/scripts/...` calls written in skills, roles and hooks | 1 | `grep -c` over `skills roles hooks/hooks.json` |
| F9 | Hub files (`gates.js`) shared by many features would light up every blast radius without a fan-in rule | 1 | precision lens |
| F10 | Nothing sends a verified wave back to the Reality Checker when code behind it changes | 1 | `docs/reference.md:697` |
| F11 | The plugin cannot retire a feature. Personas and assumptions retire in place; features have only `supersedes` | owner | `skills/personas/SKILL.md:52`; `templates/story.md:12-16` |

## Who has it

The **operator** running one or more delivery initiatives on a product with several areas, and
the **Product Manager** and **Delivery Manager** sessions who shape and order work for them.
Count unknown beyond this repository's own operator.

## Cost of the status quo

- Silent breaks across plugins: two in this repo, 23 hours and roughly 13 days to detect.
- Four chief-of-staff spike trials re-run after the ledger gap (`604d508` body).
- Parallel builders on the same file go unwarned when paths are spelled differently.
- Features accrete: with no retirement path, nothing tells the owner a feature has stopped earning its place.

Workaround today: hand-written file tables and memory.

## What changes if we solve it

Before code, the owner and planners see, for one named feature: the code it lives in, the other
features and customer surfaces that code reaches, the stories in flight there, and the verified
waves at risk, each tagged by how it was found (declared, merged, call graph). Shape and
removal become decisions made early, with the owner's words on record, and a retired feature
leaves a checklist instead of a guess.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Undeclared reach caught before merge | fix commits whose cause sits in another feature | 2 found after the fact | caught at plan or merge gate |
| Detection latency | breaking commit to fix | 23 h; ~13 days | same day |
| Collision recall | same-file declarations flagged by the overlap check | spelling pairs missed | all flagged |
| Map freshness | declared anchors that resolve at HEAD | 32 of 54 | all resolve or are marked stale |
| Declared vs merged | undeclared files per story-PR | not measured | reported on every merge |
| Retirement | features retired with a record and a clean blast radius | impossible today | first one done |

## MVP boundary

1. A feature register keyed `<initiative>/<feature-id>`, each feature with code anchors
   (path, optional symbol), relation (changes, reads, tests), source and last-confirmed commit.
2. Seeded from story tables, reconciled on every merged story PR, stale anchors marked, never dropped.
3. `impact <feature|story>`: other features, surfaces, in-flight stories and verified waves
   reached, at file level, stating its level. A call graph (Trail-Code) is an optional depth.
4. A retire path: a feature marked retired in place with an owner record, its exclusive anchors
   as the deletion checklist.

## Explicitly out of scope

- Building our own call-graph parser.
- Making Trail-Code, Decisioncraft or Amplifier required.
- Scoring features numerically or ranking them by a combined score.
- Deleting code automatically.
- Changing the attractor-handoff plan (a separate initiative).

## Current-state workflow

The PM writes architecture "Codebase context" by hand; the DM writes each story's "Files and
modules" table; `waves.js` warns on exact path matches at claim time; a builder discovers reach
while editing; a break is found by whoever next looks.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | What is a feature to you: one requirement, a product area, or a capability you name (for example "the invocation ledger")? | operator | register key |
| 2 | Who looks at blast radius, and when: you approving a story, the PM in architecture, or a builder claiming one? | operator | where `impact` runs |
| 3 | Is a missed feature worse than a false alarm? | operator | file vs call-graph depth |
| 4 | May feature names appear in the product repo, even in an ignored cache? | operator | where the map lives (F7) |
| 5 | Should a change behind a verified wave send it back to the Reality Checker automatically? | operator | F10 |
| 6 | Is a file-level map worth shipping if Trail-Code cannot be installed here? | operator | MVP depth |
| 7 | Which project should prove the two-repo case, since this repo merges both? | operator | test bed (F12) |
