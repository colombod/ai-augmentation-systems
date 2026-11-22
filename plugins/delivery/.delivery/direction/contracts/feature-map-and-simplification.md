# Feature map and simplification

For the owner, the product manager, builders and anyone proposing a change. The promise: the team always knows which features a product has, what code implements each, who uses it and what it costs to keep. It builds new only after checking what exists, and it regularly proposes removing what is not worth keeping, so the codebase stays compact and cheap to maintain.

**Example:** A builder proposes a new capability. The proposal includes what the map says it touches, and that an existing feature already covers most of it. The builder says why extending it is not enough, or changes the proposal to extend it. The same sprint report notes that two older features have had no use in months and cost a fifth of the test suite. The owner retires one. That counts as delivered value, because the resources it frees can go to work customers can use.

## Commitments

1. **Keep the trail map current.** Each product has a map from features to the code that implements them, updated on every merge. Agents and people can query it. It is a working tool and is not prose to be read. Whether it needs a persistent database or a server is decided by a story that shows the need, not assumed.

2. **Show blast radius before a change.** Every proposal to change a feature says what the change touches, by the map: dependent features, shared code and the checks that should be rerun.

3. **Check reuse before building.** Every proposal for a new feature or new code includes a map query for existing features and code that already do the job or nearly do it. It states why extending them is not enough, and what the new code will cost to own. A proposal without this check is returned. When extending is nearly as good, extending wins.

4. **Record what each feature costs.** Each feature has a customer, the evidence of its use where it exists, and the cost of owning it: code, tests, documentation, defects and support. Where there is no usage evidence, the map says so. It does not guess.

5. **Bring up simplification and retirement regularly.** Each sprint's proposals include candidates to simplify or retire, with the evidence and what removal frees, or a statement of why there are none. The owner decides. Proposing a removal is always appropriate and needs no pretext. Features labelled nice-to-have under [Customer value and increments](customer-value-and-increments.md) are the first candidates to trim.

6. **Apply it to the plugin itself.** The plugin's scripts, hooks, roles and tests are features with a cost, and they are justified under [Customer value and increments](customer-value-and-increments.md). Their growth is reported against the value they return. In the failed team, scripts and hooks grew from about 430 to about 33,000 lines and tests from about 550 to about 42,000, with almost nothing retired.

**Check:** Ask for the impact of changing a named feature: the map should answer, naming files and dependents. Ask which features have no use evidence: the answer should be a list, not a guess. Submit a proposal for new code with no reuse query: it should be returned. Submit one for something an existing feature nearly does: the proposal should name that feature and justify not extending it. Read a sprint's proposals: they should include a simplification or retirement candidate, or say why not. Compare the plugin's size from one sprint to the next: growth should come with a stated value.

**Left open:** The map's storage and query interface, how usage is measured for each product, and the format of retirement proposals.
