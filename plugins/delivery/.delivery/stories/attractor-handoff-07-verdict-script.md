<!--
BUDGET — target 700 words, hard cap 1200 words. Excludes code, YAML and data tables.
Stories carry full context deliberately — cut restatement, never context an implementer needs.
-->

---
id: attractor-handoff-07
title: Build compute-sprint-verdict.js (FR-18 transitive debt-taint walk)
status: ready
epic: attractor-handoff
supersedes: []
superseded_by: []
superseded_reason:
phase: "Phase 1 — Prove the mechanism, ship the deterministic scripts, template prerequisite"
requirements: [FR-17, FR-18]
depends_on: []
size: M
---

# Build compute-sprint-verdict.js (FR-18 transitive debt-taint walk)

> This file is the complete context. Someone opening only this file — a teammate who missed
> the planning, or an agent with no memory of it — must be able to finish the work.

**Over the 1200-word hard cap, declared not silent:** this story reproduces `ADR-013`'s exact
algorithm in full (per the task brief) and enumerates every fixture cell the task and
architecture.md's Test strategy row require — both debt-taint sources, the 2-hop chain, and the
"no `outputs=` declared" case — as explicit, falsifiable acceptance criteria and test rows.
Compressing further would mean cutting one of those required cases rather than restatement,
which this document's own writing standard protects against.

## Goal

Given a sprint's per-story outcome and `outputs=` consumption facts, deterministically compute
(a) which stories are **debt-tainted**, and (b) the sprint-level verdict — `Accepted`,
`Accepted with debt`, or `Not accepted`. This is `FR-18`'s mechanism: the single
highest-consequence judgment call the whole `attractor-handoff` feature produces, built as
real, tested code an operator can trust — never an agent's self-graded read of a table.

## Context

`FR-16` requires `/delivery:sprint-review` to stay unmodified beyond consuming `sprint.md`'s
widened Outcome enum. That only holds if something already knows, before sprint-review runs,
whether a `done` story's correctness secretly rests on a `non-convergent`/`irreducible` story's
declared output. `ADR-013` settles who computes that, closing two review findings on the
original `FR-18` draft: **QA-strategist** flagged that "agent prose reading tables" would make
this the single most self-report-risk-prone output in a feature built to remove self-report
risk (the same bug class `research.md` found live in Argo Workflows — a retry's real outcome
failing to propagate into the overall verdict); **feature-critic** found the original two-clause
`FR-18` had no rule for a `non-convergent`/`irreducible` story consuming *another*
`non-convergent`/`irreducible` story's output — a chained-debt case the compiler's own data
already answers if asked.

