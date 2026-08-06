# Dataflow failure propagation — design

**Status:** IMPLEMENTED and merged as `feat/attractor-dataflow`. **Informative, not
authoritative — the code is the truth.** Three corrections made during implementation are
marked inline below, each found by an implementer reading the handlers instead of
transcribing this document; a fourth change is not marked inline and is the most
important one for a reader of section 1: **only DECLARED `outputs=` keys enter the
failed-output ledger. Nothing is inferred, not even the tool handler's
`tool.last_line`** — inferring it made every failure-reporting node unreachable and
contradicted the stale-label doctrine. Inference survives only as DATA-001's notion of
what a graph supplies. See finding I1 in `plugins/attractor/.superpowers/spec-conformance.md` for the
settled account.
**Closes:** I1 (closed; the protection is opt-in via `outputs=`), and reclassifies I2 as
a graph-shape hazard caught by GATE-001 rather than an engine defect
**Grounded on:** `plugins/attractor/.superpowers/spec-conformance.md`, `strongdm/attractor` `attractor-spec.md`,
and `microsoft/amplifier-bundle-attractor` `docs/designs/r12-node-failure-propagation.md`

---

## The problem

Two interaction defects are recorded OPEN in the conformance audit.

**I1.** A node fails. A later node's edge carries `condition="context.k!=bad"`, where `k` is a
key the failed node was supposed to write. Under §10.3 a missing key compares as the empty
string, so the guard is *vacuously true*, the edge is eligible, and the run walks past the
failure into a node whose inputs do not exist. Nothing is wrong with §10.3 — the defect is
that **a node has no way to say what it produces, and therefore no way for a successor to
know its inputs are missing rather than merely empty.**

**I2.** A goal gate sits on a branch a failure route bypasses. It is never visited, so §3.4's
visited-scoped check is legitimately empty and the pipeline exits SUCCESS.

Amplifier hit the same class and wrote R12. Their framing is the right one:

> the engine has no contract for how a node's outputs flow to its successors

## What we take from R12, and what we must not

R12 proposes five mechanisms. Read against the spec, they do not all survive.

| R12 mechanism | Verdict | Why |
|---|---|---|
| M1 `outputs=` declared outputs | **Port** | §2 design goals: "extensible through custom attributes". A custom node attribute is sanctioned. |
| M2 eager reference scan | **Port** | Pure engine behaviour, nothing in the spec forbids it. |
| M3 SKIPPED propagation | **REJECT — contradicts §5.2** | See below. |
| M4 `runs_on={always\|success\|failure}` | **Port** | Custom attribute. Needed so cleanup nodes still run. |
| M5 unified substitution policy | **Already done** | Our `$name` substitution is already single-pass and uniform across handlers. |

### Why M3 is rejected

§5.2's status table is unambiguous:

> `SKIPPED` — Stage was skipped (e.g., condition not met). **Proceed without recording an
> outcome.**

R12's M3 says the opposite:

> Edge selection treats SKIPPED like FAIL for routing... **A SKIPPED node never traverses
> unconditional edges silently** — if no skip-/fail-aware edge matches, the engine emits
> `PIPELINE_STAGE_FAILED` and halts the linear path.

"Proceed" and "halts the linear path" cannot both be true of the same status. Porting M3
would reintroduce exactly the class of defect the spec-correction plan existed to remove.
Amplifier is free to make that choice — they are not claiming to be a strict superset. We
are.

**We use `FAIL` instead, and it is better.** A node that cannot obtain a declared input has
not been "skipped for lack of relevance"; it has failed, for a precise and reportable
reason. `FAIL` is spec-defined, routes through §3.7's ladder unchanged, and composes with
our existing fail-fast doctrine — so a node with unavailable inputs and no explicit failure
edge halts the run, which is the behaviour I1 needs. No new status, no new routing rule, no
divergence.

---

## Design

### 1. `outputs=` (node attribute, extension)

A node may declare the context keys it is contracted to produce:

```
build [type="tool", tool_command="make", outputs="artifact.path,artifact.sha"]
```

