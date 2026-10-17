# Shipping team: long-lived role sessions for the delivery plugin

Date: 2026-10-12. Status: design approved in conversation, awaiting written review.

## 1. Problem

The operator runs a product (The Vault) with about ten Claude Code sessions, each holding a role
(Chief of Staff, Product Manager, Delivery Manager, Infra Manager, Progress Observer, Spike
Researcher, AI Worker, two General Workers, a cloud Documentation Manager). They run on a Windows PC,
a headless Ubuntu server, and the cloud. They coordinate through cross-session messages and beads
over a shared Dolt server. The rules that make it work are in the product repo's AGENTS.md
(sections 5, 8, 9, 10).

Landing that shape took weeks of hand work and it cannot be reproduced for a new project. The
pieces are scattered: role briefs exist only in session-start prompts; every session started in the
same folder shares one auto-memory, so one role's notes leak into another's; two sessions share a
beads actor suffix, so claims cannot tell them apart; the roadmap lives only in beads with no record
of why; plans sit in a public repo's agents file; and beads reachability needed hand-written SSH
wrappers because the PC blocks unsigned binaries.

The delivery plugin already has the roles as subagent personas and a planning pipeline, but no
notion of sessions, hosts, beads, models, or enforcement.

## 2. Goal

Extend the delivery plugin so that one conversation with a Chief of Staff deploys and runs a
product-shipping team: each session has a specialised role from its first turn and keeps it, roles
are placed on the hosts that can do the work, cost is tuned per role, work is tracked in beads
derived from a planned roadmap, strategy never leaks into the public product repo, and the team
scales itself as the work gets more specialised. The operator never runs a join command.

Delivery is the delivery platform. It plans, staffs, dispatches, reviews and realigns; it does not
write product code itself. Building is done by builder sessions through a **runner** chosen per role
in the manifest: `superpowers` (brainstorm-skipped, plan then execute), `attractor` (the attractor
plugin's DOT-graph pipeline, `claude -p` workers), or `plain` (the builder session itself, with the
story as its only brief). The reviewer is always separate from the runner, which is what makes
sprint-review trustworthy.

Non-goals: native Agent Teams are not used; every role is an independent session wired by
cross-session messaging. The Vault is not migrated as part of this work.

## 3. Two repositories

| Repo | Visibility | Holds |
|---|---|---|
| Product repo (e.g. `the-vault`) | may be public | the product, its tests, CI, build and test rules in AGENTS.md, one line pointing at where team rules come from |
| Project repo (e.g. `the-vault-project`) | private | `team.json`, `hosts.json`, `briefs/`, the whole `.delivery/` tree, beads configuration and Dolt remote, cloud environment definition, the denylist |

Delivery's existing delivery-root resolution points `.delivery/` at the project repo. The product
repo never learns the team or the plan exists beyond bead ids in commit messages.

Beads syncs through the project repo: it is the Dolt remote. Hosts on the tailnet use the shared
Dolt server for speed; cloud sessions pull and push against the remote. A Dolt merge conflict
becomes a reconcile item for the Delivery Lead.

## 4. Roles

### 4.1 Core roles, always present

| Role | Brief source | Owns | Must not |
|---|---|---|---|
| chief-of-staff | delivery agent, extended | the operator's attention, routing, one ranked briefing in merged / deployed / verified; delegate mode (a brief-level rule: coordinate, never edit product files) | build, change beads, PRs, settings or sessions unless the operator said so, answer for the operator |
| staffing | new | hiring, the roster, `team.json` (sole writer), scaling within budget | anything else that writes |
| product-manager | delivery product-owner | vision, brief, PRD, prioritisation, roadmap document; the operator talks to it directly for vision work and it tells the Chief of Staff | dispatch |
| delivery-lead | delivery delivery-lead | bead structure (sole writer), materialise, reconcile, assignment, blockers | product scope decisions |
| progress-observer | delivery qa-strategist, extended | evidence, liveness, roster bead, real-app rows, drift checks | claims on build beads |
| builder | new, thin | claim a ready bead, run the role's `runner` on it (superpowers, attractor or plain), report in three words; one worktree each; `count` and `cap` in the manifest | create GitHub issues, touch bead structure |
| spike-researcher | delivery, standing | derisking: claims `spike` beads attached to architecture decisions and roadmap phases, answers the question with sources or an experiment, records the result in the bead and the ADR or roadmap it derisks; research and throwaway experiments only | ship code, take build beads |

Chief of Staff, Product Manager and Delivery Lead are three roles, not one. The Vault's Product
Manager does both product and dispatch; this design separates them.

### 4.2 Specialists, hired on evidence

Infra per platform (vercel, azure, aws, fly, ...), AI host experts (chatgpt, claude, gemini,
copilot), data, mobile, security, docs. Each brief says what the role owns, what it is asked for,
and what it must not do. Default: one specialist per platform that actually appears in the product
repo, no speculative hires.

### 4.3 One-off roles

`migration-expert` (bring an existing project into the two-repo shape, move beads config and team
rules, generate the first denylist, hand to the Delivery Lead). Hired for a job, released after.

### 4.3a Spikes derisk the plan

A spike is a question whose answer changes a design or a roadmap decision: can host X do Y, does
API Z rate-limit us, is approach A or B cheaper. Spikes are first-class:

- The architecture step and the roadmap step emit `spike` beads for every decision they mark as
  unproven, each with the question, the decision it gates, and what answer would change it. A
  spike bead blocks the story or phase it derisks, so `bd ready` surfaces spikes before the work
  that depends on them.
