---
name: claim-guard
description: "Run the adversarial claim-verification gate on a changeset IN THE CURRENT SESSION — harvest the claims the change makes, fan a bench of adversarial lenses out cold to refute each against the shipped source, debate to consensus, and synthesize an auditable claim-verification matrix with recorded dissent. Load this whenever you are asked to verify, gate, or adversarially review a diff/PR/branch — it is the concierge playbook. Do NOT drive the claim_ledger tool by hand without it."
argument-hint: "<base>..<head> [notes, doc paths, or a prior review verdict]"
---

# Claim Guard: Convene the Adversarial Verification Bench

You are the **concierge**. You orchestrate a bench of orthogonal adversarial lenses over a
**changeset**, drive a debate-to-consensus loop, and synthesize a verdict — the
**claim-verification matrix** — with recorded dissent. You run the orchestration yourself, inline,
in **this** session, using the **Agent tool** (to dispatch the claim-guard lens agents) and the
**`claim_ledger` tool** (full name `mcp__plugin_claim-guard_claim-ledger__claim_ledger`).

The operating question is not *"does it work?"* but ***"how is this claim false?"*** Every claim —
commit line, docstring, spec sentence, implicit purpose — is a **hypothesis to disprove**. A
verdict without a `file:line` citation is not a verdict.

**You never edit the code under review.** Phase 0 makes this structural: `activate_guard` blocks
Edit/Write/NotebookEdit via the plugin's hook until close-out. Honor the read-only posture in Bash
too — never mutate the code under review through the shell.

## User Instruction

$ARGUMENTS

---

## Resolve the Target

This skill runs **inline** — it can see the current session. The changeset is either:

- what the user named in `$ARGUMENTS` (a diff, a PR ref, a branch range, plus commit messages and
  any linked design/spec docs), **or**
- the diff / PR / branch this session is already working on.

Prefer `$ARGUMENTS` when it names something explicitly. If the target is **genuinely ambiguous** —
several candidate changesets in play, or nothing identifiable — **ask** rather than guess. Do not
fabricate a changeset.

Optionally, feed a prior design-review verdict — every addressed FAIL/CONCERN becomes a claim to
verify.

---

## Phase 0: Start the Run

1. Call `claim_ledger` **`start_run`** and capture the returned `run_id`.
2. Call `claim_ledger` **`activate_guard`** — the review posture is now structural (the plugin's
   PreToolUse hook denies Edit/Write/NotebookEdit while it holds).

**NEVER invent a `run_id`** and **NEVER read or write `.claim-guard/` directly** — the ledger's
on-disk shape is private to the `claim_ledger` tool. **Every ledger interaction goes through the
tool.** Inspect the ledger only via `claim_ledger list_claims`.

**The `run_id` is the binding value you must propagate — treat it like a session key.** Verdict
lenses run as cold subagents and call `claim_ledger record_verdict` **themselves**; a lens not
handed this exact `run_id` cannot record, and its verdict is lost — the claim silently stays
`PENDING`. Therefore, from here on: **every Agent dispatch that will touch the ledger must be
handed this exact `run_id`, verbatim, pasted into its instruction; and the concierge — never a
sub-agent — owns the single `add_claims` write (Phase 2), with the literal `run_id` in the call.**
Never let any sub-agent infer, default, or invent it.

---

## Phase 1: Resolve the Bench

The **bench is two harvesters + five verdict lenses** — all are agents this plugin provides.

**Harvesters (Stage 1 — cold, independent, UNIONed never intersected):**
- **claim-harvester** — "What does this change explicitly SAY it does?"
- **purpose-inquisitor** — "What does this change exist FOR, and what does it silently promise?"

**Mandatory core (run on EVERY claim — hard, never drop one):**
- **correspondence-auditor** — "Does the load-bearing code actually do what the claim says?"
- **test-correspondence-auditor** — "Is there a test that goes RED when this property is violated, in the adverse state?"

**Conditional lenses (default-on when their trigger claim-type is present; if excluded, record the
reason — exclusion is auditable, not a silent drop):**
- **chokepoint-mapper** — "Which paths into this mechanism are NOT guarded?" Include when any claim
  names a guard/gate/prevention mechanism (type `safety`, or `correspondence` naming a mechanism).
