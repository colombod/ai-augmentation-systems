# ADR-018: Extract Python and workflow edges with lexical line scanners; declare the rest blind

**Status:** accepted in practice (built as line scanners in `lib/codemap.js`)

> **Against what shipped (2026-10-30, delivery 0.39.0 to 0.41.2, #91 to #97):** Python imports, workflow `run:` lines and other references are read by lexical scanners in `lib/codemap.js` (#91, #97), and files no rule reads are listed by `map.js blind`, as this ADR proposed. Spike 3's precision audit (50 edges per rule) was not run; the Vault replay of eight merges (#97, #100) is the evidence so far.
**Date:** 2026-10-24
**Deciders:** Solution Architect (`initiatives/feature-map/architecture.md`); Delivery Manager through spike 3

## Context

The map must inventory a multi-language product: the Vault (`colombod-personal/the-vault`, read at
`b1ca9eb`) is 354 Python files, 15 GitHub Actions workflows, JavaScript for the web, two assistant
plugins, and a second repository pinned in `requirements-vcs.txt` (brownfield brief B7). tree-sitter
cannot be installed (npm unreachable). The PRD rules out "our own language parser". The binding constraint forbids guessing: what the extractor cannot see is
listed, never filled in.

Measured with a throwaway scanner (not shipped) on the Vault at `b1ca9eb`: 3,344 imported names on
import lines; 1,205 resolve to repository files, 53 to the pinned toolkit, 2,086 are external;
relative imports 329 of 329; no internal-looking name unresolved; 12 dynamic imports (9 literal, 3
computed); 4 import-shaped lines inside strings correctly skipped. Workflows: 191 run lines;
`python -m` 21 (17 resolve to `jobs/`, 4 are `pytest`); scripts 6 of 6; requirement files 23 of 23;
0 YAML anchors. Read 90 ms, extraction 237 ms.

## Decision

- **Python:** a line scanner that tracks string and comment state (triple quotes across lines,
  backslash continuation, parenthesised import lists, whose module is on the first line). Rules:
  absolute, from-, relative imports; literal `importlib.import_module` and `__import__`. Source
  roots from `pyproject.toml` (hatch `packages`, pytest `pythonpath`, `src/` layout) read by a TOML
  subset reader (tables, string and string-array values). Imports of a pinned repository's package
  become cross-repository edges at the pinned commit.
- **Workflows:** a line scanner over the GitHub Actions subset, using indentation for block
  scalars: triggers under `on:` make each workflow an entry point; commands in `run:`
  (`python -m`, `python <path>`, `-r <file>`, `node <path>`) and local `uses: ./` make edges;
  external actions are pinned external nodes.
- **Declared blind spots, each a row with its line:** computed dynamic imports,
  `spec_from_file_location`, `sys.path` edits, TOML lines the subset reader does not understand,
  YAML anchors and aliases, flow-style steps, `${{ }}` or a shell variable in a path or module
  position, reusable workflows from other repositories, URL contracts (an `.mcp.json` calling a
  deployed URL) and tool names called from prose. The last two can be linked only by a declared
  fact.
- Every rule has an id and version in the registry, and a mutation test (PRD FR-44).

## Alternatives considered

### tree-sitter or another parser package

**Why it was attractive:** exact syntax trees for many languages. **Why rejected:** not installable
here; the PRD puts a parser out of scope.

### Run the product's own Python (`python3 -c "import ast"`) over each blob

**Why it was attractive:** a real parser, already on most hosts. **Why rejected:** a second runtime
the plugin does not control, whose version varies by host; and the measured scanner
already resolved every internal import, so the parser buys little until spike 3 says otherwise.

### Treat Python and YAML as blind files

**Why it was attractive:** no new rules. **Why rejected:** 354 of the Vault's 651 text files would be
blind; the product's main component would have no map.

## Consequences

**We gain:** a map of the Vault's application, jobs and workflows, with line evidence.

**We accept:** a scanner is not a parser: a syntax the subset misses is a false absence unless it
lands in a blind row; rates rest on one repository until spike 3.

**We will need to revisit this if:** spike 3's audit puts any rule's precision below 90%; a product
uses Python packaging the TOML subset cannot read; or a parser becomes installable.
