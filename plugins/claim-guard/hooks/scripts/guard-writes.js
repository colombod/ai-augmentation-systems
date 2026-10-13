#!/usr/bin/env node
// PreToolUse hook: while a claim-guard run holds the review posture
// (.claim-guard/GUARD_ACTIVE exists), Edit/Write/NotebookEdit are denied —
// the gate never edits the code it reviews. Any internal failure ALLOWS:
// a broken plugin must never brick editing.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin());
  } catch {
    /* malformed input -> allow */
  }
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  let active = false;
  try {
    active = fs.existsSync(path.join(root, ".claim-guard", "GUARD_ACTIVE"));
  } catch {
    active = false;
  }
  if (active) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "claim-guard review posture active — the gate never edits the code it reviews. Finish the run (Phase 7 close-out calls claim_ledger deactivate_guard) or abandon it explicitly to re-enable writes.",
        },
      }),
    );
  }
}

try {
  main();
} catch (e) {
  console.error("guard-writes hook error (allowing):", e && e.message);
}
process.exit(0);
