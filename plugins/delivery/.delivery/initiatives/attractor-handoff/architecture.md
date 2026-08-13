# Architecture: Attractor handoff runner mode

> Phase 8 artifact. Owned by Solution Architect, with QA Strategist.
> Status: draft · Last updated: 2026-08-13
> PRD: `.delivery/initiatives/attractor-handoff/prd.md`

## Approach

One compiled DOT pipeline per sprint, built entirely from attractor's **documented interface** (`plugins/attractor/README.md` — a precise term, see glossary; never its engine source or build status). The most important decision: the bounded gate/fix retry loop — the mechanism the whole feature's value rests on — is built from the engine's actual, empirically-verified primitives (a deterministic `parallelogram` gate whose own shell command counts attempts and routes on plain string equality), not from a `condition=` counter comparison (grammatically impossible, confirmed by running it through `attractor lint`) or `max_retries=` (only fires on a self-graded `box` node's `RETRY` verdict, never on our deterministic gate). See `ADR-011` for the full reasoning chain, including a real documentation gap this initiative found and got fixed upstream (`github.com/colombod/ai-augmentation-systems#40` → `#42`).

## Codebase context

| Path | Role today | Change |
| :-- | :-- | :-- |
| `plugins/delivery/skills/handoff/SKILL.md` | Compiles a sprint scope package into `superpowers` or `generic` artifacts | **Extended** — new `## Runner: attractor` section |
| `plugins/delivery/templates/sprint.md` | Scope table, verification contract, Required report-back table | **Extended** — Outcome column: one cell, `done / blocked / not attempted` → `done / non-convergent / blocked / not attempted` |
| `plugins/delivery/skills/sprint/SKILL.md` | Instructs what a runner reports back | **Extended** — line ~106's own enum restatement needs the same fourth value, or `/delivery:sprint` will keep telling superpowers/generic runners the old three-value contract while the template it fills in now allows four (found independently by QA-strategist review, §0.4) |
| `plugins/delivery/templates/story.md` | Source of `depends_on`, acceptance criteria | **Untouched** — already carries what compilation consumes |
| `plugins/delivery/skills/sprint-review/SKILL.md` | Independent re-verification, three-way verdict | **Untouched** (`FR-16`) — verified its procedure re-derives met/not-met from code, never switches on the Outcome column's literal string |
| `plugins/delivery/hooks/scripts/*.js` | Real Node tooling precedent | **Extended** — two new scripts, below |
| `plugins/attractor/README.md`, CLI | External, stable dependency | **Untouched** — consumed via documented CLI/DOT contract only |
| `.delivery/sprints/<n>-<slug>-attractor.dot`, `...-attractor-manifest.md` | — | **New**, produced per sprint (data, not plugin source) |

## Setup — prerequisite, not a feature or a phase

