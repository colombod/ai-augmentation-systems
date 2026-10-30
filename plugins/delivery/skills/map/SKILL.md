---
description: The feature map. Before code, show what a product ships (its features, derived from the code and declared by the team) and what a change reaches from the feature's point of view — the blast radius of a story, a list of files or a commit range, with the chain of files and file:line evidence for every step, the hubs it touches and what the map cannot see. Use when writing or sizing a story, before a refactor or a removal, when a change broke something unexpected, or when asked "what does this touch".
argument-hint: "[features | impact <paths> | impact --story <file> | impact --diff <base> [<head>] | blind]"
---

# The feature map

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

The owner's ask: "a feature to code map helping understanding blast radius from feature point of
view before hitting the code". Every answer comes from `scripts/map.js`, read from git at one
40-hex commit, and names that commit. Quote it; never restate a reach from memory.

## What a feature is

- **Derived**: a Claude Code plugin's skills, agents, commands, role briefs and each hook event (anchored
  at the scripts it runs); a package's command-line entry points (`package.json` `bin`).
- **Declared**: what the team names in `.delivery/features.json`, for any project in any language:
  `{"features": [{"id": "checkout", "name": "Checkout", "anchors": ["src/checkout/**", "api/pay.py"]}]}`.
  An anchor is the file a user's path starts from. One that matches nothing is listed as dangling.

If `features` lists no declared features for a product whose users do not start from a plugin or a
bin, declare them first: a map with no features reaches nothing. The Product Manager owns the
register, because naming what the product ships is a product decision.

## Commands

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js features [--at <ref>]` — every feature and its anchors.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js impact <path>...` — what changing these files reaches.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js impact --story <story file>` — the paths in the story's
  "Files and modules" table. New files are listed as not in the commit: they reach nothing yet.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js impact --diff <base> [<head>]` — a commit range, mapped at
  the base it lands on. Use it on a pull request, or to replay a past break.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js blind` — the files no rule reads, by kind.
- Add `--repo <dir>` for another repository and `--json` for the machine-readable answer.

## Reading the answer

- Each reached feature has its shortest chain, from the feature's file to the changed file, one
  `file:line -> file (rule)` step per hop. Fewer hops is closer to what the user touches.
- **Hub**: a file most features reach. A change there reaches most of the product: say so to the
  Delivery Manager, and size and test it as a change to all of them.
- **Unreached**: a changed file no feature reaches. It is dead code, a feature nobody declared, or a
  reference no rule reads. Find out which before calling the change safe.
- **Blind spots**: files of a kind no rule reads (binary, generated, an unsupported language), and
  references the rules do not understand (a path built at run time, dependency injection). The map
  never claims reach through them. When the blind share matters to a decision, say it in the answer.

## Where it is used

- `/delivery:stories` step 3a: every story carries its blast radius before it is ready.
- Before a removal: a feature's exclusive files can go; files other features reach mean retire the
  surface and keep the code.
- After a break: `impact --diff <bad commit>^ <bad commit>` shows what the change reached, to check
  whether the map would have predicted it.
