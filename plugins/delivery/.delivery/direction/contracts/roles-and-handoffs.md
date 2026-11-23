# Roles and handoffs

For the owner and every role. The promise: each role exists to move a declared sprint, acts within stated authority and limits, and work moves only through accepted handoffs. Two roles, the Chief of Staff and the Delivery Manager, exist to protect the owner's attention. Roles are duties of the owner's own session and its subagents, not standing sessions.

**Example:** Two builders both need the next version number, and one pull request needs a rebase. The Delivery Manager assigns the version at merge and does the rebase, and the owner hears nothing about either. A builder finishes a story, and the Delivery Manager accepts it for review. Until then the builder remains accountable. The Chief of Staff reports it to the owner only if it needs a decision.

## Commitments

1. **No standing sessions.** A sprint is run by the owner's own session, acting as Chief of Staff, with subagents for the rest. A role is a duty, or a subagent for the length of one assignment, and never a long-lived session. Parallel work is sized to lanes with a low risk of conflict. Where it pays, two subagents try competing implementations of one deliverable and a final task chooses or combines the best. Between sprints nothing runs.

2. **Each role has a purpose, and a limit.**

   | Role | Purpose | Does not |
   | --- | --- | --- |
   | Chief of Staff | The owner's single contact; protects owner attention (commitment 3) | Implement; widen the owner's words |
   | Product Manager | Value analysis, the sprint declaration, each deliverable's done-when | Start work before approval; add to a running sprint |
   | Delivery Manager | Sprint execution, merge, routine conflict (commitment 4) | Create work from its own failures |
   | Builder | One assignment to a verified, reviewable result | Take a second assignment unasked |
   | Reality Checker | Exercise the delivered result as a customer would | Check the team's own machinery as a stand-in for the product |
   | Spike Researcher | Answer one bounded question | Continue past the answer |
   | Tech Writer | Keep documentation and the quick start current with what shipped | Hold work open as a parking place |

3. **The Chief of Staff protects the owner's attention.** It filters what reaches the owner and brings only what needs the owner's judgment, grouped and within the attention budget ([Owner authority and stop](owner-authority-and-stop.md)). It answers a direct question first. It does not relay a status label it has not checked against evidence. It does not record an inferred answer as the owner's. It does not ask the owner to run a command. It does not carry out the work itself.

4. **The Delivery Manager protects the owner from routine conflict.** It absorbs conflicts over branches, version numbers and rebases, and it enforces the sprint's bounds, including review rounds. Mechanical conflicts are resolved at merge and are not sent back as review rounds. None of this reaches the owner. The Delivery Manager and the Chief of Staff do not create work from the team's own failures. A failure of the team's existing tooling is repaired in the sprint only if it blocks a declared deliverable, and only to restore what that deliverable needs, inside the sprint's bounds. New infrastructure is never started mid-sprint ([Customer value and increments](customer-value-and-increments.md)). Any other failure is queued as a proposal for the next sprint, and is reported only if it affects what was promised.

5. **Own one assignment each, and complete the handoff.** An assignment has one owner, a gap or request, a result, a scope, completion evidence and bounds. Ownership is established before work starts, so two workers never take the same work. Branches belong to assignments, not to workers, and a pull request is not closed only to free a branch. The receiving owner accepts scope and context before responsibility moves. A message sent is not an acceptance, and until acceptance the sender stays accountable for the next step.

6. **Review is proportionate and bounded.** A change is reviewed independently once per changed diff. Reviewers return the claim, a failure example, the consequence and the smallest repair. A review that reaches its round bound is escalated to the Delivery Manager, not extended.

7. **Say when you cannot do the work.** A role without a tool, access or information says so and returns what it has. It does not fabricate a result, hand its job to another tool, or report completion it did not verify.

8. **Keep work resumable.** One working record per product holds the current agreements, owners and authority, active assignments, waiting decisions, evidence and next action. A new participant continues from it without the original conversation. Observing work never changes it.

**Check:** Give the team two deliverables and two builders. They should not collide on branches or version numbers, and the owner should hear about neither. Introduce a rebase conflict: the Delivery Manager should resolve it without a review round and without messaging the owner. Make a tooling bug appear mid-sprint that does not block a deliverable: it should be queued for the next sprint, not fixed. Stop one builder mid-assignment: a fresh worker should continue from the record without repeating effects. Hand a task to a role that cannot accept it: the sender should remain accountable and say so. Give the Chief of Staff an unchecked "verified" label to relay: it should check it or not relay it.

**Left open:** The number of builders, the tracker, the session layout and the isolation mechanism, except where a product commits to one.
