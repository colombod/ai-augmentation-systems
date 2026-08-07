<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Word count: ~2138 prose-only, by this project's own `grep -v '^|'` / code-fence-excluded
convention (see chief-of-staff-04's identical method) — past the template's hard cap.
Declared, not silent, same reasoning prd.md/architecture.md/roadmap.md/every prior
chief-of-staff story already uses: the plain pointer block, both reconciliation deltas, and
architecture.md's own reconciliation paragraph are reproduced in full rather than linked, so
this file needs no other document open beside it to insert seven near-identical sections
correctly and not accidentally drift the two that must differ.
-->

---
id: chief-of-staff-10
title: 'Roll out the "Chief of staff" pointer section to the remaining 7 consulting agents'
status: ready
epic: chief-of-staff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 9 — full 9-agent pointer-section rollout"
requirements: [FR-48]
depends_on: [chief-of-staff-08, chief-of-staff-09]
size: M
---

# Roll out the "Chief of staff" pointer section to the remaining 7 consulting agents

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work without
> reading `prd.md`/`architecture.md`/`roadmap.md` separately.
>
> **Word count: ~2138 prose-only** (code fences and table rows excluded, matching
> `chief-of-staff-04`'s own counting convention) — past the template's 1200-word hard cap.
> Declared above, not silent.

## Goal

Every consulting-agent file in this plugin — not just the 2 (`delivery-lead.md`,
`qa-strategist.md`) story `chief-of-staff-01`'s CoS-1 spike needed — carries the short "##
Chief of staff" pointer section that lets it make a real, ledger-visible Agent-tool call to
`agents/chief-of-staff.md` instead of reasoning a candidate question through silently, inline,
inside its own turn. This is what actually exposes the mechanism epic-wide, per
`roadmap.md`'s Phase 9.

## Context

`ADR-002`/`architecture.md`'s Component structure add one short standing-instruction section —
"in the same location and register as the existing '## Language' section every agent already
carries" — to each of the 9 consulting-agent files, "stating only the trigger condition, the
exact call to make, and the `FR-48` fallback, never the triage logic itself." Story
`chief-of-staff-01` built this for real but deliberately thin: a walking-skeleton
`agents/chief-of-staff.md` (real S-5 citation logic, stubbed S-6/S-7/S-8) plus the pointer
section on exactly `delivery-lead.md` and `qa-strategist.md` — the 2 files CoS-1's own "≥2
different consulting-agent types" bar required, chosen because neither carries a pre-existing
escalation habit to reconcile. That story's own Files-and-modules note reserves the remaining
work explicitly: *"`business-analyst.md` and `solution-architect.md` are explicitly excluded
from this story... that reconciliation text is reserved for story `chief-of-staff-10` and must
not be improvised here."* This story is that reservation, fulfilled.

**Entry criteria, stated plainly because getting this wrong is worse than not rolling out at
all:** `roadmap.md`'s Phase 9 entry criteria require Phase 8 complete — "the whole
S-5–S-8+S-10 mechanism is real, not just Phase 5's own 2-agent thin rollout." Extending the
pointer to 7 more agents while `agents/chief-of-staff.md` still returns CoS-1's labeled-stub
S-6/S-7/S-8 responses would mean seven more agents trusting a plausible-looking but fake
bounce/spike/queue outcome — CoS-1's own stub carried an explicit "this is a stub" disclaimer
for spike-grading purposes only; a wider rollout has no such safety net. This is exactly why
`chief-of-staff-08`/`chief-of-staff-09` (Phase 8) are hard dependencies, not soft ones.

**The two-tier split.** Of the 9 consulting agents (every agent but `persona-simulator.md`),
2 already carry the section (`chief-of-staff-01`). Of the remaining 7: 5 have no
pre-existing escalation habit and get the identical plain block CoS-1 already wrote
(`design-lead.md`, `feature-critic.md`, `product-owner.md`, `program-manager.md`,
`user-researcher.md`). 2 — `business-analyst.md` and `solution-architect.md` — already carry a
pre-existing, working escalation habit that architecture.md requires this addition to
reconcile with, not silently duplicate. `agents/persona-simulator.md` stays untouched:
confirmed by direct read to carry no "## Language" section at all, and its own frontmatter
(`disallowedTools: Write, Edit, NotebookEdit`) already forbids it from being a pipeline writer
— consistent with `ADR-002`'s "role-plays an end user, not a pipeline worker" rationale.

## Files and modules

Real paths, verified against the repo (`plugins/delivery/agents/`). Line numbers below are the
`## Language — your standing responsibility` and `## Boundaries` headings in each file today —
re-check them if either file has changed since this story was written.

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/agents/design-lead.md` | **modify** — insert the plain block (below) after `## Language — your standing responsibility` (line 45), before `## Boundaries` (line 70) |
| `plugins/delivery/agents/feature-critic.md` | **modify** — same plain block, after line 37, before line 62 |
| `plugins/delivery/agents/product-owner.md` | **modify** — same plain block, after line 40, before line 65 |
| `plugins/delivery/agents/program-manager.md` | **modify** — same plain block, after line 43, before line 68 |
| `plugins/delivery/agents/user-researcher.md` | **modify** — same plain block, after line 53, before line 78 |
| `plugins/delivery/agents/business-analyst.md` | **modify** — insert the plain block **plus** the business-analyst reconciliation paragraph (below), after line 47, before line 72 |
| `plugins/delivery/agents/solution-architect.md` | **modify** — insert the plain block **plus** the solution-architect reconciliation paragraph (below), after line 45, before line 70 |

Not touched by this story: `agents/delivery-lead.md`, `agents/qa-strategist.md` (already done,
`chief-of-staff-01`) and `agents/persona-simulator.md` (deliberately excluded, see Context).

## Interfaces and contracts to honor

**Plain block — byte-identical to `chief-of-staff-01`'s own text, reused verbatim for all 7
files (5 get exactly this; 2 get this plus their delta below).** Consistency across files is
the whole point of a shared pointer (`ADR-002`'s "## Language" precedent) — do not rephrase,
shorten, or "improve" this wording per file:

```
## Chief of staff

When a question forms mid-task that would otherwise go straight to the operator — because
nothing in front of you settles it — consult chief of staff before asking directly. Invoke
the Agent tool with `subagent_type: "delivery:chief-of-staff"`. State in your prompt: the
candidate question verbatim, what you already checked and why nothing settled it, and which
of S-5 (already answered somewhere real), S-6 (scope you invented, not the plan), or S-7 (a
technical unknown, not a decision) you believe applies — chief of staff may reclassify.

If chief of staff is unavailable, unconfigured, or errors, fall back to asking the operator
directly, exactly as you do today — never block on this, never drop the question silently
(`FR-48`).
```

**`business-analyst.md` delta — append this paragraph inside the same section, after the two
paragraphs above:**

```
**This does not replace your own Open Questions convention.** Your existing "Track open
questions as first-class items" habit stays exactly as-is — that mechanism is for your own
deliverable output (feeding `prd.md`'s Open Questions table via a reviewed phase, not an ad
hoc mid-task interrupt), a different case from a candidate question that would otherwise
surface directly to the operator. Chief-of-staff consultation applies only to the latter.
```

**`solution-architect.md` delta — append this paragraph inside the same section, after the two
paragraphs above:**

```
**This does not duplicate your own spike-flagging habit.** Your existing "Flag these as
spikes with a specific question and a time box" convention already *is* S-7's own mechanism,
natively — you already do this. Consult chief of staff only when a technical unknown surfaces
outside your own spike-authoring context, e.g. while reviewing another role's output, not as
a second, redundant routing step for the same event you would already flag as a spike
yourself.
```

Both deltas are adapted into each file's own second-person voice from `architecture.md`'s
Component structure — see Relevant design decisions for that source text, reproduced verbatim
rather than paraphrased, per this story's own instruction.

## Relevant design decisions

- **`ADR-002`** — "Every consulting agent's persona file gets a short new section, in the same
  location as its existing '## Language' section, stating the trigger condition, the exact
  call to make, and the `FR-48` fallback — never the triage logic itself." This story is the
  7-file completion of that decision; nothing here reopens it.
- **`architecture.md`'s Component structure — the reconciliation paragraph, quoted verbatim
  because it is the authority for both deltas above, not paraphrased:**

  > Two of the nine already have a pre-existing, working escalation habit that this addition
  > must reconcile with, not silently duplicate (feature-critic finding, folded in here):
  > `business-analyst.md`'s "Track open questions as first-class items" and
  > `solution-architect.md`'s "Flag [unproven assumptions] as spikes with a specific question
  > and a time box" both predate this epic and already route their own findings to a written
  > artifact — never to a mid-work operator interruption. Neither is the failure mode
  > S-5/S-6/S-7 exist to intercept, so neither instruction is edited or superseded. The
  > per-file pointer section states this explicitly rather than leaving it to be inferred:
  > for `business-analyst.md`, its existing Open Questions convention stays exactly as-is —
  > that mechanism is for a role's own deliverable output (feeding `prd.md`'s Open Questions
  > table via a reviewed phase, not an ad hoc mid-task interrupt), a different case from S-5's
  > "candidate question that would otherwise surface directly to the operator." Chief-of-staff
  > consultation applies only to the latter. For `solution-architect.md`, its existing
  > spike-flagging habit already *is* S-7's own mechanism natively — the pointer section says
  > so directly ("you already do this; consult chief of staff only when a technical unknown
  > surfaces outside your own spike-authoring context, e.g. while reviewing another role's
  > output") rather than instructing a second, redundant routing step for the same event.
- **`roadmap.md`'s Phase 9 table** — sizes this exact split as "S (5 files)" + "M (2 files,
  a judgment call per file, not copy-paste)"; this story merges both into one deliverable
  rather than two, since the 2-file delta is small once the plain block already exists.

## Acceptance criteria

- [ ] `FR-48` — all 7 files' new sections state the fallback verbatim: if chief of staff is
      unavailable, unconfigured, or errors, the agent asks the operator directly, exactly as
      it does today — never blocks, never silently drops the candidate question.
- [ ] Each of the 7 files gains a "## Chief of staff" section inserted immediately after its
      existing "## Language — your standing responsibility" section and immediately before
      "## Boundaries" — same location every file in this plugin already uses.
- [ ] `design-lead.md`, `feature-critic.md`, `product-owner.md`, `program-manager.md`, and
      `user-researcher.md` each contain the plain block byte-identical to `chief-of-staff-01`'s
      own text for `delivery-lead.md`/`qa-strategist.md` — states the trigger condition, the
      exact call (`subagent_type: "delivery:chief-of-staff"`), and the `FR-48` fallback; does
      not restate S-5/S-6/S-7's triage logic itself.
- [ ] `business-analyst.md`'s section carries the plain block plus its reconciliation
      paragraph, stating explicitly that its Open Questions convention is not superseded or
      duplicated.
- [ ] `solution-architect.md`'s section carries the plain block plus its reconciliation
      paragraph, stating explicitly that its spike-flagging habit is not superseded or
      duplicated.
- [ ] `agents/persona-simulator.md` is unmodified — no "## Chief of staff" section, no other
      change.
- [ ] All 9 non-excluded consulting-agent files now carry a "## Chief of staff" section; a
      diff review confirms the 7 covered here (5 + 2) and the 2 covered by `chief-of-staff-01`
      read as one consistent set — identical wording except the 2 files' own reconciliation
      deltas.
- [ ] At least one of the 7 newly-extended agents is observed, in a real live session,
      actually invoking chief of staff via a real Agent-tool call (ledger-confirmed per
      `harden-05`'s mechanism) when a genuine candidate question forms mid-task — narrated
      without a matching ledger line does not satisfy this.

## Test approach

**Level:** example-based / manual review. This is a markdown convention change across 7
files, not executable logic — same reasoning the harden epic gave Phase 0's template edit, and
the same level `chief-of-staff-01` itself used ("empirical spike, not a test" for the
live-invocation half; plain diff review for the text half).

**On the "was the existing '## Language' section's 10-file consistency ever formally
checked" question — answered directly, not assumed:** it was not. `git log -- agents/` shows
the "## Language" section was introduced in one direct commit (`6cea411`, "feat: ubiquitous
language, curated by every agent rather than a phase"), predating this repo's
story-tracking discipline entirely — no story, ADR, or review file in `.delivery/` records a
check of its cross-file consistency. `ADR-002` *asserts* the pattern "survives across 10 files
without drifting," but that assertion has no cited verification behind it, only the
architect's own read of the files. This story does not inherit a precedent that never
existed; the diff-review case below is this epic's first actual check of that claim, for the
"## Chief of staff" section specifically.

**Cases:**

| Case | Expected |
| :-- | :-- |
| Diff/grep the 5 plain files for "## Chief of staff" | Section present, wording identical to the plain block above, placed between Language and Boundaries |
| Diff/grep `business-analyst.md` and `solution-architect.md` | Section present, plain block + the file's own reconciliation delta only — no other line in the file changed |
| Diff/grep `agents/persona-simulator.md` | No diff at all |
| Cross-file consistency check across all 9 sections (7 here + 2 from `chief-of-staff-01`) | Identical wording for the 7 plain-block files (5 here + `delivery-lead.md`/`qa-strategist.md`); the 2 reconciliation files differ only by their delta paragraph |
| Live session: one of the 7 newly-extended agent types forms a genuine candidate question mid-task, engineered the same way `chief-of-staff-01`'s CoS-1 trials were (never a scripted "now call chief of staff" instruction) | A real `chief-of-staff` Agent-tool call appears in `.delivery/invocations/<session_id>.ndjson` (`tool_name: "Agent"`, `invoked_name: "delivery:chief-of-staff"`) — quote the matching line |
| Same live-session trial, but the agent narrates consultation with no matching ledger line | Fails the acceptance criterion — narration is not evidence, same standard `chief-of-staff-01` set |

**Run with:** no automated test runner exists for this plugin's agent-file conventions;
verification is (a) a direct `grep -n "^## Chief of staff"` across all 9 non-excluded files
plus a manual side-by-side text diff of the sections, and (b) a real Claude Code session
dispatching one of the 7 newly-extended agent types (via the Agent tool,
`subagent_type: "delivery:<agent-name>"`) on a task engineered to surface a genuine candidate
question, then inspecting `.delivery/invocations/<session_id>.ndjson` for a real
`chief-of-staff` call — the identical method and mechanism `chief-of-staff-01`'s own CoS-1
spike already established and ran (`harden-05`/`harden-06`'s ledger, live-verified 21/21).

## Out of scope

- Re-measuring consultation-compliance rate at full 9-agent scale. `chief-of-staff-01`'s CoS-1
  measured it at 2-agent scale (its own provisional ≥70% pass bar); a full-scale
  re-measurement across all 9 agents is real future work, named here rather than assumed —
  the 2-agent result is not claimed to generalize by this story.
- Building or upgrading `agents/chief-of-staff.md` itself, or `skills/chief-of-staff/SKILL.md`
  — Phase 6–8's job (stories `chief-of-staff-03` through `chief-of-staff-09`), which this
  story depends on rather than duplicates.
- Testing `FR-48`'s fallback behavior itself (the unavailable/unconfigured/erroring case) —
  stated verbatim in each section's text, but exercising it is a fixture-based test named as
  separate work in `architecture.md`'s Test strategy table, same exclusion `chief-of-staff-01`
  already stated for its own 2 files.
- Updating `.delivery/stories/README.md`'s index table to include the `chief-of-staff` epic.
  Several sibling stories (`chief-of-staff-01` through `-05`, `-07`) are being authored
  concurrently with this one; editing a shared index file here risks clobbering that
  concurrent work. Named as a real follow-up, not silently skipped.
- Any change to `agents/delivery-lead.md`, `agents/qa-strategist.md` (done), or
  `agents/persona-simulator.md` (deliberately excluded).

## Dependencies

- **`chief-of-staff-08`, `chief-of-staff-09`** (Phase 8 — S-8 briefing assembly + `FR-49`
  merge check) must be `done` first. `roadmap.md`'s Phase 9 entry criteria require "Phase 8
  complete — the whole S-5–S-8+S-10 mechanism is real, not just Phase 5's own 2-agent thin
  rollout." See Context above for why this is a hard, not soft, dependency: the pointer
  section this story writes tells 7 more agents to trust chief of staff's response, and that
  response is only trustworthy once S-6/S-7/S-8 are real logic, not CoS-1's labeled stub.
- **Honestly stated, not guessed:** as of this writing, `.delivery/stories/` contains
  `chief-of-staff-01` through `chief-of-staff-05` and `chief-of-staff-07` (Phases 5, 6, 7,
  7b) — `chief-of-staff-06` (the remaining Phase 7 scenario) and `chief-of-staff-08`/`-09`
  (Phase 8) have not yet been authored. This story's own content is complete and
  implementable now; it cannot move past `ready` to `in-progress` until those stories exist
  and reach `done`. This is the same pattern already established by `chief-of-staff-02`
  through `-07` in this same batch, each marked `ready` while depending on a sibling that was
  itself only `ready`, not `done`, at the time it was written.
- **The one open question this story does *not* have** — which 2 of the 9 files
  `chief-of-staff-01` already used — is resolved, not guessed: `chief-of-staff-01` exists
  (status `ready`), used `delivery-lead.md` and `qa-strategist.md` by name, and its own text
  explicitly reserves the 7-file/2-delta completion for "story `chief-of-staff-10`" — this
  story. No reconciliation step remains on that question.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
