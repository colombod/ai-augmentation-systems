// Persistence for claim-guard runs. Writes ONLY under <repo>/.claim-guard/ —
// this confinement is a structural guarantee the tests pin down.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RunRecord } from "./types.js";

export function repoRoot(): string {
  return process.env.CLAIM_GUARD_REPO || process.cwd();
}

export function ledgerRoot(): string {
  return path.join(repoRoot(), ".claim-guard");
}

export function runDir(runId: string): string {
  return path.join(ledgerRoot(), runId);
}

export function newRunId(): string {
  return "run_" + randomBytes(4).toString("hex");
}

const RUN_ID_SHAPE = /^run_[0-9a-f]{8}$/;

export function loadRun(runId: string): RunRecord | null {
  if (!RUN_ID_SHAPE.test(runId)) return null;
  const file = path.join(runDir(runId), "ledger.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
  } catch {
    return null;
  }
}

export function saveRun(run: RunRecord): void {
  const dir = runDir(run.run_id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ledger.json");
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function listRunIds(): string[] {
  try {
    return fs
      .readdirSync(ledgerRoot())
      .filter((name) => RUN_ID_SHAPE.test(name))
      .filter((name) => fs.existsSync(path.join(runDir(name), "ledger.json")))
      .sort();
  } catch {
    return [];
  }
}

export function guardMarkerPath(): string {
  return path.join(ledgerRoot(), "GUARD_ACTIVE");
}
