import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ENGINE = resolve(import.meta.dirname, '..')
const BUNDLE = resolve(ENGINE, '..', 'dist', 'attractor.js')
const ESBUILD = join(ENGINE, 'node_modules', 'esbuild', 'bin', 'esbuild')

/**
 * The committed bundle must be a build of the CURRENT sources.
 *
 * `dist/attractor.js` is deliberately not git-ignored, so installing the
 * plugin needs no build step -- which means a source change landed without a
 * rebuild ships a plugin that behaves like the previous commit while every
 * test in this suite, running from `src/`, stays green. That is exactly what
 * happened: the bundle went into Plan 3's final task carrying none of the
 * plan's corrections, and the two tests below could not tell. They run the
 * bundle, so they prove it WORKS; nothing proved it was CURRENT.
 *
 * Rebuilding to a temp file and comparing bytes is the general form of that
 * check: it catches any un-rebuilt source change, not merely the ones a
 * hand-written behavioural probe happens to cover. esbuild is deterministic
 * for a fixed input and version, so a byte difference means the committed
 * artifact and the sources disagree.
 *
 * Skipped rather than failed when esbuild is absent: this machine's npm
 * registry cannot reach `registry.npmjs.org`, so `npm install` is not a
 * remedy a contributor can apply, and a hard failure would make the suite
 * un-runnable instead of reporting a missing dev dependency.
 */
test('the committed bundle is a build of the current sources', { skip: !existsSync(ESBUILD) && 'esbuild not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-fresh-'))
  try {
    const fresh = join(dir, 'attractor.js')
    execFileSync(
      ESBUILD,
      [
        'src/cli.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        `--outfile=${fresh}`,
        '--banner:js=#!/usr/bin/env node',
      ],
      { cwd: ENGINE, encoding: 'utf8' },
    )
    assert.equal(
      readFileSync(BUNDLE, 'utf8'),
      readFileSync(fresh, 'utf8'),
      'dist/attractor.js is stale - run `npm run build` in plugins/attractor/engine and commit the result',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the bundle exists after npm run build', () => {
  assert.ok(
    existsSync(BUNDLE),
    'dist/attractor.js missing - run `npm run build` in plugins/attractor/engine',
  )
})

test('the bundle lints a graph with no node_modules present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-'))
  try {
    const file = join(dir, 'g.dot')
    writeFileSync(
      file,
      `digraph G {
         start [shape=Mdiamond]
         done  [shape=Msquare]
         a [shape=parallelogram, tool_command="printf ok"]
         start -> a -> done
       }`,
      'utf8',
    )
    const out = execFileSync('node', [BUNDLE, 'lint', file], {
      cwd: dir,
      encoding: 'utf8',
    })
    assert.match(out, /no errors/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the bundle runs a graph end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-run-'))
  try {
    const file = join(dir, 'g.dot')
    writeFileSync(
      file,
      `digraph G {
         start [shape=Mdiamond]
         done  [shape=Msquare]
         a [shape=parallelogram, tool_command="printf hello > out.txt; printf ok"]
         start -> a -> done
       }`,
      'utf8',
    )
    const out = execFileSync(
      'node',
      [BUNDLE, 'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub'],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.match(out, /status: success/)
    assert.match(out, /start -> a -> done/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// p2-10: FR-5's real, sanctioned invocation path -- ADR-002's "primary invocation
// path... almost certainly non-TTY" -- proven against the actual built CLI, not an
// in-process proxy. `execFileSync`'s default stdio is a pipe, never a TTY, matching
// the Bash-tool-spawned invocation Spike 13 confirmed earlier this same phase
// (`process.stdin.isTTY` reads `undefined`).
test('the bundle refuses a human-gate graph loudly and fast when stdin is not a TTY (FR-5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attractor-bundle-humangate-'))
  try {
    const file = join(dir, 'gate.dot')
    writeFileSync(
      file,
      `digraph G {
         start [shape=Mdiamond]
         done  [shape=Msquare]
         gate  [shape=hexagon, prompt="approve?"]
         gate -> done [label="ok"]
         start -> gate
       }`,
      'utf8',
    )
    const start = Date.now()
    let threw: { status: number | null; stdout: string; stderr: string } | undefined
    try {
      execFileSync('node', [BUNDLE, 'run', file, '--cwd', dir, '--run-dir', join(dir, 'r'), '--stub'], {
        cwd: dir,
        encoding: 'utf8',
      })
    } catch (err) {
      const e = err as { status: number | null; stdout: string; stderr: string }
      threw = { status: e.status, stdout: e.stdout, stderr: e.stderr }
    }
    const elapsed = Date.now() - start

    assert.ok(threw, 'the process must exit non-zero, not succeed')
    assert.notEqual(threw?.status, 0)
    assert.ok(elapsed < 5000, `expected a fast, loud refusal, took ${elapsed}ms`)
    assert.doesNotMatch(threw?.stdout ?? '', /status:/, 'no status: line -- the run never actually dispatched')
    assert.match(threw?.stderr ?? '', /human gate/i)
    assert.match(threw?.stderr ?? '', /gate/)
    // Confirms which refusal path actually fired, rather than assuming it: a bare
    // hexagon node with the default human.channel and no --allow-agent-gates/
    // --channel flags is caught by the CLI's own fast-path preflight (p2-09) before
    // any worktree or Engine is constructed, not by Engine.run()'s own copy (that
    // would still refuse it too, but only after worktree setup) nor by
    // HumanGateHandler's dispatch loop (never reached at all -- no node dispatches).
    assert.match(threw?.stderr ?? '', /refusing to run: a reachable human gate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// p2-10: FR-7's literal, final acceptance confirmation for the whole phase -- the
// existing HITL-001 suite must pass completely unmodified. Re-run directly here
// rather than only trusted from the full `node --test` run, so this story's own
// record shows the check was actually re-executed, not merely assumed still green.
test('FR-7 acceptance: the full HITL-001 suite passes unmodified', () => {
  // This test file is itself a child process node --test spawned (isolation
  // mode), which set NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID in its own env.
  // Inheriting those into the nested `node --test` below makes Node's own
  // recursion guard treat it as an accidental nested call and skip running
  // it entirely ("run() is being called recursively... skipping running
  // files") -- stripping both lets the nested invocation run for real.
  const { NODE_TEST_CONTEXT: _ctx, NODE_TEST_WORKER_ID: _worker, ...cleanEnv } = process.env
  const out = execFileSync('node', ['--test', 'test/lint.test.ts'], {
    cwd: ENGINE,
    encoding: 'utf8',
    env: cleanEnv,
  })
  assert.match(out, /(?:#|ℹ) pass \d+/)
  assert.doesNotMatch(out, /(?:#|ℹ) fail [1-9]/, 'the lint suite, including all 8 HITL-001 tests, must be fully green')
})
