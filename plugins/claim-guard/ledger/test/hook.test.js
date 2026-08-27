import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "hooks", "scripts", "guard-writes.js",
);

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claim-guard-hook-"));
});

function runHook(input, env = {}) {
  return spawnSync("node", [SCRIPT], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, ...env },
  });
}

const editCall = () => ({
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_input: { file_path: path.join(tmp, "src", "x.py") },
  cwd: tmp,
});

test("denies Edit while GUARD_ACTIVE exists", () => {
  fs.mkdirSync(path.join(tmp, ".claim-guard"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claim-guard", "GUARD_ACTIVE"), "now\n");
  const r = runHook(editCall());
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /claim-guard review posture active/);
});

test("allows (empty stdout) when the marker is absent", () => {
  const r = runHook(editCall());
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("falls back to cwd from stdin when CLAUDE_PROJECT_DIR is unset", () => {
  fs.mkdirSync(path.join(tmp, ".claim-guard"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".claim-guard", "GUARD_ACTIVE"), "now\n");
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("node", [SCRIPT], { input: JSON.stringify(editCall()), encoding: "utf8", env });
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});

test("never bricks editing: malformed stdin allows", () => {
  const r = spawnSync("node", [SCRIPT], {
    input: "not json at all",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
