# Product brief: attractor — correct spec implementation and pipeline-authoring layer

> Phase 1 artifact. Owned by Product Owner and Business Analyst.
> Status: draft · Last updated: 2026-08-05

**Mode:** assess · **Word count:** 1587 (target 1200, cap 2000, excludes tables/code — counted with a script, not estimated). Over target, under cap: a challenge review (`plugins/attractor/.delivery/reviews/brief-01.md`) found and fixed 15 real findings, 4 of them blocking, including a claim about amplifier's example pipelines that turned out to be a paper trace rather than an execution when actually run. The added prose is those fixes and their evidence, not restatement.

## Coverage

Four lenses ran independently against `plugins/attractor/`, `plugins/attractor/.superpowers/spec-conformance.md`, the fetched `strongdm/attractor` specification, and `microsoft/amplifier-bundle-attractor` as a comparison implementation. None saw another's output before filing.

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value (product-owner) | yes | yes — the dataflow opt-in gap, the retry-loop cost, resume |
| precision (business-analyst) | yes | yes — two specification self-contradictions, an undocumented severity tightening |
| absence (feature-critic) | yes | yes — marketplace infrastructure literally absent, §9.7 and §4.12 blind spots |
| decay (qa-strategist) | yes | yes — citation drift, an audit claim that was false until an unrelated commit fixed it |

**Findings by convergence:** 0 found by 3+ lenses · 2 by two · ~20 by one only.