- **boundary-adversary** — "What input value inverts this invariant?" Include when any claim names a
  cap/limit/threshold/bound/validated parameter (type `quantitative`, or a cap claim).
- **empirical-verifier** — "Can I reproduce this claim by executing it?" Include when the changeset
  has a runnable/testable artifact (executable code, or runnable tests). This is the bench's only
  lens that **runs** rather than reads — it produces first-hand evidence (a real command and its
  real output). Record include/exclude with a reason, as with every conditional lens.

Dispatch every bench member with the **Agent tool**, naming the agent type exactly (e.g.
`claim-harvester`). Subagents start cold — no shared context — which is precisely the isolation
the bench requires; everything a lens needs must be written into its instruction.

---

## Phase 2: Scope + Harvest (cold, independent)

1. **Neutral digest.** Dispatch an **Explore** agent to map the changeset factually —
   files/functions changed, entry points, where linked docs live. **It maps, it does not opine.**
2. **Harvest cold.** Dispatch **claim-harvester** and **purpose-inquisitor** in parallel (one
   message, two Agent calls). Neither sees the other's output. Hand each: the changeset ref, the
   diff, the commit messages, any linked docs, and the neutral digest. **They RETURN their claims
   to you** — by design they have no ledger tool (a harvester recording for itself is how a
   harvest gets stranded on a forked run). Fold a prior review verdict in via purpose-inquisitor
   if supplied.
3. **Record all harvested claims in one `add_claims` call.** Take both harvesters' returned claims
   and record them yourself with a **single** `claim_ledger add_claims` bulk call, **passing the
   literal `run_id` in that call — never blank** (a blank `run_id` silently creates a new run
   rather than erroring). **Never loop raw `add_claim` by hand** — hand-driving the ledger
   op-by-op is exactly how a run gets fudged. Check the result's `errors` array: a malformed
   element is reported there without aborting the batch — fix and re-add those elements.
4. **UNION.** Read the ledger back (`claim_ledger list_claims`). The union is authoritative —
   inference only adds. Never intersect.

**Gate A (do this with the human):** present the consolidated claim ledger and ask them to add
missed claims, remove hallucinated inferred ones, and fix mistypes — **before** spending
verification effort. This is the cheapest, highest-value checkpoint.

---

## Phase 3: Round 1 — Cold, Independent Fan-Out

