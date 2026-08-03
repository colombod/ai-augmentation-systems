---
description: Convert a sprint scope package into the native format of an external implementation runner — superpowers, or a generic self-contained brief. Use after /delivery:sprint to hand work to the system that will actually build it. Writes no source code.
---

# Hand off to an implementation runner

Runner: **$ARGUMENTS** (`superpowers` | `generic`; defaults to asking)

This plugin plans, scopes, reviews and re-aligns. It does not build. This skill translates
the scope package into whatever the chosen runner expects, so the hand-off is a real
contract rather than a pile of markdown someone has to re-read.

## Gate check

Read the sprint scope package in `docs/product/sprints/`. If none exists, stop and run
`/delivery:sprint` first.

Verify the package is genuinely hand-off ready — each of these becomes a defect inside the
runner, where it is much more expensive to fix than here:

- Every story `ready`, every acceptance criterion falsifiable
- No open **blocking** findings against the specs in scope
- Every cited file path exists
- **No unresolved open questions in the stories.** Runners do not ask questions; they guess.

---

## Runner: `superpowers`

[obra/superpowers](https://github.com/obra/superpowers) —
`/plugin install superpowers@claude-plugins-official`.

Its native chain is `brainstorming` → `writing-plans` → `subagent-driven-development`.
This pipeline replaces the first step and can replace the second. **Which one you pick
matters**, so decide deliberately:

### Mode A — spec handoff (recommended)

Emit the design spec; let superpowers write its own execution plan.

**Write** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` — the path its
`writing-plans` skill looks for. Synthesize it from the pipeline's artifacts:

| Spec section | Sourced from |
| :-- | :-- |
| Problem and users | `brief.md`, `personas/` |
| Requirements | `prd.md` — keep the `FR-n`/`NFR-n` IDs |
| Scope boundary | `prioritization.md` — this stage only, plus what is excluded |
| Design constraints | `design-system.md` — token names, required states, a11y rules |
| Technical approach | `architecture.md` — components, interfaces, ADR outcomes |
| Verification | acceptance criteria and the exact test command |
| Known risks | open findings in `reviews/`, un-run spikes |

Then tell the user to run superpowers' `writing-plans` against it, followed by
`subagent-driven-development`.

**Why this is the default:** superpowers' plan format is tuned to its own executor —
tasks of 2–5 minutes, `Files:` and `Interfaces:` blocks, checkbox steps containing
*actual code*, and a hard ban on `TBD`/`TODO`. Reproducing that here means maintaining a
mirror of somebody else's contract, and it will drift silently the moment they change it.
This pipeline's value is upstream — research, personas, prioritisation, architecture,
adversarial review. Theirs is fine-grained execution planning. Let each do its own job.

### Mode B — plan handoff

Emit the execution plan directly and skip superpowers' planning step.

**Write** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` in its exact format:

- **Header**: feature name, note for agentic workers, goal, architecture, tech stack, global constraints
- **Per task**: `## Task N: [Component Name]`, then `Files:` (create / modify / test) and `Interfaces:` (consumes / produces)
- **Steps**: `- [ ] **Step N:** …` containing real code, real commands, and expected output
- **No placeholders.** `TBD` and `TODO` are forbidden by the format

**The granularity gap you must close.** Our stories are vertical slices sized for one
focused sitting. Superpowers tasks are 2–5 minutes with complete code inline. So this mode
requires genuinely decomposing each story into many tasks and writing the code into the
plan — it is not a reformat, it is a second planning pass. If you are not prepared to write
real code into the plan, use Mode A; a plan full of vague steps will produce worse output
than letting `writing-plans` do it properly.

Use Mode B when the work is mechanical and well-understood, or when you specifically want
this pipeline's review gates applied to the task breakdown itself.

### Either mode

Carry these across, since superpowers has no way to know them:

- The **stop conditions** from the scope package, and that an honestly-blocked task is a success
- **Do not weaken a test to make it pass** — report it instead
- Design tokens by real name; raw values not acceptable where a token exists
- The **required report-back**, which `/delivery:sprint-review` will consume

Note the ID mapping in the scope package — superpowers tasks do not carry `FR-n` IDs, and
the review needs to trace results back to requirements.

---

## Runner: `generic`

For your own harness, a contractor, or any agent without a fixed plan format. Write a
single self-contained brief to `docs/product/sprints/<n>-<slug>-handoff.md` containing the
scope package inline — stories, acceptance criteria, design constraints, verification
contract, stop conditions, working agreement and required report-back — assuming the reader
has no memory of the planning and cannot ask questions.

---

## Report

State which runner, which mode, the exact file written, and the literal next command the
user should run.

Then state plainly what the runner is **not** being told, and why that is acceptable —
usually the research, persona and prioritisation reasoning, which informed the scope but
is not needed to build it. If something load-bearing had to be dropped to fit the target
format, say so; that is a real loss in the hand-off and the user should know about it.

After the external run completes, the next step is `/delivery:sprint-review`, which
re-verifies independently rather than trusting the runner's own report, then
`/delivery:realign`.
