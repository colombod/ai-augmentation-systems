# Delivery: direction

Draft vision and contracts for the Delivery plugin, written in the form of [Amplifier Converge](https://github.com/microsoft/amplifier-converge): a one-page narrative vision and focused contracts, each with an audience line, a promise, an example, numbered commitments, a "Check" scenario and a "Left open" list. Converge prescribes no template, so the form here is borrowed from how its own contracts are laid out. The wording is original.

Status: draft for the owner's review. Nothing here is approved or built. The Check scenarios were walked by reading only; none has been run against a real team, and the contracts have not been tabletop reviewed.

Start with [VISION.md](VISION.md). The contracts are in [contracts/](contracts/). The sprint-by-sprint [PLAN.md](PLAN.md) applies them to the plugin itself, including how to stop it compromising a user's Claude setup. The [research note on execution engines](research/execution-engines.md) records what Claude Code, the Agent SDK and attractor can and cannot do for a bounded sprint, from primary sources. Abbreviations below: CV customer value, IN intent to increment, SP spend and idle, OA owner authority, RH roles and handoffs, VE verification, FM feature map.

## How each failure maps to a clause

The failures come from the 2026-11-22 post-mortem and the analyses of the Chief of Staff, delivery-lead, workers, plugin design and the asked-versus-delivered ledger. Counts are from those analyses and are keyword- or title-based unless said otherwise.

| What happened | Where it is now forbidden |
| --- | --- |
| About 84% of PRs since 30 Oct were the team's own machinery; no customer-visible feature shipped in the period | CV 2, 3, 5; IN 3 |
| One complaint (`/tmp` full) grew into a 159-bead tree of watchdog, revive and host-manager work | CV 5; IN 5; RH 4 |
| New asks (Codex port, feature transfer, docs role, multi-product) all went into one team and budget, mid-run | IN 3, 4 |
| No sprint plan was approved for 16 days | IN 3 |
| Owner's short answers widened into scope; about 11 answers recorded in the owner's name | IN 7; OA 9; RH 3 |
| Infrastructure built far beyond what any deliverable needed; scripts and hooks grew from about 430 to about 33,000 lines | CV 5; FM 6 |
| The same components fixed again and again (wake 20 PRs, install about 28); the outage drill built three times | CV 3; FM 3 |
| "Ready work with nothing in progress is a defect"; idle treated as failure | SP 3, 4 |
| Watchdog woke sessions every 15 minutes and at usage resets; 113 wakes ended at the 5-hour limit | SP 3, 5, 9 |
| Every role resumed after each usage limit | SP 5 |
| 300k to 960k-token contexts reloaded on each wake | SP 8 |
| 97.6% of tokens on the top model tier; 324 of 327 delivery-lead subagents on it | SP 6 |
| Budget only warned; no token or money cap; no bound on a round as a whole | SP 1, 2 |
| `CLAUDE_CODE_SUBAGENT_MODEL=opus` is set in the owner's settings and shell. By the docs it is only a default, ranking below a per-call or per-definition model, unless `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` is set or Claude Code is older than v2.1.251. Whether the team's hosts met either condition is unverified | SP 6 |
| 304 PR reviews of 109 PRs; PR 178 reviewed nine times; rebase-only send-backs | RH 4, 6; SP 7 |
| Delivery-lead filed 87% of all beads, and owner-driven items fell from about 8% to about 2% of new beads | RH 4; IN 5 |
| Watchdog and host manager restarted each other; the restart ignored the pause | SP 9; OA 3 |
| Owner's stop order blocked by the roles' own hooks; pause needed an unreadable Yes/No box; owner uninstalled by hand | OA 1, 2, 3, 4 |
| Owner asked to run commands, restart servers and approve tool calls | OA 5; RH 3 |
| Owner had to ask "progress?" repeatedly; status given from memory; 247 of 467 messages failed; "you're right" many times with no change | OA 6, 7, 8; RH 3 |
| One branch per builder, PRs closed to free the branch, 8 version-number collisions | RH 4, 5 |
| Reality checks on team machinery; 222 auto-created check tasks; checks failing from their own bugs | VE 2, 6 |
| 178 tasks labelled shipped or verified, about half with a merged PR; child tasks inherited labels | VE 4, 5 |
| Feature map shipped, but the store and server were dropped and no retirement was ever proposed | FM 1, 5 |

## Decisions only the owner can make

1. **Standing team or per-sprint team.** The contracts assume roles run only while a declared sprint needs them. The earlier design kept 13 long-lived sessions. This is the largest change. If per-sprint, the plan proposes a thin runner over `claude -p` as Sprint 3's engine (see [PLAN.md](PLAN.md)). Attractor is not chosen, because it has no run-level time or spend cap, no stop and no resume. The owner decides whether to build the runner at all.
2. **Sprint length.** The contracts require a bound on time, spend and review rounds for each sprint and do not choose them.
3. **Attention budget size.** The limit on decision requests and messages per sprint, and what happens at the limit.
4. **The usage budget.** Its unit, its size, and whether it is per week, per sprint, or both. The contracts require it to be hard.
5. **Default tier, and when the top tier is allowed without a reason.** The contract says the smallest tier that can do the job, and the top tier only for hard work with a recorded reason. The owner may want a different default, or a list of work for which the top tier needs no reason.
6. **One Chief of Staff for several products or one per product.** The contracts work either way.
7. **The feature map's storage.** The owner said the store and server were needed only if a story shows the need. This draft keeps that, but you may want it decided.
8. **Where this lives.** It can be the plugin's `AGENTS.md` doctrine, its `.delivery/` record, or a separate repository, which Converge itself favours for focused parts.
9. **Whether the Codex port, feature transfer and docs role remain in the first sprint.** The contracts do not prioritise them.
10. **Repairing team tooling mid-sprint.** The rules say infrastructure needs its necessity declared before work starts, and that the Delivery Manager creates no work from its own failures. A broken existing tool that blocks a declared deliverable is the hard case. Roles and handoffs 4 allows a bounded repair that restores only what the deliverable needs. The stricter reading, which is to report the deliverable blocked and fix nothing until the next sprint, is also consistent with the rules. The owner should pick.

## What I did not verify

- I read Converge's six contracts and writing guide. I did not read its people, agent and reviewer guides line by line.
- Figures in the traceability table are from the analyses and are not re-run.
- The contracts are not checked against the plugin's current code. Several commitments, such as a stop that cannot be blocked, would need real changes there.
- The Check scenarios were walked against the text by reading only. They have not been run, and nobody other than the author has reviewed them.
