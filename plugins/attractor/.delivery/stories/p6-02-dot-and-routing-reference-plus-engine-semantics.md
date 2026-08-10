---
id: p6-02
title: Reference material — dot-reference.md, routing-reference.md (ported+corrected), engine-semantics.md (from scratch)
status: ready
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-14, FR-15]
depends_on: []
size: M
---

# Reference material — dot-reference.md, routing-reference.md, engine-semantics.md

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. See
[ADR-018](../decisions/ADR-018-reference-material-porting-split.md) for the full
porting-split reasoning — authoritative here, not re-derived.

## Goal

Three of the five `skills/attractorify/reference/` files, the ones with the highest
risk of manufacturing the-amplifier-veteran persona's (P-4) named wrong beliefs if done
carelessly:

- `dot-reference.md` — ported from amplifier's `context/dot-reference.md`, corrected to
  this engine's real shape/attribute set.
- `routing-reference.md` — ported from amplifier's `docs/ROUTING-REFERENCE.md`,
  corrected — **this is FR-15's home**: it must state, and only state, that a routing
  verdict is requested for `goal_gate=true` nodes and no others.
- `engine-semantics.md` — written from scratch, from this engine's own tests and
  source. Not a port of anything, despite the shared filename with amplifier's own
  `context/engine-semantics.md` — per `AGENTS.md`'s explicit instruction that this
  specific file must describe the shipped engine, not be inherited prose about a
  different one.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/skills/attractorify/reference/dot-reference.md` | new |
| `plugins/attractor/skills/attractorify/reference/routing-reference.md` | new |
| `plugins/attractor/skills/attractorify/reference/engine-semantics.md` | new |

## Content requirements

**`dot-reference.md`** — node shapes, edge attributes, `$param` substitution syntax,
`outputs=`/`runs_on=` dataflow attributes. States explicitly, as its own opening
section, the six handlers this build registers (`Handler.START`/`Mdiamond`,
`Handler.EXIT`/`Msquare`, `Handler.CONDITIONAL`/`diamond`, `Handler.TOOL`/`parallelogram`,
`Handler.CODERGEN`/`box` or unshaped default, `Handler.PARALLEL`/`component`) and names
the three that exist in the spec/shape table but are **not** registered
(`Handler.HUMAN`/`hexagon`, `Handler.FAN_IN`/`tripleoctagon`, `Handler.MANAGER_LOOP`/`house`
— cite `dot/graph.ts`'s `SHAPE_TO_HANDLER` table and `core/engine.ts`'s
`defaultHandlers()`), each refused at lint time by `HAND-001` if used. This is FR-14's
direct textual enforcement — a document that only lists the six usable shapes, with the
three unusable ones named as refused rather than omitted (an author who doesn't know
`hexagon` exists in the spec at all might reinvent an ad hoc equivalent instead of
recognizing the refusal for what it is).

**`routing-reference.md`** — edge selection algorithm (label match, condition
evaluation, unconditional fallback), the `outcome=`/`preferred_label=` condition
vocabulary, and the verdict contract. The verdict-contract section must say: a
structured routing verdict is requested only when `node.attrs.goal_gate === 'true'`,
matching `wantsVerdict` (`plugins/attractor/engine/src/backend/argv.ts:42-43`) exactly
— quote the function. Do not describe a `report_outcome`-style mechanism available to
every LLM node; that is amplifier's model and this engine's the-amplifier-veteran
persona names it as a specifically wrong belief
(`.delivery/personas/the-amplifier-veteran.md:50`).

**Both files**: do not state what any lint code number means. Link to
`plugins/attractor/README.md`'s `## Lint rules` section instead (already accurate,
already maintained) — per ADR-018, this closes the renumbering landmine (P-4's other
named wrong belief, `the-amplifier-veteran.md:52`) by removing the duplicate source of
truth rather than trying to keep two copies in sync.

