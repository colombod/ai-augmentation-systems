import { type Context } from './context.ts'

/**
 * M5 substitution contract.
 *
 * Replaces `$key` and `${key}` with the context value for `key`. Keys absent
 * from context are left as literal text, so shell variables inside a
 * tool_command survive untouched.
 *
 * `${...}` forms carrying shell parameter-expansion operators (`%`, `#`, `:`,
 * `/`, `-`, `+`, `?`, `!`) are never treated as context keys. Command
 * substitution `$(...)` is likewise untouched, since `(` is not a key
 * character.
 *
 * `${key}` additionally accepts `.` in the key, because context keys are
 * flat dotted strings (`artifact.path`, `tool.output` -- see `context.ts`),
 * not nested objects. `$key` (the bare form) does not: it stands in for a
 * shell variable, and shell variable names never contain a dot, so widening
 * it would start swallowing characters a real shell would treat as separate
 * text.
 *
 * `$$` is matched and consumed as its own alternative, before either token
 * alternative is tried, so the character immediately after it is never
 * reinterpreted as the start of a key -- but it is emitted VERBATIM, not
 * collapsed to a single `$`. `tool_command` feeds a real shell, and in a
 * shell `$$` is the process-id idiom (`mktemp /tmp/build.$$`); rewriting it
 * to a single `$` would silently turn a valid, common shell idiom into
 * broken text with no diagnostic -- inventing an expansion the author never
 * wrote, exactly what the single-pass design below exists to prevent.
 * Consuming it (rather than leaving the tokenizer to stumble into `$HOME`
 * from the second `$` of `$$HOME`) is still necessary and still the fix:
 * `$$HOME` must not expand `HOME`. Emitting it unchanged is what keeps the
 * shell receiving exactly what the author wrote.
 *
 * `referencedKeys` below shares this exact pattern rather than keeping a
 * second regex that merely looks the same. A hand-duplicated tokenizer is
 * how `substitute` and the thing that predicts its output drift apart --
 * the same failure mode `splitClauses` in `condition.ts` was extracted to
 * prevent for the condition evaluator and its lint rule.
 */
const TOKEN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_.]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

export function substitute(text: string, ctx: Context): string {
  // ONE pass over the original text. Two chained passes would let a value
  // inserted by the first be rescanned by the second, so a context value
  // that happens to contain `$otherkey` would expand a second time -- the
  // engine inventing an expansion the author never wrote. A single
  // `replace` never rescans inserted text.
  return text.replace(TOKEN, (match, braced?: string, bare?: string) => {
    // $$ is consumed (so a following identifier is never mistaken for a
    // bare key) but handed back unchanged -- see the doc comment above.
    if (match === '$$') return '$$'
    const key = braced ?? bare
    if (key === undefined) return match
    const value = ctx.get(key)
    return value === undefined ? match : value
  })
}

/**
 * The set of context keys `substitute` would replace in `text` -- every
 * `$key` and `${key}` token, minus `$$` (which never names a key, since it
 * is emitted verbatim -- see the doc comment above), minus anything the
 * shell parameter-expansion exclusion or the empty-braces case leaves
 * untouched.
 *
 * This walks the exact same `TOKEN` pattern `substitute` replaces with, so
 * the two can never disagree about what counts as a reference. A second,
 * independently written regex would look right today and drift the moment
 * either function's pattern changed without the other.
 */
export function referencedKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(TOKEN)) {
    const key = match[1] ?? match[2]
    if (key !== undefined) keys.add(key)
  }
  return [...keys]
}
