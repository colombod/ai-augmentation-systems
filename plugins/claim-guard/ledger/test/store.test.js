import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newRunId, loadRun, saveRun, listRunIds, repoRoot } from "../.build/store.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-store-"));
  process.env.CLAIM_GUARD_REPO = tmp;
});

test("repoRoot honors CLAIM_GUARD_REPO", () => {
  assert.equal(repoRoot(), tmp);
});

test("saveRun/loadRun roundtrip; unknown id loads null", () => {
  const run = {
    run_id: newRunId(),
    gate_policy: "blocking-with-waiver",
    created_at: new Date().toISOString(),
    claims: [],
    debate: [],
    audit: [],
  };
  saveRun(run);
  const back = loadRun(run.run_id);
  assert.deepEqual(back, run);
  assert.equal(loadRun("run_deadbeef"), null);
});

test("write confinement: everything lands under <repo>/.claim-guard/", () => {
  const run = {
    run_id: newRunId(),
    gate_policy: "advisory",
    created_at: new Date().toISOString(),
    claims: [],
    debate: [],
    audit: [],
  };
  saveRun(run);
  const created = fs.readdirSync(tmp);
  assert.deepEqual(created, [".claim-guard"]);
  assert.ok(fs.existsSync(path.join(tmp, ".claim-guard", run.run_id, "ledger.json")));
});

test("listRunIds sees saved runs; empty repo lists none", () => {
  assert.deepEqual(listRunIds(), []);
  const a = { run_id: newRunId(), gate_policy: "blocking", created_at: "t", claims: [], debate: [], audit: [] };
  saveRun(a);
  assert.deepEqual(listRunIds(), [a.run_id]);
});

test("run ids have shape run_<8hex> and are unique", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^run_[0-9a-f]{8}$/);
});
