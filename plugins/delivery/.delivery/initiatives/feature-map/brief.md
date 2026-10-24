# Product brief: feature map, from what is shipped to blast radius to retirement

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft (revision 2, after `reviews/feature-map-brief-01.md`) · Last updated: 2026-10-24

**Mode:** frame · **Word count:** 968 (cap 900, tables excluded, measured with
`grep -v '^|' | wc -w`).

## Owner's ask

> "I want to actually have a feature to code map helping understanding blast radius from feature point of view before hitting the code"

> "[MJ's skills] help bringing the product taste decision early and help customers managing the product shape and knowing when and how to delete feature is a massive utility"

> "this is where we need to have the system I was asking to track feature against actual code artefacts and graphs a real view into what is shipped, what is the backing tech or artefacts and how all integrates"

> "Because we are going feature / product value as main driver we need to to be able to understand how ferries relate to each other , someone is clear but sometime is because dog underlaying implementation details . Understanding and tracking such inventory is key to understand business impact of bugs and code changes, how to pick the next thing to build so we compound on the work already done and on the value we ship. When and what to consolidate and how to pick better the tech debt to handle . [...] adding feature and code is easy but leads to complexity for customers so we need to be able to run analysts of the product from the customer and Personas (including when we introduce and retire them) so they use can have clear vision on how to meet them, with new or modified or removed features"

The fourth quote makes the map the **product inventory** planning runs on, not only a blast-radius
check: feature relations (declared, and coupling through shared implementation), business impact
of a bug or change, selection that compounds on verified work (today an advisory judge reads bead
titles only, `scripts/plan.js:79-90`), consolidation and tech-debt candidates, and persona-to-feature
analysis as personas are introduced and retired. These are scoped in the PRD and staged there; the
MVP below stays the foundation they all read.

> "That inventory MUST always be up to date, fresh and real . Noise , hallucination and incorrect claims in that detail the entire product delivery"

The fifth quote is a **binding constraint** on every requirement below: inventory facts come only
from git objects at a named commit, each with its source (commit, path, line, extraction rule);
an answer older than the commit it describes is refused, never served; no model-written text is
stored as an inventory fact; what the extractor cannot see is stated, never filled in.

No operator record exists yet (this session ran outside a team). Defaults below that stand in
for an owner decision are labelled **default**, never presented as decided.

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (product-owner) | yes, isolated | yes: the ledger break caused by another plugin (F3) |
| precision (business-analyst) | yes, isolated | yes: no feature key; FR ids collide (F1); hubs (F9) |
| absence (feature-critic) | yes, isolated | yes: planners cannot read code (F6); leak guard (F7); markdown calls (F8); stale verified waves (F10) |

**Findings by convergence:** 3 by all three lenses · 4 by two · 4 by one only; F11 from the owner.
Each lens found material the others missed: **not exhausted.** The challenge panel
(`reviews/feature-map-brief-01.md`) and the spike (`research.md`) changed F3, F5 and F8 below.

## Problem

The plugin plans and gates per story and per path. It has no persistent, checked view of what
is shipped, what backs each shipped thing, and how the pieces reach each other. So reach is
discovered by a break, and features never leave.

| # | Finding | Lenses | Evidence | Smallest fix alone |
| :-- | :-- | :-- | :-- | :-- |
| F1 | No feature identity. No glossary entry; `FR-9` in 4 PRDs; `area` groups waves but 0 of 29 story files set it | 3 | `.delivery/glossary.md`; `gates.js:219` | none: needs a definition |
| F4 | Declared files never reconciled with merged files; `pr.files` used only for line counts | 3 | `reviews.js:133-145` | ~10 lines in `reviews.js` |
| F5 | Story path tables rot: of 22 unresolved paths in 54, ~3 are prose rows, ~11 planned creates, ~8 real rot | 3 | `gates.js parseStory` over `.delivery/stories/` | none: seed from history instead |
| F2 | Overlap is string matching: `agents/chief-of-staff.md` spelled two ways (10 vs 5 stories) never matches | 2 | `waves.js:72-78` | path normalisation in `norm` |
| F3 | Undeclared reach breaks silently. `6883fee` (2026-08-06 18:02) created `plugins/attractor/.delivery/`; the ledger stopped until `604d508` (08-07 17:11, 23 h). It is **runtime reach**: `record-invocation.js` searched for directories named `.delivery` | 2 | `git log`; `604d508` body | none: no code edge exists |
| F7 | Feature words beside paths are what the leak guard denies in the product repo | 2 | `plan-graph.js:188-207` | n/a: a constraint |
| F12 | This repo is a weak test bed: one repo plays both roles; commits carry several stories | 2 | `89b6597` | n/a |
| F6 | Only builders have a product checkout | 1 | `roles/*.md:3` | n/a: a constraint |
| F8 | 100 `${CLAUDE_PLUGIN_ROOT}/scripts/` calls on 68 lines of markdown and JSON; a code-only graph sees none | 1 | `grep -o` over `skills roles hooks/hooks.json` | none |
| F9 | Hubs: 20 backing files are reached by 20+ of 71 shipped entry points | 1 | `research.md` spike | none |
| F10 | Nothing flags code changing behind a verified wave (absence; no line describes it) | 1 | `scripts/lib/waves.js` (no such check) | none |
| F11 | Features cannot be retired; personas and assumptions retire in place | owner | `skills/personas/SKILL.md:52` | none |

