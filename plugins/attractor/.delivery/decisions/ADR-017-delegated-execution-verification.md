# ADR-017: A second, new independent-verification gate — the graph actually runs — on top of amplifier's ported diagnosis-verification gate

**Status:** accepted
**Date:** 2026-08-10
**Deciders:** Solution Architect

## Context

FR-13: *"Every graph the authoring skill hands back as 'ready' is accompanied by a
real execution transcript (`events.jsonl`, terminal `status`/`path`) produced by a
delegated, independent verification step — not the same session that authored the
graph, per `AGENTS.md`'s rule ('verification inside the context that produced the
evidence is not verification') and the ported `attractorify` skill's own
independent-verifier convention."*

That last clause is doing real work and is easy to over-read. Amplifier's
`skills/attractorify/SKILL.md` ("Independent verification" section, confirmed by direct
read against `microsoft/amplifier-bundle-attractor@main`) delegates to a fresh-context
agent that re-derives and checks the **three-question diagnosis** — whether a pipeline
was warranted at all — against the user's session turns. It never runs the resulting
`.dot` graph; there is no execution-transcript concept anywhere in that skill. FR-13
cites this convention as the *precedent for the mechanism* (delegate to a fresh
context with no stake in the artifact), not as a claim that amplifier already does what
FR-13 asks. The two verified claims are genuinely different: "the reasoning to build
this was sound" vs. "this specific graph runs to a real terminal state."

## Decision

Keep both gates, in sequence, both required before a `ready` handback:

1. **Diagnosis-verification** (ported near-verbatim from amplifier, unchanged) —
   Step 1's three-question artifact, independently re-derived and checked before design
   starts.
2. **Execution-verification** (new, this ADR) — after a `.dot` is drafted and passes
   `attractor lint` with no ERROR-severity diagnostic, the authoring session invokes the
   Task tool to launch a fresh-context subagent with exactly one instruction: run
   `verify-run.ts <path> --stub` and report its stdout verbatim. The subagent has no
   memory of the design conversation and no access to why the graph looks the way it
   does — the same isolation property the diagnosis-verifier already has, applied to a
   second artifact. The handback template requires the literal `VERIFIED: status=...
   path=...` line and the `events.jsonl` path to be present, not paraphrased.

`--stub`, not `--live`, is the "ready" bar. `--stub` (the engine's existing
deterministic-backend CLI flag) proves every claim FR-13 actually needs proven —
routing, retries, parallel dispatch, and goal-gate evaluation all resolve to a real
terminal `RunResult` — without spending real `claude -p` budget or introducing
model-output variance into what is supposed to be a deterministic gate. The skill may
additionally offer a `--live` run as an explicit, separately-requested option; the
handback states which one produced the attached transcript (`status=... (stub)` inline,
not only in a linked doc), so nobody reads a `--stub` transcript as a full live proof.

## Alternatives considered

### Treat amplifier's diagnosis-verifier as already satisfying FR-13

**Why it was attractive:** zero new mechanism, ships faster.
**Why rejected outright:** it verifies a different claim. A diagnosis that correctly
concludes "yes, build a pipeline" says nothing about whether the specific graph
subsequently drafted actually reaches a terminal state — the two failure modes are
independent (a well-justified decision to build can still produce a graph with a dead
end or a misrouted edge).

### Run the execution-verification step in the same session that authored the graph, just as a separate step

**Why rejected:** this is exactly the shape `AGENTS.md`'s cited rule forbids — the
judgment that wrote the graph is well-positioned to rationalize why it "should" work
rather than actually confirm it does, the identical reasoning that already justifies
amplifier's own diagnosis-verifier's isolation.

### `--live` as the default verification mode

**Why it was attractive:** the strongest possible proof — these exact prompts, on this
exact engine, produced this exact outcome.
**Why rejected as the default:** cost and nondeterminism on every single authoring
cycle, for a claim (control-plane correctness) that doesn't need a live model to prove.
Kept as an explicit opt-in, not removed.

## Consequences

**We gain:** FR-13's actual claim — a real, engine-produced transcript, from an
independent process — not a documentation-review substitute for it.

**We accept:** two separate delegations per authoring cycle (diagnosis-verify,
execution-verify) instead of one — more Task-tool round-trips than amplifier's own
flow, a deliberate cost for a stronger guarantee this project's own doctrine asks for.

**We will need to revisit this if:** a future engine change makes `--stub` no longer a
faithful proxy for control-plane behavior (e.g. a future feature whose correctness
depends on real model output even for routing) — at that point `--stub`-only
verification would need to become `--live`-required for that feature class specifically,
not a blanket policy change.
