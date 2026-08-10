# Carry-forward from Plan 1 (engine core)

Items deliberately left open when Plan 1 merged, with the plan that owns each.
Recorded here because the SDD workspace ledger is scratch and gets deleted; this
file is the durable record.

Plan 1 final state: 125 tests, 41 commits, bundle verified standalone.
Final whole-branch review found 1 Critical and 4 Important, all fixed and
re-reviewed clean.

## Status re-checked 2026-08-04, after Plan 3 (spec correction)

Two entries below were stale and are struck in place rather than deleted, so the
record shows what was believed and when it stopped being true.

**The plan numbers in this file were off by one and have been corrected.** It was
written from Plan 1 against a roster in which Plan 3 was human gates; the plan that
actually landed as Plan 3 of 7 was the spec correction, so everything after Plan 2
shifted. The headings below now carry the corrected number *and* the subject, with the
original number noted. Plan 3's own residuals, recorded in `spec-conformance.md` under
"Residuals from Plan 3", name their owners the same way.

---

The headings below now carry the **subject** as well as the number, and the number has
been corrected. An owner recorded only by number silently loses its owner the moment
the sequence shifts — which is what happened here. Name the subject from now on.

Current sequence: 1 engine core, 2 Claude backend, **3 spec correction (landed)**,
**3.5 dataflow failure propagation (landed 2026-08-04, unnumbered in the original
roster — see note)**, 4 human gates and the Discord bridge, 5 parallel execution,
6 visualization, 7 doctrine port and marketplace packaging.

**2026-08-05 correction:** the dataflow-failure-propagation plan
(`plugins/attractor/.superpowers/plans/2026-08-04-attractor-dataflow-failure-propagation.md`) landed
between Plan 3 and Plan 4 and was referenced twice elsewhere in this file by name only,
never inserted into this roster — found by a decay-lens audit pass that checks this
document's own claims for staleness, not by anyone noticing the omission directly. It
closed I1, reclassified I2, and produced RUNS-001/002, DATA-001/002 and GATE-001. Given
"3.5" rather than a renumber, so no later reference to "Plan 4" or beyond needs to shift
again — the same lesson this section already drew from the first numbering mistake.

---

## Must be addressed by a specific later plan

### Plan 2 (Claude Code backend)

- **`Backend.run` now takes `signal?: AbortSignal` and `Outcome` has
  `metrics?: Record<string, number>`.** Both were added in Plan 1's fix wave
  and are currently unused. Plan 2 must actually wire them: the signal to
  cancellation and per-node timeouts, metrics to `total_cost_usd`, `usage` and
  `num_turns` from the `claude -p` result object.
- ~~**`carriesVerdict()` reads the RAW `contextUpdates`, before the `tool.`
  filter.**~~ **CLOSED.** `carriesVerdict` now takes the *allowed* updates and
  judges evidence on those (`plugins/attractor/engine/src/handlers/box.ts:19-31`,
  called at `:120` with the filtered map). Evidence the control plane refused to
  accept is no longer evidence, so a `tool.*`-only payload can no longer satisfy a
  gate. Note the *sibling* hazard this leaves, now filed as residual R2 in
  `spec-conformance.md`: `box.ts:145` still writes the RAW updates into
  `status.json`. Inert until something reads that file back.
- **The engine never merges `Outcome.contextUpdates`** — only `BoxHandler`
  does, while `ToolHandler` writes context directly. The asymmetry is
  documented but not resolved. Centralising the merge in the engine would make
  the `tool.` guard apply uniformly.
- `prompt.md` is now written before dispatch, so a hung subprocess still leaves
  a record of what was asked. Keep that ordering.

### Plan 4 — human gates and the Discord bridge (was numbered Plan 3; that plan did not land)

**RESOLVED 2026-08-06.** Adopted the channels design
(`.superpowers/specs/2026-08-05-human-gate-channels-design.md`) in full for FR-5–FR-8.
This document's own §7 (Human in the loop) and §8 (Operator onboarding) — park + checkpoint,
`attractor approve`/`attractor resume`, the official `discord@claude-plugins-official` channel
plugin + a monitor session — are marked **superseded** in place in
`2026-08-03-attractor-claude-code-plugin-design.md` (not deleted, not ported). Decided by a
multi-lens comparison (persona fit, engineering cost, doctrine alignment, requirement
coverage, extensibility risk; two independent judges; one final synthesis), which converged
5/5: the channels design is the only one of the two with an architectural slot for the user's
two hard, explicit, non-hybrid requirements — arbitrary bespoke/pluggable external channels
(`CommandChannel`) and an opt-in `agent`-proxy channel — that the park/checkpoint design
predates and has no equivalent for. Park/resume's one clean advantage, cross-restart
durability, is not in play: `.delivery/initiatives/spec-conformance-mvp/prd.md`'s Non-Goals/Out-of-scope section already
excludes it this slice, independent of which design won. ADR-002 stands unchanged in content
(addended, not superseded — see its own Addendum section) as the `human` channel's eventual
implementation. `.delivery/initiatives/spec-conformance-mvp/prd.md` Open Questions 1 and 2 are resolved accordingly.

