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
| R-arch-1 | blocking | FR-43 lets model-written text become a declared fact: an inferred, unratified answer is accepted with a rationale (`scripts/lib/operator-records.js:531-533`, verified) and scoped to a whole initiative (`:27`), so a feature name and area a model chose would pass as declared | a declared row cites only a decision or a ratified record whose scope names the feature id; free-text fields are labelled "declared label", never "fact" | fixed: a declared fact needs a `dec-` record or a ratified `ans-` whose scope labels name `feature:<id>` (`repo:<id>` for repo rows); free text is a "declared label" (`declared_labels`), never a fact. Label, not a new scope key: labels are free strings, `operator.js:86` parses `label:feature:F-x`, and `goal:` labels are the precedent (`operator.js:98-103`); no `operator-records.js` change, optional `operator.js --feature` story. Where: architecture.md Interfaces ("What a declared row may assert"), NFR-F6, A-8, risk table; ADR-016 point 3 |
| R-arch-2 | blocking | "shipped" silently means "in git at main": the Vault deploys through Vercel's git integration (`vercel.json` `ignoreCommand`) with a manual fallback (`deploy.yml`), so production can lag or skip commits | resolve "shipped" from a deployment record (GitHub deployments or the Vercel production SHA) and refuse when unknown; otherwise label the view "merged at <sha>" | fixed: "shipped" from a deployment record, read live: the Vault's `/api/health` `commit` (`vault/app.py:305-311`, verified), else the latest successful GitHub `Production` deployment (assumed, A-15); a plugin's marketplace version on `origin/main`, shipped at the first `main` commit that set it, later unbumped commits "merged at <sha>, unreleased". None: refused `no-deployment-record`, `--as merged` labelled. Where: architecture.md Component structure ("What shipped means"), envelope, spike 2, fx-deploy; ADR-019 point 7 |
| R-arch-3 | significant | declared facts are read from the role's own clone, not fetched: a register changed on one host is stale on another while the answer says fresh | fetch the project repo before answering; refuse or name the gap when the declared head differs from origin | fixed: declared facts read at the project repo's `origin/<default>` after a fetch in the same call; unpushed rows counted, never used; fetch failure refuses `feature`. Where: architecture.md "Declared facts are read fresh", envelope `declared`, freshness matrix; ADR-019 point 6, ADR-016 point 3 |
| R-arch-4 | significant | each role clone builds its own mirror (`scripts/prepare-role.js:52-54`): 33 MiB packed times four or five roles per host, and map files are never evicted | one host-level cache under the team directory with alternates to the local product repo; an age or LRU limit; lane protection on that path | fixed: one host cache under the team directory (`<team dir>/.delivery-map/`), mirrors with `--reference-if-able` to the host's product checkout (new `DELIVERY_PRODUCT_CHECKOUT` env from `prepare-role.js`), eviction at 14 days and 2 GiB, lane protection on the path (best effort). Where: architecture.md Component structure table, Codebase context (`cache.js`, `prepare-role.js`), fx-cache; ADR-016 point 1, ADR-019 point 4 |
| R-arch-5 | significant | who can query on which host is unverified: the server's cwd is the role directory (not a repo); credentials on wintermute and cloud; Node on the Windows PC | spike 2 covers first clone and credentials on pc, wintermute and cloud; define how the server finds the project and product repos | fixed: spike 2 now covers first clone, credentials and deployment-record reach on pc, wintermute and cloud; spike 1 checks the server receives `settings.env`; the server finds the project repo from `DELIVERY_PROJECT_ROOT` or `DELIVERY_ROLE_DIR/project`, product repos from `repo.add` rows, never cwd (A-16). Node on the Windows PC stays spike 6. Where: architecture.md Component structure table, spikes 1 and 2; ADR-017 |
| R-arch-6 | significant | NFR-P2 is measured per entry point while the gate fires on cross-area reach, and areas start empty (0 of 29 story files carry `area`): silent on day one, noisy later | warn only when the story has an area and the reach crosses a declared area; replay the last 20 Vault PRs before enabling; informational until then | fixed: the gate warns only when the story has an area and reach crosses a declared area; informational until spike 5 replays the last 20 merged Vault story PRs and the owner sees the warn rate. Where: architecture.md "The ready gate's reach finding", spike 5 |
| R-arch-7 | minor | the contested-field machinery protects a case the lanes almost exclude (one Product Manager) and leaves resolution undefined | one chain per instance; drop `base` and contested until a second declaring role exists | fixed: one chain per instance (the operator-records pattern), `base` and `contested` dropped; `team.json` validation refuses a second declaring instance, and a second one brings `base` back (ADR-016 revisit trigger). Where: architecture.md declared row format and "who writes", NFR-6, A-9; ADR-016 point 3 |
| R-arch-8 | minor | the CLI's `--at` has no stated default | `main`, after a fetch | fixed: `--at` defaults to the remote's default branch (`main`), after a fetch. Where: architecture.md CLI block; ADR-019 point 1 |

## Smallest first release (critic's proposal)

`map.js` CLI (`shipped`, `feature`, `impact`, `blind`, `verify`) over the project repo and the
Vault; rule packs for plugin files, JS, markdown, manifests, Python and workflows; provenance,
the blind list, refusal for another commit, the linear reader, one host cache; "shipped" from a
deployment record or labelled "merged"; declared features as named groups of entry points written
by the Product Manager only; the ready gate prints reach for information. Deferred: the MCP server
until spike 1 passes (the owner asked for it, so it ships next), multi-repo joins, full-text
search, replay and sweep, debt and persona analysis, three-stage retirement, merge-gate
reconciliation, expert staleness (needs FR-46), and the runtime-reach rule until spike 4.

## Resolution (Solution Architect, architecture step 4, 2026-10-24)

All eight findings fixed, none rejected; each was checked against the code first
(`operator-records.js:27`, `:526-557`; the Vault's `vercel.json`, `deploy.yml` and `vault/app.py:305-311`;
`prepare-role.js:52-54`). QA's eight "found untestable" items are fixed in the architecture's table of
that name. Release scope: the critic's smallest release stands except the MCP server, which the owner kept
in the first release ("Yes keep the server in this release", 2026-10-24); spike 1 is first on its
critical path. Recorded in the architecture's phasing note and ADR-017.
