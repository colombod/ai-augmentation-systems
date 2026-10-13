// Human-facing rendering of the claim-verification matrix. The columns and the
// coverage line are part of the contract — the concierge prints them verbatim.
import type { RunRecord } from "./types.js";
import { computeGate } from "./gate.js";

const HEADER =
  "| Claim | Type | Source (inferred?) | Verdict | Evidence (file:line) | Counter-case | Adverse-state test | Lens errors |";
const SEPARATOR = "|---|---|---|---|---|---|---|---|";

function cell(value: string | null | undefined): string {
  const v = (value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
  return v === "" ? "-" : v;
}

export function renderMarkdownMatrix(run: RunRecord): string {
  const rows = run.claims.map((claim) => {
    const source = claim.inferred ? `${claim.source} (inferred)` : claim.source;
    const evidence = claim.verdicts.flatMap((v) => v.evidence).join("; ");
    const counterCases = claim.verdicts
      .map((v) => v.counter_case)
      .filter((c): c is string => c !== null && c !== "")
      .join("; ");
    const adverse = claim.adverse_state_test.exists ? "yes" : "no";
    const lensErrors = claim.lens_errors.map((e) => `${e.lens}: ${e.error}`).join("; ");
    return [
      cell(claim.text),
      cell(claim.type),
      cell(source),
      cell(claim.aggregate),
      cell(evidence),
      cell(counterCases),
      cell(adverse),
      cell(lensErrors),
    ].join(" | ");
  });

  const { coverage } = computeGate(run);
  const coverageLine = `Coverage: harvested ${coverage.harvested} / verified ${coverage.verified} / probed ${coverage.probed} / deferred ${coverage.deferred} / waived ${coverage.waived}`;

  return [HEADER, SEPARATOR, ...rows.map((r) => `| ${r} |`), "", coverageLine].join("\n");
}
