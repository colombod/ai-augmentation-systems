import { execFileSync } from 'node:child_process'

export interface Check {
  name: string
  ok: boolean
  required: boolean
  detail: string
}

function probe(name: string, args: string[], required: boolean): Check {
  try {
    const out = execFileSync(name, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { name, ok: true, required, detail: out.trim().split('\n')[0] || 'present' }
  } catch (err) {
    // "missing" and "present but broken" need different answers. Telling an
    // operator whose claude install has an auth problem that it is "not
    // found" sends them hunting for a binary already on their PATH -- the
    // opposite of what this command exists to do.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { name, ok: false, required, detail: 'not found' }
    }
    const reason = err instanceof Error ? err.message.trim().split('\n')[0] : String(err)
    return { name, ok: false, required, detail: `present but failing: ${reason}` }
  }
}

/**
 * Every check runs independently. An operator repairing their environment
 * needs the complete list in one pass, so a missing tool must not short
 * circuit the ones after it.
 */
/** Exported for tests: the two failure modes must be distinguishable. */
export function probeTool(name: string, args: string[], required: boolean): Check {
  return probe(name, args, required)
}

export function runChecks(): Check[] {
  return [
    probe('claude', ['--version'], true),
    probe('git', ['--version'], true),
    probe('sh', ['-c', 'echo ok'], true),
    // Optional: the Discord channel plugin is a Bun script (Plan 4), and
    // Graphviz renders images (Plan 6). Neither blocks running a pipeline.
    probe('bun', ['--version'], false),
    probe('dot', ['-V'], false),
  ]
}

export function checksPass(checks: Check[]): boolean {
  return checks.every((c) => c.ok || !c.required)
}

export function formatChecks(checks: Check[]): string {
  const lines = checks.map((c) => {
    const mark = (c.ok ? 'ok' : c.required ? 'MISSING' : 'absent').padEnd(7)
    const tag = c.required ? '' : ' (optional)'
    return `  ${mark}  ${c.name}${tag}: ${c.detail}`
  })
  return `attractor doctor\n${lines.join('\n')}\n`
}
