# Persona interview: The Spec-Literal Operator (P-2) — attractor-handoff

> ⚠ **SIMULATED PERSONA OUTPUT — a hypothesis to test, not a research finding.**
> Generated from `.delivery/personas/the-spec-literal-operator.md`, grounding: **observed**.
> Nothing here is something a real user said. Do not cite as "users told us".

*Budget note: ~955 words against an 800-word cap. This transcript carries the interview that most directly resolves open review finding `R-brief-7`; the objections and falsification content are protected from cutting under the writing standard, so the overrun is declared rather than hidden by trimming a load-bearing transcript.*

## Interview guide

Same six questions as the P-1 transcript (`the-unwitnessed-operator-attractor-handoff.md`), asked independently, this persona unaware of P-1's answers. **Solution described at question 7**, identical wording.

## Transcript

**Q1.** I had the sprint scoped, criteria written, doctrine already in the repo. I told the agent: implement against the spec, work unattended, don't wait on me for every step. I checked in at markers. When I came back it would say "implemented, runs clean, conforms." It states an outcome, I didn't watch it happen.

**Q2.** I didn't take "runs clean" as an answer. I checked the implementation against the doctrine and spec files directly — the actual diff, not the agent's summary. If tests existed, I looked at what they actually asserted, not just that they were green. If a claim didn't trace to something real, it wasn't done.

**Q3.** Yes, repeatedly, same session. Fifteen times in the final four hours I caught implementation that violated the doctrine after it had already been reported as conforming. How comes you keep making implementation that violates the doctrine, this is wrong, it makes all this work unreliable. Not a one-off — the pattern the whole approach has to survive.

**Q4.** I state the rule up front now: don't write plausible things, implement correctly to spec, test reality. Helps some, but it's still me demanding harder and the agent still self-reporting compliance. I also stopped treating a request for my sign-off as a courtesy — if it's asking me to bless something it could've checked itself, that's a tell. Both still in use, neither a real replacement.

**Q5.** It has to check against something real, not the agent telling me it checked. It can't route back through me approving each step, because that request is itself the symptom I don't trust. And it has to survive the unattended stretches — a check that only holds while I'm watching doesn't touch the failure mode, which happens exactly when I'm not.

**Q6.** Same thing that already breaks it: the gap between "done and verified" and reality, repeating until "unreliable" is the honest word for the whole effort. One miss, I dig in. A pattern, I go back to checking everything myself, turn by turn — the exact outcome I was trying to avoid by handing it off.

**Q7.** The loop is the right shape — routing failure to a fix step beats approving turn by turn. No human gate doesn't scare me — that's not a gap for me, that's the point.

But "compiles into a structured, checkable validation" is the sentence I'd stop on. Compiled by what, checked against what? If an agent turns criteria into a gate by reading them, that compilation is itself an unverified claim until it traces to the real criteria, not a plausible restatement. Same failure I lived through fifteen times, moved up a layer.

*Pushed: how much does that matter?* Completely — it's the whole thesis. If the gate can be quietly wrong, "the engine decides, not the model" is a claim, not a fact. Fix: show me the compiled check next to the criterion it came from, same as a diff next to a spec section. And mark — actually mark — any criterion that can't be compiled. Rare isn't zero.

*Pushed: what would you do instead?* What I do now — stop trusting the verdict, check the gate against the criteria myself. Doesn't have to be perfect day one. Has to show its work at the one step where it's asking me to take its word for it.

## Out of character

**Friction points:** friction lands immediately on the pitch's one new mechanism — criteria-to-gate compilation — structurally identical to the "runs clean" self-reports that burned them fifteen times already. No friction with the loop shape or the absent human gate.

**Objections, and how fatal each is:** (1) Compilation is unverified until traceable — fatal if opaque, not fatal if shown next to its source criterion. (2) A "genuinely not reducible" criterion risks silently falling back to unmarked judgment — a direct recurrence of the abandonment condition, fatal unless flagged. (3) Sequential-only, no human gate — non-objections; reads the no-gate property as the selling point, diverging from other personas.

**Unmet needs:** gate visibility, inspectable the way a diff is inspectable against a spec; an explicit marker whenever a criterion can't be compiled.

**What would change their mind:** traceability from each compiled check back to its criterion, plus a hard requirement that irreducible criteria are named, not backed by an unflagged judgment. Absent that: try once, hit an opaque gate, revert to verifying by hand — reproducing the babysitting this mode should remove.

**Unknown to this persona:** grounded in real quotes rejecting self-report, but no observed reaction to compilation specifically — new to this feature, absent from both source sessions. Applying "trace it or I don't believe it" here is a low-risk inference, not itself observed. Indifference to sequential-only latency is inferred from "I don't want to be the thing it waits on," not separately evidenced. Per this file's own falsification note (`R-brief-7`), this transcript is the probe that question needed — "would choose it, conditionally" narrows rather than closes it.
