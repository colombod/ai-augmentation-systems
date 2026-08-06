import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, formatChecks, checksPass, probeTool as probe, type Check } from '../src/doctor.ts'

test('every required tool is checked', () => {
  const names = runChecks().map((c) => c.name)
  for (const required of ['claude', 'git', 'sh']) {
    assert.ok(names.includes(required), `${required} must be checked`)
  }
})

test('optional tools are checked but marked optional', () => {
  const checks = runChecks()
  for (const optional of ['bun', 'dot']) {
    const c = checks.find((x) => x.name === optional)
    assert.ok(c, `${optional} must be reported`)
    assert.equal(c?.required, false, `${optional} must not be required`)
  }
})

test('git and sh are present on any machine that can run this suite', () => {
  const checks = runChecks()
  assert.equal(checks.find((c) => c.name === 'git')?.ok, true)
  assert.equal(checks.find((c) => c.name === 'sh')?.ok, true)
})

test('a tool that exists but fails is reported as present, not missing', () => {
  // git exists on any machine running this suite; a bogus subcommand makes it
  // exit non-zero. Reporting that as "not found" would send an operator
  // looking for a binary that is already installed.
  const checks = runChecks()
  assert.equal(checks.find((c) => c.name === 'git')?.ok, true, 'precondition: git works')

  const broken = probe('git', ['definitely-not-a-subcommand'], true)
  assert.equal(broken.ok, false)
  assert.match(broken.detail, /present but failing/)
  assert.doesNotMatch(broken.detail, /not found/)
})

test('a genuinely absent binary is reported as not found', () => {
  const absent = probe('attractor-no-such-binary-xyz', ['--version'], false)
  assert.equal(absent.ok, false)
  assert.equal(absent.detail, 'not found')
})

test('claude specifically is reported MISSING when absent from PATH', () => {
  const originalPath = process.env.PATH
  try {
    process.env.PATH = ''
    const check = probe('claude', ['--version'], true)
    assert.equal(check.ok, false)
    assert.equal(check.detail, 'not found')
  } finally {
    process.env.PATH = originalPath
  }
})

test('a missing optional tool does not fail the overall verdict', () => {
  const checks: Check[] = [
    { name: 'claude', ok: true, required: true, detail: '2.1.220' },
    { name: 'bun', ok: false, required: false, detail: 'not found' },
  ]
  assert.equal(checksPass(checks), true)
})

test('a missing required tool fails the overall verdict', () => {
  const checks: Check[] = [
    { name: 'claude', ok: false, required: true, detail: 'not found' },
    { name: 'bun', ok: true, required: false, detail: '1.0' },
  ]
  assert.equal(checksPass(checks), false)
})

test('the report names every check and marks optional ones', () => {
  const text = formatChecks([
    { name: 'claude', ok: true, required: true, detail: '2.1.220' },
    { name: 'bun', ok: false, required: false, detail: 'not found' },
  ])
  assert.match(text, /claude/)
  assert.match(text, /2\.1\.220/)
  assert.match(text, /bun/)
  assert.match(text, /optional/i, 'an absent optional tool must be visibly optional')
})
