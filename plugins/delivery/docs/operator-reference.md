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
- The operator chose between options: `record ... --over '<option>|<option>'` keeps the ones turned down (one to five, none the decision itself), signed with the decision; `show` prints them as "turned down", `find --text` searches them, and the bead note carries them.
- The operator withdraws a delegation or a decision:
  `operator.js revoke --cite in-<host>-N --quote '<their words>' --target del-<instance>-N|dec-<instance>-N`

The cited input must be said after the record it ratifies or revokes.

## Questions nobody needs any more

`operator.js withdraw --question q-<instance>-N --reason '<why>'` closes an open question. An answered question cannot be withdrawn.

## Reading the record

- `operator.js show <id>`: one record or input, as stored.
- `operator.js ledger [--bead <id>] [--status open|answered|withdrawn]`: every question, its asker, its status, the answering record and the operator's words. `operator/LEDGER.md` in the operator store is the same view, regenerated after each write.
- `operator.js pending [--since 24h] [--all]`: inputs without a record or ack, open questions, inferred answers awaiting ratification, and delegations awaiting a glance.

## Capture and distribution

- `operator.js sync [--all] [--format-check]`: capture this session's operator inputs from its transcript now. The hooks already do this on every prompt and stop, and `record` and `ack` sync first, so you rarely need it. `--format-check` exits 1 when the transcript format is not recognised.
- `operator.js publish [--force]`: commit the store's new entries and push them to the `delivery-operator` branch of the project's `origin` (fetch, append-only merge, push; a rejected push is retried up to five times). Every write publishes on its own; run this after a failed push. It needs push access to the project remote, and the repository's branch rules must allow pushes to `delivery-operator`. It prints how many entries it pushed, and exits 1 when an error kept them from the remote (not for "no remote"). Each fetch or push waits at most 15 s (`DELIVERY_GIT_TIMEOUT_MS`), a publish's network work at most 30 s (not counting the store lock or the refresh before it); a remote that did not answer is not tried again for 60 s by any command on this host.
- `operator.js refresh`: fetch that branch and merge other writers' chains into the private store. It never touches your checkout; you never pull for operator records.
- The store is `.git/delivery-operator/` of the checkout (the main repository's `.git` for a linked worktree). Inspect it with `git -C .git/delivery-operator log --stat`. Deleting it, or deleting or re-cloning the checkout, loses everything not yet published.

## When a chain fails verification

- `operator.js problems`: every chain or record that fails verification or is diverged (exit 1 when anything is affected), and entries not on the remote yet as a warning (exit code unaffected).
- `operator.js repair --instance <i>`: repair a torn last line of that instance's own chain. The partial line is kept as evidence.
- `operator.js quarantine --file records/<i>.ndjson|inputs/<host>/<YYYY-MM>.ndjson --reason '<what failed>' [--adopt-remote]` (the Chief of Staff, or the chain's own instance for `records/<i>`, or a role on that host for `inputs/<host>/`, so a host without a Chief of Staff can recover): set a failing chain aside, kept as evidence (in the store's local `quarantine/`), so writing can go on. When the remote holds another copy (the other side of a fork, or the lines published before a local corruption) the store takes it, and the output names every line it took that this store did not write (also in `<evidence>.adopted.txt`): review them. When the remote copy is this copy plus extra lines (someone else wrote them), quarantine refuses until you rerun it with `--adopt-remote` after reviewing them. A never-published copy leaves the store.
- A rehost is accepted from the remote only when the committed `team.json` places the instance on the new host (or the rehost was written here): commit the manifest change first. An unauthorised rehost is a fork; `operator.js problems` names its record id. Restore from the store's history (`git -C .git/delivery-operator log -p -- operator/<chain>`) when you can.
- `operator.js rehost --instance <i> --reason '<why it moved>' [--to-host <h>] [--to-machine <m>]`: record that an instance moved to another host or machine, before it writes from there. `--to-machine` is read only together with `--to-host`.
