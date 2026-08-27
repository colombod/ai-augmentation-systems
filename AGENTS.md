# AGENTS.md — ai-augmentation-systems

Repository-level guidance. **This file binds every plugin in this marketplace.**
Plugin-specific doctrine lives in `plugins/<name>/AGENTS.md` and adds to this, never
replaces it.

Read this file, then the AGENTS.md of the plugin you are working on.

## What this repository is

A private Claude Code **plugin marketplace**. Each plugin is a self-contained capability
installed via `/plugin install <name>@ai-augmentation-systems`.

```
.claude-plugin/marketplace.json     one entry per plugin, appended never rewritten
plugins/<name>/
  .claude-plugin/plugin.json        explicit semver
  AGENTS.md                         plugin-specific doctrine
  agents/  skills/  commands/       the plugin's Claude Code surface
  README.md
  .superpowers/                     durable engineering record: plans, specs,
                                     the spec-conformance audit. Hidden, TRACKED
                                     (not gitignored -- this is the opposite of
                                     the ephemeral SDD scratch workspace, see below).
  .delivery/                        durable product-pipeline record: brief,
                                     research, personas/, reviews/. Hidden, TRACKED.
```

**Both are internal engineering record, not shipped product surface.** They exist so a
future session (or a different plugin's engineer) can find the decision trail without it
being mistaken for repo-wide documentation or for something an end user installs. Neither
is on any packaging manifest; whoever builds a plugin's `.claude-plugin/plugin.json` file
list must not include them.

**Do not confuse `plugins/<name>/.superpowers/` (tracked, durable) with the repo-root
`.superpowers/` (gitignored, ephemeral SDD scratch — briefs, task reports, review
packages, deleted per plan).** Same name, different directory level, opposite git status,
by design: `.gitignore`'s rule is anchored (`/.superpowers/`) specifically so it matches
only the root scratch directory and never a plugin's own durable one.

A plugin's `docs/` folder does not exist at the repository root — a root-level `docs/`
would belong to no single plugin and has already been found, once, holding content that
was 100% about one (`attractor`'s spec-conformance audit and product-pipeline artifacts,
moved into `plugins/attractor/.superpowers/` and `plugins/attractor/.delivery/`
respectively). If a repository-wide document is ever genuinely needed — spanning more
than one plugin — it belongs at the root, outside every `plugins/<name>/` directory, and
should say explicitly why it isn't plugin-scoped.

**A shell glob using `*` silently skips both directories — confirmed, not assumed:**
`plugins/attractor/*.md` lists `AGENTS.md` and `README.md` only; nothing under
`.superpowers/` or `.delivery/` appears, with no error and no warning. `find`, `grep -r`
and `git ls-files` all descend into them correctly — only the bare-`*` shell glob (bash's
default, no `dotglob`) excludes them. **Do not conclude a plugin has no plans, no audit
trail, or no product-pipeline artifacts from a glob listing alone.** Use `find
plugins/<name> -iname '*.md'`, or read this file and the plugin's own `AGENTS.md`, which
name the exact paths. This is precisely why the standing rule is "read `AGENTS.md`
first, before browsing" — an agent that follows it finds these paths explicitly stated;
one that doesn't is already violating the project's most emphasized instruction, and a
missed hidden directory is a symptom of that, not a separate failure.

Current and planned plugins:

| Plugin | What it does |
|---|---|
| `delivery` | Intent-to-implementation pipeline: personas, PRD, architecture, sprints |
| `attractor` | DOT-graph convergence orchestration with `claude -p` workers |

### Working in a shared repository

More than one session may be working here at once. Therefore:

- **Land plugin work on a branch**, never directly on `main`.
- **`marketplace.json` is shared.** Touch it with a single appended array entry. Never
  rewrite the file, never reorder existing entries.
- A plugin owns everything under `plugins/<name>/` and nothing outside it, except that
  one appended marketplace entry.
- **Before starting implementation on a tracked requirement or roadmap item, check
  whether another session already has.** `git branch -a` / `git worktree list` for a
  branch already named after it, `gh pr list --state all --search "<id>"` and
  `gh issue list --search "<id>"` for a PR or issue already touching it. This is not
  optional diligence — it is the check that was missing when `attractor`'s FR-17b got
  implemented twice, independently, by two sessions with no shared coordination: a
  multi-sprint effort with a full `.delivery/` decision trail, and a one-commit PR built
  from a `main` that predated that trail entirely and never saw any of it. Neither
  session did anything wrong in isolation — nothing forced either to check first. See
  `colombod/ai-augmentation-systems#28` and `#29` for the full account. Finding the
  collision after both sides are built costs a reconciliation; finding it before either
  starts costs one `git branch -a`.

## Conventions that bind every plugin

### When a plugin implements a specification, read the specification FIRST

Before reasoning about what the code *should* do, before asking, and before writing
anything — open the spec and read the relevant section. Quote it when you record what
you found. If two sections disagree, that is an ambiguity to record, not a licence to
pick the one you prefer.

This is the rule with the worst track record when skipped. It has cost this repository
real work twice, both times because a plausible reading was asserted instead of
checked. The attractor plugin keeps the specifics and the fetch command in
`plugins/attractor/AGENTS.md`; any future plugin that implements a published spec
inherits the same obligation.

### Versioning and packaging

- **Explicit semver** in both `marketplace.json` and each `plugin.json`. Bump on every
  user-visible change; commit-SHA versioning is not used here.
- A plugin that ships compiled code commits its build output (for example
  `plugins/attractor/dist/`) so installation needs no build step. `dist/` is deliberately
  **not** git-ignored. Rebuild whenever source changes.
- MIT, © 2026 Diego Colombo. Ported material keeps its upstream attribution in a per-file
  header and in `NOTICE`.

### Style

- No emoji in source, tests, commit messages, documentation, or CLI output.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Explain **why** in comments and commit bodies. What the code does is readable; why it
  is shaped that way is not.

### Environment facts that bind every task here

- This machine's npm registry is a corporate proxy and **`registry.npmjs.org` is
  unreachable**. Lockfiles generated here record internal registry URLs that break
  installs elsewhere, so they are git-ignored. **Never run `npm install`** expecting the
  public registry.
- `bun` is not installed. Anything needing it (the Discord channel plugin, for instance)
  must degrade gracefully and be reported by a doctor-style preflight.
- System Graphviz is present here but must not be assumed elsewhere.
- Shell tooling is POSIX. On Windows that means Git Bash or WSL.

## How work is reviewed here, and why

These rules were not adopted in advance. They are what roughly 35 findings across two
plans actually taught us. **Every one of those findings was a defect in a plan document,
not in an implementer's transcription.** Four were caught by implementers themselves. The
most serious — a cleanup path that deleted a real repository, and one that silently
destroyed a run's output while reporting success — were found by reviewers who *ran the
code* rather than reading it.

1. **Treat a plan's reference code as the least-trusted artifact**, not the specification
   of record. If the brief contradicts what the code demonstrably does, report it — do
   not adjust the test until it passes.
2. **Verify a fix actually fixes.** Transcribing a directed fix and declaring victory has
   twice shipped a fix that did not work. Reproduce the original bug against the new code.
3. **Mutation-check every new test.** Break the behaviour, confirm the test fails,
   restore. A test that passes with its feature deleted is worse than no test — this
   project has shipped twelve of them.
4. **When a guard both permits and forbids, test both directions.** The recurring failure
   is a refusal path covered and its success path unverified.
5. **Clearing a risk needs the same evidence standard as raising one.** "This constructor
   does no I/O" was a claim about unread code; it was false and leaked a git checkout.
6. **Run the thing.** The worst bug in this project passed eight task reviews and a
   whole-branch review, and was found by executing a real pipeline and looking at the
   artifact rather than the exit code.

## Upstream we are building on

Two upstream projects matter, and the relationship to each is deliberate.

- **[`strongdm/attractor`](https://github.com/strongdm/attractor)** (Apache-2.0) — the
  canonical **specification**. Authoritative for anything it defines.
- **[`microsoft/amplifier-bundle-attractor`](https://github.com/microsoft/amplifier-bundle-attractor)**
  (MIT) — the only maintained implementation, and more importantly the source of the
  **doctrine**: an `attractor-expert` agent, an `/attractorify` design skill, reference
  context files, and a corpus of example pipelines. That material is written from live
  post-mortems and is not reproducible from the spec.

**We implement the spec natively and port the doctrine.** We do not depend on Amplifier.

The porting rule, which applies to any plugin adopting upstream material: **doctrine
ports, engine-coupled documentation is rewritten.** The upstream expert agent states that
engine runtime semantics are its source of truth and that reasoning from the spec alone
makes you confidently wrong about the running engine. Ported verbatim it would describe
Amplifier's engine. Design principles, patterns and post-mortems port near-verbatim;
anything describing how an engine actually behaves is rewritten from our tests.

## Adding a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` at explicit semver.
2. Write `plugins/<name>/AGENTS.md` covering: what the plugin is, what upstream it
   adheres to and how, any doctrine it will not trade away, and its own conventions.
3. Append one entry to `.claude-plugin/marketplace.json`.
4. Everything in this file already applies. Do not restate it — link to it.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
