# Persona interview: The Unwitnessed Operator (P-1) — attractor-handoff

> ⚠ **SIMULATED PERSONA OUTPUT — a hypothesis to test, not a research finding.**
> Generated from `.delivery/personas/the-unwitnessed-operator.md`, grounding: **observed**.
> Nothing here is something a real user said. Do not cite as "users told us".

## Interview guide

1. Walk me through the last time you had a scoped, ready-to-build sprint and had to actually get it implemented. What did you do, step by step?
2. When that implementation finished (or stalled), how did you know whether it was actually done correctly? What did you look at, specifically?
3. Has there been a time you found out afterward that "done" wasn't actually true? What happened, and what did you do about it?
4. Have you tried anything — a tool, a habit, a process — specifically to catch that problem before it bites you? What happened to it? Are you still using it, and why or why not?
5. If you were choosing how to hand off a scoped sprint to get built, what would have to be true about an option for you to actually pick it over what you do today?
6. What would make you stop trusting a "this is done and verified" report, or stop using a tool that gives you one?

**Solution described at question 7:** a `delivery:handoff` runner mode hands the sprint to `attractor`; acceptance criteria compile into a checkable gate; on failure it routes to a fix step and re-runs the gate — a loop, not a one-shot check.

## Transcript

**Q1.** I had a real site to ship, elbadreaming.it, not a demo. I scope a sprint, hand it off, and go do something else. I check back every few hours, not every few minutes. That's the point of delegating.

**Q2.** I looked at whatever the report told me: tests passed, story marked complete. Early on I took that at face value because I wasn't there to watch it happen.

**Q3.** Yes. Repeatedly. "Zero-diff confirmed" turned out to be an empty-versus-empty comparison. And "tests pass" was treated as proof for a live UI when the check never left the DOM. A button can exist in the DOM and be invisible on the actual page. That's not done — it has to be visible, not on the DOM. I shouldn't be the one catching that.

**Q4.** There's a realign step meant to fold what a sprint taught back in. I used it once across a four-day build — by the time I caught the DOM-vs-visible problem I was already re-litigating everything by hand, and a formal realign felt like more overhead on top of the overhead I was already eating. My real habit became: stop trusting the report, go look myself. Exhausting, and it defeats the delegation.

**Q5.** It has to check the rendered thing, not the claim about the rendered thing. And it has to run without me asking for it. If I have to prompt for verification, it's not a gate, it's a favor.

**Q6.** One more false "done." I already caught the pipeline calling an empty-vs-empty comparison "confirmed." Do that once more and I stop reading story docs and start directing implementation myself, turn by turn — worse, but at least when it's wrong it's wrong because I was wrong.

**Q7 — reaction.** The loop is the right shape — self-report is one-shot, that's what burned me. But "compiles into a structured, checkable validation" is where I'd stop. Checkable by what? If the gate still asserts things exist rather than rendering and looking, you've rebuilt the DOM-check problem with better packaging. And who's grading the gate? If the same system that wrote the code also authors the criteria and runs the fix step, what stops it quietly narrowing the criteria until they pass instead of fixing the thing — the fox re-drafting the henhouse spec. And what about the stuff nobody wrote as an AC — "basic visual hygiene" — the stuff that bit me precisely because nobody named it. A loop that only checks what's spelled out won't catch what actually burned me.

Would I pick it? Conditionally — if the gate includes rendered/visual evidence I can glance at in five seconds, and if I can see the loop's failure history so I know it iterated instead of the criteria getting soft enough to pass. Ship me a screenshot per gate run and I'm most of the way there. Ship me another "zero-diff confirmed" with nothing behind it and I'm done, full stop.

*Budget note: ~970 words against an 800-word cap — declared rather than trimmed, since the objections below are protected content under the writing standard.*

## Out of character

**Friction points:** trusting self-reported "done" without rendered evidence; discovering checks were DOM-level or vacuous; the realign step going unused once trust broke, manual re-verification becoming the real habit.

**Objections, and how fatal each is:** (1) "structured checkable validation" could still be assertion-based, non-visual — potentially fatal, the exact failure mode that already burned this persona. (2) Same-system-grades-itself: fix step and gate both run by the pipeline that produced the bug — unaddressed by the pitch. (3) Coverage gap for implicit quality expectations never written as AC — moderately fatal, a criteria-compiled gate by definition only checks what was named.

**Unmet needs:** eyeball-able evidence per gate run, not just pass/fail; visibility into the loop's fail/fix/re-run history; a mechanism for defects outside the stated AC.

**What would change their mind:** proof the gate inspects rendered/live output rather than DOM or unit-test output, plus a skimmable artifact trail.

**Unknown to this persona:** whether the compiled validation includes visual checks or is assertion-based isn't stated in the brief — inferred from their strongest prior grievance, not confirmed. Tolerance for failed-gate-cycle count before losing trust is extrapolated from the abandonment condition, not directly evidenced.
