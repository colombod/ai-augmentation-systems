---
description: Turn an approved PRD into a technical design grounded in the actual codebase, with decisions, spikes, migration plan and test strategy. Use once requirements are settled and before work is broken into stories. Produces .delivery/initiatives/<initiative>/architecture.md.
argument-hint: "[initiative]"
---

# Architecture and technical design

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Focus note from user: **$ARGUMENTS**

DEFINE stage, last step. Inputs: `.delivery/initiatives/<initiative>/prd.md`, plus `prioritization.md` and `design-system.md` where they exist. Output: `.delivery/initiatives/<initiative>/architecture.md` and ADRs in `.delivery/decisions/`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Open blocking findings**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read `.delivery/initiatives/<initiative>/prd.md`.

- **Missing** — stop. Designing against an unwritten specification produces a design for the wrong thing. Tell the user to run `/delivery:prd` and offer to run it now.
- **Non-functional requirements are vague or absent** — flag it. The architect needs numbers to design against; without them the design cannot be checked. Ask the user for the numbers or accept explicitly that the design is unvalidated on those axes.

If `.delivery/initiatives/<initiative>/architecture.md` already exists, read it and ask
whether to **revise**, **replace**, or **start new version**. See
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the same-problem
test that chooses between revise and start new version, and the Version-history table and
Corrections log it writes. Never silently overwrite.

**Open blocking findings.** Apply the conventions' *Open blocking findings* check to every artifact this phase consumes before going further.

## Run

**1. Read the codebase before designing.** This is not optional and it comes first. Identify the modules the change touches, the existing patterns and conventions, and the interfaces already in place. A design that has not been checked against the real code is a guess.

**2. Solution Architect produces the design.** Delegate to `delivery:solution-architect` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/solution-architect.md` and adopt the persona). It must deliver:
- Component structure with **real file paths**, marking what changes, what is extended, what is untouched
- Interfaces and data contracts
- How each `NFR-n` from the PRD is met, addressed one by one
- Alternatives considered and why rejected, for every consequential decision
- The **spike list**: assumptions that must be proven before committing, each with a specific question, the decision it informs, a decision rule (which result means build, change the design, or stop), its decision owner (DM, PM, or the owner when it decides scope) and a time box
- The **assumption register**: every claim the design rests on that nobody has yet seen hold, each with its kind (`external-host` for how a host we do not control behaves, else `platform`, `data`, `customer` or `internal`) and the acceptance criteria it sits on
- Migration and rollback plan for any change to persisted data or public interfaces
- Risk register

**3. QA Strategist adds the test strategy.** Delegate to `delivery:qa-strategist` for the risk-based plan: what is tested at which level, where coverage is deliberately thin and why, and how the non-functional numbers get measured.

**4. Critic passes over it.** Delegate to `delivery:feature-critic` (read-only) to find the unstated assumption. Fold the blocking findings in before writing; report the rest.

**5. Write the design** to `.delivery/initiatives/<initiative>/architecture.md` using `${CLAUDE_PLUGIN_ROOT}/templates/architecture.md`. Write each consequential decision as its own ADR in `.delivery/decisions/ADR-NNN-<slug>.md` using `${CLAUDE_PLUGIN_ROOT}/templates/adr.md`.

**6. Write the assumption register** to `.delivery/initiatives/<initiative>/assumptions.md` from `${CLAUDE_PLUGIN_ROOT}/templates/assumptions.md`, in a role session only through `node ${CLAUDE_PLUGIN_ROOT}/scripts/assumptions.js add` (the lanes refuse a direct edit): one row per assumption, every one `assumed` (only a probe in the real host makes one `observed`), criteria as `<story>#<n>` once the stories exist (until then, the stories' ids from the roadmap). Each `external-host` row gets a spike in the Spikes table naming it in its Assumption column; materialise turns it into a spike bead that blocks those stories, and their claims are refused until it is answered in the real host and its decision owner has acknowledged the result. An external host is observed only by the Reality Checker's probe in the real host; a documentation reading or a twin is never an observation of it. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/assumptions.js list` to check the table parses.

**7. Declare the customer surface** in `.delivery/initiatives/<initiative>/surface.json` from `${CLAUDE_PLUGIN_ROOT}/templates/surface.json`: where the customer actually uses the product (host, app, mode, the install artifact they get), whether an agent can drive it by script (`scriptable`), and the host's limits as numbers (`size_budgets`). Cite the owner's decision in `owner_record`; one surface is the norm, a second only when the owner named it. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/surface.js check <initiative>`. Every story names its surface, and evidence from any other surface does not count at the done gate, so a wrong surface here is the costliest error in the design.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Component structure cites real, verified file paths
- Every `NFR-n` in the PRD is addressed explicitly, or listed as unmet with the reason
- Every consequential decision has stated alternatives
- The spike list exists — or the document states plainly that nothing needs proving, which is rare enough to justify — and every spike names its decision, decision rule and decision owner
- `assumptions.md` exists, every `external-host` assumption has a spike, and `assumptions.js list` reports no warnings
- Migration and rollback are covered, or explicitly not applicable
- Test strategy is present
- `surface.json` exists and `surface.js check` passes

## Writing, then revising

**Budget: 1000 words target, 1600 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report exit criteria status, and surface the spike list prominently — the Program Manager needs it to sequence the plan. If the design revealed that a requirement is disproportionately expensive, state the tradeoff for the Product Owner rather than quietly simplifying it. Next step: `/delivery:roadmap`.
