<!--
BUDGET — target 700 words, hard cap 1100 words. Excludes code, YAML and data tables.
Phase, dependency and coverage tables are data.
-->

# Delivery roadmap: feature map, from what is shipped to blast radius to retirement

> Written by /delivery:roadmap. Owned by Program Manager, with QA Strategist.
> Status: draft · Last updated: 2026-10-24 · Planned at `195071b`; revised at `e67a1b0` (HEAD of `delivery-feature-map`)
> PRD: `.delivery/initiatives/feature-map/prd.md` · Architecture: `.delivery/initiatives/feature-map/architecture.md` · ADR-016 to ADR-019
> Revised in place: same problem as the Sequencing rationale, status draft, so no Version-history row. Challenge: `reviews/feature-map-roadmap-01.md`, 24 findings (5 blocking), all fixed, none rejected.
> Open blocking findings: none (`reviews/feature-map-*.md`). No `prioritization.md`: the PRD's proposed stages are step 2's baseline.
> **Word count:** see the last line.

## Constraints

No operator record exists (no team session has run): the owner's words are cited; each **default** stands in for a decision.

**Team (default):** the owner plus role sessions (Product Manager, Delivery Manager, one builder) on pc, wintermute and cloud; build work runs serially on the one builder.
**Fixed dates:** none.
**Fixed variable (default):** scope, set by the owner: "Yes keep the server in this release", read through "That inventory MUST always be up to date, fresh and real" (`brief.md`). No cut drops the freshness rule or the server's tools; a cut dropping a `must` is taken only with the Product Owner's record.

**Evidence rules.** In this initiative's folder, spike results are rows in `spikes/results.md`: host, Node, exact command, raw output, decision. An L5 check is `evidence/l5-<phase>-<host>.md`: role, host, installed plugin version and commit, the tool call as the lane hook received it, the response with its 40-hex stamp, `map.js … --json` at that commit, and their diff; a missing part reads "cannot independently confirm". A cut item's signal reads "not measured".

## Sequencing rationale

Three unknowns could invalidate release 1 and need no build work, so they run on day one in one owner-started role session per host: plugin stdio servers in role sessions (spike 1, against a minimal real one-tool server, since only its own `tools/list` shows the names the lane hook receives), `node:sqlite` (spike 6), fetch speed and deployment records (spike 2). A failed spike 1 reaches the owner before any map story (ADR-017).

Release 1 then follows the owner's first ask, blast radius: provenance, then `impact` and runtime reach on this repository at explicit SHAs, before the three L items (fetch, "shipped", the Vault) and declared features, which wait on owner records. An owner checkpoint after `impact` decides go or no-go on the L items. The mutation harness lands with Setup, before the rules it guards.

## Second prioritisation pass: inversions for the Product Owner

| # | Item | Value | Cost before | Cost now | Recommendation |
| :-- | :-- | :-- | :-- | :-- | :-- |
| I-1 | Runtime reach (FR-11, must) | the only measured catch, `6883fee` | MVP, unsized | S plus spike 4 (4 h), once the rule exists | release 1, last on its cut list |
| I-2 | "Shipped" from a deployment record (R-arch-2) | owner quote 3, "what is shipped" | FR-1 read git at a commit | M plus an external dependency (A-15) | keep; `--as merged` is the fallback, labelled |
| I-3 | Python and workflow rules (ADR-018) | the Vault in release 1 | NFR-9: JS, TS, markdown, JSON only | 2 × M, low confidence until spike 3 | keep; spike 3's stop rule makes Python a blind spot rather than slip the release |
| I-4 | Path normalisation (FR-27) | brief F2 | "ship alone, first" | S, no dependency | Phase 1 |
| I-5 | Merge reconciliation (FR-28, FR-29) | brief F4; measures the map's accuracy | "ship alone, first" | S: FR-28 already defines truncation (exactly 3,000 reads "not reconciled, truncated"), so spike 7 refines rather than blocks | Phase 1, restoring the PRD's own staging |
| I-6 | Expert staleness (proposed FR-46) | brownfield MVP 6 depends on it | not in the PRD | M, needs PR #63 merged | not planned until the Product Owner adds FR-46 to the PRD |

## Phases

### Phase 1: the map tools in a real role session

