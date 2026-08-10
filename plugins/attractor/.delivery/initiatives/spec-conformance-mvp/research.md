# Feature research: correct attractor implementation + pipeline-authoring layer

> Phase 2 artifact. Owned by the pipeline, informed by direct source reading (GitHub API), not web search.
> Last updated: 2026-08-05
> Every claim is marked **verified** (source read), **reported** (secondary), or **assumed** (inference). Unmarked claims are not permitted.

## Research method

No live web search was available or used. All prior-art and domain-constraint claims below come from directly fetching and reading primary sources via `gh api` — the `strongdm/attractor` specification (2091 lines, fetched verbatim, re-fetched multiple times across this effort to catch upstream drift) and `microsoft/amplifier-bundle-attractor`'s full source tree (~30 files read in full: agents, context docs, authoring guides, four example pipelines executed directly against this engine, not read as prose). This is **verified**, source-read research, not web-search synthesis — marked per claim below.

## Prior art

### `microsoft/amplifier-bundle-attractor`

**Approach:** implements the same `strongdm/attractor` specification on top of Microsoft's Python `amplifier` framework — a module-registry-based orchestrator with per-provider agent bundles (Anthropic/OpenAI/Gemini), a full authoring layer (`attractor-expert` agent, `attractorify` skill), and a documented pattern library (`PIPELINE_DESIGN_PRINCIPLES.md`, `PIPELINE_PATTERNS.md`, `ROUTING-REFERENCE.md`).

**Gets right (verified, source-read):** a working end-to-end authoring flow — a skill that runs a three-question fitness test, produces a `.dot` graph, and delegates to an independent verifier before handing off; a documented tier discipline (code-tier for determinism, LLM-tier for generative work) that maps directly onto this project's own doctrine, arrived at independently; a fail-closed bash gate pattern nearly identical in spirit to this project's own goal-gate incident. Sixteen-plus example pipelines and a pattern catalog, all committed.

**Users complain about (inferred from their own documented incident history, `docs/designs/CODE-REVIEW-CHECKLIST.md`; reported, not observed):** the same class of failure this project's doctrine exists to prevent — silent routing sentinels, verdict contracts a model can subvert, `HandlerRegistry` bugs that recurred five times before a review checklist was written specifically to catch them.

**Diverges materially (verified by direct execution against this engine):** their engine's routing surface is wider than ours by default — a `report_outcome` tool gives any box node routing vocabulary; ours restricts structured verdicts to `goal_gate=true` nodes only. Their `outputs=` attribute is scoped to subgraph/folder nodes; ours is a general per-node dataflow contract with no subgraph analogue. Confirmed by running their own examples against this engine: two of four amplifier example pipelines lint clean and hard-abort on an unregistered handler (human gate, parallel fan-in); a third, also claimed clean by an earlier unexecuted trace, actually loops to this engine's 500-step cap on a missing test fixture, not an engine defect (`plugins/attractor/.superpowers/spec-conformance.md`, "Four amplifier example pipelines, actually executed").

**Source:** `github.com/microsoft/amplifier-bundle-attractor` · verified (full source read, four examples executed)

## Domain constraints

| Constraint | Applies because | Source | Confidence |
| :-- | :-- | :-- | :-- |
| The engine, not the model, must decide run success | This project's own founding incident: a judge's non-convergent verdict recorded as success, 2.4 hours, zero work product | `plugins/attractor/AGENTS.md:60-64` | verified |
| No implicit timeout may silently decide an unattended run | Same incident class; a multi-hour run must never be silently decided by a timer | `plugins/attractor/AGENTS.md` | verified |
| Extensions to the specification are permitted; contradictions are not | Standing project rule, upstream-borrowed | `plugins/attractor/AGENTS.md:13-29` | verified |
| Node ≥ 24 native TypeScript stripping — no build step, closed dependency set | Explicit environment constraint | `plugins/attractor/AGENTS.md` | verified |
| No API keys — the operator's own Claude Code login is the only auth path | Explicit design decision, carried since the earliest design doc | `plugins/attractor/AGENTS.md:8-11` | verified |

## Technical landscape

| Option | Maturity | Maintained | Licence | Might not fit because |
| :-- | :-- | :-- | :-- | :-- |
| Native TS engine (current) | Working, 462 tests | Active, this project | MIT | — this is the decided path |
| Port amplifier's Python engine directly | Mature, 16+ examples | Active, Microsoft | (unconfirmed) | Explicit design decision against it: Python dependency, no Claude Code plugin format, no bypass-permissions-native isolation story |
| Build on `@ts-graphviz/ast` vs. a hand-rolled DOT parser | Chosen (current) | Third-party, npm | (unconfirmed) | Already causes two known gaps (unquoted qualified ids, literal newlines in quoted values) worked around by a lexical pre-pass rather than replacing the dependency |

Not a live decision — recorded for completeness per this phase's template; the engine's stack was chosen and built before this reconciliation effort began.

## What the existing codebase already decides

| Path | Constraint it imposes |
| :-- | :-- |
| `plugins/attractor/engine/src/core/engine.ts` | Fixed, closed `HandlerKind` map — no runtime handler registration exists (§4.12 gap, `spec-conformance.md`) |
| `plugins/attractor/engine/src/backend/argv.ts` | Structured routing verdicts (`--json-schema`) restricted to `goal_gate=true` nodes only — any authoring-layer guidance must not assume amplifier's wider `report_outcome` surface |
| `plugins/attractor/AGENTS.md`'s doctrine list | Seven non-tradeable extensions, each tied to a cited incident — any new authoring guidance must not contradict these, and any that appears to require deleting one is a stop-and-ask signal, not a design choice |
| No `.claude-plugin/plugin.json` anywhere under `plugins/attractor/` | Not installable via a marketplace today — forecloses "assume the user installed this normally" as a starting assumption for any persona or journey |

## Implications for the brief

Confirms rather than undermines the brief's framing. The one material addition: amplifier's own incident history (`CODE-REVIEW-CHECKLIST.md`, five recurrences of the same `HandlerRegistry` bug class before a checklist was written) is independent evidence that "loud aborts over silent degradation" and "verify against the running engine, not the report" are not this project's idiosyncrasies — a comparable, larger, longer-running implementation of the same specification converged on the same doctrine from its own separate incidents. Worth citing directly when the architecture phase justifies keeping this project's doctrine rather than simplifying it away.

## Gaps

| Question | Why it matters | How to answer |
| :-- | :-- | :-- |
| Has anyone besides this project's own author run a real (non-`--stub`) pipeline? | Every persona in the next phase will be `reported`/`assumed`, not `observed`, without this | No telemetry or issue tracker exists in this repo; would need real usage once installable |
| What does amplifier's own user base actually complain about, first-hand? | `CODE-REVIEW-CHECKLIST.md` gives internal engineering incidents, not end-user pain | No public issue tracker was checked (out of scope for this pass); would need a dedicated search if this becomes load-bearing |
| Real-dollar cost of the uncapped `retry_target` loop (R1) against a live `claude -p` backend | The 249-jump/7-second figure is `--stub`-only; real backend cost is unmeasured | Requires an authorized, budgeted live run — explicitly opt-in per this project's own testing rules (`ATTRACTOR_LIVE=1`) |
