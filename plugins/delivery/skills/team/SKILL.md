---
description: Show the shipping team — every role instance in team.json, which session holds it, whether it is live, stale or missing, and any drift between the manifest and the roster. Read-only.
argument-hint: ""
---

# Team status

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

Read-only. This skill reports; it changes nothing.

1. Resolve the project root: the `project_root` in `.delivery-role.json` when this is a role session (found upward from the working directory), then `DELIVERY_PROJECT_ROOT` from the environment, then the directory holding `.delivery/team/team.json` found upward from the working directory. If none is found, say so and stop.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <root>` and show its output verbatim.
3. If the output has a `## Roster drift` section, say in one line who owns each kind: missing or extra instances and wrong models belong to Staffing (and the host's steward applies the fix); stale instances belong to the Progress Observer's liveness sweep. Do not fix anything yourself.
4. Plan drift. For each initiative under `.delivery/initiatives/` that has a `roadmap.md`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project <root> --initiative <slug> --check` and show its output. The Delivery Lead owns stories without a bead, stale references and stray roadmap beads; the Product Manager owns a closed phase review whose roadmap phase is not marked `(done)`.
