// Operation handlers for the claim_ledger tool. Every handler returns
// { ok: true, ... } or { ok: false, error, message } — never throws across the
// tool boundary.
import fs from "node:fs";
import { aggregate } from "./aggregate.js";
import { computeGate } from "./gate.js";
import { claimId } from "./identity.js";
import { renderMarkdownMatrix } from "./matrix.js";
import {
  guardMarkerPath,
  ledgerRoot,
  listRunIds,
  loadRun,
  newRunId,
  saveRun,
} from "./store.js";
import {
  CLAIM_TYPES,
  DEFAULT_GATE_POLICY,
  GATE_POLICIES,
  PROBE_ELIGIBLE_TYPES,
  err,
  type ClaimRecord,
  type ClaimType,
  type GatePolicy,
  type OpResult,
  type RunRecord,
  type VerdictRecord,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function newRunRecord(gatePolicy: GatePolicy): RunRecord {
  return {
    run_id: newRunId(),
    gate_policy: gatePolicy,
    created_at: now(),
    claims: [],
    debate: [],
    audit: [],
  };
}

function requireRun(runId: unknown): RunRecord | OpResult {
  if (typeof runId !== "string" || runId === "") {
    return err("invalid_input", "run_id is required");
  }
  const run = loadRun(runId);
  if (!run) return err("run_not_found", `no run ${runId}`);
  return run;
}

function isRun(x: RunRecord | OpResult): x is RunRecord {
  return (x as RunRecord).run_id !== undefined && (x as { ok?: boolean }).ok === undefined;
}

function requireClaim(run: RunRecord, claimIdArg: unknown): ClaimRecord | OpResult {
  if (typeof claimIdArg !== "string" || claimIdArg === "") {
    return err("invalid_input", "claim_id is required");
  }
  const claim = run.claims.find((c) => c.claim_id === claimIdArg);
  if (!claim) return err("claim_not_found", `no claim ${claimIdArg} in ${run.run_id}`);
  return claim;
}

function isClaim(x: ClaimRecord | OpResult): x is ClaimRecord {
  return (x as ClaimRecord).claim_id !== undefined && (x as { ok?: boolean }).ok === undefined;
}

// ---------------------------------------------------------------- start_run

export function opStartRun(input: { gate_policy?: string }): OpResult {
  const policy = input.gate_policy ?? DEFAULT_GATE_POLICY;
  if (!GATE_POLICIES.includes(policy as GatePolicy)) {
    return err("invalid_input", `unknown gate_policy: ${input.gate_policy}`);
  }
  const run = newRunRecord(policy as GatePolicy);
  saveRun(run);
  return { ok: true, run_id: run.run_id, gate_policy: run.gate_policy };
}

// ---------------------------------------------------------------- add_claim

interface AddClaimInput {
  run_id?: string;
  text?: unknown;
  type?: unknown;
  source?: unknown;
  inferred?: unknown;
  basis?: unknown;
  quote?: unknown;
}

function validateClaimFields(input: AddClaimInput): OpResult | null {
  if (typeof input.text !== "string" || input.text.trim() === "") {
    return err("invalid_input", "text is required");
  }
  if (!CLAIM_TYPES.includes(input.type as ClaimType)) {
    return err("invalid_input", `unknown claim type: ${String(input.type)}`);
  }
  if (typeof input.source !== "string" || input.source === "") {
    return err("invalid_input", "source is required");
  }
  if (typeof input.inferred !== "boolean") {
    return err("invalid_input", "inferred must be a boolean");
  }
  return null;
}

// Identity uses only the FILE relpath embedded in the source (upstream F-9:
// "repo_relpath_of(source)", line numbers excluded). Non-file sources (commit,
// pr-body, council-verdict) contribute no path, so the same claim harvested
// from two prose sources keeps one identity.
function sourceRelPath(source: string): string {
  const m = source.match(/([^:\s]+\.[A-Za-z0-9]{1,8})(?::\d+)?/);
  return m ? m[1] : "";
}

function addClaimToRun(run: RunRecord, input: AddClaimInput): OpResult {
  const invalid = validateClaimFields(input);
  if (invalid) return invalid;
  const text = input.text as string;
  const type = input.type as ClaimType;
  const source = input.source as string;
  const id = claimId(text, type, sourceRelPath(source));

  const existing = run.claims.find((c) => c.claim_id === id);
  if (existing) {
    // Idempotent re-add: update provenance, never reset verdicts.
    existing.source = source;
    existing.basis = (input.basis as string | null) ?? existing.basis;
    existing.quote = (input.quote as string | null) ?? existing.quote;
    existing.inferred = input.inferred as boolean;
    return { ok: true, claim_id: id, run_id: run.run_id, was_new: false };
  }

  const claim: ClaimRecord = {
    claim_id: id,
    text,
    type,
    source,
    inferred: input.inferred as boolean,
    basis: (input.basis as string | null) ?? null,
    quote: (input.quote as string | null) ?? null,
    verdicts: [],
    aggregate: "PENDING",
    adverse_state_test: { exists: false, test_ref: null, reason: null },
    probe_eligibility: PROBE_ELIGIBLE_TYPES.has(type) ? "eligible" : "not_eligible",
    probe: null,
    standing_test: null,
    waiver: null,
    lens_errors: [],
  };
  run.claims.push(claim);
  return { ok: true, claim_id: id, run_id: run.run_id, was_new: true };
}

export function opAddClaim(input: AddClaimInput): OpResult {
  let run: RunRecord;
  if (!input.run_id) {
    // Auto-create a run — the add_claims threading path rides this.
    const invalid = validateClaimFields(input);
    if (invalid) return invalid;
    run = newRunRecord(DEFAULT_GATE_POLICY);
  } else {
    const found = requireRun(input.run_id);
    if (!isRun(found)) return found;
    run = found;
  }
  const result = addClaimToRun(run, input);
  if (result.ok) saveRun(run);
  return result;
}

// ---------------------------------------------------------------- add_claims

export function opAddClaims(input: { run_id?: string; claims?: unknown }): OpResult {
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    return err("invalid_input", "claims must be a non-empty array");
  }
  let run: RunRecord | null = null;
  if (input.run_id) {
    const found = requireRun(input.run_id);
    if (!isRun(found)) return found;
    run = found;
  }
  const results: Array<{ claim_id: string; was_new: boolean }> = [];
  const errors: Array<{ index: number; error: string; message: string }> = [];
  let added = 0;
  let updated = 0;

  input.claims.forEach((element, index) => {
    const claimInput = (element ?? {}) as AddClaimInput;
    const invalid = validateClaimFields(claimInput);
    if (invalid && invalid.ok === false) {
      errors.push({ index, error: invalid.error, message: invalid.message });
      return; // a malformed element never aborts the batch
    }
    if (!run) run = newRunRecord(DEFAULT_GATE_POLICY);
    const r = addClaimToRun(run, claimInput);
    if (r.ok === false) {
      errors.push({ index, error: r.error, message: r.message });
      return;
    }
    const okR = r as { ok: true; claim_id: string; was_new: boolean };
    results.push({ claim_id: okR.claim_id, was_new: okR.was_new });
    if (okR.was_new) added += 1;
    else updated += 1;
  });

  if (!run) {
    // every element malformed — nothing created
    return { ok: true, run_id: input.run_id ?? null, results, added, updated, errors };
  }
  saveRun(run);
  return { ok: true, run_id: (run as RunRecord).run_id, results, added, updated, errors };
}

