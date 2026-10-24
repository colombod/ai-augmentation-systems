# ADR-016: Keep the feature and code map in a commit-pinned SQLite database, queried through tools

**Status:** proposed
**Date:** 2026-10-24
**Deciders:** owner (asked for it), Solution Architect (to confirm in `/delivery:architecture`)

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
| `6883fee` replayed as a recursive SQL query on the map at its parent | the 2 `record-invocation` hooks, 1 hop, same as the in-memory walk |
| Open the map for a different commit | refused: `stale: map 528f388..., asked 00a5cb1...` |
| Open it for its own commit | answers |

## Decision

1. **Derived map:** one SQLite file per commit, named `map-<full sha>.db`, built from git
   objects at that commit, written to a temporary name and renamed atomically. It is a cache:
   never committed, always rebuildable, and refused when its commit is not the asked one.
2. **Every row carries provenance:** commit, path, line span, matched text and extraction rule
   (PRD NFR-F1); a fact without them is not inserted. Unanalysed files are rows in a `blind`
   table, never silent.
3. **Declared facts** (feature names, areas, retirement states, owner records) are the only
   hand-made data. They live in the project repo as an append-only file written by one script,
   reviewed in pull requests, and are loaded into the database at build time with their
   declarer and record id. They are never extracted, and extracted rows are never edited.
4. **Agents query, they do not read:** an MCP server in the plugin (as `claim-guard` ships one)
   exposes `shipped`, `feature`, `impact`, `search` and `verify`, each answer stating the commit
   it describes and its blind spots. The CLI exposes the same queries for hooks and gates.
5. Node 22.13 or later becomes the plugin's minimum for the map only; older Node gets a refusal
   naming the version, and every other script keeps working.

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
`refs/dolt/data`. **Why rejected for the derived map:** the map is rebuilt from git in seconds, so
versioning it duplicates git; Dolt is not available in every session. **Kept open** for the
declared facts, which could sit beside the beads (architecture to decide).

## Consequences

- An answer is either for the asked commit or refused; staleness becomes a structural property.
- `node:sqlite` prints an ExperimentalWarning on Node 22; the Node minimum rises for this feature.
- A second extractor version needs a schema version in `meta`; old files are rebuilt, not migrated.
- The MCP server is new shipped surface: it needs lanes, tests and the doctor check.
