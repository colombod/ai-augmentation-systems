---
name: attractor
description: Run, lint, and check preflight for attractor DOT-graph pipelines -- nodes are computation, edges are dispatch, LLM nodes run as claude -p subprocesses. Use when the user wants to author, validate, or execute an attractor pipeline (.dot file).
---

# attractor

DOT-graph pipeline orchestration. A `.dot` file is a program: nodes are
computation, edges are dispatch. See `README.md` in this plugin for the full
node-shape reference and example pipelines.

Invoke the CLI via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/attractor.js" <command> [args]
```

## Commands

- `lint <file.dot>` — validate a pipeline without running it. Always do this
  before `run`.
- `run <file.dot> [--param key=value]... [--cwd dir] [--run-dir dir] [--stub]
  [--model name] [--max-budget-usd n] [--allow-tools tool,tool,...]
  [--worktree] [--in-place]` — execute a pipeline.
- `doctor` — check the local machine has what a run needs (`claude`, `git`,
  `sh`; optionally `bun`, `dot`).

Run `doctor` first if unsure whether the environment is ready. Always `lint`
a graph before `run`ning it — a lint ERROR means the run will refuse to start.
