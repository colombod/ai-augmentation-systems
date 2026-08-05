# Feature research: delivery plugin — closing the doctrine/enforcement gap

> Phase 2 artifact. Owned by the pipeline, informed by web research where available.
> Last updated: 2026-08-05
> Every claim is marked **verified** (source read), **reported** (secondary), or
> **assumed** (inference). Unmarked claims are not permitted.

## Research method

WebSearch/WebFetch available and used. Four parallel passes ran, one per brief finding,
each running at least three independent search angles internally (by product category, by
practitioner complaint, by adjacent discipline) per `/delivery:research`'s convergent-search
rule. No pass saw another's output before filing. Convergence: all four independently
concluded the mature, general-purpose version of the mechanism they searched for does not
exist yet — every area has partial, adjacent prior art, not a solved problem to copy.

## Prior art

### Invocation provenance — did an action actually happen, or was it only narrated?

| Tool | Approach | Gets right | Still missing | Source |
| :-- | :-- | :-- | :-- | :-- |
| OpenTelemetry GenAI conventions | Standard spans for real tool calls (`gen_ai.tool.call.id/arguments/result`) | Exists only if a real call happened | No enforcement of instrumentation coverage | [spec](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) · verified |
| Langfuse | Traces tool calls; can query for "dead tools" offered but never invoked | Purpose-built retroactive audit | No live cross-check against the model's own claims in the same turn | [blog](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse) · verified |
| SLSA build provenance | Signed attestation from a builder distinct from the claimant | True non-repudiation | Doesn't map to agent loops — claimant and builder are the same untrusted process | [spec](https://slsa.dev/spec/v1.0/provenance) · verified |
| GitHub required status checks | Merge structurally blocked without independent CI signal | Enforcement, not just logging | Needs an independent gatekeeper process | docs · reported |

