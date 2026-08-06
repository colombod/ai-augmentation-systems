# Spec conformance audit — 2026-08-03

Audited against `strongdm/attractor` `attractor-spec.md`, sections 2, 3, 4, 5, 7, 10
and Appendices A-C, at engine commit `948378b` (186 tests).

**Verdict: superset with fixable contradictions.** The architecture is spec-shaped
and the deterministic core is largely faithful, but fourteen behaviours contradict
normative spec text rather than extending it. The project's stated rule is that we
may extend the spec and must never contradict it, so these are defects.

Every finding below carries a spec quote. Findings without one were not filed.

## Re-audit — 2026-08-04, after Plan 3 (spec correction)

Re-verified at engine commit `f8f981b`, 272 tests (271 pass, 1 live test skipped),
by reading the code as it now stands rather than the task reports. **Twelve of the
fourteen are CLOSED, two are PARTIALLY CLOSED, none are open.** Status and the
file:line that makes it so are recorded on each finding below.

Why the citations and not the reports: this document has already been wrong once in
a way that mattered. The Priority 3 entry claiming `fidelity`/`thread_id`/`llm_model`
were "ignored" was stale by the time Plan 2 shipped, and Plan 3 was grounded on it —
one plan away from re-implementing working thread-continuity code. A finding recorded
as closed when it is not is worse than one recorded as open. Reports say what an
implementer believed; only the code says what is true.

**Corrections to this document's own record, found by the re-audit:** the Task 8
brief expected C7, C10, C13 and C14 to still be open — they were scoped after all,
in commits `f536cbc` (C7, C10) and `7a962da` (C13, C14), and the audit text below
had never been updated to say so. Nothing was mis-recorded in the *closing*
direction: every entry previously marked CLOSED verified as closed against the code.

A residuals section at the end records five items found during Plan 3 and
deliberately deferred, each with the plan that should own it.

**Amendment — 2026-08-04, subgraph scoping.** The Priority 3 bullet recording subgraph
default scoping as open was *understated*, not merely open: the same parser shape
violated §2.10, §2.11 and §2.5, and the §2.5 violation silently replaced the pipeline's
`goal`. All three are now CLOSED (commit `2ba2ea7`, 401 tests, 400 pass, 1 live test
skipped); §2.10's class derivation is recorded as open and tied to the model-stylesheet
work. See the Priority 3 entry for the full record. This is the second time an entry in
this document was less true than the code — the first was the stale `fidelity` entry
above. An entry that understates a defect misroutes the plan that reads it just as an
entry that overstates one does.

**Read the "Whole-branch review corrections" section at the end before trusting any
individual finding's CLOSED status as a statement about the run.** Every one of these
findings was verified in isolation, and a subsequent whole-branch review found two
Critical defects in the *interactions* between findings that were each closed
correctly — C1/C2 composing into I1, and C4/C6 composing into I2. A per-finding audit
cannot see those, and this document's structure is per-finding.

**I1 is now CLOSED and I2 is RECLASSIFIED** by the dataflow plan; see the whole-branch
review section for both, and the dataflow residuals section at the end for what the fix
does not cover. I2's reclassification is a correction to *this document*: it filed a
spec-conformant engine behaviour as a Critical engine defect. Read it before treating
any run-level surprise as an engine defect.

---

## Priority 1 — core semantics other plans will build on

Fix these before Plans 3-6, because later work inherits the wrong behaviour.

### C1. Edge selection treats conditions as a filter, not an early return
> §3.3 Step 2: "**If no condition-matching edges were found** and the node's outcome
> includes a `preferred_label`, find the first **unconditional** edge whose `label`
> matches..." Pseudocode: `IF condition_matched is not empty: RETURN best_by_weight_then_lexical(condition_matched)`

`core/edge-select.ts` makes matched conditional edges the *eligible set*, then runs
preferred-label and suggested-ids over it. The spec returns immediately.

Divergence: two conditional edges match, A has higher weight, outcome's
`preferred_label` matches B. Spec picks A; we pick B.

**This one is mine, and it was introduced deliberately on a misreading.** A Plan 1
reviewer flagged the question as "cannot verify from diff"; the process makes
resolving such items the controller's job, and I resolved it the wrong way — I
asserted in a code comment that the cascade "is what the spec describes". It is not.
The lesson is narrower than "read the spec": an unverifiable item resolved by the
same judgement that wrote the code is exactly the self-certification the review
process exists to prevent.

Two sub-divergences in the same function:
- §3.3 Step 2 says "find the **first**" matching edge (declaration order); we sort by
  weight then lexical.
- §3.3 Step 3 iterates `suggested_next_ids` **in list order**, so the caller's
  ranking is authoritative; we collapse to a `Set` and re-rank.

**CLOSED** — Plan 3 Tasks 3 and 5, commits `7842cba` and `cc33acf`. All three halves
verified at `engine/src/core/edge-select.ts`:
- `:84-88` — step 1 returns immediately: `if (matched.length > 0) return
  matched.sort(byWeightThenTarget)[0]`. Steps 2 and 3 are unreachable once a
  condition matched, so a `preferred_label` can no longer override a matched
  condition.
- `:102-108` — preferred-label lookup is `unconditional.find(...)`, declaration order,
  no sort.
- `:112-117` — suggestions iterate the caller's array in list order; no `Set`.
Steps 2-5 are scoped to `unconditional` (`:97`), which is what §3.3 says.

### C2. Missing context keys fail closed; spec says they compare as empty string
> §10.3: "`context.*` keys look up values from the run context. **Missing keys
> compare as empty strings (never equal to non-empty values).**"

`core/condition.ts` returns false for the whole condition when a key is absent, for
`!=` as well as `=`.

Breaks the spec's own §10.6 loop-guard example,
`review -> iterate [condition="context.loop_state!=exhausted"]`: true under the spec
before `loop_state` is ever set, false under ours. Combined with fail-fast the run
dead-ends. **Any spec-authored graph guarding a loop with `!=` inverts.**

**CLOSED** — Plan 3 Task 4, commit `b51ab95`. `engine/src/core/condition.ts:41-51`:
`resolveKey` ends every branch with `?? ''`, so a missing key is the empty string and
never short-circuits the whole condition. Verified end to end against the rebuilt
bundle rather than only in unit tests: a graph whose sole route out of a node is
`condition="context.loop_state!=exhausted"` dead-ended `FAIL` on the pre-Plan-3
bundle and converges `start -> a -> b -> done` on the current one.

### C3. Unqualified condition keys are unresolvable
> §10.4: "Direct context lookup for unqualified keys" and, for prefixed keys, "**Also
> try without `context.` prefix** for convenience".

Only `outcome`, `preferred_label` and `context.*` resolve. `condition="tests_passed=true"`
is permanently false, and a context key literally named `context.foo` is unreachable.

**CLOSED** — Plan 3 Task 4, commit `b51ab95`. `engine/src/core/condition.ts:47-49`: a
`context.`-prefixed key tries the literal key first and then the unprefixed form
(`ctx.get(key) ?? ctx.get(key.slice(8))`), so a key literally named `context.foo` is
reachable; an unqualified key is a direct `ctx.get(key)` lookup at `:50`.

### C4. Goal gates checked over declared nodes, not visited ones
> §3.4: "Check all **visited** nodes that have `goal_gate=true`."

`core/engine.ts` iterates every declared node. A gate on a branch the run legitimately
did not take blocks exit forever — bouncing to `retry_target` until the step cap, then
FAIL. The spec exits SUCCESS.

Diverges fail-*open* in the other direction too: `goalGatesSatisfied` is a sticky Set,
never cleared, whereas the spec checks each gate's **latest** outcome. A gate that
passed on iteration 1 and failed on iteration 3 blocks exit under the spec, passes
under ours.

**CLOSED** — Plan 3 Task 6, commit `862564c`. `goalGatesSatisfied: Set<string>` became
`gateOutcomes: Map<string, Status>`, written on every completion of a goal-gate node and
read as "visited gates whose latest status is neither SUCCESS nor PARTIAL". Both halves
are fixed: gates are scoped to visited nodes, and the check is on the latest outcome
rather than ever-satisfied. `Checkpoint.goal_gates_satisfied` is derived at save time, so
the §5.3 wire shape is unchanged. Fail-closed goal gates are untouched — the satisfying
status set is still exactly SUCCESS/PARTIAL, and scoping to visited nodes was paired with
recording a gate's outcome *before* the retry machine, so a gate that RETRYs away to a
retry target and never returns still blocks the exit.

Re-verified 2026-08-04 at `engine/src/core/engine.ts`: `:91` declares
`gateOutcomes: Map<string, Status>`; `:234-241` writes it on every completion of a
`goal_gate="true"` node; `:369` is the call site, above the retry machine; `:169-175`
is `unsatisfiedGoalGates()`, iterating only map entries (visited gates) and testing
the latest status against SUCCESS/PARTIAL; `:415` is the exit-time check.
`:162-164` derives the §5.3 `goal_gates_satisfied` wire field at save time.

### C5. Default retry count is 2; spec says 0
> §3.5: "If neither is set, the built-in default is 0 (no retries)."

Every node in a graph declaring no retry attributes silently gets 3 executions instead
of 1. A cost and timing contract, not a style choice.

**CLOSED** — Plan 3, commit `f36ce24`. `engine/src/core/retry.ts:10-17`:
`DEFAULT_POLICY.maxRetries` is `0`, and `resolveRetryPolicy` (`:26-33`) falls back to
it only after `max_retries`, `default_max_retries` and the `default_max_retry` alias.
`max_retries=N` still means N+1 attempts, so an explicit declaration is unchanged.

### C6. FAIL never consults `retry_target`
> §3.7: failure routing order is "1. Fail edge ... **2. Retry target** ... **3.
> Fallback retry target** ... 4. Pipeline termination."

We reach `resolveRetryTarget` only on RETRY exhaustion, never on a FAIL outcome. A
node with `retry_target` that returns FAIL should jump; ours ends the run.

**CLOSED** — Plan 3 Task 6, commit `862564c`. `resolveRetryTarget` is now consulted when
`selectEdge` returns nothing for a FAIL outcome, which places it after step 1 and before
step 4. Fail-fast on FAIL is unchanged and still tested: the ladder is only entered when
no edge matched, so no unconditional edge carries a failure forward. Ordering is pinned
separately — an explicit `outcome=fail` edge still outranks the retry target.

Re-verified 2026-08-04 at `engine/src/core/engine.ts:508-515`: the ladder is entered
only when `selectEdge` returned nothing AND the status is FAIL, which places it after
step 1 (an explicit fail edge wins) and before step 4 (`:489-501`, terminate).

Known consequence, deliberately deferred: this makes a second unbounded loop shape
reachable (`node -> retry_target -> node`), bounded only by the 500-step cap. Unlike the
RETRY case it has no backoff at all, because the FAIL never enters the retry machine.
Measured on the rebuilt bundle: a `build [retry_target="prep"]` node whose command
exits 1 produced **249 `node.fail.retry_target` events, zero `node.retry` events**
(hence zero backoff), and terminated FAIL at the step cap after 7s of pure subprocess
spawn cost. See residual R1; owner recorded there.

---

## Priority 2 — contract and compatibility

### C7. Status file contract: wrong filename, wrong fields, never read back
> Appendix C: "Each non-terminal node writes a `status.json` file in its stage
> directory." §4.5: "external tools or agents can write `status.json` to communicate
> outcomes back to the engine."

We write `outcome.json` with internal field names (`status`, `preferredLabel`,
`suggestedNextIds`) rather than `status.json` with the spec's (`outcome`,
`preferred_label`, `suggested_next_ids`). Nothing reads a status file back, so the
contract's bidirectional half is absent: a spec-conformant agent writing `status.json`
is ignored.

Same class: `checkpoint.json` uses `runId`/`currentNode`/`completed`/`attempts` where
§5.3 names `timestamp`/`current_node`/`completed_nodes`/`node_retries`/`logs`. A
spec-written resume cannot read our checkpoint. `response.md` (§4.5) and
`manifest.json` (§5.6) are not written at all.

**PARTIALLY CLOSED — the write half only.** Plan 3, commit `f536cbc`. This finding was
in scope after all; the Task 8 brief expected it open.

Closed:
- `engine/src/handlers/box.ts:141-148` writes `status.json` (not `outcome.json`) with
  Appendix C's field names: `outcome`, `preferred_label`, `suggested_next_ids`,
  `context_updates`, `notes`. Written *after* the fail-closed gate decision, so the
  artifact cannot say "success" while the event log says "retry".
- `engine/src/handlers/box.ts:149` writes `response.md` (§4.5).
- `engine/src/core/checkpoint.ts:26-46` converts at the boundary to a `CheckpointWire`
  named `timestamp`/`run_id`/`current_node`/`completed_nodes`/`node_retries`/
  `context`/`goal_gates_satisfied`, with the internal type unchanged. Confirmed on a
  live run's `checkpoint.json`: exactly those seven keys on disk.

Still open, and each needs an owner:
- **The §4.5 bidirectional half.** Nothing reads a status file back — no `readFileSync`
  of `status.json` exists anywhere in `engine/src`. A spec-conformant external agent
  writing `status.json` is still ignored. Deliberately deferred by the Plan 3 brief to
  **the plan that adds the manager loop**, which is the feature that needs it. Writing
  the correct file now is what unblocks it. See residual R2 for a hazard that becomes
  live the moment this lands.
- **`manifest.json` (§5.6) is still not written.** Same owner.
- **§5.3's `logs` field** is absent from `CheckpointWire`. Minor; same owner.

### C8. Bare-key truthiness and quoted literals unsupported
> §10.5: "ELSE: -- Bare key: check if truthy" and `parse_literal` unquoting.

`condition="context.ready"` is always false rather than truthy-checked, and
`condition="outcome=\"success\""` never matches because the quotes are compared
literally.

**CLOSED** — Plan 3 Task 4, commit `b51ab95`. `engine/src/core/condition.ts:152-160`:
a clause the `CLAUSE` regex does not match is treated as a bare key and passes when
`resolveKey` returns a non-empty string. `:54-58` is `parseLiteral`, which strips a
matched pair of surrounding double quotes before comparison.

### C9. Label normalization strips the wrong thing
> §3.3: "strip accelerator prefixes (patterns like `[Y] `, `Y) `, `Y - `)."

We handle only `[Y] `, then truncate at the first dash-separated segment. So
`"A - Approve"` normalizes to `"a"` (spec: `"approve"`), `"Approve - ship it"` to
`"approve"` (spec: unchanged), and `"Y) Yes"` is not stripped at all. A human gate
written in the spec's accelerator style will not route.

**CLOSED** — Plan 3 Task 3, commit `7842cba`. `engine/src/core/edge-select.ts:12-17`:
one anchored alternation strips `[Y] `, `Y) ` and `Y - ` and nothing else, then trims
and lowercases. The dash truncation is gone, so `"red - retry"` and `"red - abort"` no
longer collide — that collision was also recorded as known-and-accepted in
`carry-forward.md` and has been struck there.

