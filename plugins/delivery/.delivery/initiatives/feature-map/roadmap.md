<!--
BUDGET — target 700 words, hard cap 1100 words. Excludes code, YAML and data tables.
Phase, dependency and coverage tables are data.
-->

# Delivery roadmap: feature map, from what is shipped to blast radius to retirement

> Written by /delivery:roadmap. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-10-24 · Planned at `195071b` (HEAD of `delivery-feature-map`)
> PRD: `.delivery/initiatives/feature-map/prd.md` · Architecture: `.delivery/initiatives/feature-map/architecture.md` · ADR-016 to ADR-019
> Open blocking findings: none (`reviews/feature-map-*.md`, all `fixed`). No `prioritization.md`: the PRD's proposed stages are step 2's baseline.
> **Word count:** 1099 prose words (target 700, cap 1100; tables and code excluded: `awk` strips fences, then `grep -v '^|' | wc -w`). Over target: five phases, each with entry, exit and cut list.

## Constraints

No operator record exists (no team session has run): the owner's words are cited; each **default** stands in for a decision.

**Team (default):** the owner plus role sessions (Product Manager, Delivery Manager, one builder) on pc, wintermute and cloud; tracks run serially.
**Fixed dates:** none.
**Fixed variable (default):** scope, set by the owner: "Yes keep the server in this release" (2026-10-24), read through "That inventory MUST always be up to date, fresh and real" (`brief.md`). Cut lists never cut the freshness rule.

## Sequencing rationale

Three unknowns could invalidate release 1 and go first: role sessions starting the plugin's MCP server (spike 1), `node:sqlite` on every host (spike 6), and a fetch per question being fast enough (spike 2). Spike 1 runs against a real one-tool server, since a stub cannot show the tool names the lane hook receives; if it fails, the owner hears before other map work (ADR-017).

Release 1 then builds trust before reach: provenance and blind spots, the asked-commit rule, "shipped", the Vault, `impact`, then declared features, last because they wait on owner records (A-8). Gates, retirement and inventory views consume `impact`, so they follow it.

## Second prioritisation pass: inversions for the Product Owner

| # | Item | Value | Cost before | Cost now | Recommendation |
| :-- | :-- | :-- | :-- | :-- | :-- |
| I-1 | Runtime reach (FR-11, must) | the only measured catch, `6883fee` | MVP, unsized | deferred by the critic until spike 4 (4 h); S once rules exist | bring into release 1 if spike 4 passes; last on its cut list |
| I-2 | "Shipped" from a deployment record (R-arch-2) | owner quote 3, "what is shipped" | FR-1 read git at a commit | M plus an external dependency (A-15) | keep; `--as merged` is the fallback, labelled |
| I-3 | Python and workflow rules (ADR-018) | the Vault in release 1 | NFR-9: JS, TS, markdown, JSON only | L, low confidence until spike 3 | keep; spike 3's stop rule makes Python a blind spot rather than slip the release |
| I-4 | Path normalisation (FR-27) | brief F2 | "ship alone, first" | S, no dependency | ship in Phase 1 |
| I-5 | Merge reconciliation (FR-28, FR-29) | brief F4, about 10 lines | "ship alone, first" | S, but deferred by the critic; truncation is spike 7 | Phase 3, after spike 7; Product Owner may pull it into Phase 1 |
| I-6 | Expert staleness (proposed FR-46) | brownfield MVP 6 depends on it | not in the PRD | M, needs PR #63 merged | Phase 3, once the Product Owner accepts FR-46 |

## Phases

### Phase 1: the map tools in a real role session