// ---------------------------------------------------------------- list_claims

export function opListClaims(input: { run_id?: string; type?: string; aggregate?: string }): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  let claims = found.claims;
  if (input.type) claims = claims.filter((c) => c.type === input.type);
  if (input.aggregate) claims = claims.filter((c) => c.aggregate === input.aggregate);
  return { ok: true, run_id: found.run_id, claims, count: claims.length };
}

// ---------------------------------------------------------------- list_runs

export function opListRuns(input: { stranded_only?: boolean }): OpResult {
  const summaries = listRunIds()
    .map((id) => loadRun(id))
    .filter((run): run is RunRecord => run !== null)
    .map((run) => {
      const pending = run.claims.filter((c) => c.aggregate === "PENDING").length;
      return {
        run_id: run.run_id,
        created_at: run.created_at,
        gate_policy: run.gate_policy,
        claims: run.claims.length,
        pending,
        stranded: run.claims.length > 0 && pending > 0,
      };
    });
  const strandedCount = summaries.filter((s) => s.stranded).length;
  const runs = input.stranded_only ? summaries.filter((s) => s.stranded) : summaries;
  return { ok: true, runs, count: runs.length, stranded_count: strandedCount };
}

// ---------------------------------------------------------------- record_verdict
// Structural enforcement (evidence, counter-case, ratchet) is layered in with
// its own tests — see verdicts.test.js.