Every lens surfaced material none of the others touched. The space is **not exhausted** — each pass, run again with a different prompt, would likely find more; the MVP boundary and cost table below should be treated as provisional on that basis, not final. Two independent research passes (not part of this brief's four lenses) ran in parallel on the same codebase and found a further ~15 items, filed in `spec-conformance.md`'s 2026-08-05 section. Per that section: three of the highest-severity new findings were each independently reproduced twice — once by the investigating pass, once directly against the real engine — before being trusted; this brief does not claim to know which three. A challenge review of this brief's own first draft then caught a further instance of the same failure mode inside the brief itself (an amplifier example claimed to "run clean" from a paper trace, not an execution) — corrected below, with the real run's output.

## Problem

`plugins/attractor/` is a from-scratch, native Claude Code implementation of the `strongdm/attractor` specification: a control plane where a DOT graph is the program and the engine — not the model — decides whether a run succeeded. It has 462 tests and a real doctrine born from a real incident (a goal-gate node recorded a judge's "NOT CONVERGED — 2 of 7 criteria pass" as success; the run "exited claiming victory with zero work product after 2.4 hours," `AGENTS.md:60-64`).

Three structural absences make the product's central promise untrue for a real user today, independent of how many individual findings are open:

1. **It cannot be installed.** No `.claude-plugin/plugin.json`, no marketplace entry, no `commands/`/`skills/`/`agents/` directory anywhere under `plugins/attractor/`. The only way to use it is to clone the monorepo and run `node dist/attractor.js` from inside the checkout.
2. **An author cannot create a pipeline without hand-transcribing the 93KB grammar.** Zero `.dot` files exist anywhere in this repository outside `node_modules` (confirmed: `find . -iname '*.dot'`). No skill, agent, or generator exists to help write one. `carry-forward.md` already states, of a committed example fixture, that it "would, on its own, have caught Plan 1's Critical finding" — and none has ever been committed.
3. **Entire specification subsystems are unimplemented, so whole classes of pipeline are inexpressible, not degraded.** Human-in-the-loop approval gates, parallel fan-out/fan-in, model-stylesheet routing, and sub-pipeline composition all parse and lint clean, then abort at runtime with `no handler registered`. Confirmed directly: amplifier's own `08-human-gate.dot` and `pr-review.dot` example pipelines both lint with **zero diagnostics** on this engine and both hard-abort three nodes in (verified by execution — see Success signals for the full table, including one claim this brief's own first draft got wrong).
4. **The specification's own extension point for exactly this problem doesn't exist.** §4.12 names a custom-handler registry as how an implementation is meant to grow past its built-in set. This engine builds a fixed, closed handler map at construction time — no registration API, no seam. So absence #3 above isn't a temporary gap an operator can work around; for anyone outside this project's own team, "loudly marked unsupported" is permanent.

A fourth thread cuts across all three: the audit document recording what's done has itself decayed. A "Confirmed conformant" claim (retry backoff defaults) was false from whenever it was written until an unrelated same-day commit happened to fix it; nobody had checked. Citations drifted separately in two files after later commits grew them — `engine.ts` by 300–700 lines, `lint.ts` by 100–200+ lines (open-ended) — a recurrence of exactly the failure the document had already caught and corrected once. A claim in an earlier draft of this brief itself ("amplifier's `03-conditional-routing.dot` runs clean") turned out to be a paper trace, not an execution — run for real, it loops to the 500-step cap; see Success signals. **"The tests are green," "the audit says conformant," and "an agent reasoned through the code" are all, as of this pass, insufficient evidence of correctness on their own** — several of today's highest-severity findings (a plain node's FAIL wrongly consulting a graph-level `retry_target`; a checkpoint's `current_node` silently `null` at every terminal save, success or failure alike) were found only by running a real graph through the real engine and reading the real output on disk.

## Who has it

Two distinct real users, conflated in an earlier draft of this brief — the amplifier examples that already run clean on this engine (see Success signals) can be copied and adapted without writing DOT from the grammar, so "must hand-write raw DOT" is false for one of them:

- **The operator.** Has a pipeline (their own or an adapted example) and launches it multi-stage, possibly unattended — a build-fix loop, a review gauntlet, an editorial pipeline — and **walks away**, metering real cost on their own login, trusting the orchestration layer, not the model, to be honest about whether the run succeeded. Needs installability and correct routing/retry/resume semantics. Does not need authoring help.
- **The author.** Has no pipeline yet and wants to describe a problem — "build a test suite using a parallel pipeline" — and get a lint-clean, spec-conformant, *actually runnable* graph back. Needs the ported expert-agent/skill layer. A fuller, evidence-graded treatment of both is in `plugins/attractor/.delivery/personas/`.

## Cost of the status quo

| Finding | Affected | Cost | Severity |
| :-- | :-- | :-- | :-- |
| No human-gate handler | anyone needing an approval step before an irreversible action | a lint-clean, spec-conformant graph hard-aborts at runtime | blocks a whole class |
| No parallel/fan-in handler | anyone needing independent concurrent workers reconciled after | sequential workaround changes what the pipeline *is*, multiplies wall-clock cost linearly | blocks a whole class |
| Not installable | every prospective user | zero discovery path via Claude Code; clone-and-run-from-checkout only | blocks a whole class |
| No authoring layer, zero examples | any first-time author | onramp is reading the grammar by hand; nothing to copy or diagnose against | degrades project-wide |
| `outputs=` opt-in-only dataflow protection | anyone whose graph omits it (plausible for a first draft; the attribute is undocumented outside this repo) | the exact silent-false-success shape the doctrine exists to prevent, still reachable by omission | **effectively defeats the product's core value proposition for the un-warned author** |
| `retry_target` loops uncapped except by a 500-step ceiling | cost-metered unattended runs | measured: 249 retry-target jumps, zero backoff, terminates only at the step cap with no diagnostic naming why | degrades, real dollar cost |
| Checkpoints never read back | any run that crashes or is interrupted | "resumable" is not true; a killed run cannot be resumed, must restart from zero | blocks operational reliability |
| D7: plain-node FAIL consults graph-level `retry_target` | any graph with a graph-level `retry_target` and a node that fails without its own retry attributes | routes past a failure §3.7 says should terminate the run — verified by direct execution, not inferred | new, Important |
| D3: checkpoint `current_node` is `null` at every terminal save (success or failure alike) | anything reading a checkpoint after a run ends | contradicts §5.3's own field definition; verified by direct execution | new, Important |
| F10: `Engine.run()` never checks lint — only the CLI does | anyone embedding the engine directly rather than shelling to the CLI (installability's likely shape) | an ERROR-severity, lint-dirty graph runs to silent `status: success` when the class is used directly — structurally the same shape as the doctrine's founding incident, worse than the "lint-clean-then-loud-abort" pattern this Problem section otherwise describes | new, Important |
| No custom-handler registry (§4.12) | anyone who hits an unimplemented handler and wants to add their own | the specification's own stated extension point doesn't exist; "loudly marked unsupported" is a permanent wall, not a documented workaround, for anyone outside this project | new, structural — see Problem |
| Audit citation drift (300–700 lines in `engine.ts`, 100–200+ in `lint.ts`) + one false "conformant" claim | anyone trusting `spec-conformance.md` as current | a recorded pattern now confirmed to recur, not a one-off | meta, Important |

## What changes if we solve it

An operator can install the plugin from the marketplace, describe a pipeline in plain language and get a lint-clean, runnable DOT graph back, and every pattern the specification or the amplifier reference implementation demonstrates either runs correctly on this engine or is explicitly, loudly marked as not yet supported — never silently. A crashed run resumes instead of restarting. A graph that omits `outputs=` still cannot silently report success on a real failure.

## Success signals

*(measured against commit `a9acf77`; re-verify before trusting the "Current" column past that point — see Problem §4 on citation decay)*

Every signal below is a real command run against a real graph, inspecting real output on disk — never a test-suite count by itself. Each is traceable to either the specification's own text or a documented usage pattern (amplifier's pattern library, once a persona/journey exists) — never an invented scenario.

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Specification's own worked examples run to their stated terminal state | `attractor run` (`--stub`) against §2.13's three examples, §8.6, §11.13's smoke test, verbatim from the fetched spec text | §2.13's three run correctly; §8.6 and §11.13 partially — checked directly this pass | 100%, and committed as golden-graph fixtures per `carry-forward.md`'s standing requirement |
| Amplifier's own example pipelines, adapted only for shape/attribute differences, run to completion | direct execution, per-example, all four fetched verbatim this pass | `01-simple-linear`: runs clean. `08-human-gate`, `pr-review`: lint clean, hard-abort on a missing handler (`human`, `parallel`), confirmed by execution. `03-conditional-routing`: lint clean, loops to the 500-step cap — its `gate` node runs a real `pytest` against a fixture file amplifier ships alongside the graph that this fetch didn't include; not a fair test until re-run with it, not counted either way. **1 of 4 clean, not "2 of 4" as an earlier draft of this brief stated from an unexecuted trace.** | stated support matches actual runnable status, with no example claimed as working that isn't, and no example evaluated without its real dependencies |
| Plugin installs via the marketplace and surfaces a discoverable command | `/plugin install attractor@ai-augmentation-systems` | fails outright — no manifest exists | succeeds |
| A run killed mid-pipeline resumes to the same terminal state a non-interrupted run reaches | kill, then resume, then diff `status`/`path` against an uninterrupted run | no resume code path exists | equal |
| A graph with a failing, un-`outputs=`-declared producer and a downstream consumer does not report overall success | construct the shape directly, run, inspect `status` | reports `status: success` — the exact silent-false-success shape the doctrine exists to prevent, still reachable by omission | the run never reports success on that shape, or the gap is named as an explicitly accepted risk |
| A named pattern, generated via the ported expert-agent/skill layer, **runs to its intended terminal state** — not merely lints clean | direct execution of the generated graph, same bar as every other row | impossible today, on two independent counts (no layer exists; lint-clean is already shown above not to imply runnable) | runs correctly, verified by execution, not by the skill's own say-so |
| §11's Definition-of-Done checklist, item by item | direct execution per item, not the checklist read as prose | **not yet tallied** — no item-by-item accounting exists anywhere in this repository; a prior draft of this brief cited spec-conformance.md for "~60% pass," a figure that document does not contain | 100%, or each remaining gap explicitly filed as a deliberate, documented extension |

## MVP boundary

*(Provisional — this list rests on findings from a single pass per lens, and the coverage section above states plainly that the space is not exhausted. Treat as a starting scope, not a locked one.)*

The smallest thing that delivers the value above, decided per item rather than left to be assumed:

- **Installable** — in scope.
- **Human gate, "working."** Two real interpretations exist and this brief picks neither by default: (a) a synchronously-blocking handler only, no durable park state, no cross-restart resume — weaker than the "walks away, trusts the control plane" operator persona above actually needs, but buildable without touching resume; or (b) the full park/notify/resume subsystem the design spec architects for it — which makes resume (below) a hard prerequisite, not a parallel-track nice-to-have. **Decide which before scoping a sprint against this brief** — sizing (a) as if it were (b), or vice versa, is an order-of-magnitude estimation error.
- **Parallel fan-out** — in scope, working or loudly marked unsupported.
- **Resume (checkpoint read-back)** — in scope if human-gate interpretation (b) above is chosen; otherwise explicitly deferred, and said so, not silently absent.
- **The `outputs=` opt-in gap** (the highest-severity line in Cost of the status quo) — in scope: a graph missing it must not be able to silently report success on a real failure. See the corresponding Success signal.
- **D7, F10** (routing/embedding correctness bugs, both "Important") — in scope as bug fixes; cheap relative to the subsystem work above.
- Authoring assistance (the expert agent/skill) is valuable independent of all of the above and can ship in parallel, but its worked examples must not claim support for a handler that isn't registered, and must be verified by running the generated graph, not by it linting clean.

## Explicitly out of scope

- HTTP server mode (§9.5) — specification marks it optional ("MAY")
- Full five-tier fidelity content differentiation (§5.4) — needs its own decision (open question 4) before it's in or out
- Artifact store (§5.5), `manifest.json`/`artifacts/{id}.json` (§5.6) — no user-facing demand identified yet; revisit once resume (in scope) creates one
- Amplifier's Python-specific machinery (module registry, hook bridge, multi-provider bundle YAML) — no Claude Code equivalent exists or is being built to have one

## Current-state workflow

Today: clone the monorepo → hand-write a `.dot` file against the 93KB grammar — no example is committed *in this repository*, and none is surfaced *inside the plugin*, though a copy-and-adapt path exists in principle against amplifier's own examples (one of four checked this pass actually runs clean; see Success signals) if a user thinks to look there → `node dist/attractor.js lint` → `node dist/attractor.js run --stub` to rehearse → run for real, unattended, hoping the graph didn't need a handler that doesn't exist → if it crashes, restart from zero.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Does a FAIL outcome get retried by `execute_with_retry` itself (§11.5's reading) or does it route immediately to failure-handling (§3.5's reading, which this engine and amplifier both independently chose)? | strongdm/attractor maintainers (file upstream, joining the already-queued §3.4 scoping question) | Confirms or overturns an already-shipped behavior |
| 2 | Is an unreachable node an ERROR (§7.2's table) or a WARNING (§11.12's checklist)? | strongdm/attractor maintainers (same upstream filing) | Confirms or overturns `TOPO-004`'s current severity |
| 3 | Should `TYPE-001` (unrecognized `type=`) really be ERROR, given §7.2 specifies WARNING for `type_known`? | this project | Needs a decision or a downgrade before the next lint-touching plan |
| 4 | Is content-differentiated fidelity (§5.4's five modes, currently all behaving identically) an accepted permanent divergence, or a real gap to build? | this project | Scopes whether it belongs in this MVP or is explicitly deferred |
| 5 | Root `AGENTS.md` already hedges — its header reads "Current **and planned** plugins," listing `delivery` and `attractor` without saying which is which. Neither the marketplace manifest nor a `plugins/delivery/` directory exists in *this* repository. Which of the two is actually current, and is `ai-augmentation-systems` the sole real marketplace with packaging meant to happen there, not in-place here? | this project | Scopes the installability work directly |
