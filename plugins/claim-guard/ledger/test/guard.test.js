import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { opActivateGuard, opDeactivateGuard } from "../.build/ops.js";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-guard-"));
  process.env.CLAIM_GUARD_REPO = tmp;
});

const marker = () => path.join(tmp, ".claim-guard", "GUARD_ACTIVE");

test("activate_guard writes the marker exactly at .claim-guard/GUARD_ACTIVE, idempotently", () => {
  const r = opActivateGuard({});
  assert.equal(r.ok, true);
  assert.equal(r.active, true);
  assert.ok(fs.existsSync(marker()));
  const again = opActivateGuard({});
  assert.equal(again.ok, true);
});

test("deactivate_guard removes the marker, idempotently", () => {
  opActivateGuard({});
  const r = opDeactivateGuard({});
  assert.equal(r.ok, true);
  assert.equal(r.active, false);
  assert.equal(fs.existsSync(marker()), false);
  const again = opDeactivateGuard({});
  assert.equal(again.ok, true);
});
