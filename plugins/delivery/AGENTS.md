# AGENTS.md — delivery

Doctrine for anyone changing this plugin. The repository's root `AGENTS.md` applies as well; this file
adds to it.

## What this plugin is

A team of Claude Code sessions (Chief of Staff, Product Manager, Delivery Manager, builders and the
roles they call) that takes a product owner's intent to shipped, verified software, in their own
project, without the owner relaying messages, approving steps or moving files between sessions.

## Doctrine that is not traded away

1. **Any user, any project, any topology.** The plugin is for every customer: a product in any
   language and build system, with its sessions on one machine, several machines, or Claude Code's
   cloud. Nothing in the plugin may assume one language, one runner, one package manager, one host or
   one owner's setup. Where the plugin needs a fact about the product (how to run its tests, where it
   deploys), it reads the product's own files or asks the owner once for one line in `team.json`, and
   says at setup which it found. A table that detects common toolchains is fine; a list that limits
   what is supported is not: the owner's one line always overrides it. A design that works only for
   this repository, one owner's product or one machine is a defect, whatever its tests say. Check
   every change against this before it ships: which customer, project or topology would it fail for?

   It was broken once by a reviewer lane that ran only node, npm, make and pytest; a product in
   .NET, Java, Go or Rust could not be reviewed. The fix runs the project's own test command
   (`review-run.js`, `scripts/lib/test-command.js`).

   Known gap against this rule: pull requests, reviews and the merge gate work through GitHub (`gh`,
   `product_github`). A product on another forge (a self-hosted Gitea, GitLab) is not supported yet.

2. **The owner is never the messenger.** Roles reach each other through the plugin (messages, the
   inbox, the watchdog); a step that needs the owner to carry a message, approve a routine action or
   start a session is a defect in the plugin (team rule 0).

3. **The owner decides the product, the team decides the implementation.** Requirements, scope and
   who the product is for are the owner's; they come in through the Chief of Staff and the
   Product Manager and are recorded. Implementation choices are the team's and are not put to the
   owner. A change that narrows what the owner asked for (fewer users, languages, hosts) is not an
   implementation choice.

4. **Run the thing.** A feature is shipped when it is merged, released at an explicit version and
   shown working on a real project, not when its tests pass.
5. **Lean on what owns the machine; no agent improvises administration.** Where Microsoft
   Amplifier is installed, it owns that machine's own setup (amplifier-work-tracker, its Dolt
   server and the logins they use): a session hands a host problem to one `amplifier run` call
   first (`skills/amplifier`). Credentials and services are wired by whatever set the machine up,
   never by an agent at run time: no agent reads a credential file, and the owner is never asked
   for a password (owner ruling 2026-10-28, after a session on Wintermute was refused editing the
   work-tracker's service and reading its credential file).

## How the owner works with agents (standing preferences, with the reason for each)

These are the owner's choices, stated more than once and broken more than once. Every session on this
plugin, and every session it starts, follows them without being reminded.

1. **Act, do not explain.** When the owner asks for something, do it and report the result. An
   explanation in place of the action is a failure, not a reply. Why: the owner's time goes to product
   decisions, not to reading why something was not done.
2. **The owner does not do the agents' work.** Never hand the owner a command to run, a file to edit,
   a message to relay or a setting to change when an agent or the plugin can do it. When Claude Code
   truly reserves a step for a person, say so once, in one line, and carry on with everything else.
   Why: the plugin exists so a team ships without the owner driving it.
3. **Opus by default; never Fable.** Every session or subagent an agent starts names its model, and
   that model is Opus (Sonnet where a role's brief says so). Never Fable. Why: Fable spends the
   owner's usage far faster, and the owner set Opus as the default on their machines.
4. **Deliver, do not burn.** Work counts when it is merged, versioned and shown running. Idle hours,
   repeated probing and long reports that ship nothing waste the owner's usage. Keep the team moving;
   never leave it stalled without saying so.
5. **Any user, any project, any language.** Never narrow scope to make the work easier (doctrine 1).
6. **Machines set up machines.** Credentials and services are wired by whatever set the machine up;
   where Amplifier is installed, lean on it first. The owner holds no passwords and is never asked for
   one (doctrine 5).

## Conventions

- Tests: `scripts/testing/run-tests.js` in this plugin (CI runs the same); it clears the role
  variables a role session carries.
- Every pull request is reviewed independently before it merges (the `pr-reviewer` agent, through the
  Delivery Manager's merge gate, for team work).
