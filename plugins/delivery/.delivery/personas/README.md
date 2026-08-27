# Personas: the delivery plugin's own users

> Phase 3 artifact. This is a self-assessment of the delivery plugin itself — these are
> the plugin's own end users, not customers of a product it was used to build.

**Evidence base, stated plainly:** one real operator, observed across two long, real,
adversarial engagements (elba-dreaming, attractor-orchestration-claude). This is **not** a
broad research base. P-1 and P-2 are the *same individual* modeled as two working modes,
not two people — see each file's grounding note. P-3 is that same individual's directly
reported (not independently observed) anticipated need. P-4 is fully `assumed`, constructed
by reasoning from the brief's Findings A and D, with no real instance in evidence.

**Grounding mix: 2 observed, 1 reported, 1 assumed** (of 4 active personas). This is
stronger observed-grounding than either real engagement's own persona work managed for its
product (elba-dreaming's set was 4-of-5 `assumed`) — but it is still one person, and every
downstream phase that reads this set should treat conclusions drawn from it as a strong
first hypothesis, not a validated finding, per the plugin's own evidence-grading doctrine.

| ID | Name | Segment | Grounding | Status |
| :-- | :-- | :-- | :-- | :-- |
| P-1 | [The Unwitnessed Operator](the-unwitnessed-operator.md) | solo operator, periodic delegation, long sessions | observed | active |
| P-2 | [The Spec-Literal Operator](the-spec-literal-operator.md) | solo operator, demands source-traceable verification | observed | active |
| P-3 | [The Monorepo Maintainer](the-monorepo-maintainer.md) | needs artifacts scoped per component | reported | active |
| P-4 | [The Trusting Delegator](the-trusting-delegator.md) | reads verdicts, not transcripts; no independent check | assumed | active |

**Served badly today:** P-4 most severely — by construction, nothing catches a false
verdict for this persona, versus P-1/P-2 who catch problems themselves at real personal
cost. P-1 and P-2 are also served badly (that is the brief's entire subject) but recover
through their own vigilance; P-4 has no equivalent recovery path in evidence.

**Served adequately now:** P-3, following this session's path-scoping fix
(`.delivery/`, resolved per-component) — kept in the set to preserve why that fix was made,
not because the persona is currently underserved.

## Research backlog — what simulation cannot answer

- Whether P-4 (The Trusting Delegator) is real at all, and if so, how they actually behave
  when a verdict turns out to be wrong. No amount of simulating this persona substitutes for
  finding a real instance — `/delivery:interview` can generate a hypothesis, not evidence.
- Whether P-1 and P-2's behavioral split (rendered-reality vs. spec-traceability) holds
  across a wider operator sample, or is idiosyncratic to one person's two projects.
- Real usage data on how often this plugin is actually run in a multi-component repo
  (P-3's premise) versus a single-product one.
- **Added 2026-08-10, attractor-handoff initiative:** whether P-2 (or anyone) actually
  chooses the `attractor` runner mode over `superpowers`/`generic` at the `/delivery:handoff`
  decision point — no observed instance exists (that mode didn't exist during either source
  transcript). Tracked as open review finding `R-brief-7`,
  `.delivery/reviews/attractor-handoff-01-brief.md`. Neither `/delivery:interview` nor
  `/delivery:simulate` resolves this — it needs a real choice being made, not a hypothesis
  walked through.

## Refinement log

- **2026-08-10, attractor-handoff initiative:** P-2 and P-4 refined (not regenerated) —
  each gained a dated note connecting existing, unchanged evidence to the new feature's
  hypothesis. No grade changed; grounding mix below is unchanged. No new persona created —
  a targeted evidence search found nothing justifying a genuinely new segment, and the
  brief's "same population as the existing two runner modes" claim held under that check.
