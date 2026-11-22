# Delivery: plan to a usable, safe plugin

Status: draft for the owner's review. Written against the [vision](VISION.md) and [contracts](contracts/), so each step below is a sprint with declared deliverables, and the plan itself follows the rules it states. It was written by reading code and reports, not by running the plugin. Where a claim rests on a comment or a report and was not run, it says so.

## 1. Where the plugin stands

- **What a user can invoke today:** 25 skills (brief, prd, architecture, roadmap, stories, sprint, sprint-review, map, materialise, team, start and others), 12 planning agents and 10 team role briefs. The planning pipeline and the feature map are the August and early-October product. Both predate the standing team.
- **What the team runtime added:** about 33,000 lines of scripts and hooks, 42,000 lines of tests, and 145 version bumps after 12 October. By the design analysis, most of it is the watchdog, host manager, self-update, revive, lane guards, outage drill and the operator-confirmation ceremony.
- **The README leads with the team,** not with the planning pipeline that works without one. The documentation was reported about 115 versions stale on 22 November.
- **What I have not done:** run the pipeline end to end, or checked which of these scripts a user can still use. Sprint 1 starts there.

## 2. The hook problem, and the rule that fixes it

**What exists now.** From the plugin's own source:

- `hooks/hooks.json` registers 15 hook entries. Some match every Bash, Write and Edit call and every `mcp__*` tool.
- A **user-level guard** is installed by the team into `~/.claude/settings.json` on PreToolUse, PostToolUse and PostToolUseFailure, plus a launcher in `~/.claude/delivery/`. By its own header (`hooks/scripts/setup.js`, `scripts/lib/user-guard.js`) it "binds every Claude Code session on the host ... and after the plugin is removed", and it refuses "disabling or uninstalling the delivery plugin ... or removing the user-level setup guard hook". The watchdog re-installs it every cycle (`scripts/watchdog.js:845`).
- Role lanes refuse `systemctl --user` writes, watchdog control and by omission `kill` to every role (`hooks/scripts/lane.js:1024-1028`, `:1572`).
- **On this machine, as of this review:** the three guard entries are still in `~/.claude/settings.json`, the launcher directory exists, and the plugin (0.43.145) is still registered in `installed_plugins.json`. The systemd units for the team have been removed. Removing the guard by hand is the first step; see section 5.

**The rule.** The plugin never takes over the user's own Claude setup.

1. **Nothing at user level.** The plugin does not write to `~/.claude/settings.json`, does not install a launcher outside its own directory, and does not install systemd units, timers or path units unless the user runs an installer command themselves and sees what it will change first.
2. **Ordinary sessions are untouched.** In a session with no role marker, no plugin hook may deny, modify or revert anything, and each must exit immediately without reading project files. A test enforces both.
3. **The stop path is never gated.** No hook, in any session, denies `kill`, `pkill`, `systemctl` on the team's own units, disabling or uninstalling the plugin, or editing Claude settings. A role's lane may stop that role's agent from doing these things to *other* roles, but the owner's stop works from a plain shell and does not go through any hook.
4. **Hooks fail open.** Claude Code already treats a hook that crashes, times out, exits with a code other than 0 or 2, or prints invalid JSON as a non-blocking error, so the call goes ahead. The plugin keeps that default: it never sets `onFailure: "block"`, and a hook that cannot read a file allows the call. `DELIVERY_HOOKS=off` in the environment makes every plugin hook exit 0. The owner's own switches are the ones Claude Code documents for turning all hooks off, in settings or for one run on the command line (see the [research note](research/execution-engines.md), section 7). There is no documented way to disable a single hook.
5. **Ask, don't deny, where a person decides.** In an interactive session a hook that needs a person returns `ask`, which shows the normal permission prompt. `defer` is honoured only in a non-interactive `claude -p` run with a single tool call, and is ignored in an interactive session, so it belongs to the sprint runner ([Sprint 3](#sprint-3-a-bounded-sprint-runner-if-the-owner-wants-a-team)), not to interactive hooks. A hook never refuses and routes the request through another session. A `deny` is reserved for harm inside a role's own lane, never for the stop path. Hooks run in every permission mode, so a deny is strong, and the docs note that matching on Bash commands is best-effort and point to permission rules for a hard gate.
6. **Uninstall removes everything.** One command, dry run by default, lists and then removes every file, setting and unit the plugin created. Its first prototype is [`tools/remove-delivery-guard.py`](tools/remove-delivery-guard.py), tested on a copy of the settings only. It is a stand-in for D0.1 and is to be replaced by the plugin's own command.

