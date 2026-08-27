# ADR-015: Per-artifact-version provenance via observed artifact writes

Status: accepted · 2026-08-27 · context-management gy5.3 (spike-mode design ADR per brief r2)

## Context

Skill/Agent ledger lines prove a phase ran but not which artifact version it produced —
F-6's cross-initiative false positive (initiative A's real `delivery:prd` line lets
initiative B's narrated prd.md pass as Invoked) and its silent-healing variant. The
operator ruled provenance must be per-artifact-**version** (OQ-3, 2026-08-27). The
challenge fixed four design inputs (R-cm-2/4/7/8): a version unit for marker-less
artifacts, edit-after-invocation semantics (OQ-6), `tool_use_id` as cross-ledger call
identity, F-13 merge semantics, and an exoneration path for the blackout artifacts.

## Decision

**Observe the writes, not just the invocations.** The hook now also matches `Write`,
`Edit` and `NotebookEdit` (PostToolUse only) and, when the written file lies inside a
`.delivery/` tree, appends an `artifact_write` record: root-relative `artifact` path,
`content_hash` (sha256 of the file on disk after the successful write), session, ts,
`tool_use_id`, cwd.

Consequences of the shape, each deliberate:

- **No cwd ambiguity exists for this class.** The artifact's own path picks its root by
  upward walk — initiative binding falls out of the path (`initiatives/<slug>/…`,
  `stories/<slug>-…`). The ambiguous-record machinery (ADR-014) never applies here.
- **The version unit is the content hash at write time** — R-cm-2's rule, now mechanical.
  ADR-005 markers, where they ever land, are prose conveniences; the hash is the identity.
- **OQ-6 is answered:** an in-session edit appends a new version line (provenance follows
  the edit); an out-of-session hand edit leaves the file's current hash matching no line,
  which `/delivery:status` reports as **modified after last observed write** — a precise
  state, not a hole.
- **Exclusions:** writes outside `.delivery/` (not governed), writes into `invocations/`
  itself (the ledger must not observe itself), failure events (no version changed). Only
  `file_path` is read from `tool_input`; the hash comes from disk — the no-raw-input
  whitelist holds.

**Status join rule:** an artifact is **Invoked** at version level when an
`artifact_write` line matches its exact root-relative path; current-hash equality makes
it version-traceable; Skill/Agent lines remain phase-level evidence. `tool_use_id`
deduplicates across ledgers (ADR-014).

**Backfill:** a `record_type: "backfill"` line, `attribution: "backfilled"`, carrying an
`evidence` citation, may be written only for artifacts a diagnosis has exonerated —
gy5.1's transcript proof for session `5b97831e` is the first and template case: hashes
computed from the git blobs at the blackout's final commit (`00fe6a7`), evidence naming
the transcript and the bead. Status reports these as **Invoked (backfilled)** — never
plain Invoked. Fabricating a backfill without cited evidence is the ledger's one
prohibited write.

## Consequences

- Ledger volume grows (one line per artifact write); NDJSON append-only with the union
  merge driver (ADR-014) absorbs it; F-13's remaining semantics stay a named constraint.
- Legacy artifacts with no `artifact_write` line stay at phase-level provenance until
  next touched — acceptable decay path, no migration needed.
- A future `.delivery/` write made by a non-observed tool (raw shell redirection) leaves
  no line and shows up as modified-after-observation — which is the correct reading.