Handlers that already write known keys contribute an **inferred** set. The effective set is
`inferred ∪ declared`. R12's reasoning for the hybrid holds: pure inference embeds handler
knowledge in the engine and breaks for context-driven keys; pure declaration burdens every
author for the common case.

**Correction, made during implementation.** This section originally claimed the tool handler
contributes `tool.output`, `tool.last_line` and `tool.exit_code`. It contributes exactly one
key, `tool.last_line` — verified against `handlers/tool.ts`, the git history, and §4.10's own
pseudocode. The implementer checked rather than transcribing, which is the correct handling
of a brief: the brief is the least-trusted artifact in the room. The inferred set must be
read from the handler, never retyped, precisely so this class of error cannot survive.

### 2. Failed-output ledger (engine, internal)

The engine already maintains `nodeFailures` for `unresolvedFailures`. It gains a derived
map `failedOutputs: key -> producing node id`, populated when a node ends FAIL or is
abandoned to a `retry_target` after exhausting retries. A key is **cleared** when the same
node later re-executes to SUCCESS or PARTIAL — the same clearing rule `unresolvedFailures`
already uses, so a repair loop leaves both empty.

This is a record, not routing state, and it must never become readable from a condition.

**Correction, made during implementation.** This section originally said "the
`isEngineManagedKey` guard already covers the namespace". It does not. The ledger's keys are
author-chosen `outputs=` names living in the author namespace, which is *deliberately*
unreserved — reserving it would take `goal` and every graph attribute away from the people
writing graphs. The guard protects the engine's own key set and has nothing to say about
these.

The protection that actually applies is stronger than the one claimed: **the ledger never
enters `Context` at all.** It is a private field on `Engine`, like `nodeFailures`. A key that
is never written cannot be read, forged, or routed on, and that holds without depending on
any namespace rule. The implementer demonstrated it rather than asserting it — a fixture
whose only route to a `forged` node is `condition="context.artifact.path=build"`, using the
ledger's own key and value, takes the author's real failure edge instead.

### 3. Eager input check (engine)

Before invoking a handler, the engine extracts `${key}` / `$key` tokens from the
substitutable attributes and intersects them with `failedOutputs`.

**Correction, made during implementation.** This section originally named the substitutable
attributes as `prompt`, `tool_command`, `tool_env` and `description`. That list was wrong
twice over and incomplete once: **`tool_env` and `description` exist nowhere in the engine**,
and it omitted **`label`**, which a box node with no `prompt` genuinely substitutes. The real
set, read from the handlers, is `prompt || label` for codergen and `tool_command` for tool —
a fallback chain a flat attribute list cannot express, and one that has to key off the
*resolved* handler to survive §2.6's type-over-shape precedence. It is now a single exported
`SUBSTITUTABLE_ATTRS` / `substitutableText()` that both the engine and the DATA-001 lint
consume, because the lint had independently derived its own copy and the two would have
drifted.

Third correction in this document found the same way: by an implementer reading the code
instead of the design.

On a non-empty intersection the engine does **not** invoke the handler and returns:

```
Outcome(status=FAIL,
        failureReason="required input 'artifact.path' unavailable: node 'build' failed")
```

The node's own declared outputs then enter `failedOutputs`, keyed to *this* node, so
propagation is transitive. Routing proceeds through §3.7 exactly as for any other FAIL,
and fail-fast applies.

This is the whole of I1's fix: the run stops at the first node whose inputs are missing,
naming the key and the node that owed it.

### 4. `runs_on={always|success|failure}` (node attribute, extension)

Default `success` — current behaviour, the check in (3) applies.

- `failure` — the node runs only if one of its referenced producers failed. References
  resolve to the empty string.
- `always` — the node runs regardless. References resolve to the empty string.

Separate from any "ignore my own failure" knob, for R12's reason: conflating them makes
cleanup nodes silence their own genuine failures.

```
work    [outputs="resource.handle"]
cleanup [tool_command="release ${resource.handle}", runs_on=always]
```

### 5. `DATA-001` lint (static, WARNING)

