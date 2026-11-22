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
4. **Hooks fail open.** A hook that errors, cannot read a file, or times out allows the call. A broken hook must never block a session. `DELIVERY_HOOKS=off` in the environment makes every plugin hook exit 0.
5. **Ask, don't deny, where a person decides.** Where a call needs human input, the hook defers or asks. It does not refuse and route the request through another session. The article (section 4) describes deferred tool calls as the pattern; its details need confirming against the hooks reference before relying on it.
6. **Uninstall removes everything.** One command, dry run by default, lists and then removes every file, setting and unit the plugin created. Its first prototype is [`tools/remove-delivery-guard.py`](tools/remove-delivery-guard.py), tested on a copy of the settings only. It is a stand-in for D0.1 and is to be replaced by the plugin's own command.

## 3. Sprints

Bounds are left for the owner to set (time, spend, review rounds, attention). Every deliverable has a customer-visible done-when. Infrastructure is named with its necessity. Nothing is added to a sprint once it starts; anything new is queued for the next.

### Sprint 0: stop compromising the user's Claude setup

Customer: the person who installs the plugin and expects their own sessions to be left alone.

| Deliverable | Done when |
| --- | --- |
| D0.1 One uninstall command | On a machine with the current guard, launcher, units and timers installed, running it with its dry run lists them and running it for real leaves `settings.json` without delivery entries, other keys unchanged, and a Claude session able to run `kill` and `/plugin uninstall`. |
| D0.2 No user-level writes, no hooks in ordinary sessions | No code path writes under `~/.claude` except into the plugin's own directory. The watchdog no longer calls the guard installer. A test shows every hook returning no output within a stated time in a directory with no role marker. |
| D0.3 The stop path ungated and fail-open | Tests show that `kill`, `systemctl --user stop`, plugin disable and settings edits are not denied by any hook in a non-role session, and that a hook error or `DELIVERY_HOOKS=off` allows the call. |
| D0.4 An owner stop that bypasses Claude | One command run in a plain shell stops every role session and every unit the plugin installed, and reports how long until quiet. |

Necessity statements: D0.1 is needed because the guard is installed on the user's machine and refuses its own removal. D0.2 and D0.3 are the fix. D0.4 is needed because the stop contract requires a stop that no role or hook can block, and nothing exists today that does.

Out of scope: any change to what roles do, the watchdog's behaviour, the beads, or the operator ledger.

### Sprint 1: the planning pipeline works for a user

Customer: someone who installs the plugin, states an intent, and wants a brief, a PRD, an architecture, a roadmap and stories.

| Deliverable | Done when |
| --- | --- |
| D1.1 One real run | The pipeline runs from `/delivery:brief` to stories for one small real intent in a clean project, with no team, beads server or systemd. Every defect that stops it is fixed. Anything else is logged for later. |
| D1.2 A README for that path | A person following only the README reaches stories without help. Someone who did not write it tries it. The team is described as optional. |
| D1.3 Sprints as contracts say | `/delivery:sprint` produces a declaration (deliverables with done-when, bounds, necessity statements, out of scope) and `/delivery:sprint-review` produces the five-part report. |

Necessity: none. This sprint adds no infrastructure.

### Sprint 2: use the feature map on the plugin, and retire what does not earn its place

Customer: the owner, who must maintain this plugin.

| Deliverable | Done when |
| --- | --- |
| D2.1 The plugin mapped | The map lists the plugin's features, the files behind each, and its cost (code, tests, docs). Where use evidence is missing it says so. |
| D2.2 A retirement proposal | A ranked list with evidence and what each removal frees. Starting candidates, from the design analysis and not yet confirmed: the user-level guard and `setup*.js`, `watchdog` timers and path units, `host-manager`, `self-update`, `team-revive`, the outage drill, andon and A3 automation, and the automatic reality-check beads. |
| D2.3 The owner's retirements carried out | Each retirement the owner approves is removed with its tests and docs, and the map and size figures are updated. |

Necessity: the map already exists (`map.js`, 74 features reported). This sprint extends it, and no store or server is built unless a story shows the need.

### Sprint 3: only if the owner wants a team, a minimal one

Decision for the owner: **no standing team**, or a team formed for each declared sprint. The contracts assume the second. Recommendation: start without a team and add it only if sprints 1 and 2 show a customer need it would serve.

| Deliverable | Done when |
| --- | --- |
| D3.1 One command runs a sprint | Given an approved declaration, it starts only the roles that sprint needs, honours the sprint bounds and the usage budget, stops at the first bound or when deliverables verify, and writes the report. |
| D3.2 The stop drill | A drill stops a real running sprint and reports time to quiet. |

Out of scope: a watchdog, host manager, self-update or revive. If D3.1 shows one is strictly necessary, it is declared in the next sprint, not added in this one.

## 4. What the always-on article gives us

Source: [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents), 13 November 2026, read in full, with the agent-identity and secure-deployment pages it links to. The hooks reference's section on deferring a tool call was only partly read, so its details are unconfirmed.

**What it says and where we use it:**

| Article | Use here |
| --- | --- |
| An always-on agent "is not actually 'always on'": it sleeps between runs and spends nothing while asleep | [Spend and idle](contracts/spend-and-idle.md) 3 and 4: wake for a reason, and idle is normal. This is the opposite of the failed design. |
| An **event inbox**: a durable list, a handler that acknowledges quickly, one active worker, deduplication, and batching of pending events into one run. For events arriving mid-run it names three options: push to the next run, fold in, or interrupt | Mid-run owner requests are pushed to the next sprint ([Intent to increment](contracts/intent-to-increment.md) 4). One worker per inbox ends the double-session and fork bugs. Batching replaces a wake on every message, which `kick.js` did. |
| **Timers** live in their own table, apart from the inbox. A timer does not start a run itself: a scheduler polls for due timers and adds an event | Wakes come from due timers and declared checkpoints, not from guessing about stalls and usage resets as the old watchdog did. |
| **Memory**: hold only what cannot be looked up, keep pointers to other systems, load a small index each run, keep a progress file per task, keep the overhead lean and use prompt caching. A long session is either compacted or restarted, and both lose detail, so save what must persist | The role briefs are 86 KB and loaded on every wake. [Spend and idle](contracts/spend-and-idle.md) 8: start from the working record. Beads and PRs stay the source of truth, with pointers in memory. |
| **Permissions** are "where always-on agents carry the most risk". Credentials sit in a proxy outside the agent's environment. Auto mode reviews risky actions, and a person still reviews the most important ones. A **deferred tool call** ends the run, saves the session mid-call, and returns the answer as an inbox event | Replace "deny and send it to the Chief of Staff" and the Yes/No box ceremony with a deferred ask. Hooks stay out of the user's own setup ([section 2](#2-the-hook-problem-and-the-rule-that-fixes-it)). |
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
- **Hook details.** The `defer` and `ask` decisions are described in the article and a summary of the hooks page. Confirm the exact fields and limits against the hooks reference before D0.3 depends on them.
- **The rules above are not reviewed.** The contracts' Check scenarios were read, not run, and this plan has had no reviewer.
