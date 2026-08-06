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
