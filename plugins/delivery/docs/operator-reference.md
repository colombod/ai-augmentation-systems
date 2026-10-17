# operator.js reference

The day-one commands are in the role briefs and the `decision` skill: `pending`, `find`, `record` (with `--answers` and `--supersedes`), `ack` (with `--pending`), `ask`, `answer` (`--confidence settled|inferred`) and `verify`. Workers only ever need `verify`.

This page covers the rest. Every command is run as `node <plugin root>/scripts/operator.js <command>`; the role brief prints the absolute path. Every command accepts `--json` and `--project <root>`. Put quotes, statements and reasons in single quotes.

## Delegations: "decide this class of things for me"

A standing preference from the operator ("you decide the naming in billing, at most twice") is a delegation. Only the Chief of Staff and the Product Manager record one.

```
operator.js delegate --cite in-<host>-N --quote '<the operator's words>' \
  --statement '<what the operator decided, in one line>' \
  --grant '<one sentence: what is delegated>' --scope label:<l>[,bead:<id>,initiative:<i>] \
  [--until <date>] [--max-uses <n>] [--answers q-<instance>-N]
```

Later cases are decided under it, by the Chief of Staff or the role that recorded the delegation. The decision must lie inside the delegation's scope, before `--until` and within `--max-uses`; `verify` walks it back to the operator's words.

```
operator.js decide --under del-<instance>-N --statement '<the decision>' --scope bead:<id> [--answers q-<instance>-N]
```

List the decisions taken under a delegation in the next briefing, one line each.

## Ratifying, overriding and revoking

- The operator confirms an inferred answer (or a delegation):
  `operator.js ratify --cite in-<host>-N --quote '<their words>' --target ans-<instance>-N|del-<instance>-N`
- The operator overrides an answer or a decision: record their new decision with `record ... --supersedes <id>`.
- The operator withdraws a delegation or a decision:
  `operator.js revoke --cite in-<host>-N --quote '<their words>' --target del-<instance>-N|dec-<instance>-N`

The cited input must be said after the record it ratifies or revokes.

## Questions nobody needs any more

`operator.js withdraw --question q-<instance>-N --reason '<why>'` closes an open question. An answered question cannot be withdrawn.

## Reading the record

- `operator.js show <id>`: one record or input, as stored.
- `operator.js ledger [--bead <id>] [--status open|answered|withdrawn]`: every question, its asker, its status, the answering record and the operator's words. `.delivery/operator/LEDGER.md` is the same view, regenerated after each write.
- `operator.js pending [--since 24h] [--all]`: inputs without a record or ack, open questions, inferred answers awaiting ratification, and delegations awaiting a glance.

## Capture and distribution

- `operator.js sync [--all] [--format-check]`: capture this session's operator inputs from its transcript now. The hooks already do this on every prompt and stop, and `record` and `ack` sync first, so you rarely need it. `--format-check` exits 1 when the transcript format is not recognised.
- `operator.js publish [--force]`: commit and push this writer's own chain files. Every write publishes on its own; run this after a failed push.
- `operator.js refresh`: bring other writers' chain files from the upstream (operator paths only, staged so a later `git pull` accepts them); when the checkout's branch is behind only by operator commits it is fast-forwarded.

## When a chain fails verification

- `operator.js problems`: every chain or record that fails verification, is diverged or is unpublished (exit 1 when anything is affected).
- `operator.js repair --instance <i>`: repair a torn last line of that instance's own chain. The partial line is kept as evidence.
- `operator.js quarantine --file records/<i>.ndjson|inputs/<host>/<YYYY-MM>.ndjson --reason '<what failed>'` (Chief of Staff only): set a failing chain aside, kept as evidence, so writing can go on. Restore the file from repository history when you can.
- `operator.js rehost --instance <i> --reason '<why it moved>' [--to-host <h>] [--to-machine <m>]`: record that an instance moved to another host or machine, before it writes from there. `--to-machine` is read only together with `--to-host`.
