# Spike results: feature-map

Each result records host, Node, command and raw output (roadmap evidence rule). A result that
could not be run in full says what is missing.

## Spike 1 (partial): an MCP server in a role session, cloud host

**Host:** cloud (this Claude Code on the web container), 2026-10-24 ~13:10 UTC · **Node:** v22.22.0 ·
**Claude Code:** 2.1.310 · **Role directory:** `/home/user/the-vault-planning-team/builder-1`,
prepared by `prepare-role.js` from branch `delivery-project-experts` for `the-vault-planning`.

**Server:** `spikes/mcp-spike.js`, one tool `show_shipped` reporting its own environment.

**Not run as specified:** installing the delivery plugin with the server in its `.mcp.json` was
refused in this session (installing a plugin changes Claude's own configuration). The server was
given to the session with `--mcp-config` instead, so this run shows the stdio protocol, the tool
name outside a plugin, and the environment, but **not** the plugin-scoped tool name, the plugin's
`CLAUDE_PLUGIN_ROOT`, or the lane hook's admission (the plugin's hooks were not loaded).

Run 1, no permission rule for the tool:

```
claude -p "Call the MCP tool show_shipped exactly once ..." --mcp-config spike-mcp.json --max-turns 3 --output-format json
is_error: false turns: 2
Line 1: mcp__map__show_shipped
Line 2: Claude requested permissions to use mcp__map__show_shipped, but you haven't granted it yet.
```

Run 2, the tool allowed (`--allowedTools mcp__map__show_shipped`):

```
mcp__map__show_shipped
{"cwd":"/home/user/the-vault-planning-team/builder-1","DELIVERY_PROJECT_ROOT":"/home/user/the-vault-planning","DELIVERY_ROLE_DIR":"/home/user/the-vault-planning-team/builder-1","DELIVERY_ROLE":"builder-1","CLAUDE_PLUGIN_ROOT":null,"node":"v22.22.0","at":null}
```

The role's settings (`.claude/settings.local.json`) hold the same `DELIVERY_PROJECT_ROOT` and
`DELIVERY_ROLE_DIR`.

| Assumption | Result |
| :-- | :-- |
| A-16: the server receives the role's `settings.env` | **observed** on cloud via `--mcp-config` |
| The server can find the project repo without its cwd | **observed**: `DELIVERY_PROJECT_ROOT` present; cwd is the role directory |
| A-1: tool names and lane admission for the plugin's own server | **not observed** (plugin not installed; hooks not loaded) |

**New finding:** a role session cannot call the server's tools without an allow rule, and
`prepare-role.js` writes allow rules for the lane's commands only. The map's read tools need
allow rules for the roles that query the map, written by `prepare-role.js` and covered by a test.

**Still needed:** the same run with the plugin installed (plugin-scoped tool name, the lane hook),
on pc, wintermute and cloud, in a session where installing the plugin is allowed.

## Spikes 2 and 6: cloud host, from Vault onboarding day one

**Source:** `colombod-personal/the-vault-planning` at `9604199`,
`.delivery/initiatives/onboarding/day-one-cloud.md` (a separate cloud session, 2026-10-24 13:55-13:57
UTC, Node v22.22.0, git 2.43.0). The rows below were re-checked in this session at about 14:05 UTC
where marked.

| Check | Result | Re-checked here |
| :-- | :-- | :-- |
| spike 6: `node:sqlite` on Node 22.22.0 | SQLite 3.50.4, FTS5 present, ExperimentalWarning printed | yes: `3.50.4`, FTS5 table created |
| spike 6: `node:sqlite` on Node 20.20.0 | `ERR_UNKNOWN_BUILTIN_MODULE` | no |
| spike 2: full clone, the-vault (316 commits, 35 MiB `.git`) | 3.73 s | count yes (316) |
| spike 2: full clone, mtg-toolkits (7 commits) | 0.55 s | no |
| spike 2: no-op fetch, three samples each | the-vault 0.31-0.47 s; mtg-toolkits 0.29-0.34 s | no |
| spike 2: credentials for clone and fetch | none; both repos are public | no |
| spike 2: deployment record | `/api/health` `commit` `2f01eab`, equal to `origin/main` | yes: `2f01eab` both |
| spike 2: GitHub deployments API (A-15) | 403 from the session proxy; not answered | no |

**New finding:** the health response's `deployment` field changed between the two checks
(`the-vault-5o309mo5l-...` at 13:56, `the-vault-532iolc5s-...` at about 14:05) while `commit`
stayed `2f01eab`. "Shipped" keys on `commit` only; the deployment id is not a stable identity.

**Not measured:** fetch p90 (three samples give a max, not a p90); spike 1 with the plugin installed
(the plugin install and its scripts were refused by that session's permission checks); every
Wintermute and PC row. The Wintermute steps are in the-vault-planning
`.delivery/initiatives/onboarding/day-one-wintermute-runbook.md` (`cb149fd`).

## Spikes 2 and 6: wintermute host, from Vault onboarding day one

**Source:** `colombod-personal/the-vault-planning` at `48d13ca`,
`.delivery/initiatives/onboarding/day-one-wintermute.md` (a Remote Control session on Wintermute,
2026-10-24 about 16:00 UTC; Ubuntu 26.04.1, Node v22.23.3, git 2.53.0, bd 1.1.2, gh signed in).
`/api/health` re-checked here after the run: `commit` `2f01eab`, deployment `the-vault-532iolc5s`.

| Check | Result |
| :-- | :-- |
| spike 6: `node:sqlite` on Node 22.23.3 | SQLite 3.51.3, FTS5 present, ExperimentalWarning |
| spike 2: full clone | the-vault 3.05 s; mtg-toolkits 0.57 s |
| spike 2: no-op fetch, ten samples each | the-vault p50 0.341 s, p90 0.365 s; mtg-toolkits p50 0.341 s, p90 0.369 s |
| spike 2: credentials | none (anonymous `ls-remote` with the credential helper disabled) |
| spike 2: `/api/health` at 16:00:43Z | `commit` `2f01eab`, equal to `origin/main` |
| spike 2: GitHub deployments API (A-15) | answered: three records, all `2f01eab`: `Production` by `vercel[bot]` at 12:17:47Z; `vercel-production` by `colombod` at 13:59:14Z and 14:07:10Z |

**A-15:** Vercel's git integration writes a GitHub deployment (`Production`, `vercel[bot]`). Two more
records for the same commit were made by the owner's account under a different environment name,
`vercel-production`, which matches the deployment id changing between the cloud checks at 13:56 and
14:05. So a deployments-API reader must accept both environment names, must not count a redeploy of
the same commit as a new release, and `/api/health` `commit` stays the primary record (ADR-019 point 7).

**Not measured on wintermute:** spike 1 and every plugin step. The auto-mode check refused
`claude plugin marketplace add` for the local clone, as on the cloud host's first pass.
