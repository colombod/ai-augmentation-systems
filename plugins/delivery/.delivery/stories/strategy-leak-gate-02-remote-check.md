---
id: strategy-leak-gate-02
title: Check pull requests on the product remote against a public-safe fingerprint
status: ready
epic: strategy-leak-gate
supersedes: []
superseded_by: []
superseded_reason:
phase: Release 2
requirements: [FR-9]
depends_on: [strategy-leak-gate-01]
size: S
---

# Check pull requests on the product remote against a public-safe fingerprint

## Goal

What gets past a session (a web edit, another tool, a session without the plugin) is caught on the product
remote before merge, without the plan ever being in the public repository (prd.md S-4, FR-9).

## Context

The session gate (story -01) keeps its fingerprint in the private project: salted 8-word hashes with their
source paths, plus terms in clear. The remote example in `docs/reference.md` covers commit messages and the
denylist only, and stores the denylist in clear as a secret.

## Acceptance criteria

1. `node scripts/leakgate.js export` prints a fingerprint with salted hashes only: no plan text, no source
   paths, and terms hashed the same way (word runs of each term's length).
2. `node scripts/leakgate.js ci --fingerprint <file> --base <sha>` checks the pull request's title, body,
   commit messages and added lines against it, exits 1 on a hit naming the file and line (never the plan
   text, which the check does not have), and 0 otherwise.
3. `docs/reference.md` replaces the denylist example with a workflow that reads the export from a
   repository secret and runs the check, with no dependency outside Node.
4. Both directions tested: a planted passage fails the check; the product's own text passes.
