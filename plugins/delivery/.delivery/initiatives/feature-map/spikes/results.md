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
