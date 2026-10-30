# Spike results: a tracker on the forge, claims as create-only git refs

**Why:** the owner, 2026-10-24: "I think bd is a suggestion if we use a repo as product umbrella in
general (assume private) ... should we use properly got hub issues as tasks tracking and claiming
is something done via the assiegned ?" and "This would also work if useresti want to be private
and run a gitea server for example".

**Why not the assignee:** every role session acts as the owner's single forge account, so an
assignee cannot name a session, and adding an assignee is never refused, so it cannot make a
claim exclusive.

**Claim mechanism tried:** a session claims issue N by creating `refs/claims/N` in the umbrella
repo with `git push origin HEAD:refs/claims/N --force-with-lease=refs/claims/N:` (the empty
expected value means "only if the ref does not exist"; the server checks the old value, so two
pushes cannot both win). Release deletes the ref. The commit message names the holder.

## Run 1: plain git (bare repository), git 2.43.0, 2026-10-24

```
*	HEAD:refs/claims/vault-12	[new reference]
a exit=0
!	HEAD:refs/claims/vault-12	[rejected] (stale info)
b exit=1
holder: claim vault-12 by a
-- release by a, then b claims
release exit=0
*	HEAD:refs/claims/vault-12	[new reference]
b exit=0
holder: claim vault-12 by b
```

## Run 2: Gitea 1.27.3 (release binary, sha256 verified), SQLite, 127.0.0.1, 2026-10-24 20:13 UTC

Private repository `owner/umbrella`; two clones over HTTP with the **same** account.

```
*	HEAD:refs/claims/1	[new reference]
a exit=0
error: failed to push some refs to 'http://127.0.0.1:3999/owner/umbrella.git'
!	HEAD:refs/claims/1	[rejected] (stale info)
b exit=1
2895ca8903358e731f02fda25e4e0d24a60a9941	refs/claims/1
holder: claim 1 by session-a
-- release by a
exit=0
*	HEAD:refs/claims/1	[new reference]
b exit=0
```

Gitea issue API (`/api/v1/repos/owner/umbrella/...`), same run:

| Call | Result |
| :-- | :-- |
| create label `claimed`; create issues 1 and 2 | ok (label id 1; issues 1, 2) |
| add label to issue 1 | ok |
| comment "claimed by builder-1@wintermute (refs/claims/1)" | ok, body returned |
| set assignee | ok (`owner`; the same account for every session) |
| `POST issues/2/dependencies` with issue 1 | 201 |
| `GET issues/2/dependencies` / `GET issues/1/blocks` | "story: login" / "story: logout" |

| Question | Answer |
| :-- | :-- |
| Is a create-only ref an exclusive claim on plain git and on Gitea? | yes, both runs: second claim refused (exit 1), first holder kept |
| Does Gitea accept a ref outside `refs/heads` and `refs/tags`? | yes (`refs/claims/1` created, listed, deleted) |
| Does Gitea have what the plugin's tracker uses (labels, comments, dependencies)? | yes for labels, comments, assignees, blocked-by dependencies |

**Not measured:** GitHub (custom refs under `refs/claims/*`, and its issue dependencies API);
branch or ref protection rules on either forge; Forgejo; a forge on a private network reached by
cloud sessions (it cannot be, the same limit as Wintermute: a forge the cloud must use has to be
reachable from the internet, with a token); API rate limits shared by all sessions on one account.