export function opRecordVerdict(input: {
  run_id?: string;
  claim_id?: string;
  lens?: string;
  verdict?: string;
  evidence?: unknown;
  counter_case?: unknown;
  adverse_state_test?: unknown;
  round?: unknown;
}): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  const claim = requireClaim(found, input.claim_id);
  if (!isClaim(claim)) return claim;
  if (typeof input.lens !== "string" || input.lens === "") {
    return err("invalid_input", "lens is required");
  }
  if (!["CONFIRMED", "REFUTED", "UNTESTABLE", "N/A"].includes(input.verdict as string)) {
    return err("invalid_input", `unknown verdict: ${String(input.verdict)}`);
  }
  const evidence = Array.isArray(input.evidence) ? (input.evidence as string[]) : [];
  const counterCase =
    typeof input.counter_case === "string" && input.counter_case !== ""
      ? (input.counter_case as string)
      : null;
  const round = typeof input.round === "number" ? (input.round as number) : 1;

  const enforcement = enforceEvidenceRules(claim, {
    lens: input.lens,
    verdict: input.verdict as VerdictRecord["verdict"],
    evidence,
    counter_case: counterCase,
  });
  if (enforcement) {
    if (enforcement.error === "ratchet_violation") {
      found.audit.push({
        type: "ratchet_rejection",
        lens: input.lens,
        claim_id: claim.claim_id,
        message: enforcement.message,
        at: now(),
      });
      saveRun(found); // the rejection itself is auditable
    }
    return enforcement;
  }

  const record: VerdictRecord = {
    lens: input.lens,
    verdict: input.verdict as VerdictRecord["verdict"],
    evidence,
    counter_case: counterCase,
    round,
    recorded_at: now(),
  };
  const priorIndex = claim.verdicts.findIndex((v) => v.lens === input.lens);
  if (priorIndex >= 0) claim.verdicts[priorIndex] = record;
  else claim.verdicts.push(record);

  if (input.adverse_state_test && typeof input.adverse_state_test === "object") {
    const ast = input.adverse_state_test as {
      exists?: unknown;
      test_ref?: unknown;
      reason?: unknown;
    };
    claim.adverse_state_test = {
      exists: ast.exists === true,
      test_ref: typeof ast.test_ref === "string" ? ast.test_ref : null,
      reason: typeof ast.reason === "string" ? ast.reason : null,
    };
  }

  claim.aggregate = aggregate(claim);
  saveRun(found);
  return {
    ok: true,
    claim_id: claim.claim_id,
    lens: input.lens,
    verdict: record.verdict,
    aggregate: claim.aggregate,
  };
}

// file.ext:line anchor shape, e.g. registry.py:648 or src/gate.ts:12
export const ANCHOR_RE = /\S+\.[A-Za-z0-9]{1,8}:\d+/;

