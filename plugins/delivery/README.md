# delivery

## Start here

delivery gives you a team of Claude Code sessions, one per role, that plan and ship a product while you talk mainly to one of them, the **Chief of Staff** (and to the Product Manager about product vision). You decide once: your exact words are recorded with proof that every session can check, so nobody asks you to repeat or pass anything on. Without a team, the same plugin is a planning pipeline that turns your intent into a brief, a PRD, an architecture, a roadmap and stories.

### Prerequisites

- Claude Code v2.1.224 or later, on macOS or Linux (the sessions message each other).
- Node 18 or later, and git.
- beads: `bd` on the PATH. **Beads** are the team's work items.
- A private **project repo** (the plan, the team manifest, your decisions) and, for an existing product, its **product repo** (code only).
- This plugin installed: `/plugin install delivery@ai-augmentation-systems`.

`/delivery:start` checks all of these for you and names the fix for anything missing.

### Start a new project in 3 steps

1. **Install the plugin:** `/plugin install delivery@ai-augmentation-systems` (the repository README has the marketplace step).
2. **Run `/delivery:start`** in an ordinary Claude Code session, outside any role directory. It asks for the project repo, the product repo, the host name, the preset, the model profile and the permission mode, shows a dry run, then writes the team manifest, creates the beads database, prepares one directory per role and prints the command that starts each session.
3. **Start the printed sessions,** run `/delivery:team join` in each, then open the Chief of Staff session and talk to it.

### Using the team