**Entry criteria:** Setup (architecture.md) done and green in CI: full-history checkout, Node 22.13, 22 and 24 matrix, `map-fixture.js`, `map-repos.js` (M, high). The owner can start one role session from a role directory.
**Delivers:** FR-1 (this repository, labelled "merged at"), FR-27
**Demonstrable exit:** in a real role session, the Product Manager calls `show_shipped` and gets 71 entry points (delivery 52, claim-guard 15, attractor 4) at `df0c0a5`, stamped with that 40-hex SHA, equal to `map.js shipped --as merged --json`; transcript recorded. Spike 1 and 6 result tables written. `agents/chief-of-staff.md` and `plugins/delivery/agents/chief-of-staff.md` raise one `file-overlap`.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| `feature-map-01` the map at a resolved commit: linear reader, plugin, JS and markdown rules with line evidence, SQLite store refusing any other commit | M | high (db-spike measured) | Setup |
| `feature-map-02` the map tool server: stdio protocol subset, `show_shipped`, `.mcp.json`, lane admission | M | medium | `feature-map-01` |
| Spike 1: MCP server, env and tool names in a role session (owner decides) | S (2 h) | medium | `feature-map-02` |
| Spike 6: `node:sqlite` on pc, wintermute, cloud, CI Node 24 | S (2 h) | high | `feature-map-01` |
| `feature-map-03` one file, one path: `waves.js` normalisation and "ambiguous" | S | high | none |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 1 | `feature-map-01` | `map.js shipped --as merged` at `df0c0a5`: 71 entry points, 40-hex SHA |
| map-tools | 1 | `feature-map-02`, spike 1 | `show_shipped` answers in a role session (L5 transcript) |
| claim | 1 | `feature-map-03` | one `file-overlap` for two spellings at claim |

**Verification in this phase:** L3 counts at `hist@df0c0a5`; L4 frames against `fx-mcp-frames`, re-recorded from spike 1; L5 once; FR-27 mutation (drop normalisation, test turns red).
**Cut list — dropped first if late, in this order:**
1. `feature-map-03` (independent; moves to Phase 3)
2. Nothing else: spike 1 is the release's precondition.

### Phase 2: release 1, the map the owner asked for, over this repository and the Vault

**Entry criteria:** Phase 1 exit; spike 1 passed or the owner chose the design change; spike 6 passed on at least the planner hosts.
**Delivers:** FR-2 to FR-10, FR-12 to FR-15, FR-20, FR-40 to FR-44; FR-11 if spike 4 passes
**Demonstrable exit:** from a role session: `show_shipped` for delivery reads `0.30.0` shipped at `df0c0a5`, and for the Vault reads the commit `https://mtgvault.cards/api/health` serves (**default** URL pending the owner); `get_impact` on a story names features, areas and blind spots; asking about a commit the map was not built for rebuilds or refuses; `map.js verify` reports 0 diffs and one hand-edited edge exits non-zero; one declared feature cites an owner decision labelled `feature:<id>`; `ready.js` prints reach as information.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 2: mirrors, fetch p90, deployment records on pc, wintermute, cloud | S (4 h) | low | Phase 1 |
| Spike 3: Python and workflow precision, 50 edges per rule, second repo | M (1 day) | low | `feature-map-01` |
| Spike 4: runtime rule after the D-6 fix | S (4 h) | medium | `feature-map-01` |
| `feature-map-04` every fact sourced, every gap listed: provenance, blind spots, dangling, `verify`, rule mutation harness | M | high | `feature-map-01` |
| `feature-map-05` answer at the asked commit or refuse: host cache, mirrors, named refs after a fetch, shallow and partial refused | L | medium | `feature-map-04`, spike 2 |
| `feature-map-06` shipped from a deployment record | M | medium | `feature-map-05` |
| `feature-map-07` the Vault mapped: Python, workflow, manifest rules, `repo.add` | L | low | `feature-map-05`, spike 3 |
| `feature-map-08` impact before code: story, feature, commit, hubs apart | M | medium | `feature-map-04` |
| `feature-map-09` runtime reach | S | medium | spike 4, `feature-map-08` |
| `feature-map-10` declared features: `map.js declare`, one writer, lane protection, anchors, seed | L | medium | `feature-map-05`, owner records |
| `feature-map-11` the map tools: `show_feature`, `get_impact`, `show_blind_spots`, `get_verification` | M | medium | `feature-map-08`, `feature-map-10` |
| `feature-map-12` reach at the ready gate, as information | M | high | `feature-map-08` |
| `feature-map-13` publish: version bump after PR #63's 0.31.0, doctor check | S | high | every wave verified |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 2 | `feature-map-04` | `map.js blind` at `df0c0a5`: analysed plus blind equals every file; claim-guard's server listed dangling; `verify` 0 diffs |
| map | 3 | `feature-map-05`, `feature-map-06` | freshness matrix green; `shipped` names the deployed SHA or refuses `no-deployment-record` |
| map | 4 | `feature-map-07` | the Vault at its deployed SHA: Python and workflow edges with lines, blind rows named (local check, host and SHA recorded) |
| map | 5 | `feature-map-08`, `feature-map-09` | `impact` on `modify .../brief/SKILL.md` reaches exactly `delivery:brief`; `6883fee^` replay reaches the 2 hooks |
| map | 6 | `feature-map-10` | one feature declared and shown; a model-chosen name refused `source-scope` |
| map-tools | 2 | `feature-map-11` | each tool's envelope equals `map.js --json` (L4); L5 transcript |
| ready-gate | 1 | `feature-map-12` | `ready.js` prints reach with `reach.source`; every fault reads `reach-not-computed`, exit 0 |
| map, map-tools | publication | `feature-map-13` | marketplace entry and `plugin.json` at the new version on `main` |

