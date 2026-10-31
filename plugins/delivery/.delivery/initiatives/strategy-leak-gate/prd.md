# PRD: strategy leak gate

> Written by /delivery:prd. Owned by Product Owner, with Business Analyst and QA Strategist.
> Status: draft · Last updated: 2026-10-31 · Brief: `brief.md` · Spike: `spikes/shingle-calibration.md`

## The promise, in one breath

A team shipping from a private plan to a public repository can rely on delivery to refuse any commit, pull request, comment, merge subject, release, branch name or added line of code that carries an exact plan term or an 8-word passage copied from the private plan, and to catch on the product remote, before merge, what got past a session.

**What it does not promise** (owner: "do not make strong promises you will fail"): paraphrase, a summary in other words, or meaning is not caught; a determined session with unrestricted shell can still leak; text already public cannot be recalled.

## User scenarios

- **S-1 A builder copies a story's sentence into a code comment.** The commit is refused, naming the 8 words and the private file they came from; the builder rewrites the comment.
- **S-2 The Delivery Manager posts a PR comment or merges with a subject quoting the roadmap.** Refused, wherever the command runs from, when it targets the product repository.
- **S-3 A branch is named after an unannounced feature.** The push is refused for the branch name.
- **S-4 Something reaches the product remote anyway** (a web edit, another tool). The product's CI check fails the pull request before merge, without the plan itself ever being in the public repository.
- **S-5 Text that is public by design** (the product's name, a public customer) is allowed through the allowlist the Product Manager keeps.

## Functional requirements

| FR | Requirement | Scenario |
| :-- | :-- | :-- |
| FR-1 | A fingerprint of the private plan: every 8-word shingle of `.delivery/**` text files (salted hash, with its source path kept privately), plus exact terms (the denylist, `.delivery/team/leak-extras.txt`). A shingle with fewer than 5 words of three letters or more is dropped (spike). | S-1 |
| FR-2 | The fingerprint is rebuilt automatically when any plan file is newer than it; nobody runs a command to keep it fresh. | S-1 |
| FR-3 | Every text channel the leak guard reads today is also checked against the shingles. | S-1, S-2 |
| FR-4 | `gh` writes that target the product repository (by `-R`/`--repo`, or run in its checkout) are scanned from any working directory, including `gh pr merge --subject/--body`. | S-2 |
| FR-5 | Added lines of a commit in the product worktree (`git diff --cached`), and content written into the product by Write and Edit, are scanned. | S-1 |
| FR-6 | Branch and tag names in `git push`, `git checkout -b`, `git switch -c`, `git branch` and `git tag` are scanned against exact terms. | S-3 |
| FR-7 | `.delivery/team/leak-allow.txt` lists public-by-design terms and passages; a match on an allowed one passes. | S-5 |
| FR-8 | A refusal names the matched words, the private source file, and the two ways out: rewrite in your own words, or ask the Product Manager to allow it. | S-1 to S-3 |
| FR-9 | `leakgate.js export` writes a public-safe fingerprint (salted hashes only: no plan text, no paths, no terms in clear) for the product repository's CI secret, and `leakgate.js ci` checks a pull request's title, body, commit messages and added lines against it. | S-4 |
| FR-10 | The `Refs <bead>` line the review binding requires is not refused for containing the initiative slug (the guard refused its own spike ids). | S-1 |

## Non-functional requirements

- A commit's scan adds under 300 ms on a 15,000-shingle plan (the Vault's size); the fingerprint builds in under 2 s.
- No network, no dependency outside Node.
- Fails closed inside the product worktree, as the guard does today.

## Decisions taken for this version (assumed defaults; the owner can change them)

- **Bead ids stay in `Refs` lines** (brief Open question 1). They are opaque ids such as `dlv-4oj`; moving the review binding off the PR body is a larger change, deferred.
- **8 words** is the shingle length, from the spike.

## Out of scope

Paraphrase and meaning; history rewriting; GitHub web edits by a person (caught only by FR-9's CI check); access control on the private repository.

## Staging

- **MVP (release 1):** FR-1 to FR-8 and FR-10, in the session's hooks.
- **Release 2:** FR-9, the product remote's check.
