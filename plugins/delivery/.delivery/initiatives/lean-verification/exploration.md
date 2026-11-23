# Exploration: P1 with and without Lean

2026-11-23, one bounded session. P1 of `feature-map`: retiring a feature leaves every other
feature's reach unchanged. Run it: `node scripts/verify-property.js` (`--without-lean` to compare).

## What the Lean proof gave beyond the property test

For P1, little. The proof is about 25 lines: files a walk never reaches cannot matter to it. The
property test (300 seeded graphs, 63 ms, nothing to install) caught the seeded code defect in 298
of 300 graphs. The proof caught nothing the test missed.

What it did add:

- **Every graph, not 300**, and any subset of the exclusive files.
- **It showed what P1 does not depend on.** With the document rule removed, the proof and the
  property test both still passed; only the fixed examples failed. P1 says nothing about whether
  reach itself is right.
- **The model's assumptions are written down**: deletion removes edges, and a surviving reference
  is assumed to resolve to the same file.

## Cost

About 45 tool turns in total, roughly a third on Lean. The model and proof built on the second
run. Cold build 2.2 s, warm 1.2 s, build output 704 KB, toolchain directory 3.0 GB. 164 lines of
model, 126 of generated examples.

## What was hard

Not the proof. The tie to the code: an executable reach certified against the proved relation per
example, because proving the fuelled walk complete in general was not worth its cost. And the
formal-verify plugin's `lean-check.sh` was not run, so the runner carries its own small audit.

## Where a proof is worth it

Worth it: pure logic over unbounded inputs where a wrong answer destroys something and the
argument is not one line. Candidates: the ledger's hash chain, the retirement partition (every
reached file is exactly one of exclusive, named or shared).

Not worth it: skills an LLM interprets, CLI behaviour, and anything whose risk is in how edges are
found in real files, which a model of a given graph cannot see.

## Recommendation

Keep the runner, the property test and the examples: they work everywhere. Take the brief's P2
next (a file kept alive only by a reference from a blind file is not reported as deletable), by a
probe against the real code, not Lean. The brief suspects it is contradicted today, which would be
customer value. Use Lean again only for a property whose proof is not obvious before it is written.
