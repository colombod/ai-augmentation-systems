# Spike results: beads topology for a team on several hosts

**Why:** the Vault's beads run on one Dolt server on Wintermute, reached from the owner's PC by a
wrapper over Tailscale (the-vault `AGENTS.md:187-190`), and the plugin's own design copied that
shape (`.superpowers/specs/2026-10-12-shipping-team-design.md` section 5: `bd_host: wintermute`,
`dolt_server: true`). On 2026-10-24 that server refused every `bd` command from a Wintermute
session ("Error 1045 (28000): Access denied for user 'root'", the-vault-planning
`day-one-wintermute.md` at `48d13ca`), and a power cut then took the host down. The owner:
"this sounds something not sustainable and working only on this project ... that is something I
need YOu to generalise when customer use the delivery plugin".

**What beads documents** (gastownhall/beads `docs/` at `068cdd6`, read 2026-10-24):

- Cross-machine sync is a Dolt remote, normally the project's own git `origin`, stored under
  `refs/dolt/data`; `bd init` wires `origin` automatically; fresh clones run `bd bootstrap`
  (`core-concepts/sync-concepts.md`).
- Embedded mode is the default: "Single-writer (one process at a time)", "Zero ops: no server, no
  ports, no PID files"; server mode is for "Multiple agents writing simultaneously"
  (`architecture/dolt.md`, Modes of Operation).
- Server mode authenticates with `BEADS_DOLT_PASSWORD` or `~/.config/beads/credentials`; shared
  server mode puts one server for all projects at `~/.beads/shared-server/`, port 3308
  (`architecture/dolt.md`, Configuration Reference, Shared Server Mode). Wintermute's server is
  that one (pid on 127.0.0.1:3308, cwd `~/.beads/shared-server/dolt`, per `day-one-wintermute.md`).

**Run:** `spikes/beads-topology-spike.sh` with bd 1.1.2 (the version on Wintermute; release
archive checksum verified against `checksums.txt`), git 2.43.0, cloud host, 2026-10-24 19:5x UTC.
Two hosts are two clones with separate `HOME`; the remote is a bare git repository. Raw output:

```
### 1. host A: bd init in a repo that has an origin
exit=0
origin               git+file:///.../run2/remote.git
sync.remote: "/.../run2/remote.git"
"dolt_mode": "embedded"
### 2. host A: create two issues, bd dolt push
exit=0
refs on the remote:  refs/dolt/data  refs/heads/__dolt_remote_info__  refs/heads/main
### 3. host B: plain git clone, then bd bootstrap
exit=0
Total: 2 issues (2 open, 0 in progress)
### 4. race: A and B both claim spk-u27 before syncing
A claim exit=0
B claim exit=0
A push exit=0
B push exit=1
Error: merge origin/main: merge conflicts in issues require operator resolution; merge aborted and working set restored
exit=1
B's local view:  "assignee": "bob",
### 5. recovery: B sets its unsynced database aside and bootstraps again
exit=0
    "assignee": "alice",
### 6. claim after pull: B tries to claim the issue A holds
Error claiming spk-u27: issue already claimed by alice
exit=1
### 7. one host, four concurrent writers, five creates each (embedded mode)
writes=20 failed=0 max_ms=3666 mean_ms=957
stderr lines: 0
issues now: 22
```

A first run of the same script reported `B push exit=0` because the label was echoed before the
exit code was read; fixed (`rc "<label>"`) and rerun from an empty directory. The output above is
the second run.

| Question | Answer (this run) |
| :-- | :-- |
| Does a plain `bd init` in a repo with an origin need any server or credential? | no: embedded mode, origin wired as the sync remote |
| Does a second host get the issues from a plain clone? | yes: `bd bootstrap`, exit 0, 2 issues |
| Does sync add anything to the git repo besides `refs/dolt/data`? | yes: a branch `__dolt_remote_info__` (matters for branch protection and for public repos) |
| Are claims exclusive across hosts? | **no**, not on their own: both hosts claimed offline; the second push is rejected (exit 1) and its pull stops on a conflict that "require[s] operator resolution" |
| Is a claim taken right after a pull exclusive? | yes: `issue already claimed by alice`, exit 1; and a push is rejected unless it fast-forwards, so pull, claim, push is a compare-and-swap |
| Can a host recover from a rejected sync without a person? | yes, by setting its database aside and bootstrapping again, which **drops that host's unsynced writes** |
| Do several sessions on one host need server mode? | not at four writers: 20 of 20 writes succeeded, waits up to 3.7 s (7.2 s in an earlier exploratory run) |

**Not measured:** sync through the cloud sessions' HTTPS proxy to GitHub (`git+https`); a real
GitHub remote with branch protection; keeping unsynced non-claim writes across a recovery; more
than four writers on one host; Windows (`bd.exe` is blocked by Smart App Control on the owner's
PC, the-vault `AGENTS.md:187`) and bd in WSL.

**Found while checking:** no repository of the Vault holds beads data: `git ls-remote` finds no
`refs/dolt/data` on `the-vault`, `the-vault-planning` or `mtg-toolkits` (2026-10-24 ~19:50 UTC).
The Vault's whole issue history is on one disk on Wintermute, with no copy off that machine.