- The Spike Researcher claims them. Output is a sourced answer or a throwaway experiment in a
  scratch worktree, never product code; the result goes in the bead and into the ADR or roadmap it
  gates, and the challenge panel reads it at the next gate.
- Anyone may raise a spike bead when they hit an unknown mid-task (the Chief of Staff's rule:
  a technical unknown routes to a spike, not to the operator). The Delivery Lead orders them.
- Staffing scales Spike Researchers like builders: within `budget`, on the number of ready spikes.

### 4.4 Duties attached to roles

- Steward: one role per host, marked in the manifest. Receives roster changes from Staffing and
  converges the sessions on its host to the manifest: start, restart with a new model, stop. On the
  PC this is the infra role; on the bd host it is the progress observer.
- Infra for provisioning: the steward of the bd host runs provision.

### 4.5 Role library layout

`plugins/delivery/roles/<id>.md`, same frontmatter format as `agents/`. Core briefs compose the
existing agent files plus a `## As a session` section with the session-level duties. Project-specific
briefs live in the project repo under `briefs/` and are referenced as `project/<id>`.

## 5. The manifest

`team.json` in the project repo at `.delivery/team/team.json`, written only by Staffing, read by everyone (JSON, not YAML: the plugin has no dependencies and Node has no YAML parser):

```yaml
project: the-vault
product_repo: git@github.com:colombod-personal/the-vault.git
prefix: vault
bd_host: wintermute
budget:
  max_roles: 12
  builders_cap: 3
  staleness_hours: 2
roles:
  - id: chief-of-staff
    brief: delivery/chief-of-staff
    host: alien51
    model: opus
    mode: delegate
  - id: staffing
    brief: delivery/staffing
    host: alien51
    model: sonnet
    mode: delegate
  - id: product-manager
    brief: delivery/product-owner
    host: alien51
    model: opus
  - id: delivery-lead
    brief: delivery/delivery-lead
    host: alien51
    model: sonnet
  - id: progress-observer
    brief: delivery/qa-strategist
    host: wintermute
    model: haiku
    steward: true
  - id: infra-vercel
    brief: delivery/infra-vercel
    host: alien51
    model: sonnet
    steward: true
  - id: builder
    brief: delivery/builder
    host: alien51
    model: sonnet
    count: 2
    runner: superpowers   # superpowers | attractor | plain
  - id: chatgpt-host-expert
    brief: project/chatgpt-host-expert
    host: alien51
    model: sonnet
```

Stored as JSON with the same keys.

`hosts.json` at `.delivery/team/hosts.json`, written by provision:

```yaml
hosts:
  alien51:   { kind: pc,    bd: wrapper, headless: false, desktop_apps: true }
  wintermute:{ kind: ssh,   bd: native,  headless: true,  desktop_apps: false, dolt_server: true,
               lanes: [a, b, c, d], check: vault-check }
  cloud:     { kind: cloud, bd: remote,  headless: true,  desktop_apps: false }
```

Stored as JSON with the same keys.

Authority: Staffing and the Chief of Staff may scale the team up and down and hire specialists on
their own within `budget`. Anything beyond the budget is a proposal in the morning briefing.
Changes are commits to the project repo.

## 6. How a session becomes a role and keeps it

### 6.1 Join

`/delivery:join <role-id>` is the only way a session acquires a role. The operator never runs it;
stewards put it in a new session's first prompt. Idempotent.

1. Creates the role instance directory beside the repos, e.g. `../the-vault-team/product-manager/`
   (builders: `builder-1/`, `builder-2/`), containing a checkout of the project repo and, for roles
   whose brief says they touch code, a worktree of the product repo. One directory per instance gives
   each session its own auto-memory, actor, and settings.
2. Writes `.claude/settings.local.json` there: `model` from the manifest, `DELIVERY_MODE`, `enabledPlugins` for delivery,
   (the permission mode is passed by the steward at launch, never written to local settings), and an env block exporting `DELIVERY_ROLE=<id>`, `DELIVERY_HOST=<host>`,
   `BEADS_ACTOR=<user>@<host>/<role-id>`, `DELIVERY_ROLE_DIR=<role instance directory>` (the hooks find
   the role marker through it after the session leaves its directory) and, when `<project>/.beads`
   exists, `BEADS_DIR=<project>/.beads` (bd cannot find the database from a role directory on its own;
   a value already in the settings is kept).
3. Writes `CLAUDE.local.md` there: team rules, the role brief, the routing table generated from the
   manifest, the host's capabilities and limits from `hosts.json`.
4. Runs `bd prime`, registers the session id in the roster bead, messages the Chief of Staff.

### 6.2 Retention

- SessionStart (startup, resume, clear, compact) re-reads the manifest, rewrites CLAUDE.local.md,
  injects a short role block under the hook output cap, and registers the session
- UserPromptSubmit appends one line: role id and current claim.

### 6.3 Model and cost

Model is one line per role. Changing it is a manifest commit by Staffing and a restart by the
steward. Defaults: Opus for chief-of-staff and product-manager, Sonnet for delivery-lead, builders
and specialists, Haiku for progress-observer. Staffing proposes changes on evidence: mostly-reading
roles are Haiku candidates, roles producing wrong reasoning are Opus candidates.

### 6.4 Cloud roles

A cloud session can receive messages but cannot reply or be restarted by a peer. It is started by the
operator on the project repo in the provisioned environment; the SessionStart hook finds the manifest
and the join prompt the steward prepared. Staffing prepares, the Chief of Staff hands the operator
the one click.

