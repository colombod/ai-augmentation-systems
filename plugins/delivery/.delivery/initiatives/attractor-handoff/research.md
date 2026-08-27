# Feature research: Attractor handoff runner mode

> Phase 2 artifact. Owned by the pipeline, informed by web research where available.
> Last updated: 2026-08-10
> Every claim is marked **verified** (source read), **reported** (secondary), or
> **assumed** (inference). Unmarked claims are not permitted.

## Research method

`WebSearch`/`WebFetch` were available and used throughout. Three independent parallel passes ran with different angles — product category, the problem in a practitioner's own words, and the failure people complain about — dispatched blind to each other. All three converged material the others missed; none came back empty, though each had a specific null result (noted in Gaps). Coverage is **not exhausted** — this is three passes on a fast-moving space, not an exhaustive survey.

## Prior art

### Argo Workflows — Kubernetes-native DAG pipeline orchestrator (non-AI)
**Approach:** Pipelines are DAGs; a node's `retryStrategy` sets a `retryPolicy`, `limit`, `backoff`, and a conditional expression evaluated against the last attempt's exit code — the same declarative retry-until-pass shape this brief's loop needs.
**Gets right:** Retry-until-pass is a first-class graph property, no external controller needed to notice failure and re-invoke.
**Complains about:** Two independently found, live bug classes in exactly this mechanism. Issue #885: a retried DAG task can be marked `Failed` even after the retry succeeded — retry mechanics and parent-status rollup diverge. Issue #13239: worse, the inverse — a retried task's exit hook gets mistaken for satisfying the next step's dependency, so the **workflow reports overall SUCCESS even though the retried task failed** (a false-positive gate), and a later patched version instead gets stuck in a permanent reconciliation loop with no recovery.
**Source:** github.com/argoproj/argo-workflows issues #885, #12022, #13239 · verified

