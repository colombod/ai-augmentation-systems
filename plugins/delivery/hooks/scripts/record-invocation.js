#!/usr/bin/env node
// harden-05 — record real Skill/Agent tool-call outcomes to a per-session,
// per-project ledger. Registered on PostToolUse and PostToolUseFailure
// (see ../hooks.json). This is the "determination" half of ADR-001: it exists
// so an invoked/not-invoked status (harden-06, /delivery:status) never has to
// trust the orchestrating agent's own narration.
//
// harden-03 — also records real capture-tool calls (e.g. a browser
// screenshot action), so FR-9's verification-channel cross-check
// (harden-07) has something real to check a claimed screenshot against.
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
const crypto = require('crypto');

function findDeliveryRootUpward(startDir) {
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

// Resolution is upward only. A downward search used to find a component's .delivery/ below the
// cwd (a marketplace repo root), but it ran a depth-4 directory walk in every session, including
// ordinary non-role ones (3.5 s from $HOME), and appended "ambiguous" records into several unrelated
// repositories. A session records only when it is a delivery role (DELIVERY_ROLE) or works inside a
// project: an upward walk from its cwd finds .delivery/ (see shouldRecord).
function findDeliveryRoot(startDir) {
  const upward = findDeliveryRootUpward(startDir);
  if (upward) return upward;
  // a role session working outside its project tree records into its own project
  const pr = process.env.DELIVERY_ROLE ? process.env.DELIVERY_PROJECT_ROOT : null;
  if (pr && path.isAbsolute(pr)) {
    const c = path.join(pr, '.delivery');
    try { if (fs.statSync(c).isDirectory()) return c; } catch (err) { /* none */ }
  }
  return null;
}

// The gate: the opt-in ledger is on, and this is a delivery role session or a cwd inside a project.
// The ledger is opt-in (DELIVERY_LEDGER=1): without it nothing is written anywhere.
function shouldRecord(cwd) {
  if (process.env.DELIVERY_LEDGER !== '1') return false;
  if (process.env.DELIVERY_ROLE) return true;
  return !!findDeliveryRootUpward(cwd);
}

// harden-03 — capture-tool discrimination (FR-9's channel cross-check).
// Sourced from each tool's own JSON-schema `action` enum, not a live capture
// — headless test sessions confirmed (empirically, 2026-08-05) to have no
// access to either tool, so their real firing behavior is unverified; the
// discriminating field/value is the tool's own documented contract, not a
// guess. `mcp__Claude_Browser__computer` is the exact tool named in the real
// elba-dreaming evidence this whole mechanism is built from — not a
// coincidental match. `zoom` counts for that tool because its own
// description is "Take a screenshot of a specific region for closer
// inspection" — a capture, just cropped.
//
// Environment-dependent, stated plainly: these are the tool names this
// environment's MCP servers use. A project with a different browser/capture
// tool (Playwright MCP, Puppeteer, none at all) simply never matches this
// map — harmless, not an error — but its screenshots won't be tracked until
// its real tool names are added here the same way these were: from the
// tool's own schema, or from real evidence of what that project actually
// uses.
const CAPTURE_TOOL_ACTIONS = {
  'mcp__Claude_Browser__computer': new Set(['screenshot', 'zoom']),
  'mcp__Claude_Code_iOS_Simulator__control': new Set(['screenshot']),
};

function captureActionFrom(toolName, toolInput) {
  const allowedActions = CAPTURE_TOOL_ACTIONS[toolName];
  if (!allowedActions) return null;
  if (!toolInput || typeof toolInput !== 'object') return null;
  const action = toolInput.action;
  return allowedActions.has(action) ? action : null;
}

function isGovernedToolCall(toolName) {
  return toolName === 'Skill' || toolName === 'Agent' || toolName in CAPTURE_TOOL_ACTIONS;
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
  const captureAction = captureActionFrom(toolName, payload.tool_input);

  return {
    ts: new Date().toISOString(),
    session_id: payload.session_id || null,
    hook_event: hookEvent,
    tool_name: toolName,
    invoked_name: invokedNameFrom(toolName, payload.tool_input),
    // Only set for a known capture tool called with a capture-type action
    // (e.g. "screenshot") — null for everything else, including non-capture
    // actions on the same tool (a "scroll" or "click" is not a capture).
    capture_action: captureAction,
    tool_use_id: payload.tool_use_id || null,
    outcome,
    cwd: payload.cwd || null,
  };
}

// gy5.3 — per-artifact-version provenance. A Skill/Agent line proves a phase
// ran; it cannot say which artifact version it produced. An observed Write/Edit
// into a .delivery/ tree can: the artifact's own path picks its root by walking
// upward (no cwd ambiguity exists for this class, by construction), and a
// sha256 of the file as it exists after the successful write binds the ledger
// line to one version. Edits after an invocation are therefore not a provenance
// hole: an in-session edit appends a new version line; an out-of-session edit
// leaves the file's hash matching no line, which /delivery:status reports as
// modified-after-observation (OQ-6, context-management brief r2).
//
// Deliberate exclusions: writes outside any .delivery tree (not governed),
// writes into invocations/ itself (the ledger must not observe itself), and
// PostToolUseFailure (a failed write changed no version). Only file_path is
// read from tool_input — the whitelist constraint above holds; the hash is
// computed from the file on disk, never from tool_input content.
const ARTIFACT_WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function recordArtifactWrite(payload) {
  if (payload.hook_event_name !== 'PostToolUse') return null;
  const input = payload.tool_input;
  const filePath = input && typeof input === 'object' ? input.file_path : null;
  if (!filePath || typeof filePath !== 'string') return null;

  const deliveryRoot = findDeliveryRootUpward(path.dirname(filePath));
  if (!deliveryRoot) return null;
  const rel = path.relative(deliveryRoot, filePath);
  if (rel.startsWith('..') || rel.split(path.sep)[0] === 'invocations') return null;

  let contentHash = null;
  try {
    contentHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (err) {
    return null; // file not readable after a "successful" write — nothing truthful to record
  }

  const sessionId = payload.session_id || 'unknown-session';
  const record = {
    ts: new Date().toISOString(),
    session_id: payload.session_id || null,
    hook_event: payload.hook_event_name || null,
    record_type: 'artifact_write',
    tool_name: payload.tool_name || null,
    artifact: rel,
    content_hash: contentHash,
    tool_use_id: payload.tool_use_id || null,
    outcome: 'success',
    cwd: payload.cwd || null,
  };

  const ledgerDir = path.join(deliveryRoot, 'invocations');
  const ledgerPath = path.join(ledgerDir, `${sessionId}.ndjson`);
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(record) + '\n');
  return { ledgerPath, record };
}

function recordInvocation(payload, options) {
  const cwdForResolution = (options && options.cwd) || payload.cwd || process.cwd();
  if (!shouldRecord(cwdForResolution)) return null; // an ordinary session outside any project

  // Artifact writes are their own governed class (gy5.3) — resolved by the
  // artifact's path, not the session cwd.
  if (ARTIFACT_WRITE_TOOLS.has(payload.tool_name)) {
    return recordArtifactWrite(payload);
  }

  // Governed = Skill/Agent invocations (FR-1-4) or a real capture-tool call
  // (FR-9's channel cross-check). Everything else is ignored even if
  // hooks.json's matcher ever widens — this is the actual filter of record.
  if (!isGovernedToolCall(payload.tool_name)) return null;
  if (
    payload.tool_name !== 'Skill' &&
    payload.tool_name !== 'Agent' &&
    !captureActionFrom(payload.tool_name, payload.tool_input)
  ) {
    return null;
  }

  const sessionId = payload.session_id || 'unknown-session';
  const deliveryRoot = findDeliveryRoot(cwdForResolution);
  if (!deliveryRoot) return null; // nothing governed reachable — no-op, not an error

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

module.exports = {
  recordArtifactWrite,
  findDeliveryRoot,
  findDeliveryRootUpward,
  shouldRecord,
  invokedNameFrom,
  captureActionFrom,
  isGovernedToolCall,
  buildRecord,
  recordInvocation,
  CAPTURE_TOOL_ACTIONS,
};
