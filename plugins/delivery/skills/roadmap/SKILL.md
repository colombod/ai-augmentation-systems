---
description: Build a phased delivery roadmap with sequencing, dependencies, critical path, risks and per-phase cut lists. Use once the PRD and architecture exist and you need to know what lands when and in what order. Produces docs/product/roadmap.md.
---

# Delivery roadmap

Constraints from user (deadlines, team size, fixed dates): **$ARGUMENTS**

Phase 9 of the pipeline. Inputs: `docs/product/prd.md`, `docs/product/architecture.md`, `docs/product/prioritization.md`. Output: `docs/product/roadmap.md`.

## Gate check

Read both inputs.

- **PRD missing** — stop. Sequencing unknown requirements is fiction. Run `/delivery:prd` first.
- **Architecture missing** — warn clearly. You can sequence without it, but the dependency map and effort sizing will be guesses, and the spike list — the most valuable input to sequencing — will not exist. Ask whether to proceed anyway or run `/delivery:architecture` first.

Ask the user for any constraints not given in `$ARGUMENTS`: team size and composition, fixed external dates, and whether scope or date is the fixed variable. A roadmap built without knowing which one is fixed will optimize for the wrong thing.

## Run

**1. Program Manager builds the plan.** Delegate to `delivery:program-manager` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/program-manager.md` and adopt the persona). It must deliver:
- **Phases** with entry and exit criteria, each producing something demonstrable — describe what you would show
- **Risk-first sequencing**: the spikes from the architecture and the least-understood work go early. State the sequencing rationale; a plan that front-loads the easy work should have to justify itself.
- **Dependency map**, including dependencies outside the team's control, each with an owner and needed-by date
- **Critical path** identified explicitly, with what would have to change to shorten it
- **Sizing** in relative terms with a confidence label per item. Never a single-point date for unscoped work.
- **Risks** with mitigations and owners
- **Cut list per phase** — what gets dropped first if the phase runs late, decided now rather than under pressure

**2. Reconcile value against real cost — the second prioritisation pass.** `prioritization.md` ranked requirements on value with pre-architecture effort guesses. Now the architecture has revealed what things actually cost, so re-check the staging against real numbers.

Look specifically for **inversions**: a requirement sitting in the MVP whose cost turned out far higher than assumed, or a deferred requirement that turns out nearly free once the MVP work exists. Both are common and neither is visible before architecture. For each inversion, state the value, the revised cost, and a recommendation.

Do not silently re-stage. Prioritisation is the Product Owner's call — present the inversions and let them decide, then record what they chose.

**3. QA Strategist places the verification.** Delegate to `delivery:qa-strategist` to map risk-based coverage onto the phases, so testing is continuous rather than a final phase.

**4. Critic checks the plan holds.** Delegate to `delivery:feature-critic` (read-only) specifically to check: do parallel tracks secretly share a person or an unbuilt component? Does the sequence match the architecture's dependencies? Is integration deferred to the end? Fold blocking findings in.

**5. Write the roadmap** to `docs/product/roadmap.md` using `${CLAUDE_PLUGIN_ROOT}/templates/roadmap.md`. Trace each phase back to the `FR-n` IDs it delivers, so coverage gaps are visible.

## Exit criteria

- Every phase has a demonstrable exit criterion, not an internal artifact
- The critical path is named
- Dependencies outside the team's control have owners and dates
- Sizes carry confidence labels
- Each phase has a cut list
- Every `FR-n` in the PRD maps to a phase, or is explicitly deferred

## Hand off

Report exit criteria status. Call out any `FR-n` that landed in no phase — that is a silent scope drop and the Product Owner needs to see it. If the plan cannot fit the scope, present the tradeoff with options rather than trimming requirements to make a date work. Next step: `/delivery:stories`.
