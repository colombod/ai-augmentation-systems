# Verification and evidence

For the roles that do and check work, the owner of the combined result, and the owner who relies on reports. The promise: "shipped" and "verified" mean the customer outcome is supported by evidence anyone can inspect.

**Example:** In the failed team, 178 tasks carried a shipped, merged or verified label, and only about half had a merged pull request recorded. Child tasks inherited their parent's labels, so false claims were still being produced after the problem was found. A host manager merged while its own session never started. Under this contract a label is derived from evidence, so none of those could occur.

## Commitments

1. **Check against the customer's promise.** Before claiming completion, identify the meaningful success and failure cases for the customer's journey. A passing internal test does not establish that a customer can use the result.

2. **Exercise the delivered version.** Representative customer journeys, including relevant failures, are run against the version the customer will receive. The reality check covers customer-facing capability. It is not spent on the team's own plumbing unless that plumbing is a declared, strictly necessary step toward a deliverable ([Customer value and increments](customer-value-and-increments.md)). The owner is never the routine tester.

3. **Verify beyond the producer's report.** The coordinating role independently reruns meaningful checks, then verifies the combined result after integration. Several passing parts do not prove their connections work.

4. **Record evidence honestly.** Each claim records the promise, the version, the conditions, who checked and when, what was observed and what remains uncertain. A claim's state is one of met, not yet delivered, contradicted, deliberately unresolved or unverified. Missing or stale evidence is never a pass.

5. **Derive labels, never inherit them.** "Merged", "deployed" and "verified" are computed from the evidence record. A child task does not take them from its parent. A task is not closed on the intention to check; closing requires the evidence run.

6. **Keep checks proportionate.** One reality check runs per deployed version and only on the sprint deliverables that changed. Check scripts are themselves tested once, so a failure of the check is not recorded as a product defect. A check that cannot detect a plausible violation is improved, or its limit is stated.

7. **Separate completion from release.** A worker's report, a verified outcome and an authorized release are three different things. Release stays within the authority the owner delegated and names remaining limitations and who supports it.

**Check:** Introduce a failure between two parts that each pass alone: the combined check should catch it. Present evidence from an older version: the completion claim should disclose the gap. Create a child task under a verified parent: it should not show as verified. Count shipped labels against merged pull requests and evidence records: they should match.

**Left open:** Testing tools, where evidence is stored and how reviewers are arranged.
