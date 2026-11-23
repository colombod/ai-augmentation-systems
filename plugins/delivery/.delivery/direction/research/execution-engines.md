# Execution engines for a bounded sprint: research note

Date: 2026-11-22. Claude Code on the machine this was written on: 2.1.330.

Question: how could a sprint run as a bounded piece of work with focused agents, with no standing team? The sprint is defined in [Intent to increment](../contracts/intent-to-increment.md) and [Spend and idle](../contracts/spend-and-idle.md): deliverables declared up front, bounds on time, spend and review rounds, and an end when deliverables verify or a bound is reached.

Method: primary sources only. These are Anthropic's docs at `code.claude.com/docs`, the claude.com article on always-on agents, this repo's `plugins/attractor`, and the clones of `strongdm/attractor` (sha `fb57a55`) and `microsoft/amplifier-bundle-attractor` (sha `36bff7b`). Nothing was run. Several long doc pages were cut off by the fetch tool. Where a finding rests only on a model-made summary of a cut-off part, it is marked **(summary)** and not relied on for a decision. Source pages are listed at the end.

## Answers

1. **Can a sprint be one bounded run that stops when deliverables verify or a bound is hit?** Partly, and only with a wrapper of our own. `claude -p` has hard caps on spend (`--max-budget-usd`) and on turns (`--max-turns`). `/goal` keeps a run going until a condition is judged met. But there is no documented wall-clock limit for a run, no token budget, and no cap on review rounds, and the goal's own turn or time clause is advisory. Time and review-round bounds must be enforced by the runner.
2. **Can a wake be an event with a recorded reason?** Not natively, apart from one narrow case. The inbox, timers and outbox in the always-on article are patterns for us to build. `ScheduleWakeup` takes a `reason`, which is shown to the user and recorded in telemetry. A wrapper that appends each event, with its reason, to a file and passes it as the run's prompt does this today.
3. **Can each run start fresh from a small working record?** Yes. `claude -p` starts fresh unless told to resume. `--bare` skips hooks, plugins, memory and CLAUDE.md, and the docs recommend it for scripted calls. Subagents start fresh. Attractor nodes are fresh by default.
4. **Can the owner's stop be a first-class control of the engine?** For some engines, from a plain shell. Background sessions have `claude stop <id>` and `claude daemon stop --any`. A `claude -p` process can be sent SIGINT or SIGTERM. Nothing documented is a single stop for everything, and the attractor engine has no stop at all. In practice the stop is SIGINT to the `claude -p` process, or Ctrl+C, and nothing of ours is needed beyond documenting it.

## Summary

| Engine | How a run ends | Hard caps | Stop from outside | Fresh start | Main gap for a sprint |
| --- | --- | --- | --- | --- | --- |
| `claude -p` / Agent SDK | Result subtype: success, max turns, max budget, error | `--max-turns`, `--max-budget-usd` (print mode only; spend can overshoot by one response) | SIGINT ends the turn; SIGTERM exits 143 and drops the turn in progress | Yes unless resumed | No wall-clock limit, no token budget |
| `/goal` | Evaluator judges the condition met or impossible, or progress stalls | None built in; a turn or time clause in the condition text | `/goal clear`; Ctrl+C or a kill for `-p` | Restored on resume, with counters reset | The evaluator cannot call tools, so it only judges what the agent says |
| `/loop`, cron, wakeups | Cancel, `stop: true`, 7-day expiry, session exit | 50 tasks per session; no iteration or spend cap | Esc, `CronDelete`, `CLAUDE_CODE_DISABLE_CRON=1` | Each fire sends the full context | Session-scoped; not a sprint engine |
| Cloud scheduled tasks | Not specified | Hourly run limits; schedule no more often than hourly | Web UI pause, delete, cancel; organisation toggle | New run each time | Time-triggered only; spend draws on the subscription |
| Background sessions (`--bg`) | Finished, failed or stopped | None of its own; `--max-budget-usd` covers background subagents | `claude stop`, `claude kill`, `claude daemon stop --any` | Per session | Cannot combine with `-p` |
| Subagents | Result returns; turn limit gives partial output | `maxTurns` per definition; 20 concurrent; depth 3 | Parent's controls; `TaskStop` | Yes | No per-subagent dollar cap |
| Workflows | Script finishes, or stopped | 16 concurrent, 1,000 agents per run | `x` in `/workflows`; SIGINT | Yes | No dollar cap or time limit documented |
| Attractor (local and spec) | Exit node after goal gates; step cap 500 | Per-node `timeout`, `max_retries`; step cap | None implemented | Yes, by default | No run-level time or spend cap; no stop; no resume |

