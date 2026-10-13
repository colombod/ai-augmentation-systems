---
name: adverse-state-catalog
description: "The catalog of adverse states a safety/integrity claim must survive — degraded dependency, transient-failure-then-success, boundary input, cross-replica race, post-repair self-clear, abrupt termination — each as a generic pattern plus concrete instantiations. Use when checking whether a test runs in the right adverse state, or when designing the test a safety claim is missing."
---

# Adverse-State Catalog

A safety claim is only meaningful *in the adverse state it exists to survive*. Testing the happy
path proves liveness, not integrity. This catalog names the adverse states, so a test targets the
condition the claim is actually about — and observes for the **specific violation** (corruption /
loss / inversion / staleness), never for mere liveness.

Structure: `category → generic pattern → concrete instantiations`. The architecture is
domain-agnostic; the instantiations start concrete (seeded from the incident that motivated this
system) and generalize by adding rows — a **data** problem, not an architecture problem.

## The six categories

| Category | Generic pattern | Observe for | Concrete instantiation (seed) |
|---|---|---|---|
| **Degraded dependency** | run with the invariant-enforcing mechanism ABSENT | corruption / duplicates | drop the `:Node` uniqueness constraint, seed duplicates, boot → `POST /events` → **count duplicate nodes** |
| **Transient failure then success** | fail once, succeed on retry, WITHIN budget | double-effect / duplicate | force a flush deadlock that retries green → **count Iteration nodes** (expect exactly one) |
| **Boundary / negative input** | feed the value the (missing) validator exists to reject | inversion / blast radius | `max_delete = -1` → `candidates[:-1]` deletes all-but-one → observe blast radius |
| **Post-repair self-clear** | degrade → observe gated → repair out-of-band → **observe AGAIN, same PID** | staleness / latch | `schema_health` computed once in `lifespan()` → does the gate self-clear without restart? |
| **Cross-replica race** | two writers, same logical entity, concurrent | last-write-wins / lost update | two replicas MERGE the same session concurrently → observe the survivor |
| **Abrupt termination** | kill -9 mid-write; observe on restart | partial write / loss | interrupt a batch flush → restart → observe consistency |

## The load-bearing discipline: observe for the violation, not liveness

The single most common testing failure is asserting the process survived (`proc.poll() is None`,
"returns 200") when the claim was about integrity. For each adverse state, the observation must be
the **specific forbidden outcome**:

- **corruption** — a value/relationship that should be impossible (a duplicate node, an inverted cap).
- **loss** — something that should persist is gone (a dropped write after kill-9).
- **inversion** — the guarantee runs backwards (a "cap" that keeps all-but-N).
- **staleness** — a latched signal that never re-clears after the world was repaired.

A test that runs in the adverse state but only checks liveness does **not** count. A test that
checks the violation but runs on the happy path does **not** count. Both are required.

## Temporal adverse states need three phases, not a snapshot

Self-clear / re-probe claims cannot be checked with one observation. You must **degrade → observe
the gated behavior → repair out-of-band → observe AGAIN (same process)**. A single snapshot cannot
catch a latch — the `schema_health`-computed-once bug is exactly this shape.

## Building the adverse world is itself a defect engine

Constructing the adverse state exercises adjacent paths and surfaces defects nobody claimed. Expect
the setup to find bugs, and record them.

## How this plugin uses the catalog

This catalog tells the `test-correspondence-auditor` what a real adverse-state test must look like
(and therefore when one is missing — the gate's second limb). The upstream amplifier bundle's
Phase 2 additionally stands these states up in a Digital Twin and attacks them; that dynamic bench
is not ported yet, so a missing adverse-state test is remediated here by writing the test (after
the gate run — the gate itself never edits code) or by a recorded human waiver.
