import { type Context } from './context.ts'
import { type Outcome } from './outcome.ts'

const CLAUSE = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|=)\s*(.*?)\s*$/

/** A bare (operator-less) clause is only a truthiness check on a single key. */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/

/**
 * Resolve a clause's left-hand side.
 *
 * Spec section 10.4: a `context.`-prefixed key tries the literal key first, then
 * the key without the prefix; an unqualified key is a direct context lookup.
 * A key that resolves to nothing is the EMPTY STRING, not undefined — spec
 * section 10.3 requires missing keys to compare as empty, which is what makes
 * the loop-guard idiom `context.loop_state!=exhausted` true on first pass.
 *
 * The two engine built-ins short-circuit to the live `Outcome`, and both must
 * agree with their `context.`-qualified spelling, because section 10.4 presents
 * the unprefixed fallback as a convenience ALIAS -- two spellings of one key
 * that answer differently is a trap, not a feature.
 *
 * - `outcome` agrees for free. `Engine.recordOutcome` writes `context.outcome`
 *   unconditionally immediately before edge selection, so the live status and
 *   the context key are the same value at every point a condition is evaluated.
 * - `preferred_label` did NOT. Section 3.2 step 4 writes it only "IF
 *   outcome.preferred_label is not empty", so the context key is deliberately
 *   STICKY: it holds the last non-empty label and is never cleared. The bare
 *   spelling read the live label, which is empty on a node that offered none --
 *   so `preferred_label=ship` was false at exactly the moment
 *   `context.preferred_label=ship` was true.
 *
 * The fix keeps the stickiness (it is spec-mandated, doctrine, and tested) and
 * makes the bare form implement the SAME "last non-empty wins" rule: live label
 * if it is non-empty, otherwise the sticky context key. That is not a
 * concession to the context key -- it is section 3.2 step 4's own rule applied
 * in both places instead of one. Reading through the live outcome first also
 * keeps the bare spelling correct for a caller evaluating a condition without
 * an engine-populated context, which is how the unit tests use it.
 */
function resolveKey(key: string, ctx: Context, outcome: Outcome): string {
  if (key === 'outcome') return outcome.status
  if (key === 'preferred_label') {
    const live = outcome.preferredLabel
    return live !== undefined && live !== '' ? live : (ctx.get('preferred_label') ?? '')
  }
  if (key.startsWith('context.')) {
    return ctx.get(key) ?? ctx.get(key.slice('context.'.length)) ?? ''
  }
  return ctx.get(key) ?? ''
}

/** Spec section 10.5: a double-quoted literal is unquoted before comparison. */
function parseLiteral(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  return v
}

/**
 * Split a condition into its `&&`-joined clauses. The one tokenizing
 * decision `evaluateCondition` and `isValidConditionSyntax` must never make
 * independently -- both call through here rather than each doing their own
 * `expr.split('&&')`, so a future change to how splitting works (for
 * example, making it quote-aware -- see the Concerns note this addresses in
 * the task 7 report) changes evaluation and linting together instead of one
 * silently drifting from the other.
 *
 * Empty or whitespace-only input has no clauses: spec section 10.7 makes
 * that condition unconditionally true, and a naive `''.split('&&')` would
 * instead yield `['']`, a single clause that both callers would otherwise
 * have to special-case as "empty bare clause, not `true`". Handling it here
 * once means neither caller carries that special case.
 *
 * Not quote-aware: a value containing a literal `&&` inside quotes (for
 * example `key="a&&b"`) is split mid-literal here exactly as it always has
 * been, before this function existed. That is a real, pre-existing grammar
 * limitation, not something introduced by sharing this splitter -- and
 * sharing it is what guarantees the lint layer inherits the same limitation
 * rather than silently disagreeing with it.
 */
function splitClauses(expr: string): string[] {
  const trimmed = expr.trim()
  return trimmed === '' ? [] : trimmed.split('&&')
}

