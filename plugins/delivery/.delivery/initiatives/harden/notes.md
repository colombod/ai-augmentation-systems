# Stories notes: harden

> Initiative: `harden`. Per `ADR-004`, the story ID/title/phase/requirements/status table
> that used to live here is retired as a hand-maintained file — it's fully derivable from
> each story's own frontmatter, and `/delivery:status` computes it live. This file keeps only
> the authored narrative judgment that isn't derivable data — moved 2026-08-07 from the
> shared `.delivery/stories/README.md`, content unchanged.

Decomposed from `roadmap.md`'s phases (0, 1, 1b, 2, 3 — the original five; Phase 5 added,
challenged, and built 2026-08-06). Stories `harden-01`–`07` cover `FR-1`–`FR-12` from
`prd.md`, all done. `harden-09`/`11` cover `FR-17`–`FR-18`'s CLI half, done in two tiers.
`harden-08`/`10` cover `FR-19`'s TUI half — written, held by a real product-owner decision,
not built. `FR-13`–`FR-16` remain deferred to Stage 2, out of scope for this epic — see
`roadmap.md`'s "Does executing this deliver the goal?"

Stories `harden-01`–`07`: **done**, all 7 passed a QA-strategist readiness check before the
build started, with two real gaps found and fixed at that stage (`harden-05`'s exit-code
contradiction, `harden-07`'s missing corrupt-capture case). Stories `harden-08`–`11`: written
2026-08-06, then run through `/delivery:challenge` before any building — a real, 5-reviewer
adversarial review (`.delivery/reviews/phase-5-cli-tui-01.md`) found the original plan wasn't
buildable as scoped. `harden-11` (a new spike, not in the original three) resolved the CLI
question for real, with a genuine partial result (live confirmation blocked by an expired
auth session, real design analysis completed anyway). `harden-09` shipped in two honest
tiers off that result. `harden-08`/`harden-10` (TUI) are held — a real product-owner
decision, not a slip, made after the review found no downstream need for it yet and a named
fallback tool confirmed unable to do the one thing it was proposed for.

**What "done" actually rests on, in order — nothing here was rounded up.** A genuine
`.delivery/`-resolution bug was found live and fixed (unit tests had missed it because
every fixture matched the implementation's own wrong assumption). The core mechanism was
then live-tested **21/21** real invocations. A real `/delivery:status` run against a real,
hook-populated ledger worked exactly as designed and caught four real problems in this
build along the way (a leftover test fixture, a status-inconsistency row, a stale
installed-plugin version, and — most tellingly — that most of this epic's own planning
artifacts read as "not-invoked" by its own new mechanism; see below). The two gaps that
stayed open the longest — a genuine mid-run tool failure, and a real screenshot firing in
an actual interactive session — were closed last, for real, during live interactive use of
this plugin: a browser navigation to an unreachable domain left a tab broken, and the
resulting screenshot attempt was both a real failure (`PostToolUseFailure`, correctly
logged) and, on a working page moments later, a real success (`capture_action:
"screenshot"`, correctly logged). Every acceptance criterion across all 7 stories now has
a real, live-observed instance behind it. See each story's own Implementation Notes for
the exact evidence.

**The most important finding from this build isn't in any single story — it's what
`harden-06`'s own live test found when pointed at this project itself:** by its own new
mechanism, 8 of this project's 11 governed-artifact classes — including the PRD,
architecture, roadmap, and these very stories — read as **not-invoked**, because they were
written directly rather than through a literal `/delivery:` Skill-tool call each phase.
This is not a bug in the mechanism; it is the mechanism working exactly as designed,
holding up a mirror to this project's own process. Worth stating plainly rather than
letting a reader discover it by reading the ledger themselves.

## Build order

```
harden-01 ─┐
harden-02 ─┼─→ harden-05 → harden-06
harden-03 ─┤        │
           └─→ harden-07 (needs harden-05, harden-03, harden-01)
harden-04  (independent — ships whenever)

harden-11 ─→ harden-09  (CLI channel, tier 1 built; tier 2 open debt)
harden-08 ─→ harden-10  (TUI channel — both held, not built)
```

## Not covered here

`FR-13`–`FR-16` (the self-correction gate) — Stage 2 in `prioritization.md`, defends a
persona with zero real transcript evidence. No stories exist for it yet; decomposing it is
future work, contingent on the operator-who-reads-only-the-verdict persona being confirmed
real (per `roadmap.md`'s learning milestone M4).
