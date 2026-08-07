---
description: Convert a sprint scope package into the native format of an external implementation runner — superpowers, or a generic self-contained brief. Use after /delivery:sprint to hand work to the system that will actually build it. Writes no source code.
---

# Hand off to an implementation runner

Runner: **$ARGUMENTS** (`superpowers` | `generic`; defaults to asking)

This plugin plans, scopes, reviews and re-aligns. It does not build. This skill translates
the scope package into whatever the chosen runner expects, so the hand-off is a real
contract rather than a pile of markdown someone has to re-read.

## Where `.delivery/` resolves to

Not necessarily the repository root. Resolve before reading or writing anything below:

1. **Reuse.** An existing `.delivery/` anywhere reachable from the working directory wins — never create a second one.
2. **Explicit override.** Otherwise honor a delivery-root path stated in the nearest `CLAUDE.md`/`AGENTS.md`.
3. **Ask, don't guess.** Otherwise, if this repository holds more than one independently-releasable component (multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar) stop and ask which component this work belongs to. Silently defaulting to the repo root in a multi-component repo is the failure this step exists to prevent.
4. **Default.** Otherwise, use `.delivery/` at the repository root.

## Which initiative

Every artifact below lives under `.delivery/initiatives/<slug>/`, never directly under
`.delivery/` — this is what lets independent initiatives (epics, sprints, parallel
workstreams) be planned in parallel branches without colliding on the same shared file
(`ADR-004`; the incident that motivated it: two initiatives independently continued the same
`S-n`/`FR-n` sequence in one shared `prd.md`, discovered only at merge). Resolve which
initiative before reading or writing anything below:

1. **Explicit signal.** The user names an initiative, or one is already established for this
   conversation — use it.
2. **Exactly one exists.** If `.delivery/initiatives/` has exactly one subdirectory, use it
   without asking — this keeps single-initiative projects exactly as simple as before this
   convention existed.
3. **Ask, don't guess.** Otherwise (zero, or more than one, with no explicit signal) — ask
   which initiative this work belongs to, or whether to start a new one. Never silently
   default to the most recently modified one.
