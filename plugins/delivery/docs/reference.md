# delivery reference

The detail behind the [README](../README.md): who is who, every mechanism the shipping team
runs on, the operator-decision machinery, the artifacts, and why the pipeline is shaped the way
it is. The README is enough to start; read this when you need to know exactly what happens.

- [Sessions you run vs reviewers they call](#sessions-you-run-vs-reviewers-they-call)
- [The shipping team's mechanisms](#the-shipping-teams-mechanisms): roles, hooks, lanes, the leak guard, bead discipline
- [Operator decisions in detail](#operator-decisions-in-detail)
- [Using it with superpowers](#using-it-with-superpowers)
- [The five ideas doing the real work](#the-five-ideas-doing-the-real-work)
- [All skills](#all-skills)
- [Artifacts](#artifacts)
- [Adapting it](#adapting-it)
- [Why this exists](#why-this-exists)

## Sessions you run vs reviewers they call

Two different things carry role-like names, and they are not interchangeable.

**Roles are sessions you run.** Each is a long-lived Claude Code session in its own prepared
directory, with a brief in `roles/`, a lane and a model. You start them (`/delivery:start` prints
the commands) and they stay up.

| Role (display name) | Id in `team.json` | Default model | Owns |
| :-- | :-- | :-- | :-- |
| Chief of Staff | `chief-of-staff` | opus | your attention: records your words, answers from earlier records, one ranked briefing |
| Product Manager | `product-manager` | opus | DEFINE and CONTRACT documents (brief to roadmap), realign and pivots |
| Delivery Manager | `delivery-lead` | sonnet | NAVIGATE: stories, materialise, sprints, phase reviews, bead structure |
| Builder | `builder` (`builder-2`, ... when counted) | sonnet | product code, in its own worktree of the product repo |
| Staffing (optional, `full`) | `staffing` | sonnet | the roster: `team.json` and project briefs |
| Progress Observer (optional, `full`) | `progress-observer` | haiku | the record stays true: re-checks merged/deployed/verified claims, liveness, stale claims |
| Spike Researcher (optional, `full`) | `spike-researcher` | sonnet | answers `spike` beads from the architecture |

The role id `delivery-lead` is kept for compatibility (manifests, lanes, record ids); the role
is shown everywhere as the Delivery Manager.

**Agents are reviewer lenses, not sessions.** The files in `agents/` are personas that a skill
calls through the Agent tool (or that you call directly with `@delivery:<name>`) for one pass
over one artifact: a lens, a review, a draft. They do not stay running, hold beads, receive
messages or talk to you. A role brief may *compose* one of them (the Product Manager's brief
includes `product-owner`, the Delivery Manager's includes `delivery-lead`, the Chief of
Staff's includes `chief-of-staff`, the Progress Observer's includes `qa-strategist`), which is
why some names appear in both lists.

| Lens (agent) | Called by | Asks |
| :-- | :-- | :-- |
| `product-owner` | brief, prd, realign, challenge | who has this problem, what is in and out, what good means |
| `business-analyst` | brief, prd, challenge | what is ambiguous, unhandled, unmeasured |
| `qa-strategist` | brief (assess), prd, design, architecture, roadmap, sprint-review, challenge | can each criterion be checked; what has decayed |
| `feature-critic` (read-only) | brief, prd, design, architecture, roadmap, sprint-review, challenge (always) | the assumption that would sink it |
| `user-researcher` | personas, design, challenge | who the users are, graded by evidence |
| `persona-simulator` (read-only) | simulate, sprint-review, challenge | one persona, in character, labelled synthetic |
| `design-lead` | design, sprint-review, challenge | tokens, states, accessibility |
| `solution-architect` | architecture, challenge | is it buildable as written |
| `program-manager` | prd (staging), roadmap, realign, challenge | sequencing, dependencies, risk |
| `delivery-lead` | stories, challenge | is each story ready to pick up |
| `chief-of-staff` | composed into the Chief of Staff role | does a real source already settle this question |

## The shipping team's mechanisms

The pipeline's roles run as long-lived sessions, one per role, on the hosts that can do the work,
coordinating through cross-session messages (`SendMessage`) and beads. These pieces give a
session its role and keep it:

- **Role briefs**: `roles/*.md`. Project-specific briefs go in the project repo under `.delivery/team/briefs/`.
- **The manifest**: `.delivery/team/team.json` and `hosts.json` in the private project repo (templates in `templates/`). [team-example.md](team-example.md) explains each field.
- **`scripts/prepare-role.js --project <root> --instance <id>`** creates one directory per role
  instance with its own settings (model, env, actor), a composed `CLAUDE.local.md`, a clone of the
  project repo and, for builders, a worktree of the product repo. The env includes
  `DELIVERY_ROLE_DIR` (so the hooks still find the role after a `cd`) and, when the project has
  `.beads`, `BEADS_DIR`.
- **Hooks** (all in `hooks/hooks.json`; each is inert outside a role session unless noted):
  - SessionStart rewrites `CLAUDE.local.md` from the manifest, registers the session in the
    roster and captures operator input. On clear and compact it restates the role; on startup
    and resume it restates it only when `CLAUDE.local.md` changed in this run (otherwise the
    natively loaded copy is current) and adds the claim line.
  - UserPromptSubmit captures operator input, marks the turn and, when the claim changed, adds a
    one-line reminder of it (and, once, a reminder that the last turn left no note on its claim).
  - PreToolUse: the lane (writes, shell commands, MCP), the leak guard (product repo), the bd
    guard (claims, EVIDENCE, structure) and the operator channel guard (`AskUserQuestion`,
    `PushNotification`, `SendUserFile` for roles other than the Chief of Staff and the Product
    Manager).
  - Stop: captures operator input, then the operator checks for the Chief of Staff and the Product
    Manager (an unrecorded input, a relay request), at most two blocking stops per turn.
  - PostToolUse and PostToolUseFailure: the invocation recorder, async, writing only with
    `DELIVERY_LEDGER=1`.
- **`/delivery:team`** compares the roster with the manifest (live, stale, missing, wrong model),
  warns when bd cannot find a database, and counts operator entries not yet pushed, inputs waiting
  for a record and inferred answers waiting for ratification. `/delivery:team join` confirms a
  freshly started role session and reports it to the Chief of Staff.
- **`/delivery:materialise <initiative>`** turns `roadmap.md`, the stories and the architecture
  spikes into beads: one epic per phase chained by a phase-review bead, one task per story, one task
  per spike blocking what it derisks. Deterministic ids (`<prefix>-<initiative>-ph<N>`,
  `<prefix>-<story id>`, `<prefix>-<initiative>-spike-<key>`), idempotent, never touches closed
  beads; `--check` reports drift. It also writes `.delivery/team/denylist.txt`.
- **Runners.** A builder's manifest entry names its runner: `superpowers`, `attractor` or `plain`.
  Delivery plans, dispatches and reviews; the runner builds.
- **Spikes are standing work**: the Spike Researcher claims `spike` beads and records answers in the bead and the ADR or roadmap they gate; in a team without one, builders take spike beads first (`bd ready --label spike`).

### Lanes

Each role file declares `lane_writes` (paths it may edit, relative to its role directory) and
`lane_bash` (command groups from `hooks/lane-groups.json`). A PreToolUse hook refuses anything
else and names the sanctioned path: managers route work to builder beads, builders never touch
plans. Subagents go through the same hook. Refusals are logged to `.delivery-lane.log` in the role
directory. A role file without `lane_bash` gets read-only groups; every role may write the
harness's own plan and memory files under `~/.claude`.

The lane covers every shell channel and MCP: `Monitor` commands are judged like Bash,
`PowerShell` is allowed only for roles with `any`, and any other tool carrying a `command` is
treated as Bash when `hooks.json` routes it to the hook. For roles without `any`, MCP tools are
read-verb only unless the role file's `lane_mcp` names them; the managers' `lane_mcp` allows
session messaging and listing.

### The leak guard

In a product worktree, commit, PR, issue and release text (through Bash, Monitor or PowerShell)
is checked against `.delivery/team/denylist.txt`, plan files cannot be written, and
`gh issue create` is refused. For roles that touch product, GitHub- and GitLab-style MCP tool
inputs pass the same scan and MCP issue creation is refused. Builders use plain
`git commit -m "text"`: command substitution, heredoc messages, `-F` files and `$VAR` in message
or push-option arguments are refused so the text can be checked.

The guard is the first line, not the last. It fails closed inside the product worktree, but it
is not a boundary against a determined session with unrestricted Bash (file contents, git
plumbing, persistent git configuration and pushes from other repositories are out of its reach).
For the durable control, scan the denylist on the product remote, for example:

```yaml
# .github/workflows/denylist.yml — fails a push whose commit messages carry a plan phrase.
# DENYLIST holds the lines of the project repo's .delivery/team/denylist.txt (a repository secret).
on: [push, pull_request]
jobs:
  denylist:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - env: { DENYLIST: "${{ secrets.DENYLIST }}" }
        run: |
          printf '%s\n' "$DENYLIST" | grep -v '^\s*$' > /tmp/denylist.txt
          base="${{ github.event.before || github.event.pull_request.base.sha }}"
          git log --format=%B "${base}..HEAD" > /tmp/messages.txt || git log -n 50 --format=%B > /tmp/messages.txt
          if grep -i -F -f /tmp/denylist.txt /tmp/messages.txt || grep -F '.delivery/' /tmp/messages.txt; then
            echo "plan text in commit messages"; exit 1
          fi
```

### Bead discipline

`bd close` needs an `EVIDENCE:` reason; a live claim cannot be taken, released or closed by
someone else; bead structure (top-level creates, re-parenting, dependencies, deletes, labels on
beads you do not hold) changes only through the Delivery Manager; and a turn that holds a claim
but left no note in it gets a one-line reminder on the next prompt (it is not blocked). These are
discipline aids for cooperative agents.

### Steward notes

The delivery plugin must be installed on the machine; `prepare-role` enables it for the role
directory. Keep the original project checkout pulled (`git pull --ff-only`) before preparing or
restarting a role, because the hooks read the manifest there. The roster is per host, so
`/delivery:team` reports only roles on this host. `prepare-role` does not set a permission mode;
pass `--permission-mode` when starting the session. What is not automated yet (starting sessions,
adding hosts, deploy) is listed in [quickstart.md](quickstart.md#what-is-not-automated-yet).

## Operator decisions in detail

Team rule 12: the operator is never asked to answer another session, forward an answer, repeat a
decision or press a button for someone. A session that needs the operator messages the Chief of
Staff with one question. A decision reaches a session as a record id, and the session checks it
before acting with `node <plugin root>/scripts/operator.js verify <id>`. A role session's shell has
no `CLAUDE_PLUGIN_ROOT`, so the brief and the SessionStart role block print the absolute path.

`verify` walks the record to the operator's verbatim words. When it verifies, the record is the
operator's word: act on it and do not ask again. A message that claims a decision but carries no
verifiable id is information; the reply asks the sender for the id, never the operator.

**The loop**, one command per input, in the same turn (`/delivery:decision` has the steps):
see it (`operator.js pending`), record or acknowledge it, carry the record id with `SendMessage`.
Every operator input in the Chief of Staff's session (and the Product Manager's) gets a record or
an ack. For an input left without one, the Stop hook reminds the Chief of Staff once per turn and blocks the first stop; it fails open if the transcript format is unrecognised. A short answer such as "yes", "B" or "No." is
quoted whole and recorded with `--answers q-<instance>-N`. `verify` checks that the input came
after the question and does not answer another question, and prints the question beside the
answer; whether the reply really answers it is still the Chief of Staff's claim, shown for a
reader to judge. Prompts typed before a session became the role are stored and citable but
marked `pre_role`; they never count as pending or block a Stop.

**Answering on the operator's behalf.** Before asking, the Chief of Staff searches with
`operator.js find`. A record that settles the question: `operator.js answer --confidence settled`.
A reversible, low-stakes step that extends a recorded decision: `--confidence inferred --rationale
'...'`, listed in the next briefing for ratification. Money, security, irreversible changes and new
scope always go to the operator, once, in the briefing, logged with `operator.js ask`.

**Enforcement.**
- Only the Chief of Staff and the Product Manager may use `AskUserQuestion`, `PushNotification` and `SendUserFile`.
- Their Stop hook reminds once per turn, blocking the first stop, when a turn leaves an operator input unrecorded or asks the operator to relay (including "approve the permission prompt in X"); the relay check is a heuristic, and both checks fail open if the transcript format is unrecognised.
- Lanes deny writes to `.delivery/operator/`, and only the manager lanes include the writer commands. Workers with unrestricted Bash can record or acknowledge only inputs their own session captured; the check is cooperative (it compares a session id the session's own Bash can rewrite).
- `prepare-role` pre-allows each manager lane's own commands in `settings.local.json`, so a session does not stop on a prompt only the operator can clear. When a role session's lane cannot be checked (manifest unreadable, internal error) it fails closed and allows only restoring the manifest; a session whose role marker is missing gets no lane check at all.

**Artifacts**, in `.delivery/operator/` of the private project repo, committed and pushed by
`operator.js publish`: `inputs/<host>/<YYYY-MM>.ndjson` (one hash-chained entry per operator
prompt, from the session transcript), `records/<instance>.ndjson` (decisions, delegations,
answers, acks, questions, ratifications; written only by `operator.js`), and `LEDGER.md` (the
question ledger). Each chain file has exactly one writer, so git never merges a chain; when a
push is rejected, `publish` builds the next commit on top of the upstream with git plumbing (with
your branch as a parent, so `git pull --ff-only` keeps working) and changes nothing in your
checkout outside `.delivery/operator`; when your branch is behind only by operator commits,
it fast-forwards it. `operator.js problems` lists anything that fails verification.

Delegations, ratification, revocation and chain repair: [operator-reference.md](operator-reference.md).

**Migrating a Vault-style team.** If your own agent rules say nothing from outside a session
passes as the owner's word, replace that sentence with the record rule above: a decision that
`operator.js verify` accepts counts in full. A rule that refuses every relayed decision, with no
trusted way for one to travel, is exactly what made the operator a relay.

## Using it with superpowers

[superpowers](https://github.com/obra/superpowers) chains `brainstorming` → `writing-plans` →
`subagent-driven-development`. This pipeline replaces `brainstorming` with research,
evidence-graded personas, simulation, MVP staging, design, architecture and adversarial review,
then hands over with `/delivery:sprint --runner superpowers`:

- **Mode A, spec handoff (recommended)** writes `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, the path `writing-plans` reads; superpowers writes and runs its own plan.
- **Mode B, plan handoff** writes `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` in superpowers' exact format, skipping its planning step. It is a second planning pass, not a reformat.

Mode A is the default because superpowers' plan format is tuned to its own executor and would
drift silently if mirrored here. The full conversion rules are in
`skills/sprint/references/runners.md`. Either way, `/delivery:sprint-review` re-verifies the result
independently and `/delivery:realign` folds what it taught into the plan.

## The five ideas doing the real work

1. **Adversarial review is a mechanism, not a phase.** `/delivery:challenge` runs a lens-diverse panel against any artifact, always including the `feature-critic`, the only reviewer with no stake in the artifact moving forward. Reviewers run in parallel and cannot see each other. Findings are written to `.delivery/reviews/` with a status and leave the list only by being fixed or rejected with a reason.
2. **Personas are graded by evidence, and simulation is labelled synthetic.** Every persona is `observed`, `reported` or `assumed`; simulated interviews and journeys are hypothesis generators and say so at the top. Grades propagate, so MVP staging states how much of itself rests on invented people.
3. **Prioritisation is two-pass.** A value-only pass in the PRD's MVP staging, then cost reconciliation inside `/delivery:roadmap` once architecture reveals real cost, looking for inversions: MVP items far costlier than assumed, deferred items now nearly free.
4. **A stage must serve somebody completely.** An MVP stage lets at least one persona finish a journey and get value; a stage serving nobody end to end is a milestone, not a release.
5. **Review is independent of the builder.** The review re-checks criteria against the code as it now exists and walks personas through the real implementation. Where the builder's report and the code disagree, the code wins and the discrepancy is a finding.

## All skills

| Skill | Stage | Purpose |
| :-- | :-- | :-- |
| `/delivery:brief` | DEFINE | Problem, users, cost of the status quo; frame or assess mode |
| `/delivery:research` | DEFINE (optional) | Prior art, domain constraints, technical landscape, cited |
| `/delivery:personas` | DEFINE (optional) | 3–5 behavioral personas, evidence-graded |
| `/delivery:simulate` | DEFINE (optional) | `--interview`: needs and objections; `--journey`: ranked friction map |
| `/delivery:prd` | DEFINE | Scenarios, falsifiable criteria, NFRs as numbers, then MVP staging (`--stage`) |
| `/delivery:design` | DEFINE (optional) | Seed → tokens, component states, computed contrast |
| `/delivery:architecture` | DEFINE | Real-codebase design, alternatives, spikes, migration |
| `/delivery:roadmap` | CONTRACT | Risk-first sequencing, critical path, cut lists, cost inversions |
| `/delivery:stories` | CONTRACT | Vertical slices carrying full context and acceptance criteria |
| `/delivery:materialise` | NAVIGATE | Roadmap, stories and spikes → beads; denylist |
| `/delivery:sprint` | NAVIGATE | Scope package with stop conditions; `--runner` for an external runner |
| `/delivery:sprint-review` | NAVIGATE | Independent acceptance verdict and calibration |
| `/delivery:realign` | NAVIGATE | Update assumptions, estimates, staging and roadmap |
| `/delivery:challenge` | any gate | Adversarial panel against any artifact |
| `/delivery:status` | any time | Gates, open findings, drift, evidence grounding |
| `/delivery:start`, `/delivery:team`, `/delivery:decision` | team | Start a team; status and join; the operator-decision loop |

Kept for one version as aliases: `/delivery:interview` (now `simulate --interview`),
`/delivery:handoff` (now `sprint --runner`), `/delivery:prioritize` (now `prd --stage`),
`/delivery:join` (now `team join`) and `/delivery:glossary` (removed: every skill keeps
`.delivery/glossary.md`, see the Language section of `references/conventions.md`).

## Artifacts

All under `.delivery/`, hidden and tracked in git, all markdown:

```
initiatives/<slug>/
  brief.md   research.md   prd.md   prioritization.md   design-system.md
  architecture.md   roadmap.md   notes.md
glossary.md   personas/    interviews/    simulations/
decisions/ADR-NNN-*.md      stories/<slug>-<nn>-*.md
reviews/<slug>-<artifact>-<nn>.md  sprints/<n>-<slug>.md, <n>-<slug>-review.md, <n>-realign.md
invocations/<session_id>.ndjson   (only with DELIVERY_LEDGER=1)
```

Every planning document lives under `.delivery/initiatives/<slug>/`, one directory per
initiative, so independent initiatives can be planned in separate branches without colliding on
one shared `prd.md` (`ADR-004`). Glossary, personas, interviews, simulations, ADRs and
invocations stay project-wide. Every skill resolves where `.delivery/` lives and which initiative
applies the same way, before touching anything: the rules are in `references/conventions.md`.
In a monorepo or marketplace this puts each component's artifacts beside it
(`plugins/<name>/.delivery/`), and the skills stop and ask rather than guess.

Requirement IDs (`FR-n`, `NFR-n`) assigned in the PRD thread through staging, architecture,
roadmap, stories and tests; `/delivery:status` walks that chain to find requirements no story
covers and documents that have drifted apart.

## Adapting it

Almost everything is markdown. Edit `agents/*.md` to change a lens's stance, `templates/*.md` to
change what an artifact must contain, or `references/conventions.md` to change a rule every skill
shares. To relocate `.delivery/` for a project, state the path in that project's
`CLAUDE.md`/`AGENTS.md`.

The invocation ledger is opt-in: set `DELIVERY_LEDGER=1` in the environment of the sessions you
want recorded (for a role, in the `env` block of its `.claude/settings.local.json`, which
`prepare-role` keeps on rerun). A hook then appends real tool-call events to
`.delivery/invocations/<session_id>.ndjson`, and `/delivery:status` reports each artifact as
invoked, not invoked or untraceable. Without it nothing is recorded and status says the ledger is
off. Why: `ADR-001-hook-based-invocation-provenance.md` in the plugin's own `.delivery/decisions/`
in the source repository.

## Why this exists

Persona libraries ([wshobson/agents](https://github.com/wshobson/agents),
[VoltAgent](https://github.com/VoltAgent/awesome-claude-code-subagents)) give you a
`product-manager` agent but no pipeline: nothing connects one role's output to the next role's
input. Method frameworks ([BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)) give you the
pipeline but arrive as a CLI installer that writes into your project, with a module ecosystem you
mostly won't use. Neither models the customer, and neither closes the loop by checking whether
what shipped was any good.
