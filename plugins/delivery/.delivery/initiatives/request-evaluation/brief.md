# Product brief: Request evaluation

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-11-23

**Mode:** frame · **Word count:** 704, excluding tables (cap 900)

All measurements are at commit `dd16d97`, mapped from the repository root.

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value | independently | No: F13 |
| precision | independently | No: F6-F10 |
| absence | independently | No: F5, F11, F12 |

**Findings by convergence:** 1 found by 3 lenses · 3 by 2 · 9 by one only. Each lens found material the others missed, so the space is **not exhausted**. F0 came from measuring, before the lenses ran.

| # | Finding | Lenses |
| :-- | :-- | :-- |
| F0 | **Reach is silently wrong from a subdirectory.** `ready.js --story` on `harden-05` prints "no feature"; from the repository root the story reaches 14 of 78 | measured |
| F3 | Reach mixes 0-hop, 7-hop and hub-only features, which do not deserve equal attention | 3 |
| F1 | Reach is not conflict: contradicting behaviour may share no file | value, absence |
| F2 | A required field invites one-word rubber stamps | value, absence |
| F4 | "Guard" is undefined, and only one property exists to point at | value, precision |
| F5 | Decommissioning needs usage evidence the map cannot give | absence |
| F6 | Reach moves after a decision is recorded | precision |
| F7 | One file can count for a derived and a declared feature (39 of 81 anchor files) | precision |
| F8 | New files inside a derived feature are attributed to nothing | precision |
| F9 | A map fault must neither block everything nor waive everything | precision |
| F10 | "Predates" is undefined | precision |
| F11 | Features declare no behaviour, so "regression" has no stated baseline | absence |
| F12 | A request is prose with no paths; someone must name candidate features | absence |
| F13 | If reach is mostly noise, the decision work is wasted | value |

## Owner lens and what must survive

**Lens:** you value deliberate decisions about existing behaviour because unexamined impact becomes regressions or dead code, while wanting to preserve a small, evidence-based process · **assumed**