## 3. Sprints

Changes from the first version of this plan, after the [research note](research/execution-engines.md): hook rules 4 and 5 now state what Claude Code documents (fail open by default, `defer` only in `-p` runs, `ask` for interactive sessions); D0.3 tests the failure paths; D1.3's declaration records the model-override risk; Sprint 3 names its engine and replaces the vague "one command runs a sprint" with a runner whose bounds and stop are specified; and two risks were added.

Bounds are left for the owner to set (time, spend, review rounds, attention). Every deliverable has a customer-visible done-when and a proposed model tier with a one-line reason, as [Spend and idle](contracts/spend-and-idle.md) requires. Infrastructure is named with its necessity. Nothing is added to a sprint once it starts; anything new is queued for the next.

### Sprint 0: stop compromising the user's Claude setup

Customer: the person who installs the plugin and expects their own sessions to be left alone.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D0.1 One uninstall command | On a machine with the current guard, launcher, units and timers installed, running it with its dry run lists them and running it for real leaves `settings.json` without delivery entries, other keys unchanged, and a Claude session able to run `kill` and `/plugin uninstall`. | Middle. Ordinary build; tested on copies of the settings. |
| D0.2 No user-level writes, no hooks in ordinary sessions | No code path writes under `~/.claude` except into the plugin's own directory. The watchdog no longer calls the guard installer. A test shows every hook returning no output within a stated time in a directory with no role marker. | Middle to build; top for the one independent review. Hooks gate every session, which is security-sensitive. |
| D0.3 The stop path ungated and fail-open | Tests show that `kill`, `systemctl --user stop`, plugin disable and settings edits are not denied by any hook in a non-role session, and that a hook error, a timeout, invalid output or `DELIVERY_HOOKS=off` allows the call. No hook sets `onFailure: "block"`. | Middle to build; top for the one independent review. This is the stop path. |
| D0.4 An owner stop that bypasses Claude | One command run in a plain shell stops every role session and every unit the plugin installed, and reports how long until quiet. | Middle to build; top for the one independent review. This is the stop path. |

Necessity statements: D0.1 is needed because the guard is installed on the user's machine and refuses its own removal. D0.2 and D0.3 are the fix. D0.4 is needed because the stop contract requires a stop that no role or hook can block, and nothing exists today that does.

Out of scope: any change to what roles do, the watchdog's behaviour, the beads, or the operator ledger.

### Sprint 1: the planning pipeline works for a user

Customer: someone who installs the plugin, states an intent, and wants a brief, a PRD, an architecture, a roadmap and stories.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D1.1 One real run | The pipeline runs from `/delivery:brief` to stories for one small real intent in a clean project, with no team, beads server or systemd. Every defect that stops it is fixed. Anything else is logged for later. | Middle. Ordinary building; fixes are focused. |
| D1.2 A README for that path | A person following only the README reaches stories without help. Someone who did not write it tries it. The team is described as optional. | Middle. Writing for a stranger; checked by a reader, not a model. |
| D1.3 Sprints as contracts say | `/delivery:sprint` produces a declaration (deliverables with done-when, bounds, a model tier and reason per assignment, necessity statements, out of scope, and the Claude Code version and whether the force variable for subagent models is set) and `/delivery:sprint-review` produces the five-part report. | Middle. Ordinary building on existing skills. |

Necessity: none. This sprint adds no infrastructure.

### Sprint 2: use the feature map on the plugin, and retire what does not earn its place

Customer: the owner, who must maintain this plugin.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D2.1 The plugin mapped | The map lists the plugin's features, the files behind each, and its cost (code, tests, docs). Where use evidence is missing it says so. | Smallest. Mechanical counting from files and the map. |
| D2.2 A retirement proposal | A ranked list with evidence and what each removal frees. Starting candidates, from the design analysis and not yet confirmed: the user-level guard and `setup*.js`, `watchdog` timers and path units, `host-manager`, `self-update`, `team-revive`, the outage drill, andon and A3 automation, and the automatic reality-check beads. | Middle. Judgement over evidence; no hard design. |
| D2.3 The owner's retirements carried out | Each retirement the owner approves is removed with its tests and docs, and the map and size figures are updated. | Middle. Deletion with tests; smallest tier may do the mechanical removals. |

