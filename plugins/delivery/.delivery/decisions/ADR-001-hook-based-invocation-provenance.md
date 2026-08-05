# ADR-001: Determine invocation provenance with a hook, not an invokable skill

**Status:** proposed
**Date:** 2026-08-05
**Deciders:** solution-architect, with product-owner sign-off pending

## Context

`prioritization.md`'s Open Question 1 asked whether checking "did a phase actually run" should
be a passive background mechanism or a skill the agent invokes. The incident this exists to
catch: "I only wrote the text 'Continuing straight into /delivery:prd now, no pause' without
actually invoking the Skill tool" (glossary: **Narrated**). If the check itself is something
the agent must choose to invoke, the same agent that skipped the first call can just as
easily skip or narrate the check — reproducing the original failure one level up, with
nothing to catch *that* recursion, since the mechanism that would (the deferred
self-correction gate) is explicitly out of this MVP.

This plugin ships zero executable code today — confirmed directly: only `.claude-plugin/`,
`agents/*.md`, `skills/*/SKILL.md`, `templates/*.md` exist. Any hook-based option is a
first-time packaging change, not a tweak.

## Decision

Invoked/not-invoked status for a governed artifact is determined by a hook-recorded,
append-only ledger of real Skill/Agent tool-call outcomes — written by a small script
registered on Claude Code's `PostToolUse`/`PostToolUseFailure` events (verified current and
documented directly against `code.claude.com/docs/en/plugins-reference`, not assumed).
*Reporting* that ledger into a human-readable table (`/delivery:status`) stays skill-based,
because a skipped report is independently visible the moment someone opens the ledger file
directly — unlike a skipped mid-session action, which leaves no trace at all.

## Alternatives considered

### A — An invokable verification skill (e.g. `/delivery:verify-invocation`)

**Why it was attractive:** no packaging change; stays inside the plugin's all-markdown model.
**Why rejected:** this is the exact failure under review. Nothing forces the agent to invoke
it — a skipped verification skill is invisible in exactly the way a skipped `/delivery:prd`
call already was.

### B — A `Stop`-hook that blocks the session from ending unless a check ran this turn

**Why it was attractive:** the strongest possible guarantee; matches the mechanism the PRD's
own Assumptions section first named.
**Why rejected:** this is a *blocking* requirement, which belongs to the deferred
self-correction gate (`FR-13`–`FR-16`), not to `FR-1`–`FR-4`'s reporting requirement.
Building it now would silently pull deferred scope into this release without a real
decision to do so. It is also harder to build correctly: `Stop`/`SubagentStop` hand a hook
the final assistant *text*, not a structured tool-call list, and fire after the harness's own
transcript record may still be lagging — `PostToolUse` fires at the tool call's own
resolution, with that call's real name and outcome, no reconstruction needed.

## Consequences

**We gain:** an invoked/not-invoked determination the orchestrating agent cannot narrate
around, because the harness — not the agent's own text — decides when the hook fires. This
is also what keeps the deferred self-correction gate genuinely deferrable rather than
secretly load-bearing.

**We accept:** the plugin now ships and must maintain real executable code for the first
time — a packaging and trust-surface change, not just a doctrine change. The ledger's
accuracy also depends on tool-call field shapes that are not a documented public contract
(Spike 2), so this needs re-verification if Claude Code's hook payload shape changes.

**We will need to revisit this if:** the self-correction gate (Stage 2) ships and needs
blocking semantics this ledger doesn't provide — at which point a `Stop`/`SubagentStop`
hook is added *alongside* this one, reading the same ledger rather than replacing it; or if
Spike 1 finds `PostToolUse` does not fire reliably enough to trust, in which case this
decision is void and Alternative B must be reconsidered despite its cost.
