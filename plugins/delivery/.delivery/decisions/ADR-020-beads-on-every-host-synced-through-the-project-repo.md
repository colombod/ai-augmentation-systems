# ADR-020: Beads on every host, synced through the project repo; no shared database server

**Status:** proposed
**Date:** 2026-10-24 (brownfield onboarding)
**Deciders:** owner (asked for it), Solution Architect
**Word count:** 726 prose words (cap 600; declared overrun: the owner's statement is kept verbatim and the decision covers six points; tables excluded, `grep -v '^|'`).
**Evidence:** `initiatives/brownfield-onboarding/spikes/beads-topology-results.md`

## Context

The owner, verbatim: "this sounds something not sustainable and working only on this project, the
session decided to put beads on Wintermute that is something I need YOu to generalise when
customer use the delivery plugin".

The plugin's manifest names one `bd_host` and per-host `bd: native | wrapper | remote`; its design
example has a `dolt_server` on the bd host (`.superpowers/specs/2026-10-12-shipping-team-design.md`
section 5, `scripts/lib/manifest.js:127`). That is the Vault's setup written into the product: one
shared server on one machine, a wrapper over a private network for the PC. On day one it refused
every command (`Error 1045`), cloud sessions cannot reach it, a power cut stopped it, and its data
exists on no other machine. A customer would have to build and run the same thing.

beads itself documents a serverless path: each machine an embedded database, sync through the
project's git `origin` under `refs/dolt/data`, `bd bootstrap` on fresh clones. The spike ran it:
plain clone and bootstrap work; claims are not exclusive across hosts unless taken right after a
pull and pushed at once; four concurrent writers on one host all succeeded.

## Decision

1. **Every host runs `bd` itself**, embedded mode, database in the project repo's `.beads/`.
   Hosts share issues only through the project repo's git remote (`bd dolt push` / `pull`,
   `bd bootstrap`). No host owns the database; `bd_host` is retired from the manifest.
2. **The project repo is the sync remote, and it must be private.** It already exists, every
   session already needs push access to it, and the sync adds `refs/dolt/data` and a
   `__dolt_remote_info__` branch. `start.js --check` refuses a public project repo for beads.
3. **Claims are compare-and-swap:** the plugin's claim path is pull, claim, push in one step. A
   rejected push means another host wrote first: keep this host's unsynced writes as an export,
   bootstrap again, replay what does not conflict, and report the claim as lost. Other writes
   are pushed at the end of the command that made them.
4. **Server mode only on measured need:** when lock waits on one host exceed the hooks' budget,
   that host switches to beads' own local server (`bd init --server`, localhost, started by bd).
   Never a server reached over the network, never a password the plugin has to find.
5. **A host that cannot run `bd`** (the owner's PC: Smart App Control blocks `bd.exe`) runs it in
   WSL or a container on that host. If neither exists, its roles get no beads writes and say so;
   a wrapper to another machine is allowed only as a declared exception in `hosts.json`.
6. **Brownfield:** an existing beads database is moved once, from the host that holds it: export
   for audit, `bd dolt remote add origin <project repo>`, `bd dolt push`; every other host
   bootstraps. The old server is stopped only after every host reads the same counts.

## Alternatives considered

- **Keep one shared server, reached over a private network:** works on one owner's network only;
  needs credentials, uptime and a backup the plugin cannot provide; unreachable from the cloud.
- **Server mode everywhere:** buys concurrency the spike did not need at four writers, and adds a
  process per host.
- **DoltHub or object storage as the remote:** a second account and credential for every
  customer, when the project repo already is a remote.
- **JSONL in git as the sync:** beads says it "is not the canonical cross-machine sync channel";
  it cannot carry deletes.

## Consequences

- Beads works on any host with git push access to the project repo, the cloud included (to be
  confirmed through the cloud proxy, spike open), and survives any one host going down.
- The claim path becomes plugin code with a network round trip; a lost race is a normal outcome
  the role briefs must handle.
- Recovery that sets a database aside must not drop unsynced writes; not yet shown.
- `hosts.json` `bd` values change to `local | wsl | none` plus the declared exception; old
  manifests need a migration and a `start.js --check` message.

**Revisit if:** lock waits on one host exceed the budget at the team's real size; beads ships
server-side claim exclusivity; or GitHub rejects `refs/dolt/data` pushes under branch protection.
