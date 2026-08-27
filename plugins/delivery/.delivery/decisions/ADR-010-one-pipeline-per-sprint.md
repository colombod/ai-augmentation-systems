# ADR-010: One compiled pipeline per sprint, not one per story

**Status:** accepted
**Date:** 2026-08-13
**Deciders:** Solution Architect

## Context

`OQ-4` (`prd.md`) asks whether cheaper per-story remediation gets designed, given `NFR-3`'s stated fact: attractor has no resume-from-checkpoint path (confirmed by a direct kill/resume test recorded in `plugins/attractor/.delivery/brief.md` — cited as a fact about the documented/tested engine, not its roadmap).

## Decision

Compile the whole sprint's dependency graph and every story's acceptance gates into one `.dot` file; one `attractor run` per sprint attempt.

## Alternatives considered

### One `.dot` file per story, run independently, chained by delivery re-invoking attractor per story

**Why it was attractive:** a non-convergent story wouldn't force re-running stories already `done`.
**Why rejected:** without a resume mechanism, a downstream story's own run needs its dependencies' outputs *fresh*, inside its own process's dataflow ledger — the ledger is run-scoped, not documented as persisting across separate `attractor run` invocations. Either delivery re-feeds a prior run's claimed outputs via `--param` (trusting a completed run's self-report instead of the ledger re-verifying it — reintroducing exactly the self-report risk this feature exists to close), or each per-story run re-derives its dependencies from scratch (no savings, just relocated and duplicated cost).

## Consequences

**We gain:** the dataflow ledger governs the whole sprint's dependency graph faithfully in one run, and `FR-10`'s blocking behavior works exactly as attractor documents it — no re-derivation, no re-trusted claims.

**We accept:** `NFR-3`'s real cost, stated plainly in the manifest every sprint — any non-convergent story means re-running the entire sprint's pipeline, not just the affected story.

**We will need to revisit this if:** attractor documents a real cross-run resume or ledger-persistence mechanism.
