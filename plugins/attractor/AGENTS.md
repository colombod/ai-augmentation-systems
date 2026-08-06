# AGENTS.md — attractor plugin

Adds to the repository-level `AGENTS.md` at the root. Read that first; everything in it
applies here and is not repeated.

## What this plugin is

A native Claude Code implementation of the **attractor nlspec** — DOT-graph-as-program
execution, where nodes are computation and edges are dispatch. It is the control plane
for long-running AI pipelines. LLM nodes run as headless `claude -p` subprocesses using
the operator's existing Claude Code login; no API key.

## Adherence: the spec is authoritative

`strongdm/attractor`'s `attractor-spec.md` is authoritative for everything it defines.
The standing rule, borrowed from upstream's own principles and adopted here:

> This plugin **extends** the spec. It does not contradict it.

Two words with different consequences:

- A **contradiction** is behaving differently from what the spec normatively requires,
  for something we implement. Those get fixed. No exceptions, no "our way is nicer".
- An **extension** is behaviour the spec does not define or forbid. Those are kept and
  written down as deltas rather than silently diverging.

A conformance audit is recorded in `plugins/attractor/.superpowers/spec-conformance.md` with the
normative quote for every finding. A correction plan is grounded on it. **That plan
corrects contradictions and retreats from nothing.**

### When in doubt, read the spec FIRST

**This is the standing rule, before reasoning, before asking, before writing code.**
If a question is about what the engine *should* do, open the spec and read it. The
answer is almost always in section 3, 4, 5 or 10, or Appendix A/B/C. The spec is 93 KB
and sits one fetch away:

```bash
gh api repos/strongdm/attractor/contents/attractor-spec.md --jq '.content' | base64 -d > /tmp/attractor-spec.md
```

The single worst class of defect in this plugin's history is settling a spec question
by reasoning instead of reading. It has happened twice, both expensively:

- A reviewer flagged an edge-selection question as unverifiable; the controller
  resolved it from intuition and asserted the wrong reading in a code comment. It
  stood for two plans (finding C1).
- A whole-branch fix introduced a run-level verdict rule without checking §11.3, which
  defines the pipeline outcome purely by goal gates. The fix was a contradiction, found
  only because someone thought to read the section afterwards.

Read it first. Quote the section when you record what you found. If two sections
disagree, that is an ambiguity to record — not a licence to pick the one you prefer.

## The doctrine — not tradeable

Each of these exists because something went wrong in a real run. They do not contradict
the spec, and they are not removed to "simplify" or to "conform":

- **Fail-closed goal gates.** A `goal_gate=true` node whose outcome carries no routing
  signal returns RETRY, not SUCCESS. Upstream's fail-open default let a judge write
  "NOT CONVERGED - 2 of 7 criteria pass" and be recorded a success; the run exited
  claiming victory with zero work product after 2.4 hours. RETRY is a legal outcome per
  spec §5.2, so nothing is contradicted.
  **A gate is a claim about evidence, so no node attribute may relax how it is earned.**
  `runs_on` is inert on a gate in both directions: a gate is never skipped, and the eager
  input check stays armed on it whatever `runs_on` says. Both halves were needed and only
  the first was implemented at first — a gate with `runs_on="failure"` was excluded from
  the input check, judged a blanked `${artifact.path}` its own producer had failed to
  produce, satisfied itself, and exited 0. **The bypass was opened by an attribute added
  for cleanup nodes, which is how the next one will arrive too**: when a new attribute
  changes when or how a node runs, state what it does to a gate, and the answer should
  be "nothing". See W1 in `plugins/attractor/.superpowers/spec-conformance.md`.
