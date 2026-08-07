# ADR-002: Chief of staff is a real subagent consulted directly, plus a shared pointer

**Status:** proposed
**Date:** 2026-08-07
**Deciders:** solution-architect, with product-owner sign-off pending
**Word count:** ~720 prose-only, past the template's 600-word cap. Declared, not silent — this
is the epic's single most consequential decision, with two full alternatives and three
consequence categories; trimmed twice already, further cuts would remove alternatives content
the template itself protects.

## Context

`prd.md`'s Open Question 8 asks whether chief of staff (S-5–S-8) is a subagent other agents
call, a shared convention document, or something else. The epic's own stated boundary: `harden-02`
already proved `PostToolUse`/`PostToolUseFailure` fire only after a tool call resolves — no
hook can force consultation. Every "routes/bounces/redirects" verb in the epic is *by
convention* only.

A shared convention document is this plugin's existing pattern for standing instructions —
every agent file already carries an identical "## Language" section
(`agents/business-analyst.md:47`, `agents/solution-architect.md:45`, and 8 others). But
`brief.md`'s Finding A is the reason this epic exists: "every mechanism in this pipeline is a
convention an agent can narrate past... it did, repeatedly." A prose-only instruction reasoned
through inline, inside the consulting agent's own turn, leaves no trace distinguishable from
having skipped it — the failure this epic exists to reduce, reproduced one level up.

A real fact changes the calculus: `hooks/hooks.json`'s matcher already includes `Agent`
(alongside `Skill`), and `hooks/scripts/record-invocation.js` already extracts
`subagent_type` as `invoked_name` for any `Agent` tool call (`isGovernedToolCall`,
`record-invocation.js:134,140`) — live-verified 21/21 real sessions (`harden-05`), shipped
infrastructure, not a proposal.

## Decision

Chief of staff is a real subagent, `agents/chief-of-staff.md`, invoked directly via the Agent
tool (`subagent_type: "delivery:chief-of-staff"`) by whichever consulting agent forms a
candidate question — no skill layer in between. A thin skill wrapper,
`skills/chief-of-staff/SKILL.md`, is the operator-facing entry point for S-8's pull-based
briefing, mirroring `/delivery:status`/`/delivery:challenge`. Every consulting agent's persona
file gets a short new section, in the same location as its existing "## Language" section,
stating the trigger condition, the exact call to make, and the `FR-48` fallback — never the
triage logic itself, which lives once, in the chief-of-staff agent.

## Alternatives considered

### A — A pure shared-convention document, no new subagent

**Why it was attractive:** zero new mechanism; matches the existing "## Language" pattern; no
new file to register.
**Why rejected:** the same failure Finding A diagnosed, built into the epic meant to reduce it.
Reasoning through S-5/S-6/S-7 inline produces no real tool call and no ledger entry — "I
checked" and "I skipped it" are textually indistinguishable after the fact. It forfeits the one
thing this harness gives for free: ledger-verified evidence of a real consultation.

### B — A subagent reachable only through a wrapping skill (no direct agent-to-agent call)

**Why it was attractive:** one uniform entry point for every consultation, push and pull alike.
**Why rejected:** doesn't match this plugin's division of labor — skills are operator-facing
entry points; agents already delegate to agents directly via the Agent tool from inside a
running skill (`skills/architecture/SKILL.md`'s own "delegate to `delivery:solution-architect`
via the Agent tool"). An extra skill hop for a mid-task push adds structure with no added
observability — both paths are Agent-tool calls the ledger sees identically.

## Consequences

**We gain:** every real consultation is automatically ledger-visible with zero change to
`hooks/hooks.json` or `hooks/scripts/record-invocation.js`. A skipped or
narrated-without-invocation consultation becomes checkable the same way Finding A's own
skipped `/delivery:prd` calls became checkable — even though nothing prevents the skip itself.

**We accept:** 9 existing agent files each need a small, consistent addition — a real
coordination cost, mitigated only by the fact the "## Language" section already proves this
pattern survives across 10 files without drifting. `agents/persona-simulator.md` is
deliberately excluded — it role-plays an end user, not a pipeline worker. The mechanism still
cannot force compliance; Spike CoS-1 (`architecture.md`) checks whether real consultation
happens often enough to justify the cost, the same role Spike 1 played for `ADR-001`.

**We will need to revisit this if:** Spike CoS-1 finds a real-consultation rate that does not
meaningfully exceed the narrated-without-invocation rate — a real subagent plus a pointer
would then be changing nothing over a pure document. **Stated plainly, per feature-critic
finding 4: Alternative B is not a fallback for this case.** It was rejected above precisely
because "both paths are Agent-tool calls the ledger sees identically" — B would fail CoS-1's
bar for the same reason A would, since neither adds anything this harness can use to force or
meaningfully bias the call. A bad CoS-1 result therefore has no described stronger alternative
within this harness's current capability — it means the epic's core premise (a convention-only
mechanism can raise consultation rates enough to matter) is unworkable as scoped, a conclusion
to reach with eyes open rather than deferred to an unnamed "something heavier." The one real
lever this harness offers, if that happens: **Claude Code shipping a real pre-tool-call
interception hook** — reopening "convention vs enforcement" the way `ADR-001` already flags for
the harden epic's own deferred gate. Until then, a bad CoS-1 result should go back to
product-owner as a scope call (is a detectable-not-enforced mechanism still worth shipping,
given the measured rate?), not to solution-architect as an unsolved engineering problem.