function enforceEvidenceRules(
  claim: ClaimRecord,
  next: { lens: string; verdict: VerdictRecord["verdict"]; evidence: string[]; counter_case: string | null },
): (OpResult & { ok: false }) | null {
  const hasAnchor = next.evidence.some((e) => typeof e === "string" && ANCHOR_RE.test(e));

  if (next.verdict === "CONFIRMED" || next.verdict === "REFUTED") {
    if (!hasAnchor) {
      return err(
        "evidence_required",
        `${next.verdict} requires at least one file:line anchor in evidence`,
      ) as OpResult & { ok: false };
    }
  } else {
    const hasReason =
      (next.counter_case && next.counter_case.trim() !== "") ||
      next.evidence.some((e) => typeof e === "string" && e.trim() !== "");
    if (!hasReason) {
      return err(
        "evidence_required",
        `${next.verdict} requires a one-line reason in counter_case or evidence`,
      ) as OpResult & { ok: false };
    }
  }

  if (next.verdict === "REFUTED" && (!next.counter_case || next.counter_case.trim() === "")) {
    return err(
      "counter_case_required",
      "REFUTED requires the input/state/sequence that breaks the claim",
    ) as OpResult & { ok: false };
  }

  // Evidence ratchet: moving away from REFUTED toward CONFIRMED needs at least
  // one anchor not already present anywhere in the claim's existing evidence.
  const priorOwn = claim.verdicts.find((v) => v.lens === next.lens);
  const movingOffRefuted =
    next.verdict === "CONFIRMED" &&
    (claim.aggregate === "REFUTED" || priorOwn?.verdict === "REFUTED");
  if (movingOffRefuted) {
    const known = new Set(
      claim.verdicts.flatMap((v) => v.evidence.flatMap((e) => e.match(new RegExp(ANCHOR_RE, "g")) ?? [])),
    );
    const fresh = next.evidence
      .flatMap((e) => (typeof e === "string" ? e.match(new RegExp(ANCHOR_RE, "g")) ?? [] : []))
      .some((anchor) => !known.has(anchor));
    if (!fresh) {
      return err(
        "ratchet_violation",
        "clearing a REFUTED requires at least one NEW file:line anchor not already cited on this claim",
      ) as OpResult & { ok: false };
    }
  }
  return null;
}

// ---------------------------------------------------------------- aggregate / gate / matrix / report

export function opAggregate(input: { run_id?: string }): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  for (const claim of found.claims) claim.aggregate = aggregate(claim);
  saveRun(found);
  const gateResult = computeGate(found);
  return {
    ok: true,
    run_id: found.run_id,
    claims: found.claims.map((c) => ({
      claim_id: c.claim_id,
      text: c.text,
      type: c.type,
      aggregate: c.aggregate,
      adverse_state_test: c.adverse_state_test,
    })),
    coverage: gateResult.coverage,
  };
}

function validatePolicy(policy: unknown): OpResult | null {
  if (policy !== undefined && !GATE_POLICIES.includes(policy as GatePolicy)) {
    return err("invalid_input", `unknown gate_policy: ${String(policy)}`);
  }
  return null;
}

export function opGate(input: { run_id?: string; gate_policy?: string }): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  const badPolicy = validatePolicy(input.gate_policy);
  if (badPolicy) return badPolicy;
  const result = computeGate(found, input.gate_policy as GatePolicy | undefined);
  return { ok: true, run_id: found.run_id, ...result };
}

export function opRenderMatrix(input: { run_id?: string; format?: string }): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  const format = input.format ?? "markdown";
  if (format !== "markdown" && format !== "json") {
    return err("invalid_input", `unknown format: ${format}`);
  }
  const content = format === "markdown" ? renderMarkdownMatrix(found) : found;
  return { ok: true, run_id: found.run_id, content };
}

