# Delivery: plan to a usable, safe plugin

Status: draft for the owner's review. Written against the [vision](VISION.md) and [contracts](contracts/), so each step below is a sprint with declared deliverables, and the plan itself follows the rules it states. It was written by reading code and reports, not by running the plugin. Where a claim rests on a comment or a report and was not run, it says so.

Revised 2026-11-22: scaled back to use what Claude Code already provides. The first version proposed a custom sprint runner. The research found that Claude Code's own `/goal`, `claude -p` caps, subagents and stop controls cover almost all of it, so the runner is dropped and the standing-team runtime is retired in Sprint 0, instead of being made safe.

## 1. Where the plugin stands

- **What a user can invoke today:** 25 skills (brief, prd, architecture, roadmap, stories, sprint, sprint-review, map, materialise, team, start and others), 12 planning agents and 10 team role briefs. The planning pipeline and the feature map are the August and early-October product. Both predate the standing team.
- **What the team runtime added:** about 33,000 lines of scripts and hooks, 42,000 lines of tests, and 145 version bumps after 12 October. By the design analysis, most of it is the watchdog, host manager, self-update, revive, lane guards, outage drill and the operator-confirmation ceremony.
- **The README leads with the team,** not with the planning pipeline that works without one. The documentation was reported about 115 versions stale on 22 November.
- **What I have not done:** run the pipeline end to end, or checked which of these scripts a user can still use. Sprint 1 starts there.

## 2. The hook problem, and the rule that fixes it

**What existed.** From the plugin's own source:

- `hooks/hooks.json` registers 15 hook entries. Some match every Bash, Write and Edit call and every `mcp__*` tool.
- A **user-level guard** was installed by the team into `~/.claude/settings.json`, plus a launcher in `~/.claude/delivery/`. By its own header (`hooks/scripts/setup.js`, `scripts/lib/user-guard.js`) it "binds every Claude Code session on the host ... and after the plugin is removed", and it refused "disabling or uninstalling the delivery plugin ... or removing the user-level setup guard hook". The watchdog re-installed it every cycle (`scripts/watchdog.js:845`).
- Role lanes refuse `systemctl --user` writes, watchdog control and by omission `kill` to every role (`hooks/scripts/lane.js:1024-1028`, `:1572`).
- **On this machine:** the user-level guard and its launcher were removed on 2026-11-22 (section 6). The plugin is still registered as installed.

**The rule.** The plugin never takes over the user's own Claude setup.

1. **Nothing at user level.** The plugin does not write to `~/.claude/settings.json`, does not install a launcher outside its own directory, and does not install systemd units, timers or path units unless the user runs an installer command themselves and sees what it will change first.
2. **After Sprint 0 the plugin ships no hooks.** With no standing team there is nothing for lane or leak hooks to guard. A plugin with no hooks leaves every session untouched by construction, which is a stronger guarantee than hooks that are safe. Rules 3 to 5 bind any hook added later.
3. **The stop path is never gated.** No hook, in any session, denies `kill`, `pkill`, `systemctl` on the plugin's own units, disabling or uninstalling the plugin, or editing Claude settings.
4. **Hooks fail open.** Claude Code already treats a hook that crashes, times out, exits with a code other than 0 or 2, or prints invalid JSON as a non-blocking error, so the call goes ahead. A plugin hook keeps that default and never sets `onFailure: "block"`. The owner's own switches are the ones Claude Code documents for turning all hooks off, in settings or for one run on the command line (see the [research note](research/execution-engines.md), section 7). There is no documented way to disable a single hook.
5. **Ask, don't deny, where a person decides.** In an interactive session a hook that needs a person returns `ask`, which shows the normal permission prompt. `defer` is honoured only in a non-interactive `claude -p` run with a single tool call, and is ignored in an interactive session. Hooks run in every permission mode, so a deny is strong, and the docs note that matching on Bash commands is best-effort and point to permission rules for a hard gate.
6. **Uninstall removes everything.** One command, dry run by default, lists and then removes every file, setting and unit the plugin created. Its prototype is [`tools/remove-delivery-guard.py`](tools/remove-delivery-guard.py), tested on a copy of the settings and then run for real on 2026-11-22. It is a stand-in for D0.1.

## 3. Sprints

