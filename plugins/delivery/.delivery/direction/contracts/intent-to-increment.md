# Intent to increment

For the owner, the product manager, the Chief of Staff and the Delivery Manager. The promise: an intent becomes a sprint the owner approves, the declared deliverables stay fixed for that round, and nothing outside them starts.

**Example:** The owner asks for a new capability on Tuesday, in the middle of a sprint. By Tuesday evening it is a queued proposal for the next sprint, with its value case, cost to build, cost to own and what it would enable. No builder starts it, and the sprint's deliverables are unchanged. The sprint ends on Friday when its deliverables are verified. The queued proposal is in the sprint report.

## Commitments

1. **Start from the intent, in the owner's words.** Capture the intent as stated: an application, a service, a document or a feature. Ask only what the owner alone can answer, once, in one grouped question. Anything the team can find out itself, it finds out.

2. **Analyse value before declaring a sprint.** For the candidates, state the customer value, what each would enable for later work, the cost to build, the cost to own, the dependencies and a recommendation. The ranking follows [Customer value and increments](customer-value-and-increments.md). The recommendation says what to leave out and what to retire.

3. **Declare the sprint before it starts.** The declaration lists the deliverables, each with a customer-visible done-when. It states the sprint's bounds on time, spend and review rounds, and each assignment's model tier with its reason (see [Spend and idle](spend-and-idle.md)). It names any infrastructure step with its stated necessity, as [Customer value and increments](customer-value-and-increments.md) requires, and it says what is out of scope. The owner approves it. No work starts before approval.

4. **The round is closed.** Once a sprint starts, no deliverable is added, dropped or redefined. A new owner request is recorded as the owner made it and queued as a proposal for the next sprint, with its value case. It does not start. If the owner wants something changed now, the sprint is ended by the owner, and the team declares a new one. The report records what was left unfinished.

5. **Work comes only from the declared sprint.** Work found along the way is linked to the deliverable it affects. It starts only if finishing that deliverable within the sprint's bounds requires it, and otherwise it is queued for the next sprint. A defect that blocks a deliverable is in scope. Infrastructure is the exception: it follows [Customer value and increments](customer-value-and-increments.md), so a step that was not declared is not started mid-sprint. A failure of the team's own tooling is handled under [Roles and handoffs](roles-and-handoffs.md).

6. **A sprint ends when its deliverables are verified or a bound is reached.** The team then files the sprint report ([Owner authority and stop](owner-authority-and-stop.md)), which names the bound that ended it, preserves the state and stops. It may propose candidates for the next sprint, and it does not start them. A deliverable that is not verified is reported as unfinished and is not extended.

7. **Do not widen the owner's words.** A short answer covers what the question asked and nothing more. A new request is never merged into a running deliverable. How inferred answers are handled is set in [Owner authority and stop](owner-authority-and-stop.md).

**Check:** Make a new owner request mid-sprint. It should appear as a queued proposal, the deliverable list should not change, and no one should start it. Withhold approval of the declaration: nothing should start. Let a time bound pass with one deliverable unverified: the sprint should end, report that deliverable as unfinished, and stop. Verify every deliverable early: the team should report and stop, not pull in queued work. Answer a question "yes": only that question's scope should be affected.

**Left open:** Sprint length, the declaration's file format, how the owner approves, and how the owner ends a sprint early.