**What must survive** (owner's words, this initiative):

- "Validation goes both ways, thanks to the feature trail map."
- "The impact of new work on existing features is surfaced as work to do"
- "a decision on either regression handling, or a possible opportunity to decommission conflicting existing behaviour"

**Proposition:** A Delivery Manager can mark a story ready only when every existing feature it reaches has one recorded decision.

| Gate | State | Reason |
| :-- | :-- | :-- |
| correctness | **fail (critical)** | F0: enforcing on today's reach would pass a 14-feature story as reaching nothing. See question 1 |
| safety | pass | A decision deletes nothing; removal stays a separate, owner-recorded story |
| accessibility | n.a. | Plain text in an existing command-line tool |
| feasibility | pass | Impact, ready, retire, owner-record verification and properties all exist |

## Problem

A story's reach is computed and then ignored. `ready.js:106-107` prints it as "never a block", and the `ready.js <bead>` path that records readiness does not compute it at all. Nothing asks what happens to each reached feature. Where reach is shown, it can be wrong (F0): `map.js:22` and `ready.js:58-65` accept a subdirectory as the repository, and the map then reads 2 of 499 files.

## Who has it

The Delivery Manager and Delivery Lead sessions that make stories ready, and the owner, who "must never have to check" (`AGENTS.md`, The law). No other users are known.

## Cost of the status quo

The cost is unmeasured: no regression or missed-retirement count exists. The exposure is measurable. Of 33 stories, 29 name files. They reach a median of 3 features, 90th percentile 9, maximum 15. None records a decision.

## What changes if we solve it

### Evaluation, both ways

| Direction | Question | The map can show | The map cannot show | Trust |
| :-- | :-- | :-- | :-- | :-- |
| Request to code | Which features does it reach? | Features, chains with file:line, hubs, unreached files | Reach through the 39 unread files; files the story fails to list | High for listed files |
| Code to request: overlap | Which features sit where the new work lands? | Shared anchors; features anchored in a new file's directory | Whether sharing means conflict | **Low: candidates only** |
| Code to request: meaning | What does it conflict with, duplicate or supersede? | Nothing | All of it. A reader compares the request with `map.js features` | Reader's judgement |

Directory overlap is weak evidence. Across the 29 stories it produced at most 1 candidate, yet `plugins/delivery/agents` alone holds 14 features. It prompts a reader and never creates a required decision by itself.

### One decision per feature

Each story carries an `## Impact decisions` table. The Delivery Lead writes it, starting from the reach.

| Decision | Means | Required evidence, checked by the gate |
| :-- | :-- | :-- |
| `guard` | Behaviour must hold | A `properties.json` id, or a test path present at HEAD or created by this story |
| `decommission` | Conflicting behaviour should go | The `map.js retire` commit, and a `dec-` record that passes `ownerRecord` (`gate-context.js:109`) |
| `accept` | Reached, no behaviour change intended | A reason naming what was read, as file:line |

- Each row also states the relation: `extends`, `conflicts`, `duplicates`, `supersedes` or `none`.
- Every reached feature id appears in exactly one row. A second appearance is a block.
- Features within 2 hops get their own row, except a derived and declared pair sharing an anchor (F7).
- Features past 2 hops or reached only through a hub may share one `accept` row, which lists each id.
- A known break is never `accept`. It is `decommission`, so the owner decides it.
- A reader-named conflicting feature gets a row even when the map does not reach it (F1, F12).

### Enforcement

`ready.js` recomputes reach at HEAD on both paths and compares feature ids with the table, so no stored commit can go stale (F6).

| Story state | Result |
| :-- | :-- |
| No table (every existing story) | Warning `impact-undecided`, written to the ledger; never a block |
| Table complete | Ready |
| Reached feature missing, duplicated, or evidence invalid | **Block** |
| Row for a feature no longer reached | Warning |
| Table present, reach cannot be computed | **Block**: missing evidence is never a pass |

The table lives outside `storyHash` (`gates.js:197`), so adding it does not trigger "criteria changed". The stories skill writes it for new stories, so presence separates new from old (F10). Deleting the table downgrades a story to a warning; the ledger shows it.

The gate proves a decision exists and its evidence resolves. It cannot prove the decision is wise, or that a named test covers the behaviour.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Reach correct from any directory | `ready.js --story` on `harden-05`, run from the plugin directory | 0 features | 14 |
| New stories with complete decisions | Stories with the table that pass the gate | 0 | 100% |
| Reach is worth deciding on | Reviewer marks reached features truly at risk, 5 existing stories | not measured | At least 1 in 3, or stop before enforcing (F13) |
| Decisions are not stamps | Share of `accept` rows over the next 10 stories | no data | Review the process if above 80% |

## MVP boundary

1. **Fix reach:** resolve the Git top level, and attribute planned files in `ready.js` as `map.js` does.
2. **Run the noise check** on 5 stories. Stop here if it fails.
3. **Add the check:** one function in `scripts/lib/`, called from both `ready.js` paths, with `impact-undecided` added to `READY_KINDS`.
4. **Update `skills/stories/SKILL.md` step 3a** to write the table.

No new command, register, agent or document type.

## Explicitly out of scope

- Automatic conflict or duplicate detection, including model judgement
- Per-feature behaviour statements (F11)
- Running guards at the ready gate
- Usage logging, and any deletion
- Backfilling existing stories
- Evaluating a request before it has a story

## Current-state workflow

1. The stories skill pastes `map.js impact` under `## Blast radius` (`SKILL.md:94`).
2. `ready.js --story` prints reach; `ready.js <bead> --record` stamps readiness without it.
3. Any retirement or regression judgement happens only if someone thinks to make it.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | **Blocking.** May the reach fix ship first, as step 1 of this work? Recommended: yes, because enforcement on wrong reach passes unsafe stories | Owner | PRD |
| 2 | If a story knowingly changes what a feature does, should you always decide, as proposed, or may the team accept it? | Owner | PRD |
| 3 | Which past surprise should this have caught? A real example would test the design and replace the assumed lens | Owner | — |
| 4 | What must never be lost when a feature is retired? | Owner | — |
| 5 | Should a request be evaluated before its story exists? Proposed: later, once this proves useful | Owner | Next increment |
