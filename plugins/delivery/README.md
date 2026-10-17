# delivery

## Start here

delivery gives you a team of Claude Code sessions, one per role, that plan and ship a product while you talk to only one of them, the **Chief of Staff**. You decide once: your exact words are recorded with proof that every session can check, so nobody asks you to repeat or pass anything on. Without a team, the same plugin is a planning pipeline that turns your intent into a brief, a PRD, an architecture, a roadmap and stories.

### Prerequisites

- Claude Code v2.1.224 or later, on macOS or Linux (the sessions message each other).
- Node 18 or later, and git.
- beads: `bd` on the PATH. **Beads** are the team's work items.
- A private **project repo** (the plan, the team manifest, your decisions) and, for an existing product, its **product repo** (code only).
- This plugin installed: `/plugin install delivery@ai-augmentation-systems`.

`/delivery:start` checks all of these for you and names the fix for anything missing.

### Start a new project in 3 steps

1. **Install the plugin:** `/plugin install delivery@ai-augmentation-systems` (the repository README has the marketplace step).
2. **Run `/delivery:start`** in an ordinary Claude Code session, outside any role directory. It asks for the project repo, the product repo, the host name, the preset and the permission mode, shows a dry run, then writes the team manifest, creates the beads database, prepares one directory per role and prints the command that starts each session.
3. **Start the printed sessions,** run `/delivery:join` in each, then open the Chief of Staff session and talk to it.

### Using the team

