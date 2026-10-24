# Challenge findings: feature-map/roadmap.md

> Adversarial review. Panel: program-manager, product-owner, qa-strategist, feature-critic · Reviewed: 2026-10-24 · Artifact version: `bd104dd`
> Version targeted: n/a — no Version-history table

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 5 | 13 | 6 | 0 |

**Independent convergence:** the server tools depend on declared features, so cut 4 leaves the
owner's server with one tool (program-manager, product-owner); spike 1 sits behind two M stories
though a minimal real server answers it on day one (program-manager, feature-critic); the spikes
needing the owner's hosts should run together first (program-manager, feature-critic); the Vault
exit rests on a commit and clones not in place (qa-strategist, feature-critic).

## Findings

| ID | Severity | Raised by | Claim and failure | Fix | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| R-rm-1 | blocking | program-manager, product-owner | `feature-map-11` (four server tools) depends on `feature-map-10` (declared features), which cut 4 drops; no owner records exist, so cut 4 is likely and the server ships `show_shipped` alone, against "Yes keep the server in this release" | split 11: `get_impact`, `show_blind_spots`, `get_verification` depend on 04/08; only `show_feature` on 10; the server tools survive every cut | open |
| R-rm-2 | blocking | program-manager, feature-critic | spike 1 waits on 01 and 02 (two M) though the tool names come from the server's own `tools/list`; a failed spike spends both first | spike 1 on day one against a minimal real stdio server; 02 follows the decision | open |
| R-rm-3 | blocking | product-owner | blast radius (the owner's first ask) sits behind 05 and 07, the least certain items | order map waves 04, 08/09 on this repo, then 05/06, then 07; 01 already refuses any other commit | open |
| R-rm-4 | blocking | qa-strategist | the mutation harness lands in 04 after the rules it guards ship in 01; Phase 1 exits green on aggregate counts the architecture calls vacuous | harness skeleton in Setup or 01; Phase 1 exit: every Phase 1 rule killed by a tagged test | open |
| R-rm-5 | blocking | qa-strategist | the Vault exit assumes a deployed commit and full clones (Vault, `mtg-toolkits`) no entry criterion provides | entry criterion for spike 3 and 07: full clones on a named host; exit "names the deployed SHA or refuses `unreachable` naming it", both ways | open |
| R-rm-6 | significant | feature-critic | the Phase 2 exit hard-codes "0.30.0 shipped at df0c0a5" while ADR-019 reads the live record; after #63 merges a correct tool says 0.31.0 | every "shipped" exit equals the live record at check time; pinned SHAs for fixtures only | open |
| R-rm-7 | significant | feature-critic | the Phase 1 tool in a role session predates named-ref fetch (05): a call without `--at` resolves a role clone's old HEAD with a real SHA | Phase 1 tool refuses any call without a 40-hex SHA until 05; an L2 test for the refusal | open |
| R-rm-8 | significant | program-manager | spikes 6 and 2 wait on build work and cost the owner three host visits | one owner session per host (pc, wintermute, cloud) runs spikes 1, 2 and 6 before 01 | open |
| R-rm-9 | significant | program-manager | spike 3 audits the scanner 07 builds, and 07 depends on spike 3; spike 4 likewise | a scanner-only slice of 07 before spike 3; the stop rule between the slice and the rest; same for spike 4 | open |
| R-rm-10 | significant | program-manager | the critical path lists edges the tables do not have; the owner-record wait (A-8) is the real long pole | redraw from the tables; ask for owner records at Phase 1 entry, needed by 10 | open |
| R-rm-11 | significant | product-owner | I-1 says runtime reach is last on its cut list; the list cuts 09 first, the only measured catch (6883fee) | 09 to the bottom of the cut list | open |
| R-rm-12 | significant | product-owner | Phase 1 answers omit blind spots and dangling references (claim-guard's missing server shows as shipped) | blind and dangling lists in 01, or every Phase 1 answer labelled "blind spots not computed" | open |
| R-rm-13 | significant | product-owner | merge reconciliation (about 10 lines, FR-28 defines truncation) is deferred behind spike 7, so the map's accuracy goes unmeasured in release 1 | ship it in Phase 1 | open |
| R-rm-14 | significant | product-owner | if Python is cut, "the Vault mapped" is hollow (the Vault is a Python app) | on that cut, release 1 says it maps workflows and manifests only, and Vault answers lead with the blind share | open |
| R-rm-15 | significant | qa-strategist | exit criteria include items the cut lists may drop | a replacement exit line per cut | open |
| R-rm-16 | significant | qa-strategist, product-owner | agent-facing claims in Phases 3-5 are checked by fixtures only | one L5 role-session transcript per release | open |
| R-rm-17 | significant | qa-strategist | L5 evidence has no defined artifact | transcript path and required contents (the tool call, the 40-hex stamp, the matching CLI output); "cannot independently confirm" when missing | open |
| R-rm-18 | significant | qa-strategist | `surface.json` and the PRD re-pin to `df0c0a5` are not scheduled | Phase 1 entry: `surface.json` with S1..S6 and the claim path; PRD criteria re-pinned and accepted | open |
| R-rm-19 | significant | feature-critic | the Phase 1 exit compares the server with the CLI, the same code | compare counts with an independent `git ls-tree` enumeration; mutation-check a missing entry point | open |
| R-rm-20 | minor | feature-critic | "2f01eab is not in the local clone" is now false (a fetch during review brought it); spike 3 corpus pinned at `b1ca9eb`, not the deployed commit | correct the row; re-measure at the deployed SHA and record it with the host | open |
| R-rm-21 | minor | program-manager | Phase 3 waits weeks on spike 5's live PRs and cannot cut 15 | decide from the 20-PR replay; 15 on the cut list | open |
| R-rm-22 | minor | program-manager, feature-critic | Phase 2 holds three L in series with no checkpoint; the harness and tamper set cannot be thinned while declared features can be cut | an internal demo at waves 2-3 with go/no-go; tamper set thins before cut 4 | open |
| R-rm-23 | minor | product-owner | FR-46 is planned though not in the PRD | amend the PRD or drop it from Delivers | open |
| R-rm-24 | minor | qa-strategist, product-owner | spike results and a success signal can be met on paper | record host, Node, command and raw output; a cut signal reads "not measured" | open |
