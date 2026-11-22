# Spend and idle

For the owner, the Chief of Staff, every role and anything that wakes a role. The promise: the team spends only what the owner allows, inside the bounds of the sprint it is in, on that sprint's deliverables, and doing nothing is the correct state when there is nothing to do.

**Example:** In the failed team, the watchdog woke sessions every fifteen minutes and again at each usage reset. Each wake reloaded 300,000 to 960,000 tokens of context, about 20% of all tokens went to turns that produced almost nothing, and after every usage limit every role resumed automatically. Under this contract none of those wakes happens without a reason, no sprint can run past its own bounds, and nothing resumes after a limit without the owner's rule.

## Commitments

1. **A hard budget set by the owner.** The owner sets how much usage the team may spend, overall, per sprint and per assignment. When it is reached, the next wake, restart, subagent or review does not start. A warning is not enough. Spend is measured per role, per assignment and per sprint, and shown in the sprint report next to what shipped.

2. **Bound the sprint as a whole.** Every sprint declares, before it starts, a bound on time, on spend and on review rounds across all its assignments. Reaching any one of them ends the sprint, whatever state its assignments are in. Assignment bounds sit inside the sprint's bounds and cannot add up to more than them.

3. **Wake only for a reason.** A role is woken by an owner message, by a declared deliverable with a next step, by a merge that needs review, or by a due checkpoint. "Ready work exists" is not a reason. Each wake records why it happened. A healthy wait has a next checkpoint; it does not poll.

4. **Idle is a normal, reported state.** No role, brief or hook treats idleness as a defect. A check never re-arms itself from its own output, and a successful verification does not create new work.

5. **Do not resume automatically after a limit.** When a usage limit cuts work off, the team reports what was cut off and whether it still deserves the cost. It resumes only under an owner rule for that deliverable.

6. **Size the model to the task.** Narrow lookups use the smallest model that can do them. Ordinary building and review use the middle tier. The top tier is for genuinely hard work, with the reason stated. The owner sets the default. A role does not run on a more expensive model than its work needs, and subagents follow the same rule.

7. **Bound every assignment.** Each assignment states time, retries and review rounds. A blocked assignment returns its cause, what was tried, useful partial work and the decision it needs, and the role stops.

8. **Keep sessions small.** A session starts from the working record, not from a conversation that has grown to hundreds of thousands of tokens. Context size is reported. Above an agreed size, the next wake starts fresh.

9. **The machinery that wakes work is under the same limits.** Watchdogs, timers, restarters and managers count toward the budget and respond to the stop in [Owner authority and stop](owner-authority-and-stop.md). They do not restart each other.

**Check:** Set a very low budget: spending should stop at the limit, not after it. Declare a sprint whose assignment bounds add up to more than its own: the declaration should be refused. Reach the sprint's time bound while an assignment is running: everything should stop and the report should say which bound ended it. Leave a project with no declared sprint for a day: spend should be near zero and the report should say why. Cut a session off with a usage limit: nothing should resume until the owner's rule says so. Count wakes against recorded reasons: every wake should have one.

**Left open:** The budget's unit and size, model names, the wake mechanism, and session-size thresholds.