- **Human gates never time out by default.** `timeout` requires an explicit target naming
  an outgoing edge -- either `on_timeout` (this engine's own attribute) or
  `human.default_choice` (spec section 6.5's name for the identical purpose) -- enforced
  by lint HITL-001. No implicit fallback, no first-edge rule. A multi-hour unattended run
  must never be silently decided by a timer.
  **Corrected 2026-08-04 (finding F9).** This entry previously named only `on_timeout`,
  and HITL-001 enforced only that spelling, refusing a graph written exactly to section
  6.5's own wording (`human.default_choice`). That was a contradiction, not an extension:
  the spec names its own attribute for this and a spec-legal graph using it was rejected.
  Both names are now accepted, independently, as satisfying "an explicit target was
  named"; a timeout with neither present is still refused. The safety property itself --
  no implicit fallback, no first-edge rule -- is unchanged.
- **CMD-001 / CMD-002 lint.** Pipe-masked exit codes and always-true routing sentinels.
  Both have silently false-passed real runs.
- **The engine-managed namespace guard**, formerly the `tool.` namespace guard. A box
  node cannot write any context key the deterministic layer owns, so a model cannot
  forge the control plane's routing tokens. It began as `tool.*` only; Plan 3 made
  `outcome`, `preferred_label`, `current_node` and `graph.*` routing-visible, which put
  them in reach of a model authoring `contextUpdates` — demonstrated, not theorised:
  `{current_node: 'start'}` took a `condition="context.current_node=start"` branch. The
  guard now covers the whole set through a single `isEngineManagedKey` predicate in
  `core/context.ts` that the engine also writes its own built-ins through, so the guard
  cannot drift from the engine's key set. The extension is unchanged in kind; it got
  wider because the surface did. Bare graph attribute names (`goal`) stay unreserved —
  that is the author's namespace, and the narrow hazard it leaves is recorded as
  residual R3 in `plugins/attractor/.superpowers/spec-conformance.md`.
- **The stale-label rule.** A failing tool node does not refresh `tool.last_line`, so a
  gate's previous label survives a failed re-entry. **This entry decided a live argument
  and the outcome is worth keeping.** The dataflow plan's failed-output ledger initially
  recorded *inferred* handler outputs as well as declared ones, which put `tool.last_line`
  — a key every tool node writes — in the ledger the moment any tool node failed. The
  eager input check then refused every node substituting it, including the node whose
  entire job is to report the failure, in graphs containing no `outputs=` at all. Two
  mechanisms were arguing about the same key and this one won: the ledger takes
  **declared `outputs=` keys only**. A key nobody declared is not a debt anybody owes.
- **Cleanup that refuses to destroy work.** A worktree holding uncommitted changes is
  preserved with a warning, never deleted. A run that produced output and did not commit
  it must not vanish.
- **Loud aborts over silent degradation.** An unimplemented shape fails with
  `no handler registered` rather than quietly running as something else.
- **An unresolved failure is recorded and said out loud — but it does not change the
  verdict.** A run can reach its exit holding a node whose work failed and which nothing
  re-ran. §11.3 decides the run status purely by goal gates — *"Pipeline outcome is
  'success' if all goal_gate nodes reached `SUCCESS` or `PARTIAL_SUCCESS`, 'fail'
  otherwise"* — so such a run is a **conformant success**, and `status` and the exit code
  say so. What we add is additive and contradicts nothing: `RunResult.unresolvedFailures`
  names the nodes, a `pipeline.unresolved_failure` event records them, and the CLI writes
  a stderr WARNING naming §11.3 so an operator who expected a failure can find out why
  they did not get one. **Two things count as the run giving up on a node**: ending FAIL,
  and exhausting retries then being abandoned to a `retry_target` — the second never
  reaches a FAIL status in our loop, though §3.5's own pseudocode calls it
  `Outcome(status=FAIL, failure_reason="max retries exceeded")`, so recording it is
  faithful rather than inventive. A failure is cleared only by **re-executing that same
  node** to SUCCESS or PARTIAL, so a repair loop leaves the record empty.
  **This entry is deliberately narrower than it once was.** It briefly read "an
  unresolved FAIL is never a SUCCESS", with the run reporting FAIL and exiting 1. That
  reported FAIL where §11.3 reports SUCCESS — a contradiction, not an extension — and it
  was withdrawn. The real fix was one level down and it landed: **I1 is CLOSED** by
  declared `outputs=` plus an eager reference scan, and **I2 was RECLASSIFIED** — it was
  never an engine defect, only a graph shape, now caught by the GATE-001 lint rule.
  SKIPPED propagation was **rejected**, not deferred: §5.2 defines `SKIPPED` as "proceed
  without recording an outcome", which cannot also mean "halt". FAIL is used instead.
  **This entry still binds, because I1's protection is fully opt-in**: only declared keys
  enter the ledger, so a graph declaring no `outputs=` still reaches its exit holding a
  failure, and the record is the only thing that speaks. Silence is what this entry
  forbids. The verdict is the spec's to decide, not ours. See I1 and I2 in
  `plugins/attractor/.superpowers/spec-conformance.md`.
- **Fail-fast on FAIL.** When a node returns FAIL and no condition explicitly matches the
  failure, no unconditional edge carries it forward. This one is a *chosen reading of an
  ambiguity*, not an invention: §3.3's `select_edge` pseudocode has no FAIL branch, so a
  literal reading follows unconditional edges, while §3.7's failure ladder never mentions
  them and terminates the pipeline. We implement §3.7. It is recorded as ambiguity #1 in
  `plugins/attractor/.superpowers/spec-conformance.md`, and it is listed here because a reading that
  lives only in a code comment is not a record — see the entry for C1 in that same
  document for what that costs.

The rule underneath all of them:

> Verification inside the context that produced the evidence is not verification.

The control plane stays outside every worker. Routing is decided by code, never by a
model. Gates are earned with evidence, not asserted.

If a change appears to require deleting one of these, stop and ask. That is a signal, not
a licence.

## What we take from the amplifier bundle

`microsoft/amplifier-bundle-attractor` is not a dependency — we implement natively. It is
the source of the **doctrine surface**, which is being ported:

| Upstream asset | Treatment |
|---|---|
| `agents/attractor-expert.md` | **Rewrite.** Keep the design-time self-check (CMD hazards, judge verdict contracts, delta-assertion gates, deferral routing) — engine-independent. Replace all integration guidance with ours. |
| `skills/attractorify/SKILL.md` | **Port near-verbatim.** The three-question test, the evidence-quoting diagnosis artifact, the fail-closed bash gate, the independent-verifier delegation and the anti-self-dealing rule are engine-independent and excellent. |
| `context/engine-semantics.md` | **Write from scratch, from our tests.** Non-negotiable: it is the expert agent's declared source of truth, and a ported one would describe Amplifier's engine. |
| `docs/PIPELINE_DESIGN_PRINCIPLES.md`, `PIPELINE_PATTERNS.md` | **Port near-verbatim.** Control-plane vs recipe-plane, tier discipline, the SF/MLE/V+R output strategies, the live post-mortems. The most valuable text in the bundle. |
| `context/dot-reference.md`, `docs/ROUTING-REFERENCE.md` | Port, then correct to our implementation. |
| `examples/pipelines/*`, `patterns/task-runner.dot` | Port and **re-verify each one runs** on our engine. An example that does not run is worse than none. |

Roughly a third of that corpus must be re-derived rather than copied. The split is not
optional: doctrine ports, engine-coupled documentation is rewritten.

**Golden-graph tests are a required deliverable of the port**, not polish. Every graph
this engine has executed so far is a small fixture written by the test that runs it. A
reviewer observed that committing `task-runner.dot` and running it to a known terminal
state would, on its own, have caught this plugin's most serious Critical finding.

## Plugin-specific conventions

- **Node >= 24**, native TypeScript type stripping — no build step for tests. Therefore
  **no `enum`, `namespace`, `declare`, or constructor parameter properties.** Use `const`
  objects with `as const` plus a derived union.
- Explicit `.ts` extensions on relative imports; `node:` prefix on builtins. ESM only.
- **Exactly two dependencies**: `@ts-graphviz/ast` (runtime), `esbuild` (dev). A third
  requires a recorded decision.
- `dist/attractor.js` is committed. Rebuild it whenever source changes.
- Pipelines are POSIX shell; `attractor doctor` reports what the machine is missing.

## Where things are

| Path | What |
|---|---|
| `engine/src/` | The engine |
| `dist/attractor.js` | Committed bundle |
| `.superpowers/specs/` | Design |
| `.superpowers/plans/` | Implementation plans |
| `.superpowers/spec-conformance.md` | Audit, now well past 14 findings — see the document itself |
| `.superpowers/carry-forward.md` | What each later plan inherits |
| `.delivery/` | Product-pipeline artifacts: brief, research, personas, reviews |
