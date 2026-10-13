---
description: Finish taking this session's role on the shipping team — verify the role marker, prime beads, register with the roster and report to the Chief of Staff. The role directory itself is prepared beforehand by a steward with scripts/prepare-role.js; this skill runs inside it.
argument-hint: ""
---

# Join the team as this session's role

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

You are being asked to confirm the role this directory was prepared for. Do these steps in order and stop at the first that fails.

1. **Find the marker.** Read `.delivery-role.json` in the working directory or an ancestor. If there is none, stop: "This directory was not prepared as a role. A steward runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/prepare-role.js --project <projectRoot> --instance <id>` first, then starts a session in the directory it prints." Do not create one.
2. **Confirm the brief is loaded.** Your context should already start with `# Role: <instance>` from the SessionStart hook. If it does not, read `CLAUDE.local.md` in the role directory now and treat it as binding.
3. **Prime beads.** Run `bd prime`. If `bd` does not answer, stop and say so; do not continue on memory.
4. **Register.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/team-status.js --project <project_root from the marker>` and confirm your instance shows `live` with this session. If it shows `missing`, the SessionStart hook did not run; say so and stop.
5. **Report.** Send one message to the session named `chief-of-staff` (or the instance whose role is chief-of-staff in the routing table) with: your instance id, your host, your model, and either your current claim or "idle, could take: <one bead from bd ready>". If you are the chief-of-staff instance, report to the operator instead.

Then act as your role. Do not narrate these steps beyond one line each.