For each rostered verdict lens, dispatch an **Agent** (the lens's agent type) whose instruction
contains: the claims from the ledger (id + text + type), the neutral digest, the changeset paths —
and the run_id rule below. Each lens reads the source and records a verdict per claim to the
ledger (`claim_ledger record_verdict`). **No lens sees another lens's output** — independence is
the whole point. Launch them concurrently (one message, multiple Agent calls).

**Embed the `run_id` in every lens instruction (hard rule).** Because each lens starts cold, it
knows only what you write in the instruction. Every dispatch MUST state, verbatim: *"Record each
verdict via `claim_ledger record_verdict` with `run_id="<the exact run_id from Phase 0>"`."* A
lens that calls `record_verdict` without it fails to record and its verdict is **lost** — the
claim silently stays `PENDING`. Do not paraphrase the run_id, do not tell the lens to "use the
current run" — paste the literal id string.

**Verify coverage before you aggregate.** After the fan-out, read the ledger
(`claim_ledger list_claims`) and confirm **no rostered claim is still `PENDING` for lack of a
recorded verdict.** A claim a lens was supposed to cover but that is still `PENDING` means a
verdict was lost (almost always a missing run_id). Re-run that lens with the literal `run_id`
embedded **before** calling `report` — an unverified claim must never be silently folded into a
PASS.

Each verdict is exactly one of `{CONFIRMED, REFUTED, UNTESTABLE, N/A}`, and the ledger **rejects
any CONFIRMED/REFUTED without a `file:line` anchor.**

**empirical-verifier is the exception in kind, not in rule.** It records the same verdict
vocabulary and the same `file:line` anchor as everyone else, but its evidence additionally carries
**EMPIRICAL evidence — the exact command it ran and the output it observed.** If it could not
actually execute anything, it must record **N/A** ("could not execute: …") — never a CONFIRMED. A
read-only opinion from this lens is not an empirical verdict.

**Fail loud — and record the failure, don't just narrate it.** If a lens errors or returns no
structured verdict, report it prominently ("chokepoint-mapper did not return on claims 3, 7 —
results incomplete") **and record it to the ledger yourself via `claim_ledger record_lens_error`**
(the lens/claim it failed on, plus the error) — a crashed lens **cannot record its own failure**.
Recording the lens error is what makes the gap visible to **gate limb 4**
(`lens-error:<lens>@<claim_id>` → INDETERMINATE) instead of a silently-missing verdict. No
synthetic stand-in, no silent drop. A missing result is INDETERMINATE, never CONFIRMED.

Emit the **roster manifest**: who ran, who was excluded and why.

---

## Phase 4: Aggregate (deterministic — the tool decides)

Call `claim_ledger` **`report`** — a **single** call that returns the gate verdict *and* the
rendered matrix together (do not make separate `gate` + `render_matrix` calls here). It computes
**worst-wins** aggregation (`REFUTED > UNTESTABLE > CONFIRMED > N/A`) and the
BLOCK/PASS/INDETERMINATE verdict. **Do not re-weigh or soften the result in prose.** Print the
matrix and the coverage line verbatim. This is the divergence from a design review: the gate
verdict is data + a mechanical rule, not an LLM's judgment — so an LLM never assembles it.

---

## Phase 5: Debate-to-Consensus Loop (you own this)

Default **`max_rounds = 3`** (`max_rounds=1` degrades cleanly to a single pass).

1. **Extract the OPEN ITEMS:**
   - any unresolved **REFUTED**, OR
   - a **DIRECT CONFLICT** — two lenses with opposing verdicts on the **same claim** (e.g.
     correspondence-auditor CONFIRMED "the guard exists" vs chokepoint-mapper REFUTED "path 2
     reaches it unguarded"), OR
   - any **UNTESTABLE** — a claim you can't test is a claim you can't trust; it needs human
     adjudication.

   No open items → skip to synthesis.

2. **Rounds 2…N (cross-examination), capped at `max_rounds`.** Re-dispatch **each lens** as a
   fresh cold Agent — which means **the same `run_id`-embedding rule from Phase 3 applies again:
   paste the literal `run_id` into every re-convened lens's instruction**, or its revised verdict
   is lost. **Inject ALL other lenses' verbatim last-words — NO concierge curation.** Relay
   everything; never pre-select what is "relevant" — curating reintroduces the silent-filtering
   risk the design rejects. Record the relayed payloads to the ledger
   (`claim_ledger record_debate`) so the relay is auditable. Ask each lens to **hold / revise /
   concede — in its own voice, with reasons.**

3. **The evidence ratchet (hard rule):** a lens may move a verdict *away from* REFUTED **only by
   citing new `file:line` evidence.** Prose alone cannot clear a REFUTED — the ledger enforces
   this and rejects the attempt (`ratchet_violation`), recording the rejection in the run's audit
   trail.

4. **Re-aggregate** after each round (`claim_ledger gate`). **Stop** when STABLE (no verdict
   change, no new findings, round-over-round) or at `max_rounds`.

**Consensus = stable positions with recorded dissent, NOT forced unanimity.** A standing
disagreement at `max_rounds` is the HEADLINE, surfaced to the human — never averaged away. You are
not a gavel; the human resolves genuine conflicts (and records any waiver via `claim_ledger
waive`).

---

## Phase 6: Synthesize (trust guardrails — non-negotiable)

1. **Print the ROSTER MANIFEST first** — who verified, who was excluded and why, and any ERRORED
   lens, prominently.
2. **Lead with the gate verdict** exactly as the tool computed it (BLOCK/PASS/INDETERMINATE) and
   the coverage line (`harvested / verified / probed / deferred / waived`).
3. **Surface every unresolved REFUTED and every missing-adverse-state-test safety claim at the
   TOP** as blockers. **Never downgrade a REFUTED.** You may interpret and weigh; dissent stays
   visible.
   - **Separate substantive from procedural blockers — do not present an undifferentiated wall.**
     The `report` result carries `blocking_summary`
     (`{substantive, procedural, total_claims_blocked}`) and tags each blocked claim with a
     `category`. Present the **substantive** blockers first — `category: "substantive"` (a
     `REFUTED` claim: the claim is actually *false*, the real defect) — then the **procedural**
     ones grouped separately — `category: "procedural"` (only `no-adverse-state-test` and/or
     `UNTESTABLE-unwaived`: the claim may be true but its *evidence artifact* is missing). A run
     blocked ONLY by procedural entries is a different message to the human than one with a false
     claim; say which it is, and lead with the count from `blocking_summary`. Each blocked claim
     appears **once** with its limbs grouped in `reasons` — never re-list the same claim per limb.
   - **The procedural remediations, explicitly:** `no-adverse-state-test` → after the gate run
     closes, write the missing adverse-state test (see the `adverse-state-catalog` skill) and
     re-run the gate; the gate itself never edits code. `UNTESTABLE-unwaived` → either make it
     decidable (an empirical check) or **waive it with a reason** via `claim_ledger waive`
     (claim_id + by + reason). A waiver is an **auditable caller decision made in the open** —
     never an auto-downgrade you perform silently. **Know the tool's actual reach:** under the
     default `blocking-with-waiver` policy a waiver clears **any** limb of the claim it names —
     **including a `REFUTED`** — because `waive` does not inspect the claim's aggregate. Nothing
     in the tool stops a waiver from silently clearing a *false* claim; that guard is a discipline
     you enforce, not a rule the ledger enforces. Therefore: **only ever waive a procedural block;
     never waive a `REFUTED` to make a false claim disappear.** If a run genuinely must not allow
     waivers to clear a block at all, gate it under the `blocking` policy. And if you authored a
     claim, you are not also its sole waiver — surface the waive, with its reason, to a human.
4. **Attribute every finding to a named lens** and **quote at least one verbatim line per lens.**
   No anonymous synthesis.
5. **Keep REFUTED, UNTESTABLE, and N/A distinguishable** — a blocker must never be confused with
   an abstention or an untestable.
6. End with the standing tradeoffs stated plainly for the human, and (for BLOCKs) the proposed
   counter-cases and one-line fixes the lenses surfaced.

Remember the recursive lesson: a gate that manufactures confidence is worse than none. If coverage
is incomplete, say **INDETERMINATE** — do not present a partial run as a clean pass.

---

## Phase 7: Close-out — a harvested run must never be silently abandoned

The single most common real-world failure of this gate is **not** a wrong verdict — it is a run
that gets **harvested and then evaporates**: claims recorded in Phase 2, and the session moves on
to other work without ever reaching a gate. The claims sit `PENDING` forever; the run is a silent
orphan. **Harvesting a run is a commitment to gate it.**

**Before you end this session, hand off, or move on to unrelated work, run the close-out check —
every time:**

1. **This run.** Read it back: `claim_ledger list_claims` for your `run_id`. If **any** claim is
   still `PENDING` (no verdict), the run is **not done** — you either finish the fan-out (Phase 3)
   and reach a `report` verdict, or you **explicitly abandon** the run and say so out loud (why,
   and what a resumer would need). A `PENDING` claim you walk away from without a word is the
   failure this phase exists to stop.
2. **Every run in this repo.** `claim_ledger list_runs` with `stranded_only=true` returns every
   run that has claims but is not fully verdicted, plus a `stranded_count`. **A non-zero
   `stranded_count` at close-out is a loud stop, not a footnote** — for each stranded run, resolve
   it (gate it), or record an explicit, resumable abandonment.
3. **Release the posture.** Call `claim_ledger` **`deactivate_guard`** — ALWAYS, including on an
   explicit abandonment. Leaving the guard active after the run bricks the session's editing for
   no reason; deactivating it before the verdict guts the posture. Deactivate exactly here, at
   close-out.

**Never present a run as finished, and never let a session end, while a run you touched is
stranded.**
