---
description: Show the shipping team — every role instance in team.json, which session holds it, whether it is live, stale or missing, and any drift between the manifest and the roster (read-only). With "join", run in a role session that has just started — confirm the role marker and brief, prime beads, check the roster registration and report to the Chief of Staff.
argument-hint: "[join]"
---

# Team: status and join

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

If `$ARGUMENTS` is `join`, do **Join** below and nothing else. Otherwise do **Status**.

## Status

Read-only. This part reports; it changes nothing.

1. Resolve the project root: the `project_root` in `.delivery-role.json` when this is a role session (found upward from the working directory), then `DELIVERY_PROJECT_ROOT` from the environment, then the directory holding `.delivery/team/team.json` found upward from the working directory. If none is found, say so and stop.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <root>` and show its output verbatim.
3. If the output has a `## Roster drift` section, say in one line who owns each kind: missing or extra instances and wrong models belong to Staffing (and the host's steward applies the fix); stale instances belong to the Progress Observer's liveness sweep. Do not fix anything yourself.
4. Plan drift. For each initiative under `.delivery/initiatives/` that has a `roadmap.md`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project <root> --initiative <slug> --check` and show its output. The Delivery Manager owns a changed roadmap, title and phase drift, stories or spikes without a bead, dependency drift and stray roadmap beads; the Product Manager owns a closed phase review whose roadmap phase is not marked `(done)`.


## Join

Run in a role session that has just started in its role directory. You are being asked to confirm the role this directory was prepared for. Do these steps in order and stop at the first that fails.

1. **Find the marker.** Read `.delivery-role.json` in the working directory or an ancestor. If there is none, stop: "This directory was not prepared as a role. A steward runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/prepare-role.js --project <projectRoot> --instance <id>` first, then starts a session in the directory it prints." Do not create one.
2. **Confirm the brief is loaded.** Your context should already start with `# Role: <instance>` from the SessionStart hook. If it does not, read `CLAUDE.local.md` in the role directory now and treat it as binding.
3. **Prime beads.** Run `bd prime`. If `bd` does not answer, stop and say so; do not continue on memory.
4. **Register.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <project_root from the marker>` and confirm your instance shows `live` with this session. If it shows `missing`, the SessionStart hook did not run; say so and stop.
5. **Report.** Send one message to the session named `chief-of-staff` (or the instance whose role is chief-of-staff in the routing table) with: your instance id, your host, your model, and either your current claim or "idle, could take: <one bead from bd ready>". If you are the chief-of-staff instance, report to the operator instead.

Then act as your role. Do not narrate these steps beyond one line each.