// One-call verdict + the matrix that explains it, from the same ledger read —
// a verdict can never ship alongside a matrix from a different state.
export function opReport(input: { run_id?: string; gate_policy?: string; format?: string }): OpResult {
  const gateResult = opGate(input);
  if (gateResult.ok === false) return gateResult;
  const matrixResult = opRenderMatrix(input);
  if (matrixResult.ok === false) return matrixResult;
  const { content } = matrixResult as { ok: true; content: unknown };
  const { ok: _ok, ...gateFields } = gateResult as { ok: true } & Record<string, unknown>;
  return { ok: true, ...gateFields, matrix: content };
}

// ---------------------------------------------------------------- record_lens_error
// A broken verification attempt must be distinguishable from a claim nobody
// looked at yet. Never a verdict; never touches aggregate/adverse_state_test.

export function opRecordLensError(input: {
  run_id?: string;
  claim_id?: string;
  lens?: string;
  error?: string;
}): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  const claim = requireClaim(found, input.claim_id);
  if (!isClaim(claim)) return claim;
  if (typeof input.lens !== "string" || input.lens === "") {
    return err("invalid_input", "lens is required");
  }
  if (typeof input.error !== "string" || input.error === "") {
    return err("invalid_input", "error is required");
  }
  const lensError = { lens: input.lens, error: input.error, recorded_at: now() };
  claim.lens_errors.push(lensError);
  saveRun(found);
  return { ok: true, claim_id: claim.claim_id, run_id: found.run_id, lens: input.lens, lens_error: lensError };
}

// ---------------------------------------------------------------- record_debate

export function opRecordDebate(input: {
  run_id?: string;
  round?: unknown;
  to_lens?: string;
  relayed_payload?: string;
  from_lenses?: unknown;
}): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  if (typeof input.round !== "number") return err("invalid_input", "round must be a number");
  if (typeof input.to_lens !== "string" || input.to_lens === "") {
    return err("invalid_input", "to_lens is required");
  }
  if (typeof input.relayed_payload !== "string" || input.relayed_payload === "") {
    return err("invalid_input", "relayed_payload is required");
  }
  const fromLenses = Array.isArray(input.from_lenses)
    ? (input.from_lenses as string[]).filter((l) => typeof l === "string")
    : [];
  found.debate.push({
    round: input.round,
    to_lens: input.to_lens,
    relayed_payload: input.relayed_payload,
    from_lenses: fromLenses,
    recorded_at: now(),
  });
  saveRun(found);
  return { ok: true, round: input.round, to_lens: input.to_lens };
}

// ---------------------------------------------------------------- waive

export function opWaive(input: {
  run_id?: string;
  claim_id?: string;
  by?: string;
  reason?: string;
}): OpResult {
  const found = requireRun(input.run_id);
  if (!isRun(found)) return found;
  const claim = requireClaim(found, input.claim_id);
  if (!isClaim(claim)) return claim;
  if (typeof input.by !== "string" || input.by === "") {
    return err("invalid_input", "by is required — a waiver is a named human decision");
  }
  if (typeof input.reason !== "string" || input.reason === "") {
    return err("invalid_input", "reason is required");
  }
  claim.waiver = { by: input.by, reason: input.reason, at: now() };
  saveRun(found);
  return { ok: true, claim_id: claim.claim_id, waiver: claim.waiver };
}

// ---------------------------------------------------------------- guard marker

export function opActivateGuard(_input: Record<string, never>): OpResult {
  fs.mkdirSync(ledgerRoot(), { recursive: true });
  fs.writeFileSync(guardMarkerPath(), now() + "\n", "utf8");
  return { ok: true, active: true };
}

export function opDeactivateGuard(_input: Record<string, never>): OpResult {
  try {
    fs.rmSync(guardMarkerPath(), { force: true });
  } catch {
    /* idempotent */
  }
  return { ok: true, active: false };
}
