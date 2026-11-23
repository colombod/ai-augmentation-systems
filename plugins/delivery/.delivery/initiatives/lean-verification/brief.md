# Product brief: Property verification, with Lean where it fits

> Written by /delivery:brief. Owned by Product Owner and Business Analyst.
> Status: draft  ·  Last updated: 2026-11-23

**Mode:** frame · **Word count:** 855 (cap 900; target 600, over it because the method table's reasoning and the plug-in points were both requested)

## Coverage

| Lens | Ran | Found nothing others did? |
| :-- | :-- | :-- |
| value | yes, independently | no: stopping rule shared, reuse of the claim slot its own emphasis |
| precision | yes, independently, without the contract or `features.json` (wrong path) | no: F9 and F10 are its alone |
| absence | yes, independently | no: F6, F7 and F11 are its alone |

**Findings by convergence:** 3 found by 3 lenses · 3 by 2 · 5 by one only · 1 from the source check after the lenses.
Each lens found material the others missed, so the space is **not exhausted**.

| ID | Finding | Lenses | Evidence |
| :-- | :-- | :-- | :-- |
| F1 | A Lean proof is about a hand-written model, so it says nothing about the code until the two are compared | 2 | formal-verify `SKILL.md:70,98` |
| F2 | Evidence rows are pass or fail, so a model proof would count toward `verified` | 3 | `scripts/evidence.js:3,17` |
| F3 | A proof keeps passing after the code changes | 3 | contract commitment 4 |
| F4 | Most of this product is skills an LLM interprets, so "not provable" is the normal case and needs a legitimate outcome | 3 | `.delivery/features.json` |
| F5 | Retirement is pure logic and the best first target | 2 | `scripts/lib/features.js:240-252` |
| F6 | A correct proof of the wrong statement looks like evidence | 1 | contract commitment 1 |
| F7 | Lean is absent, and the suite runs sealed | 1 | `which`, `CLAUDE.md` |
| F8 | Proof effort can exceed the failure it prevents | 2 | contract commitment 6 |
| F9 | Only the Delivery Manager or a Reality Checker may write evidence rows, so who records a proof is undecided | 1 | `scripts/evidence.js:11-14` |
| F10 | A property bound to a dangling anchor can pass while proving nothing | 1 | `scripts/lib/features.js:80-85` |
| F11 | "Verified" already carries a contract meaning, so "proved" must not become a synonym | 1 | `.delivery/glossary.md:33` |
| F12 | `map.js retire` prints "Deletable with it" without the blind-file count that `impact` prints | source check | `scripts/map.js:85,152` |

## Owner lens and what must survive

**Lens:** you value knowing that a feature's claim really holds in the code, because that makes decisions about work and retirement safe, while wanting to preserve flexibility across kinds of output · assumed (the team's reading).

**What must survive:**

- "A property proof like Lean may not always be applicable, depending on the outcome type and the output the product produces, so be flexible." (owner, this initiative)
- Missing or stale evidence is never a pass. **assumed** to apply here (contract commitment 4).
- Reuse `agent-formal-verify` and `claim-guard` before building anything. **assumed** (from the request framing this brief).

**Proposition:** Before committing to a change or a retirement, the owner can see which properties of the feature hold against the current code, by what method, and what that method cannot show.

| Gate | Status | Reason |
| :-- | :-- | :-- |
| correctness | unknown | P1 below is expected to hold, and no proof has been written |
| safety | pass | The first increment deletes nothing, and retirement stays the owner's recorded decision |
| accessibility | n.a. | Text records and CLI output only, with no new interface |
| feasibility | unknown | Lean, Java, TLC and Kani are absent, and the setup skill has not been run |

## Problem

The plugin records whether a criterion passed, but not what kind of assurance stands behind that pass. A unit test, a reviewed reading and a proof would all land as the same `pass`. When someone weighs a change or a retirement, the map shows reach, and nothing states which properties of the feature must still hold afterwards.

## Who has it

The owner, who relies on the `verified` label and decides retirements. The Delivery Manager and QA Strategist, who choose and record the checks. The plugin declares 8 features.

## Cost of the status quo

The contract's founding failure was 178 tasks labelled shipped, merged or verified with about half having a merged pull request. Labels are now derived, yet the strength of a claim is still invisible. A retirement can list a file as deletable while a reference from a file no rule reads keeps it alive (F12). The workaround is reading the code by hand each time.

## What changes if we solve it

Each important claim about a feature becomes a named property with a chosen method, a recorded limit and a state. A change that touches the property's code makes it `unverified` until rechecked.

### What can be stated and checked