## 7. Plan and execution: document plans, beads execute

### 7.1 Two forms, one direction each

- Structure flows document to beads only. `roadmap.md` (and the stories) are where phases and order
  are decided, by the Product Manager with the operator, at the end of the delivery pipeline (brief,
  research, personas, interview, simulate, PRD, prioritise, architecture, roadmap, challenge at every
  gate). `/delivery:materialise`, run by the Delivery Lead, is the single writer of bead structure:
  one epic per phase chained with blocked-by, one child per story, story dependencies from the
  critical path, a final `phase review` child per epic blocked by all its stories and blocking the
  next epic. Deterministic and idempotent. Every epic and story bead carries `roadmap-ref:
  <file>@<git sha> phase <n> [story <id>]` and the journey and criteria it serves.
- Status and evidence flow beads to document only. Sprint-review and realign read bead evidence.
  Nobody edits the roadmap to say a phase is done.

### 7.2 Compounding

`bd ready` shows the frontier. Builders claim from it. Work found while building becomes a child
bead under the bead that found it. A phase closes only when every child is closed with evidence,
which unblocks the next epic. The chain of evidence is the audit trail.

### 7.3 Review points

- Phase gate, always: the `phase review` bead. Closing it means sprint-review ran and realign
  updated the roadmap. The next epic cannot start without it.
- Triggered review: anyone may create a `strategy review` bead citing a contradiction (blocker
  invalidating a PRD assumption, twin diverging from reality, clustering user reports). A role other
  than the Delivery Lead creates it as a child of the bead it holds (8.2). The Product
  Manager owns it; the Chief of Staff puts it at the top of the briefing. Nothing else stops.
- Cadence review: the morning briefing reports drift (evidence not matching criteria, phases running
  long, open challenge findings). Drift above the threshold in the manifest creates a strategy review
  bead.

### 7.4 Pivot mechanics

The operator and the Product Manager revise brief, PRD or roadmap. Materialise reconciles beads:
new epics added, open beads re-parented or marked deferred with the reason, closed beads never
touched, dependencies re-threaded. The old plan stays in git history and in deferred beads.

### 7.5 Reconciliation owner and drift detection

The Delivery Lead owns the seam. `/delivery:team` (and the morning routine) runs a reconcile check:
roadmap stories with no bead, beads with a stale roadmap-ref, phases closed in beads but not in
realign, manifest roles missing or extra or on the wrong model in the roster bead. Any drift is one
bead owned by the Delivery Lead (plan) or Staffing (roster), at the top of the briefing.
In phase 1 the roster is a per-host file; cross-host drift arrives with phase 4.

## 8. Enforcement: hooks

All hooks ship in the plugin (`plugins/delivery/hooks/`) and are active in every role directory.
They are scripts, so they hold regardless of what the model decides.

### 8.1 Protect the public product repo

Active only when the working tree is a product-repo worktree (for shell commands, by the directory
each command runs in) or, for MCP tools, when the role touches product.

- PreToolUse on `git commit|merge|tag|notes|push`, `gh pr create|edit|comment`, `gh issue
  create|comment`, `gh release create` and `gh api` writes, whether run through Bash, Monitor or
  PowerShell: block if the message or body contains a denylist phrase, a `.delivery/` path, or a bead
  title. Only `Refs <prefix>-<id>` is allowed, never a title. `gh issue create` is blocked outright for
  agents (issues are for users). Replies to users pass the same scan. Text that cannot be checked
  (command substitution, `-F` files, `sh -c` strings wrapping git or gh) is refused, and a guard error
  on a shell call inside the product worktree fails closed.
- PreToolUse on GitHub-style MCP tools (hooks.json routes `mcp__` tools whose names contain github,
  gitlab or git to the hook; within it, names containing github, gitlab, issue, pull, comment,
  release, commit or repo are scanned) for a role that touches product (a product worktree in its role directory,
  or a builder): every string in the tool input (to depth 4, first 20 KB) passes the same scan, and a
  tool that creates an issue (whole names `create_issue`, `add_issue`, or `issue_write` with
  `method: create`) is refused outright; `add_issue_comment` is scanned like `gh issue comment`.
- PreToolUse on Write and Edit: block paths under `.delivery/`, `.beads/` and `team.json` inside the
  product worktree. File contents are not scanned (see 8.5).
- PostToolUse after push: re-scan pushed commit messages; a hit creates a strategy review bead.
- Denylist: generated by materialise into the project repo from initiative names, phase titles,
  persona names, story titles, and vision vocabulary from brief and PRD; exact phrases of three or
  more words plus proper nouns; reviewed by the operator once at materialise; the hook names the
  matched phrase so a false positive is a one-line fix.

### 8.2 Keep the record honest (PreToolUse on bd, Stop)

Enforced by hooks (the bd guard on every shell tool call that mentions bd, and the Stop guard):

- No close without a reason starting `EVIDENCE:`.
- Live-claim protection: no claim, assignee or status change (`--claim`, `--assignee`/`-a`,
  `--status`/`-s`) and no close on a bead whose holder is another actor and live (last change within
  `staleness_hours`; a configured 0 means no claim is ever live). A live claim cannot be released by
  someone else.
- Structural changes only by the Delivery Lead: for every other role, `bd create` (and `new`, `q`)
  without `--parent`, `bd update --parent`, `bd dep add|remove|relate|unrelate`, `bd delete`,
  `bd label add|remove|propagate`, and label flags on `bd update` of a bead the actor does not hold
  are refused with the sanctioned path (create a child bead under the bead you hold, or message the
  Delivery Lead). The `bd-structure` lane group (8.3) is the second layer.
