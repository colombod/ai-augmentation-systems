# Challenge findings: feature-map/architecture.md (critic pass, architecture step 4)

> Read-only critic pass. Panel: feature-critic · Reviewed: 2026-10-24 · Artifact version: `435defd`
> Version targeted: n/a — no Version-history table

## Summary

| Blocking | Significant | Minor | Dropped as preference |
| :-- | :-- | :-- | :-- |
| 2 | 4 | 2 | 0 |

The core rule holds: derived facts from git objects at a resolved commit, provenance on every row,
another commit refused. The weak points are declared facts, the meaning of "shipped", and where
mirrors live.

## Findings

| ID | Severity | Claim and failure | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| R-arch-1 | blocking | FR-43 lets model-written text become a declared fact: an inferred, unratified answer is accepted with a rationale (`scripts/lib/operator-records.js:531-533`, verified) and scoped to a whole initiative (`:27`), so a feature name and area a model chose would pass as declared | a declared row cites only a decision or a ratified record whose scope names the feature id; free-text fields are labelled "declared label", never "fact" | open |
| R-arch-2 | blocking | "shipped" silently means "in git at main": the Vault deploys through Vercel's git integration (`vercel.json` `ignoreCommand`) with a manual fallback (`deploy.yml`), so production can lag or skip commits | resolve "shipped" from a deployment record (GitHub deployments or the Vercel production SHA) and refuse when unknown; otherwise label the view "merged at <sha>" | open |
| R-arch-3 | significant | declared facts are read from the role's own clone, not fetched: a register changed on one host is stale on another while the answer says fresh | fetch the project repo before answering; refuse or name the gap when the declared head differs from origin | open |
| R-arch-4 | significant | each role clone builds its own mirror (`scripts/prepare-role.js:52-54`): 33 MiB packed times four or five roles per host, and map files are never evicted | one host-level cache under the team directory with alternates to the local product repo; an age or LRU limit; lane protection on that path | open |
| R-arch-5 | significant | who can query on which host is unverified: the server's cwd is the role directory (not a repo); credentials on wintermute and cloud; Node on the Windows PC | spike 2 covers first clone and credentials on pc, wintermute and cloud; define how the server finds the project and product repos | open |
| R-arch-6 | significant | NFR-P2 is measured per entry point while the gate fires on cross-area reach, and areas start empty (0 of 29 story files carry `area`): silent on day one, noisy later | warn only when the story has an area and the reach crosses a declared area; replay the last 20 Vault PRs before enabling; informational until then | open |
| R-arch-7 | minor | the contested-field machinery protects a case the lanes almost exclude (one Product Manager) and leaves resolution undefined | one chain per instance; drop `base` and contested until a second declaring role exists | open |
| R-arch-8 | minor | the CLI's `--at` has no stated default | `main`, after a fetch | open |

## Smallest first release (critic's proposal)

`map.js` CLI (`shipped`, `feature`, `impact`, `blind`, `verify`) over the project repo and the
Vault; rule packs for plugin files, JS, markdown, manifests, Python and workflows; provenance,
the blind list, refusal for another commit, the linear reader, one host cache; "shipped" from a
deployment record or labelled "merged"; declared features as named groups of entry points written
by the Product Manager only; the ready gate prints reach for information. Deferred: the MCP server
until spike 1 passes (the owner asked for it, so it ships next), multi-repo joins, full-text
search, replay and sweep, debt and persona analysis, three-stage retirement, merge-gate
reconciliation, expert staleness (needs FR-46), and the runtime-reach rule until spike 4.
