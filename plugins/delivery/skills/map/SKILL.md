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
  at the scripts it runs); a package's command-line entry points (`package.json` `bin`, pyproject
  `[project.scripts]`); and a product's own entry points: web routes (`@app.get(...)`, `@router.post(...)`,
  `app.get('/x', ...)`, one feature per file), MCP tools (`Tool("name", ...)`, `server.tool("name", ...)`),
  serverless functions (`vercel.json` and its `api/` files) and CI workflows (`.github/workflows/*.yml`).
  Test files never count as the product's entry points.
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
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/map.js retire <feature-id>` — what retiring a feature frees: the
  files only it reaches (deletable with it) and the files other features reach too (retire the surface,
  keep the code), with those features named.
- Add `--repo <dir>` for another repository and `--json` for the machine-readable answer.

## Reading the answer

- Each reached feature has its shortest chain, from the feature's file to the changed file, one
  `file:line -> file (rule)` step per hop. Fewer hops is closer to what the user touches.
- **Reached only through a hub**: features that reach the change only through a shared file a fifth or
  more of the features reach (a config, a core library) are counted apart, with the hub named; `--all`
  lists them. Past two hops, features are counted, not listed, unless `--all`.
- **Hub**: a changed file many features reach. A change there reaches most of the product: say so to the
  Delivery Manager, and size and test it as a change to all of them.
- **Unreached**: a changed file no feature reaches. It is dead code, a feature nobody declared, or a
  reference no rule reads. Find out which before calling the change safe.
- **Blind spots**: files of a kind no rule reads (binary, generated, an unsupported language), and
  references the rules do not understand (a path built at run time, dependency injection). The map
  never claims reach through them. When the blind share matters to a decision, say it in the answer.

## Where it is used

- `/delivery:stories` step 3a: every story carries its blast radius before it is ready.
- Retiring a feature (from MJ's Market Fit and Worth Using):
  1. `map.js retire <id>` for what it would free. Exclusive files go with it; shared files stay.
  2. Evidence of non-use comes from the product's own logs, never from the map: the feature's users no
     longer return to it over two checks. No logs means instrument the feature first and decide later.
  3. The decision is the owner's and irreversible: put it to them once, with the retire output and
     the evidence, and record it (`/delivery:decision`). Then a story of kind retire deletes the
     exclusive files and the shared surface, and its blast radius (`impact --story`) is empty of
     features it does not name.
- After a break: `impact --diff <bad commit>^ <bad commit>` shows what the change reached, to check
  whether the map would have predicted it.