4. **Starting a new initiative.** Confirm its slug (kebab-case, derived from the brief
   subject or what the user names) before creating `.delivery/initiatives/<slug>/` — check it
   doesn't collide with an existing initiative slug or any other top-level `.delivery/` entry.
   A genuinely new initiative needs its own `/delivery:brief`, or an explicit
   `extends: <existing-slug>` note (in this new initiative's own first artifact) declaring it
   reuses an existing initiative's problem framing instead of running its own — state which,
   don't leave it implicit.

Cross-cutting, project-wide, never per-initiative: `.delivery/glossary.md`,
`.delivery/personas/`, `.delivery/interviews/`, `.delivery/simulations/`,
`.delivery/decisions/ADR-NNN-*.md`, `.delivery/invocations/<session_id>.ndjson`.
`.delivery/stories/`, `.delivery/reviews/`, `.delivery/sprints/` stay flat but are prefixed
by initiative slug, matching `stories/<slug>-NN-<name>.md`'s existing convention.

## Gate check

Read the sprint scope package in `.delivery/sprints/`. If none exists, stop and run
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

Emit a spec rich enough that `writing-plans` can produce a complete execution plan from
it and nothing else. **This is the whole job of Mode A** — the goal is not to summarize
the pipeline, it is to be sufficient input.

**Write** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` — the path its
`writing-plans` skill looks for.

**Match the section set `brainstorming` produces**, since that is what `writing-plans` is
built to read. Its five are **Architecture, Components, Data flow, Error handling,
Testing**. Emit those names, then add ours. Scale each to complexity — brief where the
answer is obvious, up to ~300 words where it is nuanced.

| Spec section | Sourced from |
| :-- | :-- |
| **Architecture** | `architecture.md` — structure and boundaries |
| **Components** | `architecture.md` — each unit and its purpose |
| **Data flow** | `architecture.md` interfaces and contracts — how information moves |
| **Error handling** | `prd.md` error and edge paths — failure modes and recovery |
| **Testing** | acceptance criteria + the exact test command |
| Problem and users | `brief.md`, `personas/` |
| Requirements | `prd.md` — keep the `FR-n`/`NFR-n` IDs |
| Scope boundary | `prioritization.md` — this stage only, plus what is excluded |
| Design constraints | `design-system.md` — token names, required states, a11y rules |
| Global constraints | version floors, **dependency limits**, naming and copy rules, platform requirements |
| Known risks | open findings in `reviews/`, un-run spikes |

Two rules from `writing-plans` that our artifacts violate by default:

**Write for someone who knows nothing about this domain.** It assumes the engineer is
"a skilled developer, but knows almost nothing about our toolset or problem domain."
Every artifact upstream of here was written for people who sat through the planning, so
it leans on domain vocabulary freely. Define the terms in the spec. A word the PRD uses
without explanation is a word the plan will guess at.

**Split independent subsystems into separate specs.** `writing-plans` asks for a spec
"broken into sub-project specs" when the work spans multiple independent subsystems. An
MVP stage often does. If yours does, emit one spec per subsystem and say which is which —
handing over one spec spanning three subsystems produces a plan with muddled boundaries.

#### The sufficiency gate

`writing-plans` must emit tasks of 2–5 minutes containing **real file paths, real
interfaces, actual code and expected command output**, and its format **forbids `TBD` and
`TODO`**. That ban is the danger: faced with a gap, it cannot leave a placeholder and it
cannot ask you — so it invents, confidently, and the invention reaches
`subagent-driven-development` as if it were a decision somebody made.

So before writing the spec, verify every one of these is present for **every story in
scope**. This pipeline already produces all of it — the check is that it actually did.

| `writing-plans` needs | Comes from | Missing means it will… |
| :-- | :-- | :-- |
| Goal — user-facing outcome | story goal | invent a rationale, then optimise for it |
| **Exact file paths**, create / modify / test | story file table, verified against the repo | guess a project layout |
| **Interfaces** — real signatures, schemas, shapes | story contracts, `architecture.md` | design an API on the spot |
| Tech stack and versions | `package.json` / project manifest, `architecture.md` | assume idioms from a different stack |
| **Actual commands** — build, test, dev | story test approach, project scripts | invent a command that does not exist |
| Global constraints and conventions | `AGENTS.md`/`CLAUDE.md`, `design-system.md` | write code that fails review on style |
| **Expected output** per verification step | acceptance criteria, test names | write a step nobody can check |
| Falsifiable acceptance criteria with `FR-n` | `prd.md` via the story | verify against its own interpretation |
| Explicit out-of-scope | story out-of-scope notes | helpfully add adjacent work |
| Domain terms defined | you, from the brief | guess at vocabulary it has never seen |
| Subsystem split, if the stage spans several | `architecture.md` boundaries | produce one plan with muddled boundaries |

**If any row is missing, stop and fix it upstream** — in `/delivery:stories` or
`/delivery:architecture` — rather than handing over a spec with a hole in it. A gap here
is cheap to close; the same gap discovered inside a subagent-driven run is not, and it
arrives disguised as a confident decision.

Record the ID mapping — `FR-n` → the spec section that carries it — so
`/delivery:sprint-review` can trace superpowers' task results back to requirements.

Then tell the user to run superpowers' `writing-plans` against the spec, followed by
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
- **No placeholders**, and the ban is broader than `TBD`/`TODO`. Also forbidden: "add appropriate error handling" without specifics, "similar to Task N" instead of repeating the code, steps that describe without showing code, and references to types or functions no task defines.
- **Type and name consistency across tasks** is checked: `clearLayers()` in task 3 and `clearFullLayers()` in task 7 is treated as a bug.

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
single self-contained brief to `.delivery/sprints/<n>-<slug>-handoff.md` containing the
scope package inline — stories, acceptance criteria, design constraints, verification
contract, stop conditions, working agreement and required report-back — assuming the reader
has no memory of the planning and cannot ask questions.

---

## Writing, then revising

**Budget: 800 words target, 1400 hard cap** (excludes code, YAML and data tables).

**Compose first. Do not try to hit the budget while writing.** Restraint during
composition trades substance for brevity in the wrong order — the findings get thinner
while the scaffolding survives. Write what the artifact needs, then cut what it does not.

**Then measure, do not estimate.** The budget counts **prose only**. Data tables, code
blocks and YAML are excluded, so measure with them stripped:

```bash
grep -v '^|' <the file you just wrote> | wc -w
```

A plain `wc -w` counts the tables and will overstate the total, often by several times.
Measuring the wrong number leads to cutting the wrong thing.

**Rows in a data table can never help you meet the budget, because they are not counted.**
Deleting them is pure loss for zero benefit. The term table, the requirement table, the
findings table, the friction map — these *are* the artifact. If a revision pass is removing
rows, it has misunderstood the rule and should stop.

**If the count exceeds 1400, you are not finished.** Make a revision pass over the file and
delete, in this order, until it fits:

1. Preamble, recap, and any sentence describing what the document is about to say
2. **Restatement** — the same fact as prose *and* a table row *and* a summary bullet. Keep the form that carries it best; delete the others. This is almost always the biggest win.
3. Process narration — "I examined X and found Y" becomes Y
4. Hedging — either you know it, or it is labelled an assumption. Both are shorter.
5. Citations past the first for a given claim
6. Examples past the first, unless the next one shows a *different* failure mode

Then re-measure with the same command and confirm.

**Never delete** any row of a data table, findings and their failure scenarios, one citation per claim, grounding
and confidence labels, synthetic-output warnings, open questions, or IDs a later phase
reads. If the artifact cannot fit without losing those, keep them, exceed the cap, and
**write the final count and the reason into the document**. A declared overrun is a
judgement. A silent one is a habit.


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