Bounds are left for the owner to set (time, spend, review rounds, attention). Every deliverable has a customer-visible done-when and a proposed model tier with a one-line reason, as [Spend and idle](contracts/spend-and-idle.md) requires. Infrastructure is named with its necessity. Nothing is added to a sprint once it starts; anything new is queued for the next.

### Sprint 0: leave the user's Claude setup alone

Customer: the person who installs the plugin and expects their own sessions to be left alone.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D0.1 One cleanup command for existing installs | On a machine with the old guard, launcher, units or timers installed, its dry run lists them and running it for real leaves `settings.json` without delivery entries, other keys unchanged. | Middle. Ordinary build; tested on copies of the settings. A prototype already exists. |
| D0.2 A plugin version that ships no hooks, units or user-level writes | The shipped `hooks.json` registers no hooks. No code path writes under `~/.claude` outside the plugin's own directory or creates units, timers or path units. A session started with the plugin enabled lists no plugin hooks. The remaining tests pass in the sealed runner. | Middle. Removal is mechanical but wide, and it is verified by the hooks listing and the test suite. |
| D0.3 The standing-team runtime retired, as the owner approves | Every file on the approved list is removed with its tests and docs. The planning skills and the map still run. Size before and after is reported. A file the owner does not approve stays. | Middle. Wide deletion checked by tests. |

Candidates for the D0.3 list, from the design analysis and not yet confirmed against use: the watchdog with its timers, path units and kick runs; the host manager; self-update; team revive; the lane, leak, send and setup guards; operator capture and the confirmation ceremony; the outage drill; andon and A3 automation; automatic reality-check beads; the standing-role briefs; and the `team`, `join` and `start` skills. The exact list is fixed in the sprint declaration, which is where the owner approves it.

Necessity statements: D0.1 is needed because the guard refused its own removal on the user's machine. D0.2 is the fix for the setup problem. D0.3 is needed because D0.2 cannot hold while hook-bearing runtime code remains, and each retained script is a cost to own.

Out of scope: any change to the planning skills, the map, or the beads data.

### Sprint 1: the planning pipeline works for a user, and a sprint can be run

Customer: someone who installs the plugin, states an intent, and wants a brief, a PRD, an architecture, a roadmap and stories, then wants to build them in bounded sprints.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D1.1 One real run | The pipeline runs from `/delivery:brief` to stories for one small real intent in a clean project, with no team, beads server or systemd. Every defect that stops it is fixed. Anything else is logged for later. | Middle. Ordinary building; fixes are focused. |
| D1.2 A README for that path | A person following only the README reaches stories without help. Someone who did not write it tries it. | Middle. Writing for a stranger; checked by a reader, not a model. |
| D1.3 Sprints as contracts say | `/delivery:sprint` produces a declaration (deliverables with done-when, bounds, a model tier and reason per assignment, necessity statements, out of scope, and the Claude Code version and whether the force variable for subagent models is set). `/delivery:sprint-review` produces the five-part report, with spend taken from `total_cost_usd`, model usage and `/usage`, marked as estimates. | Middle. Ordinary building on existing skills. |
| D1.4 A sprint recipe, run once | A one-page recipe (section 4) is run on one small real sprint by someone other than its author. It ends at verified deliverables or at a bound, the stop is used once and the time to quiet is recorded, and the report is produced. | Middle. The real run is the evidence. |

Necessity: none. This sprint adds no infrastructure. The recipe is a document, not a program.

### Sprint 2: use the feature map on the plugin, and retire what does not earn its place

Customer: the owner, who must maintain this plugin.

| Deliverable | Done when | Model tier and reason (proposed) |
| --- | --- | --- |
| D2.1 The plugin mapped | The map lists the plugin's features, the files behind each, and its cost (code, tests, docs). Where use evidence is missing it says so. | Smallest. Mechanical counting from files and the map. |
| D2.2 A retirement proposal | A ranked list, from the map, of what remains after Sprint 0 and has no use evidence, with what each removal frees. | Middle. Judgement over evidence; no hard design. |
| D2.3 The owner's retirements carried out | Each retirement the owner approves is removed with its tests and docs, and the map and size figures are updated. | Middle. Deletion with tests; the smallest tier may do the mechanical removals. |