**Carried forward as future/additive work on top of the `Channel` abstraction, not as a
reason to revisit this decision:** `checkpoint.ts`/`loadCheckpoint` (already implemented,
currently unwired — see the bullet below) as the basis for a later `attractor resume`;
the `reminder=` re-notification attribute; §7.6's free-form-input collection for unlabelled
edges; a first-party `CommandChannel` reference script for Discord, prioritized early since
it delivers the same "answer from anywhere" need without depending on Anthropic's
research-preview Channels surface or `bun`. **Required follow-up before the `agent` channel
ships:** close the self-report evidentiary gap in `human.context=` — nothing today restricts
an author from exposing the `agent` channel to evidence written by the very node the gate is
meant to check; needs a lint rule or a documented authoring restriction.

**Comparison table, kept for the historical record of what was weighed:**

| | §7/§8 of this spec (2026-08-03) | The new channels design (2026-08-05) |
|---|---|---|
| While waiting | Engine **parks**: writes `checkpoint.json` + `pending-approval.json`, may exit, costs nothing, resumable across a reboot via `attractor resume <run>` | Process **blocks alive** (`process.stdin.resume()`, ADR-002) if a real TTY; otherwise fails fast immediately — no parking, no cross-restart resume at all |
| Answer delivery | `/attractor approve <run-id> <label>`, a separate CLI invocation, from any session or the raw CLI | A pluggable `Channel` interface (`human`/`agent`/operator `CommandChannel`), read by the same process, no separate approve verb |
| Discord | Anthropic's own official, research-preview `discord@claude-plugins-official` Channels plugin + a live "monitor session" relaying messages; requires `bun` | A generic, dependency-free external-command channel — Discord is just a webhook script satisfying a stdout-line contract, no bun, no official Channels dependency |
| Unattended preflight | Rejects the run if any reachable `hexagon` lacks `on_timeout` (E3) | Rejects the run if any reachable gate's declared channel chain has no viable hop — a related but not identical condition |
| Not present in the other design | `reminder=` re-notification; §7.6 free-form-input collection into context for unlabelled edges | An `agent` channel (an isolated `claude -p` proxy answering on the human's behalf) and timeout-driven channel *escalation chains* — both genuinely new ideas, absent from §7/§8 |

**Resolved as candidate (a):** the new design is the considered evolution; §7/§8 are amended
in place (marked superseded, with the supersession written down the way F9/W1/W4 do it) rather
than kept live or reverted. Candidates (b) (complementary/hybrid) and (c) (revert to §7/§8) are
retired — (b) was explicitly the hybrid the project owner ruled out; (c) loses on every
dimension the comparison scored, including the two hard requirements park/resume has no
answer for.

- **`loadCheckpoint` is implemented but unreachable from the engine or CLI.**
  There is no `resumeFrom` option on `EngineOptions` and no `attractor resume`
  command. This is now future/additive work on top of the `Channel` abstraction
  (see the RESOLVED note above), not a park-model prerequisite — a later
  `attractor resume` would checkpoint at gate-entry and re-enter the channel
  chain, closing NFR-9's residual risk without reviving §7/§8's architecture.
- `RunResult.path` records one entry per *attempt*, not per graph transition,
  so retries appear as repeated entries. `/attractor status` should not print
  it raw as a route summary.
- `completed` includes nodes that finished with FAIL, despite the name.
- **When this plan finally registers `Handler.HUMAN` in `defaultHandlers()`
  (`core/engine.ts`), `dot/graph.ts`'s `UNREGISTERED_HANDLER_KINDS` constant must
  be updated to remove `HUMAN` from it** (see ADR-005's Correction, added by the
  final whole-branch review, for why it is in there today). This is a loud trap,
  not a silent one — the anchor test `test/lint.test.ts`'s
  `'UNREGISTERED_HANDLER_KINDS matches what defaultHandlers() actually
  registers'` and its companion `'HAND-001 fires for Handler.HUMAN too, since
  it is unregistered in this build'` will both fail as soon as `HUMAN` is
  registered and the constant is not also edited — but it is flagged here
  anyway so the failure is expected, not a surprise.

### Plan 5 — parallel execution (was numbered Plan 4)

- The exit-triggered goal-gate retry loop applies no backoff, unlike node-level
  RETRY. Bounded by the step cap today; revisit when concurrency makes the
  loop cheaper to spin.

  **Still open, and it now has a sibling.** Plan 3's C6 made a second instance of the
  same class reachable — a FAIL bouncing to its `retry_target`, with no backoff at all
  because the FAIL never enters the retry machine. Measured: 249 jumps, zero
  `node.retry` events, terminating FAIL at the 500-step cap. Both are filed together
  as **residual R1** in `spec-conformance.md` so one plan owns the whole class. R1 is
  coupled to C11's open half (`internal.retry_count.<node_id>`): both turn on where
  the attempt counter resets.

### Plan 7 — doctrine port and marketplace packaging (was numbered Plan 6)

- **Golden-graph tests are genuinely absent and were nobody's job in Plan 1.**
  The spec's testing strategy calls for each example pipeline to run to a known
  terminal state against a stub backend, and says that is what makes
  `context/engine-semantics.md` truthful. No example pipeline is committed
  anywhere. Every graph the engine has executed is a 4-to-6-node fixture written
  by the test that runs it. The final reviewer noted that committing
  `task-runner.dot` (20 nodes, 30 edges) as a fixture and running it to a known
  terminal state would, on its own, have caught Plan 1's Critical finding.
  **This is a required deliverable of the doctrine-port plan, not optional polish.**

  **Re-verified 2026-08-04 and still exactly accurate.** `find . -name '*.dot'`
  outside `node_modules` returns zero files; no example pipeline is committed
  anywhere; every graph run in Plan 3's tests and in its final verification is still
  an inline fixture. This entry still points at the right plan (the doctrine port and
  packaging, whatever its number ends up being). Filed as **residual R5** in
  `spec-conformance.md` with one added consequence: the Plan 3 Task 8 brief asks for
  "the canonical `task-runner.dot` still lints clean" as a verification step, and
  that file does not exist, so the check could not be run.
- `context/engine-semantics.md` must be written FROM the tests, and must
  document the delta list in the design spec section 12 plus these Plan 1
  additions: `TOPO-006`, `HITL-002`, the `tool.` namespace guard, and
  engine-emitted `node.start`/`node.end` events.

  **The throw-to-RETRY conversion was struck from that list on 2026-08-04 and
  must not be documented as a delta, because it no longer exists.** It was a
  contradiction, not an extension. Spec §4.12's handler contract states
  *"Handler panics/exceptions MUST be caught by the engine and converted to
  FAIL outcomes"*, and §3.5's `CATCH` says the same in code — *"ELSE: RETURN
  Outcome(status=FAIL, failure_reason=str(exception))"*. A MUST is normative
  for something we implement, so the plugin's own rule applies with no
  discretion: contradictions get fixed. The engine now returns FAIL.

  Two consequences worth carrying, both verified by execution rather than
  reasoning:

  - **No `should_retry` predicate**, deliberately, and this is the recorded
    decision rather than an oversight. §3.5 only retries an exception when
    `retry_policy.should_retry(exception)` is true, and §3.6 scopes that to
    *"network errors, rate limit errors (HTTP 429), server errors (HTTP 5xx),
    and provider-reported transient failures"*. **Our backend cannot produce
    one.** `backend/claude.ts` converts its entire transport surface — spawn
    failure, abort, non-zero exit, unparseable output — into a FAIL `Outcome`
    before it can throw: `runProcess` resolves and never rejects, and
    `interpretResult` catches its own throw. So everything reaching the
    engine's catch is a handler bug or a filesystem error, all of which are on
    §3.6's *`false`* list. A predicate matching guessed HTTP shapes would be
    dead code that could only ever fire on a string coincidence. If a future
    backend genuinely throws transient errors, the predicate belongs in
    `core/retry.ts` and must be derived from what that backend throws.
  - **§3.6's five preset policies (`none`/`standard`/`aggressive`/`linear`/
    `patient`) are not implemented**, for the same reachability reason. §2.5's
    graph-attribute table and §2.6's node-attribute table were both read in
    full: neither defines an attribute that selects a policy, so nothing a DOT
    author can write would reach one. The `max_delay_ms` default (60000) and
    `jitter` (default true) from the same section WERE implemented, because
    those apply to every policy the engine actually builds.
