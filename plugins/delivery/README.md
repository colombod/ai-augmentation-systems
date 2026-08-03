# delivery

You supply **intent** — why this app exists, what it should do — and optionally a
**design seed** for identity and look and feel. The plugin produces everything needed
to reach implementation, runs implementation as sprints, and reviews whether each
sprint is actually acceptable.

## Why this exists

Persona libraries ([wshobson/agents](https://github.com/wshobson/agents),
[VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) give you a
`product-manager` agent but no pipeline — nothing connects one role's output to the
next role's input. Method frameworks
([BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) give you the pipeline but
arrive as a CLI installer that writes into your project, with a module ecosystem you
mostly won't use. Neither models the **customer**, and neither closes the loop by
checking whether what shipped was any good.

## The pipeline

```
INTENT (+ design seed)
   │
 1 │ /delivery:brief          idea → framed project
 2 │ /delivery:research       prior art, domain constraints, what the codebase forecloses
 3 │ /delivery:personas       end-user personas, graded by evidence
 4a│ /delivery:interview      simulated interviews → needs, objections
 4b│ /delivery:simulate       journey walk-through → friction map, load-bearing steps
 5 │ /delivery:prd            scenarios, falsifiable criteria, NFRs as numbers
 6 │ /delivery:prioritize     MVP stages + milestones, from friction data
 7 │ /delivery:design         seed → tokens, states, accessibility rules
 8 │ /delivery:architecture   design against the real codebase, ADRs, spikes
 9 │ /delivery:roadmap        risk-first sequencing + value/cost reconciliation
10 │ /delivery:stories        self-contained, implementation-ready
11 │ /delivery:sprint         automated implementation wave
12 │ /delivery:sprint-review  acceptance verdict → feeds the next cycle
   ↺
/delivery:challenge   adversarial panel — usable at ANY gate
/delivery:status      gates, open findings, drift, sprint state
```

Every phase reads the previous artifact and **stops if it is missing** rather than
improvising one. That gate is the point: it is what stops a confident plan being built
on nothing.

## The five ideas doing the real work

**1. Adversarial review is a mechanism, not a phase.** `/delivery:challenge` runs a
lens-diverse panel against any artifact, picked by artifact type, always including the
`feature-critic` — the only reviewer with no stake in the artifact moving forward.
Reviewers run in parallel and cannot see each other, so independent convergence means
something. Findings are **written to `docs/product/reviews/` with a status**, and
`/delivery:status` keeps reporting anything `open`. A finding leaves the list by being
fixed or rejected-with-a-reason, never by being ignored.

**2. Personas are graded by evidence, and simulation is labelled synthetic.** Every
persona is `observed`, `reported`, or `assumed`. Simulated interviews and journey walks
are hypothesis generators, not findings — every artifact says so at the top. A
fabricated user who agrees with you is worse than no user: it manufactures confidence
and is very hard to argue with. Grades propagate, so prioritisation states how much of
itself rests on invented people.

**3. Prioritisation is two-pass.** A value-only pass after simulation (cheap — stops you
specifying things you'll cut), then cost reconciliation inside `/delivery:roadmap` once
architecture reveals real cost. That second pass looks for **inversions**: MVP items far
costlier than assumed, deferred items now nearly free. Neither is visible before
architecture.

**4. A stage must serve somebody completely.** An MVP stage is not a batch of features —
it is a set that lets **at least one persona finish a journey and get value**. The
simulation's per-persona coverage data is what tests this. A stage serving nobody
end to end is a project milestone, not a release.

**5. Sprint review is independent of the sprint.** The sprint reports its own results;
the review re-checks acceptance criteria against the code as it now exists. Where log
and code disagree, the code wins and the discrepancy is itself a finding. It also walks
personas through the **real** implementation — because every story can pass while no one
can actually complete a journey.

## Skills

| Skill | Purpose |
| :-- | :-- |
| `/delivery:brief` | Problem, users, cost of the status quo, MVP boundary |
| `/delivery:research` | Prior art, domain constraints, technical landscape, cited |
| `/delivery:personas` | 3–5 behavioral personas, evidence-graded, with abandonment conditions |
| `/delivery:interview` | Non-leading simulated interviews, run in parallel |
| `/delivery:simulate` | Journey walk-through → ranked friction map |
| `/delivery:prd` | Scenarios with error paths, falsifiable criteria, NFRs as numbers |
| `/delivery:prioritize` | Requirement scoring, MVP stages, milestones |
| `/delivery:design` | Seed → tokens, component states, computed contrast |
| `/delivery:architecture` | Real-codebase design, alternatives, spikes, migration |
| `/delivery:roadmap` | Risk-first sequencing, critical path, cut lists, inversions |
| `/delivery:stories` | Vertical slices carrying full context and design tokens |
| `/delivery:sprint` | Automated implementation wave with explicit stop conditions |
| `/delivery:sprint-review` | Independent acceptance verdict + calibration feedback |
| `/delivery:next-story` | Single-story implementation |
| `/delivery:challenge` | Adversarial panel against any artifact |
| `/delivery:status` | Gates, open findings, drift, evidence grounding |

## Personas

**Team roles** — Product Owner, Program Manager, Business Analyst, Solution Architect,
Design Lead, Delivery Lead, QA Strategist, and the read-only Feature Critic.

**Customer side** — User Researcher (derives and grades personas) and Persona Simulator
(embodies one end-user persona, read-only, output always labelled synthetic).

Each has an explicit *"what you push back on"* section. Invoke one directly with
`@delivery:product-owner` when you want a single opinion rather than a whole phase.

## Artifacts

All under `docs/product/` in the target project, all markdown in git:

```
brief.md   research.md   prd.md   prioritization.md   design-system.md
architecture.md   roadmap.md
personas/    interviews/    simulations/
decisions/ADR-NNN-*.md      stories/<epic>-<nn>-*.md
reviews/<artifact>-<nn>.md  sprints/<n>-*.md + -review.md
```

Requirement IDs (`FR-n`, `NFR-n`) assigned in the PRD thread through prioritisation,
architecture, roadmap, stories and tests. `/delivery:status` walks that chain to find
requirements no story covers and documents that have drifted apart.

## Adapting it

Everything is markdown. Edit `agents/*.md` to change a persona's stance, or
`templates/*.md` to change what an artifact must contain — skills reference the
templates, so both stay in step. To use a path other than `docs/product/`, say so in
your project's `CLAUDE.md`.
