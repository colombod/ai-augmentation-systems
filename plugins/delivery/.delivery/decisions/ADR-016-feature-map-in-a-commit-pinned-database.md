# ADR-016: Keep the feature and code map in a commit-pinned SQLite database, queried through tools

**Status:** proposed · **not built**: open for the owner

> **Against what shipped (2026-10-30, delivery 0.39.0 to 0.41.2, #91 to #97):** `scripts/map.js` (`lib/codemap.js`, `lib/features.js`) computes every answer from git objects at the resolved commit on each call; there is no SQLite store, no `node:sqlite`, no full-text index. The owner asked for "a real db tech not markdown … a real 'rag tool'" (Context, above). The shipped design does not meet that ask, and no owner record drops it. Whether to build the store, or to accept per-call computation instead, is the owner's decision.
**Date:** 2026-10-24 (amended twice the same day by `/delivery:architecture`, steps 2 and 4, see "Amendment")
**Deciders:** owner (asked for it), Solution Architect (confirmed with amendments in `initiatives/feature-map/architecture.md`)
**Word count:** 827 prose words (cap 600; declared overrun: the owner's two statements are kept verbatim, the decision covers six points, and step 4 tightened points 1 and 3 after the critic pass; tables excluded, `grep -v '^|'`).

## Context

The owner, verbatim: "I want to use proper data structure for the fruste maps and code maps using
a real db tech not markdown we need that to be a real 'rag tool' not something agents read and
hope for the best", and earlier: "That inventory MUST always be up to date, fresh and real"
(`initiatives/feature-map/brief.md`).

Constraints in this repository: the npm registry is unreachable, so nothing can be installed
(`AGENTS.md`, environment facts); plugin scripts use Node built-ins only. Prior art stores maps
as files agents read: Trail-Code writes markdown nodes plus `graft/.graph/wiring.json`;
graphify writes `graph.json` and markdown wiki pages, though both also offer an MCP query
server, and graphify tags every edge EXTRACTED, INFERRED or AMBIGUOUS
(github.com/Graphify-Labs/graphify README, read 2026-10-24).

Measured here (`spikes/db-spike.js`, Node 22.22.0, `node:sqlite`, SQLite 3.50.4):

| Check | Result |
| :-- | :-- |
| FTS5 and recursive CTEs available with no install | yes |
| Build at `528f388` (563 files, 1,654 edges, 71 features) | 4.0 s, 0.99 MB |
| Build at `57d5eca` (565 files), three runs | 2.98, 2.58, 2.73 s; 2.55 s of it is the spike's quadratic blob reader (`map-spike.js:27-44`) |
| Linear reader (`ls-tree -z`, one `cat-file --batch`, Buffer slices) at `57d5eca` | 87-90 ms; inserting 1,654 edges plus FTS 26 ms; cold node, open, read meta 28-31 ms |
| `6883fee` replayed as a recursive SQL query on the map at its parent | the 2 `record-invocation` hooks, 1 hop, same as the in-memory walk |
| Recursive reach query for `scripts/lib/gates.js` | 24 features, 20.6 ms |
| Open the map for a different commit | refused: `stale: map 528f388..., asked 00a5cb1...` |
| Open it for its own commit | answers |

## Decision

1. **Derived map:** one SQLite file per (repository, commit, rule-set hash),
   `map-<repo>-<sha>-<rules12>.db`, built from git objects, renamed into place atomically, in one
   host cache (`<team dir>/.delivery-map/db/`, or `<git-common-dir>/delivery-map/` outside a team
   session) beside full bare mirrors of the product repos, evicted by age and size. A cache: never
   committed, rebuildable, refused for any other commit.
2. **Provenance on every row** (path, line span, matched text, rule) through NOT NULL and CHECK
   columns; commit, extractor and rules hash once in `meta`, stamped on every answer. Every file
   is analysed or has a `blind` row.
3. **Declared facts** are the only hand-made data: `.delivery/map/declared/<instance>.ndjson`, one
   append-only chain per author instance, one declaring instance (the operator-records pattern).
   A row's structure is a fact only when its `source` is a decision or a ratified answer whose
   scope labels name `feature:<id>`; its free text is a "declared label", never a fact. Read at
   `origin/<default>` after a fetch, never from a role clone's work tree. Only `map.js declare`
   writes them.
4. **Agents query, they do not read:** a read-only MCP server (ADR-017) with read-verb tools, and
   the same queries on the CLI for hooks and gates; each answer states its commit, provenance and
   blind spots.
5. Node 22.13 or later for the map only; older Node gets a refusal, the ready gate a warning.
6. **Several repositories:** one map per repository commit; a pin is an extracted row, and the
   pinned repository is mapped at the pinned commit and attached at query time.

## Alternatives considered

### Markdown or JSON files that agents read (Trail-Code, graphify, the spike)

**Why it was attractive:** no runtime; diffable. **Why rejected:** the owner ruled it out; reading
leaves freshness and completeness to the reader; no query can refuse a stale answer.

### A graph database (Neo4j, Kùzu) or a vector store

**Why it was attractive:** native graph queries; semantic search. **Why rejected:** neither can be
installed here; embeddings are model output, which the freshness constraint forbids as fact.
Recursive SQL answered the replay exactly.

### Dolt (already the beads database)

**Why it was attractive:** a SQL database with git-style versions, already synced through
`refs/dolt/data`. **Why rejected for the derived map:** the map is rebuilt from git (its measured parts: read 87-90 ms,
insert 26 ms), so versioning it duplicates git; Dolt is not available in every session. **Why rejected
for the declared facts (decided in amendment):** `bd` is absent in this container and on some
role hosts, and declared facts must be reviewed in pull requests beside the plan they serve; a
tracked append-only file gives both.

### One database per product snapshot (all repositories in one file)

**Why it was attractive:** one file to open. **Why rejected:** a toolkit commit pinned by two
product commits would be built twice.

## Consequences

- An answer is either for the asked commit or refused; staleness becomes a structural property.
- `node:sqlite` prints an ExperimentalWarning on Node 22; the Node minimum rises for this feature.
- A new extractor version changes the rules hash, so the file name: old maps are rebuilt, not migrated.
- The MCP server is new shipped surface: it needs lanes, tests and the doctor check.
- Every declared fact waits for an owner decision whose scope names its feature id (PRD FR-43): batching is the owner's cost.

**We will need to revisit this if:** `node:sqlite` changes its API in a later Node major; a
product repo is too large to rebuild per asked commit within the ready gate's budget; or the owner
relaxes FR-43; or a second declaring instance is needed (then `base` and `contested` return).

## Amendment (2026-10-24, `/delivery:architecture`)

What changed from the first proposal, and why:

| Point | Was | Now | Why |
| :-- | :-- | :-- | :-- |
| 1 | `map-<sha>.db`, location unstated (the spike used the OS temp dir) | keyed by repo, commit and rules hash; in `<git-common-dir>/delivery-map/` | a rule change must not reuse an old map; the temp dir is shared and unprotected |
| 2 | `commit_sha` on every edge row; `blind` held dangling references only | commit once in `meta`; NOT NULL and CHECK columns; every unanalysed file a `blind` row | D-4, D-9; a constraint failure names the missing field (FR-40) |
| 3 | "an append-only file"; Dolt kept open | per-writer chained ndjson with `source` and `base`; Dolt rejected | cross-host merges; FR-43; review in pull requests |
| 4 | tools `shipped`, `feature`, `impact`, `search`, `verify` | read-verb names | `hooks/scripts/lane.js:1071-1075` admits only read verbs |
| 5 | refusal on old Node | plus a ready-gate warning | PRD NFR-7 |
| 6 | single repository | per-repository maps joined through pins | the Vault and `mtg-toolkits` (brownfield brief B7) |
| 1 (step 4) | one cache per git common dir, so per role clone | one host cache under the team directory, alternates to the host's product checkout, eviction | R-arch-4: `scripts/prepare-role.js:52-54` clones the project per role |
| 3 (step 4) | any verifying record; per-session chains with `base` and `contested` | a decision or ratified answer whose scope labels name `feature:<id>`; free text a "declared label"; one chain per instance; read at `origin/<default>` after a fetch | R-arch-1 (`operator-records.js:27`, `:531-533`), R-arch-3, R-arch-7 |
