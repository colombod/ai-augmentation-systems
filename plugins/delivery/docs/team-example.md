# A full team manifest, explained

`templates/team.json` is the minimal team: Chief of Staff, Product Manager, Delivery Manager (role id `delivery-lead`) and one builder, all on one host. This page shows every field a larger team can use. JSON allows no comments, so the notes follow each block.

## team.json

```json
{
  "project": "acme",
  "prefix": "acme",
  "bd_host": "buildbox",
  "budget": { "builders_cap": 3, "staleness_hours": 2 },
  "roles": [
    { "id": "chief-of-staff",    "brief": "delivery/chief-of-staff",    "host": "pc",       "model": "opus",   "mode": "delegate" },
    { "id": "product-manager",   "brief": "delivery/product-manager",   "host": "pc",       "model": "opus" },
    { "id": "delivery-lead",     "brief": "delivery/delivery-lead",     "host": "pc",       "model": "sonnet" },
    { "id": "staffing",          "brief": "delivery/staffing",          "host": "pc",       "model": "sonnet", "mode": "delegate" },
    { "id": "progress-observer", "brief": "delivery/progress-observer", "host": "buildbox", "model": "haiku",  "steward": true },
    { "id": "spike-researcher",  "brief": "delivery/spike-researcher",  "host": "pc",       "model": "sonnet" },
    { "id": "builder",           "brief": "delivery/builder",           "host": "pc",       "model": "sonnet", "count": 2, "runner": "superpowers", "steward": true },
    { "id": "infra-vercel",      "brief": "project/vercel",             "host": "pc" }
  ]
}
```

- `project`, `prefix` and `bd_host` are required. `prefix` is the bead id prefix; `project` names the default team directory, `<project-root>/../<project>-team`.
- `budget.builders_cap` caps the number of builder instances; `budget.staleness_hours` is when `/delivery:team` calls a silent session stale.
- Each role has an `id` (lower case, digits, `-`), a `brief` (`delivery/<role>` for the plugin's own `roles/`, `project/<name>` for `.delivery/team/briefs/<name>.md`) and a `host` from `hosts.json`.
- `model` is any model name Claude Code accepts. `opus`, `sonnet` and `haiku` are checked; another name is passed through with a warning. Leave it out to use the brief's own `default_model`.
- Optional per role: `mode` (`default` or `delegate`), `runner` for builders (`superpowers`, `attractor`, `plain`), `count` for several instances (`builder-1`, `builder-2`), `steward: true`, and `retired: true` for a role kept only so its records still verify.
- `steward: true` marks the role that converges its host's sessions. A team on more than one host needs one per host that is not `cloud`; a single-host team needs none.
- Roles beyond the minimal four are opt-in: `staffing` (edits this file through its lane), `progress-observer` (live re-checks of what is claimed merged, deployed or verified) and `spike-researcher` (otherwise builders take spikes).
- `product_github` (`owner/name`) is the product's GitHub repository, which the review records and the merge gate read through gh; `start.js --product-repo` records it from the product checkout's origin.
- Older manifests may carry `product_repo`, `budget.max_roles`, and in `hosts.json` `dolt_server` or `check`. No script reads them; they are accepted and ignored.

## hosts.json

```json
{
  "hosts": {
    "pc":       { "kind": "pc",    "bd": "wrapper", "headless": false, "desktop_apps": true },
    "buildbox": { "kind": "ssh",   "bd": "native",  "headless": true,  "desktop_apps": false, "lanes": ["a", "b"] },
    "cloud":    { "kind": "cloud", "bd": "remote",  "headless": true,  "desktop_apps": false }
  }
}
```

- `kind` is `pc`, `ssh` or `cloud`; `bd` says how beads is reached there; `headless` hosts get no browser or desktop tools, and the brief says which host can do that work instead.
