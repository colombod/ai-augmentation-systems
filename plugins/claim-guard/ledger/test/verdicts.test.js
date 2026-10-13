import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { opStartRun, opAddClaim, opListClaims, opRecordVerdict } from "../.build/ops.js";

let runId, claimIdA;
beforeEach(() => {
  process.env.CLAIM_GUARD_REPO = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-verdicts-"));
  runId = opStartRun({}).run_id;
  claimIdA = opAddClaim({
    run_id: runId,
    text: "the max_delete cap cannot be inverted",
    type: "safety",
    source: "commit:abc",
    inferred: false,
  }).claim_id;
});

const record = (over = {}) =>
  opRecordVerdict({
    run_id: runId,
    claim_id: claimIdA,
    lens: "correspondence-auditor",
    verdict: "CONFIRMED",
    evidence: ["admin.py:972"],
    ...over,
  });

const theClaim = () => opListClaims({ run_id: runId }).claims[0];

test("CONFIRMED without a file:line anchor is rejected, nothing written", () => {
  const r = record({ evidence: ["it reads correctly to me"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "evidence_required");
  assert.equal(theClaim().verdicts.length, 0);
  assert.equal(theClaim().aggregate, "PENDING");
});

test("REFUTED without a counter_case is rejected", () => {
  const r = record({ verdict: "REFUTED" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "counter_case_required");
});

test("REFUTED with anchor + counter_case lands and aggregates", () => {
  const r = record({ verdict: "REFUTED", counter_case: "max_delete=-1 slices candidates[:-1]" });
  assert.equal(r.ok, true);
  assert.equal(r.aggregate, "REFUTED");
});

test("UNTESTABLE needs a reason but no anchor", () => {
  const bare = record({ verdict: "UNTESTABLE", evidence: [] });
  assert.equal(bare.ok, false);
  const withReason = record({ verdict: "UNTESTABLE", evidence: ["cannot decide from static read"] });
  assert.equal(withReason.ok, true);
  assert.equal(withReason.aggregate, "UNTESTABLE");
});

test("ratchet: clearing a REFUTED by re-citing the same anchors is rejected and audited", () => {
  record({ verdict: "REFUTED", counter_case: "cap inversion" });
  const retry = record({ verdict: "CONFIRMED", evidence: ["admin.py:972"] });
  assert.equal(retry.ok, false);
  assert.equal(retry.error, "ratchet_violation");
  assert.equal(theClaim().aggregate, "REFUTED");
  const ledger = JSON.parse(
    fs.readFileSync(path.join(process.env.CLAIM_GUARD_REPO, ".claim-guard", runId, "ledger.json"), "utf8"),
  );
  assert.equal(ledger.audit.length, 1);
  assert.equal(ledger.audit[0].type, "ratchet_rejection");
});

test("ratchet: a NEW anchor clears the REFUTED and re-aggregates", () => {
  record({ verdict: "REFUTED", counter_case: "cap inversion" });
  const cleared = record({ verdict: "CONFIRMED", evidence: ["admin.py:972", "validators.py:44"], round: 2 });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.aggregate, "CONFIRMED");
});

test("cross-lens ratchet: another lens cannot CONFIRM over a standing REFUTED without new evidence", () => {
  record({ verdict: "REFUTED", counter_case: "cap inversion" });
  const other = record({ lens: "boundary-adversary", verdict: "CONFIRMED", evidence: ["admin.py:972"] });
  assert.equal(other.ok, false);
  assert.equal(other.error, "ratchet_violation");
});

test("same lens re-record replaces; different lens appends", () => {
  record({});
  record({ round: 2 });
  assert.equal(theClaim().verdicts.length, 1);
  assert.equal(theClaim().verdicts[0].round, 2);
  record({ lens: "chokepoint-mapper", evidence: ["router.py:10"] });
  assert.equal(theClaim().verdicts.length, 2);
});

test("adverse_state_test payload lands on the claim", () => {
  const r = record({
    lens: "test-correspondence-auditor",
    adverse_state_test: { exists: true, test_ref: "tests/test_cap.py::test_negative_cap", reason: "goes red on inversion" },
  });
  assert.equal(r.ok, true);
  assert.equal(theClaim().adverse_state_test.exists, true);
  assert.equal(theClaim().adverse_state_test.test_ref, "tests/test_cap.py::test_negative_cap");
});

test("unknown run / claim / verdict rejected with typed errors", () => {
  assert.equal(opRecordVerdict({ run_id: "run_deadbeef", claim_id: claimIdA, lens: "l", verdict: "N/A" }).error, "run_not_found");
  assert.equal(record({ claim_id: "clm_ffffffff" }).error, "claim_not_found");
  assert.equal(record({ verdict: "MAYBE" }).error, "invalid_input");
});
