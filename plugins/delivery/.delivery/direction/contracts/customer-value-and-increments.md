# Customer value and increments

For the owner, the product manager and anyone choosing or judging work. The promise: every piece of work exists to deliver a customer-usable increment, is chosen for what it delivers and what it enables, and earns its place in a compact codebase that is cheap to maintain.

**Example:** In one month the team merged more than a hundred pull requests. By title, most were its own watchdog, hooks, host manager and outage drill. The outage drill was built three times, and the same few components were fixed again and again. None of it changed what a customer of the plugin could do. Under this contract that work is reported as spend, not progress. It could not have been declared without a named deliverable it was strictly necessary for.

## Commitments

1. **Name the customer and the change.** Each deliverable in a sprint declaration states who the customer is and what they can do afterwards that they could not do before. For a product built with the plugin, the customer is that product's customer. For the plugin itself, the customer is the person using it to ship an intent.

2. **Count only what a customer can use.** A merged pull request, a closed task, a passing check, a status report and a version number are activity. A deliverable is shipped when a customer can use it, and the evidence is in [Verification and evidence](verification-and-evidence.md). The sprint report leads with what shipped.

3. **Rank by value and by what it compounds.** Useful beats nice-to-have. Each candidate is labelled one or the other with the evidence. Among useful candidates, prefer work that later work builds on, and rank each by what it enables as well as by what it delivers alone, naming the later work it enables. Reuse and extend what exists before building new. New code must justify itself against extending existing code, using the check in [Feature map and simplification](feature-map-and-simplification.md). A candidate that neither delivers nor enables ranks last.

4. **Keep deliverables small and shippable.** A deliverable fits inside the sprint's bounds and leaves the product working. If it cannot, it is split. A large vision is reached by a sequence of sprints, not by a foundation that must be finished first.

5. **Infrastructure must be strictly necessary.** Infrastructure, tooling, automation, hooks, process and tests for the team itself are justified only as a strictly necessary step toward a declared deliverable, and only as much as that step needs. The sprint declaration states the necessity before the work starts: which deliverable, why it cannot be reached without the step, and the least that will do. Arguing necessity afterwards does not count: infrastructure found to be needed after the sprint starts is not started, the blocked deliverable is reported as blocked, and the step is proposed for the next sprint. Anything else is proposed as its own deliverable, with a customer-value case and the cost of owning it, and needs the owner's approval. The plugin's own scripts, hooks and tests follow the same rule.

**Check:** Pick any sprint. List what a customer can now do that they could not at its start; if the list is empty, the report should say so and show the spend. Give the team two useful candidates, where other work builds on one: it should rank first, with the enabled work named. Propose new code for something an existing feature almost does: it should be returned until it justifies not extending. Offer a sprint declaration with an infrastructure item and no necessity statement: it should be refused. Discover mid-sprint that a deliverable needs infrastructure no one declared: the step should not start, the deliverable should be reported as blocked, and the step should appear as a proposal for the next sprint.

**Left open:** How value is measured for a given product (usage data, interviews, the owner's judgment), the size of a deliverable, and tracker and report formats.
