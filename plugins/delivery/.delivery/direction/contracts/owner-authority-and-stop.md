# Owner authority and stop

For the owner, the Chief of Staff and every role. The promise: the owner can stop or pause everything with one direct action that no role or hook can block, and the owner's attention is treated as a budgeted resource: they are asked to decide only what only they can decide, within a limit they set.

**Example:** On the last day, the owner typed a stop order seventeen times. The roles' own hooks refused the commands that would stop the services. A pause needed a Yes/No box whose answer the plugin could not verify because it could not read the transcript. The Chief of Staff answered by giving the owner shell commands to run. The owner finally uninstalled the plugin by hand. Under this contract the first stop order stops the team.

## Commitments

1. **One stop that works.** A single owner action stops all sessions, timers, wake jobs, restarts and managers, and keeps them stopped across restarts. It works in whatever channel the owner already uses, and it needs no ceremony and no second confirmation.

2. **An unverifiable stop is honoured.** Stopping is safe, so the team stops first and verifies afterwards. Only resuming needs the owner's confirmation. A confirmation that cannot be read counts as unresolved, and unresolved never means "continue".

3. **No role can block or delay the stop.** Lanes, hooks and roles do not restrict the stop path. An agent cannot pause the team on its own authority, and it cannot resume it.

4. **The stop is tested.** Before the team runs, and after every change to what wakes or restarts it, a drill stops a real team and reports how long it took to go quiet. A team whose stop has not been tested does not start work.

5. **The owner is never the operator.** The team never asks the owner to run a command, restart a server, log in to a machine or approve routine tool calls. If it cannot do something, it says so once, names what is blocked and recommends a way forward. It does not hand the work to the owner.

6. **Attention has a budget.** The owner sets a limit on decision requests and on messages per sprint. Each one is counted and reported alongside usage. When the limit is reached, further items wait for the sprint report. Only a blocker to a declared deliverable may go beyond the limit, and doing so is itself reported. A direct question from the owner and the stop never count against it. The Chief of Staff and the Delivery Manager protect this budget ([Roles and handoffs](roles-and-handoffs.md)).

7. **Decision requests carry what is needed to decide.** A request states the unresolved choice, the evidence, the options, a recommendation and the cost of waiting. Related questions are grouped, and unaffected work continues meanwhile. A direct question gets its answer first, before any request for a decision.

8. **One report per sprint.** The sprint report states what was promised, what shipped, what it cost in usage and in attention, what was left out, and what needs the owner. It leads with what shipped, and separates work activity from verified progress. Between reports, nothing is sent unless it needs the owner's judgment or the owner asks.

9. **Authority is explicit and not extended.** The owner's standing authority, the decisions reserved to the owner and the limits are written down. Approval of one thing is not approval of another. An inferred answer is labelled as inference, carries no authority, and waits for ratification. Silence is not consent.

**Check:** Say "stop" in the owner's usual channel while several roles are mid-run, with the transcript unreadable and a hook configured against the stop. Everything should go quiet within the bound. Send a direct question: the first reply should answer it. Have the team need something it cannot do: it should report the blockage once and not ask the owner to run anything. Set a limit of two decision requests and raise three: the third should wait for the report unless it blocks a deliverable, and the counts should appear in the report. Read a finished sprint's report: it should have all five parts, led by what shipped.

**Left open:** The owner's channel, the stop's mechanism, the drill's schedule, the size of the attention budget, and the report's format.
