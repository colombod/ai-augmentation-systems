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
| Reality Checker (optional, `full`) | `reality-checker` | sonnet | runs reality-check scripts on the real customer surface with browser control or computer use; writes evidence rows and captures only. On by default when a declared surface is not scriptable |

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
| `pr-reviewer` (no edits) | the Delivery Manager, for every pull request before the merge gate | does this head meet its story's criteria, with the suite's output quoted |

The `pr-reviewer` is the one lens with a lane of its own, when the Delivery Manager dispatches it (any other role's dispatch keeps that role's lane). A Delivery Manager's lane runs no product code, so a reviewer that inherited it could not run the tests it must quote; with one builder on the team, this subagent is the independent reviewer. Its lane: read everything; check out and test a head only through `review-run.js` (`checkout <pr> <full head sha>`, `test <pr>`), which keeps the clone at `review/pr-<pr>` of the role directory; edit files only in that clone (to break a covered line and see its test fail), never in its `.git/` nor a role marker or team manifest, in any letter case. Everything else is refused, the reviewer's own git writes and `mkdir` included: git run by the reviewer was once pointed outside `review/` through a fake bare repository, so `review-run.js` runs git itself, with the repository and work tree named and discovery, hooks and fsmonitor off.

`review-run.js test` runs the product's own test command, in whatever language the product is written: `test_command` in `team.json` when the owner sets it (one line of shell, the command CI runs from the repository root, for example `dotnet test`, `./gradlew check`, `cargo test`, `make ci`), otherwise the one the repository's build files name, with its install step where the toolchain needs one (`npm ci && npm test`, `bundle install && ...`): a Makefile `test` target first, else .NET, Rust, Go, Maven, Gradle, sbt, Python, Ruby, Elixir, PHP, Swift, Dart and Flutter, Haskell, Zig, CMake, Node.js and Deno, A repository with several of these and no `make test` is refused with the candidates named, never guessed; `start.js` says at setup which command it found. It runs only in `review/pr-<pr>`, with the role's `DELIVERY_*`, beads and repository-pointing git variables cleared, and takes no extra arguments (a runner's own options can point it outside the clone); `test_timeout_minutes` (default 60) bounds it. The lane never lists runners itself: a list locks languages out, and a wildcard was got past with `timeout ... git push`.

What the lane cannot stop: the tests are the pull request's own code (and the reviewer may edit files in its clone), and they run with the role's access. The lane keeps an honest reviewer from writing, pushing or recording by mistake; it is not a sandbox against a hostile pull request. Run the team where a role's credentials can do no more than its work needs.

## The shipping team's mechanisms

The pipeline's roles run as long-lived sessions, one per role, on the hosts that can do the work,
coordinating through cross-session messages (`SendMessage`) and beads. These pieces give a
session its role and keep it:

- **Role briefs**: `roles/*.md`. Project-specific briefs go in the project repo under `.delivery/team/briefs/`.
- **Experts**: the product's own specialists (infrastructure, security, scalability) as subagent definitions in the project repo under `.delivery/team/experts/<name>.md`, written by Staffing. `prepare-role` copies each into the role session's `.claude/agents/`, keeps a list of what it installed in `.claude/.delivery-managed-agents.json`, removes an expert the project no longer defines, never overwrites an agent the user wrote, and reports a malformed expert (no `name`, a `name` that is not the file name, no `description`) or more than five.
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

Browser, desktop and computer-use tools reach the owner's apps and the customer surface. The reach
servers are `Claude_Browser`, `claude-in-chrome`, `computer-use`, `Claude_Code_iOS_Simulator`,
`playwright`, `chrome-devtools` and `puppeteer` (and, for the hook, their `plugin_<name>_` copies).
Only a reach lane has them:

- **The Reality Checker** (its role file says `lane_reach: true`) has all of them, except
  `request_credentials`, the clipboard tools and `request_full_control` / teach access: a sign-in,
  consent or payment step is an owner-queue step, never typed by an agent.
- **A builder (or another non-manager) opted in** with `"reach": true` on its `team.json` entry gets
  *local* reach (R-05): browser tools whose `url` is a local development host (`localhost`,
  `127.0.0.1`, `::1`, `*.localhost`, `*.test`) and actions in those browsers, for its own UI work;
  never the owner's own Chrome (`claude-in-chrome`) or desktop (`computer-use`). Re-run `prepare-role`
  after changing it.
- **Every other role** is refused by the hook ("real-surface runs belong to the Reality Checker, with
  a script"). The manifest refuses `reach` for a manager by id or by brief (the Chief of Staff, the
  Product Manager, the Delivery Manager, Staffing, or a custom id using one of their briefs), and the
  hook ignores `reach` on a manager even when `team.json` was edited after `prepare-role`.

`prepare-role` writes native deny rules for the seven server names above, so they hold where the hook
cannot (a hook that fails open, a broken manifest). A browser or desktop MCP server with another
name has no native rule: for a manager lane the hook's read-verb filter refuses its actions but lets
read-shaped tools (`list_pages`, `get_page_text`) through, and for an `any` lane (builders, the Spike
Researcher) only the hook stands, and shell routes (`osascript`, `open`, a test runner driving a
browser) are cooperative trust, like the rest of an `any` lane.

Merging is the Delivery Manager's: for every other role, `any` lanes included, the hook refuses
`gh pr merge`, the merge endpoints through `gh api`, a push to the default branch (`main`,
`master`, or what `origin/HEAD` names; a bare `git push` while on it), `git merge` while on it,
and MCP merge tools; `prepare-role` adds a native `Bash(gh pr merge:*)` deny rule for those roles.
A builder pushes its own branch and merges the default branch into it to resolve a conflict. The
Delivery Manager requests an independent review (a reviewer subagent or another session, never the
author) and merges only on a passing review of the pull request's current head; a conflict or new
commits send the pull request back to its owner and to review again. Its own `gh pr merge` sits in
the `gh-merge` group and passes only through the merge gate (below).

