# ADR-026: `CommandChannel` shell-quotes substituted values, diverging deliberately from `tool_command`'s unescaped substitution reuse

**Status:** accepted
**Date:** 2026-08-11
**Deciders:** Solution Architect (original draft), Feature Critic (found the gap this ADR closes)

## Context

The adopted design doc specifies `CommandChannel` substitutes `${...}` tokens into its command
string "exactly like `tool_command` nodes already do" (`human-gate-channels-design.md:143`). An
initial architecture draft took this literally: reuse `core/substitute.ts`'s `substitute()`
unchanged. `core/substitute.ts:43-58` does a single-pass, **unescaped** textual token
replacement — a context value containing `;`, `` ` ``, `$(...)`, `|`, etc. is spliced verbatim
into a string later handed to `spawn('sh', ['-c', command], {cwd})` (`handlers/tool.ts:17`),
executing as shell syntax rather than literal text.

A Feature Critic pass found this reuse crosses a trust boundary `tool_command` never had to
handle. `tool_command=` is a string the graph **author** writes and controls at design time,
substituted with values from nodes in the **same trust domain** they authored — an accepted,
never-separately-security-reviewed but bounded risk. `CommandChannel`'s command string is
**operator-supplied** (`--channel name=command`, explicitly config, not graph), but its
substituted values come from `HumanGateContext.exposedContext` — populated by `human.context=`,
an attribute the PRD and ADR-006 are explicit is meant to expose upstream `Handler.TOOL`/
`Handler.CODERGEN` output (the same self-report scenario HITL-003 exists to police). That value
can be traceable to external, untrusted input — a fetched issue body, a PR diff, LLM-generated
prose — the operator never reviewed. Splicing it unescaped into a shell command the operator DID
write and trust is a new capability this design would introduce: a hostile or careless upstream
context value achieving arbitrary command execution on the machine running the operator's
`--channel` script.

## Decision

`CommandChannel` shell-quotes each substituted value (POSIX single-quote escaping: wrap in `'…'`,
replace any embedded `'` with `'\''`) before splicing it into the command string. The `${...}`
token-replacement mechanism itself (`core/substitute.ts`, unchanged) is still reused; only the
values it produces are escaped before they reach the shell, at the `CommandChannel` call site —
`tool_command`'s own existing behavior is untouched, this divergence is local to the new call
site alone.

## Alternatives considered

### Reuse `substitute()`'s output unescaped, matching `tool_command` exactly, as originally specified

**Why it was attractive:** literal fidelity to the adopted design doc's own wording; avoids
introducing a behavioral difference between two `${...}`-substituting mechanisms that otherwise
look identical to an author.
**Why rejected:** the trust-boundary analysis above — `tool_command`'s existing assumptions
(author-controlled command, same-trust-domain values) don't transfer to an operator-supplied
command receiving pipeline-computed, potentially externally-influenced values. Silent reuse would
ship a real, newly-introduced injection path under the banner of "matching existing behavior."

### Pass `GateContext` fields via environment variables or separate `argv` arguments instead of string interpolation

**Why it was attractive:** avoids shell-string construction entirely — the most robust fix, no
quoting logic to get subtly wrong.
**Why rejected:** would abandon the adopted design's `${...}`-in-command-string authoring UX,
which is the same mental model `tool_command=` already establishes for this codebase's authors —
a bigger, less-precedented change than the finding requires. Shell-quoting closes the injection
path while keeping that UX, at the cost of one well-understood escaping function rather than a
new configuration surface (env var naming, argv-position conventions) this design doesn't
otherwise need.

## Consequences

**We gain:** `CommandChannel` can safely receive pipeline-computed `human.context=` values without
those values gaining shell-execution power over the operator's script, regardless of the
content's ultimate origin.

**We accept:** `CommandChannel`'s substitution behavior now genuinely differs from `tool_command`'s
in one specific way (values are quoted, not raw) — an author or operator debugging a `--channel`
script that expects to receive an unquoted value (e.g. relying on word-splitting a
space-separated list) will see different behavior than a `tool_command` node would produce from
the same context. Documented in the `--channel` flag's own help text and any `CommandChannel`
authoring reference material, not left to be discovered by surprise.

**We will need to revisit this if:** `tool_command`'s own unescaped reuse is itself reconsidered
as a security gap in a future pass — at that point the two mechanisms' quoting behavior should be
reconciled explicitly, not left to diverge further by accident.
