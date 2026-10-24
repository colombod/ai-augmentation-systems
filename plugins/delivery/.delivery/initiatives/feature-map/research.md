# Feature research: feature map, blast radius and retirement

> Written by /delivery:research. Owned by Business Analyst, with Solution Architect.
> Status: draft · Last updated: 2026-10-24 · Brief: `.delivery/initiatives/feature-map/brief.md`
> **Word count:** 279 (target 900, cap 1400, tables excluded).

Grades: **verified** (source read), **reported** (secondary or search summary), **assumed** (inference).
Codebase claims are verified by running code in this repository unless marked.

## Research method

Three web passes ran in parallel without shared context: by product category, by the user's
problem in their own words, and by failure. A fourth pass was run here, against this repository:
the spike `spikes/map-spike.js` and `spikes/sweep.js`, so the codebase section rests on measured
output, not reading.

| Finding | Passes that found it |
| :-- | :-- |
| Static maps miss runtime, configuration and prompt-borne edges, and report green anyway | category, problem, failure, spike |
| Maps decay unless checked mechanically; fingerprints or CI rescans are what work | category, problem, failure |
| Safe removal needs a dependency graph plus a usage signal, with a human deciding at the boundary | category, problem, failure |
| Noisy impact output gets ignored | failure, spike |
| A feature is a set of locations, not one anchor | category |
| Removal is staged (no new users, hidden, deleted), with deadlines | problem |

Each pass found material the others missed: **the space is not exhausted.**

## Prior art

