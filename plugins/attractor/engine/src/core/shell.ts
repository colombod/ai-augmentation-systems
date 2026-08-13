import { spawn } from 'node:child_process'

/**
 * Relocated from `handlers/tool.ts` (ADR-020) so `channels/command.ts` can share it
 * without a non-handler concern reaching into handler-owned code. Zero behavior change.
 */
export interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

export function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    // detached: true puts the child in its own POSIX process group, so a timeout can
    // kill the whole tree via a negative PID, not just the direct `sh` process.
    // Load-bearing on Linux, found by CI actually running a real long command (not by
    // local testing alone, which passed on macOS): `sh` there is typically `dash`,
    // which does not reliably exec-replace itself for a `-c "command"` invocation the
    // way macOS's bash-as-sh does -- it can fork the command as a genuine child. A
    // plain `child.kill()` then only kills `sh` itself, leaving whatever it forked
    // (e.g. `sleep`, or any multi-process pipeline) running to completion and holding
    // the stdout/stderr pipes open, so the timeout never actually bounds anything.
    const child = spawn('sh', ['-c', command], { cwd, detached: true })
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined

    const killTree = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        // The process group is already gone (the command already exited) -- nothing
        // left to kill, not an error worth surfacing.
      }
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => killTree('SIGKILL'), timeoutMs)
    }
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}${String(err)}` })
    })
  })
}

export function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return lines.length > 0 ? lines[lines.length - 1].trim() : ''
}