The two smallest fixes (F2, F4) are worth shipping regardless; they do not deliver the view,
the runtime reach or retirement, which is what justifies the map.

## Who has it

The **operator**, and the **Product Manager** and **Delivery Manager** (`roles/product-manager.md`,
`agents/delivery-lead.md`) who shape and order work for them, on a product with several areas.
Count beyond this repository's operator: unknown.

## Cost of the status quo

- Silent breaks across plugins: 23 h (`6883fee` to `604d508`), and 13 to 17 days for the
  ambiguous-cwd gap (calls lost 08-10 to 08-14, fixed `29b0129` on 08-27).
- Four chief-of-staff spike trials re-run (`604d508` body).
- A shipped defect nobody saw: claim-guard's MCP server bundle is not in git (`research.md`).
- Features accrete with no signal that one has stopped earning its place.

## What changes if we solve it

Anyone can ask, before code: what is shipped, what backs it, what it reaches, and what a
change or a removal would touch, each answer tagged by how it was found and what it cannot see.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Reach seen before code | stories whose `impact` output is recorded at the ready gate | 0 | every story claimed in a wave |
| Prediction holds | files merged outside the story's predicted reach, per story PR | not measured | falls over the first 10 story PRs |
| Replayed breaks caught | known breaks replayed against the map at their parent commit | 1 of 1 (`6883fee`, spike) | every new incident replayed, caught or the gap named |
| Noise | features reached per commit, hubs excluded | p90 7 with hubs | p90 3 or fewer |
| Shipped truth | references from manifests, hooks and prose to files absent from git | 1 found | 0 on main |
| Retirement candidates | candidates raised per realign with usage evidence and window | impossible | raised, or "instrument first" stated |

## MVP boundary

1. **What is shipped:** a view of every shipped entry point per plugin (skills, roles, hooks,
   CLIs, MCP servers), the files backing each, and typed edges between them, built from git.
2. **Feature register:** named features (project-wide id) grouping entry points, each tied to
   one `area`; written only by one script; anchors confirmed against a commit, stale ones marked.
3. **`impact`:** for a story, feature or commit, the features, areas and verified waves reached,
   including runtime reach, hubs reported separately, blind spots stated.
4. **Ready-gate warning** when a story's predicted reach crosses another area or a verified wave.
5. **Retire path:** a feature retired in place, citing an operator record scoped
   irreversible; exclusive anchors only after a reference check at HEAD; staged.

## Explicitly out of scope

- Our own language parser; Trail-Code, Decisioncraft or Amplifier as requirements.
- Combined scores; automatic code deletion.
- MJ-skill doctrine (storyboard, usefulness card, leftover-stone test): a separate initiative.
- The attractor-handoff plan (separate; spike 01 is draft PR #61).

## Current-state workflow

The Product Manager writes "Codebase context" by hand; the Delivery Manager writes each story's
"Files and modules"; `waves.js` warns on exact path matches; a builder discovers reach while
editing; a break is found by whoever next looks.

## Open questions

| # | Question | Owner | Blocks | Default until answered |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Is a feature a capability you name ("the invocation ledger"), grouped under a product area, or is the area itself the feature? | operator | register key | a named capability inside one area |
| 2 | When a story's reach crosses another area, should the ready gate warn or refuse? | operator | gate behaviour | warn |
| 3 | Should a change behind a verified wave send it back to the Reality Checker? | operator | F10 | warn and name the wave |
| 4 | Which product repo should prove the two-repo case? | operator | test bed (F12) | none |
| 5 | Which logs show a product feature is used, for retirement? | operator | retire evidence | instrument first |