Necessity: the map already exists (`map.js`, 74 features reported). This sprint extends it, and no store or server is built unless a story shows the need.

No later sprint is planned. The next ones come from the owner's asks and the sprint report.

## 4. How a sprint runs: Claude Code's own features

The research note ([execution engines](research/execution-engines.md)) found that Claude Code already provides most of what the contracts require. A sprint needs no program of ours.

| Need | How |
| --- | --- |
| A sprint | One `/goal` run. The condition is the declared deliverables' done-when checks, plus "or stop after N turns". Unattended, `claude -p "/goal ..."` with `--max-budget-usd` and `--max-turns`. |
| Whole-sprint time bound | A shell wrapper such as `timeout -s INT 4h claude -p ...`. Claude Code documents no run time limit of its own. Use SIGINT, which ends the turn and keeps its result. The default SIGTERM exits with code 143 and records no result for the turn in progress, so that turn's spend is lost from the report. |
| Stop | Ctrl+C, SIGINT to the `claude -p` process (which ends the turn), or `claude stop <id>` for background sessions. Nothing of ours to build or gate. |
| Independent verification | A second, fresh run that re-checks the deliverables and prints the evidence. The `/goal` evaluator cannot call tools, so it cannot be the verifier. |
| Cheap models | The `model` parameter on each subagent call, named in the declaration. |
| Fresh start from a small record | A `claude -p` run starts fresh unless told to resume. The record is the sprint file in the repo. |
| Explicit checkpoint | `/loop` for one named check, such as CI. Not for doing work, and it expires after 7 days. |
| Parallel work inside an assignment | Subagents, or a workflow, as the assignment needs. |
| Spend and attention in the report | `total_cost_usd` and model usage from the `-p` result, and `/usage`. The count of decisions and messages is kept by hand. |

**What this leaves manual or approximate.** The time bound is a shell command. The `/goal` turn clause is advisory, because the evaluator judges it from the conversation. `total_cost_usd` is a client-side estimate, and spend can pass a cap by one response. Review rounds are counted by the declaration, not enforced by the engine. The attention budget is counted by hand.

**Why not build a runner, or use another engine.**

- *A custom runner* is infrastructure that nothing requires today. It would add a bound-accounting program to own, and the contracts' necessity rule is not met until the recipe fails to hold a bound in practice.
- *Attractor* has no run-level time or spend cap, only a per-node budget, and no stop or resume. It launches workers with `bypassPermissions` by default.
- *`/loop`, cron and cloud scheduled tasks* are time triggers. A loop is session-bound and expires after 7 days, and cloud tasks run no more often than hourly.
- *Background sessions* cannot be combined with `-p` and carry no cap of their own.
- *Workflows* fan out well but have no dollar cap or time limit, and the runtime only warns on a large run.

**Reconsider if:** the recipe cannot hold a bound in practice (for example spend overshoots further than the owner accepts), or parallel sprints are needed. A runner would then be declared as a sprint deliverable with its necessity stated.

## 5. What the always-on article gives us

Source: [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents), 13 November 2026, read in full, with the agent-identity and secure-deployment pages it links to. The hooks reference was read in parts and is recorded in the [research note](research/execution-engines.md), which also lists what could not be confirmed.

**What it says and where we use it:**

