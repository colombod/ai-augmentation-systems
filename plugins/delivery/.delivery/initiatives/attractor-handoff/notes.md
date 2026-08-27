# Notes: attractor-handoff

> Authored narrative not derivable from story frontmatter — build order and cross-story
> reconciliation. The ID/title/phase/status table itself is computed live by `/delivery:status`,
> per `.delivery/stories/README.md`.

## Phase 1 — build order and dependency graph

```
attractor-handoff-01 (Spike 5) ──┬──> attractor-handoff-02 (Spike 1, OQ-2)
                                  └──> attractor-handoff-06 (sizing script)

attractor-handoff-03 (Spike 2, OQ-3) ── independent
attractor-handoff-04 (Spike 3, OQ-9) ── independent
attractor-handoff-05 (Spike 4, OQ-10) ── independent
attractor-handoff-07 (verdict script) ── independent
attractor-handoff-08 (enum widen)     ── independent
```

Six of eight independently pickable day one: `01, 03, 04, 05, 07, 08`. Only `02` and `06` are gated, both on `01` alone.

## Readiness

`ready`: `01, 02, 05, 06, 07, 08`. `draft`: `03, 04` — both draft for the same honest reason: each writer actually ran real commands against the live `attractor` CLI while writing the story and found a genuine open technical question, left as a stated escalation rather than resolved or hidden. That is the correct outcome of a spike, not a craftsmanship gap — do not mark either `ready` under schedule pressure per the skill's own instruction.

## Cross-story findings — real, convergent, found by independent writers running real commands

**1. A real gap in `ADR-011`'s own routing (found by `attractor-handoff-03`, not yet resolved).** The compiled acceptance gate routes on three `condition=`-matched edges against `context.tool.last_line` (`gate_pass`/`gate_retry`/`gate_giveup`). A hang *inside* the compiled check — before the counter/label logic ever runs — produces a `FAIL` matching none of the three conditions. `core/edge-select.ts`'s own fail-fast doctrine forbids an unconditional edge from carrying that forward. Whether this dead-ends the run or falls through to `retry_target=`/`fallback_retry_target=` is exactly what `NFR-2`'s "counts as one consumed attempt" requires to be true, and `ADR-011` as written declares neither attribute. `attractor-handoff-03` makes this an explicit acceptance criterion (observe, record, escalate by name to Solution Architect if it's a dead-end) rather than silently assuming the mechanism just works. **This may require an `ADR-011` amendment once `attractor-handoff-01` and `-03` are both done** — flagging now so it isn't missed.

**2. `--stub` alone does not exercise worktree creation (found by `attractor-handoff-04`, confirmed by real execution).** `attractor run <fixture> --stub` never touches `--cwd`'s isolation machinery at all — confirmed live. The flag combination that actually creates a real worktree without a paid `claude -p` backend is `--stub --worktree`. Any future story or documentation citing "`--stub` dry run" for worktree/permission testing should say `--stub --worktree` explicitly, or it will silently test nothing.

**3. Box-shaped (self-report fallback) acceptance gates are not covered by `NFR-1`'s sizing formula (found by `attractor-handoff-06`).** The formula `≈ 2 × Σ(attempt_bound per gate) + fixed_overhead` is scoped strictly to `ADR-011`'s parallelogram fix/gate loop. A `box`-shaped gate can carry its own `max_retries=` bound the script doesn't account for. `attractor-handoff-06` specifies the script to *refuse* on any such node (`unsizable: true`) rather than silently under-counting, and flags the gap as a Solution Architect item for Phase 2 (where `box`-shaped gates actually get compiled).

**4. Two stale citations, found independently by two different writers (`attractor-handoff-02` and `-06`), same correction both times.** `plugins/attractor/.delivery/prd.md` does not exist. The real path is `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md`; even that file's own `engine.ts:199` citation for the 500-node-visit ceiling is stale — the real constant (`DEFAULT_MAX_STEPS = 500`) is at `engine.ts:142`, enforced at `engine.ts:735`. Both corrections are recorded in both stories directly. **Neither `architecture.md` nor `roadmap.md` has been corrected to match** — both still carry the original (now known-stale) citation. Not fixed here; a cheap follow-up whenever those documents are next touched.

**5. The truncation string does not live in `events.jsonl` (found by `attractor-handoff-02`, contradicting an assumption baked into this story's own dispatch instructions).** On step-cap truncation, `events.jsonl` only ever records `{type:'pipeline.end', node, status:'FAIL'}` — indistinguishable from an ordinary dead-end. The literal string (`step cap of 500 reached without terminating`) lives in `RunResult.notes`, printed only to CLI stdout. `attractor-handoff-02`'s test approach was corrected to grep CLI stdout, not `events.jsonl`.

## Repo hygiene note

While verifying `attractor-handoff-04`'s real worktree-testing claims (2026-08-14), found and removed one stray empty branch (`attractor/attractor-oq9-run2-f47030a0`, zero commits ahead of `main`) left over from a real `--stub --worktree` test run — the worktree itself had been cleaned up correctly, only the branch ref survived. No content was lost; confirmed via `git diff main...<branch> --stat` (empty) before deletion.