- **§3.4 leaves one question open and we answered it.** When the exit is
  reached with *several* unsatisfied goal gates, the spec does not say whose
  `retry_target` is used. We take the **first-visited** unsatisfied gate.
  §3.4's own `check_goal_gates` iterates `node_outcomes` and RETURNS on the
  first gate it finds unsatisfied — it hands the caller exactly one gate, the
  first in traversal order — so this is the reading closest to the pseudocode.
  It is also deterministic (which "any unsatisfied gate" is not) and points at
  the earliest stage that failed to converge, matching the first-failure order
  `RunResult.unresolvedFailures` already promises. Recorded here because a
  reading that lives only in a code comment is not a record; see C1.
- Add to the attractor-expert design-time checklist: an edge condition of the
  form `preferred_label!=x` is never eligible when no label was produced, which
  combined with fail-fast yields a dead pipeline with no diagnostic.
- **Three residuals from the dataflow plan land here**, recorded in full as R6,
  R8 and R10 in `spec-conformance.md`:
  - **Neither** `DATA-001` **nor the runtime input check** sees a `${key}`
    reference that appears only in an edge *condition* — which is finding I1's
    own worked example. Both read `substitutableText`, deliberately, so they
    share the gap along with the agreement. Re-scoped by the whole-branch
    review: the earlier wording here called the runtime check "the guard",
    which was wrong. A design-time checklist entry is the honest interim.
  - `GATE-001` treats the declared gates as one wall rather than checking each
    individually, and does not recognise a `preferred_label` failure route.
    Both under-report, and the first **worsens as gate count grows**. Tuning it
    needs the golden-graph corpus this plan owns.
  - The CLI's unresolved-failure warning says "reached its exit" on a run that
    **halted**. Pre-existing (introduced in `de31ff7`, an ancestor of `main`);
    the dataflow plan made the shape more reachable and deliberately did not
    change CLI output text.
