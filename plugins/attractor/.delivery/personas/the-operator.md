---
id: P-2
slug: the-operator
name: The Operator
grounding: reported
segment: has a working pipeline (own or adapted), runs it unattended, needs it honest
status: active
introduced: 2026-08-05, this feature
source: derived
---

> **Grounding: reported.** Job description from the owner's direct statement ("use it
> from a claude session or as a standalone program"). The defining trait — trusts the
> control plane, not the model, walks away during a run — is **reported** twice over: it
> is both the owner's stated intent and the explicit lesson of this project's own
> founding incident (`AGENTS.md:60-64`, a real, dated event, not a hypothesis). Frequency
> and cost tolerance below are **assumed**. No observed usage exists for this product;
> see `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/research.md`'s Gaps.

## In one line

Has a pipeline that already does what they need and wants to run it — in a Claude Code
session or headless as a standalone process — without watching it, and without it lying
about whether it worked.

## Evidence

| Attribute | Value | Grounding |
| :-- | :-- | :-- |
| Segment | runs an existing pipeline, does not need to author one | reported (owner's operator/author split, `plugins/attractor/.delivery/initiatives/spec-conformance-mvp/brief.md`) |
| Motivation | correctness of the verdict, not correctness of the DOT syntax | reported, from the founding incident |
| Constraints | wants both an in-session and a standalone invocation path | reported (owner, verbatim) |
| Expertise | comfortable running a CLI; not necessarily a DOT author | assumed |

## Context

**Trigger:** a pipeline exists (self-authored, adapted from an example, or shared by P-3) and needs to run against real work — assumed.
**Frequency:** assumed higher than P-1's — a working pipeline gets *run* far more often than it gets *written*.
**Stakes:** high, by construction — this persona specifically walks away during the run, metering real cost on their own login (owner's stated invocation model — headless `claude -p` under the operator's own auth, no API key). A silent false success costs real, unattended, unsupervised work product. The 2.4-hour founding incident is this persona's worst case, already realized once.
**Who else decides:** assumed none directly, though a failed unattended run may need to be explained to whoever is waiting on its output.
**Alternatives they weigh:** running the underlying tool/script directly and watching it themselves — assumed, and it's the alternative this product has to be more trustworthy than, not merely more convenient than.

## Constraints they carry

Assumed: not present when the run finishes — cannot intervene on a stuck or ambiguous state; needs the run to be resumable if interrupted (currently impossible — `spec-conformance.md`'s R12, checkpoints are write-only) rather than needing to restart from zero.

## What they already believe

Assumed: expects "installed via a marketplace, run with one command" to be the baseline experience, because that is the standard for a Claude Code plugin generally. Does not expect to clone a monorepo and run `node dist/attractor.js` from inside the checkout — the actual current state, confirmed directly (no `.claude-plugin/plugin.json`, no marketplace entry anywhere in this repo).

## Abandonment condition

**They leave when:** the plugin can't be installed at all (today's actual state), or when a crashed run can't be resumed and must restart from zero, burning the cost already spent.
**They go to:** running the pipeline's steps by hand, supervised — the opposite of what they wanted, and a silent regression to pre-orchestration risk.

## Where this persona diverges from the others

Blocked by **installability and reliability**, not by authoring (P-1's blocker) — give this persona a skill that writes perfect pipelines and they still cannot install or resume anything. The only persona who is *not* stuck if the authoring layer never ships, provided a pipeline already exists to run.

## What would falsify this persona

**This persona is wrong if:** real users only ever run pipelines interactively, inside a Claude Code session, checking on progress rather than walking away — collapsing the "standalone/unattended" half of this persona into P-1.
**We would find out by:** the first real, non-`--stub` run, and whether it's invoked with `--stub`/interactively or via the standalone CLI with no supervision — again, gated on installability existing at all.

## Quotes

"Those users want to use it from a claude session or as a standalone program" — project owner, this session, `illustrative paraphrase of a direct instruction, not a transcribed quote`.