- Stop: a session holding a claim cannot end its turn without a note newer than the turn start
  (stored to the second, as bd stores `updated_at`).

bd global options before the subcommand (`--json`, `-q`, `--actor X`, `--db X` and the rest) do not
hide the subcommand. The hooks run bd at the project root with `BEADS_DIR` defaulted to
`<project>/.beads`. These are discipline aids for cooperative agents: a bd lookup that fails, or a
segment the guard cannot parse, is allowed.

### 8.3 Keep roles in their lane: delegation is enforced, not requested

The operator's rule (2026-10-12): models rush to do work themselves instead of delegating, so a
sentence in a brief is not enough. Each role does its own job and never another session's; work is
done by workers (builders, spike researchers) that managers dispatch to through beads or spawn as
subagents. A PreToolUse hook enforces this from a policy each role declares.

- **Policy lives in the role file.** Two frontmatter keys, comma-separated: `lane_writes` (path
  patterns the role may Write/Edit, relative to its role directory: `project/...` is the project
  repo clone, `product/...` the product worktree, `scratch/...` a throwaway area; `$TMPDIR` is always
  allowed) and `lane_bash` (named command groups the role may run). Project briefs may declare their
  own. A role file without `lane_writes` may write nothing in its role directory; one without (or
  with an empty) `lane_bash` gets `read, bd-read, git-read, operator-read`; this default is also the lane of a hired specialist whose brief declares none, so every role can verify an operator record. Every role may also write the harness's
  own plan and memory files (`~/.claude/plans/**`, `~/.claude/projects/*/memory/**`).
- **MCP tools.** Roles with `any` use MCP tools unrestricted. For every other role an MCP tool is
  allowed when its name matches a pattern in the optional third key, `lane_mcp` (comma-separated
  tool-name patterns, `*` the only wildcard, matched against the whole name, regardless of verb), or
  when its final name part starts with a read verb (read, get, list, search, query, view, status,
  find, describe, resolve, fetch, context, ask, show, display) and carries no write verb. The manager
  roles' `lane_mcp` names the session messaging and listing tools (`send_message`, `list_*`,
  `get_session`, `search_session_transcripts` of the session-management server). The headless rule
  (below) comes first.
- **Other shell channels.** `Monitor` runs a command in the Bash environment and is judged exactly
  like Bash. `PowerShell` cannot be classified into groups: allowed only for roles with `any`. Any
  other non-MCP tool whose input carries a string `command` is treated as Bash when hooks.json routes
  the tool to the hook (deny by default for an unknown channel).
- **Command groups** (`hooks/lane-groups.json`): `read` (ls, cat, grep, rg, find, head, tail, wc, diff,
  jq, node on plugin scripts), `git-read`, `git-write-project`, `git-write-product`, `gh-read`,
  `gh-write`, `bd-read`, `bd-notes` (append notes and comments only), `bd-claim` (claim, release own,
  close), `bd-create-child` (create with `--parent` only), `bd-structure` (any create, dep add/remove,
  re-parent, materialise), `any` (unrestricted Bash, for workers). A Bash command is split on `&&`,
  `;`, `|`, `||`; every segment must belong to an allowed group or the whole call is refused.
- **Manager lanes.** Every manager lane below also includes `operator-read` and `operator-write`
  (the `operator.js` read and writer commands, 8.6). Chief of Staff: no writes; read, git-read,
  gh-read, bd-read, bd-notes, bd-create-child. Staffing: writes `project/.delivery/team/team.json` and `project/.delivery/team/briefs/**`;
  read, git-read, git-write-project, bd-read, bd-notes. Product Manager: writes
  `project/.delivery/initiatives/**`, `personas/**`, `interviews/**`, `simulations/**`,
  `decisions/**`, `reviews/**`, `sprints/*-realign.md`, `glossary.md`; read, git-read, git-write-project, bd-read, bd-notes,
  bd-create-child. Delivery Lead: writes `project/.delivery/stories/**`, `sprints/**`, `reviews/**`,
  `team/denylist.txt`; read, git-read, git-write-project, gh-read, bd-read, bd-notes,
  bd-create-child, bd-structure. Progress Observer: writes `project/.delivery/reviews/**`; read,
  git-read, gh-read, bd-read, bd-notes, bd-claim (release stale claims). No manager may write under
  `product/`.
- **Worker lanes.** Builder: writes `product/**`, `scratch/**` and `project/.delivery/decisions/**`
  (spike mode, when no Spike Researcher is hired); bash `any`, still subject to 8.1 and 8.2. Spike Researcher: writes `project/.delivery/initiatives/**`, `decisions/**`, `scratch/**`;
  bash `any`; never `product/**`.
- **Subagents are allowed everywhere** (the Agent tool is how a manager reads broadly or drafts), and
  their tool calls pass through the same hook, so a subagent cannot do what its parent role may not.
- **Refusals teach.** A refused call returns the reason and the sanctioned path: "Role chief-of-staff
  does not edit product files; create a child bead for a builder (`bd create --parent <id>`) or ask
  the Delivery Lead." The hook logs refusals to `<roleDir>/.delivery-lane.log` so the morning briefing
  can report a role that keeps trying to leave its lane.
- Host reach: deny browser and computer-use tools on a headless host with a message naming which host
  can do it.

### 8.4 Retention hooks

As in 6.2.