## 1. `claude -p` and the Agent SDK

- **What it is.** `-p` runs Claude Code non-interactively. The SDK is the same engine as TypeScript and Python packages.
- **Bounds, by exact name.** CLI `--max-turns` and `--max-budget-usd`; TypeScript `maxTurns` and `maxBudgetUsd`; Python `max_turns` and `max_budget_usd`. The docs say of the turn limit "No limit by default" and say of the budget "Stop the run once estimated spend on API calls reaches this amount (print mode only)". Spend from subagents counts toward it. "Spend can pass the cap" by up to the cost of the response that reaches it, plus whatever running subagents spend before they stop.
- **Not found:** a token budget and a run timeout, in the sections read. Python lists a `task_budget` option whose meaning I did not read.
- **Other levers.** `--permission-mode dontAsk` denies anything that would prompt. `--permission-prompts none` (v2.1.259 and later) does the same and tells Claude nobody can approve. `--allowedTools` does not restrict by itself; `--disallowedTools` does. `--fallback-model`, `--no-session-persistence`, `--resume`, `--continue` and `--fork-session` exist. Since v2.1.302 a `claude -p` run with no permission mode set starts in manual mode, which denies a call that needs approval.
- **How it ends.** Result subtypes are `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution` and `error_max_structured_output_retries`. There is also a `terminal_reason` field with values such as `completed`, `max_turns`, `budget_exhausted`, `hook_stopped` and `tool_deferred`.
- **Stopping from outside.** SIGINT ends the turn. SIGTERM "exits with code 143 ... leaves the turn that was in progress unfinished and records no result for it." In the SDK, `interrupt()` works only in streaming input mode; `close()` terminates the process; TypeScript also has `abortController` and `stopTask()`.
- **After the turn ends**, a `-p` run can wait for background work, and stops waiting after 10 minutes of idleness by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`).
- **Cost readout.** The JSON result carries `total_cost_usd` and per-model `modelUsage`. The docs call these client-side estimates and say not to use them to bill or for financial decisions.

## 2. `/goal`

The plugin's own `goal.js` is an owner-pause record and is unrelated. Claude Code does have a feature of this name.

- **What it is.** "The `/goal` command sets a completion condition and Claude keeps working toward it without you prompting each step. After each turn, a model checks whether the condition holds." It wraps a session-scoped prompt-based Stop hook.
- **Unattended.** "Setting a goal with `-p` runs the loop to completion in a single invocation." Run it in auto mode, because a goal does not change the permission mode.
- **Limits.** The condition can be 4,000 characters. There is no turn, time or dollar cap built in. "To bound how long a goal runs, include a turn or time clause in the condition, such as `or stop after 20 turns`", which the evaluator judges from the conversation. The docs do not say how `/goal` interacts with `--max-turns` or `--max-budget-usd`. That is unconfirmed.
- **The evaluator** is a small fast model, billed on top of the main turns, and "does not call tools". It can only judge what the agent has put in the conversation.
- **How it ends.** The evaluator says the goal is met or impossible, or progress stalls (several turns with no tool use), or an error clears it. A usage limit pauses it, and it resumes after the reset if the session is waiting.
- **Stopping.** `/goal clear`, or Ctrl+C or a kill for a `-p` run. There is no documented external command for an interactive session's goal.
- **Unavailable** when `disableAllHooks` is true or `allowManagedHooksOnly` is set.
- **Consequence for us.** A goal is a convenient way to keep one assignment going until a builder reports its condition met. It is not independent verification. [Verification and evidence](../contracts/verification-and-evidence.md) requires a separate check.

## 3. `/loop`, cron, wakeups and cloud scheduled tasks

- **`/loop`.** Interval form `/loop 5m ...` becomes a cron job, with a one-minute minimum. Self-paced form picks a delay of one minute to one hour each iteration through `ScheduleWakeup`, and Claude ends it by calling that tool with `stop: true`.
- **Limits.** Recurring tasks expire after 7 days, with a final fire. 50 tasks per session. Tasks fire only while Claude Code is running and idle. A self-paced loop is not restored on resume.
- **Cost.** "A session-scoped scheduled task fires on its interval even while the session is idle, sending your full context each time." `/usage` lists the heaviest loops. No spend cap per loop was found.
- **Stopping.** Esc on an empty prompt, or asking Claude to cancel (it uses `CronDelete`). `CLAUDE_CODE_DISABLE_CRON=1` disables the scheduler entirely.
- **Cloud scheduled tasks** (`/schedule`, claude.ai/code/routines). Minimum interval one hour, and 100 scheduled runs an hour per account **(summary)**. The owner can pause, delete or cancel from the web UI, and an organisation owner can switch the feature off. Runs draw on subscription usage, and without usage credits they are rejected after the limit **(summary)**.
- **Fit.** These are time triggers. They suit an explicit checkpoint. They do not bound a sprint.

## 4. Background sessions and stop controls

- `claude --bg "prompt"` starts a background session and cannot be combined with `-p`.
- From a plain shell: `claude agents`, `claude attach`, `claude logs`, `claude stop <id>` (alias `claude kill`), and `claude daemon stop --any`, which "stop[s] the background-session supervisor and the sessions it hosts." This is the best-documented owner stop for local sessions.
- Spend is the same as an interactive session, "ten agents in parallel uses quota roughly ten times as fast".
- Other off switches by environment variable: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.

## 5. Subagents and model choice

- **Precedence, verbatim.** "When more than one source sets a model, Claude Code uses the first in this order: 1. The per-invocation `model` parameter ... 2. The `model` field in the subagent's definition ... 3. The `CLAUDE_CODE_SUBAGENT_MODEL` environment variable 4. The main conversation's model."
- **So the environment variable is a default, not an override.** It overrides the first two only when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257 and later) is set, and it did before v2.1.251. It also does not change the built-in Explore and Plan agents.
- **Limits.** 20 concurrent subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), nesting depth 3, `maxTurns` per definition, which returns partial output and can be resumed. The parent's `--max-budget-usd` covers subagents. No per-subagent dollar cap was found.
- **Definition `model`** takes `sonnet`, `opus`, `haiku`, `fable`, a full ID, or `inherit`.
- **Not stated** in the pages read: whether the session's own hooks apply to a subagent's tool calls.

## 6. Workflows

- **What it is.** "A dynamic workflow is a JavaScript script that orchestrates many subagents at once." The API is `agent()`, `pipeline()`, `parallel()`, `phase()` and `log()`. Runs replay deterministically, so `Date.now()` and `Math.random()` throw.
- **Limits.** 16 concurrent agents by default (up to 256), 4,096 items in one call, 1,000 agents per run. An agent restarts at most 5 times when it stalls.
- **Cost.** No dollar cap or time limit is documented. A "Large workflow" warning appears above 25 agents or a projected 1.5 million tokens, and it "is advisory: it doesn't pause or limit the run." The `workflowSizeGuideline` setting is advice, not a cap.
- **Stopping and resuming.** In `/workflows`, `x` stops an agent or the run and `p` pauses. A stopped run can be relaunched and replays saved results. The SDK tool takes `resumeFromRunId`.
- **Unattended.** Works in `-p` and the SDK, but the Workflow call needs a permission route (an allow rule, auto mode, a hook that allows it, or a permission prompt tool). Whether the parent's `--max-budget-usd` stops a running workflow is inferred, not stated.
- **Fit.** Good for fanning out reviews or builders inside one assignment. It does not bound a sprint's time or spend on its own.

## 7. Hooks

- **Decisions.** PreToolUse returns `permissionDecision` of `allow`, `deny`, `ask` or `defer`, inside `hookSpecificOutput`. Precedence across hooks is deny, then defer, then ask, then allow.
- **`defer` is narrow.** "Claude Code honors `"defer"` only in non-interactive mode with the `-p` flag, and only when Claude makes a single tool call in the turn." In an interactive session "it logs a warning and ignores the hook result." The turn ends with `stop_reason: "tool_deferred"`, the caller reads `deferred_tool_use`, and resumes with `claude -p --resume <session-id>`. "There is no timeout or retry limit"; the session stays on disk until the 30-day retention sweep. So `defer` suits a `claude -p` sprint run, not an interactive session. Interactive sessions use `ask`.
- **`ask` under `-p`** is not stated for PreToolUse. The docs say a denied call in a `-p` run, where no one can answer, shows Claude the reason. Treat the behaviour as unconfirmed.
- **Failure is open by default.** A hook that exits with a code other than 0 or 2, crashes, times out, or prints invalid JSON is a non-blocking error and the call goes ahead. Exit 2 blocks. Blocking on failure is opt-in through `onFailure: "block"` (v2.1.295 and later). The default hook timeout is 600 seconds for command hooks.
- **Hooks run in every permission mode.** A `deny` blocks the tool even under `bypassPermissions`.
- **Off switches.** `disableAllHooks: true`, or `--settings '{"disableAllHooks": true}'` for one run. "There is no way to disable an individual hook while keeping it in the configuration." No environment variable that disables hooks was found. A managed-settings `disableAllHooks` is needed to disable managed hooks.
- **Not a reliable hard gate.** The docs warn that matching on Bash commands is best-effort, and they point to permission rules and the sandbox for hard allow or deny.
- **Stop hooks.** `decision: "block"` keeps Claude working. `stop_hook_active` signals a continuation, and after eight blocks in a row with no tool call, Claude Code overrides the next one (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it).
- **Read in part only.** The reference page was 293,934 characters. About 100,000 characters in the middle were read as a summary. Treat details from there as unconfirmed.

## 8. Attractor

Sources: the local plugin `plugins/attractor`, the spec `strongdm/attractor`, and `microsoft/amplifier-bundle-attractor`.

- **What a run is.** A DOT graph executed node by node. Local LLM nodes are `claude -p` subprocesses. The traversal is single-threaded.
- **Ends.** The exit node runs only when goal gates pass. Per-node `timeout` and `max_retries` exist. The local engine has a step cap of 500 node dispatches (`DEFAULT_MAX_STEPS`) and fails the run when it is reached. The spec has no run-level step, time or cost cap.
- **Review rounds.** There is no numeric counter in the condition grammar. A bounded loop is built with a file-based counter in a tool node. The graph-level retry ladder "is **not bounded by `max_retries` at all**", with the 500-step cap as the backstop.
- **Spend.** `--max-budget-usd` is passed to each node's `claude -p`, so it is a per-node cap, the same for every node. There is no cumulative budget.
- **Stop and resume.** None implemented locally. There is no signal handler, no cancel command and no stop file. `loadCheckpoint` exists but is unreachable, and the audit says the checkpoint omits the failed-output ledger. An external kill leaves the last per-node checkpoint and the worktree, but nothing reads them back. Amplifier has `dot-runner resume` and a `max_pipeline_duration` cap, which the strongdm spec does not.
- **Fresh runs.** Each node's prompt is only its substituted text, so nodes are fresh by default. `compact` and `summary` fidelity are not implemented locally.
- **Model per node.** `llm_model` per node works. The stylesheet does not.
- **Human gates.** A `hexagon` gate blocks on a terminal, or is answered by an agent or a command channel. There is no park-and-resume across a restart.
- **Defaults to note.** Tools default to `Bash,Read,Write,Edit` with `bypassPermissions`.
- **Not read:** `dist/` against `engine/src`, the ADRs, `engine-semantics.md`, and large parts of the audit file and spec.
- **Reading for a sprint.** Deliverables, verify-then-stop, per-node time and model all map. Whole-sprint time and spend, review-round counting, an owner stop and resume do not.

## 9. The always-on article, as primitives

Source: "Building always-on agents" (claude.com, 13 November 2026). It describes patterns to build, not features to call.

| Primitive | What it says | What we would build |
| --- | --- | --- |
| Event inbox | A durable list, one active worker, deduplicate on source IDs, batch pending events into one run. For mid-run events, push to the next run, fold in, or interrupt | A sprint file the next run reads. Mid-sprint owner requests are queued for the next sprint |
| Timers | A separate store. A timer does not start a run; a scheduler polls for due timers and adds an event | Checkpoint timers declared in the sprint, as events |
| Memory | Hold only what cannot be looked up, with a small index loaded each run; a progress file per task; keep overhead lean | One working record per product; beads and PRs stay the source of truth |
| Permissions | "Where always-on agents carry the most risk"; deferred tool calls end the run and resume on an answer | `ask` in interactive sessions; `defer` in a `claude -p` sprint run |
| Outbox | A run ends by sending, deciding nothing needs sending, or deferring for input; start quiet | The sprint report, and a valid "nothing to report" |

The article is silent on stopping, usage caps, observability and model sizing.

## 10. Measuring spend

A script can read `total_cost_usd` and `modelUsage` from the `--output-format json` result, and the SDK result message carries the same. The docs call them estimates. `claude_code.cost.usage` and `claude_code.api_request` events are available through OpenTelemetry, with `model` and `query_source` attributes. Whether metrics export under `-p` is not stated. A sprint report built from these shows spend per model as [Spend and idle](../contracts/spend-and-idle.md) requires, as an estimate.

## Not confirmed

- A wall-clock timeout, a token budget, or a goal turn cap in the Claude Code docs. None was found in the sections read.
- How `/goal` interacts with `--max-turns` and `--max-budget-usd`.
- `ask` behaviour under `-p` for PreToolUse hooks.
- Whether the session's hooks apply to a subagent's tool calls.
- Whether the parent's budget cap stops a running workflow.
- Whether editing `.claude/scheduled_tasks.json` from outside cancels a task.
- What a SIGTERM to the attractor CLI leaves, and whether `dist/` matches `engine/src`.
- Plan-level figures for the five-hour and weekly usage windows, and the cloud-task details marked **(summary)**.
- Anything on pages not read: the permissions and settings-reference pages, `statusline.md`, the SDK's remaining sections, and `support.claude.com`.

## Sources read

- Claude Code docs, `code.claude.com/docs/en/`: `llms.txt`, `scheduled-tasks`, `goal`, `routines`, `desktop-scheduled-tasks`, `costs`, `tools-reference`, `interactive-mode`, `agent-view`, `cli-reference`, `errors`, `headless`, `env-vars`, `commands`, `hooks`, `hooks-guide`, `settings`, `sub-agents`, `model-config`, `workflows`, `monitoring-usage`, `plugins/measure`.
- Agent SDK docs, `code.claude.com/docs/en/agent-sdk/`: `typescript`, `python`, `agent-loop`, `cost-tracking`, `subagents`, `secure-deployment`.
- claude.com articles: "Building always-on agents", and "Agent identity in Claude Tag".
- This repo: `plugins/attractor` (`AGENTS.md`, `README.md`, `.superpowers/spec-conformance.md`, `.superpowers/carry-forward.md`, `engine/src/core/engine.ts`, `engine/src/handlers/box.ts`, `engine/src/backend/argv.ts`, `engine/src/cli.ts`, `skills/attractorify/examples/00-convergence-loop.dot`).
- Upstream: `strongdm/attractor` `attractor-spec.md`; `microsoft/amplifier-bundle-attractor` `README.md`, `specs/EXTENSIONS.md`, `docs/DOT-AUTHORING-GUIDE.md`.
