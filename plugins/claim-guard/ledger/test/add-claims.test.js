import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  opStartRun,
  opAddClaim,
  opAddClaims,
  opListClaims,
  opListRuns,
  opRecordVerdict,
} from "../.build/ops.js";

beforeEach(() => {
  process.env.CLAIM_GUARD_REPO = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-ops-"));
});

const CLAIM = { text: "retries are bounded", type: "quantitative", source: "commit:abc", inferred: false };

test("start_run returns a run_id and default policy; rejects unknown policy", () => {
  const r = opStartRun({});
  assert.equal(r.ok, true);
  assert.match(r.run_id, /^run_[0-9a-f]{8}$/);
  assert.equal(r.gate_policy, "blocking-with-waiver");
  const bad = opStartRun({ gate_policy: "vibes" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "invalid_input");
});

test("add_claim auto-creates a run on empty run_id; idempotent re-add keeps verdicts", () => {
  const first = opAddClaim({ run_id: "", ...CLAIM });
  assert.equal(first.ok, true);
  assert.equal(first.was_new, true);
  const runId = first.run_id;

  const v = opRecordVerdict({
    run_id: runId, claim_id: first.claim_id, lens: "correspondence-auditor",
    verdict: "CONFIRMED", evidence: ["registry.py:12"],
  });
  assert.equal(v.ok, true);

  const again = opAddClaim({ run_id: runId, ...CLAIM, source: "pr-body", basis: null });
  assert.equal(again.ok, true);
  assert.equal(again.was_new, false);
  const { claims } = opListClaims({ run_id: runId });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].verdicts.length, 1);
});

test("add_claim sets probe_eligibility from type", () => {
  const run = opStartRun({});
  const safety = opAddClaim({ run_id: run.run_id, ...CLAIM, text: "no data loss", type: "safety" });
  const cov = opAddClaim({ run_id: run.run_id, ...CLAIM, text: "this is tested", type: "coverage" });
  const { claims } = opListClaims({ run_id: run.run_id });
  const byId = Object.fromEntries(claims.map((c) => [c.claim_id, c]));
  assert.equal(byId[safety.claim_id].probe_eligibility, "eligible");
  assert.equal(byId[cov.claim_id].probe_eligibility, "not_eligible");
});

test("add_claim rejects unknown type", () => {
  const run = opStartRun({});
  const r = opAddClaim({ run_id: run.run_id, ...CLAIM, type: "bogus" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_input");
});

test("add_claims: malformed element lands in errors, the rest still land", () => {
  const r = opAddClaims({
    run_id: "",
    claims: [
      { text: "a is guarded", type: "safety", source: "commit:x", inferred: false },
      { text: "b", type: "bogus-type", source: "commit:x", inferred: false },
      { text: "c is tested", type: "coverage", source: "commit:x", inferred: true, basis: "implied by purpose" },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].index, 1);
  const { claims } = opListClaims({ run_id: r.run_id });
  assert.equal(claims.length, 2);
});

test("add_claims rejects wholly on empty/non-array claims", () => {
  for (const claims of [[], null, "nope"]) {
    const r = opAddClaims({ run_id: "", claims });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  }
});

test("add_claims threads run_id from first successful add", () => {
  const r = opAddClaims({ claims: [ { ...CLAIM }, { ...CLAIM, text: "no dup under retry", type: "concurrency" } ] });
  assert.equal(r.ok, true);
  const { claims } = opListClaims({ run_id: r.run_id });
  assert.equal(claims.length, 2);
});

test("list_claims filters by type and aggregate", () => {
  const run = opStartRun({});
  opAddClaim({ run_id: run.run_id, ...CLAIM });
  opAddClaim({ run_id: run.run_id, ...CLAIM, text: "no data loss", type: "safety" });
  const safety = opListClaims({ run_id: run.run_id, type: "safety" });
  assert.equal(safety.claims.length, 1);
  const pending = opListClaims({ run_id: run.run_id, aggregate: "PENDING" });
  assert.equal(pending.claims.length, 2);
});

test("list_claims on unknown run errors run_not_found", () => {
  const r = opListClaims({ run_id: "run_deadbeef" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "run_not_found");
});

test("list_runs stranded_only flags claims>0 && pending>0", () => {
  const empty = opStartRun({});
  const stranded = opStartRun({});
  opAddClaim({ run_id: stranded.run_id, ...CLAIM });
  const done = opStartRun({});
  const c = opAddClaim({ run_id: done.run_id, ...CLAIM });
  opRecordVerdict({ run_id: done.run_id, claim_id: c.claim_id, lens: "correspondence-auditor", verdict: "CONFIRMED", evidence: ["a.py:1"] });

  const all = opListRuns({});
  assert.equal(all.ok, true);
  assert.equal(all.runs.length, 3);
  assert.equal(all.stranded_count, 1);

  const onlyStranded = opListRuns({ stranded_only: true });
  assert.equal(onlyStranded.runs.length, 1);
  assert.equal(onlyStranded.runs[0].run_id, stranded.run_id);
  assert.equal(onlyStranded.runs[0].stranded, true);
  assert.equal(empty.ok && done.ok, true);
});
