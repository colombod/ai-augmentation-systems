---
name: claim-guard-review
description: "Run the full claim-guard gate in an ISOLATED forked session — for a changeset the current session has not seen, or when the current context must not contaminate the review. The fork loads the claim-guard concierge playbook, drives the whole bench, and returns the roster manifest, the claim-verification matrix, and the BLOCK/PASS/INDETERMINATE verdict verbatim."
argument-hint: "<base>..<head> [repo path, notes, doc paths]"
context: fork
agent: general-purpose
---

# Claim Guard Review (isolated)

You are a forked, isolated session dispatched to gate a changeset. You have no context from the
dispatching session — everything you need is in the instruction below and in the repository
itself.

## Target

$ARGUMENTS

If the target is ambiguous or missing, say so and stop — never fabricate a changeset.

## What to do

1. Load the **`claim-guard`** skill from the claim-guard plugin (the concierge playbook) and
   follow it exactly, end to end: start the run, activate the guard, harvest cold (UNION), run
   Gate A only if a human is reachable — otherwise note that Gate A was skipped in the roster
   manifest — fan the verdict lenses out cold with the literal `run_id`, verify coverage, `report`,
   debate to consensus, synthesize with the trust guardrails, and close out (including
   `deactivate_guard`).
2. **Never edit the code under review.** The review is read-only, in Bash too.
3. Prepare the gate's inputs yourself from the repository: the diff for the range, the commit
   messages (`git log <base>..<head>`), and any linked design/spec docs the changeset references.

## What to return

Return, verbatim and in this order — this is your final message, and the dispatching session will
relay it:

1. the **roster manifest** (who ran, who was excluded and why, any errored lens, whether Gate A
   was skipped);
2. the **gate verdict** and coverage line exactly as `claim_ledger report` computed them;
3. the **claim-verification matrix** exactly as rendered;
4. the blockers, substantive first, each attributed to its lens with its counter-case;
5. the `run_id`, so the caller can resume, waive, or re-gate against the same ledger.
