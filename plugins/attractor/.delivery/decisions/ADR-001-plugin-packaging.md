# ADR-001: Author the first plugin.json/marketplace.json pair, one skill not a command

**Status:** accepted
**Date:** 2026-08-05
**Deciders:** Solution Architect, reviewed by Feature Critic

## Context

No `.claude-plugin/` directory exists anywhere in this repository — not for `attractor`, not
for `delivery` (which isn't vendored here at all; it runs from the user's global plugin
cache). FR-1/FR-2 require the first plugin manifest and marketplace catalog this repo has
ever had, with no sibling example to copy. The schema was fetched from Anthropic's live docs
(`code.claude.com/docs/en/plugins-reference`, `.../plugin-marketplaces`), not assumed — every
quoted claim below was independently re-verified word-for-word by an adversarial pass.

## Decision

`plugin.json` sets `name`, `version`, `description`, `author`, `license`, `keywords` — no
`skills`/`commands`/`agents` path fields (the default directory scan finds them), no
`homepage`/`repository` (no git remote exists to cite). `marketplace.json` is created at the
repo root with `name: "ai-augmentation-systems"` (fixed by FR-2's literal acceptance string),
one `plugins[]` entry for `attractor` with `source: "./plugins/attractor"`, and **no
`version` field on the entry itself**. The discoverable surface (FR-2) is a single skill at
`plugins/attractor/skills/attractor/SKILL.md`, frontmatter `name: attractor` set explicitly.

## Alternatives considered

### Duplicate `version` on the marketplace entry, matching plugin.json

**Why it was attractive:** reads as more explicit; matches a naive reading of AGENTS.md's
"explicit semver in both marketplace.json and each plugin.json."
**Why rejected:** the platform docs state plainly — "Avoid setting version in both
plugin.json and the marketplace entry. Claude Code always uses the plugin.json value without
warning, so a stale manifest version can mask a version you set in marketplace.json." AGENTS.md's
rule is satisfied by marketplace.json's own top-level `version` (the catalog file) plus each
plugin's own `version` — not a third, redundant copy that can silently drift and be ignored.

### `commands/attractor.md` instead of a skill

**Why it was attractive:** functionally identical per the platform docs; a coin flip either way.
**Why rejected:** AGENTS.md's porting table already commits this plugin to a second skill,
`skills/attractorify/SKILL.md` (S7, may ship in parallel). Starting with the `skills/`
directory layout now avoids a near-certain, already-documented restructure later.

### A `bin/attractor` PATH executable

**Why it was attractive:** cheap, turns `node dist/attractor.js` into a bare `attractor` command.
**Why rejected:** doesn't itself satisfy "discoverable" — nothing surfaces it in a skill
listing. FR-2's bar is discoverability, not invocation ergonomics. Good candidate for the S7
authoring-skill pass, not this one; building it now would be scope the FR doesn't ask for.

## Consequences

**We gain:** a working, schema-conformant install path with no invented field names, and no
version-masking hazard the platform explicitly warns about.

**We accept:** the manifest pair is unverified against a real `/plugin install` flow until
Spike 3 runs — everything here is schema-conformant by inspection, not yet by execution. We
also accept that AGENTS.md's assumption that `plugin.json` can exclude files from the packaged
plugin (`.delivery/`, `.superpowers/`, `engine/test/`) has no corresponding field in the
fetched schema — Spike 5 tracks confirming this is genuinely a doctrine/platform mismatch
rather than a missed field.

**We will need to revisit this if:** the platform adds a file-exclusion manifest field (Spike
5 would then become "adopt it"), or `delivery` gets vendored into this repo and needs its own
marketplace entry appended (must not reorder or rewrite this one, per AGENTS.md).

> **Correction, 2026-08-06 (real-remote reconciliation):** this ADR assumed no sibling
> plugin.json/marketplace.json existed to copy, because this repository had never been
> connected to its real remote (`github.com/colombod/ai-augmentation-systems`) when it was
> written. The real repository already has both, with `delivery`'s own marketplace entry
> **carrying a per-entry `version: "0.11.0"`** — directly contradicting this ADR's "no version
> field on the entry itself" decision. Consistency with the real, already-shipped sibling
> convention wins over this ADR's platform-docs-derived reasoning: `attractor`'s marketplace
> entry now carries `version: "0.1.0"` too, matching `delivery`'s shape. The version-masking
> risk the platform docs warn about is accepted, same as it already is for `delivery`, rather
> than making `attractor` the one inconsistent entry in the array. `plugin.json` also gained
> `homepage`/`repository` fields (both `https://github.com/colombod/ai-augmentation-systems`),
> matching `delivery`'s `plugin.json` exactly, now that a real remote exists to cite.