/**
 * Statically check a condition string against the same grammar
 * `evaluateCondition` parses, without needing a live `Context`/`Outcome` to
 * evaluate against. This is the lint layer's grammar authority: it shares
 * `CLAUSE` and `splitClauses` with `evaluateCondition` below so the two
 * cannot drift apart.
 *
 * The reason this is not just "does `evaluateCondition` throw" is that
 * `evaluateCondition` never throws -- a malformed bare clause such as
 * `outcome success` (missing `=`) is not rejected at runtime, it is looked
 * up as a literal context key via `resolveKey()`, found nowhere, and
 * silently evaluates to false forever. That is a syntax error from a
 * human-authoring standpoint even though the engine tolerates it, and it is
 * exactly the failure mode spec section 10.3's empty-string-on-miss rule
 * (see `resolveKey` above) makes more dangerous: a typo no longer throws,
 * it just quietly routes wrong. This function is what lets the lint layer
 * catch it before the graph runs.
 *
 * A bare clause is valid only when it is a single identifier (spec section
 * 10.5's truthiness check) -- so `context.ready` is fine, but text
 * containing a space, or `||` (deliberately not an operator per section
 * 10.7 -- see the comment on `evaluateCondition`), fails this check and is
 * flagged. This does not add `||` as an operator: inside a matched
 * `key[!]=value` clause the value capture is unconstrained free text, so
 * `key=a||b` is accepted unchanged, exactly as `evaluateCondition` treats
 * it. Only a clause with no operator at all is held to the stricter
 * identifier shape, because at runtime that is a key lookup.
 *
 * Deliberate asymmetry, recorded here so it is never "fixed" into a hole:
 * `resolveKey`, the runtime lookup a bare clause resolves through, accepts
 * ANY non-empty string as a key -- a `--param feature-flag=on`-style key is
 * a real, producible context key `evaluateCondition` resolves correctly,
 * hyphen included. `BARE_IDENTIFIER` is narrower than that on purpose: it
 * excludes the hyphen along with the space and `||`. "Cannot drift"
 * therefore describes `CLAUSE` and `splitClauses` -- shared verbatim, so
 * evaluation and linting can never disagree on those -- and not this
 * branch, which is intentionally *stricter* than the engine rather than a
 * mirror of it. That is a style constraint, not an oversight: every
 * condition and every `--param`/`contextUpdates` key already in this
 * codebase's fixtures uses the identifier charset, and a `key[!]=value`
 * comparison can never reference a hyphenated key at all -- its left-hand
 * side is bound by this same `CLAUSE` charset, a limitation that predates
 * this function. A hyphenated key was therefore already unusable through
 * one of the two clause forms; narrowing the bare form to match closes the
 * one remaining inconsistent escape hatch rather than adding a new
 * restriction. Widening `BARE_IDENTIFIER` to match `resolveKey`'s raw
 * permissiveness would silently readmit this rule's own flagship case --
 * `condition="outcome success"` is, after all, just another non-empty
 * string `resolveKey` tolerates without complaint.
 */
export function isValidConditionSyntax(expr: string): boolean {
  return splitClauses(expr).every((raw) => CLAUSE.test(raw) || BARE_IDENTIFIER.test(raw.trim()))
}

/**
 * Evaluate an edge condition. The grammar is a conjunction of comparisons
 * joined by `&&`; there is deliberately no disjunction, so routing stays
 * readable in the graph rather than hidden in expressions (spec section
 * 10.7 asks implementations not to add operators without updating the
 * grammar, so a `||` inside a value stays literal text and simply fails to
 * match rather than being treated as an operator).
 *
 * A clause with no operator is a truthiness check on the bare key (spec
 * section 10.5).
 */
export function evaluateCondition(expr: string, ctx: Context, outcome: Outcome): boolean {
  for (const raw of splitClauses(expr)) {
    const m = CLAUSE.exec(raw)
    if (m === null) {
      const bare = raw.trim()
      if (bare === '') return false
      if (resolveKey(bare, ctx, outcome) === '') return false
      continue
    }
    const [, key, op, expected] = m
    const actual = resolveKey(key, ctx, outcome)
    const equal = actual === parseLiteral(expected)
    if (op === '=' ? !equal : equal) return false
  }
  return true
}
