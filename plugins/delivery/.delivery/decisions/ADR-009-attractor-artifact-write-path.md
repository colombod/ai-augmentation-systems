# ADR-009: Compiled attractor handoff artifact writes to `.delivery/sprints/`, not `.attractor/`

**Status:** accepted
**Date:** 2026-08-13
**Deciders:** Solution Architect

## Context

`OQ-13` (`prd.md`) was punted to architecture because neither existing runner mode's write-path convention transfers cleanly to `attractor`. `superpowers` writes into `docs/superpowers/...` because its `writing-plans` skill actively looks there; `generic` writes into `.delivery/sprints/` because it has no target-runner directory convention of its own. `attractor`'s CLI takes a bare file-path argument (`attractor lint pipeline.dot`) with no directory-lookup convention of its own — the one attractor-owned convention that exists is `--run-dir`, defaulting to `.attractor/runs/<timestamp>`, and this repo's root `.gitignore` excludes `.attractor/` entirely (verified directly).

`delivery:chief-of-staff` was consulted before this reached the operator (per direct correction earlier in this initiative): it declined to answer, correctly, since neither existing convention is asserted anywhere as the pattern a third mode inherits.

## Decision

The compiled `.dot` pipeline and its manifest write to `.delivery/sprints/<n>-<slug>-attractor.dot` and `.delivery/sprints/<n>-<slug>-attractor-manifest.md` — alongside the sprint scope package, matching `generic` mode's naming pattern. Only the **run output** (checkpoints, event log) uses attractor's own `--run-dir`, `.attractor/runs/<slug>-<compile-timestamp>`.

## Alternatives considered

### Mirror `superpowers`, write into a runner-owned tree (`.attractor/pipelines/`)

**Why it was attractive:** consistent with Mode A/B's precedent of writing into the target's own space.
**Why rejected:** `.attractor/` is gitignored — a durable, `FR-5`-traceable artifact a reviewer must be able to read "before or after a run" (`prd.md` S-2) cannot default to a location `git status` doesn't even see.

### A new top-level `.attractor-pipelines/` convention outside both existing trees

**Why it was attractive:** avoids overloading either directory's existing meaning.
**Why rejected:** adds a third top-level convention for one feature; `.delivery/` is already this plugin's tracked-artifact home and needs no sibling.

## Consequences

**We gain:** the artifact is git-tracked, diffable, and consistent with every other governed handoff artifact this plugin produces.

**We accept:** the pipeline definition and its run output live in genuinely different directories — a real split, but one attractor's own CLI already expects (`pipeline.dot` and `--run-dir` are always separate arguments).

**We will need to revisit this if:** attractor ever documents a pipeline-discovery convention of its own that supersedes a bare path argument.
