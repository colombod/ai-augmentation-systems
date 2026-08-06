import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export interface Checkpoint {
  runId: string
  currentNode: string | null
  completed: string[]
  attempts: Record<string, number>
  context: Record<string, string>
  goalGatesSatisfied: string[]
}

/**
 * §5.3 wire shape. A spec-written resume tool must be able to read this file,
 * so the on-disk field names are the spec's, not our internal `Checkpoint`
 * type's -- the internal shape is unaffected and converted at the boundary.
 */
interface CheckpointWire {
  timestamp: string
  run_id: string
  current_node: string | null
  completed_nodes: string[]
  node_retries: Record<string, number>
  context: Record<string, string>
  goal_gates_satisfied: string[]
}

function toWire(cp: Checkpoint): CheckpointWire {
  return {
    timestamp: new Date().toISOString(),
    run_id: cp.runId,
    current_node: cp.currentNode,
    completed_nodes: cp.completed,
    node_retries: cp.attempts,
    context: cp.context,
    goal_gates_satisfied: cp.goalGatesSatisfied,
  }
}

function fromWire(w: CheckpointWire): Checkpoint {
  return {
    runId: w.run_id,
    currentNode: w.current_node,
    completed: w.completed_nodes,
    attempts: w.node_retries,
    context: w.context,
    goalGatesSatisfied: w.goal_gates_satisfied,
  }
}

const FILE = 'checkpoint.json'

/** fsync a path, ignoring platforms that refuse to sync a directory. */
function syncPath(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch {
    // Some platforms (notably Windows) reject fsync on a directory handle.
    // Losing the directory sync is a weaker guarantee, not a failed write.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Write atomically AND durably.
 *
 * A checkpoint truncated by a crash mid-write would make a run unresumable,
 * which defeats the point of having one. Temp-then-rename gives atomicity:
 * a reader sees the old file or the new one, never a half-written one.
 *
 * Atomicity alone only survives the PROCESS dying. Without fsync the bytes
 * can still be in page cache when the machine loses power, so on recovery
 * the rename may be visible while the data behind it is stale or zeroed.
 * A pipeline can park at a human gate overnight, so reboot survival is the
 * case that actually matters: the temp file is synced before the rename and
 * the directory entry after it.
 */
export function saveCheckpoint(runDir: string, cp: Checkpoint): void {
  mkdirSync(runDir, { recursive: true })
  const target = join(runDir, FILE)
  // Unique temp name: two writers on one run directory must not share it.
  const temp = `${target}.${process.pid}.tmp`
  const fd = openSync(temp, 'w')
  try {
    writeFileSync(fd, JSON.stringify(toWire(cp), null, 2), 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, target)
  syncPath(runDir)
}

export function loadCheckpoint(runDir: string): Checkpoint | null {
  const target = join(runDir, FILE)
  if (!existsSync(target)) return null
  return fromWire(JSON.parse(readFileSync(target, 'utf8')) as CheckpointWire)
}