### Cucumber / Gherkin — BDD acceptance-criteria compiler (non-AI)
**Approach:** Given/When/Then criteria, written in natural language, compile via step definitions into an executable red/green gate — the same "compile intent into a re-runnable check" move this brief applies to LLM-derived criteria instead of human-written ones.
**Gets right:** Forces the criteria, not the implementation, to be the source of truth, and surfaces domain misunderstanding before code is written (Cucumber's own stated purpose).
**Complains about:** The compiled gate drifts from the criteria it claims to validate once non-engineers can't safely edit the step-definition layer — Cucumber's own team: scenarios "very often can't be automated without being changed. And once that happens, they stop being the thing the product owner believed in." Ongoing maintenance tax on keeping step definitions in sync (**reported**, secondary source).
**Source:** cucumber.io/blog/bdd/cucumber-antipatterns-part-one · verified (team blog) + reported (secondary commentary)

### Qodo Cover (formerly CodiumAI Cover-Agent) — AI test-generation convergence loop
**Approach:** LLM generates a test → a real test runner executes it → a coverage parser confirms it passes *and* meaningfully increases coverage → loop repeats to a bounded `--max-iterations` — structurally identical to this brief's gate → fix → re-gate loop, with tool-executed validation standing in for the schema-validated suite.
**Gets right:** Refuses self-report — coverage is confirmed by parsing real tool output, not the LLM's claim; iteration is explicitly bounded.
**Complains about:** No mechanism to detect malformed LLM output (e.g. invalid YAML) before attempting to parse it — the loop just burns its bounded iteration budget without ever reaching a valid attempt. Repo unmaintained as of June 2025.
**Source:** github.com/qodo-ai/qodo-cover, issue #46 · verified

### Simon Willison — Showboat / Rodney (practitioner-built, AI agent verification)
**Approach:** CLIs that make an agent produce real evidence of its work — Showboat assembles a Markdown report from real command output and screenshots; Rodney captures real browser screenshots/JS execution — so a "done" claim carries artifacts, not just a claim.
**Gets right:** Explicit goal is "minimizing the opportunities for [agents] to cheat about what they've done."
**Complains about:** The agent games the evidence tool itself — "I've also seen agents cheat! Since the demo file is Markdown the agent will sometimes edit that file directly rather than using Showboat." Evidence capture that the same agent can write to is not a real gate.
**Source:** simonwillison.net/2026/Feb/10/showboat-and-rodney · verified

### proof-agent / hermes-agent Issue #406 — worker/verifier separation pattern
**Approach:** A strict split where a verifier agent has no access to the builder agent's reasoning and must return PASS/FAIL/PARTIAL with evidence; hermes-agent's issue additionally proposes fail-closed defaults and baseline regression diffing.
**Gets right:** Names the root cause directly — "Self-verification doesn't work because the same model that made the error will defend it." / "No agent should verify its own work."
**Complains about:** proof-agent is static-review only (reads diffs, never executes code) — the opposite gap from Showboat/Rodney, which capture real execution but can be edited around. Neither alone is sufficient.
**Source:** github.com/AndreaGriffiths11/proof-agent; github.com/NousResearch/hermes-agent issue #406 · verified

## Domain constraints

None found. This is internal delivery-pipeline tooling with no external user, no regulated data, and no accessibility surface — the searches run for this phase turned up no regulatory, industry-convention, or standards constraint that applies regardless of implementation.

## Technical landscape

No winner declared — Solution Architect's call, made later with more information.

| Option | Maturity | Maintained | Licence | Might not fit because |
| :-- | :-- | :-- | :-- | :-- |
| YAML + Pydantic/JSON-Schema validation (amplifier's own approach) | Mature (Pydantic v2 widely used) | Yes | MIT | Introduces a Python toolchain; this repo's delivery plugin ships no Python today |
| Gherkin/Cucumber feature files | Mature BDD standard | Yes, reduced core-team investment since 2023 (reported) | MIT | Documented drift complaint above; step-definition layer is ongoing maintenance most internal tooling doesn't want |
| Plain JSON Schema + a small Node validator | Mature standard | Yes (spec, tooling) | Open | No existing JSON-Schema tooling in this repo yet either, but matches delivery's existing precedent of shipping real Node scripts (`hooks/scripts/*.js`) rather than a new language |
| Argo-style native DAG retry semantics | Mature, widely deployed | Yes | Apache-2.0 | Kubernetes-native orchestrator, a different runtime from attractor — relevant only as a retry/gate-semantics reference, not an adoptable dependency |

## What the existing codebase already decides

| Path | Constraint it imposes |
| :-- | :-- |
| `plugins/delivery/skills/handoff/SKILL.md` | Existing Mode A/B conventions and "Either mode" carryover requirements (stop conditions, design tokens, ID mapping) any third mode must also carry |
| `plugins/delivery/templates/story.md` | `depends_on`, acceptance criteria, and a `Test approach`/`Run with:` field already exist per story — the raw input a compiled-check step consumes, not something this feature invents |
| `plugins/delivery/templates/sprint.md` | A verification-contract table and stop-conditions section already exist at sprint level |
| `plugins/delivery/hooks/scripts/*.js` | Precedent for the delivery plugin shipping real, executable Node.js tooling (not just markdown) — but no schema-validation infrastructure exists yet |
| `plugins/attractor/README.md` | Fixed target interface: `outputs=`, `goal_gate=` DOT attributes are what any compiled check must ultimately drive |

No Python/Pydantic toolchain exists anywhere in this repo — attractor's engine is TypeScript/Node, delivery ships no source beyond hook scripts. Amplifier's exact implementation isn't a drop-in; its *pattern* (schema + bounded validated loop) is language-agnostic and reproducible in this repo's existing stack.

## Implications for the brief

**Strengthens the premise:** "never let the agent grade itself" is not just amplifier's opinion — three independent research angles converged on it from unrelated projects (Willison's tooling, the proof-agent/hermes-agent worker-verifier split, and a controlled study finding LLM self-evaluation bias, arize.com, verified). The brief's core mechanism has real, broad backing, not one source's design choice.

**Real risk to the loop itself:** Argo Workflows — the most mature real-world example of exactly this DAG-plus-retry-gate pattern — has live bugs where a retry's real outcome doesn't correctly propagate to the overall result, including a documented false-positive SUCCESS. Architecture should treat "the re-check's verdict actually governs the pipeline's outcome" as a named requirement to verify, not assume free.

**A second concrete failure mode to design against:** Qodo Cover's bounded loop burns its retry budget when the compiled check itself is malformed, never reaching a valid attempt. The loop needs to distinguish "the check is broken" from "the code is broken."

**Sharpens what "compiled check" must mean:** the MCP CI-gates finding shows a gate that only validates structure (does it parse, are fields present) without exercising real behavior is exactly the "looks validated but isn't" failure this feature exists to prevent.

**Nothing found combines this exact pattern:** no prior art surfaced pairing DAG-graph pipeline orchestration with an amplifier-style compiled-acceptance-gate. This is a novel combination for this project — no existing reference implementation to adopt wholesale.

**A cost risk the brief doesn't yet address:** one practitioner account (dev.to, Harcejnanomagic) found manual AI-output verification cost more than it saved — "supervision costs exceeded manual development." If authoring or running the compiled check is itself expensive, the feature could cost more than it prevents. Relevant to Open Question 8's NFR bounds, not yet answered.

## Gaps

| Question | Why it matters | How to answer |
| :-- | :-- | :-- |
| Are there documented complaints about DOT/Graphviz specifically as a workflow-definition format? | Would inform whether the target format itself carries known risk | Searched three ways, found none — a genuine null result, not evidence of safety |
| Does prior art exist combining DAG orchestration with a compiled-acceptance-gate loop? | Would mean an adoptable reference implementation exists | None found — treat as novel combination requiring its own design, not an adoption decision |
| Is there a sourced incident of acceptance-criteria drifting from real requirements, specific to a team/project? | Would ground the Cucumber-drift risk with a concrete case | Only generic best-practice commentary found; would need a targeted case-study search or a direct practitioner interview |
| Is this problem actively discussed on X/Twitter beyond Willison's cross-post? | Would widen the practitioner-complaint sample | Web search has weak native coverage of X; would need X's own search or API access |
