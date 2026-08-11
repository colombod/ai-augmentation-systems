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
    const child = spawn('sh', ['-c', command], { cwd })
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined

    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
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
