---
description: Removed — the glossary is no longer a separate skill. Every pipeline skill keeps .delivery/glossary.md through the Language section of the plugin's references/conventions.md. This alias is kept for one version.
disable-model-invocation: true
argument-hint: "[term-optional]"
---

Removed: the glossary is kept by every pipeline skill. Read the **Language** section of `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (if `${CLAUDE_PLUGIN_ROOT}` is empty, use the `installPath` of `delivery@ai-augmentation-systems` from `~/.claude/plugins/installed_plugins.json`) and follow it; the file is `.delivery/glossary.md`, written from `${CLAUDE_PLUGIN_ROOT}/templates/glossary.md`.
