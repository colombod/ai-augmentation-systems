# ai-augmentation-systems

A private Claude Code plugin marketplace for AI augmentation systems — role personas
and phase-gated workflows that carry work from a feature idea through to delivered code.

## Install

```bash
# In Claude Code
/plugin marketplace add colombod/ai-augmentation-systems
/plugin install delivery@ai-augmentation-systems
```

The repository is private, so `/plugin marketplace add` clones over your existing
git credentials. Anyone installing needs read access to this repo and a working
`gh` or SSH setup.

To enable it automatically for everyone working in a given project, commit this
to that project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "ai-augmentation-systems": {
      "source": { "source": "github", "repo": "colombod/ai-augmentation-systems" }
    }
  },
  "enabledPlugins": {
    "delivery@ai-augmentation-systems": true
  }
}
```

## Plugins

| Plugin | What it does |
| :-- | :-- |
| [`delivery`](plugins/delivery) | Product Owner, Program Manager, Business Analyst, Solution Architect, Delivery Lead, QA Strategist and an adversarial Feature Critic, wired into a five-phase pipeline: brief → PRD → architecture → roadmap → stories → implementation. |
| [`claim-guard`](plugins/claim-guard) | Adversarial claim-verification gate for changesets: harvests explicit and implicit claims, fans 7 lens agents out cold to refute each against the shipped source, and gates merge with a deterministic BLOCK / PASS / INDETERMINATE verdict from a bundled `claim_ledger` MCP tool. |

## Repository layout

```
.claude-plugin/marketplace.json   registry Claude Code reads
plugins/<name>/
  .claude-plugin/plugin.json      plugin manifest
  agents/                         persona subagent definitions
  skills/<name>/SKILL.md          slash commands / workflow phases
  templates/                      artifact templates
```

## Versioning

The marketplace and its plugins version **independently**.

- `.claude-plugin/marketplace.json` → `version` describes the **registry** — bump when the
  set of plugins or the registry's own shape changes, not when a plugin changes.
- `plugins/<name>/.claude-plugin/plugin.json` → `version` describes **that plugin**. This is
  the one that decides whether installed copies pick up your changes.
- The `version` mirrored in the registry's `plugins[]` entry should match the plugin's own.

Bumping both in lockstep works with one plugin and stops meaning anything with two.

## Adding a plugin

1. Create `plugins/<name>/` with a `.claude-plugin/plugin.json` manifest.
2. Add `agents/`, `skills/`, `hooks/` at the **plugin root** — never inside
   `.claude-plugin/`, which holds only the manifest.
3. Register it in the `plugins` array of `.claude-plugin/marketplace.json`, with
   `"source": "./plugins/<name>"` — the explicit relative path, which is what the
   validator accepts.
4. Validate and test before pushing:

```bash
claude plugin validate ./plugins/<name>
claude --plugin-dir ./plugins/<name>
```

Bump the plugin's `version` when you want installed copies to pick up changes —
without an explicit version, every commit counts as a new one.

## License

MIT — see [LICENSE](LICENSE).