Necessity: the map already exists (`map.js`, 74 features reported). This sprint extends it, and no store or server is built unless a story shows the need.

### Sprint 3: a bounded sprint runner, if the owner wants a team

Decision for the owner: **no standing team**, or a team formed for each declared sprint. The contracts assume the second. Recommendation: build nothing here until sprints 1 and 2 show a customer need it would serve. If the owner wants it, the engine is below.

**Engine chosen: a thin runner that launches each assignment as a fresh `claude -p` run.** The reasons, from the [research note](research/execution-engines.md):

- **The documented controls cover each assignment.** `--max-budget-usd` and `--max-turns` are hard caps, `--model` sets the tier, `--permission-mode dontAsk` (or `--permission-prompts none`) and an allowlist remove approval prompts, and a `claude -p` run starts fresh, which meets "each run starts from a small working record". The JSON result carries `total_cost_usd` and per-model usage for the report.
- **Under any option, the whole-sprint bounds and the stop are ours.** Claude Code documents no wall-clock run limit, no token budget, no review-round bound and no single stop for everything. The runner enforces the sprint's time, spend and review-round bounds itself, by summing each result and refusing to start another assignment once a bound is reached, and it provides the stop. This is the only infrastructure Sprint 3 adds.
- **Why not the others.**
  - *Attractor* has no run-level time or spend cap, only a per-node budget, and no stop or resume. It would need a cumulative budget, a deadline, a stop and a resume path before it met the contracts, and it launches workers with `bypassPermissions` by default.
  - *`/loop`, cron and cloud scheduled tasks* are time triggers. A loop is session-bound and expires after 7 days, and cloud tasks run no more often than hourly.
  - *Background sessions* cannot be combined with `-p` and carry no cap of their own.
  - *Workflows* fan out well but have no dollar cap or time limit, and the runtime only warns on a large run.
  - *`/goal`* may be used inside a builder's assignment to keep it going until its condition is reported met, with a turn clause. It does not replace verification, because its evaluator cannot call tools.
- **Workflows and `/goal` stay optional tools inside one assignment.** Neither is the engine.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D3.1 One command runs a sprint | Given an approved declaration, it launches each assignment as a fresh `claude -p` run with its declared model, a per-assignment budget and turn cap, and an allowlist, starting from the working record. It totals the spend from each result, enforces the sprint's time, spend and review-round bounds, starts nothing once a bound is reached, ends when the deliverables verify, and writes the five-part report with spend per role and per model. | Middle to build; top only if the bound accounting needs cross-cutting design, with the reason recorded. |
| D3.2 The runner's stop | A stop command or stop file prevents any new run, sends SIGINT to the runs in progress, records the state and exits. A drill stops a real running sprint and reports time to quiet. | Middle to build; top for the one independent review. This is the stop path. |

Necessity statement: the runner is needed because no documented Claude Code feature gives a whole-sprint time bound, a spend bound across assignments, or one owner stop. The per-assignment caps are native and are used as they are. Nothing else is built.

Out of scope: a watchdog, host manager, self-update, revive, an event inbox or timers. If D3.1 shows one is strictly necessary, it is declared in the next sprint, not added in this one.

## 4. What the always-on article gives us

Source: [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents), 13 November 2026, read in full, with the agent-identity and secure-deployment pages it links to. The hooks reference was read in parts and is recorded in the [research note](research/execution-engines.md), which also lists what could not be confirmed.

**What it says and where we use it:**