Where `gh pr create` (GraphQL) is refused, a role opens its pull request through REST:
`gh api -X POST repos/<owner>/<repo>/pulls -f title='<the change>' -f head=team/<instance> -f base=main -f body='Refs <bead id> ...'`.
The `gh-write` group and the leak guard accept exactly that shape (inline `title`, `head`, `base`, optionally
`body`, `draft`), and scan the title and body like `gh pr create`; every other `gh api` write, a body read from
a file, and any other endpoint stay refused.

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
| `goal_instruction` v1 | probability | `goal.js set`, free-text path only, off (`goal.free_text`) | not measured; the confirmed question is the only path until it is |

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
  story as ready, sets states, waives and cuts; evidence rows come from the Delivery Manager or the
  Reality Checker (only through `reality-check.js run-record`), never from an author of the story. A
  criterion a reality check verifies (its probe says `by: reality-check`, or its surface is not
  scriptable) counts only from the Reality Checker's row, or from a Delivery Manager row that cites a
  verified owner record (`evidence.js add ... --record dec-...`); any other row is a side arm. The scripts take the role from the
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
surface that is not scriptable (it needs a reality check, below); it
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
recorded after that deploy, by a role and an actor that are not among the story's authors, and, for a
criterion a reality check verifies, from that check (or on the owner's record). Of the rows that would
count, the latest decides: a fail after a pass un-verifies the story. Anything
else is a side arm or does not count. A waiver counts when recorded before the deploy and a cut counts at all only while its owner record
still verifies: the gate re-runs `operator.js verify` on it. `evidence.js check <bead>` reports the gate without changing anything.

**States.** `evidence.js state <bead> merged [--pr <n>]` and `evidence.js state <bead> deployed --sha
<sha> [--version <v>]` set `state-merged` and `state-deployed` (and `deployed_sha`, `deployed_at`, and
`deployed_version`, the version string the surface shows for that build); `state-verified`
follows the rows, set when every criterion counts and removed when they no longer do (a new sha, a
re-recorded criterion). Status words in the briefs come from these labels and the `ev-` ids, never
from a session's say-so; closed is not verified, so team status counts closed stories by their labels.

**Reality checks (R-33).** A customer surface no test reaches is checked by an agent with browser
control or computer use, by script, never by the owner. `node ${CLAUDE_PLUGIN_ROOT}/scripts/reality-check.js plan <bead> [--attempts <n>] [--minutes <n>]`
(the Delivery Manager) writes `.delivery/reality-checks/<bead>.json` in the format of
`templates/reality-check.json`: the surface tuple (host, app, mode, install artifact), the test
account by name (from `surface.json` `test_account`; never a secret; a sign-in is an owner-queue
step), the artifact under test (the deployed sha and the version string to read on screen, from
`version_on_screen`), setup steps that confirm the app, mode and version, one step group per criterion
whose probe says `by: reality-check` (every criterion on a surface that is not scriptable), each step
with an action, the expected observation and what to capture (screenshot, page text, log), a pass
rule per criterion, and a cap (attempts, default 2, and minutes, default 30). Scripts live in the
shared project checkout (the project root every role's marker names), which `run-record` reads; no
lane writes them directly. The Delivery Manager edits one with `reality-check.js refine <bead>
[--criterion <n> (--step <k> | --add-step) | --setup <k>] [--action ..] [--expect ..] [--capture a,b]
[--pass-rule ..] [--account <name>] [--read-on-screen ..] [--precondition <o-id>]` (an account that
looks like a secret is refused). A refined group is kept on re-plan while its criterion's wording is
unchanged. Once the story is deployed, plan also creates
one child bead per deployed sha (`<bead>-rc-<sha7>`, label `reality-check`, not a story) for the
Reality Checker, which claims it from `bd ready --label reality-check`. The checker saves captures
under `.delivery/evidence/artifacts/<bead>/` in its own project clone (where its lane writes) or in the
shared checkout; `run-record` checks the real path stays inside one of those (no `..`, no symlink
out), copies the capture into the shared checkout's directory and records that path, so every reader
finds it. It records each criterion with
`reality-check.js run-record <bead> --criterion <n> --result pass|fail --artifact <path>
--observed-version <v> [--host|--app|--mode|--install-artifact <observed>]`. It refuses a version on
screen that is neither the deployed sha nor the deployed version, a capture that is missing or
outside those directories, a capture whose bytes already back a row for another bead, criterion or
sha, a criterion not in the script or reworded since it was planned, a script planned for another
deploy, and a run past the cap (runs on the wrong surface do not count against it); a second run
after a fail on the same sha is a `reality-retry` warning. The observed tuple is the script's (what
was set up) unless the checker says otherwise, so a surface declaration changed after planning makes
the run a side arm. `deployed_version` and `evidence_head` are gate fields only the Delivery Manager's
scripts write. The row goes
through `evidence.js` with `via: reality-check`, the observed version and the capture's path and hash,
so the tuple and sha rules above apply: a run on Codex mode for a plain-chat surface is a side arm. A
counting fail raises the andon (the mechanical pause below) with no owner step. `/delivery:team`
lists the open reality checks. The run's minutes cap is the checker's brief, not yet measured by the
script.

**Command-line surfaces.** A surface declared with `"command_line": true` (a CLI, a library, a service
driven by commands) has no screen, so the Reality Checker checks it with
`verify-run.js run <bead> --criterion <n>` (the `verify-run` lane group, the Reality Checker's only).
The Delivery Manager puts the command in the script step with `reality-check.js refine <bead>
--criterion <n> --step <k> --command '<shell command>' [--match '<pattern stdout must show>']`. The runner
checks out the bead's deployed sha (the full sha) in `verify/<bead>-<sha12>` of the role directory,
runs the command there with the role's variables cleared, saves the command, sha, stdout, stderr and
exit code as the capture, decides the result itself (exit 0, and the match found in stdout when the step
has one), and records the row through `run-record`, so the run cap, the capture rules and the andon on
a fail all apply. The agent types no result, and the builder's lane has no way to write the row.
The run cap is checked before the checkout, so an over-cap run executes nothing and writes no capture;
a criterion with more than one step carrying a command is refused, never partly run. The runner runs
the source clone at the deployed sha, not the installed artifact, so the version it observes is the
clone's sha. The capture is cut at 256 KiB per stream (and says so) and is not redacted: a command that
prints a secret writes it into the capture.
`start.js` adds the Reality Checker to a new team whose surfaces include a command-line one, and
`/delivery:team` warns when a declared surface only the Reality Checker can verify has no Reality
Checker on the team.

**Migration and cut stories.** The hard done gate applies to stories the Delivery Manager made ready.
A story never made ready (one from before 0.22, or on the old checkbox template) closes with a
`close-not-ready` warning, so in-flight work is never locked out; another bead closed with no
`--reason` is a `close-no-reason` warning. A story that is cut or replaced closes on the owner's record:
`evidence.js cut <bead> --record <dec-...> --reason '...'` sets `state-cut`, then `bd close` or
`bd supersede`.

**What is cooperative trust.** The gates are discipline aids for cooperative agents, not a security
boundary. The bd guard unwraps the usual wrappers (`env`, `VAR=`, `command`, an absolute path, `nice`,
`timeout`, `exec`, `sh -c` and `bash -c --`, `eval`, subshells, command substitutions) and, in a command
that names bd, refuses to every role but the Delivery Manager and Product Manager what it cannot read: a
command word built by the shell (`$(which bd)`, `${BD:-bd}`, `"b"d`, `b\d`, a variable), a shell
reading its script from stdin or a file (`| sh`, `sh -s`, `bash <<EOF`), and a runner that executes an
argument naming bd (`xargs`, `find -exec`, `parallel`, `watch`). A role whose lane is `any` (builders,
the Spike Researcher) can always run what no guard sees: a symlink or copy of bd under another name, or
any program (python, node) that spawns bd. Through those it can write any label or field, and rewrite
`evidence_head` to match a forged row. The durable control is not the label: a tier-1 fix and a
verified story also need the evidence and owner-record checks, and the done gate re-verifies a close
from the evidence chain against its recorded head and from the owner's records, so a state label alone
never closes a story. Beyond that, a builder could also edit a story file (which a ready hash then refuses as D1), or start a script from
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

### Waves, budget and selection

Owner rulings: never start what cannot be completed within the budget; half-built products are the
worst outcome; build in compounding waves, each shipped and verified before the next builds on it;
prefer work that builds on what is already verified; fixes and security first when the budget is
tight; block only on serious divergence, otherwise warn (R-34, R-36, R-41, R-23, R-31).

- **Waves.** A wave is a set of stories in one product area that together deliver a verified
  increment. Each story names `area:` and `wave:` in its frontmatter (the roadmap's Waves table) and
  materialise stamps a protected `wave-<n>` label and `metadata.wave`. A label, not a wave epic: a
  story's one parent is its phase epic, which carries the phase-review chain. The current wave of an
  area is its lowest wave with a story neither verified nor cut (a cut is the owner's, through
  `evidence.js cut`). `node ${CLAUDE_PLUGIN_ROOT}/scripts/wave.js show [<area>]` says it in plain
  words ("wave 2 of import: 3 of 5 stories checked on the customer's app"); `wave.js plan` lists each
  area's waves with what they still need and file overlaps inside a wave, and `wave.js close <area>
  <n>` records a finished wave; both append to `.delivery/waves.ndjson` and are the Delivery
  Manager's.
- **The budget.** Only the owner's figures, set through the question box (`budget.weekly_units`,
  `budget.usage_envelope`, `budget.lean_at`, and overrides of the estimate table). With none set,
  every budget check only warns. Estimates come from the size label and the model the builder
  dispatches (size-L on its large model, opus by default, so a large story costs about 1.7 times more,
  which the owner weighs when setting the weekly figure): S 1, M 3, L 8 units
  on sonnet, opus 1.7x, haiku 0.35x, plus a 30% reserve for review, reality check and merge (owner
  overrides: `budget.estimate_s|m|l`, `budget.reserve`, `budget.unit_tokens`). Spend is what a script
  can read: cost-weighted tokens from every role transcript since the period start (one unit is 5M
  weighted tokens until a realign recalibrates it; a streamed reply at its largest reading; files read
  in chunks from where the last scan stopped, within the hook's deadline, the figure marked partial
  when it ran out), counted from the status line's weekly reset, else from the owner's week start
  (`budget.period_start`), else over the last 7 days, and capped by the status line's weekly reading when
  `usage.js statusline` is wired as a role session's statusLine command (subscribers only). The CLI
  has no usage command and hooks see no usage figures. In-flight work, stories and fix beads alike,
  keeps its estimate plus reserve (only the reserve once merged). `lean_at` is a share of the weekly
  allowance. Only the plugin's reader writes `.delivery/usage/`; the lanes refuse it to every role. `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.js budget` shows remaining
  against what each current wave still needs; `usage.js show` the raw readings.
- **The claim check.** At `bd update --claim` on a story or a fix, the bd guard warns on: a story
  outside its area's current wave (D5), overlapping files with a story in progress, WIP above the
  builders or, in lean mode, any second story (R-23, R-31), a new area (nothing built there while other
  areas hold work) with no recorded reason (R-41), and a story that does not fit inside a wave under
  way. It refuses only half-built risk, and only under an owner-set budget: a story that would start
  its wave when the whole wave's estimate plus reserve exceeds what is free after in-flight work (D5); a later-wave
  story when what is left cannot finish the current wave as well (D5); a new area near the limit (D5);
  a new area with no recorded reason at half the budget or less (D1). A recorded reason is the owner's
  Yes to `goal.js ask area_add <area>`, or a row of a roadmap's `## Areas` table citing an owner record
  that verifies. Near the limit means that once in-flight work is paid for not even a size-S story
  fits.
- **Fixes and security fixes.** A `bug` bead counts as a fix only with `fixes:` in its bead metadata
  (a story file's line is a note and never counts) naming a merged, deployed or verified story, a counting failed check row (the Delivery
  Manager's or a Reality Checker's), or the owner's own report of the defect (a record resting only on
  the owner's words, not a goal decision, scoped to the bead or naming it); a `security` bead with
  `finding:` naming a review finding by id (`.delivery/reviews/<file>#<id>`) or a finding bead
  (labelled `security` and `finding`); review files are written only by the Delivery Manager, Product
  Manager and Reality Checker. Never the bead itself. The owner's report must name the defect in the
  owner's own words, not in the recording agent's statement. The labels and links are the Delivery
  Manager's and Product Manager's to set. Linked fixes skip the wave, lean and new-area rules and must
  fit what is left with their reserve; a label alone is ordinary work with a `fix-unlinked` warning.
  A peer agent's message is captured as an input but is never the owner's record, for fixes, cuts,
  waivers or area reasons alike.
- **Selection.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/plan.js select [--record]` ranks ready work: tier 1
  linked fixes, tier 2 compounding work by score (verified dependencies 3 each, an area or surface
  with verified work, the current wave and whether it is under way, existing files changed, `reuses:`
  entries), tier 3 new areas. What may not start now is listed apart with the claim check's own
  reason, so select offers exactly what a claim allows. With the typed
  judge on, `builds_on_verified` and `is_fix` are asked as advisory input. `--record` writes tier,
  score and reasons on the chosen bead (`metadata.selection`) and the warnings in the ledger.

### Assumptions and spikes

Owner rulings: build on evidence, not on a reading of the documentation; block only on serious
divergence, otherwise warn (R-14, R-15, R-16, R-18; D4).

- **The register.** `.delivery/initiatives/<initiative>/assumptions.md` (template
  `templates/assumptions.md`), one table row per assumption: `Id` (A-n), `Statement`, `Kind`
  (`external-host`, `platform`, `data`, `customer`, `internal`), `Criteria` (`<story>#<n>`, space
  separated; a bare story id is every criterion), `Status` (`assumed`, `observed`, `refuted`),
  `Evidence` (an `ev-` row) and `Decision owner` (`DM`, `PM`, or `owner` when the answer decides
  scope). The Criteria column is the only link between a story and its assumptions. In a role session
  only `assumptions.js` writes the file: every lane, the Product Manager's and the `any` lanes
  included, refuses a Write, Edit, redirect, `sed -i`, `cp` or `mv` onto it (best effort, like the goal
  sheet). Every write takes a lock on the register for its read, check, id allocation and write, so
  two sessions never lose each other's rows; a held lock refuses and asks for a retry. `node ${CLAUDE_PLUGIN_ROOT}/scripts/assumptions.js list [--plain] [--json]` reads it;
  `--plain` covers every initiative and is the Chief of Staff's wording ("blocked until we check
  whether ...", "waiting for your decision: ..."), and says "No assumptions recorded." when there is
  no register. `add` is the Product or Delivery Manager's and starts a row `assumed`.
- **The gates re-verify every status.** At ready and at claim an `observed` or `refuted` row counts only
  when its evidence row exists on an intact chain, on a bead of the same initiative, is an observation
  of that assumption (below), and no reopen of the assumption came after it. Otherwise it is treated as
  assumed, with an `assumption-unverified` warning, so a hand edit of the register gains nothing.
- **Spike beads.** Materialise makes one spike bead per `external-host` assumption, whatever its status,
  `<prefix>-<initiative>-spike-a-<n>`, blocking the stories its criteria sit on: the evidence and the
  acknowledgement live on that spike's chain. A Spikes table row naming the assumption in its
  `Assumption` column gives it its question, decision, decision rule, decision owner and time box (the
  table is read by header; an older four-column table still parses). A spike with no decision rule is a
  materialise warning; one claimed without its question, decision and decision rule is a claim warning.
  Only the Delivery Manager removes the `spike` label, and the close gate keys on the protected
  `assumption` field as well. No one, the Delivery Manager included, deletes a spike while an open story
  rests on its assumption.
- **What observes an assumption.** `assumptions.js probe <spike> --host <where> --observed '<what was
  seen>' --artifact <capture>` appends a probe row to the spike's evidence chain. An `external-host`
  assumption is observed only by the Reality Checker's probe in the real host (`probe` lane group), never
  through a twin. Other kinds may also be probed locally by a builder holding the spike or the Spike
  Researcher. `assumptions.js observe|refute <A-n> --evidence <ev-id>` (Product or Delivery Manager,
  Spike Researcher, or the builder holding the spike) refuses any other row, and a refused settle is a
  warning. A refuted assumption is not observed again by a later probe: it returns through a new design
  or the Product Manager's `assumptions.js reopen <A-n>`, which writes a reopen row on the spike's
  chain; only a Reality Checker probe in the real host, newer than that, observes it, whatever its kind
  (refuting it again is not restricted).
- **The design change, by command.** The Product Manager adds the new design's assumption (`add`), or
  moves an existing one with `assumptions.js relink <A-n> --criteria '<story>#<n> ...'` (not on a
  refuted row; recorded as an `assumption-relinked` warning), and retires the refuted row with
  `assumptions.js retire <A-n> --reason '<the design change>'`: its Criteria cell becomes `retired:
  <links>`, kept as history, and a retire row goes on the spike's chain. The gates honour retired links
  only on a refuted row with that retire row after the refutation; anywhere else they stay live. A
  retired row is not reopened. Then the Delivery Manager re-records ready and the story and its area
  start again. `reopen`, `retire` and `relink` are the Product Manager's (the `assumptions` lane group;
  the script checks the role).
- **Twins (R-18).** A test double or twin counts as a probe only for an `internal` or `platform`
  assumption, with `--twin <recording>`: a JSON object with `source`, `recorded_at`, `recorded_by` and
  `exchanges` (non-empty request and response pairs), or a HAR file. The probe row keeps the recording's
  sha256, recorder and capture time. Who made the recording is what the file says: this rests on
  cooperative trust, like the rest of the record. Any other twin row (no recording, an incomplete one,
  or a `data` or `customer` kind) is kept with `counts: false`, recorded as a `twin-unrecorded`
  warning, and is never a result.
- **D4 at ready and claim.** A story whose criteria sit on an `external-host` assumption that is
  (effectively) `assumed` is not ready (`ready.js`, by bead or with `--story <file> --initiative
  <slug>`, reports a block and `--record` stamps nothing) and its claim is refused in two lines naming
  the spike to run. A child bead of that story is refused too, for its `criterion`, or for all of them
  when it names none, and by its story's area pause unless the child or the story is a fix. Once observed, the claim waits for the decision owner's acknowledgement of that
  result. Every other kind, assumed, refuted or with an unacknowledged spike, is a warning.
- **The acknowledgement.** `assumptions.js ack <spike> --result <ev-id> --decision '<the decision taken>'
  [--record dec-...]` names the counting result it approves and is newer than it; it counts only for
  that result, so a newer result needs a new one. Only the declared decision owner acknowledges: the
  Delivery Manager for `DM`, the Product Manager for `PM`; for `owner`, either of them citing the
  owner's record scoped to that spike or assumption (its scope names the spike bead, or carries the
  label `assumption:<A-n>` or `spike:<id>`), re-verified at every claim. A spike that answers an
  external-host assumption closes only with a result and that acknowledgement (D4); other spikes with
  decision fields close with a `spike-unacked` warning.
