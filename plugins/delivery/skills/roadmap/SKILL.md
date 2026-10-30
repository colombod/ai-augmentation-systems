---
description: Build a phased delivery roadmap with sequencing, dependencies, critical path, risks and per-phase cut lists. Use once the PRD and architecture exist and you need to know what lands when and in what order. Produces .delivery/initiatives/<initiative>/roadmap.md.
argument-hint: "[initiative]"
---

# Delivery roadmap

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Constraints from user (deadlines, team size, fixed dates): **$ARGUMENTS**

CONTRACT stage. Inputs: `.delivery/initiatives/<initiative>/prd.md`, `.delivery/initiatives/<initiative>/architecture.md`, `.delivery/initiatives/<initiative>/prioritization.md`. Output: `.delivery/initiatives/<initiative>/roadmap.md`.

## Conventions

Before reading or writing anything below, Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`).
Its sections **Where `.delivery/` resolves to**, **Which initiative**, **Open blocking findings**, **Language**, **Writing, then revising** bind this skill as if written here.

## Gate check

Read the inputs and, where they exist, `storyboard.md` and the brief.

- **PRD missing** — stop. Sequencing unknown requirements is fiction. Run `/delivery:prd` first.
- **Storyboard not approved** — stop. `.delivery/initiatives/<initiative>/storyboard.md` must exist
  with status approved and the owner's approving words quoted exactly (`/delivery:prd` step 6.7;
  Sizzle's storyboard gate, michaeljabbour, MIT). Missing, unquoted or reopened: say which, and offer
  to draft it or put it to the owner. Only the owner may waive it, in words you quote in the
  roadmap's header; a role never does, and silence is not approval. **Reopened on an initiative
  already being built** (a `roadmap.md` exists, and `/delivery:realign` or a PRD change reopened the
  storyboard) — not a stop: revise the roadmap, mark each phase the change affects "storyboard
  reopened: awaiting the owner", and put the storyboard to the owner.
  **Planned before this gate:** an initiative whose brief has no *Owner lens and what must survive*
  section was framed before the storyboard existed (delivery 0.41.2). Do not stop it: go on, and
  write in the roadmap's header "Planned before the storyboard gate: no approved storyboard;
  `/delivery:prd --stage` adds one", and say so in the hand-off. Once the brief has that section,
  the gate applies in full.
- **Proposed for not doing, or a proposed non-goal (step 5b), unanswered** — not a stop. Sequence
  each such `FR-n` in the stage `prioritization.md` keeps it in, marked "proposed: awaiting the
  owner" in its phase; never leave it out of the plan on the team's word, whatever the PRD's out of
  scope list says about it.
- **Architecture missing** — warn clearly. You can sequence without it, but the dependency map and effort sizing will be guesses, and the spike list — the most valuable input to sequencing — will not exist. Ask whether to proceed anyway or run `/delivery:architecture` first.

If `.delivery/initiatives/<initiative>/roadmap.md` already exists, read it and ask whether
to **revise**, **replace**, or **start new version**. See
`${CLAUDE_PLUGIN_ROOT}/templates/version-history.md` for what each means, the same-problem
test that chooses between revise and start new version, and the Version-history table and
Corrections log it writes. Never silently overwrite.

Ask the user for any constraints not given in `$ARGUMENTS`: team size and composition, fixed external dates, and whether scope or date is the fixed variable. A roadmap built without knowing which one is fixed will optimize for the wrong thing.

**Open blocking findings.** Apply the conventions' *Open blocking findings* check to every artifact this phase consumes before going further.

## Run

**1. Program Manager builds the plan.** Delegate to `delivery:program-manager` (via the Agent tool; if subagents are unavailable, read `${CLAUDE_PLUGIN_ROOT}/agents/program-manager.md` and adopt the persona). It must deliver:
- **Phases** with entry and exit criteria, each producing something demonstrable — describe what you would show. Setup never becomes its own phase: fold `architecture.md`'s Setup section into Phase 1's entry criteria — a phase needs a persona-facing demonstrable exit and an `FR-n` it delivers, and setup work has neither.
- **Risk-first sequencing**: the spikes from the architecture and the least-understood work go early. State the sequencing rationale; a plan that front-loads the easy work should have to justify itself.
- **Dependency map**, including dependencies outside the team's control, each with an owner and needed-by date
- **Critical path** identified explicitly, with what would have to change to shorten it
- **Sizing** in relative terms with a confidence label per item. Never a single-point date for unscoped work.
- **Risks** with mitigations and owners
- **Cut list per phase** — what gets dropped first if the phase runs late, decided now rather than under pressure
- **Waves inside each phase**, per product area: the smallest set of shippable stories that delivers a verified increment on the customer surface, each wave building on the one before. Publication (store or directory submissions, a launch) is a wave of its own after the wave it publishes. Every area in play goes in the `## Areas` table; a new one carries a reason citing the owner's record. Prefer work that builds on verified work (`node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.js select`)

**2. Reconcile value against real cost — the second prioritisation pass.** `prioritization.md` ranked requirements on value with pre-architecture effort guesses. Now the architecture has revealed what things actually cost, so re-check the staging against real numbers.

Look specifically for **inversions**: a requirement sitting in the MVP whose cost turned out far higher than assumed, or a deferred requirement that turns out nearly free once the MVP work exists. Both are common and neither is visible before architecture. For each inversion, state the value, the revised cost, and a recommendation.

Do not silently re-stage. Prioritisation is the Product Owner's call — present the inversions and let them decide, then record what they chose.

**3. QA Strategist places the verification.** Delegate to `delivery:qa-strategist` to map risk-based coverage onto the phases, so testing is continuous rather than a final phase.

**4. Critic checks the plan holds.** Delegate to `delivery:feature-critic` (read-only) specifically to check: do parallel tracks secretly share a person or an unbuilt component? Does the sequence match the architecture's dependencies? Is integration deferred to the end? Fold blocking findings in.

**5. Write the roadmap** to `.delivery/initiatives/<initiative>/roadmap.md` using `${CLAUDE_PLUGIN_ROOT}/templates/roadmap.md`. Trace each phase back to the `FR-n` IDs it delivers, so coverage gaps are visible.

## Exit criteria

- Within the template's budget, or the overrun declared in the document with its reason — count the words, do not estimate

- Every phase has a demonstrable exit criterion, not an internal artifact
- The critical path is named
- Dependencies outside the team's control have owners and dates
- Sizes carry confidence labels
- Each phase has a cut list
- Each phase is cut into waves per area, and every new area has a reason citing an owner record
- Every `FR-n` in the PRD maps to a phase, or is explicitly deferred

## Writing, then revising

**Budget: 700 words target, 1100 hard cap** (excludes code, YAML and data tables). Compose, measure and revise as *Writing, then revising* in the conventions says.

## Hand off

Report exit criteria status. Call out any `FR-n` that landed in no phase — that is a silent scope drop and the Product Owner needs to see it. If the plan cannot fit the scope, present the tradeoff with options rather than trimming requirements to make a date work. Next step: `/delivery:stories`.