A `${key}` reference that **no** node declares in `outputs=`, that is not an engine built-in
(`goal`, `graph.*`, `outcome`, `preferred_label`, `current_node`, `tool.*`), and that is not
supplied by `--param`, is almost certainly a typo or a missing declaration.

**WARNING, not ERROR**, and the reason matters: `--param` values arrive at runtime and the
linter cannot see them, so an ERROR would refuse legitimate graphs. This is the CMD-001
lesson — an ERROR rule that false-positives makes a real pipeline unrunnable. The runtime
check in (3) is the load-bearing guard; DATA-001 is the design-time hint.

### 6. `GATE-001` lint (static, WARNING) — this is I2's real fix

I2 is not an engine defect. §3.4 scopes goal gates to *visited* nodes, so a gate on a
bypassed branch is legitimately unchecked, and §11.3 then reports SUCCESS. The engine is
behaving exactly as specified.

The defect is **authorial**: a graph where a failure route can reach the exit without
passing through a declared goal gate has a gate that does not gate. That is statically
detectable — a reachability question over the failure edges and `retry_target` jumps — and
it belongs in lint, where it can be reported before the pipeline ever runs.

Recording I2 as an engine defect was a category error. It is a graph-shape hazard.

---

## What this does not do

- It does not change the run verdict. §11.3 decides that, and it is not ours to redefine.
  A run that halts at a failed input reports FAIL because a node failed and no route was
  found (§3.7 step 4) — through the spec's own mechanism, not a rule layered on top.
- It does not add a status value.
- It does not make `SKIPPED` reachable from the engine. `SKIPPED` remains what §5.2 says it
  is, and stays unused by our handlers until something genuinely needs "proceed without
  recording an outcome".

## Testing

Golden-graph tests are a required deliverable of the packaging plan and are still absent.
This design's runtime behaviour is the strongest argument yet for them: the I1 shape is a
four-node graph whose defect no unit test caught for two plans. Each new mechanism gets an
engine-level test through a real `Engine.run()`, and the I1 and I2 fixtures — currently
asserting known-open conformant SUCCESS — are rewritten to assert the halt and the lint
diagnostic respectively.

## Open questions for the plan — both answered

1. Should `outputs=` be validated against what a handler actually wrote, reporting a node
   that declared an output it did not produce? Tempting, and it is a real contract
   violation — but it is a second mechanism and may belong in its own change.

   **Answered: out of scope, deliberately, and unassigned.** It is a post-execution
   contract check with its own undecided question (FAIL the node? warn? the first is a
   routing change), and I1 closed without it. Recorded as residual R11 in
   `spec-conformance.md`, as a question rather than a task, because filing it against a
   plan would imply it had been decided.

2. Does the inferred set for the codergen (box) handler include anything? A model's
   `contextUpdates` keys are arbitrary and filtered by the engine-managed guard, so the
   honest inferred set is empty. That makes `outputs=` mandatory for a box node whose
   output anything depends on — worth stating loudly in the authoring guide.

   **Answered: empty, and the same turned out to be true of the tool handler for the
   ledger's purposes.** Inference is not evidence that anyone promised anything;
   `outputs=` is a node declaring a contract. So the ledger takes declared keys only, and
   `outputs=` is the *only* way a node joins the dataflow contract. It is stated loudly
   in `plugins/attractor/README.md`, in DATA-001's own message, and in finding I1.

## Two lint rules the plan added that this document did not name

- **`RUNS-001` (ERROR)** — an unrecognised `runs_on` value. `runsOn` degrades it to
  `success`, which silently re-arms the eager input check on a node written to run after
  a failure. ERROR follows TYPE-001 and HITL-002 rather than DATA-001: DATA-001 softens
  to WARNING only because `--param` supplies keys lint cannot see, and the `runs_on`
  value set is closed and fully known at lint time.
- **`RUNS-002` (WARNING)** — a `goal_gate` node with `runs_on=failure`. The engine
  already resolves the contradiction fail-closed by running the gate anyway, so the
  attribute is inert rather than dangerous; a separate code from RUNS-001 because one
  code must carry one severity.