| Article | Use here |
| --- | --- |
| An always-on agent "is not actually 'always on'": it sleeps between runs and spends nothing while asleep | [Spend and idle](contracts/spend-and-idle.md) 3 and 4: wake for a reason, and idle is normal. This is the opposite of the failed design. |
| An **event inbox**: a durable list, a handler that acknowledges quickly, one active worker, deduplication, and batching of pending events into one run. For events arriving mid-run it names three options: push to the next run, fold in, or interrupt | Mid-run owner requests are pushed to the next sprint ([Intent to increment](contracts/intent-to-increment.md) 4). One worker per inbox ends the double-session and fork bugs. Batching replaces a wake on every message, which `kick.js` did. |
| **Timers** live in their own table, apart from the inbox. A timer does not start a run itself: a scheduler polls for due timers and adds an event | Wakes come from due timers and declared checkpoints, not from guessing about stalls and usage resets as the old watchdog did. |
| **Memory**: hold only what cannot be looked up, keep pointers to other systems, load a small index each run, keep a progress file per task, keep the overhead lean and use prompt caching. A long session is either compacted or restarted, and both lose detail, so save what must persist | The role briefs are 86 KB and loaded on every wake. [Spend and idle](contracts/spend-and-idle.md) 8: start from the working record. Beads and PRs stay the source of truth, with pointers in memory. |
| **Permissions** are "where always-on agents carry the most risk". Credentials sit in a proxy outside the agent's environment. Auto mode reviews risky actions, and a person still reviews the most important ones. A **deferred tool call** ends the run, saves the session mid-call, and returns the answer as an inbox event | Replace "deny and send it to the Chief of Staff" and the Yes/No box ceremony with `ask` in interactive sessions and a deferred ask in the sprint runner. `defer` works only in `claude -p`. Hooks stay out of the user's own setup ([section 2](#2-the-hook-problem-and-the-rule-that-fixes-it)). |
| **Outbox**: a run ends by sending a message, deciding nothing needs sending, or deferring for input. Agents should "start quiet and then earn more of the user's attention", tuned with evals | "Nothing to report" is a valid end of a run. [Owner authority and stop](contracts/owner-authority-and-stop.md) 6 and 8 set the attention budget and the sprint report. |

**What it does not cover.** I looked for each of these and the article is silent on them: stopping or pausing, usage caps and budgets, observability beyond audit logging in the linked identity page, and model or subagent sizing. Those are exactly where this plugin failed, and the contracts in this folder are the only definition of them. I cannot cite Anthropic guidance for a stop, a budget or a model policy.

**A caution.** The article is guidance for building products on Claude. It has no evidence that this team's design would work, and its numbers are about model cost, not about our system.

## 5. What to do on this machine now

The guard is live in every Claude session here until it is removed. It is the owner's setup, so I have not touched it, and it refuses its own removal through a Claude tool. In a plain terminal:

```
python3 -I plugins/delivery/.delivery/direction/tools/remove-delivery-guard.py          # dry run
python3 -I plugins/delivery/.delivery/direction/tools/remove-delivery-guard.py --apply  # backs up, then removes
```

It removes only the three setup-guard entries from `~/.claude/settings.json` and the `~/.claude/delivery` launcher, keeps a timestamped backup, and leaves every other key and hook alone. Afterwards `/plugin uninstall delivery@ai-augmentation-systems` will no longer be refused, and `installed_plugins.json` can be cleaned that way.

## 6. Risks and what is not known

- **Whether the pipeline works today.** Not run. Sprint 1 is how we find out.
- **Which retirement candidates have real users.** They come from the design analysis and commit history. Sprint 2 checks them against the map and the owner.
- **Hook details still unconfirmed.** How `ask` behaves under `claude -p`, whether the session's hooks apply to a subagent's tool calls, and the middle of the hooks reference, which was read as a summary. Confirm these before D0.3 depends on them.
- **Claude Code resumes by itself after a usage limit.** In an interactive session signed in with a subscription, the default is to wait and continue automatically after the reset, up to three times (`autoContinueAtUsageLimit`, v2.1.234 and later). That conflicts with [Spend and idle](contracts/spend-and-idle.md) 5, which says nothing resumes without the owner's rule. A `claude -p` run is not offered this, so the sprint runner is unaffected. Any interactive role session needs the setting off in its own role directory, not in the owner's user settings.
- **The runner is unproven.** No wall-clock limit, token budget or review-round bound is documented, so the runner's accounting is ours to build and test. `total_cost_usd` is a client-side estimate that the docs say not to use for financial decisions, and spend can overshoot a cap by one response, so the sprint's spend bound is approximate.
- **A host-wide model override.** `CLAUDE_CODE_SUBAGENT_MODEL=opus` is set in this owner's `~/.claude/settings.json` and in the shell environment. Per Claude Code's docs, a model passed when a subagent is started, and a `model` field in an agent definition, both rank above that variable, so on its own it is only the default for a subagent that names no model. It does override both when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` is set, and it did before Claude Code v2.1.251. On this machine the version is 2.1.330 and the force variable is unset, so a tier chosen in a declaration is not defeated here. Any host running an older version, or with the force variable set, is. Each declaration records the version and whether either is present. It is the owner's file and this plan does not change it. The precedence is in the [research note](research/execution-engines.md).
- **The rules above are not reviewed.** The contracts' Check scenarios were read, not run, and this plan has had no reviewer.
