# ADR-017: Ship the map's MCP server as one dependency-free script, read-only

**Status:** proposed
**Date:** 2026-10-24
**Deciders:** Solution Architect (`initiatives/feature-map/architecture.md`); owner through spike 1

## Context

ADR-016 point 4 puts the map behind MCP tools, as the owner asked ("a real 'rag tool'"). The one MCP
server already in this repository shows the failure mode to avoid: `plugins/claim-guard/.mcp.json`
runs `${CLAUDE_PLUGIN_ROOT}/dist/claim-ledger.js`, built by esbuild from TypeScript that imports
`@modelcontextprotocol/sdk` and `zod` (`plugins/claim-guard/ledger/package.json`). `.gitignore:4`
ignores every `dist/` except attractor's, so the bundle is not in git and the shipped server cannot
start; nothing noticed until the feature-map spike found the dangling reference. Here the npm
registry is unreachable, so the SDK cannot be installed to rebuild it either.

The delivery plugin has no `package.json` and no build step; its CI runs `node --test` on built-ins
only (`.github/workflows/delivery-tests.yml`). The lane hook admits an MCP tool for roles without an
explicit `lane_mcp` entry only when the tool's own name starts with a read verb and contains no write
verb (`hooks/scripts/lane.js:44-45`, `1071-1075`).

## Decision

- `scripts/map-mcp.js` is a plain CommonJS script speaking MCP over stdio as newline-delimited
  JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, `ping`, and nothing else. No SDK, no
  schema library, no build output; argument checks are hand-written against each tool's
  `inputSchema`.
- It calls `lib/map/query.js` in-process, so the CLI and the server return the same envelope.
- Tools: `show_shipped`, `show_feature`, `get_impact`, `search_evidence`, `show_blind_spots`,
  `get_verification`, `show_experts`. There is no write tool: declared facts have one write path,
  `map.js declare`, which the lanes can see and scope.
- stdout carries only protocol frames; diagnostics, including `node:sqlite`'s ExperimentalWarning,
  go to stderr or are suppressed. The database opens on the first call, not at start.
- `.mcp.json` at the plugin root declares one server, `map`.

## Alternatives considered

### The MCP SDK, bundled into `dist/`

**Why it was attractive:** the SDK tracks protocol changes; claim-guard already uses it.
**Why rejected:** it needs npm and a build; a bundle under `dist/` is git-ignored here, which is
exactly how claim-guard shipped a server that cannot start.

### CLI only, no MCP

**Why it was attractive:** no new surface; the lanes already understand `node .../map.js`.
**Why rejected:** the owner asked for tools agents query. It stays the fallback if spike 1 shows
role sessions do not load plugin servers.

### Write tools in the server

**Why it was attractive:** one interface for everything. **Why rejected:** a tool call's write is
not a node process the lane recognises as the owning script, and two write paths break the
single-writer rule (PRD FR-6).

## Consequences

**We gain:** a server that installs with the plugin and runs wherever Node 22.13 runs; one envelope
for every reader; reads open to every role through the existing lane rule.

**We accept:** we maintain a small protocol subset by hand, with tests against recorded frames; any
MCP feature beyond tools (resources, prompts, notifications) is out.

**We will need to revisit this if:** the MCP protocol version Claude Code negotiates drops what we
implement; spike 1 shows plugin servers are not loaded in role sessions or their tools are named
differently; or a write through tools becomes necessary.