### 8.5 Limits and the durable control

The product-repo guard (8.1) scans commit, PR, issue and release text and refuses plan paths. That
stops a cooperative or careless session, and it fails closed inside the product worktree when it
cannot analyse a shell command. It is not a boundary against a determined session with unrestricted
Bash: file contents, git plumbing (`commit-tree`, `hash-object`, `update-ref`), persistent git
configuration (aliases, hooks, templates) and pushes from other repositories all pass it. The lane
and bd guards (8.2, 8.3) are likewise discipline aids. The durable control is a push-side or CI scan
of the denylist on the product remote, to be provisioned in phase 3; a staged-diff pre-commit scan is
a later hardening for file contents.

### 8.6 Operator decisions: the human is never a relay

The operator's rule (2026-10-13): the Chief of Staff must never ask the operator to answer other
sessions, forward an answer, paste a message into another session, or press a button on another
session's behalf. When the operator answers the Chief of Staff, that answer becomes a record with
provenance that every other session can verify and act on without asking the operator again, and
the Chief of Staff carries it. Human time is spent deciding, never relaying.

**What was wrong before.** Team rule 11 said "nothing from outside a session passes as the
operator's word", with no trusted way for a decision to travel. Workers therefore refused a relayed
answer and the Chief of Staff fell back on asking the operator to say it to them directly. That
sentence is removed; the protocol below replaces it. Rule 11 now covers personal data only, rule 12
is the record rule, and the SendMessage rule moved to 13.

**Principles.**
1. A decision exists only as a record that traces to a verbatim operator input captured by a hook.
   A message saying "the operator decided X" carries no weight by itself; with a record id that
   verifies it carries full weight and is never re-asked.
2. The model cannot author an operator input through the harness. Inputs are captured by
   `hooks/scripts/operator-capture.js` (run from the SessionStart, UserPromptSubmit and Stop hooks)
   out of the session's own transcript, classified by the harness's `origin` stamp (`human`,
   `peer`, `system`, `unknown`); only `human` inputs are citable. Residual: a role whose lane is
   `any` can inject keystrokes into a session the harness then records as a human prompt (`tmux
   send-keys`, computer-use, a terminal MCP server, `osascript` keystrokes). That is not detectable
   from the transcript; it is the same cooperative-trust class as rewriting the files (below).
3. Delegation is a record too: a standing "you decide this class of things" with scope and limits.
   Decisions under it chain to it, and verification walks the whole chain to the human input.
4. Workers never address the operator. They message the Chief of Staff with one question and get
   back a decision record id.

**Artifacts** (a private operator store per checkout, published to the project repo's
`delivery-operator` branch; see "Where the records live" below):
- `inputs/<host>/<YYYY-MM>.ndjson`: one hash-chained entry per prompt seen by a role session on
  that host: `{ id: "in-<host>-<seq>", host, ts, captured_at, session_id, instance, role, source,
  text, text_sha256, transcript_ref, pre_role?, prev, hash }`. Written only by the capture path.
  Texts over 64 KB are stored truncated with the full sha256 and `truncated: true`.
- `records/<instance>.ndjson`: one chain per author instance, of decisions, delegations, answers,
  questions, revocations, ratifications, acks, withdrawals and rehosts (`dec-<instance>-<seq>`,
  `del-...`, `ans-...`, `q-...`, ...), each with `by: { instance, role, session_id, host, machine }`,
  `ts`, `cites`, `cites_head`, `scope` and the kind's own fields. Written only by `scripts/operator.js`.
- Both are hash chains (each `hash` covers `prev` and the canonical entry), so an edit is detectable
  by anyone who verifies. The store's git history is a second witness: `operator.js publish` (run
  after every write) commits the new lines and pushes them, and a merge only ever accepts a chain
  that grew (a deleted, shortened or rewritten chain is refused).

