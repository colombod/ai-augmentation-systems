---
description: Start a shipping team for a project from your ordinary Claude Code session: check the prerequisites, ask a few questions, write the team manifest, create the beads database, prepare one directory per role, and print the command that starts each role session. Run it in your own session, never in a role session. Safe to run again: it never overwrites a manifest and only prepares missing roles.
argument-hint: "[project path]"
---

# Start a shipping team

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

You are helping the human (the operator) start a team of role sessions for a project. Everything that writes is done by `start.js`; you ask the questions and run it. Do not write the manifest or prepare roles by hand.

**The script.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/start.js`. If `${CLAUDE_PLUGIN_ROOT}` is empty in your shell, read `~/.claude/plugins/installed_plugins.json`, take the `installPath` of `delivery@ai-augmentation-systems`, and use `node <installPath>/scripts/start.js`; say which path you used.

1. **Not in a role session.** If the environment variable `DELIVERY_ROLE` is set, or a `.delivery-role.json` exists in the working directory or above it, stop: "This is the role session <instance>. Run /delivery:start in your own ordinary session, outside any role directory." Do nothing else.

2. **Prerequisites.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/start.js --check` and show its output verbatim. If it exits 1, list each `FAIL` line with its fix and stop until the human has fixed them. `warn` and `????` lines do not stop you; mention them in one line each.

3. **Ask.** Use `AskUserQuestion` (one call, several questions) for:
   - **Project repo:** where the private project repo is, or should be created. It holds the plan, the team manifest and the operator's decisions; it should be private. Default: `$ARGUMENTS` if given, otherwise the current directory when it is a git repo.
   - **New or existing:** a new project with no code yet, or an existing product. For an existing one, ask for the product repo as a local checkout path or a clone URL; builders get their own worktree of it. For a new one, say the team can be started now without a product repo and a builder prepared later.
   - **Host name:** the name this machine has in the manifest. Default: the short hostname (`hostname -s`).
   - **Preset:** recommend `minimal` (Chief of Staff, Product Manager, Delivery Manager, one builder). `full` adds Staffing (owns the roster), the Progress Observer (keeps the record true, runs on haiku) the Spike Researcher (answers technical unknowns) and the Reality Checker (runs checks on the real customer surface with browser control or computer use). The Reality Checker joins either preset by itself when a declared surface is not scriptable; `--reality-checker` adds it otherwise.
   - **Models:** recommend `balanced` (opus for the Chief of Staff and the Product Manager, sonnet for the Delivery Manager and builders, haiku for the Progress Observer). `quality` also puts the Delivery Manager on opus; `economy` puts the Chief of Staff, Product Manager and Delivery Manager on sonnet and Staffing on haiku. Builders give their subagents a stronger model for size-L stories in every preset. A model can be changed later in `team.json`.
   - **Permission mode** for the role sessions: `default` (no `--permission-mode` flag: each session uses the human's own Claude Code default; the manager roles have their lane's commands pre-allowed), or one of the modes `claude --help` lists. Say that the lane hook checks file writes, shell commands and MCP calls whatever the mode.

   Then run `start.js --check --project <project repo>` once more if the project repo already exists, and mention a missing remote as a warning.

4. **Dry run.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/start.js --project <project repo> --host <host> --preset <preset> --models <models> [--product-repo <path or url>] [--permission-mode <mode>] --dry-run` and show the plan verbatim. Ask the human to confirm it.

5. **Real run.** Run the same command without `--dry-run` and show the output verbatim. If it exits non-zero, show the refusal and stop; never work around it. If it says a manifest already exists, that manifest is kept as it is; say so.

6. **Start the sessions.** Tell the human to run each printed `cd ... && claude ...` line in its own terminal, the Chief of Staff first, and to run `/delivery:team join` in each session once it starts.

7. **How to use the team.** End with these five lines, in your words:
   - Talk to the Chief of Staff for decisions and logistics, and with the Product Manager about product vision; the other sessions send their questions to the Chief of Staff, not to you.
   - It answers from what you already decided, and asks you the rest once, in one ranked briefing.
   - Each of your decisions is recorded with your exact words; to see every question and answer, run `node <plugin root>/scripts/operator.js ledger --project <project repo>`, or ask the Chief of Staff.
   - `/delivery:team`, in any session, shows who is live, stale or missing.
   - When something is refused or blocked, the message names the way out; docs/quickstart.md in the plugin has the troubleshooting list.
