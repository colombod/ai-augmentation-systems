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
| Delivery Manager | `delivery-lead` | sonnet | NAVIGATE: stories, materialise, sprints, phase reviews, bead structure; independent review requests, acceptance and merging pull requests |
| Builder | `builder` (`builder-2`, ... when counted) | sonnet | product code, in its own worktree of the product repo; opens the pull request, never merges |
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
    guard (claims, structure, the ready and done gates) and the operator channel guard (`AskUserQuestion`,
    `PushNotification`, `SendUserFile` for roles other than the Chief of Staff and the Product
    Manager).
  - Stop: captures operator input, then the operator checks for the Chief of Staff and the Product
    Manager (an unrecorded input, a relay request, asked of the [typed judge](#the-typed-judge) first
    when it is on), at most two blocking stops per turn.
  - PostToolUse and PostToolUseFailure: the invocation recorder, writing only with
    `DELIVERY_LEDGER=1`; synchronous for a successful Write, Edit or NotebookEdit (it hashes the
    file as the tool left it), async for everything else.
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

Merging is the Delivery Manager's: for every other role, `any` lanes included, the hook refuses
`gh pr merge`, the merge endpoints through `gh api`, a push to the default branch (`main`,
`master`, or what `origin/HEAD` names; a bare `git push` while on it), `git merge` while on it,
and MCP merge tools; `prepare-role` adds a native `Bash(gh pr merge:*)` deny rule for those roles.
A builder pushes its own branch and merges the default branch into it to resolve a conflict. The
Delivery Manager requests an independent review (a reviewer subagent or another session, never the
author) and merges only on a passing review of the pull request's current head; a conflict or new
commits send the pull request back to its owner and to review again.

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

### The typed judge

An optional, advisory model that answers catalogued gate questions with a typed answer (a
probability, or one of a fixed set of options with a confidence). It is off unless the manifest
has a `judge` block and the key variable is set in the session's environment:

```json
"judge": { "provider": "typesafe", "model": "jev-latest", "key_env": "TYPESAFE_API_KEY", "block_threshold": 0.8, "warn_threshold": 0.5 }
```

`provider` is `typesafe` (TypeSafe Jev) or `none`. `key_env` must be `TYPESAFE_API_KEY` or another
`TYPESAFE_*` variable, so a manifest edit cannot turn another secret into the bearer token. The key
is read from the environment only, sent only as the `Authorization` header to
`https://api.typesafe.ai/v1/systemone`, and never logged. The manifest cannot change the endpoint; the
only override is the `DELIVERY_JUDGE_ENDPOINT` environment variable, accepted for a loopback address
only (the tests' fake provider). Gateways are not supported yet. Unknown keys are ignored with a
warning. `block_threshold` must be 0.5 to 0.95 and `warn_threshold` 0.2 to `block_threshold`; out of range,
the judge stays off and the regex decides. `judge.js` reads the configuration only from the project of the session's role marker (or,
outside a role, `DELIVERY_PROJECT_ROOT`); it takes no `--project`.

The catalogue is `judge/questions.json`, versioned per question:

| Question | Type | Used by | Mode |
|---|---|---|---|
| `relay_request` v1.1 | probability | the Chief of Staff's and Product Manager's Stop hook | confirms or overrules the regex (below) |
| `divergence` v2 | none, minor, serious | the done gate (bd guard on close) | warn-only until re-measured on real gate summaries |
| `shippable_unit` v2 | yes, partial, no | the ready gate (`ready.js`, bd guard on claim) | advisory: a warning at most |
| `builds_on_verified` v2 | strongly, partly, new area | library and CLI only for now | advisory |
| `is_fix` v1 | probability | library and CLI only for now | advisory (a probability, not the yes/no choice first planned) |
| `orders_owner` v1 | probability | the Chief of Staff's and Product Manager's Stop hook | warns at 0.5; blocks once at 0.8 only with an out-of-queue order to the owner (below) |
| `tone_violation` v1 | none, justifying, condescending, therapeutic | the same Stop hook | warn-only |
| `jargon` v1 | probability | the same Stop hook, when the id rule finds nothing | warn-only, at 0.8 |
| `goal_instruction` v1 | probability | `goal.js set`, free-text path only | a free-text change needs it at p ≥ 0.8 with the word rule; without the judge only the confirmed question sets a field (not measured) |

- **Tool:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/judge.js ask <question-id> --state <file|->` prints the
  typed result as JSON (exit 0 answered, 3 skipped or failed, with the reason); `judge.js questions`
  lists the catalogue; `judge.js stats` summarises the log. Every role's lane has the `judge` group, so
  once the judge is enabled any role can send up to 16,000 characters of filtered text to the provider
  through it; such calls are logged with gate `cli`.
- **Relay guard:** with the judge on, the Stop hook asks `relay_request` about the final message
  (code blocks, inline code, quoted lines and double-quoted spans removed first). When the regex
  detector also flags a clause, the block stands unless the judge is clearly negative: p ≥ the lower
  of `warn_threshold` and 0.5 blocks (the clause and p quoted); below it the stop passes and the overruled hit is
  recorded in the judge log (`judge.js stats` counts them). Without a regex hit, p ≥ `block_threshold`
  blocks once (the message's start quoted), the band from `warn_threshold` to `block_threshold` leaves a
  one-line reminder for the next prompt, and below it passes. Off, refused locally, errored, malformed
  or timed out (2 s), the regex detector decides as before. A continuation that can no longer block
  asks nothing. The answer is kept in the stop state.
- **What is sent:** only the question's declared state fields. A best-effort pattern filter refuses the
  call locally when a declared field (names and values, nested objects flattened) looks like a token,
  key, credential, id, email, URL, path, IP address or phone number, contains the key's own value, or
  matches `.delivery/team/denylist.txt` (a denylist that exists but cannot be read refuses every call).
  The result names the field and the kind, never the value. States over 16,000 characters are refused.
  Names and other personal data are not reliably detected: send only the declared minimum.
- **The log:** each call is one advisory line in `.delivery/judge/<date>.ndjson` (gitignored): question,
  version, model, answer, probabilities, latency, tokens, the gate, how many undeclared fields were
  dropped, and a sha256 of the state sent, not the state. `judge.js stats` reports calls, latency
  p50/p95, tokens, overruled regex hits and the share at or above each threshold per question.
  Agreement with later outcomes and blocks overridden as wrong are not tracked yet.
- **Advisory:** an operator record or a customer-surface evidence row always decides over the judge;
  the judge's answer is evidence for a gate, never the proof. A malformed answer (a probability outside
  0 to 1, an undeclared option, no confidence) is an error, never a "no".
- **What the numbers are worth:** the J1 probe had 10 relay cases and 5 for each other question, all
  written by someone who knew the labels; 10 of 10 has a 95% lower bound of about 72%. The
  role-neutral v1.1 wording was re-checked live on the same 10 relay cases; Product Manager messages
  are not measured. `divergence` is re-measured on real gate summaries (about 10, at least 3 minor)
  before it may ever block.
- **Live check:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/judge-smoke.js` (opt-in, not in the test suite)
  sends the 10 labelled relay cases in `judge/smoke-relay-cases.json` and fails below 9 of 10;
  `judge-smoke.js --set message` sends the 30 owner-message cases in `judge/smoke-message-cases.json`
  and prints, per question, the score and any wrong answer at or above 0.8. A question may block only at
  9 of 10 or better with no such wrong answer. Measured once (0.23.0, jev-1.13.0): `orders_owner` 10/10
  (yes 0.79 to 0.90, no 0.06 to 0.14), `tone_violation` 8/10 (two condescending messages called
  justifying), `jargon` 8/10 at 0.5 (negatives up to 0.62, so it warns at 0.8). On the same cases the
  word rules find an order in all 5 order cases and in none of the 5 others, and ids in all 5 jargon
  cases and none of the plain ones. The same caveat applies: 10 cases, labelled by someone who knew
  them, from one team's Chief of Staff.

### Bead discipline

A live claim cannot be taken, released or closed by someone else; bead structure (top-level
creates, re-parenting, dependencies, deletes, labels on beads you do not hold) changes only
through the Delivery Manager, and so do the `state-*` labels and the gate fields (`ready_hash`,
`deployed_sha`); and a turn that holds a claim but left no note in it gets a one-line reminder
on the next prompt (it is not blocked). `bd close` no longer checks a reason prefix: a story
closes on evidence rows (below). These are discipline aids for cooperative agents.

### Ready and done gates

Gates keep work flowing. Each check has one of three levels:

- **Block: authority.** Who may do what. Only the Delivery Manager acknowledges warnings, records a
  story as ready, sets states, waives and cuts; evidence rows come from the Delivery Manager (or a
  Reality Checker, phase 1b), never from an author of the story. The scripts take the role from the
  session's role marker and refuse every write without one (they fail closed). The bd guard refuses
  anyone but the Delivery Manager: the `story` and `state-*` labels, `--set-labels`, the gate fields
  (`ready_hash`, `deployed_sha`, `authors`, `story_file`, `surface`, `area`, `roadmap_ref` and the
  rest, judged on the parsed metadata keys; labels and metadata built by the shell, `$VAR` included,
  are refused; create-time `--labels` count), releasing or reassigning a claimed story (the Delivery
  Manager may do so even while the claim is live), and the commands that write around the guard:
  `bd batch`, `bd sql` other than a read, and `bd vc` and `bd federation` other than their status reads.
  A claim, or work the Delivery Manager assigns, stamps the assignee in `metadata.authors`; the
  Delivery Manager is never stamped.
- **Block on divergence.** Only a checkable fact that opens a serious divergence from what was
  agreed: **D1** the agreed criteria or requirements changed (or were deleted) since the story was
  made ready, checked at claim and at close, or a child bead names a criterion its story does not
  have; **D2** a story or an evidence row names a surface, or a tuple, that is not the one in
  `surface.json`; **D3** a close in any form (`bd close` and its alias `bd done`, `bd update --status closed`,
  `duplicate`, `supersede`, `bd gate resolve`) without a counting pass row per criterion, a waiver recorded after the deploy, or an
  evidence file edited by hand. The refusal is two lines: what and why, then the command for the
  Delivery Manager, or for anyone else "message the Delivery Manager".
- **Warn and record.** Everything else, including D5 for now: more than `budget.max_unverified`
  (default 2) merged-but-unverified stories in an area, open or closed, is a warning on claim; the
  refusal for starting the next wave arrives with waves (phase 2). `bug` and `security` beads are
  exempt.

**The warnings ledger.** `.delivery/warnings/<instance>.ndjson` in the project repo, one file per
instance (a session with no role writes `local-<host hash>.ndjson`), so sessions on different hosts
never write the same file. Append-only: `{type: "warning", id: "w-<instance>-<time><random>", kind,
rule, bead, detail, raised_by, at}`, and an acknowledgement is a second row
`{type: "ack", id, acked_by, acked_at, reason}`. An open warning with the same kind, bead and detail
is not repeated; the check and the append run under a lock file, so parallel hooks do not duplicate a
finding. `node ${CLAUDE_PLUGIN_ROOT}/scripts/warnings.js list [--open|--overdue] [--json]` shows them
with counts per kind; `warnings.js ack <w-id> --reason '...'` is the Delivery Manager's.
`/delivery:team` prints warnings open longer than 24 h first, then the counts and the story states.
A claim prints at most three warning lines; the ledger holds all of them.

**The customer surface.** `.delivery/initiatives/<slug>/surface.json`, written in
`/delivery:architecture` from `templates/surface.json`: `owner_record`, and `surfaces[]` each with
`id`, `host`, `app`, `mode`, `install_artifact`, `scriptable` (true or false) and `size_budgets`
(names to numbers). `node ${CLAUDE_PLUGIN_ROOT}/scripts/surface.js check <slug>` validates it.
Materialise stamps `surface` (the story's `surface:`, else the only one declared) and `area` (the
story's `area:`, else its epic) on each story bead, along with `story_file`, which marks the bead as
a story whatever its labels. A story with no declared surface (no `surface.json`, or several and none
named) is not locked out: its evidence counts without the surface check and the close records a
`no-surface` warning.

**The ready gate.** The story template has `Owner's ask` (quoted, with the `dec-` id when there is
one), `Customer surface`, `Acceptance criteria` as outcomes the customer sees on the surface, each
with one `Probe:` line (`what is observed; where: <surface>; by: test | reality-check`), a
`Measurement plan` table (signal, a numeric threshold, where) and `Shippable unit`. A criterion line
that still holds a template `<placeholder>` does not count. `node ${CLAUDE_PLUGIN_ROOT}/scripts/ready.js <bead>`
(or `--story <file> --initiative <slug>` before materialise) reports each missing piece, a criterion
with no outcome verb (sees, shows, reads, finds, completes: a word rule), and a `test` probe for a
surface that is not scriptable (it needs a reality check; the Reality Checker role comes later); it
writes nothing. `ready.js <bead> --record` stamps the hash of the criteria and the `requirements`,
records what is still wrong as warnings and resolves the ready warnings it no longer finds;
re-recording changed criteria needs `--owner-record <dec-...>` that `operator.js verify` accepts and
drops an earlier `state-verified`. The bd guard runs the same check on a claim and records the
claimer in `metadata.authors`. With the typed judge on, `shippable_unit` is asked too; a `partial` or
`no` is a warning, never a block.

**Evidence and the done gate.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/evidence.js add <bead> --criterion <n>
--result pass|fail --surface <id> --sha <deployed sha> [--run <ref>] [--host|--app|--mode <observed>]`
appends `ev-<bead>-<n>` rows to `.delivery/evidence/<bead>.ndjson` with the writer's role, actor,
time and the criterion's own hash. Files rather than bead notes: notes are free text any role can
append to, while a row here is structured, append-only and readable by the hook without bd. Each row
carries `seq` and a hash of the line before it, and evidence.js records the chain head (row count and
the last line's hash) in the bead's `evidence_head`, so an edited, inserted, deleted or appended line,
the last one included, refuses the close. Appends take a per-bead lock, so two writers never fork the
chain. A row
counts for a criterion when it is a pass, for that criterion's current wording, on the story's
surface and tuple, on the deployed sha (case-insensitive; a prefix of 7 or more characters matches),
recorded after that deploy, by a role and an actor that are not among the story's authors. Anything
else is a side arm or does not count. A waiver counts when recorded before the deploy and a cut counts at all only while its owner record
still verifies: the gate re-runs `operator.js verify` on it. `evidence.js check <bead>` reports the gate without changing anything.

**States.** `evidence.js state <bead> merged [--pr <n>]` and `evidence.js state <bead> deployed --sha
<sha>` set `state-merged` and `state-deployed` (and `deployed_sha`, `deployed_at`); `state-verified`
follows the rows, set when every criterion counts and removed when they no longer do (a new sha, a
re-recorded criterion). Status words in the briefs come from these labels and the `ev-` ids, never
from a session's say-so; closed is not verified, so team status counts closed stories by their labels.

**Migration and cut stories.** The hard done gate applies to stories the Delivery Manager made ready.
A story never made ready (one from before 0.22, or on the old checkbox template) closes with a
`close-not-ready` warning, so in-flight work is never locked out; another bead closed with no
`--reason` is a `close-no-reason` warning. A story that is cut or replaced closes on the owner's record:
`evidence.js cut <bead> --record <dec-...> --reason '...'` sets `state-cut`, then `bd close` or
`bd supersede`.

**What is cooperative trust.** The gates are discipline aids for cooperative agents, not a security
boundary. A role whose lane is `any` (builders, the Spike Researcher) can still run bd in a shape
the guard does not parse (`env bd`, `sh -c`, a subshell) and so also rewrite `evidence_head` to match
a forged row, edit a story file (which a ready hash then refuses as D1), or start a script from
another role's directory with that role's `DELIVERY_ROLE` set; `BEADS_ACTOR` is self-declared. What the gates do is make the
honest path the easy one, refuse the plain shortcuts the Vault took, and leave a record that an
independent review can check.

**The hook's budget.** The bd guard keeps to one 8 s budget inside the 15 s hook timeout: every bd
call checks the time left first and gets at most 4 s of it, bead reads are cached, and when the
budget runs out the command is allowed with a `budget-spent` warning (fail open).

**The judge at the gates.** Advisory only, at most once per command and only while 2.5 s of the
hook's budget remain. `shippable_unit` warns at the ready gate.
`divergence` is asked at a close that passed, with the criteria, the surface and the close reason; a
`serious` answer is a recorded warning and never blocks until it is re-measured on real gate
summaries. No new catalogue question was added: a criterion-kind question needs labelled cases first,
so mechanism wording is a word rule. The deployed sha is the one recorded with `evidence.js state`;
checking it against a health URL is not done yet.

### Owner authority and communication

The owner runs the enterprise; the Chief of Staff runs the team for the owner (R-42 to R-46).

- **Constraints only on the owner's yes.** `.delivery/goal.json` holds the fields that constrain the
  work: `budget.weekly_units`, `budget.usage_envelope`, `budget.lean_at`, `pause` (paused, stopped,
  off), the scope (changed by `scope_add` and `scope_remove`), `approvals`, `idle_minutes` (30) and
  `briefing_lines` (12). The scope is the list of product areas the team builds toward: an add puts
  items in, a remove takes them out, and a remove can never add.
- **The confirmed question (the main path).** In plain words for the owner: to set a budget or pause
  the team, the Chief of Staff asks you a yes/no question; your yes is the decision. Mechanically:
  - `node ${CLAUDE_PLUGIN_ROOT}/scripts/goal.js ask <field> <value>` words the question itself ("Pause
    the team's work now?", "Set the weekly budget to 5 units?", "Add billing to the scope?", "Resume
    the team's work now?") and records it with `operator.js ask` (options Yes and No);
  - the Chief of Staff asks exactly that text (AskUserQuestion, Yes/No) and records the owner's reply
    with `operator.js record --answers <q> --goal <field>=<value>`;
  - `goal.js set <field> <value> --record <dec-id>` accepts it only when the question text is
    goal.js's text for that field and value, the record carries the same field and value, the owner's
    whole reply is a yes ("yes", "y", "ok", "okay", "do it", "go", "go ahead", "confirmed", "agreed",
    "approve", "approved"; anything else, a no, "not now", a question back, is not), the reply came
    after the question (one question per reply), and the record is neither revoked nor superseded.
- **Free text (the second path).** An instruction the owner types in their own words ("Pause the team
  now") sets a field only when the typed judge is on and its `goal_instruction` answer is p ≥ 0.8, and
  the plugin's word rule passes as a pre-filter; a failed call counts as no. With the judge off, free
  text never sets a field: the plugin does not understand free-text instructions on its own. The word
  rule refuses, whatever else is said: a negation, a conditional ("only if", "if", "unless", "when",
  "in case"), another language, a figure that is not the object of its field word in the same clause,
  a pause that is not a verb on the work, a resume tied to a later time. It is a filter, not an
  understanding: it still lets through words that do not instruct ("halt the team chatter"), which is
  why it never decides alone.
- **Who sets what.** The Chief of Staff sets every field; the Product Manager sets scope changes only.
  Other roles, and sessions without a role, are refused. Every read checks the record again: a revoked
  record, or a value written by hand, falls back to unset (or the default) with a `goal-unverified`
  warning. `goal.js show` prints each field with its record, and whether work is paused.
- **The mechanical pause.** `goal.js pause --trigger andon:<ev-row-id>` (Delivery Manager or Chief of
  Staff) cites a failed check row that `evidence.js add` wrote (by the Delivery Manager or a Reality
  Checker); the Delivery Manager may pause on a fail row it recorded itself. At pause time the bead's
  recorded evidence head must match the file. When read with bd at hand (`/delivery:team`, the Stop
  hook's idle check, `goal.js show`), only rows up to the recorded head count, so a pass appended by
  hand does not lift it and an edited chain keeps it open. The pause lapses when one of those writers
  records a pass for the same criterion. It is kept apart from the owner's pause, so a closing andon
  never lifts an owner pause. Red CI is a hook point that is not readable yet.
- **Not gated yet: new team rules.** R-42 also asks that new process rules need an owner record; there
  is no rules field or change log yet (deferred). Team rules change through the plugin's own release.
- **The lane.** Every role is refused a direct write, `sed -i` or `perl -i` (also from inside
  `.delivery`), move or `git checkout -- .delivery/goal.json`; committing it is fine. This is a
  discipline aid, not a boundary: a role whose lane is `any` (builders, the Spike Researcher) can still
  write the file through `python3 -c`, `node -e`, `cd .delivery && echo > goal.json`,
  `git checkout <rev> -- .`, `git reset --hard` and similar, and can write evidence rows by hand. A
  session can also pose as another role by running a script from that role's directory with its
  `DELIVERY_ROLE` set. A hand-written value is inert because every read re-checks its record. A
  hand-written evidence row is refused at pause time (no matching recorded head), but a session that
  can also rewrite the bead's metadata can forge one. Both are cooperative trust, detectable in git
  history.
- **No default budget.** A budget field is unset until the owner sets it, and every budget check only
  warns until then. A usage figure written into `team.json` (`budget.weekly_units`,
  `usage_envelope`, `lean_at`) is ignored with a warning. `budget.builders_cap`, `staleness_hours` and
  `max_unverified` are team settings, not budget figures.
- **Idle is a defect.** With ready beads, nothing in progress, the last bead activity older than
  `idle_minutes` and no pause that still holds (its record verifies or its andon is open),
  `team-status.js` (and so `/delivery:team`) shows "Idle: ..." first and records one `idle` warning
  per idle stretch; the Delivery Manager's and Chief of Staff's Stop does the same check at most every
  10 minutes and says it on the next prompt. The alarm runs only when someone runs `/delivery:team`
  or a Chief of Staff or Delivery Manager session stops: a team with no session running is not
  flagged until the watchdog (a later phase). A stale `in_progress` bead (an abandoned claim) also
  keeps it quiet. Telling sessions to idle is not a pause. A ready bead
  counts as waiting for the owner only while an open owner-queue step names it.
- **The owner queue.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/owner-queue.js add --kind
  signin|consent|payment|secret|account|decision --what '<one action>' --where '<place>' --steps
  '<exact steps>' [--expect '<what they see>'] [--check '<read-back>'] [--bead <id>]` (decisions also
  `--about scope|money|irreversible --question q-...`). A check of whether something works, or a relay
  into another session in any wording, is refused whatever the kind; retrying a sign-in or testing a
  connection inside an owner-only step is fine. An open step exempts a message's order only for the
  same action (the same first verb and shared words), not for a shared place name. `owner-queue.js list` is the daily batch;
  `owner-queue.js done <id>` closes a step and prints its read-back. Only the Chief of Staff writes it;
  rows are append-only under `.delivery/owner-queue/`.
- **The owner-message checks** (the Chief of Staff's and Product Manager's Stop, `message-checks.js`):

  | Check | Rule | Level |
  |---|---|---|
  | an imperative addressed to the owner (an address mark or second person, a bare imperative opening its sentence, or after a lead naming the owner) that no open queue step holds; plan lines, the list under a plan label, options and decision questions are not orders, unless the line sends someone into a session, to type or paste, or names the owner | `orders_owner` p ≥ 0.5, or the word rule with the judge off | warn; p ≥ 0.8 with such an imperative blocks once per turn (not again when a relay block already says it) |
  | a routine briefing over `briefing_lines`; a message is a decision only when it ends with a question to the owner | line count | warn |
  | the ids and names the plugin produces: `dec-`/`ev-`/`q-`/`ans-`/`in-`/`del-` ids, the project's bead ids, the plugin's script names, lane groups, `.delivery` and `.beads` paths | patterns; links, and replies to an owner who explicitly asked for ids, beads or links, are skipped | warn |
  | `jargon` when the patterns find nothing (and the owner did not ask for ids); `tone_violation` justifying, condescending or therapeutic | the judge | warn |
  | live, shipped or verified (not in a question) with no `evidence.js check` or `list` in this turn's tool calls, of the bead when one is named | word rule over the transcript (read back up to 64 MB for a long turn) | warn, unless it says "not checked yet" |

  Each warning is a ledger row (rules R-44, R-45, R-03) and one two-line reminder on the next prompt.
  The judge questions are asked in parallel with `relay_request`, 2 s each, and not at all on a
  continuation that can no longer block. Their message is redacted first: paths, commands, links and
  tokens become placeholders (`[path]`, `[url]`), so a concrete order still reaches the judge. The Stop
  hook keeps a 12 s deadline inside the harness's 15 s: bd reads take what is left, and the idle check
  is skipped when less than 4 s remain.
- **Short reasons.** Every block and warning reason from the hooks and these scripts is at most two
  lines and its last line names the exact command or the role to message; `hooks/scripts/reasons.test.js`
  checks it over the guards' refusals.
- **Limits.** The word rules are heuristics: an order phrased as a statement, or ids in an image, pass.
  The queue, like the warnings ledger, is tamper-evident by git history only (see the lane, above).

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
- Lanes deny writes to the operator store (`.git/delivery-operator/`, in the project and in a role's clone, case-folded and through symlinks), to the legacy `.delivery/operator/`, and git commands that would write the store or push its branch; only the manager lanes include the writer commands. Workers with unrestricted Bash can record or acknowledge only inputs their own session captured; the check is cooperative (it compares a session id the session's own Bash can rewrite).
- `prepare-role` pre-allows each manager lane's own commands in `settings.local.json`, so a session does not stop on a prompt only the operator can clear. When a role session's lane cannot be checked (manifest unreadable, internal error) it fails closed and allows only restoring the manifest; a session whose role marker is missing gets no lane check at all.

**Artifacts**, in the `operator/` directory of the private operator store:
`inputs/<host>/<YYYY-MM>.ndjson` (one hash-chained entry per operator prompt, from the session
transcript), `records/<instance>.ndjson` (decisions, delegations, answers, acks, questions,
ratifications; written only by `operator.js`), and `LEDGER.md` (the question ledger). `cursors/`
(recorded heads, transcript cursors, per-session role boundaries) and `quarantine/` are local and
never published.

**Where they live and how they travel.**
- The store is a private git repository at `<git-common-dir>/delivery-operator/`: `.git/delivery-operator/`
  in a normal clone, the main repository's `.git` for a linked worktree. Every role uses the store of
  its marker's `project_root`, so the roles of one checkout share it and other clones have their own.
- It is inside `.git`, so it is outside your index and working tree: `git status`, `git clean -fdx`,
  `git stash -u`, `git reset --hard`, `git checkout .`, `git pull` (with `pull.rebase` or not) and
  your own commits never touch it, whatever state the checkout is in (detached, no upstream, mid-merge
  or mid-rebase, shallow). In your checkout the plugin only reads `git rev-parse --git-common-dir`
  and `git config --get remote.origin.url`. You never pull for operator records.
- Its `origin` is your project's `origin`; the records travel on that remote's `delivery-operator`
  branch, which carries operator files only. Repository branch rules must allow pushes to
  `delivery-operator`. A session publishes only with push access to the project remote (cloud and
  SSH sessions included); otherwise its records stay committed in its store and show as unpublished.
- `operator.js publish` (after every write) commits the store's new lines, fetches the branch,
  merges it, and pushes, retrying a rejected push up to five times. What is checked:
  - **Before a commit**, every chain file whose complete lines changed must start with its committed
    copy, and the changed chains must verify (hash chain, id sequence, text hashes).
  - **On every merge** (publish and refresh), every chain on either side must reach the result whole
    (no deletion, shortening or rewrite), and two copies that grew differently are a fork.
  - **The owner rule:** a chain this store writes may be behind on the remote, never ahead or
    different. Owned are this host's `inputs/<host>/` chains, a records chain whose last line here was
    written from this host, and any records chain to which the remote adds lines claiming to come from
    this host. A remote extension of an owned chain is a fork, refused (`refresh` exits 1; `problems`
    and `pending` list it, naming the rehost record when one is involved), with two exceptions:
    - a valid rehost moved the instance to another host, and that destination is where the
      **committed** `.delivery/team/team.json` (the project's HEAD; an uncommitted edit does not count)
      places the instance, or the rehost is already in this store's copy. So a second writer that
      records a rehost is not merged silently: move an instance by committing the manifest change, then
      running `operator.js rehost` from the new host;
    - the store is new and does not hold or write that chain yet: a fresh clone adopts its host's
      published chains (a new store with no HEAD fetches once before its first capture for that reason).
  - **Before every push**, whatever reached the store (operator.js, a merge, or a commit made by hand
    in the store), every chain that differs from the fetched remote copy must still start with it, and
    must verify as committed.
  A refusal pushes nothing and names the command that fixes it. `operator.js refresh` is the fetch and
  merge alone. A chain has one writer by design (per host, per instance); the owner rule is what makes
  a second writer show up as a fork instead of being merged.
- Network calls are bounded: each fetch or push at most 15 s (`DELIVERY_GIT_TIMEOUT_MS`), and one
  publish's network work at most 30 s (`DELIVERY_PUBLISH_BUDGET_MS`). That budget does not include
  waiting for the store lock (up to 60 s while another command on this host holds it) or the
  command's own refresh before it. When a fetch or push times out or cannot reach the remote, the
  store remembers it for 60 s, across processes: a write against an unreachable remote takes 10-15 s
  the first time and returns at once (saying it is unpublished) for the next minute; reads that
  refresh do the same. A refusal (permission, branch rule) is not remembered that way.
- With no remote the store is local only (`publish` says "no remote"). A project directory outside git
  keeps the records in `<project>/.delivery/operator/`; records an earlier version left there are
  copied into the store once.
- **Cooperative trust, specifically.** Anyone with push access to the project remote, or a session
  with unrestricted Bash on a host, can do things these checks only make visible, or not even that:
  - pre-seed the chains of a host that has no store yet; the new store adopts them as its own;
  - write records citing human inputs they typed themselves: they verify and are indistinguishable;
  - push one line into a foreign chain that claims a host: that host's owner rule then refuses every
    merge, so it cannot publish until the chain is set aside with `operator.js quarantine
    --adopt-remote` (after review) or the remote branch is repaired by hand;
  - commit a correctly hashed line in a host's own store, which that host then publishes.
  And a re-clone whose first fetch fails (offline) starts this host's inputs chain over, which is a
  fork against the published one: recover with `operator.js quarantine --file inputs/<host>/<YYYY-MM>.ndjson`
  on that host (the published chain is taken); the inputs captured meanwhile are in the quarantined
  copy and come back on the next capture, because capture re-reads the session transcript (or run
  `operator.js sync`).
- **Deleting or re-cloning the project checkout deletes its store**, and with it every entry not yet
  published (and, without a remote, everything). Before deleting a clone, run `operator.js publish`
  and check that `/delivery:team` (team-status) shows `Operator entries unpublished: 0`. team-status
  warns when entries have been unpublished for more than 24 hours, and `operator.js problems` lists
  unpublished entries as a warning. Published entries come back: a new clone's store takes them from
  the remote. Inspect a store with `git -C .git/delivery-operator log --stat`.

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
