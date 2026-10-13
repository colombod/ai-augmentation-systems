// Worst-wins aggregation — deterministic, never an LLM.
// Precedence: REFUTED > UNTESTABLE > CONFIRMED > N/A.
// Zero recorded verdicts => PENDING (a gap must never read as a pass).
import type { Aggregate, ClaimRecord } from "./types.js";

export function aggregate(claim: Pick<ClaimRecord, "verdicts">): Aggregate {
  const verdicts = claim.verdicts.map((v) => v.verdict);
  if (verdicts.length === 0) return "PENDING";
  if (verdicts.includes("REFUTED")) return "REFUTED";
  if (verdicts.includes("UNTESTABLE")) return "UNTESTABLE";
  if (verdicts.includes("CONFIRMED")) return "CONFIRMED";
  return "N/A";
}
