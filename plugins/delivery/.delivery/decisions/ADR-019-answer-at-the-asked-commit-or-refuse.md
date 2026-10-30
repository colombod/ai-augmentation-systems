# ADR-019: Answer at the asked commit, building the map there, or refuse

**Status:** partly built

> **Against what shipped (2026-10-30, delivery 0.39.0 to 0.41.2, #91 to #97):** every `map.js` answer is read from git at one resolved 40-hex commit and names it, and a ref that does not resolve is refused. Not built: the host cache and mirrors, fetching before a named ref, refusing shallow and partial clones, and the deployment record for "shipped" (points 2 to 7). A named ref such as `main` is answered at whatever it names in the local clone, without a fetch.
**Date:** 2026-10-24 (amended the same day at architecture step 4, see "Amendment")
**Deciders:** Solution Architect (`initiatives/feature-map/architecture.md`, answering PRD OQ 11 and 19); owner through spike 2

## Context

Owner quote 5: "That inventory MUST always be up to date, fresh and real". The PRD leaves two
questions to this role: where the map is built when planners have no product checkout (OQ 11;
`roles/*.md:3`, only builders have `touches_code: true`), and whether a stale answer is rebuilt or
refused (OQ 19, default rebuild). The spike served any ref and printed the ref, not a SHA (D-1).

Measured here: a linear blob reader takes 87-90 ms for this repository and 90 ms for the Vault's
text blobs; inserting a full map 26 ms; opening one 28-31 ms. A local partial clone
(`mtg-toolkits`, `blob:none`) took 13.1 s to read 31 blobs, fetched lazily over the network.

## Decision

1. **The asked commit is resolved first.** A 40-hex SHA is used as given. A named ref (`main`, a
   branch) is resolved only after a successful `git fetch` of that repository's mirror in the same
   call; the answer carries `asked`, the resolved SHA and `fetched_at`. A failed fetch refuses a
   named ref, naming the error; the caller may pass a SHA. With no `--at`, the ref is the remote's
   default branch (`main`).
2. **A map exists for that commit and rule set, or it is built**, inline, then the question is
   answered. No map for another commit is ever consulted for the answer.
3. **Refused when building is impossible:** unknown or unreachable commit, shallow repository,
   partial clone, `node:sqlite` unavailable. Each refusal is two lines: what and why, then the way
   out.
4. **Where:** in the project repository's session, from private full mirrors in one host cache
   (`<team dir>/.delivery-map/repos/`; `<git-common-dir>/delivery-map/` outside a team session),
   or the project repository itself when it is the product. Nothing is written to a product
   repository.
5. **Live inputs that are not git** (beads, the reviews ledger) are read at answer time and stamped
   with their read time; a stored stamp (the ready gate's `reach`) is reused only when commit,
   Files-table hash, rules hash and declared head all match, and `reach.source` says which.
6. **Declared facts** are read at the project repo's `origin/<default>` after a fetch in the same
   call, never from the role clone's work tree; a failed fetch refuses a question that needs them.
7. **"Shipped" is a deployment record, read live:** the Vault's production `/api/health` `commit`,
   else its latest successful GitHub `Production` deployment; a plugin's marketplace version on
   `origin/main`. With none, `shipped` refuses; `--as merged` answers, labelled "merged at <sha>".

## Alternatives considered

### Serve the last map with a staleness warning

**Why it was attractive:** instant; works offline. **Why rejected:** a warning beside a wrong answer
is still a wrong answer, which owner quote 5 forbids; readers drop warnings.

### A time-to-live cache for named refs

**Why it was attractive:** fewer fetches. **Why rejected for now:** it makes "fresh" mean "fresh as
of N seconds ago". Spike 2 measures fetch latency; if it is too slow, a stated fetch age is the
fallback, and choosing it relaxes the owner's constraint, so it is the owner's call.

### Build only from a commit hook or CI

**Why it was attractive:** no build on the read path. **Why rejected:** a story's base commit can be
any commit, and a missed hook silently becomes a stale map.

## Consequences

**We gain:** staleness is structural; every answer is checkable against one named commit.

**We accept:** an offline session answers only for explicit SHAs; every named-ref answer pays a
fetch (two when declared facts are used: the product mirror and the project repo); a build failure is a refusal, never a degraded answer (the ready gate turns it into a
warning).

**We will need to revisit this if:** spike 2 puts fetch p90 above 2 s; a product repository's build
exceeds the ready gate's budget; planners gain product checkouts; or spike 2 finds no deployment
record answering from a planner host.

## Amendment (2026-10-24, `/delivery:architecture` step 4)

| Point | Was | Now | Why |
| :-- | :-- | :-- | :-- |
| 1 | no default ref | the remote's default branch, after a fetch | R-arch-8 |
| 4 | mirrors per git common dir (per role clone) | one host cache | R-arch-4 |
| 5 | declared facts a live input read locally | stamp reuse made observable (`reach.source`) | QA untestable 5 |
| 6 | (new) | declared facts read at `origin/<default>` after a fetch | R-arch-3 |
| 7 | (new; "shipped" meant "in git at `main`") | a deployment record, or refused | R-arch-2: the Vault deploys through Vercel's git integration with a manual fallback (`vercel.json` `ignoreCommand`, `.github/workflows/deploy.yml`) |
