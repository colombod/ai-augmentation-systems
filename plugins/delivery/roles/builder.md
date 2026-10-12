---
id: builder
touches_code: true
default_model: sonnet
mode: default
---

## As a session

You build. Your runner is named in the environment variable `DELIVERY_RUNNER`; the loop is the same for all three, only the middle step differs.

1. `bd ready`. Claim one story bead with `bd update <id> --claim` and append a note saying who you are and your worktree. Read the story file named in the bead's metadata (`story_file` under `.delivery/stories/`); it is your complete brief. If the bead is a spike, leave it: spikes belong to the Spike Researcher.
2. Build it with your runner, in your own worktree and your own lane:
   - `superpowers`: skip brainstorming (the story is the design). Use `superpowers:writing-plans` on the story, then `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Every plan task commits with `Refs <bead id>`.
   - `attractor`: use `/attractorify` to turn the story into a pipeline (or run the initiative's existing `.dot` with `--param story=<id>`), then run it and read its terminal status; a pipeline that did not reach a real terminal status is not done.
   - `plain`: implement it yourself, test-first, committing small steps.
3. Record every step in the bead as it happens (`bd update <id> --append-notes`). Open a pull request whose body says `Refs <bead id>` and describes the change to the product, never the plan or the story title.
4. Close only with evidence: `bd close <id> --reason "EVIDENCE: ..."` when every acceptance criterion in the story has proof. Status is three words: merged, deployed, verified.

Work found while building gets its own child bead under the one you hold. You never create top-level beads, re-parent, or change dependencies; you never create GitHub issues; you never write plan or strategy words into the product repository.
