# delivery

Role personas and a phase-gated pipeline that turns a feature idea into a PRD,
an architecture, a delivery roadmap, implementation-ready stories, and finally code.

## Why this exists

Two things already exist and neither is quite this. Persona libraries
([wshobson/agents](https://github.com/wshobson/agents),
[VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) give you a
`product-manager` agent but no pipeline — nothing connects one role's output to the
next role's input. Method frameworks
([BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) give you the pipeline
but arrive as a CLI installer that writes into your project, with a module ecosystem
you mostly won't use.

This plugin takes the part of BMAD that earns its keep — **the artifact contract
between roles, and phase gates that refuse to proceed on missing input** — and ships
it as a small, plugin-native package you own and can edit.

## The pipeline

```
/delivery:brief             → docs/product/brief.md
      ↓
/delivery:prd               → docs/product/prd.md            (FR-n, NFR-n get stable IDs)
      ↓
/delivery:review-scenarios  → read-only adversarial panel, findings only
      ↓
/delivery:architecture      → docs/product/architecture.md + decisions/ADR-*.md
      ↓
/delivery:roadmap           → docs/product/roadmap.md        (phases, critical path, cut lists)
      ↓
/delivery:stories           → docs/product/stories/*.md      (self-contained)
      ↓
/delivery:next-story        → code + tests, verified against acceptance criteria

/delivery:status            → where you are, what's stale, what's inconsistent (any time)
```

Every phase reads the previous phase's artifact and **stops if it is missing** rather
than improvising one. That gate is the whole point: it is what stops a confident plan
being built on nothing.

## Skills

| Skill | Purpose |
| :-- | :-- |
| `/delivery:brief` | Discovery — problem, users, cost of the status quo, MVP boundary |
| `/delivery:prd` | Scenarios with error paths, falsifiable acceptance criteria, NFRs as numbers |
| `/delivery:review-scenarios` | Four independent reviewers in parallel; deduplicated, ranked findings |
| `/delivery:architecture` | Design against the real codebase, alternatives, spike list, migration plan |
| `/delivery:roadmap` | Risk-first sequencing, dependencies, critical path, per-phase cut list |
| `/delivery:stories` | Vertical slices carrying full context, readiness-checked |
| `/delivery:next-story` | Implement, test, verify criteria-first |
| `/delivery:status` | Gate status, story counts, cross-document drift |

## Personas

| Agent | Owns | Pushes back on |
| :-- | :-- | :-- |
| `product-owner` | Value, scope, acceptance criteria | Scope creep, criteria that restate the title |
| `program-manager` | Sequencing, dependencies, risk, roadmap | Uniform phases, integration deferred to the end |
| `business-analyst` | Requirement precision, edge cases, NFRs | "etc.", "handle appropriately", missing failure paths |
| `solution-architect` | Technical design, ADRs, buildability | Abstractions for use cases that don't exist yet |
| `delivery-lead` | Story decomposition and readiness | Horizontal slices, stories assuming you were in the meeting |
| `qa-strategist` | Test strategy, verification evidence | Unverifiable criteria, "we'll add tests later" |
| `feature-critic` | Adversarial read (read-only) | The load-bearing assumption nobody noticed making |

Invoke one directly with `@delivery:product-owner` when you want a single opinion
rather than a whole phase.

## Artifacts

All under `docs/product/` in the target project:

```
brief.md          prd.md          architecture.md    roadmap.md
decisions/ADR-NNN-<slug>.md
stories/<epic>-<nn>-<slug>.md     stories/README.md
```

Everything is markdown in git — diffable, reviewable, and readable without this plugin.

## Design choices worth knowing

**Stories carry their full context.** Story files are long on purpose. The relevant
slices of the PRD and architecture are copied *into* each story rather than linked,
so an implementer with no memory of the planning can finish the work from one file.

**Requirement IDs are the spine.** `FR-n` and `NFR-n` are assigned in the PRD and
referenced by the architecture, roadmap, stories and tests. `/delivery:status` uses
them to find requirements no story covers.

**Review is read-only and independent.** `review-scenarios` runs four reviewers in
parallel so they can't converge on each other, then deduplicates. Independent
agreement between reviewers is treated as a strong signal.

**Gates report honestly.** Each skill has explicit exit criteria and reports which
are unmet. A phase whose artifact exists but fails its exit criteria is reported as
in progress, not complete.

## Adapting it

Everything is markdown. Edit `agents/*.md` to change a persona's stance, or
`templates/*.md` to change what an artifact must contain — the skills reference the
templates, so both stay in step. To use a path other than `docs/product/`, say so in
your project's `CLAUDE.md`.