| Article | Use here |
| --- | --- |
| An always-on agent "is not actually 'always on'": it sleeps between runs and spends nothing while asleep | [Spend and idle](contracts/spend-and-idle.md) 3 and 4: nothing runs unless started, and idle is normal. This is the opposite of the failed design. |
| An **event inbox**: a durable list, a handler that acknowledges quickly, one active worker, deduplication, and batching of pending events into one run. For events arriving mid-run it names three options: push to the next run, fold in, or interrupt | Mid-run owner requests are pushed to the next sprint ([Intent to increment](contracts/intent-to-increment.md) 4). One worker per inbox ends the double-session and fork bugs. Batching replaces a wake on every message, which `kick.js` did. |
| **Timers** live in their own table, apart from the inbox. A timer does not start a run itself | A check is an explicit timer the owner approves, such as a `/loop` on CI, with a recorded reason and an end. |
| **Memory**: hold only what cannot be looked up, keep pointers to other systems, load a small index each run, keep a progress file per task, keep the overhead lean and use prompt caching. A long session is either compacted or restarted, and both lose detail, so save what must persist | The role briefs are 86 KB and loaded on every wake. [Spend and idle](contracts/spend-and-idle.md) 8: start from the working record. PRs stay the source of truth, with pointers in memory. |
| **Permissions** are "where always-on agents carry the most risk". Auto mode reviews risky actions, and a person still reviews the most important ones. A **deferred tool call** ends the run, saves the session mid-call, and returns the answer later | Use `ask` in interactive sessions and `defer` only in a `claude -p` sprint run. Hooks stay out of the user's own setup ([section 2](#2-the-hook-problem-and-the-rule-that-fixes-it)). |
| **Outbox**: a run ends by sending a message, deciding nothing needs sending, or deferring for input. Agents should "start quiet and then earn more of the user's attention", tuned with evals | "Nothing to report" is a valid end of a run. [Owner authority and stop](contracts/owner-authority-and-stop.md) 6 and 8 set the attention budget and the sprint report. |

**What it does not cover.** I looked for each of these and the article is silent on them: stopping or pausing, usage caps and budgets, observability beyond audit logging in the linked identity page, and model or subagent sizing. Those are exactly where this plugin failed, and the contracts in this folder are the only definition of them. I cannot cite Anthropic guidance for a stop, a budget or a model policy.

**A caution.** The article is guidance for building products on Claude. It has no evidence that this team's design would work, and its numbers are about model cost, not about our system.

## 6. State of this machine, 2026-11-22

- **Done:** the three user-level guard entries were removed from `~/.claude/settings.json` and the `~/.claude/delivery/` folder was deleted, by running `tools/remove-delivery-guard.py` on the owner's instruction. The file is still valid JSON and every other key is identical. A backup is at `~/.claude/settings.json.bak-20261122-234719`.
- **Not done:** the plugin is still registered as installed (`installed_plugins.json`, version 0.43.145) and its versions are still cached under `~/.claude/plugins/cache/ai-augmentation-systems/delivery/`. `/plugin uninstall delivery@ai-augmentation-systems` was not available in the environment where the script ran. The owner can run it in their own terminal, or remove the registration and the cached folder. Any plugin hooks load only while it stays enabled.

## 7. Risks and what is not known

- **Whether the pipeline works today.** Not run. Sprint 1 is how we find out.
- **Which retirement candidates have real users.** They come from the design analysis and commit history. The owner approves the exact list in the Sprint 0 declaration, and Sprint 2 checks what is left against the map.
- **The recipe is unproven.** No wall-clock limit, token budget or review-round bound is documented, so the time bound is a shell command and the review bound is by declaration. The `/goal` evaluator cannot call tools. `total_cost_usd` is an estimate that the docs say not to use for financial decisions, and spend can pass a cap by one response. How `/goal` interacts with `--max-turns` and `--max-budget-usd` is not documented.
- **Claude Code resumes by itself after a usage limit.** In an interactive session signed in with a subscription, the default is to wait and continue automatically after the reset, up to three times (`autoContinueAtUsageLimit`, v2.1.234 and later). That conflicts with [Spend and idle](contracts/spend-and-idle.md) 5, which says nothing resumes without the owner's rule. A `claude -p` run is not offered this. An interactive `/goal` session needs the setting off for that project, or the sprint should run with `-p`.
- **Hook details, if one is added later.** How `ask` behaves under `claude -p`, whether a session's hooks apply to a subagent's tool calls, and the middle of the hooks reference, which was read as a summary.
- **A host-wide model override.** `CLAUDE_CODE_SUBAGENT_MODEL=opus` is set in this owner's `~/.claude/settings.json` and in the shell environment. Per Claude Code's docs, a model passed when a subagent is started, and a `model` field in an agent definition, both rank above that variable, so on its own it is only the default for a subagent that names no model. It does override both when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` is set, and it did before Claude Code v2.1.251. On this machine the version is 2.1.330 and the force variable is unset, so a tier chosen in a declaration is not defeated here. Each declaration records the version and whether the force variable is present. It is the owner's file and this plan does not change it.
- **The rules above are not reviewed.** The contracts' Check scenarios were read, not run, and this plan has had no reviewer.
