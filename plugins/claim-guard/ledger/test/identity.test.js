import { test } from "node:test";
import assert from "node:assert/strict";
import { claimId } from "../.build/identity.js";

test("reword-stable: case, unicode quotes, articles, contractions do not fork identity", () => {
  const a = claimId("The server won’t corrupt data", "safety", "commit");
  const b = claimId("the server will not corrupt data", "safety", "commit");
  assert.equal(a, b);
});

test("negation is never stripped", () => {
  assert.notEqual(
    claimId("the cache is cleared on boot", "correspondence", "commit"),
    claimId("the cache is not cleared on boot", "correspondence", "commit"),
  );
});

test("numbers are preserved and distinguish claims", () => {
  assert.notEqual(
    claimId("stays under 100ms", "quantitative", "commit"),
    claimId("stays under 200ms", "quantitative", "commit"),
  );
});

test("backticks fold but identifiers survive (casefolded)", () => {
  const a = claimId("`max_delete` is validated", "safety", "commit");
  const b = claimId("max_delete is validated", "safety", "commit");
  assert.equal(a, b);
});

test("type-sensitive: same text, different type, different id", () => {
  assert.notEqual(
    claimId("retries are bounded", "safety", "commit"),
    claimId("retries are bounded", "quantitative", "commit"),
  );
});

test("source-sensitive: same text and type, different source path, different id", () => {
  assert.notEqual(
    claimId("retries are bounded", "safety", "commit"),
    claimId("retries are bounded", "safety", "pr-body"),
  );
});

test("embedded file:line trailing line number is stripped in code spans", () => {
  assert.equal(
    claimId("guard lives at registry.py:648", "correspondence", "commit"),
    claimId("guard lives at registry.py:9", "correspondence", "commit"),
  );
});

test("boilerplate lead-in folds away", () => {
  assert.equal(
    claimId("the code ensures that retries are bounded", "safety", "commit"),
    claimId("retries are bounded", "safety", "commit"),
  );
});

test("id shape is clm_<8hex>", () => {
  assert.match(claimId("x", "coverage", "pr-body"), /^clm_[0-9a-f]{8}$/);
});
