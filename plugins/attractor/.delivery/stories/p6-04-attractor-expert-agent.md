---
id: p6-04
title: attractor-expert agent — rewritten from amplifier's, engine-specific integration guidance only
status: ready
epic: Phase 6 — FR-13-16 (S7 authoring skill / TS-library packaging)
supersedes: []
superseded_by: []
superseded_reason:
phase: Phase 6
requirements: [FR-14, FR-15]
depends_on: [p6-02]
size: M
---

# attractor-expert agent

> This file is the complete context. Someone opening only this file — a teammate
> who missed the planning, or an agent with no memory of it — must be able to
> finish the work. Extract what is needed from the PRD and architecture into
> this document rather than linking out.

## Roadmap item

FR-13–16 (S7), Phase 6. Root `AGENTS.md`'s porting table: `agents/attractor-expert.md`
— "**Rewrite.** Keep the design-time self-check (CMD hazards, judge verdict contracts,
delta-assertion gates, deferral routing) — engine-independent. Replace all integration
guidance with ours."

## Goal

`plugins/attractor/agents/attractor-expert.md` — a Claude Code subagent definition, the
consultation target the `attractorify` skill (p6-05) delegates to at design start, mid-build,
and final review. Keeps amplifier's design-time self-check checklist (genuinely
engine-independent — it's about prompt/gate hygiene, not runtime mechanics). Everything
about *this engine's* actual behavior — handler set, lint codes, verdict contract,
integration paths — is rewritten from this project's own material (p6-02's
`engine-semantics.md`/`routing-reference.md`/`dot-reference.md`, p6-03's
`pipeline-design-principles.md`/`pipeline-patterns.md`), not carried over from
amplifier's Python-embedding-specific integration guidance (`DirectProviderBackend` vs
`AmplifierBackend`, bundle/profile config — none of which exists in this engine at all).

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/attractor/agents/attractor-expert.md` | new |

## Content requirements

Claude Code subagent frontmatter (`name`, `description` — including the "MUST be used
when..." trigger list amplifier's own version uses, adapted) plus a body covering:

- **Knowledge base**: links to this project's own five reference files (p6-02, p6-03),
  not amplifier's `context/`/`docs/` paths.
- **What it knows**: DOT syntax and the **six registered handlers only** — do not list
  `Handler.HUMAN`/`Handler.FAN_IN`/`Handler.MANAGER_LOOP` as patterns it can help design;
  name them as spec-legal-but-unregistered, refused by `HAND-001` (same framing as
  `dot-reference.md`, p6-02) so the agent doesn't recommend a shape that will be refused.
  No `model_stylesheet`, no fidelity modes, no `DirectProviderBackend`/`AmplifierBackend`
  integration paths (none of that exists in this engine) — replace with this engine's
  real integration surface: the CLI (`skills/attractor/SKILL.md`) and the library entry
  point (`engine/src/index.ts`, p6-01).
- **Example pipelines**: cites only the examples this project actually ships
  (p6-07, per [ADR-019](../decisions/ADR-019-example-portability-policy.md)'s table) —
  not amplifier's full 16, and not `task-runner.dot` (excluded).
- **Design-time self-check** (ported near-verbatim, per the porting table): CMD-001/
  CMD-002 pipe-masked-exit-code and always-true-sentinel hazards, judge-verdict-contract
  checks (adapted to this engine's `goal_gate=true`-only rule, FR-15 — not
  `report_outcome`), delta-assertion gate discipline, deferral/observer routing power.
  These four are genuinely engine-independent prompt/gate-hygiene checks — keep their
  substance; only the code-example syntax needs to match this engine's DOT dialect where
  the checklist item includes one.
- **Session entry point**: directs to `/attractorify` (p6-05) for a guided design
  conversation, same relationship amplifier's own version states.

## Relevant design decisions

- **[ADR-018](../decisions/ADR-018-reference-material-porting-split.md)** — this agent's
  knowledge-base links point at p6-02/p6-03's files, which are already correct against
  this engine; the agent file itself should not restate engine facts those files already
  own (link, don't restate — same discipline the ported `SKILL.md` names explicitly).

## Acceptance criteria

- [ ] `FR-14` — the agent's own "What it knows" / pattern-recommendation content never
      presents `Handler.HUMAN`, `Handler.FAN_IN`, or `Handler.MANAGER_LOOP` as an
      available design option; each is named explicitly as unregistered/refused where
      mentioned at all.
- [ ] `FR-15` — the judge-verdict-contract self-check item states the `goal_gate=true`-only
      rule, consistent with p6-02's `routing-reference.md`/`engine-semantics.md` (same
      fact, not a third independent wording that could drift).
- [ ] No reference to `model_stylesheet`, `DirectProviderBackend`, `AmplifierBackend`,
      `PreparedBundle`, or any other amplifier-Python-specific integration concept
      anywhere in the file.
- [ ] Every `@`-style or path-style reference to a reference file resolves to a real path
      under `plugins/attractor/skills/attractorify/reference/` or
      `plugins/attractor/skills/attractorify/examples/` (post p6-02/p6-03/p6-07) — no
      dangling reference to an amplifier-only path (`context/`, `docs/`, amplifier's
      example filenames not in the portability table).
- [ ] The design-time self-check section (CMD hazards, judge verdict, delta-assertion,
      deferral routing) is present and substantively matches amplifier's own four
      checklist items in intent, adapted only where the DOT dialect or verdict rule
      differs.

## Test approach

**Level:** doc-consistency (this is a markdown agent-definition file, not code). Extend
p6-02's `check-consistency.mjs` script: (1) zero hits for
`model_stylesheet|DirectProviderBackend|AmplifierBackend|PreparedBundle`, (2) zero hits
presenting `hexagon|tripleoctagon|house` as a usable/recommended shape (reuse the same
check p6-02 already wrote, applied to this file too), (3) every relative reference
resolves to a real path in this repo.

**Run with:** `node plugins/attractor/skills/attractorify/reference/check-consistency.mjs`
from the repo root.

## Out of scope

- The `attractorify` skill itself (`SKILL.md`) — p6-05.
- Any change to the existing operator-facing `skills/attractor/SKILL.md`.

## Dependencies

Depends on p6-02 (needs `engine-semantics.md`/`routing-reference.md`/`dot-reference.md`
to exist so its knowledge-base links resolve and its verdict-contract statement can be
checked for consistency against them). Does not depend on p6-03, though referencing it
is natural if both are done.