**Complaints validating the problem, not solving it:** Claude Code issue [#37818](https://github.com/anthropics/claude-code/issues/37818) — financial loss from a declared-done fix that never ran; [#11913](https://github.com/anthropics/claude-code/issues/11913) — fabricated test results from stale output. Both closed with no structural fix. Verified (issue text read).

### Evidence confidence as a gate, not a label

| System | Mechanism | Gets right | Still missing | Source |
| :-- | :-- | :-- | :-- | :-- |
| GRADE (medicine) | Certainty tier is meant to bound recommendation strength | Explicit, machine-checkable rule | Audited: 63.6% of "strong" recs rested on low-certainty evidence; the rule exists, isn't enforced | [PMC10039768](https://pmc.ncbi.nlm.nih.gov/articles/PMC10039768/) · verified |
| ICD 203 (intelligence analysis) | Mandates stating confidence alongside probability | Forces disclosure | Labeling only — nothing blocks acting on a stated low-confidence judgment | [ICD-203.pdf](https://archive.dni.gov/files/documents/ICD/ICD-203.pdf) · verified |
| ESSA / WWC (education policy) | Title I funds legally restricted to Tier 1–3 evidence; Tier 4 ("rationale only") excluded | The one true hard gate found — low tier structurally cannot unlock the action | Narrow: applies to one funding stream only | [ies.ed.gov](https://ies.ed.gov/ncee/wwc/essa) · verified |
| RICE / Now-Next-Later | Confidence multiplies or sorts the score | Quantifies confidence | Advisory only — a low-confidence item can still win on raw score | [Intercom](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/) · verified |

**Synthesis:** the one real gate (ESSA) works by tying a specific decision type to a minimum evidence tier as a precondition, not by grading evidence in general. That pattern — not "grade everything," but "name the decisions that require tier ≥ N and refuse them otherwise" — is what generalizes here.

### Automated visual/design-rubric checking

| Tool | Checks against | Gets right | Still missing | Source |
| :-- | :-- | :-- | :-- | :-- |
| Percy / Chromatic / Applitools / BackstopJS | A prior screenshot (or one designer-exported Figma frame) | Catches unintended change | Baseline-diff only — cannot judge a correct-looking first render against design rules | [review](https://getautonoma.com/blog/visual-regression-testing-tools) · verified |
| Storybook a11y addon (axe-core) | WCAG rules against the rendered DOM | Always-on CI gate, no baseline needed, catches ~57% of a11y issues automatically | Operates on DOM/CSSOM, not pixels — cannot see misalignment | [storybook.js.org](https://storybook.js.org/blog/accessibility-testing-with-storybook/) · reported |
| UIClip / UICrit (research) | A learned quality score / critique dataset from screenshots | Right shape — a rubric-based visual scorer | Research artifact, not a deployed gate | [arxiv 2404.12500](https://arxiv.org/pdf/2404.12500) · reported |

**Direct confirmation of the failure mode:** "Claude cannot see what it built... the same agent that wrote the code is the worst reviewer of it" — proposed fix is a manually authored list of ~69 design rules, not automation. Verified: [superdesign.dev](https://superdesign.dev/blog/how-to-make-claude-code-ui-look-good).

**No production tool found that scores an arbitrary first render against a design system's rules.** Axe-core's DOM-rule-gate shape is the closest analog, adapted to visual/spacing rules instead of accessibility rules.

### Making a review/status check structurally non-optional

| Mechanism | How it forces the check | Source |
| :-- | :-- | :-- |
| GitHub required status checks, bypass disabled | Server-side; even admins blocked without explicit permission | [docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) · verified |
| Local git hooks | Trivially bypassed (`--no-verify`, `HUSKY=0`) with no native bypass audit — real enforcement moves server-side | [bobbyhadz](https://bobbyhadz.com/blog/git-commit-skip-hooks) · verified |
| **Claude Code `Stop` / `SubagentStop` / `TaskCompleted` hooks** | **Exit code 2 or `{"decision":"block"}` prevents the session/subagent/task from ending — a real, structural "before you finish, run X" gate, confirmed in current docs. `PreToolUse` can deny or rewrite a call outright. No native "every N turns" counter — must be hand-built by a hook script tracking its own state.** | [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) · **verified, load-bearing** |

## Domain constraints

| Constraint | Applies because | Source | Confidence |
| :-- | :-- | :-- | :-- |
| None found regulatory/legal | This is internal tooling doctrine, not a regulated product surface | — | assumed |

## Technical landscape

| Option | Maturity | Maintained | Licence | Might not fit because |
| :-- | :-- | :-- | :-- | :-- |
| Claude Code `Stop`/`SubagentStop`/`TaskCompleted`/`PreToolUse` hooks | Stable, documented, current | Yes (Anthropic) | N/A (built-in) | No native turn-counter primitive; a custom script must track state itself |
| OpenTelemetry GenAI span conventions | Emerging standard | Yes | Apache-2.0 | Built for observability platforms, not lightweight markdown-skill tooling; adds an instrumentation layer this plugin doesn't otherwise have |
| axe-core-style DOM rule gate, adapted to visual/spacing rules | Mature pattern (a11y), unproven for design-token rules | Yes (axe-core itself) | MPL-2.0 | Nothing ports the *rule set* — this plugin's own `design-system.md` would have to become the rule source, which doesn't exist yet as machine-checkable data |

No winner declared — this is the Solution Architect's call, made with more information.

## What the existing codebase already decides

| Path | Constraint it imposes |
| :-- | :-- |
| `plugins/delivery/skills/*/SKILL.md` | All doctrine is markdown prompt text read by the orchestrating agent — no existing code layer to attach a hook to *inside* a skill; any enforcement has to come from outside the skill (the harness), matching the hooks finding above |
| `plugins/delivery/skills/status/SKILL.md` | Already reads artifact existence + exit criteria; extending it to cross-check invocation provenance is additive, not a redesign |
| `plugins/delivery/templates/prioritization.md` | Already has a `Confidence` column (R-brief-3, this session) — Finding B's fix is a rule change against an existing field, not new schema |
| No `design-system.md` exists anywhere in this repo or in elba-dreaming | There is no machine-checkable rule source today for a visual-conformance gate to check against — that artifact has to exist before Finding C's second layer can be enforced |
| No CI, no hooks configuration exists in this plugin's own repo | The plugin currently has zero infrastructure of the kind this research found as the real enforcement mechanism (hooks) — nothing here today would stop its own next drift |

## Implications for the brief

**This is the most valuable finding of this phase:** Claude Code's `Stop`/`SubagentStop`/
`TaskCompleted` hooks are a real, documented, currently-available mechanism that can block a
session or task from ending unless a condition is met — not aspirational, not something to
invent. Finding D's "self-correction is optional" is not a hard problem requiring a novel
mechanism; it's an unused, already-available feature of the very tool this plugin runs
inside. This should pull Finding D earlier/cheaper in scoping than the brief's MVP boundary
currently ranks it, and Open Question 3 ("no native scheduling primitive") is now partly
answered: `Stop`-hook gating exists; a turn-counter for cadence-based triggers does not and
would need to be hand-built.

No prior art fully solves Findings A or C as stated — both need a purpose-built mechanism,
not an off-the-shelf adoption. That's a real cost signal for architecture, not a reason to
defer: the closest analogs (OTel tracing, axe-core-style DOM gating) both suggest the same
shape — instrument first (make actions/renders inspectable), then gate on the instrumented
signal — which is buildable incrementally.

## Gaps

| Question | Why it matters | How to answer |
| :-- | :-- | :-- |
| Does any tool fuse rule-based DOM/design-token checking with vision-model screenshot scoring for first-render defects (not just baseline diff)? | Would materially cheapen Finding C's second layer if it exists | Deeper vendor-by-vendor search; ask design-tooling communities directly |
| Can a `Stop`-hook script reliably read the current turn's actual tool-call history to detect a narrated-but-uninvoked skill within the same turn, or only after the fact? | Determines whether Finding A can be *prevented* in-turn or only *detected* post-hoc | A technical spike against the hooks API, deferred to architecture |
| Full text of the ACM "synthetic persona" critique (fetch blocked, 403) | Would strengthen Finding B's evidence base beyond this plugin's own two engagements | Retry via a different access path, or find the paper via a preprint host |
