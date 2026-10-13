import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../.build/aggregate.js";

const v = (verdict, lens = "l") => ({ lens, verdict, evidence: [], counter_case: null, round: 1, recorded_at: "t" });

test("worst-wins precedence pairs", () => {
  assert.equal(aggregate({ verdicts: [v("CONFIRMED"), v("REFUTED", "m")] }), "REFUTED");
  assert.equal(aggregate({ verdicts: [v("REFUTED"), v("UNTESTABLE", "m")] }), "REFUTED");
  assert.equal(aggregate({ verdicts: [v("UNTESTABLE"), v("CONFIRMED", "m")] }), "UNTESTABLE");
  assert.equal(aggregate({ verdicts: [v("CONFIRMED"), v("N/A", "m")] }), "CONFIRMED");
  assert.equal(aggregate({ verdicts: [v("N/A"), v("N/A", "m")] }), "N/A");
});

test("zero verdicts => PENDING, never a pass", () => {
  assert.equal(aggregate({ verdicts: [] }), "PENDING");
});

test("an abstention never lowers an aggregate", () => {
  assert.equal(aggregate({ verdicts: [v("CONFIRMED"), v("N/A", "m"), v("N/A", "n")] }), "CONFIRMED");
});
