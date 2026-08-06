# ADR-002: A human gate blocks only when stdin is a real TTY; every other context fails fast

**Status:** accepted
**Date:** 2026-08-05
**Deciders:** Solution Architect; revised after Feature Critic review

> **Budget overrun declared:** 796 prose words against a 600-word cap. This ADR reverses the
> original design after an adversarial finding with real product-visible consequences (a
> silent-hang risk in the plugin's own primary invocation path); the reasoning connecting that
> finding to the fix is exactly what the writing standard says never to cut. Kept whole rather
> than thinned.

## Context

FR-5/6/7 require a human-gate node to block the process and never take an implicit edge,
without FR-8 (the answer-delivery channel) being decided — Open Question 1 is unresolved,
so nothing can ever end the wait in this build. The first design (block unconditionally via
`process.stdin.resume()` plus a heartbeat timer) was reviewed adversarially and found to have
a serious, unflagged consequence: NFR-1's 500-step cap does not apply to a step that never
completes, and `timeout`/`on_timeout`/`human.default_choice` are deliberately not honored this
slice — so an unconditional block turns *every* non-interactive invocation (CI, a scripted
`claude -p` batch run, a routing bug that reaches a hexagon node unexpectedly, and — critically
— FR-2's own sanctioned "invoke via Bash" path, which almost certainly has no TTY on stdin)
into a **silent, permanent hang**, with zero of the safety nets that make today's immediate
"no handler registered" abort loud and diagnosable. This is a direct tension with AGENTS.md's
own doctrine, "loud aborts over silent degradation."

## Decision

`HumanGateHandler.execute()` checks `process.stdin.isTTY` (injectable for tests) before
blocking. If **not** a TTY, it returns `Status.FAIL` immediately, with a message naming the
node, that no answer-delivery mechanism exists yet (PRD Open Question 1 / FR-8), and that
blocking would have been a silent hang — this is the *loud* failure mode, not a regression
from today's "no handler registered," and it terminates the pipeline exactly the way any other
unrecovered FAIL does (fail-fast per existing engine convention — no unconditional edge
carries it forward). If stdin **is** a TTY, it blocks exactly as originally designed
(`resume()` + heartbeat), serving the one case that plausibly has a human physically present
to eventually inform FR-8's design.

## Alternatives considered

### Block unconditionally, as originally designed

**Why it was attractive:** the most literal reading of FR-5's text ("blocks the process...
remains alive until answered"), no invocation-context branching.
**Why rejected:** creates the silent-forever-hang failure mode described above, in the one
invocation path (FR-2's Bash-tool skill) this whole slice exists to make discoverable. Fails
the doctrine's own stated preference by construction, not by accident.

### Resolve Open Question 2 now (refuse `--unattended` runs at preflight if a reachable gate has no timeout escape)

**Why it was attractive:** directly answers the open question the PRD already names for
exactly this risk, rather than inventing a new mechanism.
**Why rejected, for this pass:** requires reachability analysis across the graph (is a gate
node reachable from the current entry point) that doesn't exist yet, and depends on a
`--unattended` flag FR-8's owner hasn't specified. The TTY check is a strictly narrower,
already-available signal that solves the same class of problem (don't hang silently when
nobody can answer) without waiting on that design. Recommended as the eventual, more precise
mechanism once Open Question 2 is resolved — this ADR's fix is not meant to preempt it.

### Auto-route via `timeout`/`on_timeout` when non-interactive

**Why it was attractive:** honors the attribute an author may have declared, following
HITL-001's lint rule to its logical conclusion.
**Why rejected:** this is FR-8-shaped decision-making (how an answer resolves), not a blocking
mechanism — building it now risks contradicting whatever FR-8's eventual design decides, and
FR-6's text ("no implicit edge... for any wait duration") reads as covering this too.

## Consequences

**We gain:** the primary, sanctioned invocation path (FR-2's skill, almost certainly
non-TTY) now fails loudly and specifically instead of hanging or being silently killed by an
unverified external harness timeout — closing the gap Feature Critic's review found between
"the mechanism works" (Node-internal, tested) and "the surrounding harness lets it keep
running" (never verified, and now moot for that path).

**We accept:** FR-5's "blocks... remains alive" behavior is now scoped to a genuinely
interactive terminal session only — narrower than the PRD's literal text, though consistent
with the PRD's own Assumptions section ("interpretation (a) serves an attended/in-session
mode"). HITL-001's lint message still reads as if a declared timeout will be enforced; it
won't be, in either branch, this slice — a documentation gap (README/SKILL.md caveat) is
still needed, tracked in the architecture's risk register, not fixed by this ADR alone. NFR-9
(crash during an unanswered gate) now applies almost exclusively to the interactive-TTY case,
since the non-interactive case no longer has a long wait to crash during.

**We will need to revisit this if:** Spike 6 (new) finds that a Bash-tool-spawned child
*does* present a TTY on stdin, which would mean the fail-fast path doesn't fire where expected
and the original unconditional-hang risk resurfaces for that channel; or when FR-8 is designed,
at which point this handler's FAIL branch is replaced by whatever the chosen answer-delivery
mechanism requires.