Binds explicitly to `plugins/delivery/.delivery/decisions/ADR-008-setup-is-a-prerequisite-not-a-feature.md` (full path stated deliberately — attractor's own decision log has an unrelated `ADR-008`; resolves brief `OQ-7`).

| Setup item | Establishes | Blocks |
| :-- | :-- | :-- |
| `attractor` plugin installed | Runner availability | `FR-13` / Runner availability check |
| `attractor doctor` passes | Tooling precondition | S-5, partially closes `OQ-9` |
| Bootstrap subgraph (`Mdiamond` start, `--param`-seeded context) compiled ahead of any story node | Carries "Either mode" carryover (stop conditions, design tokens) | Fixed overhead in `NFR-1`'s sizing formula, never counted against a story's own budget |

None of these get an `FR-n` or a roadmap phase.

## Component structure

```
skills/handoff/SKILL.md
├── Handoff readiness check (shared, extended: FR-19 zero-criteria + OQ-11 zero-story)
├── Runner: superpowers (unmodified)
├── Runner: generic (unmodified)
└── Runner: attractor (NEW)
    ├── Runner availability check      — FR-13/14
    ├── Compilation                    — dependency graph + acceptance gates + irreducible flags
    ├── Substitution list (inline)     — FR-6 (ADR-012)
    └── Report-back                    — FR-15/17/18/20, verdict mapping (ADR-013)

templates/sprint.md               — Outcome column: +1 value
skills/sprint/SKILL.md            — enum restatement: +1 value

hooks/scripts/
├── validate-attractor-pipeline.js (NEW) — deterministic sizing check (NFR-1)
└── compute-sprint-verdict.js      (NEW) — FR-18's transitive debt-taint walk (ADR-013)
```

**Dependency direction:** `handoff/SKILL.md` depends on `sprint.md`'s schema and attractor's documented CLI/DOT contract. Nothing in `plugins/attractor` depends on delivery. `sprint-review/SKILL.md` depends on `sprint.md`'s schema exactly as before — it does not know attractor exists.

## Interfaces and data contracts

**Compiled artifact = two files**, joined by a node-ID convention (`<story-id>__<criterion-id>__{fix,gate}`) — not by duplicating criterion text into DOT comments; `FR-5`'s "no external lookup" is satisfied by the manifest, per S-2's own wording ("reading the two side by side" names the sprint package and the compiled artifact, not two halves of the compiled artifact against each other).

**`<n>-<slug>-attractor.dot`.** Per acceptance gate, a two-node cycle (`ADR-011`):

```
s3_c2__fix  [shape=box, prompt="<criterion text, FR-n, prior failure evidence>"]
s3_c2__gate [shape=parallelogram, goal_gate=true,
             tool_command="<compiled check>; c=$(( $(cat <ctr> 2>/dev/null || echo 0)+1 )); echo $c > <ctr>;
                            if <passed>; then printf gate_pass;
                            elif [ \"$c\" -ge <BOUND> ]; then printf gate_giveup;
                            else printf gate_retry; fi",
             outputs="s3_c2.result"]

s3_c2__fix -> s3_c2__gate
s3_c2__gate -> <next node>          [condition="context.tool.last_line=gate_pass"]
s3_c2__gate -> s3_c2__fix           [condition="context.tool.last_line=gate_retry"]
s3_c2__gate -> <non_convergent tag> [condition="context.tool.last_line=gate_giveup"]
```

Gate preference: **`parallelogram` wherever a criterion compiles to a real command**, falling back to `box` only when none exists — rare, per `NFR-1`'s compile-rate assumption, and flagged in the manifest per gate when it happens (attractor's own `HITL-003` lint warning names exactly this self-report risk).

Story ordering: topological sort of `depends_on` (`FR-2`, 1:1); independent stories get one deterministic total order (declaration order in `sprint.md`'s Scope table) — not parallel branches (`component`/`tripleoctagon` remain lint-refused; this feature's own non-goal, unaffected by that status either way).

**`<n>-<slug>-attractor-manifest.md`** — the static, compile-time traceability document:

| Section | Content | FR |
| :-- | :-- | :-- |
| Irreducible criteria (leads) | Story, criterion, `FR-n`, reason | `FR-12` |
| Per-gate table | Story ID, criterion ID, criterion text, `FR-n`, derived check summary, node-ID prefix, attempt bound, timeout, gate shape (parallelogram/box) | `FR-5`, `FR-6`, `FR-7`, `FR-20` |
| Dependency graph | `depends_on` edges, verbatim | `FR-2` |
| Sizing declaration | stories × criteria × bound → projected node-visits vs. ceiling | `NFR-1` |
| Fixed disclosures | No resume path (`NFR-3`); do not share `--run-dir` (`NFR-4`) | `NFR-3`, `NFR-4` |
| Literal next command | `attractor run <path> --run-dir .attractor/runs/<slug>-<timestamp>` | S-1 |

