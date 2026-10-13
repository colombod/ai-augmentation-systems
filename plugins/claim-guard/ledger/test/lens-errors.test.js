import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  opStartRun,
  opAddClaim,
  opListClaims,
  opRecordVerdict,
  opRecordLensError,
  opRecordDebate,
  opWaive,
} from "../.build/ops.js";

let runId, claim;
beforeEach(() => {
  process.env.CLAIM_GUARD_REPO = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-lens-"));
  runId = opStartRun({}).run_id;
  claim = opAddClaim({ run_id: runId, text: "no data loss on degraded boot", type: "safety", source: "commit:abc", inferred: false }).claim_id;
});

const theClaim = () => opListClaims({ run_id: runId }).claims[0];

test("record_lens_error appends and never creates a verdict or moves the aggregate", () => {
  opRecordVerdict({ run_id: runId, claim_id: claim, lens: "correspondence-auditor", verdict: "CONFIRMED", evidence: ["store.py:12"] });
  const r = opRecordLensError({ run_id: runId, claim_id: claim, lens: "chokepoint-mapper", error: "Tool 'claim_ledger' not found" });
  assert.equal(r.ok, true);
  const c = theClaim();
  assert.equal(c.lens_errors.length, 1);
  assert.equal(c.lens_errors[0].lens, "chokepoint-mapper");
  assert.equal(c.verdicts.length, 1);
  assert.equal(c.aggregate, "CONFIRMED");
  assert.equal(c.adverse_state_test.exists, false);
});

test("record_lens_error validates inputs", () => {
  assert.equal(opRecordLensError({ run_id: runId, claim_id: claim, lens: "", error: "x" }).error, "invalid_input");
  assert.equal(opRecordLensError({ run_id: runId, claim_id: "clm_ffffffff", lens: "l", error: "x" }).error, "claim_not_found");
  assert.equal(opRecordLensError({ run_id: "run_deadbeef", claim_id: claim, lens: "l", error: "x" }).error, "run_not_found");
});

test("record_debate persists the verbatim relay payload", () => {
  const r = opRecordDebate({
    run_id: runId,
    round: 2,
    to_lens: "correspondence-auditor",
    relayed_payload: "chokepoint-mapper: path 2 reaches MERGE unguarded (registry.py:648)",
    from_lenses: ["chokepoint-mapper"],
  });
  assert.equal(r.ok, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(process.env.CLAIM_GUARD_REPO, ".claim-guard", runId, "ledger.json"), "utf8"));
  assert.equal(ledger.debate.length, 1);
  assert.equal(ledger.debate[0].relayed_payload, "chokepoint-mapper: path 2 reaches MERGE unguarded (registry.py:648)");
  assert.deepEqual(ledger.debate[0].from_lenses, ["chokepoint-mapper"]);
});

test("waive records by/reason/at on the claim", () => {
  const r = opWaive({ run_id: runId, claim_id: claim, by: "colombod", reason: "accepted risk for the demo branch" });
  assert.equal(r.ok, true);
  const c = theClaim();
  assert.equal(c.waiver.by, "colombod");
  assert.equal(c.waiver.reason, "accepted risk for the demo branch");
  assert.ok(c.waiver.at);
});

test("waive requires by and reason", () => {
  assert.equal(opWaive({ run_id: runId, claim_id: claim, by: "", reason: "r" }).error, "invalid_input");
  assert.equal(opWaive({ run_id: runId, claim_id: claim, by: "b", reason: "" }).error, "invalid_input");
});