- **Talk to the Chief of Staff** for decisions and logistics; talk with the Product Manager about product vision. Both record what you decide. Other sessions send their questions to the Chief of Staff; it answers from what you already decided and asks you the rest once, in one ranked briefing.
- **See progress** with `/delivery:team` in any session (who is live, stale or missing), or ask the Chief of Staff for a briefing.
- **Decisions are recorded and verified.** `operator.js ledger` lists every question the team asked you and its answer; a session runs `operator.js verify <record id>` to see your exact words before it acts.
- **When something blocks,** the refusal names the way out. See [Troubleshooting](docs/quickstart.md#troubleshooting).

### Use the planning pipeline without a team

Run the pipeline skills yourself, from `/delivery:brief` on: see [Using the planning pipeline without a team](#using-the-planning-pipeline-without-a-team).

## What you get

- **A product defined before it is built**: brief, PRD with MVP stages, architecture, then a roadmap and stories with acceptance criteria, each gated and open to adversarial review.
- **Your attention protected.** Only what only you can decide reaches you, once, in one ranked briefing, and each decision carries a **record id** any session can check against your exact words.
- **Roles that cannot do each other's jobs.** Each role has a **lane**, enforced by hooks.
- **The right model for each job**, set per role and raised per story.
- **Work that finishes.** The team builds in compounding waves per product area, each verified on the customer's app before the next builds on it; it picks fixes and work that builds on verified work first, and under the budget you set it never starts what it cannot finish. Large stories are costed on the large model they are built with (opus by default), so set the weekly figure with that in mind: see [Waves, budget and selection](docs/reference.md#waves-budget-and-selection).
- **Strategy stays private.** Plans and decisions live in the project repo; the product repo gets code only.

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
   (who is on    Manager        Manager        Observer       (build in      Researcher
   the team)     (define,       (navigate:     (keeps the     the product    (answers
                 contract)      plan → beads)  record true)   repo)          spike beads)

  How one decision travels (a record id, never a relay):

    1. you say "B"  ──▶  2. Chief of Staff records it  ──▶  3. record id sent to the session
                            operator.js record --quote 'B' --answers q-...   dec-chief-of-staff-000004
                                                                          │
                                     4. the session checks it: operator.js verify dec-chief-of-staff-000004
                                        VERIFIED ... operator said: "B"   (then acts; never asks you)

  Two repositories:

    private PROJECT repo (strategy)                 PRODUCT repo (code only)
    .delivery/initiatives, stories, reviews         one worktree per builder, branch team/<instance>
    .delivery/team/                                 leak guard: plan text and plan files refused
    branch delivery-operator: operator records
      (kept in .git/delivery-operator, never in your checkout)
```

## The flow: Define → Contract → Navigate

`*` marks optional depth. **Fast path:** `/delivery:brief` → `/delivery:prd` → `/delivery:architecture` → `/delivery:roadmap` → `/delivery:stories`. `/delivery:challenge` runs an adversarial panel at any gate; `/delivery:status` shows where everything stands. Every step reads the previous artifact and stops if it is missing rather than improvising one.

**1. DEFINE the product.** `/delivery:brief` → `/delivery:research`* → `/delivery:personas`* → `/delivery:simulate`* (`--interview`, `--journey`) → `/delivery:prd` (with MVP staging) → `/delivery:design`* → `/delivery:architecture`.
- Produces: the problem and who has it, evidence-graded personas, a PRD with falsifiable criteria and NFRs as numbers, MVP stages that each let a persona finish a journey, a design system, an architecture with ADRs and spikes.
- Owner: the Product Manager, talking with you about the vision. Model tier: the strongest (opus); this is where judgement pays.

**2. CONTRACT.** `/delivery:roadmap` → `/delivery:stories`.
- Produces: phases in risk-first order with cut lists and a value/cost reconciliation, then self-contained stories with acceptance criteria, each sized S, M or L, and spikes that block what they derisk.
- Owner: the Product Manager writes the roadmap (opus); the Delivery Manager writes the stories (sonnet).

**3. NAVIGATE delivery.** `/delivery:materialise` → `/delivery:sprint` → build → `/delivery:sprint-review` → `/delivery:realign`.
- Produces: beads from the plan, a sprint package with stop conditions, code from dedicated builders in their own worktrees, an independent acceptance verdict, and a re-aligned plan.
- Owner: the Delivery Manager runs it (sonnet); builders build (sonnet, raised for L stories); the Product Manager owns realign, the pivot point, and brings any pivot to you.

## The team

The default team (`minimal` preset) has four roles:

- **Chief of Staff** — your channel for decisions and logistics; every other session asks it, not you. It runs the team's day from the record: a ranked plan each morning, each item sent to the role that owns it, and a short briefing the plugin writes ([the Chief of Staff's day](docs/reference.md#the-chief-of-staffs-day)).
- **Product Manager** — owns what to build and why: DEFINE and CONTRACT, realign and pivots; talks with you about vision.
- **Delivery Manager** — owns stage 3: stories, materialise, sprints, phase reviews and the bead graph; assigns work to builders; has each pull request reviewed independently and merges it on a passing review.
- **Builder** — builds one story at a time in its own worktree of the product repo, with a runner (`plain`, `superpowers` or `attractor`); opens the pull request and hands it to the Delivery Manager, resolves conflicts when asked, and never merges.

The `full` preset adds four optional roles:

- **Staffing** — owns the roster (`team.json`, project briefs).
- **Progress Observer** — keeps the record true: re-checks what is claimed merged, deployed or verified, watches liveness and releases stale claims.
- **Spike Researcher** — answers spike beads from the architecture.
- **Reality Checker** — runs the reality-check script for a deployed story on the real customer surface, with browser control or computer use, and records a row per criterion; the only role with those tools. It is on by default, in either preset, when a declared surface is not scriptable; opt in otherwise with `start.js --reality-checker`. The owner is never asked to run a check: see [Reality checks](docs/reference.md#ready-and-done-gates).

**Ready and done gates.** A story names its customer surface (`surface.json`) and states its criteria as what the customer sees there, each with a probe; a story closes only when every criterion has a pass row on that surface, on the deployed sha, recorded by someone other than its builder. Gates block only on a divergence from what was agreed; everything else is a counted warning the Delivery Manager acknowledges. Status is merged, deployed, verified, from the record: see [Ready and done gates](docs/reference.md#ready-and-done-gates).

Who talks to whom: you talk to the Chief of Staff (and to the Product Manager about vision); every session messages the Chief of Staff with questions for you; work moves between roles as beads, and the Delivery Manager alone changes their structure. The agents in `agents/` are reviewer lenses that skills call, not sessions: see [Sessions you run vs reviewers they call](docs/reference.md#sessions-you-run-vs-reviewers-they-call).

## Models

| Role | Default | Raise it when |
| :-- | :-- | :-- |
| Chief of Staff | opus | keep it high: it judges what reaches you |
| Product Manager | opus | keep it high: DEFINE and CONTRACT are judgement work |
| Delivery Manager | sonnet | stories keep coming back not ready, or the plan is large |
| Builder | sonnet | per story, through its size label (below) |
| Staffing, Spike Researcher, Reality Checker | sonnet | spikes are deep research |
| Progress Observer | haiku | its sweeps miss drift |

**Pick a whole-team profile** when you start: `start.js --models quality|balanced|economy` (`balanced`, the default, is this table; `quality` also puts the Delivery Manager on opus; `economy` moves the senior roles to sonnet and Staffing to haiku).

**Change a role's model:** edit `roles[].model` in `.delivery/team/team.json`, rerun `prepare-role` for that instance, and restart its session. `/delivery:team` shows each session's model and flags a wrong one. The model is how you set the cost of each role; `budget.builders_cap` limits how many builders run.

**Per story:** the Delivery Manager sets `size: S|M|L` in every story (S routine, M ordinary, L risky or ambiguous). Materialise turns it into a `size-S|M|L` label; a builder gives `size-L` beads a stronger model for its implementer and reviewer (`$DELIVERY_LARGE_MODEL`, opus except in `economy`), and a story that needs a specific model says `model:` in its frontmatter.

## Operator decisions

**In plain words.**
You answer once.
The Chief of Staff records your exact words, links them to the question, and sends the record id.
A worker runs `verify` and sees your words and the chain back to them.
Nobody asks you to pass anything on.
You get no orders: what only you can do (a sign-in, a payment, a secret, a scope or money decision) arrives once a day as exact steps (`owner-queue.js list`).
To set a budget or pause the team, the Chief of Staff asks you a Yes/No question in a question box; clicking Yes is the decision; idle with ready work is flagged, and messages to you are plain, short and end with "Ask for details on any item" ([details](docs/reference.md#owner-authority-and-communication)).

**Day-one commands** (the Chief of Staff runs them; `/delivery:decision` has the loop):

- `operator.js pending` — your inputs not yet recorded.
- `operator.js record --cite in-<host>-N --quote '<exact words>' --statement '...' --scope bead:<id>` — record a decision.
- `operator.js ack --input in-<host>-N --reason '...'`, or `operator.js ack --pending --reason 'conversational'` for chat — acknowledge the rest.
- `operator.js find`, `operator.js answer`, `operator.js ask` — answer from earlier records, or log a question for your briefing.
- `operator.js verify <id>` — any session checks a decision before acting; `operator.js ledger` lists every question and answer.

**Where the records live.** Not in your checkout. Each checkout keeps them in a private git repository inside its `.git` directory (`.git/delivery-operator/`), so `git status`, `git clean`, `git stash`, `git reset --hard`, `git pull` and your own commits never see them. They travel on the project remote's `delivery-operator` branch, which carries operator files only: your repository's branch rules must allow pushes to it, and a session (cloud and SSH ones included) publishes only with push access to the project remote. Without a remote the records stay local. **Deleting or re-cloning the checkout deletes `.git/delivery-operator` and every entry not yet published** (without a remote: everything): run `operator.js publish` and check that `/delivery:team` shows `Operator entries unpublished: 0` first. Published entries come back in a new clone. Inspect the store with `git -C .git/delivery-operator log --stat`.

Delegations, ratification, revocation and chain repair are in [docs/operator-reference.md](docs/operator-reference.md); enforcement and the record files in [docs/reference.md](docs/reference.md#operator-decisions-in-detail). [docs/quickstart.md](docs/quickstart.md) walks through one decision with real output.

**Limits.** This is tamper-evidence for cooperative sessions, not a security boundary.
- **Files can be rewritten.** A session with unrestricted Bash can rewrite and re-hash the files; the hash chains, recorded heads, the store's append-only merge check and its git history make that detectable, not impossible.
- **Push access is trust too.** Anyone who can push to the project remote can pre-seed a new host's chains, write records citing inputs they typed, or push a line claiming a host, which blocks that host's publishing until its chain is set aside (`operator.js quarantine`, reviewed with `--adopt-remote`). A rehost counts only when the committed `team.json` agrees. Details: [docs/reference.md](docs/reference.md#operator-decisions-in-detail).
- **Recorded heads are local** (`cursors/heads.json` on each host), so they are cooperative trust too.
- **Records are checked for form, not relevance.** A well-formed record citing a real input cannot be machine-rejected when the input does not support it; detection is human, from the verbatim words and author `verify` prints.
- **Capture depends on the harness's undocumented transcript format.** If it changes, `operator.js sync` reports `format_unrecognised` and recording fails closed. Cloud sessions are captured only when they sync from their own host.
- **The pre-role boundary is a local file** (`cursors/role-since/<instance>.json` in the operator store); deleting or post-dating it hides genuine inputs.
- **Keystrokes can be injected** into another session by a role with unrestricted Bash, and the harness records that as a human prompt.
- **The relay detector is a heuristic backstop**; the structural fix is that no session ever needs you to relay.
- **Instance ids belong to one role.** A new role gets a new id; mark a departed instance `"retired": true` in `team.json` rather than deleting it.

## Using the planning pipeline without a team

Run the skills yourself, in order; each writes under `.delivery/` and gates on the one before. In a shipping team the role whose lane holds the output runs them.

### Which skill do I run when?

| When | Run | Stage |
| :-- | :-- | :-- |
| You have an idea, or a product to assess | `/delivery:brief` | DEFINE |
| The brief exists; you need prior art and constraints | `/delivery:research` | DEFINE, optional |
| You need the users the product is for | `/delivery:personas`, then `/delivery:simulate --interview` or `--journey` | DEFINE, optional |
| Users are settled; you need a specification and an MVP | `/delivery:prd` (re-stage with `--stage`) | DEFINE |
| You need look and feel, then a technical design | `/delivery:design`, then `/delivery:architecture` | DEFINE |
| Design is settled; you need order and stories | `/delivery:roadmap`, then `/delivery:stories` | CONTRACT |
| A wave of work is ready to build | `/delivery:sprint` (`--runner superpowers` or `generic` for your own runner) | NAVIGATE |
| The wave was built | `/delivery:sprint-review`, then `/delivery:realign` | NAVIGATE |
| Before you commit to any document | `/delivery:challenge` | any gate |
| You want to know where the plan stands | `/delivery:status` | any time, read-only |
| You want a shipping team for a project | `/delivery:start` | team, your own session |
| A role session has just started | `/delivery:team join` | team, every role session |
| You want to see who is live, stale or missing | `/delivery:team` | team, read-only |
| The operator spoke, or a session needs an operator decision | `/delivery:decision` | team, the Chief of Staff |
| The roadmap, stories or spikes changed | `/delivery:materialise <initiative>` | team, the Delivery Manager (anyone with `--check`) |

New terms go in `.delivery/glossary.md`; every skill keeps it. Renamed skills keep a one-line alias for one version: `interview`, `handoff`, `prioritize`, `join`, `glossary`.

## Clashes and limits

The shipping team runs on hooks and per-role settings. These are the places where they meet the rest of a Claude Code setup.

- **Permission modes.** With a user-level `defaultMode` of `auto`, or a role started with `--permission-mode`, nothing prompts: the lane hook is then the only allowlist, and a hook that fails to spawn (no `node`, a moved plugin path) fails open. `prepare-role` also writes native `permissions.deny` rules that hold even then: `AskUserQuestion`, `PushNotification` and `SendUserFile` for every role except the Chief of Staff and the Product Manager, and `Bash(git push:*)`, `Bash(sudo:*)`, `Bash(curl:*)`, `Bash(wget:*)` and `Bash(rm:*)` for manager lanes that do not allow them. A role session whose lane cannot be checked fails closed.
- **Plugin updates.** Hook paths are fixed when a session starts, and the allow rules name the operator.js path of the plugin version that wrote them. After updating, rerun `prepare-role` for each role and restart its session.
- **superpowers.** Its "you must invoke skills" instruction competes with the manager lanes. Consider disabling it in manager role directories through `enabledPlugins` in the role's `settings.local.json`.
- **ralph-loop and the Stop cap.** Claude Code allows at most 8 consecutive Stop blocks; the delivery Stop hook blocks at most twice per turn, but a loop plugin that also blocks Stop shares the budget.
- **Role directories make roles.** An ordinary session started inside a role directory becomes that role, with its lane, deny rules and Stop guard.
- **The product-repo guard is a first line.** It stops a cooperative or careless session; for the durable control, scan the denylist on the product remote ([example](docs/reference.md#the-leak-guard)).
- **The typed judge sends text to a third party, only if you turn it on.** Off by default. With a `judge` block in `team.json` and `TYPESAFE_API_KEY` set, the Stop hook sends the Chief of Staff's or Product Manager's final message (code and quotes removed) to TypeSafe (`api.typesafe.ai`) to ask whether it asks you to relay, gives you orders, or reads as jargon or justification, and any role can ask a catalogued question with `judge.js ask`, which sends only that question's fields. A best-effort pattern filter refuses text that looks like a token, credential, id, email, URL, path, IP address or phone number, or matches the denylist; it does not reliably catch names or other personal data. Answers are advisory and logged locally without the text ([details](docs/reference.md#the-typed-judge)).
- **Cost.** Each hook is a separate `node` process, about 38 ms per delivery hook; a Bash call pays 3 (lane, leak guard, bd guard), a Write or Edit 3, and the hooks return immediately outside a role.

## Reference

- [docs/quickstart.md](docs/quickstart.md) — the manual way to start a team, step by step, one decision traced with real output, troubleshooting.
- [docs/reference.md](docs/reference.md) — sessions vs reviewer lenses, lanes, hooks, the leak guard, bead discipline, operator decisions in detail, superpowers, artifacts, every skill, adapting it, why it exists.
- [docs/operator-reference.md](docs/operator-reference.md) — the rest of `operator.js`.
- [docs/team-example.md](docs/team-example.md) — a manifest explained field by field.
