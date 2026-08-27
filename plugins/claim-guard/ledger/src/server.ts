// claim_ledger MCP stdio server — the trust anchor of the claim-guard plugin.
// One tool, dispatched by `operation`; every structural guarantee (worst-wins,
// evidence enforcement, the ratchet, the gate rule) lives behind this seam.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  opActivateGuard,
  opAddClaim,
  opAddClaims,
  opAggregate,
  opDeactivateGuard,
  opGate,
  opListClaims,
  opListRuns,
  opRecordDebate,
  opRecordLensError,
  opRecordVerdict,
  opRenderMatrix,
  opReport,
  opStartRun,
  opWaive,
} from "./ops.js";
import type { OpResult } from "./types.js";

const OPERATIONS = {
  start_run: opStartRun,
  add_claim: opAddClaim,
  add_claims: opAddClaims,
  list_claims: opListClaims,
  list_runs: opListRuns,
  record_verdict: opRecordVerdict,
  record_lens_error: opRecordLensError,
  record_debate: opRecordDebate,
  waive: opWaive,
  aggregate: opAggregate,
  gate: opGate,
  render_matrix: opRenderMatrix,
  report: opReport,
  activate_guard: opActivateGuard,
  deactivate_guard: opDeactivateGuard,
} as const;

type OperationName = keyof typeof OPERATIONS;

const DESCRIPTION = `Deterministic claim-verification ledger — the trust anchor of the claim-guard gate. Records harvested claims and per-lens verdicts, enforces file:line evidence and the REFUTED evidence ratchet structurally, aggregates worst-wins (REFUTED > UNTESTABLE > CONFIRMED > N/A), and computes the BLOCK / PASS / INDETERMINATE gate verdict mechanically — never by an LLM.

Operations: ${Object.keys(OPERATIONS).join(", ")}.

Storage under .claim-guard/ is PRIVATE to this tool — read the ledger only via list_claims / report, never by opening the files. Concierge flow: start_run -> add_claims (one bulk call, literal run_id) -> lenses record_verdict (each with the literal run_id) -> report.`;

async function main(): Promise<void> {
  const server = new McpServer({ name: "claim-ledger", version: "0.1.0" });

  server.registerTool(
    "claim_ledger",
    {
      description: DESCRIPTION,
      inputSchema: {
        operation: z.enum(Object.keys(OPERATIONS) as [OperationName, ...OperationName[]]),
        run_id: z.string().optional(),
        claim_id: z.string().optional(),
        text: z.string().optional(),
        type: z.string().optional(),
        source: z.string().optional(),
        inferred: z.boolean().optional(),
        basis: z.string().optional(),
        quote: z.string().optional(),
        claims: z.array(z.record(z.unknown())).optional(),
        lens: z.string().optional(),
        verdict: z.string().optional(),
        evidence: z.array(z.string()).optional(),
        counter_case: z.string().optional(),
        adverse_state_test: z.record(z.unknown()).optional(),
        round: z.number().optional(),
        to_lens: z.string().optional(),
        relayed_payload: z.string().optional(),
        from_lenses: z.array(z.string()).optional(),
        by: z.string().optional(),
        reason: z.string().optional(),
        error: z.string().optional(),
        gate_policy: z.string().optional(),
        format: z.string().optional(),
        stranded_only: z.boolean().optional(),
        aggregate: z.string().optional(),
      },
    },
    async (args: Record<string, unknown>) => {
      const { operation, ...input } = args;
      let result: OpResult;
      try {
        const handler = OPERATIONS[operation as OperationName];
        result = handler
          ? handler(input as never)
          : { ok: false, error: "unknown_operation", message: `unknown operation: ${String(operation)}` };
      } catch (e) {
        result = { ok: false, error: "internal_error", message: e instanceof Error ? e.message : String(e) };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("claim-ledger server failed:", e);
  process.exit(1);
});