**Verification in this phase:** deepest on freshness (matrix over every verb and tool), provenance (tamper set) and blind spots (invariant at every L3 commit); FR-44 harness in CI; the ready-gate fault list.
**Cut list — dropped first if late, in this order:**
1. `feature-map-09` (runtime reach returns to Phase 3)
2. `feature-map-12` (the ready gate waits for Phase 3)
3. Seed in `feature-map-10` (FR-8); declare by hand-chosen entry points
4. `feature-map-10` whole, if no owner record names a feature: release 1 ships derived facts only, said so in every answer
5. Python in `feature-map-07` (spike 3's stop rule: blind spot, workflows kept)

### Phase 3: release 2, reach in the gates

**Entry criteria:** release 1 published; spike 5 measuring over the first 10 story PRs.
**Delivers:** FR-16 to FR-19, FR-21, FR-28, FR-29, FR-45; proposed FR-46; FR-11 if cut
**Demonstrable exit:** `ready.js --record` warns naming "wave 2 of A" on fx-waves and records 1 ledger row; the merge gate warns "declared not merged: c.js"; the FR-45 window fires runtime reach once, on `6883fee`; a stale expert reads stale.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 5: features reached per story PR; 20 Vault PRs replayed | S | low | release 1 |
| Spike 7: `gh pr list --json files` truncation | S (2 h) | medium | none |
| `feature-map-14` replay and sweep | M | medium | `feature-map-09` |
| `feature-map-15` ready-gate warnings | M | medium | spike 5, `feature-map-12` |
| `feature-map-16` declared versus merged at merge | S | high | spike 7 |
| `feature-map-17` the toolkit joined at its pin, `search_evidence` | M | medium | `feature-map-07` |
| `feature-map-18` expert staleness | M | medium | PR #63 merged; FR-46 accepted |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 7 | `feature-map-14`, `feature-map-17` | FR-45 window fires once, on `6883fee`; a Vault import into `mtg-toolkits` resolves at the pinned SHA |
| ready-gate | 2 | `feature-map-15` | warning names area or wave, feature and file; story stays ready |
| merge-gate | 1 | `feature-map-16` | merged row carries the reconciliation |
| experts | 1 | `feature-map-18` | `map.js experts` verdicts printed at role start |
| all of the above | publication | version bump | new version on `main` |

**Verification in this phase:** L2 on fake `bd` and fake `gh`; one `bd` contract check on a host with `bd` (A-14).
**Cut list — dropped first if late, in this order:**
1. `feature-map-17`
2. `feature-map-18`
3. `feature-map-16`

### Phase 4: retirement

**Entry criteria:** release 2; the owner names a usage source (brief OQ 5), else candidates read "instrument first".
**Delivers:** FR-22 to FR-26
**Demonstrable exit:** at `/delivery:realign`, a fx-retire feature moves retiring, hidden, deleted, each citing a record scoped `irreversible`; `git ls-files` and every blob hash unchanged.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| `feature-map-19` candidates with raw usage evidence | M | low | usage source |
| `feature-map-20` three stages, irreversible record | M | medium | `feature-map-10` |
| `feature-map-21` deletable only when nothing references it | M | medium | spike 7 |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| realign | 1 | `feature-map-19`, `feature-map-20` | realign lists candidates with raw usage, or "instrument first"; stages recorded |
| realign | 2 | `feature-map-21` | deletable list names its resolved HEAD, or "keep the code" with the reason |

**Verification in this phase:** L2 on fx-retire; FR-26 hash check after each stage.
**Cut list — dropped first if late, in this order:**
1. `feature-map-21` (every exclusive file reads "keep the code")

### Phase 5: the product inventory views

**Entry criteria:** release 2; the Product Owner answers PRD OQ 15 (who declares personas served).
**Delivers:** FR-30 to FR-39
**Demonstrable exit:** a hidden coupling cited by path and line; `plan.js select` gives "builds on verified F via `x.js`"; a retired persona leaves F "unserved".

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| `feature-map-22` relations, declared and hidden | S | medium | `feature-map-10` |
| `feature-map-23` business impact by persona and surface | M | low | OQ 15 |
| `feature-map-24` selection that compounds | M | medium | `feature-map-15` |
| `feature-map-25` consolidation candidates | S | medium | `feature-map-22` |
| `feature-map-26` tech-debt columns | S | medium | `feature-map-14` |
| `feature-map-27` personas over time | S | low | OQ 15 |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 8 | `feature-map-22`, `feature-map-23` | a pair reads hidden, citing path and line; "who is affected" names personas with grades as recorded |
| plan-select | 1 | `feature-map-24` | `select` reasons cite files |
| realign | 3 | `feature-map-25` to `feature-map-27` | consolidation, debt columns, unserved features shown; nothing changed |

**Verification in this phase:** one L2 fixture per criterion (thin: advisory, read-only).
**Cut list — dropped first if late, in this order:**
1. `feature-map-27`
2. `feature-map-25`
3. `feature-map-26`

## Areas

No row cites a `dec-` record yet, so `waves.js roadmapAreas` honours none: a new area is refused at half the budget or less until the first team session records one.

| Area | Reason | Record |
| :-- | :-- | :-- |
| map | new: owner quotes 1, 3 and 5 (`brief.md`) | none yet: owner's words only |
| map-tools | new: "Yes keep the server in this release" (2026-10-24); "a real 'rag tool'" (ADR-016) | none yet: owner's words only |
| claim | existing claim path (`waves.js`); brief F2 | none yet; area name unverified (`bd` absent) |
| ready-gate | existing surface S2; brief MVP 4 | none yet; area name unverified |
| merge-gate | existing surface S3; brief F4 | none yet; area name unverified |
| experts | PR #63's surface; brownfield MVP 6 | none yet |
| realign | existing surface S5; owner quote 2, brief MVP 5 | none yet |
| plan-select | existing surface S4; owner quote 4 | none yet |

## Critical path

```
Setup → feature-map-01 → feature-map-02 → spike 1 (owner) → feature-map-04 → spike 2 → feature-map-05
      → spike 3 → feature-map-07 → feature-map-08 → feature-map-10 (owner records) → feature-map-11
      → L5 transcript (owner) → feature-map-13
```

**To shorten it:** move the Vault (`feature-map-07`) to release 2; ship declared features later (cut 4); or accept a stated fetch age, which relaxes owner quote 5 (the owner's call).

## Dependencies outside our control

No calendar date is set, so "needed by" is a phase exit.

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Claude Code starts plugin stdio servers in role sessions, passes `settings.env`, names tools `mcp__plugin_delivery_map__*` (A-1, A-16) | Anthropic (Claude Code); observed by the owner | Phase 1 exit | assumed | owner told before other work; design change or CLI by owner's choice |
| A role session the owner starts, for spike 1 and each release's L5 transcript | owner | Phase 1, Phase 2 exits | none run yet | release cannot be verified on S6 |
| Node 22.13+ with `node:sqlite` on pc, wintermute, cloud (A-3) | owner | Phase 1 exit | 22.22.0 here only | map answers refuse on that host; gates warn |
| Private mirror access to `the-vault` and `mtg-toolkits` from planner hosts (A-4) | owner | `feature-map-05` | unmeasured | that host maps this repository only, said so |
| Vault production answers `/api/health` with `commit` (A-15) | owner (Vercel project) | `feature-map-06` | observed from this container on 2026-10-24: `commit` `2f01eab…`; that commit is not in the local clone (`b1ca9eb`), so the reachability rule applies | `shipped` refuses for the Vault; `--as merged` labelled |
| Owner decisions labelled `feature:<id>`, and one per new area (A-8) | owner | `feature-map-10` | none exist | cut 4 |
| PR #63 merged (experts, delivery 0.31.0) | owner | `feature-map-13` (version), `feature-map-18` | open | version number moves; `feature-map-18` waits |
| Consumer, not supplier: brownfield-onboarding (PR #62) reads the inventory for its release 1 dry run | owner | our release 1 | brief draft | their MVP 1 waits on ours |
| `gh pr list --json files` reports truncation (A-2) | GitHub | Phase 3 | spike 7 | "not reconciled, truncated" at exactly 3,000 |
| A usage source for product features | owner | Phase 4 | brief OQ 5 open | "instrument first", no candidates |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1 | 1, 2 | merged view in 1; deployment record in 2 |
| FR-2 to FR-5, FR-40, FR-42, FR-44 | 2 | `feature-map-04`, `feature-map-05`; FR-1 and FR-4 counts re-pinned to `df0c0a5` (556 files), for the Product Owner to accept |
| FR-6 to FR-9, FR-43 | 2 | `feature-map-10`; FR-8 on the cut list |
| FR-10, FR-12 to FR-15 | 2 | `feature-map-08` |
| FR-11 | 2 or 3 | spike 4 decides (I-1) |
| FR-20 | 2 | information only |
| FR-41 | 2 | `feature-map-05` |
| FR-16, FR-17, FR-45 | 3 | `feature-map-14` |
| FR-18, FR-19, FR-21 | 3 | warnings enabled after spike 5 (R-arch-6) |
| FR-27 | 1 | I-4 |
| FR-28, FR-29 | 3 | I-5 |
| FR-22 to FR-26 | 4 | |
| FR-30 to FR-39 | 5 | |
| FR-46 (proposed) | 3 | not in the PRD (I-6) |

**Deferred:** none. NFR-P2's target is not met as measured (architecture.md); spike 5 puts the unit to the owner.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Role sessions do not load plugin MCP servers | medium | high | spike 1 first, against a real server | owner | spike 1 transcript shows no tools |
| No owner record names a feature, so the register stays empty | medium | high | seed prints the labels a decision must carry; cut 4 | Product Manager | `feature-map-10` reaches ready with no record |
| Fetch per question too slow on a host | medium | medium | spike 2 per host; fetch age is the owner's call | owner | p90 above 2 s |
| Python precision below 90% | medium | medium | spike 3 decision rule | Delivery Manager | audit below 90% |
| `node:sqlite` changes between Node majors | medium | high | CI on 22 and 24; one wrapper | Delivery Manager | Node 24 job red |
| Release 1's three L items run serially on one builder | high | medium | cut list; Vault movable | Program Manager | `feature-map-05` exceeds L |
| NFR-P2 pressure hides true edges | high | high | no rule tuned to the number | owner | spike 5 p90 above 3 |
| The plan has had no isolated critic pass (step 4 ran in-session: no subagent tool; it found tracks sharing one builder and `feature-map-05`, order matching the component graph, integration proven per wave) | high | medium | run `/delivery:challenge` on this file before `agreed` | Program Manager | before `/delivery:stories` |

## Buffer

Time boxes are hard: a stop rule removes scope, never adds time. The cut lists are the buffer; none is hidden in sizes.

## Open questions for the owner

| # | Question, in your words | Default until answered |
| :-- | :-- | :-- |
| 1 | Is release 1 fixed in what it holds, with the date free to move? | yes |
| 2 | Is `https://mtgvault.cards` the Vault's production address? Today it says it is serving `2f01eab`. | yes |
| 3 | At the first team session, will you record one decision opening each area above, and one per batch of features naming each feature? | release 1 ships without declared features |
| 4 | If the check on the August ledger break passes, should "what a new folder breaks" be in release 1? | yes |
| 5 | Ship the path-spelling fix (two names for one file) now, and the merge-time file check in release 2? | yes |
| 6 | When a commit edits five skills, is "five features reached" noise or truth? Spike 5 shows the numbers. | truth: the target waits |
| 7 | Should experts be flagged when the files they were written from change (FR-46)? | yes, release 2 |