### C10. Codergen prompt falls back to the graph goal, not the node label
> §4.5: "prompt = node.prompt / IF prompt is empty: prompt = node.label"

Every promptless box node receives the same prompt (the graph goal) instead of its own
label. Also uses `??`, so an explicit `prompt=""` dispatches a blank prompt rather than
falling back.

**CLOSED** — Plan 3, commit `f536cbc`. This finding was in scope after all; the Task 8
brief expected it open. `engine/src/handlers/box.ts:43`:
`ctx.node.attrs.prompt || ctx.node.attrs.label || ''` — the node's own label, and `||`
rather than `??`, so an explicit `prompt=""` falls back instead of dispatching blank.

### C11. Built-in engine context keys not set, or renamed
> §3.2 Step 4 sets `outcome` and `preferred_label`; §5.1 lists `graph.goal`,
> `current_node`, `internal.retry_count.<node_id>`.

We mirror graph attributes under bare names (`goal`, not `graph.goal`) and never set
`outcome`, `preferred_label` or `current_node`. So `context.graph.goal=...` and
`context.outcome=...` never resolve.

**PARTIALLY CLOSED — do not mark done.** Plan 3 Task 6, commit `862564c`. `outcome`,
`preferred_label` (only when non-empty, per §3.2's own wording) and `current_node` are
now set, and graph attributes are mirrored under `graph.<name>` *in addition to* their
bare names — the bare form is what `$goal` substitution reads and is a documented
superset, so mirroring adds a name rather than moving one.

Re-verified 2026-08-04. Closed half: `engine/src/core/engine.ts:264` sets `outcome`
unconditionally and `preferred_label` only when non-empty; `:332` sets `current_node`
before the checkpoint; `:311-315` mirrors every graph attribute under both the bare
name and `graph.<name>`, neither spelling overwriting a caller-supplied run parameter.
Confirmed on a live run's `checkpoint.json` context:
`{goal, graph.goal, current_node, outcome, tool.last_line}`.

`internal.retry_count.<node_id>` is **still unset**, deliberately. It is not a
key-naming fix: §5.1's lifecycle is "increment on retry, reset on SUCCESS/PARTIAL_SUCCESS",
whereas this engine resets its retry budget on *every* completion including FAIL
(`engine/src/core/engine.ts:406`, the retry-target jump, and `:422`, the
fall-through). Mirroring `attempts` would
therefore produce a key reading `0` at every point a condition can observe it — a
constant sentinel of exactly the CMD-002 class our own lint forbids. Implementing it
faithfully means a second counter with a different reset point, which is an engine-state
decision rather than a transcription.

**Record the consequence, because it is a live inversion, not merely an absence.** §10.3
makes a missing key compare as the empty string, so a spec-authored
`condition="context.internal.retry_count.build=0"` — the natural "first attempt" guard —
is **false** on our engine where the spec makes it true, and the `!=` spelling is
permanently true. Same silent-inversion shape as C2, on a key a spec-conformant author
has every reason to use. Whoever closes this owns the reset-point decision.

Re-confirmed 2026-08-04 by grep: `internal.retry_count` appears nowhere in
`engine/src` except the reservation comment at `core/context.ts:18`. The `internal.`
prefix IS reserved (`core/context.ts:33`), so the namespace is held; only the value is
missing. Nothing here is closed by the reservation — `isEngineManagedKey('internal.retry_count.a')`
being true is what stops a model forging the key, not what makes it resolve. **This
finding stays PARTIALLY CLOSED. Do not mark it done.** Owner: whichever plan revisits
retry-budget state — the same plan that owns R1's loop bounds is the natural fit,
since both turn on where the attempt counter resets.

Also still unset: `last_stage` and `last_response`. §5.1 attributes both to *handlers*
rather than the engine, and no handler writes them. Not previously filed; recorded here
so the §5.1 gap is complete.

**New surface this correction created, closed in the same plan (fix round 1).** Making
`current_node`, `preferred_label` and `graph.*` routing-visible put them in reach of a
model authoring `contextUpdates` — the same hazard the `tool.` namespace guard exists to
close, demonstrated rather than theorised (`{current_node: 'start'}` took a
`condition="context.current_node=start"` branch). The guard now rejects the whole
engine-managed set via a single `isEngineManagedKey` predicate in `core/context.ts` that
the engine writes its own built-ins through, so the guard cannot drift from the engine's
key set. Bare graph attribute names are deliberately *not* reserved (author namespace),
which leaves a pre-existing, narrower hazard: a box node can still overwrite `goal`, and
an unqualified `condition="goal=..."` would follow it. That predates this plan and is
filed as its own follow-up rather than silently widened into — **residual R3**.

The guard's anti-drift test has a scope limit of its own — **residual R4**.

### C12. `condition=""` is classified as conditional
> §3.3: "unconditional = [e FOR e IN edges WHERE e.condition **is empty**]"

We discriminate on `=== undefined`, not emptiness. An `edge [condition=""]` default
block would make every edge condition-matching and silently delete the unconditional
path.

**CLOSED** — Plan 3 Tasks 3 and 5, commits `7842cba` and `cc33acf`.
`engine/src/core/edge-select.ts:53-55`: `isConditional` requires the attribute to be
present AND non-empty after trimming, so `condition=""` and `condition="   "` both
fall to the unconditional path. The whitespace case was the Task 5 round: without the
trim it short-circuited step 1 exactly like a real match, and on a FAIL outcome it
would have carried the failure forward where `condition=""` correctly does not.

---

## Priority 3 — silent omissions

Silence is the problem here. A loud abort is an acceptable "not yet"; silently doing
something else is not. Deviation note #6 in the Plan 2 document claims these abort
loudly — that claim is only true for `component` and `tripleoctagon`.

- **C13. `type` attribute ignored.** §2.6: "Takes precedence over shape-based
  resolution." `foo [type="tool"]` with no shape runs as an LLM node. The spec's own
  §2.13 human-gate example uses `type="wait.human"`. No `type_known` lint either.

  **CLOSED** — Plan 3 commit `7a962da`, lint added in `c8f2e2e`, prototype-key hole
  closed in `ab1620b`/`c562a5a`. This finding was in scope after all; the Task 8 brief
  expected it open. `engine/src/dot/graph.ts:92-105`: `handlerForNode` resolves an
  explicit `type` through `TYPE_TO_HANDLER` (`:73-83`, the spec's §2.6 strings) before
  falling through to shape. An unrecognised `type` degrades to shape rather than
  aborting, and `TYPE-001` (`engine/src/dot/lint.ts:235-245`, ERROR) is the catch that
  makes the degradation loud at lint time. Both sides use `Object.hasOwn` against the
  *same exported table*, so `type="constructor"` cannot read as known through
  `Object.prototype` in one and not the other. Verified through the rebuilt bundle:
  `h [type="wait.human"]` with no shape now fails with
  `no handler registered for human (node h)` instead of running its label as an LLM
  prompt.

- **C14. `shape=house` degrades to codergen.** Appendix B maps it to
  `stack.manager_loop`. `component`/`tripleoctagon` abort loudly; `house` does not — a
  supervisor node runs its label through the LLM and the pipeline reports success.

  **CLOSED** — Plan 3 commit `7a962da`. Also in scope after all.
  `engine/src/dot/graph.ts:43` maps `house` to `Handler.MANAGER_LOOP`, and
  `engine/src/core/engine.ts:49-58` registers no handler for it, so `:201-208` aborts.
  Verified through the rebuilt bundle: `sup [shape=house]` now fails with
  `no handler registered for manager_loop (node sup)`. The *contradiction* is closed —
  the shape no longer silently becomes something else. The manager-loop handler
  remains unimplemented, which is an absence and a loud one; it belongs to the plan
  that adds the manager loop, together with C7's read-back half.
- `loop_restart` ignored — the edge is followed as an ordinary transition rather than
  restarting the run (§3.2 Step 7). Worst of the silent set, because the edge *is*
  processed, just with the wrong semantics.
- `allow_partial` ignored (§3.5: should return PARTIAL_SUCCESS on exhaustion).
- `auto_status` ignored. `SKIPPED` is in the enum but routed like a success, where
  §5.2 says "proceed without recording an outcome".
- `class`, `llm_provider`, `reasoning_effort`, `model_stylesheet` all ignored.
- **Corrected 2026-08-03, after Plan 2's whole-branch review:** `fidelity`,
  `thread_id` and `llm_model` are IMPLEMENTED, not ignored. `argv.ts` passes
  `node.attrs.llm_model` (falling back to the run-level `--model`) as `--model`.
  `threads.ts`'s `isFullFidelity` gates continuation on `fidelity === 'full'` AND a
  present `thread_id`; `ThreadStore` resumes the recorded session id via
  `--resume` when both hold, and starts fresh otherwise. This entry was stale by
  the time Plan 2 shipped; Plan 3 is grounded on this document, so leaving it
  wrong risked re-implementing or overwriting the thread-continuity work rather
  than building on it.
  Two gaps the whole-branch review confirmed are still genuinely open, not fixed
  by the above: graph-level `default_fidelity` (as opposed to a per-node
  `fidelity`) is still not honoured -- a node with no `fidelity` attribute of its
  own does not inherit one from the graph. And there is no `fidelity_valid` lint,
  so `fidelity="fully"` (a typo for `"full"`) is accepted silently and starts a
  fresh conversation instead of resuming, with no diagnostic pointing at the typo.
- **Lint rules: two of seven are now implemented.**
  - `condition_syntax` (ERROR) — **IMPLEMENTED** as `COND-001`, Plan 3 commits
    `c8f2e2e` and `ab1620b`. `engine/src/dot/lint.ts:150-166`, severity ERROR. It was
    the necessary companion to C2/C3/C8: making a missing key compare as the empty
    string means a typo'd condition no longer fails at runtime, it just resolves empty
    and silently disables (or silently re-enables) an edge. The rule shares its
    grammar with the engine's own parser rather than restating it —
    `isValidConditionSyntax` (`engine/src/core/condition.ts:137-139`) wraps the exact
    `CLAUSE` regex and the shared `splitClauses` tokenizer `evaluateCondition` uses, so
    lint and evaluation cannot drift on clause splitting. The bare-identifier branch is
    deliberately *stricter* than `resolveKey` (it excludes the hyphen); that asymmetry
    is recorded in the function's own comment and is not an oversight.
  - `type_known` — **IMPLEMENTED** as `TYPE-001`, same commits. See C13.
  - Still absent: `stylesheet_syntax` (ERROR), `fidelity_valid`,
    `retry_target_exists`, `goal_gate_has_retry`, `prompt_on_llm_nodes`. Owner: the
    plan that closes the remaining Priority 3 lint gap. `fidelity_valid` in particular
    is the one with a live silent failure behind it (see the `fidelity` entry above);
    `retry_target_exists` matters more now that C6 made `retry_target` reachable on
    FAIL, since `resolveRetryTarget` treats a target naming a nonexistent node as
    absent (`engine/src/core/retry.ts:52-55`) with no diagnostic.
- **Subgraph default scoping (§2.10, §2.11, §2.5) — CLOSED**, commit `2ba2ea7`.
  The entry as written ("we flatten, so a subgraph's `node [...]` block leaks to the
  whole graph") understated it: one parser shape carried **three** violations, and the
  third was the damaging one.
  1. §2.10 — *"Attributes declared in a subgraph's `node [ ... ]` block apply to nodes
     **within that subgraph**"*. Defaults accumulated into two graph-wide objects, so
     they applied everywhere. A leaked `retry_target` is a **routing** defect: it hands
     §3.7 step 2 a failure jump target to nodes whose author wrote none, where step 4
     (terminate) is what the graph says.
  2. §2.11 — *"Default blocks set baseline attributes for all **subsequent** nodes or
     edges within their scope"*. Defaults were applied in a pass **after** the whole
     walk, so a default reached backwards onto nodes and edges declared before it.
  3. §2.5 — graph attributes are declared in a `graph [ ... ]` block *"or as top-level
     `key = value` declarations"*. A subgraph's are neither, and merging them
     overwrote the graph's own. A `goal` anywhere inside a subgraph replaced the
     pipeline's goal, silently rewriting `$goal` in every prompt the engine builds and
     the `graph.goal` key conditions route on; a subgraph's `label` — which §2.10
     reserves for class derivation — became the graph's.

  `engine/src/dot/parse.ts` now threads a `Scope` (node defaults, edge defaults,
  `isRootGraph`) through the walk. Entering a subgraph takes a **copy**, so it inherits
  what encloses it and nothing it declares escapes. Defaults are filled in at the point
  a node or edge is declared, which is what makes "subsequent" true. A bare
  `key = value` reaches `graphAttrs` only at the root graph. A node appearing only as an
  edge endpoint is created at the edge statement with the defaults in scope there — the
  edge statement is its declaration point, which is what Graphviz itself does with
  `subgraph { node [x]; a -> b }`.
  Verified through the rebuilt bundle against the pre-fix bundle on the same graph:
  a node declared **outside** a subgraph went from `Advance hijacked` to
  `Advance real goal` in its `prompt.md`, and a failing node outside the subgraph went
  from diverting into the leaked `retry_target` (`start -> early -> fix -> done`,
  `status: success`, exit 0) to terminating with no failure route
  (`start -> early`, `status: fail`, exit 1).
  The spec's own §2.10 example (`Plan` inherits `thread_id` and `timeout`, `Implement`
  inherits `thread_id` but overrides `timeout`) is a fixture in
  `engine/test/parse.test.ts` and our behaviour matches it.
- **Subgraph class derivation (§2.10) — OPEN**, deliberately not built with the scoping
  fix. §2.10's second purpose: *"Nodes inside a subgraph receive the derived class …
  derived by lowercasing the label, replacing spaces with hyphens, and stripping
  non-alphanumeric characters (except hyphens)"*, so `label="Loop A"` yields `loop-a`.
  We do not derive it. Deriving it now would be **inert**: `class` (§2.12) and
  `model_stylesheet` (§8) are both unimplemented, so nothing would read the derived
  value. Owner: the plan that implements the model stylesheet — it must land with that
  work, not before it.
  **What the scoping fix leaves for it, stated precisely so the next reader does not
  have to re-derive it:** a subgraph's bare attributes (including its `label`) are now
  *discarded* rather than merged into the graph's map. That is correct — merging was
  violation 3 — but it means the derivation work must **capture** the label in the
  parser's `Scope`, not merely read it back from somewhere. Nothing today reads a
  subgraph attribute, which is why discarding is honest rather than lossy.

**Re-confirmed still absent, 2026-08-04, by grep over `engine/src`:** `loop_restart`,
`allow_partial`, `auto_status`, `model_stylesheet`, `reasoning_effort`, `llm_provider`,
`default_fidelity` — zero occurrences each. `SKIPPED` appears only in the `Status`
enum (`engine/src/core/outcome.ts:6`) and is still routed like a success where §5.2
says "proceed without recording an outcome". None of these was in Plan 3's scope and
none is a contradiction Plan 3 introduced; each belongs to the plan that implements
the feature. `loop_restart` remains the worst of the set, because the edge *is*
processed, just with the wrong semantics.

---

## Confirmed conformant

Chained-edge expansion with per-edge attribute cloning; `node`/`edge` default blocks
not overriding explicit attributes; repeated node statements accumulating; `max_retries=N`
meaning N+1 attempts; retry-target resolution order; backoff formula; weight-desc then
lexical tie-break with non-numeric weight as 0; status wire strings; goal gate satisfied
by SUCCESS or PARTIAL only; no disjunction in conditions (§10.7 explicitly asks
implementations not to add operators); `&&` semantics and empty-condition-true; lint
diagnostics refusing execution on error; tool handler empty-command FAIL and timeout;
`default_max_retries` with the `default_max_retry` alias.

**Two counts in this list were stale and are corrected 2026-08-04** — this is the
section where the last stale entry hid, so the numbers are now stated as derivable
facts rather than as counts that quietly age:

- *"the six implemented lint rules at ERROR severity"*. There are now **twelve** rule
  codes (`engine/src/dot/lint.ts`): TOPO-001 through TOPO-006, COND-001, TYPE-001,
  HITL-001, HITL-002, CMD-001, CMD-002. Eleven are ERROR; **CMD-001 is a WARNING**
  (`lint.ts:311`) and does not refuse execution — that was true when the count was
  written too, so "the N lint rules at ERROR severity" was never an accurate phrasing.
  `hasErrors` (`lint.ts:342-344`) is what refuses execution, and it tests severity, not
  rule count.
- *"shape map for the six implemented shapes"*. `SHAPE_TO_HANDLER`
  (`engine/src/dot/graph.ts:34-44`) now maps **nine** shapes — Appendix B in full,
  `house` included since C14. Only **five** have registered handlers
  (`engine/src/core/engine.ts:49-58`: start, exit, conditional, tool, codergen). The
  other four — `hexagon`/human, `component`/parallel, `tripleoctagon`/fan_in,
  `house`/manager_loop — resolve correctly and then abort loudly with
  `no handler registered`. That is the conformant state: the *map* is complete, the
  *handler set* is not, and the gap is loud. Both verified through the rebuilt bundle.
- Newly conformant since this section was written, and belonging here rather than in
  "genuine extensions" because both are spec-named §7.4 rules: **COND-001**
  (`condition_syntax`) and **TYPE-001** (`type_known`).

## Genuine extensions, no conflict

`events.jsonl`; engine-emitted `node.start`/`node.end`; atomic fsynced checkpoints
(stronger than §5.3); `$name` substitution generalised beyond `$goal` (a strict
superset — `$goal` still resolves); fail-closed goal gates (RETRY is a legal outcome
per §5.2, so nothing is contradicted); the engine-managed namespace guard
(`isEngineManagedKey` — the `tool.` guard generalised to every key the deterministic
layer owns, so a backend cannot forge one) and the stale-label rule; TOPO-006, HITL-001/002, CMD-001/002 (§7.4 permits custom rules); `on_timeout`;
`Outcome.metrics`; `--stub`; the 500-step cap.

Re-checked 2026-08-04, with one addition and one clarification:

- **Added: the bare graph-attribute mirror.** The engine now writes each graph
  attribute under *both* `graph.<name>` (§5.1's name) and the bare `<name>`
  (`engine/src/core/engine.ts:311-315`). The bare spelling is what `$goal` substitution
  and every pipeline written against this engine already read. It adds a name, it does
  not move one, so it is a strict superset — but only the `graph.`-qualified form is
  reserved against a model forging it, deliberately, because bare names are the
  author's namespace. See residual R3 for the narrow hazard that leaves.
- **Clarification, not a change: COND-001 and TYPE-001 are NOT extensions.** They are
  the spec's own `condition_syntax` and `type_known`, now implemented, and are listed
  under "Confirmed conformant" above. TOPO-006, HITL-001/002 and CMD-001/002 remain
  genuine §7.4 custom rules.

## Ambiguities where we chose a reading

1. **Fail-fast on FAIL.** §3.3's `select_edge` has no FAIL branch (a literal reading
   follows unconditional edges); §3.7's ladder never mentions them and terminates. We
   implement the §3.7 reading. Defensible, but it is a reading and should be recorded
   as a deviation rather than left implicit in a comment.

   **The "should be recorded" half is now done** — Plan 3, commit `b762e0a`. The
   reading is an entry in the doctrine list in `plugins/attractor/AGENTS.md`, cross-
   referenced from `engine/src/core/edge-select.ts:66-73` and from this item. A reading
   that lives only in a code comment is not a record; that is exactly what C1 cost.
   The reading itself is unchanged, and C6 did not weaken it: §3.7 places the retry
   target *below* the fail edge, so an author's explicit failure route still wins, and
   still no unconditional edge carries a failure forward
   (`engine/src/core/edge-select.ts:90-94`).

   **What this reading costs if it is ever revisited: it decides the run verdict, not
   only the route.** Take `b -> done [unconditional]`, no fail edge on `b` and no
   `retry_target`. Under the §3.7 reading we implement, `b` FAILing stops the run at
   `b` reporting FAIL. Under a literal §3.3 reading — no FAIL branch, so the
   unconditional edge is simply followed — the same run reaches `done` and §11.3
   reports SUCCESS on a graph that never resolved its failure. That is the mirror image
   of the run-level rule withdrawn above ("The withdrawn fix, and why it was
   withdrawn"): that rule tried to make an unresolved FAIL change the verdict and was
   pulled because no spec sentence said the verdict works that way. Fail-fast survives
   the same scrutiny because it does **not** invent a verdict rule — it rests on an
   explicit spec sentence, §3.7 step 4: *"Pipeline termination: No failure route found.
   The pipeline fails with the stage's failure reason."* The withdrawn rule rested on no
   spec sentence at all. That distinction — one reading is licensed by the text, the
   other supplied a rule the text never stated — is the whole test for whether a verdict
   consequence is a defensible reading or a contradiction, and it is why this one stays
   and that one did not.
2. **Absent keys in `$name` substitution.** Spec defines expansion only for `$goal`.
   We leave unknown keys literal, which is the only safe reading given the same
   function serves `tool_command`. Single-pass is a tightening the spec is silent on.
3. **Which goal gates the exit check consults — the spec contradicts itself.** This is
   not a gap we are filling by choice; it is an internal inconsistency in the spec, and
   it is the reason finding I2 above is arguable rather than clear-cut.

   > §3.4: "Check all **visited** nodes that have `goal_gate=true`."

   > §11.3: "Pipeline outcome is 'success' if **all** goal_gate nodes reached `SUCCESS`
   > or `PARTIAL_SUCCESS`, 'fail' otherwise."

   > §11.4: "Before allowing exit via a terminal node, the engine checks **all** goal
   > gate nodes have status `SUCCESS` or `PARTIAL_SUCCESS`."

   The two readings differ exactly when a gate is never visited — a gate on a branch the
   run legitimately did not take. Under §3.4 the run may exit; under §11.3/§11.4 it can
   never exit, because a gate with no outcome at all has not "reached SUCCESS".

   **We implement §3.4**, for three reasons, in order of weight. §3.4 is the normative
   algorithm section and carries pseudocode, while §11 is a Definition-of-Done checklist
   whose bullets are summaries. That pseudocode is decisive on the point: it iterates
   `node_outcomes` — the map of nodes that produced an outcome, i.e. visited ones — not
   `graph.nodes`. And the §11 reading makes any graph with a conditional branch carrying
   a gate permanently unexitable, which contradicts §3.3's own branching model.

   This is also, in the other direction, the exact behaviour C4 corrected *to*: iterating
   every declared node made a gate on an untaken branch permanently unsatisfiable, the
   exit bounced to its retry target until the step cap, and a run the spec exits
   successfully failed. Reverting to the §11 wording would reinstate that bug.

   **To be filed upstream.** Unlike the other items in this section, this one is not a
   reading we should have to choose: §3.4 and §11.3/§11.4 cannot both be satisfied, and
   only the spec's authors can say which is intended.

4. **Where `contextUpdates` are applied.** §3.2 puts the merge in the engine loop; we
   put it in handlers. Equivalent today, divergent the moment a third handler exists.

   Still accurate, and re-checked 2026-08-04: the engine never merges
   `Outcome.contextUpdates` — only `BoxHandler` does
   (`engine/src/handlers/box.ts:92-113`), while `ToolHandler` writes context directly.
   Plan 3 raised the stakes rather than resolving it: the engine-managed-key guard now
   lives *inside* that handler-side merge, so a fourth handler that merged updates
   without calling `isEngineManagedKey` would bypass the guard entirely, not merely
   duplicate a merge. Residual R2 is the near-term instance of this.
5. **HITL-002 rejects graphs the spec accepts** (`goal_gate` on non-box/parallelogram
   shapes). A deliberate tightening — but tightening is the one form of "extension"
   that can reject a conformant author's graph, so it is a deviation, not a freebie.

   Still accurate (`engine/src/dot/lint.ts:279-301`), and now joined by a second
   tightening worth naming: **COND-001's bare-clause branch also rejects conditions the
   engine would run.** `BARE_IDENTIFIER` excludes the hyphen, so
   `condition="feature-flag"` is a lint ERROR even though `resolveKey` would resolve a
   context key of that name correctly. That is deliberate — widening it to match
   `resolveKey`'s permissiveness would readmit the rule's own flagship case,
   `condition="outcome success"` — but it is a tightening, so it is recorded here
   rather than only in the function's comment.

---

## Residuals from Plan 3

Five items found during the spec-correction plan and deliberately deferred. None is a
newly introduced contradiction; each is recorded here, with an owner, so a later plan
finds it rather than rediscovering it.

**Owners are named by what the plan does, not only by number, on purpose.**
`carry-forward.md` was originally written from Plan 1 against a roster in which Plan 3
was human gates; the plan that actually landed as Plan 3 (of 7) was this spec
correction, which left every number after Plan 2 in that document off by one. Commit
`e3d4025` corrected the numbering there, so it is now accurate — but the *name* remains
authoritative below regardless, for the same reason that correction gave: a number is
only right until the roster shifts again.

### R1. `retry_target` loops are bounded only by the 500-step cap

Two instances of one class, no backoff, no diagnostic:

- **The goal-gate exit block.** An exit whose goal gates are unsatisfied bounces to
  `resolveRetryTarget` and continues (`engine/src/core/engine.ts:428-438`) with no
  delay, giving roughly 250 `gate -> target -> gate` round trips before the cap.
- **C6's FAIL jump** (`engine/src/core/engine.ts:508-515`), which has no backoff *at
  all* because the FAIL never enters the retry machine that computes one. Measured:
  249 `node.fail.retry_target` events, zero `node.retry` events, terminating FAIL at
  the cap.

Both terminate and neither can report SUCCESS, which is why this is a residual rather
than a defect. What is missing is bounding, backoff and a diagnostic that says *why*
a run burned 500 steps — today the operator gets only "step cap reached without
terminating".

> **Correction, 2026-08-04 (whole-branch review).** The sentence above was true of
> the two *loop* shapes this residual enumerates, and false as a general statement
> about C6's FAIL jump. It silently assumed the jump target routes back — that is
> what makes it a loop, and what makes the step cap the terminator. **When the
> target does NOT loop back, C6's jump is not a loop at all: it is a one-way route
> to the exit, and it reported SUCCESS**, exit 0, with the failing node's FAIL
> sitting in the event log. That is finding I2 of the whole-branch review, and the
> stated reason for deferring R1 never covered it.
>
> The deferral of R1 still stands, unchanged and for its own reasons: the *looping*
> shapes really are bounded by the cap and really do terminate FAIL, so bounding,
> backoff and a diagnostic remain the missing work and remain Plan 4's. What is
> withdrawn is only the claim that "neither can report SUCCESS" — the non-looping
> case did, and it was a defect, not a residual. It is fixed (see "Whole-branch
> review corrections" below); the fix does not bound the loop and does not touch
> routing, so it takes nothing off Plan 4's plate.
>
> The lesson worth keeping is the shape of the mistake, because it is this
> document's second instance of it: a residual was cleared as harmless on a
> property ("cannot report SUCCESS") that was verified against the enumerated
> instances rather than against the class. **Clearing a risk needs the same
> evidence standard as raising one** — root `AGENTS.md`, rule 5.

**Owner: Plan 4 (parallel).** `carry-forward.md` already assigns the goal-gate half
there ("revisit when concurrency makes the loop cheaper to spin"); C6's half joins it
so one plan owns the whole class. It is coupled to C11's open half: both turn on where
the attempt counter resets.

### R2. `box.ts` records the RAW `contextUpdates` into `status.json`

`engine/src/handlers/box.ts:145` writes `context_updates: finalOutcome.contextUpdates`
— the unfiltered map, including keys the engine-managed-key guard rejected three lines
earlier at `:109-111`. The guard filters what reaches *context*; it does not filter
what reaches *disk*.

Inert today, because nothing reads a status file back (see C7). It stops being inert
the moment C7's §4.5 read-back lands: a rejected `{current_node: 'start'}` would be
sitting in the file the engine is about to trust, an unfiltered path around the guard.
This is the same shape as the `carriesVerdict` bug Plan 3 fixed — evidence the control
plane refused to accept must not come back in through another door.

**Owner: the plan that adds the manager loop**, i.e. whichever plan closes C7's
read-back half. It must be fixed *before or with* that read-back, not after.

### R3. A box node can still overwrite bare graph attributes

`goal` and every other bare graph-attribute name are deliberately unreserved
(`engine/src/core/context.ts:22-29`): they are the author's namespace, and reserving
whatever a graph's header happens to declare would make "a node can write context"
depend on the header. The consequence is that a box node can overwrite `goal`, and an
unqualified `condition="goal=..."` would follow the overwritten value. `graph.goal`,
the engine's mirror, is reserved and unforgeable.

This predates Plan 3 and was narrowed rather than widened by it. **It probably wants a
lint, not a reservation** — something like `graph_attr_shadow` (WARNING) firing when a
condition reads a bare name the graph also declares as an attribute. A reservation
would break the general feature; a lint tells the author their routing key is
shadowable.

**Owner: the plan that closes the remaining Priority 3 lint gap** — the same one owing
`fidelity_valid`, `retry_target_exists`, `goal_gate_has_retry`, `prompt_on_llm_nodes`
and `stylesheet_syntax`.

### R4. The engine-managed-key anti-drift test only observes one fixture's path

`engine/test/engine.test.ts:678-692` derives its expected set from what the engine
actually wrote — the right design, and the reason it will catch a future built-in
added without registering it in `isEngineManagedKey`. But it observes only the keys
present after running the `LINEAR` fixture. A built-in written on a path `LINEAR` does
not take — a goal-gate branch, a retry-target jump, a tool node — would never appear
in its checkpoint and would escape the assertion silently.

Not a live hole: every key the engine currently writes is on `LINEAR`'s path, verified.
It is a *coverage* gap in the mechanism that exists to stop exactly this class of
drift, which is why it is worth recording rather than assuming.

**Owner: same as R3.** Cheapest fix is to run the assertion over several fixtures'
checkpoints, or to derive it from a run that exercises a gate and a retry.

### R5. Golden-graph tests are absent and no example pipeline is committed

Re-verified 2026-08-04: `find . -name '*.dot'` outside `node_modules` returns **zero
files**. Every graph this engine has executed, in every test and in this task's own
verification, is a small fixture written inline by the code that runs it.

`carry-forward.md` records this as a **required Plan 6 deliverable, not optional
polish**, and points at Plan 6 (doctrine port and packaging). **That entry is still
accurate and still points at the right plan** — checked, not assumed. The reviewer's
observation behind it also still holds: committing `task-runner.dot` and running it to
a known terminal state would, on its own, have caught Plan 1's Critical finding.

One consequence for anyone reading the Plan 3 task briefs: Task 8's verification list
includes "the canonical `task-runner.dot` still lints clean". **That file does not
exist in this repository** and the check could not be run. What was run instead is
recorded in the task 8 report. The check becomes runnable when R5 closes.

---

## Whole-branch review — 2026-08-04. I1 CLOSED, I2 RECLASSIFIED

A whole-branch review of `feat/attractor-spec-correction` raised two Critical findings.
Both are **interactions** between corrections that were each individually correct,
individually approved, and individually pinned by a test. The review's diagnosis of why
the suite missed them is the part worth keeping: **every correction was pinned in
isolation and nothing composed two and checked the run-level outcome.** Both are
committed as regression fixtures.

They were recorded OPEN for one plan, after a verdict-level fix was implemented,
reviewed and then **withdrawn as a spec contradiction**. Read the withdrawal section
below before proposing anything verdict-shaped. **The dataflow plan
(`feat/attractor-dataflow`) settled both, and the two settlements are different in
kind — one is a fix, the other is a correction to this document.**

### I1 (CLOSED). A vacuously-true `!=` guard carries a FAIL past fail-fast

`resolveKey` returns `''` for a missing key (`engine/src/core/condition.ts:41-51`,
correct per §10.3), so `condition="context.build_error!=fatal"` is **true** when nothing
ever writes `build_error`. `selectEdge` evaluates conditional edges at step 1 and returns
immediately (`engine/src/core/edge-select.ts:84-88`, correct per §3.3) — *before* the
fail-fast branch below it. The failure travels an edge the author really did write;
fail-fast is not violated, it never runs.

```dot
build -> publish [condition="context.build_error!=fatal"]
```

`status: success`, `path: start -> build -> publish -> done`, exit 0, with
`{"node":"build","status":"fail"}` in the event log.

**Why it was never simply wrong.** §11.3 decides the run verdict purely by goal gates
and this graph declares none, so SUCCESS is conformant. The defect was real but it lived
one level down, in *dataflow*: `publish` consumed nothing from `build` because nothing
declared what `build` produces.

**How it closed.** Not at the verdict, and not by touching §10.3 or §3.3. Three
mechanisms in `engine/src/core/engine.ts`:

- **`outputs=`** (`dot/graph.ts`, `declaredOutputs`) lets a node declare the context keys
  it is contracted to produce. A custom node attribute, sanctioned by §2's "extensible
  through custom attributes".
- **A failed-output ledger** (`Engine.failedOutputs`) maps each such key to the node that
  owed it, populated when that node ends FAIL or exhausts its retries and is abandoned to
  a `retry_target`, and cleared when the owing node re-executes green or when any node
  actually writes the key. It is a private field and never enters `Context`, so nothing
  can route on it.
- **The eager input check** (`Engine.unavailableInput`) intersects the keys a node's
  handler would substitute with that ledger *before* invoking the handler. A non-empty
  intersection means the handler is not invoked and the node returns
  `FAIL(notes="required input 'artifact.path' unavailable: node 'build' failed")`. The
  blocked node's own declared outputs then enter the ledger against itself, so
  propagation is transitive; routing proceeds through §3.7's ladder unchanged, and
  fail-fast halts the run.

The result, on the shape above **with the reference also appearing in `publish`'s prompt**:
`path: start -> build -> publish`, `status: fail`, exit 1, `publish` never invoked. Pinned
by `I1 (CLOSED): a declared output owed by a failed node halts the run` in
`engine/test/engine.test.ts`, which asserts the halt, the absence of the downstream
invocation, and that the reason names both the key and the owing node.

**That qualification is load-bearing, and this document previously omitted it — the
sentence claimed the halt for "the shape above", whose only reference is in the edge
condition, and that shape actually exits 0.** CLOSED is still the right word for the
mechanism, and the scope of what it closes is precisely this: **the eager check protects
references in SUBSTITUTED TEXT** — a box node's `prompt` (or `label`), a tool node's
`tool_command`, read from `substitutableText`. **A reference appearing only in an edge
condition is unprotected at any level of opt-in**, because neither the ledger's consumer
nor its lint counterpart can see it. That is not a gap in the opt-in; adding `outputs=`
to the producer does not help. It is a coverage boundary, re-scoped as residual R6 below
and pinned by `I1 does not reach a reference that appears only in an edge condition`,
which asserts the green exit rather than leaving it as an unnoticed surprise.

**It is fully OPT-IN, and this is the sentence to carry forward.** Only `outputs=`-declared
keys enter the ledger. Nothing is inferred — not for box nodes (a model's `contextUpdates`
keys are arbitrary and are filtered by the engine-managed guard, so there is nothing
honest to infer) and, after fix round 2 of the implementation, not for tool nodes either.
**A graph that declares no `outputs=` gets none of this protection** and behaves exactly
as the fixture above describes; that case is pinned too, alongside the DATA-001 warning
that is the only thing which speaks for it.

The inferred half was removed because it *contradicted doctrine*, not because it was
noisy. `tool.last_line` is written by every tool node, so a failing `build` recorded it as
owed and the eager check then refused `notify` — the node whose entire job is to report
the failure — in a graph containing no `outputs=` at all. **The stale-label rule exists
precisely so a failing tool node's previous `tool.last_line` survives to be read.** A
ledger marking that key unavailable argues with a non-tradeable doctrine entry, and the
doctrine wins. A key nobody declared is not a debt anybody owes.

**Not ported from amplifier's R12: SKIPPED propagation.** §5.2 defines `SKIPPED` as
*"Proceed without recording an outcome"*, which cannot also mean "halt the linear path".
`FAIL` is used instead — spec-defined, routes through §3.7 unchanged, no new status.

### I2 (RECLASSIFIED, not closed). A FAIL `retry_target` routes around an unvisited goal gate

C4 scoped goal gates to *visited* nodes (§3.4); C6 made a FAIL consult `retry_target`
(§3.7 step 2). Composed, the failed node's fallback route reaches the exit without the
gate ever being visited, so `unsatisfiedGoalGates()` is legitimately empty.

`status: success`, `path: start -> plan -> build -> report -> done`, exit 0.

**This was never an engine defect, and filing it as one was a category error.** §3.4
scopes the goal-gate check to *visited* nodes, so a gate on a branch a failure route
bypasses is legitimately never consulted, and §11.3 then reports the run a success. The
engine is behaving exactly as specified. Nothing in the engine changed for I2 and nothing
should: tightening the check to unvisited nodes is precisely the regression C4 exists to
prevent — it made a gate on a branch the run legitimately never took permanently
unsatisfiable, so the exit bounced to its retry target until the step cap and failed a run
the spec exits successfully.

**What is actually wrong is the graph.** A pipeline where a failure route can reach the
exit without passing through a declared goal gate has a gate that does not gate. That is
a **graph-shape hazard**, it is statically detectable, and it belongs in lint where an
author is told before the pipeline ever runs.

**Where it now lives: `GATE-001`** (`engine/src/dot/lint.ts`), a WARNING. It walks the
failure routes §3.7's ladder recognises — a declared fail edge, a node `retry_target`, a
graph-level `retry_target`/`fallback_retry_target` — and reports any that can reach an
exit node without passing a gate. The message carries the §3.4 reasoning, deliberately,
because a diagnostic that only says "gate bypassed" invites a bug report against the
engine, which is how this was filed in the first place. It fires on this finding's own
fixture as a true positive, asserted by `I2 (RECLASSIFIED): GATE-001 catches the finding
at design time`.

**Why "reclassified" and not "closed".** Closing it would imply the engine was repaired.
It was not, and a future reader who believes it was will go looking for a fix that does
not exist, or worse, add one. The record that matters is that the classification was
wrong: this document filed a spec-conformant engine behaviour as a Critical engine
defect, on the strength of an outcome that looked wrong at the run level. The visited-scoping
ambiguity (see ambiguity 3) made it *look* arguable at the engine level and that is what
concealed the category error for a plan.

**Two known under-reports in GATE-001, both in the safe direction:** it treats the
declared gates as one wall rather than checking each individually, so a route bypassing
*some* gates but reaching another is not reported; and a failure route expressed as a
`preferred_label` branch is not recognised as a failure route. Recorded as residuals
below.

### The withdrawn fix, and why it was withdrawn

A run-level rule was implemented: *a run that reaches the exit still holding an
unresolved node FAIL reports FAIL and exits 1*. It closed both findings, kept routing
untouched, and preserved repair loops. It was wrong anyway.

> §11.3: "Pipeline outcome is 'success' if all goal_gate nodes reached `SUCCESS` or
> `PARTIAL_SUCCESS`, 'fail' otherwise."

That is the **only** normative statement of the run verdict in the spec, and it decides
it purely by goal gates. Two further readings confirm it rather than soften it:

- **§3.7** lists four failure-routing steps and only step 4, *"Pipeline termination: No
  failure route found. The pipeline fails with the stage's failure reason"*, ends the
  run. A failure the author DID route is carried onward **by design**.
- **§3.5**'s `allow_partial` is per-node, consulted on retry exhaustion, and returns
  `PARTIAL_SUCCESS` for that node. It is never a run-level switch, so the spec does not
  even anticipate a run-level knob here.

So the rule reported FAIL where §11.3 reports SUCCESS. That is a **contradiction**, and
this plugin's standing rule is that it extends the spec and never contradicts it.
Withdrawn in full: `status` is decided by goal gates alone, exactly as before, and the
exit code follows `status` with no new semantics.

**The process failure is the more useful record.** The rule was reasoned out, reviewed
twice, committed, and defended in a report that asserted "nothing in the spec requires a
run holding an unrecovered failure to be called a success" — an assertion about a section
nobody had read. It is the same failure as C1 (a reading settled by intuition and then
asserted in a code comment) and it is why the plugin's `AGENTS.md` now opens its doctrine
with a standing rule to read the spec first and quote the section.

### What shipped instead: the record, and a loud diagnostic

Purely additive, contradicting nothing, and the only reason the failure is visible above
the event log at all:

- **`RunResult.unresolvedFailures`** — the nodes the run gave up on and never re-ran, in
  first-failure order. Previously `RunResult` retained nothing, so the CLI's `status:`
  line, its exit code and any embedding caller all saw an unqualified success.
- **A `pipeline.unresolved_failure` event**, beside the existing `pipeline.goal_gate_block`.
- **A stderr WARNING from the CLI** naming the nodes and citing §11.3, so an operator who
  expected a failure can find out why they did not get one. `status` and the exit code
  are untouched.

Two nodes qualify as "given up on": one that ended FAIL, and one that **exhausted its
retries and was abandoned to a retry target**. The second never reaches a FAIL status in
our loop — `Engine.run` rewrites an exhausted RETRY to FAIL only when no target exists —
but §3.5's own `execute_with_retry` returns `Outcome(status=FAIL, failure_reason="max
retries exceeded")` on exhaustion unconditionally, and §3.7's jump is failure routing
that happens *after* that. So recording it is faithful to the spec. Omitting it made the
record silently wrong for the most reachable failure there is: a backend crash, malformed
output or budget abort on a node with a node- or graph-level retry target.

**A recorded divergence, not one this creates:** we do not rewrite the node's `Outcome`
to FAIL on the retry-target path, where §3.5's pseudocode does. The reviewer confirmed
this is **pre-existing** — the jump path never wrote FAIL before this branch either;
recording the ledger entry did not touch it. Doing so would push `fail` into the
routing-visible `context.outcome` before the jump and could change which edge the target
node takes — a routing change, out of scope for a record. The ledger sees the failure;
`context.outcome` still reads `retry`. Worth closing deliberately, not by accident.

**Owner: Plan 4 (parallel)**, the same plan R1 assigns to the retry-target jump this
divergence shares a code path with. Rewriting `Outcome` there is a routing decision, not
a transcription, so it belongs with the class R1 already owns rather than being fixed
incidentally by whichever plan happens to touch that line next.

### `preferred_label` had two spellings with opposite answers

`resolveKey` short-circuited the bare form to the **live** `Outcome`, while
`context.preferred_label` fell through to the sticky context key that `recordOutcome`
writes only when non-empty and never clears. §10.4 presents the unprefixed fallback as a
convenience **alias**, so `preferred_label=ship` being false at the exact moment
`context.preferred_label=ship` was true — same run, same graph — is a trap.

**Made to agree, keeping the stickiness.** The bare form now reads the live label when
non-empty and otherwise falls back to the sticky key: §3.2 step 4's own "IF
outcome.preferred_label is not empty" rule applied in both places rather than one.
Stickiness is spec-mandated, is doctrine (the stale-label rule), and is pinned end to end.
`outcome` never had this problem because `recordOutcome` writes it unconditionally
immediately before edge selection; that asymmetry was the clue.

The agreement is scoped to **engine-reachable states**, and that scoping is deliberate:
a context whose sticky label disagrees with a non-empty live label cannot arise, because
`recordOutcome` writes the live label to context before edge selection. In that
unreachable state the spellings still differ, since §10.4's literal-first rule governs
the qualified form. The unit tests pin the resolution rule; an engine test runs the same
graph in both spellings and asserts equal paths.

### Minor items taken with it

- `engine.ts` restated `attrs.goal_gate === 'true'` instead of calling `wantsVerdict`
  (`engine/src/backend/argv.ts:42`) — the hand-kept-copy pattern `isEngineManagedKey` and
  `wantsVerdict` were both extracted to prevent. Now calls the predicate.
- `setManaged`'s throw — the engine-facing half of the anti-drift mechanism — had no test
  and could be deleted with the suite green. Now pinned, in both directions.
- `dot/parse.ts` applied `node [...]` and `edge [...]` defaults through
  `if (!(k in attrs))`, which walks `Object.prototype`, so `node [toString="x"]` was
  silently dropped. Same class the branch already swept out of `graph.ts` and `lint.ts`;
  the sweep missed these two loops. Now `Object.hasOwn`.
- `cli.ts` seeds `Context.from(args.params)` unguarded, so `--param current_node=x`
  bypasses `isEngineManagedKey`. **Decision: warn, do not refuse.** The guard exists so a
  *model* cannot forge routing tokens; an operator typing `--param` is the same authority
  that wrote the graph. Refusing would also delete a documented override — `Engine.run`
  mirrors graph attributes only `if (!context.has(qualified))`, deliberately, so that
  `--param graph.goal=...` wins. What was wrong is that the bypass was silent.

### Line pins in this document were refreshed, and will go stale again

`engine.ts` grew by roughly 90 lines and `condition.ts` by 26 across this work, which
left citations pointing at unrelated text — worst of all in C4's "Re-verified 2026-08-04"
block, whose entire value is that a reader can re-check it. Every `condition.ts` pin was
recomputed against the current source and spot-checked line by line.

**The `engine.ts` pins were not.** They were computed against a draft roughly 11 lines
shorter than what shipped, and this document asserted they had been verified when they
had not — the same shape of failure this branch exists to withdraw (see "The withdrawn
fix, and why it was withdrawn" above), now found in this document's own audit trail on
review. Every `engine.ts` citation above has since been recomputed against the current
source and corrected in place. **They will drift again**, on both files. A citation of
the form `file:line` is a snapshot, and this document is structurally committed to them;
anyone re-verifying should treat a pin that lands on unrelated text as stale rather than
as evidence the claim is false.

### Effect on the residuals

- **R1** — the "neither can report SUCCESS" claim is corrected in place above. The
  deferral stands; nothing here bounds the loop or touches routing.
- **R4** — narrowed, not closed. The anti-drift *test* still observes one fixture's path,
  but the engine-facing throw it guards is now itself pinned.
- **R5** — unchanged. The review fixtures are inline consts in `engine/test/engine.test.ts`,
  following this suite's existing convention; committed `.dot` files remain Plan 6's.

---

## Residuals from the dataflow plan — 2026-08-04

Recorded at the close of `feat/attractor-dataflow` (371 tests, 369 pass, 1 skipped
`live.test.ts`, 1 bundle check). Each has an owner. **None of them is a spec
contradiction**; they are coverage limits and known inaccuracies in our own additions,
recorded here because the alternative is that a future reader discovers them as
surprises and "fixes" one in the wrong direction.

One item from the reviews was **closed rather than deferred**: `NEVER_FAILS` in
`dot/lint.ts` hand-copied `PassthroughHandler`'s handler kinds. `defaultHandlers` is now
built from an exported `PASSTHROUGH_KINDS` and `NEVER_FAILS` *is* that list, with a test
in `lint.test.ts` recomputing the passthrough set from the map so an entry added after
the spread cannot drift unnoticed.

### R6. NEITHER guard sees a reference that appears only in an edge condition

**Re-scoped 2026-08-04, from a lint-coverage limit to a RUNTIME-coverage limit.** This
entry used to say the blind spot was DATA-001's and concede it on the grounds that "the
runtime input check is the load-bearing guard". That defence does not exist: the runtime
check has the identical blind spot, by construction and on purpose.

`DATA-001` and `Engine.unavailableInput` both scan `substitutableText(node)` — a box
node's `prompt` (or `label`), a tool node's `tool_command` — which is exactly the text
the engine substitutes. Sharing it is deliberate: the warning and the halt must agree
about what counts as a reference, or a graph lints clean and then dies on a key lint
could have named. The cost of that agreement is that they share the gap too.

The consequence is that **finding I1's own worked example is invisible to both of them**:

```dot
build   [tool_command="exit 1", outputs="build_error"]
publish [prompt="publish the artifact"]
build -> publish [condition="context.build_error!=fatal"]
```

`build_error` appears nowhere but the condition. With full opt-in applied — the producer
declaring it, the ledger armed — the run still reaches `done` at exit 0, `publish`
invoked. No `DATA-001` fires and no `node.input_unavailable` is recorded. **Adding
`outputs=` buys nothing here**, which is what makes this a coverage limit rather than a
consequence of I1's opt-in design.

Closing it means scanning `condition` attributes with a different tokenizer (`context.`
prefixes, not `${}`), on both sides. That is a new mechanism, not a widening of either
existing one, and it has a routing question attached: the condition is evaluated when
*leaving* the producer, before the consumer is reached at all.

Recorded as behaviour rather than left implicit: `I1 does not reach a reference that
appears only in an edge condition` in `engine/test/engine.test.ts` pins the green exit,
the absent block event and DATA-001's silence together.

**Owner: Plan 7 (doctrine port and packaging)**, alongside the attractor-expert
design-time checklist, which is where a hazard with no static rule belongs.

### R7. DATA-001's undotted-key exemption is the SHELL-VARIABLE exemption

`DATA-001` never flags an undotted reference. This is easy to misread as a `--param`
heuristic that could be tightened, and it must not be: **`substitute` deliberately leaves
a bare `$NAME` literal** so `$HOME` and `$WORKDIR` survive into `sh -c`. Drop the
exemption and the first `tool_command` mentioning `$HOME` false-positives immediately.
Every dataflow key in this engine is dotted (`artifact.path`, `tool.last_line`, every
`outputs=` example, every engine-managed prefix), which is what makes the line drawable
at all.

The residual gap is real but narrow: a **dotted** `--param` name still false-positives,
because lint cannot see runtime parameters. That is the reason DATA-001 is a WARNING and
not an ERROR.

**Owner: nobody, deliberately.** Recorded so it is not "simplified" away.

### R8. GATE-001 under-reports in two known ways

- It treats the declared gates as **one wall**: `bypassesGates` stops at any gate, so a
  route that bypasses gate A but reaches gate B is not reported, even though A's work
  went unjudged. **This under-report WORSENS AS GATE COUNT GROWS**: the more gates a
  pipeline declares, the likelier any given failure route lands on one of them, and the
  quieter the rule becomes — so the rule is weakest on exactly the elaborate pipelines
  that most need it. GATE-001 is I2's entire fix, so this is not a footnote.
- A failure route expressed as a **`preferred_label` branch** is not recognised.
  `isFailureRoute` asks the engine's own evaluator whether a clause is eligible on FAIL
  and not on SUCCESS; `preferred_label=abort` is eligible on neither against an empty
  context, so it does not count.

Both under-report rather than over-report, which is the correct direction for a WARNING
— the CMD-001 lesson is that a rule which cries wolf gets filtered out and becomes worse
than absent. Recorded because "GATE-001 covers I2" is true of I2's shape and not of
every shape.

**Owner: Plan 7 (doctrine port and packaging)**, with the golden-graph corpus. A rule
this shape needs real pipelines to tune against, and R5 is the entry that provides them.

### R9. `SUBSTITUTABLE_ATTRS` restates attribute names rather than importing them

`dot/graph.ts`'s `SUBSTITUTABLE_ATTRS` maps each handler kind to the attribute names that
handler passes through `substitute()` — `['prompt', 'label']` for codergen,
`['tool_command']` for tool. Those strings are **read from the handlers and retyped**,
unlike `TOOL_OUTPUT_KEYS`, which `INFERRED_OUTPUTS_BY_HANDLER` imports from
`handlers/tool.ts` precisely so it cannot drift.

The asymmetry is deliberate as far as it goes — the fallback chain (`prompt || label`) is
an ordering a handler does not export today, and the table is keyed off the resolved
handler so §2.6's `type`-over-`shape` precedence survives — but it is a hand-copy, and
this branch has already been bitten twice by hand-copied lists. The cheap close is for
each handler to export its own ordered attribute list.

**Owner: whichever plan next changes a handler's substitution surface.** It is a
five-line change and does not justify a plan of its own; it justifies not being
forgotten.

### R10. The CLI's unresolved-failure warning says "reached its exit" on a run that halted

`cli.ts` writes `WARNING: the pipeline reached its exit with unresolved node failures:
...` whenever `RunResult.unresolvedFailures` is non-empty. The condition is "the run
holds an unresolved failure"; the text claims something stronger. A run that **halts** —
a FAIL with no matching edge, §3.7 step 4, which is now the ordinary outcome of a blocked
input — never reaches the exit and still prints it.

**Pre-existing**, and confirmed so rather than assumed: the string was introduced in
`de31ff7`, which is an ancestor of `main`, and the halt path (a FAIL with no route)
existed before this branch. This branch made the shape more reachable; it did not create
the inaccuracy. Not fixed here deliberately — it is a message change on a path with its
own CLI tests, and it belongs in a change that owns the CLI's output rather than in a
dataflow branch.

**Owner: Plan 7 (doctrine port and packaging)**, which owns the operator-facing surface.

### R11. `outputs=` is never verified against what a handler actually wrote

A node that declares `outputs="artifact.path"` and returns SUCCESS without ever writing
that key is not reported. Its successors then reference a key nothing produced, and
§10.3 resolves it to the empty string — the same vacuous-guard shape I1 is about, one
level removed.

This is the design's own **open question 1**, and it is out of scope **deliberately**,
not by omission: it is a second mechanism (a post-execution contract check, with its own
question about what to do when the contract is broken — FAIL the node? warn? which
would be a routing change), and the dataflow plan closed I1 without it.

**Owner: unassigned, and it should stay a recorded question until someone wants the
behaviour.** Filing it against a plan would imply it has been decided.

---

## Whole-branch review of `feat/attractor-dataflow` — 2026-08-04

Four findings against the merged dataflow branch. **Two were breaches of a non-tradeable
doctrine entry, and both were found by RUNNING the code on A/B graphs rather than reading
it** — the sixth review rule in the root `AGENTS.md`, earning its place again. The other
two are corrections to this document and to a lint gap. All four are fixed on the branch;
what follows is the record, plus three residuals the review asked to be recorded and not
fixed.

### W1 (FIXED, Critical). `runs_on` re-opened the fail-closed goal gate

Task 5 correctly ensured a goal gate is never *skipped* by `runs_on`. The eager input
check was still gated on `mode === RunsOn.SUCCESS`, so a gate with
`runs_on={failure,always}` was excluded from it. Demonstrated on identical A/B graphs:

- gate without `runs_on`: blocked, run halts, `status: fail`.
- gate with `runs_on="failure"`: eager check skipped, the owed `${artifact.path}` blanked,
  the gate printed `verified ` and returned SUCCESS, **satisfied itself**, and the run
  reached `done` at `status: success`, exit 0.

A goal gate earning its verdict against an input the engine itself recorded as
unavailable is exactly the unearned false-success the fail-closed entry in
`plugins/attractor/AGENTS.md` exists to prevent — the entry cites a real run that claimed
victory with zero work product after 2.4 hours.

**Fixed**: the eager input check applies to a `goal_gate` node regardless of `runs_on`
(`Engine.run`'s `checksInputs`). `runs_on` is now wholly inert on a gate — it can neither
skip one nor relax one. Pinned by `a goal gate is never earned on an owed input` over all
three modes and by `the runs_on attribute changes nothing at all on a goal gate`.

Two supporting claims asserted the opposite and were corrected rather than left:
RUNS-002's message ("The engine runs it anyway and makes it earn its verdict") and the
engine comment justifying WARNING ("this line is what makes the combination safe rather
than dangerous"). Both were half-true, which is the worst kind: the gate did run, and
then judged blanked inputs.

**RUNS-002 stays WARNING, re-decided rather than inherited.** With both halves of the
fail-closed resolution present the original claim is finally true, nothing unsafe
survives, and refusing to run a graph over an inert attribute would be the CMD-001
mistake. It now also fires on `runs_on="always"`, which the fix turned from dangerous
into silently inert.

### W2 (FIXED, Important). Blanking owed keys created `rm -rf /tmp`

`OwedKeysReadEmpty.get` returned `''` for a key the ledger owed. Verified end to end: a
`runs_on=always` cleanup node with `tool_command="... rm -rf ${artifact.dir}/tmp ..."`
after a failed producer executed with **`rm -rf /tmp`** substituted. `$HOME` was correctly
preserved — the shell-variable half of the protection worked — and the owed-key half
created the identical hazard, on the one class of node (`runs_on=always` cleanup) where
`rm -rf` actually lives.

It was also a **safety regression**: before this branch `sh` rejected `${artifact.dir}`
with `bad substitution` and exit 1, so the failure was loud.

**Fixed**: `OwedKeysReadEmpty` and `Engine.dispatchContext` are deleted. An owed key is
left literal, exactly as an unknown key already was — `substitute`'s existing, deliberate
behaviour, one rule instead of two, and the loud failure restored. **The design specified
blanking; the design was wrong.**

Effect on `runs_on={failure,always}` nodes that legitimately reference an owed key: the
handler receives the reference text, and a POSIX shell then fails the command loudly,
because a dotted key is not a valid shell parameter name. That is a cleanup node
reporting that its input never arrived — true — instead of silently deleting a path the
author never wrote. Pinned by `an owed key in a cleanup command stays literal: the rm is
not silently widened`, which asserts the recorded `command.sh` text verbatim, the
survival of a sentinel the blanked form would delete, and the non-zero exit.

### W3 (FIXED, Important). `outputs=` could name engine-managed keys

Nothing validated `outputs=` against `isEngineManagedKey` or the handler-owned set.
Verified: `build [outputs="tool.last_line"]` linted clean and blocked the downstream node
whose whole job is reporting the failure — **the exact stale-label contradiction this
branch removed** by making the ledger declared-only, re-armable from the graph one
attribute at a time. `build [outputs="outcome"]` blocked every downstream node
substituting `$outcome`; the write-clearing in `Engine.run` cannot rescue it, because
engine bookkeeping writes are drained and discarded before dispatch.

**Fixed**: `DATA-002`, an **ERROR**, refusing an `outputs=` declaration that names an
engine-managed key or a handler-owned one. The sets are derived, never retyped —
`isEngineManagedKey` for the first, `INFERRED_OUTPUTS_BY_HANDLER` (which imports
`TOOL_OUTPUT_KEYS` from the handler) for the second.

**ERROR, against DATA-001's precedent, on the closed-set test RUNS-001 settled.**
DATA-001 softens to WARNING because `--param` supplies keys lint cannot see, so its
question is unanswerable at design time. This question is answerable and closed: both key
sets are fixed at lint time and no runtime input makes declaring one legitimate — a
`--param` seeds a *value*, this is a *declaration of authorship* that is false however the
run is invoked. And `outputs=` is new on this branch, so no pre-existing graph can be
refused; the CMD-001 hazard that forces WARNING elsewhere has nothing to bite on. **That
last point was checked, not assumed** — see the sweep below — and yes, it changes the
answer: without it, ERROR would be a bet rather than a finding.

**False-positive sweep, every DOT graph in the repository.** 59 tracked files, 14
containing graphs, **214 `digraph` blocks extracted, 204 parsed** (10 unparseable
fragments are deliberately malformed parser fixtures), **31 graphs using `outputs=`, 41
declared keys**. DATA-002 fires **4 times, all in `lint.test.ts`, all on the three
fixtures written for the rule itself**. Zero diagnostics on any pre-existing graph.

### W4 (FIXED, Important). I1's closure was overstated in this document

Corrected in place in the I1 section above and in R6, which is re-scoped from a
lint-coverage limit to a runtime-coverage limit. The claim that "the runtime input check
is the load-bearing guard" was used to concede the condition-only blind spot to DATA-001;
the runtime check has the identical blind spot, by design, because both read
`substitutableText`. A test now pins the shape.

### R12. The checkpoint omits `failedOutputs` and `Context.written`

`core/checkpoint.ts` persists `runId`, `currentNode`, `completed`, `context` and
`attempts`. The failed-output ledger and the per-node write record are absent.

**Harmless today** — there is no resume path, so nothing reads a checkpoint back into a
running engine. It stops being harmless the moment one exists: a resumed run would start
with an empty ledger, so **every I1 protection earned before the checkpoint would be
silently lost**, and a node whose producer failed before the resume point would be
dispatched against inputs that are never coming. `Context.written` matters for the same
reason one hop down — a drained-and-restored write record is what keeps the engine's own
bookkeeping writes from settling a node's debt.

**Owner: whichever plan implements resume**, as a required part of that work rather than
a follow-up to it.

### R13. RUNS-001 claims the bare attribute name `runs_on` at ERROR

`runs_on` is a custom attribute this branch introduced, and RUNS-001 refuses any value
outside `RUNS_ON_MODES` as an ERROR — so a pre-existing graph that used `runs_on` for an
unrelated purpose of its own becomes unrunnable, not merely warned about. **No such graph
exists in this repository** (checked in the same sweep as W3), and the fallback direction
argument for ERROR is unchanged and still right. Recorded because "we claimed a name in
the author's namespace at ERROR severity" is a decision, not an accident, and the next
custom attribute should be argued the same way rather than inheriting this silently.

**Owner: nobody, deliberately.** Recorded so it is not rediscovered as a surprise.

---

## Lint conformance fixes — 2026-08-04 (F2, F3, F9). CLOSED

**Status: merged into `main` at `efda0c7` ("Merge: lint conformance (F2, F3, F9)"),
`--no-ff` off `fix/attractor-lint-f2-f3-f9`.** Re-probed by direct execution against the
merged tree after the final integration (`node --test`: 462 tests, 461 pass, 0 fail, 1
skipped; `dist/attractor.js` rebuilt and confirmed byte-identical to a fresh `esbuild`
run). All three behave exactly as recorded below — see the final-integration re-probe
output for each.

Three findings against `engine/src/dot/lint.ts`, each reproduced by executing the rule
before any change, fixed on `fix/attractor-lint-f2-f3-f9` off `main`. A false-positive
sweep of every `digraph` block in the repository (277 blocks across 18 files, 245 parsed,
32 deliberately-malformed parser fixtures skipped) after all three fixes found **zero new
ERROR-severity diagnostics on any graph** — every diagnostic that changed only *dropped
out* of the ERROR set (30 cases: 28 TOPO-006 severity downgrades, one HITL-002 and one
HITL-001 case that were the fixtures written for these findings themselves).

### F2. HITL-002 rejected the spec-legal `goal_gate=false`

> Appendix A / section 2.6: `goal_gate` is `Boolean`, default `false`. Section 2.4:
> Boolean syntax is exactly the literal keywords `true` and `false`.

HITL-002's first check refused any `goal_gate` value other than the exact string `"true"`
— including `"false"`, the type's own default. That is the same class of mistake this
document's ambiguity #5 above already named once for HITL-002's *second* check (the
shape restriction): an ERROR that rejects a conformant author's graph.

**Fixed**: the check now excludes `"false"` as well as `"true"` from the near-miss set —
`node.attrs.goal_gate !== undefined && node.attrs.goal_gate !== 'false'` guards the
branch, so `goal_gate=false` produces no diagnostic, matching `wantsVerdict`
(`backend/argv.ts:43`, `=== 'true'`) reading it as "not a gate," which is the spec
default. The hazard the rule exists for is unweakened: a value that is neither `"true"`
nor `"false"` (`"TRUE"`, `"1"`, etc.) still fires ERROR, still names the node, still says
outright that the engine's runtime match is exact-string. The second check (shape
restriction, ambiguity #5) is untouched and still fires independently once `goal_gate` is
genuinely `"true"`.

### F3. TOPO-006 downgraded from ERROR to WARNING

Neither section 7.2's built-in lint rule table nor the section 11.2 checklist mentions a
dead-end rule (a non-exit node with no outgoing edges) at any severity — checked, not
assumed, by reading both in full. TOPO-006 was always a genuine §7.4 extension (and is
still named as one in the "Genuine extensions" list above), never a spec requirement.

Separately, the engine's own runtime already guarantees the property TOPO-006 exists to
protect. `Engine.run` (`core/engine.ts:1173-1186`) halts any run that reaches a node with
no route forward — `status: FAIL`, a message naming the node ("... which has no outgoing
edges and is not the exit") — rather than silently reporting success and bypassing
`unsatisfiedGoalGates()`. This is pinned end to end by `engine/test/engine.test.ts`'s "a
dead-end node fails the run instead of reporting silent success," which deliberately runs
the dead-end fixture WITHOUT lint to prove the runtime alone is sufficient.

**Decision: downgrade to WARNING, not remove and not leave at ERROR.** All three options
were weighed:

- **Remove entirely** was rejected. The diagnostic still has value the runtime does not
  replace: a design-time hint is cheaper to see than discovering the same dead end after
  a long-running pipeline reaches it. DATA-001 and GATE-001 both kept their diagnostics
  at WARNING rather than being removed, for the identical reason.
- **Leave at ERROR** was rejected because it fails the same test DATA-001 and GATE-001
  were held to: an ERROR that refuses to execute a graph the spec places no requirement
  on, over a shape the engine already handles safely and loudly, is exactly the CMD-001
  lesson — a rule that costs more than the hazard it prevents, since the hazard is
  already prevented one layer down.
- **Downgrade to WARNING** matches the discipline DATA-001 uses almost verbatim: DATA-001
  is WARNING because "the engine's eager input check is the guard that actually stops the
  run" (line ~656 above); here, the engine's own dead-end halt is that guard. GATE-001 is
  WARNING for the adjacent reason that the engine "is behaving exactly as specified" —
  true here too, since nothing in the spec is contradicted by a dead end existing or by
  the run halting when one is reached.

**Fixed**: `engine/src/dot/lint.ts`'s TOPO-006 block now pushes `Severity.WARNING`. The
diagnostic, its code, and its node attribution are otherwise unchanged; the message was
extended to name the runtime guarantee so a reader is not left to independently discover
why this is a WARNING rather than the ERROR it used to be.

**This document's own "eleven of twelve rule codes are ERROR" claim (line ~516,
"Confirmed conformant") is now stale** and is corrected here rather than silently: as of
this fix, TOPO-006 joins CMD-001 as a WARNING-severity rule code. `hasErrors` is still
what decides refusal, and it still tests severity, not rule count or name — that
mechanism is unchanged and is exactly what makes this downgrade take effect correctly.

### F9. HITL-001 required `on_timeout`, refusing the spec's own `human.default_choice`

> Section 6.5: "For `wait.human` nodes, the node attribute `human.default_choice`
> specifies which edge target to select on timeout."

The spec never uses the name `on_timeout` anywhere in its text (confirmed by grep over
the full spec). `on_timeout` was this engine's own invention for the same purpose
`human.default_choice` names, and was correctly recorded in the "Genuine extensions, no
conflict" list above — but HITL-001 *required* it, which is where the extension crossed
into contradiction: a graph written to the spec's own section 6.5 wording, using
`human.default_choice` and never `on_timeout`, was refused at ERROR.

**Fixed**: HITL-001 now checks both attribute names independently. Either one naming a
real outgoing edge label satisfies "an explicit target was named"; a timeout with
*neither* attribute present is still refused, and a timeout where the only attribute(s)
present name no real edge is still refused, listing what was checked. `on_timeout`
remains recognised — nothing in the spec forbids a second, engine-native spelling for the
same purpose, so keeping it is additive, not a second contradiction.

The doctrine entry "Human gates never time out by default" in `plugins/attractor/AGENTS.md`
named only `on_timeout`; it is corrected in place there, with a dated note, to name both
attributes and record why. The safety property itself — no implicit fallback, no
first-edge rule — is unchanged and is not weakened by accepting a second spelling of
"you must name one."

---

## Parser conformance fix — 2026-08-04 (F1). CLOSED, retroactively recorded

This finding shipped on `fix/attractor-parser-conformance` (commit `d51a981`), merged
into `main` at `89ba3e6` ("Merge: parser conformance (sections 2.2, 2.3, 3.2, 4.4)")
before the lint and parser-multiline branches existed. That merge never added an entry
to this document — an omission, not a judgement call — so it is recorded here now,
during the final integration, rather than left to be rediscovered as a surprise the next
time someone asks "was section 2.2 ever fixed."

### F1. Unquoted qualified attribute ids (`section 2.2`, `QualifiedId`) failed to parse

> Section 2.2: `QualifiedId ::= Identifier ('.' Identifier)*`. Every dotted attribute
> name the specification itself defines — `human.default_choice` (section 6.5),
> `manager.poll_interval`, `stack.manager_loop` and the rest — is a bare `QualifiedId`.

**Before**: the upstream `@ts-graphviz/ast` grammar has no production for an unquoted
`.` inside an identifier, so a source using any of the spec's own dotted attribute names
unquoted threw `Expected "=" but "." found.` and the *whole file* failed to parse — not
just the one attribute.

**Fixed**: `parse.ts`'s section-2.2 lexical scanner wraps a bare `QualifiedId` — and only
a bare `QualifiedId` — in double quotes before the source reaches the upstream parser.
Quoting changes only the `quoted` flag on the resulting AST `Literal`; `value` is
byte-identical, and `value` is the only field this module reads, so the unquoted and
quoted spellings of a dotted key are guaranteed to agree.

**Re-probed against the final merged `main`** (this integration), by direct execution:

```
OK   unquoted dotted key (human.default_choice): {"n.attrs":{"human.default_choice":"Continue"}}
OK   unquoted dotted key (manager.poll_interval): {"n.attrs":{"manager.poll_interval":"45s"}}
OK   unquoted dotted key (stack.manager_loop): {"n.attrs":{"stack.manager_loop":"true"}}
OK   already-quoted dotted key (control): {"n.attrs":{"manager.poll_interval":"45s"}}
```

Still fixed; no regression from the F2/F3/F5/F9 merges, which never touch this code path.

---

## Parser conformance fix — 2026-08-04 (F5). CLOSED

**Status: merged into `main` at `c027403` ("Merge: accept a literal newline inside a
quoted value (F5, section 2.4)"), `--no-ff` off `fix/attractor-parser-multiline`.**

### F5. A literal newline inside a quoted value failed to parse

> Section 2.4's `String` production allows escapes — the table's own example is
> `"line1\nline2"`. Section 8.6's own worked example embeds a **real** newline
> character inside `model_stylesheet`'s quoted value, spanning five source lines.

**Before**: real Graphviz accepts a bare newline byte inside a double-quoted value
(verified against `dot -Tcanon`), but the upstream `@ts-graphviz/ast` grammar has no
production for a bare newline or CR inside a quoted string — only `\"` and a
backslash-preceded line continuation are legal there. Section 8.6's own example, fetched
verbatim from the specification, threw `Expected "\"" or "\\" but "\n" found.` and did
not parse.

**Fixed**: the section-2.2 scanner (already walking quoted-string spans character by
character with correct backslash-escape handling) substitutes a reversible Unicode
noncharacter placeholder — U+FFFE for a bare LF, U+FFFF for a bare CR, both permanently
reserved and never valid for interchange — while scanning, and restores the original
byte in every AST literal (`id`, `key`, `value`) once parsing completes. A source that
already contains either noncharacter is rejected outright rather than silently
mis-restored. Encoding the newline as the two characters `\` + `n` was considered and
rejected: the dependency's `QuoteEscape` action leaves any `\X` other than `\"`
unchanged — matching real Graphviz's own rule that `\n` (two characters) and an actual
newline byte are different values — so that encoding would have silently changed the
value's meaning rather than preserved it.

**Re-probed against the final merged `main`**, by direct execution — the spec's own
section 8.6 example, fetched verbatim:

```
section 8.6 example PARSED. graph name: Pipeline
model_stylesheet byte-exact round-trip: true
model_stylesheet value (JSON): "\n            * { llm_model: claude-sonnet-4-5; llm_provider: anthropic; }\n            .code { llm_model: claude-opus-4-6; llm_provider: anthropic; }\n            #critical_review { llm_model: gpt-5.2; llm_provider: openai; reasoning_effort: high; }\n        "
literal backslash-n stays 2 chars: "line1\\nline2" contains real NL: false
```

The multi-line value round-trips byte-exact, and the boundary case (a literal
two-character `\n` that must **not** become a real newline) still holds.

---

## Final integration — 2026-08-04. F1, F2, F3, F5, F9 re-probed against merged `main`

All five findings tracked for this integration round were re-probed by direct execution
against the final merged `main` (commit `e0905e7`, after both fix branches and the
bundle rebuild), independent of the unit-test suite. All five are **fixed and holding, no
regression**:

| Finding | Area | Status | Probe result |
|---|---|---|---|
| F1 | parser, section 2.2 | fixed (pre-existing on `main`, undocumented until now) | unquoted qualified ids parse |
| F2 | lint, HITL-002 | fixed on this branch | `goal_gate=false` no longer refused; near-miss still refused |
| F3 | lint, TOPO-006 | fixed on this branch | WARNING not ERROR; runtime still halts a reached dead end |
| F5 | parser, section 2.4/8.6 | fixed on this branch | section 8.6 example parses byte-exact |
| F9 | lint, HITL-001 | fixed on this branch | `human.default_choice` accepted; safety property unweakened |

No finding in this set was recorded-not-fixed; each has a positive, reproduced fix. If a
sixth finding surfaces later that was investigated and deliberately left unfixed, it
belongs in a new dated section here with the same discipline as everything else in this
document: the normative quote, why it was left, and what still protects the property it
would have protected.

Full suite at this commit: **462 tests, 461 pass, 0 fail, 1 skipped** (the one skip is
`live.test.ts`, pre-existing, invokes no real `claude` binary). `dist/attractor.js`
rebuilt and confirmed byte-identical (SHA-256
`71663c1749d2f3ad157304613056fedd395e541f21d2ab970f88cfb9556c9441`) to an independent
`esbuild src/cli.ts --bundle --platform=node --format=esm` run taken after the commit.

**Naming note.** The `F1` above is the section-2.2 unquoted-qualified-id fix, labelled from
a scratch report found during this integration round. A *different*, unrelated
investigation running in parallel also used the label `F1` for a separate candidate
finding — `edge_target_exists` — and concluded no fix was warranted. To avoid two
different things both being called `F1` in this document, that investigation is recorded
below under its rule name rather than a number.

---

## `edge_target_exists` (`TOPO-003`) investigated — 2026-08-04. No fix warranted

> Section 7.2: `edge_target_exists | ERROR | Every edge target must reference an
> existing node ID.`

**The candidate finding:** `dot/parse.ts` back-fills any id appearing only as an edge
endpoint into a real node before lint ever runs (`upsertNode(id, {}, scope)` in the
`Edge` case), so `TOPO-003` — coded correctly to the rule text — can never observe a
missing target on any `Graph` `parseDot` produces. A typo'd edge target therefore
becomes a new, empty, codergen-handled node rather than a lint error.

**Why no fix was made.** Section 1.2 points to the Graphviz DOT language specification
for syntax, which includes implicit node declaration on first use as an edge endpoint.
Section 2.13's own third worked example (the human-gate pipeline) declares `ship_it` and
`fixes` **only** as edge endpoints — no `NodeStmt` for either exists in that block — and
presents it as a correct, complete, minimal pipeline. A `TOPO-003` that rejected an edge
to an undeclared id would therefore flag the specification's own canonical example as an
ERROR, which is incoherent. Section 7.3's `validate(graph, ...)` takes a `Graph`, not DOT
source text, and section 9.1 places it strictly downstream of an arbitrary transform
chain; section 9.3/9.4 describe custom transforms that merge or inject nodes and edges —
exactly the class of operation that can produce a genuinely dangling edge without ever
going through `parseDot`'s implicit-declaration guarantee. So "existing node ID" is
scoped to whatever `Graph` `validate()` is actually handed, not to the direct output of
parsing DOT text, and `TOPO-003` remains a live, correctly-scoped, already-tested check
at that level — `test/lint.test.ts:204` exercises it against a hand-built `Graph` with a
dangling edge pushed on directly, which is the only way to construct the case it guards
against. That test's own comment (`:176-179`) already stated this exact reasoning before
this investigation started.

There is no principled way to distinguish a typo'd edge target from a deliberately
minimal implicit node at the level DOT syntax operates — `a -> reviw` and
`a -> review_extra_minimal_stage` are syntactically and semantically identical
operations, and the specification draws no such distinction. A stricter `TOPO-003` would
need to reject exactly what section 2.13's own example does.

**Verified independently, twice** (the investigating agent and its adversarial reviewer,
separately): a hand-built `Graph` simulating a careless transform-style merge that drops
a node while keeping edges into and out of it still trips `TOPO-003` correctly — the rule
is live, not dead code. A false-positive sweep of every DOT-shaped block in the
repository (implicit-declaration via subgraph scoping, via chained edges, via forward
reference) produced zero `TOPO-003` false positives. A reachable (non-dead-end) phantom
node created by a typo'd edge target was confirmed to slip past every existing lint rule
with no diagnostic at all — real, and inherent to the DOT semantics the specification
adopts, not a defect specific to how this engine scopes `TOPO-003`.

**What still protects against a typo'd edge target:** nothing at lint time. A reachable
phantom node dispatches to the codergen handler with an empty prompt; an unreachable one
is caught by `TOPO-004` (unreachable) or, if it has no outgoing edge, `TOPO-006`
(dead-end, WARNING as of the F3 fix above). The gap is real only for a typo that happens
to land on a node with a working, reachable route forward — noted in passing during
review: `prompt_on_llm_nodes` (section 7.2, WARNING, unimplemented — already tracked
under Priority 3) is the natural home for a partial mitigation, since it would flag the
phantom node's empty prompt regardless of how it was created.

---

## Reconciliation — 2026-08-05. New defects, a citation-drift recurrence, two spec
self-contradictions, and an accountability gap in this document's own trail

Two independent passes ran against `main` at `e919c44`: one re-verifying, by direct
execution, everything this document currently claims CONFORMANT or CLOSED that a later
commit could plausibly have touched; the other checking specifically for drift — claims
that were true when written and may not be true now. A four-lens product-brief exercise
ran in parallel and surfaced two further items neither pass was scoped to find. Every
finding below was reproduced independently before being recorded — three of the highest-
severity ones twice: once by the investigating pass, once by the controller directly
against the real bundle or the engine's own constructor, pasted below.

### The citation drift predicted at the end of the previous section recurred, exactly as predicted

Commit `0717b38` ("fix(engine): conform to sections 3.4, 3.6, 4.12 and 5.3", landed the
same evening as the correction above but **after** it) grew `engine.ts` from 1076 to
1197 lines by inserting large doc-comment blocks throughout the file, and `retry.ts` from
56 to 106 lines. Every `engine.ts` citation pinned before that commit is now off by
300-700 lines — not the ~10-90 line drift the previous correction repaired, a much larger
one. Spot-checked directly:

| citation | claimed | actual content there now |
|---|---|---|
| `engine.ts:91` | `gateOutcomes` declared | unrelated line inside `defaultHandlers` |
| `engine.ts:264` | sets `outcome` unconditionally | mid-JSDoc for an unrelated field; the real call is now at `:689` |
| `engine.ts:332` | sets `current_node` | inside a doc-comment; the real call is now at `:761` |
| `engine.ts:415` | "the exit-time check" | inside the `gateRetryTarget` doc-comment |

The semantics described at every stale citation are still correct — this is a citation
problem, not a behavioral regression, confirmed by reading each real current location.
`lint.ts` (874 lines today, six feature commits past where COND-001/TYPE-001/HITL-002
were pinned) has the same class of drift, worse in magnitude (100-200+ lines). `graph.ts`
is drifted more mildly (20-40 lines). `condition.ts` and `edge-select.ts` — the two files
explicitly re-pinned in the previous correction, and the only two nothing has touched
since — are **still exact**, line for line. The pattern is now established rather than
theoretical: **a file's citations are only as fresh as the last time someone deliberately
recomputed them, and this document has no mechanism that notices when they haven't been.**
Rather than re-pin every citation a third time, only for it to drift a third time, the
record here is the pattern itself; a reader re-verifying any specific citation in an older
section should expect drift proportional to how many commits have touched that file since
the citation's own dated block, and should treat a pin landing on unrelated text as stale,
not as evidence the underlying claim is false.

### The same commit fixed four real defects with no finding ID, and one of them made a "Confirmed conformant" claim false until it landed

`0717b38`'s own commit message describes: the goal-gate retry ladder resolving from the
exit node instead of the gate node (already independently re-verified CONFORMANT below,
now correctly attributed); `checkpoint.json`'s `current_node` being written before a node
completed rather than after; handler exceptions converting to RETRY instead of FAIL
(§4.12); and `max_delay_ms` defaulting to `30_000` against §3.6's stated default of
`60_000`, with `jitter` entirely unimplemented. Only the exception-handling item has any
citation anywhere in this document (`carry-forward.md`'s throw-to-RETRY note, without a
commit reference); the other three appear in neither this document nor `carry-forward.md`.

This matters beyond bookkeeping: the "Confirmed conformant" section below lists "backoff
formula" as conformant. Verified against history —

```
git show f36ce24:.../retry.ts   → maxDelayMs: 30_000, no jitter field
current retry.ts                → maxDelayMs: 60_000, jitter field present
```

— that claim was **false** from whenever it was written until `0717b38` landed, and this
document never flagged the defect and never retracted the claim while it was false. It
reads correctly today only because an unrelated-looking commit happened to sweep it up.
This is the same failure the previous section's "found only because someone thought to
read the section afterwards" incident describes, recurring in a quieter form: a defect
that a commit fixed as a side effect, with nobody checking whether the audit's own claim
about it needed to change.

### New findings, independently reproduced by direct engine execution

**D7 (Important) — a plain node's FAIL wrongly consults the graph-level `retry_target`.**
§3.7's failure ladder names only *node* `retry_target`/`fallback_retry_target`; graph-level
rungs belong to §3.4's separate goal-gate-exit ladder. `resolveRetryTarget` in `retry.ts`
is shared by both call sites. Reproduced directly against the engine, bypassing the CLI
and lint entirely:

```
graph [retry_target="recover"]; boom [tool_command="exit 1"]; start->boom; boom->exit; recover->exit
→ status: success, path: start -> boom -> recover -> exit
```

`boom` declares no node-level retry attributes and has no `condition="outcome=fail"`
edge — under §3.7 step 4 this run should terminate. It doesn't, because the graph-level
`retry_target` leaks into ordinary node-failure routing. Fix: a scoped variant of
`resolveRetryTarget` (`{includeGraphLevel: boolean}`), `false` at the two §3.7 call sites,
`true` only from the goal-gate ladder.

**D3 / F12 (Important) — `checkpoint.json`'s `current_node` is `null` at every terminal
save**, contradicting §5.3's literal definition ("ID of the last completed node").
Reproduced directly:

```
start -> mid -> exit, run to SUCCESS
→ checkpoint.json: "current_node": null, "completed_nodes": ["start","mid","exit"]
```

The in-run timing fix (write after a node completes, not before) is correct and holds;
only the terminal overwrite is divergent. Note this is a different field from the
context-level `context.current_node` (correctly `"exit"` in the same checkpoint), which
is the engine-managed context key, not the top-level wire field §5.3 defines.

**D12 (Important) — no `should_retry` predicate; an exception on any node, with any
retry policy, is unconditionally terminal on the first attempt.** §3.5's
`execute_with_retry` retries an exception when `should_retry(exception) AND attempt <
max_attempts`. Probed: a throwing handler on a `max_retries=3` node was called once, not
retried. Argued as low-risk in the code (`claude.ts`'s own backend never throws a
retryable exception — every transport failure is converted to a FAIL `Outcome` before it
can propagate), but structurally contradicts §3.5 for any future or custom handler
(§4.12) that throws a genuinely transient error, and was never filed here.

**F10 (Important) — `Engine.run()` itself never checks lint; only the CLI does.** §7.1:
"the engine must refuse to execute a pipeline with error-severity diagnostics." Confirmed:
a two-`Mdiamond` graph (`TOPO-001` ERROR) passed directly to `new Engine(...)`, bypassing
`cli.ts`'s `reportDiagnostics()` wrapper, ran to `status: success`. `engine.ts` never
imports `dot/lint.ts`. Any embedder using the `Engine` class directly — a test, a future
HTTP mode — gets no refusal-on-ERROR protection at all.

**D14 (Minor) — `Status.SKIPPED` is unreachable.** Defined in the enum; no handler ever
returns it. Its §5.2 "proceed without recording an outcome" semantics are therefore
untested — a status that fell through to the engine's ordinary edge-selection path would
be treated like any other non-RETRY status, not specially, but nothing exercises this.

**D9 (Minor) — the dead-end-always-FAIL rule is undocumented in the doctrine.** The one
relevant `plugins/attractor/AGENTS.md` bullet, "Fail-fast on FAIL," is textually scoped to
a node that *returns* FAIL. The code's actual rule is broader: any non-exit dead end
becomes FAIL regardless of the reaching node's outcome status (a SUCCESS node with no
outgoing edges is still terminal FAIL). `AGENTS.md` should have its own bullet for this,
distinct from the FAIL-outcome one.

### Two specification self-contradictions, same shape as the goal-gate scoping ambiguity already filed upstream

Found by a business-analyst-lens pass reading the full specification against this
document's existing "Ambiguities" section, and independently confirmed against the
fetched spec text:

1. **Does a FAIL outcome get retried, separate from failure routing?** §3.5's own
   pseudocode (`execute_with_retry`) returns immediately on FAIL, no retry attempt.
   §11.5's Definition-of-Done checklist asserts the opposite: "nodes with `max_retries >
   0` are retried on RETRY **or FAIL** outcomes." Both this engine and
   `microsoft/amplifier-bundle-attractor` independently chose the §3.5 reading; neither
   project treats it as settled. Same shape as the already-filed §3.4-vs-§11.3/§11.4
   scoping question — queued for the same upstream issue.
2. **Is an unreachable node an ERROR or a WARNING?** §7.2's lint table marks
   `reachability` ERROR. §11.12's test matrix labels the identical case "orphan node ->
   warning." This engine implements ERROR (`TOPO-004`); the checklist disagrees with the
   table in the same document.

Recorded here as ambiguity 4 and ambiguity 5, joining the existing four. Both belong in
the same upstream filing as ambiguity 3 (goal-gate scoping) once that issue is opened —
not filed separately, since a maintainer resolving one is likely to want the others in
front of them at the same time.

### An undocumented severity tightening, flagged but not resolved

`TYPE-001` (unrecognized `type=` attribute) is ERROR; §7.2 specifies `type_known` as
WARNING. Unlike `HITL-002`'s shape restriction (recorded as a deliberate tightening) or
`RUNS-001`'s ERROR (justified against a closed, fully-known value set at lint time,
recorded in the dataflow plan), this one has never been given a reasoning entry. It may
well be justified by the same "unrecognized value degrades silently to codergen" argument
`RUNS-001` used — but that argument was made *about* `TYPE-001` as precedent without ever
being applied *to* `TYPE-001` itself. Left open rather than decided unilaterally here;
whoever picks this up should either write the justification or downgrade it.

### Two genuine blind spots — sections neither sweep engaged with at all

- **Section 9.7, Tool Call Hooks** (`tool_hooks.pre`/`tool_hooks.post`, also listed in
  Appendix A). Zero mentions anywhere in this document, `carry-forward.md`, `AGENTS.md`,
  the README, or the engine source. Not filed as ABSENT because nobody had checked either
  direction. Confirmed absent: the attributes parse and are never read.
- **Section 4.12's custom-handler registry** (`registry.register("my_type",
  MyHandler())`). `defaultHandlers()` builds a fixed map from a closed `HandlerKind` enum
  at construction time; there is no registration API, CLI flag, or programmatic seam for
  a sixth handler kind. This is the specification's own stated answer to "how do you make
  attractor do something it doesn't do out of the box" for the **program** half of this
  plugin's stated scope, and it has no realized path. Not previously filed in either
  direction.

Both added to the Priority 3 (silent omissions) list below.

### A documentation-accuracy note, not a product finding

`plugins/attractor/.superpowers/carry-forward.md`'s "Current sequence" roster (Plan 1 through Plan 7)
does not include the dataflow-failure-propagation plan
(`plugins/attractor/.superpowers/plans/2026-08-04-attractor-dataflow-failure-propagation.md`) at all —
it is referenced twice by name, never assigned a number, never inserted into the
sequence, despite being the plan that closed I1, reclassified I2, and produced
RUNS-001/002, DATA-001/002, and GATE-001. Fixed directly in that document alongside this
correction.

One upstream quote was also found not verbatim: this document's F1 section quotes
`QualifiedId ::= Identifier ('.' Identifier)*` (zero-or-more); the specification's current
text (§2.2) reads `Identifier ( '.' Identifier )+` (one-or-more). The `+` reading is
*stronger* for F1's own argument (a `QualifiedId` under `+` cannot degenerate to a bare
`Identifier`, which is exactly what makes the `Key ::= Identifier | QualifiedId`
alternation meaningful), so the fix stands regardless — only the quoted grammar in that
section needed correcting, not fixed here inline to avoid re-opening a closed section;
noted for whoever next touches F1's text.

### Four amplifier example pipelines, actually executed — one claim corrected live

The port-plan research pass that produced most of this section's port-classification
work stated, of four `microsoft/amplifier-bundle-attractor` example pipelines: "Checked
each `.dot` node-by-node against `SHAPE_TO_HANDLER`/`TYPE_TO_HANDLER`... and ran the lint
rules... **mentally** against each graph's structure" — a paper trace, not an execution.
The product brief this document feeds (`plugins/attractor/.delivery/brief.md`) then stated the result
with execution-level confidence and no caveat. A challenge review of that brief caught
the gap: the claim had no corroborating record anywhere in this repository. Rather than
add the mental trace as though it were verified, the four files were fetched verbatim
and actually run, `--stub`, against the current bundle:

| file | lint | run result |
|---|---|---|
| `01-simple-linear.dot` | no errors | `status: success`, `start -> implement -> done` |
| `03-conditional-routing.dot` | no errors | `status: fail`, step cap (500) reached, `test -> gate -> fix` repeating |
| `08-human-gate.dot` | no errors | `status: fail`, `no handler registered for human (node review_gate)` |
| `pr-review.dot` | no errors | `status: fail`, `no handler registered for parallel (node parallel_review)` |

`08` and `pr-review` matched the mental trace exactly. **`03` did not** — it was claimed
to run clean and does not. Root cause, found by reading the node's actual tool output
(`gate/stdout.txt`): the `gate` node's `tool_command` runs a real `pytest -q
test_url_shortener.py`, a fixture file that ships elsewhere in amplifier's own repository
and was not part of this fetch. Pytest fails to collect it every time, `tool.last_line`
is `fail` every time, and `fix` — a codergen node running under `--stub` — never performs
a real file write to satisfy it, so `test -> gate -> fix` repeats until the step cap.

**This is not an engine defect, and the run's own behavior is the doctrine working
correctly**: no false success was ever reported; the loop is bounded by the step cap
exactly as designed, and it terminates `FAIL`, honestly, rather than silently claiming
convergence on a test that never passed. The defect is in the verification method, not
the product: an isolated example `.dot` file, run under `--stub` without its companion
fixture files, is not a fair test of a graph whose core mechanism is a real shell command
against real files that `--stub`'s codergen nodes cannot create. The correct fix is to
fetch the example's full directory (fixture files included) before claiming it "runs",
not to patch the graph or the engine.

**Corrected claim for the record: one of four amplifier examples (`01`) runs clean
end-to-end under `--stub` as an isolated file; two (`08`, `pr-review`) hard-abort on a
missing handler, confirmed by execution; one (`03`) cannot be fairly evaluated without
its fixture files and should not be counted either way until re-run with them.** Anyone
citing "2 of 4 run clean" from this session's earlier work should use this table instead.

## HITL-001/`selectEdge` normalisation mismatch (F13). FIXED — 2026-08-05

### F13. HITL-001's label-existence check disagreed with how `selectEdge` actually matches a label at runtime

Found while source-verifying a design spec for a different feature (human-gate channels,
`plugins/attractor/.superpowers/specs/2026-08-05-human-gate-channels-design.md`), not by a
sweep — the design needed to know exactly how an edge's `label=` attribute participates in
routing, and reading `core/edge-select.ts` and `dot/lint.ts`'s HITL-001 rule side by side
surfaced a real, live disagreement between the two.

`selectEdge` (`core/edge-select.ts`, step 2) matches `outcome.preferredLabel` against an
unconditional edge's `label=` only after normalising both sides: stripping a leading
accelerator (`"[Y] "`, `"Y) "`, `"Y - "`), trimming, lowercasing (`normaliseLabel`). HITL-001
(`dot/lint.ts`), checking whether a human gate's `on_timeout`/`human.default_choice` names a
real outgoing edge, compared the raw, unnormalised strings: `labels.includes(d.value)`. The
two rules disagreed on the class of graph doctrine cares about most for this rule: an edge
declared `label="Y) Yes"` with `on_timeout="Yes"` — the natural, normalised form an author
would write, and the exact form that *would* match at runtime — was refused by lint as
"no outgoing edge carries that label," even though it would have worked correctly if built.
Lint and runtime disagreeing about what matches is the same class of defect finding C1 above
names as this project's worst-tracked failure mode (a question settled by intuition rather
than by reading the code it's supposed to guard).

**Fix:** `normaliseLabel` exported from `core/edge-select.ts` (previously module-private);
HITL-001 now compares `normaliseLabel(edge.label)` against `normaliseLabel(declared value)`,
reusing the exact function `selectEdge` already uses rather than re-implementing the
normalisation a second time. Two new tests pin the previously-refused shapes
(`test/lint.test.ts`, "HITL-001 accepts on_timeout written in normalised form against an
accelerated edge label" and "...differing from an edge label only by case"); both were
confirmed to fail against the pre-fix code (TDD red), then pass after the fix (green). All
six pre-existing HITL-001 tests, including both "still fires" regression guards, continue to
pass — the safety property (a timeout with no matching declared target is still refused) is
unchanged. Full suite: 464 tests, 463 pass, 1 skipped (unrelated, pre-existing live test),
0 failures. `dist/attractor.js` rebuilt to match.

Not filed as a new lint code — this is a bug fix to HITL-001's existing comparison logic, not
a new rule.

## TOPO-004/`retry_target` reachability blind spot (F14). FIXED — 2026-08-06

### F14. TOPO-004 does not recognise `retry_target`/`fallback_retry_target` as a reachability path, so the shipped CLI already refuses valid graphs that use it

Found while implementing FR-11/F10 (a direct `Engine` embed refusing a lint-dirty graph, the
fix immediately above F13's peer entry): the Task 3 implementation plan's own verification step
called for running the full `engine.test.ts` suite after wiring `run()` to `lint()`, and 13
pre-existing tests regressed. Tracing the first one down (`GATE_RETRIES_PAST_ITSELF`, a goal-gate
fixture where `gate`'s `retry_target="sidestep"` is `sidestep`'s only route in) showed `lint()`
reporting `TOPO-004: node sidestep is unreachable from start` even though the engine legitimately
routes there at runtime via section 3.4's goal-gate retry ladder.

The natural first read is "Task 3 introduced this by finally exercising `Engine.run()`'s embedded
path end-to-end" — but `Engine.run()` calling `lint()` doesn't change what `lint()` returns; it
only changes who's forced to look at the answer. The bug was already live in the shipped CLI,
independent of Task 3 entirely. Verified directly against the actual committed artifact, not
inferred: `dist/attractor.js` as of commit `f7e6315` (the last commit to touch it, Task 2's D7
fix, which predates every Task 3 change) already refuses this graph —

```
digraph GRT {
  start [shape=Mdiamond]  done [shape=Msquare]
  gate [shape=box, goal_gate=true, prompt="judge", retry_target="sidestep"]
  sidestep [shape=box, prompt="sidestep"]
  start -> gate
  gate -> done
  sidestep -> done
}
```

```
$ node dist/attractor.js lint repro.dot
ERROR TOPO-004 repro.dot:sidestep: node sidestep is unreachable from start
$ echo $?
1
$ node dist/attractor.js run repro.dot --stub
ERROR TOPO-004 repro.dot:sidestep: node sidestep is unreachable from start
refusing to run a graph with lint errors
$ echo $?
1
```

Both `lint` and `run` refuse a valid graph shape today, in the already-shipped product, for a
node whose only route in is a `retry_target`/`fallback_retry_target` attribute — a first-class,
spec-defined mechanism (section 3.4's goal-gate ladder, section 3.7's node-level failure ladder)
the engine actually traverses at run time. `dot/lint.ts`'s `reachableFrom` (the function TOPO-004
walks) only follows `graph.edges` — literal DOT `->` edges — and has no notion of these
attributes at all. Lint and runtime disagreeing about what is reachable is the same class of
defect finding C1 names as this project's worst-tracked failure mode (a question settled by
intuition — "TOPO-004 walks the graph, so it must already account for how the engine actually
routes" — rather than by reading the code it's supposed to guard). This is not a Task 3 defect;
Task 3 exposed it by finally routing a real embedding path through `lint()` against fixtures that
exercise `retry_target` without a redundant DOT edge, something the CLI's own pre-existing test
suite (`cli.test.ts`, `lint.test.ts`) never happened to do — every "good"/lint-clean fixture there
that uses `retry_target` also happens to give the target node a literal edge in from somewhere
else, which is why this went undiscovered until a fixture existed that didn't.

**Fix:** `reachableFrom` (`dot/lint.ts`) expands, for each node it dequeues, that node's own
`retry_target`/`fallback_retry_target` targets unconditionally — section 3.7's node-level failure
ladder applies to every node regardless of anything else in the graph. It additionally seeds its
BFS with the graph-level `retry_target`/`fallback_retry_target` targets up front, but **only when
the graph contains at least one `goal_gate=true` node** (`[...graph.nodes.values()].some(wantsVerdict)`)
— see the Correction below for why that guard exists; it was not part of the fix's first version.
Verified against the pre-fix code by reverting the change and re-running the full suite: the same
11 of the 13 originally-regressed tests failed again (the other 2 were independently fixed below
and are unaffected by this specific change), confirming the fix is what clears them, not a
coincidence of some other edit. Restored immediately after.

**Correction, 2026-08-06 (independent review).** The fix's first version seeded the graph-level
half unconditionally — no `goal_gate=true` check — which is strictly broader than what it claimed
to do and than the code comment (and this entry, as first written) asserted. Caught by an
independent reviewer, who verified concretely: a graph with a graph-level `retry_target="orphan"`,
zero goal-gate nodes, and `orphan` genuinely unreachable by any other mechanism, produced **no
TOPO-004 diagnostic at all** under the first version. Per D7/ADR-003 and `engine.ts`'s
`gateRetryTarget`, the graph-level `retry_target`/`fallback_retry_target` is consulted **only** by
an unsatisfied goal gate's exit check (section 3.4) — with no goal gate anywhere in the graph,
nothing ever reads that attribute, so treating it as a route in was the exact over-broad heuristic
the original write-up said this fix deliberately was not. Fixed by gating the graph-level seeding
on `wantsVerdict` (the same goal-gate predicate the engine and every other rule in this file
already use, not a restated check) — the node-level expansion needed no change, since section
3.7's ladder never depended on a goal gate existing anywhere.

The same review also flagged that the fix rode entirely on 11 `engine.test.ts` fixtures whose
primary purpose is pinning engine routing/retry behaviour, not lint correctness, and that none of
them covered the over-broad case above. Four direct tests were added to `test/lint.test.ts`,
beside the existing `"TOPO-004 fires for an unreachable node"` test: a node-level-only positive
case (with a goal gate present, to prove the node-level path is unaffected by the new guard); the
over-broad-case regression itself (graph-level target, no goal gate, must still fire — this is the
one that would have caught the bug directly); its positive counterpart (graph-level target, goal
gate present, must not fire, proving the guard swings both ways); and a robustness case (a
`retry_target` naming a node that was never declared must not crash lint, must not appear in any
diagnostic, and must not suppress a genuinely unreachable node elsewhere in the same graph).
Mutation-checked individually: forcing the goal-gate guard to `true` broke only the no-gate test;
forcing it to `false` broke only the gate-present test; disabling the node-level expansion broke
only the node-level test; disabling TOPO-004 entirely broke the robustness test's second
assertion. (The robustness test's guard against a *nonexistent* target specifically was checked
too and found to have no currently-observable effect via `lint()`'s output — `graph.nodes.has()`'s
removal doesn't fail any test, because TOPO-004's own reporting loop only ever iterates
`graph.nodes.values()`, so a phantom id sitting in the internal `seen` set is never surfaced
either way. The guard stays, as cheap defensive symmetry with the graph-level block and to keep
`seen`'s invariant intact for any future reader of `reachableFrom`'s return value, but this is
recorded plainly rather than claimed as mutation-proven when it measurably is not.)

Two of the 13 originally-regressed tests needed a different resolution, because TOPO-004's
refusal in those two cases turned out to be **correct**, not a symptom of this blind spot:

- `STEP_CAP` (`test/engine.test.ts`) intentionally loops `a <-> b` forever with no route to `done`
  at all, by any mechanism, to let a real non-terminating graph exercise the step cap. `done` was
  genuinely unreachable, not merely unreachable-via-`retry_target`. Fixed by adding
  `a -> done [condition="outcome=fail"]` — dead in this test's own script (`a` never fails, so the
  condition never matches, and the `a <-> b` loop the test verifies is unchanged) but honest: a
  real author writing an intentionally-looping pair like this would plausibly give it a failure
  exit, and a graph whose exit node has no route in by any mechanism isn't one an author would
  ship. `FAIL_RETRY_TARGET_LOOP` had the identical shape (a `failing <-> recover` loop with no
  route to `done`) and got the same treatment: `failing -> done [condition="outcome=success"]`,
  dead because `failing` is scripted to FAIL every time.
- `RUNS_ON_UNRECOGNISED` (`test/engine.test.ts`) is a fixture the file's own pre-existing comment
  already documents as *deliberately* lint-dirty (RUNS-001, not TOPO-004) — its point was to drive
  `engine.run()` directly, bypassing lint on purpose, to observe `runsOn()`'s runtime fallback
  in isolation. FR-11 removes the ground that test stood on: `run()` now refuses any lint-ERROR
  graph before dispatching anything, so a RUNS-001-dirty graph can no longer reach that fallback
  through the public `Engine.run()` API at all — which is exactly FR-11 working as intended, one
  layer up. Converted to a direct unit test of `runsOn()` itself (now living in `dot/graph.ts`
  after Task 3's relocation), asserting the fallback directly rather than through a run that can no
  longer reach it.

Full suite after both the `reachableFrom` fix and the two fixture rewrites: 474 tests, 473 pass, 1
skipped (unrelated, pre-existing `live.test.ts` test), 0 failures. `dist/attractor.js` rebuilt to
match.

Filed as a lint-code-level fix to TOPO-004's existing reachability computation, not a new rule —
the rule's intent (every node must be reachable) is unchanged; only what counts as a route in was
wrong.