- **One residual from the whole-branch review belongs to the RESUME plan, not
  here**, recorded in full as R12 in `spec-conformance.md`: `checkpoint.ts`
  persists neither `Engine.failedOutputs` nor `Context.written`, so whoever
  implements resume silently loses I1's protection across a restart unless they
  add both. It is a required part of that work, not a follow-up to it.

---

## Known-and-accepted, no owner needed

- `handlerForShape` with an unrecognised shape on a reserved id (`start`,
  `exit`) falls through to CODERGEN. Not specified; no real pipeline hits it.
- `stripSubstitutions` mis-counts `$(( ))` arithmetic depth and can leak a
  stray `)`. No verdict-changing case found; the canonical exemplar lints clean.
- `isPredicateFilter` allows zero letters before `q`, so a hypothetical
  `grep -query` would read as a predicate. Not reachable with real grep options.
- `STATUS_CAPTURE` in lint.ts is dead code as wired: `BARE_SENTINEL` already
  excludes a `rc=$?` statement.
- ~~`normaliseLabel` truncates at the first ` - `, so `"red - retry"` and
  `"red - abort"` collide and the weight/lexical tiebreak silently picks.~~
  **CLOSED** by C9 in Plan 3 (`plugins/attractor/engine/src/core/edge-select.ts:12-17`):
  only an accelerator prefix (`[Y] `, `Y) `, `Y - `) is stripped, and the rest of the
  label is significant. `"red - retry"` and `"red - abort"` no longer collide.
- `retry_target` is overloaded: it answers both "where does an exhausted node
  go" and "where does a blocked exit go".
- `TOPO-004` and `TOPO-006` can both fire on the same dead unreachable node.
  Redundant but not wrong.
- Three test-discrimination gaps survive mutation testing, all peripheral:
  checkpoint atomicity (replacing the whole temp-then-fsync-then-rename body
  with a plain write still passes), the `!=` fail-closed branch, and
  `EventLog.all()`'s break-vs-continue.

---

## Environment facts that bind every plan

- This machine's npm registry is a Microsoft corporate proxy and
  `registry.npmjs.org` is UNREACHABLE. `package-lock.json` is git-ignored
  because a lockfile generated here records internal registry URLs that break
  installs elsewhere. Never run `npm install` expecting the public registry.
- Bun is NOT installed. The Discord channel plugin in the human-gates plan requires it, so
  `attractor doctor` must check for it.
- System Graphviz is present here (15.1.0) but must not be assumed for others;
  The visualization plan bundles WASM Graphviz instead.
- `dist/` is deliberately NOT git-ignored under `plugins/attractor/`.
