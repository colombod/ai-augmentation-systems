// Shared types and constants for the claim_ledger trust anchor.
// Contract: docs/superpowers/specs/2026-08-27-claim-guard-plugin-design.md
// (ported from amplifier-bundle-claim-guard docs/tool-claim-ledger-contract.md).

export const CLAIM_TYPES = [
  "correspondence",
  "safety",
  "quantitative",
  "temporal",
  "concurrency",
  "coverage",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VERDICTS = ["CONFIRMED", "REFUTED", "UNTESTABLE", "N/A"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Aggregate = Verdict | "PENDING";

export const GATE_POLICIES = [
  "advisory",
  "blocking-with-waiver",
  "blocking",
] as const;
export type GatePolicy = (typeof GATE_POLICIES)[number];

export const DEFAULT_GATE_POLICY: GatePolicy = "blocking-with-waiver";

// Claim types whose truth needs behavioural proof (Phase 2). Static-only build:
// the field is set at add_claim time and read by nothing else yet.
export const PROBE_ELIGIBLE_TYPES: ReadonlySet<string> = new Set([
  "safety",
  "quantitative",
  "temporal",
  "concurrency",
]);

export interface VerdictRecord {
  lens: string;
  verdict: Verdict;
  evidence: string[];
  counter_case: string | null;
  round: number;
  recorded_at: string;
}

export interface LensError {
  lens: string;
  error: string;
  recorded_at: string;
}

export interface AdverseStateTest {
  exists: boolean;
  test_ref: string | null;
  reason: string | null;
}

export interface Waiver {
  by: string;
  reason: string;
  at: string;
}

export interface ClaimRecord {
  claim_id: string;
  text: string;
  type: ClaimType;
  source: string;
  inferred: boolean;
  basis: string | null;
  quote: string | null;
  verdicts: VerdictRecord[];
  aggregate: Aggregate;
  adverse_state_test: AdverseStateTest;
  // Phase-2 schema (present from day one, unfilled in the static-only build):
  probe_eligibility: "not_eligible" | "eligible" | "deferred";
  probe: null;
  standing_test: null;
  waiver: Waiver | null;
  lens_errors: LensError[];
}

export interface DebateRecord {
  round: number;
  to_lens: string;
  relayed_payload: string;
  from_lenses: string[];
  recorded_at: string;
}

export interface AuditRecord {
  type: "ratchet_rejection";
  lens: string;
  claim_id: string;
  message: string;
  at: string;
}

export interface RunRecord {
  run_id: string;
  gate_policy: GatePolicy;
  created_at: string;
  claims: ClaimRecord[];
  debate: DebateRecord[];
  audit: AuditRecord[];
}

export type OpResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string; message: string };

export function err(error: string, message: string): OpResult {
  return { ok: false, error, message };
}
