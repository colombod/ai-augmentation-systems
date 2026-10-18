# Start a shipping team: the manual way

> **The quick way is `/delivery:start`.** Run it in an ordinary Claude Code session, outside any role directory. It checks the prerequisites, asks a few questions and runs `scripts/start.js`, which does steps 1 to 3 below for you and prints the commands for step 4. This page shows what it runs, with real output, and how to do each step by hand.

This guide starts a small shipping team on one machine: a Chief of Staff, a Product Manager, a Delivery Manager and one builder. Each runs as its own Claude Code session in its own directory. You talk to the Chief of Staff for decisions and logistics, and with the Product Manager about product vision; the other sessions send their questions to the Chief of Staff.

Words used below:

- **Role session:** a Claude Code session started in a directory prepared for one role.
- **Beads:** work items in the `bd` issue tracker. The team plans, claims and closes work as beads.
- **Lane:** the files a role may edit and the commands it may run. A hook refuses anything outside it.
- **Record id:** the id of one recorded operator decision or answer, such as `dec-chief-of-staff-000004`. Any session can check it with `operator.js verify`.
- **Steward:** the role on a host that keeps the project checkout pulled and (re)starts role sessions there. Today that is you, by hand.

The planning pipeline (`/delivery:brief` and the rest) works on its own without any of this. See [Which skill do I run when?](../README.md#which-skill-do-i-run-when) in the README.

## Prerequisites

- Claude Code v2.1.224 or later, on macOS or Linux: the role sessions message each other.
- Node 18 or later, and git.
- `bd` (beads) on the PATH. `bd version` should answer.
- The delivery plugin installed: `/plugin install delivery@ai-augmentation-systems` (the repository README's Install section has the marketplace step). In the commands below, `<plugin-root>` is the plugin's directory: the `installPath` listed for `delivery@ai-augmentation-systems` in `~/.claude/plugins/installed_plugins.json`.
- A **private project repo**, `<project-root>`. It holds strategy: the plan under `.delivery/`, the team manifest, and your recorded decisions. `start.js` creates it (`git init`) when it does not exist; add a private remote so plans and records are pushed.
- For an existing product, a **product repo**: a local checkout at `<product-checkout>`, or a clone URL that `start.js` clones next to the project repo as `<project>-product`. It holds code only. Builders get their own worktree of it.

`node <plugin-root>/scripts/start.js --check` checks these and prints the fix for each one missing. It exits 1 when a hard prerequisite (node, git, bd, claude and its version) is missing; the plugin's install state and the project remote are warnings. On this machine:

```
delivery prerequisites
  [pass] node: 26.5.0 (need 18 or later)
  [pass] git: git version 2.54.0 (Apple Git-157)
  [pass] bd (beads): bd version 1.2.2 (Homebrew)
  [pass] claude (Claude Code): 2.1.287 (cross-session messaging needs 2.1.224 or later)
  [warn] delivery plugin: installed 0.16.0 is older than this copy (0.20.0); the installed hooks may lack the shipping team. Fix: update it with /plugin
All hard prerequisites are met.
```

## What `/delivery:start` runs

The skill asks you for the project repo, the product repo, the host name, the preset, the model profile and the permission mode, then runs `start.js` twice: a dry run to show you the plan, then the real run. All inputs are flags; the script never prompts.

```
node <plugin-root>/scripts/start.js --project <project-root> --host laptop --models balanced --product-repo <product-checkout> --dry-run
node <plugin-root>/scripts/start.js --project <project-root> --host laptop --models balanced --product-repo <product-checkout>
```

Other flags: `--preset minimal|full` (default `minimal`: Chief of Staff, Product Manager, Delivery Manager, one builder; `full` adds Staffing, the Progress Observer, the Spike Researcher and the Reality Checker; the Reality Checker also joins `minimal` when a declared surface is not scriptable, or with `--reality-checker`), `--models quality|balanced|economy` (default `balanced`; see the README's Models section), `--prefix <bd prefix>` (default: the project directory name), `--runner superpowers|attractor|plain` for the builder (default `plain`), `--permission-mode <mode>` (default: none, so each session uses your own Claude Code default), `--team-dir <dir>` and `--user <name>` (passed to `prepare-role`).

The real run, against a throwaway fixture (paths shortened to placeholders):

```
delivery start: <project-root>
  project repo: create <project-root> and run git init
  manifest: write .delivery/team/team.json and .delivery/team/hosts.json: preset minimal, models balanced, host "laptop", prefix "acme", roles chief-of-staff, product-manager, delivery-lead, builder
  manifest: valid
  product repo: using the checkout at <product-checkout>
  manifest: committed (6380dab)
  beads: run bd init --prefix acme
  roles (in <team-dir>):
    chief-of-staff: prepared (opus)
    product-manager: prepared (opus)
    delivery-lead: prepared (sonnet)
    builder: prepared (sonnet)

Start each session in its own terminal, the Chief of Staff first:
  cd <team-dir>/chief-of-staff && claude --name chief-of-staff
  cd <team-dir>/product-manager && claude --name product-manager
  cd <team-dir>/delivery-lead && claude --name delivery-lead
  cd <team-dir>/builder && claude --name builder
  (no --permission-mode: each session uses your own Claude Code default; pass --permission-mode to choose one)

Then:
  1. In every session, run /delivery:team join.
  2. Open the Chief of Staff session and talk to it for decisions and logistics; talk with the Product Manager about product vision.
  3. /delivery:team shows who is live; ask the Chief of Staff for the question ledger to see every decision.
```

The dry run prints the same plan with "would" in front of each write, and writes nothing. Running it again is safe: an existing manifest is kept as it is (and `--preset`, `--models`, `--host`, `--prefix` and `--runner` are not applied to it; if it is uncommitted, for example after a refused run, just those two files are committed), `bd init` runs only when `.beads` is absent, and only roles without a prepared directory are prepared (plus, once `.beads` exists, any prepared role still missing `BEADS_DIR`, which is re-prepared):

```
delivery start: <project-root>
  project repo: exists
  manifest: keeping the existing .delivery/team/team.json and .delivery/team/hosts.json (project "acme", 4 instance(s)); --preset, --models, --host, --prefix and --runner are not applied to it
  manifest: valid
  product repo: none given; a builder prepared in this run gets no product worktree (pass --product-repo <path|url>)
  beads: .beads exists; bd init skipped
  roles (in <team-dir>):
    chief-of-staff: already prepared
    product-manager: already prepared
    delivery-lead: already prepared
    builder: already prepared
```

When `bd` is missing, `start.js` still prepares the roles and says how to finish: install `bd`, run `bd init --prefix <prefix>` in `<project-root>`, then run `start.js` again: it re-prepares each role that lacks `BEADS_DIR`. The steps below are what `start.js` does, for doing them by hand.

## 1. Write the team manifest

Create `.delivery/team/team.json` and `.delivery/team/hosts.json` in `<project-root>`. The templates `<plugin-root>/templates/team.json` and `<plugin-root>/templates/hosts.json` are this minimal single-host team; `docs/team-example.md` shows every field of a larger one:

`<project-root>/.delivery/team/team.json`

```json
{
  "project": "acme",
  "prefix": "acme",
  "bd_host": "laptop",
  "budget": { "builders_cap": 1, "staleness_hours": 2 },
  "roles": [
    { "id": "chief-of-staff",  "brief": "delivery/chief-of-staff",  "host": "laptop", "model": "opus",   "mode": "delegate" },
    { "id": "product-manager", "brief": "delivery/product-manager", "host": "laptop", "model": "opus" },
    { "id": "delivery-lead",   "brief": "delivery/delivery-lead",   "host": "laptop", "model": "sonnet" },
    { "id": "builder",         "brief": "delivery/builder",         "host": "laptop", "model": "sonnet", "runner": "plain", "large_model": "opus" }
  ]
}
```

`<project-root>/.delivery/team/hosts.json`

```json
{
  "hosts": {
    "laptop": { "kind": "pc", "bd": "native", "headless": false, "desktop_apps": true }
  }
}
```

What the fields mean, as `scripts/lib/manifest.js` checks them:

- `project`, `prefix` and `bd_host` are required. `prefix` is the bead id prefix. `project` also names the default team directory, `<project-root>/../<project>-team`.
- The product repository is not named in the manifest: you pass its local checkout to `prepare-role` (step 3).
- Each role needs an `id` (lower case, digits, `-`), a `brief` (`delivery/<role>` for the plugin's role files in `roles/`, or `project/<name>` for a brief under `.delivery/team/briefs/`), a `host` that is a key in `hosts.json`, and a `model`: any model name Claude Code accepts (`opus`, `sonnet` and `haiku` are checked; another name is passed through with a warning). Leave it out to use the role brief's `default_model`. The model is how you set the cost of each role.
- Optional: `mode` (`default` or `delegate`), `runner` for builders (`superpowers`, `attractor` or `plain`), `large_model` for builders (the model their subagents get on a `size-L` bead, exported as `DELIVERY_LARGE_MODEL`; default `opus`), `count` for several instances (`builder-1`, `builder-2`, ...), `steward: true` (see below; `start.js` marks the builder), and `retired: true` for an instance that has left.
- A team on more than one host needs, on each host that is not `cloud`, one role with `"steward": true`. A single-host team needs none.
- The number of builders may not exceed `budget.builders_cap`. `staleness_hours` is when `/delivery:team` calls a silent session stale.

Commit the manifest. The hooks read it from this checkout, so keep it pulled (`git pull --ff-only`) before preparing or restarting a role.

## 2. Create the beads database

In `<project-root>`, run `bd init --prefix acme` with the same prefix as `team.json`. Do this before step 3: `prepare-role` sets `BEADS_DIR` for a role only when `<project-root>/.beads` already exists, and `bd` cannot find the database from a role directory without it.

## 3. Prepare one directory per role

Run once per instance. It is safe to run again.

```
node <plugin-root>/scripts/prepare-role.js --project <project-root> --instance chief-of-staff
node <plugin-root>/scripts/prepare-role.js --project <project-root> --instance product-manager
node <plugin-root>/scripts/prepare-role.js --project <project-root> --instance delivery-lead
node <plugin-root>/scripts/prepare-role.js --project <project-root> --instance builder --product-repo <product-checkout>
```

Each run prints the role directory it made, `<team-dir>/<instance>`. Options: `--team-dir <dir>` to put the role directories elsewhere, `--user <name>` for the beads actor name (default: your login name). A builder without `--product-repo` gets a warning and no product worktree.

A role directory holds:

```
<team-dir>/builder/
  .claude/settings.local.json   model, role environment, plugin enabled, the lane's own commands pre-allowed
  .delivery-role.json           the role marker: which instance this is and where the project is
  CLAUDE.local.md               the composed role brief and team rules (re-rendered at every start)
  project/                      a clone of the project repo
  product/                      builders only: a worktree of the product repo on branch team/<instance>
```

`prepare-role` does not set a permission mode, and it refuses an instance marked `retired`.

## 4. Start each session in its role directory

Start the Chief of Staff first, so the others can report to it. In a separate terminal for each role:

```
cd <team-dir>/chief-of-staff
claude --permission-mode <mode> --name chief-of-staff
```

`<mode>` is your choice for that role (`claude --help` lists the modes). The lane hook runs before every file write, shell command and MCP call. The model comes from the role's `settings.local.json`. Name each session after its instance: `/delivery:team join` reports to the session named `chief-of-staff`. On start, the SessionStart hook makes sure the role is loaded, registers the session in the roster, and starts capturing what you type in that session.

## 5. Join, then check the team

In each session, run:

```
/delivery:team join
```

It checks the role marker, runs `bd prime`, confirms the session is `live` in the roster, and reports to the Chief of Staff (the Chief of Staff reports to you). Then, in any session:

```
/delivery:team
```

It runs `team-status.js` and shows every instance with its session and state. A healthy start looks like this (from a test fixture):

```
| Instance | Role | Host | Model | Session | State |
|---|---|---|---|---|---|
| chief-of-staff | chief-of-staff | laptop | opus | <session-id> | live |
| product-manager | product-manager | laptop | opus | <session-id> | live |
| delivery-lead | delivery-lead | laptop | sonnet | <session-id> | live |
| builder | builder | laptop | sonnet | <session-id> | live |

Manifest: <project-root> at <commit>

Operator entries unpublished: 0
Operator inputs pending a record: 0
Inferred answers awaiting ratification: 0

To change a model: edit roles[].model in .delivery/team/team.json, rerun prepare-role for that instance, restart its session.

No drift.
```

To give the team work, plan with the pipeline skills (the Product Manager writes `.delivery/initiatives/<initiative>/`, the Delivery Manager writes stories), then the Delivery Manager runs `/delivery:materialise <initiative>` to turn the roadmap, stories and spikes into beads.

## 6. Your first conversation

Talk to the Chief of Staff in its session, in your own words. For each thing you say, in the same turn, it:

1. **sees** your words, which the hooks capture from the session transcript, with `operator.js pending`;
2. **records** a decision with your exact words (`operator.js record`) or **acknowledges** anything else (`operator.js ack`; `ack --pending --reason 'conversational'` for chat); a standing preference is a delegation ([operator-reference.md](operator-reference.md));
3. **delegates** the work: it turns your ask into a bead, or finds the bead that holds it, and routes it to a role;
4. **sends the record id** with `SendMessage` to every session that needs it. That session runs `operator.js verify <id>` and acts.

For an input still without a record or an ack, its Stop hook reminds the Chief of Staff once per turn and blocks the first stop; it fails open if the transcript format is unrecognised. `/delivery:decision` holds the full loop.

To see every question the team asked you and how each was answered, ask for the ledger, or run it yourself:

```
node <plugin-root>/scripts/operator.js ledger --project <project-root>
```

To check a record yourself:

```
node <plugin-root>/scripts/operator.js verify <id> --project <project-root>
```

Reading (`verify`, `show`, `pending`, `find`, `ledger`) works from any directory. Writing works only from a role session.

## A worked example

The output below was produced by running these commands against a throwaway fixture (the same kind the tests build). Times, machine and session ids are shortened to placeholders. Every command is `node <plugin-root>/scripts/operator.js ...`, run in the session named in brackets.

**Earlier, you told the Chief of Staff:** "Export orders as CSV first; JSON can wait." It captured and recorded that:

```
[chief-of-staff]$ operator.js sync
added 1 (ok)
[chief-of-staff]$ operator.js pending
Operator inputs with no record or ack (1):
  in-laptop-000001  <time>  "Export orders as CSV first; JSON can wait."
[chief-of-staff]$ operator.js record --cite in-laptop-000001 --quote 'Export orders as CSV first' --statement 'The orders export ships as CSV first; JSON later' --scope bead:acme-12
refused (quote_negated): in the input the quoted words sit next to a negation or a hold (not, never, no, stop, wait, ...) that the quote leaves out; quote at least: «Export orders as CSV first; JSON can wait.» (operator.js show in-laptop-000001 prints the operator's words)
[chief-of-staff]$ operator.js record --cite in-laptop-000001 --quote 'Export orders as CSV first; JSON can wait.' --statement 'The orders export ships as CSV first; JSON later' --scope bead:acme-12
dec-chief-of-staff-000001
```

The first attempt was refused because the quote dropped "JSON can wait". A quote must not lose a negation or a hold.

**The builder asks which format to use.** It sends the question to the Chief of Staff, not to you. The Chief of Staff searches the record first, finds your earlier decision, and answers from it:

```
[chief-of-staff]$ operator.js find --scope bead:acme-12 --text 'csv'
dec-chief-of-staff-000001 decision scope bead:acme-12: The orders export ships as CSV first; JSON later (operator: "Export orders as CSV first; JSON can wait.")
in-laptop-000001 input: Export orders as CSV first; JSON can wait.
[chief-of-staff]$ operator.js answer --cite dec-chief-of-staff-000001 --question 'Which file format should the orders export use?' --answer 'CSV' --confidence settled --scope bead:acme-12
ans-chief-of-staff-000002
```

It sends `ans-chief-of-staff-000002` to the builder, which checks it:

```
[builder]$ operator.js verify ans-chief-of-staff-000002
VERIFIED ans-chief-of-staff-000002
  ans-chief-of-staff-000002  answer: CSV [settled] (by chief-of-staff [chief-of-staff] host laptop machine <machine-id> session <session-id>, <time>)
    question: "Which file format should the orders export use?"
  dec-chief-of-staff-000001  decision: The orders export ships as CSV first; JSON later (by chief-of-staff [chief-of-staff] host laptop machine <machine-id> session <session-id>, <time>)
  in-laptop-000001  input (human, host laptop, session <session-id>, <time>)
    cited in context: "«Export orders as CSV first; JSON can wait.»"
  records/chief-of-staff: heads: recorded (2 entries)
  inputs/laptop: heads: recorded (1 entries)
operator said: "Export orders as CSV first; JSON can wait."
```

You were not asked anything.

**The builder asks something new:** should the export include cancelled orders? No record covers it, so the Chief of Staff logs the question for your next briefing:

```
[chief-of-staff]$ operator.js find --scope bead:acme-12 --text 'cancelled'
nothing found
[chief-of-staff]$ operator.js ask --text 'Should the CSV export include cancelled orders?' --asker builder --bead acme-12 --options 'A: leave them out|B: include them, flagged' --recommendation 'B'
q-chief-of-staff-000003
[chief-of-staff]$ operator.js ledger --status open
...
| Question id | Question | Asker | Bead | Asked | Status | Answer | Record | Operator's words | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| q-chief-of-staff-000003 | Should the CSV export include cancelled orders? (recommended: B) | builder (builder) | acme-12 | <time> | open |  |  |  |  |
```

**In the briefing it asks you once, with the options and its recommendation. You reply "B".** It records your one-letter answer against that question:

```
[chief-of-staff]$ operator.js sync
added 1 (ok)
[chief-of-staff]$ operator.js pending
Open questions (1):
  q-chief-of-staff-000003  Should the CSV export include cancelled orders? (bead acme-12) [recommended: B]
Operator inputs with no record or ack (1):
  in-laptop-000002  <time>  "B"
[chief-of-staff]$ operator.js record --cite in-laptop-000002 --quote 'B' --statement 'The CSV export includes cancelled orders, flagged' --scope bead:acme-12 --answers q-chief-of-staff-000003
dec-chief-of-staff-000004
[chief-of-staff]$ operator.js pending
nothing pending
```

It sends `dec-chief-of-staff-000004` to the builder. The builder checks it and sees the question beside your answer:

```
[builder]$ operator.js verify dec-chief-of-staff-000004
VERIFIED dec-chief-of-staff-000004
  dec-chief-of-staff-000004  decision: The CSV export includes cancelled orders, flagged (by chief-of-staff [chief-of-staff] host laptop machine <machine-id> session <session-id>, <time>)
    answers q-chief-of-staff-000003: "Should the CSV export include cancelled orders?" (asked <time>, 0 minutes before the answer)
  in-laptop-000002  input (human, host laptop, session <session-id>, <time>)
    cited in context: "«B»"
  records/chief-of-staff: heads: recorded (4 entries)
  inputs/laptop: heads: recorded (2 entries)
operator said: "B"
```

An id that does not check out is refused, and the builder asks the Chief of Staff for a real one:

```
[builder]$ operator.js verify dec-chief-of-staff-000099
NOT VERIFIED dec-chief-of-staff-000099: not_found: record dec-chief-of-staff-000099 was not found (operator.js refresh pulls other hosts)
```

In the fixture each write also printed `unpublished (no remote)`, because the throwaway project repo has no remote. With a remote, each write ends with a best-effort commit in the private operator store (`.git/delivery-operator/`, never your checkout) and a push to the remote's `delivery-operator` branch (`operator.js publish`); the session needs push access, and branch rules must allow that branch. You never pull for operator records: `operator.js refresh` fetches them into the store. `pending`, `find`, `ledger`, `problems` and every write run it first; `verify` and `show` run it only when the id is not found locally.

What `verify` proves and what it does not is listed under **Limits** in the README's "Operator decisions" section. In short: this is tamper-evidence for cooperative sessions, not a security boundary.

## What is not automated yet

- **Provisioning and deploy are manual.** `/delivery:start` writes the manifest and prepares the roles on this host, but you still start each session yourself, and adding a host or a role later means editing `team.json` and running `start.js` (or `prepare-role`) again.
- **The roster is per host.** `/delivery:team` reports only the roles on the host it runs on.
- **Nothing restarts a session for you.** When a session ends, start it again in its role directory; the SessionStart hook restores the role.

## Troubleshooting

**1. "This directory was not prepared as a role", or a write refused with `not_allowed`.** The role marker `.delivery-role.json` is missing, or the session is not in its role directory, or `DELIVERY_ROLE` does not name the marker's instance. Run `prepare-role` for that instance and start the session in the directory it prints. Without a valid marker the lane hook does not apply at all, and `operator.js` refuses every write:

```
refused (not_allowed): no valid role marker for this session, so nothing can be recorded here; run operator.js from a delivery role session (prepare-role writes the marker and sets DELIVERY_ROLE). Reading (verify, show, pending, find, ledger) works anywhere
```

**2. Every tool call is denied with "the lane cannot be checked".** `team.json` or `hosts.json` in `<project-root>` does not load (for example, a broken edit). A role session then fails closed and allows only restoring the manifest:

```
Role chief-of-staff: the lane cannot be checked (manifest: team.json: invalid JSON (...)), so nothing that writes or runs is allowed. Restore the manifest with `git -C <project-root> checkout -- .delivery/team/team.json` (allowed), or tell the Chief of Staff by SendMessage.
```

Run the restore command it names, or fix the file from outside the session.

**3. `bd` cannot find the database.** From a role directory `bd where` says `No active beads workspace found`, and `/delivery:team` warns `bd unreachable from role directories: run bd init in the project root, then rerun prepare-role so the roles get BEADS_DIR`. The role's `settings.local.json` has no `BEADS_DIR`, usually because `prepare-role` ran before `bd init`. Run `bd init` in `<project-root>` if needed, run `prepare-role` again for each instance, and restart the sessions.

**4. `format_unrecognised`.** `operator.js sync` or `record` reports that the transcript format was not recognised. Capture relies on an undocumented field the harness writes on each transcript entry; when it changes, recording fails closed rather than trusting what it cannot read. Nothing is recorded until the transcript reader in `scripts/lib/transcript.js` is updated. Tell whoever maintains the plugin; `operator.js sync --format-check` shows the state.

**5. The Chief of Staff's turn is blocked by its Stop hook** (once per turn: the first stop). Two common reasons, both with the way out in the message:

- An input of yours has no record. The Chief of Staff records it or acks it, then carries on:

  ```
  You have an operator input with no record: in-laptop-000003 ("ok thanks"). Record the decision (...) or acknowledge it (`node <plugin-root>/scripts/operator.js ack --input in-laptop-000003 --reason '<why this is not a decision>'`; for chat, `node <plugin-root>/scripts/operator.js ack --pending --reason 'conversational'` acks them all at once), then send the record id to the sessions that need it with SendMessage. Do not ask the operator to relay it.
  ```

- It asked you to pass something on. The relay guard quotes the clause; the Chief of Staff rewrites only that clause and sends the record id itself:

  ```
  You carry answers; the operator does not. You wrote: "Please tell the builder to include cancelled orders". Rewrite only that clause: a decision only the operator can make goes into your next batched briefing (if it blocks work now, ask it once here yourself); record the answer, then send the record id yourself with SendMessage.
  ```

  The relay guard is a heuristic backstop: it catches common phrasings, not all of them.
