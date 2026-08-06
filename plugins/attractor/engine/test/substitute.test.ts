import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '../src/core/context.ts'
import { substitute, referencedKeys } from '../src/core/substitute.ts'

test('context stores, merges and snapshots', () => {
  const c = Context.from({ goal: 'ship' })
  c.set('iter', '3')
  c.merge({ iter: '4', extra: 'yes' })
  assert.equal(c.get('goal'), 'ship')
  assert.equal(c.get('iter'), '4')
  assert.deepEqual(c.snapshot(), { goal: 'ship', iter: '4', extra: 'yes' })
  assert.equal(c.has('missing'), false)
})

test('substitutes $name and ${name}', () => {
  const c = Context.from({ goal: 'ship it', dir: '/tmp/x' })
  assert.equal(substitute('do $goal in ${dir}', c), 'do ship it in /tmp/x')
})

test('absent keys are left as literal text', () => {
  const c = Context.from({})
  assert.equal(substitute('VF="$task_file"', c), 'VF="$task_file"')
})

test('shell parameter expansion is not treated as a key', () => {
  const c = Context.from({ VF: 'should-not-be-used' })
  assert.equal(substitute('${VF%.md}.verify.sh', c), '${VF%.md}.verify.sh')
  assert.equal(substitute('${B:-6}', c), '${B:-6}')
})

test('longest key wins so prefixes do not corrupt', () => {
  const c = Context.from({ task: 'A', task_file: 'B' })
  assert.equal(substitute('$task_file', c), 'B')
})

test('command substitution is untouched', () => {
  const c = Context.from({ n: '9' })
  assert.equal(substitute('n=$(cat .ai/iter)', c), 'n=$(cat .ai/iter)')
})

test('a substituted value is never re-expanded', () => {
  // The engine must expand what the author wrote, once. If a value that
  // itself contains $HOME were rescanned, the engine would invent an
  // expansion the author never asked for.
  const c = Context.from({ dir: '$HOME', HOME: '/root' })
  assert.equal(substitute('cd ${dir}', c), 'cd $HOME')
  assert.equal(substitute('cd $dir', c), 'cd $HOME')
})

test('a value containing replacement syntax is inserted literally', () => {
  const c = Context.from({ pat: '$& and $1' })
  assert.equal(substitute('use $pat', c), 'use $& and $1')
})

test('clone is independent of the original', () => {
  const a = Context.from({ k: '1' })
  const b = a.clone()
  b.set('k', '2')
  b.set('extra', 'x')
  assert.equal(a.get('k'), '1')
  assert.equal(a.has('extra'), false)
  assert.equal(b.get('k'), '2')
})

test('both reference forms are extracted', () => {
  assert.deepEqual(
    referencedKeys('cd $dir && cat ${artifact.path}').sort(),
    ['artifact.path', 'dir'],
  )
})

test('$$ is not a reference: it is consumed but never names a key', () => {
  assert.deepEqual(referencedKeys('echo $$HOME'), [])
})

test('$$ (HOME) is preserved verbatim, not collapsed to a single $', () => {
  // $$ must be consumed by the tokenizer -- otherwise the second $ of
  // $$HOME would be picked up by the bare-key alternative and HOME would
  // expand. But it must NOT be rewritten to a single $: see the shell
  // idiom test below for why.
  const c = Context.from({ HOME: '/root' })
  assert.equal(substitute('echo $$HOME', c), 'echo $$HOME')
})

test('the shell $$ (process id) idiom in a tool_command survives untouched', () => {
  // Regression guard, not a unit test of the regex: substitute() feeds
  // tool_command, a real shell command line, where $$ is the process-id
  // idiom (`mktemp /tmp/build.$$`). Rewriting $$ to a single $ would
  // silently turn a valid, common shell idiom into broken text with no
  // diagnostic -- the engine inventing an expansion the author never
  // wrote, which is exactly what this module's single-pass design exists
  // to prevent.
  const c = Context.from({})
  assert.equal(substitute('mktemp /tmp/build.$$', c), 'mktemp /tmp/build.$$')
})

test('extraction and substitution agree on every token', () => {
  // This is the load-bearing test: it fails the moment referencedKeys and
  // substitute disagree about what counts as a token, because it derives
  // the context entirely from referencedKeys and then checks substitute's
  // output against a literal expectation computed by hand. $$lit must
  // survive as $$lit -- referencedKeys must not report "lit" as a key
  // needing a context value, and substitute must not touch it.
  const text = 'a $x ${y.z} $$lit ${} $'
  const ctx = new Context()
  for (const k of referencedKeys(text)) ctx.set(k, 'V')
  // One assertion, deliberately. There was a second -- `assert.ok(!substitute(
  // text, ctx).includes('V') === false)` -- which was double-negated into
  // "the output contains a V", fully subsumed by the equality below, and
  // unable to fail while the equality passed. A dead assertion is worse than
  // none: it reads as extra coverage.
  assert.equal(substitute(text, ctx), 'a V V $$lit ${} $')
})
