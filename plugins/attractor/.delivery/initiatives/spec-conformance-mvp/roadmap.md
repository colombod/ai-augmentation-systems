# Delivery roadmap: attractor — human-gate self-report guard (FR-18/HITL-003) and beyond

> Phase 9 artifact. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-08-06
> PRD: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/prd.md` · Architecture: `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/architecture.md`
> No `.delivery/initiatives/spec-conformance-mvp/prioritization.md` file exists; the Product Owner's scoring/staging and this
> Program Manager's feasibility check, both supplied inline, stand in for it. No
> `.delivery/glossary.md` exists either — terms below match the PRD's; new ones proposed at
> the end, not coined silently.

## Constraints

**Team:** not stated upstream. Every ADR here (ADR-001–005) names one Solution Architect
deciding and one implementer building. Assumed: **one implementer, single-threaded**, until
told otherwise — confirm before Phase 2 needs a real calendar.
**Fixed dates:** none found in the PRD, architecture, or `carry-forward.md`.
**Fixed variable: scope.** No external date is fixed; the plan optimizes for landing FR-18
correctly and surfacing the open decisions blocking everything after it, not a stated date.

## Sequencing rationale

Phase 0 is not sequenced — already in production (PRs #1–#4), recorded only for a complete
requirement-coverage table. Everything real starts at Phase 1: FR-18 (HITL-003) is the only
unbuilt requirement with **zero open product or architecture questions**, confirmed by tracing
it against the blocked question clusters directly against source, not the PRD's prose
grouping. It is staged first less because it proves the riskiest assumption and more because
it is the *only* buildable unit — everything else is blocked on a decision this document
cannot make. Risk-first here therefore means pointing at the open questions, not at code
sequencing — see Dependencies outside our control and Phase 2's correction below.

## Phases

### Phase 0: Already shipped (MVP) — retrospective, not planned

**Entry criteria:** none — complete, merged (PRs #1–#4).
**Delivers:** FR-1, FR-2, FR-3, FR-4, FR-10, FR-11, FR-17a.
**Demonstrable exit (already shown):** install `attractor` via the marketplace without
cloning the monorepo; `attractor doctor` correctly reports a missing `claude` on `PATH`; an
invalid `plugin.json` fails with a message naming the file and the parse problem; a plain
node's FAIL no longer wrongly consults the graph-level `retry_target` (D7); a direct
`new Engine(...)` embed refuses a lint-dirty graph exactly like the CLI (F10); lint refuses,
before a run starts, any node resolving to `Handler.PARALLEL`/`FAN_IN`/`MANAGER_LOOP`.
**What it taught:** the packaging approach works end-to-end, and both founding-incident-
adjacent bugs (D7, F10) were real and fixable, not hypothetical.

### Phase 1: FR-18 — HITL-003, the self-report guard

**Entry criteria:** none beyond Phase 0 — `declaredOutputs`/`effectiveOutputs`, the `Handler`
enum, and the `HAND-001` pattern in `lint.ts` all exist unconditionally. No dependency on
`Handler.HUMAN` being registered (HITL-001's own fixtures already lint human-gate nodes with
`HUMAN` unregistered — direct precedent). **Delivers:** FR-18 only.
**Demonstrable exit:** run `attractor lint` (or the equivalent test) against two side-by-side
fixtures — one where a `Handler.CODERGEN` node feeds `human.context=` into a direct-successor
gate whose `human.channel` includes `"agent"` (WARNING fires, message names the node and the
key), one safe variant that lints clean (channel is `"human"`-only, or the context key traces
to a non-adjacent node). Same demo shape ADR-005 already used for HAND-001.

**Not "done" at the lint rule passing.** The feasibility check and Feature Critic review each
independently surfaced gaps that don't block starting but change what "done" means. All
resolve inside one document, **ADR-006, written first**, before any fixture — detail in the
work-item table.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| **ADR-006** — (a) fixes the PRD's dead "design doc's Residual Risk section" citation (`prd.md:80,102`; confirmed absent from every candidate file — channels-design headings, `architecture.md`'s differently-named `## Risks`, every existing ADR's Context/Decision/Alternatives shape) by writing the section or repointing to `carry-forward.md`'s Plan 4 paragraph; (b) resolves the FR text's own reading ambiguity as its opening decision — does the rule fire only when the direct predecessor resolves to `Handler.CODERGEN`, or for any direct predecessor whose declared/effective output matches — before fixtures are written, not after a reviewer picks the other reading; (c) adds an Open Questions row (owner: PO or SA) tracking the multi-hop and `Handler.TOOL`-without-`outputs=` shapes FR-18's own prose admits are out of scope, so they survive this phase shipping instead of living only in a parenthetical; (d) states explicitly that the WARNING is visible on the CLI's pre-run lint path today but **not** on a direct-embed `Engine` path until Open Question 7/FR-12 resolves — the `agent` channel's likeliest unattended usage is exactly the path this doesn't reach | S | high | none |
| Direct-predecessor-edge helper in `graph.ts` (mirrors GATE-001's inline pattern, ~5 lines) | S | high | ADR-006 (b) |
| `HITL-003` lint rule block in `lint.ts` (~50–80 lines, HAND-001-sized) | S | high | predecessor helper |
| Fixtures + tests in `lint.test.ts` — positive/negative pair, plus a third pinning ADR-006(b)'s reading (e.g. a `Handler.TOOL` node with declared `outputs=` in the same shape), anchor-style | S | high | lint rule block |
| SKILL.md/README caveat: WARNING not visible on embedded-`Engine` path pending FR-12 | S | high | ADR-006 |

**Verification in this phase:** unit-level only, same file/idiom as HITL-001/HAND-001 — no new
test infrastructure, no integration or subprocess test (no runtime handler consumes these
attributes yet).

**Cut list — dropped first if late, in this order:**
1. SKILL.md/README caveat about FR-12's embedded-path gap — fast-follow, not a blocker to ship.
2. Narrow ADR-006's Residual Risk section to HITL-003's own scope; the Open Questions row
   becomes a one-line addition, not a fuller write-up.
3. If the CODERGEN-scope reading proves contentious, ship the narrower literal reading and
   file the broader one as a Residual Risk bullet rather than resolving it in this phase.

Deciding this now beats deciding it under pressure.

### Phases 2–6: named, not planned in detail

Two corrections worth stating in prose because missing either mis-routes an owner: **Phase 2
is not blocked by an open product question** — Open Questions 1/2 (which blocked FR-8) were
**resolved 2026-08-06**; what actually blocks it is an unstarted architecture pass, nobody's
been asked to schedule. **Phase 3 (Open Question 9) is the single highest-leverage open
decision on this whole board** — this project's own founding-incident class — and currently
owns no stage at all. Everything else below is table detail, not further narrative.

| Phase | FRs | Blocked by | Owner | Depends on | Effort |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 2 — Human-gate core | FR-5, FR-6, FR-7, FR-8 | **Not** Q1/Q2 (resolved 2026-08-06, channels design, 5/5 convergence) — an unstarted architecture pass: no ADR covers the `agent`/`CommandChannel` hops or `GateContext`/`selectEdge` wiring; `architecture.md` predates the resolution and says so in its own Scope line; `Handler.HUMAN` still unregistered | Solution Architect — schedule the pass | `agent` sub-slice depends on Phase 1; the `human`-channel path does not and could be architected in parallel | Unscoped — no estimate until the architecture pass exists |
| 3 — Founding-incident verdict | FR-9a / FR-9b (mutually exclusive) | Open Question 9 — runtime-verdict change (FR-9a, reverses a previously-withdrawn fix) vs. lint-time-only refusal (FR-9b) | Product Owner + Solution Architect jointly — `AGENTS.md:157`'s "if a change appears to require deleting one of these, stop and ask" applies to FR-9a specifically | None | Unscoped |
| 4 — Embedder diagnostic visibility | FR-12 | Open Question 7 — should an embedder observe WARNING-severity diagnostics at all; a scope call, not an engineering unknown | Solution Architect | Also closes Phase 1's own FR-12 caveat (embedded-`Engine` WARNING visibility) — scope with that in view, not purely as S6 ergonomics | Unscoped |
| 5 — Parallel fan-out | FR-17b | Open Questions 3, 4, 5 — branch-declaration syntax, worktree isolation default, fan-in-on-all-fail semantics, all undecided | Product Owner | None | PRD's pre-architecture `L` stated as a floor, not a ceiling; not revised here |
| 6 — Authoring skill | FR-13, FR-14, FR-15, FR-16 | Not an open question — explicit Product Owner deprioritization: P-2 (MVP's only fully-served persona) needs none of it | Product Owner | Contingent on Phase 2 proving the channels design, and on P-1/P-4 becoming a committed priority — P-4 is this project's weakest-grounded persona (`assumed`, not `reported`) and FR-15 rests on that one belief | Unscoped |

## Second prioritization pass — inversion check

FR-18's Product-Owner-scored effort (`S`) matches this Program Manager's independent
feasibility check (`S`, high confidence, same HAND-001/ADR-005 precedent). **No inversion
found.** No comparable check exists for Phases 2–6 — none has an architecture pass yet.

## Critical path

Phase 1's own path is short and deliberately low-risk, not the program's real one:

```
ADR-006 (scope + citation fixes) → predecessor-edge helper → HITL-003 lint block → fixtures/tests
```

**The program's actual critical path runs through decision-making, not code:** Open Question 9
(FR-9a/FR-9b, Phase 3) has no stage and no scheduled decision date — see Risks and Dependencies
below. To shorten it, that decision session needs scheduling now, in parallel with Phase 1, not
queued behind it — the two share no owner or component, so concurrency costs nothing.

## Dependencies outside our control

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Open Question 9 decision (FR-9a vs FR-9b) | Product Owner + Solution Architect | Before Phase 3 can be sized; recommended in parallel with Phase 1, not after | Open | Founding-incident-class gap stays unowned and unstaged indefinitely |
| Open Question 7 decision (embedder WARNING visibility) | Solution Architect | Before Phase 4, and before Phase 1's FR-12 caveat can be closed | Open | Phase 1's WARNING stays invisible on the embedded-`Engine` path with no committed date |
| Open Questions 3/4/5 decisions (branch syntax, worktree isolation, fan-in-on-all-fail) | Product Owner | Before Phase 5 can be sized at all | Open | `L` effort estimate stays a floor; S3 stays fully blocked |
| Architecture pass for the resolved channels design (`agent`/`CommandChannel`, `GateContext`/`selectEdge`) | Solution Architect | Before Phase 2 can be sized | Not scheduled | Phase 2 stays "named, not planned" indefinitely even though its product question is resolved |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1 | 0 | Shipped |
| FR-2 | 0 | Shipped |
| FR-3 | 0 | Shipped |
| FR-4 | 0 | Shipped |
| FR-5 | 2 | Named, not planned — architecture-pass gap, not an open question |
| FR-6 | 2 | Named, not planned — same gap |
| FR-7 | 2 | Named, not planned — same gap |
| FR-8 | 2 | Named, not planned — `agent` sub-slice also depends on Phase 1 |
| FR-9a | 3 | Named, not planned — Open Question 9 |
| FR-9b | 3 | Named, not planned — mutually exclusive alternative to FR-9a, same question |
| FR-10 | 0 | Shipped |
| FR-11 | 0 | Shipped |
| FR-12 | 4 | Named, not planned — Open Question 7 |
| FR-13 | 6 | Named, deprioritized — no open question, PO scope call |
| FR-14 | 6 | Named, deprioritized |
| FR-15 | 6 | Named, deprioritized — rests on `assumed`-grade P-4 evidence |
| FR-16 | 6 | Named, deprioritized |
| FR-17a | 0 | Shipped |
| FR-17b | 5 | Named, not planned — Open Questions 3/4/5 |
| FR-18 | 1 | Fully planned this phase |

No `FR-n` lands in no phase.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| PRD's "Residual Risk section" citation resolves to nothing | confirmed today | medium — breaks the audit trail for anyone tracing FR-18's known blind spots | ADR-006 writes the section or repoints the citation, inside Phase 1 | implementer |
| CODERGEN-scope reading picked implicitly, overturned mid-phase | medium | low-medium — rework of fixtures, not of the rule's core logic | Resolve as ADR-006's opening decision, before fixtures | implementer |
| Named residual gaps (multi-hop, `Handler.TOOL`-without-`outputs=`) never revisited | high if untracked | medium — the self-report gap is treated as closed on paper when it isn't | Open Questions row added in ADR-006, owner assigned | Product Owner / Solution Architect |
| HITL-003's WARNING invisible on embedded-`Engine` path, read as uniformly mitigating | medium | medium — false confidence for the `agent` channel's likeliest unattended usage | State the FR-12 dependency explicitly in the rule's doc and in this roadmap (done above); do not close Phase 1 as if it were resolved | implementer / Solution Architect |
| Open Question 9 stays unowned by any stage indefinitely | high without action | critical — this project's own founding-incident class | Schedule the PO+SA decision session in parallel with Phase 1 | Product Owner |
| Phase 2 mislabeled as "blocked on open questions" when it is really an unstarted architecture pass | medium | low-medium — the wrong owner gets pinged, or nobody schedules the actual missing step | Corrected explicitly in this document's Sequencing rationale and Phase 2 entry | Program Manager (this document) |
| Locked attribute names (`human.channel`, `human.context`, design doc §5) diverge once Phase 2's implementation actually lands | low — names are a resolved 5/5-converged decision, not open prose | medium — Phase 1's fixtures would need updating | ADR-006 cites design doc §5 explicitly with a note to revisit if Phase 2 diverges | implementer |

## Buffer

No calendar exists to buffer against (see Constraints). The structural buffer here is that
**Phase 1 is deliberately over-scoped on process** (ADR-006, an Open Questions row, a doc
caveat) relative to its code (one lint rule, one helper): if any named gap runs long, the cut
list above absorbs it without touching the lint rule's own correctness or test coverage.

## Terms this roadmap needed and the glossary does not yet have

No `.delivery/glossary.md` exists. Proposed, not coined new — reusing the Feature Critic's own
proposal rather than adding a fifth synonym to the four already in use (`self-report
hazard`/`risk`/`evidentiary gap`/`shapes`):

- **self-report gap** — a human- or agent-facing approval gate whose displayed evidence
  traces back to the very node the gate exists to check, so approval verifies nothing
  independent of the work being approved. Referent: FR-18/HITL-003, `carry-forward.md` Plan 4.
- **direct predecessor** — a node with a single edge into the gate node being checked, as
  opposed to a multi-hop chain of intermediate nodes. Referent: FR-18's own text ("single-hop,
  structurally-provable direct predecessor"), needed because the term is coined once, in the
  FR itself, with no definition anywhere else.
