import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  opStartRun,
  opAddClaim,
  opRecordVerdict,
  opRecordLensError,
  opWaive,
  opGate,
  opReport,
} from "../.build/ops.js";

let runId;
beforeEach(() => {
  process.env.CLAIM_GUARD_REPO = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-gate-"));
  runId = opStartRun({}).run_id;
});

const addClaim = (over = {}) =>
  opAddClaim({
    run_id: runId,
    text: over.text ?? "the code does X",
    type: over.type ?? "correspondence",
    source: "commit:abc",
    inferred: false,
    ...over,
  }).claim_id;

const confirm = (claimId, over = {}) =>
  opRecordVerdict({
    run_id: runId, claim_id: claimId, lens: over.lens ?? "correspondence-auditor",
    verdict: "CONFIRMED", evidence: ["a.py:1"], ...over,
  });

const refute = (claimId) =>
  opRecordVerdict({
    run_id: runId, claim_id: claimId, lens: "boundary-adversary",
    verdict: "REFUTED", evidence: ["a.py:2"], counter_case: "n=-1 inverts the cap",
  });

test("limb 5: zero claims harvested => INDETERMINATE", () => {
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "INDETERMINATE");
  assert.ok(g.indeterminate_reasons.includes("zero-claims-harvested"));
});

test("limb 4: PENDING claim => INDETERMINATE with claim-pending reason", () => {
  const c = addClaim({});
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "INDETERMINATE");
  assert.ok(g.indeterminate_reasons.includes(`claim-pending:${c}`));
});

test("limb 4: lens error => its own reason, even when the claim has a verdict", () => {
  const c = addClaim({});
  confirm(c);
  opRecordLensError({ run_id: runId, claim_id: c, lens: "chokepoint-mapper", error: "crashed" });
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "INDETERMINATE");
  assert.ok(g.indeterminate_reasons.includes(`lens-error:chokepoint-mapper@${c}`));
});

test("limb 1: REFUTED => BLOCK, substantive", () => {
  const c = addClaim({});
  refute(c);
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "BLOCK");
  assert.equal(g.blocking_claims.length, 1);
  assert.equal(g.blocking_claims[0].category, "substantive");
  assert.deepEqual(g.blocking_claims[0].reasons, ["REFUTED"]);
  assert.equal(g.blocking_summary.substantive, 1);
  assert.equal(g.blocking_summary.procedural, 0);
});

test("limb 2: CONFIRMED safety claim with no adverse-state test still BLOCKs (procedural)", () => {
  const c = addClaim({ text: "no data loss", type: "safety" });
  confirm(c);
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "BLOCK");
  assert.equal(g.blocking_claims[0].category, "procedural");
  assert.deepEqual(g.blocking_claims[0].reasons, ["no-adverse-state-test"]);
});

test("limb 2 clears when the adverse-state test exists", () => {
  const c = addClaim({ text: "no data loss", type: "safety" });
  confirm(c, { adverse_state_test: { exists: true, test_ref: "t.py::t", reason: "red on violation" } });
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "PASS");
});

test("limb 3: UNTESTABLE unwaived BLOCKs; waiver clears under blocking-with-waiver", () => {
  const c = addClaim({});
  opRecordVerdict({ run_id: runId, claim_id: c, lens: "correspondence-auditor", verdict: "UNTESTABLE", evidence: ["cannot decide statically"] });
  let g = opGate({ run_id: runId });
  assert.equal(g.verdict, "BLOCK");
  assert.deepEqual(g.blocking_claims[0].reasons, ["UNTESTABLE-unwaived"]);
  opWaive({ run_id: runId, claim_id: c, by: "colombod", reason: "needs a human call, accepted" });
  g = opGate({ run_id: runId });
  assert.equal(g.verdict, "PASS");
});

test("policy blocking: waiver recorded but clears nothing", () => {
  const strict = opStartRun({ gate_policy: "blocking" }).run_id;
  const c = opAddClaim({ run_id: strict, text: "x", type: "correspondence", source: "commit:a", inferred: false }).claim_id;
  opRecordVerdict({ run_id: strict, claim_id: c, lens: "l", verdict: "UNTESTABLE", evidence: ["reason"] });
  opWaive({ run_id: strict, claim_id: c, by: "b", reason: "r" });
  const g = opGate({ run_id: strict });
  assert.equal(g.verdict, "BLOCK");
});

test("policy advisory: limbs 1-3 report instead of blocking, but INDETERMINATE stays", () => {
  const c = addClaim({});
  refute(c);
  let g = opGate({ run_id: runId, gate_policy: "advisory" });
  assert.equal(g.verdict, "PASS");
  assert.equal(g.blocking_claims.length, 1); // still reported

  const pending = addClaim({ text: "another thing", type: "coverage" });
  g = opGate({ run_id: runId, gate_policy: "advisory" });
  assert.equal(g.verdict, "INDETERMINATE");
  assert.ok(g.indeterminate_reasons.includes(`claim-pending:${pending}`));
});

test("a claim carrying limbs 1 and 2 appears ONCE with reasons grouped", () => {
  const c = addClaim({ text: "no corruption", type: "safety" });
  refute(c);
  const g = opGate({ run_id: runId });
  assert.equal(g.blocking_claims.length, 1);
  assert.deepEqual(g.blocking_claims[0].reasons.sort(), ["REFUTED", "no-adverse-state-test"]);
  assert.equal(g.blocking_claims[0].category, "substantive"); // substantive wins the label
  assert.equal(g.blocking_summary.total_claims_blocked, 1);
});

test("coverage counts harvested/verified/waived", () => {
  const a = addClaim({});
  const b = addClaim({ text: "b is tested", type: "coverage" });
  confirm(a);
  opRecordVerdict({ run_id: runId, claim_id: b, lens: "l", verdict: "UNTESTABLE", evidence: ["reason"] });
  opWaive({ run_id: runId, claim_id: b, by: "x", reason: "y" });
  const g = opGate({ run_id: runId });
  assert.deepEqual(g.coverage, { harvested: 2, verified: 2, probed: 0, deferred: 0, waived: 1 });
});

test("INDETERMINATE wins over BLOCK", () => {
  const c = addClaim({});
  refute(c);
  addClaim({ text: "pending one", type: "coverage" });
  const g = opGate({ run_id: runId });
  assert.equal(g.verdict, "INDETERMINATE");
});

test("gate validates run and policy", () => {
  assert.equal(opGate({ run_id: "run_deadbeef" }).error, "run_not_found");
  assert.equal(opGate({ run_id: runId, gate_policy: "vibes" }).error, "invalid_input");
});

test("report = gate + matrix from one read; gate errors pass through unchanged", () => {
  const c = addClaim({ text: "no loss", type: "safety" });
  refute(c);
  const r = opReport({ run_id: runId });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "BLOCK");
  assert.ok(typeof r.matrix === "string" && r.matrix.includes("| Claim |"));
  assert.ok(r.matrix.includes("Coverage:"));
  const bad = opReport({ run_id: "run_deadbeef" });
  assert.equal(bad.error, "run_not_found");
});
