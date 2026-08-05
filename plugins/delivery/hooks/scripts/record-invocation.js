#!/usr/bin/env node
// harden-05 — record real Skill/Agent tool-call outcomes to a per-session,
// per-project ledger. Registered on PostToolUse and PostToolUseFailure
// (see ../hooks.json). This is the "determination" half of ADR-001: it exists
// so an invoked/not-invoked status (harden-06, /delivery:status) never has to
// trust the orchestrating agent's own narration.
//
// Binding constraint (do not relax): never write raw tool_input. Only the
// whitelisted fields below. This ledger is git-tracked with the project, and
// raw tool_input on other tool types can carry file contents or secrets.
//
// Binding constraint (do not relax): this hook only observes. It must never
// throw an uncaught error or exit non-zero for any reason — the entire body
// runs inside one top-level try/catch. Per current Claude Code docs, neither
// PostToolUse nor PostToolUseFailure can block a tool call regardless of exit
// code (both fire only after the tool has already resolved) — this script's
// own exit-0 guarantee is a second, independent line of defense, not a
// substitute for that platform behavior.
//
// Field names below (session_id, tool_name, tool_input, tool_use_id,
// tool_result, cwd, hook_event_name) are confirmed against current Claude
// Code docs (code.claude.com/docs/en/hooks) as of 2026-08-05. The exact
// firing-reliability rate across many real invocations, and any race with a
// same-session status read, is NOT independently re-verified in this file —
// that empirical spike needs a fresh session with this hook already
// registered before it starts (see harden-02's story). Re-run that spike
// after any Claude Code upgrade, per architecture.md's own risk register.

const fs = require('fs');
const path = require('path');

function findDeliveryRoot(startDir) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, '.delivery');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

function invokedNameFrom(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolName === 'Skill') return toolInput.skill || null;
  if (toolName === 'Agent') return toolInput.subagent_type || null;
  return null;
}

function buildRecord(payload) {
  const toolName = payload.tool_name || null;
  const hookEvent = payload.hook_event_name || null;
  const outcome = hookEvent === 'PostToolUseFailure' ? 'error' : 'success';

  return {
    ts: new Date().toISOString(),
    session_id: payload.session_id || null,
    hook_event: hookEvent,
    tool_name: toolName,
    invoked_name: invokedNameFrom(toolName, payload.tool_input),
    tool_use_id: payload.tool_use_id || null,
    outcome,
    cwd: payload.cwd || null,
  };
}

function recordInvocation(payload, options) {
  const cwdForResolution = (options && options.cwd) || payload.cwd || process.cwd();

  // Only Skill and Agent tool calls are governed-artifact-relevant; ignore
  // everything else even if hooks.json's matcher ever widens.
  if (payload.tool_name !== 'Skill' && payload.tool_name !== 'Agent') return null;

  const deliveryRoot = findDeliveryRoot(cwdForResolution);
  if (!deliveryRoot) return null; // nothing governed here yet — no-op, not an error

  const sessionId = payload.session_id || 'unknown-session';
  const ledgerDir = path.join(deliveryRoot, 'invocations');
  const ledgerPath = path.join(ledgerDir, `${sessionId}.ndjson`);

  const record = buildRecord(payload);

  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(record) + '\n');
  return { ledgerPath, record };
}

function main() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw) return;
    const payload = JSON.parse(raw);
    recordInvocation(payload);
  } catch (err) {
    // Never propagate. This hook only logs; a logging failure is not the
    // observed tool call's problem.
  }
}

if (require.main === module) {
  main();
}

module.exports = { findDeliveryRoot, invokedNameFrom, buildRecord, recordInvocation };
