# AGENTS.md — delivery

Doctrine for anyone changing this plugin. The repository's root `AGENTS.md` applies as well; this file
adds to it.

## What this plugin is

A team of Claude Code sessions (Chief of Staff, Product Manager, Delivery Manager, builders and the
roles they call) that takes a product owner's intent to shipped, verified software, in their own
project, without the owner relaying messages, approving steps or moving files between sessions.

## The law

The owner's standing rules. They bind every session on this plugin, every subagent, and every
change, and they take precedence over anything else in this file. They were stated many times and
broken many times; the owner must never have to check that they are followed.

**Before any action, check four things. If any answer is no, do not act.**
1. Does it deliver customer value, a shipped and verified increment, or directly unblock one, and
   how much? Value decides, not whether the owner happened to ask for it.
2. Does it connect to the agreed work: a declared sprint deliverable, and a feature on the map
   (`scripts/map.js`) that it serves, with the code it touches known?
3. Has the owner already answered or decided this? (See `.delivery/direction/README.md` and the
   owner's recorded decisions. Never ask again.)
4. Is it the smallest thing that does the job, reusing and extending what exists?

**The rules.**
1. **Customer value is the goal.** Shipping nothing is a failure, worse if resources were used.
   Work is incremental toward the product vision. Useful beats nice-to-have. Always bring up what
   to simplify or retire. Prefer work that later work builds on. Work must earn its place.
2. **Work on what was agreed, nothing else.** Take work from the sprint's declared deliverables and
   the feature trail on the map. Work that connects to neither is not done, however easy: no new
   documents, initiatives, agents, workers or plans in place of delivery. Start no standing
   sessions, ever.
3. **Decide with the feature map, not with guesses.** Keep, change or retire only on the evidence of
   `scripts/map.js` (`impact`, `retire`) with the commit named. Default is keep. Nothing is removed
   without proof it is not needed. There are no customers on old versions, so no backward
   compatibility work.
4. **Sprints are closed rounds.** Deliverables are declared before the sprint starts and fixed.
   New asks are queued for the next sprint. Infrastructure only as a strictly necessary,
   pre-declared step toward a deliverable. One report per sprint.
5. **Verified shipping.** "Done" needs evidence: a receipt and a ledger entry. Say what was run and
   what was only read. Never state as checked what was not run.
6. **Protect the owner's attention and usage.** Short messages, results not reports, no promises,
   no repeated questions. Bring only what only the owner can decide, with a recommendation.
   Spend within a declared bound; idle is a normal state.
7. **Models.** Workers (building, review, checks) use Sonnet. Design and planning, and other highly
   complex work, use Opus or Fable, with the reason recorded. Narrow lookups and low-level file and
   git operations use Haiku.
8. **Never compromise the owner's own setup.** Nothing at user level. No hook gates the stop path,
   kill, settings edits or plugin removal. Hooks fail open. The owner can always stop everything,
   and when told to stop, stop.

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
3. **The right model for the right job.** Every session or subagent an agent starts uses the model
   configured for it, or else the smallest that can do the job. Design and planning, and other highly
   complex work (cross-cutting design, subtle bugs, security-sensitive logic, or a failed lower-tier
   attempt), use Opus or Fable, with the reason recorded. Workers (building, review, checks) use
   Sonnet. Narrow lookups and low-level file and git operations use Haiku. See `.delivery/direction/contracts/spend-and-idle.md`,
   commitment 6. Why: the top tiers spend the owner's usage far faster, and a default that picks them
   for ordinary work is how a month of usage was burned.
4. **Deliver, do not burn.** Work counts when it is merged, versioned and shown running. Idle hours,
   repeated probing and long reports that ship nothing waste the owner's usage. Keep the team moving;
   never leave it stalled without saying so.
5. **Any user, any project, any language.** Never narrow scope to make the work easier (doctrine 1).
6. **Machines set up machines.** Credentials and services are wired by whatever set the machine up;
   where Amplifier is installed, lean on it first. The owner holds no passwords and is never asked for
   one (doctrine 5).
7. **Pull requests open ready, never as drafts.** A pull request is opened for review and merged
   once CI is green and its review is done. Why: drafts only add a step and leave work looking
   unfinished on the owner's list.

## Conventions

- Tests: `scripts/testing/run-tests.js` in this plugin (CI runs the same); it clears the role
  variables a role session carries.
- Every pull request is reviewed independently before it merges (the `pr-reviewer` agent, through the
  Delivery Manager's merge gate, for team work).
