---
name: properly-delivered-claim
description: "The three-part definition of a claim that is DELIVERED, not merely asserted — a static correspondence check, an adverse-state executable probe that fails on violation, and that probe committed as a standing regression test — plus the reframed 'done': a safety claim without an adverse-state test is not done. Use when deciding whether a claim passes the gate, or what a claim still needs to clear it."
---

# The Properly Delivered Claim

An *asserted* claim is a sentence. A *delivered* claim is a sentence backed by evidence that would
go red if the sentence became false. The gate exists to tell the two apart. This is the standard
the whole system enforces.

## The three parts (all required for a safety/integrity claim)

1. **(static) A code-level correspondence check.** The load-bearing code exists and matches the
   claim, cited to `file:line`. This is what the `correspondence-auditor` and `chokepoint-mapper`
   produce. Necessary — but for a safety claim, **not sufficient**: code that looks right can still
   fail in the adverse state.
2. **(dynamic) An adverse-state executable probe that FAILS on violation.** A test that runs in the
   condition the claim exists to survive (see the `adverse-state-catalog` skill) and goes RED when
   the forbidden violation occurs — not when the process merely dies. This is what the
   `test-correspondence-auditor` demands the existence of.
3. **(durable) That probe committed as a standing regression test.** A one-shot experiment that is
   thrown away protects nothing. The surviving probe becomes a permanent guardian.

## The reframed "done" (the single rule)

> **A safety claim without an adverse-state test is not done.**

Enforced, that one rule would have blocked every blocker in the incident that motivated this
system. It is the gate's second limb: even when the code CONFIRMS, a safety claim with
`adverse_state_test.exists = false` **BLOCKs**.

## Why static alone is insufficient for some claim types

Some claims are only falsifiable empirically — static reading accepts wrong answers:

- **quantitative** — "stays under 25K tokens" (a real investigation corrected ~23–26K to ~36–39K, a
  50% miss that reading accepted).
- **timing / concurrency** — retry-then-succeed races; cross-replica last-write-wins.
- **temporal** — self-clear after out-of-band repair; a single snapshot can't catch a latch.
- **emergent / integration** — composition effects at boundaries.

For these, the correct static verdict is often **UNTESTABLE** (static cannot settle it) — and if it
is a safety claim, it still trips the gate. The `empirical-verifier` lens can settle some of them
by actually executing; the rest need a human call, recorded as a waiver in the open.

## Probe graduation criteria (what "durable" means)

A surviving adverse-state probe becomes a proposed standing test only if all three hold:

1. it **fails on the pre-change code** and **passes on the post-change code** — both demonstrated;
2. it runs **deterministically 3× consecutively**;
3. it asserts the **property** the claim forbids violating, not the repro's incidental values.

A probe that cannot show red-before/green-after is not evidence — report it as a one-shot finding,
and leave the claim's `adverse_state_test` empty (so a safety claim still BLOCKs). This is how the
gate stays honest about over-fit or flaky probes.

## The recursive lesson

A gate that manufactures confidence is worse than none — "we verified it" is worse than "we didn't"
if the verification was hollow. So: coverage is always visible (harvested / verified / deferred /
waived), incomplete runs report **INDETERMINATE** not PASS, and a downgrade is always a **human's**
recorded waiver, never the agent's quiet decision.