**Where the records live.** Never in the user's checkout. Each git checkout keeps them in a private
git repository at `<git-common-dir>/delivery-operator/` (for a normal clone `.git/delivery-operator/`;
a linked worktree shares its main repository's), branch `delivery-operator`, tracking only
`operator/inputs/`, `operator/records/` and `operator/LEDGER.md`; `operator/cursors/` (heads, cursors,
per-session role boundaries) and `operator/quarantine/` are local state, never committed. Because the
store is inside `.git`, the user's index, working tree, `git status`, `git clean`, `git stash`,
`git reset --hard`, `git pull` and the user's own commits never see it, in any repository state
(detached HEAD, no upstream, a merge or rebase in progress, `pull.rebase=true`, a shallow clone).
Every role on a host uses the store of its marker's `project_root` (the original checkout), so the
roles of one checkout share one store and different clones have their own. The store's `origin` is
the project's `origin` (read with `git config --get`); in the project checkout only
`git rev-parse --git-common-dir` and that config read ever run. With no remote the store is local
only and publish reports "no remote". A project directory outside git keeps the records in
`<project>/.delivery/operator/` (local only); records an earlier version left there are copied into
the store the first time. Deleting the store loses only what was not yet published; the published
copy is the `delivery-operator` branch on the remote. Inspect it with `git -C <store> log`.

**Commands** (`scripts/operator.js`; one script, all output machine-readable with `--json`):
- `record --cite in-N --quote "<exact span>" --statement "<what is decided>" --scope bead:ID,...`:
  verifies that the cited input exists, is `human`, that the quote is a substring of its verbatim
  text (whitespace-normalised), and that the recorder is the Chief of Staff or the role whose session
  captured the input; writes the record; appends `DECISION dec-N (operator in-M): <statement>` to
  each scoped bead.
- `delegate --cite in-N --quote ... --scope ... [--until DATE] [--max-uses N]`.
- `decide --under del-N --statement ... --scope ...`: verifies the scope is inside the delegation,
  not expired or revoked, uses remaining; records the chain.
- `revoke --cite in-N --quote ... --target del-N`.
- `ack --input in-N --reason "<why this input is not a decision>"`.
- `verify <id>`: recomputes the chains and prints the path from the record to the verbatim human
  input (quote shown), or fails with the reason. Exit 0 verified, 1 not.
- `show <id>`, `pending` (human inputs with no record or ack).
Read commands (`verify`, `show`, `pending`) are in every role's lane. Write commands are in the
lanes of chief-of-staff, product-manager, delivery-lead, staffing and progress-observer.

**Answering on the operator's behalf.** The Chief of Staff's job is to spare the operator, so it
answers worker questions itself whenever it can prove the basis, and asks the operator only for what
no record settles. An answer is a record too (`ans-<seq>`), citing the decisions, delegations or
earlier answers it applies, with a `confidence`:
- `settled`: every bead, label and initiative the answer touches lies inside the scope of a cited
  record that has not been revoked or superseded, and the cited statement covers the question.
  Workers treat it exactly as the operator's word.
- `inferred`: a judgement that extends a recorded decision or delegation to a new case. Allowed only
  for reversible, low-stakes actions (never money, security, irreversible changes, or new product
  scope), requires a written rationale, and is listed in the next briefing as one line the operator
  can ratify or override. Workers act on it, preferring reversible steps until it is ratified.
- Anything else is not answered by the Chief of Staff: it goes to the operator once, batched in the
  briefing, with options and a recommendation.
Before escalating, the Chief of Staff searches the record (`operator.js find`) for governing
decisions. An override is a new decision that `supersedes` the earlier record; a ratification cites
the operator's input. `verify` walks answer, decision or delegation, to the verbatim human input,
and re-checks scope containment for `settled` answers. Commands added: `answer`, `find`, `ratify`.

**Distributed sessions.** Roles run on several hosts (the operator's PC, SSH hosts, cloud sandboxes)
that share only the private project repository, so every chain file has exactly one writer and git
never merges a chain's content: operator inputs are per host, records are per author instance, ids
embed the owner (`in-<host>-N`, `dec-<instance>-N`). Entries travel on the project remote's
`delivery-operator` branch, which carries operator files only (repository branch rules must allow
pushes to it). `operator.js publish` (after every write) commits the store's new lines, fetches the
branch, merges it (peer files differ by name, so a merge is a union; a chain that grew on both sides
is a fork and is refused), checks before every push that each chain on both sides reaches the result
whole and that the chains being committed verify, and pushes, retrying a rejected push up to five
times. `operator.js refresh` is the same fetch and merge without the push, in the store only; a
verifier that cannot find a cited id refreshes and retries once. Nobody pulls the project checkout for
operator records. An input is as trustworthy as the session environment that captured it and records
its host, session and transcript reference; a session can publish only with push access to the
project remote (cloud and SSH sessions included): without it the records stay committed in its store
and `team-status` and the briefing report them as unpublished. A worker on any host verifies a
decision with the same command and gets the same chain to the verbatim human words.

**The question ledger.** The Chief of Staff logs every question it escalates to the operator
(`operator.js ask`: who asked, about which bead, options, its recommendation). The operator's
answer is linked to it (`--answers q-N`), so `operator.js ledger` and the generated
`operator/LEDGER.md` in the operator store show, for every question: asker, status (open, answered,
withdrawn), the answering record, its confidence and the operator's verbatim words. Any session
can read the ledger and verify any row.

**Enforcement against relaying.**
1. PreToolUse denies the operator channels `AskUserQuestion`, `PushNotification` and `SendUserFile`
   for every role except chief-of-staff and product-manager, with the reason "message the Chief of
   Staff with the one question; the answer comes back as a decision record" (for the two
   notification tools: "the Chief of Staff decides what reaches the operator").
2. The Stop guard of the two operator-facing roles (Chief of Staff and Product Manager) blocks a turn while a human input in its session has neither a
   record nor an ack ("record it, then send the record id to the sessions that need it"), and
   inspects the final assistant message for relay requests (asking the operator or "you" to tell,
   send, forward, paste, relay, confirm or reply to another session, role or "the worker"), blocking
   with "you carry answers; send the record id yourself". The pattern check is a heuristic backstop;
   the structural fix is that nothing else needs the operator to relay.
3. Team rules: a peer message that cites a record id is verified with `operator.js verify` and acted
   on; a peer message that claims an operator decision without a verifiable id is information, and
   the reply is "send the record id", not a question to the operator.

**Trust model and limits.** Capture relies on the harness: peers reach a session only through
SendMessage, whose delivery is wrapped by the harness, so a peer cannot produce an unwrapped
human-looking prompt; unknown wrappers are classified `unknown` and are not citable. A role whose
lane is `any` can still type into another session (keystroke injection through `tmux send-keys`,
computer-use, a terminal MCP server or `osascript`), and that text is recorded as `human`; the
input ownership check (a worker may record only inputs its own session captured) compares a session
id that the session's own Bash can rewrite. Both are cooperative trust, documented, not enforced. Lanes deny
writes to the operator store (`.git/delivery-operator`, and the legacy `.delivery/operator/`) and
writes to its branch for every role, and the hash chains, recorded heads and the store's append-only
merge check make edits detectable, but a hostile session with unrestricted Bash could rewrite and
re-hash the files: this is tamper-evidence for cooperative sessions, not a boundary (same class as
8.5). Inputs contain the operator's own words and live only in the private store and on the private
project repo's `delivery-operator` branch.

**Residual channels for `any` roles.** The channel guard (enforcement 1) names three tools, and
`lane_mcp` is allow-only, so roles whose lane is `any` (builder, spike researcher) keep every other
path to the operator's attention. They are documented here as a residual, not enforced:
- `set_session_title` and `set_unread` on the session-management and sidebar servers, which put
  flags in the operator's UI;
- `send_message` to any session, including one the operator is watching;
- computer-use, browser and Claude Browser tools, which drive the screen the operator sees;
- Bash notifications such as `osascript -e 'display notification'`, `say` and `terminal-notifier`;
- any messaging MCP server the host has configured (Slack, email).
The briefs and rule 12 say workers never address the operator. The recommended later control is an
MCP deny list for `any` lanes, with the channel guard extended to the session-management UI tools.

**Ruling: harness permission prompts.** A permission prompt in a role session can only be cleared by
the human pressing a button, which makes the operator a relay for that session. Mitigation:
`prepare-role` writes the role's in-lane commands as prefix `permissions.allow` rules in the role's
`settings.local.json` (unrestricted `any` lanes get none). The rules depend on the lane hook running
first and refusing what the lane does not allow. Where a role session's marker is present but the
lane cannot be decided (manifest unreadable, an internal exception), the hook fails closed and allows
only restoring the manifest; where no role marker is found the hook is inert, and the allow rules
then let a matching command through without a prompt. A prompt that still appears goes into the Chief of
Staff's next briefing as one batched owner-side line ("approve once in session X, or extend the
lane"); asking the operator to go and approve it is a relay request the Stop guard flags. Residual:
after a plugin-cache version move the operator.js rules name the old path until `prepare-role` runs
again.

**Ruling: prompts from before the role.** A session resumed or adopted into a role directory has
earlier human prompts in its transcript. The first hook that sees a session id in a role directory
(SessionStart, with or without a transcript yet) records that session's boundary in the operator
store's local state (`operator/cursors/role-since/<instance>.json`; the old
`<roleDir>/.delivery-role-since.json` is still read), one entry per session id, never overwritten, written under a
lock and pruned to the newest 32. Inputs dated earlier are stored and citable (`record --cite` works
on request) but carry `pre_role: true` and never appear in `pending` or block a Stop. When a later
hook creates the boundary instead (no SessionStart was seen), nothing captured in that same
invocation is marked pre-role.