**Entry criteria:** Setup (architecture.md) green in CI, including the `map-mutate.js` skeleton (a planted untested rule turns it red); `surface.json` with S1 to S6 and the claim path (PRD OQ 17) passing `surface.js check`; the PRD re-pin and the owner records the dependency table names. The host sessions start day one, before these.
**Delivers:** FR-1 (this repository, "merged at", 40-hex only), FR-3, FR-4 (lists, without `verify`), FR-27, FR-28, FR-29
**Demonstrable exit:** the wave increments below, shown in a real role session (L5 file): the Product Manager's `show_shipped` at `df0c0a5b0dba1449b6cdfef421bfe1ebc4d658c0` equals `map.js shipped --as merged --json`, and naming `main` is refused. Counts are checked against `git ls-tree`, never the CLI. Every Phase 1 rule is killed by a `[rule:<id>]` test; spike rows exist for all three hosts.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 1: minimal real stdio server (`spikes/mcp-spike.js`, one tool, `.mcp.json`): server start, `settings.env`, tool names, frames recorded into fx-mcp-frames (owner decides) | S (2 h) | medium | none: day one, host session |
| Spike 6: `node:sqlite` on pc, wintermute, cloud; CI Node 24 from the Setup matrix | S (2 h) | high | none: day one, host session |
| Spike 2: mirrors, fetch p90, deployment records, per host | S (4 h) | low | none: day one, host session |
| `feature-map-01` the map at a 40-hex commit: linear reader, plugin, JS and markdown rules with line evidence, blind and dangling lists, SQLite store refusing any other commit; a call without a 40-hex SHA refused until `feature-map-05` | M | medium | Setup, spike 6 |
| `feature-map-02` the map tool server: stdio subset, `show_shipped`, `.mcp.json`, lane admission, to spike 1's recorded names | M | medium | spike 1 decision, `feature-map-01` |
| `feature-map-03` one file, one path: `waves.js` normalisation and "ambiguous" | S | high | none |
| `feature-map-16` declared versus merged at merge (FR-28's 3,000 rule) | S | high | none |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 1 | `feature-map-01` | `map.js shipped --as merged --at df0c0a5…`: 71 entry points (delivery 52, claim-guard 15, attractor 4), claim-guard's server dangling, analysed plus blind 556 = `git ls-tree -r --name-only df0c0a5 -- plugins/ \| wc -l`; skills 31 and agents plus commands 19 equal `ls-tree` path counts (measured); `--at main` refused |
| map-tools | 1 | `feature-map-02`, spike 1 | `show_shipped` answers in a role session (L5 file) |
| claim | 1 | `feature-map-03` | one `file-overlap` for two spellings at claim (`agents/chief-of-staff.md`, `plugins/delivery/agents/chief-of-staff.md`) |
| merge-gate | 1 | `feature-map-16` | fx-merge warns exactly "declared not merged: c.js"; the capped PR reads "not reconciled, truncated"; exit 0 |

**Verification in this phase:** L3 counts mutation-checked (one `SKILL.md` deleted from the fixture: 70, red); the named-ref refusal at L2, mutation-checked; L4 against spike 1's frames; FR-27 and FR-28 mutations.

**Cut list — dropped first if late, in this order:**

| # | Cut | Replacement exit |
| :-- | :-- | :-- |
| 1 | `feature-map-03` to Phase 3 | the `file-overlap` line reads "not measured"; `waves.js` unchanged, stated |
| 2 | `feature-map-16` to Phase 3 | the merge-gate line reads "not measured"; release 1's note says the map's accuracy against merged files is unmeasured |
| — | nothing else: spikes 1, 2, 6, `feature-map-01`, `feature-map-02`, the refusal and the harness are the release's precondition | — |

### Phase 2: release 1, the map the owner asked for, over this repository and the Vault

**Entry criteria:** Phase 1 exit; spike 1 passed or the owner chose the design change; spike 6 passed on the planner hosts; spike 2 rows per host. Spike 3 and 07b also need full clones of the Vault and `mtg-toolkits` on a named host (dependency table).
**Delivers:** FR-1 (deployment record), FR-2 to FR-15, FR-20, FR-40 to FR-44
**Demonstrable exit:** the wave increments below, shown from a role session (L5 file), with "shipped" equal to the live record at check time: for delivery, the marketplace version on `origin/main` and the commit that set it (today `0.30.0` at `df0c0a5`; `0.31.0` if PR #63 merges first); for the Vault, the `commit` production `/api/health` serves (2f01eab at 2026-10-24 12:4x UTC), or `unverifiable` naming it when the mirror lacks it, both ways on fx-deploy. Pinned SHAs stay in fixtures.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| `feature-map-04` every fact sourced: provenance checks, `verify`, tamper set, harness operators line shift and false edge | M | high | `feature-map-01` |
| `feature-map-08` impact before code: story, feature, commit, hubs apart | M | medium | `feature-map-04` |
| `feature-map-09a` runtime rule with the D-6 fix, in the registry | S | medium | `feature-map-04` |
| Spike 4: the rule over the FR-45 window; stop rule between 09a and 09b | S (4 h) | medium | `feature-map-09a` |
| `feature-map-09b` runtime reach in `impact` | S | medium | spike 4, `feature-map-08` |
| `feature-map-11a` the tools `get_impact`, `show_blind_spots`, `get_verification` | M | medium | `feature-map-02`, `feature-map-04`, `feature-map-08` |
| `feature-map-12` reach at the ready gate, as information | M | high | `feature-map-08` |
| Checkpoint: owner sees `impact` on this repository; go or no-go on 05, 06, 07 | — | — | map wave 3 |
| `feature-map-05` answer at the asked commit or refuse: host cache, mirrors, named refs after a fetch, shallow and partial refused | L | medium | `feature-map-04`, spike 2, checkpoint |
| `feature-map-06` shipped from a deployment record | M | medium | `feature-map-05` |
| `feature-map-07a` Python and workflow rule packs, fx-py, fx-wf | M | low | `feature-map-04` |
| Spike 3: precision, 50 edges per rule, the Vault at its deployed SHA and 30 back, `mtg-toolkits`; stop rule between 07a and 07b | M (1 day) | low | `feature-map-07a`, full clones |
| `feature-map-07b` the Vault mapped: manifest rules, `repo.add`, at its deployed SHA | M | low | spike 3, `feature-map-06` |
| `feature-map-10` declared features: `map.js declare`, one writer, lane protection, anchors, seed | L | medium | `feature-map-05`, owner records |
| `feature-map-11b` the tool `show_feature` | S | medium | `feature-map-10`, `feature-map-11a` |
| `feature-map-13` publish: version bump after PR #63's 0.31.0, doctor check | S | high | every wave verified |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 2 | `feature-map-04` | `map.js verify` 0 diffs at `df0c0a5`; one hand-edited edge, and each tamper, exits non-zero naming it |
| map | 3 | `feature-map-08`, `feature-map-09a`, `feature-map-09b` | `impact` on `modify .../brief/SKILL.md` reaches exactly `delivery:brief`; `6883fee^` replay reaches the 2 hooks; then the checkpoint |
| map-tools | 2 | `feature-map-11a` | each tool's envelope equals `map.js --json` (L4); `get_impact` lists blind spots |
| ready-gate | 1 | `feature-map-12` | `ready.js` prints reach with `reach.source`; every fault reads `reach-not-computed`, exit 0 |
| map | 4 | `feature-map-05`, `feature-map-06` | freshness matrix green; a named ref answers after a fetch; `shipped` equals the live record or refuses `no-deployment-record` |
| map | 5 | `feature-map-07a`, `feature-map-07b` | the Vault at its deployed SHA: Python and workflow edges with lines, blind rows named (local check, host and SHA recorded) |
| map | 6 | `feature-map-10` | one feature declared, citing an owner record labelled `feature:<id>`; a model-chosen name refused `source-scope` |
| map-tools | 3 | `feature-map-11b` | `show_feature` envelope equals `map.js feature --json`; L5 file for release 1 |
| map, map-tools | publication | `feature-map-13` | marketplace entry and `plugin.json` at the new version on `main` |

**Verification in this phase:** deepest on freshness (matrix over every verb and tool), provenance (tamper set) and blind spots (invariant at every L3 commit); every harness operator in CI; the ready-gate fault list; fx-deploy both ways.

**Cut list — dropped first if late, in this order:**

| # | Cut | Replacement exit |
| :-- | :-- | :-- |
| 1 | `feature-map-12` to Phase 3 | `ready.js` unchanged; reach read through `get_impact` only; the ready line reads "not measured" |
| 2 | seed in `feature-map-10` (FR-8) | declare by hand-chosen entry points; exit unchanged |
| 3 | harness to the delete operator; tamper set to `matched` and `dst`; the rest to Phase 3 | FR-44's floor killed by tagged tests; `verify` red on both tampers |
| 4 | `feature-map-10` and `feature-map-11b`, if no owner record names a feature when `feature-map-05` is verified | release 1 ships derived facts; every answer says `declared: none`; `feature-map-11a` ships; the declared-feature line reads "not measured" |
| 5 | Python in `feature-map-07a` and `feature-map-07b` (spike 3's stop rule) | release 1 says it maps the Vault's workflows and manifests only; every Vault answer leads with its blind share (354 Python files at `2f01eab`) |
| 6 | `feature-map-09a`, `feature-map-09b` to Phase 3 | the replay line reads "not measured"; every `impact` answer lists runtime reach under blind spots |

### Phase 3: release 2, reach in the gates

**Entry criteria:** release 1 published; spike 5's replay of the last 20 merged Vault story PRs recorded (the 10-PR live measure is reported, never waited for).
**Delivers:** FR-16 to FR-19, FR-21, FR-45; FR-11 if cut
**Demonstrable exit:** the wave increments below; `ready.js --record` records 1 ledger row on fx-waves; L5 file: the Delivery Manager reads a reach warning, the Product Manager calls `search_evidence`.

| Work item | Size | Confidence | Depends on |
| :-- | :-- | :-- | :-- |
| Spike 5: 20 Vault PRs replayed; features reached per story PR | S | low | release 1 |
| Spike 7: `gh pr list --json files` truncation, refining FR-28's rule | S (2 h) | medium | none |
| `feature-map-14` replay and sweep | M | medium | `feature-map-09b` |
| `feature-map-15` ready-gate warnings | M | medium | spike 5 replay, `feature-map-12` |
| `feature-map-17` the toolkit joined at its pin, `search_evidence` | M | medium | `feature-map-07b` |
| `feature-map-18` expert staleness (not in Delivers) | M | medium | FR-46 in the PRD; PR #63 merged |

**Waves:**

| Area | Wave | Stories | Verified increment on the customer surface |
| :-- | :-- | :-- | :-- |
| map | 7 | `feature-map-14`, `feature-map-17` | FR-45 window fires once, on `6883fee`; a Vault import into `mtg-toolkits` resolves at the pinned SHA |
| ready-gate | 2 | `feature-map-15` | on fx-waves the warning names "wave 2 of A", feature and file; story stays ready |
| experts | 1 | `feature-map-18` | `map.js experts` verdicts printed at role start |
| all of the above | publication | version bump | new version on `main` |

**Verification in this phase:** L2 on fake `bd` and fake `gh`; one `bd` contract check on a host with `bd` (A-14); L5 once.

**Cut list — dropped first if late, in this order:**

| # | Cut | Replacement exit |
| :-- | :-- | :-- |
| 1 | `feature-map-18` | experts unflagged, stated at role start |
| 2 | `feature-map-17` | toolkit imports listed as cross-repo dangling with the pin row; the `search_evidence` line reads "not measured" |
| 3 | `feature-map-15` | the gate stays information only (release 1); FR-18, FR-19, FR-21 move to Phase 4, by Product Owner record |

### Phase 4: release 3, retirement

**Entry criteria:** release 2; the owner names a usage source (brief OQ 5), else candidates read "instrument first".
**Delivers:** FR-22 to FR-26
**Demonstrable exit:** at `/delivery:realign`, a fx-retire feature moves retiring, hidden, deleted, each citing a record scoped `irreversible`; `git ls-files` and every blob hash unchanged; L5 file of a realign session listing candidates.

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
| realign | publication | version bump | new version on `main` |

**Verification in this phase:** L2 on fx-retire; FR-26 hash check after each stage; L5 once.

**Cut list — dropped first if late:**

| # | Cut | Replacement exit |
| :-- | :-- | :-- |
| 1 | `feature-map-21` | every exclusive file reads "keep the code"; the deletable line reads "not measured" |

### Phase 5: release 4, the product inventory views

**Entry criteria:** release 2; the Product Owner answers PRD OQ 15 (who declares personas served).
**Delivers:** FR-30 to FR-39
**Demonstrable exit:** a hidden coupling cited by path and line; `plan.js select` gives "builds on verified F via `x.js`"; a retired persona leaves F "unserved"; L5 file of a planning session reading the `select` reason.

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
| all of the above | publication | version bump | new version on `main` |

**Verification in this phase:** one L2 fixture per criterion (thin: advisory, read-only); L5 once.

**Cut list — dropped first if late, in this order:**

| # | Cut | Replacement exit |
| :-- | :-- | :-- |
| 1 | `feature-map-27` | the "unserved" line reads "not measured" |
| 2 | `feature-map-25` | no consolidation list, stated |
| 3 | `feature-map-26` | no debt columns, stated |

## Areas

No row cites a `dec-` record yet, so `waves.js roadmapAreas` honours none; the records are asked for at Phase 1 entry.

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

Drawn from the Depends-on columns; the checkpoint is a sequencing choice.

```
Setup → 01 → 02 → Phase 1 L5 (owner) → 04 → 08 → checkpoint (owner) → 05 → 06 → 07b → release-1 L5 (owner) → 13
                                                                         05 → 10 (owner records, A-8) → 11b ┘
feeders:  spike 6 → 01   spike 1 → 02   spike 2 → 05   04 → 07a → spike 3 → 07b   04 → 09a → spike 4 → 09b
```

The owner-record wait (A-8) is the long pole: with no record naming a feature when 05 is verified, 10 and 11b hold the path, or cut 4 is taken. The one builder adds the off-path stories (03, 16, 09a, 09b, 11a, 12, 07a) by their sizes.

**To shorten it, one of these would have to change:** owner records at Phase 1 entry; the Vault to release 2 at the checkpoint; a second builder on 07a and spike 3 beside 08 (sharing only verified 04); or a stated fetch age, which relaxes owner quote 5 (the owner's call).

## Dependencies outside our control

No calendar date is set, so "needed by" is a phase exit or a story.

| Dependency | Owner | Needed by | Status | If it slips |
| :-- | :-- | :-- | :-- | :-- |
| Claude Code starts plugin stdio servers in role sessions, passes `settings.env`, names tools `mcp__plugin_delivery_map__*` (A-1, A-16) | Anthropic (Claude Code); observed by the owner | `feature-map-02` | assumed; spike 1 day one | owner told before any map story; design change or CLI by owner's choice |
| One owner-started role session per host (pc, wintermute, cloud) for spikes 1, 2, 6; one per release for the L5 file | owner | day one; each release's exit | none run yet | 01 and 02 wait; a release without its L5 file reads "cannot independently confirm" on S6 |
| Node 22.13+ with `node:sqlite` on pc, wintermute, cloud (A-3) | owner | `feature-map-01` | 22.22.0 here only | map answers refuse on that host; gates warn |
| Owner records: surface (for `surface.json`), one per new area, one per feature batch labelled `feature:<id>` (A-8) | owner | Phase 1 entry (surface); `feature-map-10` (features) | none exist; asked at Phase 1 entry | `surface.json` cannot pass; cut 4 |
| PRD criteria re-pinned to `df0c0a5` and S-17 reworded | Product Owner | Phase 1 entry | proposed in architecture.md | Phase 1 counts have no accepted criterion |
| Private mirror access to `the-vault` and `mtg-toolkits` from planner hosts (A-4) | owner | `feature-map-05` | spike 2 | that host maps this repository only, said so |
| Full clones of the Vault and `mtg-toolkits` on a named host | owner | spike 3 | the Vault full here (316 commits); `mtg-toolkits` `blob:none` here | spike 3 and 07b wait; cut 5 |
| Vault production answers `/api/health` with `commit` (A-15) | owner (Vercel project) | `feature-map-06` | 2026-10-24 12:4x UTC: `commit` `2f01eab`, equal to `origin/main`; in the local clone since a fetch during review (its parent is `b1ca9eb`), so reachability holds today | `shipped` refuses for the Vault; `--as merged` labelled |
| PR #63 merged (experts, delivery 0.31.0) | owner | `feature-map-13` (version), `feature-map-18` | open | version number moves; `feature-map-18` waits |
| Consumer, not supplier: brownfield-onboarding (PR #62) reads the inventory for its release 1 dry run | owner | our release 1 | brief draft | their MVP 1 waits on ours |
| `gh pr list --json files` reports truncation (A-2) | GitHub | Phase 3 | spike 7; FR-28's 3,000 rule ships first | "not reconciled, truncated" at exactly 3,000 stays |
| A usage source for product features | owner | Phase 4 | brief OQ 5 open | "instrument first", no candidates |

## Requirement coverage

| FR | Phase | Notes |
| :-- | :-- | :-- |
| FR-1 | 1, 2 | merged view at a 40-hex SHA in 1; deployment record in 2 |
| FR-2 | 2 | `feature-map-04` (line evidence from 1) |
| FR-3, FR-4 | 1, 2 | lists in `feature-map-01`; completeness checks in `feature-map-04` |
| FR-5, FR-40, FR-42, FR-44 | 2 | `feature-map-04`, `feature-map-05`; the FR-44 harness skeleton is Phase 1 entry (Setup) |
| FR-6 to FR-9, FR-43 | 2 | `feature-map-10`; FR-8 on the cut list |
| FR-10, FR-12 to FR-15 | 2 | `feature-map-08`; at 40-hex SHAs before `feature-map-05` |
| FR-11 | 2 or 3 | spike 4 decides; last on the cut list (I-1) |
| FR-20 | 2 | information only |
| FR-41 | 2 | `feature-map-05` |
| FR-16, FR-17, FR-45 | 3 | `feature-map-14` |
| FR-18, FR-19, FR-21 | 3 | warnings enabled after spike 5's replay (R-arch-6) |
| FR-27 | 1 | I-4 |
| FR-28, FR-29 | 1 | I-5 |
| FR-22 to FR-26 | 4 | |
| FR-30 to FR-39 | 5 | |
| FR-46 (proposed) | none | not in the PRD (I-6); `feature-map-18` waits for it |

**Deferred:** none. NFR-P2's target is not met as measured (architecture.md); spike 5 puts the unit to the owner.

## Risks

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Role sessions do not load plugin MCP servers | medium | high | spike 1 on day one, against a minimal real server | owner | spike 1 transcript shows no tools |
| No owner record names a feature, so the register stays empty | medium | high | asked at Phase 1 entry; seed prints the labels a record must carry; cut 4 keeps 11a | Product Manager | `feature-map-05` verified with no record |
| Fetch per question too slow on a host | medium | medium | spike 2 per host; fetch age is the owner's call | owner | p90 above 2 s |
| Python precision below 90% | medium | medium | spike 3 decision rule, between 07a and 07b | Delivery Manager | audit below 90% |
| `node:sqlite` changes between Node majors | medium | high | CI on 22 and 24; one wrapper | Delivery Manager | Node 24 job red |
| Release 1's three L items run serially on one builder | high | medium | owner checkpoint before them; cut list; Vault movable | Program Manager | `feature-map-05` exceeds L |
| NFR-P2 pressure hides true edges | high | high | no rule tuned to the number | owner | spike 5 p90 above 3 |
| A green exit on vacuous evidence (aggregate counts, CLI against itself, paper results) | medium | high | tagged-test harness from Setup; `ls-tree` counts; L5 file contents; spike rows with raw output | QA Strategist | an exit line without its artifact |
| This revision has not been re-challenged | medium | medium | run `/delivery:challenge` on it before `agreed` | Program Manager | before `/delivery:stories` |

## Buffer

Time boxes are hard: a stop rule removes scope, never adds time. The cut lists, each with its replacement exit, are the buffer; none is hidden in sizes.

## Open questions for the owner

| # | Question, in your words | Default until answered |
| :-- | :-- | :-- |
| 1 | Is release 1 fixed in what it holds, with the date free to move? | yes |
| 2 | Is `https://mtgvault.cards` the Vault's production address? At 12:4x UTC today it said it serves `2f01eab`. | yes |
| 3 | On day one, can you start one role session on each of pc, wintermute and cloud? Three short checks run there (up to 8 hours in all), and no map work starts until they answer. | as soon as you can; the map waits |
| 4 | At the first team session, will you record three things: that the map's tools in role sessions are where you use it, one decision opening each area above, and one decision per batch of features naming each feature (for example "the invocation ledger")? | release 1 ships without named features |
| 5 | Once you have seen "what this story touches" working on this repository, go on to the Vault in release 1, or ship release 1 for this repository and bring the Vault in release 2? | go on |
| 6 | May a full copy of `mtg-toolkits` be made on one of your machines? The copy here holds only the file list, and the map refuses it. | yes, on cloud |
| 7 | If the check on the August ledger break passes, keep "what a new folder breaks" in release 1, dropped last if late? | yes |
| 8 | Ship the path-spelling fix and the merge-time file check before release 1? | yes |
| 9 | When a commit edits five skills, is "five features reached" noise or truth? Spike 5 shows the numbers. | truth: the target waits |
| 10 | Should experts be flagged when the files they were written from change? If yes, it is added to the PRD first. | not planned until added |

**Word count:** 1365 prose words, code blocks and tables excluded (target 700, cap 1100), measured by deleting fenced blocks with `awk`, then `grep -v '^|' | wc -w`. **Declared overrun:** the 24 challenge findings added evidence rules (R-rm-17, R-rm-24), entry criteria (R-rm-5, R-rm-10, R-rm-18) and live-record exits (R-rm-6); restatement was cut first, and what remains is findings, citations and IDs that later phases read.
