# Notes: feature-map

> Authored narrative not derivable from the brief: source reads that `/delivery:research`
> and `/delivery:prd` consume. Written 2026-10-24. Every external claim below is Claimed
> grade (read from the source's own documents, not run here). Nothing was executed.

## External sources read

| Source | Licence | Read | Portable method | Not portable |
| :-- | :-- | :-- | :-- | :-- |
| trailhq/Trail-Code | MIT | README | file and symbol call graph, `trail blast --base`, staleness by content hash | npm install (registry unreachable here); its learnings and hooks overlap delivery's records and Stop hooks |
| michaeljabbour/amplifier-smart-tool-decisioncraft | MIT, Decisioncraft contributors | SKILL.md, contracts, docs, source | as-is / to-be model (`when`, `replaces`, Goes away), gaps as stories with `done_when`, role notes ending in a question, triage by stakes / undo cost / who is affected / deadline, writing guide | Python CLI, canvas, MCP, review server |
| michaeljabbour/amplifier-skill-worth-using | MIT | SKILL.md, rubric.md, examples, benchmark | six criteria (Job, First value, Fit, Outcome, Trust, Return), Claimed / Seen / Repeated, never summed, subtract-first | Amplifier modes and recipes; light-humour voice |
| michaeljabbour/amplifier-skill-market-fit | MIT, Market Fit contributors | SKILL.md, coaching.md, examples | one customer, costed problem, stranger-decodable name, one picture; the leftover-stone test; choice log with the option turned down; stall rule | coaching posture, growth card by default |
| michaeljabbour/amplifier-skill-taste | MIT | SKILL.md, calibration.md, evaluation | owner lens elicited in at most three questions, "what must survive", gates first (correctness, safety, accessibility, feasibility), refine or reframe, two rounds | recipes, `.taste/` |
| michaeljabbour/amplifier-skill-sizzle | MIT | SKILL.md, lessons, storyboard | owner-approved storyboard before any spend, reopened by scope change; one proposition, one-breath test; "change only what the note asks, prove nothing else moved" | all media tooling |

All four MJ skills' benchmarks are "not yet run": port as doctrine on trial.

## What each contributes to the feature lifecycle

| Stage | Contribution | Source | Delivery insertion point |
| :-- | :-- | :-- | :-- |
| Shape, early | Owner lens and "what must survive" recorded before PRD staging | taste | `skills/brief`, `skills/prd` step 6.3, decision records |
| Shape, early | One-proposition / one-breath test; "what to cut" as proposed non-goals | sizzle | `/delivery:challenge` on `prd.md` |
| Shape, early | Leftover-stone test: requirements not in the primary persona's before/after picture default to "Explicitly not doing" unless load-bearing for another persona | market-fit | `templates/prioritization.md` |
| Shape, early | Product storyboard approved by the owner before roadmap; scenario changes reopen it | sizzle | exit of `skills/prd` or entry of `skills/roadmap` |
| Map | Today / planned / both per feature, `replaces`, path:line evidence, freshness | decisioncraft | feature register seed in brief (assess) and research |
| Blast radius | Scoped change: diff may touch only the declared features' anchors | sizzle | `scripts/merge-gate.js`, story "Files and modules" |
| Verify | Measured gate first, then a judged meaning check against the approved storyboard | sizzle | sprint review, Reality Checker unchanged |
| Usefulness | Per-area usefulness card; a Reality Checker pass is Claimed, never Seen | worth-using | `skills/sprint-review`; glossary crosswalk |
| Retire | Candidates: Return not Solid-Repeated after 2 return checks backed by logs (no logs means instrument first, never retire); every Job persona retired; return only on promotion | worth-using | `skills/realign` step 3; owner question via Chief of Staff |
| Retire | Exclusive anchors are deletable; anchors shared with kept features mean retire the surface, keep the code | market-fit | `impact` output |
| Retire | `kind: retire` story with `retires:`; replace checks (planned replacement, nothing replaced twice); always tagged irreversible so it reaches the operator | decisioncraft | `templates/story.md`; `operator-records.js` `DEFAULT_HIGH_STAKES` |

## Porting cautions

- Decisioncraft quietly keeps a "goes away" box unless an undocumented `goes_away: true` is set (its drafter). Our retire path must make removal explicit, never inferred.
- Role notes from one model call are not independent; keep `/delivery:challenge`'s isolated reviewers and port only the card shape.
- Coaching the owner conflicts with the Chief of Staff's no-lecturing rule; if kept, opt-in in the Product Manager's conversation.
- Merge Decisioncraft's writing rules into `templates/writing-standard.md`, not beside it.
- Attribution: NOTICE entry and per-file header for anything ported.

## Worth Using on delivery itself (Claimed only)

For an engineer installing it for the first time: Job Partial, First value Partial, Fit Missing
(team mode), Outcome Partial, Trust Solid, Return Missing. Not stranger-ready. Diagnosis: two
jobs in one tool (team, pipeline only): split, then name the user for each.

## Related decisions pending (outside this initiative)

- **attractor-handoff.** 8 stories, 0 done, plan dated 2026-08-13 and aimed at `/delivery:handoff`.
  The shipping team's builder already runs attractor per story (`roles/builder.md:23`) without
  compiled gates. Proposed refresh: compile `by: test` probes into gate loops, leave
  `by: reality-check` probes irreducible for the Reality Checker; compile rate becomes the measure
  of inference removed. First step: spike `attractor-handoff-01`.
- **Claude Code `/goal`.** Its completion check is a small model reading the transcript; it "doesn't
  call tools" (code.claude.com/docs/en/goal.md). Usable as a continuation loop for stories too
  small for a pipeline, with "done" defined by delivery's own commands, not as a gate. No documented
  way for a plugin to set it. Name clash with delivery's own `goal.js` (the goal sheet).