**Per-attempt runtime evidence — a real boundary, stated explicitly (closes feature-critic's finding on multi-cycle traceability):** the manifest is a *static*, compile-time document. It cannot contain what a fix cycle actually tried at runtime — that's attractor's own job, and attractor already does it: every node visit is a real event in `--run-dir`'s `events.jsonl`, addressable by the same node-ID convention (`s3_c2__gate`) the manifest already declares. A reviewer tracing one criterion's history reads the manifest for *what was checked and why*, then the run's own event log — located via the literal next command's `--run-dir` — for *what actually happened, attempt by attempt*. The manifest does not duplicate that log; it names the key that finds it.

**`FR-18` verdict mapping** (`ADR-013`) — deterministic code, `hooks/scripts/compute-sprint-verdict.js`, not agent prose, not `sprint-review`. Walks the compiled `.dot`'s own `outputs=` references transitively: a story is *debt-tainted* if `non-convergent`/unresolved-`irreducible`, or if it consumes a debt-tainted story's output. **Not accepted** if any `done` story is debt-tainted; **Accepted with debt** if debt-tainted stories exist but nothing `done` depends on them; **Accepted** otherwise — sprint-review's existing, unmodified rubric reaches this verdict from the `Evidence` cell alone.

## Meeting the non-functional requirements

| NFR | Target | How the design meets it | Confidence |
| :-- | :-- | :-- | :-- |
| NFR-1 | Sprint-wide attempt bound stays under attractor's 500-node-visit ceiling | `ADR-011`'s two-node-per-attempt structure: `projected_visits ≈ 2 × Σ(attempt_bound per gate) + fixed_overhead` (down from an earlier four-node estimate). `hooks/scripts/validate-attractor-pipeline.js` computes this from the actual compiled `.dot` and refuses to write the artifact past a declared safety margin — real code, not agent arithmetic. The number itself is `OQ-2`, spike 1 | High on mechanism (now simpler and cheaper); number unproven |
| NFR-2 | Per-attempt wall-clock timeout | Attractor's own documented `timeout=` node attribute (README, added by `#42`) wraps `s3_c2__gate` directly — in-process enforcement, `FAIL` on fire, no external `timeout` binary needed (this replaces the earlier shell-`timeout`-wrapping idea; the real attribute exists and is simpler). Duration is `OQ-3`, spike 2 | High — mechanism now fully native, no binary precondition |
| NFR-3 | Remediation cost, no resume path | Manifest's fixed disclosure states this plainly every sprint. Directly shapes `ADR-010` (one graph per sprint) | High — a documentation commitment, not a mechanism to build |
| NFR-4 | Concurrent-run safety | Literal next command always names a unique `--run-dir` (`<slug>-<compile-timestamp>`); manifest states the unsafe-sharing risk explicitly | High |

## Decisions

| ADR | Decision | Alternatives rejected |
| :-- | :-- | :-- |
| ADR-009 | Artifact writes to `.delivery/sprints/`, never `.attractor/` (gitignored) | Mirror `superpowers`'s runner-owned tree; a new top-level convention |
| ADR-010 | One compiled pipeline per sprint | Per-story graphs (no resume mechanism to make it cheaper) |
| ADR-011 | Bounded retry via gate-owned shell arithmetic + 3-way string routing | `condition=` counter (grammatically impossible, empirically refused); `max_retries=` (wrong node-shape semantics); static unrolling (node-count blowup) |
| ADR-012 | `FR-6` substitution list lives inline in `SKILL.md` | A standalone reference file |
| ADR-013 | `FR-18` verdict mapping is deterministic code in handoff, walked transitively | Add to `sprint-review` (violates `FR-16`); agent prose (unverifiable, highest-consequence output) |

## Spikes — what must be proven before committing

| # | Question | Time box | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | `OQ-2`: real attempt-bound number(s) — run `validate-attractor-pipeline.js`'s formula against an assumed max scenario and confirm one dimension past it does truncate | 1 day | NFR-1 sign-off |
| 2 | `OQ-3`: real per-attempt `timeout=` duration | 0.5 day | NFR-2 sign-off |
| 3 | `OQ-9`: `attractor doctor` + a real `--stub` dry run in a fresh worktree with no prior grants — does a missing worktree/permission right fail cleanly at doctor/lint time, or crash mid-run? | 1 day | S-5 completeness |
| 4 | `OQ-10`: is a cheap file-existence pre-check worth adding per story group, or does real drift mostly show as content change rather than absence? | 0.5 day | S-1 completeness |
| 5 | Build the exact `ADR-011` gate (fix→gate, 3-way `gate_pass`/`gate_retry`/`gate_giveup` routing) as a real fixture; `attractor lint` clean; two `--stub` runs (fails-then-passes → `done` after one fix cycle; fails-through-bound → `non-convergent`) produce the expected node-visit counts | 0.5 day | `ADR-011` sign-off — the mechanism is now grammar-legal and grounded in a real executed example, but has not itself been run yet |

## Migration and rollback

**Forward.** `templates/sprint.md` line ~93:

Old: `\| \| done / blocked / not attempted \| n of m \| test name or observed behavior \| sha \|`
New: `\| \| done / non-convergent / blocked / not attempted \| n of m \| test name or observed behavior \| sha \|`

`skills/sprint/SKILL.md` line ~106 (found by QA-strategist review, not by the original design pass — a second, independent prose restatement of the same enum) needs the identical value added, or `/delivery:sprint` keeps briefing runners against the old three-value contract. `skills/handoff/SKILL.md` gains one new top-level section and one frontmatter-line edit (`Runner: **$ARGUMENTS** (`superpowers` \| `generic` \| `attractor`; defaults to asking)`). `skills/sprint-review/SKILL.md` — zero changes.

**Impact on existing `superpowers`/`generic` sprint logs: none.** Verified two ways: no script in `hooks/scripts/*.js` parses `sprint.md`'s Outcome column (`grep -rl "sprint" ...` → empty), and `sprint-review/SKILL.md`'s own procedure re-derives met/not-met from code independently rather than switching on that column's literal string — confirmed by reading the skill directly, not inferred from the grep alone (feature-critic's finding: the grep proves no *script* risk; this second check closes the *agent-reads-unfamiliar-prose* risk the grep alone couldn't see).

**Back.** Revert the two table/prose edits and delete the new `SKILL.md` section and the two new scripts. Any sprint log already written with `non-convergent` keeps it as a historical Markdown record, needing no data transformation.

**Not applicable:** no persisted data store, no API surface, no schema migration in the database sense.

## Test strategy

Risk-based, per QA-strategist review — full findings in that pass; summary here.

| Area | Risk | Test level | Notes |
| :-- | :-- | :-- | :-- |
| `validate-attractor-pipeline.js` sizing arithmetic | High — must measure runtime step-visits, not static node count (QA correction) | Unit (`node --test`, second real test-command story in this plugin) | Boundary cases: exactly-at-bound, bound+1, malformed `.dot` |
| `compute-sprint-verdict.js` transitive debt-taint walk | High — highest-consequence output; a 2-hop chain must resolve correctly | Unit | Fixture matrix: direct consumption, no consumption (incl. no `outputs=` declared), 2-hop chain |
| Compiled `.dot`'s validity | Medium | Integration — real `attractor lint` as the oracle, never a reimplemented checker | Fuzz story/criterion combinations through the compiler, lint every output |
| Gate/fix loop convergence, exhaustion, `outputs=` propagation | High — this is the Argo-Workflows-class bug (`research.md`) this feature must not reproduce | Integration — real `attractor run --stub`, no LLM cost | Fixtures: pass-first-attempt; fail-then-pass; fail-through-bound with a downstream consumer correctly blocked |
| Manifest structure (`FR-5/6/7/12/20`) | Low-Medium | Unit — parse and assert table contents | — |
| `FR-7` fixture-per-check | N/A — downgraded to `should` (`R-prd-12`) | Manual spot-check, not gated | Deliberately thin coverage; named explicitly, not hidden |
| SKILL.md prose itself | N/A for automation | No mechanical check exists or is proposed — verifiable only by a live compilation run, read by a human, same as every other skill file in this plugin | Consistent with this plugin's own research finding (1 of 21 stories has a real test command) |

**Deliberately thin coverage:** the compiled check's own semantic correctness (does the criterion-derived shell command actually test the right thing) is verified by `FR-7`'s fixture where one exists, and otherwise not mechanically verifiable at all — the same boundary this entire feature exists to be honest about, not to solve universally.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
| :-- | :-- | :-- | :-- | :-- |
| `ADR-011`'s gate mechanism, though now grammar-legal and grounded in a real example, has not itself been run through attractor | Low-Medium | High — the whole retry mechanism | Spike 5, first thing built |
| `compute-sprint-verdict.js`'s transitive walk misses a case beyond 2-hop chains | Low | Medium | Fixture matrix explicitly includes a 2-hop case; extend if a 3-hop scenario is found in practice |
| `box`-shaped gates (no deterministic command available) reintroduce self-report risk `HITL-003` warns about | Medium (depends on `OQ-18`'s compile-rate) | Medium | Manifest flags every `box`-shaped gate explicitly |
| `ADR-008`'s doctrine is still `proposed`, not `accepted`, in delivery's own decision log | Low | Low | Track its status; this design's Setup section matches its current text |
