---
id: strategy-leak-gate-01
title: Refuse plan material in every public channel a session writes
status: done
epic: strategy-leak-gate
supersedes: []
superseded_by: []
superseded_reason:
phase: MVP
requirements: [FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-10]
depends_on: []
size: M
---

# Refuse plan material in every public channel a session writes

## Goal

A team shipping from a private plan to a public repository can rely on the session hooks to refuse any
commit, pull request, comment, merge subject, release, branch name, added line of code or file written into
the product that carries an exact plan term or 8 words copied from the private plan (prd.md, "The promise,
in one breath"). Paraphrase is not promised.

## Context

The leak guard (`hooks/scripts/leak.js`) checked commit, PR, issue and release text from the product
worktree against the denylist only, which holds headings and story titles. The brief's five gaps: the diff
was never scanned; the denylist knows headings, not the plan; the plugin's own `Refs` line was refused for
spike ids carrying the slug; the Delivery Manager's `gh` writes from the project directory were unscanned;
the remote backstop covers commit messages only (the last is story -02).

Spike `spikes/shingle-calibration.md`: 8-word passages, dropping runs with fewer than 5 words of three
letters or more, hit 6 of 609 public files and 0 of 315 commit messages on the Vault replay.

## Acceptance criteria

1. An 8-word passage from any text file under the project's `.delivery/` is refused in commit and PR text,
   PR comments, merge subjects, release notes, MCP text, the staged change of a commit, and Write, Edit and
   MultiEdit content into the product; text in the session's own words passes. (FR-1, FR-3, FR-5)
2. Terms from the denylist and `.delivery/team/leak-extras.txt` are refused in the same channels and in
   branch and tag names; deleting a name passes. (FR-1, FR-6)
3. The fingerprint rebuilds itself when a plan file changes, lives git-ignored in `.delivery/cache/leak/`
   and holds salted hashes, never plan text. (FR-2)
4. `gh` writes that name `product_github` (`-R`, or `repos/<o>/<r>` in `gh api`) are scanned from any
   directory, body files included; the planning repository and unnamed targets are not. (FR-4)
5. `.delivery/team/leak-allow.txt` removes its terms and its sentences' passages, and only those. (FR-7)
6. A refusal is two lines: the matched words with their private source, then the way out (rewrite, or
   message the Product Manager). (FR-8, R-46)
7. A `Refs` line of bead ids is not scanned; a bare slug after `Refs` still is. (FR-10)
8. A commit's check stays under 300 ms on a 12,000-passage plan. (NFR)

## Verification

`node --test hooks/scripts/leak-gate.test.js hooks/scripts/leak.test.js hooks/scripts/reasons.test.js`;
every new test mutation-checked (20 mutations, all killed). Run against the real Vault plan and its public
product repository: build 73 ms, a whole-file check 194 ms, the leaked test-file sentence found with its
source, 3 of 595 public files hit, each a sentence shared verbatim with the plan.