`ADR-013`'s decision: this is **deterministic code**, `hooks/scripts/compute-sprint-verdict.js`
— the same real-tooling precedent this plugin already has in `hooks/scripts/record-invocation.js`.
It walks the compiled `.dot`'s own `outputs=`-consumption graph — the **Dataflow ledger**
(glossary term: attractor's own `outputs=`-driven record of which node owes a declared context
key and hasn't delivered it) — **transitively, not just one hop**.

**Why this story has no dependencies and sits first in Phase 1** (roadmap.md's Phase 1
work-item table: "None — pure fixture-testable"): the compiled `.dot` doesn't exist until Phase
2, and "wire this script to a real compiled pipeline" is its own Phase 3 item, depending on this
one. This story therefore builds the **algorithm** against an already-resolved, story-level data
shape, not a `.dot` parser — see Interfaces and Out of scope for the exact boundary.

**`FR-17` is in scope here only as an input contract, not work this story implements.** `FR-17`:
a story's `Outcome` ∈ `{done, non-convergent, blocked, not attempted}`; `m` includes
`irreducible` criteria, `n` never does; a story carrying an unresolved `irreducible` criterion
never reaches `done` — per the PRD's 2026-08-13 correction, **there is no "signed-off"
exception**. This script assumes that rollup already happened upstream, but its own debt-taint
check must hold even if that assumption is ever violated elsewhere — the "no signed-off
exception" acceptance criterion below is this story's real, falsifiable stake in `FR-17`.

## Files and modules

| Path | What to do |
| :-- | :-- |
| `plugins/delivery/hooks/scripts/compute-sprint-verdict.js` | create — pure functions implementing the transitive debt-taint walk and the sprint-verdict mapping, plus a thin CLI entry point |
| `plugins/delivery/hooks/scripts/compute-sprint-verdict.test.js` | create — `node:test` unit tests, fixture matrix per Test approach below |
| `plugins/delivery/.claude-plugin/plugin.json` | modify — version bump (`0.13.0` → next patch/minor), per this plugin's own convention (see Ship readiness) |
| `plugins/delivery/hooks/scripts/record-invocation.js` | read-only reference — this plugin's real Node-tooling precedent: pure exported functions, a `main()` CLI wrapper, `module.exports` listing everything tested |
| `plugins/delivery/hooks/scripts/record-invocation.test.js` | read-only reference — `node:test` style/structure to follow (`test('name', () => { ... })`, `assert.equal`/`assert.ok`, no test framework beyond Node's built-in) |

## Interfaces and contracts to honor

**Input shape.** This script consumes an already-resolved, story-level graph, not raw `.dot`
text. It mirrors the real mechanism (`plugins/attractor/README.md`, "Dataflow: `outputs=`"): a
node's `outputs="key,key"` declares what it promises; any other node whose prompt/
`tool_command` substitutes one of those keys **consumes** it; if the declaring node fails, every
consumer is blocked, and the block is **transitive** ("the blocked node's own `outputs=` then
enter the ledger against itself"). This script reimplements that logic at the **story** level
(one story can own several compiled criteria/gates), over facts already extracted from the
compiled artifact:

```js
/**
 * One story's already-resolved facts. Phase 3's still-to-be-built .dot-to-
 * story adapter produces this shape from the real compiled artifact; this
 * script never parses `.dot` syntax itself (see Out of scope).
 *
 * @typedef {Object} StoryNode
 * @property {string} id
 *   Story ID, e.g. "s3".
 * @property {'done'|'non-convergent'|'blocked'|'not attempted'} outcome
 *   FR-17's closed Outcome enum, already rolled up by the caller.
 * @property {boolean} nonConvergent
 *   True iff this story's own gate/fix loop exhausted its declared attempt
 *   bound (FR-9). Carried as its own field, independent of `outcome`, so the
 *   two debt-taint self-sources ADR-013 names can be exercised separately —
 *   architecture.md's Test strategy row requires both be covered, not
 *   inferred from one another.
 * @property {boolean} irreducible
 *   True iff this story carries at least one unresolved `irreducible`
 *   criterion (glossary term). FR-17: a story carrying one never reaches
 *   `done` — no signed-off exception.
 * @property {string[]} declaresOutputs
 *   `outputs=` keys this story's own compiled gate(s) declare. `[]` if none
 *   (a legitimate, explicitly-covered case — see FR-18 below).
 * @property {string[]} consumesOutputs
 *   `outputs=` keys substituted into any of this story's own compiled node
 *   prompt/tool_command text (real example from architecture.md's per-gate
 *   node structure: story `s3`'s criterion `c2` declares `"s3_c2.result"`).
 */

// A story is debt-tainted if it is itself non-convergent/irreducible, or if
// it consumes a declared outputs= key from a debt-tainted story — checked
// transitively (FR-18, ADR-013).
function computeDebtTaint(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));

  // Each key belongs to exactly one declaring story (the compiler's own
  // node-ID convention namespaces keys by story ID, e.g. "s3_c2.result").
  const ownerOfKey = new Map();
  for (const s of stories) {
    for (const key of s.declaresOutputs || []) ownerOfKey.set(key, s.id);
  }

  const tainted = new Map();   // storyId -> boolean, memoized
  const inProgress = new Set(); // cycle guard — a valid dependency graph is
                                 // acyclic (FR-2's topological sort), but this
                                 // walk must never hang if that ever breaks.

  function isTainted(id) {
    if (tainted.has(id)) return tainted.get(id);
    if (inProgress.has(id)) return false; // defensive, not expected to fire
    inProgress.add(id);

    const story = byId.get(id);
    let result = false;
    if (story) {
      if (story.nonConvergent || story.irreducible) {
        result = true; // the two self-taint sources — both must be checked
      } else {
        for (const key of story.consumesOutputs || []) {
          const ownerId = ownerOfKey.get(key);
          if (ownerId && ownerId !== id && isTainted(ownerId)) {
            result = true;
            break;
          }
        }
      }
    }
    inProgress.delete(id);
    tainted.set(id, result);
    return result;
  }

  for (const s of stories) isTainted(s.id);
  return tainted; // Map<storyId, boolean>
}

// Sprint verdict maps to the existing three-way rubric — no fourth verdict
// (FR-18).
function computeSprintVerdict(stories) {
  const taint = computeDebtTaint(stories);
  const debtTaintedStoryIds = stories.filter((s) => taint.get(s.id)).map((s) => s.id);

  const anyDoneStoryTainted = stories.some((s) => s.outcome === 'done' && taint.get(s.id));
  if (anyDoneStoryTainted) {
    return { verdict: 'Not accepted', debtTaintedStoryIds };
  }
  if (debtTaintedStoryIds.length > 0) {
    return { verdict: 'Accepted with debt', debtTaintedStoryIds };
  }
  return { verdict: 'Accepted', debtTaintedStoryIds: [] };
}
```

**CLI contract, minimal, Phase-1-scoped:** `main()` reads a JSON array of `StoryNode` from
stdin and writes `JSON.stringify(computeSprintVerdict(stories))` to stdout — mirroring
`record-invocation.js`'s `main()`/`module.exports` shape, with **one deliberate divergence**:
`record-invocation.js` is an observing hook, bound to never throw or exit non-zero, because
nothing can block on it. This script is the opposite — the highest-consequence output in the
feature — so malformed input must fail **loudly** (non-zero exit, a stderr message), never
swallow an error silently. Copying the "never throw" rule here would reintroduce the exact
self-report/silent-pass risk `ADR-013` exists to remove.

`module.exports` must include at least `computeDebtTaint` and `computeSprintVerdict`, callable
directly by tests without going through stdin/stdout.

## Relevant design decisions

- **`ADR-013`** — this story's entire reason to exist: verdict mapping is deterministic code,
  not agent prose, and the walk must be transitive, not one-hop. Both alternatives it rejected
  (adding the check to `sprint-review`; agent-executed prose) are why this lives in its own
  script rather than folded into a skill's Markdown.
- **`FR-16`** — `/delivery:sprint-review` stays otherwise unmodified. This script's output feeds
  the `Evidence` cell sprint-review already reads; sprint-review itself never runs this logic.
- **`FR-17`** — the input contract's precondition (Outcome rollup, no signed-off exception). Not
  implemented here — see Out of scope — but its "no exception" guarantee is directly tested here
  (see Acceptance criteria).
- **Glossary — `Dataflow ledger`, `Non-convergent`, `Irreducible criterion`** — used exactly as
  defined; do not introduce a synonym (e.g. never "blocked-output map" or "timed out").

## Acceptance criteria

- [ ] `FR-18` — a story with `nonConvergent: true` (and `irreducible: false`, no consumption) is
  debt-tainted.
- [ ] `FR-18` — a story with `irreducible: true` (and `nonConvergent: false`, no consumption) is
  debt-tainted — a **distinct** fixture from the one above; both self-taint sources are each
  independently tested, not inferred from a shared fixture (architecture.md's Test strategy row:
  "a walk correct on one taint source but not the other would pass an incomplete matrix").
- [ ] `FR-18` — a story that consumes a declared `outputs=` key belonging to a debt-tainted story
  is itself debt-tainted (direct, 1-hop consumption).
- [ ] `FR-18` — a story **two hops** downstream in a consumption chain (A tainted → B consumes
  A's output → C consumes B's output, C never references A's key directly) is correctly flagged
  debt-tainted. This is the exact case `ADR-013` added after feature-critic's chained-debt
  finding; a one-hop-only implementation must fail this case.
- [ ] `FR-18` — a debt-tainted story that declares `declaresOutputs: []` cannot taint any
  downstream story (nothing exists for anything to consume) — the sprint verdict is
  `Accepted with debt`, never `Not accepted`, in this configuration, matching `FR-18`'s explicit
  clause ("including the case where it declared no `outputs=` at all — by construction nothing
  can be silently relying on it").
- [ ] `FR-18` — `computeSprintVerdict` returns `Not accepted` when any `outcome: 'done'` story is
  debt-tainted, directly or transitively.
- [ ] `FR-18` — `computeSprintVerdict` returns `Accepted with debt` when a debt-tainted story
  exists but no `done` story is debt-tainted.
- [ ] `FR-18` — `computeSprintVerdict` returns `Accepted` when no story is debt-tainted.
- [ ] `FR-17` — a fixture with an internally inconsistent input (`outcome: 'done'` together with
  `irreducible: true`, which should never occur upstream per `FR-17`'s rollup) still resolves
  debt-tainted — demonstrating no signed-off/bypass exception exists in this walk, matching
  `FR-17`'s explicit removal of the "signed-off" exception even under a malformed input.
- [ ] `node --test plugins/delivery/hooks/scripts/compute-sprint-verdict.test.js` exits 0 with
  every case above present and passing.

## Test approach

**Level:** Unit (`node --test`) — pure logic, no filesystem/network/attractor dependency.
Matches architecture.md's Test strategy row for this script exactly ("Unit... Fixture matrix:
direct consumption, no consumption (incl. no `outputs=` declared), 2-hop chain") plus the
roadmap's Phase 1 verification addition ("fixture matrix including **both**
`non-convergent`- and `irreducible`-sourced debt-taint cases").

**Cases:**

| Case | Setup | Expected |
| :-- | :-- | :-- |
| Non-convergent-sourced taint | Story A: `nonConvergent: true`, `irreducible: false`, consumes nothing | `computeDebtTaint([A]).get('A') === true` |
| Irreducible-sourced taint | Story A: `nonConvergent: false`, `irreducible: true`, consumes nothing | `computeDebtTaint([A]).get('A') === true` |
| Clean story, no taint sources | Story A: both flags `false`, consumes nothing | `computeDebtTaint([A]).get('A') === false` |
| Direct consumption (1-hop) | A tainted (`nonConvergent: true`), `declaresOutputs: ["s_a.result"]`; B: both flags `false`, `consumesOutputs: ["s_a.result"]` | `computeDebtTaint([A,B]).get('B') === true` |
| No consumption at all | A tainted, `declaresOutputs: ["s_a.result"]`; B: both flags `false`, `consumesOutputs: []`, unrelated to A | `computeDebtTaint([A,B]).get('B') === false` |
| No `outputs=` declared by the tainted story | A tainted (`irreducible: true`), `declaresOutputs: []`; B consumes nothing | `computeDebtTaint([A,B]).get('B') === false`; `computeSprintVerdict([A,B]).verdict === 'Accepted with debt'` (never `'Not accepted'`) |
| 2-hop chain | A tainted (`nonConvergent: true`), declares `["s_a.x"]`; B: both flags `false`, consumes `["s_a.x"]`, declares `["s_b.y"]`; C: both flags `false`, consumes `["s_b.y"]` only (never `"s_a.x"`) | `computeDebtTaint([A,B,C]).get('B') === true` and `.get('C') === true` |
| Verdict: Not accepted | Same 2-hop chain, `C.outcome = 'done'` | `computeSprintVerdict([A,B,C]).verdict === 'Not accepted'` |
| Verdict: Accepted with debt | Same 2-hop chain, no debt-tainted story has `outcome: 'done'` (e.g. `C.outcome = 'blocked'`) | `computeSprintVerdict([A,B,C]).verdict === 'Accepted with debt'` |
| Verdict: Accepted | No story tainted (all flags `false`, arbitrary `outcome` values) | `computeSprintVerdict(...).verdict === 'Accepted'` |
| FR-17 no-signed-off-exception (defensive) | Story A: `outcome: 'done'`, `irreducible: true` (inconsistent input) | `computeDebtTaint([A]).get('A') === true` — the outcome label never overrides the flag |
| Cycle guard (defensive) | Two stories whose `consumesOutputs`/`declaresOutputs` reference each other (should not occur in a valid `depends_on` DAG, but must not hang) | Function returns synchronously, no stack overflow, no infinite loop |
| CLI: malformed stdin | `node compute-sprint-verdict.js` given invalid JSON on stdin | Non-zero exit, stderr message — never a silent empty success |

**Run with:** `node --test plugins/delivery/hooks/scripts/compute-sprint-verdict.test.js`

## Ship readiness

**Only applies when this story changes the plugin's own skills, hooks, agents, or
templates** — this one does: it adds a new file under `hooks/scripts/`, the exact directory
architecture.md calls "Real Node tooling precedent," alongside `record-invocation.js` and the
sibling `validate-attractor-pipeline.js`.

- [ ] Branch was fetched and compared against the real current `main` immediately before
      merge — not assumed current after time has passed. State the check, not just the result:
      `git fetch origin main && git log --oneline main..origin/main` (empty output = current).
- [ ] `plugins/delivery/.claude-plugin/plugin.json`'s `version` is bumped — confirmed convention
      in this repo's own history (`08acbcb`, `0cb8a3b`: version bumps accompany hooks/scripts
      changes), not assumed.
- [ ] Named explicitly, not silently passed over: this script is **not** wired into
      `hooks.json`, any `SKILL.md`, or any live invocation path by this story — that is Phase
      3's "Verdict mapping wired to `compute-sprint-verdict.js`" work item, which depends on
      this one. Until Phase 3 lands, `node --test` is the only executed verification this story
      produces; there is no live-session behavioral check to run, and none is claimed.

## Out of scope

- **Parsing a real compiled `.dot` file's `outputs=`/prompt/`tool_command` text into the
  `StoryNode` shape.** Phase 3's own work item ("Verdict mapping wired to
  `compute-sprint-verdict.js`," roadmap.md), depending on Phase 2's compiled-artifact format.
  This story's fixtures construct `StoryNode` objects directly, in-memory.
- **Wiring this script into `skills/handoff/SKILL.md`'s Report-back section, `hooks.json`, or
  any live invocation.** Phase 3, not Phase 1.
- **`FR-17`'s own Outcome-rollup arithmetic** (deriving `outcome`/`irreducible`/`m`/`n` from raw
  per-criterion results). Assumed already done upstream; a separate, already-distinct Phase 3
  work-item line ("Story `Outcome` rollup... (`FR-17`)") from this story's `FR-18` line.
- **Deeper-than-2-hop chain fixtures.** The walk itself is unbounded recursion, not hardcoded to
  2 hops, so deeper chains work by construction — but the required fixture matrix stops at 2
  hops, matching architecture.md's stated bar. Its Risks register already tracks "misses a case
  beyond 2-hop chains" as a named, Low-likelihood risk with its own trigger ("extend if a 3-hop
  scenario is found in practice"); not re-litigated here.
- **`templates/sprint.md` / `skills/sprint/SKILL.md`'s Outcome-enum edit.** A separate Phase 1
  work item in the roadmap's own table.
- **`validate-attractor-pipeline.js`** (`NFR-1` sizing check). A distinct script, distinct
  requirement; not touched here.

## Dependencies

None — matches roadmap.md's Phase 1 table exactly ("`compute-sprint-verdict.js` ... None — pure
fixture-testable"). Phase 1's stated entry criteria (`attractor` plugin installed, `attractor
doctor` passes, per `ADR-008`) apply to the phase as a whole, but this particular script never
calls attractor and has no runtime dependency on it — stated for consistency with every sibling
Phase 1 story, not because this one actually needs it.

## Implementation notes

Filled in during and after implementation. Record surprises, deviations from the plan and the
reason, and follow-up work — anything a future reader would want.