| Approach | Gets right | Complaints | Covers feature / staleness / non-code / retire | Source |
| :-- | :-- | :-- | :-- | :-- |
| Doorstop (requirements as files) | SHA256 fingerprints flag a changed parent on its children and linked files | links are hand-made | yes / yes / by hand / no | doorstop.readthedocs.io (verified) |
| Feature-flag catalogs: LaunchDarkly code refs, Uber Piranha | named features; "ready for code removal"; an extinction event at a commit; Piranha removed ~2000 stale flags | covers only flag-gated code | yes / CI rescan / text scan / yes | launchdarkly.com/docs/home/observability/code-references, uber.com/blog/piranha (verified) |
| Meta SCARF | product-to-asset graph; engineer decides at boundaries; assets with usage metrics never auto-deleted; >100M lines removed | graph "can grow extremely complex" | yes / per run / data assets / yes | engineering.fb.com/2023/10/17/data-infrastructure/automating-product-deprecation-meta (verified) |
| Build graphs: Nx affected, Bazel | recomputed each run | non-code counts only if declared; aggregate targets missed (nx#37479) | project / fresh / declared only / no | nx.dev/docs/features/ci-features/affected (verified) |
| Call graphs: Trail-Code | symbol callers, `trail blast` on a diff, fresh per query | barrel re-exports and interface calls missed (#653, #618) | symbol / fresh / no / no | github.com/trailhq/Trail-Code (verified) |
| Ownership maps: CODEOWNERS, CodeScene components | named areas by glob | rot as teams churn and paths move | area / no / no / no | gitlab.com/gitlab-org/gitlab/-/issues/371980 (reported) |
| Sunset playbooks: Intercom, Google | kill criteria; dabblers first; compulsory deadlines beat advisory ones | say nothing on finding the code | yes / n/a / n/a / process | intercom.com/blog/how-to-sunset-a-feature, abseil.io/resources/swe-book/html/ch15.html (verified) |

## Domain constraints

| Constraint | Applies because | Source | Confidence |
| :-- | :-- | :-- | :-- |
| An impact report must state what it cannot see | static analysis is unsound for runtime-loaded and generated code; a green report misleads | arxiv.org/abs/2001.02545 (verified); github.com/nrwl/nx/issues/13625 (verified) | verified |
| "No usage data" is not "unused" | Hyrum's Law; Meta blocks auto-deletion of assets with metrics; Knight Capital's dormant code woke on flag reuse (>$460M) | abseil.io ch.15 (verified); en.wikipedia.org/wiki/Knight_Capital_Group (reported) | verified / reported |
| Keep effective false positives low | engineers ignore tools they do not act on; Tricorder holds checks under ~10% | cacm.acm.org/magazines/2018/4/226371 (reported) | reported |
| Shared assets need an explicit keep-or-sever call | "used by several products" | Meta SCARF (verified) | verified |

## Technical landscape

| Option | Maturity | Maintained | Licence | Might not fit because |
| :-- | :-- | :-- | :-- | :-- |
| Own extractor over git objects (the spike) | spike, 1 day | ours | MIT | JS/TS and markdown patterns only; regex, not a parser |
| Trail-Code as optional depth | ~10.7k stars, active | yes | MIT | npm unreachable here; markdown not parsed; writes hooks that collide with ours |
| Decisioncraft model (`when`, `replaces`) | draft contract | yes | MIT | journey steps, not features; undocumented `goes_away` |
| Doorstop-style fingerprints | established | yes | LGPLv3 (idea only) | Python; we would reuse the idea, not the tool |
| Production usage signal (invocation ledger) | in repo | ours | MIT | itself broke silently twice |

## What the existing codebase already decides

| Path | Constraint it imposes |
| :-- | :-- |
| `scripts/lib/plan-graph.js:188-207`, `scripts/lib/leak.js` | feature words beside paths are denied in the product repo: the map lives in the project repo |
| `roles/*.md:3` (`touches_code`), `scripts/prepare-role.js:61-73` | only builders have a product checkout: planners need the map handed to them, not computed by them |
| `scripts/assumptions.js`, lanes in `hooks/lane-groups.json` | records are written by one owning script; lanes refuse hand edits |
| `scripts/lib/gates.js:219`, `scripts/lib/waves.js` | `area` already groups stories for waves, caps and stops: a feature must relate to it, not duplicate it |
| `scripts/lib/reviews.js:23` (`GENERATED`), `:133-145` | generated code is defined once; `pr.files` is already fetched at merge |
| `scripts/lib/operator-records.js:174,181,535-540` | high stakes match decision-record scope, not story labels; a custom list replaces the default |
| `.gitignore:4-5` | every `dist/` is ignored except attractor's |

## Spike results (this repository, HEAD and history)

| Measure | Result |
| :-- | :-- |
| Graph at HEAD | 558 files, 71 shipped entry points (delivery 52, claim-guard 15, attractor 4), 1,654 typed edges, 3.1 s |
| Edge types | uses 541, tests 455, invokes 236, mentions 233, documents 90, discovers-at-runtime 85, wires 12, built-from 1, cross-plugin 1 (the one `serves` reference is dangling) |
| Replay `6883fee` with runtime reach | 2 features reached, both the `record-invocation` hooks (`path.join(dir, '.delivery')`) |
| Replay without runtime reach | 0 features: the break is invisible to a file or call map |
| Runtime rule over 255 commits | fires once, on `6883fee` (fires only when a discovered directory appears or disappears) |
| Features reached per commit | 153 of 255 reach none; median 0, p90 7, max 48 |
| Fan-in of backing files | 25 exclusive to one feature; 20 reached by 20 or more |
| Broken shipped link | `claim-guard/.mcp.json` serves `dist/claim-ledger.js`, absent from git (ignored by `.gitignore:4`) |
| Unreached code | test fixtures, `judge-smoke.js`, `usage.js` (wired by host status line), claim-guard server source |

One break is one sample: precision and recall are 1 of 1, not a rate. **assumed:** other
runtime-reach shapes (environment variables, process cwd, files read by glob) are not detected.

## Implications for the brief

- R-brief-2 is answered: the break is catchable, only with a runtime-reach relation. Keep it in the MVP.
- Seed from the graph and merged history, not story tables (R-brief-5).
- Hubs are measured: 20 files reach 20+ features. A fan-in rule is MVP, not polish (R-brief-6).
- Every report states its blind spots (domain constraint 1).
- Retirement needs a usage signal and a staged path; "no data" means instrument first (constraint 2).
- The map found a shipped defect on first run: a "what is shipped" view has value before any gate.

## Gaps

| Question | Why it matters | How to answer |
| :-- | :-- | :-- |
| Does the extractor generalise to a product repo in another language? | this repo is JS and markdown | run it on one real product repo |
| Which usage signal backs retirement for a product, not the plugin? | the ledger only sees plugin calls | owner names the product's logs |
| Precision on more than one break | n=1 | replay more incidents as they occur |
| Feature-location survey (Dit et al.) | PDF returned 503 | retry cs.wm.edu/semeru |
