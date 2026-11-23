# delivery

Delivery takes an idea to a shipped, verified product in small, closed steps. You state an intent; it turns it into a brief, a PRD, an architecture, a roadmap and stories; work is done in sprints whose deliverables are fixed up front; and "done" has to be backed by evidence, not by an agent's say-so.

## Install

```
/plugin marketplace add colombod/ai-augmentation-systems
/plugin install delivery@ai-augmentation-systems
```

You need Claude Code, Node 18 or later, and git. The repository is private, so the marketplace step clones with your existing git credentials. The plugin registers no hooks that can block anything, writes nothing into your Claude settings, and starts no background sessions.

## Quick start

Run these in your project folder, in an interactive Claude Code session, in order. `<name>` is a short name you choose for the work; use the same one in every step. Each step writes under `.delivery/initiatives/<name>/` and checks the one before it. The skills ask you questions; in a headless run, unanswered questions become items marked "assumed".

1. `/delivery:brief <your intent>` writes `brief.md`: the problem, who has it, what is known and unknown.
2. `/delivery:prd <name>` writes `prd.md` (scenarios, numbered requirements, acceptance criteria), `prioritization.md` (an MVP and later stages) and `storyboard.md`, marked **NOT APPROVED**.
3. **Approve the storyboard in your own words.** The plugin quotes your message into the storyboard. It never writes an approval for you. The roadmap, stories and sprints wait for it; architecture does not.
4. `/delivery:architecture <name>` writes `architecture.md`.
5. `/delivery:roadmap <name>`, then `/delivery:stories <name>`.
6. `/delivery:sprint`, build, then `/delivery:sprint-review`.
7. `/delivery:status <name>` at any time: a read-only report of the gates, open findings and what is traceable. It runs two small checking scripts and may ask your approval to run them.

Other skills: `research`, `personas`, `simulate`, `design`, `challenge` (an adversarial review of any document), `decision`, `realign`, `handoff`, `glossary`. Each one gates on the artifacts before it and tells you what is missing.

## What has been verified

Run for real on 2026-11-23, on one small intent, in headless Claude Code: `brief`, `prd` (with staging, prioritization and storyboard), `architecture` and `status`. They produced the files above and `status` found real inconsistencies in them.

Not yet run end to end: `roadmap`, `stories`, `sprint`, `sprint-review`, `realign`. Treat them as documented, not proven.

Cost, measured on that run (Opus, a small intent): about $2 for the brief, $2.50 to $3 for the PRD and storyboard, $2 for the architecture, $0.35 for `status`. Each step runs several reviewers in parallel. A fresh Sonnet session that followed this README on a second small intent and skipped the optional reviewers did the brief, PRD, storyboard and status for $0.74.

## Verified shipping

Set `DELIVERY_LEDGER=1` before starting Claude Code. The plugin then records each skill and agent call and each file written under `.delivery/` to `.delivery/invocations/`. The recorder only observes: it prints nothing, always exits 0, and writes nothing without the variable. `/delivery:status` reads the ledger to say which documents were produced by real skill calls and which were not. In a fresh-project test it recorded the PRD and status skill calls, three reviewer agent calls and four file writes, and `status` used them to say the PRD files came from real writes. The brief's own skill call and its finder agents were not in the ledger, and why is not yet confirmed.

## Feature map

Know what a change reaches before you touch code, and what removing a feature would free.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js features
node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js impact <path>...
node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js retire <feature-id>
node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js blind
```

Declare what your product ships in `.delivery/features.json` (`{"features": [{"id", "name", "anchors": [...]}]}`); without declared features the map reaches nothing. Each answer names the commit it was computed at. It reports what a feature reaches, not whether anyone uses it.

## How it works

- **Closed sprints.** Deliverables are declared before the sprint starts and fixed; new asks are queued for the next one. One report per sprint: what was promised, shipped, spent and left out.
- **Your attention is a budget.** You are asked only what only you can decide, with a recommendation.
- **The right model for each job.** Workers use Sonnet; design and planning use Opus; low-level file and git work uses Haiku.
- **Useful beats nice-to-have.** Every plan proposes what to simplify or retire.

The reasoning and the contracts behind these are in [.delivery/direction](.delivery/direction/VISION.md).

## Not part of the supported product

The standing team of role sessions (Chief of Staff, builders, watchdog, host manager) is not supported and nothing in this README depends on it. Its README is kept at [docs/team-runtime-readme.md](docs/team-runtime-readme.md) until the feature map shows its code can go.

## Reference

[docs/reference.md](docs/reference.md) describes every skill in detail. Parts of it still describe the team and are not verified for this release.
