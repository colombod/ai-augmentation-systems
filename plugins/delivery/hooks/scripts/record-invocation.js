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

const DOWNWARD_SEARCH_MAX_DEPTH = 4;
const DOWNWARD_SEARCH_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.cache',
]);

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

// Bounded breadth-first search downward from startDir. A component's
// .delivery/ (e.g. plugins/<name>/.delivery/ in a marketplace repo) sits
// BELOW a session's cwd when the session runs from the repo root, not
// above it — the upward walk alone misses this real, common shape,
// confirmed by running this exact script against this exact repo.
//
// Returns every .delivery/ found, not just a resolved single answer —
// findDeliveryRootDownward (below) collapses this to one-or-null for the
// plain case; recordInvocation's session-continuity fallback (added after
// a real gap found live in the chief-of-staff epic's own spike — see its
// call site) needs the full candidate list to break a tie honestly.
function findAllDeliveryRootsDownward(startDir, maxDepth) {
  const found = [];
  let frontier = [{ dir: startDir, depth: 0 }];

  while (frontier.length > 0) {
    const next = [];
    for (const { dir, depth } of frontier) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        continue; // unreadable directory — skip, do not throw
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.delivery') {
          found.push(path.join(dir, entry.name));
          continue; // do not descend into a found .delivery/ itself
        }
        if (DOWNWARD_SEARCH_SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.delivery') continue;
        if (depth + 1 <= maxDepth) {
          next.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
    }
    frontier = next;
  }
  return found;
}

function findDeliveryRootDownward(startDir, maxDepth) {
  const found = findAllDeliveryRootsDownward(startDir, maxDepth);

  // Exactly one candidate is usable without guessing. Zero means nothing
  // governed here. More than one is the same "ask, don't guess" situation
  // the skill-level resolution algorithm names — a script can't ask, so it
  // declines rather than picking one here. (recordInvocation's caller has
  // one more real, non-guessing tiebreaker available to it — see below.)
  if (found.length === 1) return found[0];
  return null;
}

function findDeliveryRoot(startDir) {
  const upward = findDeliveryRootUpward(startDir);
  if (upward) return upward;
  return findDeliveryRootDownward(startDir, DOWNWARD_SEARCH_MAX_DEPTH);
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

function recordInvocation(payload, options) {
  const cwdForResolution = (options && options.cwd) || payload.cwd || process.cwd();

  // Governed = Skill/Agent invocations (FR-1-4) or a real capture-tool call
  // (FR-9's channel cross-check). Everything else is ignored even if
  // hooks.json's matcher ever widens — this is the actual filter of record.
  if (!isGovernedToolCall(payload.tool_name)) return null;

  // A non-capture action on a capture-capable tool (e.g. a plain click or
  // scroll on the browser tool) is not itself governed — only Skill/Agent
  // calls and genuine capture actions are.
  if (
    payload.tool_name !== 'Skill' &&
    payload.tool_name !== 'Agent' &&
    !captureActionFrom(payload.tool_name, payload.tool_input)
  ) {
    return null;
  }

  const sessionId = payload.session_id || 'unknown-session';
  let deliveryRoot = findDeliveryRoot(cwdForResolution);

  // Session continuity — a real gap found live, not a hypothetical: a downward
  // search ambiguous between multiple candidates (e.g. this repo's own
  // plugins/delivery/.delivery + plugins/attractor/.delivery) isn't a dead end
  // if THIS session already wrote a ledger entry under exactly one of them
  // earlier — that's an established fact about where this session's governed
  // work lives, not a guess. A brand-new session with no prior write, or one
  // where two candidates both already have a ledger, stays correctly declined
  // — this only resolves the case a script can settle without asking.
  if (!deliveryRoot && !findDeliveryRootUpward(cwdForResolution)) {
    const candidates = findAllDeliveryRootsDownward(cwdForResolution, DOWNWARD_SEARCH_MAX_DEPTH);
    if (candidates.length > 1) {
      const withEstablishedLedger = candidates.filter((candidate) =>
        fs.existsSync(path.join(candidate, 'invocations', `${sessionId}.ndjson`))
      );
      if (withEstablishedLedger.length === 1) {
        deliveryRoot = withEstablishedLedger[0];
      }
    }
  }

  if (!deliveryRoot) return null; // nothing governed here yet, or still genuinely ambiguous — no-op, not an error

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
  findDeliveryRoot,
  findDeliveryRootUpward,
  findDeliveryRootDownward,
  findAllDeliveryRootsDownward,
  invokedNameFrom,
  captureActionFrom,
  isGovernedToolCall,
  buildRecord,
  recordInvocation,
  CAPTURE_TOOL_ACTIONS,
};