A property is checkable when it is one falsifiable sentence about a feature, tied to anchors, with a known way to observe a violation. The method follows the outcome type:

| Outcome type | Example here | Method | What it cannot show |
| :-- | :-- | :-- | :-- |
| Pure logic, any input size | retirement partition, hash chain | **Lean**, plus differential vectors against the real function | Anything outside the model's assumptions |
| Concurrency or ordering | parallel sessions writing a ledger | TLA+ with TLC | Code fidelity, without a trace check |
| Bounded Rust | none in this plugin today | Kani | Inputs beyond the bound |
| Guard or gate in shipped code | "a non-author writes evidence" | claim-guard adverse-state probe | Paths nobody enumerated |
| Deterministic script behaviour | CLI refusals | Test with a named failure case | Untested inputs |
| Speed, size, cost | check duration | Measurement | Other load conditions |
| LLM-interpreted skill output | "brief stays within cap" | Repeated runs against a rubric, then review | Any guarantee: results are a rate |
| Experience and design | readability of a report | Review, reality check | Real users' reaction |
| Customer value, continued use | "nobody uses this feature" | Logs, user evidence | Non-use where nothing is instrumented |

### How the choice is made and recorded

Take the cheapest method able to detect a plausible violation. Choose Lean only when all four hold: the claim is true or false for every input, it needs no judgement, the logic can be isolated, and being wrong costs more than the proof.

Each property is recorded on its feature in `features.json`, which the map already tolerates because it reads only named fields (`scripts/lib/features.js:84`). It holds the statement, outcome type, method, reason, limit, commit, and state. Choosing a different method later is an edit with a reason.

States stay the contract's five, with no new one. A Lean proof without agreeing differential vectors is `unverified`. claim-guard verdicts map directly: `CONFIRMED` to met, `REFUTED` to contradicted, `UNTESTABLE` to unverified. A proof supports a property and never replaces the customer-journey reality check (commitment 2).

### Where it plugs in

- **Map:** `impact` names the properties a change reaches, and those become `unverified`.
- **Stories:** an acceptance criterion cites a property ID, and QA picks the method when setting the test approach.
- **Retirement:** `retire` lists the properties that die with the feature and those that shared code must keep.

## Success signals

| Signal | How measured | Current | Target |
| :-- | :-- | :-- | :-- |
| Features with recorded properties | count in `features.json` | 0 of 8 | 1 of 8 in the first increment |
| Properties stating method and limit | count | 0 | all recorded |
| Seeded violations caught | mutate the code, rerun the check | not measured | every seeded violation for P1 and P2 |
| Effort for the first proof | hours recorded | not measured | recorded, to set the stopping rule |

## MVP boundary

One feature, `feature-map`, and two properties that show both sides of the choice:

- **P1, Lean:** deleting a retired feature's exclusive files leaves every other feature's reach unchanged, over the graph the map sees. Differential vectors compare the model with the real `retirement()`.
- **P2, claim-guard probe:** a file kept alive only by a reference in a blind file is not reported as deletable. The code suggests this is **contradicted today** (F12), which would be the increment's first customer value.

Stop if P1 costs more than the agreed budget, and keep the probe and tests.

## Explicitly out of scope

- Proving skills, LLM output or whole-program correctness
- Properties for all features, or a new evidence store, CLI or verifier
- Changing `evidence.js` or adding a claim state
- Adding Lean to the sealed test suite or to CI
- Requiring Lean on customers' machines

## Current-state workflow

A story's criteria are checked, and the Delivery Manager or Reality Checker records pass or fail per commit. For a retirement, someone runs `map.js retire`, reads the list, seeks usage logs and asks the owner.

## Open questions

| # | Question | Owner | Blocks |
| :-- | :-- | :-- | :-- |
| 1 | Does this lens match what you want: confidence in decisions, flexible by output type? | Owner | PRD |
| 2 | May we install Lean on this machine with the formal-verify setup? | Owner | P1 |
| 3 | How much effort is one proof worth before we stop? Example: one working day for P1. | Owner | Stopping rule |
| 4 | Which feature's failure would hurt you most? It may be a better first target than retirement. | Owner | MVP choice |
| 5 | Who records a proof result, and may a story's author write the proof? (F9) | Delivery Manager | Architecture |
| 6 | Which changes invalidate a proof: code, toolchain, statement, or new reach? | Solution Architect | Architecture |
| 7 | Who reviews that a Lean statement says what the customer was promised? (F6) | QA Strategist | P1 acceptance |
| 8 | Proposed glossary term: **Property**, one falsifiable sentence about a feature with a method and state. Accept? | Product Owner | PRD |