**Rulings on parked items.**
- *Rejected pushes and the user's checkout (superseded twice).* The records used to be committed in
  the user's own checkout (`.delivery/operator/`), and every recovery scheme for a rejected push
  (merging upstream, then plumbing commits with the checkout's branch as a parent, then staging peer
  copies into the user's index) still left operator files in the user's index and working tree:
  `git pull` refused in common cases, peer copies leaked into the user's commits, `git clean` or
  `reset --hard` deleted unpublished records, and publish committed onto detached HEADs and
  mid-rebase. Ruling: operator storage moved to the private store described under "Where the records
  live"; nothing operator-related is ever in the user's index or working tree, so these cases do not
  arise. Every write to the store happens under one store lock; a rejected push is fetched, merged
  (append-only, verified) and retried up to five times with 50-250 ms jitter.
- *Lock deadline and stale threshold.* A writer waits at most 2 s for a chain lock, and a lock is
  treated as stale after 10 s; pid liveness is not checked (pids are host-local). A crashed writer's
  fresh lock therefore refuses writes for up to 10 s with a retryable error; hooks fail open.
  Accepted as is.
- *Machine id.* `by.machine` is a hash of the hostname. It tells two machines apart that share one
  instance id, not two clones on one machine (one working copy per host label is assumed), and a
  renamed host needs `operator.js rehost`. It is an identifier, not a secret.
- *`sync --all` and the roster.* `sync --all` reads other instances' transcripts from the roster's
  `transcript_path`, which an `any`-lane session can rewrite to point at a forged file. Residual of
  the keystroke-injection class; the recommended hardening is to accept only paths under the
  harness's own projects directory and to restrict `--all` to the Chief of Staff.
- *Forged or fast-clock chain entries.* A writer never stamps beyond its clock plus ten minutes and
  orders against the previous valid record, and warns (`clock_behind_chain`). Recovery from a chain
  whose last entry is far in the future is a new instance id in team.json (Staffing) or recording
  through the Chief of Staff; the old instance can be retired (`"retired": true`) so its history
  keeps verifying.

## 9. Staffing and routines

### 9.1 Hire

`/delivery:hire`, run by Staffing during onboarding and again on evidence:

1. Reads the product repo: manifests, lockfiles, deploy config, CI, docs, MCP surface.
2. Maps findings to specialists with a stated reason each.
3. Proposes a roster with host placement and model, sized small; builders scaled to ready beads
   within `builders_cap`.
4. Operator approves through the Chief of Staff (first hire) or Staffing applies within budget
   (later changes), commits `team.json`, messages stewards.
5. Re-runs on evidence: new platform in the repo, a role idle for a week, beads bouncing between
   roles, complexity growing in one area. Proposes beyond budget, applies within it, each change
   noted in the briefing.

### 9.2 Routines

Scheduled through the existing routine mechanism, so they run whether or not a session is open.

- Morning briefing (Chief of Staff): reads beads, roster, open PRs, CI; runs reconcile and roster
  drift; one ranked page in merged / deployed / verified with what needs the operator at the top.
- Evening review (Progress Observer): liveness sweep, stale claims released with a note, done beads
  older than the retention window summarised into their epic, denylist regenerated if the plan
  changed.

## 10. Onboarding

Two entry points, one path after the first step.

- New project: `/delivery:init <product-repo> <project-repo>`. Creates the private project repo if
  missing, the `.delivery/` skeleton, an empty manifest with the core roles, the delivery-root
  pointer. Continues into provision.
- Existing project: Staffing hires migration-expert. It proposes the split, moves beads config, plans
  and team rules to the project repo, leaves build and test rules in the product repo with one
  pointer line, generates the first denylist. Continues into provision.

Provision (`/delivery:provision`, bd-host steward):

1. Hosts: record each in `hosts.json` (kind, bd reach, headless, desktop apps, steward); verify each
   SSH host answers.
2. Beads: on the bd host install bd and Dolt if absent, create the shared Dolt server as a systemd
   user unit bound to the tailnet, `bd init` with the prefix, set the Dolt remote to the project
   repo. On hosts that cannot run bd natively, generate the SSH wrapper and actor export. Verify
   `bd ready` from every host.
3. Cloud environment: write the environment definition for the project repo (setup script: install
   bd, clone product repo as sibling, set Dolt remote and actor, install the product's test
   dependencies from its developing docs). Register it.
4. Test lanes. On the check host, create N isolated lanes (own folder and Postgres database each) and a
   lock that refuses a busy lane with a distinct exit code; record lanes in `hosts.json`. Builders are
   assigned a lane in their composed brief, so two sessions never share one.
5. Existing environments are reused, never duplicated: provision detects a cloud environment or Dolt
   server that already serves this project and records it instead of creating a second.
6. Secrets stay with the operator. Provision writes everything except secret values and hands the
   operator one list of what to paste where, through the Chief of Staff; it never reads or moves a
   token itself.
7. Record every step and its check in a provisioning bead.

Then hire (section 9.1), then deploy:

`/delivery:deploy`, from any session on any host: read manifest and roster bead, compute missing per
host; start missing roles on this host with join as first prompt; message other stewards; prepare
cloud join prompts for the operator; wait for the roster bead to show every role live; the Chief of
Staff gives the first briefing.

Then the Product Manager runs the pipeline to the first roadmap, and the Delivery Lead materialises.
The operator says yes at hire and at the first roadmap; the Chief of Staff carries everything else.

## 11. New surface

Skills: `init`, `provision`, `hire`, `join`, `deploy`, `materialise`, `team`. Roles: `roles/`.
Hooks: as in section 8, added to `hooks/hooks.json` (PreToolUse matchers cover Bash, Monitor,
PowerShell, the file tools and MCP tools). Environment written to each role's settings: `DELIVERY_ROLE`,
`DELIVERY_ROLE_ID`, `DELIVERY_HOST`, `DELIVERY_PROJECT_ROOT`, `DELIVERY_ROLE_DIR`, `BEADS_ACTOR`,
`DELIVERY_RUNNER`, `DELIVERY_MODE`, and `BEADS_DIR` when the project has `.beads`. Role file keys:
`lane_writes`, `lane_bash`, `lane_mcp`. Templates: `team.json`, `hosts.json`,
`denylist.txt`, composed `CLAUDE.local.md`, cloud environment definition. Routines: two definitions
under `routines/`. The existing pipeline skills and agents are unchanged except where a core role
brief composes them.

## 12. Phasing

Each phase gets its own implementation plan.

1. Roles, manifest, join, retention hooks, `team` status with roster drift. Proves a session takes
   and keeps a role.
2. Document-to-beads: materialise (incl. spike beads from architecture and roadmap), reconcile
   check, record-honesty hooks, leak hooks and denylist; the builder runner contract (`runner`
   validated as superpowers | attractor | plain, and the builder and spike-researcher briefs
   carrying the per-runner loop).
3. Provision: hosts, beads over Dolt, wrappers, cloud environment, init and migration-expert.
4. Hire, deploy, stewards, routines.

## 13. Testing

- Hook scripts: unit tests beside each script, as `record-invocation.test.js` is today; fixtures for
  allowed and blocked commit messages, bd commands, and tool calls per role and host.
- Join and materialise: run against a scratch pair of repos; assert the role directory contents,
  settings, actor, and the bead graph for a fixture roadmap; idempotency by running twice.
- Reconcile: fixtures with each drift class, assert one bead per class.
- Provision: dry-run mode that prints every command and check; a live test on wintermute by hand,
  recorded in the provisioning bead.
- Hire: fixture repos per platform, assert the proposed roster and reasons.

## 14. Prior art considered

Native Agent Teams (same-host, no resume, no identity beyond spawn prompt), Cortex (markdown task
files with heartbeat, a dispatcher called chief of staff), metaswarm (subagents in one session),
Gas Town (Mayor on beads, Linux and tmux, heavy), TAKT (YAML topology). Lifted: liveness ticks and a
staleness rule, daily briefing and review cadence, pruning, delegate mode. Not lifted: async task
files (beads does it better), native teams.

## 15. Open items

- The exact routine mechanism for the two scheduled runs (cloud routine versus a steward's local
  loop) is decided in phase 4's plan.
- The denylist's false-positive rate is unknown until the Vault's first materialise; the review step
  at materialise is the control.