- **Talk to the Chief of Staff.** It is your one contact. Other sessions send their questions to it; it answers from what you already decided and asks you the rest once, in one ranked briefing.
- **Who does what.** Product Manager: what to build and why, the plan documents. Delivery Lead: turns the plan into beads and runs the work. Builders: build in their own worktree of the product repo. The `full` preset adds Staffing (the roster), the Progress Observer (keeps the record true) and the Spike Researcher (technical unknowns).
- **See progress** with `/delivery:team` in any session (who is live, stale or missing), or ask the Chief of Staff for a briefing.
- **Decisions are recorded and verified.** `operator.js ledger` lists every question the team asked you and its answer; a session runs `operator.js verify <record id>` to see your exact words before it acts.
- **When something blocks,** the refusal names the way out. See [Troubleshooting](docs/quickstart.md#troubleshooting).

### Use the planning pipeline without a team

Run the pipeline skills yourself, from `/delivery:brief` on: see [The pipeline](#the-pipeline) and [Which skill do I run when?](#which-skill-do-i-run-when).

## What you get

- **Your time and attention are protected.** Only what only you can decide reaches you, once, in one ranked briefing.
- **You decide once, and the decision carries proof.** Each decision gets a **record id** (such as `dec-chief-of-staff-000004`) that any session can check against your exact words.
- **Roles cannot do each other's jobs.** Each role has a **lane** (the files it may edit and the commands it may run), and hooks refuse anything outside it.
- **You choose the model, and so the cost, per role.** For example opus for the Chief of Staff, sonnet for builders, haiku for the Progress Observer; `builders_cap` limits how many builders run.
- **One source of truth for the work.** The planning documents are the plan, and `/delivery:materialise` turns them into **beads** (work items in the `bd` issue tracker) and reports drift between the two.
- **Strategy stays private.** Plans, the team manifest and your decisions live in a private project repo; the product repo gets code only.

## How it works in one picture

```
                                  YOU (the operator)
                                       │   ▲
               you talk; it asks you   │   │  one ranked briefing: open questions,
               only what you decide    ▼   │  answers waiting for your OK
                         ┌───────────────────────────────────┐
                         │          Chief of Staff           │
                         │ records your words, answers from  │
                         │ earlier records, routes the work  │
                         └─────────────────┬─────────────────┘
                   messages (SendMessage)  │  beads (bd: work items, claims, notes)
      ┌──────────────┬──────────────┬──────┴───────┬──────────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼              ▼
   Staffing      Product        Delivery       Progress       Builders        Spike
   (who is on    Manager        Lead           Observer       (build in      Researcher
   the team)     (what, why)    (plan into     (keeps the     the product    (answers
                                beads)         record true)   repo)          spike beads)

  How one decision travels (a record id, never a relay):

    1. you say "B"  ──▶  2. Chief of Staff records it  ──▶  3. record id sent to the session
       (captured from       operator.js record                 SendMessage:
        the transcript)     --quote 'B' --answers q-...        dec-chief-of-staff-000004
                            (hash-chained, with provenance)               │
                                                                          ▼
                                     4. the session checks it: operator.js verify dec-chief-of-staff-000004
                                        VERIFIED ... operator said: "B"   (then acts; never asks you)

  Two repositories:

    private PROJECT repo (strategy)                 PRODUCT repo (code only)
    .delivery/initiatives, stories, reviews         one worktree per builder, branch team/<instance>
    .delivery/team/ (team.json, hosts.json)         leak guard: plan text and plan files refused
    .delivery/operator/ (your words, records)
```

## Four things to know

1. **You talk to the Chief of Staff only.** It is the one session that speaks to you; every other session sends its question to it, never to you. The Product Manager may also talk with you about product vision, and records your words the same way.
2. **Your answer is recorded once, with proof.** The Chief of Staff records your exact words linked to the question and sends the record id to the sessions that need it. A worker runs `operator.js verify <id>`, sees your words and the chain back to them, and acts; it never expects to hear from you.
3. **Every role has a lane, enforced by hooks.** A role file declares the paths the role may write and the command groups it may run, and a PreToolUse hook refuses anything else with the sanctioned way to do it. Managers route work to builder beads; builders never touch plans.
4. **The product repo stays free of strategy.** Plans, the manifest and your decisions live in the private project repo, and in a builder's product worktree a leak guard checks commit, PR, issue and release text against `.delivery/team/denylist.txt` and refuses plan files. It is a first line for cooperative sessions, not a boundary: for the durable control, put a push-side or CI scan of the denylist on the product remote.

## Documentation map

- **Start here** (above): prerequisites, the three steps, how to use the team.
- **What you get, the picture, four things to know** (above): how it works and why it helps.
- **`/delivery:start`** (`skills/start/SKILL.md`, driving `scripts/start.js`): the guided start.
- **[docs/quickstart.md](docs/quickstart.md):** the manual way, what `start.js` does step by step, one decision traced with real output, and troubleshooting.
- **Reference, from "Why this exists" down:** every phase, mechanism, limit and artifact. Read it when you need the detail.

## Why this exists

Persona libraries ([wshobson/agents](https://github.com/wshobson/agents),
[VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) give you a
`product-manager` agent but no pipeline — nothing connects one role's output to the
next role's input. Method frameworks
([BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) give you the pipeline but
arrive as a CLI installer that writes into your project, with a module ecosystem you
mostly won't use. Neither models the **customer**, and neither closes the loop by
checking whether what shipped was any good.

## The pipeline

You supply **intent** — why this app exists, what it should do — and optionally a
**design seed** for identity and look and feel. The plugin produces everything needed
to reach implementation, scopes it into sprints, hands each one to whatever runner you
choose, then independently reviews acceptance and re-aligns the plan.

**This package does not build.** Implementation belongs to an external runner —
[superpowers](https://github.com/obra/superpowers), your own harness, an agent, a team.
That boundary is deliberate: it keeps the pipeline harness-agnostic, and it keeps the
thing that reviews the work separate from the thing that produced it, which is what makes
`/delivery:sprint-review` worth trusting.

```
INTENT (+ design seed)
   │
 1 │ /delivery:brief          idea → framed project
 2 │ /delivery:research       prior art, domain constraints, what the codebase forecloses
 3 │ /delivery:personas       end-user personas, graded by evidence
 4a│ /delivery:interview      simulated interviews → needs, objections
 4b│ /delivery:simulate       journey walk-through → friction map, load-bearing steps
 5 │ /delivery:prd            scenarios, falsifiable criteria, NFRs as numbers
 6 │ /delivery:prioritize     MVP stages + milestones, from friction data
 7 │ /delivery:design         seed → tokens, states, accessibility rules
 8 │ /delivery:architecture   design against the real codebase, ADRs, spikes
 9 │ /delivery:roadmap        risk-first sequencing + value/cost reconciliation
10 │ /delivery:stories        self-contained, implementation-ready
11 │ /delivery:sprint         scope package for an external runner
12 │ /delivery:handoff        translate to the runner's native format
   ├──▶ EXTERNAL IMPLEMENTATION RUN (superpowers / your harness)
13 │ /delivery:sprint-review  independent acceptance verdict
14 │ /delivery:realign        fold what it taught back into the plan
   ↺
/delivery:challenge   adversarial panel — usable at ANY gate
/delivery:status      gates, open findings, drift, sprint state
```

Every phase reads the previous artifact and **stops if it is missing** rather than
improvising one. That gate is the point: it is what stops a confident plan being built
on nothing.

### Which skill do I run when?

Pipeline skills plan the product: run them yourself, in order. In a shipping team the role whose lane holds the output runs them: the Product Manager writes `.delivery/initiatives/` (brief to roadmap), personas, interviews, simulations and ADRs; the Delivery Lead writes stories and sprints. Team skills run inside role sessions.

| When | Run | Kind |
| :-- | :-- | :-- |
| You have an idea, or a product to assess | `/delivery:brief` | pipeline |
| New terms keep appearing | `/delivery:glossary` | pipeline |
| The brief exists; you need prior art and constraints | `/delivery:research` | pipeline |
| You need the users the product is for | `/delivery:personas`, then `/delivery:interview` and `/delivery:simulate` | pipeline |
| Users are settled; you need a specification | `/delivery:prd`, then `/delivery:prioritize` | pipeline |
| You need look and feel, then a technical design | `/delivery:design`, then `/delivery:architecture` | pipeline |
| Design is settled; you need order and stories | `/delivery:roadmap`, then `/delivery:stories` | pipeline |
| A wave of work is ready to build | `/delivery:sprint`, then `/delivery:handoff` | pipeline |
| The wave was built | `/delivery:sprint-review`, then `/delivery:realign` | pipeline |
| Before you commit to any document | `/delivery:challenge` | pipeline, any gate |
| You want to know where the plan stands | `/delivery:status` | pipeline, read-only |
| You want a shipping team for a project | `/delivery:start` | team, in your own ordinary session |
| A role session has just started in its role directory | `/delivery:join` | team, every role session |
| You want to see who is live, stale or missing | `/delivery:team` | team, read-only |
| The operator spoke, or a session needs an operator decision | `/delivery:decision` | team, the Chief of Staff |
| The roadmap, stories or spikes changed | `/delivery:materialise <initiative>` | team, the Delivery Lead (anyone with `--check`) |

## The shipping team

**In short.** The pipeline's roles run as long-lived sessions, one per role, each in its own prepared directory. They coordinate through cross-session messages and beads, and you talk only to the Chief of Staff. Each session's role is restored by hooks on every start and compaction, and its lane is checked before every file write, shell command and MCP call. A builder works in its own worktree of the product repo, where commit and PR text is checked against the denylist and plan files are refused. To start one, run `/delivery:start`; [docs/quickstart.md](docs/quickstart.md) has the manual way.

**Reference.** The bullets below list every mechanism; read them when you need the detail.

The pipeline's roles can also run as long-lived sessions, one per role, on the hosts that can do the
work, coordinating through cross-session messages and beads. Phase 1 ships the pieces that give a
session its role and keep it:

- `roles/*.md` — the role briefs (chief-of-staff, staffing, product-manager, delivery-lead,
  progress-observer, builder, spike-researcher). Project-specific briefs go in the project repo under
  `.delivery/team/briefs/`.
- `.delivery/team/team.json` and `hosts.json` — the manifest, in the private project repo. Templates
  under `templates/`.
- `scripts/prepare-role.js --project <root> --instance <id>` — creates one directory per role
  instance with its own settings (model, env, actor), a composed `CLAUDE.local.md`, a clone of the
  project repo and, for builders, a worktree of the product repo. Start a session in that directory.
  The env includes `DELIVERY_ROLE_DIR` (so the hooks still find the role after a `cd` out of it) and,
  when the project has `.beads`, `BEADS_DIR` (bd cannot find the database from a role directory).
- Hooks — SessionStart re-injects the role on startup, resume, clear and after compaction, and
  refreshes CLAUDE.local.md from the current manifest; UserPromptSubmit adds a one-line reminder
  with the current claim.
- `/delivery:join` — confirms the role in-session, primes beads, reports to the Chief of Staff.
- `/delivery:team` — roster versus manifest: live, stale, missing, wrong model; warns when bd cannot
  find a database from the project root; counts operator entries not yet pushed, operator inputs
  waiting for a record, and inferred answers waiting for ratification.
- `/delivery:decision` — the Chief of Staff's operator-decision loop (see "Operator decisions" below).
- `/delivery:materialise <initiative>` — turns `roadmap.md`, the stories and the architecture spikes into
  beads: one epic per phase chained by a phase-review bead, one task per story, one task per spike
  blocking the story or phase it derisks. Deterministic ids (`<prefix>-<initiative>-ph<N>`, `<prefix>-<story id>`,
  `<prefix>-<initiative>-spike-<key>`), idempotent, never touches closed beads. `--check` reports drift. It also
  writes `.delivery/team/denylist.txt`, the phrases the leak-prevention hooks block in the product repo.
- Runners. A builder's manifest entry names its runner: `superpowers`, `attractor` (the attractor
  plugin's pipeline), or `plain`. Delivery plans, dispatches and reviews; the runner builds.
- Spikes are standing work: the Spike Researcher claims `spike` beads emitted from the architecture
  document and records answers in the bead and the ADR or roadmap they gate.
- Lanes are enforced. Each role file declares `lane_writes` (paths it may edit, relative to its role
  directory) and `lane_bash` (command groups from `hooks/lane-groups.json`). A PreToolUse hook refuses
  anything else and says what the sanctioned path is: managers route work to builder beads, builders
  never touch plans. Subagents go through the same hook. Refusals are logged to `.delivery-lane.log`
  in the role directory. A role file without `lane_bash` gets read-only groups; every role may write
  the harness's own plan and memory files under `~/.claude`.
- The lane covers every shell channel and MCP. `Monitor` commands are judged like Bash, `PowerShell`
  is allowed only for roles with `any`, and any other tool carrying a `command` is treated as Bash when hooks.json routes it to the hook. For
  roles without `any`, MCP tools are read-verb only unless the role file's `lane_mcp` key names them
  (comma-separated tool-name patterns, `*` wildcard); the managers' `lane_mcp` allows session
  messaging and listing.
- The product repo is protected: in a product worktree, commit, PR, issue and release text (through
  Bash, Monitor or PowerShell) is checked against `.delivery/team/denylist.txt` (written by
  materialise), plan files cannot be written, `gh issue create` is refused, and pushed commits are
  re-scanned. For roles that touch product, GitHub- and GitLab-style MCP tool inputs pass the same
  scan and MCP issue creation is refused.
- The record stays honest: `bd close` needs an `EVIDENCE:` reason, a live claim cannot be taken,
  released or closed by someone else, bead structure (top-level creates, re-parenting, dependencies,
  deletes, labels on beads you do not hold) changes only through the Delivery Lead, and a turn that
  holds a claim cannot end without a note. These are discipline aids for cooperative agents.
- The product-repo guard is the first line, not the last. It scans commit, PR, issue and release text and refuses plan paths for a cooperative or careless session, and it fails closed inside the product worktree; it is not a boundary against a determined session with unrestricted Bash (file contents, git plumbing, persistent git configuration and pushes from other repositories are out of its reach). Put a push-side or CI scan of the denylist on the product remote for the durable control.
- Builders use plain `git commit -m "text"` in the product worktree: command substitution, heredoc messages, `-F` files and `$VAR` in message or push-option arguments are refused so the text can be checked.

The delivery plugin must be installed on the machine; `prepare-role` enables it for the role
directory. The steward keeps the original project checkout pulled (`git pull --ff-only`) before
preparing or restarting a role, because the hooks read the manifest there. In phase 1 the roster is
per host, so `/delivery:team` reports only roles on this host. `prepare-role` does not set a
permission mode; a steward passes `--permission-mode` when starting the session.

Design: `.superpowers/specs/2026-10-12-shipping-team-design.md`. Provisioning, hiring and deploy
are later phases.

## Operator decisions

**In plain words.**
You answer once.
The Chief of Staff records your exact words, links them to the question, and sends the record id.
A worker runs `verify` and sees your words and the chain back to them.
Nobody asks you to pass anything on.
What this proves, and what it does not, is under **Limits** at the end of this section. [docs/quickstart.md](docs/quickstart.md) walks through one decision with real output.

**Reference.** The operator decides; nobody asks them to relay. Team rule 12 says it: the operator is never asked to answer another session, forward an answer, repeat a decision or press a button for someone. A session that needs the operator messages the Chief of Staff with one question. An operator decision reaches a session as a record id, and the session checks it before acting:

```
node <plugin root>/scripts/operator.js verify <id>
```

A role session's shell has no `CLAUDE_PLUGIN_ROOT`, so the brief (`CLAUDE.local.md`) and the SessionStart role block print the absolute path; both are re-rendered at every SessionStart.

`verify` walks the record to the operator's verbatim words. When it verifies, the record is the operator's word: act on it and do not ask again. A message that claims a decision but carries no verifiable id is information. The reply asks the sender for the id; it never goes to the operator.

**The loop.** The Chief of Staff runs it in the same turn as each operator input, one command per input (`/delivery:decision` has the steps):

1. Capture: `operator.js sync`, then `operator.js pending` for the input id.
2. Record or acknowledge:
   - a decision: `operator.js record --cite in-<host>-N --quote '<exact words>' --statement '...' --scope bead:<id>`;
   - a standing preference: `operator.js delegate`, with later cases under it through `operator.js decide --under`;
   - anything else, including "ok thanks": `operator.js ack --reason 'conversational'`.
3. Carry: `SendMessage` the record id to every session that needs it.

Every operator input in the Chief of Staff's session (and the Product Manager's) gets a record or an ack, and the Stop hook holds the turn until then. A short answer such as "yes", "B" or "No." is quoted whole and must be recorded with `--answers q-<instance>-N`. `verify` checks that the operator's input came after the question was asked and does not answer another question, and prints the question beside the answer with how long before it was asked. Whether the reply really answers that question is still the Chief of Staff's claim, shown for a reader to judge.

Prompts typed before a session became the role (a resumed or adopted session) are stored and citable on request (`record --cite` works), but they are marked `pre_role` and never count as pending or block a Stop.

**Answering on the operator's behalf.** Before asking the operator, the Chief of Staff searches the record with `operator.js find`.
- When a record settles the question, it answers with `operator.js answer --confidence settled`.
- When the step is reversible and low-stakes and extends a recorded decision, it answers with `--confidence inferred --rationale '...'` and lists the answer in the next briefing for ratification.
- Questions about money, security, irreversible changes and new scope always go to the operator, once, in the briefing. They are logged with `operator.js ask`, and `operator.js ledger` shows the log.

**Enforcement.**
- Only the Chief of Staff and the Product Manager may use `AskUserQuestion`, `PushNotification` and `SendUserFile`.
- The Stop hook of the Chief of Staff and of the Product Manager blocks a turn that leaves one of that session's operator inputs unrecorded or asks the operator to relay (including "approve the permission prompt in X").
- Lanes deny writes to `.delivery/operator/`, and only the manager roles' lanes include the writer commands. Workers with unrestricted Bash can record or acknowledge only inputs that their own session captured. The library checks this, but the check is cooperative: it compares a session id that the session's own Bash can rewrite.
- `prepare-role` pre-allows each manager lane's own commands in the role's `settings.local.json`, so a session does not stop on a permission prompt only the operator can clear. These rules are only as narrow as the lane hook in front of them: the hook refuses anything outside the lane, and when a role session's lane cannot be checked (manifest unreadable, an internal error) it now fails closed and allows only restoring the manifest. A session whose role marker is missing gets no lane check at all, and then the allow rules let matching commands through without a prompt.

**Artifacts.** These live in `.delivery/operator/` in the private project repository, are committed, and are pushed by `operator.js publish`:
- `inputs/<host>/<YYYY-MM>.ndjson`: one hash-chained entry per operator prompt, written by the capture hook from the session transcript;
- `records/<instance>.ndjson`: decisions, delegations, answers, acks, questions and ratifications, written only by `operator.js`;
- `LEDGER.md`: the question ledger, generated from the records.

Each chain file has exactly one writer, so git never merges a chain. When a push is rejected because another writer pushed first, `publish` builds the next commit on top of the upstream with git plumbing (only this writer's own chain files, checked append-only) and pushes that. It never merges into, deletes from or resets your checkout, so other sessions' unpublished files and your unrelated work stay as they were. `operator.js problems` lists anything that fails verification.

**Limits.** This is tamper-evidence for cooperative sessions, not a security boundary.
- **Files can be rewritten.** A session with unrestricted Bash can rewrite and re-hash the files. The hash chains, the recorded heads and the git history make that detectable; they do not prevent it.
- **Recorded heads are local.** The heads that catch a truncated chain live in `cursors/heads.json`, a local file on each host, so they are cooperative trust too. A broken `heads.json` is reported as a problem.
- **Records are checked for form, not relevance.** A validly shaped record that cites a real operator input cannot be machine-rejected, even when the input it cites does not support it. Detection is human: the git history, and the verbatim words and author that `verify` prints.
- **Capture depends on the harness.** Capture relies on the harness's `origin` stamp on each transcript entry, and that format is undocumented. If it changes, `operator.js sync` reports `format_unrecognised` and recording fails closed.
- **Cloud sessions are captured late.** Their transcripts are not reachable from other hosts. Inputs typed directly into a cloud session are captured only when that session syncs from its own host.
- **The pre-role boundary is a local file.** `<roleDir>/.delivery-role-since.json` keeps one boundary per session id, set at SessionStart; it is not checked. Deleting it, or dating it in the future, hides genuine inputs from `pending` and the Stop guard. Only a session with unrestricted Bash or a human can do that.
- **Keystrokes can be injected.** A role with unrestricted Bash can type into another session (`tmux send-keys`, computer-use, a terminal MCP server, `osascript`), and the harness records that as a human prompt. This cannot be told apart in the transcript.
- **The relay detector is a heuristic backstop.** It catches common phrasings, not all of them. The structural fix is that no session ever needs the operator to relay.
- **Instance ids.** An instance id belongs to one role:
  - A new role gets a new instance id; giving an existing id a different role invalidates its earlier records.
  - When an instance leaves, mark its role entry `"retired": true` in `team.json` rather than deleting the entry and its chain. A host that never recorded that instance's head trusts its records only while `team.json` lists it. A retired role is shown as `retired` by `/delivery:team` (never missing or drift), `prepare-role` refuses to start it, and `operator.js` records nothing new from it. One instance of a counted role (`builder-2` of two) cannot be retired alone; lowering the count drops it from the manifest.

**Migrating a Vault-style team.** Some teams onboard with their own agent rules. If those rules say that nothing from outside a session passes as the owner's word (the Vault's `AGENTS.md` does), replace that sentence with the record rule above. A rule that refuses every relayed decision, with no trusted way for one to travel, is exactly what made the operator a relay. Workers refused relayed answers, so the Chief of Staff asked the operator to repeat each decision to each session. Keep the intent, nothing unverified counts as the operator's word, and add the way through: a decision that `operator.js verify` accepts counts in full.

## Clashes and limits

The shipping team runs on hooks and per-role settings. These are the places where they meet the rest of a Claude Code setup.

- **Permission modes.** With a user-level `defaultMode` of `auto`, or a steward starting a role with `--permission-mode`, nothing prompts. The lane hook is then the only allowlist, and a hook that fails to spawn (no `node`, a moved plugin path) fails open. Defence in depth: `prepare-role` writes native `permissions.deny` rules into each role's `settings.local.json`, and these hold even then:
  - `AskUserQuestion`, `PushNotification` and `SendUserFile` for every role except the Chief of Staff and the Product Manager;
  - `Bash(git push:*)`, `Bash(sudo:*)`, `Bash(curl:*)`, `Bash(wget:*)` and `Bash(rm:*)` for restricted (manager) lanes, each only where the lane does not allow it. The Product Manager, Delivery Lead and Staffing keep `git push` because they push plan documents.

  A role session whose lane cannot be checked (marker present, manifest unreadable) fails closed.
- **Plugin updates.** Hook paths are fixed when a session starts, and the `permissions.allow` rules name the operator.js path of the plugin version that wrote them. After updating the plugin, rerun `prepare-role` for each role and restart its session; until then in-lane commands may prompt again.
- **superpowers.** Its "you must invoke skills" instruction competes with the lanes in manager roles: a manager pushed to run a planning or execution skill is then refused by its lane. Consider disabling superpowers in manager role directories through `enabledPlugins` in the role's `settings.local.json` (for example `"superpowers@<its marketplace>": false`). `prepare-role` does not do this for you, because the plugin's id depends on the marketplace it was installed from.
- **ralph-loop and the Stop cap.** Claude Code allows at most 8 consecutive Stop blocks. The delivery Stop hook blocks at most twice per turn, but a loop plugin that also blocks Stop shares that budget, and the harness then ends the turn regardless.
- **Role directories make roles.** An ordinary session started inside a role directory (where `.delivery-role.json` and `settings.local.json` live) becomes that role, with its lane, its deny rules and its Stop guard.
- **Cost.** Each hook is a separate `node` process: about 30 ms for node itself, about 38 ms per delivery hook measured on this machine.
  - A Bash call pays 4 spawns (lane, leak guard, bd guard, the post-push scan), in role and in ordinary sessions alike; the hooks return immediately outside a role.
  - A Write or Edit pays 3 (lane, leak guard, the invocation recorder, which now runs async).
  - Tools the matchers no longer catch by accident (TodoWrite, BashOutput, and so on) pay none; before the matchers were anchored, a harness reading them as unanchored regexes would have run 3 hooks on a TodoWrite.
  - The invocation recorder no longer walks directories below the working directory, which took 3.5 s from `$HOME`.

## Using it with superpowers

[superpowers](https://github.com/obra/superpowers) has its own chain:
`brainstorming` → `writing-plans` → `subagent-driven-development`. This pipeline
**replaces `brainstorming`** with something far richer — research, evidence-graded
personas, journey simulation, prioritisation, design system, architecture, and
adversarial review at every gate — and then hands over.

`/delivery:handoff superpowers` offers two modes:

**Mode A — spec handoff (recommended).** Writes
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, the path `writing-plans` reads.
Superpowers then writes its own execution plan and runs it.

**Mode B — plan handoff.** Writes `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
directly, in superpowers' exact format, skipping its planning step.

**Mode A is the default for a reason.** Superpowers' plan format is tuned to its own
executor — tasks of 2–5 minutes, `Files:`/`Interfaces:` blocks, checkbox steps containing
*actual code*, a hard ban on `TBD`. Reproducing that here means maintaining a mirror of
someone else's contract that will drift silently when they change it. There is also a real
granularity gap: our stories are vertical slices sized for one sitting, so Mode B is a
second planning pass, not a reformat. This pipeline's value is upstream; theirs is
fine-grained execution planning. Let each do its own job.

Either way, the loop closes back here: `/delivery:sprint-review` re-verifies the result
independently, and `/delivery:realign` folds what it taught into the plan.

## The five ideas doing the real work

**1. Adversarial review is a mechanism, not a phase.** `/delivery:challenge` runs a
lens-diverse panel against any artifact, picked by artifact type, always including the
`feature-critic` — the only reviewer with no stake in the artifact moving forward.
Reviewers run in parallel and cannot see each other, so independent convergence means
something. Findings are **written to `.delivery/reviews/` with a status**, and
`/delivery:status` keeps reporting anything `open`. A finding leaves the list by being
fixed or rejected-with-a-reason, never by being ignored.

**2. Personas are graded by evidence, and simulation is labelled synthetic.** Every
persona is `observed`, `reported`, or `assumed`. Simulated interviews and journey walks
are hypothesis generators, not findings — every artifact says so at the top. A
fabricated user who agrees with you is worse than no user: it manufactures confidence
and is very hard to argue with. Grades propagate, so prioritisation states how much of
itself rests on invented people.

**3. Prioritisation is two-pass.** A value-only pass after simulation (cheap — stops you
specifying things you'll cut), then cost reconciliation inside `/delivery:roadmap` once
architecture reveals real cost. That second pass looks for **inversions**: MVP items far
costlier than assumed, deferred items now nearly free. Neither is visible before
architecture.

**4. A stage must serve somebody completely.** An MVP stage is not a batch of features —
it is a set that lets **at least one persona finish a journey and get value**. The
simulation's per-persona coverage data is what tests this. A stage serving nobody
end to end is a project milestone, not a release.

**5. Review is independent of the builder.** The runner reports its own results and
optimises for finishing; the review re-checks criteria against the code as it now exists.
Where the report and the code disagree, the code wins and the discrepancy is itself a
finding — it should change how much of that runner's next report you believe. The review
also walks personas through the **real** implementation, because every story can pass
while nobody can actually complete a journey.

## Skills

| Skill | Purpose |
| :-- | :-- |
| `/delivery:brief` | Problem, users, cost of the status quo, MVP boundary |
| `/delivery:research` | Prior art, domain constraints, technical landscape, cited |
| `/delivery:personas` | 3–5 behavioral personas, evidence-graded, with abandonment conditions |
| `/delivery:interview` | Non-leading simulated interviews, run in parallel |
| `/delivery:simulate` | Journey walk-through → ranked friction map |
| `/delivery:prd` | Scenarios with error paths, falsifiable criteria, NFRs as numbers |
| `/delivery:prioritize` | Requirement scoring, MVP stages, milestones |
| `/delivery:design` | Seed → tokens, component states, computed contrast |
| `/delivery:architecture` | Real-codebase design, alternatives, spikes, migration |
| `/delivery:roadmap` | Risk-first sequencing, critical path, cut lists, inversions |
| `/delivery:stories` | Vertical slices carrying full context and design tokens |
| `/delivery:sprint` | Scope package for an external runner, with stop conditions |
| `/delivery:handoff` | Translate to superpowers' format, or a generic brief |
| `/delivery:sprint-review` | Independent acceptance verdict + calibration feedback |
| `/delivery:realign` | Update assumptions, estimates, staging and roadmap |
| `/delivery:challenge` | Adversarial panel against any artifact |
| `/delivery:status` | Gates, open findings, drift, evidence grounding |

## Personas

**Team roles** — Product Owner, Program Manager, Business Analyst, Solution Architect,
Design Lead, Delivery Lead, QA Strategist, and the read-only Feature Critic.

**Customer side** — User Researcher (derives and grades personas) and Persona Simulator
(embodies one end-user persona, read-only, output always labelled synthetic).

Each has an explicit *"what you push back on"* section. Invoke one directly with
`@delivery:product-owner` when you want a single opinion rather than a whole phase.

## Artifacts

All under `.delivery/`, hidden and tracked in git, all markdown:

```
initiatives/<slug>/
  brief.md   research.md   prd.md   prioritization.md   design-system.md
  architecture.md   roadmap.md   notes.md
glossary.md   personas/    interviews/    simulations/
decisions/ADR-NNN-*.md      stories/<slug>-<nn>-*.md
reviews/<slug>-<artifact>-<nn>.md  sprints/<slug>-<n>-*.md + -review.md
invocations/<session_id>.ndjson
```

**Every planning document lives under `.delivery/initiatives/<slug>/`, one directory per
initiative — never a single shared file per project** (`ADR-004`). This is what lets
independent initiatives (epics, sprints, parallel workstreams) be planned in separate
branches without colliding: two initiatives editing the same shared `prd.md` in parallel is
exactly the incident that motivated this. `/delivery:status` resolves which initiative
applies before touching anything — an explicit signal if given, the one existing initiative
if there's only one (so a single-initiative project stays exactly as simple as before this
convention existed), otherwise it asks rather than guesses. Cross-cutting content that
genuinely doesn't fork per initiative — `glossary.md`, `personas/`, `interviews/`,
`simulations/`, `decisions/ADR-NNN-*.md`, `invocations/<session_id>.ndjson` — stays
project-wide, one copy, shared.

**`.delivery/` is not always the repository root**, and every skill resolves it the same
way before touching anything, in order: reuse an existing `.delivery/` if one is already
reachable; otherwise honor an explicit path stated in the nearest `CLAUDE.md`/`AGENTS.md`;
otherwise, if the repository holds more than one independently-releasable component
(multiple `package.json`/`plugin.json`/`pyproject.toml`, workspace members, or similar),
**stop and ask** which component this work belongs to rather than guessing; otherwise
default to `.delivery/` at the repository root. In a plugin marketplace or monorepo this
puts each component's artifacts at `plugins/<name>/.delivery/`, `packages/<name>/.delivery/`
and so on — scoped to the thing they're actually about, findable by `find`/`grep -r` from
anywhere, invisible to a bare `*` glob so it never gets mistaken for shipped product
surface. A repository-wide artifact that is genuinely not about one component belongs at
the root, and should say explicitly why it isn't component-scoped.

Requirement IDs (`FR-n`, `NFR-n`) assigned in the PRD thread through prioritisation,
architecture, roadmap, stories and tests. `/delivery:status` walks that chain to find
requirements no story covers and documents that have drifted apart.

## Adapting it

Almost everything is markdown. Edit `agents/*.md` to change a persona's stance, or
`templates/*.md` to change what an artifact must contain — skills reference the
templates, so both stay in step. To relocate `.delivery/` for a project, state the path
explicitly in that project's `CLAUDE.md`/`AGENTS.md` — every skill checks there before
falling back to the default above.

The one exception: `hooks/` ships a small Node script, registered on real tool-call
events, that records whether a phase actually ran — not something an agent can narrate
past. See `.delivery/decisions/ADR-001-hook-based-invocation-provenance.md` for why.
