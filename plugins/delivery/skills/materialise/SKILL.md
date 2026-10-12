---
description: Turn an initiative's roadmap, stories and architecture spikes into the bead graph the team executes — one epic per phase chained by phase reviews, one task per story, one task per spike blocking what it derisks — and regenerate the denylist. Deterministic and idempotent; run by the Delivery Lead after every roadmap, story or spike change and after realign. Pass --check to report drift without writing.
argument-hint: "<initiative> [--dry-run | --check]"
---

# Materialise the plan into beads

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

Only the Delivery Lead runs this without `--check`; anyone may run `--check`. Structure flows from documents to beads here and nowhere else: never create epics, re-parent, or add dependencies by hand.

1. Resolve the project root (marker `project_root`, then `DELIVERY_PROJECT_ROOT`, then upward search) and the initiative slug from `$ARGUMENTS` or the current initiative. Confirm `bd prime` answers; if not, stop and say so.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/materialise.js --project <root> --initiative <slug> --dry-run` and show the command list. If the warnings name a story with a phase not in the roadmap, or a spike whose `Blocks` matched nothing, fix the document first (or tell the Product Manager) rather than materialising around it.
3. Run it again without `--dry-run`. Show the summary line and the warnings verbatim. Append one note to the first phase epic: `bd update <prefix>-<initiative>-ph<first> --append-notes "<date>: materialised <initiative>/roadmap.md@<sha> by <your instance>"`.
4. Commit `.delivery/team/denylist.txt` in the project repository (`git add .delivery/team/denylist.txt && git commit -m "team: denylist from materialise <sha>"`) and tell the operator through the Chief of Staff that the denylist changed, so they can review it once.
5. With `--check`: run with `--check`, show the output verbatim, and say who owns each drift class: stories without a bead, stale references and stray roadmap beads are yours (re-run materialise or fix the document); a closed phase review with the roadmap not marked `(done)` belongs to the Product Manager (run realign).
