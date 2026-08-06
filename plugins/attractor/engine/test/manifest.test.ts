import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '../..')
const repoRoot = resolve(here, '../../../..')

test('plugin.json is valid JSON with a name and a semver version', () => {
  const raw = readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')
  const manifest = JSON.parse(raw)
  assert.equal(manifest.name, 'attractor')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

test('marketplace.json carries exactly one attractor entry, sourced at plugins/attractor, version matching plugin.json', () => {
  const raw = readFileSync(resolve(repoRoot, '.claude-plugin/marketplace.json'), 'utf8')
  const marketplace = JSON.parse(raw)
  const entries = marketplace.plugins.filter((p: { name: string }) => p.name === 'attractor')
  assert.equal(entries.length, 1, 'exactly one attractor entry')
  assert.equal(entries[0].source, './plugins/attractor')
  // ADR-001's correction: the real marketplace.json's existing `delivery` entry already
  // carries a per-entry version, so attractor's does too for consistency -- the
  // version-masking risk the platform docs warn about is accepted, same as it already is
  // for delivery, rather than being the one inconsistent entry in the array.
  const pluginRaw = readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')
  const plugin = JSON.parse(pluginRaw)
  assert.equal(entries[0].version, plugin.version)
})

test('the attractor skill sets its name explicitly in frontmatter', () => {
  const raw = readFileSync(resolve(pluginRoot, 'skills/attractor/SKILL.md'), 'utf8')
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(frontmatter, 'SKILL.md must have YAML frontmatter')
  assert.match(frontmatter![1], /^name:\s*attractor\s*$/m)
})
