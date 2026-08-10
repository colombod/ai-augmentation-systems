# Persona interview: The Monorepo Maintainer (P-3) — attractor-handoff

> ⚠ **SIMULATED PERSONA OUTPUT — a hypothesis to test, not a research finding.**
> Generated from `.delivery/personas/the-monorepo-maintainer.md`, grounding: **reported**.
> Nothing here is something a real user said. Do not cite as "users told us".

## Interview guide

Same six questions as the other transcripts, asked independently. **Solution described at question 7**, identical wording.

## Transcript

**Q1.** Ran the delivery pipeline's sprint stage on the delivery plugin itself, in this repo, which also has superpowers and other plugins under `plugins/`. Scoped sprint came out, handed it to the coding agent turn by turn, sat there, merged the diffs myself. The build wasn't the part that went sideways.

**Q2.** Tests, and whether the diff stayed inside the files the story named. Mostly I look at what got written and where — did a new folder appear, does it live under the plugin's own directory or leak to repo root. That's where the surprise usually is for me, not whether the code runs.

**Q3.** Same day. The pipeline had written `docs/product/` and `docs/superpowers/` straight at repo root. Everything in both was 100% about one plugin — neither path said which. In a marketplace repo that's a landmine: next session, different plugin, same root path, two products' docs stomping on each other with no owner. Caught it eyeballing the tree after the run. Hand-migrated it myself.

**Q4.** For a while my only defense was habit — run it, then check the root before trusting anything. That's not a process, that's paranoia. We fixed the root cause this session — path resolution scoped per component now. That fire's out for me, for now.

**Q5.** It has to respect the repo's own structure without me telling it to, every time. Anything it writes goes under the component's own directory, full stop. I want to tell what belongs to what from the file tree alone.

**Q6.** If it says done but the artifacts are scattered somewhere unscoped, I don't care how green the checkmarks are — that's a mess with a good attitude. Catch it lying about scope once and I stop reading the report, I just grep the diff myself.

**Q7.** So it's a gate/fix loop on whether acceptance criteria pass, not a one-shot self-report. Real problem, just not mine. My bruise is entirely about where stuff lands, not whether criteria were met. So: does `attractor` respect the same per-component scoping when it runs? Where do its outputs go — the fix-step diffs, the gate logs? If that writes to some root-level `attractor/` workspace instead of inside the scoped plugin, I'm back where I started with a fancier failure mode.

*Pushed: if it does inherit the same path resolution, does the loop add value for you?* Neutral, mostly. It's solving a problem I've never had — I don't have war stories about acceptance criteria failing silently, I have war stories about docs in the wrong folder. If it's there and free, I won't turn it off. But I'm not switching my workflow for it, and if I had to pick between guaranteed scoped output and guaranteed verified acceptance criteria, I'm picking scoping — that's the one that's cost me an afternoon.

## Out of character

**Friction points:** the root-level `docs/product/` collision is this persona's one grounded incident, and it dominates every answer, even ones nominally about something else.

**Objections, and how fatal each is:** does `attractor` inherit per-component path scoping, or does it write its own outputs to a root/shared location — **potentially fatal but untested**: if outputs leak to root, this persona explicitly reverts to manual control. If scoping holds, the objection resolves to indifference, not endorsement — the gate/fix-loop mechanism itself is not fatal, but also not persuasive; would never be chosen *for* its verification benefit.

**Unmet needs:** explicit confirmation that `attractor`'s own run artifacts resolve to the same per-plugin path scheme as everything else under `.delivery/` — not addressed by the solution as described.

**What would change their mind:** nothing about the gate/fix loop would recruit this persona — their conversion trigger is orthogonal, only caring if scoping violations reappear through the new runner. A "won't object, won't champion it" bystander otherwise.

**Unknown to this persona:** whether `attractor`'s outputs are scoped per-component isn't stated anywhere in the persona file or the solution description — flagged as an open question rather than an invented answer. Exact reaction speed/severity if scoping does leak is extrapolated from the abandonment condition, not separately evidenced.