- **Refutation and the andon.** A refuted `external-host` assumption stops every story resting on it
  (D4) and pauses their area: other non-fix stories there are refused while a story rests on it, each
  story read against its own initiative's register, and `bug` and `security` work goes on. `ready.js
  --record` stamps the assumptions it was recorded on (`ready_assumptions`, protected), so a story made
  ready on one that is later refuted is held until the design changes and ready is re-recorded, which
  also resolves the `assumption-refuted` warnings `refute` wrote for the Delivery Manager. A refuted
  assumption of another kind is a warning, with no area pause.
- **Not yet.** Probe size and blind-retry warnings (R-17), the `assumption_source` judge question
  (it needs labelled cases first), and the R-01 goal sheet's blocking unknowns. A program that writes
  the register or the evidence files outside a tool call is not seen by the lanes (cooperative trust,
  as for the bd guard); the gates' re-verification is what still holds then.

### Review records and the merge gate

Owner rulings: builders cannot merge; the Delivery Manager asks independent reviewers to review each
pull request and, on their outcome, accepts and merges; a conflict goes back to the pull request's
owner and is reviewed again; gates block only on authority or serious divergence (R-32, R-24, R-12).

- **The product repository.** Sessions run in the project (planning) checkout, so gh is always given
  the product repository: `team.json` `product_github` (`owner/name`), which `start.js --product-repo`
  records from the product checkout's origin when it is on `github.com` (or a role's own product
  worktree's origin; no other host is read as GitHub). Without it,
  `review.js request`, `merge-gate.js check` and the Delivery Manager's merge are refused. The legacy
  `product_repo` field is still not read.
- **Review records.** `.delivery/reviews/prs/<pr>/<writer>.ndjson`: one chain per pull request and
  per session that writes (the Delivery Manager, each reviewer session), append-only and chained like
  the evidence rows (`n`, `prev`), written only by `review.js` and `merge-gate.js`. Sessions on
  different hosts each append to their own file, so their checkouts merge in git without forking a
  chain; a reader merges every chain of the pull request in time order (clocks are trusted to be
  roughly right). Every row names the product repository, and rows recorded for another repository
  never count, for the gate or for status. Rows: `request`, `review`, `ci`, `sent-back`, `merged`. `node ${CLAUDE_PLUGIN_ROOT}/scripts/review.js
  show <pr>` and `review.js list [--plain] [--json]` read them. **Review rows are published to the
  project repository automatically**: right after a row is written, the script commits that one
  chain file (`reviews: PR <n> <event> (<writer>)`) and pushes the root's branch to origin
  (fast-forward only; on a rejected push it fetches, rebases the record commit and retries once),
  so the gate on another host, or after a container restart, reads the same rows. Nothing else in
  the root is staged. It never blocks a command: with no origin or an unreachable one the command
  keeps its exit code and prints `review rows for PR <n> not published: <reason>`, and the next
  command carries the earlier rows too.
- **Who authored it.** A GitHub fact, not the body a builder wrote: the pull request's head branch,
  `team/<builder instance>` (the worktree branch prepare-role gives each builder). Every bead its
  `Refs <bead>` lines name must have that builder among its stamped authors (the claim check records
  them); a bead with no recorded author, another builder's bead, or a branch that is not a builder's
  is refused at request. `state-merged` goes only on a story whose author is that builder. Without gh
  the Delivery Manager names `--head`, `--branch`, `--bead` and `--lines`, on its word.
- **Request.** `review.js request <pr> --reviewer <session or subagent id>` (the Delivery Manager)
  reads the pull request through `gh pr view -R <product>` (head, branch, changed lines, `Refs`),
  refuses a reviewer who is an author or the Delivery Manager itself, and prints the reviewer brief:
  review that head only, run the tests and quote their output, report `pass` or `changes` with
  findings, never modify code, push, approve or merge.
- **Independence.** `review.js record <pr> --head <sha> --result pass|changes [--by <id>] --summary
  '<line>'` records only a reviewer requested for that pull request and head. A session records its
  own review; the Delivery Manager records only a subagent or bot it asked, by its id, and never in a
  team session's name. Refused: an author (by instance or actor), a review recorded from an author's
  session (so a subagent an author dispatched never counts), and the Delivery Manager as its own
  reviewer. Identities are compared normalised: case, `user@host/` and `@host` forms, `_` for `-`, trailing
  punctuation, and the `delivery-manager` alias. A bot (`copilot`, `claude`, `gemini-code-assist`, `github-actions`, `dependabot`, `renovate`, any `[bot]`
  or `-bot` name, or `--advisory`) is an advisory row: it never satisfies the gate alone unless
  `team.json` sets `"review": { "bots_count": true }`, and then its newer `changes` blocks as well.
- **The gate.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-gate.js check <pr>` passes only when a
  passing counted review of the pull request's current head exists, recorded after the last
  send-back, with no newer counted `changes` on that head; CI is green (gh's `statusCheckRollup`:
  every check completed with success, neutral or skipped; pending waits; where gh cannot read the
  checks, or none are configured, the Delivery Manager's `review.js ci <pr> --head <sha> --result
  pass|fail --run <ref>` row stands in); and gh reports the pull request mergeable (`CONFLICTING` is
  sent back, `UNKNOWN` waits: GitHub is still computing). A new commit changes the head, so the old
  review no longer counts. The lane runs the same check before it allows the Delivery Manager's
  `gh pr merge`, which must name the pull request by number with `-R <product>` (or by its URL in
  that repository) and the full 40-character head with `--match-head-commit`, so GitHub merges
  exactly what was reviewed; `--admin`, `--auto` and `-a`, in any form, are refused, and so is the
  Delivery Manager's `gh pr review --approve` (approvals are review rows, not GitHub approvals).
  Each refusal is two lines, the second the exact command to run. An error in the check fails
  closed. `gh workflow run` stays in the Delivery Manager's lane for deploys: a workflow that merges
  pull requests would sit outside the gate, so none should.
- **Send-back.** Changes asked, red CI, or a conflict: `review.js send-back <pr> --reason
  conflict|changes|ci [--note '<what>']` appends a note to the beads and prints the message for the
  owner (the builder whose branch it is). The Delivery Manager never resolves a conflict itself;
  reviews before the send-back stop counting, so the fix is reviewed again.
- **Merged.** `merge-gate.js merged <pr>` after the merge: checks gh says merged, writes the `merged`
  row once, and runs `evidence.js state <bead> merged --pr <pr>` for its stories (R-12). It is safe to
  run again: a story already marked is skipped, and a failed bead update is reported (exit 1) with the
  command to retry. A merge made without a passing review of its head is recorded with a
  `merge-ungated` warning.
- **Size and scope (R-24).** A pull request over `pr_size_lines` changed lines (600 by default; lock
  files including `bun.lockb` and any `*.lock`, `dist/`, `build/`, `out/`, `vendor/`, `generated/`,
  `gen/`, `__generated__/`, `target/`, `coverage/`, minified files, source maps, snapshots and
  generated protobuf, Dart and `.generated.*` files left out) or whose `Refs` lines span more than one
  story is a recorded warning in `review.js request` and in `merge-gate.js check`, never a refusal.
  The figure is a goal field: it changes only on the owner's Yes in the question box (`goal.js ask
  pr_size_lines <n>`, then `goal.js set`).
- **Status.** `team-status.js` groups the open pull requests: waiting for review, review passed,
  ready to merge, changes requested, build failing, sent back, review record damaged (a broken chain
  is reported as such, never as its readable rows). Bots count for status exactly as for the gate
  (`review.bots_count`). With gh it reads each open one live: a
  head that moved since the last request means "needs review again", red checks "build failing", and
  only green checks with a mergeable pull request "ready to merge"; without gh a passing review is
  "review passed", the gate not known. The head is the latest requested one, so a late review of an
  older head never reads as ready. `review.js list --plain` is the Chief of Staff's wording ("The
  change "Import a collection" is reviewed and merged; checking it on the customer's app next"),
  with no pull request or bead ids.
- **What rests on trust.** The lanes refuse a Write, Edit, redirect, `tee`, `cp`, `mv` or `sed -i`
  onto `.delivery/reviews/prs/` for every role. An `any` lane (builders, the Spike Researcher) can
  still run a program that writes the file (`node -e`, `python3 -c`) and append a chained row the gate
  will count; that is cooperative trust, as for the rest of an `any` lane, and git history shows it.
  `git stash -u` (or a checkout) in the project checkout can also set aside uncommitted records, so
  the Delivery Manager commits them. Rows the Delivery Manager records for a subagent, a bot or a CI
  run rest on its word: the script checks who is named, not that the subagent ran. Only the exact
  `team/<instance>` branch binds (nothing under it), and the lane refuses every session's push onto
  another builder's `team/<instance>` branch, forced or not; a program run from an `any` lane is
  cooperative trust, as above.
- **Not yet.** `state-merged` is set by `merge-gate.js merged`, not by a hook after the merge; the
  full-run receipt (lane, sha, passed count) R-32 names, 400-line caps on security paths, and a story's
  `split_plan`. The chain's head is not stored outside the
  file, so a deleted last row is caught only by git history.

### Stop the line and flow

Owner rulings: block only on authority or serious divergence, otherwise warn; the owner is never
asked to verify (R-22, R-23, R-24; D3).

- **Area stop (D3).** A counting fail row from a reality check (`reality-check.js run-record`, the
  mechanical pause above) stops its area, never the team: `goal.js show` says "area X stopped", and
  the idle alarm still counts ready work in other areas. A claim there is refused unless it is
  recovery work for a failure in that area: a fix linked to it (a `bug` bead whose `fixes:` names the
  failed row, the failed story's bead or its story id), work on the failed story itself, or the A3's
  own work (`a3: <id>`, which only the Delivery Manager or Product Manager sets). Linked fixes start at
  once. The stop lifts when the failure's A3 closes, and the lift is final: the close already proved
  the fix on a later deploy, so a deploy after it stops nothing. A regression is a new fail row and a
  new stop.
- **The A3.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/a3.js new --trigger andon:<ev row>|ci:main|flaky:<test>`
  writes `.delivery/reviews/<a3>.md` from `templates/a3.md`: the problem as observed on the surface,
  the evidence row (filled from the row), what was expected (filled from the criterion), the root cause
  in one paragraph, the class of defect, the fix across the class and the check that proves it. The
  Delivery Manager and the Product Manager write it (by editing the file or with the section flags);
  the Reality Checker may open one and draft the problem, evidence and expected sections only. One
  open A3 per trigger (checked and opened under one lock). `a3.js close <a3> --fix <bead>... --proof
  <ref>` refuses:
  - a section that is a placeholder (TBD, TODO, n/a, -), under eight words, or single letters only;
  - a fix bead that does not exist, is not linked to the failure (`fixes:` as above, or `a3: <id>`),
    or is not merged (its state label, or a merged review record that carried it);
  - for a failed check, a proof that is not a counting pass (the done gate's row rule, so the
    criterion's current wording) on the sha deployed now, a later build than the one that failed;
  - for `ci:main`, any required workflow still red (every one that went red must be green again), or a
    proof that is not a green run of main newer than its workflow's last red run, read through gh
    (where gh cannot read CI, the Delivery Manager's `ci green --workflow <w>` row after that
    workflow's last red one);
  - for `flaky:`, a proof that is one of the runs recorded for the test, or a run gh lists as not green.
  `a3.js show <a3>` and `a3.js list` read them.
- **Red main (D3).** The claim check reads CI on the product's main (`gh run list -R <product_github>
  --branch main`; `team.json` `product_branch` overrides the branch) for the required workflows only:
  `team.json` `required_workflows`, or by default the push-triggered workflows that ran on the newest
  main sha (so a manual release or a scheduled job counts only when the team names it). Each counts by
  its latest run with a verdict (cancelled and skipped runs are none) and by when runs finished. When
  one failed, new claims across the product are refused, except linked fixes and the `ci:main` A3's
  own work, until every required workflow is green again; an A3 never lifts a red main. The refusal
  and the status name the repository, branch and red workflows. Where gh cannot read CI, the Delivery
  Manager records one row per workflow:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/andon.js ci red|green --sha <sha> --run <ref> [--workflow <w>]`.
- **Flaky test (a warning).** `andon.js flaky <test> --sha <sha> --fail-run <ref> --pass-run <ref>
  [--area <a>]` (any session but the Chief of Staff): the same test failed then passed on one sha. It
  warns at each claim in its area (or everywhere, with no area) and wants an A3 within 24 h. A record
  is confirmed when the Delivery Manager made it or confirms it (`andon.js flaky confirm <test>`).
  Only a confirmed record that names its area, with no A3 opened within 24 h, refuses claims in that
  area (D3), until an A3 is opened; it never stops the whole product.
- **Fix on fix (a warning).** `merge-gate.js merged <pr>` checks each fix bead the pull request
  carried (labels `bug`, `security` or `finding`): when another merged fix shares its symptom (the
  same `fixes:` or `finding:` target, or an A3 whose class of defect reads the same) within 48 h, it
  creates a spike bead (`<bead>-spike`, label `spike`, with its question, decision and decision rule),
  records a `chain` row and a `fix-on-fix` warning. Later fix claims on that symptom warn until the
  Delivery Manager acknowledges it (`andon.js ack <chain row> --reason '<the spike's answer>'`); closing
  the spike bead alone is not an answer. After the answer only fixes merged later pair again. A merge
  recorded without `merge-gate.js merged` is not seen.
- **The ledger.** `.delivery/andon/<writer>.ndjson`, append-only and chained like the review records
  (`n`, `prev`), written only by `a3.js`, `andon.js` and `merge-gate.js`. Every lane refuses a hand
  write, and a deletion or move of the folder, of its parent, or by a glob that reaches it. A chain
  broken in the middle is reported, and its closes and acknowledgements stop counting. Not detected:
  rows cut off the end of a file, or a whole writer's file deleted by a program; git history shows
  both. `andon.js show [--plain] [--json]` reads it.
- **Flow (R-23, warnings only).** At a claim or assignment of a story: one story in progress and one
  queued per session (`team.json` `budget.wip_per_session`, default 1 in progress), counted with the
  status the story ends with and with the earlier stories of the same command; merged, deployed,
  verified or cut stories have left the builder's hands. In-progress stories at most the team's
  builders. At `review.js request`, more than `budget.open_prs_per_builder` (default 2) pull requests
  that GitHub still has open for the builder (where gh cannot read them, unmerged requests from the
  last 14 days); one story per pull request and the size cap (R-24) as before.
- **Status.** `team-status.js` puts stopped areas, a red main, flaky tests, open A3s, fix-on-fix
  spikes and the open flow warnings right after the idle line. `andon.js show --plain` is the Chief
  of Staff's wording: "The import area is stopped until we fix why files dropped in plain chat did not
  arrive; the fix is in review." (the area's own name, or "an unassigned area"; the A3's first problem
  sentence; where the linked fix stands).
- **What rests on trust.** The A3's prose is the Delivery Manager's word; the close row keeps a hash
  of it. CI read from gh is what GitHub reports for the newest 30 runs on the branch, for the
  repository named in `product_github`. A program run from an `any` lane (`node -e` calling the
  library) could append a chained ledger row or cut rows off a file's end, as for the review records.
- **Not yet.** Stall and production-probe triggers (R-04); a `split_plan` that waives the size
  warning; flaky run references are checked against gh only when gh lists the run.

### Owner authority and communication

The owner runs the enterprise; the Chief of Staff runs the team for the owner (R-42 to R-46).

- **Constraints only on the owner's yes.** `.delivery/goal.json` holds the fields that constrain the
  work: `budget.weekly_units`, `budget.usage_envelope`, `budget.lean_at`, the estimate overrides
  (`budget.estimate_s|m|l`, `budget.reserve`, `budget.unit_tokens`), `area_add` (a product area the
  owner agreed to open), `pause` (paused, stopped,
  off), the scope (changed by `scope_add` and `scope_remove`), `approvals`, `idle_minutes` (30) and
  `briefing_lines` (12). The scope is the list of product areas the team builds toward: an add puts
  items in, a remove takes them out, and a remove can never add.
- **The confirmed question (the only path).** In plain words for the owner: the Chief of Staff asks you
  a Yes/No question in a question box; clicking Yes is the decision. Mechanically:
  - `node ${CLAUDE_PLUGIN_ROOT}/scripts/goal.js ask <field> <value>` words the question itself ("Pause
    the team's work now?", "Set the weekly budget to 5 units?", "Add billing to the scope?", "Resume
    the team's work now?"), records it with `operator.js ask`, and prints the AskUserQuestion input to
    use: that question, the options Yes and No, single choice;
  - the capture hooks read the session's transcript, which the harness writes: the AskUserQuestion
    answer (the harness's tool_result) becomes an owner input bound to the question text, the options
    and the choice mode the tool_use put, and the option chosen;
  - the Chief of Staff records it with `operator.js record --answers <q> --goal <field>=<value>`;
  - `goal.js set <field> <value> --record <dec-id>` accepts it only when the question is goal.js's text
    for that field and value, the box offered exactly Yes and No as a single choice, the owner chose
    Yes, the answer came after the question and within `answer_window_hours` (24), the record carries
    the same field and value, it was not decided under a delegation, and it is neither revoked nor
    superseded. A typed "yes" never counts: a question in a message can sit in a code block or a quote
    while the owner answers something else;
  - a yes applies once: a second change on the same question, answer or record is refused, and only the
    latest change to a field counts on read, so an older yes never re-applies.
  The transcript is the harness's file, but a session with unrestricted Bash could append to its own
  transcript; like the rest of the capture, this is cooperative trust, detectable in the store's chains.
- **Free text is off.** An instruction the owner types in their own words sets nothing until
  `goal_instruction` is measured on labelled cases (at least 9 of 10, no wrong answer at or above 0.8).
  The code stays behind `team.json` `"goal": { "free_text": true }` (default off): then a free-text
  change needs the word rule as a pre-filter and the typed judge's `goal_instruction` at p ≥ 0.8. The
  word rule refuses, whatever else is said: a negation, a conditional ("only if", "if", "unless",
  "when", "in case"), another language, a figure that is not the object of its field word in the same
  clause, a pause that is not a verb on the work or starts later, a resume tied to a later time. It is
  a filter, not an understanding.
- **Who sets what.** The Chief of Staff sets every field; the Product Manager sets scope changes only.
  Other roles, and sessions without a role, are refused. Every read checks the record again: a revoked
  record, or a value written by hand, falls back to unset (or the default) with a `goal-unverified`
  warning. `goal.js show` prints each field with its record, and whether work is paused.
- **The mechanical pause.** `goal.js pause --trigger andon:<ev-row-id>` (Delivery Manager, Chief of
  Staff, or the Reality Checker, whose `run-record` raises it on a counting fail) cites a failed check row that `evidence.js add` wrote (by the Delivery Manager or a Reality
  Checker); the Delivery Manager may pause on a fail row it recorded itself. At pause time the bead's
  recorded evidence head must match the file. When read with bd at hand (`/delivery:team`, the Stop
  hook's idle check, `goal.js show`), only rows up to the recorded head count, so a pass appended by
  hand does not lift it and an edited chain keeps it open. It stops only its area, never the team,
  and lapses when the failure's A3 closes on a proved fix (see Stop the line below). It is kept apart
  from the owner's pause, so a closing andon never lifts an owner pause. Red CI is read by the claim check (Stop the line), not by this pause.
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
  | live, shipped or verified (not in a question) with no `evidence.js check` or `list` in this turn's tool calls (a clause `plan.js brief` printed this turn is backed), of the bead when one is named | word rule over the transcript (read back up to 64 MB for a long turn) | warn, unless it says "not checked yet" |

  Each warning is a ledger row (rules R-44, R-45, R-03) and one two-line reminder on the next prompt.
  The judge questions are asked in parallel with `relay_request`, 2 s each, and not at all on a
  continuation that can no longer block. Their message is redacted first: paths, commands, links and
  tokens become placeholders (`[path]`, `[url]`), so a concrete order still reaches the judge. The Stop
  hook keeps a 12 s deadline inside the harness's 15 s: bd reads take what is left, and the idle check
  runs only with 5 s left and must finish by 9.5 s, so the worst stop stays under 10 s (9.3 s measured).
- **Short reasons.** Every block and warning reason from the hooks and these scripts is at most two
  lines and its last line names the exact command or the role to message; `hooks/scripts/reasons.test.js`
  checks it over the guards' refusals.
- **Limits.** The word rules are heuristics: an order phrased as a statement, or ids in an image, pass.
  The queue, like the warnings ledger, is tamper-evident by git history only (see the lane, above).

### The Chief of Staff's day

In the Vault the Chief of Staff relayed the owner's words, misrouted most of its messages and planned only
at the end (R-01, R-02, R-03, R-06, R-45). Its day is now three commands over the record, no agent
judgement in between (`scripts/lib/daily-plan.js`).

- **The goal sheet.** `goal.js sheet [--json]` (every role reads it) assembles one page from existing
  records: the outcome (the brief's "What changes if we solve it", else the PRD summary) and the scope
  the owner set; the customer surface (`surface.json`, the surfaces the stories name); what done means
  (every criterion of every story passes on the customer's app, and how many stories are checked, by
  the done gate's own verdict, as in the brief); the
  owner-set budget and its basis, or "not set by the owner"; the current wave per area; the blocking
  unknowns (external-host assumptions not observed and acknowledged, open spike beads, stopped areas);
  what waits on the owner (open owner-queue steps and open owner questions). Plain words; `--json` gives
  each line's record ids (`dec-`, `A-n`, spike, story and row ids) and the document an outcome was read from.
- **No view on a failed read.** When bd, the owner queue, the operator records or the review records
  cannot be read, or the operator records report a broken or missing chain, `goal.js sheet`, `plan.js
  today` and `plan.js brief` exit 1 with the command that shows it (`bd where`, `operator.js problems`), and no
  plan row is written, so a later "since" never compares against an empty snapshot.
- **The plan.** `plan.js today` (Chief of Staff only) ranks the day in six sections: 1) owner steps due
  and open owner questions, 2) stopped areas (a stop whose bead cannot be read stays, as "could not be
  read") and a red main, 3) blocking unknowns (a probe to run, a design to change, a result to
  acknowledge, an open spike; an assumption is `<initiative>/<A-n>`, since ids restart per initiative; a
  result the owner decides is two items: the Chief of Staff asks the owner in a question box and records
  it, the Delivery Manager acknowledges citing that record),
  4) the current wave's next stories by `plan.js select`, admitted only when the claim check would admit
  them (stop the line, the assumption gate and its area pause: a stopped area offers only its recovery
  work, a red main only fixes), at most three, 5) pull requests waiting for review or merge, with changes requested,
  with a failing build or a damaged review record, all to the Delivery Manager, 6) reality checks
  pending. `plan.js today` runs only on the session's own project (`--project` naming another is refused). Each item names its role from the routing table and its one action, and carries its
  reference. Every run appends a plan row, with the story states, to `.delivery/plans/<date>.ndjson`
  (UTC date); the latest of the day counts.
- **The routing table.** Owner steps and questions: the Chief of Staff. Stops, probes, stories to
  assign, reviews, merges and spike results the Delivery Manager owns: the Delivery Manager. Design
  changes after a refuted assumption and spike results the Product Manager owns: the Product Manager.
  Spikes: the Spike Researcher, else the Delivery Manager. Reality checks: the Reality Checker, else the
  Delivery Manager.
- **Routing.** The Chief of Staff sends each item with `SendMessage`, carrying its reference in brackets
  (`[ex-vault-0n9-4]`, `[vault/A-8]` or its spike, `[#478]`); a plain mention is context, not a send. A
  PostToolUse hook (`route-check.js`) appends a sent row for each of today's items a Chief of Staff message carries,
  and records a `misroute` warning (R-06) with one line of context when the recipient's role is not the
  item's: acceptance to anyone but the Delivery Manager, implementation to the Product Manager, any other
  mismatch. Warn only. `plan.js routed [--json]` lists today's items not yet sent to their role, and the
  misroutes. The recipient is read from the manifest's instance names, the roster's session ids, a
  role's display name, or DM, PM, CoS and RC; anything else is an unknown session.
- **The briefing.** `plan.js brief` renders the owner's briefing: a stopped area first ("The import area
  is stopped until we fix why ..."), then what changed since the last plan of an earlier day ("since
  yesterday", or "since <date>" when that plan is older; merged, live, checked on the customer's app,
  checked only on the done gate's own verdict: the file matches the recorded evidence head, and the
  latest counting row of every criterion on the deployed sha is a pass), up to two blocking unknowns in
  the owner's words (assumptions and open technical spikes), what waits on the owner, today's stories,
  pull requests and checks; no ids; at most `briefing_lines` (`--limit <n>` asks for fewer; one line is
  the first line with the offer), the last words always "Ask for details on any item". The Chief of
  Staff sends it instead of its own summary; the owner-message checks still apply, and a live or checked
  claim is backed when `plan.js brief`, run on its own in a call, printed that same clause in this turn
  (the Stop hook reads the command's output in the transcript). The sheet's wave lines count checked
  stories by the same rule.
- **The lane.** `plan.js today|brief|routed` are in the Chief of Staff's `plan-cos` group; every role is
  refused a hand write to `.delivery/plans/`, by file tool and by shell, `any` lanes included. The Chief
  of Staff still has no build, commit, push, merge, infra or app tools. The lane's temporary-directory
  exemption (scratch files) no longer applies under the project root or inside a role directory: the
  shared checkout is refused to every role, under tmp or not, and each role writes its own clone.
- **What rests on trust.** Plan rows are not chained (tamper-evident by git history, like warnings). A
  sent row means the message tool returned, not that the session acted. The plan says what to do, not
  whether it was done: status still comes from beads, evidence and review records.
- **Not yet.** The Stop reminder when the day's plan is missing (R-02) and `team.json` `owners` with its
  validation (R-06). Stalls come first in the plan: see [The watchdog](#the-watchdog-stalls-and-the-wake).

### The watchdog: stalls and the wake

In the Vault nothing woke the team for four days after the weekly usage reset (the owner typed "Try
again" twice), a top-priority bead sat unclaimed 15.5 hours overnight, and a watcher polled 30 pull
requests every 90 seconds until GitHub's rate limit failed a deploy.

- **What can wake a stopped session (the probe, Claude Code 2.1.287).** Checked against `claude --help`
  and the Claude Code docs, with one `claude -p --model haiku` run in a scratch directory:
  - `claude --resume <session-id> -p "<prompt>"` continues that conversation non-interactively, under the
    same id, with its model, but not its permission mode: a session started in auto comes back in
    default (checked on claude 2.1.310, and seen on a real team as a woken builder stopped at approval
    prompts no one could answer), so every wake passes `--permission-mode`; run in the role directory, the role's
    `.claude/settings.local.json` (model, `DELIVERY_ROLE`, lane permissions) and the plugin's hooks load
    (the scratch run fired SessionStart; `--resume` with an unknown id exits 1, "No conversation found",
    without calling the API). The resume of a real role session was not exercised live. A `-p` prompt is
    written to the transcript as an SDK prompt, not a typed one, so operator capture never takes it for
    the owner's words.
  - A session still open in another process cannot be resumed in place (documented as a conflict).
    `--fork-session` continues a copy under a new id. `claude agents --json` lists the open sessions with
    `status` busy, waiting or idle (its field names are read as the 2.1.287 output shows them).
  - A message from another session wakes an idle open session, but only from inside a session: a host
    job cannot send one, and a closed session has no inbox.
  - Hooks cannot wake anything later (a Stop hook only keeps the current turn going); `/loop` and
    `CronCreate` run only inside a live session and stop with it; cloud routines run on a fresh clone in
    the cloud and cannot reach a local session; during a usage limit their runs are rejected too.
  - A usage limit is written to the transcript as an assistant row with `error: "rate_limit"`,
    `apiError: "usage_limit_reached"` and `quotaLimits.resetsAt` (epoch seconds; milliseconds are read
    as such) and `rateLimitType` (`five_hour`, `seven_day`), text "You've hit your weekly limit · resets
    ...". The row is not documented: the reader fails open, line by line (a torn or empty line is
    skipped; an impossible reset time is "not known").
- **The stalls.** `watchdog.js check [--json]` reads beads, the goal sheet, the owner queue, the roster
  and each role's transcript on this host, and reports, in plain lines:
  - idle: ready work and nothing in progress for more than `idle_minutes`, as above;
  - a bead in progress with no bead update and no activity of its holder's session (roster `last_seen`,
    transcript time) for more than `stall_hours` (a goal field, 2 by default, owner-set like the others;
    `goal.js ask stall_hours <n>`), unless the holder is inside a `watch.js until` wait within the
    `--max` it declared; a verified or cut story wakes its holder to close it;
  - a story merged or deployed, waiting on its evidence rows, with no bead update for `stall_hours`:
    it goes to the Delivery Manager (deploy it, dispatch its reality check, record its evidence), never
    to its builder, who has nothing to continue;
  - a top-priority (P0) bead that can be taken now (in `bd ready`: open, not blocked, not an epic) and
    unclaimed for more than an hour;
  - a session stopped on a usage limit: "The team resumes at <reset + 5 min> (restart scheduled)" once the
    job is installed, else "the team is stalled; the watchdog is not installed", and "Resume now" once it
    has reset (its held beads are not also reported as stalled);
  - a role whose transcript polls gh in a loop (gh and a sleep, with its s/m/h/d unit, inside one
    `while`, `until` or `for` that runs, not loop text quoted as an argument;
    `watch -n`, gh's own `--watch`/`--interval`) more often than every 4 minutes (R-25).
  Each is a warning in the ledger (`idle`, `stall`, `p0-unclaimed`, `usage-limit`, `tight-poll`), once per
  stall, in this host's own ledger file. Nothing is paused or blocked. An owner pause that verifies silences all of it, the polling
  warnings included; an open andon (a failed check row) silences idle, quiet and P0 stalls for beads in
  its area only (they wait for its fix); a message telling the team to stop is not a pause. `plan.js
  today` lists stalls first ("0. Stalls first"), each routed to the session the watchdog wakes for it
  (sending it to another instance of the same role is a misroute, and it stays unrouted),
  and the resume time when a restart is scheduled; `plan.js brief` leads with them in plain words;
  `team-status.js` lists them under the idle line. Times are the host's local time with its zone.
- **The wake.** `watchdog.js wake [--dry-run]` wakes, for each due stall, its session: the holder of a
  stalled bead or of a bead stopped by the usage limit, else the Delivery Manager. One run carries every
  line for that session in one prompt. The command, in the session's role directory with
  `DELIVERY_ROLE`, `DELIVERY_WAKE` and `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` set (a headless run
  otherwise stops the background subagents its turn started, such as the Delivery Manager's reviewer,
  ten minutes after the turn ends; the wake's own limit still bounds it), always with
  `--permission-mode <mode>` first (team.json
  `permission_mode`, which start.js records; for a team recorded before it, the mode the session
  started in; auto when neither says; nothing for `default`; an unreadable team.json or an invalid mode
  is no wake, alarm only): `claude --resume <id> -p "<prompt>"` when the session is not
  open; with `--fork-session` when it is open and idle; `claude -c -p` when the roster has no session id;
  nothing when it is busy, when open sessions cannot be listed (`claude agents --json` failed: alarm
  only, never a fork), or when its role directory is not on this host. A session not open whose last turn carried more
  than `wake_fresh_above_tokens` (team.json, 120000 by default, 0 for never; read from the usage its
  transcript records) is woken in a fresh session in its role directory instead (`claude -p`, no
  resume), told that its earlier conversation is not loaded and to start from its in-progress beads:
  a resume reloads the whole conversation, and one day of wakes took a real Delivery Manager's turns to
  236k tokens. The fresh session is named like the role (`--name`), and the next wake resumes it (a
  fresh role session starts near 53k tokens). The Stop guard's check for unrecorded operator input is
  per session, so a fresh Chief of Staff is told to run `operator.js pending` first.
- **The wake's limits.** At most one wake per session an hour whatever the stalls; at most 6 a day per
  session; each stall waits 1, 2, 4, 8 ... hours after each wake that carried it; never while that
  session's last wake still runs, however long ago it started (each wake runs in its own process group
  under `lib/wake-run.js`, which stops the whole group after 2 hours, SIGTERM then SIGKILL, and lives
  until the group is gone; the guard checks that the logged pid is alive and is still that supervisor); never before the session's own usage limit resets (then once,
  for everything due). Past a limit the stall stays an alarm: "Alarm only: <session>: <reason>". A usage
  limit with no known reset keeps one key and one warning however often a wake is rejected again. A
  usage-limit wake starts within the 5-minute grace plus one job interval of the reset (at most 20 minutes at
  the default `--every 15m`; `--every 5m` keeps it within 10). `run`
  takes a lock (`.delivery/watchdog/run.lock`), so concurrent runs wake once.
- **Forks.** A fork's SessionStart (with `DELIVERY_WAKE=fork`) is recorded in the roster entry's
  `forks` list, never in place of the owner's open session, which stays the one the watchdog reads;
  operator capture leaves the roster alone for a fork, and a fork keeps its own session id and
  transcript locator (`.delivery-session.fork-<wake id>`), so `operator.js` records, syncs and acks as the
  fork, never as the owner's session. The forks' transcripts count with the primary's
  for activity and the usage limit, so a fork on the limit holds the next wake until its reset. Forks
  older than a day drop off the list; their transcripts stay on disk.
- **The log.** Every wake, skip (at most one an hour per session) and scheduled wake is a row in
  `.delivery/watchdog/wakes.ndjson`, rotated to `wakes.ndjson.1` past 1 MB; each wake's output goes to
  `.delivery/watchdog/logs/` (the newest 50 kept); the job's own output to `job.log` (rotated past 1 MB).
  All of `.delivery/watchdog/` is gitignored: it is this host's. Each wake is one turn of that session;
  the next run checks again. `DELIVERY_CLAUDE_BIN` names another `claude`.
- **The host job: installed by the owner, once per host.** `watchdog.js install [--every 15m]` prints
  what it would write and how to remove it; `--apply` writes it; `watchdog.js uninstall` removes it in
  every form (running it again says "Nothing to remove"). Nothing installs it for you. `wake`, `run`,
  `install` and `uninstall` are refused to every role session, `any` lanes included and whatever the
  form (the job shim with any arguments, a compound command such as `if ...; then ...; fi`, a chain, a wrapper such as `env`, `nohup` or `timeout`, `bash -c`, `eval`, `$(...)`, `node -e`,
  the shim, a quote-split or glob word, a command word built from a variable), and so is
  `claude --resume`/`--continue` by hand. Only what runs is judged, at each command position after
  shell grammar, assignments and wrappers, and inside `$(...)` or backticks the shell would expand (not
  inside single quotes, not escaped): a note, a commit message, `rg claude -c src`, `printf ... watchdog.js
  run` or `git diff -- scripts/watchdog.js` that names the file or a flag is not refused; the
  script itself refuses them inside a role directory or with a role session's environment
  (`DELIVERY_ROLE`, `DELIVERY_ROLE_ID`, `DELIVERY_ROLE_DIR`). Only `check` runs in a role session. What
  `--apply` writes:
  - `.delivery/watchdog/job.js`, a shim the job runs with `/usr/bin/env node`: it finds the plugin each
    run (a checkout stays where it is; a plugin installed by Claude Code is looked up in
    `~/.claude/plugins/installed_plugins.json`, so an update is picked up), then runs
    `watchdog.js run --project <root>`. No node or plugin version is pinned in the job.
  - macOS: `~/Library/LaunchAgents/com.delivery-plugin.watchdog.<hash>.plist`, a launchd agent every 15
    minutes and at load, in the project root, with the installing shell's `PATH` followed by
    `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin` and `~/.local/bin`, output to
    `.delivery/watchdog/job.log`, loaded with `launchctl bootstrap gui/<uid>`.
  - Linux with systemd: `~/.config/systemd/user/delivery-watchdog-<hash>.service` (`Type=oneshot`,
    `KillMode=process` so a wake outlives the run, `Environment="PATH=..."`) and `.timer`
    (`OnUnitActiveSec`, `Persistent=true`), enabled with `systemctl --user enable --now`. A user timer
    runs only while you are logged in unless lingering is on: `loginctl enable-linger $USER`.
  - Linux without systemd: one crontab line marked `# delivery-watchdog <hash>` (a second install
    replaces it; every `%` is escaped for cron; a crontab that cannot be read is never replaced, only "no crontab" counts as empty). Cron runs on clock minutes, so `--every` must divide the hour there (5m, 10m, 12m, 15m,
    20m, 30m, 1h).
  `--every` is 5m to 1h. The machine must be on and the owner signed in to Claude Code for a wake to run.
  Each scheduler keeps the installing shell's `CLAUDE_CONFIG_DIR`, and the shim restores it before it
  looks up the plugin or wakes anyone. Paths with spaces are quoted for each scheduler.
  `.delivery/watchdog/installed.json` records the install; the plan and the brief promise a restart only
  while it and the job file exist. An operator's own `watchdog.js wake` works without the job.
- **Watching GitHub within a budget (R-25).** `watch.js until <text> --every <5m> --max <2h> -- gh <read>`
  repeats a gh read until its output shows `<text>` (a pattern, any case), exit 0, or the time limit
  passes, exit 1. Outside a project its cache is a private folder in the temporary directory (0700,
  files 0600), not reused when it is a link, another user's or open to others. It refuses a watcher with no exit condition, no time limit, a limit over 6 hours or
  an interval under 4 minutes, anything but a gh read, and gh's own polling flags (`--watch`, `-w`,
  `--interval`, `-i`). `watch.js gh <read>` is one read. Both go through `.delivery/cache/gh/`
  (gitignored), shared by every role on the host and fresh for 4 minutes (the one query per 4 minutes
  of R-25), keyed by the read, its repository (`-R`, `GH_REPO`, else the working directory gh resolves
  it from) and its host (`GH_HOST`); a read that names no PR (`pr checks`, `pr view`) keeps its
  checkout and branch in the key even with `-R`. It is kept with its exit status (a read cut short is
  never kept), so a pending check or a rate-limit error is
  shared for the window too; one caller refreshes an entry while the others wait for its result;
  entries older than an hour go and at most 500 stay. The briefs tell roles to use it instead of
  `while ... sleep`, `watch -n` or a polling Monitor. `watch.js` is in the `gh-read` lane.
- **What rests on trust.** The transcript format and the `claude agents --json` fields are
  undocumented; a change in them makes the limit stall silent or a wake an alarm only, not wrong. The
  wake log is not chained. A wake means the command started, not that the session acted: the next check
  still reads the beads. A builder's `any` lane still runs arbitrary code on the host; the lane and the
  script stop the watchdog paths, not a builder determined to start a session another way.
- **Not yet.** The typed judge's `stalled` score on notes that do not move (R-04), merged-not-deployed
  over 20 minutes as a stall, a red main as a reason to hold the P0 alarm, a polling warning when the
  command starts rather than from the transcript, and a wake across hosts (each host's job wakes its own
  roles).

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
| `/delivery:amplifier` | any time | On a machine with Microsoft Amplifier: hand a host problem (work-tracker, its Dolt server, services) to one `amplifier run` call first; every session there starts with a one-line reminder, and `start.js --check` shows Amplifier and the work-tracker's doctor |

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
