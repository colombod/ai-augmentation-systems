# Sprint 3 realign

Closing step after `sprints/3-parallel-handler-review.md`. In plain terms: sprint 3's review
found five real problems (one bug, four documentation gaps); all five got fixed directly instead
of being written down as "do this later," so this record is short — there is no leftover work to
schedule.

## What changed, and why

| Document | Change | Why |
| :-- | :-- | :-- |
| `roadmap.md` | Phase 5 marked done; four new risk rows added and immediately marked resolved; the closing note corrected from "accepted with debt, see what's still open" to "nothing from that review is still open" | The review's own findings needed a permanent home in the plan, not just the review document, so a later reader checking the roadmap alone sees the true state |
| `reviews/sprint-3-01.md` | New — the four documentation/observability findings, each with status `fixed` and its resolution | Matches this project's own convention (`sprint-2-01.md`) of a standing findings file `/delivery:status` can track by ID |
| `reviews/sprint-2-01.md` | `R-sprint2-1` (a git worktree race, open since sprint 2) marked `fixed` | Its own resolution note named this sprint's `p5-08` as the trigger condition; that arrived, was caught, and was fixed within this same review |
| `sprints/3-parallel-handler-review.md` | Verdict changed from "accepted with debt" to "accepted"; carried-debt table now empty | All four findings were fixed the same day, not deferred — the verdict must reflect the code as it now stands, not as it stood mid-review |
| `stories/p5-08-parallel-handler-integration.md` | Implementation notes and final test count updated | Keep the story's own record consistent with what actually shipped |

## Invalidated assumption

The README's node-shape table (pairing `component`/`tripleoctagon` as both usable) was treated as
accurate authoring guidance; it was not — `tripleoctagon` is still refused. Source: `README.md`.
Fixed at the source, not merely noted.

## Estimates

No recalibration needed. `p5-08` was sized `L` and took three implementation commits plus two
review-fix rounds, which is what `L` should absorb.

## Re-staged / re-sequenced

No change to the MVP boundary or phase order. Phase 5 already lets a real persona finish a
journey end to end (confirmed by an actual CLI run this review performed), and none of the four
fixes changed what any story does — only what it says and reports.

## Simulation calibration

A real persona walk (driving the actual built CLI, not reading code) found all four
documentation/observability gaps; no test in the sprint's own suite could have. Worth budgeting a
real persona walk — not just a simulated one — on every future story with a CLI-facing surface,
not only ones explicitly framed as UX work.

## Carried debt

None. Every finding from this sprint's review is `fixed`.

## Next

`p5-09` (concurrency verification under the now-real `ParallelHandler`) is unblocked and next.
