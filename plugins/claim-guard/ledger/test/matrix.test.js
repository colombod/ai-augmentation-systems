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
  opRenderMatrix,
} from "../.build/ops.js";

let runId;
beforeEach(() => {
  process.env.CLAIM_GUARD_REPO = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-matrix-"));
  runId = opStartRun({}).run_id;
});

test("markdown matrix: exact column header, coverage line, lens-error cell", () => {
  const a = opAddClaim({ run_id: runId, text: "no loss on degraded boot", type: "safety", source: "commit:abc", inferred: true, basis: "implied by purpose" }).claim_id;
  opRecordVerdict({
    run_id: runId, claim_id: a, lens: "boundary-adversary", verdict: "REFUTED",
    evidence: ["registry.py:648"], counter_case: "boot with schema_health=degraded then MERGE",
  });
  opRecordLensError({ run_id: runId, claim_id: a, lens: "chokepoint-mapper", error: "crashed" });

  const r = opRenderMatrix({ run_id: runId, format: "markdown" });
  assert.equal(r.ok, true);
  const lines = r.content.split("\n");
  assert.equal(
    lines[0],
    "| Claim | Type | Source (inferred?) | Verdict | Evidence (file:line) | Counter-case | Adverse-state test | Lens errors |",
  );
  assert.ok(r.content.includes("commit:abc (inferred)"));
  assert.ok(r.content.includes("REFUTED"));
  assert.ok(r.content.includes("registry.py:648"));
  assert.ok(r.content.includes("chokepoint-mapper: crashed"));
  assert.ok(r.content.includes("Coverage: harvested 1 / verified 1 / probed 0 / deferred 0 / waived 0"));
});

test("markdown matrix: dash cells when empty; adverse-state yes/no", () => {
  const a = opAddClaim({ run_id: runId, text: "plain claim", type: "coverage", source: "pr-body", inferred: false }).claim_id;
  opRecordVerdict({ run_id: runId, claim_id: a, lens: "test-correspondence-auditor", verdict: "CONFIRMED", evidence: ["t.py:3"], adverse_state_test: { exists: true, test_ref: "t.py::x", reason: "red on violation" } });
  const r = opRenderMatrix({ run_id: runId, format: "markdown" });
  const row = r.content.split("\n").find((l) => l.includes("plain claim"));
  assert.ok(row.includes("| yes |"));
  assert.ok(row.endsWith("| - |"));
});

test("json format returns the raw run record", () => {
  opAddClaim({ run_id: runId, text: "x", type: "coverage", source: "pr-body", inferred: false });
  const r = opRenderMatrix({ run_id: runId, format: "json" });
  assert.equal(r.ok, true);
  assert.equal(r.content.run_id, runId);
  assert.equal(r.content.claims.length, 1);
});

test("invalid format rejected", () => {
  assert.equal(opRenderMatrix({ run_id: runId, format: "xml" }).error, "invalid_input");
});
