// The gate rule — pure computation over the ledger. Never averages, never
// softens, never infers intent. INDETERMINATE is never downgraded by policy:
// an incomplete run must never read as a pass.
import type { ClaimRecord, GatePolicy, RunRecord } from "./types.js";

export interface BlockingClaim {
  claim_id: string;
  text: string;
  category: "substantive" | "procedural";
  reasons: string[];
}

export interface GateResult {
  verdict: "PASS" | "BLOCK" | "INDETERMINATE";
  blocking_claims: BlockingClaim[];
  indeterminate_reasons: string[];
  coverage: {
    harvested: number;
    verified: number;
    probed: number;
    deferred: number;
    waived: number;
  };
  blocking_summary: {
    substantive: number;
    procedural: number;
    total_claims_blocked: number;
  };
}

function blockingReasons(claim: ClaimRecord): string[] {
  const reasons: string[] = [];
  // limb 1 — a false claim (substantive)
  if (claim.aggregate === "REFUTED") reasons.push("REFUTED");
  // limb 2 — safety claim without a red-on-violation test, independent of limb 1
  if (claim.type === "safety" && !claim.adverse_state_test.exists) {
    reasons.push("no-adverse-state-test");
  }
  // limb 3 — undecidable claim. Whether a recorded waiver clears it is the
  // POLICY's decision (blocking-with-waiver only), not the limb's.
  if (claim.aggregate === "UNTESTABLE") {
    reasons.push("UNTESTABLE-unwaived");
  }
  return reasons;
}

export function computeGate(run: RunRecord, policyOverride?: GatePolicy): GateResult {
  const policy = policyOverride ?? run.gate_policy;

  const indeterminate: string[] = [];
  // limb 5 — an empty claim list is a harvest failure, not a clean bill of health
  if (run.claims.length === 0) indeterminate.push("zero-claims-harvested");
  for (const claim of run.claims) {
    // limb 4 — never ruled on at all
    if (claim.aggregate === "PENDING") indeterminate.push(`claim-pending:${claim.claim_id}`);
    // limb 4 — a broken verification is a distinct signal from "not looked at"
    for (const le of claim.lens_errors) {
      indeterminate.push(`lens-error:${le.lens}@${claim.claim_id}`);
    }
  }

  const blocking: BlockingClaim[] = [];
  for (const claim of run.claims) {
    const reasons = blockingReasons(claim);
    if (reasons.length === 0) continue;
    // blocking-with-waiver: a recorded waiver clears this claim's limbs 1-3
    // contribution. (Tool reach, stated plainly: it clears ANY limb, including
    // a REFUTED — only ever waive a procedural block; that discipline lives in
    // the concierge skill, not here.)
    if (policy === "blocking-with-waiver" && claim.waiver) continue;
    blocking.push({
      claim_id: claim.claim_id,
      text: claim.text,
      category: reasons.includes("REFUTED") ? "substantive" : "procedural",
      reasons,
    });
  }

  const coverage = {
    harvested: run.claims.length,
    verified: run.claims.filter((c) => c.aggregate !== "PENDING").length,
    probed: 0,
    deferred: run.claims.filter((c) => c.probe_eligibility === "deferred").length,
    waived: run.claims.filter((c) => c.waiver !== null).length,
  };

  const blocking_summary = {
    substantive: blocking.filter((b) => b.category === "substantive").length,
    procedural: blocking.filter((b) => b.category === "procedural").length,
    total_claims_blocked: blocking.length,
  };

  let verdict: GateResult["verdict"];
  if (indeterminate.length > 0) verdict = "INDETERMINATE";
  else if (blocking.length > 0 && policy !== "advisory") verdict = "BLOCK";
  else verdict = "PASS";

  return {
    verdict,
    blocking_claims: blocking,
    indeterminate_reasons: indeterminate,
    coverage,
    blocking_summary,
  };
}