**`engine-semantics.md`** — written from the engine's own tests and source, covering:
routing/edge-selection (cite `core/edge-select.ts`), context substitution (cite
`core/substitute.ts`), the verdict contract (cite `backend/argv.ts:42-43` again, same
exact statement as `routing-reference.md` — do not let the two files drift into two
different wordings of the same fact), fail-loud behavior on an unregistered handler
(`HAND-001`), retry semantics (cite `core/retry.ts`), and the §11.3 goal-gate-only
verdict rule (`AGENTS.md`'s own "An unresolved failure is recorded and said out loud —
but it does not change the verdict" entry — quote it, don't paraphrase). Every claim
must cite a real file/line or a real test name in `plugins/attractor/engine/`; a claim
with no citation does not go in this file.

## Relevant design decisions

- **[ADR-018](../decisions/ADR-018-reference-material-porting-split.md)** — the
  near-verbatim / port-then-correct / from-scratch split and why, including the
  `model_stylesheet`/`examples/gates/` corrections that also apply to the *other* two
  reference files (p6-03), not just these three.

## Acceptance criteria

- [ ] `FR-14` — `dot-reference.md` lists exactly the six registered handlers as usable,
      and separately names the three unregistered ones as refused (not silently omitted,
      not presented as usable).
- [ ] `FR-15` — `routing-reference.md`'s verdict-contract section states the
      `goal_gate=true`-only rule, citing `argv.ts:42-43`'s `wantsVerdict` by exact
      function name and file path.
- [ ] `FR-15` (consistency) — `engine-semantics.md`'s own verdict-contract statement
      matches `routing-reference.md`'s wording (not necessarily character-identical, but
      no contradiction — both must say `goal_gate=true`-only, neither may imply any
      broader verdict-eligible node set).
- [ ] Neither `dot-reference.md` nor `routing-reference.md` states what any `TOPO-`/`COND-`/
      `TYPE-`/`HITL-`/`CMD-`/`RUNS-`/`DATA-`/`GATE-`/`HAND-`/`PAR-` code means; both link to
      `README.md#lint-rules` (or the equivalent anchor) instead.
- [ ] Every factual claim in `engine-semantics.md` about this engine's behavior cites a
      real file path (and line number or test name) in `plugins/attractor/engine/` —
      spot-checked by re-opening each citation and confirming it says what the doc claims.
- [ ] The doc-consistency check from `architecture.md`'s Test strategy table (grep-based,
      not manual) exists and passes: no reference file names `hexagon`/`tripleoctagon`/
      `house` as usable, and `routing-reference.md` does not contain language implying a
      non-gate node receives a structured verdict.

## Test approach

**Level:** doc-consistency, not unit/integration — these are markdown files, not code.
Write one small script (or a `node --test` file using plain string checks) implementing
the two grep-based checks named in `architecture.md`'s Test strategy table:
(1) no reference file lists `hexagon`/`tripleoctagon`/`house` as a usable shape, (2)
`routing-reference.md` contains the `goal_gate=true` framing and does not contain
verdict language scoped to "every node" or unqualified "LLM node." Place it at
`plugins/attractor/skills/attractorify/reference/check-consistency.test.ts` (runs under
`node --test` from `engine/`... **no** — this lives outside `engine/`, so it needs its
own invocation; simplest is a plain Node script run via `node
skills/attractorify/reference/check-consistency.mjs`, not wired into `engine`'s test
runner, since the reference material isn't inside the `engine/` package). Document the
run command in the script's own header comment.

**Run with:** `node plugins/attractor/skills/attractorify/reference/check-consistency.mjs`
from the repo root.

## Out of scope

- `pipeline-design-principles.md`, `pipeline-patterns.md` — p6-03.
- The worked examples referenced by these docs — p6-07 (this story may leave forward
  references to example filenames that don't exist yet; do not block on that, but do
  not claim any example "works" here either — only p6-07 earns that claim).
- Any engine code change — this story is docs only.

## Dependencies

None. Can proceed in parallel with p6-01.
