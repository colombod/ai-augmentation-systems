# Stories: delivery plugin self-hardening (epic `harden`)

> Phase 10 artifact. Decomposed from `roadmap.md`'s phases (0, 1, 1b, 2, 3 — the original
> five; Phase 5 added 2026-08-06). Stories `harden-01`–`07` cover `FR-1`–`FR-12` from
> `prd.md`, all done. `harden-08`–`10` cover the newly-added `FR-17`–`FR-19` (CLI/TUI channel
> generalization), not yet built. `FR-13`–`FR-16` remain deferred to Stage 2, out of scope
> for this epic — see `roadmap.md`'s "Does executing this deliver the goal?"

| ID | Title | Roadmap phase | Requirements | Depends on | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| [harden-01](harden-01-rubric-citation-slot.md) | Add a citable rule-ID column to the design-system template | 0 | FR-10 | — | **done** |
| [harden-02](harden-02-spike-invocation-reliability.md) | Spike: confirm hook firing reliability, field names, crash isolation | 1 | — | — | **done** |
| [harden-03](harden-03-spike-capture-tool-discrimination.md) | Spike: confirm capture-tool discrimination for the real toolset in evidence | 1 | — | — | **done** |
| [harden-04](harden-04-evidence-only-marker.md) | Flag stages backed entirely by unconfirmed evidence | 1b | FR-5–FR-8 | — | **done** |
| [harden-05](harden-05-invocation-ledger.md) | Record real skill invocations to a durable, per-session ledger | 2 | FR-1–FR-3 | harden-02 | **done** |
| [harden-06](harden-06-status-invocation-reporting.md) | Report invoked, not-invoked, and untraceable per governed artifact | 2 | FR-1, FR-2, FR-4 | harden-05 | **done** |
| [harden-07](harden-07-verification-channel-rubric-gate.md) | Require a real render and an honest rubric citation for UI verdicts | 3 | FR-9–FR-12 | harden-05, harden-03, harden-01 | **done** |
| [harden-08](harden-08-spike-terminal-capture-tool.md) | Spike: confirm whether a real terminal-visual-capture tool exists | 5 | FR-19 | — | **draft** |
| [harden-09](harden-09-cli-channel-rule.md) | Require a real process invocation, not an internal-logic call, for CLI verdicts | 5 | FR-17, FR-18 | — | **draft** |
| [harden-10](harden-10-tui-channel-rule.md) | Require a real visual capture, not an ANSI-stripped text read, for TUI verdicts | 5 | FR-17, FR-19 | harden-08 | **draft** |

Stories `harden-01`–`07`: **done**, all 7 passed a QA-strategist readiness check before the
build started, with two real gaps found and fixed at that stage (`harden-05`'s exit-code
contradiction, `harden-07`'s missing corrupt-capture case). Stories `harden-08`–`10`: newly
written 2026-08-06, not yet reviewed or built — next-wave scope.

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

harden-08 ─→ harden-10 (TUI channel, needs harden-08's spike result)
harden-09  (CLI channel, independent — no spike dependency)
```

## Not covered here

`FR-13`–`FR-16` (the self-correction gate) — Stage 2 in `prioritization.md`, defends a
persona with zero real transcript evidence. No stories exist for it yet; decomposing it is
future work, contingent on the operator-who-reads-only-the-verdict persona being confirmed
real (per `roadmap.md`'s learning milestone M4).
